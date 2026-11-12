// Historique local des envois et tableau de bord « Vos envois » (spec §33, §33.1 ; UI §9.6 ;
// Task H), sur le vrai serveur. Preuves : rien en clair dans IndexedDB, clé non extractible ;
// l'accueil ne fait aucune requête ; relecture seulement à la demande et au plus une fois par
// 5 min ; ouverture vue avec son intervalle ; Détruire ; filtres ; expiré ; effacer ; bascule
// désactivée ; hors ligne ; stockage refusé (navigation privée stricte). Captures 1440 et 390.
import { mkdirSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { NotFoundError, fetchMeta } from "../src/index";
import { axe, capture, expect, test } from "./fixtures";
import { freshPage, sendShare, unlock } from "./open-helpers";

const SHOTS = "/tmp/claude-0/-home-user/b97dc3e7-f107-54ba-8c5b-d4198f88d7ff/scratchpad/captures-envois";

async function shot(page: Page, name: string, isMobile: boolean) {
  await capture(page, name);
  if (process.env.HIST_SHOTS === "1") {
    mkdirSync(SHOTS, { recursive: true });
    // Téléphone : captures à 390 px de large (le projet émule un Pixel 7, 412 px).
    const vp = page.viewportSize();
    if (isMobile && vp) await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${SHOTS}/${name}-${isMobile ? "390" : "1440"}.png`, fullPage: true });
    if (isMobile && vp) await page.setViewportSize(vp);
  }
}

/** Requêtes de relecture d'état (GET /api/manage/status) vues par le serveur. */
function statusCalls(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/manage/status") seen.push(r.url());
  });
  return seen;
}

/** Confirme un InlineConfirm : sur place (ordinateur) ou dans la feuille du bas (téléphone). */
async function confirm(page: Page, scope: Locator, trigger: string, yes: string) {
  await scope.getByRole("button", { name: trigger, exact: true }).first().click();
  // Téléphone : la question monte dans une feuille (dialog) ; ordinateur : elle remplace le bouton.
  // Dans les deux cas, le bouton de confirmation est dans le groupe de la question.
  const yesBtn = (root: Page | Locator) => root.getByRole("group").getByRole("button", { name: yes, exact: true });
  await yesBtn(page.getByRole("dialog")).or(yesBtn(scope)).filter({ visible: true }).first().click();
}

async function finish(page: Page) {
  await confirm(page, page.locator(".ready"), "Terminé", "Terminer");
  await expect(page.getByRole("heading", { name: "Lien prêt" })).toBeHidden();
}

const card = (page: Page) => page.locator("[data-share-card]");
const keepSwitch = (page: Page) => page.getByRole("switch", { name: "Garder dans mon historique" });

/** Contenu brut de la base de l'historique, en texte, et propriétés de la clé. */
const rawDb = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ text: string; extractable: boolean | null; algo: string; count: number }>((ok, ko) => {
        const r = indexedDB.open("shhdrop-history");
        r.onerror = () => ko(r.error);
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction(["meta", "entries"], "readonly");
          const parts: string[] = [];
          const k = tx.objectStore("meta").get("key");
          const all = tx.objectStore("entries").getAll();
          const keys = tx.objectStore("entries").getAllKeys();
          tx.oncomplete = () => {
            for (const rec of all.result as { iv: Uint8Array; ct: Uint8Array }[]) {
              for (const b of [rec.iv, rec.ct]) parts.push(String.fromCharCode(...b), [...b].map((x) => x.toString(16).padStart(2, "0")).join(""));
            }
            parts.push(...(keys.result as string[]));
            const key = k.result as CryptoKey | undefined;
            ok({ text: parts.join("\n"), extractable: key ? key.extractable : null, algo: key ? JSON.stringify(key.algorithm) : "", count: all.result.length });
            db.close();
          };
        };
      }),
  );

test.describe("fr-FR", () => {
  test.use({ locale: "fr-FR", timezoneId: "Europe/Paris" });

  test("envoi → historique chiffré ; accueil « Vos partages actifs » sans requête ; /envois ; ouverture vue après Actualiser ; Détruire ; filtres ; effacer", async ({ page, shh, browser, isMobile }) => {
    test.setTimeout(180_000);
    await page.clock.install();
    const calls = statusCalls(page);
    // Repère cherché dans la base : long et hors de l'alphabet hexadécimal, il ne peut pas surgir par
    // hasard de l'hex des octets chiffrés (« 4471 » y tombait parfois), ni, en pratique, de leurs octets bruts.
    const MARK = "REPERE-HISTORIQUE-QZWXKJ";
    const sent = await sendShare(page, shh.origin + "/", { text: `Le code de la porte est ${MARK}.`, isMobile });
    // « Lien prêt » : bascule activée par défaut (Q-H2), avec sa phrase honnête.
    await expect(keepSwitch(page)).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("jamais le lien de partage ni le mot de passe", { exact: false })).toBeVisible();
    await expect.poll(async () => (await rawDb(page)).count).toBe(1);

    // Rien en clair dans IndexedDB : ni S_gestion, ni K_lien, ni mot de passe ; clé non extractible.
    const raw = await rawDb(page);
    const secret = sent.manage.split("#m")[1]!;
    expect(secret).toHaveLength(43);
    for (const s of [secret, sent.link.split("#")[1]!, sent.password, "127.0.0.1", MARK, "Note", "createdAt"]) expect(raw.text).not.toContain(s);
    expect(raw.extractable).toBe(false);
    expect(raw.algo).toBe('{"name":"AES-GCM","length":256}');
    await finish(page);

    // Accueil : la bande, sans aucune requête au chargement.
    await page.goto(shh.origin + "/");
    const strip = page.locator("[data-active-shares]");
    await expect(strip.getByRole("heading", { name: "Vos partages actifs" })).toBeVisible();
    await expect(strip.locator("[data-share-card]")).toHaveCount(1);
    await expect(strip).toContainText("Ouvert 0 / 1");
    await expect(strip).toContainText("1 élément");
    await expect(strip.getByRole("button", { name: "Détruire" })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(calls).toEqual([]);
    await page.waitForTimeout(400);
    await shot(page, "home-active-shares", isMobile);

    // « Tout voir (1) » → /envois : état local d'abord ; partage lu il y a moins de 5 min → aucune requête.
    await strip.getByRole("link", { name: "Tout voir (1)" }).click();
    await expect(page).toHaveURL(/\/envois$/);
    await expect(page.getByRole("heading", { level: 1, name: "Mes partages" })).toBeVisible();
    await expect(page).toHaveTitle("Mes partages · Shhgone");
    await expect(page.locator("[data-counts]")).toHaveText("1 actif · 0 terminé");
    await expect(card(page)).toHaveCount(1);
    await expect(card(page)).toContainText(/Créé (à l'instant|il y a \d+ min) · \d+ nov\., \d+ h \d\d/);
    await expect(card(page).locator("[data-state-chip]")).toHaveText("Actif");
    await expect(card(page)).toContainText(/Expire dans \d+ h/);
    const body = await page.evaluate(() => document.body.innerText);
    expect(body).not.toContain(secret);
    expect(body).not.toContain(sent.password);
    await page.waitForTimeout(4500);
    expect(calls).toEqual([]);
    expect(await axe(page)).toEqual([]);
    await shot(page, "history", isMobile);

    // Le destinataire ouvre, dans un autre contexte.
    const r = await freshPage(browser);
    await r.page.goto(sent.link);
    await unlock(r.page, sent.password);
    await r.ctx.close();

    // « Actualiser » avant 5 min : refusé sur place, aucune requête ; après 5 min : relu.
    await card(page).getByRole("button", { name: "Détails" }).click();
    await expect(card(page).locator("[data-fresh]")).toContainText("nouvelle relecture possible dans");
    expect(calls).toEqual([]);
    await page.clock.fastForward("05:01");
    await card(page).getByRole("button", { name: "Actualiser" }).click();
    await expect(card(page)).toContainText("Ouvert 1 / 1", { timeout: 15_000 });
    expect(calls).toHaveLength(1);
    await expect(card(page)).toContainText(/Ouvert entre \d+ h \d\d et \d+ h \d\d · 1 \/ 1/);
    await expect(card(page).locator("[data-state-chip]")).toHaveText(/Toutes les ouvertures utilisées|Actif/);
    await shot(page, "history-details", isMobile);

    // Détruire en un geste (confirmation sur place) → « Détruit », reçu ; le serveur ne l'a plus.
    await confirm(page, card(page), "Détruire", "Détruire");
    await expect(card(page).locator("[data-state-chip]")).toHaveText("Détruit");
    await expect(card(page).locator("[data-receipt]")).toBeVisible();
    await expect.poll(async () => fetchMeta(sent.link, shh.origin).then(() => "vivant", (e) => (e instanceof NotFoundError ? "supprimé" : String(e)))).toBe("supprimé");
    await expect(page.locator("[data-counts]")).toHaveText("0 actif · 1 terminé");
    await page.waitForTimeout(500);
    await shot(page, "history-destroy", isMobile);

    // Filtres : Actifs vide, Terminés montre la carte.
    const filters = page.getByRole("radiogroup", { name: "Afficher" });
    await filters.getByText("Actifs", { exact: true }).click();
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByText("Aucun partage dans ce filtre.")).toBeVisible();
    await filters.getByText("Terminés", { exact: true }).click();
    await expect(card(page)).toHaveCount(1);

    // Accueil : plus de partage actif → aucune bande.
    await page.goto(shh.origin + "/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-active-shares]")).toHaveCount(0);

    // Effacer l'historique → état vide, honnête, avec « Envoyer quelque chose ».
    await page.goto(shh.origin + "/envois");
    await confirm(page, page.locator(".hist .foot"), "Effacer l'historique", "Effacer");
    await expect(page.locator("[data-history-empty]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Aucun envoi pour l'instant" })).toBeVisible();
    await expect(page.getByText("sur cet appareil seulement", { exact: false }).first()).toBeVisible();
    await expect.poll(async () => (await rawDb(page)).count).toBe(0);
    expect(await axe(page)).toEqual([]);
    await shot(page, "history-empty", isMobile);
    await page.getByRole("link", { name: "Envoyer quelque chose" }).click();
    await expect(page).toHaveURL(/\/envoyer$/);
    expect(calls).toHaveLength(1);
  });

  test("partage expiré (horloge avancée) : « Expiré » sans requête, retiré 7 jours après ; hors ligne : « non mis à jour »", async ({ page, shh, context, isMobile }) => {
    test.setTimeout(150_000);
    await page.clock.install();
    const calls = statusCalls(page);
    await sendShare(page, shh.origin + "/", { text: "Bonjour", isMobile });
    await expect.poll(async () => (await rawDb(page)).count).toBe(1);
    await finish(page);

    // Hors ligne, après 5 min : la relecture échoue → dernier état connu, « non mis à jour ».
    await page.goto(shh.origin + "/envois");
    await expect(card(page)).toHaveCount(1);
    await page.clock.fastForward("05:01");
    await context.setOffline(true);
    await card(page).getByRole("button", { name: "Détails" }).click();
    for (let i = 0; i < 12 && !(await card(page).locator("[data-stale]").isVisible()); i++) {
      await page.clock.fastForward("00:05");
      await page.waitForTimeout(250);
    }
    await expect(card(page).locator("[data-stale]")).toContainText("non mis à jour");
    await expect(card(page)).toContainText("Ouvert 0 / 1");
    await context.setOffline(false);

    // Échéance passée : expiré, calculé sur place, sans requête.
    const before = calls.length;
    await page.clock.fastForward(25 * 3600_000);
    await page.goto(shh.origin + "/envois");
    await expect(card(page).locator("[data-state-chip]")).toHaveText("Expiré");
    await expect(card(page)).toContainText("Effacé du serveur à l'échéance.");
    await expect(card(page).getByRole("button", { name: "Retirer de la liste" })).toBeVisible();
    await page.waitForTimeout(4500);
    expect(calls.length).toBe(before);
    await shot(page, "history-expired", isMobile);

    // 7 jours après la fin : retiré seul.
    await page.clock.fastForward(170 * 3600_000);
    await page.goto(shh.origin + "/envois");
    await expect(page.locator("[data-history-empty]")).toBeVisible();
  });

  test("lien de gestion #m… : relecture puis « Supprimer maintenant » → l'entrée de l'historique passe à « Détruit » (test d'intrusion du 11 novembre)", async ({ page, shh, isMobile }) => {
    test.setTimeout(150_000);
    const sent = await sendShare(page, shh.origin + "/", { text: "Bonjour", isMobile });
    await expect.poll(async () => (await rawDb(page)).count).toBe(1);
    await finish(page);
    await page.goto(sent.manage);
    await expect(page.getByRole("heading", { level: 1, name: "Suivi du partage" })).toBeVisible();
    await expect(page.locator("[data-read-at]")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Supprimer maintenant" }).click();
    await page.getByRole("button", { name: "Supprimer", exact: true }).filter({ visible: true }).last().click();
    await expect(page.getByRole("heading", { level: 1, name: "Supprimé" })).toBeVisible({ timeout: 15_000 });
    await page.goto(shh.origin + "/envois");
    await expect(card(page)).toHaveCount(1);
    await expect(card(page).locator("[data-state-chip]")).toHaveText("Détruit");
    await expect(page.locator("[data-counts]")).toHaveText("0 actif · 1 terminé");
    // Aucune entrée nouvelle : toujours un seul enregistrement.
    expect((await rawDb(page)).count).toBe(1);
  });

  test("bascule désactivée sur « Lien prêt » : aucune entrée, aucune bande ; /envois dit « désactivé » et propose de l'activer", async ({ page, shh, isMobile }) => {
    test.setTimeout(120_000);
    await sendShare(page, shh.origin + "/", { text: "Rien à garder", isMobile });
    await expect(keepSwitch(page)).toHaveAttribute("aria-checked", "true");
    await keepSwitch(page).click();
    await expect(keepSwitch(page)).toHaveAttribute("aria-checked", "false");
    await expect.poll(async () => (await rawDb(page)).count).toBe(0);
    await finish(page);
    await page.goto(shh.origin + "/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-active-shares]")).toHaveCount(0);
    await page.goto(shh.origin + "/envois");
    await expect(page.getByRole("heading", { name: "L'historique est désactivé" })).toBeVisible();
    await page.getByRole("button", { name: "L'activer pour les prochains envois" }).click();
    await expect(page.getByRole("heading", { name: "Aucun envoi pour l'instant" })).toBeVisible();
    // Le prochain envoi est gardé.
    await sendShare(page, shh.origin + "/", { text: "Celui-ci, oui", isMobile });
    await expect(keepSwitch(page)).toHaveAttribute("aria-checked", "true");
    await expect.poll(async () => (await rawDb(page)).count).toBe(1);
  });

  test("stockage refusé (navigation privée stricte, IndexedDB absent) : le site marche sans historique, et le dit", async ({ page, shh, isMobile }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      Object.defineProperty(window, "indexedDB", {
        configurable: true,
        get() {
          throw new DOMException("refusé", "SecurityError");
        },
      });
    });
    const sent = await sendShare(page, shh.origin + "/", { text: "Sans historique", isMobile });
    expect(sent.manage).toMatch(/#m[A-Za-z0-9_-]{43}$/);
    await expect(page.locator("[data-keep-unavailable]")).toHaveText(/Historique indisponible dans ce navigateur .*gardez vous-même le lien de gestion\./);
    await expect(keepSwitch(page)).toHaveCount(0);
    await finish(page);
    await page.goto(shh.origin + "/envois");
    await expect(page.getByRole("heading", { name: "Historique indisponible dans ce navigateur" })).toBeVisible();
    await expect(page.getByText("Le site marche quand même", { exact: false })).toBeVisible();
    await page.goto(shh.origin + "/");
    await expect(page.getByRole("heading", { level: 1, name: "Un lien, un mot de passe, puis plus rien." })).toBeVisible();
    await expect(page.locator("[data-active-shares]")).toHaveCount(0);
  });
});

test.describe("en-US", () => {
  test.use({ locale: "en-US", timezoneId: "America/New_York" });
  test("My shares : textes anglais, pied de page", async ({ page, shh, isMobile }) => {
    await page.goto(shh.origin + "/envois");
    await expect(page.getByRole("heading", { level: 1, name: "My shares" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nothing sent yet" })).toBeVisible();
    const foot = page.locator("footer.foot").getByRole("link", { name: "My shares", exact: true });
    await expect(foot).toHaveAttribute("aria-current", "page");
    // Une simple visite (accueil, « Vos envois ») ne crée aucune base dans le navigateur.
    await page.goto(shh.origin + "/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(500);
    expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
    void isMobile;
  });
});
