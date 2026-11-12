// Logo « Trame » (mot-symbole shhgone, nom affiché depuis le 12 novembre) et favicon « o rayé »,
// construits à la règle et au compas.
// Aucune image générée : chaque tracé est calculé ici, puis écrit dans src/ui/logo-paths.ts,
// public/logo.svg et public/favicon.svg. Les PNG et l'ICO viennent de scripts/gen-icons.mjs.
// Déterministe : le test régénère les sorties et les compare octet pour octet.
//
// Construction (unité u, ligne de base y = 0, axe y vers le bas) :
//   bas-de-casse monoline : hauteur d'x 24, ascendante 34, descendante 10, trait 5 (centré sur l'axe) ;
//   rondes : axe r 10,1 (débord optique 0,6) ; arches de h et r : r 9,5 centrées à y = −12 ;
//   s : deux ellipses 7,5 × 5,05, bornes coupées à ±20° ; approches 3,5 / 4,5 / 4,5 / 3 / 3 / 3,5.
//   g : panse du o, fût droit jusqu'à la ligne de base, crochet r 10,1 centré sur la ligne de base
//   (0° à 160°) ; n : fût d'x et arche du h ; e : panse du o, barre à mi-hauteur, ouverture de 0° à 40°.
//   « shh » plein ; « gone » échantillonné sur une grille au pas du trait (5 u), origine propre à
//   chaque lettre (centre des panses, fût du n), points dont le rayon décroît de 2,5 à 1,5 u en x.
//   Favicon : anneau r 11 / 5 sur une grille de 32, six bandes de 2 u au pas de 4 (alignées au pixel à 16 et 32 px).
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const X = 24, ASC = 34, DESC = 10, W = 5, HW = W / 2, RO = 10.1, RA = 9.5, OV = 0.6;
const GAPS = [3.5, 4.5, 4.5, 3.0, 3.0, 3.5];
const HOOK = 160, E_OPEN = 40;
const PITCH = 5, R_MAX = 2.5, R_MIN = 1.5, BUCKETS = 6;

const f = (v) => {
  const s = (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
};
const P = (x, y) => `${f(x)} ${f(y)}`;
const rad = (d) => (d * Math.PI) / 180;
const ring = (cx, cy, r) => `M${P(cx - r, cy)}A${f(r)} ${f(r)} 0 1 1 ${P(cx + r, cy)}A${f(r)} ${f(r)} 0 1 1 ${P(cx - r, cy)}`;

// Lettres, tracées directement à leur abscisse x0 (chemins absolus).
const L = {
  s(x0) {
    const rx = 7.5, ry = (X + 2 * OV - W) / 4, cx = x0 + HW + rx, cu = -X / 2 - ry, cl = -X / 2 + ry;
    const p0 = [cx + rx * Math.cos(rad(-20)), cu + ry * Math.sin(rad(-20))];
    const p1 = [cx + rx * Math.cos(rad(160)), cl + ry * Math.sin(rad(160))];
    return { d: `M${P(...p0)}A${f(rx)} ${f(ry)} 0 1 0 ${P(cx, -X / 2)}A${f(rx)} ${f(ry)} 0 1 1 ${P(...p1)}`, w: 2 * rx + W };
  },
  h(x0) {
    const s = x0 + HW;
    return { d: `M${P(s, -ASC)}V0M${P(s, -X / 2)}A${f(RA)} ${f(RA)} 0 0 1 ${P(s + 2 * RA, -X / 2)}V0`, w: 2 * RA + W };
  },
  o(x0) {
    return { d: ring(x0 + HW + RO, -X / 2, RO), w: 2 * (HW + RO) };
  },
  g(x0) {
    const c = x0 + HW + RO, end = [c + RO * Math.cos(rad(HOOK)), RO * Math.sin(rad(HOOK))];
    return { d: `${ring(c, -X / 2, RO)}M${P(c + RO, -X)}V0A${f(RO)} ${f(RO)} 0 0 1 ${P(...end)}`, w: 2 * (HW + RO) };
  },
  n(x0) {
    const s = x0 + HW;
    return { d: `M${P(s, -X)}V0M${P(s, -X / 2)}A${f(RA)} ${f(RA)} 0 0 1 ${P(s + 2 * RA, -X / 2)}V0`, w: 2 * RA + W };
  },
  e(x0) {
    const c = x0 + HW + RO, end = [c + RO * Math.cos(rad(E_OPEN)), -X / 2 + RO * Math.sin(rad(E_OPEN))];
    return { d: `M${P(c - RO, -X / 2)}H${f(c + RO)}A${f(RO)} ${f(RO)} 0 1 0 ${P(...end)}`, w: 2 * (HW + RO) };
  },
};

export function build() {
  const xs = [];
  let x = 0;
  const parts = [..."shhgone"].map((ch, i) => {
    xs.push(x);
    const g = L[ch](x);
    x += g.w + (GAPS[i] ?? 0);
    return g;
  });
  const width = xs[6] + parts[6].w;
  const [XG, XO, XN, XE] = [xs[3], xs[4], xs[5], xs[6]];
  const CG = XG + HW + RO, CO = XO + HW + RO, SN = XN + HW, CE = XE + HW + RO, tol = HW + 0.3;
  const deg = (px, py, cx, cy) => ((Math.atan2(py - cy, px - cx) * 180) / Math.PI + 360) % 360;
  const onRing = (px, py, cx, cy, r) => Math.abs(Math.hypot(px - cx, py - cy) - r) <= tol;

  const inG = (px, py) =>
    onRing(px, py, CG, -X / 2, RO) ||
    (Math.abs(px - (CG + RO)) <= tol && py >= -X && py <= 0) ||
    (py > 0 && onRing(px, py, CG, 0, RO) && deg(px, py, CG, 0) <= HOOK);
  const inO = (px, py) => onRing(px, py, CO, -X / 2, RO);
  const inN = (px, py) =>
    (Math.abs(px - SN) <= tol && py >= -X && py <= 0) ||
    (onRing(px, py, SN + RA, -X / 2, RA) && deg(px, py, SN + RA, -X / 2) >= 180) ||
    (Math.abs(px - (SN + 2 * RA)) <= tol && py >= -X / 2 && py <= 0);
  const inE = (px, py) =>
    (Math.abs(py + X / 2) <= tol && Math.abs(px - CE) <= RO) ||
    (onRing(px, py, CE, -X / 2, RO) && !(deg(px, py, CE, -X / 2) > 0 && deg(px, py, CE, -X / 2) < E_OPEN));

  const pts = [];
  for (const [inside, ox, oy] of [[inG, CG, -X / 2], [inO, CO, -X / 2], [inN, SN, -X / 2], [inE, CE, -X / 2]])
    for (let j = -8; j <= 8; j++)
      for (let i = -8; i <= 8; i++) {
        const px = ox + i * PITCH, py = oy + j * PITCH;
        if (inside(px, py) && !pts.some(([a, b]) => Math.abs(a - px) < 0.3 && Math.abs(b - py) < 0.3)) pts.push([px, py]);
      }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const buckets = Array.from({ length: BUCKETS }, () => "");
  for (const [px, py] of pts) {
    const t = (px - XG) / (width - XG);
    const r = R_MAX - (R_MAX - R_MIN) * t;
    const k = Math.min(BUCKETS - 1, Math.floor(t * BUCKETS));
    buckets[k] += `M${P(px - r, py)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`;
  }
  const top = -ASC, bottom = DESC + R_MIN + 0.2;
  return {
    viewBox: `0 ${f(top)} ${f(width)} ${f(bottom - top)}`,
    head: parts.slice(0, 3).map((p) => p.d).join(""),
    tail: parts.slice(3).map((p) => p.d).join(""),
    dots: buckets,
    count: pts.length,
  };
}

/**
 * O rayé (repère 32 × 32) : anneau r 11 / 5 centré en (15, 15), six bandes de 2 u au pas de 4,
 * [−11,−9] … [9,11]. Bords des bandes et de l'anneau sur des unités paires : nets à 16 px (1 px)
 * et à 32 px (2 px). Le décalage d'une unité vers le haut à gauche est le prix de cette netteté.
 */
export function mark() {
  const c = 15, R = 11, r = 5;
  const sx = (rr, y) => Math.sqrt(Math.max(0, rr * rr - y * y));
  let d = "";
  for (let a = -R; a < R; a += 4) {
    const b = a + 2;
    if (Math.min(Math.abs(a), Math.abs(b)) >= r) {
      // bande hors du trou : une seule pièce
      d += `M${P(c - sx(R, a), c + a)}H${f(c + sx(R, a))}A${R} ${R} 0 0 1 ${P(c + sx(R, b), c + b)}H${f(c - sx(R, b))}A${R} ${R} 0 0 1 ${P(c - sx(R, a), c + a)}Z`;
    } else {
      // bande qui traverse le trou : deux pièces (droite puis gauche)
      d += `M${P(c + sx(r, a), c + a)}H${f(c + sx(R, a))}A${R} ${R} 0 0 1 ${P(c + sx(R, b), c + b)}H${f(c + sx(r, b))}A${r} ${r} 0 0 0 ${P(c + sx(r, a), c + a)}Z`;
      d += `M${P(c - sx(r, a), c + a)}H${f(c - sx(R, a))}A${R} ${R} 0 0 0 ${P(c - sx(R, b), c + b)}H${f(c - sx(r, b))}A${r} ${r} 0 0 1 ${P(c - sx(r, a), c + a)}Z`;
    }
  }
  return d;
}

export const COLORS = { bg: "#0B0D12", text: "#E9ECF2", accent: "#5FE3B5" };

/** Favicon / icône : o rayé menthe sur tuile sombre (lisible sur onglet clair comme sombre). */
export function iconSvg(size, { rounded = true, scale = 1, center = false } = {}) {
  // Favicon (scale 1) : repère d'origine, aligné au pixel. Grandes icônes : anneau recentré en (16, 16).
  const off = center ? 16 - 15 * scale : 0;
  const rx = rounded ? 7 : 0;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">` +
    `<rect width="32" height="32" rx="${rx}" fill="${COLORS.bg}"/>` +
    `<path transform="translate(${f(off)} ${f(off)}) scale(${f(scale)})" d="${mark()}" fill="${COLORS.accent}"/></svg>\n`
  );
}

export function logoSvg() {
  const b = build();
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.viewBox}" role="img" aria-label="Shhgone">` +
    `<path d="${b.head}" fill="none" stroke="${COLORS.text}" stroke-width="${W}"/>` +
    `<path d="${b.dots.join("")}" fill="${COLORS.accent}"/></svg>\n`
  );
}

export function pathsTs() {
  const b = build();
  return (
    "// Généré par scripts/gen-logo.mjs : ne pas modifier à la main.\n" +
    `// Trame : ${b.count} points en ${b.dots.length} tranches (de gauche à droite).\n` +
    `export const LOGO_VIEWBOX = ${JSON.stringify(b.viewBox)};\n` +
    `export const LOGO_STROKE = ${W};\n` +
    `export const LOGO_HEAD = ${JSON.stringify(b.head)};\n` +
    `export const LOGO_TAIL = ${JSON.stringify(b.tail)};\n` +
    `export const LOGO_DOTS: readonly string[] = ${JSON.stringify(b.dots)};\n` +
    `export const MARK_PATH = ${JSON.stringify(mark())};\n`
  );
}

export const OUTPUTS = {
  "src/ui/logo-paths.ts": pathsTs,
  "public/logo.svg": logoSvg,
  "public/favicon.svg": () => iconSvg(32),
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const web = join(dirname(fileURLToPath(import.meta.url)), "..");
  for (const [rel, gen] of Object.entries(OUTPUTS)) writeFileSync(join(web, rel), gen());
  console.log("gen-logo :", Object.keys(OUTPUTS).join(", "));
}
