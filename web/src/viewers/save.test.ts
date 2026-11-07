import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Opened } from "../index";
import { REVOKE_AFTER_MS, saveItemTo, type SaveDeps } from "./save";

const NAME = "facture.pdf";

function fakeOpened(chunks: number[][], fail?: unknown) {
  return {
    manifest: { v: 2, rights: "enregistrer", items: [{ kind: "file", name: "../RAW‮fdp.exe", mime: "text/html", size: chunks.flat().length, offset: 0 }] },
    safeName: () => NAME,
    async saveItem(_i: number, sink: (c: Uint8Array<ArrayBuffer>) => void | Promise<void>) {
      for (const c of chunks) await sink(new Uint8Array(c));
      if (fail) throw fail;
    },
  } as unknown as Opened;
}

function writable() {
  const w = { written: [] as number[], closed: 0, aborted: 0, failWrite: null as unknown };
  return {
    w,
    impl: {
      async write(c: Uint8Array<ArrayBuffer>) {
        if (w.failWrite) throw w.failWrite;
        w.written.push(...c);
      },
      async close() {
        w.closed++;
      },
      async abort() {
        w.aborted++;
      },
    },
  };
}

const deps = (over: Partial<SaveDeps> = {}): SaveDeps => ({
  collectToBlob: vi.fn(),
  click: vi.fn(),
  now: () => 0,
  ...over,
});

describe("saveItemTo, sélecteur de fichier", () => {
  it("suggestedName = safeName(i), écriture, close(), saved", async () => {
    const { w, impl } = writable();
    const picker = vi.fn(async () => ({ createWritable: async () => impl }));
    const seen: number[] = [];
    const r = await saveItemTo(fakeOpened([[1, 2], [3]]), 0, deps({ showSaveFilePicker: picker }), (d) => seen.push(d));
    expect(r).toBe("saved");
    expect(picker).toHaveBeenCalledWith({ suggestedName: NAME });
    expect(w.written).toEqual([1, 2, 3]);
    expect([w.closed, w.aborted]).toEqual([1, 0]);
    expect(seen).toEqual([2, 3]);
  });
  it("erreur de saveItem → abort(), jamais close(), failed", async () => {
    const { w, impl } = writable();
    const r = await saveItemTo(fakeOpened([[1]], new Error("reseau")), 0, deps({ showSaveFilePicker: async () => ({ createWritable: async () => impl }) }), () => undefined);
    expect(r).toBe("failed");
    expect([w.closed, w.aborted]).toEqual([0, 1]);
  });
  it("signal → abort(), cancelled", async () => {
    const { w, impl } = writable();
    const ac = new AbortController();
    const r = await saveItemTo(fakeOpened([[1], [2], [3]]), 0, deps({ showSaveFilePicker: async () => ({ createWritable: async () => impl }) }), () => ac.abort(), ac.signal);
    expect(r).toBe("cancelled");
    expect([w.closed, w.aborted]).toEqual([0, 1]);
    expect(w.written).toEqual([1]);
  });
  it("AbortError du sélecteur → cancelled sans écriture", async () => {
    const o = fakeOpened([[1]]);
    const spy = vi.spyOn(o, "saveItem");
    const r = await saveItemTo(o, 0, deps({ showSaveFilePicker: async () => Promise.reject(new DOMException("x", "AbortError")) }), () => undefined);
    expect(r).toBe("cancelled");
    expect(spy).not.toHaveBeenCalled();
  });
  it("QuotaExceededError → abort(), disk_full", async () => {
    const { w, impl } = writable();
    w.failWrite = new DOMException("plein", "QuotaExceededError");
    const r = await saveItemTo(fakeOpened([[1]]), 0, deps({ showSaveFilePicker: async () => ({ createWritable: async () => impl }) }), () => undefined);
    expect(r).toBe("disk_full");
    expect([w.closed, w.aborted]).toEqual([0, 1]);
  });
});

describe("saveItemTo, repli Blob", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it("collectToBlob puis <a download> = safeName(i), octet-stream, URL révoquée à 60 s", async () => {
    let made: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => ((made = b as Blob), "blob:x/1"));
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi.fn();
    const collectToBlob = vi.fn(async (o: Opened, i: number) => {
      const parts: Uint8Array<ArrayBuffer>[] = [];
      await o.saveItem(i, (c) => void parts.push(c));
      return new Blob(parts, { type: "application/octet-stream" });
    });
    const seen: number[] = [];
    const r = await saveItemTo(fakeOpened([[4], [5, 6]]), 0, deps({ collectToBlob, click }), (d) => seen.push(d));
    expect(r).toBe("saved");
    expect(click).toHaveBeenCalledWith("blob:x/1", NAME);
    expect(made?.type).toBe("application/octet-stream");
    expect(seen).toEqual([1, 3]);
    vi.advanceTimersByTime(REVOKE_AFTER_MS - 1);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith("blob:x/1");
  });
  it("signal pendant l'assemblage : cancelled, aucun lien déclenché", async () => {
    const ac = new AbortController();
    const click = vi.fn();
    const collectToBlob = async (o: Opened, i: number) => {
      await o.saveItem(i, () => undefined);
      return new Blob([]);
    };
    const r = await saveItemTo(fakeOpened([[1], [2]]), 0, deps({ collectToBlob, click }), () => ac.abort(), ac.signal);
    expect(r).toBe("cancelled");
    expect(click).not.toHaveBeenCalled();
  });
  it("échec de lecture : failed, aucun lien", async () => {
    const click = vi.fn();
    const r = await saveItemTo(fakeOpened([[1]]), 0, deps({ collectToBlob: async () => Promise.reject(new Error("reseau")), click }), () => undefined);
    expect(r).toBe("failed");
    expect(click).not.toHaveBeenCalled();
  });
});

describe("save.ts n'utilise jamais le MIME du manifeste", () => {
  it("aucune lecture de .mime dans le code", () => {
    const src = readFileSync(new URL("./save.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\.mime\b/);
    expect(src).not.toMatch(/previewKind/);
  });
});
