// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { readLink, scrubAddressBar } from "./link";

const ID = Buffer.from(Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 1)).toString("base64url");
const KEY = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => 255 - i * 3)).toString("base64url");
const O = "https://shhdrop.example";

describe("readLink", () => {
  it("lien de partage et de gestion valides : rend le lien tel que parseLink l'attend", () => {
    expect(readLink(`${O}/s/${ID}#${KEY}`, "s", "/")).toEqual({ kind: "s", link: `${O}/s/${ID}#${KEY}` });
    expect(readLink(`${O}/m/${ID}#${KEY}`, "m", "/")).toEqual({ kind: "m", link: `${O}/m/${ID}#${KEY}` });
  });

  it("sans # ou avec # vide → incomplet", () => {
    expect(readLink(`${O}/s/${ID}`, "s", "/")).toEqual({ kind: "incomplete" });
    expect(readLink(`${O}/s/${ID}#`, "s", "/")).toEqual({ kind: "incomplete" });
  });

  it("clé tronquée, identifiant faux, requête, adresse illisible → incomplet", () => {
    for (const h of [
      `${O}/s/${ID}#${KEY.slice(0, -1)}`,
      `${O}/s/${ID}#${KEY}A`,
      `${O}/s/${ID.slice(1)}#${KEY}`,
      `${O}/s/${ID}/#${KEY}`,
      "pas une adresse",
      "",
    ])
      expect(readLink(h, "s", "/"), h).toEqual({ kind: "incomplete" });
  });

  it("requête ignorée (?fbclid= ajouté par Facebook, Messenger, Instagram) : lien valide, rendu sans la requête", () => {
    expect(readLink(`${O}/s/${ID}?fbclid=x#${KEY}`, "s", "/")).toEqual({ kind: "s", link: `${O}/s/${ID}#${KEY}` });
    expect(readLink(`${O}/m/${ID}?a=1&b=2#${KEY}`, "m", "/")).toEqual({ kind: "m", link: `${O}/m/${ID}#${KEY}` });
    expect(readLink(`${O}/Shhdrop/s/${ID}?fbclid=x#${KEY}`, "s", "/Shhdrop/")).toEqual({ kind: "s", link: `${O}/s/${ID}#${KEY}` });
    expect(readLink(`${O}/s/${ID}?fbclid=x`, "s", "/")).toEqual({ kind: "incomplete" });
  });

  it("mauvais préfixe : un lien de gestion n'est pas accepté comme lien de partage, ni l'inverse", () => {
    expect(readLink(`${O}/m/${ID}#${KEY}`, "s", "/")).toEqual({ kind: "incomplete" });
    expect(readLink(`${O}/s/${ID}#${KEY}`, "m", "/")).toEqual({ kind: "incomplete" });
  });

  it("base de dépôt /Shhdrop/ : retirée avant l'analyse, exigée", () => {
    const local = "http://127.0.0.1:5173";
    expect(readLink(`${local}/Shhdrop/s/${ID}#${KEY}`, "s", "/Shhdrop/")).toEqual({
      kind: "s",
      link: `${local}/s/${ID}#${KEY}`,
    });
    expect(readLink(`${O}/Shhdrop/m/${ID}#${KEY}`, "m", "/Shhdrop/")).toEqual({ kind: "m", link: `${O}/m/${ID}#${KEY}` });
    expect(readLink(`${O}/s/${ID}#${KEY}`, "s", "/Shhdrop/")).toEqual({ kind: "incomplete" });
    expect(readLink(`${O}/Shhdropx/s/${ID}#${KEY}`, "s", "/Shhdrop/")).toEqual({ kind: "incomplete" });
    expect(readLink(`${O}/Shhdrop/Shhdrop/s/${ID}#${KEY}`, "s", "/Shhdrop/")).toEqual({ kind: "incomplete" });
  });

  it("base par défaut : celle de Vite (« / » hors démo)", () => {
    expect(readLink(`${O}/s/${ID}#${KEY}`, "s")).toEqual({ kind: "s", link: `${O}/s/${ID}#${KEY}` });
  });
});

describe("scrubAddressBar", () => {
  it("retire le # de l'adresse et de l'entrée d'historique courante, sans en ajouter", () => {
    history.replaceState(null, "", `/s/${ID}#${KEY}`);
    expect(location.hash).toBe(`#${KEY}`);
    const before = history.length;
    expect(scrubAddressBar(history, location.pathname)).toBe(true);
    expect(location.hash).toBe("");
    expect(location.href).not.toContain("#");
    expect(location.pathname).toBe(`/s/${ID}`);
    expect(history.length).toBe(before);
    expect(history.state).toBeNull();
  });

  it("retire aussi la requête (paramètres de suivi)", () => {
    history.replaceState(null, "", `/s/${ID}?fbclid=x#${KEY}`);
    expect(scrubAddressBar(history, location.pathname)).toBe(true);
    expect(location.search).toBe("");
    expect(location.hash).toBe("");
  });

  it("ce qui n'est pas un chemin nu (#, ?, //, \\, adresse complète) : sans effet, rend false, ne lève jamais", () => {
    history.replaceState(null, "", `/s/${ID}#${KEY}`);
    for (const p of [location.href, `/s/${ID}#${KEY}`, `/s/${ID}?q`, "//evil.example/x", "/\\evil.example/x", "/a\\b", "s/x", "", "https://x/s"])
      expect(scrubAddressBar(history, p), p).toBe(false);
    expect(location.hash).toBe(`#${KEY}`); // rien n'a été écrit
  });
});
