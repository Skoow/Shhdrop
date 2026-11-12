// @vitest-environment happy-dom
// Titre de l'onglet (scan UX B9) : « écran · Shhgone », traduit, jamais de secret ; préfixe de la démo.
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "../i18n/i18n.svelte";
import { demoPrefixed, progressTitle, routeTitle, setProgressTitle, setScreenTitle } from "./title";

afterEach(() => setLang("fr"));

describe("titre de l'onglet", () => {
  it("par route, en français et en anglais", () => {
    setLang("fr");
    expect(routeTitle("home")).toBe("Envoyer · Shhgone");
    expect(routeTitle("landing")).toBe("Partage chiffré de bout en bout, sans compte · Shhgone");
    expect(routeTitle("ready")).toBe("Lien prêt · Shhgone");
    expect(routeTitle("open")).toBe("Ouvrir un partage · Shhgone");
    expect(routeTitle("manage")).toBe("Gérer un partage · Shhgone");
    expect(routeTitle("notfound")).toBe("Page introuvable · Shhgone");
    expect(routeTitle("securite")).toBe("Sécurité · Shhgone");
    expect(routeTitle("confidentialite")).toBe("Confidentialité · Shhgone");
    setLang("en");
    expect(routeTitle("home")).toBe("Send · Shhgone");
    expect(routeTitle("ready")).toBe("Link ready · Shhgone");
    expect(routeTitle("open")).toBe("Open a share · Shhgone");
    expect(routeTitle("confidentialite")).toBe("Privacy · Shhgone");
  });
  it("progression : « 42 % · Shhgone », pourcentage d'abord, borné, jamais de nom ; puis le titre de l'écran revient", () => {
    expect(progressTitle(42.7, "fr")).toBe("42\u202f% · Shhgone");
    expect(progressTitle(150, "en")).toBe("100% · Shhgone");
    setScreenTitle("open");
    setProgressTitle(42, "fr");
    expect(document.title).toBe("42\u202f% · Shhgone");
    setProgressTitle(null, "fr");
    expect(document.title).toBe(routeTitle("open"));
  });
  it("setScreenTitle écrit document.title", () => {
    setScreenTitle("sealing");
    expect(document.title).toBe("Envoi en cours · Shhgone");
  });
  it("préfixe de la démo dans la langue de la page, jamais doublé", () => {
    expect(demoPrefixed("Envoyer · Shhgone", "fr")).toBe("Démo · Envoyer · Shhgone");
    expect(demoPrefixed("Send · Shhgone", "en")).toBe("Demo · Send · Shhgone");
    expect(demoPrefixed("Démo · Send · Shhgone", "en")).toBe("Demo · Send · Shhgone");
    expect(demoPrefixed("Demo · Envoyer · Shhgone", "fr")).toBe("Démo · Envoyer · Shhgone");
    expect(demoPrefixed("Démo · x", "fr")).toBe("Démo · x");
  });
});
