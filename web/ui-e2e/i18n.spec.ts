import type { Page } from "@playwright/test";
import { axe, capture, expect, test } from "./fixtures";
import { footLink, langGroup, switchLang } from "./foot-helpers";

/** Va à la page Sécurité : lien du pied de page (présent partout, ordinateur et téléphone). */
async function openSecurity(page: Page) {
  const l = footLink(page, /^(Sécurité|Security)$/);
  await l.scrollIntoViewIfNeeded();
  await l.click();
}

test.describe("français par défaut", () => {
  test.use({ locale: "fr-FR" });

  test("la bascule change <html lang>, les textes et ne stocke rien", async ({ page, shh }) => {
    await page.goto(shh.origin + "/inconnu");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByRole("heading", { name: "Cette page n'existe pas." })).toBeVisible();
    await expect(page).toHaveTitle("Page introuvable · Shhdrop");

    await switchLang(page, "English");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "This page does not exist." })).toBeVisible();
    await expect(page).toHaveTitle("Page not found · Shhdrop");
    // Titre par route (scan UX B9) : accueil, puis Sécurité.
    await openSecurity(page);
    await expect(page).toHaveTitle("Security · Shhdrop");
    // Accueil : titre descriptif (référencement, retours CLEAN2) ; page d'envoi : « Envoyer ».
    await page.goto(shh.origin + "/");
    await expect(page).toHaveTitle("Partage chiffré de bout en bout, sans compte · Shhdrop");

    await switchLang(page, "English");
    await expect(page).toHaveTitle("End-to-end encrypted sharing, no account · Shhdrop");
    await switchLang(page, "Français");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page).toHaveTitle("Partage chiffré de bout en bout, sans compte · Shhdrop");
    await page.goto(shh.origin + "/envoyer");
    await expect(page).toHaveTitle("Envoyer · Shhdrop");

    const stored = await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      cookie: document.cookie,
      idb: (await indexedDB.databases()).length,
    }));
    expect(stored).toEqual({ local: 0, session: 0, cookie: "", idb: 0 });
    expect((await page.context().cookies()).length).toBe(0);
  });

  test("pas de mémorisation : un rechargement revient à la langue du navigateur", async ({ page, shh }) => {
    await page.goto(shh.origin + "/inconnu");
    await switchLang(page, "English");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  });

  test("lien d'évitement : focus sur le contenu, aucun # dans l'adresse", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Aller au contenu" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#contenu")).toBeFocused();
    expect(new URL(page.url()).hash).toBe("");
  });

  test("navigation interne sans rechargement, focus sur le contenu, retour arrière", async ({ page, shh, isMobile }) => {
    await page.goto(shh.origin + "/");
    await page.evaluate(() => ((window as unknown as { __marque: number }).__marque = 1));
    await openSecurity(page);
    await expect(page).toHaveURL(shh.origin + "/securite");
    if (!isMobile) await expect(page.getByRole("link", { name: "Sécurité", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("main#contenu")).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL(shh.origin + "/");
    expect(await page.evaluate(() => (window as unknown as { __marque?: number }).__marque)).toBe(1);
  });

  test("404 de l'interface : axe et capture", async ({ page, shh }) => {
    await page.goto(shh.origin + "/s/a/b");
    await expect(page.getByRole("heading", { name: "Cette page n'existe pas." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Retour à l'accueil" })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await capture(page, "coque-404-fr");
  });
});

test.describe("anglais par défaut", () => {
  test.use({ locale: "en-GB" });

  test("langue du navigateur non française → anglais", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(await axe(page)).toEqual([]);
    await capture(page, "coque-en");
  });
});

test("le verre de l'en-tête apparaît au défilement et pas avant", async ({ page, shh }) => {
  await page.goto(shh.origin + "/inconnu");
  const header = page.locator("header.top");
  await expect(header).not.toHaveClass(/scrolled/);
  await page.evaluate(() => {
    document.body.style.minHeight = "4000px"; // CSSOM : permis par la CSP, contrairement à l'attribut style
  });
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect(header).toHaveClass(/scrolled/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(header).not.toHaveClass(/scrolled/);
});

test("pied de page, langue : chaque bouton porte sa langue (lang) et son état (aria-pressed)", async ({ page, shh }) => {
  await page.goto(shh.origin + "/inconnu");
  await expect(page.getByRole("banner").getByRole("button", { name: /English|Français/ })).toHaveCount(0);
  const html = await page.locator("html").getAttribute("lang");
  await switchLang(page, html === "fr" ? "English" : "Français");
  await expect(page.locator("html")).toHaveAttribute("lang", html === "fr" ? "en" : "fr");
  const grp = langGroup(page);
  await expect(grp.getByRole("button", { name: "Français" })).toHaveAttribute("lang", "fr");
  await expect(grp.getByRole("button", { name: "English" })).toHaveAttribute("lang", "en");
  await expect(grp.getByRole("button", { name: html === "fr" ? "English" : "Français" })).toHaveAttribute("aria-pressed", "true");
});

test("le secret du # ne fuit ni dans le DOM, ni dans le titre, ni dans la console, ni dans une requête", async ({ page, shh }) => {
  const SECRET = "SECRETSECRET";
  const consoleTexts: string[] = [];
  const urls: string[] = [];
  page.on("console", (m) => consoleTexts.push(m.text()));
  page.on("request", (r) => urls.push(r.url()));
  await page.goto(`${shh.origin}/s/AbCdEfGhIjKlMnOpQrStUv#${SECRET}`);
  await expect(page.locator("main#contenu")).toBeVisible();
  // Navigation interne et bascule de langue : le routeur travaille sous l'adresse complète.
  await switchLang(page, "English");
  await openSecurity(page);
  await page.goBack();
  await page.evaluate(() => 0);
  expect(await page.content()).not.toContain(SECRET);
  expect(await page.title()).not.toContain(SECRET);
  expect(consoleTexts.join("\n")).not.toContain(SECRET);
  expect(urls.join("\n")).not.toContain(SECRET);
});
