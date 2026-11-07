// Téléphone façon app (< 900 px), jusqu'à la vraie version mobile : PWA installable (manifeste,
// méta), aucun défilement horizontal, barre d'onglets sur les écrans racine seulement, action
// principale visible en bas, cibles ≥ 44 px, champs ≥ 16 px (pas de zoom iOS), confirmations
// en feuille du bas, tableau comparatif en cartes. Ordinateur : rien ne change (≥ 900 px).
// Captures fr-FR 390 × 844 (×2) : .superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-MOB/.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { freshPage, pwField, sendShare, settle, unlock, unlockButton } from "./open-helpers";
import { addText, noHScroll, readyHeading, sendButton } from "./send-helpers";

const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-MOB/", import.meta.url));
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "fr-FR" } as const;

async function shot(page: Page, name: string) {
  // Une seule série de captures (Chromium) : WebKit vérifie le comportement, sans capture.
  if (test.info().project.name !== "chromium-mobile") return;
  mkdirSync(SHOTS, { recursive: true });
  await settle(page);
  await page.screenshot({ path: `${SHOTS}${name}.png` });
}

const tabbar = (page: Page) => page.getByRole("navigation", { name: "Navigation principale" });

/** Boutons et liens-boutons visibles plus petits que 44 × 44 px (liens dans le texte exclus). */
const smallTargets = (page: Page, scope: string) =>
  page.evaluate((sel) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(`${sel} button, ${sel} [role=button], ${sel} [data-tabbar] a, ${sel} summary`)) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || st.visibility === "hidden" || el.closest("[hidden], [inert]")) continue;
      if (r.height < 43.5 || r.width < 43.5) out.push(`${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return out;
  }, scope);

/** Champs de saisie visibles dont la police fait moins de 16 px (iOS zoomerait). */
const smallFields = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea, select")]
      .filter((el) => el.getClientRects().length > 0 && !el.closest("[hidden]"))
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => `${el.id || el.getAttribute("name") || el.tagName} ${getComputedStyle(el).fontSize}`),
  );

const inViewport = (page: Page, loc: ReturnType<Page["locator"]>) =>
  loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight + 0.5 && r.height > 0;
  });

test.describe("téléphone façon app", () => {
  test.use(PHONE);
  test.beforeEach(({}, info) => test.skip(!info.project.name.endsWith("-mobile"), "téléphone seulement"));

  test("PWA : manifeste valide (standalone, couleurs de la DA, icônes locales) et méta d'app", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href).toBe("/manifest.webmanifest");
    const m = await page.evaluate(async (u) => (await fetch(u)).json(), href!);
    expect(m).toMatchObject({ name: "Shhdrop", short_name: "Shhdrop", display: "standalone", start_url: "./", scope: "./", theme_color: "#0B0D12", background_color: "#0B0D12" });
    for (const i of m.icons as { src: string; sizes: string; type: string }[]) {
      expect(i.src).not.toMatch(/^(https?:)?\/\//); // aucune ressource tierce
      const r = await page.request.get(new URL(i.src, shh.origin + href!).href);
      expect(r.status(), i.src).toBe(200);
    }
    expect((m.icons as { sizes: string }[]).map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    const meta = (n: string) => page.locator(`meta[name="${n}"]`).getAttribute("content");
    expect(await meta("theme-color")).toBe("#0B0D12");
    expect(await meta("apple-mobile-web-app-capable")).toBe("yes");
    expect(await meta("viewport")).toContain("viewport-fit=cover");
    // Aucun service worker dans cette tâche (Tasks C1 à C4).
    expect(await page.evaluate(() => navigator.serviceWorker?.controller ?? null)).toBeNull();
  });

  test("accueil : onglets en bas, Réglages en feuille, comparatif en cartes, ni rebond ni défilement horizontal", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    const nav = tabbar(page);
    await expect(nav).toBeVisible();
    expect(await inViewport(page, nav)).toBe(true);
    await expect(nav.getByRole("link", { name: "Envoyer" })).toHaveAttribute("aria-current", "page");
    for (const n of [/^Mes partages/, /^Salon/]) await expect(nav.getByRole("button", { name: n })).toHaveAttribute("aria-disabled", "true");
    expect(await smallTargets(page, "body")).toEqual([]);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY)).toBe("none");
    expect(await noHScroll(page)).toBe(true);
    await expect(page.locator("footer.foot")).toBeHidden(); // liens dans Réglages
    await shot(page, "accueil");

    // Comparatif : cartes (pas de tableau large), aucun nom de marque.
    const cmp = page.locator("[data-compare]");
    await cmp.scrollIntoViewIfNeeded();
    await expect(cmp.getByRole("heading", { name: "Pourquoi Shhdrop" })).toBeVisible();
    await expect(cmp.locator("table")).toBeHidden();
    await expect(cmp.locator(".card")).toHaveCount(7);
    await expect(cmp.getByText("Comparaison générale, vérifiée en novembre 2026.", { exact: false })).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
    await cmp.locator(".card").first().scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -80));
    await shot(page, "tableau-comparatif");

    // Réglages : langue, Sécurité, Confidentialité.
    await nav.getByRole("button", { name: "Réglages" }).click();
    const sheet = page.getByRole("dialog", { name: "Réglages" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Sécurité" })).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Confidentialité" })).toBeVisible();
    await sheet.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Français" }).click();
    await page.getByRole("dialog", { name: "Réglages" }).getByRole("link", { name: "Sécurité" }).click();
    await expect(page).toHaveURL(/\/securite$/);
    await expect(nav.getByRole("button", { name: "Réglages" })).toHaveAttribute("aria-current", "page");
  });

  test("composeur → options → envoi → lien prêt : onglets masqués, action en bas, champs ≥ 16 px, feuille de confirmation", async ({ page, shh }) => {
    test.setTimeout(90_000);
    await page.goto(shh.origin + "/");
    await addText(page, "Le code de la porte est 4471.");
    await expect(tabbar(page)).toHaveCount(0);
    const send = sendButton(page);
    expect(await inViewport(page, send)).toBe(true);
    expect(await smallTargets(page, "main")).toEqual([]);
    expect(await noHScroll(page)).toBe(true);
    await shot(page, "composeur");

    await page.getByRole("button", { name: /^Options · / }).click();
    const opts = page.getByRole("dialog", { name: "Options" });
    await expect(opts).toBeVisible();
    expect(await smallFields(page)).toEqual([]);
    expect(await smallTargets(page, "dialog[open]")).toEqual([]);
    await shot(page, "options");
    await page.keyboard.press("Escape");

    await send.click();
    await expect(readyHeading(page)).toBeVisible({ timeout: 60_000 });
    await expect(tabbar(page)).toHaveCount(0);
    expect(await noHScroll(page)).toBe(true);
    const done = page.getByRole("button", { name: "Terminé" });
    expect(await inViewport(page, done)).toBe(true);
    await shot(page, "lien-pret");

    // Confirmation : feuille qui monte du bas, gros boutons, focus sur Annuler.
    await done.click();
    const conf = page.getByRole("dialog", { name: "Terminé" });
    await expect(conf).toBeVisible();
    const box = (await conf.boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(844 - 2); // ancrée en bas
    await expect(conf.getByRole("button", { name: "Annuler" })).toBeFocused();
    for (const b of await conf.getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await shot(page, "feuille-confirmation");
    await conf.getByRole("button", { name: "Annuler" }).click();
    await expect(conf).toBeHidden();
    await expect(readyHeading(page)).toBeVisible();
  });

  test("destinataire : ouverture et contenu sans onglets, Déverrouiller en bas, champ ≥ 16 px", async ({ page, shh, browser }) => {
    test.setTimeout(90_000);
    const { ctx, page: sender } = await freshPage(browser);
    const s = await sendShare(sender, shh.origin + "/", { text: "Le code de la porte est 4471." });
    await ctx.close();
    await page.goto(s.link);
    await expect(pwField(page)).toBeVisible();
    await expect(tabbar(page)).toHaveCount(0);
    expect(await smallFields(page)).toEqual([]);
    expect(await inViewport(page, unlockButton(page))).toBe(true);
    expect((await unlockButton(page).boundingBox())!.width).toBeGreaterThan(300); // pleine largeur
    expect(await page.evaluate(() => getComputedStyle(document.body).overscrollBehaviorY)).toBe("none");
    expect(await noHScroll(page)).toBe(true);
    await shot(page, "ouverture");
    await unlock(page, s.password);
    await expect(tabbar(page)).toHaveCount(0);
    expect(await noHScroll(page)).toBe(true);
    await shot(page, "contenu");
  });
});

test.describe("ordinateur : rien ne change", () => {
  test.use({ locale: "fr-FR" });
  test.beforeEach(({}, info) => test.skip(!info.project.name.endsWith("-desktop"), "ordinateur seulement"));

  test("pas de barre d'onglets ; comparatif en vrai tableau (th scope)", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    await expect(tabbar(page)).toBeHidden();
    await expect(page.locator("footer.foot")).toBeVisible();
    const table = page.locator("[data-compare] table");
    await table.scrollIntoViewIfNeeded();
    await expect(table).toBeVisible();
    await expect(table.locator('thead th[scope="col"]')).toHaveCount(4);
    await expect(table.locator('tbody th[scope="row"]')).toHaveCount(7);
    await expect(table.getByRole("columnheader", { name: "Shhdrop" })).toBeVisible();
    await expect(table.getByRole("cell", { name: "Toujours" })).toBeVisible();
    await expect(page.locator("[data-compare] .cards")).toBeHidden();
  });
});
