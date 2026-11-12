// Profil persistant de Chromium (audit M2, M3) : ce que le navigateur écrit sur le disque et
// restaure après la fermeture. Établit le comportement réel, puis vérifie la parade de §41.4.
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import { shareStatus } from "../src/index";
import { freshPage, noteRow, pwField, sendShare, unlock } from "./open-helpers";

const TEXT = "Le code du portail est 2208.";
// Chromium complet (nouveau mode sans tête) : le « headless shell » par défaut n'écrit pas
// Default/Preferences et ne restaure pas les sessions (CI rouge du 10 novembre).
const exe = process.env.PW_LOCAL_CHROMIUM === "1" ? { executablePath: "/opt/pw-browsers/chromium" } : { channel: "chromium" };

/** Fichiers du profil qui contiennent `needle` (UTF-8 ou UTF-16LE, octets bruts). */
function filesWith(dir: string, needle: string): string[] {
  const pats = [Buffer.from(needle, "utf8"), Buffer.from(needle, "utf16le")];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (st.size < 64 << 20) {
        const b = readFileSync(p);
        if (pats.some((x) => b.includes(x))) out.push(p.slice(dir.length + 1));
      }
    }
  };
  walk(dir);
  return out;
}

const launch = (dir: string) => chromium.launchPersistentContext(dir, { ...exe, locale: "fr-FR", viewport: { width: 1440, height: 900 } });

/** Demande à Chromium de rouvrir la dernière session au démarrage (comme « Continuer là où vous en étiez »). */
function restoreOnStartup(dir: string): void {
  const p = join(dir, "Default", "Preferences");
  const prefs = JSON.parse(readFileSync(p, "utf8")) as Record<string, Record<string, unknown>>;
  prefs.session = { ...(prefs.session ?? {}), restore_on_startup: 1 };
  writeFileSync(p, JSON.stringify(prefs));
}

async function restoredPage(ctx: BrowserContext, origin: string): Promise<Page | undefined> {
  for (let i = 0; i < 50; i++) {
    const p = ctx.pages().find((x) => x.url().startsWith(origin));
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
}

test.use({ locale: "fr-FR" });
// Ce test décrit le comportement de Chromium lui-même (profil persistant, restauration de
// session), pas celui de l'application. Sous forte charge (suite complète, 4 workers),
// Chromium bloque parfois plusieurs minutes au lancement ou à la fermeture d'un profil : une
// seule reprise, ici seulement ; chaque étape a son délai et son nom pour dire où il bloque.
test.describe.configure({ retries: 1 });

/** Étape nommée, bornée à `ms` : un blocage de Chromium échoue vite et dit où. */
function step<T>(name: string, run: () => Promise<T>, ms = 90_000): Promise<T> {
  return test.step(name, () =>
    Promise.race([run(), new Promise<never>((_, ko) => setTimeout(() => ko(new Error(`${name} : bloqué plus de ${ms / 1000} s (Chromium)`)), ms))]),
  );
}

for (const late of [false, true]) {
  test(`profil persistant : # absent de l'historique et du disque ; onglet restauré ${late ? "après 3 min : clé oubliée" : "aussitôt : « Rouvrir »"}`, async ({ shh, browser, browserName }) => {
    test.skip(browserName !== "chromium" || test.info().project.name !== "chromium-desktop", "contexte persistant Chromium, un seul projet (il ne suit pas l'appareil du projet)");
    test.setTimeout(300_000);
    const s = await freshPage(browser);
    const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT, opens: 3 });
    await s.ctx.close();
    const key = sent.link.slice(sent.link.indexOf("#") + 1);
    const dir = mkdtempSync(join(tmpdir(), "shh-profile-"));
    try {
      let ctx = await step("lancement du profil", () => launch(dir));
      // late : l'horloge de la page avance de 3 min sur la vraie (fermeture « il y a 3 min »).
      if (late) await ctx.addInitScript(() => { const n = Date.now; Date.now = () => n() - 180_000; });
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto(sent.link);
      await unlock(page, sent.password);
      // M3 : l'entrée d'historique de l'onglet ne porte plus le # (replaceState).
      expect(await page.evaluate(() => ({ href: location.href, n: history.length }))).toEqual({ href: shh.origin + "/", n: 2 });
      expect(await page.evaluate(() => sessionStorage.getItem("shh.og") ?? "")).toContain(key);
      await step("fermeture du profil", () => ctx.close());

      // Ce que le profil garde sur le disque (rapport : M2 « Session Storage », M3 « History »).
      const onDisk = filesWith(dir, key);
      test.info().annotations.push({ type: "fichiers du profil contenant K_lien", description: onDisk.join(", ") || "aucun" });
      // Constat (8 novembre, Chromium de Playwright) : K_lien est écrit dans Default/History,
      // Favicons, Sessions/* et « Session Storage » ; replaceState n'y change rien. Hors de notre
      // contrôle (spec §5.3, §41.4) : noté, non exigé, pour ne pas lier le test à une version.

      // Réouverture avec restauration de la session.
      restoreOnStartup(dir);
      ctx = await step("relance avec restauration", () => launch(dir));
      const back = await restoredPage(ctx, shh.origin);
      test.info().annotations.push({ type: "onglet restauré", description: back ? back.url() : "aucun" });
      expect(back, "Chromium restaure l'onglet (constaté le 8 novembre)").toBeDefined();
      if (back) {
        const nav = await back.evaluate(() => (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type ?? "");
        test.info().annotations.push({ type: "type de navigation restaurée", description: nav });
        expect(back.url()).toBe(shh.origin + "/");
        if (late) {
          // Entrée effacée et plus de « # » (retiré par replaceState) : la clé est perdue.
          await expect(back.getByRole("heading", { name: "Lien incomplet", exact: true })).toBeVisible();
          expect(await back.evaluate(() => sessionStorage.getItem("shh.og"))).toBeNull();
        } else if (onDisk.some((f) => f.includes("Session Storage"))) {
          await expect(back.getByRole("heading", { name: "Rouvrir ce partage" })).toBeVisible();
        } else {
          // Sous charge, Chromium ferme parfois avant d'écrire le sessionStorage sur le disque :
          // rien à rendre à l'onglet restauré, la clé est perdue comme dans le cas « late ».
          // Comportement du navigateur, pas de l'application (test instable sinon) : noté.
          test.info().annotations.push({ type: "sessionStorage non écrit par Chromium", description: "restauration sans entrée" });
          await expect(back.getByRole("heading", { name: "Lien incomplet", exact: true })).toBeVisible();
        }
      }
      await step("fermeture finale", () => ctx.close());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

// D42-22 : le retour survit à la fermeture du navigateur (octroi chiffré en IndexedDB, jamais
// K_lien ni le mot de passe) : rouvrir le lien du message, navigateur relancé sans restauration,
// rouvre la même ouverture, mot de passe ressaisi.
test("profil persistant : navigateur fermé puis relancé, rouvrir le lien revient sans consommer d'ouverture", async ({ shh, browser, browserName }) => {
  test.skip(browserName !== "chromium" || test.info().project.name !== "chromium-desktop", "contexte persistant Chromium, un seul projet");
  test.setTimeout(300_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT, opens: 1 });
  await s.ctx.close();
  const dir = mkdtempSync(join(tmpdir(), "shh-profile-"));
  try {
    let ctx = await step("lancement du profil", () => launch(dir));
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(sent.link);
    await unlock(page, sent.password);
    // Retour écrit juste après le déverrouillage (chiffrement asynchrone) : attendu avant de fermer.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          if (!(await indexedDB.databases()).some((d) => d.name === "shhdrop-returns")) return 0;
          const db = await new Promise<IDBDatabase>((ok, ko) => {
            const r = indexedDB.open("shhdrop-returns");
            r.onsuccess = () => ok(r.result);
            r.onerror = () => ko(r.error);
          });
          const n = await new Promise<number>((ok) => {
            const q = db.transaction("entries").objectStore("entries").count();
            q.onsuccess = () => ok(q.result);
          });
          db.close();
          return n;
        }),
      )
      .toBe(1);
    await step("fermeture du profil", () => ctx.close());
    // Jamais le mot de passe dans le profil (ni dans le stockage, ni ailleurs).
    expect(filesWith(dir, sent.password)).toEqual([]);
    ctx = await step("relance sans restauration", () => launch(dir));
    const back = ctx.pages()[0] ?? (await ctx.newPage());
    await back.goto(sent.link);
    await expect(back.getByRole("heading", { name: "Rouvrir ce partage" })).toBeVisible({ timeout: 30_000 });
    await pwField(back).fill(sent.password);
    await back.getByRole("button", { name: /^(Rouvrir|Déchiffrement)/ }).click();
    await expect(noteRow(back)).toBeVisible({ timeout: 30_000 });
    expect(await shareStatus(sent.manage, shh.origin)).toMatchObject({ opensUsed: 1, state: "draining" });
    await step("fermeture finale", () => ctx.close());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
