// Refonte de l'accueil (UI §25, 12 novembre) : barre du haut et ses menus au clavier, bouton
// « Choisir des fichiers » qui ouvre le sélecteur du composeur, premier écran, infographie
// (pause, survol, hors écran, mouvement réduit), bande des engagements, accessibilité.
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { axe, expect, test } from "./fixtures";
import { file } from "./open-helpers";

test.use({ locale: "fr-FR" });

const step = (page: Page) => page.locator("[data-demo]").getAttribute("data-step");
const inView = (page: Page, sel: string) =>
  page.locator(sel).first().evaluate((e) => {
    const r = e.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && r.width > 0;
  });

test("premier écran : « Choisir des fichiers » visible ; ordinateur : le haut de la carte de dépôt aussi", async ({ page, shh, isMobile }) => {
  await page.goto(shh.origin + "/");
  await expect(page.getByRole("button", { name: "Choisir des fichiers" })).toBeVisible();
  expect(await inView(page, "[data-pick]")).toBe(true);
  if (!isMobile) {
    const top = await page.locator('[data-slot="compose"]').evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBeLessThan(900 - 40);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("« Choisir des fichiers » ouvre directement le sélecteur ; les fichiers vont au composeur", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choisir des fichiers" }).click();
  const fc = await chooser;
  expect(fc.isMultiple()).toBe(true);
  await fc.setFiles({ name: "foret-brume.jpg", mimeType: "image/jpeg", buffer: readFileSync(file("foret-brume.jpg")) });
  await expect(page.locator("[data-row]").filter({ hasText: "foret-brume" }).first()).toBeVisible();
  await expect(page).toHaveURL(shh.origin + "/");
});

test.describe("barre du haut (ordinateur)", () => {
  test.skip(({ isMobile }) => isMobile, "téléphone : barre d'onglets");

  test("menus au clavier : Entrée, flèches, Échap ; focus visible ; un seul ouvert ; clic extérieur ; axe", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    const share = page.getByRole("navigation", { name: "Menu principal" }).getByRole("button", { name: "Partager" });
    const sec = page.getByRole("button", { name: "Sécurité" });
    await share.focus();
    await page.keyboard.press("Enter");
    await expect(share).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowDown");
    const first = page.getByRole("button", { name: /^Fichiers / });
    await expect(first).toBeFocused();
    expect(await first.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe("none");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("button", { name: /^Note / })).toBeFocused();
    expect(await axe(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(share).toHaveAttribute("aria-expanded", "false");
    await expect(share).toBeFocused();
    await share.click();
    await sec.click();
    await expect(share).toHaveAttribute("aria-expanded", "false");
    await expect(sec).toHaveAttribute("aria-expanded", "true");
    await page.mouse.click(700, 860);
    await expect(sec).toHaveAttribute("aria-expanded", "false");
    // Tab hors du menu : fermé.
    await sec.focus();
    await page.keyboard.press("ArrowUp");
    await expect(page.locator("[data-nav-item]").filter({ hasText: "Signaler un abus" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(sec).toHaveAttribute("aria-expanded", "false");
  });

  test("Partager › Note ouvre l'éditeur ; Sécurité › Ce que voit le serveur ouvre la question ; Offres", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    await page.getByRole("navigation", { name: "Menu principal" }).getByRole("button", { name: "Partager" }).click();
    await page.getByRole("button", { name: /^Note / }).click();
    await expect(page.getByRole("dialog", { name: "Nouveau texte" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Sécurité" }).click();
    await page.locator("[data-nav-item]").filter({ hasText: "Ce que voit le serveur" }).click();
    await expect(page.locator("#faq-server")).toHaveAttribute("open", "");
    await expect(page.locator("#faq-server summary")).toBeFocused();
    await page.getByRole("link", { name: "Offres", exact: true }).click();
    await expect(page).toHaveURL(shh.origin + "/offres");
    // Ailleurs que sur l'accueil : « Partager › Fichiers » mène à la page d'envoi.
    await page.getByRole("navigation", { name: "Menu principal" }).getByRole("button", { name: "Partager" }).click();
    await page.getByRole("button", { name: /^Note / }).click();
    await expect(page).toHaveURL(shh.origin + "/envoyer");
    await expect(page.getByRole("dialog", { name: "Nouveau texte" })).toBeVisible();
  });
});

test("infographie : la boucle avance, le bouton pause l'arrête, le survol aussi ; hors écran, arrêtée", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  const demo = page.locator("[data-demo]");
  await demo.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  const s0 = await step(page);
  await expect.poll(() => step(page), { timeout: 5000 }).not.toBe(s0);
  await page.locator("[data-demo-toggle]").click();
  await expect(page.locator("[data-demo-toggle]")).toHaveAttribute("aria-label", "Lire l'animation");
  await page.mouse.move(1, 1);
  const frozen = await step(page);
  await page.waitForTimeout(2600);
  expect(await step(page)).toBe(frozen);
  await page.locator("[data-demo-toggle]").click();
  await page.mouse.move(1, 1);
  await expect.poll(() => step(page), { timeout: 5000 }).not.toBe(frozen);
  // Survol de la scène : arrêt.
  await page.locator("[data-demo-view]").hover();
  const held = await step(page);
  await page.waitForTimeout(2600);
  expect(await step(page)).toBe(held);
  // Hors écran : arrêt.
  await page.mouse.move(1, 1);
  await page.locator("footer[data-foot]").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const away = await step(page);
  await page.waitForTimeout(2600);
  expect(await step(page)).toBe(away);
  expect(await demo.evaluate((e) => e.classList.contains("paused"))).toBe(true);
});

test("mouvement réduit : storyboard statique, bande immobile, aucune animation dans l'infographie ni la bande", async ({ page, shh }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(shh.origin + "/");
  const demo = page.locator("[data-demo]");
  await expect(demo).toHaveClass(/board/);
  await expect(page.locator("[data-demo-steps] li")).toHaveCount(7);
  await expect(page.locator("[data-demo-steps] li").first()).toBeVisible();
  await expect(page.locator("[data-band]")).toHaveClass(/still/);
  await page.waitForTimeout(2200);
  const running = await page.evaluate(
    () => document.getAnimations().filter((a) => a.playState === "running" && ((a.effect as KeyframeEffect).target as Element | null)?.closest("[data-demo], [data-band]")).length,
  );
  expect(running).toBe(0);
  expect(await axe(page)).toEqual([]);
});

test("bande des engagements : promesses vraies, bouton d'arrêt", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  const band = page.locator("[data-band]");
  await expect(band.getByRole("listitem")).toHaveCount(6);
  await band.getByRole("button", { name: "Arrêter le défilement" }).click();
  await expect(band).toHaveClass(/stopped/);
  const t = await band.locator(".track").evaluate((e) => e.getAnimations().map((a) => a.playState));
  expect(t).toEqual(["paused"]);
});

test("rien n'a l'air d'une commande sans en être une : tout ce qui montre une main est un lien, un bouton ou une question", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  const bad = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).cursor === "pointer")
      .filter((e) => !e.closest("a[href], button, summary, label, input, [role=button], [role=switch], [role=radio]"))
      .map((e) => `${e.tagName}.${e.className}`),
  );
  expect(bad).toEqual([]);
  // Aucune rangée de pastilles ou de tirets façon carrousel : l'infographie dit son étape par son journal.
  await expect(page.locator("[data-demo] .dots")).toHaveCount(0);
});
