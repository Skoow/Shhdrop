// Icônes PNG et ICO du site (favicon « o rayé », scripts/gen-logo.mjs), rendues localement par Chromium.
// Aucune image générée par IA : le SVG construit est rastérisé tel quel.
//   node scripts/gen-icons.mjs      (PW_LOCAL_CHROMIUM=1 sur le poste de développement)
// Sorties : public/apple-touch-icon.png (180, plein cadre), public/icon-192.png et public/icon-512.png
// (marge de sécurité « maskable » : l'anneau tient dans 60 % du côté), public/favicon.ico (16 et 32).
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { iconSvg } from "./gen-logo.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const launch = process.env.PW_LOCAL_CHROMIUM === "1" ? { executablePath: "/opt/pw-browsers/chromium" } : {};

const PNG = {
  "apple-touch-icon.png": [180, { rounded: false, scale: 0.85, center: true }],
  "icon-192.png": [192, { rounded: false, scale: 0.78, center: true }],
  "icon-512.png": [512, { rounded: false, scale: 0.78, center: true }],
  "favicon-16": [16, {}],
  "favicon-32": [32, {}],
};

/** ICO avec PNG embarqués (format admis depuis Windows Vista et par tous les navigateurs). */
export function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size % 256, e);
    head.writeUInt8(size % 256, e + 1);
    head.writeUInt16LE(1, e + 4); // plans
    head.writeUInt16LE(32, e + 6); // bits par pixel
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const browser = await chromium.launch(launch);
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const out = {};
  for (const [name, [size, opts]] of Object.entries(PNG)) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(iconSvg(size, opts).replace("<svg ", '<svg id="i" '));
    await page.addStyleTag({ content: "html,body{margin:0;background:transparent}svg{display:block}" });
    out[name] = await page.locator("#i").screenshot({ omitBackground: true });
  }
  await browser.close();
  for (const name of ["apple-touch-icon.png", "icon-192.png", "icon-512.png"]) writeFileSync(join(web, "public", name), out[name]);
  writeFileSync(join(web, "public", "favicon.ico"), ico([{ size: 16, data: out["favicon-16"] }, { size: 32, data: out["favicon-32"] }]));
  console.log("gen-icons : apple-touch-icon.png, icon-192.png, icon-512.png, favicon.ico");
}
