// Page de contenu « 2027 » en listes compactes (Task R2 ; décisions du propriétaire du
// 7 novembre) : une ligne par élément (icône de format, nom, type, taille, temps estimé,
// actions), groupes par catégorie avec nombre et taille ; téléchargement d'un fichier, d'une
// catégorie, de tout ; pause, reprise, arrêt ; visionneuse en panneau ; archive .zip ;
// « voir seulement ». Captures fr-FR à 1440 et 390 px.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "@playwright/test";
import { axe, capture, expect, test } from "./fixtures";
import { file, freshPage, sendShare, settle, unlock, type Sent } from "./open-helpers";

test.use({ locale: "fr-FR" });

const TEXT = "Bonjour,\nvoici les documents de la réunion.";
const NAMES = ["foret-brume.jpg", "lac-gele.jpg", "schema.png", "vocal.ogg", "anniversaire-lou.webm", "contrat.pdf", "budget-2026.xlsx", "archive.zip", "installer.exe", "trap.svg"];
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function share(browser: Browser, origin: string, o: { download?: boolean } = {}): Promise<Sent> {
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, origin + "/", { text: TEXT, files: NAMES.map(file), opens: 5, download: o.download });
  await s.ctx.close();
  return sent;
}

const rows = (page: Page) => page.locator("li.row");
const row = (page: Page, name: string) => rows(page).filter({ hasText: name });

test("listes compactes : groupes, icônes par format, types, tailles, temps estimés ; axe ; captures", async ({ page, shh, browser }, info) => {
  test.setTimeout(180_000);
  const sent = await share(browser, shh.origin);
  await page.goto(sent.link);
  await unlock(page, sent.password);

  const heads = await page.locator("section.group h2").allTextContents();
  expect(heads).toEqual(["Texte", "Photos", "Vidéos", "Audio et vocaux", "Documents", "Archives", "Autres"]);
  // Chaque en-tête : nombre et taille cumulée.
  await expect(page.locator('[data-group="photos"] .gm:not(.eta)')).toHaveText(/^4 · /);
  // Une icône de format par ligne, avec son étiquette.
  const fmt = async (name: string) => row(page, name).locator("svg.fi").getAttribute("data-format");
  expect(await fmt("contrat.pdf")).toBe("PDF");
  expect(await fmt("budget-2026.xlsx")).toBe("XLS");
  expect(await fmt("archive.zip")).toBe("ZIP");
  expect(await fmt("installer.exe")).toBe("EXE");
  expect(await fmt("foret-brume.jpg")).toBe("JPG");
  expect(await fmt("schema.png")).toBe("PNG");
  expect(await fmt("vocal.ogg")).toBe("OGG");
  expect(await fmt("trap.svg")).toBe("SVG");
  await expect(row(page, "contrat.pdf")).toContainText("Document PDF");
  await expect(row(page, "contrat.pdf")).toContainText(/env\.\s/);
  await expect(page.locator(".sum")).toContainText("(estimation)");
  // « Voir » sur image, vidéo, audio, texte ; jamais sur SVG, PDF, programme, archive.
  for (const n of ["foret-brume.jpg", "vocal.ogg", "anniversaire-lou.webm"]) await expect(row(page, n).getByRole("button", { name: `Voir ${n}` })).toBeVisible();
  for (const n of ["trap.svg", "contrat.pdf", "installer.exe", "archive.zip"]) {
    await expect(row(page, n).getByRole("button", { name: /^Voir/ })).toHaveCount(0);
    await expect(row(page, n).getByRole("button", { name: `Télécharger ${n}` })).toBeVisible();
  }
  // Aucune vignette : aucune image ni canvas dans la liste.
  expect(await page.locator("ul.items img, ul.items canvas").count()).toBe(0);
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await capture(page, "content-list-1440");
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Zones tactiles : 44 px au moins.
  const small = await page.locator("ul.items button, [data-download-bar] button").evaluateAll((bs) =>
    bs.filter((b) => b.getBoundingClientRect().height < 44 || b.getBoundingClientRect().width < 44).map((b) => b.getAttribute("aria-label") ?? b.textContent),
  );
  expect(small).toEqual([]);
  expect(await axe(page)).toEqual([]);
  await capture(page, "content-list-390");
  void info;
});

/** Faux sélecteurs (fichier, dossier) : octets gardés en mémoire de la page, SHA-256 à la fermeture. */
async function fakePickers(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __fs: Record<string, { sha?: string; aborted?: boolean; bytes: number }>; __dirPicks: number } & Record<string, unknown>;
    w.__fs = {};
    w.__dirPicks = 0;
    const writable = (name: string) => {
      const parts: Uint8Array[] = [];
      const f = (w.__fs[name] = { bytes: 0 } as { sha?: string; aborted?: boolean; bytes: number });
      return {
        write: async (c: Uint8Array) => {
          parts.push(new Uint8Array(c));
          f.bytes += c.length;
        },
        close: async () => {
          const h = await crypto.subtle.digest("SHA-256", await new Blob(parts as BlobPart[]).arrayBuffer());
          f.sha = [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
        },
        abort: async () => void (f.aborted = true),
      };
    };
    w.showSaveFilePicker = async ({ suggestedName }: { suggestedName: string }) => ({ createWritable: async () => writable(suggestedName) });
    w.showDirectoryPicker = async () => {
      w.__dirPicks++;
      return {
        getFileHandle: async (n: string, o?: { create?: boolean }) => {
          if (!o?.create && !(n in w.__fs)) throw new DOMException("absent", "NotFoundError");
          return { createWritable: async () => writable(n) };
        },
      };
    };
  });
}
const fs = (page: Page) => page.evaluate(() => (window as unknown as { __fs: Record<string, { sha?: string; aborted?: boolean; bytes: number }> }).__fs);

/** Fichiers de 9 Mio pseudo-aléatoires (3 segments chacun). */
function big(seed: number): Buffer {
  const b = Buffer.alloc(9 * 1048576);
  for (let i = 0, x = seed; i < b.length; i++) b[i] = (x = (x * 1103515245 + 12345) & 0x7fffffff) >>> 16;
  return b;
}
const A = big(3);
const B = big(5);
const C = big(9);

test("contrôles à trois niveaux : fichier, catégorie, tout ; pause sans relecture, reprise, arrêt ; captures", async ({ page, shh, browser }) => {
  test.setTimeout(240_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", {
    files: [
      { name: "a.bin", mimeType: "application/octet-stream", buffer: A },
      { name: "b.bin", mimeType: "application/octet-stream", buffer: B },
      { name: "c.bin", mimeType: "application/octet-stream", buffer: C },
    ],
    opens: 3,
  });
  await s.ctx.close();
  await fakePickers(page);
  await page.goto(sent.link);
  await unlock(page, sent.password);
  // Segments lents et comptés : une pause ne doit rien relire.
  const reads: number[] = [];
  let delay = 700;
  await page.route("**/api/shares/segments/*", async (r) => {
    reads.push(Number(r.request().url().split("/").pop()));
    await new Promise((res) => setTimeout(res, delay));
    await r.continue();
  });

  // Fichier : pause, puis reprise ; aucun segment demandé pendant la pause ; contenu exact.
  await page.getByRole("button", { name: "Télécharger a.bin" }).click();
  await expect(row(page, "a.bin")).toHaveAttribute("data-state", "downloading");
  await page.getByRole("button", { name: "Mettre en pause a.bin" }).click();
  await expect(row(page, "a.bin")).toHaveAttribute("data-state", "paused");
  await settle(page);
  await capture(page, "content-paused-1440");
  await page.waitForTimeout(1500);
  const during = reads.length;
  await page.waitForTimeout(2000);
  expect(reads.length).toBe(during);
  await page.getByRole("button", { name: "Reprendre a.bin" }).click();
  await expect(row(page, "a.bin")).toHaveAttribute("data-state", "done", { timeout: 60_000 });
  expect((await fs(page))["a.bin"]!.sha).toBe(sha(A));
  expect(new Set(reads).size).toBe(reads.length); // aucun segment relu

  // Arrêt : partiel supprimé, la ligne revient au départ.
  await page.getByRole("button", { name: "Télécharger b.bin" }).click();
  await expect(row(page, "b.bin")).toHaveAttribute("data-state", "downloading");
  await page.getByRole("button", { name: "Arrêter b.bin" }).click();
  await expect(row(page, "b.bin")).toHaveAttribute("data-state", "idle", { timeout: 20_000 });
  await expect.poll(async () => (await fs(page))["b.bin"]?.aborted).toBe(true);

  // Catégorie : un seul choix de dossier, pause et reprise de la catégorie.
  await page.getByRole("button", { name: "Télécharger la catégorie Autres" }).click();
  await expect(page.locator('li.row[data-state="downloading"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Mettre en pause la catégorie Autres" }).click();
  await expect(page.locator('li.row[data-state="paused"]')).toHaveCount(3);
  await page.getByRole("button", { name: "Reprendre la catégorie Autres" }).click();
  await expect(page.locator('li.row[data-state="done"]')).toHaveCount(3, { timeout: 90_000 });
  expect(await page.evaluate(() => (window as unknown as { __dirPicks: number }).__dirPicks)).toBe(1);
  const got = await fs(page);
  // Le dossier contenait déjà a.bin et b.bin (partiel) : jamais d'écrasement, « (2) ».
  expect(got["a (2).bin"]!.sha).toBe(sha(A));
  expect(got["c.bin"]!.sha).toBe(sha(C));

  // Tout : progression d'ensemble, Tout mettre en pause, Tout reprendre, Tout arrêter.
  delay = 900;
  await page.getByRole("button", { name: "Télécharger à nouveau c.bin" }).click();
  await expect(page.locator('[data-progress="all"]')).toBeVisible();
  await page.getByRole("button", { name: "Tout mettre en pause" }).click();
  await expect(row(page, "c.bin")).toHaveAttribute("data-state", "paused");
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await page.getByRole("button", { name: "Tout reprendre" }).click();
  await expect(row(page, "c.bin")).toHaveAttribute("data-state", "downloading");
  await page.getByRole("button", { name: "Tout arrêter" }).click();
  await expect(row(page, "c.bin")).toHaveAttribute("data-state", "idle", { timeout: 20_000 });
});

test("visionneuse en panneau : précédent, suivant, Début, Fin, Échap rend le focus, balayage au doigt ; axe ; captures", async ({ page, shh, browser }) => {
  test.setTimeout(180_000);
  const sent = await share(browser, shh.origin);
  await page.goto(sent.link);
  await unlock(page, sent.password);
  const voir = page.getByRole("button", { name: "Voir foret-brume.jpg" });
  await voir.click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toHaveAttribute("aria-roledescription", "carousel");
  await expect(dlg.getByRole("heading")).toHaveText("foret-brume.jpg");
  await expect(dlg.locator(".count")).toHaveText("2 / 6"); // la note est la première
  await expect(dlg.locator("img")).toBeVisible();
  // Un panneau, pas toute la page.
  const box = (await dlg.boundingBox())!;
  expect(box.width).toBeLessThan(1440 - 100);
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await capture(page, "viewer-1440");
  await page.keyboard.press("ArrowRight");
  await expect(dlg.getByRole("heading")).toHaveText("lac-gele.jpg");
  await page.keyboard.press("End");
  await expect(dlg.getByRole("heading")).toHaveText("vocal.ogg");
  await page.keyboard.press("Home");
  await expect(dlg.locator("pre")).toHaveText(TEXT);
  await page.keyboard.press("ArrowLeft"); // déjà au début : rien
  await expect(dlg.locator(".count")).toHaveText("1 / 6");
  // Balayage au doigt (événements de pointeur tactiles) : élément suivant, puis fermeture vers le bas.
  const stage = dlg.locator(".stage");
  const swipe = (dx: number, dy: number) =>
    stage.evaluate((el, [x, y]) => {
      const r = el.getBoundingClientRect();
      const o = { pointerId: 7, pointerType: "touch", bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      el.dispatchEvent(new PointerEvent("pointerdown", o));
      el.dispatchEvent(new PointerEvent("pointerup", { ...o, clientX: o.clientX + x!, clientY: o.clientY + y! }));
    }, [dx, dy]);
  await swipe(-80, 4);
  await expect(dlg.getByRole("heading")).toHaveText("foret-brume.jpg");
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
  await expect(voir).toBeFocused();
  await voir.click();
  await swipe(2, 120);
  await expect(dlg).toHaveCount(0);
  // Téléphone : le panneau reste un panneau.
  await page.setViewportSize({ width: 390, height: 844 });
  await voir.click();
  await expect(dlg.locator("img")).toBeVisible();
  await settle(page);
  await capture(page, "viewer-390");
});

test("archive .zip sans sélecteur : confirmation des fichiers à risque, archive reçue, mêmes noms et mêmes octets", async ({ page, shh, browser }) => {
  test.setTimeout(180_000);
  const sent = await share(browser, shh.origin);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker;
    delete w.showDirectoryPicker;
  });
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await page.getByRole("button", { name: "Tout télécharger en .zip" }).click();
  await expect(page.getByText(/Ces fichiers peuvent exécuter du code sur votre appareil\s: .*installer\.exe/)).toBeVisible();
  await settle(page);
  await capture(page, "zip-confirm-1440");
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Télécharger quand même" }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe("shhdrop.zip");
  await expect(page.locator('[data-progress="zip"]')).toContainText("Archive enregistrée");
  const dir = mkdtempSync(join(tmpdir(), "shh-zip-e2e-"));
  const p = join(dir, "a.zip");
  writeFileSync(p, readFileSync(await d.path()));
  const out = JSON.parse(
    execFileSync("python3", ["-I", "-c", "import sys,zipfile,hashlib,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({i.filename:hashlib.sha256(z.read(i)).hexdigest() for i in z.infolist()}))", p]).toString(),
  ) as Record<string, string>;
  for (const n of NAMES) expect(out[n], n).toBe(sha(readFileSync(file(n))));
  expect(Object.keys(out)).toHaveLength(NAMES.length + 1); // + la note en .txt
  expect(out["Note.txt"] ?? Object.entries(out).find(([k]) => k.endsWith(".txt"))?.[1]).toBe(createHash("sha256").update(TEXT).digest("hex"));
});

test("« voir seulement » : aucune action de téléchargement ni de copie dans tout le DOM, visionneuse comprise ; mention honnête", async ({ page, shh, browser }) => {
  test.setTimeout(180_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT, files: [file("foret-brume.jpg"), file("vocal.ogg")], download: false });
  await s.ctx.close();
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await page.getByRole("button", { name: "Voir foret-brume.jpg" }).click();
  await expect(page.getByRole("dialog").locator("img")).toBeVisible();
  const bad = await page.evaluate(() =>
    [...document.querySelectorAll("button, a")].map((b) => (b.getAttribute("aria-label") ?? "") + " " + (b.textContent ?? "")).filter((t) => /Télécharger|Tout télécharger|\.zip|Copier/.test(t)),
  );
  expect(bad).toEqual([]);
  await expect(page.locator("[data-download-bar]")).toHaveCount(0);
  await expect(page.getByRole("dialog").getByText("Une capture d'écran reste possible.", { exact: false })).toBeVisible();
  await settle(page);
  await capture(page, "view-only-viewer-1440");
});

test("destruction ici : illustration du document qui se défait, aucun cadenas ; mouvement réduit fixe ; axe ; captures", async ({ page, shh, browser }) => {
  test.setTimeout(180_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT });
  await s.ctx.close();
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await page.getByRole("button", { name: "Détruire ce partage pour tout le monde" }).click();
  await page.getByRole("button", { name: "Détruire", exact: true }).click();
  const art = page.locator('svg[data-state="destroyed"]');
  await expect(art).toBeVisible({ timeout: 20_000 });
  await capture(page, "destroyed-art-start");
  await page.waitForTimeout(450);
  await capture(page, "destroyed-art-mid");
  await settle(page);
  await capture(page, "destroyed-art-end");
  expect(await art.locator("rect.dot").count()).toBe(48);
  expect(await page.locator(".lucide-lock-open, [data-state='destroyed'] .lucide-lock-open").count()).toBe(0);
  expect(await page.locator("svg.lucide-lock-open").count()).toBe(0);
  expect(await axe(page)).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "destroyed-art-390");
});

test.describe("mouvement réduit", () => {
  test.use({ reducedMotion: "reduce" });
  test("illustration « détruit » sans aucune animation", async ({ page, shh, browser }) => {
    test.setTimeout(180_000);
    const s = await freshPage(browser);
    const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT });
    await s.ctx.close();
    await page.goto(sent.link);
    await unlock(page, sent.password);
    await page.getByRole("button", { name: "Détruire ce partage pour tout le monde" }).click();
    await page.getByRole("button", { name: "Détruire", exact: true }).click();
    const art = page.locator('svg[data-state="destroyed"]');
    await expect(art).toBeVisible({ timeout: 20_000 });
    expect(await art.evaluate((e) => e.getAnimations({ subtree: true }).length)).toBe(0);
  });
});
