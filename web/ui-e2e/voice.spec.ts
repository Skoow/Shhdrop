// Enregistreur vocal (Task 12, spec §35.3) avec le faux micro de Chromium : onde vivante,
// minuteur « 0:02 / 30:00 max » sur une ligne, pause qui fige le minuteur, reprise, arrêt, réécoute
// facultative sur la forme d'onde (lecture, déplacement, vitesse), « Valider », ligne du composeur
// avec mini-onde, durée et vitesse. Micro éteint après l'arrêt et l'annulation ; refus du micro : message clair ; mouvement
// réduit : pastille et onde immobiles.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openFilePicker, enterComposer } from "./send-helpers";

const local = process.env.PW_LOCAL_CHROMIUM === "1" ? { executablePath: "/opt/pw-browsers/chromium" } : {};
test.use({
  locale: "fr-FR",
  launchOptions: { ...local, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  permissions: ["microphone"],
  deviceScaleFactor: 2, // captures ×2
});
test.skip(({ browserName }) => browserName !== "chromium", "faux micro : Chromium seulement");

const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-VOICE5/", import.meta.url));

async function spyStreams(page: Page) {
  await page.addInitScript(() => {
    // Lecteurs créés par new Audio() (hors DOM) : gardés pour lire leur vitesse.
    const w = window as unknown as { __audios: HTMLAudioElement[]; Audio: typeof Audio };
    w.__audios = [];
    const A = w.Audio;
    w.Audio = function (src?: string) {
      const a = new A(src);
      w.__audios.push(a);
      return a;
    } as unknown as typeof Audio;
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
  // Téléphone : « Commencer » mène d'abord à la page d'envoi (D41-37).
  if (!(await page.getByRole("group", { name: "Ou créez sur place" }).isVisible().catch(() => false))) await enterComposer(page);
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
  // Le micro est le bouton : il devient l'arrêt au même endroit ; minuteur et onde ne bougent pas.
  const big = rec.getByRole("button", { name: "Démarrer l'enregistrement" });
  await expect(rec.getByRole("status")).toHaveText(isMobile ? "Touchez pour enregistrer" : "Cliquez pour enregistrer");
  const where = async (b: ReturnType<Page["locator"]>) => ({ mic: (await b.boundingBox())!, bubble: (await rec.locator(".bubble").boundingBox())!, timer: (await rec.locator("[data-timer]").boundingBox())! });
  const before = await where(big);
  expect(before.mic.width).toBeGreaterThanOrEqual(72);
  if (isMobile) await rec.screenshot({ path: `${SHOTS}voice-initial-390.png` });
  await big.click();
  await expect(rec.locator("[data-timer]")).toContainText("/ 30:00 max");
  await page.waitForTimeout(250); // fin du fondu micro → carré
  const after = await where(rec.getByRole("button", { name: "Arrêter l'enregistrement" }));
  for (const k of ["mic", "bubble", "timer"] as const) {
    expect(after[k].x, k).toBeCloseTo(before[k].x, 0);
    expect(after[k].y, k).toBeCloseTo(before[k].y, 0);
  }
  // Pause à gauche du micro, Annuler à droite ; cibles ≥ 44 px.
  const pz = (await rec.getByRole("button", { name: "Mettre en pause" }).boundingBox())!;
  const cx = (await rec.getByRole("button", { name: "Annuler l'enregistrement" }).boundingBox())!;
  expect(pz.x + pz.width).toBeLessThan(after.mic.x);
  expect(cx.x).toBeGreaterThan(after.mic.x + after.mic.width);
  for (const b of [pz, cx]) expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
  // Une seule ligne, même à 360 px.
  await page.setViewportSize({ width: 360, height: 740 });
  const one = await rec.locator("[data-timer]").evaluate((el) => {
    const [a, b] = [...el.children].map((c) => c.getBoundingClientRect());
    return a!.bottom > b!.top && b!.left >= a!.right && el.scrollWidth <= el.clientWidth;
  });
  expect(one).toBe(true);
  if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
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
  // Vitesse : 1× → 1,5× (hauteur conservée) → 2× → 1×.
  await rec.getByRole("button", { name: /^Vitesse de lecture\s*: 1×$/ }).click();
  await expect(rec.getByRole("button", { name: /^Vitesse de lecture\s*: 1,5×$/ })).toHaveText("1,5×");
  const media = await page.evaluate(() => {
    const a = (window as unknown as { __audios: HTMLAudioElement[] }).__audios.at(-1)!;
    return { rate: a.playbackRate, pitch: a.preservesPitch };
  });
  expect(media).toEqual({ rate: 1.5, pitch: true });
  if (isMobile) await rec.screenshot({ path: `${SHOTS}voice-review-390.png` });
  await expect(rec.getByRole("button", { name: "Réenregistrer" })).toBeVisible();
  await rec.getByRole("button", { name: "Valider" }).click();
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
  await row.getByRole("button", { name: /^Vitesse de lecture\s*: 1×$/ }).click();
  await expect(row.getByRole("button", { name: /^Vitesse de lecture\s*: 1,5×$/ })).toBeVisible();
  await row.getByRole("button", { name: /^Écouter Mémo vocal 1/ }).click();
  await expect(row.getByRole("button", { name: /^Mettre Mémo vocal 1.* en pause$/ })).toBeVisible();
  await row.getByRole("button", { name: /^Mettre Mémo vocal 1.* en pause$/ }).click();
  expect(await liveTracks(page)).toBe(0);
});

test("arrêter → « Valider » sans réécouter → ligne ajoutée", async ({ page, shh, isMobile }) => {
  test.setTimeout(60_000);
  if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
  mkdirSync(SHOTS, { recursive: true });
  await page.goto(shh.origin + "/");
  const rec = await openVoice(page);
  await rec.getByRole("button", { name: "Démarrer l'enregistrement" }).click();
  await expect(timer(rec)).toHaveText("0:02", { timeout: 4000 });
  await rec.getByRole("button", { name: "Arrêter l'enregistrement" }).click();
  const ok = rec.getByRole("button", { name: "Valider" });
  await expect(ok).toBeVisible({ timeout: 10_000 });
  const again = rec.getByRole("button", { name: "Réenregistrer" });
  await expect(again).toBeVisible();
  await expect(rec.getByRole("button", { name: "Écouter l'enregistrement" })).toBeVisible();
  // « Valider » principal sur la largeur restante ; « Réenregistrer » en petite icône micro.
  const [ob, ab] = [(await ok.boundingBox())!, (await again.boundingBox())!];
  expect(ob.width).toBeGreaterThan(ab.width * 3);
  expect(Math.min(ab.width, ab.height)).toBeGreaterThanOrEqual(44);
  if (isMobile) await rec.screenshot({ path: `${SHOTS}voice-stopped-390.png` });
  await ok.click();
  await expect(rec).toBeHidden();
  await expect(page.locator("[data-row]").filter({ hasText: "Mémo vocal 1" })).toBeVisible();
});

test("ligne vocale : nom générique renommable (Entrée, Échap, vide → générique) ; bulle centrée sous le nom ; alignée sur les autres lignes", async ({ page, shh, isMobile }) => {
  test.setTimeout(60_000);
  const SHOTS4 = SHOTS.replace("task-VOICE5", "task-VOICE4");
  mkdirSync(SHOTS4, { recursive: true });
  if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(shh.origin + "/");
  const rec = await openVoice(page);
  await rec.getByRole("button", { name: "Démarrer l'enregistrement" }).click();
  await expect(timer(rec)).toHaveText("0:01", { timeout: 4000 });
  await rec.getByRole("button", { name: "Arrêter l'enregistrement" }).click();
  await rec.getByRole("button", { name: "Valider" }).click();
  await expect(rec).toBeHidden();
  await (await openFilePicker(page)).setFiles(fileURLToPath(new URL("./files/contrat.pdf", import.meta.url)));
  const voice = page.locator("[data-row]").filter({ has: page.locator("[data-voice-clip]") });
  const pdf = page.locator("[data-row]").filter({ hasText: "contrat.pdf" });
  await expect(pdf).toBeVisible();
  // Extension interne : jamais affichée.
  await expect(voice.locator(".nm")).toHaveText("Mémo vocal 1");
  await expect(voice).not.toContainText(/\.(webm|m4a)/);
  await page.waitForTimeout(800); // fin des animations d'arrivée

  const box = async (l: ReturnType<Page["locator"]>) => (await l.boundingBox())!;
  const act = isMobile ? "[data-menu]" : "[data-remove]";
  for (const w of isMobile ? [360, 390] : [0]) {
    if (w) await page.setViewportSize({ width: w, height: 844 });
    await page.waitForTimeout(150);
    const [vr, pr] = [await box(voice.locator(".row")), await box(pdf.locator(".row"))];
    expect(vr.x).toBeCloseTo(pr.x, 0);
    expect(vr.width).toBeCloseTo(pr.width, 0);
    for (const sel of [".pic", ".main", act]) {
      const [a, b] = [await box(voice.locator(sel).first()), await box(pdf.locator(sel).first())];
      expect(a.x, `${sel} à ${w}`).toBeCloseTo(b.x, 0);
    }
    // Icône, nom et « … » sur la même rangée ; la bulle dessous, centrée dans la ligne.
    const [pic, meta, menu, clip] = [await box(voice.locator(".pic")), await box(voice.locator(".meta")), await box(voice.locator(act)), await box(voice.locator("[data-voice-clip]"))];
    expect(Math.abs(pic.y + pic.height / 2 - (menu.y + menu.height / 2))).toBeLessThan(2);
    expect(clip.y).toBeGreaterThanOrEqual(meta.y + meta.height);
    expect(clip.y).toBeGreaterThanOrEqual(pic.y + pic.height);
    expect(Math.abs(clip.x + clip.width / 2 - (vr.x + vr.width / 2))).toBeLessThan(0.75);
  }
  if (isMobile) await voice.screenshot({ path: `${SHOTS4}voice-row-390.png` });

  // Le vocal se renomme comme les autres (retours UI6) : crayon de la ligne sur ordinateur,
  // menu « … » sur téléphone (plus de crayon propre au vocal).
  await expect(voice.locator(".head button:not([data-clean] *)")).toHaveCount(0); // le bouclier de nettoyage suit le nom (UI9)
  const rename = async (from: string, to: string, opts: { cancel?: boolean; shot?: boolean } = {}) => {
    if (isMobile) {
      await voice.getByRole("button", { name: `Actions pour ${from}` }).click();
      const menu = page.getByRole("dialog", { name: from });
      await expect(menu.locator(".mi")).toHaveText(["Aperçu", "Renommer", "Supprimer"]);
      await menu.getByRole("button", { name: "Renommer" }).click();
      const field = menu.getByRole("textbox", { name: `Nouveau nom de ${from}` });
      await expect(field).toBeFocused();
      await expect(field).toHaveValue(from);
      await field.fill(to);
      if (opts.shot) await page.screenshot({ path: `${SHOTS4}voice-row-rename-390.png` });
      if (opts.cancel) {
        await menu.getByRole("button", { name: "Annuler" }).click();
        await expect(menu.locator(".mi").first()).toBeVisible();
        await page.keyboard.press("Escape");
      } else await field.press("Enter");
      await expect(menu).toBeHidden();
      return;
    }
    const pencil = voice.getByRole("button", { name: `Renommer ${from}`, exact: true });
    await pencil.click();
    const field = voice.getByRole("textbox", { name: `Nouveau nom de ${from}` });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(from);
    await field.fill(to);
    await field.press(opts.cancel ? "Escape" : "Enter");
    if (opts.cancel) await expect(pencil).toBeFocused();
  };
  // Annuler, puis valider (même assainissement que les autres noms), puis nom vide → générique.
  await rename("Mémo vocal 1", "Brouillon", { cancel: true });
  await expect(voice.locator(".nm")).toHaveText("Mémo vocal 1");
  await rename("Mémo vocal 1", "Réunion\u200b du lundi", { shot: true });
  await expect(voice.locator(".nm")).toHaveText("Réunion du lundi");
  await expect(voice.getByRole("button", { name: /^Écouter Réunion du lundi$/ })).toBeVisible();
  await rename("Réunion du lundi", "   ");
  await expect(voice.locator(".nm")).toHaveText("Mémo vocal 1");
  await expect(voice.locator('[role="alert"]')).toHaveCount(0);
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
  // Téléphone : « Commencer » mène d'abord à la page d'envoi (D41-37).
  if (!(await page.getByRole("group", { name: "Ou créez sur place" }).isVisible().catch(() => false))) await enterComposer(page);
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
    await expect(rec.getByRole("button", { name: "Valider" })).toBeVisible({ timeout: 10_000 });
  });
});
