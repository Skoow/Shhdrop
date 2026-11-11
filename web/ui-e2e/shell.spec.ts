import { axe, capture, expect, test } from "./fixtures";

test("l'accueil se charge sous la CSP, sans violation ni requête tierce", async ({ page, shh }) => {
  const res = await page.goto(shh.origin + "/");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const csp = res?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(await axe(page)).toEqual([]);
  await capture(page, "accueil");
});

// Spec §32 : les liens sont à la racine ; /s/ et /m/ ne sont plus des routes (404 de
// l'interface), et X-Robots-Tag a disparu.
for (const p of ["/s/x", "/m/x"]) {
  test(`${p} : 404 de l'interface, sans X-Robots-Tag`, async ({ page, shh }) => {
    const res = await page.goto(shh.origin + p);
    expect(res?.status()).toBe(404); // vrai statut (audit de performance, point 5)
    expect(res?.headers()["x-robots-tag"]).toBeUndefined();
    await expect(page.getByRole("heading", { name: /^(Cette page n'existe pas\.|This page does not exist\.)$/ })).toBeVisible();
  });
}

test.describe("fr-FR", () => {
  test.use({ locale: "fr-FR" });
test("pied de page (UI5) : Produit, Confiance, Légal ; langue, nettoyage, À propos ; sans traceur ; © ; version du build ; visible en bas de l'accueil, téléphone compris", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  const foot = page.locator("footer[data-foot]");
  await foot.scrollIntoViewIfNeeded();
  await expect(foot).toBeVisible();
  for (const c of ["Produit", "Confiance", "Légal"]) await expect(foot.getByText(c, { exact: true })).toBeVisible();
  for (const l of ["Envoyer", "Offres Plus et Pro", "Sécurité", "Confidentialité", "Code source sur GitHub", "Signaler un abus", "Conditions d'utilisation", "Mentions légales", "Licence AGPL-3.0"])
    await expect(foot.getByRole("link", { name: new RegExp(`^${l}`) })).toBeVisible();
  // 9 liens, plus le logo (retour à l'accueil, UI7).
  await expect(foot.getByRole("link")).toHaveCount(10);
  await expect(foot.getByRole("link", { name: "Shhdrop, accueil" })).toBeVisible();
  await expect(foot.getByText(/^Salon\s+bientôt$/)).toBeVisible(); // pas un lien
  await expect(foot.getByRole("link", { name: /^Code source/ })).toHaveAttribute("href", "https://github.com/Skoow/shhdrop");
  await expect(foot.getByRole("link", { name: /^Code source/ })).toHaveAttribute("rel", "noopener noreferrer");
  // Retours UI9 : plus de mention « aucune publicité » ; le nom en bas à gauche, « © 2026 » à côté.
  await expect(foot.getByText(/publicité/)).toHaveCount(0);
  await expect(foot.locator(".base .sig")).toHaveText(/^Shhdrop\s*©\s2026$/);
  await expect(foot.locator("[data-build]")).toHaveText(/^Version ([0-9a-f]{7}|dev)$/);
  // Langue : boutons du pied (pas de liste déroulante), nettoyage automatique, À propos.
  await expect(foot.getByRole("combobox")).toHaveCount(0);
  await expect(foot.getByRole("group", { name: "Langue" }).getByRole("button")).toHaveText(["Français", "English"]);
  await expect(foot.getByRole("switch", { name: "Nettoyage automatique" })).toBeVisible();
  await expect(foot.getByText("Shhdrop chiffre sur votre appareil avant l'envoi.", { exact: false })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600); // fin des apparitions au défilement
  expect(await axe(page)).toEqual([]);
});
});

test("référencement : robots.txt et sitemap.xml ; pages publiques indexées, pages privées « noindex »", async ({ page, request, shh }) => {
  const robots = await request.get(shh.origin + "/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("Sitemap: https://shhdrop.app/sitemap.xml");
  const map = await request.get(shh.origin + "/sitemap.xml");
  expect(map.status()).toBe(200);
  expect(map.headers()["content-type"]).toMatch(/xml/);
  const locs = [...(await map.text()).matchAll(/<loc>https:\/\/shhdrop\.app([^<]*)<\/loc>/g)].map((m) => m[1]);
  expect(locs).toEqual(["/", "/securite", "/confidentialite", "/offres", "/conditions", "/mentions-legales"]);
  const meta = (n: string) => page.locator(`meta[name="${n}"]`);
  for (const p of locs) {
    await page.goto(shh.origin + p);
    await expect(meta("robots"), p).toHaveAttribute("content", "index, follow");
    await expect(page.locator('link[rel="canonical"]'), p).toHaveAttribute("href", shh.origin + p);
    expect((await meta("description").getAttribute("content"))!.length, p).toBeGreaterThan(40);
  }
  for (const p of ["/envoyer", "/signaler", "/inconnu"]) {
    await page.goto(shh.origin + p);
    await expect(meta("robots"), p).toHaveAttribute("content", "noindex");
    await expect(page.locator('link[rel="canonical"]'), p).toHaveCount(0);
  }
  // Un partage ouvert (« /#clé ») n'est jamais indexé, et la canonique ne garde aucun fragment.
  await page.goto(shh.origin + "/#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  await expect(meta("robots")).toHaveAttribute("content", "noindex");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});

test("translate=no et meta notranslate", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  await expect(page.locator("html")).toHaveAttribute("translate", "no");
  await expect(page.locator('meta[name="google"]')).toHaveAttribute("content", "notranslate");
});

test("les gardes enregistrent une requête tierce et une violation CSP", async ({ page, shh }) => {
  // Preuve que les gardes de fin de test fonctionnent ; on les vide ensuite pour ne pas échouer.
  await page.goto(shh.origin + "/");
  await page.evaluate(() => void fetch("http://127.0.0.1:1/x").catch(() => {}));
  await expect.poll(() => shh.cspViolations.length).toBeGreaterThan(0);
  // Navigation du cadre principal vers une origine tierce, servie par route() : aucun réseau,
  // même comportement dans tous les moteurs (WebKit attend longtemps un port fermé).
  await page.route("http://tiers.invalid/**", (r) => r.fulfill({ contentType: "text/html", body: "<title>t</title>" }));
  await page.goto("http://tiers.invalid/");
  expect(shh.foreignRequests).toContain("http://tiers.invalid/");
  shh.cspViolations.length = 0;
  shh.foreignRequests.length = 0;
});

test("capture() n'avale pas une vraie violation CSP", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  // Violation réelle de la page avant la capture, puis capture : elle doit rester enregistrée.
  await page.evaluate(() => void fetch("http://127.0.0.1:1/x").catch(() => {}));
  await expect.poll(() => shh.cspViolations.length).toBeGreaterThan(0);
  await capture(page, "garde-violation");
  expect(shh.cspViolations.some((v) => v.includes("connect-src"))).toBe(true);
  shh.cspViolations.length = 0;
  // Style en ligne de la page, après la capture : refusé et enregistré (hors fenêtre de capture).
  await page.evaluate(() => {
    const st = document.createElement("style");
    st.textContent = "body{color:red}";
    document.head.append(st);
  });
  await expect.poll(() => shh.cspViolations.length).toBeGreaterThan(0);
  shh.cspViolations.length = 0;
});

test("vitesse : JS et CSS servis compressés (brotli) ; fichiers à empreinte en cache un an, page jamais en cache", async ({ page, shh, browserName }) => {
  const seen: { url: string; enc: string; cache: string }[] = [];
  page.on("response", async (r) => {
    if (/\/assets\/index-[^/]+\.(js|css)$/.test(r.url())) {
      const h = await r.allHeaders();
      seen.push({ url: r.url(), enc: h["content-encoding"] ?? "", cache: h["cache-control"] ?? "" });
    }
  });
  const doc = await page.goto(shh.origin + "/");
  expect((await doc!.allHeaders())["cache-control"]).toBe("no-store");
  // L'application démarre : le JS compressé a été décodé et exécuté.
  await expect(page.locator("main h1").first()).toBeVisible();
  expect(seen.map((s) => s.url.split(".").pop()).sort()).toEqual(["css", "js"]);
  for (const s of seen) {
    // WebKit sous Linux n'annonce brotli qu'en HTTPS : en HTTP (serveur de test), il reçoit la
    // variante gzip, précompressée elle aussi (CI du 10 novembre). Les autres reçoivent brotli.
    expect(s.enc, s.url).toBe(browserName === "webkit" ? "gzip" : "br");
    // Le nom porte l'empreinte du contenu, et index.html (jamais en cache) fixe ce nom et son
    // empreinte SRI : un fichier en cache ne peut pas être une autre version (10 novembre).
    expect(s.cache, s.url).toBe("public, max-age=31536000, immutable");
  }
});
