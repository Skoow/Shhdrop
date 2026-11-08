// Caméra et micro dans l'interface (Q-REC1 acceptée), comme une app photo : un seul « Photo ou
// vidéo », bascule Photo / Vidéo, déclencheur, avant / arrière, vignette « Galerie ». Photo par
// <canvas>, vidéo et vocal par MediaRecorder (fausse caméra de Chromium), minuteur « 0:01 / 5:00
// maximum », nom du navigateur et dates effacés. Chaque prise arrive dans le composeur ; les
// pistes sont toutes arrêtées à la sortie. Refus et API absente : message clair, repli sur le
// sélecteur du système. En-têtes : camera=(self) sur la page seulement.
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
async function pick(page: Page, name: "Photo ou vidéo" | "Vocal") {
  const add = page.getByRole("button", { name: /^Ajouter/ }).filter({ visible: true }).first();
  if (await add.isVisible().catch(() => false)) {
    await add.click();
    await page.getByRole("dialog", { name: "Ajouter" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  } else await page.getByRole("group", { name: "Ou créez sur place" }).getByRole("button", { name, exact: true }).click();
}
const camera = (page: Page) => page.locator("dialog[data-capture]");

test("photo prise ici → ajoutée au composeur (Photos, sans métadonnées), caméra éteinte", async ({ page, shh }) => {
  await spyStreams(page);
  await page.goto(shh.origin + "/");
  await pick(page, "Photo ou vidéo");
  const cam = page.getByRole("dialog", { name: "Prendre une photo" });
  await expect(cam).toBeVisible();
  await expect(cam.getByText("Aucune position ni modèle d'appareil.")).toBeVisible();
  // Comme une app photo : Photo choisi, Vidéo à côté ; Galerie à gauche, avant / arrière à droite.
  await expect(cam.getByRole("group", { name: "Photo ou vidéo" }).getByRole("button", { name: "Photo", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(cam.getByRole("button", { name: "Galerie" })).toBeVisible();
  const shoot = cam.getByRole("button", { name: "Prendre la photo" });
  await expect(shoot).toBeEnabled({ timeout: 15_000 });
  await expect(cam.getByRole("button", { name: "Changer de caméra" })).toBeVisible();
  const [g, sh, fl] = await Promise.all(["Galerie", "Prendre la photo", "Changer de caméra"].map((n) => cam.getByRole("button", { name: n }).boundingBox()));
  expect(g!.x).toBeLessThan(sh!.x);
  expect(sh!.x).toBeLessThan(fl!.x);
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

test("vidéo : bascule Photo → Vidéo, minuteur « 0:01 / 5:00 maximum », sans nom du navigateur ni date ; pistes arrêtées", async ({ page, shh }) => {
  test.setTimeout(60_000);
  await spyStreams(page);
  // Garde les Blob passés à URL.createObjectURL (la CSP interdit de relire une URL blob: par fetch).
  await page.addInitScript(() => {
    const blobs: Blob[] = [];
    (window as unknown as { __blobs: Blob[] }).__blobs = blobs;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (o: Blob | MediaSource) => {
      if (o instanceof Blob) blobs.push(o);
      return orig(o);
    };
  });
  await page.goto(shh.origin + "/");
  await pick(page, "Photo ou vidéo");
  await camera(page).getByRole("button", { name: "Vidéo", exact: true }).click();
  const cam = page.getByRole("dialog", { name: "Filmer une vidéo" });
  await expect(cam.getByRole("button", { name: "Vidéo", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(cam.getByText("Aucune position ni modèle d'appareil.")).toBeVisible();
  const start = cam.getByRole("button", { name: "Démarrer l'enregistrement" });
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await start.click();
  await expect(cam.locator(".timer.rec")).toBeVisible();
  await expect(cam.locator(".timer")).toContainText("0:01 / 5:00\u202fmaximum", { timeout: 5_000 });
  await expect(cam.getByRole("button", { name: "Galerie" })).toHaveCount(0); // pas pendant l'enregistrement
  await cam.getByRole("button", { name: "Arrêter l'enregistrement" }).click();
  await expect(cam.locator("video.still")).toBeVisible();
  expect(await liveTracks(page)).toBe(0);
  // Le fichier relu : ni « Chrome » (WebM) ni date de création (MP4, mvhd).
  const meta = await page.evaluate(async () => {
    const all = (window as unknown as { __blobs: Blob[] }).__blobs;
    const b = new Uint8Array(await all[all.length - 1]!.slice(0, 4096).arrayBuffer());
    const txt = Array.from(b, (c) => String.fromCharCode(c)).join("");
    const i = txt.indexOf("mvhd");
    const date = i < 0 ? null : b[i + 4] === 1 ? Number(new DataView(b.buffer, b.byteOffset).getBigUint64(i + 8)) : new DataView(b.buffer, b.byteOffset).getUint32(i + 8);
    return { chrome: txt.includes("Chrome"), date };
  });
  expect(meta.chrome).toBe(false);
  if (meta.date !== null) expect(meta.date).toBe(0);
  await cam.getByRole("button", { name: "Utiliser la vidéo" }).click();
  const row = page.locator("[data-row]").filter({ hasText: "Vidéo 1" });
  await expect(row).toBeVisible();
  expect(await liveTracks(page)).toBe(0);
});

test("vignette « Galerie » : caméra éteinte, sélecteur photos et vidéos du système (plusieurs)", async ({ page, shh }) => {
  await spyStreams(page);
  await page.goto(shh.origin + "/");
  await pick(page, "Photo ou vidéo");
  const cam = camera(page);
  await expect(cam.getByRole("button", { name: "Prendre la photo" })).toBeEnabled({ timeout: 15_000 });
  const chooser = page.waitForEvent("filechooser");
  await cam.getByRole("button", { name: "Galerie" }).click();
  const fc = await chooser;
  expect(await fc.element().getAttribute("accept")).toBe("image/*,video/*");
  expect(fc.isMultiple()).toBe(true);
  expect(await fc.element().getAttribute("capture")).toBeNull();
  await expect(cam).toBeHidden();
  expect(await liveTracks(page)).toBe(0);
});

test("vocal enregistré → ajouté (Audio et vocaux) ; micro seul, jamais la caméra", async ({ page, shh }) => {
  test.setTimeout(60_000);
  await spyStreams(page);
  await page.goto(shh.origin + "/");
  await pick(page, "Vocal");
  const rec = page.getByRole("dialog", { name: "Enregistrer un vocal" });
  const start = rec.getByRole("button", { name: "Démarrer l'enregistrement" });
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await expect(rec.getByRole("button", { name: "Galerie" })).toHaveCount(0);
  await expect(rec.getByRole("group", { name: "Photo ou vidéo" })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.every((s) => s.getVideoTracks().length === 0))).toBe(true);
  await start.click();
  await expect(rec.locator(".timer")).toContainText("/ 30:00\u202fmaximum");
  await page.waitForTimeout(1200);
  await rec.getByRole("button", { name: "Arrêter l'enregistrement" }).click();
  await rec.getByRole("button", { name: "Utiliser le vocal" }).click();
  await expect(page.locator("[data-row]").filter({ hasText: "Vocal 1" })).toBeVisible();
  expect(await liveTracks(page)).toBe(0);
});

test("fermer sans prendre : rien n'est ajouté, toutes les pistes s'arrêtent", async ({ page, shh }) => {
  await spyStreams(page);
  await page.goto(shh.origin + "/");
  await pick(page, "Photo ou vidéo");
  const cam = page.getByRole("dialog", { name: "Prendre une photo" });
  await expect(cam.getByRole("button", { name: "Prendre la photo" })).toBeEnabled({ timeout: 15_000 });
  expect(await opened(page)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(cam).toBeHidden();
  await expect.poll(() => liveTracks(page)).toBe(0); // arrêt à l'événement close (tâche suivante)
  await expect(page.locator("[data-row]")).toHaveCount(0);
});

test("permission refusée : message clair, repli sur l'appareil photo du système", async ({ page, shh }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("non", "NotAllowedError"));
  });
  await page.goto(shh.origin + "/");
  await pick(page, "Photo ou vidéo");
  const cam = page.getByRole("dialog", { name: "Prendre une photo" });
  await expect(cam.getByRole("alert")).toContainText("L'accès à la caméra a été refusé.");
  const chooser = page.waitForEvent("filechooser");
  await cam.getByRole("button", { name: /^(Utiliser l'appareil photo du téléphone|Choisir une photo)$/ }).click();
  const fc = await chooser;
  expect(await fc.element().getAttribute("capture")).toBe("environment");
  expect(await fc.element().getAttribute("accept")).toBe("image/*");
});

test("API absente : « Photo ou vidéo » ouvre directement la galerie ; pas de vocal", async ({ page, shh }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  });
  await page.goto(shh.origin + "/");
  const add = page.getByRole("button", { name: /^Ajouter/ }).filter({ visible: true }).first();
  test.skip(!(await add.isVisible()), "feuille d'ajout : téléphone");
  await add.click();
  const sheet = page.getByRole("dialog", { name: "Ajouter" });
  await expect(sheet.getByRole("button", { name: /^Vocal/ })).toHaveCount(0);
  const media = sheet.getByRole("button", { name: /^Photo ou vidéo/ });
  await expect(media).toContainText("Depuis votre galerie");
  const chooser = page.waitForEvent("filechooser");
  await media.click();
  expect(await (await chooser).element().getAttribute("accept")).toBe("image/*,video/*");
  await expect(page.locator("dialog[data-capture]")).not.toBeVisible();
});

test("en-têtes : caméra et micro permis à la page, jamais au cadre PDF", async ({ page, shh }) => {
  const r = await page.request.get(shh.origin + "/");
  expect(r.headers()["permissions-policy"]).toMatch(/^microphone=\(self\), camera=\(self\), geolocation=\(\), /);
  const f = await page.request.get(shh.origin + "/pdf-frame.html");
  expect(f.headers()["permissions-policy"]).toMatch(/^microphone=\(\), camera=\(\), geolocation=\(\), /);
});

// Audit F7 : un format que le nettoyage ne reconnaît pas ne part plus en silence. Le premier
// morceau de MediaRecorder est préfixé de 4 octets nuls : ni WebM ni MP4 pour strip-capture.
for (const keep of [true, false]) {
  test(`vocal au format inattendu : averti, ${keep ? "« Garder tel quel » l'ajoute" : "« Annuler » n'ajoute rien"}`, async ({ page, shh }) => {
    test.setTimeout(60_000);
    await spyStreams(page);
    await page.addInitScript(() => {
      const proto = window.MediaRecorder?.prototype;
      const d = proto && Object.getOwnPropertyDescriptor(proto, "ondataavailable");
      if (!d?.set || !d.get) return;
      const { set, get } = d;
      Object.defineProperty(proto, "ondataavailable", {
        configurable: true,
        get() {
          return get.call(this);
        },
        set(f: ((e: BlobEvent) => void) | null) {
          let first = true;
          set.call(
            this,
            f &&
              ((e: BlobEvent) => {
                const data = first ? new Blob([new Uint8Array(4), e.data], { type: e.data.type }) : e.data;
                first = false;
                f({ data } as BlobEvent);
              }),
          );
        },
      });
    });
    await page.goto(shh.origin + "/");
    await pick(page, "Vocal");
    const rec = page.getByRole("dialog", { name: "Enregistrer un vocal" });
    const start = rec.getByRole("button", { name: "Démarrer l'enregistrement" });
    await expect(start).toBeEnabled({ timeout: 15_000 });
    await start.click();
    await page.waitForTimeout(1200);
    await rec.getByRole("button", { name: "Arrêter l'enregistrement" }).click();
    await expect(rec.getByRole("alert")).toHaveText(/n'a pas pu être nettoyé/);
    await expect(rec.getByRole("button", { name: "Utiliser le vocal" })).toHaveCount(0);
    await rec.getByRole("button", { name: keep ? "Garder tel quel" : "Annuler" }).click();
    await expect(rec).toBeHidden();
    await expect(page.locator("[data-row]").filter({ hasText: "Vocal 1" })).toHaveCount(keep ? 1 : 0);
    expect(await liveTracks(page)).toBe(0);
  });
}
