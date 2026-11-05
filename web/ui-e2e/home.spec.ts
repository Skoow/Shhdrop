// Accueil (UI §9.1, DA v2 §20.4) : titre mot par mot, phrase, réceptacle, schéma en boucle,
// lien « Comment ça marche ».
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

    const schema = page.locator('[role="img"]');
    await expect(schema).toHaveCount(1);
    await expect(schema).toHaveAttribute("aria-label", SCHEMA_FR);
    await expect(page.getByRole("img", { name: SCHEMA_FR })).toBeVisible();

    const how = page.getByRole("link", { name: "Comment ça marche" });
    await expect(how).toHaveAttribute("href", "/securite");

    // Aucun défilement horizontal.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await axe(page)).toEqual([]);
    await page.waitForTimeout(900); // entrée finie (K1)
    await capture(page, "home");

    await how.click();
    await expect(page).toHaveURL(shh.origin + "/securite");
  });

  test("téléphone 390 × 844 : la rangée d'ajout est dans le premier écran, le schéma sous le réceptacle (S4)", async ({ page, shh, isMobile }) => {
    test.skip(!isMobile, "projets téléphone seulement");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(shh.origin + "/");
    await page.waitForTimeout(900); // positions finales (entrée finie)
    const row = page.getByRole("group", { name: "Ajouter" });
    await expect(row).toBeVisible();
    const box = (await row.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    const vessel = (await page.locator('[data-slot="compose"]').boundingBox())!;
    const schema = (await page.locator('[role="img"]').boundingBox())!;
    expect(schema.y).toBeGreaterThan(vessel.y + vessel.height);
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
    // Les libellés restent dans le flux : sous le dessin, au-dessus du bloc suivant (le pied de page).
    const drawing = await page.locator('[role="img"]').boundingBox();
    const next = await page.locator("footer").boundingBox();
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

  test("K1 : toutes les animations d'entrée sont finies à 900 ms (hors ambiance)", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    const entries = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => !((a.effect as KeyframeEffect).target as Element).closest("[data-ambient]"))
        .map((a) => ({ name: (a as CSSAnimation).animationName, end: Number(a.effect!.getComputedTiming().endTime) })),
    );
    // Le titre (9 mots), le réceptacle, la phrase et le schéma entrent bien.
    expect(entries.length).toBeGreaterThanOrEqual(12);
    for (const e of entries) expect(e.end, e.name).toBeLessThanOrEqual(900);
    // L'ambiance seule boucle : aurore, lumière du réceptacle, schéma.
    const infinite = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.effect!.getComputedTiming().iterations === Infinity)
        .every((a) => ((a.effect as KeyframeEffect).target as Element).closest("[data-ambient]") !== null),
    );
    expect(infinite).toBe(true);
  });

  test("K8 : le titre a pour nom la phrase entière ; la copie animée est cachée", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    const h1 = page.getByRole("heading", { level: 1, name: TITLE_FR, exact: true });
    await expect(h1).toBeVisible();
    await expect(h1.locator(".words")).toHaveAttribute("aria-hidden", "true");
    await expect(h1.locator(".words .w")).toHaveCount(9);
  });

  test("rien n'attend : un clic sur le réceptacle à 100 ms ouvre le sélecteur de fichiers", async ({ page, shh }) => {
    await page.goto(shh.origin + "/", { waitUntil: "domcontentloaded" });
    const vessel = page.locator('[data-slot="compose"] .vessel');
    await expect(vessel).toBeAttached();
    await page.waitForTimeout(100);
    const chooser = page.waitForEvent("filechooser", { timeout: 2000 });
    // force : pas d'attente de stabilité (le réceptacle monte encore de quelques pixels).
    await page.locator(".drop-title").click({ force: true });
    const fc = await chooser;
    expect(fc.isMultiple()).toBe(true);
  });

  test("ambiance (aurore, réceptacle, schéma) : pause hors écran et onglet caché, reprise ensuite", async ({ page, shh }) => {
    // Écran court : en haut de page, le schéma (sous le réceptacle) est hors écran.
    await page.setViewportSize({ width: 390, height: 560 });
    await page.goto(shh.origin + "/");
    const ambient = () =>
      page.evaluate(() => {
        const out: Record<string, string[]> = { aurora: [], vessel: [], schema: [] };
        for (const a of document.getAnimations()) {
          const el = (a.effect as KeyframeEffect).target as Element;
          if (!el.closest("[data-ambient]")) continue;
          const k = el.closest(".aurora") ? "aurora" : el.closest(".vessel") ? "vessel" : "schema";
          out[k]!.push(a.playState);
        }
        return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...new Set(v)].sort().join(",") + `×${v.length}`]));
      });
    // Hors écran : le schéma est en pause, l'aurore et le réceptacle (visible) tournent.
    await expect.poll(ambient).toEqual({ aurora: "running×3", vessel: "running×2", schema: "paused×5" });
    // Le schéma entre dans l'écran : il reprend.
    await page.locator(".schema").evaluate((e) => e.scrollIntoView({ block: "center" }));
    await expect.poll(ambient).toEqual({ aurora: "running×3", vessel: "running×2", schema: "running×5" });
    // Onglet caché : toute l'ambiance se met en pause ; visible à nouveau : elle reprend.
    const setHidden = (v: boolean) =>
      page.evaluate((hidden) => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
        document.dispatchEvent(new Event("visibilitychange"));
      }, v);
    await setHidden(true);
    await expect.poll(ambient).toEqual({ aurora: "paused×3", vessel: "paused×2", schema: "paused×5" });
    await setHidden(false);
    await expect.poll(ambient).toEqual({ aurora: "running×3", vessel: "running×2", schema: "running×5" });
  });

  test("mouvement réduit : aucune animation infinie, aucune entrée ; capture", async ({ page, shh, isMobile }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await page.goto(shh.origin + "/");
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    // m6 : l'ouverture du contour (état drop) n'est pas animée, seule sa couleur l'est.
    const props = await page.locator(".vessel .track").evaluate((e) => getComputedStyle(e).transitionProperty);
    expect(props).not.toMatch(/stroke-dasharray|all/);
    await capture(page, "home-v2-reduced");
  });

  test("transition de vue réduite (m5) : fondu seulement, aucun groupe déplacé ni redimensionné", async ({ page, shh, browserName }) => {
    test.skip(browserName !== "chromium", "pseudo-éléments de transition dans getAnimations : Chromium");
    await page.goto(shh.origin + "/");
    const run = (reduced: boolean) =>
      page.evaluate(async (r) => {
        const root = document.documentElement;
        root.classList.toggle("vt-reduced", r);
        const doc = document as Document & { startViewTransition(cb: () => void): { ready: Promise<void>; finished: Promise<void> } };
        // Le titre (groupe hero-title) change de taille : sans réduction, son groupe s'anime.
        const vt = doc.startViewTransition(() => document.querySelector("h1")!.classList.toggle("compact"));
        await vt.ready;
        const pseudo = document
          .getAnimations()
          .map((a) => (a.effect as KeyframeEffect).pseudoElement)
          .filter((p): p is string => !!p && p.startsWith("::view-transition"));
        await vt.finished;
        root.classList.remove("vt-reduced");
        return pseudo;
      }, reduced);
    const normal = await run(false);
    expect(normal.some((p) => p.startsWith("::view-transition-group(hero-title)"))).toBe(true);
    const reduced = await run(true);
    expect(reduced.filter((p) => p.startsWith("::view-transition-group"))).toEqual([]);
    expect(reduced).toContain("::view-transition-new(root)");
  });

  test("contraste forcé : aurore et grain retirés ; capture", async ({ page, shh, browserName, isMobile }) => {
    test.skip(browserName !== "chromium", "forcedColors : Chromium seulement");
    await page.emulateMedia({ forcedColors: "active" });
    await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await page.goto(shh.origin + "/");
    await expect(page.getByRole("heading", { level: 1, name: TITLE_FR })).toBeVisible();
    expect(await page.locator(".aurora").evaluate((e) => getComputedStyle(e).display)).toBe("none");
    expect(await page.locator(".grain").evaluate((e) => getComputedStyle(e).display)).toBe("none");
    await page.waitForTimeout(900);
    await capture(page, "home-v2-forced");
  });

  test("captures DA v2 (à comparer à da-v2/shots/01-accueil-*.png)", async ({ page, shh, isMobile }) => {
    await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await page.goto(shh.origin + "/");
    await page.waitForTimeout(1000);
    await capture(page, isMobile ? "home-v2-390" : "home-v2-1440");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
