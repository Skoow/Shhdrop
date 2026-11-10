// Banc de vitesse du moteur de chiffrement : 128 Mio chiffrés puis rouverts en mémoire, et
// Argon2id de création. Une passe d'échauffement écartée, puis RUNS passes. Résultat dans
// window.__bench. Le moteur n'est touché que par ./api (interface neutre).
import { deriveKey, openPacket, sealPacket } from "./api";

const MIB = 1048576;
const SIZE = 128 * MIB;
const RUNS = 15;

type Stat = { median: number; min: number; iqr: number; runs: number[] };
type Result = { seal_mib_s: Stat; open_mib_s: Stat; argon2_ms: Stat; argon2_first_ms: number };
declare global {
  interface Window {
    __bench?: Result | { error: string };
  }
}

// 128 Mio pseudo-aléatoires (xorshift32, graine fixe).
function pseudo(n: number, seed: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  let x = seed | 0 || 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x >>> 24;
  }
  return out;
}

function stat(runs: number[]): Stat {
  const s = [...runs].sort((a, b) => a - b);
  const q = (f: number) => {
    const p = (s.length - 1) * f;
    const lo = Math.floor(p);
    return s[lo]! + (s[Math.min(lo + 1, s.length - 1)]! - s[lo]!) * (p - lo);
  };
  return { median: q(0.5), min: s[0]!, iqr: q(0.75) - q(0.25), runs };
}

const same = (parts: Uint8Array[], data: Uint8Array) => {
  let o = 0;
  for (const c of parts) {
    for (let i = 0; i < c.length; i++) if (c[i] !== data[o + i]) return false;
    o += c.length;
  }
  return o === data.length;
};

async function pass(data: Uint8Array<ArrayBuffer>, blob: Blob): Promise<{ seal: number; open: number }> {
  const t0 = performance.now();
  const p = await sealPacket(blob);
  const seal = (performance.now() - t0) / 1000;
  const t1 = performance.now();
  const parts = await openPacket(p);
  const open = (performance.now() - t1) / 1000;
  if (!same(parts, data)) throw new Error("octets rouverts différents");
  return { seal, open };
}

async function main(): Promise<Result> {
  const data = pseudo(SIZE, 12345);
  const blob = new Blob([data]);
  await pass(data, blob); // échauffement écarté
  const seal: number[] = [];
  const open: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await pass(data, blob);
    seal.push(128 / r.seal);
    open.push(128 / r.open);
  }
  // Mot de passe de la forme générée (11 caractères, quatre familles).
  const pw = "aB3$kLm9#xQ";
  const salt = new Uint8Array(16).fill(7);
  const t0 = performance.now();
  await deriveKey(pw, salt); // premier appel : coût à froid (instanciation comprise), écarté de la médiane
  const first = performance.now() - t0;
  const argon: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    await deriveKey(pw, salt);
    argon.push(performance.now() - t);
  }
  return { seal_mib_s: stat(seal), open_mib_s: stat(open), argon2_ms: stat(argon), argon2_first_ms: first };
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
