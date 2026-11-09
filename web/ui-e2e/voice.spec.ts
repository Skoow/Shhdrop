// Enregistreur vocal (Task 12, spec §35.3) avec le faux micro de Chromium : onde vivante,
// minuteur « 0:02 / 30:00 maximum », pause qui fige le minuteur, reprise, arrêt, réécoute sur la
// forme d'onde (lecture, déplacement), ajout au partage, ligne du composeur avec mini-onde et
// durée. Micro éteint après l'arrêt et l'annulation ; refus du micro : message clair ; mouvement
// réduit : pastille et onde immobiles.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const local = process.env.PW_LOCAL_CHROMIUM === "1" ? { executablePath: "/opt/pw-browsers/chromium" } : {};
test.use({
  locale: "fr-FR",
  launchOptions: { ...local, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  permissions: ["microphone"],
  deviceScaleFactor: 2, // captures ×2
});
test.skip(({ browserName }) => browserName !== "chromium", "faux micro : Chromium seulement");

const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-VOICE/", import.meta.url));

async function spyStreams(page: Page) {
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) return;
    const orig = md.getUserMedia.bind(md);
    (window as unknown as { __streams: MediaStream[] }).__streams = [];
    md.getUserMedia = async (c) => {
      const s = await orig(c);
      (window as unknown as { __streams: MediaStream[] }).__streams.push(s);
      return s;
    };
  });
}
const liveTracks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState !== "ended").length);

async function openVoice(page: Page) {
  const add = page.getByRole("button", { name: /^Ajouter/ }).filter({ visible: true }).first();
  if (await add.isVisible().catch(() => false)) {
    await add.click();
    await page.getByRole("dialog", { name: "Ajouter" }).getByRole("button", { name: /^Vocal/ }).click();
  } else await page.getByRole("group", { name: "Ou créez sur place" }).getByRole("button", { name: "Vocal", exact: true }).click();
  const rec = page.getByRole("dialog", { name: "Enregistrer un vocal" });
  await expect(rec.getByRole("button", { name: "Démarrer l'enregistrement" })).toBeEnabled({ timeout: 15_000 });
  return rec;
}
const timer = (rec: ReturnType<Page["getByRole"]>) => rec.locator("[data-timer] .now");

test("enregistrer 2 s → pause (minuteur figé) → reprendre → arrêter → réécouter → ajouter → ligne avec onde", async ({ page, shh, isMobile }) => {
  test.setTimeout(90_000);
  if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
  mkdirSync(SHOTS, { recursive: true });
  await spyStreams(page);
  await page.goto(shh.origin + "/");
  const rec = await openVoice(page);
  await rec.getByRole("button", { name: "Démarrer l'enregistrement" }).click();
  await expect(rec.locator("[data-timer]")).toContainText("/ 30:00 maximum");
  await expect(rec.getByRole("status").filter({ hasText: "Enregistrement en cours" })).toBeVisible();
  // Onde vivante : les barres bougent avec le son du faux micro.
  const wave = rec.locator('[data-wave="live"] .b');
  await expect(wave).toHaveCount(40);
  const shape = () => wave.evaluateAll((bs) => bs.map((b) => getComputedStyle(b).transform).join("|"));
  const s1 = await shape();
  await expect.poll(shape, { timeout: 3000 }).not.toBe(s1);
  await expect(timer(rec)).toHaveText("0:02", { timeout: 4000 });
  if (isMobile) await rec.screenshot({ path: `${SHOTS}voice-recording-390.png` });

  await rec.getByRole("button", { name: "Mettre en pause" }).click();
  await expect(rec.getByRole("status").filter({ hasText: "En pause" })).toBeVisible();
  const frozen = await timer(rec).textContent();
  await page.waitForTimeout(1300);
  await expect(timer(rec)).toHaveText(frozen!);
  if (isMobile) await rec.screenshot({ path: `${SHOTS}voice-paused-390.png` });

  await rec.getByRole("button", { name: "Reprendre l'enregistrement" }).click();
  await page.waitForTimeout(1100);
  await expect(timer(rec)).not.toHaveText(frozen!);
  await rec.getByRole("button", { name: "Arrêter l'enregistrement" }).click();

  // Réécoute : forme d'onde de l'enregistrement, lecture, toucher pour se déplacer.
  const seek = rec.getByRole("slider", { name: "Position dans l'enregistrement" });
  await expect(seek).toBeVisible({ timeout: 10_000 });
  await expect(seek.locator(".b")).toHaveCount(60);
  expect(await liveTracks(page)).toBe(0); // micro éteint dès l'arrêt
  const box = (await seek.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await expect.poll(async () => Number(await seek.getAttribute("aria-valuenow"))).toBeGreaterThan(30);
  await expect(seek.locator(".b.on").first()).toBeVisible();
  const play = rec.getByRole("button", { name: "Écouter l'enregistrement" });
  await play.click();
  await expect(rec.getByRole("button", { name: "Mettre l'enregistrement en pause" })).toBeVisible();
  if (isMobile) await rec.screenshot({ path: `${SHOTS}voice-review-390.png` });
  await expect(rec.getByRole("button", { name: "Réenregistrer" })).toBeVisible();
  await rec.getByRole("button", { name: "Ajouter au partage" }).click();
  await expect(rec).toBeHidden();

  const row = page.locator("[data-row]").filter({ hasText: "Mémo vocal 1" });
  await expect(row).toBeVisible();
  await expect(row.locator('[data-wave="mini"] .b')).toHaveCount(28);
  await expect(row.locator("[data-voice-clip] .time")).toHaveText(/^0:0[3-5]$/);
  await expect(row.locator('[data-clean="nettoye"]')).toBeVisible();
  if (isMobile) {
    await page.waitForTimeout(800); // fin des animations d'arrivée de la ligne
    await row.screenshot({ path: `${SHOTS}voice-row-390.png` });
    await page.screenshot({ path: `${SHOTS}voice-compose-390.png` });
  }
  await row.getByRole("button", { name: /^Écouter Mémo vocal 1/ }).click();
  await expect(row.getByRole("button", { name: /^Mettre Mémo vocal 1.* en pause$/ })).toBeVisible();
  await row.getByRole("button", { name: /^Mettre Mémo vocal 1.* en pause$/ }).click();
  expect(await liveTracks(page)).toBe(0);
});

test("annuler : immédiat sous 5 s, confirmation au-delà ; micro de l'enregistrement éteint", async ({ page, shh }) => {
  test.setTimeout(60_000);
  await spyStreams(page);
  await page.goto(shh.origin + "/");
  const rec = await openVoice(page);
  await rec.getByRole("button", { name: "Démarrer l'enregistrement" }).click();
  await expect(timer(rec)).toHaveText("0:01", { timeout: 4000 });
  await rec.getByRole("button", { name: "Annuler l'enregistrement" }).click();
  // De nouveau prêt, sans question ; le flux de l'enregistrement annulé est arrêté.
  await expect(rec.getByRole("button", { name: "Démarrer l'enregistrement" })).toBeEnabled({ timeout: 10_000 });
  await expect.poll(() => liveTracks(page)).toBe(1); // seul le micro du nouvel état « prêt »
  await rec.getByRole("button", { name: "Démarrer l'enregistrement" }).click();
  await expect(timer(rec)).toHaveText("0:06", { timeout: 9000 });
  await rec.getByRole("button", { name: "Annuler l'enregistrement" }).click();
  const ask = rec.getByRole("alertdialog");
  await expect(ask).toContainText("Supprimer cet enregistrement de 0:0");
  await expect(rec.getByRole("status").filter({ hasText: "En pause" })).toBeVisible();
  await ask.getByRole("button", { name: "Continuer" }).click();
  await expect(rec.getByRole("status").filter({ hasText: "Enregistrement en cours" })).toBeVisible();
  await rec.getByRole("button", { name: "Annuler l'enregistrement" }).click();
  await rec.getByRole("alertdialog").getByRole("button", { name: "Supprimer" }).click();
  await expect(rec.getByRole("button", { name: "Démarrer l'enregistrement" })).toBeEnabled({ timeout: 10_000 });
  await page.keyboard.press("Escape");
  await expect(rec).toBeHidden();
  await expect.poll(() => liveTracks(page)).toBe(0);
  await expect(page.locator("[data-row]")).toHaveCount(0);
});

test("micro refusé : message clair et marche à suivre", async ({ page, shh }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("non", "NotAllowedError"));
  });
  await page.goto(shh.origin + "/");
  const add = page.getByRole("button", { name: /^Ajouter/ }).filter({ visible: true }).first();
  if (await add.isVisible().catch(() => false)) {
    await add.click();
    await page.getByRole("dialog", { name: "Ajouter" }).getByRole("button", { name: /^Vocal/ }).click();
  } else await page.getByRole("group", { name: "Ou créez sur place" }).getByRole("button", { name: "Vocal", exact: true }).click();
  const alert = page.getByRole("dialog", { name: "Enregistrer un vocal" }).getByRole("alert");
  await expect(alert).toContainText("L'accès au micro a été refusé.");
  await expect(alert).toContainText("autorisez le micro dans les réglages du site");
  await expect(alert.getByRole("button", { name: "Réessayer" })).toBeVisible();
});

test.describe("mouvement réduit", () => {
  test.use({ reducedMotion: "reduce" });
  test("pastille immobile, onde statique, minuteur en chiffres tabulaires", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    const rec = await openVoice(page);
    await rec.getByRole("button", { name: "Démarrer l'enregistrement" }).click();
    await expect(timer(rec)).toHaveText("0:01", { timeout: 4000 });
    expect(await rec.locator(".state .dot").evaluate((d) => getComputedStyle(d).animationName)).toBe("none");
    expect(await rec.locator("[data-timer]").evaluate((d) => getComputedStyle(d).fontVariantNumeric)).toContain("tabular-nums");
    const wave = rec.locator('[data-wave="live"] .b');
    const shape = () => wave.evaluateAll((bs) => bs.map((b) => getComputedStyle(b).transform).join("|"));
    const s1 = await shape();
    await page.waitForTimeout(800);
    expect(await shape()).toBe(s1);
    await rec.getByRole("button", { name: "Arrêter l'enregistrement" }).click();
    await expect(rec.getByRole("button", { name: "Ajouter au partage" })).toBeVisible({ timeout: 10_000 });
  });
});
