// Démo (Pages) : icônes du site servies sous la base, logo nommé (scripts/gen-logo.mjs).
import { expect, test } from "./fixtures";

test("démo : liens d'icônes sous la base /shhdrop/, fichiers servis (200)", async ({ page, request, demo }) => {
  await page.goto(demo.url);
  const links = await page.$$eval("link[rel~='icon'], link[rel='apple-touch-icon']", (ls) =>
    ls.map((l) => (l as HTMLLinkElement).getAttribute("href")!),
  );
  expect(links.sort()).toEqual(["/shhdrop/apple-touch-icon.png", "/shhdrop/favicon.ico", "/shhdrop/favicon.svg"]);
  for (const p of [...links, "/shhdrop/icon-192.png", "/shhdrop/icon-512.png"]) {
    const res = await request.get(demo.origin + p);
    expect(res.status(), p).toBe(200);
  }
  await expect(page.locator("header").getByRole("img", { name: "Shhdrop" })).toBeVisible();
});
