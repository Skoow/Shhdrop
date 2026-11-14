// Historique des téléchargements (conception compte §21.9, §21.15.5 ; R12) : sur cet appareil
// seulement, chiffré au repos (clé non extractible), champs exacts (jamais lien, clé, mot de
// passe ni contenu), entrées retirées après 30 jours, réglage coupé → rien d'écrit, « Effacer
// tout », et une entrée seulement après un enregistrement réussi.
import { describe, expect, it } from "vitest";
import { createDownloads, type ItemSink } from "../flows/downloads.svelte";
import { createReadMeter } from "../flows/read-meter";
import { fakeIndexedDB } from "../history/fake-idb.test-helper";
import { memoryBackend } from "../history/store";
import { DOWNLOADS_DB, DOWNLOADS_KEEP_MS, afterSave, byDay, downloadsIdb, openDownloads, type NewDownload } from "./store";

const T0 = new Date(2026, 10, 14, 15, 30).getTime();
const NAME = "Facture-confidentielle-Dupont.pdf";
const fresh = (over: Partial<NewDownload> = {}): NewDownload => ({
  name: NAME,
  sizeBytes: 148_897_792,
  format: { family: "pdf", label: "PDF" },
  source: "partage",
  savedAt: T0,
  ...over,
});

function dump(v: unknown): string {
  const seen: string[] = [];
  const walk = (x: unknown) => {
    if (x instanceof Uint8Array) seen.push(new TextDecoder("latin1").decode(x), Buffer.from(x).toString("hex"));
    else if (x instanceof Map) for (const [k, y] of x) (seen.push(String(k)), walk(y));
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object" && !(x instanceof CryptoKey)) for (const [k, y] of Object.entries(x)) (seen.push(k), walk(y));
    else seen.push(String(x));
  };
  walk(v);
  return seen.join("\n");
}

describe("historique des téléchargements : stockage", () => {
  it("base « shhdrop-telechargements », chiffrée : aucun nom, taille, date ni champ en clair ; relue à l'identique", async () => {
    const idb = fakeIndexedDB();
    const d = (await openDownloads({ backend: downloadsIdb(idb), now: () => T0 }))!;
    const e = await d.add(fresh());
    expect(e).not.toBeNull();
    expect([...idb.raw().keys()]).toEqual([DOWNLOADS_DB]);
    expect(DOWNLOADS_DB).toBe("shhdrop-telechargements");
    const raw = dump(idb.raw());
    for (const s of ["Facture", "Dupont", ".pdf", "148897792", String(T0), "partage", "name", "sizeBytes", "savedAt"]) expect(raw, s).not.toContain(s);
    const again = (await openDownloads({ backend: downloadsIdb(idb), now: () => T0 }))!;
    expect(await again.list()).toEqual([e]);
  });

  it("champs exacts : nom, taille, format, source, date ; tout autre champ (lien, clé, mot de passe) est ignoré", async () => {
    const b = memoryBackend();
    const d = (await openDownloads({ backend: b, now: () => T0 }))!;
    const extra = { ...fresh(), link: "https://x.test/#" + "K".repeat(43), key: "K".repeat(43), password: "motdepasse" };
    const e = (await d.add(extra as NewDownload))!;
    expect(Object.keys(e).sort()).toEqual(["format", "id", "name", "savedAt", "sizeBytes", "source"]);
    expect(e).toMatchObject({ name: NAME, sizeBytes: 148_897_792, format: { family: "pdf", label: "PDF" }, source: "partage", savedAt: T0 });
    const listed = (await d.list())[0]!;
    expect(Object.keys(listed).sort()).toEqual(["format", "id", "name", "savedAt", "sizeBytes", "source"]);
  });

  it("entrée invalide refusée (source, format, taille, nom vide)", async () => {
    const d = (await openDownloads({ backend: memoryBackend(), now: () => T0 }))!;
    for (const bad of [{ source: "compte" }, { format: { family: "zzz", label: "PDF" } }, { format: { family: "pdf", label: "<b>" } }, { sizeBytes: -1 }, { name: "" }])
      await expect(d.add(fresh(bad as Partial<NewDownload>))).rejects.toThrow();
    expect(await d.list()).toEqual([]);
  });

  it("30 jours : une entrée plus ancienne est retirée (aussi du stockage) ; les plus récentes d'abord", async () => {
    expect(DOWNLOADS_KEEP_MS).toBe(30 * 86_400_000);
    let now = T0;
    const b = memoryBackend();
    const d = (await openDownloads({ backend: b, now: () => now }))!;
    await d.add(fresh({ savedAt: T0 - 2 * 86_400_000, name: "vieux.txt" }));
    await d.add(fresh({ savedAt: T0, name: "neuf.txt" }));
    expect((await d.list()).map((e) => e.name)).toEqual(["neuf.txt", "vieux.txt"]);
    now = T0 - 2 * 86_400_000 + DOWNLOADS_KEEP_MS - 1;
    expect((await d.list()).map((e) => e.name)).toEqual(["neuf.txt", "vieux.txt"]);
    now = T0 - 2 * 86_400_000 + DOWNLOADS_KEEP_MS;
    expect((await d.list()).map((e) => e.name)).toEqual(["neuf.txt"]);
    expect(b.raw().size).toBe(1);
  });

  it("réglage coupé : rien d'écrit, l'historique existant est effacé ; rallumé : écrit de nouveau", async () => {
    const b = memoryBackend();
    const d = (await openDownloads({ backend: b, now: () => T0 }))!;
    expect(await d.enabled()).toBe(true); // activé par défaut (R12)
    await d.add(fresh());
    await d.setEnabled(false);
    expect(await d.enabled()).toBe(false);
    expect(b.raw().size).toBe(0);
    expect(await d.add(fresh())).toBeNull();
    expect(b.raw().size).toBe(0);
    await d.setEnabled(true);
    expect(await d.add(fresh())).not.toBeNull();
    expect(b.raw().size).toBe(1);
  });

  it("« Effacer tout » et « Retirer »", async () => {
    const d = (await openDownloads({ backend: memoryBackend(), now: () => T0 }))!;
    const a = (await d.add(fresh({ name: "a.txt" })))!;
    await d.add(fresh({ name: "b.txt" }));
    await d.remove(a.id);
    expect((await d.list()).map((e) => e.name)).toEqual(["b.txt"]);
    await d.clear();
    expect(await d.list()).toEqual([]);
  });

  it("stockage absent ou refusé : null (le site marche sans historique)", async () => {
    expect(await openDownloads({ backend: null })).toBeNull();
    const idb = fakeIndexedDB();
    idb.failOpen = true;
    expect(await openDownloads({ backend: downloadsIdb(idb) })).toBeNull();
  });
});

describe("groupes par jour", () => {
  it("Aujourd'hui, Hier, puis la date ; dans l'ordre, du plus récent au plus ancien", () => {
    const at = (d: number, h: number) => new Date(2026, 10, d, h, 0).getTime();
    const list = [at(14, 9), at(14, 1), at(13, 23), at(12, 10), at(1, 8)].map((savedAt, i) => ({ id: String(i), savedAt }));
    const g = byDay(list, T0);
    expect(g.map((x) => x.day)).toEqual(["today", "yesterday", at(12, 0), at(1, 0)]);
    expect(g.map((x) => x.items.map((e) => e.id))).toEqual([["0", "1"], ["2"], ["3"], ["4"]]);
  });
});

describe("une entrée seulement après un enregistrement réussi", () => {
  const sink = (log: string[], failClose = false): ItemSink => ({
    write: async () => void log.push("write"),
    close: async () => {
      if (failClose) throw new DOMException("plein", "QuotaExceededError");
      log.push("close");
    },
    abort: async () => void log.push("abort"),
  });

  it("afterSave : appelé après close réussi seulement ; jamais après abort ni close en échec", async () => {
    const saved: number[] = [];
    const ok = afterSave(sink([]), () => saved.push(1));
    await ok.write(new Uint8Array(1));
    expect(saved).toEqual([]);
    await ok.close();
    expect(saved).toEqual([1]);
    await afterSave(sink([]), () => saved.push(2)).abort();
    await expect(afterSave(sink([], true), () => saved.push(3)).close()).rejects.toThrow();
    expect(saved).toEqual([1]);
    // Un historique qui échoue ne fait pas échouer l'enregistrement.
    await expect(afterSave(sink([]), () => { throw new Error("idb"); }).close()).resolves.toBeUndefined();
  });

  it("avec la file de téléchargements : réussi → 1 entrée ; lecture échouée, arrêt, sélecteur fermé → rien", async () => {
    const d = (await openDownloads({ backend: memoryBackend(), now: () => T0 }))!;
    const record = (i: number) => void d.add(fresh({ name: `f${i}.bin`, sizeBytes: 4 }));
    let fail = false;
    const dl = createDownloads([4, 4, 4], {
      read: async (_i, _from, on) => {
        if (fail) throw new TypeError("reseau coupé");
        await on(new Uint8Array(4));
      },
      openSink: async (i, target) => (target === "ferme" ? null : afterSave(sink([]), () => record(i))),
      meter: createReadMeter([0, 1, 2].map(() => ({ kind: "file" as const, offset: 0, size: 4 }))),
      now: () => 0,
    });
    const settle = async () => {
      for (let k = 0; k < 50; k++) await new Promise((r) => setTimeout(r, 0));
    };
    dl.start([0], "dossier");
    await settle();
    expect(dl.rows[0]!.state).toBe("done");
    fail = true;
    dl.start([1], "dossier");
    await settle();
    expect(dl.rows[1]!.state).toBe("failed");
    fail = false;
    dl.start([2], "ferme");
    await settle();
    expect(dl.rows[2]!.state).toBe("idle");
    await settle();
    expect((await d.list()).map((e) => e.name)).toEqual(["f0.bin"]);
  });
});
