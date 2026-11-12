import { describe, expect, it } from "vitest";
import { abbr, formatOf, KNOWN_EXTS } from "./formats";
import { fr } from "../i18n/fr";
import { en } from "../i18n/en";

const f = (ext: string, sniffed: Parameters<typeof formatOf>[0]["sniffed"] = null, preview?: Parameters<typeof formatOf>[0]["preview"]) => formatOf({ kind: "file", ext, sniffed, preview });

describe("formatOf", () => {
  it("une étiquette par format, par l'extension", () => {
    const want: [string, string, string][] = [
      ["pdf", "PDF", "pdf"], ["docx", "DOC", "doc"], ["xlsx", "XLS", "sheet"], ["pptx", "PPT", "slides"], ["zip", "ZIP", "archive"],
      ["rar", "RAR", "archive"], ["7z", "7Z", "archive"], ["txt", "TXT", "text"], ["csv", "CSV", "sheet"], ["mp3", "MP3", "audio"],
      ["mp4", "MP4", "video"], ["mov", "MOV", "video"], ["jpeg", "JPG", "image"], ["png", "PNG", "image"], ["heic", "HEIC", "image"],
      ["svg", "SVG", "image"], ["exe", "EXE", "exec"], ["apk", "APK", "exec"], ["iso", "ISO", "disk"], ["ts", "CODE", "code"],
      ["html", "HTML", "code"], ["epub", "EPUB", "book"], ["woff2", "WOFF", "font"],
    ];
    for (const [ext, label, family] of want) expect(f(ext)).toEqual({ label, family });
  });
  it("le contenu l'emporte : exécutable renommé en .jpg, PDF sans extension, image disque", () => {
    expect(f("jpg", "exe")).toEqual({ label: "EXE", family: "exec" });
    expect(f("", "pdf")).toEqual({ label: "PDF", family: "pdf" });
    expect(f("txt", "iso")).toEqual({ label: "ISO", family: "disk" });
    expect(f("png", "jpeg")).toEqual({ label: "JPG", family: "image" });
  });
  it("un document bureautique est un zip : l'extension précise ; un .m4a reste de l'audio", () => {
    expect(f("docx", "zip")).toEqual({ label: "DOC", family: "doc" });
    expect(f("apk", "zip")).toEqual({ label: "APK", family: "exec" });
    expect(f("zip", "zip")).toEqual({ label: "ZIP", family: "archive" });
    expect(f("m4a", "mp4")).toEqual({ label: "M4A", family: "audio" });
    expect(f("bin", "mp4")).toEqual({ label: "MP4", family: "video" });
  });
  it("mémo vocal en WebM ou MP4 : audio dès que le type MIME ou la catégorie le dit (audit D2), vidéo sinon", () => {
    // Composeur : octets lus (webm), type MIME de l'enregistreur, catégorie « audio ».
    expect(formatOf({ kind: "file", ext: "webm", sniffed: "webm", mime: "audio/webm;codecs=opus" })).toEqual({ label: "WEBM", family: "audio" });
    expect(formatOf({ kind: "file", ext: "webm", sniffed: "webm", category: "audio" })).toEqual({ label: "WEBM", family: "audio" });
    expect(formatOf({ kind: "file", ext: "mp4", sniffed: "mp4", mime: "audio/mp4" })).toEqual({ label: "MP4", family: "audio" });
    // Destinataire : pas d'octets lus, la visionneuse permise vient du type MIME du manifeste.
    expect(f("webm", null, "audio")).toEqual({ label: "WEBM", family: "audio" });
    expect(f("mp4", null, "audio")).toEqual({ label: "MP4", family: "audio" });
    // Une vraie vidéo reste une vidéo ; un indice audio ne change pas une famille stricte.
    expect(formatOf({ kind: "file", ext: "webm", sniffed: "webm", mime: "video/webm" })).toEqual({ label: "WEBM", family: "video" });
    expect(f("webm", null, "video")).toEqual({ label: "WEBM", family: "video" });
    expect(formatOf({ kind: "file", ext: "mov", mime: "audio/mp4" })).toEqual({ label: "MOV", family: "video" });
    expect(formatOf({ kind: "file", ext: "webm", sniffed: "exe", mime: "audio/webm" })).toEqual({ label: "EXE", family: "exec" });
  });
  it("inconnu : famille par la visionneuse permise, sinon fichier ; étiquette de 4 caractères au plus", () => {
    expect(f("xyz", null, "image")).toEqual({ label: "XYZ", family: "image" });
    expect(f("", null, "video")).toEqual({ label: "", family: "video" });
    expect(f("verylong")).toEqual({ label: "", family: "file" });
    expect(f("dat")).toEqual({ label: "DAT", family: "file" });
    expect(formatOf({ kind: "text", ext: "" })).toEqual({ label: "", family: "note" });
  });
});

describe("libellé de l'icône (retours UI7)", () => {
  it("4 caractères au plus pour chaque extension connue et chaque libellé générique", () => {
    for (const e of KNOWN_EXTS) expect(f(e).label.length, e).toBeLessThanOrEqual(4);
    for (const d of [fr, en]) for (const [k, v] of Object.entries(d)) if (k.startsWith("format.short.")) expect(v.length, k).toBeLessThanOrEqual(4);
  });
  it("au-delà de 4 caractères : abrégé", () => {
    expect(abbr("pdf")).toBe("PDF");
    expect(abbr("WOFF2")).toBe("WOFF");
    expect(abbr(" epub ")).toBe("EPUB");
  });
});
