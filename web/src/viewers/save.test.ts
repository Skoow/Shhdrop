// Destinations des téléchargements reçus (UI §9.9, §9.8.6).
import { describe, expect, it, vi } from "vitest";
import { CLICK_GAP_MS, blobDownloads, inDirectory, needsMemoryWarning, pickFile, type DirHandle } from "./save";

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

describe("avertissement mémoire (UI §9.2.5, spec §18.7 ; revue du 10 novembre)", () => {
  const MiB = 1048576;
  const IOS = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15", maxTouchPoints: 5 } as Navigator;
  const DESKTOP = { userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0", maxTouchPoints: 0 } as Navigator;
  it("sans sélecteur de fichier, un fichier de plus de 200 Mio sur un appareil à petite mémoire : prévenir", () => {
    expect(needsMemoryWarning([10 * MiB, 300 * MiB], false, IOS)).toBe(true);
    expect(needsMemoryWarning([200 * MiB], false, IOS)).toBe(false);
    expect(needsMemoryWarning([300 * MiB], false, { ...DESKTOP, deviceMemory: 2 } as Navigator)).toBe(true);
  });
  it("avec sélecteur (écriture en flux), ou sur un appareil qui a la mémoire : rien", () => {
    expect(needsMemoryWarning([1500 * MiB], true, IOS)).toBe(false);
    expect(needsMemoryWarning([1500 * MiB], false, DESKTOP)).toBe(false);
    expect(needsMemoryWarning([], false, IOS)).toBe(false);
  });
});
