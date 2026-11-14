// Couche HTTP du client (contrat : server/internal/api). Les secrets passent en en-tête
// (X-Shh-Access, X-Shh-Manage) ou dans le corps, en base64url sans bourrage, jamais dans
// l'URL. Aucun chemin ne porte d'identifiant (spec §29.8, §32) : le partage est désigné par
// un jeton signé du serveur, par K_accès ou par S_gestion ; l'id dérivé du lien ne sort pas. `fetch` est injectable (tests : capture des requêtes, coupures simulées).
// Les secrets ont des types marqués (engine/pure.ts) : K_lien ne peut pas être envoyé (audit M1).
// Module interne : l'interface publique est src/index.ts, sans ce module.
import { b64u, checkOrigin, unb64u, type KAcces, type KPreuve, type SGestion } from "../engine/pure";
import { fetchUploader, xhrUploader, type Uploader } from "./upload";
import { MAX_OPENS, TTL_MAX_HOURS } from "../limits";

export type Net = {
  fetch?: typeof fetch;
  /**
   * Première attente entre deux essais (doublée à chaque fois) des routes rejouables hors
   * envoi (défi, meta, segments lus, done, status). 500 ms par défaut ; réglable pour les
   * tests. Les PUT de segment et finalize suivent le budget de coupure de createShare.
   */
  retryDelayMs?: number;
  /**
   * Transport des PUT de segment (tests). Par défaut : XMLHttpRequest s'il existe et que
   * `fetch` n'est pas fourni (octets envoyés suivis), sinon `fetch`.
   */
  upload?: Uploader;
};

export type Ctx = { origin: string; fetch: typeof fetch; retryDelayMs: number; upload: Uploader };

/** Nombre de nouveaux essais après le premier : 0,5 s, 1 s, 2 s, 4 s, 8 s. */
export const RETRIES = 5;

export function ctx(origin: string, net: Net = {}): Ctx {
  const f = net.fetch ?? globalThis.fetch.bind(globalThis);
  const upload = net.upload ?? (net.fetch === undefined && typeof XMLHttpRequest === "function" ? xhrUploader : fetchUploader(f));
  return { origin, fetch: f, retryDelayMs: net.retryDelayMs ?? 500, upload };
}

/** Réponse d'erreur du serveur ({"error": …}). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly attemptsLeft?: number,
    readonly retryAfterS?: number,
  ) {
    super(code);
  }
}

/** Budget de lecture de l'ouverture épuisé (429 {"error":"budget"}) : définitif. */
export const isBudget = (e: unknown): e is HttpError => e instanceof HttpError && e.status === 429 && e.code === "budget";

/** Réponse 2xx inattendue (champ manquant, taille de segment fausse…) : ce n'est pas une coupure. */
export class BadResponse extends Error {
  constructor() {
    super("reponse_invalide");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Req = {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array<ArrayBuffer>;
  retry?: boolean;
  /** La requête survit à la fermeture de la page (fetch keepalive). */
  keepalive?: boolean;
  /** Annulation : l'AbortError est relancée telle quelle (jamais « reseau »). */
  signal?: AbortSignal;
};

function httpErrorOf(status: number, v: unknown): HttpError {
  const j = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const int = (x: unknown) => (Number.isSafeInteger(x) ? (x as number) : undefined);
  return new HttpError(status, typeof j.error === "string" ? j.error : `http_${status}`, int(j.attempts_left), int(j.retry_after_s));
}

/** En-tête Retry-After en secondes (forme « délai » seulement ; une date HTTP est ignorée). */
export function retryAfterHeader(h: Headers): number | undefined {
  const v = h.get("Retry-After")?.trim() ?? "";
  if (!/^\d{1,9}$/.test(v)) return undefined;
  return Number(v);
}

async function httpError(r: Response): Promise<HttpError> {
  let v: unknown;
  try {
    v = await r.json();
  } catch {
    // corps absent ou non JSON
  }
  const e = httpErrorOf(r.status, v);
  // 429 ou 503 sans retry_after_s dans le corps (mandataire devant le serveur) : l'en-tête.
  const h = e.retryAfterS === undefined ? retryAfterHeader(r.headers) : undefined;
  return h === undefined ? e : new HttpError(e.status, e.code, e.attemptsLeft, h);
}

/**
 * Envoie une requête et lit la réponse avec `read`. Si `retry` : coupure réseau, 5xx, 429
 * ou réponse invalide → jusqu'à RETRIES nouveaux essais, attente exponentielle
 * (retry_after_s respecté pour 429). À n'utiliser que pour les requêtes sans effet si elles
 * sont rejouées. Après le dernier essai, l'erreur réelle est relancée (HttpError,
 * BadResponse) ; seule une coupure réseau devient Error("reseau").
 */
async function send<T>(c: Ctx, q: Req, read: (r: Response) => Promise<T>): Promise<T> {
  const tries = q.retry ? 1 + RETRIES : 1;
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    if (i > 0) {
      let wait = c.retryDelayMs * 2 ** (i - 1);
      if (last instanceof HttpError && last.retryAfterS !== undefined) wait = Math.max(wait, last.retryAfterS * 1000);
      await sleep(wait);
    }
    let r: Response;
    try {
      r = await c.fetch(c.origin + q.path, {
        method: q.method,
        headers: q.headers,
        body: q.body,
        credentials: "omit",
        redirect: "error",
        keepalive: q.keepalive,
        signal: q.signal,
      });
    } catch (e) {
      if (q.signal?.aborted) throw e;
      last = e; // coupure réseau
      continue;
    }
    if (!r.ok) {
      last = await httpError(r);
      // 429 « budget » : l'ouverture a lu tout son budget d'octets ; il ne se recharge pas
      // (seul un nouveau déverrouillage rouvre la lecture) : jamais de nouvel essai.
      if (isBudget(last)) throw last;
      if (r.status >= 500 || r.status === 429) continue;
      throw last;
    }
    try {
      return await read(r);
    } catch (e) {
      if (q.signal?.aborted) throw e;
      // BadResponse : réponse invalide ; toute autre erreur de lecture : corps interrompu (réseau).
      last = e;
      if (!q.retry && e instanceof BadResponse) throw e;
    }
  }
  if (last instanceof HttpError || last instanceof BadResponse) throw last;
  throw new Error("reseau");
}

const json = (v: unknown): { headers: Record<string, string>; body: string } => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(v),
});

function obj(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null) throw new BadResponse();
  return v as Record<string, unknown>;
}
function num(o: Record<string, unknown>, k: string): number {
  const v = o[k];
  if (!Number.isSafeInteger(v)) throw new BadResponse();
  return v as number;
}
function str(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  if (typeof v !== "string") throw new BadResponse();
  return v;
}
// Corps illisible en JSON : coupure (TypeError d'undici / du navigateur) ou JSON invalide.
const readJSON = async (r: Response) => {
  const t = await r.text(); // une coupure lève ici
  try {
    return obj(JSON.parse(t));
  } catch {
    throw new BadResponse();
  }
};
const none = async (r: Response) => {
  await r.arrayBuffer();
};

export type Captcha = {
  /** Défi transmis à solveCaptcha (réponse du serveur sans shown_at ni fallback). */
  challenge: Record<string, unknown>;
  /** Jeton signé de l'heure d'émission, lié au sel du défi. */
  shownAt: string;
  /** Sel du défi (captcha_salt du repli) ; null s'il manque. */
  salt: string | null;
  /** Origine du cadre de vérification du repli ; null si le repli est désactivé ou si la valeur n'est pas une origine. */
  fallbackOrigin: string | null;
  /**
   * Fin de validité du défi sur l'horloge monotone du client (performance.now(), ms) :
   * réception + CAPTCHA_LIFETIME_MS, ou moins si le serveur l'indique (voir captcha()).
   */
  expiresAt: number;
  /** Instant de réception (performance.now()) : départ du délai CAPTCHA_MIN_MS. */
  receivedAt: number;
};

/** Durée de vie d'un défi émis par le serveur (spec D4 : 2 min). */
export const CAPTCHA_LIFETIME_MS = 120_000;

function originOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    return checkOrigin(v);
  } catch {
    return null;
  }
}

/**
 * L'horloge du serveur n'est jamais comparée à celle du client (décalage possible de
 * plusieurs minutes) : la validité se mesure sur l'horloge monotone du client à partir de la
 * réception, 2 min au plus. Si la réponse porte un en-tête Date, la durée restante selon le
 * serveur (« expires= » du sel − Date, deux heures du serveur) peut seulement la réduire.
 * L'en-tête Date est à la seconde : l'écart (< 1 s) est couvert par la marge de 15 s de createShare.
 */
export async function captcha(c: Ctx): Promise<Captcha> {
  const { o, date } = await send(c, { method: "GET", path: "/api/captcha", retry: true }, async (r) => ({
    o: await readJSON(r),
    date: r.headers.get("Date"),
  }));
  const receivedAt = performance.now();
  const { shown_at, fallback, ...challenge } = o;
  if (typeof shown_at !== "string") throw new BadResponse();
  const salt = typeof challenge.salt === "string" ? challenge.salt : null;
  let validMs = CAPTCHA_LIFETIME_MS;
  const exp = salt === null ? null : /[?&]expires=(\d{10})(?:&|$)/.exec(salt);
  const serverNow = date === null ? NaN : Date.parse(date);
  if (exp && Number.isFinite(serverNow)) validMs = Math.min(validMs, Number(exp[1]) * 1000 - serverNow);
  return { challenge, shownAt: shown_at, salt, fallbackOrigin: originOrNull(fallback), expiresAt: receivedAt + validMs, receivedAt };
}

/** Création (spec §29.8) : ni id, ni durée, ni ouvertures, ni sel, ni V_preuve à ce stade. */
export type CreateBody = {
  bucket: number;
  hp: string;
  shown_at: string;
} & ({ altcha: string } | { recaptcha: string; captcha_salt: string });

/**
 * Réponse 201 : jeton d'envoi et nombre de segments du palier. K_accès et S_gestion passent en
 * en-tête : le serveur en tire V_accès et V_gestion, clés de recherche du partage (index
 * uniques) ; 400 si l'un d'eux existe déjà (même lien deux fois).
 */
export async function create(
  c: Ctx,
  kAcces: KAcces,
  sGestion: SGestion,
  b: CreateBody,
): Promise<{ uploadToken: string; segments: number }> {
  const q: Req = { method: "POST", path: "/api/shares", ...json(b) };
  q.headers = { ...q.headers, "X-Shh-Access": b64u(kAcces), "X-Shh-Manage": b64u(sGestion) };
  const o = await send(c, q, readJSON);
  return { uploadToken: str(o, "upload_token"), segments: num(o, "segments") };
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

/**
 * Un seul essai (le budget de coupure de createShare réessaie ; renvoyer un segment le
 * remplace, spec §7.4). Erreur HTTP → HttpError ; coupure et annulation transmises telles quelles.
 */
export async function putSegment(
  c: Ctx,
  token: string,
  n: number,
  data: Uint8Array<ArrayBuffer>,
  onBytes: (sent: number) => void,
  signal?: AbortSignal,
  /** Plage de morceaux à partir du morceau `from` du segment (brouillon, audit H-2). */
  from?: number,
): Promise<void> {
  const headers = { ...bearer(token), "Content-Type": "application/octet-stream" };
  const q = from === undefined ? "" : `?from=${from}`;
  const r = await c.upload(`${c.origin}/api/shares/segments/${n}${q}`, headers, data, onBytes, signal);
  if (r.status < 200 || r.status > 299) throw httpErrorOf(r.status, r.json);
}

/** Finalisation (spec §29.8) : tout ce qui dépend du mot de passe, et le bourrage [fill_from, fill_to). */
export type FinalizeBody = {
  salt: string;
  kdf_ops: number;
  kdf_mem: number;
  proof_v: string;
  envelope: string;
  ttl_hours: number;
  max_opens: number;
  fill_from: number;
  fill_to: number;
};

/** Un seul essai (le budget de coupure de createShare réessaie). */
/**
 * Finalisation d'un brouillon (spec §41.14) : palier final, en-tête (48 octets) et morceau
 * chiffré du manifeste, en base64url ; jamais de fill_* (le serveur remplit tous les trous).
 */
export type DraftFinalizeBody = Omit<FinalizeBody, "fill_from" | "fill_to"> & {
  bucket: number;
  header: string;
  tail: string;
  /** Plages [début, fin) de morceaux de petits éléments retirés, remplies d'aléa (audit H-2). */
  void?: [number, number][];
};

/** Agrandit la réservation d'un brouillon au palier `bucket` (un essai). */
export async function grow(c: Ctx, token: string, bucket: number, signal?: AbortSignal): Promise<void> {
  const q: Req = { method: "POST", path: "/api/shares/grow", ...json({ bucket }), signal };
  q.headers = { ...q.headers, ...bearer(token) };
  await send(c, q, none);
}

/** Efface sur le serveur les segments [from, to) d'un élément retiré (un essai). */
export async function erase(c: Ctx, token: string, from: number, to: number, signal?: AbortSignal): Promise<void> {
  const q: Req = { method: "POST", path: "/api/shares/erase", ...json({ from, to }), signal };
  q.headers = { ...q.headers, ...bearer(token) };
  await send(c, q, none);
}

/** Signe de vie d'un brouillon (corps vide, un essai). */
export async function keep(c: Ctx, token: string): Promise<void> {
  await send(c, { method: "POST", path: "/api/shares/keep", headers: bearer(token) }, none);
}

export async function finalize(c: Ctx, token: string, b: FinalizeBody | DraftFinalizeBody, signal?: AbortSignal): Promise<number> {
  const q: Req = { method: "POST", path: "/api/shares/finalize", ...json(b), signal };
  q.headers = { ...q.headers, ...bearer(token) };
  const o = await send(c, q, readJSON);
  return num(o, "expires_in_s");
}

export type Meta = { expiresInS: number; salt: string; kdf: { ops: number; mem: number }; bucket: number; segments: number; opensLeft: number };

/** Octroi d'ouverture (spec §41.4) : 40 octets, soit 54 caractères base64url exactement. */
export const GRANT_CHARS = 54;
const GRANT_RE = /^[A-Za-z0-9_-]{54}$/;

const grantHeader = (grant?: string): Record<string, string> => (grant ? { "X-Shh-Grant": grant } : {});

/**
 * meta ; avec un octroi (rechargement), un partage dont toutes les ouvertures sont prises
 * (« draining ») reste lisible pour l'ouverture en cours : opens_left vaut alors 0.
 */
export async function meta(c: Ctx, kAcces: KAcces, grant?: string): Promise<Meta> {
  const o = await send(
    c,
    { method: "GET", path: "/api/shares/meta", headers: { "X-Shh-Access": b64u(kAcces), ...grantHeader(grant) }, retry: true },
    readJSON,
  );
  const k = obj(o.kdf);
  return {
    expiresInS: expiresOf(o),
    salt: str(o, "salt"),
    kdf: { ops: num(k, "ops"), mem: num(k, "mem") },
    bucket: num(o, "bucket"),
    segments: num(o, "segments"),
    opensLeft: opensLeft(num(o, "opens_left"), grant !== undefined && grant !== ""),
  };
}

/**
 * Audit web D4 : bornes des valeurs du serveur, aux maxima de l'offre actuelle (gratuite :
 * TTL_MAX_HOURS, MAX_OPENS) ; marge de 15 min pour l'arrondi de l'échéance côté serveur.
 * Au-delà, la réponse est refusée : un serveur ne fait pas afficher « 27 777 h » ni « 999 999
 * ouvertures ». À relever avec les formules payantes (limits.ts, PAID), le jour où elles existent.
 */
export const EXPIRES_MAX_S = TTL_MAX_HOURS * 3600 + 900;
function expiresOf(o: Record<string, unknown>): number {
  const v = num(o, "expires_in_s");
  if (v < 0 || v > EXPIRES_MAX_S) throw new BadResponse();
  return v;
}

/** Un partage lisible a au moins une ouverture restante (ruling 5), sauf rouvert par octroi ; jamais plus que MAX_OPENS (D4). */
function opensLeft(n: number, reopen: boolean): number {
  if (n < (reopen ? 0 : 1) || n > MAX_OPENS) throw new BadResponse();
  return n;
}

/**
 * last_open (revue D42-22) : entier 0 ou 1 exactement, tout le reste refusé (un booléen
 * aussi : true et false n'ont pas la même longueur, que verrait un observateur du trafic
 * chiffré ; audit D2 du 12 novembre, spec §29.8). 1 seulement à 0 ouverture restante.
 */
function lastOpenOf(o: Record<string, unknown>, left: number): boolean {
  const v = o["last_open"];
  if ((v !== 0 && v !== 1) || (v === 1 && left !== 0)) throw new BadResponse();
  return v === 1;
}

function grantOf(o: Record<string, unknown>): string {
  const g = str(o, "grant");
  if (!GRANT_RE.test(g)) throw new BadResponse();
  return g;
}

/** Enveloppe E rendue par unlock : 60 octets, soit 80 caractères base64url exactement. */
export const ENVELOPE_CHARS = 80;

function envelopeOf(o: Record<string, unknown>): Uint8Array<ArrayBuffer> {
  const s = str(o, "envelope");
  if (s.length !== ENVELOPE_CHARS) throw new BadResponse();
  try {
    return unb64u(s);
  } catch {
    throw new BadResponse();
  }
}

// Jamais rejoué : un déverrouillage réussi consomme une ouverture (sauf avec un octroi
// valable : même ouverture, spec §41.4), un échec compte un essai.
export async function unlock(
  c: Ctx,
  kAcces: KAcces,
  kPreuve: KPreuve,
  grant?: string,
): Promise<{ downloadToken: string; segments: number; envelope: Uint8Array<ArrayBuffer>; grant: string; opensLeft: number; lastOpen: boolean }> {
  const o = await send(
    c,
    {
      method: "POST",
      path: "/api/shares/unlock",
      ...json({ proof: b64u(kPreuve) }),
      headers: { "Content-Type": "application/json", "X-Shh-Access": b64u(kAcces), ...grantHeader(grant) },
    },
    readJSON,
  );
  // opens_left : ouvertures encore possibles après celle-ci (0 : c'était la dernière).
  const left = opensLeft(num(o, "opens_left"), true);
  return { downloadToken: str(o, "download_token"), segments: num(o, "segments"), envelope: envelopeOf(o), grant: grantOf(o), opensLeft: left, lastOpen: lastOpenOf(o, left) };
}

export async function getSegment(c: Ctx, token: string, n: number, size: number): Promise<Uint8Array<ArrayBuffer>> {
  return send(c, { method: "GET", path: `/api/shares/segments/${n}`, headers: bearer(token), retry: true }, async (r) => {
    const b = new Uint8Array(await r.arrayBuffer());
    if (b.length !== size) throw new BadResponse(); // rejoué
    return b;
  });
}

export async function done(c: Ctx, token: string): Promise<void> {
  // Rejouable : done_mask |= bit de l'ouverture. keepalive : envoyé même si la page se ferme.
  await send(c, { method: "POST", path: "/api/shares/done", headers: bearer(token), retry: true, keepalive: true }, none);
}

/**
 * GET /api/shares/watch (spec §41.8, route de la Task M2, étape 7b) : requête tenue 25 s au
 * plus par le serveur. 204 → "alive" ; 410 {"error":"gone"} → "gone" ; 404 (serveur sans la
 * route) → "stop" : la surveillance s'arrête pour de bon ; toute autre réponse ou erreur
 * (429, 5xx, réseau coupé) → "retry" : passagère, la boucle de surveillance réessaie
 * (audit adverse 3, F2 : une seule requête perdue désarmait la révocation jusqu'à la
 * fermeture de la page). Annulable (signal).
 */
export type WatchResult = "alive" | "gone" | "stop" | "retry";

export async function watch(c: Ctx, token: string, signal?: AbortSignal): Promise<WatchResult> {
  try {
    await send(c, { method: "GET", path: "/api/shares/watch", headers: bearer(token), signal }, none);
    return "alive";
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e instanceof HttpError && e.status === 410 && e.code === "gone") return "gone";
    return e instanceof HttpError && e.status === 404 ? "stop" : "retry";
  }
}

export type DestroyAuth = { kAcces: KAcces; kPreuve: KPreuve } | { sGestion: SGestion };

/**
 * Destinataire (K_accès + K_preuve) : POST /api/shares/destroy, reason "report" pour un
 * signalement (le serveur ne conserve pas le motif). Expéditeur (S_gestion) : POST
 * /api/manage/destroy, S_gestion en en-tête, corps vide (spec §32). keepalive : la requête
 * survit à la fermeture de la page (annulation d'un envoi, `pagehide`).
 */
export async function destroy(c: Ctx, a: DestroyAuth, reason?: "report", keepalive?: boolean): Promise<void> {
  const r = reason === undefined ? {} : { reason };
  const q: Req =
    "sGestion" in a
      ? { method: "POST", path: "/api/manage/destroy", headers: { "X-Shh-Manage": b64u(a.sGestion) }, keepalive }
      : {
          method: "POST",
          path: "/api/shares/destroy",
          body: JSON.stringify({ proof: b64u(a.kPreuve), ...r }),
          headers: { "Content-Type": "application/json", "X-Shh-Access": b64u(a.kAcces) },
        };
  await send(c, q, none);
}

export type Status = { opensUsed: number; maxOpens: number; expiresInS: number; state: string };

export async function status(c: Ctx, sGestion: SGestion): Promise<Status> {
  const o = await send(
    c,
    { method: "GET", path: "/api/manage/status", headers: { "X-Shh-Manage": b64u(sGestion) }, retry: true },
    readJSON,
  );
  return { opensUsed: num(o, "opens_used"), maxOpens: num(o, "max_opens"), expiresInS: num(o, "expires_in_s"), state: str(o, "state") };
}
