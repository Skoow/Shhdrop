// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "./en";
import { fr } from "./fr";
import { formatBytes, formatDuration, formatRate, plural } from "./format";
import { detectLang, getLang, setLang, t } from "./i18n.svelte";

const NNBSP = " ";

describe("dictionnaires", () => {
  it("mêmes clés en FR et EN, aucune valeur vide", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
    for (const [k, v] of Object.entries(fr)) expect(v.trim(), `fr ${k}`).not.toBe("");
    for (const [k, v] of Object.entries(en)) expect(v.trim(), `en ${k}`).not.toBe("");
  });

  it("mêmes paramètres {…} dans les deux langues", () => {
    const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(fr) as (keyof typeof fr)[]) expect(params(en[k]), k).toEqual(params(fr[k]));
  });

  it("FR : espace fine insécable avant : ; ! ? (jamais d'espace ordinaire ni rien)", () => {
    for (const [k, v] of Object.entries(fr)) {
      for (const m of v.matchAll(/(.)([:;!?])/g)) {
        // « : » dans une heure ou un paramètre n'existe pas ici ; toute ponctuation haute est précédée de U+202F
        expect(m[1], `${k} : « ${v} »`).toBe(NNBSP);
      }
    }
  });

  it("jamais « ≈ » ni « 100 % sécurisé »", () => {
    for (const d of [fr, en])
      for (const [k, v] of Object.entries(d)) {
        expect(v, k).not.toContain("≈");
        expect(v, k).not.toMatch(/100\s*%\s*(s[eé]curis|secure)/i);
      }
  });
});

describe("t et langue", () => {
  afterEach(() => setLang("fr"));

  it("remplace les paramètres nommés", () => {
    setLang("fr");
    expect(t("compose.removed", { name: "a.png" })).toBe("a.png retiré");
    setLang("en");
    expect(t("compose.removed", { name: "a.png" })).toBe("a.png removed");
  });

  it("ne réinterprète pas les accolades d'une valeur (nom de fichier)", () => {
    setLang("en");
    expect(t("compose.removed", { name: "{name}$&.png" })).toBe("{name}$&.png removed");
  });

  it("pluriel : suffixe .one / .other selon n et la langue", () => {
    setLang("fr");
    expect(t("open.badPw", { n: 1 })).toContain("1 essai restant");
    expect(t("open.badPw", { n: 3 })).toContain("3 essais restants");
    setLang("en");
    expect(t("open.badPw", { n: 1 })).toContain("1 attempt left");
    expect(t("open.badPw", { n: 2 })).toContain("2 attempts left");
  });

  it("setLang met à jour <html lang> et ne stocke rien", () => {
    setLang("en");
    expect(document.documentElement.lang).toBe("en");
    expect(getLang()).toBe("en");
    setLang("fr");
    expect(document.documentElement.lang).toBe("fr");
    expect(localStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });

  it("detectLang : la première langue fr ou en décide ; sinon français", () => {
    expect(detectLang(["en-US", "fr"])).toBe("en");
    expect(detectLang(["fr-FR", "en"])).toBe("fr");
    expect(detectLang(["de", "fr-CH", "en"])).toBe("fr");
    expect(detectLang(["de", "EN-gb"])).toBe("en");
    expect(detectLang(["FR-be"])).toBe("fr");
    expect(detectLang(["de"])).toBe("fr");
    expect(detectLang([])).toBe("fr");
    expect(detectLang(["frobnicate", "en"])).toBe("en");
    expect(detectLang(["english"])).toBe("fr");
  });

  it("une clé inconnue se voit (jamais de texte vide)", () => {
    expect(t("nope.nope" as never)).toBe("nope.nope");
  });
});

describe("formats", () => {
  const N = "\u202f"; // FR : espace fine insécable entre nombre et unité
  const B = "\u00a0"; // EN : espace insécable

  it("durées FR (U+202F)", () => {
    expect(formatDuration(4 * 3600 + 15 * 60, "fr")).toBe(`4${N}h${N}15`);
    expect(formatDuration(4 * 3600, "fr")).toBe(`4${N}h`);
    expect(formatDuration(4 * 3600 + 5 * 60, "fr")).toBe(`4${N}h${N}05`);
    expect(formatDuration(12 * 60, "fr")).toBe(`12${N}min`);
    expect(formatDuration(45, "fr")).toBe(`45${N}s`);
    expect(formatDuration(45, "fr", { coarse: true })).toBe("moins d'une minute");
    expect(formatDuration(0, "fr")).toBe("moins d'une minute");
    expect(formatDuration(-3, "fr")).toBe("moins d'une minute");
  });

  it("durées EN (U+00A0)", () => {
    expect(formatDuration(4 * 3600 + 15 * 60, "en")).toBe(`4h${B}15m`);
    expect(formatDuration(4 * 3600, "en")).toBe("4h");
    expect(formatDuration(12 * 60, "en")).toBe(`12${B}min`);
    expect(formatDuration(45, "en")).toBe(`45${B}s`);
    expect(formatDuration(0, "en")).toBe("less than a minute");
    expect(formatDuration(30, "en", { coarse: true })).toBe("less than a minute");
  });

  it("arrondit toujours vers le haut (jamais « 0 » avant l'échéance)", () => {
    expect(formatDuration(0.2, "fr")).toBe(`1${N}s`);
    expect(formatDuration(61, "fr")).toBe(`2${N}min`);
    expect(formatDuration(3601, "fr")).toBe(`1${N}h${N}01`);
  });

  it("tailles", () => {
    expect(formatBytes(34 * 1024 * 1024, "fr")).toBe(`34${N}Mo`);
    expect(formatBytes(1024 ** 3, "fr")).toBe(`1${N}Go`);
    expect(formatBytes(0, "fr")).toBe(`0${N}octet`);
    expect(formatBytes(1, "fr")).toBe(`1${N}octet`);
    expect(formatBytes(5, "fr")).toBe(`5${N}octets`);
    expect(formatBytes(1536, "fr")).toBe(`1,5${N}Ko`);
    expect(formatBytes(1536, "en")).toBe(`1.5${B}KB`);
    expect(formatBytes(0, "en")).toBe(`0${B}bytes`);
    expect(formatBytes(1, "en")).toBe(`1${B}byte`);
    expect(formatBytes(1024 ** 3, "en")).toBe(`1${B}GB`);
    expect(formatBytes(-5, "fr")).toBe(`0${N}octet`);
    expect(formatBytes(Number.NaN, "fr")).toBe(`0${N}octet`);
  });

  it("débits", () => {
    expect(formatRate(4404019, "fr")).toBe(`4,2${N}Mo/s`);
    expect(formatRate(4404019, "en")).toBe(`4.2${B}MB/s`);
    expect(formatRate(0, "fr")).toBe(`0${N}octet/s`);
  });

  it("aucune espace ordinaire dans un nombre suivi d'une unité", () => {
    for (const lang of ["fr", "en"] as const)
      for (const s of [formatDuration(15300, lang), formatDuration(720, lang), formatDuration(45, lang), formatBytes(35651584, lang), formatRate(4404019, lang)])
        expect(s).not.toContain(" ");
  });

  it("pluriels", () => {
    expect(plural("fr", 0)).toBe("one");
    expect(plural("fr", 1)).toBe("one");
    expect(plural("fr", 2)).toBe("other");
    expect(plural("en", 1)).toBe("one");
    expect(plural("en", 0)).toBe("other");
  });
});

describe("annonces", () => {
  it("une annonce par seconde au plus, dans l'ordre", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { announce, onAnnounce, resetAnnounce } = await import("../ui/announce");
    resetAnnounce();
    const got: string[] = [];
    const off = onAnnounce((s) => got.push(s));
    announce("a");
    announce("b");
    announce("c");
    vi.advanceTimersByTime(10);
    expect(got).toEqual(["a"]);
    vi.advanceTimersByTime(1000);
    expect(got).toEqual(["a", "b"]);
    vi.advanceTimersByTime(1000);
    expect(got).toEqual(["a", "b", "c"]);
    off();
    vi.useRealTimers();
  });

  it("la file est bornée : les plus anciennes sont abandonnées", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { announce, onAnnounce, resetAnnounce } = await import("../ui/announce");
    resetAnnounce();
    const got: string[] = [];
    const off = onAnnounce((s) => got.push(s));
    announce("1");
    vi.advanceTimersByTime(10);
    for (const s of ["2", "3", "4", "5", "6"]) announce(s);
    vi.advanceTimersByTime(20_000);
    expect(got[0]).toBe("1");
    expect(got.at(-1)).toBe("6");
    expect(got).toEqual(["1", "4", "5", "6"]);
    off();
    vi.useRealTimers();
  });
});
