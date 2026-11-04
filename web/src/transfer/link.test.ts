import { describe, expect, it } from "vitest";
import { b64u } from "../crypto/encoding";
import { randomBytes } from "../crypto/kdf";
import { manageLink, parseLink, shareLink } from "./link";

const ID = b64u(new Uint8Array(16).fill(7)); // 22 caractères

describe("liens", () => {
  it("aller-retour shareLink → parseLink", () => {
    const k = randomBytes(32);
    const link = shareLink("https://shhdrop.example", ID, k);
    expect(link).toBe(`https://shhdrop.example/s/${ID}#${b64u(k)}`);
    const p = parseLink(link);
    expect(p.kind).toBe("s");
    expect(p.id).toBe(ID);
    expect(p.secret).toEqual(k);
  });

  it("aller-retour manageLink → parseLink", () => {
    const s = randomBytes(32);
    const link = manageLink("http://127.0.0.1:4000", ID, s);
    expect(link).toBe(`http://127.0.0.1:4000/m/${ID}#${b64u(s)}`);
    const p = parseLink(link);
    expect(p.kind).toBe("m");
    expect(p.id).toBe(ID);
    expect(p.secret).toEqual(s);
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
});
