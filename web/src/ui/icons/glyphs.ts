// Jeu d'icônes maison (retours UI8) : dessin propre à Shhdrop, grille 24, trait 1,75 par défaut,
// extrémités et angles arrondis, aucun fichier ni service extérieur. Chaque glyphe est une liste
// d'éléments SVG simples (chemin, cercle, rectangle) rendus par Glyph.svelte. Un point plein
// (`dot`) remplace un tracé quand il doit rester lisible à petite taille.
import type { SVGAttributes } from "svelte/elements";

/** Propriétés d'une icône (mêmes noms qu'avant : size, strokeWidth, attributs SVG). */
export type IconProps = Omit<SVGAttributes<SVGSVGElement>, "name"> & { size?: number | string; strokeWidth?: number | string };

export type GlyphEl =
  | { d: string }
  | { c: readonly [cx: number, cy: number, r: number]; dot?: true }
  | { r: readonly [x: number, y: number, w: number, h: number, rx: number] };

const SHIELD = "M12 3.5l7 2.6v5.4c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6.1z";
const FILE = "M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8zM14 3.5V8h4.5";
const LOCK_BODY = { r: [5, 10.5, 14, 10, 2.5] } as const;
const RING = { c: [12, 12, 8.5] } as const;

export const GLYPHS = {
  "paperclip": [{ d: "M15.5 7.5l-6.3 6.3a1.8 1.8 0 0 0 2.5 2.5l6.6-6.6a3.8 3.8 0 0 0-5.4-5.4l-6.5 6.5a5.8 5.8 0 0 0 8.2 8.2l4.4-4.4" }],
  "camera": [{ d: "M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.6-2.2h5.8L16.5 7h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" }, { c: [12, 13, 3.25] }],
  "mic": [{ r: [9, 3.5, 6, 11, 3] }, { d: "M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" }],
  "square": [{ r: [5.5, 5.5, 13, 13, 2.5] }],
  "type": [{ d: "M5 7.5v-2h14v2M12 5.5v13M9.5 18.5h5" }],
  "x": [{ d: "M6.5 6.5l11 11M17.5 6.5l-11 11" }],
  "pencil": [{ d: "M4.5 19.5l1-4.2L15.8 5a1.9 1.9 0 0 1 2.7 0l.5.5a1.9 1.9 0 0 1 0 2.7L8.7 18.5zM14 6.8l3.2 3.2" }],
  "grip-vertical": [{ c: [9, 6, 1.25], dot: true }, { c: [15, 6, 1.25], dot: true }, { c: [9, 12, 1.25], dot: true }, { c: [15, 12, 1.25], dot: true }, { c: [9, 18, 1.25], dot: true }, { c: [15, 18, 1.25], dot: true }],
  "arrow-up": [{ d: "M12 19V5M6 11l6-6 6 6" }],
  "arrow-down": [{ d: "M12 5v14M6 13l6 6 6-6" }],
  "arrow-right": [{ d: "M5 12h14M13 6l6 6-6 6" }],
  "chevron-left": [{ d: "M14.5 6l-6 6 6 6" }],
  "chevron-down": [{ d: "M6 9.5l6 6 6-6" }],
  "lock": [LOCK_BODY, { d: "M8.5 10.5v-3a3.5 3.5 0 0 1 7 0v3M12 14.5v2" }],
  "lock-open": [LOCK_BODY, { d: "M8.5 10.5v-3a3.5 3.5 0 0 1 6.7-1.4M12 14.5v2" }],
  "shield-check": [{ d: SHIELD }, { d: "M9 12l2.2 2.2 3.8-4" }],
  "shield-alert": [{ d: SHIELD }, { d: "M12 8.5v4M12 15.8h.01" }],
  "shield-x": [{ d: SHIELD }, { d: "M9.8 9.8l4.4 4.4M14.2 9.8l-4.4 4.4" }],
  "triangle-alert": [{ d: "M10.3 4.6a2 2 0 0 1 3.4 0l7 12.2a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3zM12 9.5v4M12 16.8h.01" }],
  "copy": [{ r: [8.5, 8.5, 11, 11, 2.25] }, { d: "M15.5 8.5V6.3a1.8 1.8 0 0 0-1.8-1.8H6.3a1.8 1.8 0 0 0-1.8 1.8v7.4a1.8 1.8 0 0 0 1.8 1.8h2.2" }],
  "check": [{ d: "M5 12.5l4.5 4.5L19 7.5" }],
  "share-2": [{ c: [17.5, 5.5, 2.5] }, { c: [6.5, 12, 2.5] }, { c: [17.5, 18.5, 2.5] }, { d: "M8.7 10.7l6.6-3.9M8.7 13.3l6.6 3.9" }],
  "qr-code": [{ r: [4, 4, 6, 6, 1.2] }, { r: [14, 4, 6, 6, 1.2] }, { r: [4, 14, 6, 6, 1.2] }, { d: "M14 14h2.5v2.5M20 14h.01M14 20h.01M17 20h3v-3" }],
  "refresh-cw": [{ d: "M19.5 12a7.5 7.5 0 0 1-13.1 5M4.5 12a7.5 7.5 0 0 1 13.1-5M17.6 3.5V7h-3.5M6.4 20.5V17h3.5" }],
  "eye": [{ d: "M2.8 12.3a1 1 0 0 1 0-.6C4.4 7.8 7.9 5.5 12 5.5s7.6 2.3 9.2 6.2a1 1 0 0 1 0 .6c-1.6 3.9-5.1 6.2-9.2 6.2s-7.6-2.3-9.2-6.2z" }, { c: [12, 12, 3] }],
  "eye-off": [{ d: "M10 5.7a9.6 9.6 0 0 1 2-.2c4.1 0 7.6 2.3 9.2 6.2a1 1 0 0 1 0 .6 10.6 10.6 0 0 1-1.9 3M14.1 14.2a3 3 0 0 1-4.3-4.3M17 17a9.5 9.5 0 0 1-5 1.5c-4.1 0-7.6-2.3-9.2-6.2a1 1 0 0 1 0-.6A10.5 10.5 0 0 1 6.9 7M3.5 3.5l17 17" }],
  "clock": [RING, { d: "M12 7.5V12l3 2" }],
  "timer": [{ c: [12, 13.5, 7] }, { d: "M10 2.8h4M12 13.5l3-3M18.2 6.8l1.3-1.3" }],
  "pause": [{ r: [6.5, 5, 3.5, 14, 1.2] }, { r: [14, 5, 3.5, 14, 1.2] }],
  "play": [{ d: "M7.5 5.6a1 1 0 0 1 1.5-.9l9.6 6.4a1 1 0 0 1 0 1.7L9 19.2a1 1 0 0 1-1.5-.8z" }],
  "download": [{ d: "M12 4v11M7 10.5l5 5 5-5M4.5 19.5h15" }],
  "upload": [{ d: "M12 15.5v-11M7 9l5-5 5 5M4.5 19.5h15" }],
  "file": [{ d: FILE }],
  "file-text": [{ d: FILE }, { d: "M9 12.5h6M9 16h4" }],
  "file-archive": [{ d: FILE }, { d: "M10.5 3.5V5M10.5 7v1.5M10.5 10.5V12" }, { r: [9.25, 14, 2.5, 3, 0.8] }],
  "image": [{ r: [3.5, 4.5, 17, 15, 2.5] }, { c: [9, 9.5, 1.75] }, { d: "M20.5 15.5l-4.3-4.3a1.5 1.5 0 0 0-2.1 0L5 19.5" }],
  "music": [{ d: "M9 18V5.5l11-2V16" }, { c: [6.5, 18, 2.5] }, { c: [17.5, 16, 2.5] }],
  "film": [{ r: [3.5, 4, 17, 16, 2.5] }, { d: "M7.5 4v16M16.5 4v16M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4M7.5 12h9" }],
  "trash-2": [{ d: "M4.5 6.5h15M9.5 6.5V5A1.5 1.5 0 0 1 11 3.5h2A1.5 1.5 0 0 1 14.5 5v1.5M6.5 6.5l.8 12.1a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12.1M10 10.5v6M14 10.5v6" }],
  "flag": [{ d: "M5.5 21V4.5M5.5 15s1.2-1 4-1 4.2 1.8 7 1.8c1.6 0 3-.8 3-.8V4.5s-1.4.8-3 .8c-2.8 0-4.2-1.8-7-1.8s-4 1-4 1" }],
  "wifi-off": [{ d: "M12 19h.01M8.6 15.6a5 5 0 0 1 6.2-.5M5.2 12.2a10 10 0 0 1 4-2.2M14.8 10a10 10 0 0 1 4 2.2M2 8.8a14.6 14.6 0 0 1 3.4-2.3M11 5.1a14.7 14.7 0 0 1 11 3.7M3.5 3.5l17 17" }],
  "clipboard-x": [{ r: [8.5, 2.5, 7, 4, 1.2] }, { d: "M15.5 4.5H17a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2h1.5M10 11.5l4 4M14 11.5l-4 4" }],
  "circle-help": [RING, { d: "M9.6 9.6a2.5 2.5 0 0 1 4.8.9c0 1.6-2.4 2.2-2.4 3.5M12 17h.01" }],
  "info": [RING, { d: "M12 11v5.5M12 7.8h.01" }],
  "minus": [{ d: "M5.5 12h13" }],
  "plus": [{ d: "M12 5.5v13M5.5 12h13" }],
  "link-2": [{ d: "M9 7.5H7.5a4.5 4.5 0 0 0 0 9H9M15 7.5h1.5a4.5 4.5 0 0 1 0 9H15M8.5 12h7" }],
  "key-round": [{ c: [8.5, 15.5, 4.5] }, { d: "M11.7 12.3l7.8-7.8M16.5 7.5L19 10M14.4 9.6l1.8 1.8" }],
  "server": [{ r: [4, 4, 16, 7, 2] }, { r: [4, 13, 16, 7, 2] }, { d: "M8 7.5h.01M8 16.5h.01" }],
  "server-crash": [{ r: [4, 4, 16, 7, 2] }, { d: "M9 20H6a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3M15 13h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-3M12.8 12l-2.3 4h3l-2.3 4M8 7.5h.01" }],
  "user-x": [{ c: [9.5, 8, 3.75] }, { d: "M3.5 20a6 6 0 0 1 12 0M16.5 8.5l4 4M20.5 8.5l-4 4" }],
  "hard-drive": [{ d: "M3.5 13.5h17M3.5 13.5l2.6-7a1.5 1.5 0 0 1 1.4-1h9a1.5 1.5 0 0 1 1.4 1l2.6 7v4.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM7.5 17h.01M11 17h.01" }],
  "code-xml": [{ d: "M8 7.5L3.5 12 8 16.5M16 7.5l4.5 4.5-4.5 4.5M13.5 5l-3 14" }],
  "ellipsis": [{ c: [6, 12, 1.4], dot: true }, { c: [12, 12, 1.4], dot: true }, { c: [18, 12, 1.4], dot: true }],
  "sliders-horizontal": [{ d: "M4 7h9M17 7h3M4 17h3M11 17h9" }, { c: [15, 7, 2] }, { c: [9, 17, 2] }],
  "compass": [RING, { d: "M15.5 8.5l-2 5-5 2 2-5z" }],
  "hourglass": [{ d: "M6.5 3.5h11M6.5 20.5h11M7.5 3.5v2.3a4 4 0 0 0 1.5 3.1L12 12l3-3.1a4 4 0 0 0 1.5-3.1V3.5M7.5 20.5v-2.3a4 4 0 0 1 1.5-3.1L12 12l3 3.1a4 4 0 0 1 1.5 3.1v2.3" }],
  "wrench": [{ d: "M17.6 4.5l-1.8 1.8 1.9 1.9 1.8-1.7a4.5 4.5 0 0 1-5.9 6.1L7.2 19a1.55 1.55 0 0 1-2.2-2.2l6.4-6.4a4.5 4.5 0 0 1 6.2-5.9z" }],
  "monitor-x": [{ r: [3, 4, 18, 12.5, 2] }, { d: "M8.5 20.5h7M12 16.5v4M10 8.3l4 4M14 8.3l-4 4" }],
  "send": [{ d: "M20.5 3.5l-10 10M20.5 3.5l-6 17-4-7-7-4z" }],
} as const satisfies Record<string, readonly GlyphEl[]>;

export type GlyphName = keyof typeof GLYPHS;
