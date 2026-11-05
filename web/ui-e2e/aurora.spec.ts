// Aurore (UI §20.2 K4, K5, K11 ; §20.7) : plafond de luminance dans chaque état, pause onglet
// caché, mémoire des calques. Chromium seulement (CDP et capture fidèle des nappes).
import type { Page } from "@playwright/test";
import { inflateSync } from "node:zlib";
import { capture, expect, test } from "./fixtures";

test.skip(({ browserName }) => browserName !== "chromium", "Chromium seulement");
test.use({ locale: "fr-FR" });

/** Décodeur PNG minimal (8 bits, RGB ou RGBA, non entrelacé, filtres 0 à 4) : les captures de Chromium. */
function decodePng(buf: Buffer): { w: number; h: number; ch: number; px: Uint8Array } {
  let off = 8;
  let w = 0;
  let h = 0;
  let ch = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString("latin1");
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      expect(data[12]).toBe(0);
      ch = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      expect(ch).toBeGreaterThan(0);
    }
    if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = new Uint8Array(h * stride);
  // Une boucle par type de filtre (le branchement par octet coûtait ~1 s par capture à 1440 px).
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const up = row - stride;
    if (f === 0) {
      for (let i = 0; i < stride; i++) px[row + i] = raw[src + i]!;
    } else if (f === 1) {
      for (let i = 0; i < stride; i++) px[row + i] = raw[src + i]! + (i >= ch ? px[row + i - ch]! : 0);
    } else if (f === 2) {
      for (let i = 0; i < stride; i++) px[row + i] = raw[src + i]! + (y > 0 ? px[up + i]! : 0);
    } else if (f === 3) {
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? px[row + i - ch]! : 0;
        const b = y > 0 ? px[up + i]! : 0;
        px[row + i] = raw[src + i]! + ((a + b) >> 1);
      }
    } else {
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? px[row + i - ch]! : 0;
        const b = y > 0 ? px[up + i]! : 0;
        const c = y > 0 && i >= ch ? px[up + i - ch]! : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        px[row + i] = raw[src + i]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
    }
  }
  return { w, h, ch, px };
}

const lin = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
// Table des 256 valeurs : mêmes résultats que lin(), sans 3 appels de ** 2.4 par pixel (1,3 M de
// pixels × 12 captures dépassaient 15 s de CPU à 1440 px, donc le délai du test sous charge).
const LIN = Float64Array.from({ length: 256 }, (_, v) => lin(v));

/**
 * Luminance relative maximale de la page, contenu caché (CSSOM : permis par la CSP), sur trois
 * phases de la dérive (début, milieu, fin de l'aller) : les nappes se recouvrent différemment.
 */
async function maxLuminance(page: Page, name: string): Promise<number> {
  let max = 0;
  for (const f of [0, 0.5, 1]) {
    await page.evaluate((phase) => {
      for (const a of document.getAnimations()) {
        // Seules les CSSAnimation ont un animationName : une CSSTransition en cours (opacité de
        // l'aurore, en-tête) n'en a pas et faisait lever « reading 'replace' » sur undefined.
        if (!(a instanceof CSSAnimation) || !/^drift-/.test(a.animationName.replace(/^svelte-\w+-/, ""))) continue;
        a.pause();
        a.currentTime = phase * Number((a.effect as KeyframeEffect).getTiming().duration);
      }
    }, f);
    await frames(page);
    const png = await page.screenshot();
    if (f === 0) await capture(page, name);
    const { w, h, ch, px } = decodePng(png);
    for (let i = 0; i < w * h; i++) {
      const o = i * ch;
      const l = 0.2126 * LIN[px[o]!]! + 0.7152 * LIN[px[o + 1]!]! + 0.0722 * LIN[px[o + 2]!]!;
      if (l > max) max = l;
    }
  }
  return max;
}

/**
 * Attend la fin réelle des transitions et animations finies de la page (Web Animations API),
 * au lieu d'un délai d'horloge qui dépend de la charge de la machine. Les boucles (aurore,
 * grain) ne finissent jamais : elles sont exclues, comme dans fixtures.axe().
 */
async function settle(page: Page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 5; i++) {
      const pending = document
        .getAnimations()
        .filter((a) => a.timeline === document.timeline && a.effect?.getComputedTiming().iterations !== Infinity && a.playState !== "paused");
      if (pending.length === 0) break;
      await Promise.all(pending.map((a) => a.finished.catch(() => undefined)));
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

/** Deux images composées : la pause ou le saut d'un temps d'animation est peint avant la capture. */
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function hideContent(page: Page) {
  await page.evaluate(() => {
    // Tout ce qui n'est pas l'aurore ni le grain : contenu, en-tête, pied, lien d'évitement.
    for (const el of document.querySelectorAll<HTMLElement>("main, header, footer, .skip, .banner-slot"))
      el.style.visibility = "hidden";
  });
}

for (const size of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`K4, K5 : luminance ≤ 0,050 au repos, au scellement, à l'éclat et détruit (${size.width} px)`, async ({ page, shh, isMobile }) => {
    test.skip(isMobile !== size.width < 600, "390 px sur le projet téléphone, 1440 px sur le projet ordinateur");
    test.slow(); // 16 captures d'écran (≈ 0,4 s chacune au repos, bien plus sous charge) : délai × 3
    await page.setViewportSize(size);
    await page.goto(shh.origin + "/");
    await expect(page.locator(".aurora img")).toHaveCount(4);
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".aurora img")].every((i) => i.complete && i.naturalWidth === 128));
    await hideContent(page);
    await settle(page);
    const results: Record<string, number> = {};
    results.repos = await maxLuminance(page, `aurora-repos-${size.width}`);

    await page.evaluate(() => (document.body.dataset.screen = "seal"));
    await settle(page); // transition d'opacité de 1,2 s, attendue jusqu'à sa fin réelle
    results.scellement = await maxLuminance(page, `aurora-scellement-${size.width}`);

    // Éclat : animation aurora-burst (560 ms de délai, pic à 1 000 ms) mise en pause à son pic.
    await page.evaluate(() => (document.body.dataset.burst = ""));
    const peak = await page.evaluate(() => {
      const a = document.getAnimations().find((x) => (x as CSSAnimation).animationName === "aurora-burst");
      if (!a) return null;
      a.pause();
      a.currentTime = 1000;
      const bloom = (a.effect as KeyframeEffect).target as Element;
      return { opacity: Number(getComputedStyle(bloom).opacity), max: Math.max(...(a.effect as KeyframeEffect).getKeyframes().map((k) => Number(k.opacity))) };
    });
    expect(peak).not.toBeNull();
    expect(peak!.opacity).toBeCloseTo(peak!.max, 3); // c'est bien le pic
    await frames(page);
    results.éclat = await maxLuminance(page, `aurora-eclat-${size.width}`);
    await page.evaluate(() => {
      delete document.body.dataset.burst;
      document.body.dataset.screen = "destroyed";
    });
    await settle(page);
    results.détruit = await maxLuminance(page, `aurora-detruit-${size.width}`);

    test.info().annotations.push({ type: "luminance", description: JSON.stringify(results) });
    for (const [state, l] of Object.entries(results)) expect(l, state).toBeLessThanOrEqual(0.05);
    // Le test mesure quelque chose : l'aurore éclaire bien le fond (#0B0D12 ≈ 0,004).
    expect(results.repos).toBeGreaterThan(0.01);
  });
}

test("onglet caché : les animations de l'aurore se mettent en pause, et reprennent", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  const states = () =>
    page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => ((a.effect as KeyframeEffect).target as Element).closest(".aurora"))
        .map((a) => a.playState),
    );
  expect(await states()).toEqual(["running", "running", "running"]);
  const setHidden = (v: boolean) =>
    page.evaluate((hidden) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event("visibilitychange"));
    }, v);
  await setHidden(true);
  await expect.poll(states).toEqual(["paused", "paused", "paused"]);
  await setHidden(false);
  await expect.poll(states).toEqual(["running", "running", "running"]);
});

test("K11 : nappes posées à 128 px, agrandies par transform ; mémoire des calques ≤ 32 Mo", async ({ page, shh, isMobile }) => {
  test.skip(!isMobile, "Pixel 7 émulé (projet chromium-mobile)");
  await page.setViewportSize({ width: 412, height: 915 }); // Pixel 7
  await page.goto(shh.origin + "/");
  const boxes = await page.locator(".aurora img").evaluateAll((imgs) =>
    imgs.map((i) => ({ w: (i as HTMLElement).offsetWidth, h: (i as HTMLElement).offsetHeight, t: getComputedStyle(i).transform })),
  );
  for (const b of boxes) {
    expect([b.w, b.h]).toEqual([128, 128]);
    expect(b.t).toMatch(/^matrix/);
  }

  // Panneau Layers de DevTools : mêmes données (CDP LayerTree) ; estimation = largeur × hauteur × 4.
  // Course d'origine (sous charge) : l'écouteur était posé après LayerTree.enable, donc le premier
  // arbre (émis par enable) était perdu, et le premier arbre reçu pouvait précéder la promotion
  // des nappes en calques. On écoute avant d'activer, on garde le dernier arbre, et on attend
  // qu'il contienne les calques de l'aurore et soit stable sur plusieurs images.
  type Layer = { layerId: string; backendNodeId?: number; width: number; height: number; drawsContent: boolean };
  const cdp = await page.context().newCDPSession(page);
  let latest: Layer[] = [];
  cdp.on("LayerTree.layerTreeDidChange", (e) => {
    if (e.layers) latest = e.layers;
  });
  await cdp.send("DOM.enable");
  await cdp.send("LayerTree.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: ".aurora, .aurora img, .grain" });
  const backend = new Set<number>();
  for (const id of nodeIds) backend.add((await cdp.send("DOM.describeNode", { nodeId: id })).node.backendNodeId);
  const auroraLayers = () => latest.filter((l) => l.backendNodeId && backend.has(l.backendNodeId) && l.drawsContent);
  const signature = () => JSON.stringify(auroraLayers().map((l) => [l.layerId, l.width, l.height]));
  let last = "";
  let stable = 0;
  await expect
    .poll(
      async () => {
        await frames(page); // relance un rendu, donc un nouvel arbre
        const sig = signature();
        stable = auroraLayers().length > 0 && sig === last ? stable + 1 : 0;
        last = sig;
        return stable;
      },
      { message: "arbre de calques de l'aurore stable", timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(5);
  const aurora = auroraLayers();
  const bytes = aurora.reduce((n, l) => n + l.width * l.height * 4, 0);
  test.info().annotations.push({
    type: "calques aurore",
    description: JSON.stringify({ count: aurora.length, layers: aurora.map((l) => `${l.width}×${l.height}`), mo: +(bytes / 2 ** 20).toFixed(2) }),
  });
  expect(aurora.length).toBeGreaterThan(0);
  expect(aurora.length).toBeLessThanOrEqual(6); // 4 nappes au plus (+ vignette, grain)
  expect(bytes).toBeLessThanOrEqual(32 * 2 ** 20);
});
