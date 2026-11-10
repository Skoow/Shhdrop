// Banc de vitesse du moteur de chiffrement : 128 Mio chiffrés puis rouverts en mémoire, et
// Argon2id (KDF_CREATE). Une passe d'échauffement écartée, puis 5 passes ; médiane de chaque
// mesure. Résultat dans window.__bench. N'importe le moteur que par ./api.
import { CHUNK, CHUNK_CT, HEADER, KDF_CREATE, SEG_CHUNKS, contentKeys, elementSealer, newSeed, openStream, passwordKey, sealFinal, segmentCount, segmentSize } from "./api";

const MIB = 1048576;
const SIZE = 128 * MIB;
const RUNS = 5;

type Result = { seal_mib_s: number; open_mib_s: number; argon2_ms: number; seal_runs: number[]; open_runs: number[]; argon2_runs: number[] };
declare global {
  interface Window {
    __bench?: Result | { error: string };
  }
}

// 128 Mio pseudo-aléatoires, graine fixe.
function pseudo(n: number, seed: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

// Une passe : chiffre tout (secondes), assemble le paquet, le rouvre en flux (secondes), vérifie les octets.
async function pass(data: Uint8Array<ArrayBuffer>): Promise<{ seal: number; open: number }> {
  const blob = new Blob([data]);
  const t0 = performance.now();
  const el = await elementSealer(blob, 0);
  const segs = new Map<number, Uint8Array<ArrayBuffer>>();
  for (const [j, p] of el.pieces.entries()) {
    const pre = p.seg === 0 ? HEADER : 0;
    let s = segs.get(p.seg);
    if (!s) segs.set(p.seg, (s = new Uint8Array(pre + SEG_CHUNKS * CHUNK_CT)));
    const b = await el.piece(j);
    s.set(b, pre + p.from * CHUNK_CT - (p.seg === 0 && p.from === 0 ? HEADER : 0));
  }
  const seal = (performance.now() - t0) / 1000;

  // Hors mesure : en-tête et manifeste (dernier morceau du palier).
  const keys = await contentKeys(newSeed());
  const fin = await sealFinal([{ kind: "file", name: "bench.bin", mime: "application/octet-stream", size: SIZE, first: 0, k: el.k }], keys, {});
  const n = Math.floor((fin.bucket - 1) / SEG_CHUNKS);
  let last = segs.get(n);
  if (!last) segs.set(n, (last = new Uint8Array(segmentSize(fin.bucket, n))));
  last.set(fin.tail, (n === 0 ? HEADER : 0) + ((fin.bucket - 1) % SEG_CHUNKS) * CHUNK_CT);
  segs.get(0)!.set(fin.header, 0);
  if (segmentCount(fin.bucket) <= n) throw new Error("palier incohérent");

  const t1 = performance.now();
  const rd = await openStream(async (k) => { const s = segs.get(k); return s ? new Uint8Array(s) : new Uint8Array(segmentSize(fin.bucket, k)); } /* copie : le lecteur met à zéro ce qu'il reçoit */, fin.bucket, keys);
  const parts: Uint8Array[] = [];
  await rd.streamItem(0, (c) => {
    parts.push(c);
  });
  const open = (performance.now() - t1) / 1000;

  const out = new Uint8Array(SIZE);
  let o = 0;
  for (const c of parts) {
    out.set(c, o);
    o += c.length;
  }
  if (o !== SIZE || !same(out, data)) throw new Error("octets rouverts différents");
  if (rd.manifest.items.length !== 1 || CHUNK !== 65536) throw new Error("manifeste inattendu");
  return { seal, open };
}

async function main(): Promise<Result> {
  const data = pseudo(SIZE, 12345);
  await pass(data); // échauffement écarté
  const seal: number[] = [];
  const open: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await pass(data);
    seal.push(128 / r.seal);
    open.push(128 / r.open);
  }
  // Mot de passe de la forme générée (11 caractères, quatre familles).
  const pw = "aB3$kLm9#xQ";
  const salt = new Uint8Array(16).fill(7);
  await passwordKey(pw, salt, KDF_CREATE); // échauffement écarté
  const argon: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    await passwordKey(pw, salt, KDF_CREATE);
    argon.push(performance.now() - t);
  }
  return { seal_mib_s: median(seal), open_mib_s: median(open), argon2_ms: median(argon), seal_runs: seal, open_runs: open, argon2_runs: argon };
}

main().then(
  (r) => {
    window.__bench = r;
    document.getElementById("out")!.textContent = JSON.stringify(r);
  },
  (e) => {
    window.__bench = { error: String(e) };
  },
);
