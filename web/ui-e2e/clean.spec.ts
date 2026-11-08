// Nettoyage automatique des métadonnées (spec §35.2, Task 9a ; décision du propriétaire du
// 8 novembre) : marque « Nettoyé » dès l'ajout, états « Non nettoyé » avec le choix Envoyer
// tel quel / Retirer, rien d'envoyé avant ce choix, réglage « Original », photo reçue sans GPS
// (octet par octet), images nettoyées toujours décodables (createImageBitmap).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { stripMetadata } from "../src/media/strip";
import { expect, test } from "./fixtures";
import { file, freshPage, sendShare, unlock } from "./open-helpers";
import { openFilePicker, sendButton } from "./send-helpers";

test.use({ locale: "fr-FR" });

const FX = (n: string) => readFileSync(fileURLToPath(new URL(`../src/media/fixtures/${n}`, import.meta.url)));
const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-9a/", import.meta.url));
const MARKERS = /ReperMake|ReperModel|ReperXMP|ReperThumb|ReperSecond|ReperMotion|2001:02:03/;
const row = (page: Page, name: string) => page.locator("[data-row]").filter({ hasText: name });

async function cleaned(name: string, mime: string): Promise<Buffer> {
  const r = await stripMetadata(new Blob([FX(name)]), mime, name);
  if (r.state !== "nettoye") throw new Error(`${name} : ${r.state}`);
  return Buffer.from(await r.data.arrayBuffer());
}

/** Faux showSaveFilePicker : garde les octets écrits (en base64). */
async function fakePicker(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.showSaveFilePicker = async () => {
      const parts: number[] = [];
      return {
        createWritable: async () => ({
          write: async (c: Uint8Array) => void parts.push(...new Uint8Array(c)),
          close: async () => void (w.__bytes = btoa(String.fromCharCode(...parts))),
          abort: async () => undefined,
        }),
      };
    };
  });
}

test("photo avec GPS : « Nettoyé » à l'ajout, le destinataire reçoit la photo nettoyée, octet par octet", async ({ page, shh, browser }) => {
  test.setTimeout(120_000);
  const s = await freshPage(browser);
  const photo = { name: "IMG_GPS.jpg", mimeType: "image/jpeg", buffer: FX("iphone-like.jpg") };
  await s.page.goto(shh.origin + "/");
  await (await openFilePicker(s.page)).setFiles(photo);
  const r = row(s.page, "IMG_GPS");
  await expect(r.locator('[data-clean="nettoye"]')).toHaveText(/^Nettoyé/);
  await expect(r.locator('[data-clean="nettoye"]')).toHaveAttribute("title", "Nettoyé · lieu, appareil et date retirés");
  await s.ctx.close();
  const s2 = await freshPage(browser);
  const sent = await sendShare(s2.page, shh.origin + "/", { files: [photo] });
  await s2.ctx.close();
  await fakePicker(page);
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await page.getByRole("button", { name: "Télécharger IMG_GPS.jpg" }).click();
  await expect(page.locator('li.row[data-state="done"]')).toBeVisible({ timeout: 30_000 });
  const got = Buffer.from((await page.evaluate(() => (window as unknown as { __bytes: string }).__bytes)) as string, "base64");
  const want = await cleaned("iphone-like.jpg", "image/jpeg");
  expect(got.equals(want)).toBe(true);
  expect(got.toString("latin1")).not.toMatch(MARKERS);
  expect(got.length).toBeLessThan(photo.buffer.length);
});

test("états à l'écran : Nettoyé, Non nettoyé (échec, non pris en charge, bientôt) ; rien n'est envoyé avant « Envoyer tel quel » ; capture", async ({ page, shh, isMobile }) => {
  test.setTimeout(90_000);
  if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
  const puts: string[] = [];
  page.on("request", (q) => {
    if (q.method() === "PUT" && q.url().includes("/api/shares/segments/")) puts.push(q.url());
  });
  await page.goto(shh.origin + "/");
  const jpg = FX("iphone-like.jpg");
  await (await openFilePicker(page)).setFiles([
    { name: "IMG_GPS.jpg", mimeType: "image/jpeg", buffer: jpg },
    { name: "abime.jpg", mimeType: "image/jpeg", buffer: jpg.subarray(0, jpg.length >> 2) },
    { name: "contrat.pdf", mimeType: "application/pdf", buffer: readFileSync(file("contrat.pdf")) },
    { name: "archive.zip", mimeType: "application/zip", buffer: readFileSync(file("archive.zip")) },
  ]);
  await expect(page.locator("[data-row]")).toHaveCount(4);
  await expect(row(page, "IMG_GPS").locator('[data-clean="nettoye"]')).toBeVisible();
  await expect(row(page, "abime").getByText("Non nettoyé : échec.", { exact: false })).toBeVisible();
  await expect(row(page, "contrat").getByText("Non nettoyé : bientôt pris en charge.", { exact: false })).toBeVisible();
  await expect(row(page, "archive").getByText("Non nettoyé : format non pris en charge.", { exact: false })).toBeVisible();
  const reason = page.locator("#send-reason").filter({ visible: true });
  await expect(reason).toHaveText("Un fichier n'a pas pu être nettoyé : choisissez « Envoyer tel quel » ou « Retirer ».");
  await expect(sendButton(page).filter({ visible: true })).toBeDisabled();
  // Seule la photo nettoyée part : une requête d'envoi (petit élément), aucune pour les autres.
  await expect(row(page, "IMG_GPS").locator('[data-up="pret"]')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(500);
  expect(puts).toHaveLength(1);
  if (isMobile) await page.screenshot({ path: `${SHOTS}compose-clean-states-390.png` });
  await page.getByRole("button", { name: "Retirer : abime.jpg" }).click();
  await expect(page.locator("[data-row]")).toHaveCount(3);
  await page.getByRole("button", { name: "Envoyer tel quel : contrat.pdf" }).click();
  await page.getByRole("button", { name: "Envoyer tel quel : archive.zip" }).click();
  await expect(row(page, "contrat").locator('[data-clean="tel-quel"]')).toHaveText(/^Non nettoyé/);
  await expect(reason).toHaveCount(0);
  await expect.poll(() => puts.length, { timeout: 30_000 }).toBe(3);
  if (isMobile) await page.screenshot({ path: `${SHOTS}compose-clean-accepted-390.png` });
});

test("réglage « Nettoyer automatiquement les fichiers » désactivé : marque « Original », rien de modifié", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  const tab = page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: "Réglages" });
  if (await tab.isVisible()) await tab.click();
  else await page.getByRole("banner").getByRole("button", { name: "Réglages" }).click();
  const sw = page.getByRole("dialog", { name: "Réglages" }).getByRole("switch", { name: "Nettoyer automatiquement les fichiers" });
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await (await openFilePicker(page)).setFiles({ name: "IMG_GPS.jpg", mimeType: "image/jpeg", buffer: FX("iphone-like.jpg") });
  await expect(row(page, "IMG_GPS").locator('[data-clean="original"]')).toHaveText(/^Original/);
  await expect(page.locator("#send-reason").filter({ visible: true })).toHaveCount(0);
});

test("images nettoyées toujours décodables (createImageBitmap), orientation gardée", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  const cases: [string, string][] = [
    ["iphone-like.jpg", "image/jpeg"],
    ["progressive.jpg", "image/jpeg"],
    ["meta.png", "image/png"],
    ["meta.webp", "image/webp"],
    ["simple.webp", "image/webp"],
    ["meta.gif", "image/gif"],
    ["meta.avif", "image/avif"],
  ];
  const decode = (b: Buffer, mime: string) =>
    page.evaluate(async ([data, type]) => {
      const bytes = Uint8Array.from(atob(data!), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type }));
      return [bmp.width, bmp.height];
    }, [b.toString("base64"), mime]);
  for (const [name, mime] of cases) {
    // Même taille affichée qu'avant le nettoyage : l'orientation est gardée.
    const size = await decode(await cleaned(name, mime), mime);
    expect(size, name).toEqual(await decode(FX(name), mime));
    // Orientation EXIF 6 : l'image de 16 × 8 s'affiche en 8 × 16.
    if (name === "iphone-like.jpg") expect(size).toEqual([8, 16]);
  }
});
