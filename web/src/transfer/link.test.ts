import { describe, expect, it } from "vitest";
import { b64u } from "../crypto/encoding";
import { newKLien, newSGestion, randomBytes } from "../crypto/kdf";
import type { KLien, SGestion } from "../crypto/types";
import { MANAGE_FRAGMENT, SHARE_FRAGMENT, SHARE_LINK_SHAPE, SHARE_PW_FRAGMENT, checkOrigin, manageLink, parseLink, shareLink, shareLinkWithPassword, splitPassword } from "./link";

const K = b64u(new Uint8Array(32).fill(1)); // 43 caractères

describe("liens (spec §32 : à la racine, secret après #)", () => {
  it("aller-retour shareLink → parseLink ; longueur = origine + 45", () => {
    const k = newKLien();
    const link = shareLink("https://shhdrop.example", k);
    expect(link).toBe(`https://shhdrop.example/#${b64u(k)}`);
    expect(link.length).toBe("https://shhdrop.example".length + 45);
    expect(link).toMatch(SHARE_LINK_SHAPE);
    expect(shareLink("https://shhdrop.app", k)).toHaveLength(64); // « 64 caractères en tout »
    const p = parseLink(link);
    if (p.kind !== "s") throw new Error("type");
    expect(p).toEqual({ kind: "s", origin: "https://shhdrop.example", kLien: k });
    expect(Object.keys(p)).not.toContain("id"); // l'id se calcule par shareId, jamais lu dans le lien
  });

  it("aller-retour manageLink → parseLink", () => {
    const s = newSGestion();
    const link = manageLink("http://127.0.0.1:4000", s);
    expect(link).toBe(`http://127.0.0.1:4000/#m${b64u(s)}`);
    const p = parseLink(link);
    if (p.kind !== "m") throw new Error("type");
    expect(p.sGestion).toEqual(s);
    expect(link).not.toMatch(SHARE_LINK_SHAPE);
  });

  it("un secret qui commence par « m » reste un lien de partage (longueurs distinctes)", () => {
    const k = `m${K.slice(1)}`;
    expect(parseLink(`https://x.test/#${k}`).kind).toBe("s");
    expect(parseLink(`https://x.test/#m${k}`).kind).toBe("m");
  });

  it("formes de fragment pour le routeur", () => {
    expect(SHARE_FRAGMENT.test(`#${K}`)).toBe(true);
    expect(MANAGE_FRAGMENT.test(`#m${K}`)).toBe(true);
    for (const h of ["", "#", `#${K.slice(1)}`, `#${K}A`, `#m${K.slice(2)}`, `#${K.slice(1)}+`, `#${K} `]) {
      expect(SHARE_FRAGMENT.test(h) || MANAGE_FRAGMENT.test(h), h).toBe(false);
    }
  });

  it("refuse les liens invalides", () => {
    const bad = [
      "pas une url",
      "https://x/", // sans secret
      "https://x/#",
      `https://x/#${K.slice(1)}`, // 42 caractères
      `https://x/#${K}A`, // 44 caractères
      `https://x/#m${K.slice(2)}`, // 42 caractères après « # » (« m » compris)
      `https://x/#m${K}A`, // gestion : 44
      `https://x/#${K.slice(0, 42)}+`, // hors base64url
      `https://x/#${K.slice(0, 42)}=`,
      `https://x/#${K.slice(0, 42)}B`, // non canonique (bits de bourrage)
      `https://x/#${K}=`,
      `https://x/#x${K}`, // préfixe inconnu
      `https://x/x#${K}`, // autre chemin
      `https://x/s#${K}`,
      `https://x/s/AAAAAAAAAAAAAAAAAAAAAA#${K}`, // ancien format : aucune compatibilité
      `https://x/m/AAAAAAAAAAAAAAAAAAAAAA#${K}`,
      `https://x//#${K}`,
      `https://x/Shhdrop/#${K}`, // base de démo hors démo
    ];
    for (const u of bad) expect(() => parseLink(u), u).toThrow("lien_invalide");
  });

  it("requête ignorée (?fbclid= ajouté par les messageries) : le secret est dans le fragment", () => {
    const p = parseLink(`https://x.test/?fbclid=abc&utm=1#${K}`);
    expect(p.kind === "s" && b64u(p.kLien)).toBe(K);
    expect(p.origin).toBe("https://x.test");
  });

  it("base /Shhdrop/ (démo) : chemin exigé, aller-retour", () => {
    const k = newKLien();
    const link = shareLink("https://skoow.github.io", k, "/Shhdrop/");
    expect(link).toBe(`https://skoow.github.io/Shhdrop/#${b64u(k)}`);
    expect(parseLink(link, "/Shhdrop/")).toEqual({ kind: "s", origin: "https://skoow.github.io", kLien: k });
    expect(parseLink(`https://skoow.github.io/Shhdrop#${K}`, "/Shhdrop/").kind).toBe("s");
    const s = newSGestion();
    expect(parseLink(manageLink("https://skoow.github.io", s, "/Shhdrop/"), "/Shhdrop/")).toEqual({
      kind: "m",
      origin: "https://skoow.github.io",
      sGestion: s,
    });
    for (const u of [`https://x/#${K}`, `https://x/Shhdropx/#${K}`, `https://x/Shhdrop/Shhdrop/#${K}`, `https://x/Shhdrop/s#${K}`])
      expect(() => parseLink(u, "/Shhdrop/"), u).toThrow("lien_invalide");
    for (const b of ["", "Shhdrop/", "/Shhdrop", "//", "/a b/"]) {
      expect(() => parseLink(`https://x/#${K}`, b), b).toThrow("base_invalide");
      expect(() => shareLink("https://x.test", newKLien(), b), b).toThrow("base_invalide");
    }
  });

  it("n'accepte http: que pour la boucle locale", () => {
    for (const host of ["localhost", "localhost:8080", "127.0.0.1", "127.0.0.1:4000", "[::1]", "[::1]:4000"]) {
      expect(parseLink(`http://${host}/#${K}`).kind, host).toBe("s");
    }
    for (const host of ["shhdrop.example", "127.0.0.2", "10.0.0.1", "localhost.example", "[::2]"]) {
      expect(() => parseLink(`http://${host}/#${K}`), host).toThrow("lien_invalide");
    }
    for (const proto of ["ftp:", "file:", "javascript:"]) {
      expect(() => parseLink(`${proto}//x/#${K}`), proto).toThrow("lien_invalide");
    }
  });

  it("anti-motif « domaines voisins » : le lien ne porte ni le mot de passe ni rien d'autre que la clé", () => {
    const k = newKLien();
    const link = shareLink("https://shhdrop.app", k);
    const password = "Ab3!xY7#";
    expect(link).not.toContain(password);
    expect(link.slice("https://shhdrop.app/#".length)).toBe(b64u(k));
  });
});

describe("origine (audit F1)", () => {
  it("parseLink rend l'origine et refuse les identifiants dans l'URL", () => {
    expect(parseLink(`https://srv.test:8443/#${K}`).origin).toBe("https://srv.test:8443");
    for (const u of [`https://user:pw@srv.test/#${K}`, `https://user@srv.test/#${K}`, `https://:pw@srv.test/#${K}`]) {
      expect(() => parseLink(u), u).toThrow("lien_invalide");
    }
  });
  it("parseLink rend l'origine du lien : à l'appelant de la comparer à la sienne", () => {
    expect(parseLink(`https://autre.example/#${K}`).origin).toBe("https://autre.example");
  });
  it("checkOrigin : https (http en boucle locale), sans chemin, requête, fragment ni identifiants", () => {
    for (const o of ["https://srv.test", "https://srv.test:8443", "http://localhost:8080", "http://127.0.0.1:4000", "http://[::1]:4000"]) {
      expect(checkOrigin(o), o).toBe(o);
    }
    for (const o of [
      "http://srv.test/", // cas de l'audit : donnait http://srv.test//…
      "https://srv.test/",
      "https://srv.test/app",
      "https://srv.test?x=1",
      "https://srv.test#x",
      "https://u:p@srv.test",
      "http://srv.test",
      "ftp://srv.test",
      "srv.test",
      "",
      "HTTPS://SRV.TEST", // forme non canonique
    ]) {
      expect(() => checkOrigin(o), o).toThrow("origine_invalide");
    }
  });
  it("shareLink et manageLink valident l'origine", () => {
    expect(() => shareLink("http://srv.test/", randomBytes(32) as KLien)).toThrow("origine_invalide");
    expect(() => manageLink("https://srv.test/x", randomBytes(32) as SGestion)).toThrow("origine_invalide");
  });
});

describe("lien + mot de passe du QR code (D41-29)", () => {
  const k = new Uint8Array(32).fill(7) as unknown as Parameters<typeof shareLink>[1];
  const link = shareLink("https://shhdrop.test", k);
  const PW = "aC3!cD5?#Fg";
  it("format : #<K_lien>.<base64url de l'UTF-8 du mot de passe>, aller-retour exact", () => {
    const q = shareLinkWithPassword(link, PW);
    expect(q).toBe(`${link}.YUMzIWNENT8jRmc`);
    expect(new URL(q).hash).toMatch(SHARE_PW_FRAGMENT);
    expect(new URL(q).hash).not.toMatch(SHARE_FRAGMENT);
    expect(splitPassword(q)).toEqual({ href: link, password: PW });
    expect(parseLink(splitPassword(q).href)).toMatchObject({ kind: "s" });
    expect(() => shareLinkWithPassword(link, "")).toThrow();
    expect(() => shareLinkWithPassword(manageLink("https://shhdrop.test", k as never), PW)).toThrow();
  });
  it("analyse robuste : mot de passe absent, mal formé, non canonique ou UTF-8 invalide → null, le lien simple reste", () => {
    expect(splitPassword(link)).toEqual({ href: link, password: null });
    for (const bad of [".", ".a", ".!!", ".YUMzIWNENT8jRmc=", ".gA", ".YUMzIWNENT8jRmd", "." + "a".repeat(65), ".YUMz.IWNE"]) {
      expect(splitPassword(link + bad), bad).toEqual({ href: link, password: null });
    }
    expect(splitPassword("pas une url")).toEqual({ href: "pas une url", password: null });
    expect(splitPassword("https://shhdrop.test/#m" + "A".repeat(43))).toEqual({ href: "https://shhdrop.test/#m" + "A".repeat(43), password: null });
  });
});
