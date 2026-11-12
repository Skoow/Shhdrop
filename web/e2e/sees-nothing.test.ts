// « Le serveur ne voit rien » (spec §14) — CE TEST BLOQUE TOUTE MISE EN LIGNE.
// Un partage est créé avec un texte, un nom de fichier et un mot de passe repères, puis
// ouvert. On fouille ensuite, en octets bruts et en base64url/base64 : le dossier de
// données (base, -wal, -shm, fichiers), stdout/stderr du serveur, chaque requête émise
// et la mémoire du processus serveur. Après destruction puis arrêt du serveur, ni les
// octets des segments, ni l'identifiant interne, le sel ou les vérificateurs ne doivent
// rester dans un fichier du dossier de données. Spec §32 : l'id dérivé du lien (HKDF de
// K_lien) ne sort jamais du navigateur ; il est fouillé comme un secret.
import { createHash, createHmac, hkdfSync } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { b64u, concat, generatePassword, unb64u, utf8, type KAcces, type KLien, type KMdp, type KPreuve, type SGestion } from "../src/engine/pure";

// Graines R tirées par createShare : R ne sort jamais du moteur (poignée opaque) ; le moteur la
// tire par le fournisseur (random(32), aléa de crypto.getRandomValues), qui en garde ici une copie
// pendant newSeed seulement (le moteur efface le tableau qu'il reçoit, après l'avoir recopié).
// Les autres tirages de 32 octets (graines k des éléments, tirées par elementSealer) sont gardés
// aussi : `others`, fouillés comme des secrets.
const seeds = vi.hoisted(() => ({ list: [] as Uint8Array<ArrayBuffer>[], others: [] as Uint8Array<ArrayBuffer>[], on: false }));
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
          if (n === 32) (seeds.on ? seeds.list : seeds.others).push(new Uint8Array(b));
          return b;
        },
      };
    },
  };
});
vi.mock("../src/engine/index", async (orig) => {
  const m = await orig<typeof import("../src/engine/index")>();
  return {
    ...m,
    newSeed: async () => {
      seeds.on = true;
      try {
        return await m.newSeed();
      } finally {
        seeds.on = false;
      }
    },
  };
});
import { accessKeys, deriveAccess, parseLink, passwordKey, shareId } from "../src/engine";
import * as api from "../src/transfer/api";
import { createShare, destroyShare, openShare, shareStatus } from "../src/transfer/client";
import { solveAltcha } from "./altcha";
import { capturingFetch, findIn, needle, scanDir, scanProcessMemory, type Captured, type Needle } from "./scan";
import { startServer, type TestServer } from "./server";

const MARKER = "MOT-REPERE-7f3a";
const NAME = "nom-repere-91c2.pdf";
const PASSWORD = "Rp4#Wx8?T%Q"; // repère de la forme générée (D41-15 : plus de mot de passe saisi)
const MIB = 1048576;
const GENERATED = generatePassword();
const sha256 = async (b: Uint8Array) => new Uint8Array(createHash("sha256").update(b).digest());
const hk = (ikm: Uint8Array, info: string) => new Uint8Array(hkdfSync("sha256", ikm, new Uint8Array(0), info, 32));
// Sous-chaînes de 8 caractères des noms et du texte saisis : aucune ne doit apparaître.
const windows = (label: string, s: string) => Array.from({ length: s.length - 7 }, (_, i) => needle(`${label}[${i}]`, s.slice(i, i + 8)));

describe("le serveur ne voit rien", () => {
  let srv: TestServer;
  const log: Captured[] = [];
  const fetch = capturingFetch(log); // toutes les requêtes du test passent par là
  let kLien: KLien;
  let kAcces: KAcces;
  let kPreuve: KPreuve;
  let kMdp: Uint8Array<ArrayBuffer>;
  let sGestion: SGestion;
  let salt: Uint8Array<ArrayBuffer>;
  let id: Uint8Array<ArrayBuffer>; // id du client (HKDF de K_lien) : jamais envoyé
  let handle: string; // id interne tiré par le serveur (nom du fichier, jetons)
  let manage: string;
  let kLien2: KLien; // second partage : signalé par Opened.destroy("report")
  let kAcces2: KAcces;
  let id2: Uint8Array<ArrayBuffer>;
  let handle2: string;
  let secrets: Needle[]; // jamais nulle part (kAcces à part)
  let keysOnDisk: Needle[]; // jamais sur disque ni dans les journaux ; dans les requêtes, jamais dans l'URL
  let traces: Needle[]; // présents tant que le partage vit ; plus nulle part après destruction
  let envelope: Uint8Array<ArrayBuffer>;
  let statusKeys: string[];
  let fillCopy: Buffer | undefined;

  beforeAll(async () => {
    srv = await startServer();
    // 11 Mio : palier 400 (7 segments), bourrage [3, 6) rempli par le serveur (spec §29.3).
    const fileData = new Uint8Array(11 * MIB).map((_, i) => (i * 131 + 7) & 255);
    fileData.set(utf8(`%PDF-1.4 contenu du fichier ${MARKER} fin`), 0);
    fileData.set(utf8(MARKER), 5 * MIB);
    const r = await createShare(
      srv.origin,
      [
        { kind: "text", name: "", mime: "text/plain", data: utf8(`texte ${MARKER} texte`) },
        { kind: "file", name: NAME, mime: "application/pdf", data: fileData },
      ],
      // Droits « coffre » + durée de garde : écrits dans le manifeste chiffré, jamais en clair.
      { ttlHours: 1, maxOpens: 2, password: PASSWORD, rights: "coffre", keepTtlH: 12, solveCaptcha: solveAltcha, fetch },
    );
    const p = await parseLink(r.link);
    if (p.kind !== "s") throw new Error("lien de partage attendu");
    kLien = p.kLien;
    id = await shareId(kLien);
    // Le seul fichier du dossier blobs : son nom est l'id interne, sans rapport avec l'id du client.
    const blobs = () => readdirSync(join(srv.dataDir, "blobs")).map(String);
    expect(blobs()).toHaveLength(1);
    handle = blobs()[0]!;
    expect(handle).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(handle).not.toBe(b64u(id));
    manage = r.manage;
    kAcces = (await deriveAccess(kLien)).kAcces;
    const g = await parseLink(manage);
    if (g.kind !== "m") throw new Error("lien de gestion attendu");
    sGestion = g.sGestion;
    // Hors journal des requêtes (fetch global) : le sel et les paramètres tels que le serveur les rend.
    const m = await api.meta(api.ctx(srv.origin), kAcces);
    salt = unb64u(m.salt);
    expect(m.bucket).toBe(400);
    kMdp = await passwordKey(PASSWORD, salt, m.kdf);
    kPreuve = (await accessKeys(kLien, kMdp as KMdp)).kPreuve;
    const o = await openShare(r.link, PASSWORD, srv.origin, undefined, { fetch });
    expect(o.manifest.items[0]!.text).toBe(`texte ${MARKER} texte`);
    expect(o.manifest.items[1]!.name).toBe(NAME);
    expect([o.manifest.rights, o.manifest.keep_ttl_h]).toEqual(["coffre", 12]);
    expect(Buffer.from(await o.item(1)).equals(Buffer.from(fileData))).toBe(true);
    await o.done();
    const st = log.length;
    await shareStatus(manage, srv.origin, { fetch });
    statusKeys = Object.keys(JSON.parse(log[st]!.response.toString("utf8")) as object).sort();
    const unlockRes = log.find((x) => x.url.endsWith("/unlock"))!;
    envelope = unb64u((JSON.parse(unlockRes.response.toString("utf8")) as { envelope: string }).envelope);
    const blobFile = readFileSync(join(srv.dataDir, "blobs", handle));
    // La copie capturée est bien R : son engagement HMAC(R, « shhdrop/v2/engagement ») est celui
    // de l'en-tête stocké (octets 16 à 48 du segment 0). Sinon les aiguilles R et K_contenu ne
    // chercheraient rien.
    expect(seeds.list).toHaveLength(1);
    const engagement = createHmac("sha256", seeds.list[0]!).update("shhdrop/v2/engagement").digest();
    expect(Buffer.from(blobFile.subarray(16, 48)).equals(engagement), "R capturée = R du partage").toBe(true);
    const segOff = (n: number) => 48 + n * 64 * 65552;
    fillCopy = blobFile.subarray(segOff(3), segOff(6));
    // Second partage (une seule ouverture) : lu puis détruit par Opened.destroy("report"), qui
    // envoie K_accès et K_preuve ; ces requêtes et le disque sont fouillés comme les autres.
    const r2 = await createShare(srv.origin, [{ kind: "text", name: "", mime: "text/plain", data: utf8(`texte ${MARKER} texte`) }], {
      ttlHours: 1,
      maxOpens: 1,
      password: GENERATED, // second chemin : mot de passe généré (8 caractères)
      solveCaptcha: solveAltcha,
      fetch,
    });
    const p2 = await parseLink(r2.link);
    if (p2.kind !== "s") throw new Error("lien de partage attendu");
    kLien2 = p2.kLien;
    id2 = await shareId(kLien2);
    handle2 = blobs().find((n) => n !== handle)!;
    expect(handle2).toMatch(/^[A-Za-z0-9_-]{22}$/);
    kAcces2 = (await deriveAccess(kLien2)).kAcces;
    const o2 = await openShare(r2.link, GENERATED, srv.origin, undefined, { fetch });
    expect(o2.manifest.items[0]!.text).toBe(`texte ${MARKER} texte`);
    await o2.destroy("report");
    await o2.done(); // 410 « gone » attendu et toléré : le partage est déjà effacé
    o2.wipe();
    expect(seeds.list).toHaveLength(2);
    // Deux éléments au premier partage (texte, fichier), un au second : trois graines k.
    expect(seeds.others).toHaveLength(3);
    const seed1 = seeds.list[0]!, seed2 = seeds.list[1]!;
    const kMaitre = hk(concat(kLien, kMdp), "shhdrop/v2/maitre");
    secrets = [
      needle("R", seed1),
      needle("R (signalé)", seed2),
      needle("K_contenu", hk(seed1, "shhdrop/v2/contenu")),
      needle("K_contenu (signalé)", hk(seed2, "shhdrop/v2/contenu")),
      needle("K_mdp", kMdp),
      ...seeds.others.map((k, i) => needle(`graine k d'élément ${i}`, k)),
      ...seeds.others.map((k, i) => needle(`clé d'élément ${i}`, hk(k, "shhdrop/v2/element"))),
      needle("K_maître", kMaitre),
      needle("K_env", hk(kMaitre, "shhdrop/v2/enveloppe")),
      ...windows("nom", NAME),
      ...windows("texte", MARKER),
      ...windows("mot de passe", PASSWORD),
      needle("mot de passe généré", GENERATED),
      needle("droits (manifeste)", '"rights":"coffre"'),
      needle("droit coffre", "coffre"),
      needle("durée de garde (manifeste)", '"keep_ttl_h"'),
      needle("kLien", kLien),
      needle("kLien (signalé)", kLien2),
      needle("id du client", id),
      needle("id du client (signalé)", id2),
      needle("texte repère", MARKER),
      needle("nom repère", NAME),
      needle("mot de passe repère", PASSWORD),
    ];
    keysOnDisk = [needle("kAcces", kAcces), needle("kAcces (signalé)", kAcces2), needle("kPreuve", kPreuve), needle("sGestion", sGestion)];
    traces = [
      needle("id", handle),
      needle("id (signalé)", handle2),
      needle("sel", salt),
      needle("access_v", await sha256(kAcces)),
      needle("proof_v", await sha256(kPreuve)),
      needle("manage_v", await sha256(sGestion)),
      needle("enveloppe", envelope),
    ];
  });
  afterAll(async () => {
    await srv?.dispose();
  });

  it("le dossier de données ne contient aucun repère (base, -wal, -shm, fichiers)", () => {
    const hits = scanDir(srv.dataDir, [...secrets, ...keysOnDisk]);
    expect(hits).toEqual([]);
    // Témoin : l'identifiant et les vérificateurs sont bien dans la base (la fouille lit les bons fichiers).
    const found = scanDir(srv.dataDir, traces).map((h) => h.slice(h.lastIndexOf(" : ") + 3));
    for (const l of ["id", "access_v", "proof_v", "manage_v"]) expect(found, l).toContain(l);
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
    // Témoin : l'identifiant interne du partage est retrouvé en mémoire (la lecture fonctionne).
    const ctl = scanProcessMemory(srv.pid, [needle("id", handle)]);
    expect(ctl.ok && ctl.hits).toEqual(["id"]);
  });

  it("après destruction et arrêt, ni segments, ni identifiant, sel ou vérificateurs sur disque", async () => {
    const segs = log.filter((r) => r.method === "PUT" && /\/segments\/\d+$/.test(r.url)).map((r) => r.body);
    expect(segs.length).toBeGreaterThan(0);
    const slices = segs.map((s, i) => {
      const mid = Math.floor(s.length / 2);
      return { label: `segment ${i}`, forms: [s.subarray(mid - 32, mid + 32)] };
    });
    // Avant destruction, le fichier du partage contient bien ces octets (témoin).
    expect(scanDir(srv.dataDir, slices).length).toBeGreaterThan(0);
    await destroyShare(manage, srv.origin, { fetch });
    expect(scanDir(srv.dataDir, slices)).toEqual([]);
    // Arrêt : SQLite replie le WAL et ferme la base ; on fouille alors chaque fichier
    // restant (shares.db, -wal, -shm s'ils existent, fichiers des partages).
    await srv.stop();
    expect(scanDir(srv.dataDir, [...slices, ...secrets, ...keysOnDisk, ...traces])).toEqual([]);
    const names = readdirSync(srv.dataDir, { recursive: true }).map(String);
    expect(names.filter((n) => n.includes(handle))).toEqual([]);
    expect(names).toContain("shares.db"); // la base a bien été fouillée
  });

  it("stdout/stderr du serveur ne contiennent aucun repère", async () => {
    await srv.stop();
    const all = [...secrets, ...keysOnDisk, ...traces];
    expect(findIn(srv.stdout(), all)).toEqual([]);
    expect(findIn(srv.stderr(), all)).toEqual([]);
    expect(srv.stdout().toString("utf8")).toMatch(/^SHH_LISTENING 127\.0\.0\.1:\d+\n$/);
  });

  it("les requêtes émises ne contiennent aucun repère ; kAcces seulement dans X-Shh-Access ; aucune clé dans une URL", () => {
    // Aucun identifiant dans un chemin (spec §32) : ni l'id du client, ni l'id interne.
    expect(log.map((r) => `${r.method} ${r.url.replace(/^https?:\/\/[^/]+/, "")}`)).toEqual([
      "GET /api/captcha",
      "POST /api/shares",
      // Segments 3 à 6 : bourrage et manifeste, jamais envoyés en PUT (spec §41.14 : le
      // serveur remplit les trous d'aléa, l'en-tête et le manifeste chiffré viennent avec finalize).
      "PUT /api/shares/segments/0",
      "PUT /api/shares/segments/1",
      "PUT /api/shares/segments/2?from=0", // fin du fichier : ses seuls morceaux, sans arrondi (D41-38)
      "PUT /api/shares/segments/3?from=0", // note (D41-37) : un élément chiffré comme un fichier, remise au clic
      "POST /api/shares/finalize",
      "GET /api/shares/meta",
      "POST /api/shares/unlock",
      "GET /api/shares/segments/0",
      "GET /api/shares/segments/6",
      "GET /api/shares/segments/3", // note lue (déchiffrée, authentifiée) à l'ouverture
      "GET /api/shares/segments/0",
      "GET /api/shares/segments/1",
      "GET /api/shares/segments/2",
      "POST /api/shares/done",
      "GET /api/manage/status",
      // Second partage : Opened.destroy("report") puis done (404 toléré).
      "GET /api/captcha",
      "POST /api/shares",
      // Note seule (D41-37) : un élément, un PUT d'un morceau ; lue dans le segment 0 à l'ouverture.
      "PUT /api/shares/segments/0?from=0",
      "POST /api/shares/finalize",
      "GET /api/shares/meta",
      "POST /api/shares/unlock",
      "GET /api/shares/segments/0",
      "POST /api/shares/destroy",
      "POST /api/shares/done",
      "POST /api/manage/destroy",
    ]);
    for (const r of log) expect(findIn(Buffer.from(r.url), [needle("id interne", handle), needle("id interne (signalé)", handle2)]), r.url).toEqual([]);
    const all = [...secrets, needle("kAcces", kAcces), needle("kAcces (signalé)", kAcces2)];
    const hits: string[] = [];
    for (const r of log) {
      const where = `${r.method} ${r.url}`;
      // kPreuve voyage dans les corps, sGestion dans X-Shh-Manage : jamais dans une URL (journaux, historique).
      for (const l of findIn(Buffer.from(r.url), [...all, ...keysOnDisk])) hits.push(`${where} URL : ${l}`);
      for (const l of findIn(r.body, all)) hits.push(`${where} corps : ${l}`);
      for (const l of findIn(r.response, [...all, ...keysOnDisk])) hits.push(`${where} réponse : ${l}`);
      for (const [k, v] of r.headers) {
        const found = findIn(Buffer.from(`${k}: ${v}`), k === "x-shh-access" ? secrets : all);
        for (const l of found) hits.push(`${where} en-tête ${k} : ${l}`);
      }
    }
    expect(hits).toEqual([]);
    // Témoin : kAcces est bien envoyé (la fouille des en-têtes n'est pas vide de sens).
    expect(log.some((r) => r.headers.some(([k, v]) => k === "x-shh-access" && findIn(Buffer.from(v), [needle("kAcces", kAcces)]).length))).toBe(true);
    // Témoin : kPreuve est bien dans un corps, sGestion dans X-Shh-Manage (la fouille des URL a un sens).
    expect(log.some((r) => findIn(r.body, [needle("kPreuve", kPreuve)]).length)).toBe(true);
    expect(log.some((r) => r.headers.some(([k, v]) => k === "x-shh-manage" && findIn(Buffer.from(v), [needle("sGestion", sGestion)]).length))).toBe(true);
    // sGestion jamais ailleurs que dans X-Shh-Manage (ni corps, ni autre en-tête).
    for (const r of log) {
      expect(findIn(r.body, [needle("sGestion", sGestion)]), r.url).toEqual([]);
      for (const [k, v] of r.headers) if (k !== "x-shh-manage") expect(findIn(Buffer.from(v), [needle("sGestion", sGestion)]), k).toEqual([]);
    }
    // Témoin : K_accès part à la création (en-tête), comme à la lecture.
    const create = log.find((r) => r.url.endsWith("/api/shares"))!;
    expect(create.headers.some(([k, v]) => k === "x-shh-access" && findIn(Buffer.from(v), [needle("kAcces", kAcces)]).length)).toBe(true);
  });

  it("la réponse de statut ne contient que compteurs, échéance et état", () => {
    expect(statusKeys).toEqual(["expires_in_s", "max_opens", "opens_used", "state"]);
  });

  it("le bourrage rempli par le serveur (segments 3 à 5) : ni repère, ni suite de 4 096 zéros", async () => {
    // Fichier du partage lu avant sa destruction : relancer n'est pas possible, on se sert de la copie faite au début.
    expect(fillCopy).toBeDefined();
    let run = 0, worst = 0;
    for (const x of fillCopy!) worst = Math.max(worst, (run = x === 0 ? run + 1 : 0));
    expect(worst).toBeLessThan(4096);
    expect(findIn(fillCopy!, [...secrets, ...keysOnDisk])).toEqual([]);
    expect(fillCopy!.length).toBe(3 * 64 * 65552);
  });
});

// Spec §36 (Task M2) : repères de requête (adresse, User-Agent, Referer, Accept-Language,
// identifiant dans une route inconnue, motif de destruction) ; aucun sur disque (base, WAL,
// fichiers), dans stdout, stderr ni dans une réponse ; base minimale après finalize, pendant
// la lecture et après la suppression (aucune date sauf expires_at, multiple de 900 ; ni
// progress_at, upload_deadline, purge_at ni ttl_hours ; aucun texte de motif).
describe("le serveur ne voit rien : repères de requête, base minimale (spec §36)", () => {
  const IP = "203.0.113.77";
  const R = {
    ua: "ReperUA/1.0",
    ref: "https://repere-referer.example/ReperRef",
    lang: "xx-ReperLang",
    id: "ReperIdAAAAAAAAAAAAAAA", // 22 caractères : forme d'un identifiant valide
    idLong: "ReperIdAAAAAAAAAAAAAAAAAAAAAA",
    reason: "ReperRaison",
  };
  const markers = [
    needle("IP (texte)", IP),
    { label: "IP (4 octets)", forms: [Buffer.from([203, 0, 113, 77])] },
    needle("User-Agent", R.ua),
    needle("Referer", "ReperRef"),
    needle("Accept-Language", "ReperLang"),
    needle("identifiant", "ReperIdAAAAAAAA"),
    needle("motif", R.reason),
  ];
  let srv: TestServer;
  const log: Captured[] = [];
  const captured = capturingFetch(log);
  const marked: typeof fetch = (input, init) => {
    const h = new Headers(init?.headers);
    h.set("X-Shh-Client-IP", IP);
    h.set("User-Agent", R.ua);
    h.set("Referer", R.ref);
    h.set("Accept-Language", R.lang);
    return captured(input, { ...init, headers: h });
  };
  type Row = Record<string, unknown>;
  const snapshots: Record<string, { cols: string[]; rows: Row[]; master: string[]; salonCols: string[]; pieceCols: string[]; salonRows: number }> = {};
  async function dbSnapshot(label: string) {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(join(srv.dataDir, "shares.db"), { readOnly: true });
    try {
      const cols = (db.prepare("SELECT name FROM pragma_table_info('shares')").all() as { name: string }[]).map((c) => c.name);
      const rows = db.prepare("SELECT * FROM shares").all() as Row[];
      const master = (db.prepare("SELECT type || ':' || name AS n FROM sqlite_master ORDER BY 1").all() as { n: string }[]).map((x) => x.n);
      const colsOf = (t: string) => (db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as { name: string }[]).map((c) => c.name);
      const count = (t: string) => Number((db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n);
      snapshots[label] = {
        cols,
        rows,
        master,
        salonCols: colsOf("salons"),
        pieceCols: colsOf("salon_pieces"),
        salonRows: count("salons") + count("salon_pieces"),
      };
    } finally {
      db.close();
    }
  }

  beforeAll(async () => {
    srv = await startServer();
    const r = await createShare(srv.origin, [{ kind: "text", name: "", mime: "text/plain", data: utf8("texte") }], {
      ttlHours: 6,
      maxOpens: 2,
      password: GENERATED,
      solveCaptcha: solveAltcha,
      fetch: marked,
    });
    await dbSnapshot("après finalize");
    const o = await openShare(r.link, GENERATED, srv.origin, undefined, { fetch: marked });
    await dbSnapshot("pendant la lecture");
    // Identifiant repère dans des routes inconnues ; motif repère refusé (400, partage intact).
    for (const path of [`/api/${R.id}`, `/api/shares/${R.idLong}`, `/API/${R.id}`, `/api/shares/segments/${R.id}`]) await marked(srv.origin + path);
    const p = await parseLink(r.link);
    if (p.kind !== "s") throw new Error("lien de partage attendu");
    const kA = (await deriveAccess(p.kLien)).kAcces;
    const bad = await marked(srv.origin + "/api/shares/destroy", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shh-Access": b64u(kA) },
      body: JSON.stringify({ proof: b64u(new Uint8Array(32)), reason: R.reason }),
    });
    expect(bad.status).toBe(400);
    await o.done();
    await destroyShare(r.manage, srv.origin, { fetch: marked });
    await dbSnapshot("après suppression");
    await srv.stop();
  });
  afterAll(async () => {
    await srv?.dispose();
  });

  // Schéma 2 (salon C-2, Task 4) : les tables du salon existent même salon désactivé ; elles restent
  // vides, et leurs colonnes sont fixées ici : aucun pseudonyme, nom, adresse, date autre que
  // expires_at, ni compteur de messages (§39.3.5).
  it("base : seule date expires_at (multiple de 900), ni ttl_hours, ni colonnes retirées ; tables du salon vides et sans colonne en trop", () => {
    for (const [label, s] of Object.entries(snapshots)) {
      expect(s.cols, label).not.toContain("progress_at");
      expect(s.cols, label).not.toContain("upload_deadline");
      expect(s.cols, label).not.toContain("purge_at");
      expect(s.master, label).toEqual([
        "index:salon_pieces_salon",
        "index:salons_access_v",
        "index:salons_manage_v",
        "index:shares_access_v",
        "index:shares_manage_v",
        "table:salon_pieces",
        "table:salons",
        "table:shares",
      ]);
      expect(s.salonCols, label).toEqual([
        "id", "access_v", "manage_v", "proof_v", "salt", "kdf_ops", "kdf_mem", "expires_at",
        "max_members", "members_can_destroy", "failed_attempts", "pieces_bytes",
      ]);
      expect(s.pieceCols, label).toEqual(["id", "salon_id", "bucket", "state", "segments_mask"]);
      expect(s.salonRows, label).toBe(0);
      for (const row of s.rows) {
        expect(row.ttl_hours, label).toBeNull();
        expect(Number(row.expires_at) % 900, label).toBe(0);
      }
    }
    expect(snapshots["après finalize"]!.rows).toHaveLength(1);
    expect(snapshots["après suppression"]!.rows).toHaveLength(0);
  });

  it("aucun repère sur disque (base, WAL, fichiers), dans stdout, stderr ni dans une réponse", () => {
    expect(scanDir(srv.dataDir, markers)).toEqual([]);
    expect(findIn(srv.stdout(), markers)).toEqual([]);
    expect(findIn(srv.stderr(), markers)).toEqual([]);
    expect(srv.stdout().toString("utf8")).toMatch(/^SHH_LISTENING 127\.0\.0\.1:\d+\n$/);
    const hits: string[] = [];
    for (const r of log) for (const l of findIn(Buffer.concat([r.response, Buffer.from(r.responseHeaders)]), markers)) hits.push(`${r.method} ${r.url} : ${l}`);
    expect(hits).toEqual([]);
    // Témoin : les repères sont bien partis dans les requêtes.
    expect(log.length).toBeGreaterThan(10);
    for (const r of log) expect(r.headers.find(([k]) => k === "user-agent")?.[1], r.url).toBe(R.ua);
    expect(log.some((r) => r.url.includes(R.id))).toBe(true);
    expect(log.some((r) => r.body.includes(R.reason))).toBe(true);
  });
});
