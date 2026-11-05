// Démo GitHub Pages (UI §14.3), servie comme par Pages (pages-server.ts : /Shhdrop/, 404.html,
// aucun en-tête). Gardes de la fixture `demo` : zéro violation de la CSP meta, zéro requête hors
// de l'origine, aucune requête /api sur le réseau (le faux serveur est dans la page).
// Les tâches suivantes ajoutent leur parcours à ce fichier.
import type { Page } from "@playwright/test";
import { axe, capture, expect, test } from "./fixtures";

const BANNER_FR = "Démo : rien n'est envoyé, le lien ne marche que dans cet onglet.";
const BANNER_EN = "Demo: nothing is sent, the link only works in this tab.";
const TITLE_FR = "Un lien, un mot de passe, puis plus rien.";

const ID = Buffer.from(Uint8Array.from({ length: 16 }, (_, i) => i * 11 + 3)).toString("base64url");
const KEY = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => 200 - i * 5)).toString("base64url");

const storage = (page: Page) => page.evaluate(() => localStorage.length + sessionStorage.length);

test.describe("fr-FR", () => {
  test.use({ locale: "fr-FR" });

  test("/Shhdrop/ : accueil, bandeau permanent, titre « Démo · », CSP meta en tête ; axe ; captures", async ({ page, demo }) => {
    const res = await page.goto(demo.url);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: TITLE_FR })).toBeVisible();
    const banner = page.getByRole("note");
    await expect(banner).toHaveText(BANNER_FR);
    await expect(banner).toBeVisible();
    // Tout en haut de la page, avant l'en-tête, sans bouton de fermeture.
    expect((await banner.boundingBox())!.y).toBe(0);
    await expect(banner.getByRole("button")).toHaveCount(0);
    await expect(page).toHaveTitle(/^Démo · /);

    const head = await page.evaluate(() =>
      [...document.head.children].slice(0, 3).map((e) => e.outerHTML),
    );
    expect(head[0]).toMatch(/^<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval';/);
    expect(head[1]).toBe('<meta name="referrer" content="no-referrer">');
    expect(head[2]).toBe('<meta name="robots" content="noindex">');
    expect(await storage(page)).toBe(0);
    expect(await axe(page)).toEqual([]);
    await page.waitForTimeout(700); // tracé du schéma
    await capture(page, "demo-home");

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(100);
    await capture(page, "demo-home-1280");
  });

  test("liens internes sous la base : « Comment ça marche » → /Shhdrop/securite, logo → /Shhdrop/", async ({ page, demo }) => {
    await page.goto(demo.url);
    await page.getByRole("link", { name: "Comment ça marche" }).click();
    await expect(page).toHaveURL(`${demo.url}securite`);
    await expect(page.getByRole("note")).toHaveText(BANNER_FR); // sur toutes les pages
    await page.getByRole("link", { name: "Shhdrop, accueil" }).click();
    await expect(page).toHaveURL(demo.url);
    await expect(page.getByRole("heading", { level: 1, name: TITLE_FR })).toBeVisible();
  });

  for (const [what, key] of [
    ["« #x »", "x"],
    ["clé de 43 caractères", KEY],
  ] as const) {
    test(`adresse profonde /Shhdrop/s/… (404.html) : route d'ouverture, ${what} retiré, jamais envoyé`, async ({ page, demo }) => {
      const id = key === "x" ? "abc" : ID;
      const res = await page.goto(`${demo.url}s/${id}#${key}`);
      expect(res?.status()).toBe(404); // Pages : pas de repli monopage, 404.html avec le code 404
      await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
      expect(page.url()).toBe(`${demo.url}s/${id}`);
      // Route d'ouverture (match → open), pas « Cette page n'existe pas ».
      await expect(page.getByRole("heading", { level: 1, name: "Shhdrop" })).toBeVisible();
      await expect(page.getByText("Cette page n'existe pas.")).toHaveCount(0);
      await expect(page.getByRole("note")).toHaveText(BANNER_FR);
      // Le fragment n'est dans aucune requête (adresse, en-têtes, corps) ni dans l'historique.
      const sent = demo.requests.map((r) => `${r.url} ${JSON.stringify(r.headers)} ${r.postData ?? ""}`);
      expect(sent.length).toBeGreaterThan(0);
      for (const s of sent) expect(s).not.toContain(`#${key}`);
      if (key !== "x") for (const s of sent) expect(s).not.toContain(key);
      expect(demo.requests.every((r) => !("referer" in r.headers) || !r.headers.referer!.includes("#"))).toBe(true);
      await page.goto(demo.url);
      await page.goBack();
      await expect.poll(() => page.evaluate(() => location.href)).toBe(`${demo.url}s/${id}`);
      expect(await storage(page)).toBe(0);
    });
  }

  test("chemin inconnu sous la base : « Cette page n'existe pas. », # retiré", async ({ page, demo }) => {
    const res = await page.goto(`${demo.url}nulle-part#${KEY}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Cette page n'existe pas." })).toBeVisible();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  });

  test("faux serveur dans la page : fetch et XHR /api détournés, autres requêtes sur le réseau", async ({ page, demo }) => {
    await page.goto(demo.url);
    const r = await page.evaluate(async () => {
      const cap = await (await fetch("/api/captcha")).json();
      const nope = await fetch("/api/shares/x/status");
      const site = await fetch("robots.txt");
      const xhr = await new Promise<number>((resolve) => {
        const x = new XMLHttpRequest();
        x.open("PUT", `${location.origin}/api/shares/x/segments/0`);
        x.setRequestHeader("Authorization", "Bearer t");
        x.onload = () => resolve(x.status);
        x.onerror = () => resolve(-1);
        x.send(new Uint8Array(10));
      });
      return { cap, nope: nope.status, site: site.status, xhr };
    });
    expect(r.cap).toMatchObject({ algorithm: "SHA-256", fallback: null });
    expect(typeof r.cap.shown_at).toBe("string");
    expect(r.nope).toBe(400); // pas d'en-tête X-Shh-Manage : même code que le vrai serveur
    expect(r.site).toBe(200);
    expect(r.xhr).toBe(404); // jeton inconnu
    expect(demo.requests.map((q) => new URL(q.url).pathname)).toContain("/Shhdrop/robots.txt");
  });
});

test.describe("en-US", () => {
  test.use({ locale: "en-US" });

  test("bandeau en anglais ; capture", async ({ page, demo }) => {
    await page.goto(demo.url);
    await expect(page.getByRole("note")).toHaveText(BANNER_EN);
    await page.waitForTimeout(700);
    await capture(page, "demo-home-en");
  });
});
