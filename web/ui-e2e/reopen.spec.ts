// Rechargement et onglets multiples sans ouverture de plus (spec §41.4, UI §9.7.1 ; plan,
// amendement v2.9) sur le vrai serveur. Le décompte vient de shareStatus en Node.
import type { Page } from "@playwright/test";
import { shareStatus } from "../src/index";
import { axe, capture, expect, test } from "./fixtures";
import { freshPage, noteRow, pwField, sendShare, settle, unlock } from "./open-helpers";

const TEXT = "Le code du portail est 2208.";
const reopenTitle = (p: Page) => p.getByRole("heading", { name: "Rouvrir ce partage" });
const reopenButton = (p: Page) => p.getByRole("button", { name: /^(Rouvrir|Déchiffrement)/ });
const incomplete = (p: Page) => p.getByRole("heading", { name: "Ce lien est incomplet. Rouvrez-le depuis le message d'origine." });

async function reopen(page: Page, password: string): Promise<void> {
  await expect(reopenTitle(page)).toBeVisible();
  await pwField(page).fill(password);
  await reopenButton(page).click();
  await expect(page.getByRole("heading", { name: "Contenu du partage" })).toBeVisible({ timeout: 30_000 });
}

const acceptUnload = (page: Page) => page.on("dialog", (d) => void (d.type() === "beforeunload" ? d.accept() : d.dismiss()));

test.use({ locale: "fr-FR" });

test("recharger rouvre sans consommer (1 / 3 avant et après), dix fois ; le onzième demande une nouvelle ouverture ; Terminer efface", async ({ page, shh, browser }) => {
  test.setTimeout(300_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT, opens: 3 });
  await s.ctx.close();
  acceptUnload(page);

  await page.goto(sent.link);
  await expect(page.getByText("Ce partage peut être ouvert encore 3 fois.", { exact: false })).toBeVisible();
  await unlock(page, sent.password);
  expect((await shareStatus(sent.manage, shh.origin)).opensUsed).toBe(1);
  // Seule entrée de l'onglet : shh.og, sans mot de passe.
  const st = await page.evaluate(() => ({ keys: Object.keys(sessionStorage), v: sessionStorage.getItem("shh.og") ?? "" }));
  expect(st.keys).toEqual(["shh.og"]);
  expect(st.v).not.toContain(sent.password);
  expect(Object.keys(JSON.parse(st.v)).sort()).toEqual(["grant", "last", "link", "v"]);

  // Premier rechargement : écran « Rouvrir », mauvais mot de passe compté, puis le bon.
  await page.reload();
  await expect(reopenTitle(page)).toBeVisible();
  await expect(page.getByText("Vous avez déjà déverrouillé ce partage.", { exact: false })).toBeVisible();
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await capture(page, "open-reopen");
  await pwField(page).fill("pas-le-bon-mot-de-passe");
  await reopenButton(page).click();
  await expect(page.locator("#open-err").getByText("Mot de passe incorrect · 4 essais restants")).toBeVisible({ timeout: 20_000 });
  await pwField(page).fill(sent.password);
  await reopenButton(page).click();
  await expect(noteRow(page, TEXT)).toBeVisible({ timeout: 30_000 });
  expect((await shareStatus(sent.manage, shh.origin)).opensUsed).toBe(1);

  // Neuf autres rechargements : toujours une seule ouverture.
  for (let k = 2; k <= 10; k++) {
    await page.reload();
    await reopen(page, sent.password);
  }
  expect((await shareStatus(sent.manage, shh.origin)).opensUsed).toBe(1);

  // Onzième : refusé, dit à l'écran, entrée effacée ; aucune ouverture comptée en silence.
  await page.reload();
  await expect(reopenTitle(page)).toBeVisible();
  await pwField(page).fill(sent.password);
  await reopenButton(page).click();
  await expect(page.getByText("Trop de rechargements : une nouvelle ouverture sera comptée.")).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => sessionStorage.getItem("shh.og"))).toBeNull();
  expect((await shareStatus(sent.manage, shh.origin)).opensUsed).toBe(1);
  await expect(page.getByText("Ce partage peut être ouvert encore 2 fois.", { exact: false })).toBeVisible();

  // Nouvelle ouverture (comptée), puis « Terminer et effacer » : un rechargement redemande le lien.
  await page.getByRole("button", { name: /^(Déverrouiller|Déchiffrement)/ }).click();
  await expect(noteRow(page, TEXT)).toBeVisible({ timeout: 30_000 });
  expect((await shareStatus(sent.manage, shh.origin)).opensUsed).toBe(2);
  await page.getByRole("button", { name: "Terminer et effacer" }).click();
  await expect(noteRow(page, TEXT)).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("shh.og"))).toBeNull();
  await page.reload();
  await expect(incomplete(page)).toBeVisible();
});

test("deuxième onglet : avec le premier ouvert, même ouverture ; sans premier onglet, une de plus, annoncée", async ({ page, shh, browser }) => {
  test.setTimeout(180_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT, opens: 3 });
  await s.ctx.close();

  await page.goto(sent.link);
  await unlock(page, sent.password);
  const tab2 = await page.context().newPage();
  await tab2.goto(sent.link);
  const other = "Ce partage est déjà ouvert dans un autre onglet : l'ouvrir ici ne compte pas une ouverture de plus.";
  await expect(tab2.getByText(other)).toBeVisible();
  await settle(tab2);
  expect(await axe(tab2)).toEqual([]);
  await capture(tab2, "open-othertab");
  await unlock(tab2, sent.password);
  expect((await shareStatus(sent.manage, shh.origin)).opensUsed).toBe(1);
  expect(await tab2.evaluate(() => Object.keys(sessionStorage))).toEqual(["shh.og"]);
  await tab2.close();

  // Autre navigateur (contexte neuf) : aucun onglet ne détient l'ouverture → la phrase annonce
  // la consommation, et le déverrouillage en compte une.
  const c = await freshPage(browser);
  await c.page.goto(sent.link);
  await expect(c.page.getByText("Ce partage peut être ouvert encore 2 fois. Ouvrir ce partage compte une ouverture.", { exact: false })).toBeVisible();
  await expect(c.page.getByText(other)).toHaveCount(0);
  await unlock(c.page, sent.password);
  expect((await shareStatus(sent.manage, shh.origin)).opensUsed).toBe(2);
  await c.ctx.close();
});

test("dernière ouverture prise (draining) : recharger rouvre, le partage reste ; 30 min sans activité → octroi effacé", async ({ page, shh, browser }) => {
  test.setTimeout(180_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT, opens: 1 });
  await s.ctx.close();
  acceptUnload(page);

  await page.clock.install();
  await page.goto(sent.link);
  await unlock(page, sent.password);
  expect(await shareStatus(sent.manage, shh.origin)).toMatchObject({ opensUsed: 1, state: "draining" });
  await page.reload();
  await reopen(page, sent.password);
  expect(await shareStatus(sent.manage, shh.origin)).toMatchObject({ opensUsed: 1, state: "draining" });

  // 30 min sans clic, touche ni défilement : l'entrée de l'onglet est effacée.
  await page.clock.fastForward("31:00");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("shh.og"))).toBeNull();
  await page.reload();
  await expect(incomplete(page)).toBeVisible();
});
