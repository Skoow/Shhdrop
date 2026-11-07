// @vitest-environment happy-dom
// Titre de l'onglet (scan UX B9) : « écran · Shhdrop », traduit, jamais de secret ; préfixe de la démo.
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "../i18n/i18n.svelte";
import { demoPrefixed, progressTitle, routeTitle, setProgressTitle, setScreenTitle } from "./title";

afterEach(() => setLang("fr"));

describe("titre de l'onglet", () => {
  it("par route, en français et en anglais", () => {
    setLang("fr");
    expect(routeTitle("home")).toBe("Envoyer · Shhdrop");
    expect(routeTitle("ready")).toBe("Lien prêt · Shhdrop");
    expect(routeTitle("open")).toBe("Ouvrir un partage · Shhdrop");
    expect(routeTitle("manage")).toBe("Gérer un partage · Shhdrop");
    expect(routeTitle("notfound")).toBe("Page introuvable · Shhdrop");
    expect(routeTitle("securite")).toBe("Sécurité · Shhdrop");
    expect(routeTitle("confidentialite")).toBe("Confidentialité · Shhdrop");
    setLang("en");
    expect(routeTitle("home")).toBe("Send · Shhdrop");
    expect(routeTitle("ready")).toBe("Link ready · Shhdrop");
    expect(routeTitle("open")).toBe("Open a share · Shhdrop");
    expect(routeTitle("confidentialite")).toBe("Privacy · Shhdrop");
  });
  it("progression : « 42 % · Shhdrop », pourcentage d'abord, borné, jamais de nom ; puis le titre de l'écran revient", () => {
    expect(progressTitle(42.7, "fr")).toBe("42\u202f% · Shhdrop");
    expect(progressTitle(150, "en")).toBe("100% · Shhdrop");
    setScreenTitle("open");
    setProgressTitle(42, "fr");
    expect(document.title).toBe("42\u202f% · Shhdrop");
    setProgressTitle(null, "fr");
    expect(document.title).toBe(routeTitle("open"));
  });
  it("setScreenTitle écrit document.title", () => {
    setScreenTitle("sealing");
    expect(document.title).toBe("Envoi en cours · Shhdrop");
  });
  it("préfixe de la démo dans la langue de la page, jamais doublé", () => {
    expect(demoPrefixed("Envoyer · Shhdrop", "fr")).toBe("Démo · Envoyer · Shhdrop");
    expect(demoPrefixed("Send · Shhdrop", "en")).toBe("Demo · Send · Shhdrop");
    expect(demoPrefixed("Démo · Send · Shhdrop", "en")).toBe("Demo · Send · Shhdrop");
    expect(demoPrefixed("Demo · Envoyer · Shhdrop", "fr")).toBe("Démo · Envoyer · Shhdrop");
    expect(demoPrefixed("Démo · x", "fr")).toBe("Démo · x");
  });
});
