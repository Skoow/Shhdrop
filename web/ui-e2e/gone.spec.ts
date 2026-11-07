// Disparition du partage pendant un téléchargement (spec §41.8, tâche E1), vrai serveur.
// (a) compte à rebours à zéro pendant un enregistrement : l'interface se ferme aussitôt, le
//     fichier en cours est nommé et se termine (octets identiques), « Terminé » ;
// (b) rien en cours : la page de fin ordinaire, sans nom ;
// (c) destruction faite ici pendant un enregistrement : le serveur efface tout de suite (la
//     grâce de la Task M2 n'existe pas encore) → « Téléchargement interrompu. », partiel supprimé.
// Le cas « surveillance » (watch, 410) attend la route serveur de la Task M2 (WATCH_READY).
import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { axe, capture, expect, test } from "./fixtures";
import { freshPage, sendShare, settle, unlock } from "./open-helpers";

test.use({ locale: "fr-FR" });
test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "faux sélecteur de fichier : Chromium, une passe");

/** 6 Mio pseudo-aléatoires : deux segments de données. */
const BIG = Buffer.alloc(6 * 1048576);
for (let i = 0, x = 11; i < BIG.length; i++) BIG[i] = (x = (x * 1103515245 + 12345) & 0x7fffffff) >>> 16;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function fakePicker(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.showSaveFilePicker = async () => {
      const parts: Uint8Array[] = [];
      return {
        createWritable: async () => ({
          write: async (c: Uint8Array) => void parts.push(new Uint8Array(c)),
          close: async () => {
            const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
            let o = 0;
            for (const p of parts) all.set(p, (o += p.length) - p.length);
            const h = await crypto.subtle.digest("SHA-256", all);
            w.__sha = [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
            w.__closed = true;
          },
          abort: async () => void (w.__aborted = true),
        }),
      };
    };
  });
}
const win = (page: Page, k: string) => page.evaluate((key) => (window as unknown as Record<string, unknown>)[key], k);

async function opened(page: Page, browser: import("@playwright/test").Browser, origin: string) {
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, origin + "/", { text: "secret 4471", files: [{ name: "rapport.bin", mimeType: "application/octet-stream", buffer: BIG }] });
  await s.ctx.close();
  await fakePicker(page);
  await page.clock.install();
  await page.goto(sent.link);
  await unlock(page, sent.password);
  return sent;
}

test("(a) expiration pendant un enregistrement : fermeture aussitôt, fichier nommé, « Terminé », octets identiques ; captures", async ({ page, shh, browser }) => {
  test.setTimeout(150_000);
  await opened(page, browser, shh.origin);
  // Segments retenus le temps de voir l'écran pendant l'enregistrement.
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/shares/segments/*", async (r) => {
    await gate;
    await r.continue();
  });
  await page.getByRole("button", { name: "Enregistrer rapport.bin" }).click();
  await expect(page.locator(".save .progress")).toBeVisible();
  await page.clock.fastForward("12:30:00");
  // Fermeture immédiate : plus de liste, de texte ni de bouton ; le fichier en cours est nommé.
  await expect(page.getByRole("heading", { name: "Ce partage a expiré." })).toBeVisible();
  await expect(page.locator(".item, pre[dir=auto]")).toHaveCount(0);
  await expect(page.getByText(/^Le fichier en cours \(rapport\.bin\) est autorisé à se terminer\s; vous ne pouvez plus rien ouvrir d'autre\.$/)).toBeVisible();
  const row = page.locator('[data-transfer]');
  await expect(row).toHaveAttribute("data-transfer", "running");
  await expect(row).toContainText("Fichier en cours autorisé à se terminer");
  await expect(row.locator("progress")).toBeVisible();
  expect(await page.evaluate(() => document.body.innerText)).not.toContain("4471");
  await expect(page).toHaveTitle("Partage indisponible · Shhdrop");
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await capture(page, "gone-finishing");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "gone-finishing-390");
  await page.setViewportSize({ width: 1440, height: 900 });
  release();
  await expect(row).toHaveAttribute("data-transfer", "done", { timeout: 30_000 });
  await expect(row).toContainText("Terminé");
  expect(await win(page, "__closed")).toBe(true);
  expect(await win(page, "__aborted")).toBeUndefined();
  expect(await win(page, "__sha")).toBe(sha(BIG));
  await capture(page, "gone-finished");
});

test("(b) expiration sans enregistrement en cours : page de fin ordinaire, sans nom de fichier", async ({ page, shh, browser }) => {
  test.setTimeout(150_000);
  await opened(page, browser, shh.origin);
  await page.clock.fastForward("12:30:00");
  await expect(page.getByRole("heading", { name: "Ce partage a expiré." })).toBeVisible();
  await expect(page.getByText(/Son contenu a été effacé de cette page\./)).toBeVisible();
  await expect(page.locator("[data-transfer]")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/rapport\.bin|4471/);
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await capture(page, "gone");
});

test("(c) destruction faite ici pendant un enregistrement : nommé, puis « Téléchargement interrompu. », partiel supprimé", async ({ page, shh, browser }) => {
  test.setTimeout(150_000);
  await opened(page, browser, shh.origin);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/shares/segments/*", async (r) => {
    await gate;
    await r.continue();
  });
  await page.getByRole("button", { name: "Enregistrer rapport.bin" }).click();
  await expect(page.locator(".save .progress")).toBeVisible();
  await page.getByRole("button", { name: "Détruire ce partage pour tout le monde" }).click();
  await page.getByRole("button", { name: "Détruire", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ce partage a été détruit." })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^Le fichier en cours \(rapport\.bin\) est autorisé à se terminer\s; vous ne pouvez plus rien ouvrir d'autre\.$/)).toBeVisible();
  release();
  const row = page.locator("[data-transfer]");
  await expect(row).toHaveAttribute("data-transfer", "failed", { timeout: 60_000 });
  await expect(row).toContainText("Téléchargement interrompu.");
  expect(await win(page, "__aborted")).toBe(true);
  expect(await win(page, "__closed")).toBeUndefined();
});
