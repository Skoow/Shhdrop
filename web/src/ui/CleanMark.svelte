<script lang="ts">
  // Marque de nettoyage d'un fichier (retours UI8, remplace l'étincelle de D41-34) : petit
  // bouclier maison juste après le nom (retours UI9), centré sur le texte, jamais repoussé hors de la ligne, avec sa propre bulle
  // (survol, focus clavier, appui). Nettoyé : bouclier coché, couleur d'accent. Échec : même
  // bouclier, ambre, « ! » à l'intérieur. Tel quel : aucune marque (l'appelant n'en pose pas).
  // Le texte de la bulle est aussi le nom du bouton ; la forme change avec l'état, pas que la couleur.
  import Tip from "./Tip.svelte";

  let { kind, text }: { kind: "done" | "fail"; text: string } = $props();
</script>

<span class={["cm", kind]} data-clean={kind === "done" ? "nettoye" : "echec"}>
  <Tip label={text} tip={text}>
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
      <path class="sh" d="M8 1.6l5.2 1.9v3.9c0 3.2-2.1 5.6-5.2 6.9-3.1-1.3-5.2-3.7-5.2-6.9V3.5z" />
      {#if kind === "done"}
        <path class="mk" d="M5.6 7.9l1.7 1.7 3.1-3.3" />
      {:else}
        <path class="mk" d="M8 5v3.4" /><circle class="dt" cx="8" cy="10.7" r="0.95" />
      {/if}
    </svg>
  </Tip>
</span>

<style>
  .cm {
    flex: none;
    display: inline-flex;
    align-items: center;
    margin-inline-start: 4px;
    line-height: 0;
  }
  svg {
    display: block;
  }
  /* Bouclier plein : visible d'un coup d'œil ; la marque se détache en creux. */
  .sh {
    stroke-linejoin: round;
  }
  .done .sh {
    fill: var(--accent);
  }
  .fail .sh {
    fill: var(--warn);
  }
  .mk {
    fill: none;
    stroke: var(--bg);
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .dt {
    fill: var(--bg);
  }
  @media (forced-colors: active) {
    .done .sh,
    .fail .sh {
      fill: CanvasText;
    }
    .mk {
      stroke: Canvas;
    }
    .dt {
      fill: Canvas;
    }
  }
</style>
