// Client de transfert : création, ouverture, destruction et suivi d'un partage
// (spec §7.4 à §7.6). Tout le chiffrement a lieu ici ; le serveur ne reçoit que des
// empreintes (V_accès, V_preuve, V_gestion), K_accès, K_preuve ou S_gestion, et des
// segments chiffrés. K_lien, le mot de passe, les noms et le contenu ne sortent jamais.
import { BUCKETS, openStream, sealStream, segmentCount, segmentSize, type Item, type Manifest } from "../crypto/container";
import { b64u, unb64u } from "../crypto/encoding";
import {
  checkKdfParams,
  deriveAccess,
  deriveContent,
  deriveContentForCreate,
  KDF_CREATE,
  newKLien,
  newSGestion,
  randomBytes,
  sha256,
} from "../crypto/kdf";
import type { KLien } from "../crypto/types";
import * as api from "./api";
import { checkOrigin, manageLink, parseLink, shareLink, type ParsedLink } from "./link";
import { readCaptcha, takeCaptcha, type PreparedCaptcha } from "./prepare";
import { isRiskyName, previewKindOf, safeName, type PreviewKind } from "./safety";
import { SERVER_STALL_MS, abortError } from "./upload";

export type { Net } from "./api";
export type { PreparedCaptcha } from "./prepare";
export type { PreviewKind } from "./safety";

/** Paramètres Argon2id des nouveaux partages : ceux qu'impose deriveContentForCreate. */
export { KDF_CREATE };

/**
 * Délai minimal entre la réception du défi anti-robot et la création : le serveur refuse
 * une création moins de 3 s après l'émission du défi (heure signée « shown_at »). 100 ms
 * de marge couvrent l'arrondi à la seconde côté serveur.
 */
export const CAPTCHA_MIN_MS = 3100;

export class NotFoundError extends Error {
  constructor() {
    super("introuvable");
    this.name = "NotFoundError";
  }
}

export class BadPasswordError extends Error {
  constructor(readonly attemptsLeft: number) {
    super("mauvais_mot_de_passe");
    this.name = "BadPasswordError";
  }
}

/** Trop de requêtes (429) : réessayer dans retryAfterS secondes. */
export class LimitError extends Error {
  constructor(readonly retryAfterS: number) {
    super("limite");
    this.name = "LimitError";
  }
}

const isNetwork = (e: unknown) => e instanceof Error && e.message === "reseau";

// Erreurs côté destinataire et gestion (openShare, destroyShare, shareStatus, fetchMeta) :
// coupure persistante → Error("reseau") ; 429 → LimitError ; mauvais mot de passe →
// BadPasswordError ; tout le reste (404, paquet corrompu, paramètres KDF refusés, réponse
// invalide, autre code) → NotFoundError : rien d'exploitable n'est montré, et un serveur
// malveillant ne peut pas faire afficher un message choisi par lui.
function readerError(e: unknown): Error {
  if (e instanceof BadPasswordError || e instanceof LimitError || e instanceof NotFoundError) return e;
  if (isNetwork(e)) return e as Error;
  if (e instanceof api.HttpError) {
    if (e.status === 429) return new LimitError(e.retryAfterS ?? 60);
    if (e.status === 403 && e.code === "bad_password" && e.attemptsLeft !== undefined) return new BadPasswordError(e.attemptsLeft);
  }
  return new NotFoundError();
}

// Erreurs côté expéditeur (createShare, prepareCaptcha) : 404 → NotFoundError (envoi échu),
// 429 → LimitError, autre code HTTP → Error(code du serveur) ; le reste tel quel
// (Error("reseau"), AbortError, erreurs locales).
export function senderError(e: unknown): unknown {
  if (e instanceof api.HttpError) {
    if (e.status === 404) return new NotFoundError();
    if (e.status === 429) return new LimitError(e.retryAfterS ?? 60);
    return new Error(e.code);
  }
  return e;
}

async function guarded<T>(f: () => Promise<T>, map: (e: unknown) => unknown): Promise<T> {
  try {
    return await f();
  } catch (e) {
    throw map(e);
  }
}

/**
 * Analyse un lien et vérifie qu'il vise l'origine attendue (celle du site, en pratique
 * location.origin) : un lien vers une autre origine, ou avec identifiants, enverrait
 * K_accès, K_preuve ou S_gestion à un autre serveur (audit F1) → Error("lien_invalide").
 * Une origine attendue mal formée → Error("origine_invalide").
 */
function parseFor(link: string, expectedOrigin: string): ParsedLink {
  const origin = checkOrigin(expectedOrigin);
  const p = parseLink(link);
  if (p.origin !== origin) throw new Error("lien_invalide");
  return p;
}

function parseShare(link: string, expectedOrigin: string): Extract<ParsedLink, { kind: "s" }> {
  const p = parseFor(link, expectedOrigin);
  if (p.kind !== "s") throw new Error("lien_invalide");
  return p;
}

/** Preuve anti-robot : preuve de travail ALTCHA (charge utile base64) ou jeton du repli reCAPTCHA. */
export type CaptchaProof = { kind: "pow"; payload: string } | { kind: "recaptcha"; token: string };
/**
 * Contexte de solveCaptcha. createShare passe toujours mode "pow" ; l'écran d'envoi impose
 * "fallback" au dernier essai (UI §9.4.6). fallbackOrigin : null si le repli est désactivé.
 */
export type CaptchaCtx = { fallbackOrigin: string | null; mode: "pow" | "fallback" };

export type CreateOpts = api.Net & {
  ttlHours: 1 | 6 | 12 | 24;
  maxOpens: number;
  password: string;
  /**
   * Résout le défi (objet renvoyé par GET /api/captcha, sans shown_at ni fallback). Doit
   * s'arrêter lui-même sur `signal` (Worker) ; createShare n'attend plus sa réponse après
   * une annulation.
   */
  solveCaptcha: (challenge: unknown, ctx: CaptchaCtx) => Promise<CaptchaProof>;
  /**
   * Défi récupéré à l'avance (prepareCaptcha) et sa preuve en cours de calcul : utilisés
   * s'il reste plus de 15 s de validité (et une seule fois), sinon nouveau défi et solveCaptcha.
   */
  prepared?: { cap: PreparedCaptcha; proof: Promise<CaptchaProof> };
  /** Segments acquittés (done, total). */
  onProgress?: (done: number, total: number) => void;
  /** Octets chiffrés envoyés : maximum atteint (monotone), jusqu'au total exact du palier. */
  onBytes?: (sent: number, total: number) => void;
  /** Un PUT de segment ou finalize a échoué : nouvel essai dans inMs (ou dès l'événement `online`). */
  onRetry?: (r: { attempt: number; inMs: number; offline: boolean }) => void;
  /** Attendue avant chaque segment (pause). L'échéance SERVER_STALL_MS continue de courir. */
  pause?: () => Promise<void> | void;
  /** Annulation à tout moment → DOMException("AbortError") ; un partage déjà créé est détruit (keepalive). */
  signal?: AbortSignal;
};

/** Validité minimale d'un défi préparé pour être utilisé. */
const PREPARED_MIN_LEFT_MS = 15_000;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** Attend `p`, mais rejette en AbortError dès l'annulation (p continue, son échec est absorbé). */
function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return p;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/** Attente interruptible : AbortError sur `signal` ; fin anticipée sur l'événement `online` si `wakeOnline`. */
function sleep(ms: number, signal?: AbortSignal, wakeOnline = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const g = globalThis as { addEventListener?: typeof addEventListener; removeEventListener?: typeof removeEventListener };
    const done = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
      if (wakeOnline) g.removeEventListener?.("online", onOnline);
    };
    const onOnline = () => {
      done();
      resolve();
    };
    const onAbort = () => {
      done();
      reject(abortError());
    };
    const t = setTimeout(onOnline, ms);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (wakeOnline) g.addEventListener?.("online", onOnline);
  });
}

const retryable = (e: unknown) =>
  e instanceof TypeError || isNetwork(e) || (e instanceof api.HttpError && (e.status >= 500 || e.status === 429));

/**
 * Budget de coupure d'une étape de l'envoi (PUT de segment, finalize) : chaque essai est un
 * seul appel ; coupure, 5xx ou 429 → nouvel essai après 1, 2, 4, 8, 16 puis 30 s
 * (retry_after_s d'une 429 respecté ; essai immédiat sur `online`), tant que l'essai suivant
 * part avant l'échéance `deadline` (dernier segment acquitté + SERVER_STALL_MS). Un essai en
 * cours à l'échéance est interrompu. Au-delà : Error("reseau"). Les autres erreurs passent.
 */
async function withBudget<T>(deadline: number, o: CreateOpts, step: (signal: AbortSignal, attempt: number) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    throwIfAborted(o.signal);
    const ac = new AbortController();
    const stop = () => ac.abort();
    const timer = setTimeout(stop, Math.max(0, deadline - Date.now()));
    o.signal?.addEventListener("abort", stop, { once: true });
    try {
      return await step(ac.signal, attempt);
    } catch (e) {
      throwIfAborted(o.signal);
      if (ac.signal.aborted) throw new Error("reseau"); // échéance atteinte pendant l'essai
      if (!retryable(e)) throw e;
      let inMs = Math.min(30_000, 1000 * 2 ** (attempt - 1));
      if (e instanceof api.HttpError && e.status === 429 && e.retryAfterS !== undefined) inMs = Math.max(inMs, e.retryAfterS * 1000);
      if (Date.now() + inMs >= deadline) throw new Error("reseau");
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      o.onRetry?.({ attempt, inMs, offline });
      await sleep(inMs, o.signal, true);
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", stop);
    }
  }
}

function proofFields(p: CaptchaProof, cap: api.Captcha): { altcha: string } | { recaptcha: string; captcha_salt: string } {
  if (p.kind === "pow" && typeof p.payload === "string") return { altcha: p.payload };
  if (p.kind === "recaptcha" && typeof p.token === "string") {
    if (cap.salt === null) throw new api.BadResponse();
    return { recaptcha: p.token, captcha_salt: cap.salt };
  }
  throw new Error("preuve_invalide");
}

/**
 * Crée un partage. Clés neuves à chaque appel (K_lien, sel, S_gestion). Le paquet est
 * chiffré en flux : chaque segment est produit juste avant son envoi, puis abandonné
 * (un seul segment chiffré en mémoire) ; en cas de nouvel essai, le même segment est renvoyé.
 * Ordre : préparation (manifeste, palier), puis défi anti-robot (valable 2 min ; défi
 * préparé s'il reste plus de 15 s), puis création, au plus tôt CAPTCHA_MIN_MS après la
 * réception du défi — createShare attend lui-même le temps restant. Envoi : `pause` attendue
 * avant chaque segment ; coupures réessayées jusqu'à l'échéance SERVER_STALL_MS (voir
 * withBudget). La requête de création n'est jamais interrompue (sinon un partage créé
 * resterait inconnu) : l'annulation est constatée juste après. En cas d'échec ou
 * d'annulation après la création, l'envoi est détruit (au mieux, en keepalive) pour
 * libérer la place réservée.
 */
export async function createShare(
  origin: string,
  items: Item[],
  o: CreateOpts,
): Promise<{ link: string; manage: string; expiresInS: number }> {
  checkOrigin(origin);
  if (![1, 6, 12, 24].includes(o.ttlHours)) throw new Error("duree_invalide");
  if (!Number.isInteger(o.maxOpens) || o.maxOpens < 1 || o.maxOpens > 10) throw new Error("ouvertures_invalides");
  // Une preuve préparée qui n'est pas utilisée peut échouer plus tard : jamais de rejet non géré.
  o.prepared?.proof.catch(() => undefined);
  throwIfAborted(o.signal);
  const c = api.ctx(origin, o);
  const signal = o.signal;

  const kLien = newKLien();
  const salt = randomBytes(16);
  const sGestion = newSGestion();
  const wipe: Uint8Array<ArrayBuffer>[] = [kLien, sGestion]; // mis à zéro quoi qu'il arrive
  try {
    return await guarded(async () => {
      const acc = await deriveAccess(kLien);
      wipe.push(acc.kAcces); // inutile à l'expéditeur
      // Refuse un mot de passe trop court ou trop courant (Error("mot_de_passe_…")).
      const keys = await deriveContentForCreate(kLien, o.password, salt);
      wipe.push(keys.kPreuve); // inutile à l'expéditeur
      const sealed = await sealStream(items, keys);
      throwIfAborted(signal);

      const pre = o.prepared;
      // Horloge monotone du client seulement (voir api.captcha).
      let cap = pre && pre.cap.expiresAt - performance.now() > PREPARED_MIN_LEFT_MS ? takeCaptcha(pre.cap, origin) : undefined;
      let proof: Promise<CaptchaProof>;
      if (cap !== undefined) {
        proof = pre!.proof;
      } else {
        const fresh = await abortable(readCaptcha(c), signal);
        throwIfAborted(signal);
        cap = takeCaptcha(fresh, origin)!;
        proof = o.solveCaptcha(fresh.challenge, { fallbackOrigin: fresh.fallbackOrigin, mode: "pow" });
      }
      const fields = proofFields(await abortable(proof, signal), cap);
      const wait = cap.receivedAt + CAPTCHA_MIN_MS - performance.now();
      if (wait > 0) await sleep(wait, signal);
      throwIfAborted(signal);

      const created = await api.create(c, {
        bucket: sealed.bucket,
        ttl_hours: o.ttlHours,
        max_opens: o.maxOpens,
        salt: b64u(salt),
        kdf: { ...KDF_CREATE },
        access_v: b64u(acc.vAcces),
        proof_v: b64u(keys.vPreuve),
        manage_v: b64u(await sha256(sGestion)),
        hp: "",
        shown_at: cap.shownAt,
        ...fields,
      });
      // Le serveur efface un envoi sans segment depuis 15 min, à compter de la création.
      let deadline = Date.now() + SERVER_STALL_MS;
      try {
        throwIfAborted(signal);
        const total = sealed.segmentCount;
        if (created.segments !== total) throw new api.BadResponse();
        let totalBytes = 0;
        for (let n = 0; n < total; n++) totalBytes += segmentSize(sealed.bucket, n);
        let acked = 0;
        let shown = 0;
        const bytes = (v: number) => {
          if (v <= shown) return; // maximum atteint : un nouvel essai ne fait pas reculer
          shown = v;
          o.onBytes?.(v, totalBytes);
        };
        o.onProgress?.(0, total);
        o.onBytes?.(0, totalBytes);
        for (let n = 0; n < total; n++) {
          await abortable(Promise.resolve().then(() => o.pause?.()), signal);
          throwIfAborted(signal);
          const data = await sealed.segment(n);
          await withBudget(deadline, o, (s) =>
            api.putSegment(c, created.id, created.uploadToken, n, data, (b) => bytes(acked + Math.min(b, data.length)), s),
          );
          acked += data.length;
          bytes(acked);
          deadline = Date.now() + SERVER_STALL_MS;
          o.onProgress?.(n + 1, total);
        }
        const expiresInS = await withBudget(deadline, o, async (s, attempt) => {
          try {
            return await api.finalize(c, created.id, created.uploadToken, s);
          } catch (e) {
            // Un essai précédent a pu aboutir sur le serveur sans que la réponse arrive
            // (finalize n'y est pas rejouable : 404 ensuite). status avec S_gestion tranche :
            // « ready » → envoi terminé ; sinon (404, autre état, échec) → erreur et destruction.
            if (attempt > 1 && e instanceof api.HttpError && e.status === 404) {
              const st = await api.status(c, created.id, sGestion).catch(() => undefined);
              if (st?.state === "ready") return st.expiresInS;
            }
            throw e;
          }
        });
        return { link: shareLink(origin, created.id, kLien), manage: manageLink(origin, created.id, sGestion), expiresInS };
      } catch (e) {
        await api.destroy(c, created.id, { sGestion }, undefined, true).catch(() => undefined);
        throw e;
      }
    }, senderError);
  } finally {
    for (const b of wipe) b.fill(0);
  }
}

export async function fetchMeta(link: string, expectedOrigin: string, net?: api.Net): Promise<{ expiresInS: number }> {
  const p = parseShare(link, expectedOrigin);
  return guarded(async () => {
    const { kAcces } = await deriveAccess(p.kLien);
    try {
      const m = await api.meta(api.ctx(p.origin, net), p.id, kAcces);
      return { expiresInS: m.expiresInS };
    } finally {
      kAcces.fill(0);
    }
  }, readerError);
}

// Dérive les clés de contenu à partir de meta, en refusant tout paramètre douteux du serveur.
async function contentKeys(kLien: KLien, m: api.Meta, password: string) {
  if (!(BUCKETS as readonly number[]).includes(m.bucket) || m.segments !== segmentCount(m.bucket)) {
    throw new api.BadResponse();
  }
  checkKdfParams(m.kdf); // le minimum est imposé par le navigateur, pas par le serveur
  let salt: Uint8Array<ArrayBuffer>;
  try {
    salt = unb64u(m.salt);
  } catch {
    throw new api.BadResponse();
  }
  if (salt.length !== 16) throw new api.BadResponse();
  return deriveContent(kLien, password, salt, m.kdf);
}

export type Opened = {
  /**
   * Manifeste tel que l'expéditeur l'a écrit : name et mime sont BRUTS et hostiles ; ne
   * jamais les afficher ni s'en servir pour un Blob. Utiliser safeName, previewKind,
   * isRiskyFile (audit M4).
   */
  manifest: Manifest;
  /** Nom nettoyé de l'élément i (voir safety.safeName) ; Error("element_inexistant") si i est invalide. */
  safeName(i: number): string;
  /** Aperçu permis pour l'élément i (liste blanche de types MIME, 200 Mio au plus). */
  previewKind(i: number): PreviewKind;
  /** Extension exécutable ou interprétée (nom nettoyé) : avertir avant d'enregistrer. */
  isRiskyFile(i: number): boolean;
  /** Élément entier en mémoire, pour l'aperçu (200 Mio au plus, sinon Error("trop_gros_pour_apercu")). */
  item(i: number): Promise<Uint8Array<ArrayBuffer>>;
  /**
   * Déchiffre l'élément i en flux vers `sink` (écrivain de showSaveFilePicker, ou
   * collectToBlob). Si saveItem échoue, le fichier partiel doit être supprimé.
   */
  saveItem(i: number, sink: (chunk: Uint8Array<ArrayBuffer>) => Promise<void> | void): Promise<void>;
  done(): Promise<void>;
  /**
   * Détruit le partage (« report » : signalement, motif non conservé par le serveur) avec
   * K_accès et K_preuve gardés depuis l'ouverture, sans repasser par meta : marche aussi
   * après la dernière ouverture (état « draining »). Erreurs : voir readerError ;
   * Error("cles_effacees") après wipe().
   */
  destroy(reason?: "report"): Promise<void>;
  /**
   * Met à zéro K_accès, K_preuve et le segment en cache (le manifeste reste en mémoire :
   * voir ContainerReader.wipe). destroy() n'est plus possible ensuite.
   */
  wipe(): void;
};

// Erreurs d'item / saveItem : paquet corrompu et erreurs du serveur → readerError ;
// le reste (erreur du sink, element_inexistant, trop_gros_pour_apercu) tel quel.
function itemError(e: unknown): unknown {
  const fromServer = e instanceof api.HttpError || e instanceof api.BadResponse || isNetwork(e);
  return fromServer || (e instanceof Error && e.message === "paquet_corrompu") ? readerError(e) : e;
}

/**
 * Ouvre un partage : meta → clés → unlock (consomme une ouverture) → segment 0 (en-tête,
 * manifeste). Les autres segments sont téléchargés à la demande par item / saveItem
 * (onProgress(n + 1, total) à chaque segment n lu, un même segment pouvant être relu).
 * Erreurs : voir readerError (BadPasswordError, LimitError, Error("reseau"), sinon
 * NotFoundError). Après lecture, appeler done() (fin du téléchargement, qui permet
 * l'effacement ; le jeton ne lit plus rien ensuite). En cas d'échec avant de rendre
 * la main, done() est appelé d'office.
 */
export async function openShare(
  link: string,
  password: string,
  expectedOrigin: string,
  onProgress?: (d: number, t: number) => void,
  net?: api.Net,
): Promise<Opened> {
  const p = parseShare(link, expectedOrigin);
  // Avant toute requête et toute dérivation (coûteuse) : un champ vide n'est pas un mot de passe.
  if (password === "") throw new Error("mot_de_passe_requis");
  const c = api.ctx(p.origin, net);
  return guarded(async () => {
    const { kAcces } = await deriveAccess(p.kLien);
    let u: { downloadToken: string; segments: number };
    let m: api.Meta;
    let keys: Awaited<ReturnType<typeof contentKeys>> | undefined;
    // K_accès et K_preuve sont gardés dans l'objet rendu (Opened.destroy, S1) jusqu'à
    // wipe() ; mis à zéro tout de suite si l'ouverture échoue.
    const zero = () => {
      kAcces.fill(0);
      keys?.kPreuve.fill(0);
    };
    try {
      m = await api.meta(c, p.id, kAcces);
      keys = await contentKeys(p.kLien, m, password);
      u = await api.unlock(c, p.id, kAcces, keys.kPreuve);
    } catch (e) {
      zero();
      throw e;
    }
    const kPreuve = keys.kPreuve;
    let wiped = false;

    let finished = false;
    const done = async () => {
      if (finished) return;
      finished = true;
      try {
        await api.done(c, p.id, u.downloadToken);
      } catch (e) {
        // 404 : partage déjà effacé (expiré ou détruit) ; le contenu est déjà lu.
        if (!(e instanceof api.HttpError && e.status === 404)) throw readerError(e);
      }
    };
    try {
      if (u.segments !== m.segments) throw new api.BadResponse();
      const fetchSegment = async (n: number) => {
        const s = await api.getSegment(c, p.id, u.downloadToken, n, segmentSize(m.bucket, n));
        onProgress?.(n + 1, m.segments);
        return s;
      };
      const r = await openStream(fetchSegment, m.bucket, keys);
      const wrap = async <T>(f: () => Promise<T>): Promise<T> => {
        try {
          return await f();
        } catch (e) {
          throw itemError(e);
        }
      };
      const entry = (i: number) => {
        const e = r.manifest.items[i];
        if (!Number.isInteger(i) || e === undefined) throw new Error("element_inexistant");
        return e;
      };
      return {
        manifest: r.manifest,
        safeName: (i) => safeName(entry(i).name),
        previewKind: (i) => previewKindOf(entry(i)),
        isRiskyFile: (i) => isRiskyName(safeName(entry(i).name)),
        item: (i) => wrap(() => r.item(i)),
        saveItem: (i, sink) => wrap(() => r.streamItem(i, sink)),
        done,
        destroy: (reason) =>
          guarded(async () => {
            if (wiped) throw new Error("cles_effacees");
            await api.destroy(c, p.id, { kAcces, kPreuve }, reason);
          }, (e) => (e instanceof Error && e.message === "cles_effacees" ? e : readerError(e))),
        wipe: () => {
          wiped = true;
          zero();
          r.wipe();
        },
      };
    } catch (e) {
      zero();
      await done().catch(() => undefined);
      throw e;
    }
  }, readerError);
}

/** Taille des tranches en mémoire avant repli dans le Blob (collectToBlob). */
export const FOLD_BYTES = 64 * 1048576;

/**
 * Assemble l'élément i dans un Blob, toujours de type application/octet-stream (jamais le
 * type du manifeste : un Blob text/html sur l'origine du site serait dangereux ; audit M4),
 * quand showSaveFilePicker n'existe pas. Tous les
 * `foldBytes` (64 Mio ; paramètre réglable pour les tests), les tranches déchiffrées sont
 * repliées dans le Blob puis mises à zéro : au plus ~64 Mio de tranches en mémoire JS.
 * Le navigateur garde le Blob en mémoire ou dans son stockage temporaire (spec §24, §18).
 */
export async function collectToBlob(open: Opened, i: number, foldBytes = FOLD_BYTES): Promise<Blob> {
  const mime = "application/octet-stream";
  let acc = new Blob([], { type: mime });
  let parts: Uint8Array<ArrayBuffer>[] = [];
  let pending = 0;
  const fold = () => {
    acc = new Blob([acc, ...parts], { type: mime });
    for (const p of parts) p.fill(0);
    parts = [];
    pending = 0;
  };
  try {
    await open.saveItem(i, (chunk) => {
      parts.push(chunk);
      pending += chunk.length;
      if (pending >= foldBytes) fold();
    });
    fold();
    return acc;
  } finally {
    for (const p of parts) p.fill(0);
  }
}

/**
 * Détruit un partage : avec le lien de partage et le mot de passe (K_accès + K_preuve ;
 * un mauvais mot de passe compte un essai et rend NotFoundError), ou avec le lien de
 * gestion (S_gestion seul). Erreurs : voir readerError.
 */
export async function destroyShare(link: string, expectedOrigin: string, opts: { password?: string } & api.Net = {}): Promise<void> {
  const p = parseFor(link, expectedOrigin);
  if (p.kind === "s" && (opts.password === undefined || opts.password === "")) throw new Error("mot_de_passe_requis");
  const c = api.ctx(p.origin, opts);
  await guarded(async () => {
    if (p.kind === "m") return api.destroy(c, p.id, { sGestion: p.sGestion });
    const { kAcces } = await deriveAccess(p.kLien);
    let keys: Awaited<ReturnType<typeof contentKeys>> | undefined;
    try {
      const m = await api.meta(c, p.id, kAcces);
      keys = await contentKeys(p.kLien, m, opts.password!);
      await api.destroy(c, p.id, { kAcces, kPreuve: keys.kPreuve });
    } finally {
      kAcces.fill(0);
      keys?.kPreuve.fill(0);
    }
  }, readerError);
}

export async function shareStatus(
  manage: string,
  expectedOrigin: string,
  net?: api.Net,
): Promise<{ opensUsed: number; maxOpens: number; expiresInS: number; state: string }> {
  const p = parseFor(manage, expectedOrigin);
  if (p.kind !== "m") throw new Error("lien_invalide");
  return guarded(() => api.status(api.ctx(p.origin, net), p.id, p.sGestion), readerError);
}
