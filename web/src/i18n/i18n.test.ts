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

  it("aucune promesse plus forte que le modèle de menaces (spec §2, §18)", () => {
    // Le serveur voit l'adresse IP, les tailles et les heures ; un site piégé reste une limite assumée.
    const banned = [/100\s*%/u, /ne voit rien/iu, /can'?t see/iu, /ne peuvent les lire/iu];
    for (const [lang, d] of [["fr", fr], ["en", en]] as const)
      for (const [k, v] of Object.entries(d))
        for (const re of banned) expect(re.test(v), `${lang} ${k} : « ${v} » contient ${re}`).toBe(false);
  });

  it("aucun nom d'algorithme ni terme technique (UI §20.8)", () => {
    const technical = /argon|\baes\b|gcm|hkdf|hmac|sha-?\d|stream|webcrypto|libsodium|ml-?kem|x25519|\d[\s\u00a0\u202f]*bits?\b|entropie|entropy/iu;
    // Le motif lui-même : « bits » seulement après un nombre (l'anglais « a bit » reste permis).
    for (const bad of ["Argon2id", "AES-256", "SHA-256", "sha256", "HKDF", "STREAM", "ML-KEM", "52\u202fbits", "52 bits", "entropie"])
      expect(technical.test(bad), bad).toBe(true);
    for (const ok of ["a bit longer", "Préparation des clés", "chiffré de bout en bout"])
      expect(technical.test(ok), ok).toBe(false);
    // pages.fr.ts et pages.en.ts (Task 25) rejoindront cette liste.
    for (const [lang, d] of [["fr", fr], ["en", en]] as const)
      for (const [k, v] of Object.entries(d)) {
        expect(technical.test(v), `${lang} ${k} : « ${v} »`).toBe(false);
        expect(/100\s*%\s*(s[eé]curis|secure)/iu.test(v), `${lang} ${k}`).toBe(false);
        expect(/ne voit rien/iu.test(v), `${lang} ${k}`).toBe(false);
      }
  });

  it("partage détruit : texte honnête K7 (UI §20.2), titre d'accueil intact", () => {
    expect(fr["destroyed.body"]).toBe(
      "Ce partage a été détruit. Il a été effacé du serveur. Ce que vous avez déjà enregistré sur cet appareil n'est pas concerné.",
    );
    expect(en["destroyed.body"]).toBe(
      "This share has been destroyed. It has been erased from the server. Anything you already saved on this device is not affected.",
    );
    expect(fr["hero.title"]).toBe("Un lien, un mot de passe, puis plus rien.");
    expect(en["hero.title"]).toBe("One link, one password, then nothing.");
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

  it("un nombre et son unité ne se séparent pas : espace insécable (U+202F en FR, U+00A0 en EN)", () => {
    // Exceptions explicites : clé -> raison. Toute autre clé doit passer.
    const EXCEPTIONS: Record<string, string> = {
      "compose.moved": "phrase d'ordre (« position 2 sur 5 dans … ») : pas une quantité",
    };
    const re = /(\d|\{(?:n|i|u|max)\}) \p{L}/u;
    for (const [lang, d] of [["fr", fr], ["en", en]] as const)
      for (const [k, v] of Object.entries(d)) {
        if (k in EXCEPTIONS) continue;
        expect(v, `${lang} ${k}`).not.toMatch(re);
      }
    // Chiffres lus dans les constantes (benchmark M5) : l'unité suit {n} par une espace insécable.
    expect(fr["compose.gauge.empty"]).toContain("{size} et {n}\u202féléments");
    expect(en["compose.gauge.empty"]).toContain("{size} and {n}\u00a0items");
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
    expect(t("compose.removed", { name: "a.png" })).toBe("a.png supprimé");
    setLang("en");
    expect(t("compose.removed", { name: "a.png" })).toBe("a.png deleted");
  });

  it("ne réinterprète pas les accolades d'une valeur (nom de fichier)", () => {
    setLang("en");
    expect(t("compose.removed", { name: "{name}$&.png" })).toBe("{name}$&.png deleted");
  });

  it("pluriel : suffixe .one / .other selon n et la langue", () => {
    setLang("fr");
    expect(t("open.badPw", { n: 1 })).toContain("1\u202fessai restant");
    expect(t("open.badPw", { n: 3 })).toContain("3\u202fessais restants");
    setLang("en");
    expect(t("open.badPw", { n: 1 })).toContain("1\u00a0attempt left");
    expect(t("open.badPw", { n: 2 })).toContain("2\u00a0attempts left");
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

  it("les clés héritées d'Object ne se résolvent jamais", () => {
    for (const k of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(t(k as never)).toBe(k);
      expect(t(k as never, { n: 1 })).toBe(k);
    }
    expect(t("compose.removed", { name: "x", __proto__: "y", constructor: "z" } as never)).toBe("x supprimé");
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

  it("précision à la seconde sous 5 min (UI §11), format inchangé à partir de 5 min", () => {
    const P = { precise: true };
    expect(formatDuration(245, "fr", P)).toBe(`4${N}min${N}05${N}s`);
    expect(formatDuration(245, "en", P)).toBe(`4${B}min${B}05${B}s`);
    expect(formatDuration(299, "fr", P)).toBe(`4${N}min${N}59${N}s`);
    expect(formatDuration(240, "fr", P)).toBe(`4${N}min`);
    expect(formatDuration(61, "en", P)).toBe(`1${B}min${B}01${B}s`);
    expect(formatDuration(300, "fr", P)).toBe(`5${N}min`);
    expect(formatDuration(301, "fr", P)).toBe(`6${N}min`);
    expect(formatDuration(15300, "fr", P)).toBe(`4${N}h${N}15`);
    expect(formatDuration(45, "fr", P)).toBe(`45${N}s`);
    expect(formatDuration(245, "fr")).toBe(`5${N}min`); // sans l'option : comme avant
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

describe("décompte et échéance (retours UI4 : deux lignes, date et heure exactes puis décompte)", () => {
  it("formatCountdown : heures et minutes au-dessus d'une heure, minutes et secondes en dessous", async () => {
    const { formatCountdown } = await import("./format");
    const n = " ";
    expect(formatCountdown(23 * 3600 + 50 * 60, "fr")).toBe(`23${n}h${n}50${n}min`);
    expect(formatCountdown(23 * 3600 + 49 * 60 + 1, "fr")).toBe(`23${n}h${n}50${n}min`); // arrondi vers le haut
    expect(formatCountdown(2 * 3600 + 5 * 60, "fr")).toBe(`2${n}h${n}05${n}min`);
    expect(formatCountdown(24 * 3600, "fr")).toBe(`24${n}h`);
    expect(formatCountdown(3600, "fr")).toBe(`1${n}h`);
    expect(formatCountdown(3599, "fr")).toBe(`59${n}min${n}59${n}s`);
    expect(formatCountdown(12 * 60 + 5, "fr")).toBe(`12${n}min${n}05${n}s`);
    expect(formatCountdown(45, "fr")).toBe(`45${n}s`);
    expect(formatCountdown(0, "fr")).toBe(`0${n}s`);
    expect(formatCountdown(12 * 60 + 5, "en")).toBe("12 min 05 s");
    expect(formatCountdown(23 * 3600 + 50 * 60, "en")).toBe("23 h 50 min");
  });
  it("formatEndsAt : « Se termine le 9 nov. à 14 h 32 » (24 h) ; « Ends Nov 9 at 2:32 PM »", async () => {
    const { formatEndsAt } = await import("./format");
    const at = new Date(2026, 10, 9, 14, 32, 10).getTime();
    expect(formatEndsAt(at, "fr")).toBe("Se termine le 9 nov. à 14 h 32");
    expect(formatEndsAt(at, "en").replace(/[  ]/gu, " ")).toBe("Ends Nov 9 at 2:32 PM");
    expect(formatEndsAt(new Date(2026, 0, 3, 9, 5).getTime(), "fr")).toBe("Se termine le 3 janv. à 9 h 05");
  });
});
