import { describe, expect, it } from "vitest";
import { currentTab, tabBarVisible, TABS } from "./tabbar";

const base = { supported: true, sending: false, composing: false };

describe("barre d'onglets (téléphone)", () => {
  it("visible sur l'accueil, Sécurité, Confidentialité et la 404", () => {
    for (const route of ["home", "securite", "confidentialite", "notfound"] as const) expect(tabBarVisible({ ...base, route })).toBe(true);
  });
  it("masquée chez le destinataire (ouverture, contenu) et sur la gestion", () => {
    expect(tabBarVisible({ ...base, route: "open" })).toBe(false);
    expect(tabBarVisible({ ...base, route: "manage" })).toBe(false);
  });
  it("masquée pendant un envoi, sur « Lien prêt », pendant la composition, sans prise en charge", () => {
    expect(tabBarVisible({ ...base, route: "home", sending: true })).toBe(false);
    expect(tabBarVisible({ ...base, route: "home", composing: true })).toBe(false);
    expect(tabBarVisible({ ...base, route: "home", supported: false })).toBe(false);
  });
  it("onglets : Envoyer, Mes partages (bientôt), Salon (bientôt), Réglages ; onglet courant", () => {
    expect(TABS.map((t) => `${t.id}${t.soon ? "*" : ""}`)).toEqual(["send", "shares*", "chat*", "settings"]);
    expect(currentTab("home")).toBe("send");
    expect(currentTab("securite")).toBe("settings");
    expect(currentTab("confidentialite")).toBe("settings");
    expect(currentTab("notfound")).toBeNull();
  });
});
