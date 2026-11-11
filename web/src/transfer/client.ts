// Client de transfert : création, ouverture, destruction et suivi d'un partage
// (spec §29, §7.6, §41.14 : la création passe par le brouillon de transfer/draft.ts). Tout
// le chiffrement a lieu dans le navigateur ; le serveur ne reçoit que des
// empreintes (V_accès, V_preuve, V_gestion), K_accès, K_preuve ou S_gestion, l'enveloppe E
// (R chiffrée sous K_env) et des segments chiffrés. K_lien, le mot de passe, K_mdp, R, les
// noms et le contenu ne sortent jamais.
import {
  BUCKETS,
  DATA_SEGMENTS,
  KDF_CREATE,
  accessKeys,
  b64u,
  checkKdfParams,
  checkOrigin,
  contentKeysChecked,
  deriveAccess,
  forget,
  open,
  openStream,
  parseLink,
  passwordKey,
  readHeader,
  segmentCount,
  segmentSize,
  segmentsNeeded,
  shareId,
  unb64u,
  type GeneratedPassword,
  type Item,
  type KeepTtl,
  type KLien,
  type Manifest,
  type ParsedLink,
  type Rights,
} from "../engine";
import { MAX_OPENS, TTL_HOURS, type TtlHours } from "../limits";
import * as api from "./api";
import { type PreparedCaptcha } from "./prepare";
import { isRiskyName, previewKindOf, safeName, type PreviewKind } from "./safety";
import { lowMemory } from "../app/env";
import { abortError } from "./upload";
import { createDraft } from "./draft";

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

/**
 * L'ouverture a lu tout son budget d'octets (429 « budget », spec §24 et audit M1) : il ne
 * se recharge pas. Seul un nouveau déverrouillage (qui consomme une ouverture) relit le contenu.
 */
export class ReadBudgetError extends Error {
  constructor() {
    super("budget_epuise");
    this.name = "ReadBudgetError";
  }
}

/**
 * Octroi d'ouverture refusé (409 grant_invalid : expiré, redémarrage du serveur, ouverture
 * terminée, spec §41.4) : ni ouverture ni essai consommé ; déverrouiller sans octroi en
 * consommera une nouvelle (à dire avant).
 */
export class GrantInvalidError extends Error {
  constructor() {
    super("octroi_invalide");
    this.name = "GrantInvalidError";
  }
}

/** Plus de 10 rechargements pour cette ouverture (429 reopen_limit) : une nouvelle sera comptée. */
export class ReopenLimitError extends Error {
  constructor() {
    super("trop_de_rechargements");
    this.name = "ReopenLimitError";
  }
}

/** Trop de requêtes (429) : réessayer dans retryAfterS secondes. */
export class LimitError extends Error {
  constructor(readonly retryAfterS: number) {
    super("limite");
    this.name = "LimitError";
  }
}

/**
 * Le serveur a répondu 5xx après tous les essais (tâche UP) : page « erreur du serveur », ou
 * « maintenance » pour 503 {"error":"frozen"} (drapeau d'exploitation, `shhdrop admin freeze`).
 * Texte fixe : un serveur ne peut pas faire afficher un message choisi par lui.
 */
export class ServerError extends Error {
  constructor(readonly maintenance: boolean) {
    super(maintenance ? "maintenance" : "serveur");
    this.name = "ServerError";
  }
}

const isNetwork = (e: unknown) => e instanceof Error && e.message === "reseau";

// Erreurs côté destinataire et gestion (openShare, destroyShare, shareStatus, fetchMeta) :
// coupure persistante → Error("reseau") ; 429 « budget » → ReadBudgetError (définitif,
// sans nouvel essai) ; autre 429 → LimitError ; mauvais mot de passe →
// BadPasswordError ; 5xx → ServerError (texte fixe) ; tout le reste (404, paquet corrompu,
// paramètres KDF refusés, réponse invalide, autre code) → NotFoundError : rien d'exploitable
// n'est montré, et un serveur malveillant ne peut pas faire afficher un message choisi par lui.
function readerError(e: unknown): Error {
  if (
    e instanceof BadPasswordError ||
    e instanceof LimitError ||
    e instanceof NotFoundError ||
    e instanceof ReadBudgetError ||
    e instanceof ServerError ||
    e instanceof GrantInvalidError ||
    e instanceof ReopenLimitError
  )
    return e;
  if (isNetwork(e)) return e as Error;
  if (api.isBudget(e)) return new ReadBudgetError();
  if (e instanceof api.HttpError) {
    if (e.status === 409 && e.code === "grant_invalid") return new GrantInvalidError();
    if (e.status === 429 && e.code === "reopen_limit") return new ReopenLimitError();
    if (e.status >= 500 && e.status <= 599) return new ServerError(e.status === 503 && e.code === "frozen");
    if (e.status === 429) return new LimitError(e.retryAfterS ?? 60);
    if (e.status === 403 && e.code === "bad_password" && e.attemptsLeft !== undefined) return new BadPasswordError(e.attemptsLeft);
  }
  return new NotFoundError();
}

// Destruction et état (destroyShare, shareStatus, Opened.destroy) : comme readerError, sauf
// qu'un refus HTTP autre que 404 ou 410 (403 d'un pare-feu, 400, 405, 413…) n'est pas
// « introuvable ». Sinon l'écran dirait « supprimé » alors que le partage existe encore
// (revue du 10 novembre). Texte fixe (ServerError) : l'écran propose de réessayer.
function destroyError(e: unknown): Error {
  const mapped = readerError(e);
  if (mapped instanceof NotFoundError && e instanceof api.HttpError && e.status !== 404 && e.status !== 410) return new ServerError(false);
  return mapped;
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

export async function guarded<T>(f: () => Promise<T>, map: (e: unknown) => unknown): Promise<T> {
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
async function parseFor(link: string, expectedOrigin: string): Promise<ParsedLink> {
  const origin = checkOrigin(expectedOrigin);
  const p = await parseAtBase(link);
  if (p.origin !== origin) throw new Error("lien_invalide");
  return p;
}

/**
 * Base de l'application (« / », « /shhdrop/ » en démo), lue à l'appel. createShare rend des
 * liens qui la portent (option `base`) : les fonctions de lecture les acceptent donc, en plus
 * de la racine (forme rendue par app/link.ts:readLink). Aucun autre chemin : l'ancien format
 * « /s/<id>#… » reste refusé (scan de sécurité du 7 novembre, F2).
 */
function appBase(): string {
  const b = import.meta.env?.BASE_URL;
  return typeof b === "string" && b !== "" ? b : "/";
}

async function parseAtBase(link: string): Promise<ParsedLink> {
  try {
    return await parseLink(link);
  } catch (e) {
    const base = appBase();
    if (base === "/") throw e;
    return parseLink(link, base);
  }
}

type ShareLink = Extract<ParsedLink, { kind: "s" }>;

async function parseShare(link: string, expectedOrigin: string): Promise<ShareLink> {
  const p = await parseFor(link, expectedOrigin);
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
  /**
   * Base de dépôt des liens rendus (« / » par défaut ; « /shhdrop/ » pour la démo, soit
   * import.meta.env.BASE_URL). Le lien vaut `${origin}${base}#<K_lien>` (spec §32).
   */
  base?: string;
  ttlHours: TtlHours;
  maxOpens: number;
  /** Mot de passe généré (generatePassword, 11 caractères) ou saisi (checkPassword : 10 au moins). */
  password: GeneratedPassword | string;
  /** Droits du destinataire (spec §34), dans le manifeste chiffré. Par défaut « enregistrer ». */
  rights?: Rights;
  /** Durée de garde dans le coffre, obligatoire avec rights « coffre » et seulement avec lui. */
  keepTtlH?: KeepTtl;
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
export const PREPARED_MIN_LEFT_MS = 15_000;

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** Attend `p`, mais rejette en AbortError dès l'annulation (p continue, son échec est absorbé). */
export function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
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
export function sleep(ms: number, signal?: AbortSignal, wakeOnline = false): Promise<void> {
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
export async function withBudget<T>(deadline: number, o: Pick<CreateOpts, "signal" | "onRetry">, step: (signal: AbortSignal, attempt: number) => Promise<T>): Promise<T> {
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

export function proofFields(p: CaptchaProof, cap: api.Captcha): { altcha: string } | { recaptcha: string; captcha_salt: string } {
  if (p.kind === "pow" && typeof p.payload === "string") return { altcha: p.payload };
  if (p.kind === "recaptcha" && typeof p.token === "string") {
    if (cap.salt === null) throw new api.BadResponse();
    return { recaptcha: p.token, captcha_salt: cap.salt };
  }
  throw new Error("preuve_invalide");
}

/**
 * Crée un partage en une fois (spec §41.14) : brouillon créé, fichiers chiffrés chacun sous sa
 * clé et envoyés, puis finalisation (R, sel, Argon2id, enveloppe, manifeste). Même contrat que
 * l'envoi dès l'ajout du composeur (transfer/draft.ts), sans création en arrière-plan. Un échec
 * ou une annulation détruit le brouillon (au mieux, en keepalive).
 */
export async function createShare(
  origin: string,
  items: Item[],
  o: CreateOpts,
): Promise<{ link: string; manage: string; expiresInS: number }> {
  checkOrigin(origin);
  if (!(TTL_HOURS as readonly number[]).includes(o.ttlHours)) throw new Error("duree_invalide");
  if (!Number.isInteger(o.maxOpens) || o.maxOpens < 1 || o.maxOpens > MAX_OPENS) throw new Error("ouvertures_invalides");
  o.prepared?.proof.catch(() => undefined);
  throwIfAborted(o.signal);
  if (items.length === 0) throw new Error("vide");
  // Refus locaux avant toute requête : place (spec §41.14, petits éléments empaquetés, H-2).
  const sizes = items.map((it) => (it.data instanceof Uint8Array ? it.data.byteLength : it.data.size));
  if (segmentsNeeded(sizes) > DATA_SEGMENTS) throw new Error("trop_gros");
  const list = items.map((item, i) => {
    // Copie d'un Uint8Array dans un Blob : l'appelant ne peut plus le modifier ensuite.
    const data = item.kind === "file" && item.data instanceof Uint8Array ? new Blob([item.data]) : item.data;
    return { id: String(i), item: { ...item, data } };
  });
  const d = createDraft(origin, { fetch: o.fetch, retryDelayMs: o.retryDelayMs, upload: o.upload });
  d.sync(list.filter((x) => x.item.kind === "file").map((x) => ({ id: x.id, data: x.item.data as Blob })));
  try {
    return await d.finalize(list, o);
  } catch (e) {
    await d.abandon();
    throw e;
  }
}

/**
 * Durée de vie restante et ouvertures restantes (ruling 5 : déjà connues de qui a K_accès,
 * pour annoncer « encore N fois » avant le geste irréversible).
 */
export async function fetchMeta(
  link: string,
  expectedOrigin: string,
  net?: api.Net,
  grant?: string,
): Promise<{ expiresInS: number; opensLeft: number }> {
  const p = await parseShare(link, expectedOrigin);
  return guarded(async () => {
    const { kAcces } = await deriveAccess(p.kLien);
    try {
      const m = await api.meta(api.ctx(p.origin, net), kAcces, grant);
      return { expiresInS: m.expiresInS, opensLeft: m.opensLeft };
    } finally {
      kAcces.fill(0);
    }
  }, readerError);
}

/**
 * Étiquette d'un partage entre onglets (spec §41.4) : SHA-256(K_accès) tronqué à 16 octets,
 * en base64url (22 caractères). Ne révèle ni K_lien ni K_accès ; sert seulement à demander à
 * un autre onglet s'il détient un octroi pour ce partage.
 */
export async function grantTag(link: string, expectedOrigin: string): Promise<string> {
  const p = await parseShare(link, expectedOrigin);
  const { kAcces } = await deriveAccess(p.kLien);
  p.kLien.fill(0);
  try {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", kAcces as Uint8Array<ArrayBuffer>));
    return b64u(h.subarray(0, 16));
  } finally {
    kAcces.fill(0);
  }
}

/**
 * K_env, K_preuve et V_preuve à partir de meta, en refusant tout paramètre douteux du
 * serveur (palier, nombre de segments, sel, Argon2id). K_mdp est mise à zéro ici.
 */
async function keysFromMeta(kLien: KLien, m: api.Meta, password: string) {
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
  const kMdp = await passwordKey(password, salt, m.kdf);
  try {
    return await accessKeys(kLien, kMdp);
  } finally {
    kMdp.fill(0);
  }
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
   * Octroi d'ouverture rendu par unlock (spec §41.4) : à garder (session/open-grant.ts) pour
   * qu'un rechargement rouvre la même ouverture. Ni clé ni mot de passe.
   */
  readonly grant: string;
  /**
   * Ouvertures encore possibles après celle-ci, rendues par unlock (0 : c'était la dernière
   * permise ; le lecteur n'offre « Détruire ce partage » qu'alors, retours UI4).
   */
  readonly opensLeft: number;
  /** Octroi renouvelé pour 30 min (POST /api/shares/regrant) ; erreurs : voir readerError. */
  regrant(): Promise<string>;
  /**
   * Sortie de page (pagehide) : à la dernière ouverture permise seulement (opensLeft = 0),
   * prévient le serveur (« je pars », D41-28), qui supprime le partage 3 min plus tard sauf
   * rechargement. Ailleurs : rien. Ne lève jamais, n'attend rien.
   */
  leave(): void;
  /**
   * Surveillance de la disparition (spec §41.8) : un appel = une requête tenue au plus 25 s.
   * "alive" (rien), "gone" (partage disparu : fermer l'interface), "stop" (ne plus surveiller).
   */
  watch(signal?: AbortSignal): Promise<"alive" | "gone" | "stop">;
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
 * Ouvre un partage : meta → K_mdp (Argon2id) → K_env, K_preuve → unlock (consomme une
 * ouverture, rend l'enveloppe E) → segment 0 (en-tête) → R → engagement → K_contenu →
 * dernier segment (manifeste). Les autres segments sont téléchargés à la demande par item / saveItem
 * (onProgress(n + 1, total) à chaque segment n lu, un même segment pouvant être relu).
 * Erreurs : voir readerError (BadPasswordError, LimitError, Error("reseau"), sinon
 * NotFoundError). Après lecture, appeler done() (fin du téléchargement, qui permet
 * l'effacement ; le jeton ne lit plus rien ensuite). En cas d'échec avant de rendre
 * la main, done() est appelé d'office.
 */
export type OpenOpts = {
  onProgress?: (d: number, t: number) => void;
  /** Octroi d'ouverture (rechargement, autre onglet) : rouvre la même ouverture sans en consommer. */
  grant?: string;
};

export async function openShare(
  link: string,
  password: string,
  expectedOrigin: string,
  progressOrOpts?: ((d: number, t: number) => void) | OpenOpts,
  net?: api.Net,
): Promise<Opened> {
  const o: OpenOpts = typeof progressOrOpts === "function" ? { onProgress: progressOrOpts } : (progressOrOpts ?? {});
  const onProgress = o.onProgress;
  const grant = o.grant;
  const p = await parseShare(link, expectedOrigin);
  // Avant toute requête et toute dérivation (coûteuse) : un champ vide n'est pas un mot de passe.
  if (password === "") throw new Error("mot_de_passe_requis");
  const idBytes = await shareId(p.kLien); // données authentifiées seulement, jamais envoyé
  const c = api.ctx(p.origin, net);
  return guarded(async () => {
    const { kAcces } = await deriveAccess(p.kLien);
    let u: Awaited<ReturnType<typeof api.unlock>>;
    let m: api.Meta;
    let keys: Awaited<ReturnType<typeof keysFromMeta>> | undefined;
    // K_accès et K_preuve sont gardés dans l'objet rendu (Opened.destroy, S1) jusqu'à
    // wipe() ; mis à zéro tout de suite si l'ouverture échoue.
    const zero = () => {
      kAcces.fill(0);
      keys?.kPreuve.fill(0);
    };
    try {
      m = await api.meta(c, kAcces, grant);
      keys = await keysFromMeta(p.kLien, m, password);
      u = await api.unlock(c, kAcces, keys.kPreuve, grant);
    } catch (e) {
      zero();
      forget(keys?.kEnv);
      throw e;
    } finally {
      p.kLien.fill(0); // plus utile : K_accès, K_env et K_preuve sont dérivées
    }
    const kPreuve = keys.kPreuve;
    const kEnv = keys.kEnv; // K_env : poignée du moteur, oubliée dès R déballée
    let wiped = false;
    let destroying = false; // destroy() en cours ou réussi ici

    let finished = false;
    const done = async () => {
      if (finished) return;
      finished = true;
      try {
        await api.done(c, u.downloadToken);
      } catch (e) {
        // 404 ou 410 « gone » (spec §41.8) : partage déjà effacé (expiré ou détruit) ; le
        // contenu est déjà lu.
        if (!(e instanceof api.HttpError && (e.status === 404 || e.status === 410))) throw readerError(e);
      }
    };
    try {
      if (u.segments !== m.segments) throw new api.BadResponse();
      const get = async (n: number) => {
        const s = await api.getSegment(c, u.downloadToken, n, segmentSize(m.bucket, n));
        onProgress?.(n + 1, m.segments);
        return s;
      };
      // En-tête en clair du segment 0 → R = open(K_env, E, id, en-tête) → engagement vérifié
      // contre R → K_contenu (spec §29.2). Le segment 0 lu ici sert ensuite au lecteur.
      let seg0: Uint8Array<ArrayBuffer> | null = await get(0);
      const { header, engagement } = await readHeader(seg0);
      let content: Awaited<ReturnType<typeof contentKeysChecked>>;
      try {
        const r = await open(kEnv, u.envelope, idBytes, header);
        try {
          content = await contentKeysChecked(r, engagement);
        } finally {
          forget(r);
        }
      } finally {
        forget(kEnv);
      }
      const fetchSegment = async (n: number) => {
        if (n === 0 && seg0 !== null) {
          const s = seg0;
          seg0 = null;
          return s;
        }
        return get(n);
      };
      const rd = await openStream(fetchSegment, m.bucket, content);
      seg0?.fill(0);
      seg0 = null;
      const wrap = async <T>(f: () => Promise<T>): Promise<T> => {
        try {
          return await f();
        } catch (e) {
          throw itemError(e);
        }
      };
      const entry = (i: number) => {
        const e = rd.manifest.items[i];
        if (!Number.isInteger(i) || e === undefined) throw new Error("element_inexistant");
        return e;
      };
      return {
        manifest: rd.manifest,
        safeName: (i) => safeName(entry(i).name),
        // Petit appareil : aperçu limité (l'aperçu tient le fichier entier en mémoire).
        previewKind: (i) => previewKindOf(entry(i), typeof navigator !== "undefined" && lowMemory(navigator, Number.MAX_SAFE_INTEGER)),
        isRiskyFile: (i) => isRiskyName(safeName(entry(i).name)),
        item: (i) => wrap(() => rd.item(i)),
        saveItem: (i, sink) => wrap(() => rd.streamItem(i, sink)),
        done,
        grant: u.grant,
        opensLeft: u.opensLeft,
        regrant: () => guarded(() => api.regrant(c, u.downloadToken), readerError),
        leave: () => {
          if (u.opensLeft === 0 && !finished && !destroying) api.leave(c, u.downloadToken).catch(() => undefined);
        },
        // Une destruction ou une fin (done) faite ici prévient aussi la surveillance (410) :
        // ce « gone » est le nôtre, l'écran de fin vient de destroy() ou de done() ; la
        // surveillance s'arrête simplement.
        watch: async (signal) => {
          const r = await api.watch(c, u.downloadToken, signal);
          return r === "gone" && (destroying || finished) ? "stop" : r;
        },
        destroy: (reason) =>
          guarded(async () => {
            if (wiped) throw new Error("cles_effacees");
            destroying = true;
            try {
              await api.destroy(c, { kAcces, kPreuve }, reason);
            } catch (e) {
              destroying = false;
              throw e;
            }
          }, (e) => (e instanceof Error && e.message === "cles_effacees" ? e : destroyError(e))),
        wipe: () => {
          wiped = true;
          zero();
          rd.wipe();
        },
      };
    } catch (e) {
      zero();
      forget(kEnv);
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
  const p = await parseFor(link, expectedOrigin);
  if (p.kind === "s" && (opts.password === undefined || opts.password === "")) throw new Error("mot_de_passe_requis");
  const c = api.ctx(p.origin, opts);
  await guarded(async () => {
    if (p.kind === "m") return api.destroy(c, { sGestion: p.sGestion });
    const { kAcces } = await deriveAccess(p.kLien);
    let keys: Awaited<ReturnType<typeof keysFromMeta>> | undefined;
    try {
      const m = await api.meta(c, kAcces);
      keys = await keysFromMeta(p.kLien, m, opts.password!);
      await api.destroy(c, { kAcces, kPreuve: keys.kPreuve });
    } finally {
      kAcces.fill(0);
      keys?.kPreuve.fill(0);
      forget(keys?.kEnv);
      p.kLien.fill(0);
    }
  }, destroyError);
}

export async function shareStatus(
  manage: string,
  expectedOrigin: string,
  net?: api.Net,
): Promise<{ opensUsed: number; maxOpens: number; expiresInS: number; state: string }> {
  const p = await parseFor(manage, expectedOrigin);
  if (p.kind !== "m") throw new Error("lien_invalide");
  return guarded(() => api.status(api.ctx(p.origin, net), p.sGestion), destroyError);
}
