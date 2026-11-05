// Animations du logo « Trame » (chronologies pures, sans DOM, appliquées par Logo.svelte) :
// « chut » à l'arrivée et effacement à la gomme pour l'écran de destruction.
// Repère : celui du mot-symbole (logo-paths.ts), y = 0 sur la ligne de base, x de 0 à ~183.
// Principe : une gomme (deux tracés) balaie le mot en deux passes ; sous elle, deux rectangles d'un
// masque SVG glissent (transform) et effacent les lettres, bord avant adouci par un dégradé. Seules
// opacity et transform varient. Le mot nettoyé laisse transparaître un instant sa trame, puis revient.

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

/**
 * Chronologie. `restore` : le mot revient assemblé et reste (arrivée, ~2 s) ; sinon il reste effacé
 * (écran de destruction, ~1,8 s).
 */
export function eraseTimeline(restore: boolean): Timeline {
  const duration = restore ? 2000 : 1800;
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
  const clearAt = o(P2.to + 120);
  const passFrames = (p: { from: number; to: number }, dir: 1 | -1): Keyframe[] => [
    { offset: 0, opacity: 1, transform: "translateX(0px)" },
    { offset: o(p.from), opacity: 1, transform: "translateX(0px)", easing: "ease-in-out" },
    { offset: o(p.to), opacity: 1, transform: `translateX(${dir * D}px)` },
    ...(restore
      ? [
          { offset: clearAt, opacity: 1, transform: `translateX(${dir * D}px)` },
          { offset: Math.min(1, clearAt + 0.001), opacity: 0, transform: `translateX(${dir * D}px)` },
        ]
      : []),
    { offset: 1, opacity: restore ? 0 : 1, transform: `translateX(${dir * D}px)` },
  ];
  tracks.push({ target: ".m1", frames: passFrames(P1, 1) });
  tracks.push({ target: ".m2", frames: passFrames(P2, -1) });

  // Encre : ce que la gomme laisse (frottement imparfait) disparaît, surface propre ; puis retour.
  const ink: Keyframe[] = [
    { offset: 0, opacity: 1, transform: "none" },
    { offset: o(P2.to - 80), opacity: 1, transform: "none", easing: "ease-in" },
    { offset: o(P2.to + 80), opacity: 0, transform: "none" },
  ];
  if (restore)
    ink.push(
      { offset: o(1560), opacity: 0, transform: "translateY(3px)", easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
      { offset: 1, opacity: 1, transform: "none" },
    );
  else ink.push({ offset: 1, opacity: 0, transform: "none" });
  tracks.push({ target: ".ink", frames: ink, fill: restore ? "none" : "forwards" });

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

// ---------------------------------------------------------------------------------------------
// « Chut » (arrivée) : le fût du second h se lève en doigt menthe devant le mot, la fin du mot
// se tait (la trame de « rop » pâlit), une onde « shh » s'éteint, puis le doigt redescend.
// Première et dernière image = le logo au repos (doigt et ondes à opacité 0, trame à 1).

/** Doigt : rectangle à bout rond, au droit du fût du second h (x 52 → 57), de la base à 4 u au-dessus de l'ascendante. */
export const FINGER = "M52 0V-35.5A2.5 2.5 0 0 1 57 -35.5V0Z";
export const FINGER_RISE = 6;
/** Ondes « shh » : deux arcs concentriques à droite du bout du doigt (centre 58 ; −34, r 5 et 9, de −50° à 40°). */
export const WAVES = [5, 9].map((r) => {
  const c = { x: 58, y: -34 };
  const a0 = (-50 * Math.PI) / 180, a1 = (40 * Math.PI) / 180;
  const p = (a: number) => `${(c.x + r * Math.cos(a)).toFixed(2)} ${(c.y + r * Math.sin(a)).toFixed(2)}`;
  return `M${p(a0)}A${r} ${r} 0 0 1 ${p(a1)}`;
});

export function hushTimeline(buckets: number): Timeline {
  const duration = 2000;
  const o = (t: number) => Math.min(1, Math.max(0, t / duration));
  const tracks: Track[] = [];
  const UP = "cubic-bezier(0.16, 1, 0.3, 1)";
  const DOWN = "cubic-bezier(0.7, 0, 0.84, 0)";
  tracks.push({
    target: ".finger",
    frames: [
      { offset: 0, opacity: 0, transform: `translateY(${FINGER_RISE}px)`, easing: UP },
      { offset: o(420), opacity: 1, transform: "translateY(0px)" },
      { offset: o(1380), opacity: 1, transform: "translateY(0px)", easing: DOWN },
      { offset: o(1680), opacity: 0, transform: `translateY(${FINGER_RISE}px)` },
      { offset: 1, opacity: 0, transform: `translateY(${FINGER_RISE}px)` },
    ],
  });
  // La fin du mot se tait, tranche par tranche de gauche à droite, puis revient exactement au repos.
  for (let k = 0; k < buckets; k++)
    tracks.push({
      target: ".dots",
      nth: k,
      frames: [
        { offset: 0, opacity: 1, transform: "scale(1)" },
        { offset: o(340 + k * 45), opacity: 1, transform: "scale(1)", easing: "ease-out" },
        { offset: o(700 + k * 45), opacity: 0.22, transform: "scale(0.86)" },
        { offset: o(1300 + k * 40), opacity: 0.22, transform: "scale(0.86)", easing: "ease-in-out" },
        { offset: o(1720 + k * 40), opacity: 1, transform: "scale(1)" },
        { offset: 1, opacity: 1, transform: "scale(1)" },
      ],
    });
  // Onde « shh » : naît au bout du doigt, s'élargit à peine, s'éteint.
  for (let i = 0; i < WAVES.length; i++) {
    const t = 480 + i * 140;
    tracks.push({
      target: `.wave${i}`,
      frames: [
        { offset: 0, opacity: 0, transform: "scale(0.85)" },
        { offset: o(t), opacity: 0, transform: "scale(0.85)", easing: "ease-out" },
        { offset: o(t + 160), opacity: 0.7, transform: "scale(0.95)" },
        { offset: o(t + 620), opacity: 0, transform: "scale(1.15)" },
        { offset: 1, opacity: 0, transform: "scale(1.15)" },
      ],
    });
  }
  return { duration, tracks };
}
