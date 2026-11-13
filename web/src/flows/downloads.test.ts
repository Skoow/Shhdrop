// File de téléchargements (UI §9.8.6) : pause, reprise, arrêt, nouvel essai à l'octet près,
// budget de lecture, archive, fermeture « partage disparu ».
import { describe, expect, it, vi } from "vitest";
import { createDownloads, readSkipping, summarize, type DownloadDeps, type ItemSink } from "./downloads.svelte";
import { createReadMeter } from "./read-meter";

const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(f: () => boolean, n = 200) {
  for (let k = 0; k < n && !f(); k++) await tick();
  expect(f()).toBe(true);
}

/** Faux lecteur : l'élément i fait sizes[i] octets, servis en tranches de 10 ; compte les octets lus. */
function fakeReader(sizes: number[]) {
  const served: number[] = sizes.map(() => 0);
  const calls: { i: number; from: number }[] = [];
  let failAt: { i: number; at: number } | null = null;
  let gate: Promise<void> | null = null;
  const saveItem = async (i: number, sink: (c: Uint8Array<ArrayBuffer>) => Promise<void> | void) => {
    for (let p = 0; p < sizes[i]!; p += 10) {
      if (gate) await gate;
      if (failAt && failAt.i === i && p >= failAt.at) {
        failAt = null;
        throw new Error("reseau");
      }
      const c = new Uint8Array(Math.min(10, sizes[i]! - p)).map((_, k) => (p + k) & 0xff);
      served[i]! += c.length;
      await sink(c);
    }
  };
  const read = readSkipping(saveItem);
  return {
    served,
    calls,
    read: ((i, from, on) => {
      calls.push({ i, from });
      return read(i, from, on);
    }) as DownloadDeps["read"],
    failOnce(i: number, at: number) {
      failAt = { i, at };
    },
    hold() {
      let open!: () => void;
      gate = new Promise((r) => (open = r));
      return () => {
        gate = null;
        open();
      };
    },
  };
}

function memSinks() {
  const files = new Map<number, { data: number[]; closed: boolean; aborted: boolean }>();
  const openSink = vi.fn(async (i: number): Promise<ItemSink> => {
    const f = { data: [] as number[], closed: false, aborted: false };
    files.set(i, f);
    return {
      async write(c) {
        f.data.push(...c);
      },
      async close() {
        f.closed = true;
      },
      async abort() {
        f.aborted = true;
        f.data = [];
      },
    };
  });
  return { files, openSink };
}

function setup(sizes: number[]) {
  const r = fakeReader(sizes);
  const s = memSinks();
  let offset = 0;
  const entries = sizes.map((size) => {
    const e = { kind: "file" as const, offset, size };
    offset += size;
    return e;
  });
  const meter = createReadMeter(entries);
  let t = 0;
  const d = createDownloads(sizes, { read: r.read, openSink: s.openSink, meter, now: () => (t += 50) });
  return { d, r, s, meter };
}
const expected = (n: number) => Array.from({ length: n }, (_, k) => k & 0xff);

describe("file de téléchargements", () => {
  it("tout : à la suite, un à la fois, ordre du manifeste ; contenu exact ; puits fermés", async () => {
    const { d, r, s } = setup([30, 25, 40]);
    d.start([2, 0, 1]);
    expect(d.rows.map((x) => x.state)).toEqual(["queued", "queued", "queued"]);
    await until(() => d.rows.every((x) => x.state === "done"));
    expect(r.calls.map((c) => c.i)).toEqual([0, 1, 2]);
    for (const [i, n] of [[0, 30], [1, 25], [2, 40]] as const) {
      expect(s.files.get(i)!.data).toEqual(expected(n));
      expect(s.files.get(i)!.closed).toBe(true);
    }
    expect(summarize(d.rows, [0, 1, 2])).toMatchObject({ total: 95, done: 95, active: 0 });
  });

  it("débit mesuré : null tant que moins de 2 s de lecture (jamais d'estimation sur un débit supposé, retours UI4)", async () => {
    const small = setup([30, 25]);
    expect(small.d.measured).toBeNull();
    small.d.start([0, 1]);
    await until(() => small.d.rows.every((x) => x.state === "done"));
    expect(small.d.measured).toBeNull(); // 55 octets lus en moins de 2 s : pas assez pour estimer
    const big = setup([1000]);
    big.d.start([0]);
    await until(() => big.d.rows[0]!.state === "done");
    expect(big.d.measured).toBeGreaterThan(0); // plus de 2 s de lecture : débit de cette session
  });

  it("pause puis reprise : aucune relecture, reprise à l'octet exact, les suivants attendent", async () => {
    const { d, r, s } = setup([100, 20]);
    const release = r.hold();
    d.start([0, 1]);
    await until(() => d.rows[0]!.state === "downloading");
    d.pause([0]);
    release();
    await tick();
    await tick();
    expect(d.rows[0]!.state).toBe("paused");
    const before = r.served[0]!;
    expect(before).toBeLessThan(100);
    for (let k = 0; k < 10; k++) await tick();
    expect(r.served[0]).toBe(before); // rien n'est lu pendant la pause
    expect(d.rows[1]!.state).toBe("queued");
    d.resume([0]);
    await until(() => d.rows.every((x) => x.state === "done"));
    expect(r.served[0]).toBe(100); // lu une seule fois
    expect(r.calls.filter((c) => c.i === 0)).toHaveLength(1);
    expect(s.files.get(0)!.data).toEqual(expected(100));
  });

  it("pause d'un élément en attente : sauté ; repris, il revient dans la file", async () => {
    const { d } = setup([20, 20]);
    d.start([0, 1]);
    d.pause([1]);
    await until(() => d.rows[0]!.state === "done");
    for (let k = 0; k < 5; k++) await tick();
    expect(d.rows[1]!.state).toBe("paused");
    d.resume([1]);
    await until(() => d.rows[1]!.state === "done");
  });

  it("arrêt pendant la lecture : partiel supprimé (abort), ligne revenue au départ, la suite continue", async () => {
    const { d, r, s } = setup([100, 20]);
    const release = r.hold();
    d.start([0, 1]);
    await until(() => d.rows[0]!.state === "downloading");
    d.stop([0]);
    release();
    await until(() => d.rows[1]!.state === "done");
    expect(d.rows[0]!.state).toBe("idle");
    expect(s.files.get(0)!.aborted).toBe(true);
    expect(s.files.get(0)!.closed).toBe(false);
  });

  it("arrêt en pause et arrêt d'un élément en attente", async () => {
    const { d, r, s } = setup([100, 20, 20]);
    const release = r.hold();
    d.start([0, 1, 2]);
    await until(() => d.rows[0]!.state === "downloading");
    d.pause([0]);
    release();
    await tick();
    d.stop([0, 1]);
    await until(() => d.rows[2]!.state === "done");
    expect(d.rows[0]!.state).toBe("idle");
    expect(d.rows[1]!.state).toBe("idle");
    expect(s.files.get(0)!.aborted).toBe(true);
    expect(s.files.has(1)).toBe(false); // jamais commencé : aucun fichier créé
  });

  it("coupure : partiel gardé, nouvel essai repris à l'octet écrit, fichier final exact", async () => {
    const { d, r, s } = setup([100]);
    r.failOnce(0, 60);
    d.start([0]);
    await until(() => d.rows[0]!.state === "failed");
    expect(d.rows[0]).toMatchObject({ reason: "network", retryable: true, done: 60 });
    expect(s.files.get(0)!.aborted).toBe(false);
    d.retry(0);
    await until(() => d.rows[0]!.state === "done");
    expect(r.calls).toEqual([{ i: 0, from: 0 }, { i: 0, from: 60 }]);
    expect(s.openSink).toHaveBeenCalledTimes(1); // même fichier partiel
    expect(s.files.get(0)!.data).toEqual(expected(100));
  });

  it("budget de lecture épuisé : plus de nouvel essai, rien n'est relu", async () => {
    const { d, r, meter } = setup([100]);
    // Consomme le budget estimé jusqu'au refus.
    while (meter.canRead(0)) {
      meter.charge(0);
      meter.interrupted();
    }
    d.start([0]);
    await until(() => d.rows[0]!.state === "failed");
    expect(d.rows[0]).toMatchObject({ reason: "budget", retryable: false });
    expect(r.calls).toHaveLength(0);
  });

  it("refus du serveur (ReadBudgetError) : échec définitif, partiel supprimé", async () => {
    const s = memSinks();
    const meter = createReadMeter([{ kind: "file", offset: 0, size: 10 }]);
    const err = Object.assign(new Error("budget_epuise"), { name: "ReadBudgetError" });
    const d = createDownloads([10], { read: async () => Promise.reject(err), openSink: s.openSink, meter, now: () => 0 });
    d.start([0]);
    await until(() => d.rows[0]!.state === "failed");
    expect(d.rows[0]).toMatchObject({ reason: "budget", retryable: false });
    expect(s.files.get(0)!.aborted).toBe(true);
  });

  it("sélecteur fermé : retour silencieux à l'état de départ", async () => {
    const r = fakeReader([10]);
    const meter = createReadMeter([{ kind: "file", offset: 0, size: 10 }]);
    const d = createDownloads([10], { read: r.read, openSink: async () => null, meter, now: () => 0 });
    d.start([0]);
    await until(() => d.rows[0]!.state === "idle");
    expect(r.calls).toHaveLength(0);
  });

  it("partage disparu : la lecture en cours finit ; l'attente et la pause sont arrêtées ; plus rien ne commence", async () => {
    const { d, r, s } = setup([60, 20, 20]);
    const release = r.hold();
    d.start([0, 1]);
    await until(() => d.rows[0]!.state === "downloading");
    d.close();
    d.start([2]);
    release();
    await until(() => d.rows[0]!.state === "done");
    expect(d.rows[1]).toMatchObject({ state: "failed", reason: "gone" });
    expect(d.rows[2]!.state).toBe("idle");
    expect(s.files.get(0)!.closed).toBe(true);
    expect(s.files.has(2)).toBe(false);
  });

  it("archive : tous les éléments passent par le même lecteur ; pause sans relecture ; arrêt → abort", async () => {
    const { d, r } = setup([30, 30]);
    const got: number[] = [];
    const aborted = vi.fn(async () => undefined);
    const release = r.hold();
    d.startZip({
      total: 60,
      abort: aborted,
      run: async (pipe) => {
        for (const i of [0, 1]) await pipe(i, async (c) => void got.push(...c));
      },
    });
    await until(() => d.zip?.state === "downloading");
    d.pauseZip();
    release();
    for (let k = 0; k < 5; k++) await tick();
    expect(d.zip!.state).toBe("paused");
    const before = r.served[0]! + r.served[1]!;
    for (let k = 0; k < 5; k++) await tick();
    expect(r.served[0]! + r.served[1]!).toBe(before);
    d.resumeZip();
    await until(() => d.zip?.state === "done");
    expect(got).toEqual([...expected(30), ...expected(30)]);
    expect(aborted).not.toHaveBeenCalled();

    const r2 = setup([100]);
    const ab = vi.fn(async () => undefined);
    const rel = r2.r.hold();
    r2.d.startZip({ total: 100, abort: ab, run: async (pipe) => pipe(0, async () => undefined) });
    await until(() => r2.d.zip?.state === "downloading");
    r2.d.stopZip();
    rel();
    await until(() => r2.d.zip?.state === "idle");
    expect(ab).toHaveBeenCalledTimes(1);
  });

  it("readSkipping jette exactement le début et met les tranches jetées à zéro", async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6]), new Uint8Array([7])];
    const read = readSkipping(async (_i, sink) => {
      for (const c of chunks) await sink(c);
    });
    const out: number[] = [];
    await read(0, 4, async (c) => void out.push(...c));
    expect(out).toEqual([5, 6, 7]);
    expect([...chunks[0]!]).toEqual([0, 0, 0]);
  });
});

describe("audit M3 : « Enregistrer sous » en file", () => {
  it("sélecteur refusé faute de clic récent (SecurityError, NotAllowedError) : raison « activation », nouvel essai possible", async () => {
    const { classify } = await import("./downloads.svelte");
    for (const n of ["SecurityError", "NotAllowedError"]) {
      expect(classify(new DOMException("x", n))).toEqual({ reason: "activation", retryable: true, keepPartial: false });
    }
  });
  it("audit web D3 : CorruptError → raison « corrupt », sans nouvel essai, partiel supprimé", async () => {
    const { classify } = await import("./downloads.svelte");
    const { CorruptError } = await import("../index");
    expect(classify(new CorruptError())).toEqual({ reason: "corrupt", retryable: false, keepPartial: false });
  });
  it("canStart : vrai seulement si un appui lancerait vraiment l'élément (sélecteur ouvert au clic sinon inutile)", async () => {
    const r = fakeReader([30, 30]);
    const release = r.hold();
    const dl = createDownloads([30, 30], { read: r.read, openSink: memSinks().openSink, meter: createReadMeter([{ kind: "file", offset: 0, size: 30 }, { kind: "file", offset: 30, size: 30 }]), now: () => 0 });
    expect(dl.canStart(0)).toBe(true);
    dl.start([0]);
    await tick();
    expect(dl.canStart(0)).toBe(false); // en cours
    expect(dl.canStart(1)).toBe(true);
    release();
    await until(() => dl.rows[0]!.state === "done");
    expect(dl.canStart(0)).toBe(true); // enregistrer à nouveau
  });
});
