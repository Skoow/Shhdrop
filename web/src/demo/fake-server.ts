// Faux serveur en mémoire de la démo GitHub Pages (UI §14.3). Mêmes routes, mêmes corps JSON
// et mêmes codes que server/internal/api (spec §8), mêmes règles visibles que
// server/internal/share : palier et taille exacte des segments, K_accès / K_preuve / S_gestion
// comparés par empreinte SHA-256, ouvertures, 5 essais puis destruction, « draining »,
// expiration, 404 uniformes ; v2 (spec §29.8) : id choisi par le client (400 s'il existe),
// sel, Argon2id, V_preuve et enveloppe à la finalisation, bourrage [fill_from, fill_to)
// rempli d'aléa, enveloppe rendue par unlock. Il ne reçoit et ne garde que ce que reçoit le
// vrai serveur (empreintes, sel, enveloppe, segments chiffrés), dans une Map de la page :
// rien n'est écrit ailleurs.
// Non simulés : limites par connexion, quotas, place disque, gel. Aucune preuve anti-robot
// n'est vérifiée (anti-robot désactivé en démo ; `fallback: null`).
import { BUCKETS, segmentCount, segmentSize } from "../crypto/container";

export const MARK = "__SHH_DEMO__";

const MAX_JSON = 4096;
const MAX_ATTEMPTS = 5;
const UPLOAD_WINDOW_S = 3 * 3600; // jeton d'envoi et échéance d'envoi (spec §24)
const PURGE_WINDOW_S = 3 * 3600; // jeton de téléchargement (spec §24)
const EMPTY_SWEEP_S = UPLOAD_WINDOW_S - 300; // envoi sans segment
const STALL_SWEEP_S = 900; // envoi sans nouveau segment depuis 15 min
const CAPTCHA_TTL_S = 120;
const MIN_FILL_S = 3; // création refusée moins de 3 s après l'émission du défi

type State = "uploading" | "ready" | "draining";

// Champs « null » jusqu'à la finalisation (spec §29.8).
type Share = {
  state: State;
  bucket: number;
  ttlHours: number | null;
  maxOpens: number | null;
  opensLeft: number;
  opensIssued: number;
  doneMask: number;
  failed: number;
  salt: Uint8Array | null;
  kdf: { ops: number; mem: number } | null;
  accessV: Uint8Array;
  proofV: Uint8Array | null;
  manageV: Uint8Array;
  envelope: Uint8Array | null;
  segments: (Uint8Array | undefined)[];
  uploadDeadline: number; // s ; 0 hors envoi
  progressAt: number | null; // s, à la minute ; null hors envoi
  expiresAt: number; // s ; 0 pendant l'envoi
  purgeAt: number; // s ; 0 hors « draining »
};

type Token = { kind: "upload" | "download"; id: string; openN: number; exp: number };

export type FakeServerOpts = {
  /** Horloge en millisecondes (tests). Par défaut Date.now. */
  now?: () => number;
  /** Débit simulé des segments (envoi et lecture), en octets par seconde. 20 Mo/s par défaut. */
  rateBytesPerS?: number;
  /** Coupure simulée : à `atFraction` des octets du premier envoi, tout /api échoue pendant `ms`. */
  outage?: { atFraction: number; ms: number };
};

export type FakeServer = {
  /** Requêtes /api/* seulement. Coupure simulée : rejet TypeError, comme un fetch sans réseau. */
  handle(req: Request): Promise<Response>;
  /** Nombre de partages en mémoire (tests). */
  shares(): number;
};

class HttpFail {
  constructor(
    readonly status: number,
    readonly error: string,
    readonly extra: Record<string, number> = {},
  ) {}
}
const notFound = () => new HttpFail(404, "not_found");
const badRequest = () => new HttpFail(400, "bad_request");

const json = (status: number, v: unknown) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json", "X-Shh-Demo": MARK } });
const empty = (status: number) => new Response(null, { status, headers: { "X-Shh-Demo": MARK } });

const B64 = /^[A-Za-z0-9_-]+$/;

/** base64url strict sans bourrage, exactement n octets (share.DecodeB64). */
function decodeB64(s: unknown, n: number): Uint8Array {
  if (typeof s !== "string" || s.length !== Math.ceil((n * 4) / 3) || !B64.test(s)) throw badRequest();
  const std = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std + "=".repeat((4 - (std.length % 4)) % 4));
  const b = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  // Forme canonique : les bits de bourrage doivent être nuls (réencodage identique).
  if (b.length !== n || b64(b) !== s) throw badRequest();
  return b;
}

function b64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomId(bytes: number): string {
  return b64(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>));
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

/** sha256(x) == vérificateur ; un secret fait toujours 32 octets (audit F4). */
async function matches(x: Uint8Array | undefined, stored: Uint8Array): Promise<boolean> {
  return x !== undefined && x.length === 32 && equal(await sha256(x), stored);
}

let emptyHash: Uint8Array | undefined;

/** Corps JSON : ≤ 4 Kio, un objet, aucune clé inconnue (readJSON du serveur). */
async function readJSON(req: Request, keys: readonly string[]): Promise<Record<string, unknown>> {
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.length > MAX_JSON) throw badRequest();
  let v: unknown;
  try {
    v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buf));
  } catch {
    throw badRequest();
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw badRequest();
  for (const k of Object.keys(v)) if (!keys.includes(k)) throw badRequest();
  return v as Record<string, unknown>;
}

const int = (v: unknown) => (v === undefined ? 0 : Number.isSafeInteger(v) ? (v as number) : NaN);
const str = (v: unknown) => (v === undefined ? "" : typeof v === "string" ? v : null);

/** En-tête secret présent exactement une fois (headerSecret). */
function headerSecret(req: Request, name: string): Uint8Array {
  const v = req.headers.get(name);
  if (v === null || v.includes(",")) throw badRequest();
  return decodeB64(v, 32);
}

function bearer(req: Request): string {
  const v = req.headers.get("Authorization");
  if (v === null || !v.startsWith("Bearer ") || v.length === 7 || v.includes(",")) throw badRequest();
  return v.slice(7);
}

/** Numéro de segment en chiffres décimaux canoniques (segNum). */
function segNum(s: string): number {
  if (!/^(0|[1-9][0-9]{0,3})$/.test(s)) throw badRequest();
  return Number(s);
}

const ceil15 = (t: number) => Math.ceil(t / 900) * 900;
const minute = (t: number) => t - (t % 60);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createFakeServer(opts: FakeServerOpts = {}): FakeServer {
  const nowMs = opts.now ?? Date.now;
  const now = () => Math.floor(nowMs() / 1000);
  const rate = opts.rateBytesPerS ?? 20_000_000;
  const shares = new Map<string, Share>();
  const tokens = new Map<string, Token>();
  const shownAt = new Map<string, number>(); // jeton → émission (s), usage unique

  // Coupure : déclenchée une seule fois, au premier envoi qui franchit la fraction.
  let outageUntil = 0;
  let outageDone = opts.outage === undefined;
  const offline = () => nowMs() < outageUntil;

  // sweepCond du serveur, appliquée paresseusement avant chaque requête.
  function sweep(): void {
    const t = now();
    for (const [id, s] of shares) {
      const gone =
        (s.state !== "uploading" && s.expiresAt <= t) ||
        (s.state === "uploading" && s.uploadDeadline <= t) ||
        (s.state === "uploading" && s.uploadDeadline - EMPTY_SWEEP_S <= t && s.segments.every((x) => x === undefined)) ||
        (s.state === "uploading" && s.progressAt !== null && s.progressAt + STALL_SWEEP_S <= t) ||
        (s.state === "draining" && s.purgeAt <= t) ||
        s.failed >= MAX_ATTEMPTS;
      if (gone) shares.delete(id);
    }
    for (const [k, tok] of tokens) if (tok.exp <= t || !shares.has(tok.id)) tokens.delete(k);
    for (const [k, at] of shownAt) if (at + CAPTCHA_TTL_S <= t) shownAt.delete(k);
  }

  function checkToken(req: Request, kind: Token["kind"], id: string): Token {
    const tok = tokens.get(bearer(req));
    if (tok === undefined || tok.kind !== kind || tok.id !== id || tok.exp <= now()) throw notFound();
    return tok;
  }

  function issue(kind: Token["kind"], id: string, openN: number, exp: number): string {
    const k = randomId(32);
    tokens.set(k, { kind, id, openN, exp });
    return k;
  }

  /** Délai du débit simulé ; coupure si cet envoi franchit la fraction du premier envoi. */
  async function transfer(bytes: number, upload?: { before: number; total: number }): Promise<void> {
    let ms = (bytes / rate) * 1000;
    if (!outageDone && upload !== undefined) {
      const cut = opts.outage!.atFraction * upload.total;
      if (upload.before <= cut && cut < upload.before + bytes) {
        outageDone = true;
        await sleep(((cut - upload.before) / rate) * 1000);
        outageUntil = nowMs() + opts.outage!.ms;
        throw new TypeError("Failed to fetch");
      }
    }
    if (ms > 0 && Number.isFinite(ms)) await sleep(ms);
  }

  function live(id: string): Share {
    const s = shares.get(id);
    if (s === undefined) throw notFound();
    return s;
  }

  async function countFailure(id: string, s: Share): Promise<number> {
    s.failed++;
    if (s.failed >= MAX_ATTEMPTS) shares.delete(id);
    return MAX_ATTEMPTS - s.failed;
  }

  // --- routes -------------------------------------------------------------------------

  function captcha(): Response {
    const tok = randomId(24);
    shownAt.set(tok, now());
    const exp = now() + CAPTCHA_TTL_S;
    // Même forme qu'un défi ALTCHA ; rien à résoudre (preuve factice « demo »).
    return json(200, {
      algorithm: "SHA-256",
      challenge: "demo",
      maxNumber: 0,
      salt: `demo?expires=${exp}`,
      signature: "demo",
      shown_at: tok,
      fallback: null,
    });
  }

  const CREATE_KEYS = ["id", "bucket", "access_v", "manage_v", "altcha", "hp", "shown_at"];

  async function create(req: Request): Promise<Response> {
    const b = await readJSON(req, CREATE_KEYS);
    const bucket = int(b.bucket);
    const altcha = str(b.altcha), hp = str(b.hp), shown = str(b.shown_at);
    if (altcha === null || hp === null || shown === null || typeof b.id !== "string") throw badRequest();
    decodeB64(b.id, 16);
    const id = b.id;
    const accessV = decodeB64(b.access_v, 32), manageV = decodeB64(b.manage_v, 32);
    emptyHash ??= await sha256(new Uint8Array(0));
    if (!(BUCKETS as readonly number[]).includes(bucket) || [accessV, manageV].some((v) => equal(v, emptyHash!))) throw badRequest();
    // Anti-robot : aucune preuve vérifiée ; seuls le jeton shown_at (émis ici, usage unique,
    // valable 2 min) et le délai de 3 s sont contrôlés, comme le fait le vrai serveur.
    const at = shownAt.get(shown);
    if (altcha === "" || hp !== "" || at === undefined || now() - at < MIN_FILL_S) throw badRequest();
    shownAt.delete(shown);
    // id existant : une sonde (id dérivé d'une K_lien de 256 bits) ; même réponse qu'une
    // création invalide (revue K1, I2).
    if (shares.has(id)) throw badRequest();
    const segs = segmentCount(bucket);
    shares.set(id, {
      state: "uploading",
      bucket,
      ttlHours: null,
      maxOpens: null,
      opensLeft: 0,
      opensIssued: 0,
      doneMask: 0,
      failed: 0,
      salt: null,
      kdf: null,
      accessV,
      proofV: null,
      manageV,
      envelope: null,
      segments: new Array(segs).fill(undefined),
      uploadDeadline: ceil15(now() + UPLOAD_WINDOW_S),
      progressAt: null,
      expiresAt: 0,
      purgeAt: 0,
    });
    return json(201, { upload_token: issue("upload", id, 0, now() + UPLOAD_WINDOW_S), segments: segs });
  }

  async function putSegment(req: Request, id: string, nStr: string): Promise<Response> {
    checkToken(req, "upload", id);
    const n = segNum(nStr);
    const body = new Uint8Array(await req.arrayBuffer());
    const s0 = shares.get(id);
    const total = s0 === undefined ? 0 : s0.segments.reduce((a, _, i) => a + segmentSize(s0.bucket, i), 0);
    const before = s0 === undefined ? 0 : s0.segments.reduce((a, x, i) => a + (x !== undefined && i !== n ? segmentSize(s0.bucket, i) : 0), 0);
    await transfer(body.length, s0 === undefined ? undefined : { before, total });
    if (req.signal.aborted) throw new DOMException("Aborted", "AbortError");
    const s = live(id); // revérifié après le transfert : détruit pendant l'envoi → 404
    if (s.state !== "uploading" || s.uploadDeadline <= now()) throw notFound();
    if (n >= s.segments.length || body.length !== segmentSize(s.bucket, n)) throw badRequest();
    s.segments[n] = body;
    s.progressAt = minute(now());
    return empty(204);
  }

  const FINALIZE_KEYS = ["salt", "kdf_ops", "kdf_mem", "proof_v", "envelope", "ttl_hours", "max_opens", "fill_from", "fill_to"];

  async function finalize(req: Request, id: string): Promise<Response> {
    checkToken(req, "upload", id);
    const b = await readJSON(req, FINALIZE_KEYS);
    const ttl = int(b.ttl_hours), maxOpens = int(b.max_opens), ops = int(b.kdf_ops), mem = int(b.kdf_mem);
    if (typeof b.fill_from !== "number" || typeof b.fill_to !== "number") throw badRequest();
    const from = int(b.fill_from), to = int(b.fill_to);
    const salt = decodeB64(b.salt, 16), proofV = decodeB64(b.proof_v, 32), envelope = decodeB64(b.envelope, 60);
    emptyHash ??= await sha256(new Uint8Array(0));
    if (
      ![1, 6, 12, 24].includes(ttl) ||
      !(maxOpens >= 1 && maxOpens <= 10) ||
      !(ops >= 3 && ops <= 10) ||
      !(mem >= 67108864 && mem <= 268435456) ||
      equal(proofV, emptyHash)
    )
      throw badRequest();
    const s = live(id);
    if (s.state !== "uploading" || s.uploadDeadline <= now()) throw notFound();
    const segs = s.segments.length;
    // Bourrage : vide [k, k), ou [from, to) avec 1 ≤ from < to ≤ dernier segment (exclu).
    if (!(from >= 0 && from <= to && to <= segs - 1 && (from === to || from >= 1))) throw badRequest();
    if (s.segments.some((x, n) => x === undefined && (n < from || n >= to))) throw new HttpFail(409, "incomplete");
    for (let n = from; n < to; n++) {
      const pad = new Uint8Array(segmentSize(s.bucket, n));
      for (let o = 0; o < pad.length; o += 65536) crypto.getRandomValues(pad.subarray(o, o + 65536));
      s.segments[n] = pad;
    }
    Object.assign(s, { salt, kdf: { ops, mem }, proofV, envelope, ttlHours: ttl, maxOpens, opensLeft: maxOpens });
    s.state = "ready";
    s.expiresAt = ceil15(now() + ttl * 3600);
    s.uploadDeadline = 0;
    s.progressAt = null;
    return json(200, { expires_in_s: s.expiresAt - now() });
  }

  /** Partage lisible (Meta) : prêt, non expiré, moins de 5 essais, K_accès juste. */
  async function readable(id: string, kAcces: Uint8Array): Promise<Share> {
    const s = live(id);
    if (s.state !== "ready" || s.expiresAt <= now() || s.failed >= MAX_ATTEMPTS) throw notFound();
    if (!(await matches(kAcces, s.accessV))) throw notFound();
    return s;
  }

  async function meta(req: Request, id: string): Promise<Response> {
    const s = await readable(id, headerSecret(req, "X-Shh-Access"));
    return json(200, {
      expires_in_s: s.expiresAt - now(),
      salt: b64(s.salt!),
      kdf: { ...s.kdf! },
      bucket: s.bucket,
      segments: segmentCount(s.bucket),
    });
  }

  async function unlock(req: Request, id: string): Promise<Response> {
    const ka = headerSecret(req, "X-Shh-Access");
    const b = await readJSON(req, ["proof"]);
    const kp = decodeB64(b.proof, 32);
    const s = await readable(id, ka); // clé d'accès fausse : 404, aucun essai compté
    if (s.proofV !== null && (await matches(kp, s.proofV))) {
      if (s.opensLeft <= 0) throw notFound();
      s.opensLeft--;
      s.opensIssued++;
      if (s.opensLeft === 0) {
        s.state = "draining";
        s.purgeAt = Math.min(ceil15(now() + PURGE_WINDOW_S), s.expiresAt);
      }
      const exp = Math.min(now() + PURGE_WINDOW_S, s.expiresAt);
      return json(200, {
        download_token: issue("download", id, s.opensIssued, exp),
        segments: segmentCount(s.bucket),
        envelope: b64(s.envelope!),
      });
    }
    const left = await countFailure(id, s);
    if (left > 0) throw new HttpFail(403, "bad_password", { attempts_left: left });
    throw notFound(); // 5ᵉ essai faux : détruit
  }

  async function getSegment(req: Request, id: string, nStr: string): Promise<Response> {
    const tok = checkToken(req, "download", id);
    const n = segNum(nStr);
    const s = live(id);
    const t = now();
    const open = s.state === "ready" || (s.state === "draining" && s.purgeAt > t);
    if (!open || s.expiresAt <= t || s.failed >= MAX_ATTEMPTS || tok.openN > s.opensIssued || (s.doneMask & (1 << (tok.openN - 1))) !== 0)
      throw notFound();
    if (n >= s.segments.length) throw badRequest();
    const data = s.segments[n]!;
    await transfer(data.length);
    if (!shares.has(id)) throw notFound(); // détruit pendant la lecture
    return new Response(data.slice() as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: { "Content-Type": "application/octet-stream", "X-Shh-Demo": MARK },
    });
  }

  function done(req: Request, id: string): Response {
    const tok = checkToken(req, "download", id);
    const s = live(id);
    if (tok.openN > s.opensIssued) throw notFound();
    s.doneMask |= 1 << (tok.openN - 1);
    let bits = 0;
    for (let m = s.doneMask; m !== 0; m >>>= 1) bits += m & 1;
    if (s.state === "draining" && bits === s.opensIssued) shares.delete(id);
    return empty(204);
  }

  /** Même condition de vie que Status : envoi non échu, ou partage non expiré. */
  function alive(id: string): Share {
    const s = live(id);
    const t = now();
    if (s.state === "uploading" ? s.uploadDeadline <= t : s.expiresAt <= t) throw notFound();
    return s;
  }

  async function destroy(req: Request, id: string): Promise<Response> {
    const b = await readJSON(req, ["proof", "manage", "reason"]);
    const reason = str(b.reason);
    if ((b.proof === undefined && b.manage === undefined) || reason === null || reason.length > 64) throw badRequest();
    let ka: Uint8Array | undefined, kp: Uint8Array | undefined, sg: Uint8Array | undefined;
    if (b.proof !== undefined) {
      ka = headerSecret(req, "X-Shh-Access");
      kp = decodeB64(b.proof, 32);
    }
    if (b.manage !== undefined) sg = decodeB64(b.manage, 32);
    const s = alive(id);
    // Les trois comparaisons sont toujours faites.
    const [a, p, g] = await Promise.all([matches(ka, s.accessV), s.proofV !== null && matches(kp, s.proofV), matches(sg, s.manageV)]);
    if (g || (a && p)) {
      shares.delete(id);
      return empty(204);
    }
    if (a) await countFailure(id, s); // K_accès juste, K_preuve faux : un essai
    throw notFound();
  }

  async function status(req: Request, id: string): Promise<Response> {
    const sg = headerSecret(req, "X-Shh-Manage");
    const s = alive(id);
    if (!(await matches(sg, s.manageV))) throw notFound();
    return json(200, {
      opens_used: s.maxOpens === null ? 0 : s.maxOpens - s.opensLeft,
      max_opens: s.maxOpens ?? 0,
      expires_in_s: s.state === "uploading" ? 0 : s.expiresAt - now(),
      state: s.state,
    });
  }

  async function route(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    const m = req.method;
    if (path === "/api/captcha") return m === "GET" ? captcha() : json(404, { error: "not_found" });
    if (path === "/api/shares") return m === "POST" ? create(req) : json(404, { error: "not_found" });
    const r = /^\/api\/shares\/([^/]+)\/(segments\/([^/]+)|finalize|meta|unlock|done|destroy|status)$/.exec(path);
    if (r === null) throw notFound();
    let id: string;
    try {
      id = decodeURIComponent(r[1]!);
    } catch {
      throw notFound();
    }
    const what = r[3] !== undefined ? "segments" : r[2]!;
    const k = `${m} ${what}`;
    switch (k) {
      case "PUT segments":
        return putSegment(req, id, r[3]!);
      case "GET segments":
        return getSegment(req, id, r[3]!);
      case "POST finalize":
        return await finalize(req, id);
      case "GET meta":
        return meta(req, id);
      case "POST unlock":
        return unlock(req, id);
      case "POST done":
        return done(req, id);
      case "POST destroy":
        return destroy(req, id);
      case "GET status":
        return status(req, id);
    }
    throw notFound();
  }

  return {
    async handle(req) {
      if (offline()) throw new TypeError("Failed to fetch");
      sweep();
      try {
        return await route(req);
      } catch (e) {
        if (e instanceof HttpFail) return json(e.status, { error: e.error, ...e.extra });
        throw e; // coupure simulée ou annulation
      }
    },
    shares: () => {
      sweep();
      return shares.size;
    },
  };
}
