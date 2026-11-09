// Fin de vie chez le destinataire (Task 24, UI §9.8 pied, §9.10 ; benchmark M10, S4, M6) et
// gestion minimale par l'expéditeur (UI §9.6), sur le vrai serveur.
import { NotFoundError, fetchMeta } from "../src/index";
import { axe, capture, expect, test } from "./fixtures";
import { freshPage, noteRow, sendShare, settle, unlock } from "./open-helpers";

const TEXT = "Repère de fin de vie 5e1b : le code est 8812.";
test.use({ locale: "fr-FR" });

async function opened(browser: import("@playwright/test").Browser, origin: string, opens = 3) {
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, origin + "/", { text: TEXT, opens });
  await s.ctx.close();
  return sent;
}

test("Détruire (dernière ouverture permise) : pied séparé par un filet, confirmation, reçu après la réponse seulement, capsule en pointillés ; captures", async ({ page, shh, browser }) => {
  test.setTimeout(150_000);
  const sent = await opened(browser, shh.origin, 1);
  await page.goto(sent.link);
  await unlock(page, sent.password);

  // M10 : dernier groupe du contenu, précédé d'un filet, style secondaire, libellé exact.
  const eol = page.locator("[data-eol]");
  expect(await eol.evaluate((e) => e === e.parentElement?.lastElementChild)).toBe(true);
  expect(await eol.evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe("solid");
  const destroy = page.getByRole("button", { name: "Détruire ce partage", exact: true });
  await expect(destroy).toHaveClass(/ghost/);
  await expect(page.getByText("Vous êtes la dernière personne à ouvrir ce partage. Il sera supprimé quand vous quitterez cette page. Vous pouvez aussi le détruire maintenant.")).toBeVisible();

  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/shares/destroy", async (r) => {
    await held;
    await r.continue();
  });
  await destroy.click();
  await expect(page.getByText("Détruire ce partage pour tout le monde ? C'est immédiat et définitif.")).toBeVisible();
  await settle(page);
  await capture(page, "destroy-confirm");
  await page.getByRole("button", { name: "Détruire", exact: true }).click();
  await page.waitForTimeout(800);
  await expect(page.locator("[data-receipt]")).toHaveCount(0); // rien avant la réponse
  await expect(noteRow(page, TEXT)).toBeVisible();
  release();

  await expect(page.getByRole("heading", { name: "Détruit" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^Ce partage a été détruit\. Il a été effacé du serveur\./)).toBeVisible();
  const receipt = page.locator("[data-receipt]");
  await expect(receipt).toContainText("Effacé du serveur : le contenu chiffré et son entrée.");
  await expect(receipt).toContainText("Pas concerné : ce qui a été enregistré sur un appareil.");
  expect(await receipt.evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/JetBrains Mono/);
  await expect(page.locator("[data-capsule]")).toHaveAttribute("data-state", "destroyed");
  expect(await page.content()).not.toContain("5e1b");
  await expect(page.getByText(/il n'existe plus nulle part/i)).toHaveCount(0);
  await expect(fetchMeta(sent.link, shh.origin)).rejects.toBeInstanceOf(NotFoundError);
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await capture(page, "destroyed");
});

test("429 pendant Détruire : « Trop de demandes, réessayez dans un instant », rien d'effacé ; puis Détruire réussit (ruling 7)", async ({ page, shh, browser }) => {
  test.setTimeout(150_000);
  const sent = await opened(browser, shh.origin, 1);
  await page.goto(sent.link);
  await unlock(page, sent.password);
  let limited = true;
  await page.route("**/api/shares/destroy", async (r) => {
    if (!limited) return r.continue();
    await r.fulfill({ status: 429, contentType: "application/json", headers: { "Retry-After": "1" }, body: '{"error":"limit","retry_after_s":1}' });
  });
  await page.getByRole("button", { name: "Détruire ce partage", exact: true }).click();
  await page.getByRole("button", { name: "Détruire", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Trop de demandes, réessayez dans un instant." })).toBeVisible({ timeout: 20_000 });
  await expect(noteRow(page, TEXT)).toBeVisible();
  await expect(page.locator("[data-receipt]")).toHaveCount(0);
  limited = false;
  await page.getByRole("button", { name: "Détruire ce partage", exact: true }).click();
  await page.getByRole("button", { name: "Détruire", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Détruit" })).toBeVisible({ timeout: 20_000 });
});

test("maxOpens = 1 (draining) : Détruire fonctionne quand même", async ({ page, shh, browser }) => {
  test.setTimeout(150_000);
  const sent = await opened(browser, shh.origin, 1);
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await page.getByRole("button", { name: "Détruire ce partage", exact: true }).click();
  await page.getByRole("button", { name: "Détruire", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Détruit" })).toBeVisible({ timeout: 20_000 });
  await expect(fetchMeta(sent.link, shh.origin)).rejects.toBeInstanceOf(NotFoundError);
});

test("Signaler : feuille sans motif, corps fixe { proof, reason: \"report\" }, détruit ; capture", async ({ page, shh, browser }) => {
  test.setTimeout(150_000);
  const sent = await opened(browser, shh.origin, 3);
  await page.goto(sent.link);
  await unlock(page, sent.password);
  const bodies: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/shares/destroy") bodies.push(r.postData() ?? "");
  });
  // Retours UI7 : « Signaler » n'existe que dans le pied de page ; sur un partage ouvert, il ouvre
  // la confirmation de CE partage (même action qu'avant).
  await expect(page.locator("main").getByRole("button", { name: /Signaler/ })).toHaveCount(0);
  await page.locator("footer[data-foot]").getByRole("button", { name: "Signaler ce partage" }).click();
  const sheet = page.getByRole("dialog", { name: "Signaler ce contenu" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(/PHAROS/)).toBeVisible();
  expect(await sheet.locator("input, textarea, select, [role=radio]").count()).toBe(0);
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await capture(page, "report-sheet");
  await sheet.getByRole("button", { name: "Signaler et détruire" }).click();
  await expect(page.getByRole("heading", { name: "Détruit" })).toBeVisible({ timeout: 20_000 });
  expect(bodies).toHaveLength(1);
  expect(Object.keys(JSON.parse(bodies[0]!)).sort()).toEqual(["proof", "reason"]);
  expect(JSON.parse(bodies[0]!).reason).toBe("report");
  await expect(fetchMeta(sent.link, shh.origin)).rejects.toBeInstanceOf(NotFoundError);
});

test("ouverture non dernière : ni « Détruire » ni « Terminer » ; « Ce lien peut encore être ouvert 2 fois. » ; « Signaler » dans le pied de page", async ({ page, shh, browser }) => {
  test.setTimeout(150_000);
  const sent = await opened(browser, shh.origin, 3);
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await expect(page.locator("[data-eol]")).toHaveText("Ce lien peut encore être ouvert 2\u202ffois.");
  await expect(page.getByRole("button", { name: /^Détruire/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Terminer|J'ai fini/ })).toHaveCount(0);
  await expect(page.locator("header.top").getByRole("button", { name: /Signaler/ })).toHaveCount(0);
  const report = page.locator("footer[data-foot]").getByRole("button", { name: "Signaler ce partage" });
  await expect(report).toBeVisible();
  expect((await fetchMeta(sent.link, shh.origin)).opensLeft).toBe(2);
});

test("gestion (#m…) : état, ouvertures, Supprimer maintenant → « Supprimé » ; captures", async ({ page, shh, browser }) => {
  test.setTimeout(150_000);
  const sent = await opened(browser, shh.origin, 3);
  await page.goto(sent.manage);
  await expect(page.getByRole("heading", { name: "Suivi du partage" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await expect(page.getByText(/^Ouvert 0 \/ 3$/)).toBeVisible();
  await expect(page.locator("[data-deadline]")).toContainText(/^Se termine le \d+\s\S+ à \d+\sh\s\d{2}/);
  await expect(page.locator("[data-rim-offset]")).toHaveAttribute("data-notches", "3");
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await capture(page, "manage");
  await page.getByRole("button", { name: "Supprimer maintenant" }).click();
  await page.getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Supprimé" })).toBeVisible({ timeout: 20_000 });
  await expect(fetchMeta(sent.link, shh.origin)).rejects.toBeInstanceOf(NotFoundError);
  await settle(page);
  await capture(page, "manage-gone");
});
