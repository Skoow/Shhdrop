import { axe, capture, expect, test } from "./fixtures";

test("l'accueil se charge sous la CSP, sans violation ni requête tierce", async ({ page, shh }) => {
  const res = await page.goto(shh.origin + "/");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Shhdrop" })).toBeVisible();
  const csp = res?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(await axe(page)).toEqual([]);
  await capture(page, "accueil");
});

for (const p of ["/s/x", "/m/x"]) {
  test(`${p} sert l'application`, async ({ page, shh }) => {
    const res = await page.goto(shh.origin + p);
    expect(res?.status()).toBe(200);
    expect(res?.headers()["x-robots-tag"]).toBe("noindex");
    await expect(page.getByRole("heading", { name: "Shhdrop" })).toBeVisible();
  });
}

test("robots.txt interdit /s/ et /m/", async ({ request, shh }) => {
  const res = await request.get(shh.origin + "/robots.txt");
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain("Disallow: /s/");
  expect(body).toContain("Disallow: /m/");
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
