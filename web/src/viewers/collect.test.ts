import { describe, expect, it } from "vitest";
import type { Opened, PreviewKind } from "../index";
import { collectPreview, previewQueue } from "./collect";

function fake(chunks: number[][], kind: PreviewKind = "image", mime = "image/png", fail?: Error) {
  const given: Uint8Array<ArrayBuffer>[] = [];
  const o = {
    manifest: { v: 2, rights: "enregistrer", items: [{ kind: "file", name: "a.png", mime, size: chunks.flat().length, offset: 0 }] },
    previewKind: () => kind,
    async saveItem(_i: number, sink: (c: Uint8Array<ArrayBuffer>) => void | Promise<void>) {
      for (const c of chunks) {
        const u = new Uint8Array(c);
        given.push(u);
        await sink(u);
      }
      if (fail) throw fail;
    },
  } as unknown as Opened;
  return { o, given };
}

describe("collectPreview", () => {
  it("octets cumulés, Blob du type sûr, tranches mises à zéro", async () => {
    const { o, given } = fake([[1, 2], [3, 4, 5]]);
    const seen: [number, number][] = [];
    const b = await collectPreview(o, 0, (d, t) => seen.push([d, t]));
    expect(seen).toEqual([[2, 5], [5, 5]]);
    expect(b.type).toBe("image/png");
    expect([...new Uint8Array(await b.arrayBuffer())]).toEqual([1, 2, 3, 4, 5]);
    expect(given.every((u) => u.every((x) => x === 0))).toBe(true);
  });
  it("type hors liste (HTML déclaré image) → type_refuse, aucune lecture", async () => {
    const { o, given } = fake([[1]], "image", "text/html");
    await expect(collectPreview(o, 0, () => undefined)).rejects.toThrow("type_refuse");
    expect(given).toHaveLength(0);
  });
  it("signal : AbortError, tranches lues mises à zéro", async () => {
    const ac = new AbortController();
    const { o, given } = fake([[7, 7], [8, 8]], "video", "video/mp4");
    const p = collectPreview(o, 0, () => ac.abort(), ac.signal);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(given[0]!.every((x) => x === 0)).toBe(true);
  });
  it("erreur de lecture : relayée, tranches mises à zéro", async () => {
    const { o, given } = fake([[9]], "audio", "audio/ogg", new Error("reseau"));
    await expect(collectPreview(o, 0, () => undefined)).rejects.toThrow("reseau");
    expect(given[0]![0]).toBe(0);
  });
});

describe("previewQueue", () => {
  it("sérialise deux demandes, même après un échec", async () => {
    const q = previewQueue();
    const log: string[] = [];
    let release!: () => void;
    const a = q(async () => {
      log.push("a+");
      await new Promise<void>((r) => (release = r));
      log.push("a-");
      throw new Error("x");
    });
    const b = q(async () => {
      log.push("b");
      return 2;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(["a+"]);
    release();
    await expect(a).rejects.toThrow("x");
    expect(await b).toBe(2);
    expect(log).toEqual(["a+", "a-", "b"]);
  });
});
