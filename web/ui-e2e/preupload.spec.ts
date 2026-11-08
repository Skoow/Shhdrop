// Envoi dès l'ajout (spec §41.14, D41-19) sur le vrai serveur : deux fichiers ajoutés, l'envoi
// commence avant le clic ; l'un est retiré pendant son envoi → requête d'effacement, ses
// segments absents du disque, place rendue ; « Chiffrer et envoyer » → le destinataire ne voit
// que l'élément gardé.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { openShare } from "../src/index";
import { expect, test } from "./fixtures";
import { openFilePicker, readyHeading, sendButton, sleep } from "./send-helpers";

const MIB = 1048576;
const SEG = 48 + 64 * 65552; // segment 0 (avec l'en-tête) ; les suivants : 64 × 65 552 octets

const fill = (n: number, seed: number) => {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i += 997) b[i] = (i * seed) & 255;
  return b;
};

async function removeItem(page: Page, name: string) {
  const direct = page.getByRole("button", { name: `Retirer ${name}` });
  if (await direct.isVisible()) return direct.click();
  await page.getByRole("button", { name: `Actions pour ${name}` }).click();
  await page.getByRole("dialog", { name }).getByRole("button", { name: "Retirer" }).click();
}

test.describe("fr-FR", () => {
  test.use({ locale: "fr-FR", timezoneId: "Europe/Paris" });

  test("l'envoi commence à l'ajout ; retirer pendant l'envoi efface sur le serveur ; le destinataire ne voit que le gardé", async ({ page, shh }) => {
    test.setTimeout(120_000);
    const puts: number[] = [];
    const erases: unknown[] = [];
    // Chaque PUT après le premier est retardé : l'envoi du second fichier dure.
    await page.route(/\/api\/shares\/segments\/\d+$/, async (route) => {
      if (route.request().method() === "PUT") {
        puts.push(Number(/(\d+)$/.exec(route.request().url())![1]));
        if (puts.length > 1) await sleep(1500);
      }
      await route.continue().catch(() => undefined);
    });
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/shares/erase") erases.push(r.postDataJSON());
    });
    // Aucune erreur de page (une boucle d'effets Svelte, par exemple, figerait les lignes).
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(shh.origin + "/");
    const chooser = openFilePicker(page);
    await (await chooser).setFiles([
      { name: "garde.bin", mimeType: "application/octet-stream", buffer: fill(3 * MIB, 3) },
      { name: "retire.bin", mimeType: "application/octet-stream", buffer: fill(9 * MIB, 7) },
    ]);
    await expect(page.locator("[data-row]")).toHaveCount(2);

    // Avant tout clic : brouillon créé, premier fichier envoyé, second en cours.
    const kept = page.locator("[data-row]").filter({ hasText: "garde.bin" });
    const gone = page.locator("[data-row]").filter({ hasText: "retire.bin" });
    await expect(kept.locator("[data-up]")).toHaveAttribute("data-up", "pret", { timeout: 30_000 });
    await expect(gone.locator("[data-up]")).toHaveAttribute("data-up", "envoi", { timeout: 30_000 });
    await expect(gone.locator("[data-up]")).toContainText(/Envoi \d+ %/);
    expect(puts[0]).toBe(0);

    const blobs = join(shh.server.dataDir, "blobs");
    const [file] = readdirSync(blobs);
    expect(file).toBeTruthy();

    await removeItem(page, "retire.bin");
    await expect(page.locator("[data-row]")).toHaveCount(1);
    await expect.poll(() => erases.length, { timeout: 20_000 }).toBe(1);
    expect(erases[0]).toEqual({ from: 1, to: 4 }); // 9 Mio : segments 1 à 3
    await expect(page.getByText("Suppression sur le serveur…")).toBeHidden({ timeout: 20_000 });
    // Segments du fichier retiré : absents du disque (relus comme des zéros), le premier intact.
    const raw = readFileSync(join(blobs, file!));
    const removed = raw.subarray(SEG, Math.min(raw.length, SEG + 3 * 64 * 65552));
    expect(removed.every((x) => x === 0)).toBe(true);
    expect(raw.subarray(48, SEG).some((x) => x !== 0)).toBe(true);
    // Place rendue : la jauge ne compte plus que le fichier gardé.
    await expect(page.locator(".cap")).toContainText("3");
    await expect(page.locator(".cap")).not.toContainText("12");

    await sendButton(page).click();
    await expect(readyHeading(page)).toBeVisible({ timeout: 60_000 });
    const read = async (name: string) => (await page.getByRole("group", { name }).locator(".sr-only").first().textContent()) ?? "";
    const link = await read("Lien");
    const password = await read("Mot de passe");
    const o = await openShare(link, password, shh.origin);
    expect(o.manifest.items.map((e) => e.name)).toEqual(["garde.bin"]);
    expect(Buffer.from(await o.item(0)).equals(fill(3 * MIB, 3))).toBe(true);
    await o.done();
    expect(errors).toEqual([]);
  });
});
