// Retours DROP du propriétaire, sur le vrai serveur : une note part dès sa validation comme un
// fichier (D41-36 : son texte est la donnée d'un élément chiffré, plus dans le manifeste) ;
// cadenas vert « Chiffré, prêt à partir » avant le clic ; modifiée → renvoyée, le destinataire lit
// la nouvelle version. La ligne d'une note ne montre que son titre (jamais le contenu), chez
// l'expéditeur comme chez le destinataire. Ordinateur : la zone de dépôt est en filigrane dans
// l'espace vide de la liste, texte entier. Captures fr-FR ×2 à 1440 px.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { openShare } from "../src/index";
import { captureOf, expect, test } from "./fixtures";
import { file, freshPage, unlock } from "./open-helpers";
import { addText, noViewTransition, openFilePicker, readyHeading, sendButton } from "./send-helpers";

const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-DROP/", import.meta.url));
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris", deviceScaleFactor: 2 });

const noteRow = (page: Page, name = "Note") => page.locator("[data-row]").filter({ has: page.locator(`.nm[title="${name}"]`) });

async function editNote(page: Page, text: string) {
  const direct = page.getByRole("button", { name: "Modifier Note" });
  if (await direct.isVisible()) await direct.click();
  else {
    await page.getByRole("button", { name: "Actions pour Note" }).click();
    await page.getByRole("dialog", { name: "Note" }).getByRole("button", { name: "Modifier" }).click();
  }
  const dlg = page.getByRole("dialog", { name: "Modifier le texte" });
  await dlg.getByLabel("Contenu").fill(text);
  await expect(dlg.locator(".count")).toHaveText(`${text.length} / 100 000`);
  await dlg.getByRole("button", { name: "Enregistrer" }).click();
  await expect(dlg).toBeHidden();
}

test("note : cadenas vert avant le clic ; modifiée → renvoyée, nouvelle version reçue ; jamais le contenu dans la ligne", async ({ page, shh }) => {
  test.setTimeout(120_000);
  const puts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT") puts.push(r.url());
  });
  await page.goto(shh.origin + "/");
  await addText(page, "contenu-secret-v1");
  const row = noteRow(page);
  await expect(row.locator("[data-up]")).toHaveAttribute("data-up", "pret", { timeout: 30_000 });
  await expect(row.locator("[data-lock] button")).toHaveAccessibleName(/Chiffré, prêt à partir/);
  await expect(row).not.toContainText("contenu-secret");
  await expect(row.locator(".meta")).toContainText("Texte");
  expect(puts.length).toBe(1);

  await editNote(page, "contenu-secret-v2");
  await expect.poll(() => puts.length, { timeout: 30_000 }).toBe(2);
  await expect(row.locator("[data-up]")).toHaveAttribute("data-up", "pret", { timeout: 30_000 });

  await sendButton(page).click();
  await expect(readyHeading(page)).toBeVisible({ timeout: 60_000 });
  expect(puts.length).toBe(2); // rien de plus au clic : la note était déjà partie
  const read = async (name: string) => (await page.getByRole("group", { name }).locator(".sr-only").first().textContent()) ?? "";
  const link = await read("Lien");
  const password = await read("Mot de passe");
  const o = await openShare(link, password, shh.origin);
  expect(o.manifest.items.map((e) => [e.kind, e.name, e.text])).toEqual([["text", "Note", "contenu-secret-v2"]]);
  await o.done();
});

test("ordinateur : filigrane de dépôt dans la liste (texte entier, clic → choix de fichiers) ; ligne de note et destinataire ; captures", async ({ page, shh, browser, isMobile }) => {
  test.skip(isMobile, "mobile inchangé (bouton Ajouter)");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(shh.origin + "/envoyer");
  await (await openFilePicker(page)).setFiles([{ name: "plage-nuit.jpg", mimeType: "image/jpeg", buffer: readFileSync(file("plage-nuit.jpg")) }]);
  await expect(page.locator("[data-row]")).toHaveCount(1);
  await expect(page.getByRole("group", { name: "Créer sur place" })).toBeVisible();
  await addText(page, "Le code de la porte est 4471.\nDeuxième ligne.");
  await expect(page.locator("[data-row]")).toHaveCount(2);
  await expect(page.locator("[data-up]:not([data-up=pret])")).toHaveCount(0, { timeout: 30_000 });

  const dz = page.locator(".lc-scroll .dropzone");
  await expect(dz).toBeVisible();
  for (const el of await dz.locator(".dz-t, .dz-s").all()) {
    expect(await el.evaluate((n) => n.scrollWidth <= n.clientWidth && getComputedStyle(n).textOverflow !== "ellipsis")).toBe(true);
  }
  await expect(dz).toContainText("Déposez des fichiers n'importe où sur la page");
  await expect(dz).toContainText("ou cliquez ici pour les choisir");
  // Sous la liste, dans l'espace vide ; texte plus clair que les noms des lignes.
  const [rows, zone] = [await page.locator(".groups").boundingBox(), await dz.boundingBox()];
  expect(zone!.y).toBeGreaterThanOrEqual(rows!.y + rows!.height);
  expect(zone!.height).toBeGreaterThan(200);
  const light = (sel: string) => page.locator(sel).first().evaluate((n) => getComputedStyle(n).color);
  expect(await light(".lc-scroll .dropzone .dz-t")).not.toBe(await light("[data-row] .nm"));
  const chooser = page.waitForEvent("filechooser");
  await dz.click({ position: { x: 20, y: 20 } });
  await chooser;
  await expect(noteRow(page)).not.toContainText("4471");
  await page.screenshot({ path: SHOTS + "composeur-filigrane-1440.png" });
  await captureOf(noteRow(page), { path: SHOTS + "ligne-note-1440.png" });

  // Destinataire : même règle, le contenu se lit avec « Voir ».
  await sendButton(page).click();
  await expect(readyHeading(page)).toBeVisible({ timeout: 60_000 });
  const read = async (name: string) => (await page.getByRole("group", { name }).locator(".sr-only").first().textContent()) ?? "";
  const link = await read("Lien");
  const password = await read("Mot de passe");
  const { ctx, page: rp } = await freshPage(browser, { deviceScaleFactor: 2 });
  await rp.goto(link);
  await unlock(rp, password);
  const recv = rp.locator("li[data-item]").filter({ hasText: "Note" }).first();
  await expect(recv).toBeVisible({ timeout: 30_000 });
  await expect(recv).not.toContainText("4471");
  await expect(recv).toContainText("Texte");
  await rp.screenshot({ path: SHOTS + "destinataire-ligne-note-1440.png" });
  await ctx.close();
});

test("page d'envoi vide « /envoyer » : atteinte par « Commencer » ou directement ; cadre compact en tête de liste (ordinateur, retours du 12 novembre), « Ajouter » (téléphone) ; captures", async ({ page, shh, isMobile }) => {
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.goto(shh.origin + "/");
  await page.getByRole("button", { name: /^Commencer/ }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(shh.origin + "/envoyer");
  await noViewTransition(page);
  await expect(page.getByRole("heading", { name: "Votre envoi" })).toBeVisible();
  await expect(page.locator("[data-row]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tout supprimer" })).toHaveCount(0);
  const zone = page.locator(".dropzone.empty");
  await expect(zone).toBeVisible();
  if (isMobile) {
    await expect(zone).toContainText("Ajouter");
    await zone.click();
    await expect(page.getByRole("dialog", { name: "Ajouter" })).toBeVisible();
    await page.keyboard.press("Escape");
  } else {
    // Toute la largeur de la liste, compact (il prenait tout l'écran, retours du 12 novembre),
    // texte blanc entier, jamais tronqué.
    const [list, z] = [await page.locator(".lc-scroll").boundingBox(), await zone.boundingBox()];
    expect(Math.abs(z!.x + z!.width / 2 - (list!.x + list!.width / 2))).toBeLessThan(12);
    expect(z!.height).toBeGreaterThanOrEqual(120);
    expect(z!.height).toBeLessThanOrEqual(220);
    const color = await zone.locator(".dz-t").evaluate((n) => getComputedStyle(n).color);
    expect(color).toBe(await page.locator("#compose-title").evaluate((n) => getComputedStyle(n).color));
    for (const el of await zone.locator(".dz-t, .dz-s").all()) expect(await el.evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(true);
    await expect(zone).toContainText("Déposez des fichiers n'importe où sur la page");
  }
  await page.screenshot({ path: SHOTS + `composeur-vide-${isMobile ? 390 : 1440}.png` });
  // Directement (rechargement, lien), y compris pour le serveur (route connue : 200).
  const r = await page.request.get(shh.origin + "/envoyer");
  expect(r.status()).toBe(200);
  await page.reload();
  await expect(page.locator(".dropzone.empty")).toBeVisible();
});
