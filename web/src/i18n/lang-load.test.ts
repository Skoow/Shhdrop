// Une seule langue au démarrage : en production, le dictionnaire anglais n'est pas dans le
// script ; il est lu (fetch + integrity) seulement pour un visiteur anglophone, ou à la demande.
// Ici, la source « production » est simulée : rien d'intégré, lecture comptée.
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "./en";

const src = vi.hoisted(() => ({ calls: 0, reply: null as null | (() => Promise<unknown>) }));
vi.mock("./en-source", () => ({
  bundled: undefined,
  fetchEn: () => {
    src.calls++;
    return src.reply ? src.reply() : Promise.resolve(JSON.parse(JSON.stringify(en)));
  },
}));

async function fresh(languages: string[]) {
  vi.resetModules();
  vi.stubGlobal("navigator", { ...navigator, languages });
  src.calls = 0;
  return import("./i18n.svelte");
}
afterEach(() => {
  vi.unstubAllGlobals();
  src.reply = null;
});

describe("langue chargée à la demande", () => {
  it("navigateur en français : aucune lecture du dictionnaire anglais", async () => {
    const m = await fresh(["fr-FR", "en"]);
    await m.langReady;
    expect(src.calls).toBe(0);
    expect(m.getLang()).toBe("fr");
    expect(m.t("hero.pick")).toBe("Choisir des fichiers");
  });

  it("navigateur en anglais : lu une fois avant l'affichage ; html lang=en", async () => {
    const m = await fresh(["en-GB"]);
    await m.langReady;
    expect(src.calls).toBe(1);
    expect(m.getLang()).toBe("en");
    expect(m.t("hero.pick")).toBe(en["hero.pick"]);
    expect(document.documentElement.lang).toBe("en");
  });

  it("autre langue à la demande (setLang) : lue puis appliquée ; une seule lecture", async () => {
    const m = await fresh(["fr"]);
    await m.langReady;
    await m.setLang("en");
    expect(m.getLang()).toBe("en");
    await m.setLang("fr");
    await m.setLang("en");
    expect(src.calls).toBe(1);
  });

  it("lecture en échec ou dictionnaire invalide : on reste en français, sans erreur", async () => {
    for (const reply of [
      () => Promise.reject(new Error("reseau")),
      () => Promise.resolve({ "hero.pick": "x" }), // clés manquantes
      () => Promise.resolve({ ...en, "hero.pick": 1 }), // valeur non texte
      () => Promise.resolve({ ...en, intrus: "x" }), // clé en trop
      () => Promise.resolve([]),
    ]) {
      src.reply = reply;
      const m = await fresh(["en"]);
      await m.langReady;
      expect(m.getLang()).toBe("fr");
      expect(m.t("hero.pick")).toBe("Choisir des fichiers");
    }
  });
});
