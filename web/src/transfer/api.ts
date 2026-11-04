// Couche HTTP du client (contrat : server/internal/api). Les secrets passent en en-tête
// (X-Shh-Access, X-Shh-Manage) ou dans le corps, en base64url sans bourrage, jamais dans
// l'URL. `fetch` est injectable (tests : capture des requêtes, coupures simulées).
// Les secrets ont des types marqués (crypto/types) : K_lien ne peut pas être envoyé (audit M1).
// Module interne : l'interface publique est src/index.ts, sans ce module.
import { b64u } from "../crypto/encoding";
import type { KAcces, KPreuve, SGestion } from "../crypto/types";

export type Net = {
  fetch?: typeof fetch;
  /** Première attente entre deux essais (doublée à chaque fois). 500 ms par défaut ; réglable pour les tests. */
  retryDelayMs?: number;
};

export type Ctx = { origin: string; fetch: typeof fetch; retryDelayMs: number };

/** Nombre de nouveaux essais après le premier : 0,5 s, 1 s, 2 s, 4 s, 8 s. */
export const RETRIES = 5;

export function ctx(origin: string, net: Net = {}): Ctx {
  return { origin, fetch: net.fetch ?? globalThis.fetch.bind(globalThis), retryDelayMs: net.retryDelayMs ?? 500 };
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

type Req = { method: string; path: string; headers?: Record<string, string>; body?: string | Uint8Array<ArrayBuffer>; retry?: boolean };

async function httpError(r: Response): Promise<HttpError> {
  let j: Record<string, unknown> = {};
  try {
    const v: unknown = await r.json();
    if (typeof v === "object" && v !== null) j = v as Record<string, unknown>;
  } catch {
    // corps absent ou non JSON
  }
  const int = (x: unknown) => (Number.isSafeInteger(x) ? (x as number) : undefined);
  return new HttpError(r.status, typeof j.error === "string" ? j.error : `http_${r.status}`, int(j.attempts_left), int(j.retry_after_s));
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
      });
    } catch (e) {
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

export type Captcha = { challenge: Record<string, unknown>; shownAt: string };

export async function captcha(c: Ctx): Promise<Captcha> {
  const o = await send(c, { method: "GET", path: "/api/captcha", retry: true }, readJSON);
  const { shown_at, ...challenge } = o;
  if (typeof shown_at !== "string") throw new BadResponse();
  return { challenge, shownAt: shown_at };
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
  altcha: string;
  hp: string;
  shown_at: string;
};

export async function create(c: Ctx, b: CreateBody): Promise<{ id: string; uploadToken: string; segments: number }> {
  const o = await send(c, { method: "POST", path: "/api/shares", ...json(b) }, readJSON);
  return { id: str(o, "id"), uploadToken: str(o, "upload_token"), segments: num(o, "segments") };
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

export async function putSegment(c: Ctx, id: string, token: string, n: number, data: Uint8Array<ArrayBuffer>): Promise<void> {
  // Rejouable : renvoyer un segment le remplace (spec §7.4).
  await send(
    c,
    {
      method: "PUT",
      path: `/api/shares/${enc(id)}/segments/${n}`,
      headers: { ...bearer(token), "Content-Type": "application/octet-stream" },
      body: data,
      retry: true,
    },
    none,
  );
}

export async function finalize(c: Ctx, id: string, token: string): Promise<number> {
  const o = await send(c, { method: "POST", path: `/api/shares/${enc(id)}/finalize`, headers: bearer(token) }, readJSON);
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
  // Rejouable : done_mask |= bit de l'ouverture.
  await send(c, { method: "POST", path: `/api/shares/${enc(id)}/done`, headers: bearer(token), retry: true }, none);
}

export type DestroyAuth = { kAcces: KAcces; kPreuve: KPreuve } | { sGestion: SGestion };

export async function destroy(c: Ctx, id: string, a: DestroyAuth): Promise<void> {
  const q: Req =
    "sGestion" in a
      ? { method: "POST", path: `/api/shares/${enc(id)}/destroy`, ...json({ manage: b64u(a.sGestion) }) }
      : {
          method: "POST",
          path: `/api/shares/${enc(id)}/destroy`,
          body: JSON.stringify({ proof: b64u(a.kPreuve) }),
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
