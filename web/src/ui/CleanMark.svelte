<script lang="ts">
  // Marque de nettoyage à côté du type d'un fichier (D41-34, retours UI7), SVG maison 12 × 12 :
  // étincelle discrète (nettoyé) ou pastille ambre avec « ! » (nettoyage impossible). Décorative :
  // le détail est dans la bulle et le nom du cadenas de l'icône, le résumé sous la liste.
  let { kind }: { kind: "spark" | "fail" } = $props();
</script>

<svg class={["cm", kind]} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false" data-clean={kind === "spark" ? "nettoye" : "echec"}>
  {#if kind === "spark"}
    <path d="M5.5 1.5Q6 5 9.5 5.5 6 6 5.5 9.5 5 6 1.5 5.5 5 5 5.5 1.5Z" />
    <circle cx="9.6" cy="2.4" r="0.9" />
  {:else}
    <circle class="dot" cx="6" cy="6" r="5.5" />
    <path class="bang" d="M6 3.3v3.2" />
    <circle class="bdot" cx="6" cy="8.6" r="0.8" />
  {/if}
</svg>

<style>
  .cm {
    flex: none;
    display: inline-block;
    margin-inline-start: 5px;
    vertical-align: -1px;
  }
  .spark {
    fill: var(--accent);
    opacity: 0.85;
  }
  .fail .dot {
    fill: var(--warn);
  }
  .fail .bang {
    fill: none;
    stroke: var(--bg);
    stroke-width: 1.5;
    stroke-linecap: round;
  }
  .fail .bdot {
    fill: var(--bg);
  }
  @media (forced-colors: active) {
    .spark,
    .fail .dot {
      fill: CanvasText;
    }
    .fail .bang {
      stroke: Canvas;
    }
    .fail .bdot {
      fill: Canvas;
    }
  }
</style>
