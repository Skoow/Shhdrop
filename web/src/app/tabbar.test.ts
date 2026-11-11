import { describe, expect, it } from "vitest";
import { currentTab, tabBarVisible, tabBarUseful, TABS } from "./tabbar";

const base = { supported: true, sending: false, composing: false };

describe("barre d'onglets (téléphone)", () => {
  it("décision du propriétaire du 11 novembre (audit M18) : masquée tant qu'un seul onglet fonctionne", () => {
    expect(TABS.filter((t) => !t.soon)).toHaveLength(1);
    expect(tabBarUseful(TABS)).toBe(false);
    for (const route of ["home", "securite", "confidentialite", "notfound"] as const) expect(tabBarVisible({ ...base, route })).toBe(false);
    expect(tabBarUseful([{ id: "send", soon: false }, { id: "shares", soon: false }, { id: "chat", soon: true }])).toBe(true);
  });
  it("une fois utile : visible sur l'accueil, Sécurité, Confidentialité et la 404", () => {
    for (const route of ["home", "securite", "confidentialite", "notfound"] as const) expect(tabBarVisible({ ...base, route }, true)).toBe(true);
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
  it("onglets : Envoyer, Mes partages (bientôt), Salon (bientôt), sans Réglages (pied de page) ; onglet courant", () => {
    expect(TABS.map((t) => `${t.id}${t.soon ? "*" : ""}`)).toEqual(["send", "shares*", "chat*"]);
    expect(currentTab("home")).toBe("send");
    expect(currentTab("securite")).toBeNull();
    expect(currentTab("confidentialite")).toBeNull();
    expect(currentTab("notfound")).toBeNull();
  });
});
