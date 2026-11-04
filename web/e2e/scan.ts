// Outils de fouille pour le test « le serveur ne voit rien ».
import { closeSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";

export type Needle = { label: string; forms: Buffer[] };

// Formes recherchées : octets bruts, et base64url / base64 pour les trois alignements
// possibles (un secret encodé au milieu d'un texte plus long ne commence pas forcément
// sur une frontière de 3 octets). Chaque forme couvre au moins 12 octets du secret.
export function needle(label: string, raw: Uint8Array | string): Needle {
  const b = Buffer.from(typeof raw === "string" ? new TextEncoder().encode(raw) : raw);
  const forms = [b];
  for (let k = 0; k < 3; k++) {
    const sub = b.subarray(k, k + Math.floor((b.length - k) / 3) * 3);
    if (sub.length < 12) continue;
    forms.push(Buffer.from(sub.toString("base64url")), Buffer.from(sub.toString("base64")));
  }
  return { label, forms };
}

/** Libellés des aiguilles trouvées dans hay. */
export function findIn(hay: Buffer, needles: Needle[]): string[] {
  return needles.filter((n) => n.forms.some((f) => hay.includes(f))).map((n) => n.label);
}

export function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
}

/** Fouille chaque fichier du dossier ; rend « fichier : libellé » pour chaque trouvaille. */
export function scanDir(dir: string, needles: Needle[]): string[] {
  const hits: string[] = [];
  for (const f of listFiles(dir)) for (const l of findIn(readFileSync(f), needles)) hits.push(`${f} : ${l}`);
  return hits;
}

export type MemScan = { ok: true; hits: string[]; bytes: number; regions: number } | { ok: false; why: string };

/**
 * Lit la mémoire du processus via /proc/<pid>/maps et /proc/<pid>/mem (Linux).
 * Chaque zone lisible est fouillée en entier (une aiguille ne peut pas être coupée).
 * Échec global (EPERM, EACCES, ENOENT…) → { ok: false, why }.
 */
export function scanProcessMemory(pid: number, needles: Needle[]): MemScan {
  let maps: string;
  let fd: number;
  try {
    maps = readFileSync(`/proc/${pid}/maps`, "utf8");
    fd = openSync(`/proc/${pid}/mem`, "r");
  } catch (e) {
    return { ok: false, why: `${(e as NodeJS.ErrnoException).code ?? ""} ${(e as Error).message}` };
  }
  const hits = new Set<string>();
  let bytes = 0;
  let regions = 0;
  try {
    for (const line of maps.split("\n")) {
      const m = /^([0-9a-f]+)-([0-9a-f]+) (\S{4})/.exec(line);
      if (!m || m[3]![0] !== "r" || line.endsWith("[vvar]") || line.endsWith("[vsyscall]")) continue;
      const start = parseInt(m[1]!, 16);
      const len = parseInt(m[2]!, 16) - start;
      const buf = Buffer.alloc(len);
      let got = 0;
      try {
        while (got < len) {
          const n = readSync(fd, buf, got, len - got, start + got);
          if (n === 0) break;
          got += n;
        }
      } catch {
        // zone illisible (EIO : pages non présentes, mappage spécial) : on garde ce qui a été lu
      }
      if (got === 0) continue;
      regions++;
      bytes += got;
      for (const l of findIn(buf.subarray(0, got), needles)) hits.add(l);
    }
  } finally {
    closeSync(fd);
  }
  if (regions === 0) return { ok: false, why: "aucune zone mémoire lisible" };
  return { ok: true, hits: [...hits], bytes, regions };
}

export type Captured = { method: string; url: string; headers: [string, string][]; body: Buffer };

/** Enveloppe fetch : chaque requête (méthode, URL, en-têtes, corps) est copiée dans `log`. */
export function capturingFetch(log: Captured[], inner: typeof fetch = globalThis.fetch): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers: [string, string][] = [];
    new Headers(init?.headers).forEach((v, k) => headers.push([k, v]));
    const b = init?.body;
    let body: Buffer;
    if (b == null) body = Buffer.alloc(0);
    else if (typeof b === "string") body = Buffer.from(b, "utf8");
    else if (b instanceof Uint8Array) body = Buffer.from(b);
    else if (b instanceof ArrayBuffer) body = Buffer.from(new Uint8Array(b));
    else throw new Error("corps de requête de type non pris en charge par la capture");
    log.push({ method: init?.method ?? "GET", url, headers, body });
    return inner(input, init);
  };
}
