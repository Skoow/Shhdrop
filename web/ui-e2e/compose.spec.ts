// Composeur (UI §9.2, §9.3), v3 : passage de l'accueil au composeur au premier ajout.
// Ordinateur (≥ 760 px) : en-tête de capacité, zone de dépôt, « Créer sur place », photos en
// grille, documents et archives en tableau, notes et audio en lignes ; options dans une colonne
// collée dont le pied (Chiffrer et envoyer) reste visible. Téléphone : app (lignes compactes,
// menu « … », barre collée, options en feuille). Captures fr-FR à 1440 × 900, 1920 × 1080, 390 × 844.
import { closeSync, ftruncateSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { axe, capture, expect, test } from "./fixtures";

const FILES = fileURLToPath(new URL("./files/", import.meta.url));
const f = (name: string) => join(FILES, name);
const PHOTOS = ["plage-nuit.jpg", "toits-belleville.jpg", "marche-matin.jpg", "foret-brume.jpg", "lac-gele.jpg", "rue-pluie.jpg"].map(f);
/** 6 photos, une vidéo, un PDF, une archive (+ une note = 10 éléments). */
const MIXED = [...PHOTOS, f("anniversaire-lou.webm"), f("contrat.pdf"), f("archive.zip")];

async function open(page: Page, origin: string) {
  await page.goto(origin + "/");
  await expect(page.getByRole("button", { name: "Parcourir les fichiers" })).toBeVisible();
}
/** Choisit des fichiers par « Parcourir les fichiers » (accueil) ou la zone de dépôt (composeur). */
async function browse(page: Page, files: string[] | { name: string; mimeType: string; buffer: Buffer }[]) {
  const home = page.getByRole("button", { name: "Parcourir les fichiers" });
  const chooser = page.waitForEvent("filechooser");
  if (await home.isVisible()) await home.click();
  else await page.locator(".dropzone").click();
  await (await chooser).setFiles(files as never);
}
async function addNote(page: Page, body: string, title = "") {
  const inComposer = page.getByRole("group", { name: "Créer sur place" });
  if (await inComposer.isVisible()) await inComposer.getByRole("button", { name: "Note texte" }).click();
  else await page.getByRole("group", { name: "Ou créez sur place" }).getByRole("button", { name: "Texte", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Nouveau texte" });
  if (title) await dlg.getByLabel("Titre").fill(title);
  await dlg.getByLabel("Contenu").fill(body);
  await dlg.getByRole("button", { name: "Ajouter" }).click();
  await expect(dlg).toBeHidden();
}
const rows = (page: Page) => page.locator("[data-row]");
const names = (page: Page) => page.locator("[data-row] .nm").allTextContents();
const settle = (page: Page) =>
  page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.timeline === document.timeline && a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const send = (page: Page) => page.getByRole("button", { name: "Chiffrer et envoyer" });
const inViewport = (l: Locator) =>
  l.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && r.height > 0;
  });

/** Les options : la colonne de droite (ordinateur) ou la feuille ouverte par « Options » (téléphone). */
async function options(page: Page, isMobile: boolean): Promise<Locator> {
  if (!isMobile) return page.locator(".side");
  await page.getByRole("button", { name: /^Options · / }).click();
  const dlg = page.getByRole("dialog", { name: "Options" });
  await expect(dlg).toBeVisible();
  return dlg;
}
/** Retire un élément : bouton « Retirer » de la ligne ou du tableau, sinon menu « … ». */
async function removeItem(page: Page, name: string) {
  const direct = page.getByRole("button", { name: `Retirer ${name}` });
  if (await direct.isVisible()) return direct.click();
  await page.getByRole("button", { name: `Actions pour ${name}` }).click();
  await page.getByRole("dialog", { name }).getByRole("button", { name: "Retirer" }).click();
}
/** Aucun paragraphe de plus de deux lignes (demande du propriétaire, téléphone). */
const longParagraphs = (scope: Locator) =>
  scope.locator("p, .h, .line").evaluateAll((els) =>
    els
      .filter((e) => (e as HTMLElement).offsetParent !== null && !e.closest(".sr-only, .cnote") && e.textContent!.trim() !== "")
      .filter((e) => {
        const lh = parseFloat(getComputedStyle(e).lineHeight) || 20;
        return e.getBoundingClientRect().height > lh * 2 + 4;
      })
      .map((e) => e.textContent!.trim()),
  );

test.describe("fr-FR", () => {
  test.use({ locale: "fr-FR" });
  test.beforeEach(async ({ page, isMobile }) => {
    if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
  });

  test("vide, puis 10 éléments mêlés : capacité en tête, grille, tableau, archive ; bouton d'envoi toujours visible ; axe ; captures", async ({ page, shh, isMobile }) => {
    await open(page, shh.origin);
    await page.waitForTimeout(900);
    await capture(page, "compose-empty");
    if (!isMobile) {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForTimeout(300);
      await capture(page, "compose-empty-1920");
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await expect(page.locator("input[type=checkbox]")).toHaveCount(0);
    // Plus de bouton « Coller » (Ctrl/Cmd + V suffit).
    await expect(page.getByRole("button", { name: "Coller" })).toHaveCount(0);

    await browse(page, [PHOTOS[0]!]);
    await expect(page.getByRole("heading", { level: 2, name: "Votre envoi" })).toBeFocused();
    await browse(page, MIXED.slice(1));
    await addNote(page, "Le code de la porte est 4512B.\nÀ ce soir !", "Code de la porte");
    await expect(rows(page)).toHaveCount(10);

    // Capacité en tête, à côté de « Votre envoi ».
    await expect(page.locator(".top .ht")).toHaveText(/^10\s\/\s10\séléments · [\d,]+\s(?:Ko|Mo) \/ 1\sGo$/);
    await expect(page.getByRole("meter", { name: "Nombre d'éléments" })).toHaveAttribute("aria-valuenow", "10");
    expect(await page.locator(".top .gh").evaluate((e) => getComputedStyle(e).fontVariantNumeric)).toContain("tabular-nums");
    expect(await page.locator(".group h3").allTextContents()).toEqual(["Texte", "Photos", "Vidéos", "Documents", "Archives"]);
    // Note : titre, puis la première ligne du contenu.
    const note = rows(page).filter({ hasText: "Code de la porte" });
    await expect(note.locator(".sub")).toHaveText("Le code de la porte est 4512B.");
    // Archive : catégorie, note honnête.
    await expect(page.getByText("Archive : son contenu n'est ni vérifié ni nettoyé.")).toBeVisible();
    await expect(page.getByText("Nettoyé", { exact: true })).toHaveCount(0);
    // Nettoyage pas encore réel (CLEANER_READY faux) : aucun bouton qui ne fait rien ; les
    // pastilles « Non nettoyé », honnêtes, restent (scan UX B3).
    await expect(page.getByRole("button", { name: "Nettoyer tous les fichiers" })).toHaveCount(0);
    await expect(page.locator(".badge.warn").filter({ hasText: "Non nettoyé" }).first()).toBeVisible();
    await expect(page.locator("[data-row]").filter({ hasText: "plage-nuit.jpg" }).locator("img")).toHaveAttribute("src", /^blob:/);
    // Légende raccourcie au milieu (« anniversair…-lou.webm ») : la vignette se trouve par son nom accessible.
    await expect(page.locator("[data-row]").filter({ has: page.getByRole("button", { name: "Actions pour anniversaire-lou.webm" }) })).toContainText("1:12");
    expect(await noHScroll(page)).toBe(true);

    if (isMobile) {
      await expect(page.getByRole("button", { name: /^Actions pour / })).toHaveCount(10);
      await expect(page.getByRole("button", { name: /^Retirer / })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Choisir des fichiers" })).toBeVisible();
      const make = page.getByRole("group", { name: "Créer sur place" }).getByRole("button");
      await expect(make).toHaveText(["Note texte", "Mémo vocal", "Photo", "Vidéo", "Conversation Bientôt"]);
      expect(await longParagraphs(page.locator("main"))).toEqual([]);
    } else {
      // Ordinateur : photos en grille, documents en tableau ; « Créer sur place » sans Photo ni Vidéo.
      await expect(page.locator(".grid .tile")).toHaveCount(7); // 6 photos + 1 vidéo
      await expect(page.getByRole("table", { name: "Documents" })).toBeVisible();
      await expect(page.getByRole("table", { name: "Archives" }).getByRole("cell", { name: "ZIP", exact: true })).toBeVisible();
      await expect(page.getByRole("group", { name: "Créer sur place" }).getByRole("button")).toHaveText(["Note texte", "Mémo vocal", "Conversation Bientôt"]);
      await expect(page.getByRole("button", { name: /^Déposez des fichiers n'importe où sur la page/ })).toBeVisible();
      // Exigence du propriétaire : tout tient dans l'écran, sans défilement de page ; le bouton
      // d'envoi est entièrement visible (1440 × 900 puis 1920 × 1080).
      for (const size of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
        await page.setViewportSize(size);
        await page.waitForTimeout(700);
        expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight), `${size.width} : pas de défilement`).toBe(true);
        expect(await inViewport(send(page)), `${size.width} : bouton visible`).toBe(true);
        for (const l of [page.locator(".top .ht"), page.getByRole("radiogroup", { name: "Durée" }), page.getByRole("radiogroup", { name: "Ouvertures" }), page.locator(".box"), page.getByRole("switch", { name: "Autoriser le téléchargement" }), page.locator(".summary")])
          expect(await inViewport(l), `${size.width} : ${await l.first().evaluate((e) => e.className)}`).toBe(true);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(500);
    }
    await settle(page);
    expect(await axe(page)).toEqual([]);
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(200);
    await capture(page, "compose-mixed");
    if (!isMobile) {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForTimeout(700);
      await capture(page, "compose-mixed-1920");
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(500);
    }
    // Task 17 : l'appui ouvre l'écran d'envoi (détail dans send.spec.ts).
    await send(page).click();
    await expect(page.locator("#seal-title")).toBeVisible();
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

  test("types : exécutable signalé, tableur (zip) = document, archive par son contenu", async ({ page, shh, isMobile }) => {
    await open(page, shh.origin);
    const buf = (n: string) => ({ name: n, mimeType: "", buffer: readFileSync(f(n)) });
    await browse(page, [buf("installer.exe"), buf("budget-2026.xlsx"), { name: "sauvegarde", mimeType: "", buffer: readFileSync(f("archive.zip")) }, { name: "vacances.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0x4d, 0x5a, 0x90, 0]) }]);
    await expect(rows(page)).toHaveCount(4);
    expect(await page.locator(".group h3").allTextContents()).toEqual(["Documents", "Archives", "Autres"]);
    const exe = rows(page).filter({ hasText: "installer.exe" });
    await expect(exe.getByText("À risque")).toBeVisible();
    // S6 : l'élément en cause est marqué en rouge.
    await expect(page.locator("[data-row].danger, [data-row] .row.danger").filter({ hasText: "installer.exe" })).toHaveCount(1);
    await expect(exe.getByText("Programme ou script : il peut agir sur l'appareil du destinataire.")).toBeVisible();
    await expect(rows(page).filter({ hasText: "vacances.jpg" }).getByText("Attention : c'est un programme, malgré son extension.")).toBeVisible();
    await expect(rows(page).filter({ hasText: "sauvegarde" }).getByText("Archive : son contenu n'est ni vérifié ni nettoyé.")).toBeVisible();
    if (!isMobile) await expect(page.getByRole("table", { name: "Autres" }).getByRole("cell", { name: "EXE", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nettoyer tous les fichiers" })).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
  });

  test("mot de passe : 10 caractères, boutons dans le champ ; écrire le sien puis « Utiliser un mot de passe généré » ; raison reliée", async ({ page, shh, isMobile, browserName }) => {
    await open(page, shh.origin);
    await browse(page, [f("contrat.pdf")]);
    const opts = await options(page, isMobile);
    const box = opts.locator(".box");
    const regen = box.getByRole("button", { name: "Générer un autre" });
    const copy = box.getByRole("button", { name: "Copier" });
    await expect(regen).toHaveAttribute("title", "Générer un autre");
    for (const b of [regen, copy]) {
      const r = (await b.boundingBox())!;
      expect(r.width).toBeGreaterThanOrEqual(43.5);
      expect(r.height).toBeGreaterThanOrEqual(43.5);
    }
    const pw = box.locator(".val .sr-only");
    const first = await pw.textContent();
    expect(first).toMatch(/^[a-km-np-zA-HJ-NP-Z2-9!#$%+=?@]{10}$/);
    await regen.click();
    await expect(pw).not.toHaveText(first!);
    if (browserName === "chromium") {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await copy.click();
      await expect(box.getByRole("button", { name: "Copié" })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await pw.textContent());
    }

    // Écrire le sien : 10 caractères au moins, raison reliée ; puis revenir au généré par le lien.
    await opts.getByRole("button", { name: "Écrire mon propre mot de passe" }).click();
    const field = opts.getByLabel("Votre mot de passe");
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("");
    for (const [k, v] of [["type", "text"], ["autocomplete", "off"], ["autocapitalize", "off"], ["autocorrect", "off"], ["spellcheck", "false"], ["name", "shh-own"]])
      await expect(field).toHaveAttribute(k, v);
    expect(await page.locator("form").count()).toBe(0);
    await field.fill("court");
    const reason = isMobile ? opts.locator("#opt-reason") : page.locator("#send-reason");
    await expect(reason).toHaveText("Le mot de passe doit faire au moins 10 caractères.");
    await field.fill("unbelievable");
    await expect(reason).toHaveText("Ce mot de passe est trop courant, même avec des chiffres ou des symboles autour. Choisissez-en un autre.");
    // Règles de forme (audit M1) : une raison claire pour chacune.
    await field.fill("azertyuiop");
    await expect(reason).toHaveText("Ce mot de passe suit les touches du clavier (comme «\u00a0azerty\u00a0»). Choisissez-en un autre.");
    await expect(opts.getByText("Suit les touches du clavier", { exact: true })).toBeVisible();
    await field.fill("aaaaaaaaaa");
    await expect(reason).toHaveText(/^Ce mot de passe répète trop les mêmes caractères/);
    await field.fill("1234567890");
    await expect(reason).toHaveText(/^Ce mot de passe suit l'ordre de l'alphabet ou des chiffres/);
    await field.fill("motdepasse12");
    await expect(reason).toHaveText(/^Ce mot de passe est trop courant/);
    await field.fill("cheval-agr");
    await expect(reason).toHaveCount(0);
    await field.fill("court");
    await settle(page);
    // Le champ et son contour de focus (2 + 2 px) tiennent dans la colonne (scan UX B4).
    const inside = await page.evaluate(() => {
      const box = document.querySelector(".pf .box")!.getBoundingClientRect();
      const col = (document.querySelector(".side-scroll") ?? document.querySelector("dialog[open]"))!;
      const c = col.getBoundingClientRect();
      // Zone visible du conteneur qui défile : bord gauche intérieur + clientWidth (sans barre).
      const left = c.left + col.clientLeft;
      return { boxL: box.left, boxR: box.right, colL: left, colR: left + col.clientWidth, scrollW: col.scrollWidth, clientW: col.clientWidth };
    });
    expect(inside.boxL - 4).toBeGreaterThanOrEqual(inside.colL - 0.5);
    expect(inside.boxR + 4).toBeLessThanOrEqual(inside.colR + 0.5);
    expect(inside.scrollW).toBeLessThanOrEqual(inside.clientW);
    expect(await axe(page)).toEqual([]);
    await capture(page, "compose-password-custom");
    await opts.getByRole("button", { name: "Utiliser un mot de passe généré" }).click();
    await expect(opts.getByLabel("Votre mot de passe")).toHaveCount(0);
    await expect(box.locator(".val .sr-only")).toHaveText(/^.{10}$/);
    // Et « Générer un autre » dans le champ fait de même.
    await opts.getByRole("button", { name: "Écrire mon propre mot de passe" }).click();
    await box.getByRole("button", { name: "Générer un autre" }).click();
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
    await dl.click();
    await expect(dl).toHaveAttribute("aria-checked", "false");
    await expect(vault).toHaveCount(0);
    if (isMobile) await page.keyboard.press("Escape");

    // Sans téléchargement, une archive ne pourra pas être ouverte.
    await browse(page, [f("archive.zip")]);
    await expect(rows(page).filter({ hasText: "archive.zip" }).getByText("Ne pourra pas être ouvert sans téléchargement")).toBeVisible();
    opts = await options(page, isMobile);
    await expect(opts.getByText("1 élément ne pourra pas être ouvert sans téléchargement.")).toBeVisible();
    await opts.locator(".warn").scrollIntoViewIfNeeded();
    await capture(page, "compose-no-download");
    await opts.locator(".warn").getByRole("button", { name: "Autoriser le téléchargement" }).click();
    await expect(opts.getByRole("switch", { name: "Autoriser le téléchargement" })).toHaveAttribute("aria-checked", "true");
    if (isMobile) await page.keyboard.press("Escape");
    await expect(page.getByText("Ne pourra pas être ouvert sans téléchargement")).toHaveCount(0);
  });

  test("retrait et Annuler (grille, tableau) ; Tout retirer revient à l'accueil, Annuler rouvre le composeur", async ({ page, shh }) => {
    await open(page, shh.origin);
    await browse(page, [...PHOTOS.slice(0, 2), f("contrat.pdf")]);
    await removeItem(page, "plage-nuit.jpg");
    await expect(rows(page)).toHaveCount(2);
    await page.getByRole("group", { name: "plage-nuit.jpg retiré" }).getByRole("button", { name: "Annuler" }).click();
    await expect(rows(page)).toHaveCount(3);
    await removeItem(page, "contrat.pdf");
    await expect(rows(page)).toHaveCount(2);
    await page.getByRole("group", { name: "contrat.pdf retiré" }).getByRole("button", { name: "Annuler" }).click();
    await expect(rows(page)).toHaveCount(3);
    await page.getByRole("button", { name: "Tout retirer" }).click();
    await expect(page.getByRole("button", { name: "Parcourir les fichiers" })).toBeVisible();
    await page.getByRole("button", { name: "Annuler" }).click();
    await expect(rows(page)).toHaveCount(3);
  });

  test("ordinateur : grille (Alt + →, menu « … »), notes (glisser, Alt + ↓), tableau (renommer) ; doublon", async ({ page, shh, isMobile }) => {
    test.skip(isMobile, "ordinateur : grille, tableau, lignes");
    await open(page, shh.origin);
    await browse(page, PHOTOS.slice(0, 2));
    const more = page.getByRole("button", { name: "Actions pour plage-nuit.jpg" });
    await more.focus();
    await page.keyboard.press("Alt+ArrowRight");
    expect(await names(page)).toEqual(["toits-belleville.jpg", "plage-nuit.jpg"]);
    await expect(page.getByRole("status").filter({ hasText: "plage-nuit.jpg : position 2 sur 2 dans Photos." })).toHaveCount(1);
    await expect(more).toBeFocused();
    await more.click();
    const menu = page.getByRole("dialog", { name: "plage-nuit.jpg" });
    // Ordinateur : menu ancré sous le bouton (popover), pas une fenêtre modale (scan UX).
    await expect(menu).toHaveAttribute("popover", "auto");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(menu.getByRole("button", { name: "Renommer" })).toBeFocused();
    const [mb, ab] = [(await menu.boundingBox())!, (await more.boundingBox())!];
    expect(Math.abs(mb.y - (ab.y + ab.height)) <= 12 || Math.abs(mb.y + mb.height - ab.y) <= 12).toBe(true);
    expect(Math.min(Math.abs(mb.x + mb.width - (ab.x + ab.width)), Math.abs(mb.x - ab.x))).toBeLessThanOrEqual(2);
    await settle(page);
    await capture(page, "compose-item-popover");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();
    await more.click();
    await menu.getByRole("button", { name: "Monter" }).click();
    expect(await names(page)).toEqual(["plage-nuit.jpg", "toits-belleville.jpg"]);
    await menu.getByRole("button", { name: "Renommer" }).click();
    await menu.getByLabel("Nouveau nom de plage-nuit.jpg").fill("Plage");
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    expect(await names(page)).toContain("Plage.jpg");

    // Notes en lignes : glisser à la souris, Alt + ↓.
    await addNote(page, "un", "A");
    await addNote(page, "deux", "B");
    const b = (await page.getByRole("button", { name: "Déplacer B" }).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y - 40, { steps: 8 });
    await page.mouse.move(b.x + b.width / 2, b.y - 70, { steps: 4 });
    await page.mouse.up();
    expect((await names(page)).slice(0, 2)).toEqual(["B", "A"]);
    await page.getByRole("button", { name: "Déplacer B" }).focus();
    await page.keyboard.press("Alt+ArrowDown");
    expect((await names(page)).slice(0, 2)).toEqual(["A", "B"]);
    // Le crayon d'une note ouvre l'éditeur (pas un renommage).
    await page.getByRole("button", { name: "Modifier A" }).click();
    const ed = page.getByRole("dialog", { name: "Modifier le texte" });
    await expect(ed.getByLabel("Titre")).toHaveValue("A");
    await expect(ed.getByLabel("Contenu")).toHaveValue("un");
    await page.keyboard.press("Escape");

    // Tableau : Renommer ouvre la feuille de renommage ; doublon.
    await browse(page, [f("contrat.pdf")]);
    await page.getByRole("button", { name: "Renommer contrat.pdf" }).click();
    const rn = page.getByRole("dialog", { name: "contrat.pdf" });
    await rn.getByLabel("Nouveau nom de contrat.pdf").fill("a/b");
    await page.keyboard.press("Enter");
    await expect(rn.getByRole("alert")).toContainText("Caractère non permis");
    await rn.getByLabel("Nouveau nom de contrat.pdf").fill("Contrat signé");
    await page.keyboard.press("Enter");
    expect(await names(page)).toContain("Contrat signé.pdf");
    await browse(page, [f("toits-belleville.jpg")]);
    // Grille : le doublon est dit dans la description de la vignette (et sa pastille).
    await expect(page.getByText("En double ?")).toHaveCount(2);

    // Un seul en-tête de tableau visible, même avec plusieurs catégories en tableau (scan UX).
    await browse(page, [{ name: "sauvegarde-complete-du-telephone-2026.zip", mimeType: "application/zip", buffer: readFileSync(f("archive.zip")) }]);
    await expect(page.locator("table.ft")).toHaveCount(2);
    expect(await page.locator("table.ft th.c-name").evaluateAll((ths) => ths.map((th) => th.getBoundingClientRect().height > 1))).toEqual([true, false]);
    // Légende de vignette : raccourcie au milieu, extension lisible.
    await browse(page, [{ name: "photo-de-vacances-ete-2026-bretagne.jpg", mimeType: "image/jpeg", buffer: readFileSync(f("plage-nuit.jpg")) }]);
    await expect(page.locator(".tile .nm").filter({ hasText: "…" })).toHaveText(/^photo-de-.+….+\.jpg$/);
  });

  test("téléphone : menu « … » (Renommer, Monter, Descendre, Retirer) ; feuille Options : focus piégé, Échap rend le focus", async ({ page, shh, isMobile }) => {
    test.skip(!isMobile, "téléphone : app");
    await open(page, shh.origin);
    await browse(page, PHOTOS.slice(0, 2));
    await page.getByRole("button", { name: "Actions pour plage-nuit.jpg" }).click();
    const menu = page.getByRole("dialog", { name: "plage-nuit.jpg" });
    await expect(menu.locator(".mi")).toHaveText(["Renommer", "Monter", "Descendre", "Retirer"]);
    await settle(page);
    await capture(page, "compose-item-menu");
    await menu.getByRole("button", { name: "Descendre" }).click();
    expect(await names(page)).toEqual(["toits-belleville.jpg", "plage-nuit.jpg"]);
    await menu.getByRole("button", { name: "Renommer" }).click();
    await menu.getByLabel("Nouveau nom de plage-nuit.jpg").fill("Plage");
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    expect(await names(page)).toEqual(["toits-belleville.jpg", "Plage.jpg"]);
    const ob = page.getByRole("button", { name: /^Options · / });
    await ob.click();
    const dlg = page.getByRole("dialog", { name: "Options" });
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("dialog[open]") || document.activeElement === document.body)).toBe(true);
    }
    expect(await longParagraphs(dlg)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
    await expect(ob).toBeFocused();
    await ob.click();
    await settle(page);
    expect(await axe(page)).toEqual([]);
    await capture(page, "compose-options-sheet");
  });

  test("limites : 12 fichiers → 10 ajoutés et message ; plus de 1 Go → capacité en danger, envoi bloqué avec la raison", async ({ page, shh, browserName }) => {
    await open(page, shh.origin);
    await browse(page, Array.from({ length: 12 }, (_, i) => ({ name: `note-${i + 1}.txt`, mimeType: "text/plain", buffer: Buffer.from(`n${i}`) })));
    await expect(rows(page)).toHaveCount(10);
    await expect(page.locator(".cnote")).toContainText("2 éléments n'ont pas été ajoutés : 10 au plus.");
    await expect(page.locator(".cnote")).toContainText("note-11.txt, note-12.txt");
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
      await expect(page.getByRole("alert").filter({ hasText: /^Trop gros\s:\s[\d,]+\s(?:octets?|Ko) de trop \(limite\s:\s1\sGo\)\.$/ }).first()).toBeVisible();
      expect(await page.locator(".top .fill").evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(255, 138, 128)");
      await expect(send(page)).toBeDisabled();
      await expect(page.locator("#send-reason")).toHaveText("Le total dépasse 1 Go. Retirez des éléments.");
      await page.waitForTimeout(6500);
      await capture(page, "compose-limit-size");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("note : titre et contenu, compteur, Modifier ; Ctrl + V de texte hors champ ouvre l'éditeur ; image collée", async ({ page, shh, isMobile }) => {
    await open(page, shh.origin);
    await addNote(page, "Premier");
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).locator(".nm")).toHaveText("Note");
    if (isMobile) {
      await page.getByRole("button", { name: "Actions pour Note" }).click();
      await page.getByRole("dialog", { name: "Note" }).getByRole("button", { name: "Modifier" }).click();
    } else await page.getByRole("button", { name: "Modifier Note" }).click();
    const dlg = page.getByRole("dialog", { name: "Modifier le texte" });
    await expect(dlg.getByLabel("Contenu")).toHaveValue("Premier");
    for (const [k, v] of [["autocomplete", "off"], ["autocorrect", "off"], ["autocapitalize", "off"], ["spellcheck", "false"]])
      await expect(dlg.getByLabel("Contenu")).toHaveAttribute(k, v);
    await dlg.getByLabel("Contenu").fill("x".repeat(10_001));
    await expect(dlg.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    await expect(dlg.getByText("10 000 caractères au plus.")).toBeVisible();
    await dlg.getByLabel("Titre").fill("Courses");
    await dlg.getByLabel("Contenu").fill("Pain\nLait");
    await dlg.getByRole("button", { name: "Enregistrer" }).click();
    await expect(rows(page).first().locator(".nm")).toHaveText("Courses");
    await expect(rows(page).first().locator(".sub")).toHaveText("Pain");

    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      const dt = new DataTransfer();
      dt.setData("text/plain", "collé");
      dt.setData("text/html", "<b>collé</b>");
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    const nd = page.getByRole("dialog", { name: "Nouveau texte" });
    await expect(nd.getByLabel("Contenu")).toHaveValue("collé");
    await expect(nd.getByLabel("Contenu")).toBeFocused();
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

  test("2 notes, 3 photos, 1 vidéo, 2 documents, 1 archive : toutes les catégories visibles, sans défilement de page ; captures", async ({ page, shh, isMobile }) => {
    await open(page, shh.origin);
    await browse(page, [...PHOTOS.slice(0, 3), f("anniversaire-lou.webm"), f("contrat.pdf"), f("budget-2026.xlsx"), f("archive.zip")]);
    await expect(rows(page)).toHaveCount(7);
    await addNote(page, "Le code de la porte est 4512B.", "Code de la porte");
    await addNote(page, "Pain, lait, café.", "Courses");
    await expect(rows(page)).toHaveCount(9);
    await settle(page);
    if (!isMobile) {
      for (const size of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
        await page.setViewportSize(size);
        await page.waitForTimeout(700);
        expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight), `${size.width} : pas de défilement`).toBe(true);
        expect(await inViewport(send(page))).toBe(true);
        // Chaque catégorie présente a son titre visible, dans l'écran et dans la zone de la liste.
        const heads = await page.locator(".group h3").evaluateAll((hs) => {
          const box = document.querySelector(".lc-scroll")!.getBoundingClientRect();
          return hs.map((h) => {
            const r = h.getBoundingClientRect();
            return { t: h.textContent, ok: r.top >= box.top - 1 && r.bottom <= box.bottom + 1 && r.bottom <= innerHeight };
          });
        });
        await capture(page, `compose-mix9-${size.width}`);
        expect(heads.map((h) => h.t)).toEqual(["Texte", "Photos", "Vidéos", "Documents", "Archives"]);
        expect(heads.filter((h) => !h.ok), `${size.width}`).toEqual([]);
      }
    } else await capture(page, "compose-mix9");
    expect(await axe(page)).toEqual([]);
  });

  test("Conversation : entrée « Bientôt », feuille d'explication sans date", async ({ page, shh }) => {
    await open(page, shh.origin);
    await browse(page, [f("contrat.pdf")]);
    const b = page.getByRole("group", { name: "Créer sur place" }).getByRole("button", { name: /^Conversation/ });
    await expect(b.locator(".soon-b")).toHaveText("Bientôt");
    await b.click();
    await expect(page.getByRole("dialog", { name: "Conversation" })).toContainText("Bientôt : un salon de discussion chiffré et éphémère, partagé par un lien et un mot de passe.");
  });

  test("Mémo vocal : entrée « Créer sur place », feuille d'attente (enregistreur à venir)", async ({ page, shh }) => {
    await open(page, shh.origin);
    await browse(page, [f("contrat.pdf")]);
    await page.getByRole("group", { name: "Créer sur place" }).getByRole("button", { name: "Mémo vocal" }).click();
    await expect(page.getByRole("dialog", { name: "Mémo vocal" })).toContainText("L'enregistreur vocal arrive bientôt.");
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
    await (await chooser).setFiles(MIXED.slice(0, 8));
    await expect(page.getByRole("heading", { level: 2, name: "Your share" })).toBeVisible();
    await expect(page.locator(".top .ht")).toHaveText(/^8\s\/\s10\sitems · /);
    if (isMobile) await expect(page.getByRole("button", { name: /^Options · 12h · 1\sopen · download allowed$/ })).toBeVisible();
    else await expect(page.locator(".summary")).toHaveText("Erased in 12h or after 1\u00a0open, whichever comes first.");
    expect(await axe(page)).toEqual([]);
    await capture(page, "compose-filled-en");
  });
});
