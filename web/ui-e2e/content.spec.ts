// Contenu et visionneuses (Task 21, UI §9.8, §12.4) sur le vrai serveur : groupes et ordre de
// l'envoi, texte brut, image depuis une URL blob révoquée au chargement, audio et vidéo natifs,
// fichiers piégés jamais affichés, échec de décodage, expiration, destruction pendant la lecture.
import { destroyShare } from "../src/index";
import { axe, capture, expect, test } from "./fixtures";
import { file, freshPage, goSecurity, sendShare, settle, unlock, type Sent } from "./open-helpers";

const TEXT = "Le code de la porte est 4471.\nالطابق الثالث — escalier B.";
const FILES = ["foret-brume.jpg", "anniversaire-lou.webm", "vocal.ogg", "trap.svg", "trap.html", "hevc.mov"].map(file);
// Au-delà du premier segment (4 Mio) : sa lecture interroge le serveur (les petits éléments,
// déjà dans le segment lu à l'ouverture, n'en ont pas besoin).
const LONG = { name: "long.ogg", mimeType: "audio/ogg", buffer: Buffer.alloc(9 * 1048576, 7) };

test.use({ locale: "fr-FR" });

async function share(browser: import("@playwright/test").Browser, origin: string): Promise<Sent> {
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, origin + "/", { text: TEXT, files: FILES, opens: 3 });
  await s.ctx.close();
  return sent;
}

test("groupes et ordre de l'envoi ; texte, image, audio, vidéo ; pièges jamais affichés ; HEVC illisible ; axe ; captures", async ({ page, shh, browser }) => {
  test.setTimeout(180_000);
  const sent = await share(browser, shh.origin);

  await page.goto(sent.link);
  await unlock(page, sent.password);
  const groups = await page.locator("section.group h2").allTextContents();
  expect(groups).toEqual(["Texte", "Photos", "Vidéos", "Audio et vocaux", "Documents"]);
  const names = await page.locator("li.row .name").allTextContents();
  expect(names.slice(1)).toEqual(["foret-brume.jpg", "trap.svg", "anniversaire-lou.webm", "hevc.mov", "vocal.ogg", "trap.html"]);
  const viewer = page.getByRole("dialog");

  // Texte brut dans la visionneuse, sens automatique, jamais de HTML.
  await page.getByRole("button", { name: `Voir ${names[0]}` }).click();
  const pre = viewer.locator("pre[dir=auto]");
  await expect(pre).toHaveText(TEXT);
  expect(await pre.evaluate((e) => e.children.length)).toBe(0);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);

  // Image : URL blob révoquée dès le chargement.
  await page.getByRole("button", { name: "Voir foret-brume.jpg" }).click();
  const img = viewer.locator("img");
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  const revoked = await img.evaluate(
    (i: HTMLImageElement) =>
      new Promise<boolean>((res) => {
        const probe = new Image();
        probe.onload = () => res(false);
        probe.onerror = () => res(true);
        probe.src = i.src;
      }),
  );
  expect(revoked).toBe(true);
  await page.keyboard.press("Escape");

  // Pièges : SVG et HTML en Télécharger seulement, aucun aperçu, aucun script exécuté.
  for (const n of ["trap.svg", "trap.html"]) {
    const row = page.locator("li.row").filter({ hasText: n });
    await expect(row.getByRole("button", { name: /^Voir/ })).toHaveCount(0);
    await expect(row.getByRole("button", { name: `Télécharger ${n}` })).toBeVisible();
    expect(await row.locator("img, iframe, object, embed, svg image").count()).toBe(0);
  }

  // Audio et vidéo : téléchargés à la demande, lisibles dans le panneau.
  await page.getByRole("button", { name: "Voir vocal.ogg" }).click();
  const audio = viewer.locator("audio");
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.readyState), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Voir anniversaire-lou.webm" }).click();
  const video = viewer.locator("video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  await expect(video).toHaveAttribute("playsinline", "");

  // HEVC : Chromium ne le décode pas → message, Télécharger reste dans le panneau.
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByRole("heading", { name: "hevc.mov" })).toBeVisible();
  // Le format et le navigateur à essayer (retours CLEAN4) : MOV, souvent en HEVC → Safari.
  await expect(viewer.getByText("Ce navigateur ne sait pas lire le format MOV. Enregistrez le fichier, ou ouvrez le lien dans Safari.")).toBeVisible({ timeout: 20_000 });
  await expect(viewer.locator("video")).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Télécharger hevc.mov" })).toBeVisible();
  await page.keyboard.press("Escape");

  expect(await page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned)).toBeUndefined();
  // Rien d'autre que le partage : aucun cadre, aucune offre.
  expect(await page.locator("iframe").count()).toBe(0);
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, "content");
});

test("expiration pendant la lecture, rien en cours → l'interface se ferme aussitôt (spec §41.8) ; capture", async ({ page, shh, browser }) => {
  test.setTimeout(150_000);
  const sent = await share(browser, shh.origin);
  await page.clock.install();
  await page.goto(sent.link);
  await unlock(page, sent.password);
  const api: string[] = [];
  page.on("request", (r) => void (new URL(r.url()).pathname.startsWith("/api/") && api.push(r.url())));
  await page.clock.fastForward("12:30:00");
  await expect(page.getByRole("heading", { name: "Ce partage a expiré." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contenu", exact: true })).toHaveCount(0);
  await expect(page.locator("li.row, pre[dir=auto], video, audio, img[src^=blob]")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/anniversaire-lou|trap\.svg|4471/);
  await expect(page).toHaveTitle("Partage indisponible · Shhdrop");
  expect(api.filter((u) => !u.endsWith("/api/shares/done"))).toEqual([]); // aucune requête pour fermer
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await capture(page, "content-expired");
});

test("destruction par l'expéditeur pendant la lecture → l'interface se ferme (« supprimé ») ; Retour → plus rien", async ({ page, shh, browser }) => {
  test.setTimeout(150_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT, files: [file("anniversaire-lou.webm"), LONG] });
  await s.ctx.close();
  await page.goto(sent.link);
  await unlock(page, sent.password);
  // Spec §41.8 : la surveillance (410) ferme l'interface sans geste de la personne.
  await destroyShare(sent.manage, shh.origin);
  await expect(page.getByRole("heading", { name: "Ce partage a été supprimé." })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Voir anniversaire-lou.webm" })).toHaveCount(0);

  // Un fichier déposé sur la page ne la fait pas naviguer.
  const prevented = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "x.txt"));
    const e = new DragEvent("drop", { dataTransfer: dt, cancelable: true, bubbles: true });
    document.body.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(prevented).toBe(true);

  // Quitter puis revenir : la page ne garde rien du partage.
  await goSecurity(page);
  await expect(page).toHaveURL(`${shh.origin}/securite`);
  await page.goBack();
  await expect(page).toHaveURL(`${shh.origin}/`);
  await expect(page.getByRole("heading", { name: "Contenu", exact: true })).toHaveCount(0);
  expect(await page.content()).not.toContain("الطابق الثالث");
});

test.describe("390 × 844", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("contenu puis destruction au téléphone : sans défilement horizontal, actions au clavier ; captures", async ({ page, shh, browser }) => {
    test.setTimeout(150_000);
    const s = await freshPage(browser);
    const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT, files: [file("foret-brume.jpg"), file("anniversaire-lou.webm")] });
    await s.ctx.close();
    await page.goto(sent.link);
    await unlock(page, sent.password);
    await expect(page.locator("li.row").first()).toBeVisible();
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(page, "content-390");
    // Détruire atteignable au clavier (M10).
    const destroy = page.getByRole("button", { name: "Détruire ce partage", exact: true });
    await destroy.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Détruire", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Détruit" })).toBeVisible({ timeout: 20_000 });
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(page, "destroyed-390");
  });
});

test.describe("en-US", () => {
  test.use({ locale: "en-US" });
  test("locked screen and content in English ; captures", async ({ page, shh, browser }) => {
    test.setTimeout(150_000);
    const s = await freshPage(browser);
    const sent = await sendShare(s.page, shh.origin + "/", { text: "Door code: 4471." });
    await s.ctx.close();
    await page.goto(sent.link);
    await expect(page.getByRole("heading", { name: "An encrypted share is waiting for you" })).toBeVisible();
    await expect(page.getByText("This share can be opened 1\u00a0more time. Opening it counts as one open. Reloading the page or opening it in another tab of this browser does not count another one for 30\u00a0minutes.")).toBeVisible();
    await settle(page);
    await capture(page, "open-en");
    await page.getByLabel("Password", { exact: true }).fill(sent.password);
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByRole("heading", { name: "Contents", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Destroy this share", exact: true })).toBeVisible();
    await settle(page);
    await capture(page, "content-en");
  });
});
