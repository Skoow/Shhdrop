// Composeur (UI §9.2, §9.3) : passage de l'accueil au composeur au premier ajout, liste par
// catégories, retrait et annulation, ordre, renommage, jauge et limites, options et mot de
// passe, texte, dépôt et collage. Captures fr-FR à 1440 et 390.
import { closeSync, ftruncateSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
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
  page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const send = (page: Page) => page.getByRole("button", { name: "Chiffrer et envoyer" });

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
    // Aucune case à cocher avant le premier élément (benchmark M1).
    await expect(page.locator("input[type=checkbox]")).toHaveCount(0);

    await browse(page, [f("plage-nuit.jpg")]);
    await expect(page.getByRole("heading", { level: 2, name: "Votre envoi" })).toBeFocused();
    await expect(page.getByRole("heading", { level: 2, name: "Comment ça marche" })).toHaveCount(0);
    await browse(page, MIXED.slice(1));
    await addText(page, "Le code de la porte, c'est 4512B. À ce soir !");
    await expect(rows(page)).toHaveCount(6);

    const heads = await page.locator(".group h3").allTextContents();
    expect(heads).toEqual(["Texte", "Photos", "Vidéos", "Audio et vocaux", "Documents"]);
    await expect(page.locator(".group").nth(1).locator(".head .meta")).toHaveText(/^2 · \d/);
    await expect(page.getByText("Même les noms de vos fichiers sont chiffrés.")).toBeVisible();
    // Pas de « Nettoyé » tant que le nettoyage (Task 9) n'existe pas ; « Non nettoyé » dit vrai.
    await expect(page.getByText("Nettoyé", { exact: true })).toHaveCount(0);
    await expect(rows(page).filter({ hasText: "plage-nuit.jpg" }).getByText("Non nettoyé")).toBeVisible();
    // Vignette d'image (URL blob) et durée de la vidéo.
    await expect(rows(page).filter({ hasText: "plage-nuit.jpg" }).locator("img")).toHaveAttribute("src", /^blob:/);
    await expect(rows(page).filter({ hasText: "anniversaire-lou.webm" }).locator(".meta")).toContainText("1:12");

    // Jauge : valeurs réelles, chiffres tabulaires, deux mesures.
    await expect(page.getByRole("meter", { name: "Nombre d'éléments" })).toHaveAttribute("aria-valuenow", "6");
    expect(await page.locator(".gauge").evaluate((e) => getComputedStyle(e).fontVariantNumeric)).toContain("tabular-nums");
    await expect(page.getByText(/^Temps d'envoi estimé\s:\senviron\s/)).toBeVisible();
    await expect(send(page)).toBeEnabled();
    expect(await noHScroll(page)).toBe(true);
    await settle(page);
    expect(await axe(page)).toEqual([]);
    await capture(page, "compose-filled");
    if (!isMobile) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      expect(await noHScroll(page)).toBe(true);
      await capture(page, "compose-filled-390");
      await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(200);
      await capture(page, "compose-filled-390-options");
    }

    // L'envoi est la Task 17 : un avis le dit, rien ne part.
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
    await expect(page.getByRole("heading", { level: 2, name: "Votre envoi" })).toBeVisible();
    // Dossier (webkitGetAsEntry simulé) : refusé, message qui dit quoi faire.
    await page.evaluate(() => {
      const item = { kind: "file", getAsFile: () => null, webkitGetAsEntry: () => ({ isDirectory: true, name: "Vacances" }) };
      const e = new DragEvent("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(e, "dataTransfer", { value: { types: ["Files"], items: [item], files: [] } });
      document.querySelector("main")!.dispatchEvent(e);
    });
    await expect(page.locator(".cnote")).toContainText("Ajoutez les fichiers eux-mêmes");
    await expect(rows(page)).toHaveCount(3);
  });

  test("mot de passe : généré (8 caractères), Générer un autre, Copier, écrire le sien ; bouton bloqué avec raison", async ({ page, shh, isMobile, browserName }) => {
    await open(page, shh.origin);
    await browse(page, [f("contrat.pdf")]);
    const pw = page.locator(".pw-wrap .sr-only");
    const first = await pw.textContent();
    expect(first).toMatch(/^[a-km-np-zA-HJ-NP-Z2-9!#$%+=?@]{8}$/);
    await page.getByRole("button", { name: "Générer un autre" }).click();
    await expect(pw).not.toHaveText(first!);
    const second = await pw.textContent();
    for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Générer un autre" }).click();
    await expect(pw).not.toHaveText(second!);
    await expect(page.getByText("Un mot de passe en plus du lien. Envoyez-les par deux moyens différents.")).toBeVisible();
    await expect(page.getByText("5 essais ratés, et le partage est détruit.")).toBeVisible();
    if (browserName === "chromium") {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.locator(".gen").getByRole("button", { name: "Copier" }).click();
      await expect(page.locator(".gen").getByRole("button", { name: "Copié" })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await pw.textContent());
    }

    await page.getByRole("button", { name: "Écrire mon propre mot de passe" }).click();
    const field = page.getByLabel("Votre mot de passe");
    await expect(field).toBeFocused();
    // Attributs de saisie (UI §12.3), hors de tout <form>.
    for (const [k, v] of [["type", "text"], ["autocomplete", "off"], ["autocapitalize", "off"], ["autocorrect", "off"], ["spellcheck", "false"], ["name", "shh-own"]])
      await expect(field).toHaveAttribute(k, v);
    expect(await page.locator("form").count()).toBe(0);
    await field.fill("court");
    await expect(send(page)).toBeDisabled();
    await expect(page.locator("#send-reason")).toHaveText("Le mot de passe doit faire au moins 12 caractères.");
    await expect(send(page)).toHaveAttribute("aria-describedby", "send-reason");
    await field.fill("unbelievable");
    await expect(page.locator("#send-reason")).toHaveText("Ce mot de passe est trop courant. Choisissez-en un autre.");
    await field.fill("une phrase de plusieurs mots");
    await expect(page.locator("#send-reason")).toHaveCount(0);
    await expect(send(page)).toBeEnabled();
    await page.getByRole("button", { name: "Masquer le mot de passe" }).click();
    await expect(page.getByRole("button", { name: "Afficher le mot de passe" })).toHaveAttribute("aria-pressed", "true");
    await field.fill("court");
    await page.getByRole("button", { name: "Afficher le mot de passe" }).click();
    await field.scrollIntoViewIfNeeded();
    await settle(page);
    expect(await axe(page)).toEqual([]);
    if (!isMobile) {
      await page.locator(".side").scrollIntoViewIfNeeded();
      await capture(page, "compose-password-custom");
    } else await capture(page, "compose-password-custom");
    await page.getByRole("button", { name: "Utiliser un mot de passe généré" }).click();
    await expect(send(page)).toBeEnabled();
  });

  test("options : 12 h et 1 ouverture par défaut, flèches, phrase à jour, droits du destinataire", async ({ page, shh }) => {
    await open(page, shh.origin);
    await browse(page, [f("plage-nuit.jpg")]);
    const ttl = page.getByRole("radiogroup", { name: "Durée" });
    const opens = page.getByRole("radiogroup", { name: "Ouvertures" });
    await expect(ttl.getByRole("radio", { name: "12 h" })).toBeChecked();
    await expect(opens.getByRole("radio", { name: "1", exact: true })).toBeChecked();
    const summary = page.locator(".summary");
    await expect(summary).toHaveText("S'efface dans 12 h ou après 1 ouverture, au premier des deux.");
    await ttl.getByRole("radio", { name: "12 h" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(ttl.getByRole("radio", { name: "24 h" })).toBeChecked();
    await opens.getByRole("radio", { name: "1", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(summary).toHaveText("S'efface dans 24 h ou après 3 ouvertures, au premier des deux.");
    await opens.getByText("10", { exact: true }).click();
    await expect(summary).toContainText("10 ouvertures");
    // Droits : « Voir et enregistrer » par défaut ; pas de coffre en production tant que… (prop).
    await expect(page.getByRole("radio", { name: "Voir et enregistrer" })).toBeChecked();
    await page.getByRole("radio", { name: "Voir seulement" }).check();
    await expect(page.getByText(/^Ce n'est qu'une dissuasion/)).toBeVisible();
    // Une archive ne s'affiche pas dans un navigateur : « Voir seulement » devient impossible.
    await browse(page, [f("archive.zip")]);
    await expect(page.getByRole("radio", { name: "Voir seulement" })).toBeDisabled();
    await expect(page.getByRole("radio", { name: "Voir et enregistrer" })).toBeChecked();
    await expect(page.getByText(/^Impossible avec\s:\sarchive\.zip\./)).toBeVisible();
    await expect(page.locator("input[type=checkbox]")).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
  });

  test("retrait et Annuler ; Tout retirer revient à l'accueil, Annuler rouvre le composeur", async ({ page, shh }) => {
    await open(page, shh.origin);
    await browse(page, MIXED.slice(0, 2));
    await page.getByRole("button", { name: "Retirer plage-nuit.jpg" }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Retirer toits-belleville.jpg" })).toBeFocused();
    await page.getByRole("group", { name: "plage-nuit.jpg retiré" }).getByRole("button", { name: "Annuler" }).click();
    await expect(rows(page)).toHaveCount(2);
    expect(await names(page)).toEqual(["plage-nuit.jpg", "toits-belleville.jpg"]);

    await page.getByRole("button", { name: "Tout retirer" }).click();
    await expect(page.getByRole("button", { name: "Parcourir les fichiers" })).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Annuler" }).click();
    await expect(rows(page)).toHaveCount(2);
  });

  test("ordre : Alt + ↓ au clavier, annonce lue ; renommage (Entrée, Échap) ; doublon", async ({ page, shh }) => {
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

    // Mode déplacement (lecteurs d'écran au toucher) : la poignée ouvre Monter / Descendre / Terminé.
    await grip.click();
    await page.getByRole("button", { name: "Monter" }).click();
    expect(await names(page)).toEqual(["plage-nuit.jpg", "toits-belleville.jpg"]);
    await page.getByRole("button", { name: "Terminé" }).click();

    // Glisser à la souris : la seconde photo passe devant.
    const b = (await page.getByRole("button", { name: "Déplacer toits-belleville.jpg" }).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y - 40, { steps: 8 });
    await page.mouse.move(b.x + b.width / 2, b.y - 70, { steps: 4 });
    await page.mouse.up();
    expect(await names(page)).toEqual(["toits-belleville.jpg", "plage-nuit.jpg"]);

    // Renommage : extension à part, Échap annule, Entrée valide.
    await page.getByRole("button", { name: "Renommer plage-nuit.jpg" }).click();
    const input = page.getByLabel("Nouveau nom de plage-nuit.jpg");
    await expect(input).toBeFocused();
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
    await expect(page.getByRole("button", { name: "Renommer Plage.jpg" })).toBeFocused();

    // Doublon : même nom (sans casse) et même taille.
    await browse(page, [f("toits-belleville.jpg")]);
    await expect(page.locator(".badge", { hasText: "En double ?" })).toHaveCount(2);
  });

  test("limites : 12 fichiers → 10 ajoutés et message ; plus de 1 Go → jauge en danger, envoi bloqué avec la raison", async ({ page, shh, browserName }) => {
    await open(page, shh.origin);
    await browse(page, Array.from({ length: 12 }, (_, i) => ({ name: `note-${i + 1}.txt`, mimeType: "text/plain", buffer: Buffer.from(`n${i}`) })));
    await expect(rows(page)).toHaveCount(10);
    await expect(page.locator(".cnote")).toContainText("2 éléments n'ont pas été ajoutés : 10 au plus.");
    await expect(page.locator(".cnote")).toContainText("note-11.txt, note-12.txt");
    await expect(page.getByRole("meter", { name: "Nombre d'éléments" })).toHaveAttribute("aria-valuenow", "10");
    await page.locator(".sendbar").scrollIntoViewIfNeeded();
    await capture(page, "compose-limit-count");

    test.skip(browserName !== "chromium", "fichier creux de 1 Go : Chromium (chemin local)");
    await page.getByRole("button", { name: "Tout retirer" }).click();
    await expect(page.getByRole("button", { name: "Parcourir les fichiers" })).toBeVisible();
    const dir = mkdtempSync(join(tmpdir(), "shh-1go-"));
    try {
      const p = join(dir, "film-1go.bin");
      const fd = openSync(p, "w");
      ftruncateSync(fd, 1073741824 + 1); // creux : rien n'est écrit sur le disque
      closeSync(fd);
      await browse(page, [p]);
      await expect(rows(page)).toHaveCount(1);
      await expect(page.getByRole("alert").filter({ hasText: /^Trop gros\s:\s1\s024,0\sMo sur 1\s023,9\sMo\. Retirez\s64\sKo\.$/ })).toBeVisible();
      await expect(page.locator(".gauge.over")).toHaveCount(1);
      expect(await page.locator(".gauge .fill").evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(255, 138, 128)");
      await expect(send(page)).toBeDisabled();
      await expect(page.locator("#send-reason")).toHaveText("Le total dépasse 1 Go. Retirez des éléments.");
      await page.locator(".sendbar").scrollIntoViewIfNeeded();
      await capture(page, "compose-limit-size");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("texte : éditeur, compteur, Modifier ; Ctrl + V de texte hors champ ouvre l'éditeur", async ({ page, shh }) => {
    await open(page, shh.origin);
    await addText(page, "Premier");
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole("button", { name: "Modifier Texte 1" }).click();
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

    // Collage de texte hors champ : nouvel élément Texte, éditeur ouvert avec ce texte (jamais text/html).
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

    // Ctrl + V d'une image : ajoutée comme « Image collée 1.png ».
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

  test("composer in English: names, gauge, options sentence ; capture", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Browse files" }).click();
    await (await chooser).setFiles(MIXED);
    await expect(page.getByRole("heading", { level: 2, name: "Your share" })).toBeVisible();
    await expect(page.locator(".summary")).toHaveText("Erased in 12h or after 1\u00a0open, whichever comes first.");
    await expect(page.getByRole("radio", { name: "View and save" })).toBeChecked();
    expect(await axe(page)).toEqual([]);
    await capture(page, "compose-filled-en");
  });
});
