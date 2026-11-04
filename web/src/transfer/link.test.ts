import { describe, expect, it } from "vitest";
import { b64u } from "../crypto/encoding";
import { newKLien, newSGestion, randomBytes } from "../crypto/kdf";
import type { KLien, SGestion } from "../crypto/types";
import { checkOrigin, manageLink, parseLink, shareLink } from "./link";

const ID = b64u(new Uint8Array(16).fill(7)); // 22 caractères

describe("liens", () => {
  it("aller-retour shareLink → parseLink", () => {
    const k = newKLien();
    const link = shareLink("https://shhdrop.example", ID, k);
    expect(link).toBe(`https://shhdrop.example/s/${ID}#${b64u(k)}`);
    const p = parseLink(link);
    if (p.kind !== "s") throw new Error("type");
    expect(p.origin).toBe("https://shhdrop.example");
    expect(p.id).toBe(ID);
    expect(p.kLien).toEqual(k);
  });

  it("aller-retour manageLink → parseLink", () => {
    const s = newSGestion();
    const link = manageLink("http://127.0.0.1:4000", ID, s);
    expect(link).toBe(`http://127.0.0.1:4000/m/${ID}#${b64u(s)}`);
    const p = parseLink(link);
    if (p.kind !== "m") throw new Error("type");
    expect(p.id).toBe(ID);
    expect(p.sGestion).toEqual(s);
  });

  it("refuse les liens invalides", () => {
    const k = b64u(new Uint8Array(32).fill(1));
    const bad = [
      "pas une url",
      `https://x/s/${ID}`, // sans secret
      `https://x/s/${ID}#`,
      `https://x/x/${ID}#${k}`, // type inconnu
      `https://x/s/${ID.slice(1)}#${k}`, // id trop court
      `https://x/s/${ID}A#${k}`, // id trop long
      `https://x/s/${ID.slice(0, 21)}+#${k}`, // id hors base64url
      `https://x/s/${ID.slice(0, 21)}B#${k}`, // id non canonique (bits de bourrage)
      `https://x/s/${ID}#${b64u(new Uint8Array(31))}`, // secret de 31 octets
      `https://x/s/${ID}#${b64u(new Uint8Array(33))}`,
      `https://x/s/${ID}#${k}=`,
      `https://x/s/${ID}/#${k}`,
      `https://x/s/${ID}?a=1#${k}`,
      `https://x/a/s/${ID}#${k}`,
    ];
    for (const u of bad) expect(() => parseLink(u), u).toThrow("lien_invalide");
  });

  it("n'accepte http: que pour la boucle locale", () => {
    const k = b64u(new Uint8Array(32).fill(1));
    for (const host of ["localhost", "localhost:8080", "127.0.0.1", "127.0.0.1:4000", "[::1]", "[::1]:4000"]) {
      expect(parseLink(`http://${host}/s/${ID}#${k}`).id, host).toBe(ID);
    }
    for (const host of ["shhdrop.example", "127.0.0.2", "10.0.0.1", "localhost.example", "[::2]"]) {
      expect(() => parseLink(`http://${host}/s/${ID}#${k}`), host).toThrow("lien_invalide");
    }
    for (const proto of ["ftp:", "file:", "javascript:"]) {
      expect(() => parseLink(`${proto}//x/s/${ID}#${k}`), proto).toThrow("lien_invalide");
    }
  });
});

describe("origine (audit F1)", () => {
  const k = b64u(new Uint8Array(32).fill(1));
  it("parseLink rend l'origine et refuse les identifiants dans l'URL", () => {
    expect(parseLink(`https://srv.test:8443/s/${ID}#${k}`).origin).toBe("https://srv.test:8443");
    for (const u of [`https://user:pw@srv.test/s/${ID}#${k}`, `https://user@srv.test/s/${ID}#${k}`, `https://:pw@srv.test/s/${ID}#${k}`]) {
      expect(() => parseLink(u), u).toThrow("lien_invalide");
    }
  });
  it("checkOrigin : https (http en boucle locale), sans chemin, requête, fragment ni identifiants", () => {
    for (const o of ["https://srv.test", "https://srv.test:8443", "http://localhost:8080", "http://127.0.0.1:4000", "http://[::1]:4000"]) {
      expect(checkOrigin(o), o).toBe(o);
    }
    for (const o of [
      "http://srv.test/", // cas de l'audit : donnait http://srv.test//s/…
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
    expect(() => shareLink("http://srv.test/", ID, randomBytes(32) as KLien)).toThrow("origine_invalide");
    expect(() => manageLink("https://srv.test/x", ID, randomBytes(32) as SGestion)).toThrow("origine_invalide");
  });
});
