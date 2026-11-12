// Envoi dès l'ajout et nettoyage (spec §29.7, §35.2 ; retours du 12 novembre) : un fichier
// déjà parti en envoi anticipé, puis nettoyé (contenu remplacé) ou retiré avant « Chiffrer et
// envoyer », ne doit rien laisser de lisible au destinataire. Le destinataire a le lien et le
// mot de passe ; un destinataire malveillant peut déchiffrer chaque morceau du flux stocké avec
// toute graine qu'il connaît. Ici, plus fort encore : on essaie TOUTES les graines de 32 octets
// tirées pendant le test (graines k des éléments, originaux compris, et R) sur TOUS les morceaux
// du flux tel que le serveur le garde ; le repère de l'original ne doit apparaître nulle part.
import { createDecipheriv, hkdfSync } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const seeds = vi.hoisted(() => ({ all: [] as Uint8Array[] }));
vi.mock("../src/engine/provider", async (orig) => {
  const m = await orig<typeof import("../src/engine/provider")>();
  return {
    ...m,
    createProvider: () => {
      const p = m.createProvider();
      return {
        ...p,
        random: (n: number) => {
          const b = p.random(n);
          if (n === 32) seeds.all.push(new Uint8Array(b));
          return b;
        },
      };
    },
  };
});

import { CHUNK, CHUNK_CT, HEADER, utf8, type Item } from "../src/engine/pure";
import { openShare } from "../src/transfer/client";
import { createDraft } from "../src/transfer/draft";
import { solveAltcha } from "./altcha";
import { startServer, type TestServer } from "./server";

const PW = "Kq7!mP2#x?a"; // forme d'un mot de passe généré (D41-15)
const MIB = 1048576;
const MARK = utf8("GPS-REPERE-48.8566N-2.3522E-c9f1");
const AD = utf8("shhdrop/v2/element-ad");

/** Contenu pseudo-aléatoire de n octets, repère écrit au début et au milieu. */
function withMark(n: number, seed: number, mark: boolean): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  if (mark) {
    out.set(MARK, 0);
    out.set(MARK, n >> 1);
  }
  return out;
}

const has = (hay: Uint8Array, needle: Uint8Array) => Buffer.from(hay).indexOf(Buffer.from(needle)) >= 0;

/** Morceau g du flux stocké déchiffré sous la graine k (AES-256-GCM, comme le moteur) ; null si refusé. */
function open(stream: Buffer, k: Uint8Array, g: number): Buffer | null {
  const at = HEADER + g * CHUNK_CT;
  if (at + CHUNK_CT > stream.length) return null;
  const key = Buffer.from(hkdfSync("sha256", k, new Uint8Array(0), "shhdrop/v2/element", 32));
  const iv = Buffer.alloc(12);
  iv.writeBigUInt64BE(BigInt(g), 3);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAAD(AD);
  d.setAuthTag(stream.subarray(at + CHUNK, at + CHUNK_CT));
  try {
    return Buffer.concat([d.update(stream.subarray(at, at + CHUNK)), d.final()]);
  } catch {
    return null;
  }
}

async function until(ok: () => boolean, what: string, ms = 60_000) {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`attente dépassée : ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("envoi anticipé puis nettoyage ou retrait : aucun octet lisible de l'original", () => {
  let srv: TestServer;
  let stream: Buffer;
  let before: Buffer; // flux pendant l'envoi anticipé des originaux (témoin du détecteur)
  const cleanedSmall = withMark(300 * 1024, 11, false);
  const cleanedBig = withMark(5 * MIB, 12, false);

  beforeAll(async () => {
    srv = await startServer();
    const d = createDraft(srv.origin, { solveCaptcha: solveAltcha, auto: true });
    // Trois fichiers avec repère : un petit (morceaux dans un segment partagé), un grand
    // (segments entiers), un troisième qui sera retiré.
    const smallOrig = new Blob([withMark(300 * 1024, 1, true)]);
    const bigOrig = new Blob([withMark(5 * MIB, 2, true)]);
    const removed = new Blob([withMark(200 * 1024, 3, true)]);
    d.sync([
      { id: "s", data: smallOrig },
      { id: "b", data: bigOrig },
      { id: "r", data: removed },
    ]);
    // Envoi anticipé fini : tous les octets chiffrés des originaux sont sur le serveur.
    await until(() => ["s", "b", "r"].every((id) => d.status(id)?.phase === "pret"), "originaux envoyés");
    const blob = () => {
      const f = readdirSync(join(srv.dataDir, "blobs")).map(String);
      expect(f).toHaveLength(1);
      return readFileSync(join(srv.dataDir, "blobs", f[0]!));
    };
    before = blob();
    // « Nettoyer » : même ligne, contenu remplacé ; « Supprimer » : ligne retirée.
    const s2 = new Blob([cleanedSmall]);
    const b2 = new Blob([cleanedBig]);
    d.sync([
      { id: "s", data: s2 },
      { id: "b", data: b2 },
    ]);
    const items: { id: string; item: Item }[] = [
      { id: "s", item: { kind: "file", name: "photo.jpg", mime: "image/jpeg", data: s2 } },
      { id: "b", item: { kind: "file", name: "video.mp4", mime: "video/mp4", data: b2 } },
    ];
    const r = await d.finalize(items, { ttlHours: 1, maxOpens: 2, password: PW });
    // Le destinataire ouvre et reçoit les versions nettoyées.
    const o = await openShare(r.link, PW, srv.origin);
    expect(Buffer.from(await o.item(0)).equals(Buffer.from(cleanedSmall))).toBe(true);
    expect(Buffer.from(await o.item(1)).equals(Buffer.from(cleanedBig))).toBe(true);
    await o.done();
    stream = blob();
  }, 180_000);
  afterAll(async () => {
    await srv?.dispose();
  });

  /** Morceaux où une graine tirée fait apparaître le repère. */
  function leaksIn(s: Buffer): { opened: number; leaks: string[] } {
    const chunks = Math.floor((s.length - HEADER) / CHUNK_CT);
    let opened = 0;
    const leaks: string[] = [];
    for (const [i, k] of seeds.all.entries())
      for (let g = 0; g < chunks; g++) {
        const p = open(s, k, g);
        if (!p) continue;
        opened++;
        if (has(p, MARK)) leaks.push(`graine ${i}, morceau ${g}`);
      }
    return { opened, leaks };
  }

  it("témoin : pendant l'envoi anticipé, le détecteur retrouve le repère des trois originaux", () => {
    expect(leaksIn(before).leaks.length).toBeGreaterThanOrEqual(3);
  });

  it("aucune graine tirée (originaux compris) ne fait apparaître le repère, dans aucun morceau du flux stocké", () => {
    expect(seeds.all.length).toBeGreaterThanOrEqual(6); // 5 graines d'éléments au moins, et R
    const { opened, leaks } = leaksIn(stream);
    // Témoin : le flux se lit bien ainsi (versions nettoyées : 5 + 80 morceaux au moins).
    expect(opened).toBeGreaterThanOrEqual(85);
    expect(leaks).toEqual([]);
    // Et en clair, jamais.
    expect(has(stream, MARK)).toBe(false);
  });
});
