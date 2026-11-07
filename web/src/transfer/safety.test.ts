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
  it("retire les caractères de largeur nulle et les étiquettes (tâche M, point 4)", () => {
    expect(safeName("a\u200Bb\u200C\u200D\u2060c.txt")).toBe("abc.txt");
    expect(safeName("fac\u{E0041}\u{E0000}\u{E007F}ture.pdf")).toBe("facture.pdf");
    expect(safeName("\u200B\u200C\u200D\u2060\u{E0041}")).toBe("fichier");
    expect(safeName("\u200Bx.exe")).toBe("x.exe");
    // Le retrait précède la normalisation : e + largeur nulle + accent → « é » composé.
    expect(safeName("e\u200B\u0301.txt")).toBe("\u00E9.txt");
  });
  it("retire aussi U+FEFF, U+2061–U+2064, U+180E, U+00AD, U+034F ; ZWJ gardé seulement entre deux emoji", () => {
    for (const c of ["\uFEFF", "\u2061", "\u2062", "\u2063", "\u2064", "\u180E", "\u00AD", "\u034F"]) {
      expect(safeName(`fac${c}ture.pdf`), JSON.stringify(c)).toBe("facture.pdf");
    }
    expect(safeName("fac\u00ADture")).toBe("facture");
    const family = "👨\u200D👩\u200D👧";
    expect(safeName(`${family}.png`)).toBe(`${family}.png`);
    expect([...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(safeName(family))].length).toBe(1);
    expect(safeName("👩🏽\u200D💻.txt")).toBe("👩🏽\u200D💻.txt"); // avec modificateur de teinte
    expect(safeName("❤\uFE0F\u200D🔥.txt")).toBe("❤\uFE0F\u200D🔥.txt"); // avec sélecteur de variante
    expect(safeName("a\u200Db")).toBe("ab");
    expect(safeName("a\u200D👩")).toBe("a👩"); // avant : pas un emoji
    expect(safeName("👩\u200Db")).toBe("👩b"); // après : pas un emoji
    expect(safeName("👩\u200D\u200D👧")).toBe("👩👧"); // deux ZWJ de suite
  });
  it("retire tout caractère ignorable par défaut ; U+FE0F gardé seulement après un emoji (revue M, m1)", () => {
    expect(safeName("x.ex\uFE00e")).toBe("x.exe");
    expect(safeName("x.ex\uFE0Fe")).toBe("x.exe"); // sélecteur de variante après une lettre
    expect(safeName("doc\u3164\u3164\uFFA0\u115F\u1160.pdf")).toBe("doc.pdf"); // remplissages hangul
    expect(safeName("a\u{E0100}\u180B\u2065\u206Fb")).toBe("ab");
    const family = "👨\u200D👩\u200D👧";
    expect(safeName(family)).toBe(family);
    expect(safeName("❤\uFE0F.txt")).toBe("❤\uFE0F.txt");
  });
  it("jamais de point initial après la coupe : repli « fichier » devant l'extension (revue M, I1)", () => {
    const hostile = "a" + "\u0301".repeat(200) + ".exe"; // un seul graphème de 201 points de code
    expect(safeName(hostile)).toBe("fichier.exe");
    expect(isRiskyName(safeName(hostile))).toBe(true);
    for (const n of [hostile, "a" + "\u0301".repeat(200), "a" + "\u0301".repeat(200) + ".tar.gz", ".exe", "...x.exe"]) {
      expect(safeName(n).startsWith("."), JSON.stringify(n.slice(0, 8))).toBe(false);
    }
    expect(safeName("a" + "\u0301".repeat(200))).toBe("fichier");
    expect(safeName(".exe")).toBe("exe");
  });
  it("coupe par graphème, sans jamais dépasser 120 points de code (tâche M, point 4)", () => {
    // « x » + accent combinant (sans forme composée) : 2 points de code, 1 graphème.
    const g = "x\u0301";
    expect(safeName("a".repeat(119) + g + "b".repeat(50))).toBe("a".repeat(119));
    expect(safeName("a".repeat(118) + g + "b".repeat(50))).toBe("a".repeat(118) + g);
    expect(safeName("a".repeat(119) + "🇫🇷" + "b".repeat(50))).toBe("a".repeat(119)); // drapeau : 2 points de code
    expect(safeName("a".repeat(119) + "👍🏽" + "b".repeat(50))).toBe("a".repeat(119)); // peau : 2 points de code
    // Extension gardée : la tête est coupée avant un graphème qui ne tient pas.
    expect(safeName("a".repeat(115) + "🇫🇷" + "b".repeat(30) + ".png")).toBe("a".repeat(115) + ".png");
    expect(safeName("a".repeat(200) + ".png")).toBe("a".repeat(116) + ".png");
    for (const n of [g.repeat(100), "🇫🇷".repeat(100) + ".png", "a".repeat(119) + g + ".jpeg"]) {
      expect([...safeName(n)].length, n).toBeLessThanOrEqual(120);
    }
  });
  it("repli « fichier »", () => {
    for (const n of ["", "   ", "...", "/", "‮\u0000", "./../"]) expect(safeName(n), JSON.stringify(n)).toBe("fichier");
  });
});

describe("previewKindOf", () => {
  it("liste blanche des types MIME", () => {
    for (const m of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic"]) {
      expect(previewKindOf(file("x", m)), m).toBe("image");
    }
    // Scan de sécurité du 7 novembre : rien qui puisse porter un script n'est jamais affiché
    // (SVG, HTML, XML et variantes) : téléchargement seulement.
    for (const m of ["image/svg+xml", "IMAGE/SVG+XML", "image/svg+xml; charset=utf-8", "text/xml", "application/xml", "image/svg", "text/xsl", "application/xslt+xml", "message/rfc822", "multipart/related", "application/x-mimearchive"]) {
      expect(previewKindOf(file("x", m)), m).toBe("none");
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
    for (const e of ["exe", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "jar", "apk", "app", "dmg", "pkg", "sh", "html", "htm", "hta", "lnk", "iso", "msix", "appx", "reg", "wsf", "cpl", "pif", "url", "command", "desktop"]) {
      expect(isRiskyName(`f.${e}`), e).toBe(true);
      expect(isRiskyName(`f.${e.toUpperCase()}`), e).toBe(true);
    }
    // Ouverts localement dans un navigateur, leur script s'exécute (scan du 7 novembre, F4 en partie).
    for (const e of ["svg", "svgz", "xhtml", "xht", "mht", "mhtml"]) expect(isRiskyName(`f.${e}`), e).toBe(true);
    // Images disque, OneNote, aide compilée, macros Office, raccourcis et scripts Windows (audit F4).
    for (const e of ["img", "vhd", "vhdx", "one", "chm", "mht", "mhtml", "svg", "xlsm", "docm", "pptm", "xlam", "ppam", "iqy", "slk", "lnk", "scf", "hta", "jse", "vbe", "ps1", "psm1", "appref-ms", "application", "gadget", "msc", "settingcontent-ms"]) {
      expect(isRiskyName(`facture.${e}`), e).toBe(true);
      expect(isRiskyName(`facture.${e.toUpperCase()}`), e).toBe(true);
    }
    for (const n of ["photo.jpeg", "tableur.xlsx", "texte.docx", "diapo.pptx", "x.ms", "x.imgs"]) expect(isRiskyName(n), n).toBe(false);
    expect(isRiskyName(".exe")).toBe(true); // nom qui commence par le point : aussi
    expect(isRiskyName(".bashrc")).toBe(false);
    for (const n of ["photo.jpg", "doc.pdf", "exe", "notes.txt", "fichier"]) expect(isRiskyName(n), n).toBe(false);
    expect(isRiskyName(safeName("../../facture‮fdp.exe\u0000"))).toBe(true);
    expect(isRiskyName(safeName("x.exe. "))).toBe(true);
  });
});
