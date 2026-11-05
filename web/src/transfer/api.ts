// Couche HTTP du client (contrat : server/internal/api). Les secrets passent en en-tête
// (X-Shh-Access, X-Shh-Manage) ou dans le corps, en base64url sans bourrage, jamais dans
// l'URL. `fetch` est injectable (tests : capture des requêtes, coupures simulées).
// Les secrets ont des types marqués (crypto/types) : K_lien ne peut pas être envoyé (audit M1).
// Module interne : l'interface publique est src/index.ts, sans ce module.
import { b64u } from "../crypto/encoding";
import type { KAcces, KPreuve, SGestion } from "../crypto/types";
import { checkOrigin } from "./link";
import { fetchUploader, xhrUploader, type Uploader } from "./upload";

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

async function httpError(r: Response): Promise<HttpError> {
  let v: unknown;
  try {
    v = await r.json();
  } catch {
    // corps absent ou non JSON
  }
  return httpErrorOf(r.status, v);
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
const enc = encodeURIComponent;

export type Captcha = {
  /** Défi transmis à solveCaptcha (réponse du serveur sans shown_at ni fallback). */
  challenge: Record<string, unknown>;
  /** Jeton signé de l'heure d'émission, lié au sel du défi. */
  shownAt: string;
  /** Sel du défi (captcha_salt du repli) ; null s'il manque. */
  salt: string | null;
  /** Origine du cadre de vérification du repli ; null si le repli est désactivé ou si la valeur n'est pas une origine. */
  fallbackOrigin: string | null;
  /** Fin de validité du défi (ms), lue dans « expires= » du sel ; 0 (périmé) si illisible. */
  expiresAt: number;
  /** Instant de réception (Date.now()) : départ du délai CAPTCHA_MIN_MS. */
  receivedAt: number;
};

function originOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    return checkOrigin(v);
  } catch {
    return null;
  }
}

export async function captcha(c: Ctx): Promise<Captcha> {
  const o = await send(c, { method: "GET", path: "/api/captcha", retry: true }, readJSON);
  const receivedAt = Date.now();
  const { shown_at, fallback, ...challenge } = o;
  if (typeof shown_at !== "string") throw new BadResponse();
  const salt = typeof challenge.salt === "string" ? challenge.salt : null;
  const exp = salt === null ? null : /[?&]expires=(\d{10})(?:&|$)/.exec(salt);
  return { challenge, shownAt: shown_at, salt, fallbackOrigin: originOrNull(fallback), expiresAt: exp ? Number(exp[1]) * 1000 : 0, receivedAt };
}

export type CreateBody = {
  bucket: number;
  ttl_hours: number;
  max_opens: number;
  salt: string;
  kdf: { ops: number; mem: number };
  access_v: string;
  proof_v: string;
  manage_v: string;
  hp: string;
  shown_at: string;
} & ({ altcha: string } | { recaptcha: string; captcha_salt: string });

export async function create(c: Ctx, b: CreateBody): Promise<{ id: string; uploadToken: string; segments: number }> {
  const o = await send(c, { method: "POST", path: "/api/shares", ...json(b) }, readJSON);
  return { id: str(o, "id"), uploadToken: str(o, "upload_token"), segments: num(o, "segments") };
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

/**
 * Un seul essai (le budget de coupure de createShare réessaie ; renvoyer un segment le
 * remplace, spec §7.4). Erreur HTTP → HttpError ; coupure et annulation transmises telles quelles.
 */
export async function putSegment(
  c: Ctx,
  id: string,
  token: string,
  n: number,
  data: Uint8Array<ArrayBuffer>,
  onBytes: (sent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers = { ...bearer(token), "Content-Type": "application/octet-stream" };
  const r = await c.upload(`${c.origin}/api/shares/${enc(id)}/segments/${n}`, headers, data, onBytes, signal);
  if (r.status < 200 || r.status > 299) throw httpErrorOf(r.status, r.json);
}

/** Un seul essai (le budget de coupure de createShare réessaie). */
export async function finalize(c: Ctx, id: string, token: string, signal?: AbortSignal): Promise<number> {
  const o = await send(c, { method: "POST", path: `/api/shares/${enc(id)}/finalize`, headers: bearer(token), signal }, readJSON);
  return num(o, "expires_in_s");
}

export type Meta = { expiresInS: number; salt: string; kdf: { ops: number; mem: number }; bucket: number; segments: number };

export async function meta(c: Ctx, id: string, kAcces: KAcces): Promise<Meta> {
  const o = await send(
    c,
    { method: "GET", path: `/api/shares/${enc(id)}/meta`, headers: { "X-Shh-Access": b64u(kAcces) }, retry: true },
    readJSON,
  );
  const k = obj(o.kdf);
  return {
    expiresInS: num(o, "expires_in_s"),
    salt: str(o, "salt"),
    kdf: { ops: num(k, "ops"), mem: num(k, "mem") },
    bucket: num(o, "bucket"),
    segments: num(o, "segments"),
  };
}

// Jamais rejoué : un déverrouillage réussi consomme une ouverture, un échec compte un essai.
export async function unlock(c: Ctx, id: string, kAcces: KAcces, kPreuve: KPreuve): Promise<{ downloadToken: string; segments: number }> {
  const o = await send(
    c,
    {
      method: "POST",
      path: `/api/shares/${enc(id)}/unlock`,
      ...json({ proof: b64u(kPreuve) }),
      headers: { "Content-Type": "application/json", "X-Shh-Access": b64u(kAcces) },
    },
    readJSON,
  );
  return { downloadToken: str(o, "download_token"), segments: num(o, "segments") };
}

export async function getSegment(c: Ctx, id: string, token: string, n: number, size: number): Promise<Uint8Array<ArrayBuffer>> {
  return send(c, { method: "GET", path: `/api/shares/${enc(id)}/segments/${n}`, headers: bearer(token), retry: true }, async (r) => {
    const b = new Uint8Array(await r.arrayBuffer());
    if (b.length !== size) throw new BadResponse(); // rejoué
    return b;
  });
}

export async function done(c: Ctx, id: string, token: string): Promise<void> {
  // Rejouable : done_mask |= bit de l'ouverture. keepalive : envoyé même si la page se ferme.
  await send(c, { method: "POST", path: `/api/shares/${enc(id)}/done`, headers: bearer(token), retry: true, keepalive: true }, none);
}

export type DestroyAuth = { kAcces: KAcces; kPreuve: KPreuve } | { sGestion: SGestion };

/**
 * reason "report" : signalement (le serveur ne conserve pas le motif). keepalive : la
 * requête survit à la fermeture de la page (annulation d'un envoi, `pagehide`).
 */
export async function destroy(c: Ctx, id: string, a: DestroyAuth, reason?: "report", keepalive?: boolean): Promise<void> {
  const r = reason === undefined ? {} : { reason };
  const q: Req =
    "sGestion" in a
      ? { method: "POST", path: `/api/shares/${enc(id)}/destroy`, ...json({ manage: b64u(a.sGestion), ...r }), keepalive }
      : {
          method: "POST",
          path: `/api/shares/${enc(id)}/destroy`,
          body: JSON.stringify({ proof: b64u(a.kPreuve), ...r }),
          headers: { "Content-Type": "application/json", "X-Shh-Access": b64u(a.kAcces) },
        };
  await send(c, q, none);
}

export type Status = { opensUsed: number; maxOpens: number; expiresInS: number; state: string };

export async function status(c: Ctx, id: string, sGestion: SGestion): Promise<Status> {
  const o = await send(
    c,
    { method: "GET", path: `/api/shares/${enc(id)}/status`, headers: { "X-Shh-Manage": b64u(sGestion) }, retry: true },
    readJSON,
  );
  return { opensUsed: num(o, "opens_used"), maxOpens: num(o, "max_opens"), expiresInS: num(o, "expires_in_s"), state: str(o, "state") };
}
