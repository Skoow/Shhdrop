// Module WebAssembly du salon (Task 9), dans Chromium, servi par le vrai serveur Go (CSP de
// production) depuis la page d'essai ui-e2e/salon-page/ (construite par global-setup.ts avec les
// greffons du site, passée à check-dist, jamais livrée) :
// - chargement à part : assets/salon-EMPREINTE.wasm lu une fois, en brotli, avec `integrity` ;
//   un octet modifié en route est refusé (erreur « reseau »), sans module partiel gardé ;
// - scénario de 10 membres de la Task 6 (9 arrivées, 100 messages, chacun dans sa trame), en
//   moins de 2 s ;
// - test croisé natif ↔ WebAssembly : Welcome, Commit et messages produits par le moteur natif
//   (test Rust `croise_natif`, engine/salon/tests/croise.rs, lancé ici) lus par le module, et
//   l'inverse ; MLS tire son aléa en interne, donc rien n'est écrit à l'avance.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const SALON_PAGE = fileURLToPath(new URL("./salon-page/dist", import.meta.url));
const ENGINE = fileURLToPath(new URL("../../engine", import.meta.url));
const CROISE = ["test", "-p", "shhdrop-salon", "--test", "croise", "--locked"];

// La page n'envoie rien au serveur : petit plafond de stockage (64 Mio), le test ne dépend pas de
// l'espace libre du disque (le serveur refuse de démarrer si le plafond dépasse l'espace utilisable).
test.use({ shhServer: { env: { SHH_STATIC_DIR: SALON_PAGE, SHH_STORAGE_MAX: String(64 << 20) } } });
test.beforeEach(({ browserName }) => test.skip(browserName !== "chromium", "module du salon vérifié sous Chromium"));

/** Outils de la page (hex, contrôle) et module chargé ; message d'erreur du chargement sinon. */
async function charger(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    w.hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    w.unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));
    w.ok = (c: unknown, m: string) => {
      if (!c) throw new Error(m);
    };
    try {
      w.S = await w.shhSalon();
      return "ok";
    } catch (e) {
      return (e as Error).message;
    }
  });
}

test("chargé à part : assets/salon-EMPREINTE.wasm lu une fois, en brotli, avec son empreinte ; un octet modifié est refusé", async ({ page, shh }) => {
  const wasm: string[] = [];
  page.on("request", (r) => void (new URL(r.url()).pathname.endsWith(".wasm") && wasm.push(new URL(r.url()).pathname)));
  const trap = async (route: import("@playwright/test").Route) => {
    const res = await route.fetch();
    const body = await res.body();
    body[body.length >> 1] ^= 1;
    await route.fulfill({ response: res, body });
  };
  await page.route("**/assets/salon-*.wasm", trap);
  await page.goto(shh.origin + "/");
  await expect(page.locator("#out")).toHaveText("prêt");
  expect(wasm).toEqual([]); // rien n'est lu avant le premier besoin
  expect(await charger(page)).toBe("reseau");
  await page.unroute("**/assets/salon-*.wasm", trap);
  const res = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith(".wasm"));
  expect(await charger(page)).toBe("ok");
  const r = await res;
  const h = await r.allHeaders();
  expect({ encoding: h["content-encoding"], type: h["content-type"], cache: h["cache-control"] }).toEqual({
    encoding: "br",
    type: "application/wasm",
    cache: "public, max-age=31536000, immutable",
  });
  const sizes = await r.request().sizes();
  console.info(`salon .wasm : ${sizes.responseBodySize} octets transférés (br), ${(await r.body()).length} octets décodés`);
  // Un second chargement réutilise le module : aucune autre lecture.
  expect(await charger(page)).toBe("ok");
  expect(wasm).toHaveLength(2);
  for (const p of wasm) expect(p).toMatch(/^\/assets\/salon-[A-Za-z0-9_-]{8}\.wasm$/);
});

test("10 membres (scénario de la Task 6) : 9 arrivées et 100 messages en trames, en moins de 2 s", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  expect(await charger(page)).toBe("ok");
  const r = await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    const { S, ok, hex } = w;
    const t0 = performance.now();
    const cles = S.clesSalon(new Uint8Array(32).fill(1), new Uint8Array(32).fill(2));
    const nonce = (s: number) => Uint8Array.from({ length: 16 }, (_, i) => (i === 0 ? s : 0xa0));
    const m = [S.Salon.creer(0, nonce(0), cles, true)];
    const liste = [{ siege: 0, nonce: nonce(0) }];
    m[0].remplacerAnnonces(0, liste);
    let seq = 0;
    const en_tete = { volatile: false, regle: 0 };
    // Le serveur range la trame au rang suivant et la remet à tous, expéditeur compris.
    const diffuser = (de: number, mls: Uint8Array) => {
      const trame = S.sceller(cles, en_tete, mls);
      seq++;
      return m.map((x) => x.recevoir(S.ouvrir(cles, trame).charge, seq, de));
    };
    for (let s = 1; s < 10; s++) {
      liste.push({ siege: s, nonce: nonce(s) });
      for (const x of m) x.annoncer(s, nonce(s));
      const n = S.Salon.creer(s, nonce(s), cles, false);
      n.remplacerAnnonces(0, liste);
      const kp = n.keyPackage();
      ok(diffuser(s, kp).every((e: any) => e.type === "keyPackage"), `KeyPackage ${s}`);
      const ev = diffuser(0, m[0].ajouter(kp));
      ok(ev[0].type === "commitAccepte" && ev[0].welcome instanceof Uint8Array, `écho du Commit ${s}`);
      ok(ev.slice(1).every((e: any) => e.type === "membres" && e.ajoutes.join() === String(s) && e.retires.length === 0), `Commit ${s}`);
      n.rejoindre(ev[0].welcome);
      m.push(n);
    }
    const arrivees = performance.now() - t0;
    for (let k = 0; k < 100; k++) {
      const de = k % 10;
      const x = `message ${k}`;
      const ev = diffuser(de, m[de].chiffrer({ id: new Uint8Array(16).fill(k), heureMs: 1_700_000_000_000 + k, regle: 0, message: { k: "texte", x } }));
      ev.forEach((e: any, i: number) => ok(i === de ? e.type === "ignore" : e.type === "message" && e.deSiege === de && e.enveloppe.message.x === x, `message ${k}, membre ${i}`));
    }
    const ms = performance.now() - t0;
    const sframe = new Set(m.map((x) => hex(x.exporterSframe())));
    const out = { ms, arrivees, epoques: m.map((x) => x.epoque()), membres: m.map((x) => x.membres().join()), sframe: sframe.size };
    for (const x of m) x.free();
    cles.free();
    return out;
  });
  console.info(`salon, 10 membres dans Chromium : ${r.ms.toFixed(0)} ms (dont 9 arrivées : ${r.arrivees.toFixed(0)} ms)`);
  expect(r.epoques).toEqual(Array(10).fill(9));
  expect(r.membres).toEqual(Array(10).fill("0,1,2,3,4,5,6,7,8,9"));
  expect(r.sframe).toBe(1);
  expect(r.ms).toBeLessThan(2000);
});

/** Fichier JSON écrit par le test Rust ; échoue s'il s'arrête avant. */
async function attendre(dir: string, nom: string, fini: { code: number | null }): Promise<Record<string, string>> {
  const p = join(dir, nom);
  await expect.poll(() => existsSync(p) || fini.code !== null, { timeout: 120_000 }).toBe(true);
  expect(existsSync(p), `${nom} : croise_natif s'est arrêté (code ${fini.code})`).toBe(true);
  return JSON.parse(readFileSync(p, "utf8"));
}

function ecrire(dir: string, nom: string, v: unknown) {
  writeFileSync(join(dir, nom + ".tmp"), JSON.stringify(v));
  renameSync(join(dir, nom + ".tmp"), join(dir, nom));
}

test("croisé natif ↔ WebAssembly : Welcome, Commit et messages du moteur natif lus par le module, et l'inverse", async ({ page, shh }) => {
  test.setTimeout(20 * 60_000);
  // Compilation du test Rust d'abord (debug, OpenMLS optimisé : engine/Cargo.toml), hors du délai d'échange.
  execFileSync("cargo", [...CROISE, "--no-run"], { cwd: ENGINE, stdio: "inherit" });
  const dir = mkdtempSync(join(tmpdir(), "shh-croise-"));
  const fini = { code: null as number | null };
  const rust = spawn("cargo", [...CROISE, "--", "croise_natif", "--exact", "--nocapture"], {
    cwd: ENGINE,
    env: { ...process.env, SHH_CROISE_DIR: dir },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const exit = new Promise<number>((res) => rust.on("exit", (c) => res((fini.code = c ?? 1))));
  try {
    await page.goto(shh.origin + "/");
    expect(await charger(page)).toBe("ok");
    // 1. Le module tire les clés des deux salons et les nonces d'arrivée ; B (siège 1 du salon 1) publie son KeyPackage.
    ecrire(
      dir,
      "wasm-1.json",
      await page.evaluate(() => {
        const w = window as unknown as Record<string, any>;
        const { S, hex } = w;
        const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n));
        const k: Record<string, Uint8Array> = { k_lien_1: rnd(32), k_mdp_1: rnd(32), k_lien_2: rnd(32), k_mdp_2: rnd(32), n_a: rnd(16), n_b: rnd(16), n_c: rnd(16), n_d: rnd(16) };
        const k1 = S.clesSalon(k.k_lien_1, k.k_mdp_1);
        const k2 = S.clesSalon(k.k_lien_2, k.k_mdp_2);
        const B = S.Salon.creer(1, k.n_b, k1, false);
        B.remplacerAnnonces(0, [
          { siege: 0, nonce: k.n_a },
          { siege: 1, nonce: k.n_b },
        ]);
        const t_kp_b = S.sceller(k1, { volatile: false, regle: 0 }, B.keyPackage());
        w.croise = { k, k1, k2, B };
        return Object.fromEntries(Object.entries({ ...k, t_kp_b }).map(([n, v]) => [n, hex(v)]));
      }),
    );
    // 2. B entre par le Welcome natif, lit le message de A, écrit, renouvelle ses clés, écrit encore ;
    //    C crée le salon 2 et ajoute D (natif) par son KeyPackage.
    const n1 = await attendre(dir, "natif-1.json", fini);
    ecrire(
      dir,
      "wasm-2.json",
      await page.evaluate((n1) => {
        const w = window as unknown as Record<string, any>;
        const { S, hex, unhex, ok, croise } = w;
        const { k, k1, k2, B } = croise;
        const ouv = (c: unknown, h: string) => S.ouvrir(c, unhex(h)).charge;
        const t = (c: unknown, mls: Uint8Array) => hex(S.sceller(c, { volatile: false, regle: 0 }, mls));
        B.rejoindre(ouv(k1, n1.t_welcome_1));
        ok(B.epoque() === 1 && B.membres().join() === "0,1", "B dans le salon 1");
        ok(hex(B.exporterSframe()) === n1.sframe_1, "clé SFrame du salon 1");
        ok(JSON.stringify([B.empreinte(0), B.empreinte(1)]) === JSON.stringify(n1.empreintes_1), "codes de vérification du salon 1");
        let ev = B.recevoir(ouv(k1, n1.t_m1), 3, 0);
        ok(ev.type === "message" && ev.deSiege === 0 && hex(S.encoder(ev.enveloppe)) === n1.env1, "message natif lu par le module");
        ok(ev.enveloppe.message.x === "Bonjour du natif, é 😀\nligne 2" && ev.enveloppe.regle === 2, "texte du message natif");
        const env2 = { id: new Uint8Array(16).fill(2), heureMs: 1_700_000_000_002, regle: 1, message: { k: "texte", x: "Réponse du module 🎉" } };
        const m2 = B.chiffrer(env2);
        ok(B.recevoir(m2, 4, 1).type === "ignore", "écho de m2");
        const c = B.renouveler();
        ev = B.recevoir(c, 5, 1);
        ok(ev.type === "commitAccepte" && ev.welcome === null && B.epoque() === 2, "renouvellement de B");
        const env3 = { id: new Uint8Array(16).fill(3), heureMs: 1_700_000_000_003, regle: 0, message: { k: "reaction", cible: new Uint8Array(16).fill(1), emoji: "👍" } };
        const m3 = B.chiffrer(env3);
        ok(B.recevoir(m3, 6, 1).type === "ignore", "écho de m3");
        const C = S.Salon.creer(0, k.n_c, k2, true);
        C.remplacerAnnonces(0, [{ siege: 0, nonce: k.n_c }]);
        C.annoncer(1, k.n_d);
        const kp_d = ouv(k2, n1.t_kp_d);
        ok(C.recevoir(kp_d, 1, 1).type === "keyPackage", "KeyPackage natif reconnu");
        ev = C.recevoir(C.ajouter(kp_d), 2, 0);
        ok(ev.type === "commitAccepte" && ev.welcome instanceof Uint8Array, "Welcome du module");
        const env4 = {
          id: new Uint8Array(16).fill(4),
          heureMs: 1_700_000_000_004,
          regle: 3,
          message: { k: "piece", r: new Uint8Array(32).fill(0x44), piece: new Uint8Array(16).fill(0x45), palier: 16, nom: "photo.png", mime: "image/png", taille: 12_345, sorte: "image", dureeMs: null },
        };
        const m4 = C.chiffrer(env4);
        ok(C.recevoir(m4, 3, 0).type === "ignore", "écho de m4");
        croise.C = C;
        return {
          t_m2: t(k1, m2),
          env2: hex(S.encoder(env2)),
          t_c: t(k1, c),
          t_m3: t(k1, m3),
          env3: hex(S.encoder(env3)),
          sframe_b: hex(B.exporterSframe()),
          t_welcome_2: t(k2, ev.welcome),
          t_m4: t(k2, m4),
          env4: hex(S.encoder(env4)),
          sframe_c: hex(C.exporterSframe()),
          empreintes_2: [C.empreinte(0), C.empreinte(1)],
        };
      }, n1),
    );
    // 3. C lit la réponse de D (natif), entré par le Welcome du module.
    const n2 = await attendre(dir, "natif-2.json", fini);
    expect(
      await page.evaluate((n2) => {
        const w = window as unknown as Record<string, any>;
        const { S, hex, unhex, croise } = w;
        const ev = croise.C.recevoir(S.ouvrir(croise.k2, unhex(n2.t_m5)).charge, 4, 1);
        const lu = ev.type === "message" && ev.deSiege === 1 && hex(S.encoder(ev.enveloppe)) === n2.env5 ? ev.enveloppe.message.pseudo : "?";
        for (const x of [croise.B, croise.C, croise.k1, croise.k2]) x.free();
        return lu;
      }, n2),
    ).toBe("Dédé");
    // Le test Rust a tout vérifié de son côté (messages du module, Commit, clés SFrame, codes).
    expect(await exit).toBe(0);
  } finally {
    if (fini.code === null) rust.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
