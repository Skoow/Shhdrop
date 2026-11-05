// Composeur (UI §9.2, §9.3), v2 : passage de l'accueil au composeur au premier ajout ; ordinateur
// en deux colonnes ; téléphone (< 760 px) en app : lignes compactes et menu « … », pastilles
// d'ajout qui défilent, barre collée (jauge, Options, Chiffrer et envoyer), options en feuille.
// Captures fr-FR à 1440 × 900 et 390 × 844.
import { closeSync, ftruncateSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { axe, capture, expect, test } from "./fixtures";

const FILES = fileURLToPath(new URL("./files/", import.meta.url));
const f = (name: string) => join(FILES, name);
const MIXED = ["plage-nuit.jpg", "toits-belleville.jpg", "anniversaire-lou.webm", "vocal.ogg", "contrat.pdf"].map(f);

async function open(page: Page, origin: string) {
  await page.goto(origin + "/");
  await expect(page.getByRole("button", { name: "Parcourir les fichiers" })).toBeVisible();
}
/** Choisit des fichiers par « Parcourir les fichiers » (accueil) ou « Fichiers » (composeur). */
async function browse(page: Page, files: string[] | { name: string; mimeType: string; buffer: Buffer }[]) {
  const home = page.getByRole("button", { name: "Parcourir les fichiers" });
  const chooser = page.waitForEvent("filechooser");
  if (await home.isVisible()) await home.click();
  else await page.getByRole("group", { name: "Ajouter" }).getByRole("button", { name: "Fichiers" }).click();
  await (await chooser).setFiles(files as never);
}
async function addText(page: Page, text: string) {
  const inComposer = page.getByRole("group", { name: "Ajouter" });
  if (await inComposer.isVisible()) await inComposer.getByRole("button", { name: "Texte", exact: true }).click();
  else await page.getByRole("group", { name: "Ou créez sur place" }).getByRole("button", { name: "Texte", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Nouveau texte" });
  await dlg.getByLabel("Votre texte").fill(text);
  await dlg.getByRole("button", { name: "Ajouter" }).click();
  await expect(dlg).toBeHidden();
}
const rows = (page: Page) => page.locator("[data-row]");
const names = (page: Page) => page.locator("[data-row] .nm").allTextContents();
const settle = (page: Page) =>
  page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.timeline === document.timeline && a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const send = (page: Page) => page.getByRole("button", { name: "Chiffrer et envoyer" });

/** Les options : la colonne de droite (ordinateur) ou la feuille ouverte par « Options » (téléphone). */
async function options(page: Page, isMobile: boolean): Promise<Locator> {
  if (!isMobile) return page.locator(".side");
  await page.getByRole("button", { name: /^Options · / }).click();
  const dlg = page.getByRole("dialog", { name: "Options" });
  await expect(dlg).toBeVisible();
  return dlg;
}
async function removeItem(page: Page, name: string, isMobile: boolean) {
  if (!isMobile) return page.getByRole("button", { name: `Retirer ${name}` }).click();
  await page.getByRole("button", { name: `Actions pour ${name}` }).click();
  await page.getByRole("dialog", { name }).getByRole("button", { name: "Retirer" }).click();
}
/** Aucun paragraphe de plus de deux lignes (demande du propriétaire, téléphone). */
const longParagraphs = (scope: Locator) =>
  scope.locator("p, .h, .cant").evaluateAll((els) =>
    els
      .filter((e) => (e as HTMLElement).offsetParent !== null && !e.closest(".sr-only, .cnote"))
      .filter((e) => {
        const lh = parseFloat(getComputedStyle(e).lineHeight) || 20;
        return e.getBoundingClientRect().height > lh * 2 + 4;
      })
      .map((e) => e.textContent!.trim()),
  );

test.describe("fr-FR", () => {
  test.use({ locale: "fr-FR" });
  // Téléphone : captures et contrôles à 390 × 844 (largeur de référence de UI §9.1).
  test.beforeEach(async ({ page, isMobile }) => {
    if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
  });

  test("accueil vide, puis Parcourir : transition vers le composeur, 6 éléments en catégories ; axe ; captures", async ({ page, shh, isMobile }) => {
    await open(page, shh.origin);
    await page.waitForTimeout(900);
    await capture(page, "compose-empty");
    await expect(page.locator("input[type=checkbox]")).toHaveCount(0);

    await browse(page, [f("plage-nuit.jpg")]);
    await expect(page.getByRole("heading", { level: 2, name: "Votre envoi" })).toBeFocused();
    await expect(page.getByRole("heading", { level: 2, name: "Comment ça marche" })).toHaveCount(0);
    await browse(page, MIXED.slice(1));
    await addText(page, "Le code de la porte, c'est 4512B. À ce soir !");
    await expect(rows(page)).toHaveCount(6);
    await expect(page.locator(".count")).toHaveText(/^6\séléments · \d/);

    expect(await page.locator(".group h3").allTextContents()).toEqual(["Texte", "Photos", "Vidéos", "Audio et vocaux", "Documents"]);
    await expect(page.getByText("Même les noms de vos fichiers sont chiffrés.")).toBeVisible();
    await expect(page.getByText("Nettoyé", { exact: true })).toHaveCount(0);
    await expect(rows(page).filter({ hasText: "plage-nuit.jpg" }).getByText("Non nettoyé")).toBeVisible();
    await expect(rows(page).filter({ hasText: "plage-nuit.jpg" }).locator("img")).toHaveAttribute("src", /^blob:/);
    await expect(rows(page).filter({ hasText: "anniversaire-lou.webm" }).locator(".meta")).toContainText("1:12");
    await expect(page.getByRole("meter", { name: "Nombre d'éléments" })).toHaveAttribute("aria-valuenow", "6");
    expect(await page.locator(".gauge, .mini").first().evaluate((e) => getComputedStyle(e).fontVariantNumeric)).toContain("tabular-nums");
    await expect(send(page)).toBeEnabled();
    expect(await noHScroll(page)).toBe(true);

    if (isMobile) {
      // App : pas de boutons Renommer / Retirer sur chaque ligne, un menu « … » ; titre d'accueil caché à l'œil.
      await expect(page.getByRole("button", { name: /^Renommer / })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Retirer / })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Actions pour / })).toHaveCount(6);
      await expect(page.locator(".adds.scroll")).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      expect((await page.getByRole("heading", { level: 1 }).boundingBox())!.height).toBeLessThanOrEqual(1);
      await expect(page.getByRole("button", { name: /^Options · 12\sh · 1\souverture · téléchargement autorisé$/ })).toBeVisible();
      expect(await longParagraphs(page.locator("main"))).toEqual([]);
    } else {
      await expect(page.getByText(/^Envoi estimé\s:\senviron\s/)).toBeVisible();
    }
    await settle(page);
    expect(await axe(page)).toEqual([]);
    await capture(page, "compose-filled");

    await send(page).click();
    await expect(page.locator(".cnote").filter({ hasText: "Envoi : prochaine étape." })).toBeVisible();
  });

  test("dépôt de 3 fichiers sur l'accueil fraîchement chargé → composeur ; dossier refusé avec consigne", async ({ page, shh }) => {
    await open(page, shh.origin);
    await page.evaluate(() => {
      const dt = new DataTransfer();
      for (const n of ["a.txt", "b.txt", "c.txt"]) dt.items.add(new File([n], n, { type: "text/plain" }));
      const fire = (type: string) => document.querySelector("main")!.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      fire("dragenter");
      fire("drop");
    });
    await expect(rows(page)).toHaveCount(3);
    await page.evaluate(() => {
      const item = { kind: "file", getAsFile: () => null, webkitGetAsEntry: () => ({ isDirectory: true, name: "Vacances" }) };
      const e = new DragEvent("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(e, "dataTransfer", { value: { types: ["Files"], items: [item], files: [] } });
      document.querySelector("main")!.dispatchEvent(e);
    });
    await expect(page.locator(".cnote")).toContainText("Ajoutez les fichiers eux-mêmes");
    await expect(rows(page)).toHaveCount(3);
  });

  test("mot de passe : boutons dans le champ (Générer un autre, Copier), écrire le sien, Générer un autre le remplace ; raison reliée", async ({ page, shh, isMobile, browserName }) => {
    await open(page, shh.origin);
    await browse(page, [f("contrat.pdf")]);
    const opts = await options(page, isMobile);
    const box = opts.locator(".box");
    const regen = box.getByRole("button", { name: "Générer un autre" });
    const copy = box.getByRole("button", { name: "Copier" });
    await expect(regen).toHaveAttribute("title", "Générer un autre");
    await expect(copy).toHaveAttribute("title", "Copier");
    for (const b of [regen, copy]) {
      const r = (await b.boundingBox())!;
      expect(r.width).toBeGreaterThanOrEqual(44);
      expect(r.height).toBeGreaterThanOrEqual(44);
    }
    const pw = box.locator(".val .sr-only");
    const first = await pw.textContent();
    expect(first).toMatch(/^[a-km-np-zA-HJ-NP-Z2-9!#$%+=?@]{8}$/);
    await regen.click();
    await expect(pw).not.toHaveText(first!);
    await expect(opts.getByText("Un mot de passe en plus du lien. Envoyez-les par deux moyens différents.")).toBeVisible();
    await expect(opts.getByText("5 essais ratés, et le partage est détruit.")).toBeVisible();
    if (browserName === "chromium") {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await copy.click();
      await expect(box.getByRole("button", { name: "Copié" })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await pw.textContent());
    }

    await opts.getByRole("button", { name: "Écrire mon propre mot de passe" }).click();
    const field = opts.getByLabel("Votre mot de passe");
    await expect(field).toBeFocused();
    for (const [k, v] of [["type", "text"], ["autocomplete", "off"], ["autocapitalize", "off"], ["autocorrect", "off"], ["spellcheck", "false"], ["name", "shh-own"]])
      await expect(field).toHaveAttribute(k, v);
    expect(await page.locator("form").count()).toBe(0);
    await field.fill("court");
    const reason = isMobile ? opts.locator("#opt-reason") : page.locator("#send-reason");
    await expect(reason).toHaveText("Le mot de passe doit faire au moins 12 caractères.");
    await field.fill("unbelievable");
    await expect(reason).toHaveText("Ce mot de passe est trop courant. Choisissez-en un autre.");
    await field.fill("court");
    await expect(box.getByRole("button", { name: "Masquer le mot de passe" })).toBeVisible();
    await settle(page);
    expect(await axe(page)).toEqual([]);
    await capture(page, "compose-password-custom");
    if (isMobile) {
      await page.keyboard.press("Escape");
      await expect(send(page)).toBeDisabled();
      await expect(page.locator("#send-reason")).toHaveText("Le mot de passe doit faire au moins 12 caractères.");
      await capture(page, "compose-password-blocked");
      await options(page, isMobile);
    } else {
      await expect(send(page)).toBeDisabled();
      await expect(send(page)).toHaveAttribute("aria-describedby", "send-reason");
    }
    // « Générer un autre » rend un mot de passe généré.
    await box.getByRole("button", { name: "Générer un autre" }).click();
    await expect(box.locator(".val .sr-only")).toHaveText(/^.{8}$/);
    await expect(opts.getByLabel("Votre mot de passe")).toHaveCount(0);
    if (isMobile) await page.keyboard.press("Escape");
    await expect(send(page)).toBeEnabled();
  });

  test("options : 12 h et 1 ouverture par défaut, flèches, phrase à jour ; téléchargement (interrupteur), coffre sur téléphone seulement", async ({ page, shh, isMobile }) => {
    await open(page, shh.origin);
    await browse(page, [f("plage-nuit.jpg")]);
    let opts = await options(page, isMobile);
    const ttl = opts.getByRole("radiogroup", { name: "Durée" });
    const opens = opts.getByRole("radiogroup", { name: "Ouvertures" });
    await expect(ttl.getByRole("radio", { name: "12 h" })).toBeChecked();
    await expect(opens.getByRole("radio", { name: "1", exact: true })).toBeChecked();
    const summary = opts.locator(".summary");
    await expect(summary).toHaveText("S'efface dans 12 h ou après 1 ouverture, au premier des deux.");
    await ttl.getByRole("radio", { name: "12 h" }).focus();
    await page.keyboard.press("ArrowRight");
    await opens.getByRole("radio", { name: "1", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(summary).toHaveText("S'efface dans 24 h ou après 3 ouvertures, au premier des deux.");

    const dl = opts.getByRole("switch", { name: "Autoriser le téléchargement" });
    await expect(dl).toHaveAttribute("aria-checked", "true");
    await expect(dl).toHaveAccessibleDescription("Sans téléchargement, une capture d'écran reste possible.");
    const vault = opts.getByRole("switch", { name: /^Garder une copie chiffrée dans l'app du destinataire/ });
    await expect(vault).toHaveCount(isMobile ? 1 : 0);
    if (isMobile) {
      await vault.click();
      await expect(vault).toHaveAttribute("aria-checked", "true");
    }
    await dl.click();
    await expect(dl).toHaveAttribute("aria-checked", "false");
    await expect(vault).toHaveCount(0);
    await expect(page.locator("input[type=checkbox]")).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
    if (isMobile) {
      await expect(page.getByRole("button", { name: /^Options · 24\sh · 3\souvertures · sans téléchargement$/ })).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: /sans téléchargement$/ })).toBeVisible();
    }

    // Sans téléchargement, une archive ne pourra pas être ouverte : avertissement sur la ligne et dans les options.
    await browse(page, [f("archive.zip")]);
    await expect(rows(page).filter({ hasText: "archive.zip" }).getByText("Ne pourra pas être ouvert sans téléchargement")).toBeVisible();
    await expect(rows(page).filter({ hasText: "plage-nuit.jpg" }).getByText("Ne pourra pas être ouvert sans téléchargement")).toHaveCount(0);
    opts = await options(page, isMobile);
    await expect(opts.getByText("1 élément ne pourra pas être ouvert sans téléchargement.")).toBeVisible();
    await opts.locator(".warn").scrollIntoViewIfNeeded();
    await settle(page);
    await capture(page, "compose-no-download");
    await opts.locator(".warn").getByRole("button", { name: "Autoriser le téléchargement" }).click();
    await expect(opts.getByRole("switch", { name: "Autoriser le téléchargement" })).toHaveAttribute("aria-checked", "true");
    if (isMobile) await page.keyboard.press("Escape");
    await expect(page.getByText("Ne pourra pas être ouvert sans téléchargement")).toHaveCount(0);
  });

  test("retrait et Annuler ; Tout retirer revient à l'accueil, Annuler rouvre le composeur", async ({ page, shh, isMobile }) => {
    await open(page, shh.origin);
    await browse(page, MIXED.slice(0, 2));
    await removeItem(page, "plage-nuit.jpg", isMobile);
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByRole("button", { name: isMobile ? "Actions pour toits-belleville.jpg" : "Retirer toits-belleville.jpg" })).toBeFocused();
    await page.getByRole("group", { name: "plage-nuit.jpg retiré" }).getByRole("button", { name: "Annuler" }).click();
    await expect(rows(page)).toHaveCount(2);
    expect(await names(page)).toEqual(["plage-nuit.jpg", "toits-belleville.jpg"]);
    await page.getByRole("button", { name: "Tout retirer" }).click();
    await expect(page.getByRole("button", { name: "Parcourir les fichiers" })).toBeVisible();
    await page.getByRole("button", { name: "Annuler" }).click();
    await expect(rows(page)).toHaveCount(2);
  });

  test("ordinateur : Alt + ↓, mode déplacement, glisser ; renommage en place (Entrée, Échap) ; doublon", async ({ page, shh, isMobile }) => {
    test.skip(isMobile, "ordinateur : poignées et boutons sur la ligne");
    await open(page, shh.origin);
    await browse(page, MIXED.slice(0, 2));
    const grip = page.getByRole("button", { name: "Déplacer plage-nuit.jpg" });
    await grip.focus();
    await page.keyboard.press("Alt+ArrowDown");
    expect(await names(page)).toEqual(["toits-belleville.jpg", "plage-nuit.jpg"]);
    await expect(page.getByRole("status").filter({ hasText: "plage-nuit.jpg : position 2 sur 2 dans Photos." })).toHaveCount(1);
    await expect(grip).toBeFocused();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(page.getByRole("status")).toHaveText("Dernier de la catégorie");
    await grip.click();
    await page.getByRole("button", { name: "Monter" }).click();
    expect(await names(page)).toEqual(["plage-nuit.jpg", "toits-belleville.jpg"]);
    await page.getByRole("button", { name: "Terminé" }).click();
    const b = (await page.getByRole("button", { name: "Déplacer toits-belleville.jpg" }).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y - 40, { steps: 8 });
    await page.mouse.move(b.x + b.width / 2, b.y - 70, { steps: 4 });
    await page.mouse.up();
    expect(await names(page)).toEqual(["toits-belleville.jpg", "plage-nuit.jpg"]);

    await page.getByRole("button", { name: "Renommer plage-nuit.jpg" }).click();
    const input = page.getByLabel("Nouveau nom de plage-nuit.jpg");
    await expect(input).toHaveValue("plage-nuit");
    await input.fill("autre");
    await page.keyboard.press("Escape");
    expect(await names(page)).toContain("plage-nuit.jpg");
    await page.getByRole("button", { name: "Renommer plage-nuit.jpg" }).click();
    await page.getByLabel("Nouveau nom de plage-nuit.jpg").fill("a/b");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: "Caractère non permis" })).toBeVisible();
    await page.getByLabel("Nouveau nom de plage-nuit.jpg").fill("Plage");
    await page.keyboard.press("Enter");
    expect(await names(page)).toContain("Plage.jpg");
    await browse(page, [f("toits-belleville.jpg")]);
    await expect(page.locator(".badge", { hasText: "En double ?" })).toHaveCount(2);
  });

  test("téléphone : menu « … » (Renommer, Monter, Descendre, Retirer) ; feuille Options : focus piégé, Échap rend le focus", async ({ page, shh, isMobile }) => {
    test.skip(!isMobile, "téléphone : app");
    await open(page, shh.origin);
    await browse(page, MIXED.slice(0, 2));
    const more = page.getByRole("button", { name: "Actions pour plage-nuit.jpg" });
    await more.click();
    const menu = page.getByRole("dialog", { name: "plage-nuit.jpg" });
    await expect(menu.locator(".mi")).toHaveText(["Renommer", "Monter", "Descendre", "Retirer"]);
    await expect(menu.getByRole("button", { name: "Fermer" })).toBeVisible();
    await settle(page);
    await capture(page, "compose-item-menu");
    await menu.getByRole("button", { name: "Descendre" }).click();
    expect(await names(page)).toEqual(["toits-belleville.jpg", "plage-nuit.jpg"]);
    await menu.getByRole("button", { name: "Renommer" }).click();
    const input = menu.getByLabel("Nouveau nom de plage-nuit.jpg");
    await expect(input).toBeFocused();
    await input.fill("Plage");
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    expect(await names(page)).toEqual(["toits-belleville.jpg", "Plage.jpg"]);
    await expect(page.getByRole("button", { name: "Actions pour Plage.jpg" })).toBeFocused();

    // Feuille Options : <dialog> modal ; Tab reste dedans ; Échap ferme et rend le focus au bouton.
    const ob = page.getByRole("button", { name: /^Options · / });
    await ob.click();
    const dlg = page.getByRole("dialog", { name: "Options" });
    await expect(dlg).toBeVisible();
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => !!document.activeElement?.closest("dialog[open]") || document.activeElement === document.body);
      expect(inside).toBe(true);
    }
    expect(await longParagraphs(dlg)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
    await expect(ob).toBeFocused();
    await ob.click();
    await settle(page);
    expect(await axe(page)).toEqual([]);
    await capture(page, "compose-options-sheet");
    await dlg.getByRole("button", { name: "Terminé" }).click();
    await expect(dlg).toBeHidden();
  });

  test("limites : 12 fichiers → 10 ajoutés et message ; plus de 1 Go → jauge en danger, envoi bloqué avec la raison", async ({ page, shh, browserName }) => {
    await open(page, shh.origin);
    await browse(page, Array.from({ length: 12 }, (_, i) => ({ name: `note-${i + 1}.txt`, mimeType: "text/plain", buffer: Buffer.from(`n${i}`) })));
    await expect(rows(page)).toHaveCount(10);
    await expect(page.locator(".cnote")).toContainText("2 éléments n'ont pas été ajoutés : 10 au plus.");
    await expect(page.locator(".cnote")).toContainText("note-11.txt, note-12.txt");
    await expect(page.getByRole("meter", { name: "Nombre d'éléments" })).toHaveAttribute("aria-valuenow", "10");
    await capture(page, "compose-limit-count");

    test.skip(browserName !== "chromium", "fichier creux de 1 Go : Chromium (chemin local)");
    await page.getByRole("button", { name: "Tout retirer" }).click();
    await expect(page.getByRole("button", { name: "Parcourir les fichiers" })).toBeVisible();
    const dir = mkdtempSync(join(tmpdir(), "shh-1go-"));
    try {
      const p = join(dir, "film-1go.bin");
      const fd = openSync(p, "w");
      ftruncateSync(fd, 1073741824 + 1);
      closeSync(fd);
      await browse(page, [p]);
      await expect(rows(page)).toHaveCount(1);
      await expect(page.getByRole("alert").filter({ hasText: /^Trop gros\s:\s[\d,]+\s(?:octets?|Ko) de trop \(limite\s:\s1\sGo\)\.$/ })).toBeVisible();
      expect(await page.locator(".fill").first().evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(255, 138, 128)");
      await expect(send(page)).toBeDisabled();
      await expect(page.locator("#send-reason")).toHaveText("Le total dépasse 1 Go. Retirez des éléments.");
      await page.waitForTimeout(6500); // l'annonce « retirés » est partie
      await capture(page, "compose-limit-size");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("texte : éditeur, compteur, Modifier ; Ctrl + V de texte hors champ ouvre l'éditeur ; image collée", async ({ page, shh, isMobile }) => {
    await open(page, shh.origin);
    await addText(page, "Premier");
    await expect(rows(page)).toHaveCount(1);
    if (isMobile) {
      await page.getByRole("button", { name: "Actions pour Texte 1" }).click();
      await page.getByRole("dialog", { name: "Texte 1" }).getByRole("button", { name: "Modifier" }).click();
    } else await page.getByRole("button", { name: "Modifier Texte 1" }).click();
    const dlg = page.getByRole("dialog", { name: "Modifier le texte" });
    await expect(dlg.getByLabel("Votre texte")).toHaveValue("Premier");
    for (const [k, v] of [["autocomplete", "off"], ["autocorrect", "off"], ["autocapitalize", "off"], ["spellcheck", "false"]])
      await expect(dlg.getByLabel("Votre texte")).toHaveAttribute(k, v);
    await dlg.getByLabel("Votre texte").fill("x".repeat(10_001));
    await expect(dlg.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    await expect(dlg.getByText("10 000 caractères au plus.")).toBeVisible();
    await dlg.getByLabel("Votre texte").fill("Second");
    await dlg.getByRole("button", { name: "Enregistrer" }).click();
    await expect(rows(page).first()).toContainText("Second");

    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      const dt = new DataTransfer();
      dt.setData("text/plain", "collé");
      dt.setData("text/html", "<b>collé</b>");
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    const nd = page.getByRole("dialog", { name: "Nouveau texte" });
    await expect(nd.getByLabel("Votre texte")).toHaveValue("collé");
    await expect(nd.getByLabel("Votre texte")).toBeFocused();
    await nd.getByRole("button", { name: "Ajouter" }).click();
    await expect(rows(page)).toHaveCount(2);

    const png = [...readFileSync(f("schema.png"))];
    await page.evaluate((bytes) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], "image.png", { type: "image/png" }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, png);
    await expect(page.locator("[data-row] .nm", { hasText: "Image collée 1.png" })).toHaveCount(1);
  });

  test("Vocal : la feuille dit que l'enregistreur arrive bientôt", async ({ page, shh }) => {
    await open(page, shh.origin);
    const voice = page.getByRole("group", { name: "Ou créez sur place" }).getByRole("button", { name: "Vocal" });
    test.skip((await voice.count()) === 0, "MediaRecorder absent");
    await voice.click();
    await expect(page.getByRole("dialog", { name: "Vocal" })).toContainText("L'enregistreur vocal arrive bientôt.");
  });

  test("320 px : nom de 200 caractères et nom arabe, aucun débordement", async ({ page, shh }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await open(page, shh.origin);
    await browse(page, [
      { name: "x".repeat(196) + ".pdf", mimeType: "application/pdf", buffer: Buffer.from("a") },
      { name: "تقرير الاجتماع السنوي للجمعية العامة.pdf", mimeType: "application/pdf", buffer: Buffer.from("b") },
    ]);
    await expect(rows(page)).toHaveCount(2);
    expect(await noHScroll(page)).toBe(true);
    await expect(rows(page).first().locator(".e")).toHaveText(".pdf");
  });
});

test.describe("en-US", () => {
  test.use({ locale: "en-US" });

  test("composer in English ; capture", async ({ page, shh, isMobile }) => {
    if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(shh.origin + "/");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Browse files" }).click();
    await (await chooser).setFiles(MIXED);
    await expect(page.getByRole("heading", { level: 2, name: "Your share" })).toBeVisible();
    if (isMobile) await expect(page.getByRole("button", { name: /^Options · 12h · 1\sopen · download allowed$/ })).toBeVisible();
    else await expect(page.locator(".summary")).toHaveText("Erased in 12h or after 1\u00a0open, whichever comes first.");
    expect(await axe(page)).toEqual([]);
    await capture(page, "compose-filled-en");
  });
});
