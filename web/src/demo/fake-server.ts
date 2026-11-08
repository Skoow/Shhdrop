// Faux serveur en mémoire de la démo GitHub Pages (UI §14.3). Mêmes routes, mêmes corps JSON
// et mêmes codes que server/internal/api (spec §8), mêmes règles visibles que
// server/internal/share : palier et taille exacte des segments, K_accès / K_preuve / S_gestion
// comparés par empreinte SHA-256, ouvertures, 5 essais puis destruction, « draining »,
// expiration, 404 uniformes ; v2 (spec §29.8, §32) : aucun id dans les chemins, partage
// trouvé par V_accès ou V_gestion (calculés ici depuis K_accès et S_gestion reçus en
// en-tête ; 400 si l'un existe déjà), désigné ensuite par le jeton signé ; id interne tiré
// ici ; sel, Argon2id, V_preuve et enveloppe à la finalisation, bourrage [fill_from, fill_to)
// rempli d'aléa, enveloppe rendue par unlock. Disparition pendant un téléchargement (spec
// §41.8) : 410 « gone » pour un jeton valide d'un partage disparu ; ouvertures actives (un
// segment dans les 120 s) servies jusqu'à 2 h après l'échéance ou la suppression ;
// signalement : aucune grâce, lectures en cours coupées ; GET /api/shares/watch tenue 25 s.
// Il ne reçoit et ne garde que ce que reçoit le
// vrai serveur (empreintes, sel, enveloppe, segments chiffrés), dans des Map de la page.
// Persistance (exception démo, demo/persist.ts) : `onChange` et `onSegment` livrent ces mêmes
// données, et elles seules, pour qu'un rechargement de l'onglet retrouve ses partages
// (`restore`) ; aucun secret du client (lien, mot de passe, clé) n'en fait partie.
// Non simulés : limites par connexion, quotas, place disque, gel. Aucune preuve anti-robot
// n'est vérifiée (anti-robot désactivé en démo ; `fallback: null`).
import { BUCKETS, CHUNK_CT, HEADER, SEG_CHUNKS, segmentCount, segmentSize } from "../crypto/container";

export const MARK = "__SHH_DEMO__";

const MAX_JSON = 4096;
const MAX_FINALIZE_JSON = 96 * 1024; // finalize d'un brouillon : manifeste chiffré (spec §41.14)
const MAX_ATTEMPTS = 5;
const UPLOAD_WINDOW_S = 6 * 3600; // jeton d'envoi et échéance d'envoi (spec §24, §41.2)
const PURGE_WINDOW_S = 6 * 3600; // jeton de téléchargement (spec §24, §41.2)
const EMPTY_SWEEP_S = UPLOAD_WINDOW_S - 300; // envoi sans segment
const STALL_SWEEP_S = 900; // envoi sans nouveau segment depuis 15 min
const CAPTCHA_TTL_S = 120;
const MIN_FILL_S = 3; // création refusée moins de 3 s après l'émission du défi
const ACTIVE_S = 120; // ouverture active : un segment dans les 120 s (spec §41.8)
const GRACE_S = 2 * 3600; // grâce après l'échéance ou la suppression
const WATCH_HOLD_MS = 25_000;
const GRANT_TTL_S = 30 * 60; // octroi d'ouverture (spec §41.4)
const MAX_REOPENS = 10;

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

/** Partage sans ses segments (gardés à part, un enregistrement par segment). */
export type SnapShare = Omit<Share, "segments"> & { nSegs: number };
/** État complet du faux serveur, clonable (structuredClone, IndexedDB) ; sans les segments. */
export type Snapshot = {
  v: 1;
  shares: [string, SnapShare][];
  dead: [string, { share: SnapShare; graceEnd: number; opens: number[] }][];
  tokens: [string, Token][];
  shownAt: [string, number][];
  active: [string, number][]; // dernier segment (s) ; les lectures en cours ne survivent pas
  revoked: string[];
  grantStr: [string, { id: string; openN: number; exp: number }][];
  grantOf: [string, { exp: number; reopens: number }][];
};

export type FakeServerOpts = {
  /** Horloge en millisecondes (tests). Par défaut Date.now. */
  now?: () => number;
  /** Durée d'une surveillance tenue (tests). 25 s par défaut. */
  watchHoldMs?: number;
  /** Débit simulé des segments (envoi et lecture), en octets par seconde. 20 Mo/s par défaut. */
  rateBytesPerS?: number;
  /** Coupure simulée : à `atFraction` des octets du premier envoi, tout /api échoue pendant `ms`. */
  outage?: { atFraction: number; ms: number };
  /** État repris (rechargement de la démo) : instantané et segments enregistrés. */
  restore?: { snap: Snapshot; segment(id: string, n: number): Uint8Array | undefined };
  /** Après chaque requête traitée : nouvel état (sans segments). */
  onChange?: (snap: Snapshot) => void;
  /** Segment reçu ou bourrage tiré (à garder avec l'état). */
  onSegment?: (id: string, n: number, data: Uint8Array) => void;
};

export type FakeServer = {
  /** Requêtes /api/* seulement. Coupure simulée : rejet TypeError, comme un fetch sans réseau. */
  handle(req: Request): Promise<Response>;
  /** Nombre de partages en mémoire (tests). */
  shares(): number;
  /** État courant, sans les segments (persistance de la démo). */
  snapshot(): Snapshot;
  /** Tests : état, palier et segments présents de chaque partage. */
  inspect(): { state: State; bucket: number; present: number[] }[];
};

class HttpFail {
  constructor(
    readonly status: number,
    readonly error: string,
    readonly extra: Record<string, number> = {},
  ) {}
}
const notFound = () => new HttpFail(404, "not_found");
const goneFail = () => new HttpFail(410, "gone");
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
async function readJSON(req: Request, keys: readonly string[], max = MAX_JSON): Promise<Record<string, unknown>> {
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.length > max) throw badRequest();
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
  // Spec §41.8 : (id, n° d'ouverture) → dernier segment et lectures en cours ; partages
  // disparus encore lus par leurs ouvertures actives ; surveillances ; lectures coupées.
  const active = new Map<string, { last: number; inflight: number }>();
  const dead = new Map<string, { share: Share; graceEnd: number; opens: Set<number> }>();
  const watchers = new Map<string, Set<() => void>>();
  const revoked = new Set<string>();
  const ak = (id: string, n: number) => `${id}:${n}`;
  // Octrois d'ouverture (spec §41.4) : chaîne opaque → ouverture ; (id, n) → échéance et
  // rechargements, comme le serveur (en mémoire ; rien n'est gardé ailleurs).
  const grantStr = new Map<string, { id: string; openN: number; exp: number }>();
  const grantOf = new Map<string, { exp: number; reopens: number }>();
  if (opts.restore !== undefined) restoreFrom(opts.restore);
  function restoreFrom(r: NonNullable<FakeServerOpts["restore"]>): void {
    const { snap } = r;
    if (snap.v !== 1) return;
    const thaw = (id: string, x: SnapShare): Share => {
      const { nSegs, ...rest } = x;
      return { ...rest, segments: Array.from({ length: nSegs }, (_, n) => r.segment(id, n)) };
    };
    for (const [id, x] of snap.shares) shares.set(id, thaw(id, x));
    for (const [id, d] of snap.dead) dead.set(id, { share: thaw(id, d.share), graceEnd: d.graceEnd, opens: new Set(d.opens) });
    for (const [k, v] of snap.tokens) tokens.set(k, v);
    for (const [k, v] of snap.shownAt) shownAt.set(k, v);
    for (const [k, last] of snap.active) active.set(k, { last, inflight: 0 });
    for (const id of snap.revoked) revoked.add(id);
    for (const [k, v] of snap.grantStr) grantStr.set(k, v);
    for (const [k, v] of snap.grantOf) grantOf.set(k, v);
  }
  function snapshot(): Snapshot {
    const freeze = (x: Share): SnapShare => {
      const { segments, ...rest } = x;
      return { ...rest, kdf: rest.kdf && { ...rest.kdf }, nSegs: segments.length };
    };
    return {
      v: 1,
      shares: [...shares].map(([id, x]) => [id, freeze(x)]),
      dead: [...dead].map(([id, d]) => [id, { share: freeze(d.share), graceEnd: d.graceEnd, opens: [...d.opens] }]),
      tokens: [...tokens].map(([k, v]) => [k, { ...v }]),
      shownAt: [...shownAt],
      active: [...active].map(([k, a]) => [k, a.last]),
      revoked: [...revoked],
      grantStr: [...grantStr].map(([k, v]) => [k, { ...v }]),
      grantOf: [...grantOf].map(([k, v]) => [k, { ...v }]),
    };
  }
  function grant(id: string, openN: number, cap: number): string {
    const t = now();
    const exp = Math.min(t + GRANT_TTL_S, cap);
    const e = grantOf.get(ak(id, openN)) ?? { exp: 0, reopens: 0 };
    e.exp = Math.max(e.exp, exp);
    grantOf.set(ak(id, openN), e);
    const g = randomId(40);
    grantStr.set(g, { id, openN, exp });
    return g;
  }
  function grantHeader(req: Request): string | null {
    const v = req.headers.get("X-Shh-Grant");
    if (v === null) return null;
    if (v.includes(",")) throw badRequest();
    decodeB64(v, 40);
    return v;
  }
  /** Octroi valable de l'ouverture encore vivante (non terminée, non balayée) du partage id. */
  function liveGrant(g: string, id: string, s: Share): number | null {
    const x = grantStr.get(g);
    if (x === undefined || x.id !== id || x.exp <= now()) return null;
    if (!grantOf.has(ak(id, x.openN)) || x.openN > s.opensIssued || (s.doneMask & (1 << (x.openN - 1))) !== 0) return null;
    return x.openN;
  }
  const isActive = (id: string, n: number, t: number) => {
    const a = active.get(ak(id, n));
    return a !== undefined && (a.inflight > 0 || t - a.last < ACTIVE_S);
  };

  /** Retire un partage ; grâce : ses ouvertures actives non terminées peuvent finir. */
  function retire(id: string, grace: boolean, event: number): void {
    const s = shares.get(id);
    if (s === undefined) return;
    shares.delete(id);
    const t = now();
    const opens = new Set<number>();
    if (grace) for (let n = 1; n <= s.opensIssued; n++) if ((s.doneMask & (1 << (n - 1))) === 0 && isActive(id, n, t)) opens.add(n);
    if (opens.size > 0) dead.set(id, { share: s, graceEnd: event + GRACE_S, opens });
    else if (!grace) revoked.add(id);
    for (const wake of watchers.get(id) ?? []) wake();
    watchers.delete(id);
  }

  // Coupure : déclenchée une seule fois, au premier envoi qui franchit la fraction.
  let outageUntil = 0;
  let outageDone = opts.outage === undefined;
  const offline = () => nowMs() < outageUntil;

  // sweepCond du serveur, appliquée paresseusement avant chaque requête.
  function sweep(): void {
    const t = now();
    for (const [id, s] of shares) {
      const upGone =
        (s.state === "uploading" && s.uploadDeadline <= t) ||
        (s.state === "uploading" && s.uploadDeadline - EMPTY_SWEEP_S <= t && s.segments.every((x) => x === undefined)) ||
        (s.state === "uploading" && s.progressAt !== null && s.progressAt + STALL_SWEEP_S <= t);
      if (upGone) shares.delete(id);
      else if (s.state !== "uploading" && s.expiresAt <= t) retire(id, true, s.expiresAt);
      else if ((s.state === "draining" && s.purgeAt <= t) || s.failed >= MAX_ATTEMPTS) retire(id, true, t);
    }
    for (const [k, e] of grantOf) {
      const i = k.lastIndexOf(":");
      const id = k.slice(0, i);
      const n = Number(k.slice(i + 1));
      if (e.exp <= t && !isActive(id, n, t)) endOpen(id, n);
    }
    for (const [g, x] of grantStr) if (x.exp <= t || !grantOf.has(ak(x.id, x.openN))) grantStr.delete(g);
    for (const [id, d] of dead) {
      for (const n of d.opens) if (t >= d.graceEnd || !isActive(id, n, t)) d.opens.delete(n);
      if (d.opens.size === 0) dead.delete(id);
    }
    for (const [k, a] of active) if (a.inflight === 0 && t - a.last >= ACTIVE_S) active.delete(k);
    // Jetons gardés jusqu'à leur échéance : un jeton valide d'un partage disparu → 410.
    for (const [k, tok] of tokens) if (tok.exp <= t) tokens.delete(k);
    for (const [k, at] of shownAt) if (at + CAPTCHA_TTL_S <= t) shownAt.delete(k);
  }

  /** Le jeton désigne le partage (aucun id dans le chemin, spec §32). */
  function checkToken(req: Request, kind: Token["kind"]): Token {
    const tok = tokens.get(bearer(req));
    if (tok === undefined || tok.kind !== kind || tok.exp <= now()) throw notFound();
    return tok;
  }

  /** Partage dont le vérificateur vaut SHA-256(secret) (index uniques du serveur). */
  async function find(secret: Uint8Array, which: "accessV" | "manageV"): Promise<[string, Share] | undefined> {
    if (secret.length !== 32) return undefined;
    const v = await sha256(secret);
    for (const e of shares) if (equal(e[1][which], v)) return e;
    return undefined;
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
    if (s.failed >= MAX_ATTEMPTS) retire(id, true, now());
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

  const CREATE_KEYS = ["bucket", "altcha", "hp", "shown_at"];

  async function create(req: Request): Promise<Response> {
    const b = await readJSON(req, CREATE_KEYS);
    const ka = headerSecret(req, "X-Shh-Access"), sg = headerSecret(req, "X-Shh-Manage");
    const bucket = int(b.bucket);
    const altcha = str(b.altcha), hp = str(b.hp), shown = str(b.shown_at);
    if (altcha === null || hp === null || shown === null) throw badRequest();
    const accessV = await sha256(ka), manageV = await sha256(sg);
    if (!(BUCKETS as readonly number[]).includes(bucket)) throw badRequest();
    // Anti-robot : aucune preuve vérifiée ; seuls le jeton shown_at (émis ici, usage unique,
    // valable 2 min) et le délai de 3 s sont contrôlés, comme le fait le vrai serveur.
    const at = shownAt.get(shown);
    if (altcha === "" || hp !== "" || at === undefined || now() - at < MIN_FILL_S) throw badRequest();
    shownAt.delete(shown);
    // V_accès ou V_gestion déjà pris : seul un détenteur du secret peut le provoquer ; même
    // réponse qu'une création invalide.
    if ((await find(ka, "accessV")) !== undefined || (await find(sg, "manageV")) !== undefined) throw badRequest();
    const id = randomId(16);
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

  async function putSegment(req: Request, nStr: string): Promise<Response> {
    const { id } = checkToken(req, "upload");
    const n = segNum(nStr);
    const body = new Uint8Array(await req.arrayBuffer());
    const s0 = shares.get(id);
    const total = s0 === undefined ? 0 : s0.segments.reduce((a, _, i) => a + segmentSize(s0.bucket, i), 0);
    const before = s0 === undefined ? 0 : s0.segments.reduce((a, x, i) => a + (x !== undefined && i !== n ? segmentSize(s0.bucket, i) : 0), 0);
    await transfer(body.length, s0 === undefined ? undefined : { before, total });
    if (req.signal.aborted) throw new DOMException("Aborted", "AbortError");
    const s = live(id); // revérifié après le transfert : détruit pendant l'envoi → 404
    if (s.state !== "uploading" || s.uploadDeadline <= now()) throw notFound();
    const q = new URL(req.url).searchParams;
    if (q.has("from")) {
      // Plage de morceaux (audit H-2, comme PutChunks du vrai serveur) : morceaux jamais reçus
      // déjà en aléa ici, comme après finalize.
      const from = segNum(q.get("from")!);
      const size = n < s.segments.length ? segmentSize(s.bucket, n) : 0;
      const chunks = Math.min(SEG_CHUNKS, s.bucket - n * SEG_CHUNKS);
      const pre = n === 0 && from === 0 ? HEADER : 0;
      const k = (body.length - pre) / CHUNK_CT;
      if (n >= s.segments.length || from >= SEG_CHUNKS || body.length - pre <= 0 || !Number.isInteger(k) || from + k > chunks) throw badRequest();
      let seg = s.segments[n];
      if (!seg) {
        const fresh = new Uint8Array(size);
        for (let o = 0; o < size; o += 65536) crypto.getRandomValues(fresh.subarray(o, Math.min(size, o + 65536)));
        s.segments[n] = seg = fresh;
      }
      seg.set(body, (n === 0 ? HEADER : 0) + from * CHUNK_CT - pre);
      opts.onSegment?.(id, n, seg);
      s.progressAt = minute(now());
      return empty(204);
    }
    if (n >= s.segments.length || body.length !== segmentSize(s.bucket, n)) throw badRequest();
    s.segments[n] = body;
    opts.onSegment?.(id, n, body);
    s.progressAt = minute(now());
    return empty(204);
  }

  const FINALIZE_KEYS = ["salt", "kdf_ops", "kdf_mem", "proof_v", "envelope", "ttl_hours", "max_opens", "fill_from", "fill_to", "bucket", "header", "tail", "void"];

  function uploading(req: Request): [string, Share] {
    const { id } = checkToken(req, "upload");
    const s = live(id);
    if (s.state !== "uploading" || s.uploadDeadline <= now()) throw notFound();
    return [id, s];
  }

  // Brouillon (spec §41.14) : agrandir la réservation, effacer un élément retiré, signe de vie.
  async function grow(req: Request): Promise<Response> {
    const [, s] = uploading(req);
    const b = await readJSON(req, ["bucket"]);
    const bucket = int(b.bucket);
    if (b.bucket === undefined || !(BUCKETS as readonly number[]).includes(bucket) || bucket <= s.bucket) throw badRequest();
    const old = s.bucket;
    const next: (Uint8Array | undefined)[] = new Array(segmentCount(bucket)).fill(undefined);
    s.segments.forEach((x, n) => (next[n] = x));
    if (old % SEG_CHUNKS !== 0) next[segmentCount(old) - 1] = undefined; // dernier segment partiel
    s.segments = next;
    s.bucket = bucket;
    s.progressAt = minute(now());
    return empty(204);
  }

  async function erase(req: Request): Promise<Response> {
    const [, s] = uploading(req);
    const b = await readJSON(req, ["from", "to"]);
    const from = int(b.from), to = int(b.to);
    if (b.from === undefined || b.to === undefined || !(from >= 0 && from < to && to <= s.segments.length)) throw badRequest();
    for (let n = from; n < to; n++) {
      s.segments[n]?.fill(0);
      s.segments[n] = undefined;
    }
    s.progressAt = minute(now());
    return empty(204);
  }

  async function keep(req: Request): Promise<Response> {
    const [, s] = uploading(req);
    if ((await req.arrayBuffer()).byteLength > 0) throw badRequest();
    s.progressAt = minute(now());
    return empty(204);
  }

  async function finalize(req: Request): Promise<Response> {
    const { id } = checkToken(req, "upload");
    const b = await readJSON(req, FINALIZE_KEYS, MAX_FINALIZE_JSON);
    const draft = b.bucket !== undefined;
    if (draft !== (b.header !== undefined) || draft !== (b.tail !== undefined)) throw badRequest();
    if (draft && (b.fill_from !== undefined || b.fill_to !== undefined)) throw badRequest();
    if (!draft && b.void !== undefined) throw badRequest();
    const ttl = int(b.ttl_hours), maxOpens = int(b.max_opens), ops = int(b.kdf_ops), mem = int(b.kdf_mem);
    // fill_from et fill_to ensemble, ou aucun des deux (spec §36 S4 : tout le bourrage envoyé).
    const noFill = b.fill_from === undefined && b.fill_to === undefined;
    if (!noFill && (typeof b.fill_from !== "number" || typeof b.fill_to !== "number")) throw badRequest();
    const from = int(b.fill_from), to = int(b.fill_to);
    const salt = decodeB64(b.salt, 16), proofV = decodeB64(b.proof_v, 32), envelope = decodeB64(b.envelope, 60);
    emptyHash ??= await sha256(new Uint8Array(0));
    if (
      ![1, 6, 12, 24].includes(ttl) ||
      !(maxOpens >= 1 && maxOpens <= 10) ||
      ops !== 3 || // audit F4 : seuls paramètres de création, comme le vrai serveur
      mem !== 67108864 ||
      equal(proofV, emptyHash)
    )
      throw badRequest();
    const s = live(id);
    if (s.state !== "uploading" || s.uploadDeadline <= now()) throw notFound();
    if (draft) {
      const fb = int(b.bucket);
      const hdr = decodeB64(b.header, HEADER), tail = decodeB64(b.tail, CHUNK_CT);
      if (!(BUCKETS as readonly number[]).includes(fb) || fb > s.bucket) throw badRequest();
      const segs = segmentCount(fb);
      const out: Uint8Array[] = [];
      for (let n = 0; n < segs; n++) {
        const size = segmentSize(fb, n);
        const got = s.segments[n];
        const seg = new Uint8Array(size);
        if (got) seg.set(got.subarray(0, size));
        else for (let o = 0; o < size; o += 65536) crypto.getRandomValues(seg.subarray(o, Math.min(size, o + 65536)));
        out.push(seg);
      }
      // Morceaux de petits éléments retirés (audit H-2) : remplacés par de l'aléa.
      const voids = b.void === undefined ? [] : b.void;
      if (!Array.isArray(voids) || voids.length > 512) throw badRequest();
      for (const v of voids as unknown[]) {
        if (!Array.isArray(v) || v.length !== 2 || !Number.isInteger(v[0]) || !Number.isInteger(v[1]) || !(v[0] >= 0 && v[0] < v[1] && v[1] <= fb - 1)) throw badRequest();
        for (let c = v[0] as number; c < (v[1] as number); c++) {
          const n = Math.floor(c / SEG_CHUNKS), at = (n === 0 ? HEADER : 0) + (c % SEG_CHUNKS) * CHUNK_CT;
          for (let o = at; o < at + CHUNK_CT; o += 65536) crypto.getRandomValues(out[n]!.subarray(o, Math.min(at + CHUNK_CT, o + 65536)) as Uint8Array<ArrayBuffer>);
        }
      }
      out[0]!.set(hdr, 0);
      const L = Math.floor((fb - 1) / SEG_CHUNKS);
      out[L]!.set(tail, (L === 0 ? HEADER : 0) + ((fb - 1) % SEG_CHUNKS) * CHUNK_CT);
      for (const x of s.segments) x?.fill(0);
      s.segments = out;
      s.bucket = fb;
      out.forEach((x, n) => opts.onSegment?.(id, n, x));
      Object.assign(s, { salt, kdf: { ops, mem }, proofV, envelope, ttlHours: ttl, maxOpens, opensLeft: maxOpens });
      s.state = "ready";
      s.expiresAt = ceil15(now() + ttl * 3600);
      s.uploadDeadline = 0;
      s.progressAt = null;
      return json(200, { expires_in_s: s.expiresAt - now() });
    }
    const segs = s.segments.length;
    // Bourrage : vide [k, k), ou [from, to) avec 1 ≤ from < to ≤ dernier segment (exclu).
    if (!(from >= 0 && from <= to && to <= segs - 1 && (from === to || from >= 1))) throw badRequest();
    if (s.segments.some((x, n) => x === undefined && (n < from || n >= to))) throw new HttpFail(409, "incomplete");
    for (let n = from; n < to; n++) {
      const pad = new Uint8Array(segmentSize(s.bucket, n));
      for (let o = 0; o < pad.length; o += 65536) crypto.getRandomValues(pad.subarray(o, o + 65536));
      s.segments[n] = pad;
      opts.onSegment?.(id, n, pad);
    }
    Object.assign(s, { salt, kdf: { ops, mem }, proofV, envelope, ttlHours: ttl, maxOpens, opensLeft: maxOpens });
    s.state = "ready";
    s.expiresAt = ceil15(now() + ttl * 3600);
    s.uploadDeadline = 0;
    s.progressAt = null;
    return json(200, { expires_in_s: s.expiresAt - now() });
  }

  /** Partage lisible (Meta) : trouvé par V_accès, prêt, non expiré, moins de 5 essais. */
  async function readable(kAcces: Uint8Array): Promise<[string, Share]> {
    const e = await find(kAcces, "accessV");
    if (e === undefined) throw notFound();
    const s = e[1];
    if (s.state !== "ready" || s.expiresAt <= now() || s.failed >= MAX_ATTEMPTS) throw notFound();
    return e;
  }

  /** Comme readable, et aussi un « draining » pour qui porte un octroi vivant (spec §41.4). */
  async function reopenable(kAcces: Uint8Array, g: string | null): Promise<[string, Share]> {
    const e = await find(kAcces, "accessV");
    if (e === undefined) throw notFound();
    const s = e[1];
    if (s.expiresAt <= now() || s.failed >= MAX_ATTEMPTS) throw notFound();
    if (s.state === "ready") return e;
    if (s.state === "draining" && g !== null && liveGrant(g, e[0], s) !== null) return e;
    throw notFound();
  }

  async function meta(req: Request): Promise<Response> {
    const [, s] = await reopenable(headerSecret(req, "X-Shh-Access"), grantHeader(req));
    return json(200, {
      expires_in_s: s.expiresAt - now(),
      salt: b64(s.salt!),
      kdf: { ...s.kdf! },
      bucket: s.bucket,
      segments: segmentCount(s.bucket),
      opens_left: s.opensLeft,
    });
  }

  async function unlock(req: Request): Promise<Response> {
    const ka = headerSecret(req, "X-Shh-Access");
    const g = grantHeader(req);
    const b = await readJSON(req, ["proof"]);
    const kp = decodeB64(b.proof, 32);
    const [id, s] = await reopenable(ka, g); // clé d'accès fausse : 404, aucun essai compté
    // Octroi invalide (falsifié, autre partage, expiré, ouverture terminée) : 409, ni ouverture
    // ni essai consommé.
    const reopenN = g === null ? null : liveGrant(g, id, s);
    if (g !== null && reopenN === null) throw new HttpFail(409, "grant_invalid");
    if (s.proofV !== null && (await matches(kp, s.proofV))) {
      // Jeton de 6 h, non plafonné à l'échéance : il borne la grâce (spec §41.8).
      const exp = now() + PURGE_WINDOW_S;
      let openN: number;
      if (reopenN !== null) {
        const e = grantOf.get(ak(id, reopenN));
        if (e === undefined) throw new HttpFail(409, "grant_invalid");
        if (e.reopens >= MAX_REOPENS) throw new HttpFail(429, "reopen_limit");
        e.reopens++;
        openN = reopenN;
        if (s.state === "draining") s.purgeAt = Math.max(s.purgeAt, Math.min(ceil15(now() + PURGE_WINDOW_S), s.expiresAt));
      } else {
        if (s.state !== "ready" || s.opensLeft <= 0) throw notFound();
        s.opensLeft--;
        s.opensIssued++;
        openN = s.opensIssued;
        if (s.opensLeft === 0) {
          s.state = "draining";
          s.purgeAt = Math.min(ceil15(now() + PURGE_WINDOW_S), s.expiresAt);
        }
      }
      return json(200, {
        download_token: issue("download", id, openN, exp),
        segments: segmentCount(s.bucket),
        envelope: b64(s.envelope!),
        grant: grant(id, openN, s.expiresAt),
        opens_left: s.opensLeft,
      });
    }
    const left = await countFailure(id, s);
    if (left > 0) throw new HttpFail(403, "bad_password", { attempts_left: left });
    throw notFound(); // 5ᵉ essai faux : détruit
  }

  /** POST /api/shares/regrant : octroi renouvelé, jamais au-delà du jeton ni de l'échéance. */
  function regrant(req: Request): Response {
    const tok = checkToken(req, "download");
    const s = shares.get(tok.id);
    const cap = s === undefined ? 0 : Math.min(tok.exp, s.expiresAt);
    if (s === undefined || dead.has(tok.id) || !grantOf.has(ak(tok.id, tok.openN)) || cap <= now()) throw goneFail();
    return json(200, { grant: grant(tok.id, tok.openN, cap) });
  }

  /** Segments lisibles par l'ouverture tok, ou 410 (partage disparu, ouverture finie). */
  function readableBy(tok: Token): Share {
    const t = now();
    const d = dead.get(tok.id);
    if (d !== undefined) {
      if (!d.opens.has(tok.openN) || t >= d.graceEnd || !isActive(tok.id, tok.openN, t)) {
        d.opens.delete(tok.openN);
        throw goneFail();
      }
      return d.share;
    }
    const s = shares.get(tok.id);
    if (s === undefined) throw goneFail();
    if (tok.openN > s.opensIssued) throw notFound();
    if ((s.doneMask & (1 << (tok.openN - 1))) !== 0) throw goneFail();
    return s;
  }

  async function getSegment(req: Request, nStr: string): Promise<Response> {
    const tok = checkToken(req, "download");
    const id = tok.id;
    const n = segNum(nStr);
    const s = readableBy(tok);
    if (n >= s.segments.length) throw badRequest();
    const data = s.segments[n]!;
    const key = ak(id, tok.openN);
    const a = active.get(key) ?? { last: now(), inflight: 0 };
    active.set(key, a);
    a.inflight++;
    a.last = now();
    try {
      await transfer(data.length);
    } finally {
      a.inflight--;
      a.last = now();
    }
    // Signalement pendant la lecture : connexion coupée (aucune grâce).
    if (revoked.has(id)) throw new TypeError("Failed to fetch");
    return new Response(data.slice() as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: { "Content-Type": "application/octet-stream", "X-Shh-Demo": MARK },
    });
  }

  /** Fin de l'ouverture n (done, ou octroi expiré sans renouvellement) ; rend faux si déjà disparue. */
  function endOpen(id: string, n: number): "ok" | "gone" | "unknown" {
    grantOf.delete(ak(id, n));
    const d = dead.get(id);
    if (d !== undefined) return d.opens.delete(n) ? "ok" : "gone";
    const s = shares.get(id);
    if (s === undefined) return "gone";
    if (n > s.opensIssued) return "unknown";
    s.doneMask |= 1 << (n - 1);
    let bits = 0;
    for (let m = s.doneMask; m !== 0; m >>>= 1) bits += m & 1;
    if (s.state === "draining" && bits === s.opensIssued) retire(id, true, now());
    return "ok";
  }

  function done(req: Request): Response {
    const tok = checkToken(req, "download");
    const r = endOpen(tok.id, tok.openN);
    if (r === "gone") throw goneFail();
    if (r === "unknown") throw notFound();
    return empty(204);
  }

  /** GET /api/shares/watch : tenue 25 s (raccourcie à l'échéance) ; 410 dès la disparition. */
  async function watch(req: Request): Promise<Response> {
    const tok = checkToken(req, "download");
    if (dead.has(tok.id)) throw goneFail();
    const s = readableBy(tok);
    const left = s.expiresAt * 1000 - nowMs();
    if (left <= 0) throw goneFail();
    const gone = await new Promise<boolean>((resolve) => {
      const set = watchers.get(tok.id) ?? new Set<() => void>();
      watchers.set(tok.id, set);
      const wake = () => finish(true);
      const timer = setTimeout(() => finish(nowMs() >= s.expiresAt * 1000), Math.min(opts.watchHoldMs ?? WATCH_HOLD_MS, left));
      const abort = () => finish(false);
      function finish(g: boolean) {
        clearTimeout(timer);
        set.delete(wake);
        req.signal.removeEventListener("abort", abort);
        resolve(g);
      }
      set.add(wake);
      req.signal.addEventListener("abort", abort);
    });
    if (req.signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (gone) throw goneFail();
    return empty(204);
  }

  /** Même condition de vie que Status : envoi non échu, ou partage non expiré. */
  function isAlive(s: Share): boolean {
    const t = now();
    return s.state === "uploading" ? s.uploadDeadline > t : s.expiresAt > t;
  }

  /** Destinataire : K_accès en en-tête, K_preuve dans le corps (POST /api/shares/destroy). */
  async function destroy(req: Request): Promise<Response> {
    const b = await readJSON(req, ["proof", "reason"]);
    // Motif fermé (spec §36 S14) : absent, ou exactement "report".
    const report = "reason" in b;
    if (report && b.reason !== "report") throw badRequest();
    const ka = headerSecret(req, "X-Shh-Access");
    const kp = decodeB64(b.proof, 32);
    const e = await find(ka, "accessV");
    if (e === undefined || !isAlive(e[1])) throw notFound();
    const [id, s] = e;
    if (s.proofV !== null && (await matches(kp, s.proofV))) {
      retire(id, !report, now());
      return empty(204);
    }
    await countFailure(id, s); // K_accès juste, K_preuve faux : un essai
    throw notFound();
  }

  /** Expéditeur : S_gestion en en-tête, corps vide (/api/manage/*). */
  async function managed(req: Request): Promise<[string, Share]> {
    if ((await req.arrayBuffer()).byteLength !== 0) throw badRequest();
    const e = await find(headerSecret(req, "X-Shh-Manage"), "manageV");
    if (e === undefined || !isAlive(e[1])) throw notFound();
    return e;
  }

  async function manageDestroy(req: Request): Promise<Response> {
    const [id] = await managed(req);
    retire(id, true, now());
    return empty(204);
  }

  async function status(req: Request): Promise<Response> {
    const [, s] = await managed(req);
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
    if (path === "/api/manage/status") return m === "GET" ? status(req) : json(404, { error: "not_found" });
    if (path === "/api/manage/destroy") return m === "POST" ? manageDestroy(req) : json(404, { error: "not_found" });
    // Aucun id dans les chemins (spec §29.8, §32).
    const seg = /^\/api\/shares\/segments\/([^/]+)$/.exec(path);
    if (seg !== null) {
      if (m === "PUT") return putSegment(req, seg[1]!);
      if (m === "GET") return getSegment(req, seg[1]!);
      throw notFound();
    }
    switch (`${m} ${path}`) {
      case "POST /api/shares/finalize":
        return await finalize(req);
      case "POST /api/shares/grow":
        return await grow(req);
      case "POST /api/shares/erase":
        return await erase(req);
      case "POST /api/shares/keep":
        return await keep(req);
      case "GET /api/shares/meta":
        return meta(req);
      case "POST /api/shares/unlock":
        return unlock(req);
      case "POST /api/shares/done":
        return done(req);
      case "POST /api/shares/regrant":
        return regrant(req);
      case "POST /api/shares/destroy":
        return destroy(req);
      case "GET /api/shares/watch":
        return watch(req);
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
      } finally {
        opts.onChange?.(snapshot());
      }
    },
    shares: () => {
      sweep();
      return shares.size;
    },
    snapshot,
    inspect: () =>
      [...shares.values()].map((x) => ({
        state: x.state,
        bucket: x.bucket,
        present: x.segments.flatMap((v, n) => (v ? [n] : [])),
      })),
  };
}
