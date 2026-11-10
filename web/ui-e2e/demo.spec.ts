// Démo GitHub Pages (UI §14.3), servie comme par Pages (pages-server.ts : /shhdrop/, 404.html,
// aucun en-tête). Gardes de la fixture `demo` : zéro violation de la CSP meta, zéro requête hors
// de l'origine, aucune requête /api sur le réseau (le faux serveur est dans la page).
// Les tâches suivantes ajoutent leur parcours à ce fichier.
import type { Page } from "@playwright/test";
import { axe, capture, expect, test } from "./fixtures";
import { addFile, addText, readyHeading, sendButton } from "./send-helpers";

const BANNER_FR = "Démo : rien n'est envoyé, le lien ne marche que dans cet onglet.";
const BANNER_EN = "Demo: nothing is sent, the link only works in this tab.";
const TITLE_FR = "Un lien, un mot de passe, puis plus rien.";

const ID = Buffer.from(Uint8Array.from({ length: 16 }, (_, i) => i * 11 + 3)).toString("base64url");
const KEY = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => 200 - i * 5)).toString("base64url");

// Seule entrée admise : l'identifiant d'onglet de la persistance de la démo (demo/persist.ts, exception démo).
const storage = (page: Page) => page.evaluate(() => localStorage.length + Object.keys(sessionStorage).filter((k) => k !== "shh.demo.tab").length);

test.describe("fr-FR", () => {
  test.use({ locale: "fr-FR" });

  test("/shhdrop/ : accueil, bandeau permanent, titre « Démo · », CSP meta en tête ; axe ; captures", async ({ page, demo }) => {
    const res = await page.goto(demo.url);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: TITLE_FR })).toBeVisible();
    const banner = page.getByRole("note");
    await expect(banner).toHaveText(BANNER_FR);
    await expect(banner).toBeVisible();
    // Tout en haut de la page, avant l'en-tête, sans bouton de fermeture.
    expect((await banner.boundingBox())!.y).toBe(0);
    await expect(banner.getByRole("button")).toHaveCount(0);
    await expect(page).toHaveTitle("Démo · Partage chiffré de bout en bout, sans compte · Shhdrop");

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

  // Revue I2 : bandeau collé en haut, en-tête collant juste dessous, sans recouvrement.
  for (const [w, h, size] of [
    [390, 560, "100%"],
    [1280, 560, "100%"],
    [390, 560, "200%"],
    [1280, 560, "200%"],
  ] as const) {
    test(`bandeau collant à ${w} px, texte ${size} : visible après défilement, sans couvrir l'en-tête`, async ({ page, demo }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(demo.url);
      // Propriété CSSOM : permise par style-src 'self' (un attribut style ne le serait pas).
      await page.evaluate((s) => void (document.documentElement.style.fontSize = s), size);
      const banner = page.getByRole("note");
      const header = page.locator("header.top");
      await expect(header).toBeVisible();
      const gap = async () => {
        const b = (await banner.boundingBox())!;
        const t = (await header.boundingBox())!;
        return { b, t, gap: t.y - (b.y + b.height) };
      };
      let m = await gap();
      expect(m.b.y).toBe(0);
      expect(m.gap).toBeGreaterThanOrEqual(-0.5);
      // Défilement : la page doit pouvoir défiler, puis rien ne bouge en haut.
      await page.evaluate(() => window.scrollTo(0, 600));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(20);
      await expect(banner).toBeInViewport({ ratio: 1 });
      m = await gap();
      expect(m.b.y).toBe(0);
      expect(m.t.y).toBeGreaterThanOrEqual(m.b.height - 0.5); // l'en-tête colle sous le bandeau
      expect(m.gap).toBeGreaterThanOrEqual(-0.5);
      expect(m.gap).toBeLessThanOrEqual(1);
      await expect(header).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }

  test("liens internes sous la base : « Tous les détails de sécurité » → /shhdrop/securite, logo → /shhdrop/", async ({ page, demo }) => {
    await page.goto(demo.url);
    await page.getByRole("link", { name: "Tous les détails de sécurité" }).click();
    await expect(page).toHaveURL(`${demo.url}securite`);
    await expect(page.getByRole("note")).toHaveText(BANNER_FR); // sur toutes les pages
    // Téléphone : en-tête natif, « Retour » à la place du logo ; ordinateur : le logo.
    const logo = page.getByRole("link", { name: "Shhdrop, accueil" });
    if (await logo.isVisible()) await logo.click();
    else await page.getByRole("banner").getByRole("button", { name: "Retour" }).click();
    await expect(page).toHaveURL(demo.url);
    await expect(page.getByRole("heading", { level: 1, name: TITLE_FR })).toBeVisible();
  });

  // Spec §32 : liens à la base de la démo, « /shhdrop/#<clé> » et « /shhdrop/#m<clé> » (index.html, 200).
  for (const [what, frag] of [
    ["partage", `#${KEY}`],
    ["gestion", `#m${KEY}`],
  ] as const) {
    test(`lien court /shhdrop/#… (${what}) : route d'ouverture ou de gestion, # retiré, jamais envoyé`, async ({ page, demo }) => {
      const res = await page.goto(`${demo.url}${frag}`);
      expect(res?.status()).toBe(200);
      await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
      expect(page.url()).toBe(demo.url);
      // Route d'ouverture ou de gestion : le faux serveur de cet onglet ne connaît pas ce partage.
      if (what === "partage") {
        await expect(page.getByRole("heading", { level: 1, name: "Ce lien n'existe pas ou n'est plus disponible." })).toBeVisible();
        await expect(page.getByText("(normal en démo : un partage n'existe que dans l'onglet qui l'a créé)")).toBeVisible();
      } else {
        await expect(page.getByRole("heading", { level: 1, name: "Supprimé" })).toBeVisible();
      }
      await expect(page.getByRole("heading", { level: 1, name: TITLE_FR })).toHaveCount(0);
      await expect(page.getByText("Cette page n'existe pas.")).toHaveCount(0);
      await expect(page.getByRole("note")).toHaveText(BANNER_FR);
      // Le fragment n'est dans aucune requête (adresse, en-têtes, corps) ni dans l'historique.
      const sent = demo.requests.map((r) => `${r.url} ${JSON.stringify(r.headers)} ${r.postData ?? ""}`);
      expect(sent.length).toBeGreaterThan(0);
      for (const s of sent) {
        expect(s).not.toContain(KEY);
        expect(s).not.toContain("#");
      }
      expect(demo.requests.every((r) => !("referer" in r.headers) || !r.headers.referer!.includes("#"))).toBe(true);
      await page.goto(`${demo.url}securite`);
      await page.goBack();
      await expect.poll(() => page.evaluate(() => location.href)).toBe(demo.url);
      expect(await storage(page)).toBe(0);
    });
  }

  test("fragment invalide à la base (« #x ») : accueil, # retiré ; ancien lien /shhdrop/s/<id>#… : 404 de l'interface, # retiré", async ({ page, demo }) => {
    await page.goto(`${demo.url}#x`);
    await expect(page.getByRole("heading", { level: 1, name: TITLE_FR })).toBeVisible();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
    const res = await page.goto(`${demo.url}s/${ID}#${KEY}`);
    expect(res?.status()).toBe(404); // Pages : 404.html
    await expect(page.getByRole("heading", { name: "Cette page n'existe pas." })).toBeVisible();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
    for (const r of demo.requests) expect(`${r.url} ${JSON.stringify(r.headers)} ${r.postData ?? ""}`).not.toContain(KEY);
  });

  test("chemin inconnu sous la base : « Cette page n'existe pas. », # retiré", async ({ page, demo }) => {
    const res = await page.goto(`${demo.url}nulle-part#${KEY}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Cette page n'existe pas." })).toBeVisible();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  });

  test("faux serveur dans la page : fetch et XHR /api détournés (aucune requête /api sur le réseau)", async ({ page, demo }) => {
    await page.goto(demo.url);
    const r = await page.evaluate(async () => {
      const cap = await (await fetch("/api/captcha")).json();
      const nope = await fetch("/api/manage/status");
      const xhr = await new Promise<number>((resolve) => {
        const x = new XMLHttpRequest();
        x.open("PUT", `${location.origin}/api/shares/segments/0`);
        x.setRequestHeader("Authorization", "Bearer t");
        x.onload = () => resolve(x.status);
        x.onerror = () => resolve(-1);
        x.send(new Uint8Array(10));
      });
      return { cap, nope: nope.status, xhr };
    });
    expect(r.cap).toMatchObject({ algorithm: "SHA-256", fallback: null });
    expect(typeof r.cap.shown_at).toBe("string");
    expect(r.nope).toBe(400); // pas d'en-tête X-Shh-Manage : même code que le vrai serveur
    expect(r.xhr).toBe(404); // jeton inconnu
  });

  // Défaut fermé (revue m1) : connect-src 'none' dans la CSP meta. Seul le faux serveur répond à
  // /api ; toute autre requête de la page, même origine ou autre origine, est refusée par le
  // navigateur et n'atteint jamais le réseau, secrets d'en-tête compris.
  test("fetch et XHR hors /api : refusés par la CSP, jamais transmis avec un secret", async ({ page, demo }) => {
    const failed = new Map<string, string>();
    page.on("requestfailed", (q) => failed.set(q.url(), q.failure()?.errorText ?? ""));
    const answered: string[] = [];
    page.on("response", (q) => answered.push(q.url()));
    await page.goto(demo.url);
    const SECRET = "secret-de-gestion-0123456789";
    const r = await page.evaluate(async (secret) => {
      const hdr = { "X-Shh-Access": secret, "X-Shh-Manage": secret, Authorization: `Bearer ${secret}` };
      const attempt = (p: Promise<Response>) => p.then((x) => `ok ${x.status}`, () => "refusé");
      const xhr = (url: string) =>
        new Promise<string>((resolve) => {
          const x = new XMLHttpRequest();
          x.open("PUT", url);
          x.setRequestHeader("Authorization", `Bearer ${secret}`);
          x.onload = () => resolve(`ok ${x.status}`);
          x.onerror = () => resolve("refusé");
          x.send(new Uint8Array(4));
        });
      return {
        sameOriginFile: await attempt(fetch("robots.txt", { headers: hdr })),
        sameOriginOther: await attempt(fetch(`${location.origin}/shhdrop/apis/x`, { method: "POST", headers: hdr, body: secret })),
        otherOrigin: await attempt(fetch("https://ailleurs.test/api/shares", { method: "POST", headers: hdr, body: secret })),
        otherOriginXhr: await xhr("https://ailleurs.test/api/shares/x/segments/0"),
        sameOriginXhr: await xhr(`${location.origin}/shhdrop/robots.txt`),
      };
    }, SECRET);
    expect(r).toEqual({
      sameOriginFile: "refusé",
      sameOriginOther: "refusé",
      otherOrigin: "refusé",
      otherOriginXhr: "refusé",
      sameOriginXhr: "refusé",
    });
    // Le navigateur a bien refusé (CSP), rien n'est parti : aucune requête ne porte le secret.
    expect(demo.cspViolations.length).toBeGreaterThan(0);
    // Playwright voit la tentative (événement « request ») avant le refus : toute tentative qui
    // porte le secret doit avoir échoué par la CSP, sans réponse du réseau.
    const carrying = demo.requests.filter((q) => `${JSON.stringify(q.headers)} ${q.postData ?? ""}`.includes(SECRET));
    for (const q of carrying) {
      expect(failed.get(q.url), q.url).toBe("csp");
      expect(answered).not.toContain(q.url);
    }
    expect(answered.filter((u) => u.includes("ailleurs.test") || u.endsWith("/apis/x") || u.endsWith("/robots.txt"))).toEqual([]);
    // Tentatives refusées par la CSP, attendues ici et seulement ici : on les retire des gardes de la fixture.
    demo.cspViolations.length = 0;
    demo.foreignRequests.length = 0;
    demo.requests.length = 0;
  });

  // Composeur (Tasks 10, 11, 13) : ajouter (dépôt, collage), réordonner, retirer ; pas de coffre en démo (spec §27.6).
  test("composeur : dépôt, collage, réordonner, retirer et annuler ; aucun droit « coffre » ; rien n'est stocké", async ({ page, demo, isMobile }) => {
    await page.goto(demo.url);
    await page.evaluate(() => {
      const dt = new DataTransfer();
      for (const n of ["a.txt", "b.txt"]) dt.items.add(new File([n], n, { type: "text/plain" }));
      const fire = (type: string) => document.querySelector("main")!.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      fire("dragenter");
      fire("drop");
    });
    const rows = page.locator("[data-row]");
    await expect(rows).toHaveCount(2);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      const dt = new DataTransfer();
      dt.items.add(new File(["c"], "c.txt", { type: "text/plain" }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect(rows).toHaveCount(3);
    // Téléphone : menu « … » de la ligne (plus de déplacement, retours UI6) ; ordinateur
    // (demo-webkit-desktop) : poignée et boutons sur la ligne.
    const order = isMobile ? ["a.txt", "b.txt", "c.txt"] : ["b.txt", "a.txt", "c.txt"];
    if (isMobile) {
      await page.getByRole("button", { name: "Actions pour a.txt" }).click();
      await page.getByRole("dialog", { name: "a.txt" }).getByRole("button", { name: "Supprimer" }).click();
    } else {
      await page.getByRole("button", { name: "Déplacer a.txt" }).focus();
      await page.keyboard.press("Alt+ArrowDown");
      await expect(page.locator("[data-row] .nm")).toHaveText(["b.txt", "a.txt", "c.txt"]);
      await page.getByRole("button", { name: "Supprimer a.txt" }).click();
    }
    await expect(rows).toHaveCount(2);
    await page.getByRole("button", { name: "Annuler" }).click();
    await expect(page.locator("[data-row] .nm")).toHaveText(order);
    // Pas de coffre en démo (spec §27.6), même au doigt.
    if (isMobile) await page.getByRole("button", { name: /^Options · / }).click();
    const opts = isMobile ? page.getByRole("dialog", { name: "Options" }) : page.locator(".side");
    await expect(opts.getByRole("switch", { name: "Autoriser le téléchargement" })).toHaveAttribute("aria-checked", "true");
    await expect(opts.getByRole("switch", { name: /garder une copie chiffrée/i })).toHaveCount(0);
    if (isMobile) await page.keyboard.press("Escape");
    expect(await storage(page)).toBe(0);
    expect(await axe(page)).toEqual([]);
    await capture(page, "demo-compose");
  });
});

test.describe("fr-FR : envoi (Tasks 17–18)", () => {
  test.use({ locale: "fr-FR" });

  test("Chiffrer et envoyer : progression, Lien prêt avec un lien /shhdrop/#<43>, ouvrir comme destinataire", async ({ page, demo }) => {
    test.setTimeout(90_000);
    await page.goto(demo.url);
    await addText(page, "Le code de la porte est 4471.");
    await addFile(page, "releve.bin", 2 * 1048576);
    await sendButton(page).click();
    await expect(page.getByRole("heading", { name: "Préparation des clés" }).or(page.getByRole("heading", { name: "Vérification anti-robot" }))).toBeVisible();
    await expect(page).toHaveTitle(/^Démo · /);
    await expect(readyHeading(page)).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveTitle("Démo · Lien prêt · Shhdrop");
    const link = (await page.getByRole("group", { name: "Lien" }).locator(".sr-only").first().textContent()) ?? "";
    expect(link).toMatch(new RegExp(`^${demo.origin.replace(/\./g, "\\.")}/shhdrop/#[A-Za-z0-9_-]{43}$`));
    const manage = (await page.locator(".manage .sr-only").first().textContent()) ?? "";
    expect(manage).toMatch(/\/shhdrop\/#m[A-Za-z0-9_-]{43}$/);
    expect(await storage(page)).toBe(0);
    await capture(page, "demo-ready");
    const password = (await page.getByRole("group", { name: "Mot de passe" }).locator(".sr-only").first().textContent()) ?? "";
    // Même onglet (le faux serveur vit dans la page) : ouverture complète, puis destruction.
    await page.getByRole("button", { name: "Ouvrir comme destinataire (démo)" }).click();
    await expect(readyHeading(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => location.pathname + location.hash)).toBe("/shhdrop/");
    await expect(page.getByRole("heading", { name: "Un partage chiffré vous attend" })).toBeVisible();
    await page.getByLabel("Mot de passe", { exact: true }).fill("pas-le-bon");
    await page.getByRole("button", { name: "Déverrouiller" }).click();
    await expect(page.locator("#open-err").getByText("Mot de passe incorrect · 4\u202fessais restants")).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("Mot de passe", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Déverrouiller" }).click();
    await expect(page.getByRole("heading", { name: "Contenu", exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('li.row[data-kind="note"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Télécharger releve.bin" })).toBeVisible();
    await capture(page, "demo-content");
    // Rechargement : le faux serveur de l'onglet survit (demo/persist.ts, exception démo) :
    // « Rouvrir ce partage », comme en production, au lieu de « Lien invalide ».
    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Rouvrir ce partage" })).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("Mot de passe", { exact: true }).fill(password);
    await page.getByRole("button", { name: /^(Rouvrir|Déchiffrement)/ }).click();
    await expect(page.getByRole("heading", { name: "Contenu", exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('li.row[data-kind="note"]')).toBeVisible();
    await page.getByRole("button", { name: "Détruire ce partage", exact: true }).click();
    await page.getByRole("button", { name: "Détruire", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Détruit" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("[data-receipt]")).toBeVisible();
    expect(await storage(page)).toBe(0);
    // Le lien collé à nouveau dans le même onglet : le partage n'existe plus.
    await page.evaluate((l) => (location.hash = new URL(l).hash), link);
    await expect(page.getByRole("heading", { name: "Ce lien n'existe pas ou n'est plus disponible." })).toBeVisible();
  });

  test("« Supprimer ce partage » depuis « Lien prêt », puis le lien de gestion : supprimé (scan du 7 novembre, F2)", async ({ page, demo }) => {
    test.setTimeout(90_000);
    await page.goto(demo.url);
    await addText(page, "À supprimer.");
    await sendButton(page).click();
    await expect(readyHeading(page)).toBeVisible({ timeout: 60_000 });
    const link = (await page.getByRole("group", { name: "Lien" }).locator(".sr-only").first().textContent()) ?? "";
    await page.getByRole("button", { name: "Supprimer ce partage" }).click();
    await page.getByRole("button", { name: "Supprimer", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Partage supprimé" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Connexion impossible\u202f: le partage n'a pas été supprimé.")).toHaveCount(0);
    await page.evaluate((l) => (location.hash = new URL(l).hash), link);
    await expect(page.getByRole("heading", { name: "Ce lien n'existe pas ou n'est plus disponible." })).toBeVisible();
  });

  test("?coupure : bandeau de coupure, puis reprise et Lien prêt", async ({ page, demo }) => {
    test.setTimeout(120_000);
    await page.goto(demo.url + "?coupure");
    await addFile(page, "releve.bin", 3 * 1048576);
    await sendButton(page).click();
    await expect(page.getByRole("status").filter({ hasText: /Connexion perdue|Hors ligne/ })).toBeVisible({ timeout: 30_000 });
    await capture(page, "demo-seal-offline");
    await expect(readyHeading(page)).toBeVisible({ timeout: 90_000 });
  });
});

test.describe("en-US", () => {
  test.use({ locale: "en-US" });

  test("bandeau en anglais ; capture", async ({ page, demo }) => {
    await page.goto(demo.url);
    await expect(page.getByRole("note")).toHaveText(BANNER_EN);
    await expect(page).toHaveTitle("Demo · End-to-end encrypted sharing, no account · Shhdrop");
    await page.waitForTimeout(700);
    await capture(page, "demo-home-en");
  });
});
