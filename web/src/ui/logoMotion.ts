// Animations du logo « Trame » (chronologies pures, sans DOM, appliquées par Logo.svelte) :
// effacement à la gomme pour l'écran de destruction.
// Repère : celui du mot-symbole (logo-paths.ts), y = 0 sur la ligne de base, x de 0 à ~183.
// Principe : une gomme (deux tracés) balaie le mot en deux passes ; sous elle, deux rectangles d'un
// masque SVG glissent (transform) et effacent les lettres, bord avant adouci par un dégradé. Seules
// opacity et transform varient. Le mot nettoyé laisse transparaître un instant sa trame, puis reste effacé.

/** Point de contact de la gomme : abscisses de début et de fin de passe, ordonnée de chaque bande. */
export const ERASE = {
  x0: -8,
  x1: 190,
  /** Bande haute (passe 1, vers la droite) et bande basse (passe 2, vers la gauche). */
  band1: { y: -40, h: 29, contact: -17 },
  band2: { y: -15, h: 29, contact: 0 },
  /** Largeur des rectangles du masque ; leur bord avant (5 % adoucis) suit le point de contact. */
  maskW: 230,
  soft: 0.1,
  /** Gomme : 26 × 10,4 u, inclinée de −30°, embout (gauche) au contact. */
  tilt: -30,
} as const;

/** Décalage centre de la gomme ← point de contact (embout bas-gauche, après inclinaison). */
const OFF = { x: 7.3, y: -4.2 }; // centre de l'embout (−8,4 ; 0) tourné de −30°

export type Track = { target: string; nth?: number; frames: Keyframe[]; easing?: string; fill?: FillMode };
export type Timeline = { duration: number; tracks: Track[] };

/** Miettes : abscisse et ordonnée de chute, passe d'origine. */
export const CRUMBS = [
  { x: 42, y: -8, pass: 1 },
  { x: 104, y: -9, pass: 1 },
  { x: 166, y: -7, pass: 1 },
  { x: 128, y: 9, pass: 2 },
  { x: 58, y: 10, pass: 2 },
] as const;

const P1 = { from: 140, to: 720 };
const P2 = { from: 820, to: 1380 };

/** Instant où le contact passe en x pendant une passe (approximation linéaire, assez pour les miettes). */
function at(pass: 1 | 2, x: number): number {
  const p = pass === 1 ? P1 : P2;
  const u = pass === 1 ? (x - ERASE.x0) / (ERASE.x1 - ERASE.x0) : (ERASE.x1 - x) / (ERASE.x1 - ERASE.x0);
  return p.from + u * (p.to - p.from);
}

const pose = (x: number, y: number, r: number) => `translate(${x + OFF.x}px, ${y + OFF.y}px) rotate(${r}deg)`;

/** Chronologie de l'effacement : le mot reste effacé (écran de destruction, ~1,8 s). */
export function eraseTimeline(): Timeline {
  const duration = 1800;
  const o = (t: number) => Math.min(1, t / duration);
  const { x0, x1, tilt } = ERASE;
  const y1 = ERASE.band1.contact;
  const y2 = ERASE.band2.contact;
  const D = x1 - x0;
  const tracks: Track[] = [];

  // Gomme : entre en glissant, frotte (légère oscillation), descend, revient, sort.
  tracks.push({
    target: ".eraser",
    frames: [
      { offset: 0, opacity: 0, transform: pose(x0 - 14, y1 - 8, tilt + 8), easing: "ease-out" },
      { offset: o(P1.from), opacity: 1, transform: pose(x0, y1, tilt), easing: "ease-in-out" },
      { offset: o((P1.from + P1.to) / 2), opacity: 1, transform: pose((x0 + x1) / 2, y1 + 0.6, tilt - 3), easing: "ease-in-out" },
      { offset: o(P1.to), opacity: 1, transform: pose(x1, y1, tilt + 2), easing: "ease-in-out" },
      { offset: o((P1.to + P2.from) / 2), opacity: 1, transform: pose(x1 + 4, (y1 + y2) / 2 - 3, tilt + 6), easing: "ease-in-out" },
      { offset: o(P2.from), opacity: 1, transform: pose(x1, y2, tilt), easing: "ease-in-out" },
      { offset: o((P2.from + P2.to) / 2), opacity: 1, transform: pose((x0 + x1) / 2, y2 - 0.6, tilt + 3), easing: "ease-in-out" },
      { offset: o(P2.to), opacity: 1, transform: pose(x0, y2, tilt - 1), easing: "ease-in" },
      { offset: o(P2.to + 140), opacity: 0, transform: pose(x0 - 22, y2 - 10, tilt + 10) },
      { offset: 1, opacity: 0, transform: pose(x0 - 22, y2 - 10, tilt + 10) },
    ],
  });

  // Masque : chaque rectangle suit la gomme pendant sa passe, puis se retire (mot invisible à ce moment).
  const passFrames = (p: { from: number; to: number }, dir: 1 | -1): Keyframe[] => [
    { offset: 0, opacity: 1, transform: "translateX(0px)" },
    { offset: o(p.from), opacity: 1, transform: "translateX(0px)", easing: "ease-in-out" },
    { offset: o(p.to), opacity: 1, transform: `translateX(${dir * D}px)` },
    { offset: 1, opacity: 1, transform: `translateX(${dir * D}px)` },
  ];
  tracks.push({ target: ".m1", frames: passFrames(P1, 1) });
  tracks.push({ target: ".m2", frames: passFrames(P2, -1) });

  // Encre : ce que la gomme laisse (frottement imparfait) disparaît, surface propre ; puis reste effacée.
  const ink: Keyframe[] = [
    { offset: 0, opacity: 1, transform: "none" },
    { offset: o(P2.to - 80), opacity: 1, transform: "none", easing: "ease-in" },
    { offset: o(P2.to + 80), opacity: 0, transform: "none" },
  ];
  ink.push({ offset: 1, opacity: 0, transform: "none" });
  tracks.push({ target: ".ink", frames: ink, fill: "forwards" });

  // Trame : transparaît un instant sur la surface nettoyée, puis s'éteint.
  tracks.push({
    target: ".ghost",
    frames: [
      { offset: 0, opacity: 0 },
      { offset: o(P2.to - 120), opacity: 0 },
      { offset: o(P2.to + 60), opacity: 0.32 },
      { offset: o(1560), opacity: 0.32 },
      { offset: o(1760), opacity: 0 },
      { offset: 1, opacity: 0 },
    ],
  });

  // Miettes : apparaissent derrière la gomme, tombent un peu, s'éteignent.
  CRUMBS.forEach((c, i) => {
    const t = at(c.pass, c.x);
    tracks.push({
      target: `.crumb${i}`,
      frames: [
        { offset: 0, opacity: 0, transform: "translateY(0px)" },
        { offset: o(t), opacity: 0, transform: "translateY(0px)", easing: "ease-out" },
        { offset: o(t + 60), opacity: 0.75, transform: "translateY(0.5px)", easing: "ease-in" },
        { offset: o(t + 420), opacity: 0, transform: "translateY(4px)" },
        { offset: 1, opacity: 0, transform: "translateY(4px)" },
      ],
    });
  });
  return { duration, tracks };
}

/** Tracés de la gomme (repère centré) : embout à gauche (9 u), fourreau à droite (17 u), coins r 2,6. */
export const ERASER_RUBBER = "M-4 -5.2H-10.4A2.6 2.6 0 0 0 -13 -2.6V2.6A2.6 2.6 0 0 0 -10.4 5.2H-4Z";
export const ERASER_SLEEVE = "M-4 -5.2H10.4A2.6 2.6 0 0 1 13 -2.6V2.6A2.6 2.6 0 0 1 10.4 5.2H-4Z";
