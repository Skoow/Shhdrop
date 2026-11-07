<script lang="ts">
  // Illustration de l'état « partage détruit » (UI §9.10.1, décision du 7 novembre) : un
  // document géométrique (rayon 12, coin plié, trois lignes) dont le bord droit et bas se défait
  // en points carrés de la Trame qui dérivent vers le haut et la droite. Remplace le cadenas
  // ouvert. Mouvement composé seulement (transform, opacity), joué une fois ; mouvement réduit :
  // l'image finale, fixe. Décorative (aria-hidden) : le titre de l'écran porte le sens.
  import { DOC, DOT_MS, dissolveCells, dissolveDots } from "./decor";
  import { reducedMotion } from "./motion";

  const cells = dissolveCells();
  const dots = dissolveDots();
  const uid = $props.id();
  const r = 12;
  const fold = 18;
  const { x, y, w, h } = DOC;
  // Feuille à coin plié (haut droit), rayon 12 ailleurs.
  const sheet = `M${x + r} ${y}H${x + w - fold}L${x + w} ${y + fold}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  const foldPath = `M${x + w - fold} ${y}V${y + fold - 4}A4 4 0 0 0 ${x + w - fold + 4} ${y + fold}H${x + w}`;

  // Joué une fois à l'arrivée : chaque point part de sa cellule et rejoint sa place finale.
  function play(node: SVGGElement) {
    if (reducedMotion() || typeof node.animate !== "function") return;
    const anims = [...node.querySelectorAll<SVGRectElement>("rect")].map((el, k) => {
      const d = dots[k]!;
      return el.animate(
        [
          { transform: `translate(${-d.dx}px, ${-d.dy}px)`, opacity: 1 },
          { transform: "translate(0px, 0px)", opacity: d.o },
        ],
        { duration: DOT_MS, delay: d.delay, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" },
      );
    });
    return () => anims.forEach((a) => a.cancel());
  }
</script>

<svg class="art" viewBox="0 0 136 128" width="136" height="128" aria-hidden="true" focusable="false" data-state="destroyed">
  <defs>
    <mask id="{uid}-m" maskUnits="userSpaceOnUse" x="0" y="0" width="136" height="128">
      <rect x="0" y="0" width="136" height="128" fill="white" />
      {#each cells as c (c.x + "," + c.y)}<rect x={c.x} y={c.y} width="8" height="8" fill="black" />{/each}
    </mask>
  </defs>
  <g mask="url(#{uid}-m)">
    <path class="sheet" d={sheet} />
    <path class="fold" d={foldPath} />
    <path class="lines" d="M{x + 14} {y + 36}H{x + 58}M{x + 14} {y + 50}H{x + 64}M{x + 14} {y + 64}H{x + 46}" />
  </g>
  <g class="dots" {@attach play}>
    {#each dots as d, k (k)}
      <rect class={["dot", d.accent && "acc"]} x={d.x + d.dx} y={d.y + d.dy} width="4" height="4" opacity={d.o} />
    {/each}
  </g>
</svg>

<style>
  .art {
    display: block;
    width: 136px;
    height: auto;
    overflow: visible;
  }
  .sheet {
    fill: var(--surface-1);
    stroke: var(--line-strong);
    stroke-width: 1.25;
  }
  .fold {
    fill: none;
    stroke: var(--line-strong);
    stroke-width: 1.25;
    stroke-linejoin: round;
  }
  .lines {
    fill: none;
    stroke: var(--text-3);
    stroke-width: 2;
    stroke-linecap: round;
  }
  .dot {
    fill: var(--text-3);
    transform-box: fill-box;
  }
  .acc {
    fill: var(--accent);
  }
  @media (forced-colors: active) {
    .sheet,
    .fold,
    .lines {
      stroke: CanvasText;
    }
    .sheet {
      fill: Canvas;
    }
    .dot,
    .acc {
      fill: CanvasText;
      opacity: 1;
    }
  }
</style>
