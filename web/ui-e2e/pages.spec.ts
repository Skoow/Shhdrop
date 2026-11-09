// Pages d'information (plan Task 25, retours UI5) et en-tête : Sécurité (limites honnêtes),
// Confidentialité, Conditions et Mentions légales (squelettes « En cours de rédaction », aucune
// identité inventée), Signaler un abus, Offres (« par partage »). Captures fr-FR 390 et 1440.
import { fileURLToPath } from "node:url";
import { axe, expect, test } from "./fixtures";

test.use({ locale: "fr-FR" });
const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-UI5/", import.meta.url));
const w = (isMobile: boolean) => (isMobile ? 390 : 1440);

test("Sécurité : chiffrement, ce que voit le serveur, limites (historique, onglet, PDF et archives, caméra) ; jamais « 100 % » ; capture", async ({ page, shh, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(shh.origin + "/securite");
  await expect(page.getByRole("heading", { level: 1, name: "Sécurité" })).toBeVisible();
  for (const h of ["Chiffré sur votre appareil", "Comment fonctionne le lien", "Ce que voit le serveur", "Ce que Shhdrop ne peut pas faire", "QR code et partage en un geste", "Caméra et micro"])
    await expect(page.getByRole("heading", { level: 2, name: h })).toBeVisible();
  const main = page.locator("main");
  for (const x of ["AES-256-GCM", "Argon2id", "historique", "stockage de cet onglet", "PDF et des archives", "Permissions-Policy", "adresse IP", "environ 3 minutes"]) await expect(main).toContainText(x);
  const text = await main.innerText();
  expect(text).not.toMatch(/100\s?%|sécurisé à|audit|Suisse|Islande/i);
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}securite-${w(isMobile)}.png`, fullPage: true });
});

test("Confidentialité, Signaler, Conditions, Mentions : contenus, bandeau « En cours de rédaction », aucun e-mail ni identité inventée", async ({ page, shh }) => {
  await page.goto(shh.origin + "/confidentialite");
  await expect(page.locator("main")).toContainText("Aucun cookie");
  await expect(page.locator("main")).toContainText("Votre adresse IP n'est pas enregistrée.");
  await expect(page.locator("#verification")).toContainText("Google voit alors votre adresse IP");
  await page.goto(shh.origin + "/signaler");
  await expect(page.getByRole("heading", { level: 1, name: "Signaler un abus" })).toBeVisible();
  await expect(page.locator("main")).toContainText("Signaler");
  for (const [path, title] of [["/conditions", "Conditions d'utilisation"], ["/mentions-legales", "Mentions légales"]] as const) {
    await page.goto(shh.origin + path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.locator("[data-draft]")).toHaveText("En cours de rédaction");
    await expect(page.locator("main")).toContainText("compléter par le propriétaire");
    expect(await page.locator("main").innerText()).not.toMatch(/@|SAS|SARL|OVH|Hetzner|Scaleway/);
    expect(await axe(page)).toEqual([]);
  }
  for (const p of ["/securite", "/confidentialite", "/signaler"]) {
    await page.goto(shh.origin + p);
    await expect(page.locator("[data-draft]")).toHaveCount(0);
    expect(await page.locator("main").innerText()).not.toContain("@");
  }
});

test("Offres : « 10 Go par partage », « 50 Go par partage » ; rien à acheter ; capture", async ({ page, shh, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(shh.origin + "/offres");
  const t = page.locator("[data-offers]");
  for (const x of ["2 Go par partage", "10 Go par partage", "50 Go par partage"]) await expect(t).toContainText(x);
  await expect(page.locator("main form, main input")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}offres-${w(isMobile)}.png`, fullPage: true });
});

test("en-tête : air au-dessus du logo, Réglages ≥ 44 px (icône 24 px) ; pied de page ; captures", async ({ page, shh, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(shh.origin + "/securite");
  // Le premier élément de la barre (logo, ou « Retour » sur téléphone) n'est plus collé en haut.
  const first = await page.locator(isMobile ? "header.top .bar" : "header.top a.logo").boundingBox();
  expect(first!.y).toBeGreaterThanOrEqual(8);
  const gear = page.getByRole("banner").getByRole("button", { name: "Réglages" });
  if (!isMobile) {
    const g = await gear.boundingBox();
    expect(Math.min(g!.width, g!.height)).toBeGreaterThanOrEqual(44);
    expect((await gear.locator("svg").boundingBox())!.width).toBeGreaterThanOrEqual(24);
  }
  await page.screenshot({ path: `${SHOTS}entete-${w(isMobile)}.png` });
  const foot = page.locator("footer[data-foot]");
  await foot.scrollIntoViewIfNeeded();
  await expect(foot).toBeVisible();
  await foot.screenshot({ path: `${SHOTS}pied-${w(isMobile)}.png` });
});
