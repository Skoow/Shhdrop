// Liens (spec §32), portés de l'ancien transfer/link.test.ts (Task 11) : parseLink, shareLink et
// manageLink sont ceux du moteur (clé lue et écrite par le moteur, asynchrones) ; les formes, origine
// et mot de passe du QR code ceux de pure.ts. Mêmes cas, mêmes attentes.
import { describe, expect, it } from "vitest";
import { MANAGE_FRAGMENT, SHARE_FRAGMENT, SHARE_LINK_SHAPE, SHARE_PW_FRAGMENT, b64u, checkOrigin, manageLink, newKLien, newSGestion, parseLink, randomBytes, shareLink, shareLinkWithPassword, splitPassword, type KLien, type SGestion } from "./index";

const K = b64u(new Uint8Array(32).fill(1)); // 43 caractères

describe("liens (spec §32 : à la racine, secret après #)", () => {
  it("aller-retour shareLink → parseLink ; longueur = origine + 45", async () => {
    const k = newKLien();
    const link = await shareLink("https://shhdrop.example", k);
    expect(link).toBe(`https://shhdrop.example/#${b64u(k)}`);
    expect(link.length).toBe("https://shhdrop.example".length + 45);
    expect(link).toMatch(SHARE_LINK_SHAPE);
    expect(await shareLink("https://shhdrop.app", k)).toHaveLength(64); // « 64 caractères en tout »
    const p = await parseLink(link);
    if (p.kind !== "s") throw new Error("type");
    expect(p).toEqual({ kind: "s", origin: "https://shhdrop.example", kLien: k });
    expect(Object.keys(p)).not.toContain("id"); // l'id se calcule par shareId, jamais lu dans le lien
  });

  it("aller-retour manageLink → parseLink", async () => {
    const s = newSGestion();
    const link = await manageLink("http://127.0.0.1:4000", s);
    expect(link).toBe(`http://127.0.0.1:4000/#m${b64u(s)}`);
    const p = await parseLink(link);
    if (p.kind !== "m") throw new Error("type");
    expect(p.sGestion).toEqual(s);
    expect(link).not.toMatch(SHARE_LINK_SHAPE);
  });

  it("un secret qui commence par « m » reste un lien de partage (longueurs distinctes)", async () => {
    const k = `m${K.slice(1)}`;
    expect((await parseLink(`https://x.test/#${k}`)).kind).toBe("s");
    expect((await parseLink(`https://x.test/#m${k}`)).kind).toBe("m");
  });

  it("formes de fragment pour le routeur", async () => {
    expect(SHARE_FRAGMENT.test(`#${K}`)).toBe(true);
    expect(MANAGE_FRAGMENT.test(`#m${K}`)).toBe(true);
    for (const h of ["", "#", `#${K.slice(1)}`, `#${K}A`, `#m${K.slice(2)}`, `#${K.slice(1)}+`, `#${K} `]) {
      expect(SHARE_FRAGMENT.test(h) || MANAGE_FRAGMENT.test(h), h).toBe(false);
    }
  });

  it("refuse les liens invalides", async () => {
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
      `https://x/shhdrop/#${K}`, // base de démo hors démo
    ];
    for (const u of bad) await expect(parseLink(u), u).rejects.toThrow("lien_invalide");
  });

  it("requête ignorée (?fbclid= ajouté par les messageries) : le secret est dans le fragment", async () => {
    const p = await parseLink(`https://x.test/?fbclid=abc&utm=1#${K}`);
    expect(p.kind === "s" && b64u(p.kLien)).toBe(K);
    expect(p.origin).toBe("https://x.test");
  });

  it("base /shhdrop/ (démo) : chemin exigé, aller-retour", async () => {
    const k = newKLien();
    const link = await shareLink("https://skoow.github.io", k, "/shhdrop/");
    expect(link).toBe(`https://skoow.github.io/shhdrop/#${b64u(k)}`);
    expect(await parseLink(link, "/shhdrop/")).toEqual({ kind: "s", origin: "https://skoow.github.io", kLien: k });
    expect((await parseLink(`https://skoow.github.io/shhdrop#${K}`, "/shhdrop/")).kind).toBe("s");
    const s = newSGestion();
    expect(await parseLink(await manageLink("https://skoow.github.io", s, "/shhdrop/"), "/shhdrop/")).toEqual({
      kind: "m",
      origin: "https://skoow.github.io",
      sGestion: s,
    });
    for (const u of [`https://x/#${K}`, `https://x/shhdropx/#${K}`, `https://x/shhdrop/shhdrop/#${K}`, `https://x/shhdrop/s#${K}`])
      await expect(parseLink(u, "/shhdrop/"), u).rejects.toThrow("lien_invalide");
    for (const b of ["", "Shhdrop/", "/shhdrop", "//", "/a b/"]) {
      await expect(parseLink(`https://x/#${K}`, b), b).rejects.toThrow("base_invalide");
      await expect(shareLink("https://x.test", newKLien(), b), b).rejects.toThrow("base_invalide");
    }
  });

  it("n'accepte http: que pour la boucle locale", async () => {
    for (const host of ["localhost", "localhost:8080", "127.0.0.1", "127.0.0.1:4000", "[::1]", "[::1]:4000"]) {
      expect((await parseLink(`http://${host}/#${K}`)).kind, host).toBe("s");
    }
    for (const host of ["shhdrop.example", "127.0.0.2", "10.0.0.1", "localhost.example", "[::2]"]) {
      await expect(parseLink(`http://${host}/#${K}`), host).rejects.toThrow("lien_invalide");
    }
    for (const proto of ["ftp:", "file:", "javascript:"]) {
      await expect(parseLink(`${proto}//x/#${K}`), proto).rejects.toThrow("lien_invalide");
    }
  });

  it("anti-motif « domaines voisins » : le lien ne porte ni le mot de passe ni rien d'autre que la clé", async () => {
    const k = newKLien();
    const link = await shareLink("https://shhdrop.app", k);
    const password = "Ab3!xY7#";
    expect(link).not.toContain(password);
    expect(link.slice("https://shhdrop.app/#".length)).toBe(b64u(k));
  });
});

describe("origine (audit F1)", () => {
  it("parseLink rend l'origine et refuse les identifiants dans l'URL", async () => {
    expect((await parseLink(`https://srv.test:8443/#${K}`)).origin).toBe("https://srv.test:8443");
    for (const u of [`https://user:pw@srv.test/#${K}`, `https://user@srv.test/#${K}`, `https://:pw@srv.test/#${K}`]) {
      await expect(parseLink(u), u).rejects.toThrow("lien_invalide");
    }
  });
  it("parseLink rend l'origine du lien : à l'appelant de la comparer à la sienne", async () => {
    expect((await parseLink(`https://autre.example/#${K}`)).origin).toBe("https://autre.example");
  });
  it("checkOrigin : https (http en boucle locale), sans chemin, requête, fragment ni identifiants", async () => {
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
  it("shareLink et manageLink valident l'origine", async () => {
    await expect(shareLink("http://srv.test/", randomBytes(32) as KLien)).rejects.toThrow("origine_invalide");
    await expect(manageLink("https://srv.test/x", randomBytes(32) as SGestion)).rejects.toThrow("origine_invalide");
  });
});

const QR_K = new Uint8Array(32).fill(7) as unknown as Parameters<typeof shareLink>[1];
const QR_LINK = await shareLink("https://shhdrop.test", QR_K);

describe("lien + mot de passe du QR code (D41-29)", () => {
  const k = QR_K;
  const link = QR_LINK;
  const PW = "aC3!cD5?#Fg";
  it("format : #<K_lien>.<base64url de l'UTF-8 du mot de passe>, aller-retour exact", async () => {
    const q = shareLinkWithPassword(link, PW);
    expect(q).toBe(`${link}.YUMzIWNENT8jRmc`);
    expect(new URL(q).hash).toMatch(SHARE_PW_FRAGMENT);
    expect(new URL(q).hash).not.toMatch(SHARE_FRAGMENT);
    expect(splitPassword(q)).toEqual({ href: link, password: PW });
    expect(await parseLink(splitPassword(q).href)).toMatchObject({ kind: "s" });
    expect(() => shareLinkWithPassword(link, "")).toThrow();
    const m = await manageLink("https://shhdrop.test", k as never);
    expect(() => shareLinkWithPassword(m, PW)).toThrow();
  });
  it("analyse robuste : mot de passe absent, mal formé, non canonique ou UTF-8 invalide → null, le lien simple reste", async () => {
    expect(splitPassword(link)).toEqual({ href: link, password: null });
    for (const bad of [".", ".a", ".!!", ".YUMzIWNENT8jRmc=", ".gA", ".YUMzIWNENT8jRmd", "." + "a".repeat(65), ".YUMz.IWNE"]) {
      expect(splitPassword(link + bad), bad).toEqual({ href: link, password: null });
    }
    expect(splitPassword("pas une url")).toEqual({ href: "pas une url", password: null });
    expect(splitPassword("https://shhdrop.test/#m" + "A".repeat(43))).toEqual({ href: "https://shhdrop.test/#m" + "A".repeat(43), password: null });
  });
});
