<script lang="ts">
  // Trame d'impression de sécurité (accueil v3) : faisceau de sinusoïdes déphasées, très pâle,
  // comme sur un billet ou un passeport. SVG en ligne (aucune URL data:), calculé une fois.
  import { guilloche } from "./decor";

  let { lines = 24 }: { lines?: number } = $props();
  const paths = $derived(guilloche(1200, 400, lines));
</script>

<svg class="guil" viewBox="0 0 1200 400" preserveAspectRatio="none" aria-hidden="true" focusable="false">
  {#each paths as d, i (i)}<path {d} />{/each}
</svg>

<style>
  .guil {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: -1;
    pointer-events: none;
    fill: none;
    stroke: rgb(233 236 242 / 0.05);
    stroke-width: 0.75;
  }
  .guil path {
    vector-effect: non-scaling-stroke;
  }
  @media (forced-colors: active), (prefers-contrast: more) {
    .guil {
      display: none;
    }
  }
</style>
