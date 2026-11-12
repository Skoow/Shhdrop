// Outils de fouille pour le test « le serveur ne voit rien ».
import { closeSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";

export type Needle = { label: string; forms: Buffer[] };

// Formes recherchées : octets bruts ; base64url / base64 pour les trois alignements
// possibles (un secret encodé au milieu d'un texte plus long ne commence pas forcément
// sur une frontière de 3 octets ; chaque forme couvre au moins 12 octets du secret) ; hex en
// minuscules et en majuscules ; pour un repère texte, UTF-16LE et UTF-16BE (relecture C-2
// Task 17).
export function needle(label: string, raw: Uint8Array<ArrayBuffer> | string): Needle {
  const b = Buffer.from(typeof raw === "string" ? new TextEncoder().encode(raw) : raw);
  const forms = [b];
  for (let k = 0; k < 3; k++) {
    const sub = b.subarray(k, k + Math.floor((b.length - k) / 3) * 3);
    if (sub.length < 12) continue;
    forms.push(Buffer.from(sub.toString("base64url")), Buffer.from(sub.toString("base64")));
  }
  const hex = b.toString("hex");
  forms.push(Buffer.from(hex), Buffer.from(hex.toUpperCase()));
  if (typeof raw === "string") {
    const le = Buffer.from(raw, "utf16le");
    forms.push(le, Buffer.from(le).swap16());
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

export type MemStats = {
  regions: number; // zones lisibles dont au moins un octet a été lu
  bytes: number; // octets distincts lus (toutes zones)
  rwRegions: number; // zones « rw-p » (tas, anonymes, données) dont au moins un octet a été lu
  rwBytes: number; // octets distincts des zones rw-p (lus ou non)
  rwFailedBytes: number; // octets des zones rw-p illisibles
  failures: number; // fenêtres dont la lecture a échoué (tout ou partie)
};
export type MemScan = ({ ok: true; hits: string[] } & MemStats) | { ok: false; why: string };

export const MEM_WINDOW = 2 << 20; // 2 Mio

/**
 * Lit la mémoire du processus via /proc/<pid>/maps et /proc/<pid>/mem (Linux), zone par
 * zone, par fenêtres de 2 Mio qui se chevauchent de (plus longue aiguille − 1) octets :
 * une aiguille à cheval sur deux fenêtres est donc vue en entier dans l'une d'elles.
 * Impossible d'ouvrir maps/mem (EPERM, EACCES, ENOENT…) → { ok: false, why }.
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
  const regions: Region[] = [];
  for (const line of maps.split("\n")) {
    const m = /^([0-9a-f]+)-([0-9a-f]+) (\S{4})/.exec(line);
    if (!m || m[3]![0] !== "r" || /\[(vvar|vvar_vclock|vsyscall)\]$/.test(line)) continue;
    regions.push({ start: parseInt(m[1]!, 16), end: parseInt(m[2]!, 16), rw: m[3] === "rw-p" });
  }
  try {
    return { ok: true, ...scanRegions(regions, (buf, len, pos) => readSync(fd, buf, 0, len, pos), needles) };
  } finally {
    closeSync(fd);
  }
}

export type Region = { start: number; end: number; rw: boolean };

/** Cœur de la fouille, séparé pour être testé avec une mémoire simulée. */
export function scanRegions(
  regions: Region[],
  read: (buf: Buffer, len: number, pos: number) => number,
  needles: Needle[],
): { hits: string[] } & MemStats {
  const longest = Math.max(1, ...needles.flatMap((n) => n.forms.map((f) => f.length)));
  if (longest > MEM_WINDOW / 2) throw new Error("aiguille trop longue pour la fenêtre");
  const step = MEM_WINDOW - (longest - 1);
  const buf = Buffer.alloc(MEM_WINDOW);
  const hits = new Set<string>();
  const st: MemStats = { regions: 0, bytes: 0, rwRegions: 0, rwBytes: 0, rwFailedBytes: 0, failures: 0 };
  for (const { start, end, rw } of regions) {
    let covered = start; // fin des octets déjà comptés (les fenêtres se chevauchent)
    let readAny = false;
    for (let w = start; w < end; w += step) {
      const len = Math.min(MEM_WINDOW, end - w);
      let got = 0;
      try {
        while (got < len) {
          const n = read(buf.subarray(got), len - got, w + got);
          if (n === 0) break;
          got += n;
        }
      } catch {
        // EIO : pages illisibles ; on garde ce qui a été lu
      }
      if (got < len) st.failures++;
      const fresh = w + len - covered; // octets de cette fenêtre pas encore comptés
      const freshOk = Math.max(0, w + got - covered);
      covered = w + len;
      st.bytes += freshOk;
      if (rw) {
        st.rwBytes += fresh;
        st.rwFailedBytes += fresh - freshOk;
      }
      if (got > 0) {
        readAny = true;
        for (const l of findIn(buf.subarray(0, got), needles)) hits.add(l);
      }
      if (w + len >= end) break;
    }
    if (readAny) {
      st.regions++;
      if (rw) st.rwRegions++;
    }
  }
  return { hits: [...hits], ...st };
}

export type Captured = {
  method: string;
  url: string;
  headers: [string, string][];
  body: Buffer;
  response: Buffer;
  /** Statut et en-têtes de la réponse (« nom: valeur », une ligne chacun). */
  status: number;
  responseHeaders: string;
};

/** Enveloppe fetch : chaque requête (méthode, URL, en-têtes, corps) et le corps de sa réponse sont copiés dans `log`. */
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
    const entry: Captured = { method: init?.method ?? "GET", url, headers, body, response: Buffer.alloc(0), status: 0, responseHeaders: "" };
    log.push(entry);
    const r = await inner(input, init);
    // Copie du corps de la réponse (fouillée elle aussi) ; la réponse rendue reste intacte.
    entry.response = Buffer.from(await r.clone().arrayBuffer());
    entry.status = r.status;
    r.headers.forEach((v, k) => (entry.responseHeaders += `${k}: ${v}\n`));
    return r;
  };
}
