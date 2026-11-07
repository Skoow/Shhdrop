// Écrivain .zip « stocké » (spec §41.6) : vecteur CRC-32, relecture par les outils du système
// (python3 -m zipfile, unzip -t ; sauts dits s'ils manquent), noms hostiles et doublons,
// ZIP64 (petit seuil relu par les outils ; vraie entrée de 5 Gio sur un flux creux), abandon.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, openSync, closeSync, writeSync, ftruncateSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { crc32 } from "./crc32";
import { createZip, zipName, type ZipSink } from "./store-zip";

const dir = mkdtempSync(join(tmpdir(), "shh-zip-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const has = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const PY = has("python3", ["-I", "-c", "import zipfile"]);
const UNZIP = has("unzip", ["-v"]);

function memSink() {
  const parts: Uint8Array[] = [];
  const s = { closed: false, aborted: false, maxWrite: 0 };
  const sink: ZipSink = {
    async write(c) {
      s.maxWrite = Math.max(s.maxWrite, c.length);
      parts.push(c.slice());
    },
    async close() {
      s.closed = true;
    },
    async abort() {
      s.aborted = true;
    },
  };
  const bytes = () => {
    const n = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  return { sink, s, bytes };
}

async function* chunks(b: Uint8Array, size = 7000) {
  for (let i = 0; i < b.length; i += size) yield b.subarray(i, i + size);
}

// Relecture Python : noms, tailles, dates, SHA-256 du contenu, et testzip().
const PY_READ = `
import sys, zipfile, hashlib, json
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
out = []
for i in z.infolist():
    out.append({"name": i.filename, "size": i.file_size, "date": list(i.date_time), "flag": i.flag_bits,
                "extra_len": len(i.extra), "comment": i.comment.decode(), "attr": i.external_attr,
                "sha": hashlib.sha256(z.read(i)).hexdigest()})
print(json.dumps(out))
`;

const sha = (b: Uint8Array) => execFileSync("python3", ["-I", "-c", "import sys,hashlib;print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())"], { input: b }).toString().trim();

describe("crc32", () => {
  it("vecteur standard « 123456789 » → 0xCBF43926, et reprise depuis une graine", () => {
    const b = new TextEncoder().encode("123456789");
    expect(crc32(b)).toBe(0xcbf43926);
    expect(crc32(b.subarray(5), crc32(b.subarray(0, 5)))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
  it("identique à zlib.crc32 sur 1 Mio pseudo-aléatoire", () => {
    const b = new Uint8Array(1048576 + 13);
    let x = 7;
    for (let i = 0; i < b.length; i++) b[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24;
    if (!PY) return;
    const ref = Number(execFileSync("python3", ["-I", "-c", "import sys,zlib;print(zlib.crc32(sys.stdin.buffer.read()))"], { input: b }).toString());
    expect(crc32(b)).toBe(ref);
  });
});

describe("zipName", () => {
  it("noms hostiles → nom sûr sans séparateur ni lettre de lecteur", () => {
    const taken = new Set<string>();
    const hostile = ["../../etc/passwd", "C:\\x", "a/b", "CON.txt", ".", "", "x".repeat(300) + ".pdf", "con.tar.gz", "nul", 'a<b>:"c|?*.txt', "..\\..\\win.ini"];
    const got = hostile.map((h) => zipName(h, taken));
    for (const g of got) {
      expect(g).not.toMatch(/[/\\:*?"<>|\u0000-\u001f]/u);
      expect(g).not.toMatch(/^\.|\.$|^\s|\s$/u);
      expect(g.length).toBeGreaterThan(0);
      expect([...g].length).toBeLessThanOrEqual(130);
    }
    expect(got[0]).toBe("etcpasswd");
    expect(got[2]).toBe("ab");
    expect(got[10]).toBe("win.ini");
    expect(got[1]).toBe("C_x");
    expect(got[3]).toBe("CON_.txt");
    expect(got[4]).toBe("fichier");
    expect(got[5]).toBe("fichier (2)");
    expect(got[6]!.endsWith(".pdf")).toBe(true);
    expect(got[7]).toBe("con_.tar.gz");
    expect(got[8]).toBe("nul_");
  });
  it("doublons sans casse → « (2) », « (3) », extension gardée", () => {
    const taken = new Set<string>();
    expect(["photo.jpg", "photo.jpg", "Photo.JPG", "note"].map((n) => zipName(n, taken))).toEqual(["photo.jpg", "photo (2).jpg", "Photo (3).JPG", "note"]);
  });
});

describe("createZip", () => {
  it("3 entrées (accents, émoji, vide) : relue octet par octet, date 1980-01-01, aucune métadonnée", async () => {
    const m = memSink();
    const z = createZip(m.sink);
    const a = new TextEncoder().encode("Bonjour 🌍 — été\n".repeat(1000));
    const b = new Uint8Array(150_000).map((_, i) => (i * 31) & 0xff);
    const files: [string, Uint8Array][] = [["éte\u0301 à la mer 🌊.txt", a], ["données.bin", b], ["vide.txt", new Uint8Array(0)]];
    for (const [n, d] of files) await z.add(n, d.length, chunks(d));
    await z.finish();
    expect(m.s.closed).toBe(true);
    expect(m.s.aborted).toBe(false);
    const p = join(dir, "three.zip");
    writeFileSync(p, m.bytes());
    if (UNZIP) expect(spawnSync("unzip", ["-tq", p]).status).toBe(0);
    if (!PY) return;
    const info = JSON.parse(execFileSync("python3", ["-I", "-c", PY_READ, p]).toString()) as { name: string; size: number; date: number[]; flag: number; extra_len: number; comment: string; attr: number; sha: string }[];
    expect(info.map((i) => i.name)).toEqual(files.map((f) => f[0]));
    info.forEach((i, k) => {
      expect(i.size).toBe(files[k]![1].length);
      expect(i.date).toEqual([1980, 1, 1, 0, 0, 0]);
      expect(i.flag & 0x0800).toBe(0x0800);
      expect(i.extra_len).toBe(0);
      expect(i.comment).toBe("");
      expect(i.attr).toBe(0);
      expect(i.sha).toBe(sha(files[k]![1]));
    });
  });

  it("ZIP64 (seuil abaissé) : relu par python3 -m zipfile et unzip -t", async () => {
    const m = memSink();
    const z = createZip(m.sink, { zip64At: 1000 });
    const d = new Uint8Array(5000).map((_, i) => i & 0xff);
    await z.add("grand.bin", d.length, chunks(d, 999));
    await z.add("petit.txt", 3, chunks(new TextEncoder().encode("abc")));
    await z.finish();
    const p = join(dir, "z64.zip");
    writeFileSync(p, m.bytes());
    if (UNZIP) expect(spawnSync("unzip", ["-tq", p]).status).toBe(0);
    if (!PY) return;
    expect(spawnSync("python3", ["-I", "-m", "zipfile", "-t", p]).status).toBe(0);
    const info = JSON.parse(execFileSync("python3", ["-I", "-c", PY_READ, p]).toString()) as { name: string; sha: string }[];
    expect(info.map((i) => i.name)).toEqual(["grand.bin", "petit.txt"]);
    expect(info[0]!.sha).toBe(sha(d));
  });

  it("entrée de 5 Gio sur un flux creux : en-têtes ZIP64 justes (python3), mémoire bornée", async () => {
    const SIZE = 5 * 1073741824;
    const CH = 8 * 1048576;
    const zero = new Uint8Array(CH);
    // Puits creux : seuls les en-têtes sont écrits dans le fichier ; les données restent des trous.
    const p = join(dir, "huge.zip");
    const fd = openSync(p, "w");
    let pos = 0;
    let maxWrite = 0;
    const sink: ZipSink = {
      async write(c) {
        maxWrite = Math.max(maxWrite, c.length);
        if (c !== zero) writeSync(fd, c, 0, c.length, pos);
        pos += c.length;
      },
      async close() {
        ftruncateSync(fd, pos);
        closeSync(fd);
      },
      async abort() {
        closeSync(fd);
      },
    };
    let reads = 0;
    async function* src() {
      for (let left = SIZE; left > 0; left -= CH) {
        reads++;
        yield left >= CH ? zero : zero.subarray(0, left);
      }
    }
    const z = createZip(sink);
    await z.add("disque.img", SIZE, src());
    await z.finish();
    expect(reads).toBe(SIZE / CH); // aucune lecture de plus
    expect(maxWrite).toBeLessThanOrEqual(CH); // jamais plus de 8 Mio en attente
    if (!PY) return;
    const r = execFileSync("python3", ["-I", "-c", "import sys,zipfile;i=zipfile.ZipFile(sys.argv[1]).infolist()[0];print(i.filename,i.file_size,i.compress_size,i.header_offset)", p]).toString().trim();
    expect(r).toBe(`disque.img ${SIZE} ${SIZE} 0`);
  }, 120_000);

  it("erreur de la source → abort() du puits, jamais close() ; plus rien n'est accepté", async () => {
    const m = memSink();
    const z = createZip(m.sink);
    async function* bad() {
      yield new Uint8Array(10);
      throw new Error("reseau");
    }
    await expect(z.add("a.bin", 20, bad())).rejects.toThrow("reseau");
    expect(m.s.aborted).toBe(true);
    expect(m.s.closed).toBe(false);
    await expect(z.finish()).rejects.toThrow();
  });

  it("taille annoncée fausse → abort(), et abort() explicite ne ferme jamais", async () => {
    const m = memSink();
    const z = createZip(m.sink);
    await expect(z.add("a", 5, chunks(new Uint8Array(4)))).rejects.toThrow("taille_incoherente");
    expect(m.s.aborted).toBe(true);
    const m2 = memSink();
    const z2 = createZip(m2.sink);
    await z2.add("a", 1, chunks(new Uint8Array(1)));
    await z2.abort();
    expect(m2.s.aborted).toBe(true);
    expect(m2.s.closed).toBe(false);
  });
});
