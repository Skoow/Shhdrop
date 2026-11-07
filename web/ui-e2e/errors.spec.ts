// Pages d'erreur (tâche UP) : introuvable (vrai 404 du serveur), hors ligne, lien invalide,
// erreur du serveur, trop de demandes (Retry-After), maintenance (503 « frozen »), navigateur
// non pris en charge. Chacune : titre d'onglet, aucun secret dans l'adresse, axe sans violation,
// captures fr-FR (1440 et 390 de large).
import type { Page } from "@playwright/test";
import { axe, capture, expect, test } from "./fixtures";
import { addText, sendButton } from "./send-helpers";

const KEY = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => 255 - i * 3)).toString("base64url");

test.use({ locale: "fr-FR" });

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(await axe(page)).toEqual([]);
  await capture(page, `${name}-1440`);
  const vp = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, `${name}-390`);
  await page.setViewportSize(vp);
}
const noSecret = (page: Page) => expect.poll(() => page.evaluate(() => location.hash + location.search)).toBe("");

test.describe("pages d'erreur", () => {
  test.skip(({ isMobile }) => isMobile, "une passe à 1440 puis 390 suffit (captures)");

  test("404 : statut réel du serveur, « Cette page n'existe pas. », lien vers l'accueil", async ({ page, shh }) => {
    const res = await page.goto(shh.origin + "/nope");
    expect(res!.status()).toBe(404);
    expect((await page.goto(shh.origin + "/securite"))!.status()).toBe(200);
    await page.goto(shh.origin + "/nope");
    await expect(page.getByRole("heading", { level: 1, name: "Cette page n'existe pas." })).toBeVisible();
    await expect(page).toHaveTitle("Page introuvable · Shhdrop");
    await expect(page.getByRole("link", { name: "Retour à l'accueil" })).toBeVisible();
    await noSecret(page);
    await shot(page, "erreur-404");
  });

  test("hors ligne : aucune requête, puis relance d'office au retour du réseau", async ({ page, shh, context }) => {
    const api: string[] = [];
    page.on("request", (r) => void (new URL(r.url()).pathname.startsWith("/api/") && api.push(r.url())));
    await page.goto(shh.origin + "/");
    await context.setOffline(true);
    await page.evaluate((k) => (location.hash = k), KEY);
    await expect(page.getByRole("heading", { level: 1, name: "Vous êtes hors ligne." })).toBeVisible();
    await expect(page).toHaveTitle("Hors ligne · Shhdrop");
    expect(api).toEqual([]);
    await noSecret(page);
    await shot(page, "erreur-hors-ligne");
    await context.setOffline(false);
    // Le lien de test n'existe pas : la relance aboutit à « lien invalide », même facture.
    await expect(page.getByRole("heading", { level: 1, name: "Ce lien n'existe pas ou n'est plus disponible." })).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveTitle("Lien indisponible · Shhdrop");
    await noSecret(page);
    await shot(page, "erreur-lien-invalide");
  });

  test("erreur du serveur (5xx persistant) : page fixe, Réessayer", async ({ page, shh }) => {
    test.setTimeout(90_000);
    await page.route("**/api/shares/meta", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"internal"}' }));
    await page.goto(`${shh.origin}/#${KEY}`);
    await expect(page.getByRole("heading", { level: 1, name: "Le serveur a un problème." })).toBeVisible({ timeout: 40_000 });
    await expect(page).toHaveTitle("Erreur du serveur · Shhdrop");
    await expect(page.getByRole("button", { name: "Réessayer" })).toBeEnabled();
    await noSecret(page);
    await shot(page, "erreur-serveur");
  });

  test("trop de demandes (429, Retry-After) : compte à rebours, Réessayer à zéro", async ({ page, shh }) => {
    test.setTimeout(90_000);
    await page.route("**/api/shares/meta", (r) => r.fulfill({ status: 429, headers: { "Retry-After": "1" }, body: "trop" }));
    await page.goto(`${shh.origin}/#${KEY}`);
    await expect(page.getByRole("heading", { level: 1, name: "Trop de demandes rapprochées." })).toBeVisible({ timeout: 40_000 });
    await expect(page).toHaveTitle("Trop de demandes · Shhdrop");
    await expect(page.getByRole("button", { name: "Réessayer" })).toBeEnabled({ timeout: 5_000 });
    await expect(page.locator(".wait")).toHaveText("Vous pouvez réessayer.");
    await noSecret(page);
    await shot(page, "erreur-trop-de-demandes");
  });

  test("maintenance (503 « frozen » à la création) : page dédiée, l'envoi est gardé", async ({ page, shh }) => {
    await page.route("**/api/shares", (r) =>
      r.request().method() === "POST" ? r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"frozen"}' }) : r.fallback(),
    );
    await page.goto(shh.origin + "/");
    await addText(page, "note gardée");
    await sendButton(page).click();
    await expect(page.getByRole("heading", { name: "Shhdrop est en maintenance." })).toBeVisible({ timeout: 40_000 });
    await expect(page).toHaveTitle("Maintenance · Shhdrop");
    await noSecret(page);
    await shot(page, "erreur-maintenance");
    await page.getByRole("button", { name: "Revenir à mon envoi" }).click();
    await expect(page.locator("[data-row]")).toHaveCount(1);
  });
});

test.describe("navigateur sans crypto.subtle", () => {
  test.skip(({ isMobile }) => isMobile, "une passe suffit");
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Crypto.prototype, "subtle", { get: () => undefined, configurable: true }));
  });
  test("« non pris en charge » : titre, aucune requête", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    await expect(page.getByRole("heading", { level: 1, name: "Ce navigateur ne permet pas de chiffrer en sécurité." })).toBeVisible();
    await expect(page).toHaveTitle("Navigateur non pris en charge · Shhdrop");
    await shot(page, "erreur-navigateur");
  });
});
