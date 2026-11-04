// Témoins des outils de fouille : fenêtres qui se chevauchent, comptage des échecs,
// lecture réelle de la mémoire d'un processus.
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { MEM_WINDOW, needle, scanProcessMemory, scanRegions } from "./scan";

const W = MEM_WINDOW;

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
