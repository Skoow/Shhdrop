// Destinations des téléchargements reçus (UI §9.9, §9.8.6).
import { describe, expect, it, vi } from "vitest";
import { CLICK_GAP_MS, blobDownloads, inDirectory, pickFile, type DirHandle } from "./save";

function writable() {
  const w = { data: [] as number[], closed: 0, aborted: 0 };
  return {
    w,
    impl: {
      async write(c: Uint8Array<ArrayBuffer>) {
        w.data.push(...c);
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

describe("pickFile", () => {
  it("nom proposé = nom nettoyé ; sélecteur fermé → null ; autre erreur remontée", async () => {
    const { impl } = writable();
    const picker = vi.fn(async () => ({ createWritable: async () => impl }));
    expect(await pickFile(picker, "facture.pdf")).not.toBeNull();
    expect(picker).toHaveBeenCalledWith({ suggestedName: "facture.pdf" });
    expect(await pickFile(async () => Promise.reject(new DOMException("x", "AbortError")), "a")).toBeNull();
    await expect(pickFile(async () => Promise.reject(new DOMException("x", "SecurityError")), "a")).rejects.toThrow();
  });
});

describe("inDirectory", () => {
  it("un seul dossier, aucun écrasement : un nom déjà présent reçoit « (2) », deux noms égaux aussi", async () => {
    const existing = new Set(["photo.jpg"]);
    const created: string[] = [];
    const dir: DirHandle = {
      async getFileHandle(n, o) {
        if (o?.create) {
          created.push(n);
          existing.add(n);
          return { createWritable: async () => writable().impl };
        }
        if (existing.has(n)) return { createWritable: async () => writable().impl };
        throw new DOMException("absent", "NotFoundError");
      },
    };
    const put = inDirectory(dir);
    await put("photo.jpg");
    await put("photo.jpg");
    await put("../note.txt");
    expect(created).toEqual(["photo (2).jpg", "photo (3).jpg", "note.txt"]);
  });
});

describe("blobDownloads", () => {
  it("Blob application/octet-stream ; 1 s entre deux déclenchements ; abort() ne déclenche rien", async () => {
    let t = 0;
    const clicks: { name: string; at: number; type: string; size: number }[] = [];
    const urls = new Map<string, Blob>();
    const create = vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      const u = `blob:x/${urls.size}`;
      urls.set(u, b as Blob);
      return u;
    });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const sleep = vi.fn(async (ms: number) => void (t += ms));
    const mk = blobDownloads({ click: (u, name) => clicks.push({ name, at: t, type: urls.get(u)!.type, size: urls.get(u)!.size }), now: () => t, sleep }, 4);
    for (const n of ["a.bin", "b.bin"]) {
      const s = mk(n);
      await s.write(new Uint8Array([1, 2, 3]));
      await s.write(new Uint8Array([4, 5]));
      await s.close();
    }
    const c = mk("c.bin");
    await c.write(new Uint8Array([9]));
    await c.abort();
    expect(clicks).toEqual([
      { name: "a.bin", at: 0, type: "application/octet-stream", size: 5 },
      { name: "b.bin", at: CLICK_GAP_MS, type: "application/octet-stream", size: 5 },
    ]);
    create.mockRestore();
    revoke.mockRestore();
  });
});
