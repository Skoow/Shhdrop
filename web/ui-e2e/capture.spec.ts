// Caméra et micro dans l'interface (Q-REC1 acceptée) : photo par <canvas>, vidéo et vocal par
// MediaRecorder, avec la fausse caméra de Chromium. Chaque prise arrive dans le composeur ; les
// pistes sont toutes arrêtées à la sortie. Refus et API absente : message clair, repli sur
// l'appareil photo du système (<input capture>). En-têtes : camera=(self) sur la page seulement.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const local = process.env.PW_LOCAL_CHROMIUM === "1" ? { executablePath: "/opt/pw-browsers/chromium" } : {};
test.use({
  locale: "fr-FR",
  launchOptions: { ...local, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  permissions: ["camera", "microphone"],
});
test.skip(({ browserName }) => browserName !== "chromium", "fausse caméra : Chromium seulement");

/** Garde chaque flux ouvert par la page, pour vérifier que toutes ses pistes sont arrêtées. */
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
  page.evaluate(() =>
    (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState !== "ended").length,
  );
const opened = (page: Page) => page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.length);

/** Téléphone : feuille « Ajouter » ; ordinateur : tuile de l'accueil. */
async function pick(page: Page, row: string, tile: string) {
  const add = page.getByRole("button", { name: /^Ajouter/ }).filter({ visible: true }).first();
  if (await add.isVisible().catch(() => false)) {
    await add.click();
    await page.getByRole("dialog", { name: "Ajouter" }).getByRole("button", { name: new RegExp(`^${row}`) }).click();
  } else await page.getByRole("group", { name: "Ou créez sur place" }).getByRole("button", { name: tile, exact: true }).click();
}

test("photo prise ici → ajoutée au composeur (Photos, sans métadonnées), caméra éteinte", async ({ page, shh }) => {
  await spyStreams(page);
  await page.goto(shh.origin + "/");
  await pick(page, "Prendre une photo", "Photo");
  const cam = page.getByRole("dialog", { name: "Prendre une photo" });
  await expect(cam).toBeVisible();
  await expect(cam.getByText("ne contient ni position ni données EXIF", { exact: false })).toBeVisible();
  const shoot = cam.getByRole("button", { name: "Prendre la photo" });
  await expect(shoot).toBeEnabled({ timeout: 15_000 });
  await shoot.click();
  await expect(cam.getByRole("img", { name: "Aperçu de la photo" })).toBeVisible();
  expect(await liveTracks(page)).toBe(0); // caméra coupée pendant la relecture
  await cam.getByRole("button", { name: "Utiliser la photo" }).click();
  await expect(cam).toBeHidden();
  const row = page.locator("[data-row]").filter({ hasText: "Photo 1" });
  await expect(row).toBeVisible();
  await expect(row).toContainText(".jpg");
  await expect(row.getByText("Non nettoyé")).toHaveCount(0);
  expect(await liveTracks(page)).toBe(0);
});

test("vidéo courte enregistrée → ajoutée (Vidéos) ; minuteur visible ; pistes arrêtées", async ({ page, shh }) => {
  test.setTimeout(60_000);
  await spyStreams(page);
  await page.goto(shh.origin + "/");
  await pick(page, "Filmer une vidéo", "Vidéo");
  const cam = page.getByRole("dialog", { name: "Filmer une vidéo" });
  const start = cam.getByRole("button", { name: "Démarrer l'enregistrement" });
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await start.click();
  await expect(cam.locator(".timer.rec")).toBeVisible();
  await expect(cam.locator(".timer")).toContainText("00:01", { timeout: 5_000 });
  await cam.getByRole("button", { name: "Arrêter l'enregistrement" }).click();
  await expect(cam.locator("video.still")).toBeVisible();
  expect(await liveTracks(page)).toBe(0);
  await cam.getByRole("button", { name: "Utiliser la vidéo" }).click();
  const row = page.locator("[data-row]").filter({ hasText: "Vidéo 1" });
  await expect(row).toBeVisible();
  expect(await liveTracks(page)).toBe(0);
});

test("vocal enregistré → ajouté (Audio et vocaux) ; micro seul, jamais la caméra", async ({ page, shh }) => {
  test.setTimeout(60_000);
  test.skip(test.info().project.name.endsWith("-desktop") === false && false);
  await spyStreams(page);
  await page.goto(shh.origin + "/");
  await pick(page, "Enregistrer un vocal", "Vocal");
  const rec = page.getByRole("dialog", { name: "Enregistrer un vocal" });
  const start = rec.getByRole("button", { name: "Démarrer l'enregistrement" });
  await expect(start).toBeEnabled({ timeout: 15_000 });
  expect(await page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.every((s) => s.getVideoTracks().length === 0))).toBe(true);
  await start.click();
  await page.waitForTimeout(1200);
  await rec.getByRole("button", { name: "Arrêter l'enregistrement" }).click();
  await rec.getByRole("button", { name: "Utiliser le vocal" }).click();
  await expect(page.locator("[data-row]").filter({ hasText: "Vocal 1" })).toBeVisible();
  expect(await liveTracks(page)).toBe(0);
});

test("fermer sans prendre : rien n'est ajouté, toutes les pistes s'arrêtent", async ({ page, shh }) => {
  await spyStreams(page);
  await page.goto(shh.origin + "/");
  await pick(page, "Prendre une photo", "Photo");
  const cam = page.getByRole("dialog", { name: "Prendre une photo" });
  await expect(cam.getByRole("button", { name: "Prendre la photo" })).toBeEnabled({ timeout: 15_000 });
  expect(await opened(page)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(cam).toBeHidden();
  expect(await liveTracks(page)).toBe(0);
  await expect(page.locator("[data-row]")).toHaveCount(0);
});

test("permission refusée : message clair, repli sur l'appareil photo du système", async ({ page, shh }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("non", "NotAllowedError"));
  });
  await page.goto(shh.origin + "/");
  await pick(page, "Prendre une photo", "Photo");
  const cam = page.getByRole("dialog", { name: "Prendre une photo" });
  await expect(cam.getByRole("alert")).toContainText("L'accès à la caméra a été refusé.");
  const chooser = page.waitForEvent("filechooser");
  await cam.getByRole("button", { name: /^(Utiliser l'appareil photo du téléphone|Choisir une photo)$/ }).click();
  const fc = await chooser;
  expect(await fc.element().getAttribute("capture")).toBe("environment");
  expect(await fc.element().getAttribute("accept")).toBe("image/*");
});

test("API absente : la photo passe directement par l'appareil photo du système ; pas de vocal", async ({ page, shh }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  });
  await page.goto(shh.origin + "/");
  const add = page.getByRole("button", { name: /^Ajouter/ }).filter({ visible: true }).first();
  test.skip(!(await add.isVisible()), "feuille d'ajout : téléphone");
  await add.click();
  const sheet = page.getByRole("dialog", { name: "Ajouter" });
  await expect(sheet.getByRole("button", { name: /^Enregistrer un vocal/ })).toHaveCount(0);
  const photo = sheet.getByRole("button", { name: /^Prendre une photo/ });
  await expect(photo).toContainText("Avec l'appareil photo du téléphone");
  const chooser = page.waitForEvent("filechooser");
  await photo.click();
  expect(await (await chooser).element().getAttribute("capture")).toBe("environment");
  await expect(page.locator("dialog[data-capture]")).not.toBeVisible();
});

test("en-têtes : caméra et micro permis à la page, jamais au cadre PDF", async ({ page, shh }) => {
  const r = await page.request.get(shh.origin + "/");
  expect(r.headers()["permissions-policy"]).toBe("microphone=(self), camera=(self), geolocation=()");
  const f = await page.request.get(shh.origin + "/pdf-frame.html");
  expect(f.headers()["permissions-policy"]).toBe("microphone=(), camera=(), geolocation=()");
});
