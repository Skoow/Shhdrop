// Ouverture (Task 20, UI §9.7, §9.11, S4 ; benchmark M6, M9) sur le vrai serveur. L'expéditeur
// envoie dans un contexte à part ; le destinataire ouvre le lien dans la page gardée (CSP,
// aucune requête hors de l'origine).
import type { Page } from "@playwright/test";
import { NotFoundError, PW_TRIES, fetchMeta, shareStatus } from "../src/index";
import { axe, capture, expect, grantClipboard, readClipboard, test } from "./fixtures";
import { freshPage, noteRow, pwField, sendShare, settle, unlock, unlockButton } from "./open-helpers";
import { armed } from "./send-helpers";

const INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 307.0.0.34.111 (iPhone15,3; iOS 17_1; fr_FR; fr; scale=3.00; 1290x2796; 532277534)";
const TEXT = "Le code de la porte est 4471.";

function apiPaths(page: Page): string[] {
  const out: string[] = [];
  page.on("request", (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith("/api/")) out.push(`${r.method()} ${p}`);
  });
  return out;
}

test.use({ locale: "fr-FR" });

test("mauvais mot de passe deux fois → « 3 essais restants », bon → contenu ; capsule locked → open ; M9 ; axe ; captures", async ({ page, shh, browser }) => {
  test.setTimeout(150_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT, opens: 3 });
  await s.ctx.close();

  const api = apiPaths(page);
  await page.goto(sent.link);
  const title = page.getByRole("heading", { name: "Un partage chiffré vous attend" });
  await expect(title).toBeVisible();
  // Le « # » a quitté la barre juste après la lecture.
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  // Écran verrouillé : recharger ou fermer demande confirmation (le « # » n'est plus là, ruling 3).
  expect(await armed(page)).toBe(true);
  const capsule = page.locator("[data-capsule]");
  await expect(capsule).toHaveAttribute("data-state", "locked");
  await capsule.evaluate((el) => ((window as unknown as { __cap: Element }).__cap = el));

  // M9 : le geste irréversible annoncé avant, relié au bouton ; textes de confiance.
  // Ruling 5 : ouvertures restantes lues par fetchMeta (partage à 3 ouvertures).
  const cost =
    "Ce partage peut être ouvert encore 3\u00a0fois. Ouvrir ce partage compte une ouverture. Recharger la page ou l'ouvrir dans un autre onglet de ce navigateur n'en compte pas d'autre pendant 30\u00a0minutes.";
  await expect(page.getByText(cost)).toBeVisible();
  await expect(unlockButton(page)).toHaveAccessibleDescription(cost);
  await expect(page.getByText("Le serveur ne reçoit que des données chiffrées, jamais la clé.")).toBeVisible();
  await expect(page.getByText(`${PW_TRIES} essais ratés, et le partage est détruit.`)).toBeVisible();
  await expect(page.locator("[data-deadline] .left")).toHaveText(/^\d+\sh/);
  await expect(page.getByText("Disponible encore")).toHaveCount(0);
  // Mot de passe vide : bouton désactivé.
  await expect(unlockButton(page)).toBeDisabled();
  // Attributs de saisie (UI §12.3), hors de tout <form>.
  const f = pwField(page);
  await expect(f).toHaveAttribute("type", "password");
  await expect(f).toHaveAttribute("autocomplete", "one-time-code");
  await expect(f).toHaveAttribute("spellcheck", "false");
  await expect(f).toHaveAttribute("autocapitalize", "off");
  await expect(f).toHaveAttribute("enterkeyhint", "go");
  expect(await page.locator("form").count()).toBe(0);
  // Navigation privée (demande du propriétaire) : repliée, Safari, Chrome, Firefox.
  await page.getByText("Pour laisser moins de traces, ouvrez ce lien en navigation privée").click();
  for (const b of ["Safari", "Chrome", "Firefox"]) await expect(page.getByText(new RegExp(`^${b}\\s:`))).toBeVisible();
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await capture(page, "open");

  // Le lien rouvert deux fois sans déverrouiller (recharger ne le peut pas : le « # » est déjà
  // retiré, la page revient à l'accueil) : aucune ouverture consommée. La confirmation de sortie
  // (ruling 3) est acceptée ici, comme le ferait la personne.
  page.on("dialog", (d) => void (d.type() === "beforeunload" ? d.accept() : d.dismiss()));
  await page.reload();
  await expect(title).toHaveCount(0);
  for (let k = 0; k < 2; k++) {
    await page.goto("about:blank");
    await page.goto(sent.link);
    await expect(title).toBeVisible();
  }
  expect((await shareStatus(sent.manage, shh.origin)).opensUsed).toBe(0);
  await capsule.evaluate((el) => ((window as unknown as { __cap: Element }).__cap = el));

  for (const left of [4, 3]) {
    await pwField(page).fill("pas-le-bon-mot-de-passe");
    await unlockButton(page).click();
    await expect(page.locator("#open-err").getByText(`Mot de passe incorrect · ${left} essais restants`)).toBeVisible({ timeout: 20_000 });
  }
  await expect(pwField(page)).toBeFocused();
  await expect(pwField(page)).toHaveValue("pas-le-bon-mot-de-passe");
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await capture(page, "open-badpw");

  await unlock(page, sent.password);
  await expect(noteRow(page)).toBeVisible();
  // M6 : même élément, de « locked » à « open », sans remontage.
  await expect(capsule).toHaveAttribute("data-state", "open");
  expect(await capsule.evaluate((el) => el === (window as unknown as { __cap: Element }).__cap)).toBe(true);
  expect((await shareStatus(sent.manage, shh.origin)).opensUsed).toBe(1);
  // Le mot de passe n'est plus nulle part dans la page.
  expect(await page.content()).not.toContain(sent.password);
  // Aucun bandeau, aucune offre, aucune requête hors de l'origine (gardes de la fixture).
  expect(await page.locator("iframe").count()).toBe(0);
  expect(api.filter((p) => !/^(GET \/api\/shares\/meta|POST \/api\/shares\/unlock|GET \/api\/shares\/segments\/\d+|POST \/api\/shares\/done|GET \/api\/shares\/watch)$/.test(p))).toEqual([]);
});

test("cinq mauvais mots de passe → « Le partage a été détruit. », partage absent en Node", async ({ page, shh, browser }) => {
  test.setTimeout(150_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT });
  await s.ctx.close();
  await page.goto(sent.link);
  for (let k = PW_TRIES - 1; k >= 1; k--) {
    await pwField(page).fill("faux-" + k);
    await unlockButton(page).click();
    await expect(page.locator("#open-err").getByText(new RegExp(`Mot de passe incorrect · ${k}\\s(essai|essais) restants?`))).toBeVisible({ timeout: 20_000 });
  }
  await expect(page.getByText("Au prochain échec, le partage sera détruit.")).toBeVisible();
  await pwField(page).fill("faux-0");
  await unlockButton(page).click();
  await expect(page.getByRole("heading", { name: "Mot de passe incorrect. Le partage a été détruit." })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("[data-capsule]")).toHaveAttribute("data-state", "destroyed");
  await expect(fetchMeta(sent.link, shh.origin)).rejects.toBeInstanceOf(NotFoundError);
});

test("clé mal formée (« # » abîmé) → « Lien incomplet », aucune requête /api/ ; « # » retiré", async ({ page, shh }) => {
  const api = apiPaths(page);
  // 43 caractères, mais encodage non canonique (bits de bourrage) : parseLink refuse localement.
  await page.goto(`${shh.origin}/#${"A".repeat(42)}B`);
  await expect(page.getByRole("heading", { name: "Ce lien est incomplet. Rouvrez-le depuis le message d'origine." })).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  expect(api).toEqual([]);
  expect(await axe(page)).toEqual([]);
});

test("lien coupé (fragment de 20 à 44 caractères qui n'est pas une clé) → « Lien incomplet » expliqué, aucune requête ; « # » retiré (ruling 2)", async ({ page, shh }) => {
  const api = apiPaths(page);
  for (const frag of ["Lr97TWFReo303xtSXonjjKhgrah", `m${"A".repeat(30)}`, "A".repeat(44)]) {
    await page.goto(`${shh.origin}/#${frag}`);
    await expect(page.getByRole("heading", { name: "Ce lien est incomplet. Rouvrez-le depuis le message d'origine." })).toBeVisible();
    await expect(page.getByText("Il manque une partie du lien", { exact: false })).toBeVisible();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  }
  // Une ancre courte reste l'accueil.
  await page.goto(`${shh.origin}/#contenu`);
  await expect(page.getByRole("heading", { name: "Ce lien est incomplet. Rouvrez-le depuis le message d'origine." })).toHaveCount(0);
  expect(api).toEqual([]);
  await page.goto(`${shh.origin}/#Lr97TWFReo303xtSXonjjKhgrah`);
  await expect(page.getByText("Il manque une partie du lien", { exact: false })).toBeVisible();
  await capture(page, "incomplete-truncated");
});

test("lien inconnu → « Lien invalide » (message unique), sans phrase de démo ; capture", async ({ page, shh }) => {
  const key = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => i * 7)).toString("base64url");
  await page.goto(`${shh.origin}/#${key}`);
  await expect(page.getByRole("heading", { name: "Ce lien n'existe pas ou n'est plus disponible." })).toBeVisible();
  await expect(page.locator(".demo-note")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Envoyer quelque chose" })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await capture(page, "invalid");
});

test("compte à rebours dépassé sur l'écran verrouillé → « Lien invalide », sans requête", async ({ page, shh, browser }) => {
  test.setTimeout(120_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT });
  await s.ctx.close();
  await page.clock.install();
  await page.goto(sent.link);
  await expect(pwField(page)).toBeVisible();
  const api = apiPaths(page);
  await page.clock.fastForward("12:30:00");
  await expect(page.getByRole("heading", { name: "Ce lien n'existe pas ou n'est plus disponible." })).toBeVisible();
  expect(api).toEqual([]);
});

test.describe("navigateur intégré (Instagram)", () => {
  test.use({ userAgent: INSTAGRAM, viewport: { width: 390, height: 844 } });

  test("bandeau, # gardé, « Copier le lien » donne le lien avec sa clé ; « Continuer ici » l'efface ; capture", async ({ page, shh, browser, context }) => {
    test.setTimeout(120_000);
    const s = await freshPage(browser);
    const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT });
    await s.ctx.close();
    await grantClipboard(context, shh.origin);
    const api = apiPaths(page);
    await page.goto(sent.link);
    await expect(page.getByText(/^Vous êtes dans le navigateur intégré de Instagram/)).toBeVisible();
    await expect(pwField(page)).toHaveCount(0);
    expect(await page.evaluate(() => location.hash)).toBe(new URL(sent.link).hash);
    expect(api).toEqual([]);
    await page.getByRole("button", { name: "Copier le lien" }).click();
    expect(await readClipboard(page)).toBe(sent.link);
    expect(await axe(page)).toEqual([]);
    await capture(page, "open-inapp");
    await page.getByRole("button", { name: "Continuer ici quand même" }).click();
    await expect(pwField(page)).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe("");
  });
});

test.describe("390 × 844", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("écran verrouillé au téléphone : pas de défilement horizontal ; capture", async ({ page, shh, browser }) => {
    test.setTimeout(120_000);
    const s = await freshPage(browser);
    const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT });
    await s.ctx.close();
    await page.goto(sent.link);
    await expect(pwField(page)).toBeVisible();
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(page, "open-390");
  });
});
