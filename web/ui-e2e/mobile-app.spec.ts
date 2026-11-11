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
import { foot, footLink, switchLang } from "./foot-helpers";

const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-MOB2/", import.meta.url));
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "fr-FR" } as const;

async function shot(page: Page, name: string) {
  // Une seule série de captures (Chromium) : WebKit vérifie le comportement, sans capture.
  if (test.info().project.name !== "chromium-mobile") return;
  mkdirSync(SHOTS, { recursive: true });
  await settle(page);
  await page.screenshot({ path: `${SHOTS}${name}.png` });
}

const tabbar = (page: Page) => page.getByRole("navigation", { name: "Navigation principale" });

/** Boutons et liens-boutons visibles plus petits que 44 × 44 px (liens dans le texte exclus).
 *  Exception (retours UI6) : pastilles de coin d'une icône de format ([data-corner], cadenas et
 *  « Téléchargé ») : deux bulles sur une icône de 44 px, donc 24 px au moins (WCAG 2.5.8). */
const smallTargets = (page: Page, scope: string) =>
  page.evaluate((sel) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(`${sel} button, ${sel} [role=button], ${sel} [data-tabbar] a, ${sel} summary`)) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || st.visibility === "hidden" || el.closest("[hidden], [inert]")) continue;
      const min = el.matches("[data-corner]") ? 23.5 : 43.5;
      if (r.height < min || r.width < min) out.push(`${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30)} ${Math.round(r.width)}×${Math.round(r.height)}`);
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

  test("accueil : onglets en bas (sans Réglages), langue dans le pied, comparatif en cartes, ni rebond ni défilement horizontal", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    const nav = tabbar(page);
    await expect(nav).toBeVisible();
    expect(await inViewport(page, nav)).toBe(true);
    await expect(nav.getByRole("link", { name: "Envoyer" })).toHaveAttribute("aria-current", "page");
    for (const n of [/^Mes partages/, /^Salon/]) await expect(nav.getByRole("button", { name: n })).toHaveAttribute("aria-disabled", "true");
    expect(await smallTargets(page, "body")).toEqual([]);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY)).toBe("none");
    expect(await noHScroll(page)).toBe(true);
    // UI5 : pied de page visible en bas de l'accueil, téléphone compris.
    await expect(page.locator("footer.foot")).toBeAttached();
    await page.locator("footer.foot").scrollIntoViewIfNeeded();
    await expect(page.locator("footer.foot")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    // Plus de sélecteur de langue en haut à droite, plus de roue ni d'onglet Réglages (retours du
    // 11 novembre) : la langue se change dans le pied de page.
    const banner = page.getByRole("banner");
    await expect(banner.getByRole("button", { name: /English|Français|Réglages/ })).toHaveCount(0);
    await expect(nav.getByRole("button", { name: "Réglages" })).toHaveCount(0);
    await shot(page, "accueil");

    // Pied de page : langue, Sécurité, Confidentialité.
    await expect(footLink(page, "Sécurité")).toBeAttached();
    await expect(footLink(page, "Confidentialité")).toBeAttached();
    await switchLang(page, "English");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await switchLang(page, "Français");
    await footLink(page, "Sécurité").click();
    await expect(page).toHaveURL(/\/securite$/);
    // Plus d'onglet Réglages : aucun onglet n'est courant sur une page d'information.
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);
    // En-tête natif : retour en haut à gauche.
    const back = page.getByRole("banner").getByRole("button", { name: "Retour" });
    await expect(back).toBeVisible();
    const bb = (await back.boundingBox())!;
    expect(bb.x).toBeLessThan(24);
    await back.click();
    await expect(page).toHaveURL(new RegExp(`${shh.origin.replace(/[.:/]/g, "\\$&")}/$`));
  });

  test("composeur → options → envoi → lien prêt : onglets masqués, action en bas, champs ≥ 16 px, feuille de confirmation", async ({ page, shh }) => {
    test.setTimeout(90_000);
    await page.goto(shh.origin + "/");
    await shot(page, "accueil-ajouter");
    // Une seule action « Commencer » → page d'envoi (D41-37) ; « Ajouter » → feuille du bas en liste groupée, avec poignée.
    await page.locator(".add-big").click();
    await expect(page).toHaveURL(/\/envoyer$/);
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    const add = page.getByRole("dialog", { name: "Ajouter" });
    await expect(add).toBeVisible();
    expect(await smallTargets(page, "dialog[open]")).toEqual([]);
    await shot(page, "feuille-ajouter");
    await page.keyboard.press("Escape");
    await addText(page, "Le code de la porte est 4471.");
    await expect(tabbar(page)).toHaveCount(0);
    // Composeur (sans onglets) : rien en haut à droite, ni langue ni Réglages ; pied de page dessous.
    await expect(page.getByRole("banner").getByRole("button", { name: /Réglages|English|Français/ })).toBeHidden();
    await expect(foot(page)).toBeAttached();
    const send = sendButton(page);
    expect(await inViewport(page, send)).toBe(true);
    // « + » (Ajouter) collé à gauche de l'envoi, même hauteur, sous le pouce.
    const plus = (await page.getByRole("button", { name: "Ajouter", exact: true }).boundingBox())!;
    const sb = (await send.boundingBox())!;
    expect(Math.abs(plus.y - sb.y)).toBeLessThan(2);
    expect(plus.x + plus.width).toBeLessThan(sb.x);
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
    // Grand titre natif : une fois défilé, il se réduit dans la barre du haut.
    await expect(page.locator("header.top .small.on")).toHaveCount(0);
    await page.evaluate(() => scrollTo(0, 600));
    await expect(page.locator("header.top .small.on")).toHaveText("Lien prêt");
    await page.evaluate(() => scrollTo(0, 0));

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

  test("composeur : glisser une ligne vers la gauche la retire, « Annuler » la remet ; le bouton reste au menu", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    await addText(page, "Première note");
    await addText(page, "Seconde note");
    await expect(page.locator("[data-row]")).toHaveCount(2);
    const row = page.locator("[data-row] .row").first();
    const box = (await row.boundingBox())!;
    // Geste au doigt (pointerType « touch ») : 60 % de la largeur vers la gauche.
    await row.evaluate((el, b) => {
      const y = b.y + b.height / 2;
      const fire = (type: string, x: number) =>
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y }));
      fire("pointerdown", b.x + b.width - 10);
      for (let k = 1; k <= 6; k++) fire("pointermove", b.x + b.width - 10 - k * b.width * 0.1);
      fire("pointerup", b.x + b.width * 0.4);
    }, box);
    await expect(page.locator("[data-row]")).toHaveCount(1);
    const undo = page.getByRole("button", { name: "Annuler" });
    await expect(undo).toBeVisible();
    await undo.click();
    await expect(page.locator("[data-row]")).toHaveCount(2);
    // Un petit glissement ne retire rien (la ligne revient).
    await row.evaluate((el, b) => {
      const y = b.y + b.height / 2;
      const fire = (type: string, x: number) =>
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 8, pointerType: "touch", isPrimary: true, clientX: x, clientY: y }));
      fire("pointerdown", b.x + b.width - 10);
      fire("pointermove", b.x + b.width - 40);
      fire("pointerup", b.x + b.width - 40);
    }, box);
    await expect(page.locator("[data-row]")).toHaveCount(2);
  });

  test("destinataire : ouverture et contenu sans onglets, Déverrouiller en bas, champ ≥ 16 px", async ({ page, shh, browser }) => {
    test.setTimeout(90_000);
    const { ctx, page: sender } = await freshPage(browser);
    const s = await sendShare(sender, shh.origin + "/", { text: "Le code de la porte est 4471." });
    await ctx.close();
    await page.goto(s.link);
    await expect(pwField(page)).toBeVisible();
    await expect(tabbar(page)).toHaveCount(0);
    // Sans onglets : la langue reste accessible dans le pied de page.
    await expect(page.getByRole("banner").getByRole("button", { name: "Réglages" })).toHaveCount(0);
    await switchLang(page, "English");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await switchLang(page, "Français");
    await page.evaluate(() => scrollTo(0, 0));
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

  test("pas de barre d'onglets ; ni engrenage ni Réglages : langue et À propos dans le pied", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    await expect(tabbar(page)).toBeHidden();
    await expect(foot(page)).toBeVisible();
    // En-tête : ni sélecteur de langue ni entrée Réglages (retours du 11 novembre).
    const banner = page.getByRole("banner");
    await expect(banner.getByRole("button")).toHaveCount(0);
    for (const n of ["Langue", "Fichiers", "À propos"]) await expect(foot(page).getByText(n, { exact: true })).toBeAttached();
    await expect(footLink(page, "Sécurité")).toBeVisible();
    await expect(footLink(page, "Confidentialité")).toBeVisible();
    await switchLang(page, "English");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await switchLang(page, "Français");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  });
});
