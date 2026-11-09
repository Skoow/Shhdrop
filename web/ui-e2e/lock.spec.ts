// Cadenas d'état par élément (D41-25) : jamais vert avant l'événement réel. Envoi : gris tant
// que le serveur n'a pas confirmé le segment, vert « Chiffré et envoyé » après. Réception : vert
// « Déchiffré et vérifié » pour un texte (manifeste authentifié) et pour un fichier seulement
// une fois lu en entier ; rien avant. Captures fr-FR 390 et 1440.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures";
import { file, freshPage, noteRow, sendShare, settle, unlock } from "./open-helpers";
import { openFilePicker } from "./send-helpers";

test.use({ locale: "fr-FR" });

const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-LOCK/", import.meta.url));
const SHOTS5 = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-UI5/", import.meta.url));

test("envoi : cadenas gris tant que le segment n'est pas confirmé, vert après ; 2ᵉ ligne de la bulle : nettoyage (D41-34)", async ({ page, shh, isMobile }) => {
  test.setTimeout(90_000);
  if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let seen = 0;
  await page.route(/\/api\/shares\/segments\//, async (route) => {
    if (route.request().method() === "PUT" && seen++ === 0) await held;
    await route.continue();
  });
  await page.goto(shh.origin + "/");
  await (await openFilePicker(page)).setFiles({ name: "notes.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(3000, 7) });
  const r = page.locator("[data-row]").filter({ hasText: "notes" });
  // Segment parti, réponse retenue : l'élément n'est pas confirmé, le cadenas n'est pas vert.
  await expect.poll(() => seen).toBe(1);
  await expect(r.locator("[data-lock]")).toHaveAttribute("data-lock", "wait");
  await page.waitForTimeout(300); // la retenue dure : toujours pas vert
  await expect(r.locator('[data-lock="ok"]')).toHaveCount(0);
  release();
  // Retours UI4 : plus de texte sur la ligne ; le libellé est le nom du bouton et sa bulle.
  // D41-34 : 2ᵉ ligne, le nettoyage (format inconnu : tel quel), dans le nom et dans la bulle.
  await expect(r.locator('[data-lock="ok"] button')).toHaveAccessibleName("Chiffré et envoyé. Fichier tel quel (non modifié)", { timeout: 30_000 });
  await expect(r.locator('[data-lock="ok"]')).toHaveText("", { useInnerText: true });
  await expect(r.locator('[data-lock="ok"] button')).toHaveAccessibleDescription(/^Chiffré et envoyé ?\. Fichier tel quel \(non modifié\)$/);
  // Capture : cadenas et marques de nettoyage.
  await (await openFilePicker(page)).setFiles([
    { name: "plage-nuit.jpg", mimeType: "image/jpeg", buffer: readFileSync(file("plage-nuit.jpg")) },
    { name: "contrat.pdf", mimeType: "application/pdf", buffer: readFileSync(file("contrat.pdf")) },
    { name: "archive.zip", mimeType: "application/zip", buffer: readFileSync(file("archive.zip")) },
  ]);
  await expect(page.locator('[data-lock="ok"]')).toHaveCount(4, { timeout: 30_000 });
  // UI5 : une pastille cadenas sur l'icône de format de CHAQUE ligne.
  await expect(page.locator("[data-row] .pic [data-lock]")).toHaveCount(await page.locator("[data-row]").count());
  await settle(page);
  await page.screenshot({ path: `${SHOTS}compose-locks-${isMobile ? 390 : 1440}.png` });
  await page.screenshot({ path: `${SHOTS5}composeur-cadenas-${isMobile ? 390 : 1440}.png` });
});

test("réception : ouvert vert pour le texte (manifeste vérifié) ; fichier fermé gris avant lecture, ouvert vert seulement une fois lu en entier", async ({ page, shh, browser, isMobile }) => {
  test.setTimeout(120_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: "Code de la porte : 4512B", files: [file("foret-brume.jpg"), file("contrat.pdf")] });
  await s.ctx.close();
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async () => undefined, close: async () => undefined, abort: async () => undefined }) });
  });
  if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(sent.link);
  await unlock(page, sent.password);
  const note = noteRow(page); // la ligne ne montre que le titre (D41-37)
  const noteLock = note.locator('[data-lock="open"] button');
  await expect(noteLock).toHaveAccessibleName("Déchiffré et vérifié");
  // Bulle : au survol (souris) ou à l'appui (tactile, bascule) ; Échap la ferme.
  const tip = page.getByRole("tooltip", { name: "Déchiffré et vérifié" });
  await expect(tip).toBeHidden();
  if (isMobile) await noteLock.tap();
  else await noteLock.hover();
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  if (isMobile) {
    await noteLock.tap();
    await expect(tip).toBeVisible();
    await page.locator("h1").first().tap(); // appui ailleurs : fermée
    await expect(tip).toBeHidden();
  }
  const photo = page.locator("li.row").filter({ hasText: "foret-brume" });
  await expect(photo.locator('.pic [data-lock="wait"] button')).toHaveAccessibleName(/^Chiffré, pas encore ouvert(\. Nettoyé avant l'envoi|$)/);
  await expect(page.locator("li.row .pic [data-lock]")).toHaveCount(3); // chaque ligne a sa pastille
  for (const n of ["foret-brume.jpg", "contrat.pdf"]) {
    await page.getByRole("button", { name: `Télécharger ${n}` }).click();
    await expect(page.locator("li.row").filter({ hasText: n.split(".")[0]! })).toHaveAttribute("data-state", "done", { timeout: 30_000 });
  }
  await expect(photo.locator('[data-lock="open"] button')).toHaveAccessibleName(/^Déchiffré et vérifié(\. Nettoyé avant l'envoi|$)/);
  await expect(page.locator('li.row [data-lock="open"]')).toHaveCount(3);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}content-locks-${isMobile ? 390 : 1440}.png` });
  await page.screenshot({ path: `${SHOTS5}destinataire-cadenas-${isMobile ? 390 : 1440}.png` });
});
