// Suppression à la sortie (D41-28) sur le vrai serveur : binaire de test (étiquette e2etime)
// dont l'attente après « je pars » est ramenée de 3 min à 3 s.
import { NotFoundError, fetchMeta } from "../src/index";
import { BINARY_E2ETIME } from "../e2e/server";
import { expect, test } from "./fixtures";
import { freshPage, pwField, sendShare, unlock } from "./open-helpers";
import { sleep } from "./send-helpers";

test.use({ locale: "fr-FR", shhServer: { binary: BINARY_E2ETIME, env: { SHH_E2E_LEAVE_DELAY: "3" } } });

const TEXT = "Repère de sortie 7c2d.";

test("dernière ouverture : recharger garde le partage ; fermer la page le supprime après l'attente", async ({ page, shh, browser }) => {
  test.setTimeout(120_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT, opens: 1 });
  await s.ctx.close();
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await expect(page.getByText("Il sera supprimé quand vous quitterez cette page.", { exact: false })).toBeVisible();

  // Rechargement : « je pars » part au pagehide (requête keepalive, que Playwright ne voit pas
  // toujours pendant un déchargement), la réouverture par l'octroi l'annule.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Rouvrir ce partage" })).toBeVisible({ timeout: 30_000 });
  await sleep(6_000); // l'écran « Rouvrir » (meta avec l'octroi) suffit à annuler
  await pwField(page).fill(sent.password);
  await page.getByRole("button", { name: "Rouvrir" }).click();
  await expect(page.getByText(TEXT)).toBeVisible({ timeout: 30_000 });
  await sleep(6_000); // deux fois l'attente
  await expect(page.getByText(TEXT)).toBeVisible();

  // Fermer la page : supprimé du serveur après l'attente.
  const ctx = page.context();
  const other = await ctx.newPage(); // garde le contexte ouvert
  await page.close({ runBeforeUnload: true });
  await expect
    .poll(async () => (await fetchMeta(sent.link, shh.origin).then(() => "là", (e: unknown) => (e instanceof NotFoundError ? "introuvable" : String(e)))), {
      timeout: 20_000,
    })
    .toBe("introuvable");
  await other.close();
});

test("ouverture non dernière : fermer la page ne supprime rien", async ({ page, shh, browser }) => {
  test.setTimeout(120_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT, opens: 2 });
  await s.ctx.close();
  let leaves = 0;
  page.context().on("request", (r) => void (r.url().endsWith("/api/shares/leave") && leaves++));
  await page.goto(sent.link);
  await unlock(page, sent.password);
  const other = await page.context().newPage();
  await page.close({ runBeforeUnload: true });
  await sleep(6_000);
  expect(leaves).toBe(0);
  expect((await fetchMeta(sent.link, shh.origin)).opensLeft).toBe(1);
  await other.close();
});
