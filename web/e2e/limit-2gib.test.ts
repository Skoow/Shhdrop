// Limite gratuite de 2 Gio (spec §41.2) sur un vrai serveur, avec des données synthétiques
// (Blob creux, lu par tranches de 64 Kio : jamais 2 Gio en mémoire).
// - 2 Gio + 1 octet : refusé par le navigateur avant tout appel réseau.
// - 2 Gio exactement : envoyé en 513 segments, fichier réservé de 2 148 073 536 octets
//   (nuit seulement : SHH_SLOW=1, plusieurs dizaines de secondes et 2 Gio de disque).
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONTENT_MAX } from "../src/limits";
import { createShare, destroyShare } from "../src/transfer/client";
import { solveAltcha } from "./altcha";
import { startServer, type TestServer } from "./server";

/** Blob creux : taille annoncée, tranches de zéros produites à la demande. */
const hollow = (size: number): Blob =>
  ({
    size,
    slice: (a = 0, b = size) => ({ arrayBuffer: async () => new ArrayBuffer(b - a) }),
  }) as unknown as Blob;

describe("limite de 2 Gio", () => {
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startServer();
  });
  afterAll(async () => {
    await srv.dispose();
  });
  const blobs = () => (existsSync(join(srv.dataDir, "blobs")) ? readdirSync(join(srv.dataDir, "blobs")) : []);
  const opts = { ttlHours: 1 as const, maxOpens: 1, password: "Lm3?Gq9!HdK", solveCaptcha: solveAltcha };

  it("2 Gio + 1 octet : refusé, rien n'est créé sur le serveur", async () => {
    await expect(createShare(srv.origin, [{ kind: "file", name: "a.bin", mime: "application/octet-stream", data: hollow(CONTENT_MAX + 1) }], opts)).rejects.toThrow(
      "trop_gros",
    );
    expect(blobs()).toHaveLength(0);
  });

  it.skipIf(!process.env.SHH_SLOW)("2 Gio exactement : accepté, fichier chiffré de 2 148 073 536 octets", async () => {
    const r = await createShare(srv.origin, [{ kind: "file", name: "a.bin", mime: "application/octet-stream", data: hollow(CONTENT_MAX) }], opts);
    const files = blobs();
    expect(files).toHaveLength(1);
    expect(statSync(join(srv.dataDir, "blobs", files[0]!)).size).toBe(2_148_073_536);
    await destroyShare(r.manage, srv.origin);
    expect(blobs()).toHaveLength(0);
  }, 600_000);
});
