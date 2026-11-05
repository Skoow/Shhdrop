// Accueil v3 (UI §9.1, §20.4) : titre mot par mot, sceaux de confiance, fenêtre de dépôt
// (Parcourir, Photo, Vidéo, Vocal, Texte, Coller), voile de dépôt pleine page, sections sous le
// pli (Comment ça marche, Pourquoi c'est sûr, questions, appel final), révélations au défilement.
import type { Page } from "@playwright/test";
import { axe, capture, expect, test } from "./fixtures";

/** Paires de libellés du schéma dont les boîtes se croisent (texte réel, pas la cellule). */
function labelOverlaps(page: Page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll("[data-label]")];
    const r = els.map((e) => e.getBoundingClientRect());
    const out: string[] = [];
    for (let i = 0; i < r.length; i++)
      for (let j = i + 1; j < r.length; j++) {
        const a = r[i]!, b = r[j]!;
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
          out.push(`${els[i]!.textContent} × ${els[j]!.textContent}`);
      }
    return out;
  });
}

const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

/** Glisser de fichiers simulé : DataTransfer construit dans la page (Chromium et WebKit). */
async function drag(page: Page, type: "dragenter" | "dragover" | "dragleave" | "drop", names: string[]) {
  await page.evaluate(
    ({ type, names }) => {
      const dt = new DataTransfer();
      for (const n of names) dt.items.add(new File(["x"], n, { type: "text/plain" }));
      const e = new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true });
      document.querySelector("main")!.dispatchEvent(e);
    },
    { type, names },
  );
}

const TITLE_FR = "Un lien, un mot de passe, puis plus rien.";
const SCHEMA_FR = "Votre appareil — chiffré — serveur (ne lit rien) — chiffré — destinataire";

test.describe("fr-FR", () => {
  test.use({ locale: "fr-FR" });

  test("titre, phrase, sceaux, fenêtre de dépôt, sections titrées, schéma nommé ; axe", async ({ page, shh, isMobile }) => {
    await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
    await page.goto(shh.origin + "/");
    await expect(page.getByRole("heading", { level: 1, name: TITLE_FR })).toBeVisible();
    await expect(page.getByText(/^Texte, photos, vidéos, vocaux, documents\./)).toBeVisible();
    const certs = page.getByRole("list", { name: "En bref" }).getByRole("listitem");
    await expect(certs).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Parcourir les fichiers" })).toBeVisible();
    for (const h of ["Comment ça marche", "Pourquoi c'est sûr", "Vos questions", "Quelque chose à transmettre ?"])
      await expect(page.getByRole("heading", { level: 2, name: h, exact: true })).toHaveCount(1);
    await expect(page.getByRole("img", { name: SCHEMA_FR })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Tous les détails de sécurité" })).toHaveAttribute("href", "/securite");
    // Le code public : lien sortant sans référent (aucune ressource chargée, une simple navigation).
    await expect(page.getByRole("link", { name: "Voir le code sur GitHub" })).toHaveAttribute("rel", "noopener noreferrer");
    // Aucun « # » dans un lien de la page (réservé aux clés, UI §12.1).
    expect(await page.locator("main a[href*='#']").count()).toBe(0);
    expect(await noHScroll(page)).toBe(true);
    expect(await axe(page)).toEqual([]);
    await page.waitForTimeout(900);
    await capture(page, "home");

    await page.getByRole("link", { name: "Tous les détails de sécurité" }).click();
    await expect(page).toHaveURL(shh.origin + "/securite");
  });

  test("téléphone 390 × 844 : les actions sont dans le premier écran, le schéma sous le réceptacle (S4)", async ({ page, shh, isMobile }) => {
    test.skip(!isMobile, "projets téléphone seulement");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(shh.origin + "/");
    await page.waitForTimeout(900); // positions finales (entrée finie)
    // Au doigt, le titre ne parle pas de glisser.
    await expect(page.getByRole("heading", { level: 2, name: "Que voulez-vous envoyer ?" })).toBeVisible();
    const row = page.getByRole("group", { name: "Ou créez sur place" });
    await expect(row).toBeVisible();
    const box = (await row.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    const browse = (await page.getByRole("button", { name: "Parcourir les fichiers" }).boundingBox())!;
    expect(browse.height).toBeGreaterThanOrEqual(44);
    for (const b of await row.getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    const vessel = (await page.locator('[data-slot="compose"]').boundingBox())!;
    const schema = (await page.locator('[role="img"]').boundingBox())!;
    expect(schema.y).toBeGreaterThan(vessel.y + vessel.height);
  });

  test("320 px : rien ne déborde ; capture", async ({ page, shh }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(shh.origin + "/");
    await expect(page.getByRole("heading", { level: 1, name: TITLE_FR })).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
    expect(await labelOverlaps(page)).toEqual([]);
    await page.waitForTimeout(900);
    await capture(page, "home-320");
  });

  test("texte à 200 % sur 320 px : aucun débordement, libellés du schéma sans chevauchement ; capture", async ({ page, shh }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(shh.origin + "/");
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%"; // CSSOM : permis par la CSP
    });
    await expect(page.locator("[data-label]")).toHaveCount(6);
    expect(await labelOverlaps(page)).toEqual([]);
    // Les libellés restent dans le flux : sous le dessin, au-dessus du lien qui le suit.
    const drawing = (await page.locator('[role="img"]').boundingBox())!;
    const next = (await page.getByRole("link", { name: "Tous les détails de sécurité" }).boundingBox())!;
    const boxes = await page.locator(".nodes [data-label]").evaluateAll((es) => es.map((e) => e.getBoundingClientRect().toJSON()));
    for (const box of boxes) {
      expect(box.top).toBeGreaterThanOrEqual(drawing.y + drawing.height);
      expect(box.bottom).toBeLessThanOrEqual(next.y);
    }
    expect(await noHScroll(page)).toBe(true);
    await page.waitForTimeout(900);
    await capture(page, "home-320-200pct");
    await page.locator(".schema").evaluate((e) => e.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(900);
    expect(await noHScroll(page)).toBe(true);
    await capture(page, "home-320-200pct-securite");
  });

  test("K1 : toutes les animations d'entrée sont finies à 900 ms (hors ambiance et défilement)", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    const entries = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.timeline === document.timeline)
        .filter((a) => !((a.effect as KeyframeEffect).target as Element).closest("[data-ambient]"))
        .map((a) => ({ name: (a as CSSAnimation).animationName, end: Number(a.effect!.getComputedTiming().endTime) })),
    );
    // Titre (9 mots), phrase, 3 sceaux, coffre et ses parties.
    expect(entries.length).toBeGreaterThanOrEqual(20);
    for (const e of entries) expect(e.end, e.name).toBeLessThanOrEqual(900);
    // Seule l'ambiance boucle.
    const infinite = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.effect!.getComputedTiming().iterations === Infinity)
        .map((a) => ((a.effect as KeyframeEffect).target as Element).closest("[data-ambient]") !== null),
    );
    expect(infinite.length).toBeGreaterThan(0);
    expect(infinite.every(Boolean)).toBe(true);
  });

  test("K8 : le titre a pour nom la phrase entière ; la copie animée est cachée", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    const h1 = page.getByRole("heading", { level: 1, name: TITLE_FR, exact: true });
    await expect(h1).toBeVisible();
    await expect(h1.locator(".words")).toHaveAttribute("aria-hidden", "true");
    await expect(h1.locator(".words .w")).toHaveCount(9);
  });

  test("rien n'attend : à 100 ms, Parcourir ouvre le sélecteur multiple ; un clic sur le verre n'ouvre rien", async ({ page, shh }) => {
    await page.goto(shh.origin + "/", { waitUntil: "domcontentloaded" });
    const browse = page.getByRole("button", { name: "Parcourir les fichiers" });
    await expect(browse).toBeAttached();
    await page.waitForTimeout(100);
    let opened = 0;
    page.on("filechooser", () => opened++);
    // force : pas d'attente de stabilité (le coffre monte encore de quelques pixels).
    await page.locator(".drop-title").click({ force: true });
    await page.locator(".band-cap").click({ force: true });
    await page.waitForTimeout(300);
    expect(opened).toBe(0);
    const chooser = page.waitForEvent("filechooser", { timeout: 2000 });
    await browse.click({ force: true });
    expect((await chooser).isMultiple()).toBe(true);
  });

  test("Photo et Vidéo : sélecteur filtré (capture sur téléphone) ; les fichiers choisis sont annoncés", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    await page.waitForTimeout(900);
    for (const [name, accept] of [["Photo", "image/*"], ["Vidéo", "video/*"]] as const) {
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("group", { name: "Ou créez sur place" }).getByRole("button", { name, exact: true }).click();
      const fc = await chooser;
      expect(fc.isMultiple()).toBe(false);
      expect(await fc.element().getAttribute("accept")).toBe(accept);
      expect(await fc.element().getAttribute("capture")).toBe("environment");
    }
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Parcourir les fichiers" }).click();
    await (await chooser).setFiles([
      { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("a") },
      { name: "b.txt", mimeType: "text/plain", buffer: Buffer.from("b") },
    ]);
    await expect(page.locator(".notice.on")).toHaveText("2 éléments ajoutés");
  });

  test("glisser-déposer : voile pleine page, Échap le ferme, un dépôt ajoute ; capture", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    await page.waitForTimeout(900);
    const overlay = page.locator(".overlay");
    await expect(overlay).toBeHidden();
    await drag(page, "dragenter", ["a.txt"]);
    await expect(overlay).toBeVisible();
    await expect(page.locator(".vessel.drop")).toHaveCount(1);
    await page.waitForTimeout(600);
    await capture(page, "home-drop");
    await page.keyboard.press("Escape");
    await expect(overlay).toBeHidden();
    // Entrées et sorties sur des éléments enfants : le voile reste tant que le compteur n'est pas à zéro.
    await drag(page, "dragenter", ["a.txt"]);
    await drag(page, "dragenter", ["a.txt"]);
    await drag(page, "dragleave", ["a.txt"]);
    await expect(overlay).toBeVisible();
    await drag(page, "drop", ["a.txt", "b.txt", "c.txt"]);
    await expect(overlay).toBeHidden();
    await expect(page.locator(".notice.on")).toHaveText("3 éléments ajoutés");
    expect(page.url()).toBe(shh.origin + "/");
  });

  test("« Commencer » ramène au coffre et met le focus sur Parcourir ; « Comment ça marche » descend à sa section", async ({ page, shh, isMobile }) => {
    await page.goto(shh.origin + "/");
    const cta = page.getByRole("button", { name: "Commencer" });
    // Bouton au centre de l'écran, révélation au défilement finie, avant l'appui.
    await cta.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await expect.poll(() => cta.evaluate((e) => Number(getComputedStyle(e.closest(".rv")!).opacity))).toBe(1);
    await cta.click();
    await expect(page.getByRole("button", { name: "Parcourir les fichiers" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Parcourir les fichiers" })).toBeInViewport();
    expect(page.url()).toBe(shh.origin + "/");
    if (!isMobile) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.getByRole("button", { name: "Comment ça marche" }).click();
      await expect(page.getByRole("heading", { level: 2, name: "Comment ça marche" })).toBeInViewport();
      expect(page.url()).toBe(shh.origin + "/");
    }
  });

  test("questions : accordéon natif, une seule réponse ouverte à la fois", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    const q1 = page.getByText("Que voit le serveur ?");
    const q2 = page.getByText("Puis-je récupérer un partage détruit ?");
    await q1.scrollIntoViewIfNeeded();
    await q1.click();
    await expect(page.getByText(/^Des données chiffrées, leur taille approximative/)).toBeVisible();
    await q2.click();
    await expect(page.getByText(/^Non\. Un partage détruit ou expiré/)).toBeVisible();
    await expect(page.getByText(/^Des données chiffrées, leur taille approximative/)).toBeHidden();
    expect(await page.locator("details[open]").count()).toBe(1);
  });

  test("révélations : chaque section apparaît en entier une fois dans l'écran", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    for (const sel of ["section.how h2", ".claim:last-child", "section.faq h2", "section.end h2"]) {
      const el = page.locator(sel).first();
      await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
      await expect
        .poll(() => el.evaluate((e) => Number(getComputedStyle(e.closest(".rv") ?? e).opacity)), { timeout: 3000 })
        .toBe(1);
    }
  });

  test("ambiance : pause hors écran et onglet caché, reprise ensuite", async ({ page, shh }) => {
    await page.setViewportSize({ width: 390, height: 560 });
    await page.goto(shh.origin + "/");
    const state = () =>
      page.evaluate(() => {
        const out: Record<string, string[]> = {};
        for (const a of document.getAnimations()) {
          const el = (a.effect as KeyframeEffect).target as Element;
          const root = el.closest("[data-ambient]");
          if (!root) continue;
          const k = el.closest(".aurora") ? "aurora" : root.classList.contains("band") ? "band" : el.closest(".schema") ? "schema" : "other";
          (out[k] ??= []).push(a.playState);
        }
        return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...new Set(v)].sort().join(",")]));
      });
    // Haut de page : le volet du coffre tourne, le schéma (loin dessous) est en pause.
    await expect.poll(async () => (await state()).band).toBe("running");
    await expect.poll(async () => (await state()).schema).toBe("paused");
    await page.locator(".schema").evaluate((e) => e.scrollIntoView({ block: "center" }));
    await expect.poll(async () => (await state()).schema).toBe("running");
    await expect.poll(async () => (await state()).band).toBe("paused");
    const setHidden = (v: boolean) =>
      page.evaluate((hidden) => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
        document.dispatchEvent(new Event("visibilitychange"));
      }, v);
    await setHidden(true);
    await expect.poll(async () => Object.values(await state()).every((s) => s === "paused")).toBe(true);
    await setHidden(false);
    await expect.poll(async () => (await state()).schema).toBe("running");
  });

  test("mouvement réduit : aucune animation, ni au chargement ni au défilement ; capture", async ({ page, shh, isMobile }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await page.goto(shh.origin + "/");
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    // m6 : l'ouverture du contour (état drop) n'est pas animée, seule sa couleur l'est.
    const props = await page.locator(".vessel .track").evaluate((e) => getComputedStyle(e).transitionProperty);
    expect(props).not.toMatch(/stroke-dasharray|all/);
    await capture(page, "home-v3-reduced");
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(200);
    // Au défilement, seules restent les transitions de couleur de l'en-tête (verre, UI §5.4) :
    // aucune animation d'image clé, rien qui bouge.
    expect(await page.evaluate(() => document.getAnimations().filter((a) => !(a instanceof CSSTransition)).length)).toBe(0);
    expect(
      await page.evaluate(() =>
        document.getAnimations().map((a) => (a as CSSTransition).transitionProperty).filter((p) => /transform|translate|scale|rotate|opacity/.test(p)),
      ),
    ).toEqual([]);
    expect(await page.locator(".rv-wait").count()).toBe(0);
  });

  test("transition de vue réduite (m5) : fondu seulement, aucun groupe déplacé ni redimensionné", async ({ page, shh, browserName }) => {
    test.skip(browserName !== "chromium", "pseudo-éléments de transition dans getAnimations : Chromium");
    await page.goto(shh.origin + "/");
    const run = (reduced: boolean) =>
      page.evaluate(async (r) => {
        const root = document.documentElement;
        root.classList.toggle("vt-reduced", r);
        const doc = document as Document & { startViewTransition(cb: () => void): { ready: Promise<void>; finished: Promise<void> } };
        // Le titre (groupe hero-title) change de taille : sans réduction, son groupe s'anime.
        const vt = doc.startViewTransition(() => document.querySelector("h1")!.classList.toggle("compact"));
        await vt.ready;
        const pseudo = document
          .getAnimations()
          .map((a) => (a.effect as KeyframeEffect).pseudoElement)
          .filter((p): p is string => !!p && p.startsWith("::view-transition"));
        await vt.finished;
        root.classList.remove("vt-reduced");
        return pseudo;
      }, reduced);
    const normal = await run(false);
    expect(normal.some((p) => p.startsWith("::view-transition-group(hero-title)"))).toBe(true);
    const reduced = await run(true);
    expect(reduced.filter((p) => p.startsWith("::view-transition-group"))).toEqual([]);
    expect(reduced).toContain("::view-transition-new(root)");
  });

  test("contraste forcé : aurore, grain et trame retirés, contrôles visibles ; captures", async ({ page, shh, browserName, isMobile }) => {
    test.skip(browserName !== "chromium", "forcedColors : Chromium seulement");
    await page.emulateMedia({ forcedColors: "active" });
    await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await page.goto(shh.origin + "/");
    await expect(page.getByRole("heading", { level: 1, name: TITLE_FR })).toBeVisible();
    for (const sel of [".aurora", ".grain", ".guil"])
      expect(await page.locator(sel).first().evaluate((e) => getComputedStyle(e).display), sel).toBe("none");
    for (const name of ["Parcourir les fichiers", "Photo", "Vidéo"]) {
      const b = page.getByRole("button", { name, exact: true });
      expect(await b.evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe("solid");
    }
    await page.waitForTimeout(900);
    await capture(page, "home-v3-forced");
    await page.locator("section.why").evaluate((e) => e.scrollIntoView());
    await page.waitForTimeout(900);
    await capture(page, "home-v3-forced-securite");
  });

  test("captures v3 : premier écran et chaque section", async ({ page, shh, isMobile }) => {
    await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await page.goto(shh.origin + "/");
    await page.waitForTimeout(1000);
    const tag = isMobile ? "390" : "1440";
    await capture(page, `home-v3-${tag}`);
    for (const s of ["how", "why", "faq", "end"]) {
      await page.locator(`section.${s}`).evaluate((e) => e.scrollIntoView({ block: "start" }));
      await page.evaluate(() => scrollBy(0, -72));
      await page.waitForTimeout(900);
      await capture(page, `home-v3-${tag}-${s}`);
    }
    expect(await noHScroll(page)).toBe(true);
  });
});

test.describe("en-US", () => {
  test.use({ locale: "en-US" });

  test("titre, schéma, sections en anglais ; axe ; capture", async ({ page, shh, isMobile }) => {
    await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
    await page.goto(shh.origin + "/");
    await expect(page.getByRole("heading", { level: 1, name: "One link, one password, then nothing." })).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Your device — encrypted — server (can't read it) — encrypted — recipient" }),
    ).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Browse files" })).toBeVisible();
    for (const h of ["How it works", "Why it's safe", "Your questions", "Something to pass on?"])
      await expect(page.getByRole("heading", { level: 2, name: h, exact: true })).toHaveCount(1);
    expect(await noHScroll(page)).toBe(true);
    expect(await axe(page)).toEqual([]);
    await page.waitForTimeout(900);
    await capture(page, "home-en");
  });
});
