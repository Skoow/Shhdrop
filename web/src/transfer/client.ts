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
import { isRiskyName, previewKindOf, safeName, type PreviewKind } from "./safety";

export type { Net } from "./api";
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

// Erreurs côté expéditeur (createShare) : 404 → NotFoundError (envoi échu), 429 → LimitError,
// autre code HTTP → Error(code du serveur) ; le reste tel quel.
function senderError(e: unknown): unknown {
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

export type CreateOpts = api.Net & {
  ttlHours: 1 | 6 | 12 | 24;
  maxOpens: number;
  password: string;
  /** Résout le défi ALTCHA (objet renvoyé par GET /api/captcha, sans shown_at) ; rend la charge utile base64. */
  solveCaptcha: (c: unknown) => Promise<string>;
  onProgress?: (done: number, total: number) => void;
};

/**
 * Crée un partage. Clés neuves à chaque appel (K_lien, sel, S_gestion). Le paquet est
 * chiffré en flux : chaque segment est produit juste avant son envoi, puis abandonné
 * (un seul segment chiffré en mémoire) ; en cas de nouvel essai, putSegment renvoie les
 * mêmes octets. Ordre : préparation (manifeste, palier), puis défi anti-robot (valable 2 min), puis création,
 * au plus tôt CAPTCHA_MIN_MS après la réception du défi — createShare attend lui-même
 * le temps restant (l'écran du Plan 2 peut s'y fier). En cas d'échec après la création,
 * l'envoi est détruit (au mieux) pour libérer la place réservée.
 */
export async function createShare(
  origin: string,
  items: Item[],
  o: CreateOpts,
): Promise<{ link: string; manage: string; expiresInS: number }> {
  checkOrigin(origin);
  if (![1, 6, 12, 24].includes(o.ttlHours)) throw new Error("duree_invalide");
  if (!Number.isInteger(o.maxOpens) || o.maxOpens < 1 || o.maxOpens > 10) throw new Error("ouvertures_invalides");
  const c = api.ctx(origin, o);

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

      const cap = await api.captcha(c);
      const shownAt = Date.now();
      const altcha = await o.solveCaptcha(cap.challenge);
      const wait = shownAt + CAPTCHA_MIN_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));

      const created = await api.create(c, {
        bucket: sealed.bucket,
        ttl_hours: o.ttlHours,
        max_opens: o.maxOpens,
        salt: b64u(salt),
        kdf: { ...KDF_CREATE },
        access_v: b64u(acc.vAcces),
        proof_v: b64u(keys.vPreuve),
        manage_v: b64u(await sha256(sGestion)),
        altcha,
        hp: "",
        shown_at: cap.shownAt,
      });
      try {
        const total = sealed.segmentCount;
        if (created.segments !== total) throw new api.BadResponse();
        o.onProgress?.(0, total);
        for (let n = 0; n < total; n++) {
          await api.putSegment(c, created.id, created.uploadToken, n, await sealed.segment(n));
          o.onProgress?.(n + 1, total);
        }
        const expiresInS = await api.finalize(c, created.id, created.uploadToken);
        return { link: shareLink(origin, created.id, kLien), manage: manageLink(origin, created.id, sGestion), expiresInS };
      } catch (e) {
        await api.destroy(c, created.id, { sGestion }).catch(() => undefined);
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
  if (p.kind === "s" && opts.password === undefined) throw new Error("mot_de_passe_requis");
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
