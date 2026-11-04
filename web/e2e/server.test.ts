// Témoins de la capture stdout/stderr et du nettoyage du lanceur (sur lesquels repose
// le test « le serveur ne voit rien »).
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ServerStartError, startServer } from "./server";

describe("lanceur du serveur de test", () => {
  it("stdout capturé : exactement la ligne SHH_LISTENING", async () => {
    const srv = await startServer();
    try {
      expect(srv.stdout().toString("utf8")).toBe(`SHH_LISTENING ${srv.origin.slice("http://".length)}\n`);
      expect((await fetch(srv.origin + "/healthz")).status).toBe(200);
    } finally {
      await srv.dispose();
    }
    expect(existsSync(srv.dataDir)).toBe(false);
  });

  it("stderr capturé ; sortie prématurée → dossier supprimé", async () => {
    const e = await startServer({ env: { SHH_LISTEN: "adresse-invalide" } }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ServerStartError);
    const s = e as ServerStartError;
    expect(s.stderr.toString("utf8")).toMatch(/^erreur: .*adresse-invalide/);
    expect(s.stdout.length).toBe(0);
    expect(existsSync(s.dataDir)).toBe(false);
  });

  it("SHH_DATA_DIR absent : stderr capturé", async () => {
    const e = (await startServer({ env: { SHH_DATA_DIR: undefined } }).catch((x: unknown) => x)) as ServerStartError;
    expect(e).toBeInstanceOf(ServerStartError);
    expect(e.stderr.toString("utf8")).toContain("SHH_DATA_DIR est obligatoire");
  });

  it("délai dépassé → processus tué et dossier supprimé", async () => {
    // 1 ms : le binaire n'a pas le temps d'écrire SHH_LISTENING.
    const e = (await startServer({ timeoutMs: 1 }).catch((x: unknown) => x)) as ServerStartError;
    expect(e).toBeInstanceOf(ServerStartError);
    expect(e.message).toContain("pas de SHH_LISTENING à temps");
    expect(existsSync(e.dataDir)).toBe(false);
  });
});
