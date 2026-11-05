<script lang="ts">
  // Sceau de confiance (accueil v3) : rosace guillochée dessinée en géométrie (decor.ts, pur
  // calcul), pastille et icône au centre. Décoratif : le texte voisin porte le sens.
  import { rosette } from "./decor";
  import type { Lock } from "./Icon";

  let { icon: Icon }: { icon: typeof Lock } = $props();
  const outer = rosette(15, 1, 3.2, 24);
  const inner = rosette(17, 1, 2.2, 24, 1.04);
</script>

<span class="seal" aria-hidden="true">
  <svg class="rose" viewBox="0 0 48 48" focusable="false">
    <path class="r1" d={outer} />
    <path class="r2" d={inner} />
    <circle class="disc" cx="24" cy="24" r="12" />
  </svg>
  <Icon size={15} strokeWidth={2} aria-hidden="true" />
</span>

<style>
  .seal {
    position: relative;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    flex: none;
    color: var(--accent);
  }
  .rose {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    fill: none;
    transition: rotate 1.2s var(--ease-out);
  }
  /* Accueil v4 : la rosace tourne doucement avec le défilement de la page (composé). */
  @media (prefers-reduced-motion: no-preference) {
    @supports (animation-timeline: scroll()) {
      .rose {
        animation: turn linear both;
        animation-timeline: scroll(root);
      }
    }
  }
  @keyframes turn {
    to {
      transform: rotate(180deg);
    }
  }
  .r1 {
    stroke: rgb(95 227 181 / 0.5);
    stroke-width: 0.5;
  }
  .r2 {
    stroke: rgb(95 227 181 / 0.26);
    stroke-width: 0.4;
  }
  .disc {
    fill: var(--accent-tint);
    stroke: rgb(95 227 181 / 0.5);
    stroke-width: 0.6;
  }
  .seal :global(svg:not(.rose)) {
    position: relative;
  }
  @media (hover: hover) and (prefers-reduced-motion: no-preference) {
    :global(:hover) > .seal .rose {
      rotate: 30deg;
    }
  }
  @media (forced-colors: active) {
    .r1,
    .r2,
    .disc {
      stroke: CanvasText;
    }
    .disc {
      fill: Canvas;
    }
  }
</style>
