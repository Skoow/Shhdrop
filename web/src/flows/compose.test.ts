import { describe, expect, it, vi } from "vitest";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { readFileSync } from "node:fs";
import { BLOCK_REASONS, blockKey, canClean, createComposer, splitName, type ComposeDeps } from "./compose.svelte";
import { gate } from "./clean-gate";
import { cleanLineKey, cleanMark, isCleanFailure } from "../media/clean-label";
import type { StripResult } from "../media/strip";
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

/** Par défaut, un nettoyage neutre (« sans ») : chaque test qui en parle donne le sien. */
function make(deps: Partial<ComposeDeps> = {}) {
  return createComposer({ probe: async () => undefined, online: () => true, strip: async () => ({ state: "sans" }), ...deps });
}
const nettoye = (data: Blob): StripResult => ({ state: "nettoye", data, family: "image" });

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
  it("JPEG nettoyé → donnée nettoyée, clean = nettoye, seule elle peut être chiffrée", async () => {
    const out = new Blob([new Uint8Array([0xff, 0xd8, 9])]);
    const strip = vi.fn(async () => nettoye(out));
    const c = make({ strip });
    const f = jpeg();
    const r = await c.add([f], "fichiers");
    expect(r.added).toEqual(["IMG_20261104.jpg"]);
    expect(strip).toHaveBeenCalledWith(f, "image/jpeg", "IMG_20261104.jpg", { recorded: false });
    expect(c.items[0]).toMatchObject({ clean: "nettoye", cleanFamily: "image", size: 3 });
    expect(c.items[0]!.data).toBe(out);
    await expect(gate(out)).resolves.toBe(out);
    await expect(gate(f)).rejects.toThrow("non_nettoye");
  });

  it("échec du nettoyage → part sans clic (D41-23), marque « Non nettoyé » et raison ; le verrou le laisse passer", async () => {
    const c = make({ strip: async () => ({ state: "echec", reason: "malformed:jpeg_sos" }) });
    const f = jpeg("x.jpg");
    await c.add([f, jpeg("y.jpg")], "fichiers");
    expect(c.items.map((i) => i.clean)).toEqual(["echec", "echec"]);
    expect(c.items[0]!.data).toBe(f);
    expect(c.items.map((i) => cleanLineKey(i))).toEqual(["clean.fail.echec", "clean.fail.echec"]);
    expect(c.items.map((i) => cleanMark(i))).toEqual(["fail", "fail"]);
    expect(c.blockReason()).toBeNull();
    expect(c.uncleanedCount).toBe(2);
    await expect(gate(f)).resolves.toBe(f);
    c.remove(c.items[1]!.id);
    expect(c.uncleanedCount).toBe(1);
  });

  it("format non reconnu : document tel quel sans marque ; photo, vidéo ou son : marque ambre et décompte (décision du 10 novembre) ; archive intacte sans analyse (D41-27)", async () => {
    const fmt: Record<string, "mp4" | "mp3" | "inconnu"> = { "application/zip": "inconnu", "image/tiff": "inconnu", "video/x-msvideo": "inconnu", "audio/aac": "inconnu", "application/x-thing": "inconnu" };
    const seen: string[] = [];
    const c = make({ strip: async (f, mime) => (seen.push((f as File).name), { state: "non_pris_en_charge", format: fmt[mime]! }) });
    const files = Object.keys(fmt).map((m, k) => file(["b.zip", "c.tiff", "d.avi", "e.aac", "f.bin"][k]!, 3, m));
    await c.add(files, "fichiers");
    const by = (b: string) => c.items.find((i) => i.base === b)!;
    // Une photo, une vidéo ou un son que le nettoyage ne sait pas lire peut porter une position :
    // la personne est prévenue (ambre, compté, dit au destinataire), l'envoi reste libre.
    for (const b of ["c", "d", "e"]) {
      expect(by(b).clean, b).toBe("echec");
      expect(cleanLineKey(by(b)), b).toBe("clean.fail.format");
      expect(cleanMark(by(b)), b).toBe("fail");
      expect(by(b).data, b).toBe(files[["b", "c", "d", "e", "f"].indexOf(b)]);
    }
    // Autre fichier (D41-34) : « Fichier tel quel (non modifié) », aucune marque sur la ligne.
    expect(cleanLineKey(by("f"))).toBe("clean.asis");
    expect(cleanMark(by("f"))).toBeNull();
    const zip = by("b");
    expect(zip.clean).toBe("intact");
    expect(zip.data).toBe(files[0]);
    expect(seen).not.toContain("b.zip");
    expect(c.blockReason()).toBeNull();
    expect(c.uncleanedCount).toBe(3);
    for (const i of c.items) await expect(gate(i.data as Blob)).resolves.toBe(i.data);
  });

  it("verrou : un contenu qui n'est passé ni par le nettoyage ni par la décision « non nettoyable » est refusé", async () => {
    await expect(gate(new Blob(["jamais vu"]))).rejects.toThrow("non_nettoye");
  });

  it("réglage désactivé : rien n'est modifié ni analysé, marque « Original », envoi libre", async () => {
    let on = false;
    const strip = vi.fn(async () => nettoye(new Blob(["x"])));
    const c = make({ strip, autoClean: () => on });
    const f = jpeg();
    await c.add([f], "fichiers");
    expect(strip).not.toHaveBeenCalled();
    expect(c.items[0]).toMatchObject({ clean: "original" });
    expect(cleanLineKey(c.items[0]!)).toBe("clean.asis");
    expect(cleanMark(c.items[0]!)).toBeNull();
    expect(c.uncleanedCount).toBe(0);
    expect(c.items[0]!.data).toBe(f);
    expect(c.blockReason()).toBeNull();
    await expect(gate(f)).resolves.toBe(f);
    on = true;
    await c.add([jpeg("b.jpg")], "fichiers");
    expect(c.items[1]!.clean).toBe("nettoye");
  });

  it("vrai nettoyage par défaut (stripMetadata) : photo avec GPS nettoyée, texte brut sans objet", async () => {
    const c = createComposer({ probe: async () => undefined, online: () => true });
    const src = new Uint8Array(readFileSync(new URL("../media/fixtures/iphone-like.jpg", import.meta.url)));
    await c.add([new File([src], "IMG_1.jpg", { type: "image/jpeg" }), file("n.txt", 3, "text/plain")], "fichiers");
    const [img, txt] = [c.items.find((i) => i.ext === ".jpg")!, c.items.find((i) => i.ext === ".txt")!];
    expect(img).toMatchObject({ clean: "nettoye" });
    expect(img.size).toBeLessThan(src.length);
    const out = new TextDecoder("latin1").decode(await (img.data as Blob).arrayBuffer());
    // Seule la vignette EXIF reste (décision du propriétaire du 11 novembre) : aucun autre repère.
    expect(out.replace("ReperThumb", "")).not.toMatch(/Reper|2001:02:03/);
    expect(out).toContain("ReperThumb");
    expect(txt.clean).toBe("sans");
    expect(c.blockReason()).toBeNull();
  });

  it("vrai nettoyage d'un .docx et d'un PDF (Task 9b, D41-31) : « Nettoyé » bureautique et PDF, même longueur ; PDF signé → protégé", async () => {
    const c = createComposer({ probe: async () => undefined, online: () => true });
    const fx = (n: string) => new Uint8Array(readFileSync(new URL(`../media/fixtures/${n}`, import.meta.url)));
    const pdfFile = new File([fx("meta.pdf")], "devis.pdf", { type: "application/pdf" });
    await c.add([new File([fx("meta.docx")], "rapport.docx"), pdfFile, new File([fx("signed.pdf")], "signe.pdf", { type: "application/pdf" })], "fichiers");
    const doc = c.items.find((i) => i.ext === ".docx")!;
    expect(doc).toMatchObject({ clean: "nettoye", cleanFamily: "bureautique" });
    expect(cleanLineKey(doc)).toBe("clean.done.office");
    expect(cleanMark(doc)).toBe("done");
    expect(new TextDecoder("latin1").decode(await (doc.data as Blob).arrayBuffer())).not.toMatch(/ReperSociete|ReperTitre|ReperMiniature/);
    const pdf = c.items.find((i) => i.base === "devis")!;
    expect(pdf).toMatchObject({ clean: "nettoye", cleanFamily: "pdf" });
    expect(cleanLineKey(pdf)).toBe("clean.done.pdf");
    expect((pdf.data as Blob).size).toBe(pdfFile.size);
    const out = new TextDecoder("latin1").decode(await (pdf.data as Blob).arrayBuffer());
    expect(out).not.toMatch(/ReperAuteur|ReperLogiciel/); // propriétés du document
    expect(out).toContain("ReperThumb"); // miniature de page gardée (décision du 11 novembre)
    expect(out).toContain("(Bonjour Shhdrop) Tj");
    const signed = c.items.find((i) => i.base === "signe")!;
    expect(signed.clean).toBe("protege");
    expect(cleanLineKey(signed)).toBe("clean.fail.protege");
    expect(isCleanFailure(signed)).toBe(true);
    expect(c.uncleanedCount).toBe(1);
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

  it("place (spec §41.14, audit H-2) : 512 segments de 4 Mio au plus, petits fichiers empaquetés ; au-delà, « segments » même sous 2 Gio", async () => {
    const c = make();
    const MIB = 1048576;
    await c.add([big("a.bin", 400 * 4 * MIB)], "fichiers"); // 400 segments
    for (let i = 0; i < 56; i++) await c.add([big(`g${i}.bin`, 4 * MIB + 1)], "fichiers"); // 2 segments chacun : 512
    expect(c.blockReason()).toBeNull();
    for (let i = 0; i < 100; i++) await c.add([big(`p${i}.bin`, 1)], "fichiers"); // 100 morceaux : 2 segments partagés
    expect(c.totalBytes).toBeLessThan(CONTENT_MAX);
    expect(c.blockReason()).toBe("segments");
    const d = make();
    for (let i = 0; i < 64; i++) await d.add([big(`p${i}.bin`, 1)], "fichiers"); // 64 petits : un seul segment
    await d.add([big("a.bin", 511 * 4 * MIB)], "fichiers");
    expect(d.blockReason()).toBeNull();
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
    expect(api[0]).toMatchObject({ kind: "text", name: "Note", mime: "text/plain;charset=utf-8" });
    // Note élément (D41-36) : le Blob de la ligne, celui que le brouillon envoie.
    expect(api[0]!.data).toBe(c.items[0]!.data);
    expect(new Uint8Array(await (api[0]!.data as Blob).arrayBuffer())).toEqual(new TextEncoder().encode("é"));
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
  it("addText, updateText, taille en octets UTF-8, trop long bloque ; note approuvée pour l'envoi anticipé", async () => {
    const c = make();
    const id = c.addText("é")!;
    await expect(gate(c.items[0]!.data as Blob)).resolves.toBe(c.items[0]!.data);
    expect(c.items[0]!.size).toBe(2);
    expect(c.items[0]!.base).toBe("Note");
    const d0 = c.items[0]!.data;
    c.updateText(id, "é", "Titre");
    expect(c.items[0]!.data).toBe(d0); // texte inchangé : même Blob, pas de renvoi
    c.updateText(id, "a".repeat(100_001));
    expect(c.items[0]!.data).not.toBe(d0); // modifié : nouveau Blob, renvoyé
    expect(c.blockReason()).toBe("texte_trop_long");
    c.updateText(id, "😀".repeat(100_000)); // points de code, pas unités UTF-16
    expect(c.blockReason()).toBeNull();
    expect(c.items[0]!.size).toBe(400_000);
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
    const c = make({ online: () => online, strip: () => new Promise((r) => (release = () => r(nettoye(new Blob(["x"]))))) });
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

  it("200 éléments aux noms courts : envoi permis ; manifeste plein (noms longs non latins) : bloqué avant le scellement (D41-17)", async () => {
    const short = make();
    await short.add(Array.from({ length: MAX_ITEMS }, (_, i) => file(`photo-${i}.jpg`, 1, "image/jpeg")), "fichiers");
    expect(short.count).toBe(200);
    expect(short.blockReason()).toBeNull();
    // 120 caractères de 4 octets par nom : environ 500 octets par entrée, le manifeste déborde.
    const wide = make();
    await wide.add(Array.from({ length: MAX_ITEMS }, (_, i) => file(`${"😀".repeat(110)}${String(i).padStart(3, "0")}.bin`)), "fichiers");
    expect(wide.blockReason()).toBe("manifeste");
    // Notes éléments (D41-36) : leur texte n'est plus dans le manifeste, il ne le remplit pas.
    const texts = make();
    for (let i = 0; i < 7; i++) texts.addText("é".repeat(100_000));
    expect(texts.blockReason()).toBeNull();
  });

  it("chaque raison a son texte en français et en anglais", () => {
    expect(BLOCK_REASONS).toEqual(["vide", "trop_gros", "segments", "texte_trop_long", "manifeste", "nettoyage", "nettoyage_en_cours", "hors_ligne"]);
    for (const r of BLOCK_REASONS) {
      const k = blockKey(r);
      expect(fr[k as keyof typeof fr], r).toBeTruthy();
      expect(en[k as keyof typeof en], r).toBeTruthy();
    }
  });

  it("textes d'état du nettoyage : chaque clé existe en français et en anglais ; un texte n'a rien", async () => {
    const c = make();
    c.addText("t");
    expect(cleanLineKey(c.items[0]!)).toBeNull();
    expect(cleanMark(c.items[0]!)).toBeNull();
    for (const k of ["clean.done.image", "clean.done.video", "clean.done.vocal", "clean.done.audio", "clean.done.pdf", "clean.done.office", "clean.asis", "clean.fail.echec", "clean.fail.format", "clean.fail.protege", "compose.uncleaned.one", "compose.uncleaned.other"]) {
      expect(fr[k as keyof typeof fr], k).toBeTruthy();
      expect(en[k as keyof typeof en], k).toBeTruthy();
    }
    expect(fr["clean.done.image"]).toBe("Nettoyé\u202f: position, appareil et dates retirés, vignette d'aperçu gardée");
    expect(fr["clean.asis"]).toBe("Fichier tel quel (non modifié)");
    for (const k of ["clean.mark", "clean.mark.not", "clean.original", "clean.original.hint"]) expect(k in fr, k).toBe(false);
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
    expect(c.items.find((i) => i.ext === ".zip")!.clean).toBe("intact");
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

describe("notes (titre et contenu)", () => {
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
});

describe("éléments en cause (S6)", () => {
  it("programme, texte trop long, plus gros fichiers au-delà de la limite", async () => {
    const c = make({ probe: async (f) => new Uint8Array(await f.slice(0, 4).arrayBuffer()) });
    await c.add([big("a.bin", CONTENT_MAX - 10), big("b.bin", 100), new File([new Uint8Array([0x4d, 0x5a])], "x.exe")], "fichiers");
    const id = (n: string) => c.items.find((i) => i.base + i.ext === n)!.id;
    expect([...c.culprits()].sort()).toEqual([id("a.bin"), id("x.exe")].sort());
    const t = c.addText("a".repeat(100_001))!;
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
  it("video-ici : nommée « Vidéo n » ; nettoyée par strip-capture (CaptureScreen) ou gardée telle quelle par choix", async () => {
    const c = make();
    const r = await c.add([new File([new Uint8Array(4)], "capture.webm", { type: "video/webm" })], "video-ici", true);
    expect(r.added).toEqual(["Vidéo 1.webm"]);
    expect(c.items[0]).toMatchObject({ category: "videos", clean: "nettoye", cleanFamily: "video" });
    await c.add([new File([new Uint8Array(4)], "capture.webm", { type: "video/webm" })], "video-ici", false);
    expect(c.items[1]).toMatchObject({ clean: "echec" });
    expect(c.blockReason()).toBeNull();
    expect(c.addVoice(new Blob(["v"]), "audio/webm")).not.toBeNull();
    expect(c.items.find((i) => i.category === "audio")).toMatchObject({ clean: "nettoye", cleanFamily: "vocal" });
    // Task 12 : forme d'onde et durée gardées pour la réécoute dans la liste, jamais dans le manifeste.
    const id = c.addVoice(new Blob(["w"]), "audio/mp4", true, { peaks: [0.2, 1], ms: 4200 })!;
    const v = c.items.find((i) => i.id === id)!;
    expect(v).toMatchObject({ ext: ".m4a", voice: { peaks: [0.2, 1], ms: 4200 } });
    expect(JSON.stringify(c.toApiItems().find((i) => i.name === v.base + v.ext))).not.toContain("peaks");
  });
  it("vocal : nom générique, renommage assaini envoyé dans le manifeste, nom vide → générique", () => {
    const c = make();
    const id = c.addVoice(new Blob(["v"]), "audio/webm", true, { peaks: [0.5], ms: 1000 })!;
    const v = () => c.items.find((i) => i.id === id)!;
    expect(v()).toMatchObject({ base: "Mémo vocal 1", ext: ".webm" });
    expect(c.rename(id, "a/b")).toBe("interdit");
    expect(c.rename(id, "x".repeat(116))).toBe("trop_long"); // 116 + « .webm » = 121
    expect(c.rename(id, "Réunion\u200b du lundi")).toBeNull();
    expect(v().base).toBe("Réunion du lundi");
    const api = c.toApiItems().find((i) => i.data === v().data)!;
    expect(api.name).toBe("Réunion du lundi.webm");
    for (const empty of ["", "   ", "\u200b", "..."]) {
      c.rename(id, "Autre");
      expect(c.rename(id, empty)).toBeNull();
      expect(v().base).toBe("Mémo vocal 1");
    }
    expect(c.toApiItems().find((i) => i.data === v().data)!.name).toBe("Mémo vocal 1.webm");
  });
});

describe("nettoyage à la demande (menu « … » : Nettoyer, Réessayer)", () => {
  const head = async (f: Blob) => new Uint8Array(await f.slice(0, 64).arrayBuffer());
  const realJpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])], "IMG_1.jpg", { type: "image/jpeg" });
  it("Original (réglage désactivé) → Nettoyer : contenu remplacé, approuvé, « Nettoyé »", async () => {
    let on = false;
    const out = new Blob(["clean"]);
    const strip = vi.fn(async () => nettoye(out));
    const c = make({ strip, autoClean: () => on, probe: head });
    await c.add([realJpeg()], "fichiers");
    const it = c.items[0]!;
    expect(canClean(it)).toBe("nettoyer");
    await c.clean(it.id);
    expect(strip).toHaveBeenCalledTimes(1);
    expect(c.items[0]).toMatchObject({ id: it.id, clean: "nettoye", size: out.size });
    expect(c.items[0]!.data).toBe(out);
    await expect(gate(out)).resolves.toBe(out);
    expect(canClean(c.items[0]!)).toBeNull();
    expect(c.isCleaning(it.id)).toBe(false);
    on = true;
  });
  it("échec → Réessayer ; vocal et vidéo pris ici : `recorded` ; archive, texte, nettoyé : rien à proposer", async () => {
    let n = 0;
    const strip = vi.fn(async (): Promise<StripResult> => (++n === 1 ? { state: "echec", reason: "x" } : nettoye(new Blob(["ok"]))));
    const c = make({ strip });
    await c.add([jpeg()], "fichiers");
    expect(canClean(c.items[0]!)).toBe("reessayer");
    await c.clean(c.items[0]!.id);
    expect(c.items[0]!.clean).toBe("nettoye");
    const vs = vi.fn(async (_f: Blob, _m: string, _n: string, _o?: { recorded?: boolean }) => nettoye(new Blob(["v"])));
    const v = make({ strip: vs });
    const id = v.addVoice(new Blob(["raw"]), "audio/webm", false)!;
    await v.clean(id);
    expect(v.items[0]).toMatchObject({ clean: "nettoye", cleanFamily: "vocal" });
    expect(vs.mock.calls[0]![3]).toEqual({ recorded: true });
    expect(canClean({ kind: "file", clean: "original", category: "archives", cleanable: false })).toBeNull();
    // Original d'un format que le nettoyage ne traite pas (vidéo importée, texte brut) : rien à proposer.
    const o = make({ autoClean: () => false, probe: head });
    await o.add([new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0])], "film.webm", { type: "video/webm" }), realJpeg()], "fichiers");
    expect(o.items.map((i) => canClean(i))).toEqual(["nettoyer", null]);
    expect(canClean({ kind: "text", clean: "sans", category: "texte" })).toBeNull();
    expect(canClean({ kind: "file", clean: "protege", category: "documents" })).toBeNull();
    expect(canClean({ kind: "file", clean: "non_pris_en_charge", category: "videos" })).toBeNull();
  });
  it("audit I1 : « Nettoyer » en cours → l'envoi est bloqué (raison dite), débloqué à la fin", async () => {
    let release!: () => void;
    const c = make({ autoClean: () => false, probe: head, strip: () => new Promise((r) => (release = () => r(nettoye(new Blob(["x"]))))) });
    await c.add([realJpeg()], "fichiers");
    expect(c.blockReason()).toBeNull();
    const p = c.clean(c.items[0]!.id);
    expect(c.blockReason()).toBe("nettoyage_en_cours");
    release();
    await p;
    expect(c.blockReason()).toBeNull();
  });
  it("retiré pendant le nettoyage : rien n'est réappliqué", async () => {
    let release!: () => void;
    const c = make({ autoClean: () => false, probe: head, strip: () => new Promise((r) => (release = () => r(nettoye(new Blob(["x"]))))) });
    await c.add([realJpeg()], "fichiers");
    const id = c.items[0]!.id;
    const p = c.clean(id);
    expect(c.isCleaning(id)).toBe(true);
    c.remove(id);
    release();
    await p;
    expect(c.items).toHaveLength(0);
    expect(c.isCleaning(id)).toBe(false);
  });
});
