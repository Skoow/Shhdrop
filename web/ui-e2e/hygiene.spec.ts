// Hygiène du lien (UI §12.1), navigateur intégré (S4), navigateur non pris en charge (UI §9.11),
// dépôt de fichier neutralisé hors du composeur (UI §9.2.2).
import type { Page } from "@playwright/test";
import { axe, capture, expect, test } from "./fixtures";

const KEY = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => 255 - i * 3)).toString("base64url");
const KEY2 = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => i * 5)).toString("base64url");

const INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 307.0.0.34.111 (iPhone15,3; iOS 17_1; fr_FR; fr; scale=3.00; 1290x2796; 532277534)";

/** Requêtes vers /api/ (aucune ne doit partir dans ces tests : il n'y a encore aucun écran qui en fasse). */
function apiRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) urls.push(r.url());
  });
  return urls;
}

/** Toutes les requêtes de la page, en-têtes compris : aucune ne doit porter la clé (spec §32). */
function allRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r) => {
    seen.push(`${r.method()} ${r.url()} ${JSON.stringify(r.headers())} ${r.postData() ?? ""}`);
  });
  return seen;
}

test.use({ locale: "fr-FR" });

const hash = (page: Page) => page.evaluate(() => location.hash);

// Spec §32 : lien court à la racine, « /#<clé> » (partage) ou « /#m<clé> » (gestion).
for (const [kind, frag] of [
  ["partage", `#${KEY}`],
  ["gestion", `#m${KEY}`],
] as const) {
  test(`/${frag.slice(0, 2)}… (${kind}) : le # est retiré de l'adresse et de l'historique, jamais envoyé`, async ({ page, shh }) => {
    const api = apiRequests(page);
    const all = allRequests(page);
    await page.goto(`${shh.origin}/${frag}`);
    await expect.poll(() => hash(page)).toBe("");
    expect(page.url()).toBe(`${shh.origin}/`);

    // Retour / Avant : aucune entrée d'historique ne réaffiche le #.
    await page.getByRole("link", { name: "Sécurité", exact: true }).click();
    await expect(page).toHaveURL(`${shh.origin}/securite`);
    await page.goBack();
    await expect(page).toHaveURL(`${shh.origin}/`);
    expect(await hash(page)).toBe("");
    await page.goForward();
    await page.goBack();
    expect(page.url()).not.toContain("#");
    // Rechargement : rien ne revient.
    await page.reload();
    expect(page.url()).toBe(`${shh.origin}/`);
    expect(await page.content()).not.toContain(KEY);
    expect(api).toEqual([]);
    // La partie après « # » n'est jamais envoyée au serveur (adresse, en-têtes, corps).
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) expect(r).not.toContain(KEY);
  });
}

test("# collé dans la barre sur la même page (navigation de fragment) : retiré aussi", async ({ page, shh }) => {
  await page.goto(`${shh.origin}/#${KEY}`);
  await expect.poll(() => hash(page)).toBe("");
  await page.evaluate((k) => (location.hash = k), KEY2);
  await expect.poll(() => hash(page)).toBe("");
  await page.evaluate((k) => (location.hash = `m${k}`), KEY2);
  await expect.poll(() => hash(page)).toBe("");
  await page.goBack();
  expect(page.url()).not.toContain("#");
});

test.describe("navigateur intégré (Instagram)", () => {
  test.use({ userAgent: INSTAGRAM });

  test("le # est gardé (pour « Ouvrir dans le navigateur »), aucune requête /api/", async ({ page, shh }) => {
    const api = apiRequests(page);
    await page.goto(`${shh.origin}/#${KEY}`);
    await expect(page.locator("main#contenu")).toBeVisible();
    await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
    expect(await hash(page)).toBe(`#${KEY}`);
    expect(api).toEqual([]);
  });
});

test.describe("navigateur sans crypto.subtle", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Crypto.prototype, "subtle", { get: () => undefined, configurable: true });
    });
  });

  test("« non pris en charge », aucune route ne démarre, aucune requête /api/", async ({ page, shh }) => {
    const api = apiRequests(page);
    await page.goto(`${shh.origin}/#${KEY}`);
    await expect(
      page.getByRole("heading", { name: "Ce navigateur ne permet pas de chiffrer en sécurité.", exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Shhdrop", exact: true })).toHaveCount(0);
    // Le lien reste dans la barre : la personne peut le recopier dans un autre navigateur.
    expect(await hash(page)).toBe(`#${KEY}`);
    expect(api).toEqual([]);
    expect(await axe(page)).toEqual([]);
    await capture(page, "non-pris-en-charge");
  });
});

test("fichier déposé sur /s/x : défaut empêché, l'adresse ne change pas", async ({ page, shh }) => {
  await page.goto(`${shh.origin}/s/x`);
  await expect(page.locator("main#contenu")).toBeVisible();
  const url = page.url();

  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File(["bonjour"], "a.txt", { type: "text/plain" }));
    return d;
  });
  await page.dispatchEvent("main#contenu", "dragover", { dataTransfer: dt });
  await page.dispatchEvent("main#contenu", "drop", { dataTransfer: dt });

  const prevented = await page.evaluate(() => {
    const d = new DataTransfer();
    d.items.add(new File(["bonjour"], "a.txt", { type: "text/plain" }));
    return (["dragover", "drop"] as const).map((type) => {
      const e = new DragEvent(type, { dataTransfer: d, bubbles: true, cancelable: true });
      document.querySelector("main")!.dispatchEvent(e);
      return e.defaultPrevented;
    });
  });
  expect(prevented).toEqual([true, true]);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  expect(page.url()).toBe(url);
});

// I1 : liens abîmés (ponctuation ajoutée par une messagerie, autre chemin, ancien format
// /s/{id}, majuscule) : le routeur les classe en accueil ou en 404, le « # » est retiré quand même.
for (const [what, path, frag] of [
  ["point collé", "/", `#${KEY}.`],
  ["parenthèse collée", "/", `#${KEY})`],
  ["clé tronquée", "/", `#${KEY.slice(1)}`],
  ["préfixe M majuscule", "/", `#M${KEY}`],
  ["ancien format /s/{id}", "/s/AAAAAAAAAAAAAAAAAAAAAA", `#${KEY}`],
  ["/S/ majuscule", "/S/x", `#${KEY}`],
  ["route inconnue", "/inconnu", `#${KEY}`],
  ["page fixe", "/securite", `#${KEY}`],
] as const) {
  test(`${path}#… (${what}) : le # est retiré sur toute route, Retour ne le rend pas`, async ({ page, shh }) => {
    await page.goto(`${shh.origin}${path}${frag}`);
    await expect.poll(() => hash(page)).toBe("");
    expect(page.url()).toBe(`${shh.origin}${path}`);
    await page.getByRole("link", { name: "Sécurité", exact: true }).click();
    await expect(page).toHaveURL(`${shh.origin}/securite`);
    await page.goBack();
    await expect(page).toHaveURL(`${shh.origin}${path}`);
    expect(await hash(page)).toBe("");
  });
}

// Spec §32 : X-Robots-Tag et le repli particulier de /s/ et /m/ ont disparu.
test("/ : pas de X-Robots-Tag ; /s/<id>. (ancien lien abîmé) → 404 du serveur", async ({ page, shh }) => {
  const res = await page.goto(`${shh.origin}/#${KEY}`);
  expect(res?.status()).toBe(200);
  expect(res?.headers()["x-robots-tag"]).toBeUndefined();
  const old = await page.request.get(`${shh.origin}/s/AAAAAAAAAAAAAAAAAAAAAA.`);
  expect(old.status()).toBe(404);
});

// I2 : paramètre de suivi ajouté par l'application (Facebook, Messenger, Instagram).
test("/?fbclid=x#<clé> : requête et # retirés, adresse = chemin nu", async ({ page, shh }) => {
  const api = apiRequests(page);
  await page.goto(`${shh.origin}/?fbclid=x#${KEY}`);
  await expect.poll(() => page.url()).toBe(`${shh.origin}/`);
  expect(api).toEqual([]);
});

test.describe("navigateur intégré (Facebook) avec ?fbclid=", () => {
  test.use({ userAgent: INSTAGRAM.replace(/Instagram .*$/, "[FBAN/FBIOS;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/17.1]") });

  test("rien n'est retiré (S4), même avec un fragment invalide ou sur une route 404", async ({ page, shh }) => {
    for (const [path, frag] of [
      ["/?fbclid=x", `#${KEY}`],
      ["/?fbclid=x", `#m${KEY}`],
      ["/", `#${KEY}.`],
      ["/inconnu", `#${KEY}`],
    ] as const) {
      await page.goto(`${shh.origin}${path}${frag}`);
      await expect(page.locator("main#contenu")).toBeVisible();
      await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
      expect(page.url()).toBe(`${shh.origin}${path}${frag}`);
    }
  });
});

// m2 : la hauteur visible réduite de plus de 25 % n'est un clavier qu'avec un pointeur grossier.
test("kbd-open seulement sur écran tactile (pointer: coarse)", async ({ page, shh }) => {
  await page.goto(`${shh.origin}/`);
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  const size = page.viewportSize()!;
  await expect(page.locator("html")).not.toHaveClass(/kbd-open/);
  await page.setViewportSize({ width: size.width, height: Math.floor(size.height * 0.5) });
  if (coarse) await expect(page.locator("html")).toHaveClass(/kbd-open/);
  else {
    await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
    await expect(page.locator("html")).not.toHaveClass(/kbd-open/);
  }
  await page.setViewportSize(size);
  await expect(page.locator("html")).not.toHaveClass(/kbd-open/);
});
