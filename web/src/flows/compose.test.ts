import { describe, expect, it, vi } from "vitest";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { BLOCK_REASONS, blockKey, createComposer, metaNoteKey, splitName, type ComposeDeps } from "./compose.svelte";
import { CATEGORY_ORDER, categoryOf } from "./kinds";
import { CONTENT_MAX, MAX_ITEMS } from "../index";

const file = (name: string, size = 3, type = "") => new File([new Uint8Array(size)], name, { type });
/** Fichier d'une taille annoncée sans l'allouer (seule .size compte pour la jauge). */
const big = (name: string, size: number, type = "application/octet-stream") => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};
const jpeg = (name = "IMG_20261104.jpg") => new File([new Uint8Array([0xff, 0xd8, 1, 2, 3])], name, { type: "image/jpeg" });

function make(deps: Partial<ComposeDeps> = {}) {
  return createComposer({ probe: async () => undefined, online: () => true, ...deps });
}

describe("catégories (UI §9.2.4)", () => {
  it("ordre fixe et attribution", () => {
    expect(CATEGORY_ORDER).toEqual(["texte", "photos", "videos", "audio", "documents", "autres"]);
    expect(categoryOf("text", "x", "")).toBe("texte");
    expect(categoryOf("file", "a.HEIC", "")).toBe("photos");
    expect(categoryOf("file", "a", "image/png")).toBe("photos");
    expect(categoryOf("file", "a.mov", "")).toBe("videos");
    expect(categoryOf("file", "a.m4a", "")).toBe("audio");
    expect(categoryOf("file", "cv.pdf", "application/pdf")).toBe("documents");
    expect(categoryOf("file", "notes.md", "")).toBe("documents");
    expect(categoryOf("file", "a.zip", "application/zip")).toBe("autres");
  });

  it("splitName : extension à part, gardée seulement si c'en est une", () => {
    expect(splitName("photo.jpg")).toEqual({ base: "photo", ext: ".jpg" });
    expect(splitName("archive.tar.gz")).toEqual({ base: "archive.tar", ext: ".gz" });
    expect(splitName("README")).toEqual({ base: "README", ext: "" });
    expect(splitName("a." + "x".repeat(30))).toEqual({ base: "a." + "x".repeat(30), ext: "" });
  });
});

describe("createComposer : ajout", () => {
  it("JPEG nettoyé → donnée nettoyée, clean = nettoye", async () => {
    const strip = vi.fn(async () => new Uint8Array([0xff, 0xd8, 9]));
    const c = make({ strip });
    const r = await c.add([jpeg()], "fichiers");
    expect(r.added).toEqual(["IMG_20261104.jpg"]);
    expect(c.items[0]!.clean).toBe("nettoye");
    expect(c.items[0]!.data).toEqual(new Uint8Array([0xff, 0xd8, 9]));
    expect(c.items[0]!.size).toBe(3);
  });

  it("JPEG malformé → failedClean, rien d'ajouté", async () => {
    const c = make({ strip: async () => Promise.reject(new Error("malforme")) });
    const r = await c.add([jpeg("x.jpg")], "fichiers");
    expect(r.failedClean).toEqual(["x.jpg"]);
    expect(c.count).toBe(0);
  });

  it("sans nettoyeur (avant Task 9) : image ajoutée telle quelle, jamais marquée « nettoyé »", async () => {
    const c = make();
    const f = jpeg();
    await c.add([f], "fichiers");
    expect(c.items[0]!.clean).toBe("non_nettoye");
    expect(c.items[0]!.data).toBe(f);
  });

  it("12 fichiers → 10 ajoutés, 2 refusés (noms rendus)", async () => {
    const c = make();
    const r = await c.add(Array.from({ length: 12 }, (_, i) => file(`f${i}.bin`)), "depot");
    expect(r.added).toHaveLength(MAX_ITEMS);
    expect(r.refusedCount).toEqual(["f10.bin", "f11.bin"]);
    expect(c.count).toBe(10);
  });

  it("deux ajouts simultanés ne dépassent pas 10", async () => {
    const c = make();
    const a = c.add(Array.from({ length: 6 }, (_, i) => file(`a${i}`)), "fichiers");
    const b = c.add(Array.from({ length: 6 }, (_, i) => file(`b${i}`)), "fichiers");
    const [ra, rb] = await Promise.all([a, b]);
    expect(c.count).toBe(10);
    expect(ra.refusedCount.length + rb.refusedCount.length).toBe(2);
  });

  it("lecture d'essai rejetée → unreadable", async () => {
    const c = make({ probe: async (f) => ((f as File).name === "dossier" ? Promise.reject(new Error("x")) : undefined) });
    const r = await c.add([file("dossier"), file("ok.txt")], "depot");
    expect(r.unreadable).toEqual(["dossier"]);
    expect(r.added).toEqual(["ok.txt"]);
  });

  it("lecture d'essai par défaut : premier octet seulement", async () => {
    const c = createComposer({ online: () => true });
    const f = file("a.txt", 10);
    const slice = vi.spyOn(f, "slice");
    await c.add([f], "fichiers");
    expect(slice).toHaveBeenCalledWith(0, 1);
    expect(c.count).toBe(1);
  });

  it("total > CONTENT_MAX → ajouté quand même, blockReason trop_gros ; à la limite exacte, rien ne bloque", async () => {
    const c = make();
    await c.add([big("a.bin", CONTENT_MAX)], "fichiers");
    expect(c.totalBytes).toBe(CONTENT_MAX);
    expect(c.blockReason()).toBeNull();
    await c.add([big("b.bin", 1)], "fichiers");
    expect(c.count).toBe(2);
    expect(c.blockReason()).toBe("trop_gros");
  });

  it("photo de la source « photo » → Photo 1.jpg, Photo 2.jpg ; vidéo → Vidéo 1.mov", async () => {
    const c = make();
    await c.add([jpeg("image.jpg")], "photo");
    await c.add([jpeg("1730000000.jpeg")], "photo");
    await c.add([file("capture.MOV", 3, "video/quicktime")], "video");
    expect(c.items.map((i) => i.base + i.ext)).toEqual(["Photo 1.jpg", "Photo 2.jpeg", "Vidéo 1.mov"]);
  });

  it("image collée → Image collée 1.png ; noms d'étiquettes fournis par la langue", async () => {
    const c = make({ names: { photo: (n) => `Photo ${n}`, video: (n) => `Video ${n}`, pasted: (n) => `Pasted image ${n}`, text: (n) => `Text ${n}`, voice: (n) => `Voice ${n}` } });
    await c.add([new File([new Uint8Array(2)], "image.png", { type: "image/png" })], "collage");
    expect(c.items[0]!.base + c.items[0]!.ext).toBe("Pasted image 1.png");
    const d = make();
    await d.add([new File([new Uint8Array(2)], "image.png", { type: "image/png" })], "collage");
    expect(d.items[0]!.base).toBe("Image collée 1");
  });

  it("nom hostile nettoyé à l'ajout (inversion de sens, contrôle)", async () => {
    const c = make();
    await c.add([file("facture‮gpj.exe")], "fichiers");
    expect(c.items[0]!.base + c.items[0]!.ext).toBe("facturegpj.exe");
  });

  it("insertion à la fin de sa catégorie ; affichage = ordre des catégories", async () => {
    const c = make();
    await c.add([file("doc.pdf", 3, "application/pdf"), jpeg("a.jpg")], "fichiers");
    c.addText("bonjour");
    await c.add([jpeg("b.jpg")], "fichiers");
    expect(c.items.map((i) => i.category)).toEqual(["texte", "photos", "photos", "documents"]);
    expect(c.groups().map((g) => [g.category, g.count])).toEqual([["texte", 1], ["photos", 2], ["documents", 1]]);
    expect(c.groups()[1]!.bytes).toBe(10);
  });
});

describe("doublons", () => {
  it("même nom (sans casse) et même taille → badge sur les deux ; retiré quand l'un part", async () => {
    const c = make();
    await c.add([file("Rapport.pdf", 5)], "fichiers");
    const r = await c.add([file("rapport.PDF", 5), file("rapport.pdf", 6)], "fichiers");
    expect(r.duplicates).toEqual(["rapport.PDF"]);
    expect(c.items.map((i) => i.duplicate)).toEqual([true, true, false]);
    c.remove(c.items[1]!.id);
    expect(c.items.map((i) => i.duplicate)).toEqual([false, false]);
  });

  it("deux textes identiques ne sont pas des doublons", () => {
    const c = make();
    c.addText("a");
    c.addText("a");
    expect(c.items.every((i) => !i.duplicate)).toBe(true);
  });
});

describe("ordre", () => {
  it("move limité à la catégorie, premier / dernier en limite", async () => {
    const c = make();
    await c.add([jpeg("a.jpg"), jpeg("b.jpg"), file("z.pdf", 3, "application/pdf")], "fichiers");
    c.addText("t");
    const [, a, b, z] = c.items;
    expect(c.move(a!.id, -1)).toBe("premier");
    expect(c.move(b!.id, 1)).toBe("dernier");
    expect(c.move(z!.id, -1)).toBe("premier");
    expect(c.move(b!.id, -1)).toBe("ok");
    expect(c.items.map((i) => i.base)).toEqual(["Texte 1", "b", "a", "z"]);
  });

  it("moveTo dans la catégorie, index borné", async () => {
    const c = make();
    await c.add([jpeg("a.jpg"), jpeg("b.jpg"), jpeg("c.jpg")], "fichiers");
    c.moveTo(c.items[0]!.id, 2);
    expect(c.items.map((i) => i.base)).toEqual(["b", "c", "a"]);
    c.moveTo(c.items[2]!.id, -5);
    expect(c.items.map((i) => i.base)).toEqual(["a", "b", "c"]);
    expect(c.positionOf(c.items[1]!.id)).toEqual({ index: 2, of: 3, category: "photos" });
  });

  it("toApiItems : ordre des catégories puis ordre interne ; File d'origine passé tel quel ; texte en octets", async () => {
    const c = make();
    const pdf = file("z.pdf", 4, "application/pdf");
    const slice = vi.spyOn(pdf, "slice");
    const arrayBuffer = vi.spyOn(pdf, "arrayBuffer");
    await c.add([pdf, jpeg("b.jpg"), jpeg("a.jpg")], "fichiers");
    c.addText("é");
    c.move(c.items[2]!.id, -1);
    const api = c.toApiItems();
    expect(api.map((i) => i.name)).toEqual(["Texte 1", "a.jpg", "b.jpg", "z.pdf"]);
    expect(api[0]).toEqual({ kind: "text", name: "Texte 1", mime: "text/plain;charset=utf-8", data: new TextEncoder().encode("é") });
    expect(api[3]!.data).toBe(pdf);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(slice.mock.calls.every((a) => a[0] === 0 && a[1] === 1)).toBe(true);
  });
});

describe("retrait et annulation", () => {
  it("remove().undo() remet à la même place", async () => {
    const c = make();
    await c.add([jpeg("a.jpg"), jpeg("b.jpg"), jpeg("c.jpg")], "fichiers");
    const { undo } = c.remove(c.items[1]!.id);
    expect(c.items.map((i) => i.base)).toEqual(["a", "c"]);
    undo();
    expect(c.items.map((i) => i.base)).toEqual(["a", "b", "c"]);
    undo(); // une seule fois
    expect(c.count).toBe(3);
  });

  it("onFirstItem une fois au passage de 0 à 1 ; onEmpty quand le dernier part ; clear() annulable", async () => {
    const onFirstItem = vi.fn();
    const onEmpty = vi.fn();
    const c = make({ onFirstItem, onEmpty });
    await c.add([file("a"), file("b")], "fichiers");
    c.addText("x");
    expect(onFirstItem).toHaveBeenCalledTimes(1);
    const all = c.clear();
    expect(c.count).toBe(0);
    expect(onEmpty).toHaveBeenCalledTimes(1);
    all.undo();
    expect(c.count).toBe(3);
    expect(onFirstItem).toHaveBeenCalledTimes(2);
    for (const it of [...c.items]) c.remove(it.id);
    expect(onEmpty).toHaveBeenCalledTimes(2);
  });

  it("commit : l'insertion passe par le rappel fourni (transition de vue)", async () => {
    const applied: string[] = [];
    const c = make({
      commit: (apply) => {
        applied.push("avant");
        apply();
        applied.push("après");
      },
    });
    await c.add([file("a")], "fichiers");
    expect(applied).toEqual(["avant", "après"]);
    expect(c.count).toBe(1);
  });
});

describe("renommage", () => {
  it("règles : vide, interdit, trop long (120 points de code), extension intouchable", async () => {
    const c = make();
    await c.add([file("a.jpg"), file("noext")], "fichiers");
    const id = c.items[0]!.id;
    expect(c.rename(id, "   ")).toBe("vide");
    expect(c.rename(id, "a/b")).toBe("interdit");
    expect(c.rename(id, "a\\b")).toBe("interdit");
    expect(c.rename(id, "a\u0007b")).toBe("interdit");
    expect(c.rename(id, "x".repeat(117))).toBe("trop_long"); // 117 + « .jpg » = 121
    expect(c.rename(id, "x".repeat(116))).toBeNull();
    expect(c.items[0]!.base + c.items[0]!.ext).toBe("x".repeat(116) + ".jpg");
    expect(c.rename(id, "photo.png")).toBeNull();
    expect(c.items[0]!.ext).toBe(".jpg");
    expect(c.items[0]!.base).toBe("photo.png");
    const n = c.items[1]!.id;
    expect(c.rename(n, "y".repeat(121))).toBe("trop_long");
    expect(c.rename(n, "y".repeat(120))).toBeNull();
  });

  it("une séquence emoji ZWJ n'est jamais coupée : refusée entière si elle dépasse", async () => {
    const c = make();
    await c.add([file("noext")], "fichiers");
    const fam = "👩‍👩‍👧‍👦"; // 7 points de code
    const id = c.items[0]!.id;
    expect(c.rename(id, "y".repeat(115) + fam)).toBe("trop_long");
    expect(c.items[0]!.base).toBe("noext");
    expect(c.rename(id, "y".repeat(113) + fam)).toBeNull();
    expect(c.items[0]!.base.endsWith(fam)).toBe(true);
  });

  it("renommer met à jour les doublons", async () => {
    const c = make();
    await c.add([file("a.txt", 2), file("b.txt", 2)], "fichiers");
    c.rename(c.items[1]!.id, "A");
    expect(c.items.every((i) => i.duplicate)).toBe(true);
  });
});

describe("textes", () => {
  it("addText, updateText, taille en octets UTF-8, trop long bloque", () => {
    const c = make();
    const id = c.addText("é")!;
    expect(c.items[0]!.size).toBe(2);
    expect(c.items[0]!.base).toBe("Texte 1");
    c.updateText(id, "a".repeat(10_001));
    expect(c.blockReason()).toBe("texte_trop_long");
    c.updateText(id, "😀".repeat(10_000)); // points de code, pas unités UTF-16
    expect(c.blockReason()).toBeNull();
    expect(c.addText("b")).not.toBe(id);
    expect(c.items[1]!.base).toBe("Texte 2");
  });

  it("texte refusé au-delà de 10 éléments", async () => {
    const c = make();
    await c.add(Array.from({ length: 10 }, (_, i) => file(`f${i}`)), "fichiers");
    expect(c.addText("x")).toBeNull();
    expect(c.count).toBe(10);
  });
});

describe("blocages et textes de raison", () => {
  it("vide, hors ligne, nettoyage en cours", async () => {
    let online = true;
    let release!: () => void;
    const c = make({ online: () => online, strip: () => new Promise((r) => (release = () => r(new Uint8Array(1)))) });
    expect(c.blockReason()).toBe("vide");
    const p = c.add([jpeg()], "fichiers");
    await Promise.resolve();
    await Promise.resolve();
    c.addText("x");
    expect(c.blockReason()).toBe("nettoyage");
    release();
    await p;
    expect(c.blockReason()).toBeNull();
    online = false;
    expect(c.blockReason()).toBe("hors_ligne");
  });

  it("chaque raison a son texte en français et en anglais", () => {
    expect(BLOCK_REASONS).toEqual(["vide", "trop_gros", "texte_trop_long", "nettoyage", "hors_ligne"]);
    for (const r of BLOCK_REASONS) {
      const k = blockKey(r);
      expect(fr[k as keyof typeof fr], r).toBeTruthy();
      expect(en[k as keyof typeof en], r).toBeTruthy();
    }
  });

  it("mention des métadonnées : seulement pour ce qui n'est pas nettoyé, jamais pour un texte", async () => {
    const c = make({ strip: async () => new Uint8Array([1]) });
    await c.add([jpeg("a.jpg"), file("v.mp4", 3, "video/mp4"), file("d.pdf", 3, "application/pdf"), file("w.docx"), file("z.zip"), file("n.txt", 3, "text/plain"), file("m.md")], "fichiers");
    c.addText("t");
    const notes = Object.fromEntries(c.items.map((i) => [i.base, metaNoteKey(i)]));
    expect(notes).toEqual({ "Texte 1": null, a: null, v: "compose.meta.video", d: "compose.meta.pdf", w: "compose.meta.doc", z: null, n: null, m: null });
    const d = make();
    await d.add([jpeg("b.jpg"), new File([new Uint8Array(1)], "h.heic", { type: "image/heic" })], "fichiers");
    expect(d.items.map(metaNoteKey)).toEqual(["compose.meta.photo", "compose.meta.photo"]);
    for (const k of ["compose.meta.video", "compose.meta.pdf", "compose.meta.doc", "compose.meta.photo"]) {
      expect(fr[k as keyof typeof fr], k).toBeTruthy();
      expect(en[k as keyof typeof en], k).toBeTruthy();
    }
  });
});
