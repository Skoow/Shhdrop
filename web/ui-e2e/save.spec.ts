// Télécharger (Task 23, UI §9.9 ; Task R2) sur le vrai serveur : en flux vers le sélecteur de
// fichier (faux sélecteur, octets comparés), coupure → partiel gardé puis nouvel essai repris à
// l'octet écrit, repli <a download> avec nom nettoyé et avertissement, « voir seulement » sans
// Télécharger.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { axe, capture, expect, test } from "./fixtures";
import { file, freshPage, sendShare, settle, unlock } from "./open-helpers";

test.use({ locale: "fr-FR" });

/** 6 Mio pseudo-aléatoires : deux segments de données. */
const BIG = Buffer.alloc(6 * 1048576);
for (let i = 0, x = 7; i < BIG.length; i++) BIG[i] = (x = (x * 1103515245 + 12345) & 0x7fffffff) >>> 16;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Faux showSaveFilePicker : garde le nom proposé, les octets écrits, close() / abort(). */
async function fakePicker(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.showSaveFilePicker = async ({ suggestedName }: { suggestedName: string }) => {
      w.__name = suggestedName;
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

test("sélecteur de fichier : nom nettoyé, octets identiques, progression tabulaire, « Enregistré » ; captures", async ({ page, shh, browser }) => {
  test.setTimeout(150_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { files: [{ name: "rapport.bin", mimeType: "application/octet-stream", buffer: BIG }] });
  await s.ctx.close();
  await fakePicker(page);
  await page.goto(sent.link);
  await unlock(page, sent.password);
  // Lecture ralentie pour voir la progression.
  await page.route("**/api/shares/segments/*", async (r) => {
    await new Promise((res) => setTimeout(res, 1200));
    await r.continue();
  });
  await page.getByRole("button", { name: "Télécharger rapport.bin" }).click();
  const progress = page.locator('li.row[data-state="downloading"] .meta');
  await expect(progress).toBeVisible();
  await expect(progress).toHaveCSS("font-variant-numeric", "tabular-nums");
  await capture(page, "save-progress");
  // Téléchargé : icône de téléchargement verte sur la ligne (retours UI4).
  await expect(page.locator('li.row[data-state="done"] button[data-done]')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('li.row[data-state="done"] button[data-done]').evaluate((e) => getComputedStyle(e).color)).toBe("rgb(95, 227, 181)");
  expect(await win(page, "__name")).toBe("rapport.bin");
  expect(await win(page, "__closed")).toBe(true);
  expect(await win(page, "__aborted")).toBeUndefined();
  expect(await win(page, "__sha")).toBe(sha(BIG));
});

test("coupure du 2ᵉ segment au-delà des essais → partiel gardé, message ; Réessayer reprend et finit, octets identiques", async ({ page, shh, browser }) => {
  test.setTimeout(150_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { files: [{ name: "rapport.bin", mimeType: "application/octet-stream", buffer: BIG }] });
  await s.ctx.close();
  await fakePicker(page);
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await page.route("**/api/shares/segments/1", (r) => r.abort("connectionreset"));
  await page.getByRole("button", { name: "Télécharger rapport.bin" }).click();
  await expect(page.getByText("Coupure réseau : la partie déjà reçue est gardée.")).toBeVisible({ timeout: 60_000 });
  expect(await win(page, "__aborted")).toBeUndefined();
  expect(await win(page, "__closed")).toBeUndefined();
  await page.unroute("**/api/shares/segments/1");
  await page.getByRole("button", { name: "Réessayer rapport.bin" }).click();
  await expect(page.locator('li.row[data-state="done"]')).toBeVisible({ timeout: 30_000 });
  expect(await win(page, "__closed")).toBe(true);
  expect(await win(page, "__sha")).toBe(sha(BIG));
});

test("sans sélecteur : avertissement avant un fichier à risque, téléchargement, nom nettoyé (sans U+202E), octets identiques ; capture", async ({ page, shh, browser }) => {
  test.setTimeout(150_000);
  const exe = readFileSync(file("installer.exe"));
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { files: [{ name: "facture‮fdp.exe", mimeType: "application/octet-stream", buffer: exe }] });
  await s.ctx.close();
  await page.addInitScript(() => void delete (window as unknown as Record<string, unknown>).showSaveFilePicker);
  await page.goto(sent.link);
  await unlock(page, sent.password);
  const row = page.locator("li.row").first();
  const name = (await row.locator(".name").textContent()) ?? "";
  expect(name).not.toContain("‮");
  await row.getByRole("button", { name: /^Télécharger/ }).click();
  await expect(page.getByText(/peut exécuter du code sur votre appareil/)).toBeVisible();
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await capture(page, "save-risky");
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Télécharger quand même" }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe(name);
  expect(d.suggestedFilename()).not.toContain("‮");
  expect(sha(readFileSync(await d.path()))).toBe(sha(exe));
  await expect(page.locator('li.row[data-state="done"]')).toBeVisible();
});

test("« voir seulement » : aucun Télécharger ni Copier, mention honnête de la capture d'écran", async ({ page, shh, browser }) => {
  test.setTimeout(150_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: "Rendez-vous à 18 h.", files: [file("foret-brume.jpg")], download: false });
  await s.ctx.close();
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await expect(page.getByText("L'expéditeur n'a pas autorisé le téléchargement. Une capture d'écran reste possible.")).toBeVisible();
  await expect(page.locator("li.row")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /Télécharger|\.zip/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Copier/ })).toHaveCount(0);
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await capture(page, "content-view-only");
});
