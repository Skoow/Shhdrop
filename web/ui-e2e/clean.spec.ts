// Nettoyage des métadonnées (spec §35.2, Task 9a ; décision du propriétaire du 8 novembre,
// D41-23 ; présentation D41-34 ; depuis le 12 novembre, seulement au balai ou par « Tout
// nettoyer », plus de réglage automatique) : 2ᵉ ligne de la bulle du cadenas (« Nettoyé : … »,
// « Fichier tel quel », « Nettoyage impossible : … »), étincelle ou pastille ambre sur la ligne,
// envoi sans clic, résumé des échecs près d'Envoyer, rien de nettoyé à l'ajout, photo reçue sans
// GPS (octet par octet), images nettoyées toujours décodables (createImageBitmap).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { stripMetadata } from "../src/media/strip";
import { expect, test } from "./fixtures";
import { file, freshPage, sendShare, unlock } from "./open-helpers";
import { cleanAll, openFilePicker, sendButton } from "./send-helpers";

test.use({ locale: "fr-FR" });

const FX = (n: string) => readFileSync(fileURLToPath(new URL(`../src/media/fixtures/${n}`, import.meta.url)));
const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-9a/", import.meta.url));
const MARKERS = /ReperMake|ReperModel|ReperXMP|ReperSecond|ReperMotion|2001:02:03/;
const row = (page: Page, name: string) => page.locator("[data-row]").filter({ hasText: name });
/** Bouton du cadenas de la ligne : son nom porte les deux lignes de la bulle (D41-34). */
const lock = (page: Page, name: string) => row(page, name).locator("[data-lock] button");
const esc = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
const detail = (s: string) => new RegExp("\\. " + esc(s).replace(/ : /g, "\\s: ") + "$");

async function cleaned(name: string, mime: string): Promise<Buffer> {
  const r = await stripMetadata(new Blob([FX(name)]), mime, name);
  if (r.state !== "nettoye") throw new Error(`${name} : ${r.state}`);
  return Buffer.from(await r.data.arrayBuffer());
}

/** Faux showSaveFilePicker : garde les octets écrits (en base64). */
async function fakePicker(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.showSaveFilePicker = async () => {
      const parts: number[] = [];
      return {
        createWritable: async () => ({
          write: async (c: Uint8Array) => void parts.push(...new Uint8Array(c)),
          close: async () => void (w.__bytes = btoa(String.fromCharCode(...parts))),
          abort: async () => undefined,
        }),
      };
    };
  });
}

test("photo avec GPS : « Nettoyé » par « Tout nettoyer », le destinataire reçoit la photo nettoyée, octet par octet", async ({ page, shh, browser }) => {
  test.setTimeout(120_000);
  const s = await freshPage(browser);
  const photo = { name: "IMG_GPS.jpg", mimeType: "image/jpeg", buffer: FX("iphone-like.jpg") };
  await s.page.goto(shh.origin + "/");
  await (await openFilePicker(s.page)).setFiles(photo);
  await cleanAll(s.page);
  const r = row(s.page, "IMG_GPS");
  // D41-34 : étincelle à côté du type ; le détail dans la bulle du cadenas (2ᵉ ligne).
  await expect(r.locator('[data-clean="nettoye"]')).toBeVisible();
  await expect(lock(s.page, "IMG_GPS")).toHaveAccessibleName(detail("Nettoyé : position, appareil et dates retirés, vignette d'aperçu gardée"));
  await s.ctx.close();
  const s2 = await freshPage(browser);
  const sent = await sendShare(s2.page, shh.origin + "/", { files: [photo], clean: true });
  await s2.ctx.close();
  await fakePicker(page);
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await page.getByRole("button", { name: "Télécharger IMG_GPS.jpg" }).click();
  await expect(page.locator('li.row[data-state="done"]')).toBeVisible({ timeout: 30_000 });
  const got = Buffer.from((await page.evaluate(() => (window as unknown as { __bytes: string }).__bytes)) as string, "base64");
  const want = await cleaned("iphone-like.jpg", "image/jpeg");
  expect(got.equals(want)).toBe(true);
  expect(got.toString("latin1")).not.toMatch(MARKERS);
  expect(got.length).toBeLessThan(photo.buffer.length);
});

test("états à l'écran (D41-34) après « Tout nettoyer » : nettoyé (photo, PDF), nettoyage impossible (échec, PDF protégé), tel quel (format non lu, archive) ; tout part sans clic (D41-23) ; résumé des échecs près d'Envoyer", async ({ page, shh, isMobile }) => {
  test.setTimeout(90_000);
  if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
  const puts: string[] = [];
  page.on("request", (q) => {
    if (q.method() === "PUT" && q.url().includes("/api/shares/segments/")) puts.push(q.url());
  });
  await page.goto(shh.origin + "/");
  const jpg = FX("iphone-like.jpg");
  await (await openFilePicker(page)).setFiles([
    { name: "IMG_GPS.jpg", mimeType: "image/jpeg", buffer: jpg },
    { name: "abime.jpg", mimeType: "image/jpeg", buffer: jpg.subarray(0, jpg.length >> 2) },
    { name: "devis.pdf", mimeType: "application/pdf", buffer: FX("meta.pdf") },
    { name: "signe.pdf", mimeType: "application/pdf", buffer: FX("signed.pdf") },
    { name: "archive.zip", mimeType: "application/zip", buffer: readFileSync(file("archive.zip")) },
    { name: "dessin.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") },
  ]);
  await expect(page.locator("[data-row]")).toHaveCount(6);
  await cleanAll(page);
  await expect(row(page, "IMG_GPS").locator('[data-clean="nettoye"]')).toBeVisible();
  await expect(row(page, "IMG_GPS").locator('[data-clean="echec"]')).toHaveCount(0);
  const fail = (n: string) => row(page, n).locator('[data-clean="echec"]');
  // Échec : petite pastille ambre sur la ligne, la raison dans la bulle du cadenas.
  await expect(fail("abime")).toBeVisible();
  await expect(lock(page, "abime")).toHaveAccessibleName(detail("Nettoyage impossible : structure du fichier inattendue"));
  // PDF (D41-31) : informations cachées retirées ; signé → nettoyage impossible, laissé intact.
  await expect(lock(page, "devis")).toHaveAccessibleName(detail("Nettoyé : propriétés du document retirées (auteur, logiciel, dates)"));
  await expect(fail("signe")).toBeVisible();
  await expect(lock(page, "signe")).toHaveAccessibleName(detail("Nettoyage impossible : fichier signé ou protégé"));
  // Image d'un format que le nettoyage ne lit pas (décision du 10 novembre ; dit dès l'ajout
  // depuis le 12 novembre) : pastille ambre, sans balai.
  await expect(fail("dessin")).toBeVisible();
  await expect(lock(page, "dessin")).toHaveAccessibleName(detail("Nettoyage impossible : format non pris en charge"));
  await expect(row(page, "dessin").getByRole("button", { name: /^Nettoyer ce fichier/ })).toHaveCount(0);
  // Archive (jamais ouverte, D41-27) : « Fichier tel quel », rien sur la ligne.
  for (const n of ["archive"]) {
    await expect(lock(page, n)).toHaveAccessibleName(detail("Fichier tel quel (non modifié)"));
    await expect(row(page, n).locator("[data-clean]")).toHaveCount(0);
  }
  // Plus aucune marque écrite.
  await expect(page.locator("[data-row]").getByText(/^(Original|Nettoyé|Non nettoyé|Archive laissée intacte)$/)).toHaveCount(0);
  // Aucun choix à faire : plus de bouton, envoi permis, résumé discret près d'Envoyer.
  await expect(page.getByRole("button", { name: /^Envoyer tel quel/ })).toHaveCount(0);
  await expect(page.locator("#send-reason").filter({ visible: true })).toHaveCount(0);
  // Deux décomptes (audit D5) : abime.jpg et signe.pdf ont échoué ; dessin.svg n'est pas lu.
  await expect(page.locator("[data-unclean-sum]").filter({ visible: true }).locator("span")).toHaveText(["2\u202ffichiers n'ont pas pu être nettoyés", "1\u202ffichier ne peut pas être nettoyé (format non pris en charge)"]);
  await expect(sendButton(page).filter({ visible: true })).toBeEnabled();
  // Chacun part dès l'ajout (une requête d'envoi par petit élément), puis la version nettoyée
  // remplace l'original (au moins une requête de plus par fichier nettoyé).
  await expect.poll(() => puts.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(6);
  await expect(page.locator('[data-up]:not([data-up="pret"])')).toHaveCount(0, { timeout: 30_000 });
  if (isMobile) await page.screenshot({ path: `${SHOTS}compose-clean-states-390.png` });
});

test("document Word avec auteur (Task 9b, D41-27) : « Nettoyé » au balai, aucune remarque, reçu sans propriétés ; commentaires intacts", async ({ page, shh, browser }) => {
  test.setTimeout(120_000);
  const doc = { name: "rapport.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: FX("meta.docx") };
  const s = await freshPage(browser);
  await s.page.goto(shh.origin + "/");
  await (await openFilePicker(s.page)).setFiles(doc);
  const r = row(s.page, "rapport");
  await r.getByRole("button", { name: "Nettoyer ce fichier" }).click();
  await s.page.getByRole("dialog", { name: "Nettoyer ce fichier\u202f?" }).getByRole("button", { name: "Nettoyer", exact: true }).click();
  await expect(r.locator('[data-clean="nettoye"]')).toBeVisible();
  await expect(lock(s.page, "rapport")).toHaveAccessibleName(detail("Nettoyé : propriétés et chemin local du fichier retirés (auteurs des commentaires et liens vers d'autres fichiers gardés)"));
  // Aucune remarque sur la ligne (D41-27) ; la bulle du cadenas et celle du bouclier disent le texte exact.
  await expect(r.getByText(/modifications suivies|commentaires/).and(s.page.locator(":not([data-lock] *, [data-clean] *)"))).toHaveCount(0);
  await s.ctx.close();
  const s2 = await freshPage(browser);
  const sent = await sendShare(s2.page, shh.origin + "/", { files: [doc], clean: true });
  await s2.ctx.close();
  await fakePicker(page);
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await page.getByRole("button", { name: "Télécharger rapport.docx" }).click();
  await expect(page.locator('li.row[data-state="done"]')).toBeVisible({ timeout: 30_000 });
  const got = Buffer.from((await page.evaluate(() => (window as unknown as { __bytes: string }).__bytes)) as string, "base64");
  const want = await cleaned("meta.docx", doc.mimeType);
  expect(got.equals(want)).toBe(true);
  expect(got.subarray(0, 4).toString("latin1")).toBe("PK\x03\x04");
  expect(got.toString("latin1")).not.toMatch(/ReperSociete|ReperMiniature|ReperTitre/);
  expect(doc.buffer.toString("latin1")).toMatch(/ReperAuteur/);
});

test("rien n'est nettoyé à l'ajout (plus de réglage, décision du propriétaire du 12 novembre) : « Fichier tel quel » dans la bulle, rien sur la ligne, rien de modifié", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  await expect(page.locator("footer[data-foot]").getByRole("switch")).toHaveCount(0);
  await (await openFilePicker(page)).setFiles({ name: "IMG_GPS.jpg", mimeType: "image/jpeg", buffer: FX("iphone-like.jpg") });
  await expect(lock(page, "IMG_GPS")).toHaveAccessibleName(detail("Fichier tel quel (non modifié)"));
  await expect(row(page, "IMG_GPS").locator("[data-clean]")).toHaveCount(0);
  await expect(row(page, "IMG_GPS").getByText("Original")).toHaveCount(0);
  await expect(page.locator("[data-unclean-sum]").filter({ visible: true })).toHaveCount(0);
  await expect(page.locator("#send-reason").filter({ visible: true })).toHaveCount(0);
});

test("images nettoyées toujours décodables (createImageBitmap), orientation gardée", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  const cases: [string, string][] = [
    ["iphone-like.jpg", "image/jpeg"],
    ["progressive.jpg", "image/jpeg"],
    ["meta.png", "image/png"],
    ["meta.webp", "image/webp"],
    ["simple.webp", "image/webp"],
    ["meta.gif", "image/gif"],
    ["meta.avif", "image/avif"],
  ];
  const decode = (b: Buffer, mime: string) =>
    page.evaluate(async ([data, type]) => {
      const bytes = Uint8Array.from(atob(data!), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type }));
      return [bmp.width, bmp.height];
    }, [b.toString("base64"), mime]);
  for (const [name, mime] of cases) {
    // Même taille affichée qu'avant le nettoyage : l'orientation est gardée.
    const size = await decode(await cleaned(name, mime), mime);
    expect(size, name).toEqual(await decode(FX(name), mime));
    // Orientation EXIF 6 : l'image de 16 × 8 s'affiche en 8 × 16.
    if (name === "iphone-like.jpg") expect(size).toEqual([8, 16]);
  }
});
