// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { readShare, readLink, scrubAddressBar } from "./link";

const KEY = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => 255 - i * 3)).toString("base64url");
const O = "https://shhdrop.example";

describe("readLink (spec §32 : lien à la racine)", () => {
  it("lien de partage et de gestion valides : rend le lien tel que le client l'attend", () => {
    expect(readLink(`${O}/#${KEY}`, "s", "/")).toEqual({ kind: "s", link: `${O}/#${KEY}` });
    expect(readLink(`${O}/#m${KEY}`, "m", "/")).toEqual({ kind: "m", link: `${O}/#m${KEY}` });
  });

  it("clé de partage qui commence par « m » (une fois sur 64) : partage, pas gestion ni « incomplet »", () => {
    const mKey = "m" + KEY.slice(1);
    expect(readLink(`${O}/#${mKey}`, "s", "/")).toEqual({ kind: "s", link: `${O}/#${mKey}` });
    expect(readLink(`${O}/#m${mKey}`, "m", "/")).toEqual({ kind: "m", link: `${O}/#m${mKey}` });
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
    expect(readLink(`${O}/shhdrop/?fbclid=x#${KEY}`, "s", "/shhdrop/")).toEqual({ kind: "s", link: `${O}/#${KEY}` });
    expect(readLink(`${O}/?fbclid=x`, "s", "/")).toEqual({ kind: "incomplete" });
  });

  it("mauvais type : un lien de gestion n'est pas accepté comme lien de partage, ni l'inverse", () => {
    expect(readLink(`${O}/#m${KEY}`, "s", "/")).toEqual({ kind: "incomplete" });
    expect(readLink(`${O}/#${KEY}`, "m", "/")).toEqual({ kind: "incomplete" });
  });

  it("base de dépôt /shhdrop/ : exigée ; le lien rendu est à la racine de l'origine", () => {
    const local = "http://127.0.0.1:5173";
    expect(readLink(`${local}/shhdrop/#${KEY}`, "s", "/shhdrop/")).toEqual({ kind: "s", link: `${local}/#${KEY}` });
    expect(readLink(`${O}/shhdrop/#m${KEY}`, "m", "/shhdrop/")).toEqual({ kind: "m", link: `${O}/#m${KEY}` });
    expect(readLink(`${O}/#${KEY}`, "s", "/shhdrop/")).toEqual({ kind: "incomplete" });
    expect(readLink(`${O}/shhdropx/#${KEY}`, "s", "/shhdrop/")).toEqual({ kind: "incomplete" });
    expect(readLink(`${O}/shhdrop/shhdrop/#${KEY}`, "s", "/shhdrop/")).toEqual({ kind: "incomplete" });
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

describe("readShare : lien + mot de passe du QR code (D41-29)", () => {
  it("sépare le mot de passe, rend le lien simple ; mal formé ou absent → null ; autre type → incomplet", () => {
    const pw = "aC3!cD5?#Fg";
    const enc = btoa(pw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    expect(readShare(`${O}/#${KEY}.${enc}`, "/")).toEqual({ state: { kind: "s", link: `${O}/#${KEY}` }, password: pw });
    expect(readShare(`${O}/#${KEY}`, "/")).toEqual({ state: { kind: "s", link: `${O}/#${KEY}` }, password: null });
    expect(readShare(`${O}/#${KEY}.%%`, "/")).toEqual({ state: { kind: "s", link: `${O}/#${KEY}` }, password: null });
    expect(readShare(`${O}/#m${KEY}.${enc}`, "/")).toEqual({ state: { kind: "incomplete" }, password: null });
  });
});
