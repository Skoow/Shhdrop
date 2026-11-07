<script lang="ts">
  // QR du lien (UI §9.5, S7) : modules sombres sur papier clair, zone de silence de 4 modules,
  // correction M. Chargé par import() dynamique, seulement quand on le demande.
  import { qrPath } from "../qr/qr";

  type Props = { text: string; label: string };
  let { text, label }: Props = $props();
  const qr = $derived(qrPath(text));
</script>

<svg class="qr" viewBox="0 0 {qr.size} {qr.size}" role="img" aria-label={label} shape-rendering="crispEdges">
  <rect class="paper" width={qr.size} height={qr.size} />
  <path class="ink" d={qr.d} />
</svg>

<style>
  .qr {
    display: block;
    width: min(100%, 280px);
    height: auto;
    aspect-ratio: 1;
    border-radius: var(--r-md);
  }
  .paper {
    fill: var(--paper);
  }
  .ink {
    fill: var(--ink);
  }
  @media (forced-colors: active) {
    .paper {
      fill: Canvas;
    }
    .ink {
      fill: CanvasText;
    }
  }
</style>
