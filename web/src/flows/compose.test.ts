import { describe, expect, it, vi } from "vitest";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { BLOCK_REASONS, blockKey, createComposer, metaNoteKey, splitName, type ComposeDeps } from "./compose.svelte";
import { CATEGORY_ORDER, categoryOf } from "./kinds";
import { HEAD_BYTES } from "./sniff";
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
    expect(CATEGORY_ORDER).toEqual(["texte", "photos", "videos", "audio", "documents", "archives", "autres"]);
    expect(categoryOf("text", "x", "")).toBe("texte");
    expect(categoryOf("file", "a.HEIC", "")).toBe("photos");
    expect(categoryOf("file", "a", "image/png")).toBe("photos");
    expect(categoryOf("file", "a.mov", "")).toBe("videos");
    expect(categoryOf("file", "a.m4a", "")).toBe("audio");
    expect(categoryOf("file", "cv.pdf", "application/pdf")).toBe("documents");
    expect(categoryOf("file", "notes.md", "")).toBe("documents");
    expect(categoryOf("file", "a.zip", "application/zip")).toBe("archives");
    expect(categoryOf("file", "police.ttf", "")).toBe("autres");
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
    const clean = vi.fn(async () => ({ file: new Blob([new Uint8Array([0xff, 0xd8, 9])]), cleaned: true, removed: ["lieu"] }));
    const c = make({ clean });
    const r = await c.add([jpeg()], "fichiers");
    expect(r.added).toEqual(["IMG_20261104.jpg"]);
    expect(c.items[0]!.clean).toBe("nettoye");
    expect(new Uint8Array(await (c.items[0]!.data as Blob).arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 9]));
    expect(c.items[0]!.size).toBe(3);
  });

  it("JPEG malformé → failedClean, rien d'ajouté", async () => {
    const c = make({ clean: async () => Promise.reject(new Error("malforme")) });
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

  it("MAX_ITEMS + 2 fichiers → MAX_ITEMS ajoutés, 2 refusés (noms rendus) ; 200 acceptés, le 201ᵉ refusé (fichiers minuscules)", async () => {
    expect(MAX_ITEMS).toBe(200);
    const c = make();
    const r = await c.add(Array.from({ length: MAX_ITEMS + 2 }, (_, i) => file(`f${i}.bin`)), "depot");
    expect(r.added).toHaveLength(MAX_ITEMS);
    expect(r.refusedCount).toEqual([`f${MAX_ITEMS}.bin`, `f${MAX_ITEMS + 1}.bin`]);
    expect(c.count).toBe(MAX_ITEMS);
    const one = make();
    expect((await one.add(Array.from({ length: MAX_ITEMS }, (_, i) => file(`g${i}`)), "fichiers")).refusedCount).toEqual([]);
    expect((await one.add([file("seizieme.bin")], "fichiers")).refusedCount).toEqual(["seizieme.bin"]);
    expect(one.count).toBe(MAX_ITEMS);
  });

  it("deux ajouts simultanés ne dépassent pas MAX_ITEMS", async () => {
    const c = make();
    const half = Math.ceil(MAX_ITEMS / 2) + 1;
    const a = c.add(Array.from({ length: half }, (_, i) => file(`a${i}`)), "fichiers");
    const b = c.add(Array.from({ length: half }, (_, i) => file(`b${i}`)), "fichiers");
    const [ra, rb] = await Promise.all([a, b]);
    expect(c.count).toBe(MAX_ITEMS);
    expect(ra.refusedCount.length + rb.refusedCount.length).toBe(2 * half - MAX_ITEMS);
  });

  it("lecture d'essai rejetée → unreadable", async () => {
    const c = make({ probe: async (f) => ((f as File).name === "dossier" ? Promise.reject(new Error("x")) : undefined) });
    const r = await c.add([file("dossier"), file("ok.txt")], "depot");
    expect(r.unreadable).toEqual(["dossier"]);
    expect(r.added).toEqual(["ok.txt"]);
  });

  it("lecture d'essai par défaut : les octets de tête seulement", async () => {
    const c = createComposer({ online: () => true });
    const f = file("a.txt", 10);
    const slice = vi.spyOn(f, "slice");
    await c.add([f], "fichiers");
    expect(slice).toHaveBeenCalledWith(0, HEAD_BYTES);
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
    expect(c.items.map((i) => i.base)).toEqual(["Note", "b", "a", "z"]);
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
    expect(api.map((i) => i.name)).toEqual(["Note", "a.jpg", "b.jpg", "z.pdf"]);
    expect(api[0]).toEqual({ kind: "text", name: "Note", mime: "text/plain;charset=utf-8", data: new TextEncoder().encode("é") });
    expect(api[3]!.data).toBe(pdf);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(slice.mock.calls.every((a) => a[0] === 0 && a[1] === HEAD_BYTES)).toBe(true);
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
    expect(c.items[0]!.base).toBe("Note");
    c.updateText(id, "a".repeat(10_001));
    expect(c.blockReason()).toBe("texte_trop_long");
    c.updateText(id, "😀".repeat(10_000)); // points de code, pas unités UTF-16
    expect(c.blockReason()).toBeNull();
    expect(c.addText("b")).not.toBe(id);
    expect(c.items[1]!.base).toBe("Note 2");
  });

  it("texte refusé au-delà de MAX_ITEMS éléments", async () => {
    const c = make();
    await c.add(Array.from({ length: MAX_ITEMS }, (_, i) => file(`f${i}`)), "fichiers");
    expect(c.addText("x")).toBeNull();
    expect(c.count).toBe(MAX_ITEMS);
  });
});

describe("blocages et textes de raison", () => {
  it("vide, hors ligne, nettoyage en cours", async () => {
    let online = true;
    let release!: () => void;
    const c = make({ online: () => online, clean: () => new Promise((r) => (release = () => r({ file: new Blob(["x"]), cleaned: true, removed: [] }))) });
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

  it("200 éléments aux noms courts : envoi permis ; manifeste plein (noms longs non latins, longs textes) : bloqué avant le scellement (D41-17)", async () => {
    const short = make();
    await short.add(Array.from({ length: MAX_ITEMS }, (_, i) => file(`photo-${i}.jpg`, 1, "image/jpeg")), "fichiers");
    expect(short.count).toBe(200);
    expect(short.blockReason()).toBeNull();
    // 120 caractères de 4 octets par nom : environ 500 octets par entrée, le manifeste déborde.
    const wide = make();
    await wide.add(Array.from({ length: MAX_ITEMS }, (_, i) => file(`${"😀".repeat(110)}${String(i).padStart(3, "0")}.bin`)), "fichiers");
    expect(wide.blockReason()).toBe("manifeste");
    const texts = make();
    for (let i = 0; i < 7; i++) texts.addText("é".repeat(10_000)); // 7 × 20 000 octets > 65 532
    expect(texts.blockReason()).toBe("manifeste");
  });

  it("chaque raison a son texte en français et en anglais", () => {
    expect(BLOCK_REASONS).toEqual(["vide", "trop_gros", "texte_trop_long", "manifeste", "nettoyage", "hors_ligne"]);
    for (const r of BLOCK_REASONS) {
      const k = blockKey(r);
      expect(fr[k as keyof typeof fr], r).toBeTruthy();
      expect(en[k as keyof typeof en], r).toBeTruthy();
    }
  });

  it("mention des métadonnées : seulement pour ce qui n'est pas nettoyé, jamais pour un texte", async () => {
    const c = make({ clean: async (f) => ({ file: f, cleaned: f.type === "image/jpeg", removed: [] }) });
    await c.add([jpeg("a.jpg"), file("v.mp4", 3, "video/mp4"), file("d.pdf", 3, "application/pdf"), file("w.docx"), file("z.zip"), file("n.txt", 3, "text/plain"), file("m.md")], "fichiers");
    c.addText("t");
    const notes = Object.fromEntries(c.items.map((i) => [i.base, metaNoteKey(i)]));
    expect(notes).toEqual({ "Note": null, a: null, v: "compose.meta.video", d: "compose.meta.pdf", w: "compose.meta.doc", z: null, n: null, m: null });
    const d = make();
    await d.add([jpeg("b.jpg"), new File([new Uint8Array(1)], "h.heic", { type: "image/heic" })], "fichiers");
    expect(d.items.map(metaNoteKey)).toEqual(["compose.meta.photo", "compose.meta.photo"]);
    for (const k of ["compose.meta.video", "compose.meta.pdf", "compose.meta.doc", "compose.meta.photo"]) {
      expect(fr[k as keyof typeof fr], k).toBeTruthy();
      expect(en[k as keyof typeof en], k).toBeTruthy();
    }
  });
});

describe("type par le contenu, archives, exécutables (sniff)", () => {
  const bytes = (arr: number[], name: string, type = "") => new File([new Uint8Array(arr)], name, { type });
  const zip = [0x50, 0x4b, 0x03, 0x04, 0, 0];
  it("archives : par extension ou par contenu ; un docx (zip) reste un document", async () => {
    const c = make({ probe: async (f) => new Uint8Array(await f.slice(0, HEAD_BYTES).arrayBuffer()) });
    await c.add([bytes(zip, "photos.zip"), bytes(zip, "sans-extension"), bytes(zip, "lettre.docx"), bytes([0x1f, 0x8b, 8], "a.tar.gz"), bytes([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], "x.7z")], "fichiers");
    expect(Object.fromEntries(c.items.map((i) => [i.base + i.ext, i.category]))).toEqual({
      "photos.zip": "archives",
      "sans-extension": "archives",
      "lettre.docx": "documents",
      "a.tar.gz": "archives",
      "x.7z": "archives",
    });
    expect(c.items.find((i) => i.ext === ".zip")!.clean).toBe("sans_objet");
  });
  it("exécutable déguisé en photo : classé Autres, à risque, contenu ≠ extension", async () => {
    const c = make({ probe: async (f) => new Uint8Array(await f.slice(0, HEAD_BYTES).arrayBuffer()) });
    await c.add([bytes([0x4d, 0x5a, 0x90, 0], "vacances.jpg", "image/jpeg"), bytes([0x4d, 0x5a], "setup.exe"), bytes([0x23, 0x21], "go.sh")], "fichiers");
    const [a, b, s] = ["vacances.jpg", "setup.exe", "go.sh"].map((n) => c.items.find((i) => i.base + i.ext === n)!);
    expect([a!.category, a!.risky, a!.mismatch]).toEqual(["autres", true, true]);
    expect([b!.category, b!.risky, b!.mismatch]).toEqual(["autres", true, false]);
    expect([s!.risky, s!.mismatch]).toEqual([true, false]);
  });
  it("catégories : HEIC, polices, image ISO, code, tableur, présentation, CSV", () => {
    expect(categoryOf("file", "IMG_1.HEIC", "")).toBe("photos");
    expect(categoryOf("file", "x", "", "heic")).toBe("photos");
    expect(categoryOf("file", "a.woff2", "", "font")).toBe("autres");
    expect(categoryOf("file", "disk.iso", "", "iso")).toBe("autres");
    for (const n of ["main.py", "lib.rs", "data.csv", "budget.xlsx", "slides.pptx", "conf.yaml"]) expect(categoryOf("file", n, ""), n).toBe("documents");
    expect(categoryOf("file", "son.webm", "audio/webm", "webm")).toBe("audio");
    expect(categoryOf("file", "clip.webm", "video/webm", "webm")).toBe("videos");
  });
});

describe("notes (titre et contenu) et nettoyage de tous les fichiers", () => {
  it("titre facultatif (« Note » par défaut), nettoyé ; updateText change le titre et le contenu", () => {
    const c = make();
    const a = c.addText("corps")!;
    const b = c.addText("x", "  Courses\u202E  ")!;
    expect(c.items.map((i) => i.base)).toEqual(["Note", "Courses"]);
    c.updateText(a, "nouveau", "Code de la porte");
    expect(c.items[0]).toMatchObject({ base: "Code de la porte", text: "nouveau" });
    c.updateText(b, "y", "");
    expect(c.items[1]!.base).toBe("Courses");
    expect(c.toApiItems()[0]!.name).toBe("Code de la porte");
  });
  it("cleanAll : nettoie ce qui peut l'être, garde le reste et le dit", async () => {
    const c = make();
    await c.add([jpeg("a.jpg"), file("d.pdf", 3, "application/pdf")], "fichiers");
    const r = await c.cleanAll(async (f) => ({ file: new Blob(["ok"]), cleaned: f.type === "image/jpeg", removed: ["lieu"] }));
    expect(r).toEqual({ cleaned: ["a.jpg"], failed: ["d.pdf"] });
    expect(c.items.map((i) => i.clean)).toEqual(["nettoye", "non_nettoye"]);
    expect(c.items[0]!.size).toBe(2);
    const r2 = await c.cleanAll(async () => Promise.reject(new Error("x")));
    expect(r2).toEqual({ cleaned: [], failed: ["d.pdf"] });
  });
});

describe("éléments en cause (S6)", () => {
  it("programme, texte trop long, plus gros fichiers au-delà de la limite", async () => {
    const c = make({ probe: async (f) => new Uint8Array(await f.slice(0, 4).arrayBuffer()) });
    await c.add([big("a.bin", CONTENT_MAX - 10), big("b.bin", 100), new File([new Uint8Array([0x4d, 0x5a])], "x.exe")], "fichiers");
    const id = (n: string) => c.items.find((i) => i.base + i.ext === n)!.id;
    expect([...c.culprits()].sort()).toEqual([id("a.bin"), id("x.exe")].sort());
    const t = c.addText("a".repeat(10_001))!;
    expect(c.culprits().has(t)).toBe(true);
    c.remove(id("a.bin"));
    expect([...c.culprits()].sort()).toEqual([t, id("x.exe")].sort());
  });
});

describe("pris dans l'interface (caméra maison, Q-REC1)", () => {
  it("photo-ici : nommée « Photo n », sans métadonnées par construction (canvas) → nettoyée", async () => {
    const c = make();
    const r = await c.add([new File([new Uint8Array([0xff, 0xd8, 1])], "capture.jpg", { type: "image/jpeg" })], "photo-ici");
    expect(r.added).toEqual(["Photo 1.jpg"]);
    expect(c.items[0]).toMatchObject({ category: "photos", clean: "nettoye" });
  });
  it("video-ici : nommée « Vidéo n », honnête : le conteneur peut porter nom du navigateur et date → non nettoyée", async () => {
    const c = make();
    const r = await c.add([new File([new Uint8Array(4)], "capture.webm", { type: "video/webm" })], "video-ici");
    expect(r.added).toEqual(["Vidéo 1.webm"]);
    expect(c.items[0]).toMatchObject({ category: "videos", clean: "non_nettoye" });
  });
});
