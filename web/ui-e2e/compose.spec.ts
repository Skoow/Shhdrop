// Composeur (UI §9.2, §9.3), v3 : passage de l'accueil au composeur au premier ajout.
// Ordinateur (≥ 760 px) : en-tête de capacité, zone de dépôt, « Créer sur place », une seule
// liste compacte partout (icône de format, nom, type, taille, temps estimé) ; options dans une colonne
// collée dont le pied (Chiffrer et envoyer) reste visible. Téléphone : app (lignes compactes,
// menu « … », barre collée, options en feuille). Captures fr-FR à 1440 × 900, 1920 × 1080, 390 × 844.
import { closeSync, ftruncateSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { axe, capture, expect, readClipboard, test } from "./fixtures";
import { openFilePicker, pickInAddSheet, enterComposer } from "./send-helpers";

const FILES = fileURLToPath(new URL("./files/", import.meta.url));
const f = (name: string) => join(FILES, name);
const PHOTOS = ["plage-nuit.jpg", "toits-belleville.jpg", "marche-matin.jpg", "foret-brume.jpg", "lac-gele.jpg", "rue-pluie.jpg"].map(f);
/** 6 photos, une vidéo, un PDF, une archive (+ une note = 10 éléments). */
const MIXED = [...PHOTOS, f("anniversaire-lou.webm"), f("contrat.pdf"), f("archive.zip")];

async function open(page: Page, origin: string) {
  await page.goto(origin + "/");
  // Accueil : « Commencer » (mène à la page d'envoi, D41-37).
  await expect(page.getByRole("button", { name: /^Commencer/ }).filter({ visible: true }).first()).toBeVisible();
}
/** Choisit des fichiers par la feuille d'ajout (« Commencer » ou « Ajouter ») ou la zone de dépôt (composeur). */
async function browse(page: Page, files: string[] | { name: string; mimeType: string; buffer: Buffer }[], wait = true) {
  const before = await rows(page).count();
  await (await openFilePicker(page)).setFiles(files as never);
  if (!wait) return;
  await expect.poll(() => rows(page).count()).not.toBe(before);
}
async function addNote(page: Page, body: string, title = "") {
  if (!(await pickInAddSheet(page, "Note"))) {
    const inComposer = page.getByRole("group", { name: "Créer sur place" });
    if (await inComposer.isVisible()) await inComposer.getByRole("button", { name: "Note", exact: true }).click();
    else await page.getByRole("group", { name: "Ou créez sur place" }).getByRole("button", { name: "Note", exact: true }).click();
  }
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
/** Supprime un élément : bouton « Supprimer » de la ligne, sinon menu « … ». */
async function removeItem(page: Page, name: string) {
  await expect(page.locator("[data-row]").filter({ hasText: name })).toBeVisible();
  const direct = page.getByRole("button", { name: `Supprimer ${name}` });
  if (await direct.isVisible()) return direct.click();
  await page.getByRole("button", { name: `Actions pour ${name}` }).click();
  await page.getByRole("dialog", { name }).getByRole("button", { name: "Supprimer" }).click();
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

  test("vide, puis 10 éléments mêlés : capacité en tête, listes compactes, archive ; bouton d'envoi toujours visible ; axe ; captures", async ({ page, shh, isMobile }) => {
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
    // Page d'envoi « /envoyer » (D41-37) : le composeur était déjà là, le focus reste où il est.
    await expect(page.getByRole("heading", { level: 2, name: "Votre envoi" })).toBeVisible();
    await browse(page, MIXED.slice(1));
    await addNote(page, "Le code de la porte est 4512B.\nÀ ce soir !", "Code de la porte");
    await expect(rows(page)).toHaveCount(10);

    // Capacité en tête, à côté de « Votre envoi ».
    await expect(page.locator(".top .ht")).toHaveText(/^10\s\/\s200\séléments · [\d,]+\s(?:Ko|Mo) \/ 2\sGo$/);
    await expect(page.getByRole("meter", { name: "Nombre d'éléments" })).toHaveAttribute("aria-valuenow", "10");
    expect(await page.locator(".top .gh").evaluate((e) => getComputedStyle(e).fontVariantNumeric)).toContain("tabular-nums");
    expect(await page.locator(".group h3").allTextContents()).toEqual(["Texte", "Photos", "Vidéos", "Documents", "Archives"]);
    // Note : son titre et « Texte · taille » seulement, jamais le contenu (D41-37).
    const note = rows(page).filter({ has: page.locator('.nm[title="Code de la porte"]') });
    await expect(note.locator(".meta")).toContainText("Texte");
    await expect(note).not.toContainText("4512B");
    // Archive : catégorie, laissée intacte (D41-27) : rien sur la ligne, « Fichier tel quel » dans la bulle (D41-34).
    await expect(rows(page).filter({ hasText: "archive.zip" }).locator("[data-clean]")).toHaveCount(0);
    await expect(rows(page).filter({ hasText: "archive.zip" }).locator("[data-lock] button")).toHaveAccessibleName(/\. Fichier tel quel \(non modifié\)$/);
    // Nettoyage automatique (Task 9a, D41-23) : étincelle sur les photos nettoyées ; la vidéo
    // part sans clic, telle quelle. Plus aucun bouton « Nettoyer tous les fichiers ».
    await expect(rows(page).filter({ hasText: "plage-nuit.jpg" }).locator('[data-clean="nettoye"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Nettoyer tous les fichiers" })).toHaveCount(0);
    await expect(page.locator("[data-row]").getByText(/^(Original|Nettoyé|Non nettoyé)$/)).toHaveCount(0);
    // Listes compactes (décision du 7 novembre) : aucune vignette, une icône de format par ligne,
    // type, taille, durée ; plus d'estimation par fichier ni par catégorie (décision du 8 novembre).
    await expect(page.locator("[data-row] img")).toHaveCount(0);
    await expect(rows(page).filter({ hasText: "plage-nuit.jpg" }).locator("svg.fi")).toHaveAttribute("data-format", "JPG");
    await expect(rows(page).filter({ hasText: "archive.zip" }).locator("svg.fi")).toHaveAttribute("data-format", "ZIP");
    await expect(rows(page).filter({ hasText: "contrat.pdf" })).toContainText(/Document PDF.*octets/);
    await expect(page.locator("[data-row], .group .meta").filter({ hasText: /env\.\s/ })).toHaveCount(0);
    // « Tout supprimer » : un vrai bouton secondaire avec icône, dans l'en-tête de la liste, au-dessus des tailles.
    const clear = page.getByRole("button", { name: "Tout supprimer" });
    await expect(clear).toHaveClass(/secondary/);
    await expect(clear.locator("svg")).toHaveCount(1);
    expect((await clear.boundingBox())!.y).toBeLessThan((await page.locator(".cap").boundingBox())!.y);
    await expect(rows(page).filter({ hasText: "anniversaire-lou.webm" })).toContainText("1:12");
    await expect(page.locator(".group .meta").first()).toContainText(/^1 · /);
    expect(await noHScroll(page)).toBe(true);

    if (isMobile) {
      await expect(page.getByRole("button", { name: /^Actions pour / })).toHaveCount(10);
      await expect(page.getByRole("button", { name: /^Supprimer / })).toHaveCount(0);
      // Téléphone : une seule action d'ajout, « + » à côté de l'envoi ; ni zone de dépôt ni rangée.
      await expect(page.locator(".dropzone")).toHaveCount(0);
      await expect(page.getByRole("group", { name: "Créer sur place" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Ajouter", exact: true })).toBeVisible();
      expect(await longParagraphs(page.locator("main"))).toEqual([]);
    } else {
      // Ordinateur : une seule présentation (ni grille ni tableau) ; « Créer sur place » sans Photo ni Vidéo.
      await expect(page.locator(".groups .grid, .groups table, .groups .tile")).toHaveCount(0);
      // Même liste d'actions que la feuille du téléphone ; la zone de dépôt tient lieu de « Fichiers ».
      await expect(page.getByRole("group", { name: "Créer sur place" }).getByRole("button")).toHaveText(["Photo ou vidéo", "Vocal", "Note"]);
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
    await expect(rows(page).filter({ hasText: "sauvegarde" }).locator("[data-clean]")).toHaveCount(0);
    await expect(exe.locator("svg.fi")).toHaveAttribute("data-format", "EXE");
    await expect(rows(page).filter({ hasText: "vacances.jpg" }).locator("svg.fi")).toHaveAttribute("data-format", "EXE");
    await expect(rows(page).filter({ hasText: "budget-2026.xlsx" }).locator("svg.fi")).toHaveAttribute("data-format", "XLS");
    await expect(page.getByRole("button", { name: "Nettoyer tous les fichiers" })).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
  });

  test("mot de passe : toujours généré, 11 caractères, « Générer un autre » et « Copier » dans le champ ; aucune saisie (D41-15)", async ({ page, shh, isMobile, browserName }) => {
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
    expect(first).toMatch(/^[abcdefghkmnpqrtuvwxyACDEFGHJKLMNPQRTUVWXY23456789!?@#$%&*+\-=/()]{11}$/);
    await regen.click();
    await expect(pw).not.toHaveText(first!);
    if (browserName === "chromium") {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await copy.click();
      await expect(box.getByRole("button", { name: "Copié" })).toBeVisible();
      expect(await readClipboard(page)).toBe(await pw.textContent());
    }

    // D41-15 : aucune saisie possible, nulle part (ordinateur et feuille du téléphone).
    await expect(opts.getByRole("button", { name: "Écrire mon propre mot de passe" })).toHaveCount(0);
    await expect(opts.locator("input[type=text], input[type=password], input:not([type])")).toHaveCount(0);
    expect(await page.locator("form").count()).toBe(0);
    // Le champ et son contour de focus (2 + 2 px) tiennent dans la colonne (scan UX B4).
    await settle(page);
    const inside = await page.evaluate(() => {
      const box = document.querySelector(".pf .box")!.getBoundingClientRect();
      const col = (document.querySelector(".side-scroll") ?? document.querySelector("dialog[open]"))!;
      const c = col.getBoundingClientRect();
      const left = c.left + col.clientLeft;
      return { boxL: box.left, boxR: box.right, colL: left, colR: left + col.clientWidth, scrollW: col.scrollWidth, clientW: col.clientWidth };
    });
    expect(inside.boxL - 4).toBeGreaterThanOrEqual(inside.colL - 0.5);
    expect(inside.boxR + 4).toBeLessThanOrEqual(inside.colR + 0.5);
    expect(inside.scrollW).toBeLessThanOrEqual(inside.clientW);
    expect(await axe(page)).toEqual([]);
    if (isMobile) await page.keyboard.press("Escape");
    await expect(send(page)).toBeEnabled();
  });

  test("limites gratuites en clair ; choix payants verrouillés (badge Plus) → feuille honnête « Bientôt disponible » (D41-16)", async ({ page, shh, isMobile }) => {
    await open(page, shh.origin);
    await browse(page, [f("contrat.pdf")]);
    await expect(page.locator("[data-free]")).toHaveText("Gratuit\u202f: 2\u202fGo · 24\u202fh maximum");
    const opts = await options(page, isMobile);
    const locked = opts.locator("[data-locked] button, button[data-locked]");
    await expect(locked).toHaveCount(5);
    // Nom de l'offre en bulle au survol, plus de badge écrit (retours CLEAN2).
    await expect(opts.locator(".badge")).toHaveCount(0);
    expect(await locked.evaluateAll((bs) => bs.map((b) => b.getAttribute("title")))).toEqual(["Plus", "Plus", "Plus", "Plus", "Pro"]);
    // Retours OPT : espaces Plus et Pro en pastilles à côté de la jauge, unité « Go » comprise.
    await expect(page.locator(".top [data-paid-space] button")).toHaveText([/^10\sGo · Plus$/, /^50\sGo · Pro$/]);
    for (const b of await locked.all()) {
      const r = (await b.boundingBox())!;
      expect(r.height).toBeGreaterThanOrEqual(43.5);
    }
    await expect(opts.getByRole("radio", { name: "12 h" })).toBeChecked();
    await opts.getByRole("button", { name: "7\u202fjours", exact: true }).click();
    await expect(opts.getByRole("button", { name: "7\u202fjours", exact: true })).toHaveAccessibleDescription("Avec Plus, bientôt disponible.");
    const sheet = page.getByRole("dialog", { name: "Shhdrop Plus" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Bientôt disponible.");
    await expect(sheet).toContainText(/7\s€\s?par mois, TTC/);
    await expect(sheet).toContainText(/ou 70\s€ par an/);
    await expect(sheet.locator("form, input, a[href]")).toHaveCount(0);
    await settle(page);
    expect(await axe(page)).toEqual([]);
    await capture(page, "compose-paid-sheet");
    await sheet.getByRole("button", { name: "Compris" }).click();
    await expect(sheet).toBeHidden();
    await expect(opts.getByRole("radio", { name: "12 h" })).toBeChecked(); // rien n'a changé
    if (!isMobile) await capture(page, "compose-locked-options");
    else {
      await settle(page);
      await capture(page, "compose-locked-options");
      await page.keyboard.press("Escape");
    }
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

  test("retrait et Annuler ; Tout supprimer laisse la page d'envoi vide (D41-37), Annuler remet la liste", async ({ page, shh }) => {
    await open(page, shh.origin);
    await browse(page, [...PHOTOS.slice(0, 2), f("contrat.pdf")]);
    await removeItem(page, "plage-nuit.jpg");
    await expect(rows(page)).toHaveCount(2);
    await page.getByRole("group", { name: "plage-nuit.jpg supprimé" }).getByRole("button", { name: "Annuler" }).click();
    await expect(rows(page)).toHaveCount(3);
    await removeItem(page, "contrat.pdf");
    await expect(rows(page)).toHaveCount(2);
    await page.getByRole("group", { name: "contrat.pdf supprimé" }).getByRole("button", { name: "Annuler" }).click();
    await expect(rows(page)).toHaveCount(3);
    await page.getByRole("button", { name: "Tout supprimer" }).click();
    await expect(page.locator(".dropzone.empty")).toBeVisible(); // page d'envoi vide (D41-37)
    await page.getByRole("button", { name: "Annuler" }).click();
    await expect(rows(page)).toHaveCount(3);
  });

  test("ordinateur : lignes (Alt + ↓, renommer en place), notes (glisser, Alt + ↓) ; doublon ; nom long", async ({ page, shh, isMobile }) => {
    test.skip(isMobile, "ordinateur : lignes avec poignée et boutons");
    await open(page, shh.origin);
    await browse(page, PHOTOS.slice(0, 2));
    const grip = page.getByRole("button", { name: "Déplacer plage-nuit.jpg" });
    await grip.focus();
    await page.keyboard.press("Alt+ArrowDown");
    expect(await names(page)).toEqual(["toits-belleville.jpg", "plage-nuit.jpg"]);
    await expect(page.getByRole("status").filter({ hasText: "plage-nuit.jpg : position 2 sur 2 dans Photos." })).toHaveCount(1);
    await expect(grip).toBeFocused();
    await page.keyboard.press("Alt+ArrowUp");
    expect(await names(page)).toEqual(["plage-nuit.jpg", "toits-belleville.jpg"]);
    await page.getByRole("button", { name: "Renommer plage-nuit.jpg" }).click();
    await page.getByLabel("Nouveau nom de plage-nuit.jpg").fill("Plage");
    await page.keyboard.press("Enter");
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

    // Renommer en place : caractère interdit refusé, puis accepté ; doublon.
    await browse(page, [f("contrat.pdf")]);
    await page.getByRole("button", { name: "Renommer contrat.pdf" }).click();
    const field = page.getByLabel("Nouveau nom de contrat.pdf");
    await field.fill("a/b");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: "Caractère non permis" })).toBeVisible();
    await field.fill("Contrat signé");
    await page.keyboard.press("Enter");
    expect(await names(page)).toContain("Contrat signé.pdf");
    await browse(page, [f("toits-belleville.jpg")]);
    await expect(page.getByText("En double ?")).toHaveCount(2);

    // Nom long : coupé avec des points de suspension, l'extension reste lisible.
    await browse(page, [{ name: "photo-de-vacances-ete-2026-bretagne-au-bord-de-la-mer-avec-toute-la-famille.jpg", mimeType: "image/jpeg", buffer: readFileSync(f("plage-nuit.jpg")) }]);
    const long = rows(page).filter({ hasText: "photo-de-vacances" });
    await expect(long.locator(".e")).toHaveText(/\S\.jpg$/); // ellipse au milieu : la fin du nom et l'extension restent
    expect(await long.locator(".b").evaluate((e) => getComputedStyle(e).textOverflow)).toBe("ellipsis");
  });

  test("téléphone : menu « … » (Aperçu, Renommer, Supprimer ; ni Monter ni Descendre) ; feuille Options : focus piégé, Échap rend le focus", async ({ page, shh, isMobile }) => {
    test.skip(!isMobile, "téléphone : app");
    await open(page, shh.origin);
    await browse(page, PHOTOS.slice(0, 2));
    await page.getByRole("button", { name: "Actions pour plage-nuit.jpg" }).click();
    const menu = page.getByRole("dialog", { name: "plage-nuit.jpg" });
    await expect(menu.locator(".mi")).toHaveText(["Aperçu", "Renommer", "Supprimer"]);
    await settle(page);
    await capture(page, "compose-item-menu");
    await menu.getByRole("button", { name: "Renommer" }).click();
    await menu.getByLabel("Nouveau nom de plage-nuit.jpg").fill("Plage");
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    expect(await names(page)).toEqual(["Plage.jpg", "toits-belleville.jpg"]);
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

  test("limites : 200 fichiers minuscules puis un 201ᵉ → message, sans « Plus » (D41-17) ; plus de 2 Go → capacité en danger, ligne « Avec Plus », envoi bloqué ; 2 Go exactement accepté", async ({ page, shh, browserName }) => {
    test.setTimeout(120_000);
    await open(page, shh.origin);
    const note = (i: number) => ({ name: `n${i + 1}.txt`, mimeType: "text/plain", buffer: Buffer.from(`n${i}`) });
    await browse(page, Array.from({ length: 200 }, (_, i) => note(i)));
    await expect(rows(page)).toHaveCount(200);
    await expect(page.getByRole("meter", { name: "Nombre d'éléments" })).toHaveAttribute("aria-valuenow", "200");
    await expect(page.locator(".top .ht")).toHaveText(/^200\s\/\s200\séléments · /);
    await expect(page.locator(".cnote")).toHaveCount(0);
    await expect(send(page)).toBeEnabled();
    await browse(page, [note(200)], false);
    await expect(rows(page)).toHaveCount(200);
    await expect(page.locator(".cnote")).toContainText("1 élément n'a pas été ajouté : 200 maximum.");
    await expect(page.locator(".cnote")).toContainText("n201.txt");
    await expect(page.locator(".cnote [data-upsell]")).toHaveCount(0); // le nombre n'est pas vendu
    await capture(page, "compose-limit-count");

    test.skip(browserName !== "chromium", "fichier creux de 2 Go : Chromium (chemin local)");
    await page.getByRole("button", { name: "Tout supprimer" }).click();
    await expect(page.locator(".dropzone.empty")).toBeVisible(); // page d'envoi vide (D41-37)
    const dir = mkdtempSync(join(tmpdir(), "shh-2go-"));
    try {
      // Fichiers creux (aucun octet écrit sur le disque) : 2 Gio exactement, puis 2 Gio + 1 octet.
      const exact = join(dir, "film-2go.bin");
      const fe = openSync(exact, "w");
      ftruncateSync(fe, 2147483648);
      closeSync(fe);
      await browse(page, [exact]);
      await expect(rows(page)).toHaveCount(1);
      await expect(page.getByRole("alert").filter({ hasText: /^Trop gros/ })).toHaveCount(0);
      await expect(page.locator("#send-reason")).toHaveCount(0);
      await page.getByRole("button", { name: "Tout supprimer" }).click();
      await expect(page.locator(".dropzone.empty")).toBeVisible(); // page d'envoi vide (D41-37)
      const p = join(dir, "film-2go-plus-1.bin");
      const fd = openSync(p, "w");
      ftruncateSync(fd, 2147483648 + 1);
      closeSync(fd);
      await browse(page, [p]);
      await expect(rows(page)).toHaveCount(1);
      await expect(page.getByRole("alert").filter({ hasText: /^Trop gros\s:\s[\d,]+\s(?:octets?|Ko) de trop \(limite\s:\s2\sGo\)\.$/ }).first()).toBeVisible();
      expect(await page.locator(".top .fill").evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(255, 138, 128)");
      await expect(send(page)).toBeDisabled();
      await expect(page.locator("#send-reason")).toHaveText("Le total dépasse 2 Go. Supprimez des éléments.");
      // Retours OPT : plus de ligne « Avec Plus » en doublon, les pastilles 10 Go et 50 Go sont à côté de la jauge.
      await expect(page.locator(".top [data-upsell]")).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.waitForTimeout(6500);
      await capture(page, "compose-limit-size");
      await page.locator(".top [data-paid-space]").getByRole("button", { name: /^50\sGo · Pro$/ }).click();
      await expect(page.getByRole("dialog", { name: "Shhdrop Pro" })).toBeVisible();
      await page.keyboard.press("Escape");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("note sur machine lente : le focus différé de l'éditeur ne vole pas le champ déjà choisi (saisie gardée dans Contenu)", async ({ page, shh }) => {
    await open(page, shh.origin);
    await enterComposer(page); // « Commencer » d'abord : le piège ci-dessous vise le seul clic qui ouvre l'éditeur
    // Sous charge, l'image suivante tombe entre la prise du focus par la personne (ou l'outil)
    // et sa saisie : on rejoue exactement cet ordre (rappels d'image différés au focus d'un champ).
    await page.evaluate(() => {
      const raf = window.requestAnimationFrame.bind(window);
      let held: FrameRequestCallback[] = [];
      let armed = false;
      window.requestAnimationFrame = (cb) => {
        if (!armed) return raf(cb);
        held.push(cb);
        return 0;
      };
      document.addEventListener("click", () => void (armed = true), { capture: true, once: true });
      document.addEventListener("focusin", (e) => {
        if (!(e.target instanceof HTMLTextAreaElement) || held.length === 0) return;
        const run = held;
        held = [];
        armed = false;
        for (const cb of run) cb(performance.now());
      }, { capture: true });
    });
    await addNote(page, "Saisie rapide");
    await expect(rows(page)).toHaveCount(1);
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
    await dlg.getByLabel("Contenu").fill("x".repeat(100_001));
    await expect(dlg.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    await expect(dlg.getByText("100\u202f000\u202fcaractères maximum.")).toBeVisible();
    await dlg.getByLabel("Titre").fill("Courses");
    await dlg.getByLabel("Contenu").fill("Pain\nLait");
    await dlg.getByRole("button", { name: "Enregistrer" }).click();
    await expect(rows(page).first().locator(".nm")).toHaveText("Courses");
    await expect(rows(page).first()).not.toContainText("Pain"); // titre seul (D41-37)
    // Collage seulement une fois l'éditeur fermé : pendant sa fermeture, editorOpen est encore
    // vrai et le texte collé est ignoré (cause de l'instabilité en suite).
    await expect(dlg).toBeHidden();

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
    await expect(nd).toBeHidden();

    const png = [...readFileSync(f("schema.png"))];
    await page.evaluate((bytes) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], "image.png", { type: "image/png" }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, png);
    await expect(page.locator("[data-row] .nm", { hasText: "Image collée 1.png" })).toHaveCount(1);
  });

  test("2 notes, 3 photos, 1 vidéo, 2 documents, 1 archive : sans défilement de page ; catégories visibles à 1920, atteignables dans la liste à 1440 ; captures", async ({ page, shh, isMobile }) => {
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
        // Listes compactes (décision du 7 novembre) : à 1440 × 900, la liste défile en elle-même
        // (la page, jamais) ; à 1920 × 1080, tout tient.
        if (size.width === 1920) expect(heads.filter((h) => !h.ok), `${size.width}`).toEqual([]);
        else {
          await page.locator(".group h3", { hasText: "Archives" }).scrollIntoViewIfNeeded();
          expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);
          await expect(page.locator(".group h3", { hasText: "Archives" })).toBeInViewport();
        }
      }
    } else await capture(page, "compose-mix9");
    expect(await axe(page)).toEqual([]);
  });

  test("ajout : feuille « Ajouter » en quatre lignes (téléphone), rangée sobre sans doublon (ordinateur) ; plus de « Conversation » ici (onglet Salon)", async ({ page, shh, isMobile }) => {
    await open(page, shh.origin);
    await browse(page, [f("contrat.pdf")]);
    await expect(page.getByRole("button", { name: /^Conversation/ })).toHaveCount(0);
    if (isMobile) {
      await page.getByRole("button", { name: "Ajouter", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Ajouter" });
      const labels = await sheet.locator("[data-add] .lb").allTextContents();
      expect(labels).toEqual(["Photo ou vidéo", "Vocal", "Note", "Fichiers"]);
      await expect(sheet.locator("[data-add=voice]")).toContainText("Micro seulement, 30\u202fmin\u202fmaximum");
      for (const b of await sheet.locator("[data-add]").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(56);
      await capture(page, "add-sheet");
      // « Fichiers » : tout type, plusieurs.
      const chooser = page.waitForEvent("filechooser");
      await sheet.getByRole("button", { name: /^Fichiers/ }).click();
      const fc = await chooser;
      expect(await fc.element().getAttribute("accept")).toBeNull();
      expect(fc.isMultiple()).toBe(true);
    } else {
      await expect(page.getByRole("button", { name: "Ajouter", exact: true })).toHaveCount(0);
      await expect(page.locator(".dropzone")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Commencer/ })).toHaveCount(0);
    }
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
    await expect(rows(page).first().locator(".e")).toHaveText(/^x+\.pdf$/);
  });
});

test.describe("en-US", () => {
  test.use({ locale: "en-US" });

  test("composer in English ; capture", async ({ page, shh, isMobile }) => {
    if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(shh.origin + "/");
    // « Get started » mène à la page d'envoi (D41-37) ; puis « Add » (téléphone) ou la zone de dépôt.
    await page.getByRole("button", { name: /^Get started/ }).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/envoyer$/);
    const chooser = page.waitForEvent("filechooser");
    if (isMobile) {
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: /^Files/ }).click();
    } else await page.locator(".dropzone.empty").click();
    await (await chooser).setFiles(MIXED.slice(0, 8));
    await expect(page.getByRole("heading", { level: 2, name: "Your share" })).toBeVisible();
    await expect(page.locator(".top .ht")).toHaveText(/^8\s\/\s200\sitems · /);
    if (isMobile) await expect(page.getByRole("button", { name: /^Options · 12h · 1\sopen · download allowed$/ })).toBeVisible();
    else await expect(page.locator(".summary")).toHaveText("Erased in 12h or after 1\u00a0open, whichever comes first.");
    expect(await axe(page)).toEqual([]);
    await capture(page, "compose-filled-en");
  });
});
