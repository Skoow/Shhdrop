// Audit M4 : nom et type MIME du manifeste rendus bruts.
import { describe, expect, it } from "vitest";
import type { ManifestEntry } from "../crypto/container";
import { isRiskyName, previewKindOf, safeName } from "./safety";

const file = (name: string, mime: string, size = 10): ManifestEntry => ({ kind: "file", name, mime, size, offset: 0 });
const MIB = 1048576;

describe("safeName", () => {
  it("cas de l'audit : « ../../facture‮fdp.exe\\u0000 »", () => {
    expect(safeName("../../facture‮fdp.exe\u0000")).toBe("facturefdp.exe");
  });
  it("retire inversions de sens, contrôles C0/C1, séparateurs et points initiaux", () => {
    for (const c of ["‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩", "‎", "‏", "؜"]) {
      expect(safeName(`a${c}b.txt`), JSON.stringify(c)).toBe("ab.txt");
    }
    expect(safeName("a\u0001\u001F\u007F\u0080\u009Fb.txt")).toBe("ab.txt");
    expect(safeName("dossier/sous\\fichier.txt")).toBe("dossiersousfichier.txt");
    expect(safeName("...cache")).toBe("cache");
    expect(safeName(". . .x")).toBe("x");
    expect(safeName("  a \t\n  b  .pdf ")).toBe("a b .pdf");
    expect(safeName("facture.exe. . ")).toBe("facture.exe"); // Windows retire les points et espaces finaux
  });
  it("NFC", () => {
    expect(safeName("été.txt")).toBe("été.txt");
  });
  it("au plus 120 points de code, extension gardée", () => {
    const long = "é".repeat(300) + ".jpeg";
    const s = safeName(long);
    expect([...s].length).toBe(120);
    expect(s.endsWith(".jpeg")).toBe(true);
    const noExt = "x".repeat(200);
    expect(safeName(noExt)).toBe("x".repeat(120));
    const hugeExt = "a." + "b".repeat(200);
    expect([...safeName(hugeExt)].length).toBe(120);
    expect([...safeName("😀".repeat(130) + ".png")].length).toBe(120);
  });
  it("repli « fichier »", () => {
    for (const n of ["", "   ", "...", "/", "‮\u0000", "./../"]) expect(safeName(n), JSON.stringify(n)).toBe("fichier");
  });
});

describe("previewKindOf", () => {
  it("liste blanche des types MIME", () => {
    for (const m of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/svg+xml"]) {
      expect(previewKindOf(file("x", m)), m).toBe("image");
    }
    for (const m of ["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "audio/wav"]) expect(previewKindOf(file("x", m)), m).toBe("audio");
    for (const m of ["video/mp4", "video/webm", "video/quicktime"]) expect(previewKindOf(file("x", m)), m).toBe("video");
    expect(previewKindOf(file("x", "application/pdf"))).toBe("pdf");
    expect(previewKindOf(file("x", "IMAGE/PNG"))).toBe("image");
    expect(previewKindOf(file("x", "image/png; charset=x"))).toBe("image");
    for (const m of ["text/html", "application/xhtml+xml", "text/javascript", "application/octet-stream", "image/x-icon", "text/plain", "", "image/png2", " image/png"]) {
      expect(previewKindOf(file("x", m)), m).toBe("none");
    }
  });
  it("texte → « text » ; au-delà de 200 Mio → « none »", () => {
    expect(previewKindOf({ kind: "text", name: "", mime: "text/html", size: 0, offset: 0, text: "<b>" })).toBe("text");
    expect(previewKindOf(file("x", "image/png", 200 * MIB))).toBe("image");
    expect(previewKindOf(file("x", "image/png", 200 * MIB + 1))).toBe("none");
  });
});

describe("isRiskyName", () => {
  it("extensions exécutables ou interprétées", () => {
    for (const e of ["exe", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "jar", "apk", "app", "dmg", "pkg", "sh", "html", "htm", "hta", "lnk", "iso"]) {
      expect(isRiskyName(`f.${e}`), e).toBe(true);
      expect(isRiskyName(`f.${e.toUpperCase()}`), e).toBe(true);
    }
    for (const n of ["photo.jpg", "image.svg", "doc.pdf", "exe", "notes.txt", "fichier"]) expect(isRiskyName(n), n).toBe(false);
    expect(isRiskyName(safeName("../../facture‮fdp.exe\u0000"))).toBe(true);
    expect(isRiskyName(safeName("x.exe. "))).toBe(true);
  });
});
