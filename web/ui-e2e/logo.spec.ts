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

test("en-tête : le logo est une image nommée « Shhgone », dans le lien d'accueil", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  const logo = page.locator("header").getByRole("img", { name: "Shhgone" });
  await expect(logo).toBeVisible();
  await expect(page.locator("header a").first().locator("svg[role='img']")).toHaveAttribute("aria-label", "Shhgone");
});

test("logo : statique à l'arrivée, aucune animation en cours, nom accessible « Shhgone »", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  const logo = page.locator("header svg[role='img']");
  await expect(logo).toHaveAttribute("aria-label", "Shhgone");
  expect(await logoAnimations(page)).toBe(0);
  await expect(logo.locator(".head")).toHaveCount(1);
  await expect(logo.locator(".dots")).toHaveCount(6);
  await expect(logo.locator("mask, .finger, .wave")).toHaveCount(0);
  expect(await logo.locator(".dots").evaluateAll((es) => es.map((e) => getComputedStyle(e).opacity))).toEqual(Array(6).fill("1"));
});

test("logo : l'élément LCP de l'accueil n'est pas le logo", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  await page.waitForTimeout(2500);
  const lcp = await page.evaluate(
    () =>
      new Promise<string>((resolve) =>
        new PerformanceObserver((list) => {
          const e = list.getEntries().at(-1) as PerformanceEntry & { element: Element | null };
          resolve(e.element ? (e.element.closest("header") ? "header" : e.element.tagName) : "none");
        }).observe({ type: "largest-contentful-paint", buffered: true }),
      ),
  );
  expect(lcp).not.toBe("header");
});

test("logo : aucune animation en mouvement réduit", async ({ page, shh }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(shh.origin + "/");
  const logo = page.locator("header").getByRole("img", { name: "Shhgone" });
  await expect(logo).toBeVisible();
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
