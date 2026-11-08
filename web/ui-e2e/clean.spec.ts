// Nettoyage automatique des métadonnées (spec §35.2, Task 9a ; décision du propriétaire du
// 8 novembre, D41-23) : marque « Nettoyé » dès l'ajout, marque « Non nettoyé » et sa raison,
// envoi sans clic, résumé près d'Envoyer, réglage « Original », photo reçue sans GPS
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

test("états à l'écran : Nettoyé, Non nettoyé avec raison (échec, PDF, archive, inconnu) ; tout part sans clic (D41-23) ; résumé près d'Envoyer", async ({ page, shh, isMobile }) => {
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
    { name: "dessin.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") },
  ]);
  await expect(page.locator("[data-row]")).toHaveCount(5);
  await expect(row(page, "IMG_GPS").locator('[data-clean="nettoye"]')).toBeVisible();
  await expect(row(page, "IMG_GPS").locator('[data-clean="non-nettoye"]')).toHaveCount(0);
  const mark = (n: string) => row(page, n).locator('[data-clean="non-nettoye"]');
  await expect(mark("abime")).toHaveText(/^Non nettoyé · Échec du nettoyage/);
  // contrat.pdf : ni table xref ni « startxref » (fichier d'essai minimal) → échec honnête.
  await expect(mark("contrat")).toHaveText(/^Non nettoyé · Échec du nettoyage/);
  await expect(mark("archive")).toHaveText(/^Non nettoyé · Archive\s:\scontenu non inspecté/);
  await expect(mark("dessin")).toHaveText(/^Non nettoyé · Format non reconnu/);
  // Aucun choix à faire : plus de bouton, envoi permis, résumé discret près d'Envoyer.
  await expect(page.getByRole("button", { name: /^Envoyer tel quel/ })).toHaveCount(0);
  await expect(page.locator("#send-reason").filter({ visible: true })).toHaveCount(0);
  await expect(page.locator("[data-unclean-sum]").filter({ visible: true })).toHaveText("4 fichiers ne sont pas nettoyés");
  await expect(sendButton(page).filter({ visible: true })).toBeEnabled();
  // Chacun part dès l'ajout, nettoyé ou non (une requête d'envoi par petit élément).
  await expect.poll(() => puts.length, { timeout: 30_000 }).toBe(5);
  await expect(page.locator('[data-up]:not([data-up="pret"])')).toHaveCount(0, { timeout: 30_000 });
  if (isMobile) await page.screenshot({ path: `${SHOTS}compose-clean-states-390.png` });
});

test("document Word avec auteur (Task 9b) : « Nettoyé » à l'ajout, remarque des modifications suivies, reçu sans auteur ni société", async ({ page, shh, browser }) => {
  test.setTimeout(120_000);
  const doc = { name: "rapport.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: FX("meta.docx") };
  const s = await freshPage(browser);
  await s.page.goto(shh.origin + "/");
  await (await openFilePicker(s.page)).setFiles(doc);
  const r = row(s.page, "rapport");
  await expect(r.locator('[data-clean="nettoye"]')).toHaveText(/^Nettoyé/);
  await expect(r.locator('[data-clean="nettoye"]')).toHaveAttribute("title", "Nettoyé · auteur, société et dates retirés, auteurs des commentaires remplacés");
  await expect(r.locator("[data-clean-note]")).toHaveText("Les modifications suivies gardent le nom de leurs auteurs.");
  await s.ctx.close();
  const s2 = await freshPage(browser);
  const sent = await sendShare(s2.page, shh.origin + "/", { files: [doc] });
  await s2.ctx.close();
  await fakePicker(page);
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await page.getByRole("button", { name: "Télécharger rapport.docx" }).click();
  await expect(page.locator('li.row[data-state="done"]')).toBeVisible({ timeout: 30_000 });
  const got = Buffer.from((await page.evaluate(() => (window as unknown as { __bytes: string }).__bytes)) as string, "base64");
  const want = await cleaned("meta.docx", doc.mimeType);
  expect(got.equals(want)).toBe(true);
  expect(got.subarray(0, 4).toString("latin1")).toBe("PK\x03\x04");
  expect(got.toString("latin1")).not.toMatch(/ReperAuteur|ReperSociete|ReperCommentateur|ReperCompte|ReperMiniature/);
  expect(doc.buffer.toString("latin1")).toMatch(/ReperAuteur/);
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
