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
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? px[y * stride + i - ch]! : 0;
      const b = y > 0 ? px[(y - 1) * stride + i]! : 0;
      const c = y > 0 && i >= ch ? px[(y - 1) * stride + i - ch]! : 0;
      const x = raw[src + i]!;
      let v: number;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      px[y * stride + i] = v & 255;
    }
  }
  return { w, h, ch, px };
}

const lin = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/**
 * Luminance relative maximale de la page, contenu caché (CSSOM : permis par la CSP), sur trois
 * phases de la dérive (début, milieu, fin de l'aller) : les nappes se recouvrent différemment.
 */
async function maxLuminance(page: Page, name: string): Promise<number> {
  let max = 0;
  for (const f of [0, 0.5, 1]) {
    await page.evaluate((phase) => {
      for (const a of document.getAnimations()) {
        if (!/^drift-/.test((a as CSSAnimation).animationName.replace(/^svelte-\w+-/, ""))) continue;
        a.pause();
        a.currentTime = phase * Number((a.effect as KeyframeEffect).getTiming().duration);
      }
    }, f);
    await page.waitForTimeout(50);
    const png = await page.screenshot();
    if (f === 0) await capture(page, name);
    const { w, h, ch, px } = decodePng(png);
    for (let i = 0; i < w * h; i++) {
      const o = i * ch;
      const l = 0.2126 * lin(px[o]!) + 0.7152 * lin(px[o + 1]!) + 0.0722 * lin(px[o + 2]!);
      if (l > max) max = l;
    }
  }
  return max;
}

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
    await page.setViewportSize(size);
    await page.goto(shh.origin + "/");
    await expect(page.locator(".aurora img")).toHaveCount(4);
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".aurora img")].every((i) => i.complete && i.naturalWidth === 128));
    await hideContent(page);
    await page.waitForTimeout(300);
    const results: Record<string, number> = {};
    results.repos = await maxLuminance(page, `aurora-repos-${size.width}`);

    await page.evaluate(() => (document.body.dataset.screen = "seal"));
    await page.waitForTimeout(1400); // transition d'opacité de 1,2 s
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
    await page.waitForTimeout(100);
    results.éclat = await maxLuminance(page, `aurora-eclat-${size.width}`);
    await page.evaluate(() => {
      delete document.body.dataset.burst;
      document.body.dataset.screen = "destroyed";
    });
    await page.waitForTimeout(1400);
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
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("LayerTree.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: ".aurora, .aurora img, .grain" });
  const backend = new Set<number>();
  for (const id of nodeIds) backend.add((await cdp.send("DOM.describeNode", { nodeId: id })).node.backendNodeId);
  const layers = await new Promise<{ layerId: string; backendNodeId?: number; width: number; height: number; drawsContent: boolean }[]>((resolve) => {
    cdp.on("LayerTree.layerTreeDidChange", (e) => {
      if (e.layers && e.layers.some((l) => l.backendNodeId && backend.has(l.backendNodeId))) resolve(e.layers);
    });
    void page.evaluate(() => document.body.getBoundingClientRect()); // relance un rendu
  });
  const aurora = layers.filter((l) => l.backendNodeId && backend.has(l.backendNodeId) && l.drawsContent);
  const bytes = aurora.reduce((n, l) => n + l.width * l.height * 4, 0);
  test.info().annotations.push({
    type: "calques aurore",
    description: JSON.stringify({ count: aurora.length, layers: aurora.map((l) => `${l.width}×${l.height}`), mo: +(bytes / 2 ** 20).toFixed(2) }),
  });
  expect(aurora.length).toBeGreaterThan(0);
  expect(aurora.length).toBeLessThanOrEqual(6); // 4 nappes au plus (+ vignette, grain)
  expect(bytes).toBeLessThanOrEqual(32 * 2 ** 20);
});
