// Témoins des outils de fouille : fenêtres qui se chevauchent, comptage des échecs,
// lecture réelle de la mémoire d'un processus.
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { MEM_WINDOW, findIn, needle, scanProcessMemory, scanRegions } from "./scan";

const W = MEM_WINDOW;

// Relecture C-2 Task 17 : chaque forme d'une aiguille est trouvée dans une meule qui ne
// contient qu'elle (brut, base64url, base64, hex minuscules et majuscules ; texte : UTF-16LE
// et UTF-16BE).
describe("needle : formes cherchées", () => {
  const octets = new Uint8Array(Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 255));
  const texte = "RepereFormesZq7";
  const dans = (hay: Buffer, n: ReturnType<typeof needle>) => findIn(Buffer.concat([Buffer.from("xx"), hay, Buffer.from("yy")]), [n]);
  const cas: [string, Uint8Array | string, Buffer][] = [
    ["brut", octets, Buffer.from(octets)],
    ["base64url", octets, Buffer.from(Buffer.from(octets).toString("base64url"))],
    ["base64", octets, Buffer.from(Buffer.from(octets).toString("base64"))],
    ["hex minuscules", octets, Buffer.from(Buffer.from(octets).toString("hex"))],
    ["hex majuscules", octets, Buffer.from(Buffer.from(octets).toString("hex").toUpperCase())],
    ["texte brut", texte, Buffer.from(texte)],
    ["texte hex minuscules", texte, Buffer.from(Buffer.from(texte).toString("hex"))],
    ["texte hex majuscules", texte, Buffer.from(Buffer.from(texte).toString("hex").toUpperCase())],
    ["texte UTF-16LE", texte, Buffer.from(texte, "utf16le")],
    ["texte UTF-16BE", texte, Buffer.from(texte, "utf16le").swap16()],
  ];
  for (const [nom, repere, forme] of cas) {
    it(nom, () => {
      const n = needle(nom, typeof repere === "string" ? repere : (repere as Uint8Array<ArrayBuffer>));
      expect(dans(forme, n)).toEqual([nom]);
      // Contre-épreuve : une forme abîmée (premier octet changé) n'est pas trouvée.
      const abimee = Buffer.from(forme);
      abimee[0] = abimee[0]! ^ 0x55;
      if (nom !== "base64url" && nom !== "base64") expect(dans(abimee, n)).toEqual([]);
    });
  }
  it("UTF-16 seulement pour un repère texte", () => {
    const n = needle("o", octets as Uint8Array<ArrayBuffer>);
    const le = Buffer.alloc(64);
    for (let i = 0; i < 32; i++) le[2 * i] = octets[i]!;
    expect(n.forms.some((f) => f.equals(le))).toBe(false);
  });
});

describe("scanRegions (mémoire simulée)", () => {
  const mark = "REPERE-fenetre-a1b2c3";
  const n = needle("repère", mark);
  const longest = Math.max(...n.forms.map((f) => f.length));
  const fromMem = (mem: Buffer, fail?: (pos: number) => boolean) => (buf: Buffer, len: number, pos: number) => {
    if (fail?.(pos)) throw Object.assign(new Error("EIO"), { code: "EIO" });
    return mem.copy(buf, 0, pos, Math.min(pos + len, mem.length));
  };

  it("aiguille à cheval sur la frontière de deux fenêtres : trouvée", () => {
    for (const at of [W - 3, W - longest + 1, W - 1, 2 * W - longest - 5]) {
      const mem = Buffer.alloc(3 * W, 0x41);
      mem.write(mark, at);
      const r = scanRegions([{ start: 0, end: mem.length, rw: true }], fromMem(mem), [n]);
      expect(r.hits, `position ${at}`).toEqual(["repère"]);
      expect(r).toMatchObject({ regions: 1, rwRegions: 1, bytes: 3 * W, rwBytes: 3 * W, rwFailedBytes: 0, failures: 0 });
    }
  });

  it("échecs de lecture comptés (octets distincts), zones non rw-p à part", () => {
    const mem = Buffer.alloc(4 * W, 0x41);
    // Zone rw-p de 4 W dont tout ce qui est après 2 W est illisible ; zone r--p lisible.
    const r = scanRegions(
      [
        { start: 0, end: 4 * W, rw: true },
        { start: 0, end: W, rw: false },
      ],
      fromMem(mem, (pos) => pos >= 2 * W && pos < 4 * W),
      [n],
    );
    expect(r.rwBytes).toBe(4 * W);
    expect(r.rwFailedBytes).toBeGreaterThan(0);
    expect(r.rwFailedBytes).toBeLessThanOrEqual(2 * W);
    expect(r.failures).toBeGreaterThan(0);
    expect(r.regions).toBe(2);
    expect(r.rwRegions).toBe(1);
  });

  it("zone rw-p entièrement illisible : non comptée comme lue", () => {
    const r = scanRegions([{ start: 0, end: W, rw: true }], () => {
      throw new Error("EIO");
    }, [n]);
    expect(r).toMatchObject({ rwRegions: 0, rwBytes: W, rwFailedBytes: W, bytes: 0 });
  });
});

describe("scanProcessMemory (processus réel)", () => {
  it("retrouve un repère gardé en mémoire par un processus enfant", async () => {
    // Le repère est assemblé à l'exécution : il n'apparaît pas tel quel dans les arguments.
    const code = `const m = Buffer.from(["REP", "ERE-", "vivant-", "d4e5f6"].join(""));
      process.stdout.write("pret\\n"); setInterval(() => m[0], 1000);`;
    const child = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "inherit"] });
    try {
      await new Promise<void>((r) => child.stdout.once("data", () => r()));
      const res = scanProcessMemory(child.pid!, [needle("repère", "REPERE-vivant-d4e5f6"), needle("absent", "jamais-present-9z9z9z")]);
      if (!res.ok) {
        if (process.env.CI) throw new Error(res.why);
        console.warn(`fouille mémoire impossible ici : ${res.why}`);
        return;
      }
      expect(res.hits).toEqual(["repère"]);
      expect(res.rwRegions).toBeGreaterThan(0);
      expect(res.rwFailedBytes).toBeLessThanOrEqual(res.rwBytes / 2);
    } finally {
      child.kill("SIGKILL");
    }
  });
});
