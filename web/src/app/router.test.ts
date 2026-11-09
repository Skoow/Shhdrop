// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { href, match, navigate, router } from "./router.svelte";

const KEY = "A".repeat(42) + "Q"; // 43 caractères base64url (forme seulement)

describe("match", () => {
  it("accueil et pages fixes", () => {
    expect(match("/")).toEqual({ name: "home" });
    expect(match("/securite")).toEqual({ name: "securite" });
    expect(match("/confidentialite")).toEqual({ name: "confidentialite" });
  });

  it("spec §41.4 : rechargement d'une ouverture déverrouillée (marque + octroi gardé) → ouverture ; sinon accueil", () => {
    expect(match("/", "", "/", true)).toEqual({ name: "open" });
    expect(match("/", "", "/", false)).toEqual({ name: "home" });
    expect(match("/securite", "", "/", true)).toEqual({ name: "securite" });
  });

  it("spec §32 : « / » + fragment de partage ou de gestion → ouverture ou gestion ; la clé n'est pas gardée", () => {
    expect(match("/", `#${KEY}`)).toEqual({ name: "open" });
    expect(match("/", `#m${KEY}`)).toEqual({ name: "manage" });
    expect(JSON.stringify(match("/", `#${KEY}`))).not.toContain(KEY);
  });
  it("D41-29 : lien du QR code (« #<K_lien>.<mot de passe> », même mal formé) → ouverture", () => {
    expect(match("/", `#${KEY}.YUMzIWNENT8jRmc`)).toEqual({ name: "open" });
    expect(match("/", `#${KEY}.%%`)).toEqual({ name: "open" });
    expect(match("/", `#${KEY}.`)).toEqual({ name: "open" });
  });

  it("fragment sans rapport avec une clé → accueil (App retire ensuite le « # »)", () => {
    for (const h of ["", "#", "#contenu", `#${KEY.slice(0, 19)}`, `#m${KEY}A`, `#${KEY.slice(1)}+`, `#${KEY.slice(0, 30)}é`])
      expect(match("/", h), h).toEqual({ name: "home" });
  });

  it("fragment de 20 à 44 caractères qui n'est pas une clé valide → ouverture, qui dira « Lien incomplet » (ruling 2)", () => {
    for (const h of [`#${KEY.slice(0, 20)}`, `#${KEY.slice(1)}`, `#${KEY}A`, `#m${KEY.slice(2)}`, `#x${KEY}`])
      expect(match("/", h), h).toEqual({ name: "open" });
    expect(match("/Shhdrop/", `#${KEY.slice(0, 30)}`, "/Shhdrop/")).toEqual({ name: "open" });
  });

  it("fragment de bonne forme ailleurs qu'à la racine : pas d'ouverture", () => {
    expect(match("/securite", `#${KEY}`)).toEqual({ name: "securite" });
    expect(match("/x", `#${KEY}`)).toEqual({ name: "notfound" });
  });

  it("anciens liens /s/{id}, /m/{id} (aucune compatibilité) et adresses inconnues → 404", () => {
    for (const p of ["/s/AbC_-1", "/m/xyz", "/s/", "/s", "/s/a/b", "/inconnu", "/securite/x", "//", "/s/é"]) {
      expect(match(p), p).toEqual({ name: "notfound" });
      expect(match(p, `#${KEY}`), p).toEqual({ name: "notfound" });
    }
  });

  it("avec une base de dépôt (démo)", () => {
    const base = "/Shhdrop/";
    expect(match("/Shhdrop/", `#${KEY}`, base)).toEqual({ name: "open" });
    expect(match("/Shhdrop", `#m${KEY}`, base)).toEqual({ name: "manage" });
    expect(match("/Shhdrop/", "", base)).toEqual({ name: "home" });
    expect(match("/Shhdrop", "", base)).toEqual({ name: "home" });
    expect(match("/Shhdrop/securite", "", base)).toEqual({ name: "securite" });
    expect(match("/", `#${KEY}`, base)).toEqual({ name: "notfound" });
    expect(match("/Shhdropx/", `#${KEY}`, base)).toEqual({ name: "notfound" });
  });
});

describe("navigate", () => {
  it("met à jour l'adresse et la route, sans rechargement", () => {
    navigate("/securite");
    expect(location.pathname).toBe("/securite");
    expect(router.current).toEqual({ name: "securite" });
    navigate("/");
    expect(router.current).toEqual({ name: "home" });
  });

  it("refuse tout ce qui n'est pas un chemin interne", () => {
    for (const p of ["//evil.example/x", "https://evil.example/", "securite", "/\\evil", "/a#k", "/s/x?y=1", `/#${KEY}`])
      expect(() => navigate(p), p).toThrow();
    expect(location.pathname).toBe("/");
  });

  it("popstate resynchronise la route, fragment compris (lien collé dans la barre)", () => {
    navigate("/confidentialite");
    history.replaceState(null, "", `/#m${KEY}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(router.current).toEqual({ name: "manage" });
    history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(router.current).toEqual({ name: "home" });
  });

  it("popstate sans changement de route : router.current n'est pas réaffecté (ni focus volé)", () => {
    navigate("/securite");
    const before = router.current;
    history.replaceState(null, "", "/securite#ancre");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(router.current).toBe(before);
    navigate("/confidentialite");
    expect(router.current).not.toBe(before);
    navigate("/");
  });

  it("href préfixe la base", () => {
    expect(href("/securite")).toBe("/securite");
  });
});
