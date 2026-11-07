// Contenu et visionneuses (Task 21, UI §9.8, §12.4) sur le vrai serveur : groupes et ordre de
// l'envoi, texte brut, image depuis une URL blob révoquée au chargement, audio et vidéo natifs,
// fichiers piégés jamais affichés, échec de décodage, expiration, destruction pendant la lecture.
import { destroyShare } from "../src/index";
import { axe, capture, expect, test } from "./fixtures";
import { file, freshPage, sendShare, settle, unlock, type Sent } from "./open-helpers";

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
  const groups = await page.locator("section.group h2").evaluateAll((hs) => hs.map((h) => h.firstChild?.textContent?.trim()));
  expect(groups).toEqual(["Texte", "Photos", "Vidéos", "Audio et vocaux", "Documents"]);
  const names = await page.locator(".item .name").allTextContents();
  expect(names.slice(1)).toEqual(["foret-brume.jpg", "trap.svg", "anniversaire-lou.webm", "hevc.mov", "vocal.ogg", "trap.html"]);

  // Texte brut, sens automatique, jamais de HTML.
  const pre = page.locator("pre[dir=auto]");
  await expect(pre).toHaveText(TEXT);
  expect(await pre.evaluate((e) => e.children.length)).toBe(0);

  // Image chargée d'office (≤ 20 Mio), URL blob révoquée dès le chargement.
  const img = page.locator('.item[data-kind="image"] img');
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

  // Pièges : SVG et HTML en Enregistrer seulement, aucun aperçu, aucun script exécuté.
  for (const n of ["trap.svg", "trap.html"]) {
    const row = page.locator(".item").filter({ hasText: n });
    await expect(row).toHaveAttribute("data-kind", "none");
    await expect(row.getByRole("button", { name: /^(Afficher|Regarder|Écouter)/ })).toHaveCount(0);
    await expect(row.getByRole("button", { name: /^Enregistrer/ })).toBeVisible();
    expect(await row.locator("img, iframe, object, embed, svg image").count()).toBe(0);
  }

  // Audio et vidéo : téléchargés à la demande, lisibles.
  await page.getByRole("button", { name: "Écouter vocal.ogg" }).click();
  const audio = page.locator("audio");
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.readyState), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "Regarder anniversaire-lou.webm" }).click();
  const video = page.locator('.item[data-kind="video"]').filter({ hasText: "anniversaire-lou.webm" }).locator("video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  await expect(video).toHaveAttribute("playsinline", "");

  // HEVC : Chromium ne le décode pas → message, Enregistrer reste.
  await page.getByRole("button", { name: "Regarder hevc.mov" }).click();
  const hevc = page.locator(".item").filter({ hasText: "hevc.mov" });
  await expect(hevc.getByText("Ce fichier ne peut pas être lu sur cet appareil.", { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(hevc.locator("video")).toHaveCount(0);

  expect(await page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned)).toBeUndefined();
  // Rien d'autre que le partage : aucun cadre, aucune offre.
  expect(await page.locator("iframe").count()).toBe(0);
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, "content");
  await page.locator('.item[data-kind="image"]').scrollIntoViewIfNeeded();
  await capture(page, "content-image");
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
  await expect(page.getByRole("heading", { name: "Contenu du partage" })).toHaveCount(0);
  await expect(page.locator(".item, pre[dir=auto], video, audio, img[src^=blob]")).toHaveCount(0);
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
  await expect(page.getByRole("button", { name: "Regarder anniversaire-lou.webm" })).toHaveCount(0);

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
  await page.getByRole("link", { name: "Sécurité", exact: true }).click();
  await expect(page).toHaveURL(`${shh.origin}/securite`);
  await page.goBack();
  await expect(page).toHaveURL(`${shh.origin}/`);
  await expect(page.getByRole("heading", { name: "Contenu du partage" })).toHaveCount(0);
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
    await expect(page.locator(".item img")).toBeVisible();
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(page, "content-390");
    // Détruire atteignable au clavier (M10).
    const destroy = page.getByRole("button", { name: "Détruire ce partage pour tout le monde" });
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
    await expect(page.getByText("Opening it counts as one open, even if you reload the page. It can be opened 1\u00a0more time.")).toBeVisible();
    await settle(page);
    await capture(page, "open-en");
    await page.getByLabel("Password", { exact: true }).fill(sent.password);
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByRole("heading", { name: "Share contents" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Destroy this share for everyone" })).toBeVisible();
    await settle(page);
    await capture(page, "content-en");
  });
});
