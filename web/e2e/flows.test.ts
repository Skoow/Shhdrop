// Parcours complets contre le vrai serveur (binaire Go). Chaque groupe démarre son propre
// serveur : limites, difficulté ALTCHA et clés des jetons vivent en mémoire du serveur.
import { createHash, randomBytes } from "node:crypto";
import { closeSync, mkdtempSync, openAsBlob, openSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { utf8 } from "../src/crypto/encoding";
import type { Item } from "../src/crypto/container";
import { BadPasswordError, NotFoundError, createShare, destroyShare, fetchMeta, openShare, shareStatus } from "../src/transfer/client";
import { parseLink } from "../src/transfer/link";
import { solveAltcha } from "./altcha";
import { startServer, type TestServer } from "./server";

const PW = "cheval-agrafe-pile-correct";
const KIB = 1024;
const MIB = 1024 * KIB;

function pseudo(n: number, seed: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

const textItem = (s: string): Item => ({ kind: "text", name: "", mime: "text/plain", data: utf8(s) });

function useServer(): () => TestServer {
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startServer();
  });
  afterAll(async () => {
    await srv?.dispose();
  });
  return () => srv;
}

const share = (srv: TestServer, items: Item[], maxOpens = 1, extra: Partial<Parameters<typeof createShare>[2]> = {}) =>
  createShare(srv.origin, items, { ttlHours: 1, maxOpens, password: PW, solveCaptcha: solveAltcha, ...extra });

describe("création puis ouverture (texte, image 300 Kio, fichier 5 Mio)", () => {
  const srv = useServer();
  it("contenu identique", async () => {
    const image = pseudo(300 * KIB, 1);
    const fichier = pseudo(5 * MIB, 2);
    const items: Item[] = [
      textItem("Bonjour é😀"),
      { kind: "file", name: "photo.jpg", mime: "image/jpeg", data: image },
      { kind: "file", name: "rapport.bin", mime: "application/octet-stream", data: fichier },
    ];
    const prog: [number, number][] = [];
    const t0 = Date.now();
    const r = await share(srv(), items, 1, { onProgress: (d, t) => prog.push([d, t]) });
    // Le serveur exige ≥ 3 s entre l'affichage du défi et la création : createShare attend.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(3000);
    expect(r.expiresInS).toBeGreaterThan(3500);
    expect(r.expiresInS).toBeLessThanOrEqual(3600 + 900);
    expect(parseLink(r.link).kind).toBe("s");
    expect(parseLink(r.manage).kind).toBe("m");
    expect(prog.at(-1)).toEqual([3, 3]); // 5,3 Mio → palier 160 → 3 segments

    expect((await fetchMeta(r.link)).expiresInS).toBeGreaterThan(3500);
    const dl: [number, number][] = [];
    const o = await openShare(r.link, PW, (d, t) => dl.push([d, t]));
    expect(dl).toEqual([[1, 3]]); // à l'ouverture : segment 0 seulement (en-tête, manifeste)
    expect(o.manifest.items.map((e) => [e.kind, e.name, e.mime])).toEqual([
      ["text", "", "text/plain"],
      ["file", "photo.jpg", "image/jpeg"],
      ["file", "rapport.bin", "application/octet-stream"],
    ]);
    expect(o.manifest.items[0]!.text).toBe("Bonjour é😀");
    expect(Buffer.from(await o.item(1)).equals(Buffer.from(image))).toBe(true);
    expect(Buffer.from(await o.item(2)).equals(Buffer.from(fichier))).toBe(true);
    expect(dl.at(-1)).toEqual([2, 3]); // le segment 2 ne contient que du bourrage : jamais lu
    await o.done();
    // maxOpens = 1 et téléchargement terminé : partage effacé.
    await expect(fetchMeta(r.link)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("mauvais mot de passe ×5", () => {
  const srv = useServer();
  it("essais restants 4, 3, 2, 1 puis introuvable", async () => {
    const r = await share(srv(), [textItem("x")]);
    for (const left of [4, 3, 2, 1]) {
      const e = await openShare(r.link, PW + "-faux").catch((x: unknown) => x);
      expect(e).toBeInstanceOf(BadPasswordError);
      expect((e as BadPasswordError).attemptsLeft).toBe(left);
    }
    await expect(openShare(r.link, PW + "-faux")).rejects.toBeInstanceOf(NotFoundError);
    // détruit : même le bon mot de passe ne sert plus
    await expect(openShare(r.link, PW)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("maxOpens = 2", () => {
  const srv = useServer();
  it("deux ouvertures, la troisième est introuvable", async () => {
    const r = await share(srv(), [textItem("deux fois")], 2);
    for (let i = 0; i < 2; i++) {
      const o = await openShare(r.link, PW);
      expect(o.manifest.items[0]!.text).toBe("deux fois");
      await o.done();
    }
    await expect(openShare(r.link, PW)).rejects.toBeInstanceOf(NotFoundError);
  });
  it("deux ouvertures simultanées réussissent", async () => {
    const data = pseudo(5 * MIB, 3);
    const r = await share(srv(), [{ kind: "file", name: "a.bin", mime: "application/octet-stream", data }], 2);
    const [a, b] = await Promise.all([openShare(r.link, PW), openShare(r.link, PW)]);
    expect(Buffer.from(await a.item(0)).equals(Buffer.from(data))).toBe(true);
    expect(Buffer.from(await b.item(0)).equals(Buffer.from(data))).toBe(true);
    await Promise.all([a.done(), b.done()]);
    await expect(openShare(r.link, PW)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("gestion : shareStatus et destruction", () => {
  const srv = useServer();
  it("opensUsed exact, puis destruction par le lien de gestion", async () => {
    const r = await share(srv(), [textItem("à détruire")], 3);
    expect(await shareStatus(r.manage)).toMatchObject({ opensUsed: 0, maxOpens: 3, state: "ready" });
    const o = await openShare(r.link, PW);
    await o.done();
    const st = await shareStatus(r.manage);
    expect(st).toMatchObject({ opensUsed: 1, maxOpens: 3, state: "ready" });
    expect(st.expiresInS).toBeGreaterThan(3500);
    await destroyShare(r.manage, {});
    await expect(openShare(r.link, PW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(fetchMeta(r.link)).rejects.toBeInstanceOf(NotFoundError);
    await expect(shareStatus(r.manage)).rejects.toBeInstanceOf(NotFoundError);
    await expect(destroyShare(r.manage, {})).rejects.toBeInstanceOf(NotFoundError);
  });
  it("destruction par le lien de partage + mot de passe", async () => {
    const r = await share(srv(), [textItem("b")]);
    await destroyShare(r.link, { password: PW });
    await expect(openShare(r.link, PW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(shareStatus(r.manage)).rejects.toBeInstanceOf(NotFoundError);
  });
  it("lien de partage sans mot de passe refusé ; mauvais type de lien refusé", async () => {
    const r = await share(srv(), [textItem("c")]);
    await expect(destroyShare(r.link, {})).rejects.toThrow("mot_de_passe_requis");
    await expect(openShare(r.manage, PW)).rejects.toThrow("lien_invalide");
    await expect(shareStatus(r.link)).rejects.toThrow("lien_invalide");
  });
});

describe("réseau coupé pendant l'envoi", () => {
  const srv = useServer();
  it("l'envoi d'un segment reprend après deux coupures", async () => {
    let putAttempts = 0;
    const flaky: typeof fetch = async (input, init) => {
      const url = String(input);
      if (init?.method === "PUT" && url.endsWith("/segments/1")) {
        putAttempts++;
        if (putAttempts <= 2) throw new TypeError("fetch failed"); // comme une coupure réseau
      }
      return globalThis.fetch(input, init);
    };
    const data = pseudo(5 * MIB, 4); // palier 80 → 2 segments
    const r = await share(srv(), [{ kind: "file", name: "a.bin", mime: "application/octet-stream", data }], 1, {
      fetch: flaky,
      retryDelayMs: 20,
    });
    expect(putAttempts).toBe(3);
    const o = await openShare(r.link, PW);
    expect(Buffer.from(await o.item(0)).equals(Buffer.from(data))).toBe(true);
    await o.done();
  });
  it("abandon après 1 + 5 essais", async () => {
    let n = 0;
    const dead: typeof fetch = async (input, init) => {
      if (init?.method === "PUT") {
        n++;
        throw new TypeError("fetch failed");
      }
      return globalThis.fetch(input, init);
    };
    await expect(share(srv(), [textItem("x")], 1, { fetch: dead, retryDelayMs: 1 })).rejects.toThrow("reseau");
    expect(n).toBe(6);
  });
});

// Spec §24 : gros fichier (File/Blob adossé au disque) chiffré, envoyé, reçu et déchiffré en
// flux ; la mémoire du processus ne grandit pas avec la taille du fichier. 250 Mio − 64 Kio :
// plus grand contenu du palier 4000 (63 segments) ; 300 Mio tomberaient dans le palier 8000
// (125 segments, 500 Mio envoyés). Le serveur limite à 60 requêtes par minute : ~130
// requêtes ici, donc environ 2 min d'attente imposée.
describe("gros fichier en flux (250 Mio)", () => {
  const srv = useServer();
  const SIZE = 250 * MIB - 64 * KIB;
  let dir: string;
  let file: string;
  let sourceHash: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "shh-gros-"));
    file = join(dir, "gros.bin");
    const h = createHash("sha256");
    const fd = openSync(file, "w");
    for (let left = SIZE; left > 0; left -= MIB) {
      const part = randomBytes(Math.min(MIB, left));
      h.update(part);
      writeSync(fd, part);
    }
    closeSync(fd);
    sourceHash = h.digest("hex");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("SHA-256 identique, croissance de la RSS < 250 Mo", async () => {
    const blob = (await openAsBlob(file, { type: "application/octet-stream" })) as unknown as Blob;
    expect(blob.size).toBe(SIZE);
    globalThis.gc?.();
    const base = process.memoryUsage().rss;
    let peak = base;
    const timer = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().rss);
    }, 20);
    try {
      const prog: [number, number][] = [];
      const r = await share(srv(), [{ kind: "file", name: "gros.bin", mime: "application/octet-stream", data: blob }], 1, {
        onProgress: (d, t) => prog.push([d, t]),
      });
      expect(prog.at(-1)).toEqual([63, 63]); // palier 4000
      const o = await openShare(r.link, PW);
      expect(o.manifest.items[0]).toMatchObject({ kind: "file", name: "gros.bin", size: SIZE });
      await expect(o.item(0)).rejects.toThrow("trop_gros_pour_apercu");
      const h = createHash("sha256");
      let got = 0;
      await o.saveItem(0, (c) => {
        h.update(c);
        got += c.length;
      });
      expect(got).toBe(SIZE);
      expect(h.digest("hex")).toBe(sourceHash);
      o.wipe();
      await o.done();
      await expect(fetchMeta(r.link)).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      clearInterval(timer);
      peak = Math.max(peak, process.memoryUsage().rss);
    }
    const growth = peak - base;
    console.log(`RSS : base ${(base / MIB).toFixed(0)} Mio, pic ${(peak / MIB).toFixed(0)} Mio, croissance ${(growth / MIB).toFixed(0)} Mio`);
    expect(growth).toBeLessThan(250e6);
  }, 400_000);
});
