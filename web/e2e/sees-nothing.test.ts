// « Le serveur ne voit rien » (spec §14) — CE TEST BLOQUE TOUTE MISE EN LIGNE.
// Un partage est créé avec un texte, un nom de fichier et un mot de passe repères, puis
// ouvert. On fouille ensuite, en octets bruts et en base64url/base64 : le dossier de
// données (base, -wal, -shm, fichiers), stdout/stderr du serveur, chaque requête émise
// et la mémoire du processus serveur. Après destruction, aucun octet des segments ne
// doit rester dans le dossier de données.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { utf8 } from "../src/crypto/encoding";
import { deriveAccess } from "../src/crypto/kdf";
import { createShare, destroyShare, openShare } from "../src/transfer/client";
import { parseLink } from "../src/transfer/link";
import { solveAltcha } from "./altcha";
import { capturingFetch, findIn, needle, scanDir, scanProcessMemory, type Captured, type Needle } from "./scan";
import { startServer, type TestServer } from "./server";

const MARKER = "MOT-REPERE-7f3a";
const NAME = "nom-repere-91c2.pdf";
const PASSWORD = "mdp-repere-44b8-zzzz";

describe("le serveur ne voit rien", () => {
  let srv: TestServer;
  const log: Captured[] = [];
  const fetch = capturingFetch(log); // toutes les requêtes du test passent par là
  let kLien: Uint8Array;
  let kAcces: Uint8Array;
  let id: string;
  let manage: string;
  let secrets: Needle[]; // jamais nulle part (kAcces à part)

  beforeAll(async () => {
    srv = await startServer();
    const fileData = utf8(`%PDF-1.4 contenu du fichier ${MARKER} fin`);
    const r = await createShare(
      srv.origin,
      [
        { kind: "text", name: "", mime: "text/plain", data: utf8(`texte ${MARKER} texte`) },
        { kind: "file", name: NAME, mime: "application/pdf", data: fileData },
      ],
      { ttlHours: 1, maxOpens: 2, password: PASSWORD, solveCaptcha: solveAltcha, fetch },
    );
    const p = parseLink(r.link);
    kLien = p.secret;
    id = p.id;
    manage = r.manage;
    kAcces = (await deriveAccess(kLien)).kAcces;
    const o = await openShare(r.link, PASSWORD, undefined, { fetch });
    expect(o.manifest.items[0]!.text).toBe(`texte ${MARKER} texte`);
    expect(o.manifest.items[1]!.name).toBe(NAME);
    expect(Buffer.from(o.item(1)).equals(Buffer.from(fileData))).toBe(true);
    await o.done();
    secrets = [needle("kLien", kLien), needle("texte repère", MARKER), needle("nom repère", NAME), needle("mot de passe repère", PASSWORD)];
  });
  afterAll(async () => {
    await srv?.dispose();
  });

  it("le dossier de données ne contient aucun repère (base, -wal, -shm, fichiers)", () => {
    const hits = scanDir(srv.dataDir, [...secrets, needle("kAcces", kAcces)]);
    expect(hits).toEqual([]);
    // Témoin : l'identifiant du partage est bien dans la base (la fouille lit les bons fichiers).
    expect(scanDir(srv.dataDir, [needle("id", id)]).length).toBeGreaterThan(0);
  });

  it("la mémoire du processus serveur ne contient aucun repère", () => {
    const res = scanProcessMemory(srv.pid, secrets);
    if (!res.ok) {
      const why = `lecture de /proc/${srv.pid}/mem impossible (${res.why})`;
      // En CI, ce test bloque la mise en ligne : sauter la fouille mémoire serait un faux succès.
      if (process.env.CI) throw new Error(`[le serveur ne voit rien] fouille mémoire obligatoire en CI : ${why}`);
      console.warn(`[le serveur ne voit rien] fouille mémoire IGNORÉE (hors CI) : ${why}`);
      return;
    }
    console.info(
      `[le serveur ne voit rien] mémoire : ${res.regions} zones, ${res.bytes} o lus ; ` +
        `rw-p : ${res.rwRegions} zones, ${res.rwFailedBytes}/${res.rwBytes} o illisibles, ${res.failures} fenêtres en échec`,
    );
    // La fouille doit avoir réellement lu le tas et les zones anonymes.
    expect(res.rwRegions, "aucune zone rw-p lue").toBeGreaterThan(0);
    expect(res.rwFailedBytes, `zones rw-p illisibles : ${res.rwFailedBytes} / ${res.rwBytes} octets`).toBeLessThanOrEqual(res.rwBytes / 2);
    expect(res.hits).toEqual([]);
    // Témoin : l'identifiant du partage est retrouvé en mémoire (la lecture fonctionne).
    const ctl = scanProcessMemory(srv.pid, [needle("id", id)]);
    expect(ctl.ok && ctl.hits).toEqual(["id"]);
  });

  it("après destruction, aucun octet des segments ne reste sur disque", async () => {
    const segs = log.filter((r) => r.method === "PUT" && /\/segments\/\d+$/.test(r.url)).map((r) => r.body);
    expect(segs.length).toBeGreaterThan(0);
    const slices = segs.map((s, i) => {
      const mid = Math.floor(s.length / 2);
      return { label: `segment ${i}`, forms: [s.subarray(mid - 32, mid + 32)] };
    });
    // Avant destruction, le fichier du partage contient bien ces octets (témoin).
    expect(scanDir(srv.dataDir, slices).length).toBeGreaterThan(0);
    await destroyShare(manage, { fetch });
    expect(scanDir(srv.dataDir, slices)).toEqual([]);
    expect(scanDir(srv.dataDir, [...secrets, needle("kAcces", kAcces)])).toEqual([]);
  });

  it("stdout/stderr du serveur ne contiennent aucun repère", async () => {
    await srv.stop();
    const all = [...secrets, needle("kAcces", kAcces)];
    expect(findIn(srv.stdout(), all)).toEqual([]);
    expect(findIn(srv.stderr(), all)).toEqual([]);
    expect(srv.stdout().toString("utf8")).toMatch(/^SHH_LISTENING 127\.0\.0\.1:\d+\n$/);
  });

  it("les requêtes émises ne contiennent aucun repère ; kAcces seulement dans X-Shh-Access", () => {
    expect(log.map((r) => `${r.method} ${r.url.replace(/^https?:\/\/[^/]+/, "").replace(id, "ID")}`)).toEqual([
      "GET /api/captcha",
      "POST /api/shares",
      "PUT /api/shares/ID/segments/0",
      "POST /api/shares/ID/finalize",
      "GET /api/shares/ID/meta",
      "POST /api/shares/ID/unlock",
      "GET /api/shares/ID/segments/0",
      "POST /api/shares/ID/done",
      "POST /api/shares/ID/destroy",
    ]);
    const all = [...secrets, needle("kAcces", kAcces)];
    const hits: string[] = [];
    for (const r of log) {
      const where = `${r.method} ${r.url}`;
      for (const l of findIn(Buffer.from(r.url), all)) hits.push(`${where} URL : ${l}`);
      for (const l of findIn(r.body, all)) hits.push(`${where} corps : ${l}`);
      for (const [k, v] of r.headers) {
        const found = findIn(Buffer.from(`${k}: ${v}`), k === "x-shh-access" ? secrets : all);
        for (const l of found) hits.push(`${where} en-tête ${k} : ${l}`);
      }
    }
    expect(hits).toEqual([]);
    // Témoin : kAcces est bien envoyé (la fouille des en-têtes n'est pas vide de sens).
    expect(log.some((r) => r.headers.some(([k, v]) => k === "x-shh-access" && findIn(Buffer.from(v), [needle("kAcces", kAcces)]).length))).toBe(true);
  });
});
