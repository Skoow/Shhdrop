// Accueil (UI §9.1) : titre, phrase, schéma, lien « Comment ça marche », emplacement du composeur.
import type { Page } from "@playwright/test";
import { axe, capture, expect, test } from "./fixtures";

/** Paires de libellés du schéma dont les boîtes se croisent (texte réel, pas la cellule). */
function labelOverlaps(page: Page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll("[data-label]")];
    const r = els.map((e) => e.getBoundingClientRect());
    const out: string[] = [];
    for (let i = 0; i < r.length; i++)
      for (let j = i + 1; j < r.length; j++) {
        const a = r[i]!, b = r[j]!;
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
          out.push(`${els[i]!.textContent} × ${els[j]!.textContent}`);
      }
    return out;
  });
}

const TITLE_FR = "Un lien, un mot de passe, puis plus rien.";
const SCHEMA_FR = "Votre appareil — chiffré — serveur (ne lit rien) — chiffré — destinataire";

test.describe("fr-FR", () => {
  test.use({ locale: "fr-FR" });

  test("titre, phrase, schéma nommé, lien vers /securite ; axe", async ({ page, shh, isMobile }) => {
    await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
    await page.goto(shh.origin + "/");
    const h1 = page.getByRole("heading", { level: 1, name: TITLE_FR });
    await expect(h1).toBeVisible();
    await expect(page.getByText(/^Texte, photos, vidéos, vocaux, documents\./)).toBeVisible();

    const schema = page.locator('svg[role="img"]');
    await expect(schema).toHaveCount(1);
    await expect(schema).toHaveAttribute("aria-label", SCHEMA_FR);
    await expect(page.getByRole("img", { name: SCHEMA_FR })).toBeVisible();

    const how = page.getByRole("link", { name: "Comment ça marche" });
    await expect(how).toHaveAttribute("href", "/securite");

    // Aucun défilement horizontal.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await axe(page)).toEqual([]);
    await page.waitForTimeout(700); // tracé du schéma terminé (600 ms)
    await capture(page, "home");

    await how.click();
    await expect(page).toHaveURL(shh.origin + "/securite");
  });

  test("téléphone 390 × 844 : la rangée d'ajout est dans le premier écran", async ({ page, shh, isMobile }) => {
    test.skip(!isMobile, "projets téléphone seulement");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(shh.origin + "/");
    const slot = page.locator('[data-slot="compose"]');
    await expect(slot).toBeAttached();
    const box = await slot.boundingBox();
    expect(box).not.toBeNull();
    // Emplacement réservé (Task 10 y mettra la rangée d'ajout) : 48 px au moins, entièrement visible.
    expect(box!.height).toBeGreaterThanOrEqual(48);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  });

  test("320 px : rien ne déborde ; capture", async ({ page, shh }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(shh.origin + "/");
    await expect(page.getByRole("heading", { level: 1, name: TITLE_FR })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await labelOverlaps(page)).toEqual([]);
    await page.waitForTimeout(700);
    await capture(page, "home-320");
  });

  test("texte à 200 % sur 320 px : libellés sans chevauchement, aucun débordement ; capture", async ({ page, shh }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(shh.origin + "/");
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%"; // CSSOM : permis par la CSP
    });
    await expect(page.locator("[data-label]")).toHaveCount(6);
    expect(await labelOverlaps(page)).toEqual([]);
    // Les libellés restent dans le flux : sous le dessin, au-dessus du bloc suivant (le composeur).
    const drawing = await page.locator('svg[role="img"]').boundingBox();
    const next = await page.locator('[data-slot="compose"]').boundingBox();
    const boxes = await page.locator(".nodes [data-label]").evaluateAll((es) => es.map((e) => e.getBoundingClientRect().toJSON()));
    for (const box of boxes) {
      expect(box.top).toBeGreaterThanOrEqual(drawing!.y + drawing!.height);
      expect(box.bottom).toBeLessThanOrEqual(next!.y);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator(".schema").evaluate((e) => e.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(700);
    await capture(page, "home-320-200pct");
  });

  test("le trait n'est tracé qu'une fois par chargement : pas au retour sur l'accueil", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    await page.getByRole("link", { name: "Comment ça marche" }).click();
    await expect(page).toHaveURL(shh.origin + "/securite");
    await page.goBack();
    await expect(page.getByRole("img", { name: SCHEMA_FR })).toBeVisible();
    // Animations du schéma seulement (le survol du lien sous le pointeur a sa propre transition).
    expect(await page.evaluate(() => document.querySelector(".schema")!.getAnimations({ subtree: true }).length)).toBe(0);
  });

  test("mouvement : le trait est tracé une fois ; en mouvement réduit, aucune animation", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    // Mouvement normal : une animation existe au chargement (le test réduit est donc significatif).
    expect(await page.evaluate(() => document.getAnimations().length)).toBeGreaterThan(0);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(shh.origin + "/");
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    // Le trait est visible (état final), pas masqué.
    const offset = await page.evaluate(() =>
      getComputedStyle(document.querySelector("svg[role=img] .trace")!).strokeDashoffset,
    );
    expect(parseFloat(offset)).toBe(0);
  });

  test("contraste forcé : capture", async ({ page, shh, browserName }) => {
    test.skip(browserName !== "chromium", "forcedColors : Chromium seulement");
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto(shh.origin + "/");
    await expect(page.getByRole("heading", { level: 1, name: TITLE_FR })).toBeVisible();
    await page.waitForTimeout(700);
    await capture(page, "home-forced-colors");
  });
});

test.describe("en-US", () => {
  test.use({ locale: "en-US" });

  test("titre et schéma en anglais ; axe ; capture", async ({ page, shh, isMobile }) => {
    await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
    await page.goto(shh.origin + "/");
    await expect(page.getByRole("heading", { level: 1, name: "One link, one password, then nothing." })).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Your device — encrypted — server (can't read it) — encrypted — recipient" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "How it works" })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await page.waitForTimeout(700);
    await capture(page, "home-en");
  });
});
