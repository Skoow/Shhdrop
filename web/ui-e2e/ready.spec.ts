// « Lien prêt » (UI §9.5) sur le vrai serveur : deux cartes pour deux secrets (M18), copie qui
// lit l'état, partage natif sans mot de passe, QR du lien seul, dictée locale, garde de sortie,
// Terminé, Supprimer. Captures fr-FR à 1440 × 900 et 390 × 844.
import type { BrowserContext, Page } from "@playwright/test";
import { NotFoundError, fetchMeta } from "../src/index";
import { qrPath } from "../src/qr/qr";
import { axe, capture, expect, test } from "./fixtures";
import { addText, armed, readyHeading, sendButton } from "./send-helpers";

const LINK_RE = /^http:\/\/127\.0\.0\.1:\d+\/#[A-Za-z0-9_-]{43}$/;

async function toReady(page: Page, context: BrowserContext, origin: string, text = "Le code de la porte est 4471.") {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.goto(origin + "/");
  await addText(page, text);
  await sendButton(page).click();
  await expect(readyHeading(page)).toBeVisible({ timeout: 60_000 });
}
const clip = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
const linkCard = (page: Page) => page.getByRole("group", { name: "Lien" });
const pwCard = (page: Page) => page.getByRole("group", { name: "Mot de passe" });
/** Valeur complète d'un CopyField (texte pour lecteur d'écran). */
const valueOf = (page: Page, card: ReturnType<typeof linkCard>) => card.locator(".sr-only").first().textContent().then((s) => s ?? "");

test.describe("fr-FR", () => {
  test.use({ locale: "fr-FR", timezoneId: "Europe/Paris" });

  test("deux cartes, copie depuis l'état, partage natif sans mot de passe, QR du lien seul, Vider, Terminé", async ({ page, shh, context, isMobile }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      const shared: unknown[] = [];
      (window as unknown as { __shared: unknown[] }).__shared = shared;
      Object.defineProperty(navigator, "share", { value: async (d: unknown) => void shared.push(d), configurable: true });
    });
    await toReady(page, context, shh.origin);
    await expect(readyHeading(page)).toBeFocused();

    // Ordre du DOM : avertissement → carte lien → carte mot de passe → gestion repliée →
    // Supprimer → Vider → Terminé (scan UX, « Lien prêt » : hiérarchie).
    const order = await page.evaluate(() => {
      const els = [...document.querySelectorAll(".ready p.never, .ready [role=group][aria-label], .ready details.manage, .ready .danger-zone, .ready .clip, .ready .done")];
      return els.map((e) => e.getAttribute("aria-label") ?? e.className.split(" ").find((c) => c && !c.startsWith("svelte-") && c !== "card"));
    });
    expect(order).toEqual(["never", "Lien", "Mot de passe", "manage", "danger-zone", "clip", "done"]);
    await expect(page.locator(".ready p.never")).toHaveText("Ce lien et ce mot de passe ne seront plus jamais affichés.");
    // Terminé : action principale ; Supprimer : secondaire.
    await expect(page.getByRole("button", { name: "Terminé" })).toHaveClass(/\bprimary\b/);
    await expect(page.getByRole("button", { name: "Supprimer ce partage" })).not.toHaveClass(/\bprimary\b/);
    // Lien de gestion replié par défaut, ouvert d'un clic sur son titre.
    const manage = page.locator("details.manage");
    await expect(manage).not.toHaveAttribute("open");
    await expect(manage.getByRole("button", { name: /^Copier/ })).toBeHidden();
    await manage.getByText("Gérer ce partage").click();
    await expect(manage).toHaveAttribute("open");
    await expect(manage.getByRole("button", { name: /^Copier/ })).toBeVisible();
    await expect(manage.locator(".sr-only").first()).toHaveText(/#m[A-Za-z0-9_-]{43}$/);
    // Plus d'avertissement « par un autre moyen » (décision du propriétaire du 8 novembre).
    await expect(page.locator(".ready").getByText("autre moyen", { exact: false })).toHaveCount(0);

    const link = await valueOf(page, linkCard(page));
    const password = await valueOf(page, pwCard(page));
    expect(link).toMatch(LINK_RE);
    expect(password.length).toBeGreaterThanOrEqual(8);
    expect(await linkCard(page).innerText()).not.toContain(password);

    // Copier lit l'état, jamais le DOM.
    await page.evaluate(() => document.querySelectorAll(".cf .val").forEach((e) => (e.textContent = "x")));
    await linkCard(page).getByRole("button", { name: /^Copier/ }).click();
    expect(await clip(page)).toBe(link);
    await pwCard(page).getByRole("button", { name: /^Copier/ }).click();
    expect(await clip(page)).toBe(password);

    // Partager : { url } seulement.
    await linkCard(page).getByRole("button", { name: "Partager le lien" }).click();
    expect(await page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared)).toEqual([{ url: link }]);
    // Mot de passe : un second partage, distinct, le texte seul (jamais avec le lien).
    await pwCard(page).getByRole("button", { name: "Partager le mot de passe" }).click();
    expect(await page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared)).toEqual([{ url: link }, { text: password }]);

    // QR : le lien, rien d'autre (même chemin que qrPath(link)).
    await linkCard(page).getByRole("button", { name: "QR code" }).click();
    const qr = page.getByRole("img", { name: "QR code du lien de partage" });
    await expect(qr).toBeVisible();
    expect(await qr.locator("path").getAttribute("d")).toBe(qrPath(link).d);
    expect(await qr.locator("path").getAttribute("d")).not.toBe(qrPath(password).d);
    await expect(page.getByText("Le QR contient la clé : ne le montrez qu'au destinataire.")).toBeVisible();
    await expect(page.locator("input[type=email]")).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
    await capture(page, "ready-qr");
    if (isMobile) await page.keyboard.press("Escape"); // téléphone : QR en feuille

    // Vider le presse-papier.
    await page.getByRole("button", { name: "Vider le presse-papier" }).click();
    await expect.poll(() => clip(page)).toBe("");

    // Garde de sortie jusqu'à Terminé ; puis composeur vide, plus aucun secret à l'écran.
    expect(await armed(page)).toBe(true);
    await page.getByRole("button", { name: "Terminé" }).click();
    await expect(page.getByText("Vous ne pourrez plus les afficher. Terminer ?")).toBeVisible();
    await page.getByRole("button", { name: "Terminer" }).click();
    await expect(page.getByRole("button", { name: /^(Parcourir les fichiers|Ajouter)/ }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.locator("[data-row]")).toHaveCount(0);
    const body = await page.evaluate(() => document.body.innerText);
    expect(body).not.toContain(link);
    expect(body).not.toContain(password);
    expect(await armed(page)).toBe(false);
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  });

  test("Supprimer ce partage : confirmation, « Partage supprimé », plus rien sur le serveur", async ({ page, shh, context }) => {
    test.setTimeout(120_000);
    await toReady(page, context, shh.origin);
    const link = await valueOf(page, linkCard(page));
    await capture(page, "ready");
    await page.getByRole("button", { name: "Supprimer ce partage" }).click();
    await expect(page.getByText("Supprimer ce partage pour tout le monde ? Le lien ne mènera plus à rien.")).toBeVisible();
    await page.getByRole("button", { name: "Supprimer", exact: true }).click();
    const title = page.getByRole("heading", { name: "Partage supprimé" });
    await expect(title).toBeVisible();
    await expect(title).toBeFocused();
    await expect(page.getByText("Il a été effacé du serveur : le lien ne mène plus à rien.", { exact: false })).toBeVisible();
    await expect.poll(async () => fetchMeta(link, shh.origin).then(() => "vivant", (e) => (e instanceof NotFoundError ? "supprimé" : String(e)))).toBe("supprimé");
    expect(await page.evaluate(() => document.body.innerText)).not.toContain(link);
    await page.waitForTimeout(2600); // gomme du logo
    await capture(page, "ready-deleted");
    await page.getByRole("button", { name: "Nouvel envoi" }).click();
    await expect(page.getByRole("button", { name: /^(Parcourir les fichiers|Ajouter)/ }).filter({ visible: true }).first()).toBeVisible();
    expect(await armed(page)).toBe(false);
  });

  test("mot de passe généré de 11 caractères : affiché exactement comme il est copié (scan UX B5 ; D41-15 : plus de saisie)", async ({ page, shh, context }) => {
    test.setTimeout(120_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: shh.origin });
    await toReady(page, context, shh.origin);
    const gen = await valueOf(page, pwCard(page));
    expect(gen).toHaveLength(11);
    // Affiché tout collé, sans groupe ni séparateur (décision du 8 novembre) : ce qu'on lit = la copie.
    await expect(pwCard(page).locator(".val.vis")).toHaveText(gen);
    await pwCard(page).getByRole("button", { name: /^Copier/ }).click();
    expect(await clip(page)).toBe(gen);
  });

  test("pastille « vers 9 h 45 » (arrondi au quart d'heure) et durée de vie choisie (3 ouvertures, 6 h)", async ({ page, shh, context, isMobile }) => {
    test.setTimeout(120_000);
    // Date.now() figé et durée exacte : le serveur arrondit l'échéance au quart d'heure SUPÉRIEUR
    // de son heure réelle ; la réponse de finalize est fixée ici à 12 h (ou 6 h) pile.
    const exact = async (p: Page) =>
      p.route("**/api/shares/finalize", async (route) => {
        const r = await route.fetch();
        const ttl = JSON.parse(route.request().postData() ?? "{}").ttl_hours as number;
        await route.fulfill({ response: r, json: { expires_in_s: ttl * 3600 } });
      });
    await exact(page);
    await page.clock.setFixedTime(new Date("2026-11-05T21:41:00+01:00"));
    await toReady(page, context, shh.origin);
    await expect(page.getByText(/^Actif · s'efface dans 12\sh \(à 09\sh\s45\)$/)).toBeVisible();
    await expect(page.getByText(/^S'efface tout seul\s: après 1\souverture, ou au bout de 12\sh\.$/)).toBeVisible();
    await expect(page.getByText(/disparaît de partout/)).toHaveCount(0);

    const p2 = await context.newPage();
    await exact(p2);
    await p2.clock.setFixedTime(new Date("2026-11-05T21:36:00+01:00"));
    await p2.goto(shh.origin + "/");
    await addText(p2, "options");
    if (isMobile) await p2.getByRole("button", { name: /^Options · / }).click(); // téléphone : options en feuille
    await p2.getByRole("radiogroup", { name: "Durée" }).getByRole("radio", { name: /^6\sh$/ }).evaluate((e: HTMLInputElement) => e.click());
    await p2.getByRole("radiogroup", { name: "Ouvertures" }).getByRole("radio", { name: "3", exact: true }).evaluate((e: HTMLInputElement) => e.click());
    if (isMobile) await p2.keyboard.press("Escape");
    await sendButton(p2).click();
    await expect(readyHeading(p2)).toBeVisible({ timeout: 60_000 });
    await expect(p2.getByText(/^S'efface tout seul\s: après 3\souvertures, ou au bout de 6\sh\.$/)).toBeVisible();
    await expect(p2.getByText(/^Actif · s'efface dans 6\sh \(à 03\sh\s30\)$/)).toBeVisible();
  });

  test("mot de passe affiché tout collé (11 caractères, sans groupe ni point), sans « Épeler » ; rien dans la console ni le stockage", async ({ page, shh, context }) => {
    test.setTimeout(120_000);
    const logs: string[] = [];
    page.on("console", (m) => logs.push(m.text()));
    await toReady(page, context, shh.origin);
    const password = await valueOf(page, pwCard(page));
    expect(password).toMatch(/^[abcdefghkmnpqrtuvwxyACDEFGHJKLMNPQRTUVWXY23456789!?@#$%&*+\-=/()]{11}$/);
    await expect(pwCard(page).locator(".val.vis")).toHaveText(password);
    await expect(pwCard(page).locator(".gsep, .g")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Épeler" })).toHaveCount(0);
    expect(logs.join("\n")).not.toContain(password);
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
    expect(await page.title()).toBe("Lien prêt · Shhdrop");
  });

  test("mouvement réduit : aucune animation ; sinon, montée en éventail ≤ 640 ms et boutons cliquables", async ({ page, shh, context }) => {
    test.setTimeout(120_000);
    // Toutes les animations WAAPI lancées dans « Lien prêt » : durée + délai ≤ 640 ms.
    await page.addInitScript(() => {
      const runs: number[] = [];
      (window as unknown as { __runs: number[] }).__runs = runs;
      const orig = Element.prototype.animate;
      Element.prototype.animate = function (k, o) {
        if (this.closest(".ready") && typeof o === "object") runs.push(Number(o.duration ?? 0) + Number(o.delay ?? 0));
        return orig.call(this, k, o);
      };
    });
    await toReady(page, context, shh.origin);
    const runs = await page.evaluate(() => (window as unknown as { __runs: number[] }).__runs);
    expect(runs.length).toBeGreaterThanOrEqual(3);
    for (const d of runs) expect(d).toBeLessThanOrEqual(640);
    // Boutons cliquables pendant l'animation : la copie répond tout de suite.
    await page.getByRole("group", { name: "Lien" }).getByRole("button", { name: /^Copier/ }).click();

    // Seconde page au premier plan : sinon l'onglet est en arrière-plan, requestAnimationFrame
    // y est suspendu et Playwright ne voit jamais un bouton « stable » (S11, téléphone).
    const p2 = await context.newPage();
    await p2.bringToFront();
    await p2.emulateMedia({ reducedMotion: "reduce" });
    await p2.goto(shh.origin + "/");
    await addText(p2, "réduit");
    await sendButton(p2).click();
    await expect(readyHeading(p2)).toBeVisible({ timeout: 60_000 });
    expect(
      await p2.evaluate(() => document.getAnimations().filter((a) => (a.effect as KeyframeEffect | null)?.target?.closest?.(".ready")).length),
    ).toBe(0);
  });
});

test.describe("390 × 844", () => {
  test.use({ locale: "fr-FR", viewport: { width: 390, height: 844 }, isMobile: false });

  test("Terminé collé en bas, sous le pouce ; Supprimer dans le fil, jamais collé ; QR en feuille ; capture", async ({ page, shh, context }) => {
    test.setTimeout(120_000);
    await toReady(page, context, shh.origin);
    await page.waitForTimeout(700);
    await capture(page, "ready-390");
    const done = page.getByRole("button", { name: "Terminé" });
    const del = page.getByRole("button", { name: "Supprimer ce partage" });
    await expect(done).toBeInViewport();
    // (Plus court depuis le 8 novembre : Supprimer peut être visible d'emblée ; il reste dans le fil.)
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect(done).toBeInViewport();
    expect(await del.evaluate((e) => getComputedStyle(e.closest(".danger-zone")!).position)).toBe("static");
    // Tout en bas : Supprimer n'est pas sous la barre de Terminé (ni recouvert, ni collé à elle).
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const [d, b] = [await del.boundingBox(), await page.locator(".done").boundingBox()];
    expect(d!.y + d!.height).toBeLessThan(b!.y - 40);
    await capture(page, "ready-390-bottom");
    await linkCard(page).getByRole("button", { name: "QR code" }).click();
    const sheet = page.getByRole("dialog", { name: "QR code" });
    await expect(sheet.getByRole("img", { name: "QR code du lien de partage" })).toBeVisible();
    await page.waitForTimeout(500);
    await capture(page, "ready-qr-390");
  });
});

test.describe("en-US", () => {
  test.use({ locale: "en-US" });

  test("Link ready in English ; capture", async ({ page, shh }) => {
    test.setTimeout(120_000);
    await page.goto(shh.origin + "/");
    if (await page.getByRole("button", { name: /^Add/ }).filter({ visible: true }).first().isVisible()) {
      await page.getByRole("button", { name: /^Add/ }).filter({ visible: true }).first().click();
      await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: /^Note/ }).click();
    } else await page.getByRole("group", { name: "Or create one here" }).getByRole("button", { name: "Note", exact: true }).click();
    const dlg = page.getByRole("dialog");
    await dlg.locator("textarea").fill("The door code is 4471.");
    await dlg.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: "Encrypt and send" }).click();
    await expect(page.getByRole("heading", { name: "Link ready" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("group", { name: "Password" })).toBeVisible();
    await expect(page.getByText("different channel", { exact: false })).toHaveCount(0);
    await page.waitForTimeout(700);
    await capture(page, "ready-en");
  });
});
