// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { readLink, scrubAddressBar } from "./link";

const KEY = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => 255 - i * 3)).toString("base64url");
const O = "https://shhdrop.example";

describe("readLink (spec §32 : lien à la racine)", () => {
  it("lien de partage et de gestion valides : rend le lien tel que le client l'attend", () => {
    expect(readLink(`${O}/#${KEY}`, "s", "/")).toEqual({ kind: "s", link: `${O}/#${KEY}` });
    expect(readLink(`${O}/#m${KEY}`, "m", "/")).toEqual({ kind: "m", link: `${O}/#m${KEY}` });
  });

  it("sans # ou avec # vide → incomplet", () => {
    expect(readLink(`${O}/`, "s", "/")).toEqual({ kind: "incomplete" });
    expect(readLink(`${O}/#`, "s", "/")).toEqual({ kind: "incomplete" });
  });

  it("clé tronquée ou trop longue, autre chemin, ancien format, adresse illisible → incomplet", () => {
    for (const h of [
      `${O}/#${KEY.slice(0, -1)}`,
      `${O}/#${KEY}A`,
      `${O}/x#${KEY}`,
      `${O}/s/AAAAAAAAAAAAAAAAAAAAAA#${KEY}`,
      `https://u:p@shhdrop.example/#${KEY}`,
      "pas une adresse",
      "",
    ])
      expect(readLink(h, "s", "/"), h).toEqual({ kind: "incomplete" });
  });

  it("requête ignorée (?fbclid= ajouté par Facebook, Messenger, Instagram) : lien valide, rendu sans la requête", () => {
    expect(readLink(`${O}/?fbclid=x#${KEY}`, "s", "/")).toEqual({ kind: "s", link: `${O}/#${KEY}` });
    expect(readLink(`${O}/?a=1&b=2#m${KEY}`, "m", "/")).toEqual({ kind: "m", link: `${O}/#m${KEY}` });
    expect(readLink(`${O}/Shhdrop/?fbclid=x#${KEY}`, "s", "/Shhdrop/")).toEqual({ kind: "s", link: `${O}/#${KEY}` });
    expect(readLink(`${O}/?fbclid=x`, "s", "/")).toEqual({ kind: "incomplete" });
  });

  it("mauvais type : un lien de gestion n'est pas accepté comme lien de partage, ni l'inverse", () => {
    expect(readLink(`${O}/#m${KEY}`, "s", "/")).toEqual({ kind: "incomplete" });
    expect(readLink(`${O}/#${KEY}`, "m", "/")).toEqual({ kind: "incomplete" });
  });

  it("base de dépôt /Shhdrop/ : exigée ; le lien rendu est à la racine de l'origine", () => {
    const local = "http://127.0.0.1:5173";
    expect(readLink(`${local}/Shhdrop/#${KEY}`, "s", "/Shhdrop/")).toEqual({ kind: "s", link: `${local}/#${KEY}` });
    expect(readLink(`${O}/Shhdrop/#m${KEY}`, "m", "/Shhdrop/")).toEqual({ kind: "m", link: `${O}/#m${KEY}` });
    expect(readLink(`${O}/#${KEY}`, "s", "/Shhdrop/")).toEqual({ kind: "incomplete" });
    expect(readLink(`${O}/Shhdropx/#${KEY}`, "s", "/Shhdrop/")).toEqual({ kind: "incomplete" });
    expect(readLink(`${O}/Shhdrop/Shhdrop/#${KEY}`, "s", "/Shhdrop/")).toEqual({ kind: "incomplete" });
  });

  it("base par défaut : celle de Vite (« / » hors démo)", () => {
    expect(readLink(`${O}/#${KEY}`, "s")).toEqual({ kind: "s", link: `${O}/#${KEY}` });
  });
});

describe("scrubAddressBar", () => {
  it("retire le # de l'adresse et de l'entrée d'historique courante, sans en ajouter", () => {
    history.replaceState(null, "", `/#${KEY}`);
    expect(location.hash).toBe(`#${KEY}`);
    const before = history.length;
    expect(scrubAddressBar(history, location.pathname)).toBe(true);
    expect(location.hash).toBe("");
    expect(location.href).not.toContain("#");
    expect(location.pathname).toBe("/");
    expect(history.length).toBe(before);
    expect(history.state).toBeNull();
  });

  it("retire aussi la requête (paramètres de suivi)", () => {
    history.replaceState(null, "", `/?fbclid=x#${KEY}`);
    expect(scrubAddressBar(history, location.pathname)).toBe(true);
    expect(location.search).toBe("");
    expect(location.hash).toBe("");
  });

  it("ce qui n'est pas un chemin nu (#, ?, //, \\, adresse complète) : sans effet, rend false, ne lève jamais", () => {
    history.replaceState(null, "", `/#${KEY}`);
    for (const p of [location.href, `/#${KEY}`, "/?q", "//evil.example/x", "/\\evil.example/x", "/a\\b", "s/x", "", "https://x/s"])
      expect(scrubAddressBar(history, p), p).toBe(false);
    expect(location.hash).toBe(`#${KEY}`); // rien n'a été écrit
  });
});
