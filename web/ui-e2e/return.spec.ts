// Retour des personnes qui ont déjà ouvert un partage, jusqu'à l'échéance (D42-22, remplace la
// suppression à la sortie D41-28), sur le vrai serveur. Le décompte vient de shareStatus en Node.
import type { Page } from "@playwright/test";
import { NotFoundError, destroyShare, fetchMeta, shareStatus } from "../src/index";
import { axe, expect, test } from "./fixtures";
import { freshPage, noteRow, pwField, sendShare, settle, unlock } from "./open-helpers";

test.use({ locale: "fr-FR", timezoneId: "Europe/Paris" });

const TEXT = "Repère de retour 7c2d.";
/** Captures (hors dépôt), seulement si AUDIT_SHOTS est donné. */
const SHOTS = process.env.AUDIT_SHOTS;
async function shot(page: Page, name: string, isMobile: boolean) {
  if (!SHOTS) return;
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${name}-${isMobile ? "m390" : "d1440"}.png` });
}

/** Contenu brut de la base des retours (D42-22), lu dans la page. */
function storedReturns(page: Page) {
  return page.evaluate(async () => {
    const dbs = (await indexedDB.databases()).map((d) => d.name);
    if (!dbs.includes("shhdrop-returns")) return { dbs, n: 0, text: "", extractable: [] as (boolean | null)[] };
    const db = await new Promise<IDBDatabase>((ok, ko) => {
      const r = indexedDB.open("shhdrop-returns");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
    const tx = db.transaction(["entries", "meta"], "readonly");
    const all = (n: string) =>
      new Promise<unknown[]>((ok) => {
        const q = tx.objectStore(n).getAll();
        q.onsuccess = () => ok(q.result);
      });
    const entries = await all("entries");
    const meta = await all("meta");
    db.close();
    const text = entries
      .map((e) => {
        const { iv, ct } = e as { iv: Uint8Array; ct: Uint8Array };
        return String.fromCharCode(...iv) + String.fromCharCode(...ct);
      })
      .join("\n");
    return { dbs, n: entries.length, text, extractable: meta.map((k) => (k instanceof CryptoKey ? k.extractable : null)) };
  });
}

async function comeBack(page: Page, link: string, password: string) {
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Rouvrir ce partage" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Vous avez déjà déverrouillé ce partage dans ce navigateur.", { exact: false })).toBeVisible();
  await pwField(page).fill(password);
  await page.getByRole("button", { name: /^(Rouvrir|Déchiffrement)/ }).click();
  await expect(noteRow(page)).toBeVisible({ timeout: 30_000 });
}

test("dernière ouverture : fermer l'onglet puis rouvrir le lien revient sans consommer ; personne d'autre n'entre ; Détruire supprime", async ({ page, shh, browser, isMobile }) => {
  test.setTimeout(180_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT, opens: 1 });
  await s.ctx.close();
  let leaves = 0;
  page.context().on("request", (r) => void (/\/api\/shares\/(leave|regrant)$/.test(r.url()) && leaves++));
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await expect(page.locator("[data-last-top]")).toBeVisible();
  // Rien de lisible dans le stockage du navigateur : ni le mot de passe, ni K_lien, ni l'octroi
  // en clair (seule l'entrée de l'onglet, §41.4, garde K_lien pour le rechargement).
  const key = sent.link.slice(sent.link.indexOf("#") + 1);
  // Écrit juste après le déverrouillage (chiffrement asynchrone) : on attend l'entrée.
  await expect.poll(() => storedReturns(page).then((x) => x.n), { timeout: 10_000 }).toBe(1);
  const stored = await storedReturns(page);
  expect(stored.dbs).toContain("shhdrop-returns");
  expect(stored.extractable).toEqual([false]);
  for (const x of [sent.password, key, "grant", "expiresAt"]) expect(stored.text).not.toContain(x);

  // Onglet fermé, lien rouvert depuis le message dans un nouvel onglet : même ouverture.
  const other = await page.context().newPage();
  await page.close();
  await comeBack(other, sent.link, sent.password);
  expect(await shareStatus(sent.manage, shh.origin)).toMatchObject({ opensUsed: 1, state: "draining" });
  await expect(other.locator("[data-last-top]")).toBeVisible();
  await shot(other, "contenu-derniere-ouverture", isMobile);
  expect(leaves).toBe(0);

  // Autre navigateur (autre appareil, navigation privée) : personne d'autre n'entre ; l'écran le dit.
  const c = await freshPage(browser);
  await c.page.goto(sent.link);
  await expect(c.page.getByRole("heading", { name: "Ce lien n'existe pas ou n'est plus disponible." })).toBeVisible({ timeout: 30_000 });
  await expect(c.page.getByText("Vous l'avez déjà ouvert ? On ne peut y revenir que depuis le même navigateur", { exact: false })).toBeVisible();
  await settle(c.page);
  expect(await axe(c.page)).toEqual([]);
  await shot(c.page, "autre-navigateur", isMobile);
  await c.ctx.close();

  // La dernière personne détruit : supprimé tout de suite, et le retour est oublié.
  const destroy = other.getByRole("button", { name: "Détruire ce partage" });
  await destroy.scrollIntoViewIfNeeded();
  await destroy.click();
  await other.getByRole("button", { name: "Détruire", exact: true }).filter({ visible: true }).click();
  await expect(other.getByRole("heading", { name: "Détruit", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(fetchMeta(sent.link, shh.origin)).rejects.toBeInstanceOf(NotFoundError);
  await other.goto(sent.link);
  await expect(other.getByRole("heading", { name: "Ce lien n'existe pas ou n'est plus disponible." })).toBeVisible({ timeout: 30_000 });
});

test("retour impossible : octroi gardé, partage supprimé entre-temps → écran clair ; ouverture non dernière : rien n'est supprimé au départ", async ({ page, shh, browser, isMobile }) => {
  test.setTimeout(180_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT, opens: 2 });
  await s.ctx.close();
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await expect.poll(() => storedReturns(page).then((x) => x.n), { timeout: 10_000 }).toBe(1);
  const other = await page.context().newPage();
  await page.close();
  expect((await fetchMeta(sent.link, shh.origin)).opensLeft).toBe(1);

  await destroyShare(sent.manage, shh.origin);
  await other.goto(sent.link);
  const lost = other.getByRole("heading", { name: "Impossible de revenir sur ce partage" });
  await expect(lost).toBeVisible({ timeout: 30_000 });
  await expect(other.getByText("Ce navigateur l'avait déjà ouvert, mais le serveur ne le reconnaît plus", { exact: false })).toBeVisible();
  await expect(other).toHaveTitle(/Lien indisponible/);
  await settle(other);
  expect(await axe(other)).toEqual([]);
  await shot(other, "retour-impossible", isMobile);
  // Le retour gardé est oublié : la fois suivante, l'écran ordinaire du lien invalide.
  await other.goto(sent.link);
  await expect(other.getByRole("heading", { name: "Ce lien n'existe pas ou n'est plus disponible." })).toBeVisible({ timeout: 30_000 });
});
