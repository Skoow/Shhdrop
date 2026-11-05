// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { href, match, navigate, router } from "./router.svelte";

describe("match", () => {
  it("accueil et pages fixes", () => {
    expect(match("/")).toEqual({ name: "home" });
    expect(match("/securite")).toEqual({ name: "securite" });
    expect(match("/confidentialite")).toEqual({ name: "confidentialite" });
  });

  it("ouverture et gestion : identifiant base64url", () => {
    expect(match("/s/AbC_-1")).toEqual({ name: "open", id: "AbC_-1" });
    expect(match("/m/xyz")).toEqual({ name: "manage", id: "xyz" });
  });

  it("adresses inconnues ou mal formées", () => {
    for (const p of ["/s/", "/s", "/s/a/b", "/m/", "/m/a/b", "/s/a b", "/s/a%2Fb", "/inconnu", "/securite/x", "//", "/s/é"])
      expect(match(p), p).toEqual({ name: "notfound" });
  });

  it("avec une base de dépôt (démo)", () => {
    const base = "/Shhdrop/";
    expect(match("/Shhdrop/s/x", base)).toEqual({ name: "open", id: "x" });
    expect(match("/Shhdrop/", base)).toEqual({ name: "home" });
    expect(match("/Shhdrop", base)).toEqual({ name: "home" });
    expect(match("/Shhdrop/securite", base)).toEqual({ name: "securite" });
    expect(match("/s/x", base)).toEqual({ name: "notfound" });
    expect(match("/", base)).toEqual({ name: "notfound" });
    expect(match("/Shhdropx/s/x", base)).toEqual({ name: "notfound" });
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
    for (const p of ["//evil.example/x", "https://evil.example/", "securite", "/\\evil", "/a#k", "/s/x?y=1"])
      expect(() => navigate(p), p).toThrow();
    expect(location.pathname).toBe("/");
  });

  it("revient en arrière : popstate resynchronise la route", () => {
    navigate("/confidentialite");
    history.replaceState(null, "", "/m/abc");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(router.current).toEqual({ name: "manage", id: "abc" });
    navigate("/");
  });

  it("href préfixe la base", () => {
    expect(href("/securite")).toBe("/securite");
  });
});
