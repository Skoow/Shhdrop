// « Le serveur ne voit rien » (spec §14), étendu aux chemins d'envoi et d'ouverture du NAVIGATEUR —
// CE TEST BLOQUE TOUTE MISE EN LIGNE. Un texte, un nom de fichier et un contenu repères sont
// envoyés par l'interface (vrai serveur, vraie preuve de travail, XHR des segments). On fouille
// ensuite, en octets bruts et en base64url / base64 : chaque requête du navigateur (URL,
// en-têtes, corps), les réponses, stdout/stderr du serveur et le dossier de données. Ni le
// contenu, ni les noms, ni le mot de passe, ni K_lien, ni l'id dérivé du lien ne doivent y être.
import { shareId, type KLien } from "../src/engine";
import { findIn, needle, scanDir, type Needle } from "../e2e/scan";
import { expect, gotoRetrying, test } from "./fixtures";
import { addText, openFilePicker, readyHeading, sendButton } from "./send-helpers";

const TEXT = "MOT-REPERE-NAVIGATEUR-5d1e : le code de la porte est 4471";
// Aucune fenêtre de 8 caractères du nom ne doit exister dans un en-tête ordinaire : « navigate »
// (Sec-Fetch-Mode, envoyé par WebKit) donnait un faux positif sur « GET / » (CI du 10 novembre).
const NAME = "nom-repere-fureteur-a83f.pdf";
const CONTENT = "CONTENU-REPERE-NAVIGATEUR-0c6b ".repeat(4000);
const windows = (label: string, s: string) => Array.from({ length: s.length - 7 }, (_, i) => needle(`${label}[${i}]`, s.slice(i, i + 8)));

test.describe("fr-FR", () => {
  test.use({ locale: "fr-FR" });

  test("envoi puis ouverture par l'interface : aucune donnée claire, aucun nom, ni mot de passe ni K_lien côté serveur", async ({ page, shh }) => {
    test.setTimeout(120_000);
    const sent: { label: string; data: Buffer }[] = [];
    page.on("request", (r) => {
      const head = Object.entries(r.headers())
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      sent.push({ label: `${r.method()} ${new URL(r.url()).pathname}`, data: Buffer.concat([Buffer.from(r.url() + "\n" + head + "\n"), r.postDataBuffer() ?? Buffer.alloc(0)]) });
    });
    const answers: { label: string; data: Buffer }[] = [];
    page.on("response", async (r) => {
      if (!new URL(r.url()).pathname.startsWith("/api/")) return;
      answers.push({ label: `réponse ${new URL(r.url()).pathname}`, data: await r.body().catch(() => Buffer.alloc(0)) });
    });

    await page.goto(shh.origin + "/");
    await addText(page, TEXT);
    // Geste visible (téléphone : feuille « Ajouter » ; le .dropzone de l'ordinateur y est absent).
    const chooser = openFilePicker(page);
    await (await chooser).setFiles({ name: NAME, mimeType: "application/octet-stream", buffer: Buffer.from(CONTENT) });
    await expect(page.locator("[data-row]")).toHaveCount(2);
    await sendButton(page).click();
    await expect(readyHeading(page)).toBeVisible({ timeout: 60_000 });

    const link = (await page.getByRole("group", { name: "Lien", exact: true }).locator(".sr-only").first().textContent()) ?? "";
    const password = (await page.getByRole("group", { name: "Mot de passe", exact: true }).locator(".sr-only").first().textContent()) ?? "";
    expect(link).toMatch(/#[A-Za-z0-9_-]{43}$/);
    expect(password.length).toBeGreaterThanOrEqual(8);
    const kLien = new Uint8Array(Buffer.from(link.slice(link.indexOf("#") + 1), "base64url"));
    expect(kLien.length).toBe(32);
    const id = await shareId(new Uint8Array(kLien) as KLien);

    const needles: Needle[] = [
      ...windows("texte", TEXT),
      ...windows("nom", NAME.replace(/\.pdf$/, "")),
      needle("contenu", "CONTENU-REPERE-NAVIGATEUR-0c6b"),
      needle("mot de passe", password),
      needle("K_lien", kLien as Uint8Array<ArrayBuffer>),
      needle("K_lien (texte)", link.slice(link.indexOf("#") + 1)),
      needle("id dérivé du lien", id),
    ];

    // Témoin : la capture voit bien les en-têtes et les corps (S_gestion part, par conception, en en-tête).
    const manage = (await page.locator(".manage .sr-only").first().textContent()) ?? "";
    const sGestion = new Uint8Array(Buffer.from(manage.slice(manage.indexOf("#m") + 2), "base64url"));
    expect(findIn(Buffer.concat(sent.map((s) => s.data)), [needle("témoin S_gestion", sGestion as Uint8Array<ArrayBuffer>)])).toEqual(["témoin S_gestion"]);
    // Chemin d'ouverture (Tasks 20, 21, 23) : le destinataire ouvre le lien dans cet onglet,
    // tape le mot de passe (une fois faux, puis juste), lit le texte et enregistre le fichier
    // (faux sélecteur de fichier). Les mêmes captures couvrent ses requêtes et leurs réponses.
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      w.showSaveFilePicker = async () => ({
        createWritable: async () => ({ write: async () => undefined, close: async () => void (w.__closed = true), abort: async () => undefined }),
      });
    });
    await page.goto("about:blank"); // nouveau document : le script ci-dessus s'applique
    await gotoRetrying(page, shh.origin, link);
    await page.getByLabel("Mot de passe", { exact: true }).fill(password + "x");
    await page.getByRole("button", { name: "Déverrouiller" }).click();
    await expect(page.locator("#open-err").getByText(/^Mot de passe incorrect/)).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("Mot de passe", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Déverrouiller" }).click();
    await expect(page.locator('li.row[data-kind="note"]')).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: `Télécharger ${NAME}` }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, unknown>).__closed)).toBe(true);
    for (const route of ["GET /api/shares/meta", "POST /api/shares/unlock", "GET /api/shares/segments/0"])
      expect(sent.some((s) => s.label === route), route).toBe(true);
    needles.push(needle("mot de passe faux", password + "x"));

    const puts = sent.filter((s) => s.label.startsWith("PUT /api/shares/segments/"));
    expect(puts.length).toBeGreaterThan(0);
    expect(puts.reduce((n, s) => n + s.data.length, 0)).toBeGreaterThan(CONTENT.length);
    const hits: string[] = [];
    for (const s of [...sent, ...answers]) for (const l of findIn(s.data, needles)) hits.push(`${s.label} : ${l}`);
    for (const l of findIn(Buffer.concat([shh.server.stdout(), shh.server.stderr()]), needles)) hits.push(`journal : ${l}`);
    hits.push(...scanDir(shh.server.dataDir, needles));
    expect(hits).toEqual([]);
  });
});
