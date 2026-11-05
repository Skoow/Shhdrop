// Logo « Trame » (scripts/gen-logo.mjs) et icônes du site, servis par le serveur Go.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const logoAnimations = (page: Page) =>
  page.evaluate(() => {
    const logo = document.querySelector("header svg[role='img']");
    return document
      .getAnimations()
      .filter((a) => a.playState === "running" && logo?.contains((a.effect as KeyframeEffect | null)?.target ?? null)).length;
  });

test("en-tête : le logo est une image nommée « Shhdrop », dans le lien d'accueil", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  const logo = page.locator("header").getByRole("img", { name: "Shhdrop" });
  await expect(logo).toBeVisible();
  await expect(page.locator("header a").first().locator("svg[role='img']")).toHaveAttribute("aria-label", "Shhdrop");
});

test("logo : l'introduction se joue sur l'accueil ; aucune animation en mouvement réduit", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  expect(await logoAnimations(page)).toBeGreaterThan(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(shh.origin + "/");
  await expect(page.locator("header").getByRole("img", { name: "Shhdrop" })).toBeVisible();
  expect(await logoAnimations(page)).toBe(0);
});

test("icônes : liens présents dans <head>, fichiers servis (200, bon type)", async ({ page, request, shh }) => {
  await page.goto(shh.origin + "/");
  const links = await page.$$eval("link[rel~='icon'], link[rel='apple-touch-icon']", (ls) =>
    ls.map((l) => (l as HTMLLinkElement).getAttribute("href")!),
  );
  expect(links.sort()).toEqual(["/apple-touch-icon.png", "/favicon.ico", "/favicon.svg"]);
  const types: Record<string, RegExp> = {
    "/favicon.svg": /^image\/svg\+xml/,
    "/favicon.ico": /^image\/(x-icon|vnd\.microsoft\.icon)/,
    "/apple-touch-icon.png": /^image\/png/,
    "/icon-192.png": /^image\/png/,
    "/icon-512.png": /^image\/png/,
    "/logo.svg": /^image\/svg\+xml/,
  };
  for (const [p, type] of Object.entries(types)) {
    const res = await request.get(shh.origin + p);
    expect(res.status(), p).toBe(200);
    expect(res.headers()["content-type"], p).toMatch(type);
  }
});
