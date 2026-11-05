import { axe, capture, expect, test } from "./fixtures";

test.describe("français par défaut", () => {
  test.use({ locale: "fr-FR" });

  test("la bascule change <html lang>, les textes et ne stocke rien", async ({ page, shh }) => {
    await page.goto(shh.origin + "/inconnu");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByRole("heading", { name: "Cette page n'existe pas." })).toBeVisible();

    await page.getByRole("button", { name: "Passer l'interface en anglais" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "This page does not exist." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Security" })).toBeVisible();

    await page.getByRole("button", { name: "Switch the interface to French" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");

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
    await page.getByRole("button", { name: "Passer l'interface en anglais" }).click();
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

  test("navigation interne sans rechargement, focus sur le contenu, retour arrière", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    await page.evaluate(() => ((window as unknown as { __marque: number }).__marque = 1));
    await page.getByRole("link", { name: "Sécurité" }).click();
    await expect(page).toHaveURL(shh.origin + "/securite");
    await expect(page.getByRole("link", { name: "Sécurité" })).toHaveAttribute("aria-current", "page");
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
