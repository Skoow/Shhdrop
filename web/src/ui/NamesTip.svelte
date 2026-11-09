<script lang="ts">
  // Petite icône maison à côté du titre d'une liste (composeur, destinataire ; retours UI6) :
  // une étiquette de nom fermée d'un cadenas. Bulle au survol, au focus ou à l'appui (Tip) :
  // « Les noms de fichiers sont chiffrés aussi : nous ne pouvons pas les lire. »
  import { t } from "../i18n/i18n.svelte";
  import Tip from "./Tip.svelte";
</script>

<Tip label={t("names.tip")} tip={t("names.tip")} class="names-tip" data-names-tip="">
  <svg viewBox="0 0 20 16" width="20" height="16" aria-hidden="true" focusable="false">
    <!-- Étiquette (le nom) : deux traits d'écriture. -->
    <path class="tag" d="M2.5 3.5h8.2a1.6 1.6 0 0 1 1.13.47l2.2 2.2" />
    <path class="tag" d="M2.5 3.5v7.5a1.5 1.5 0 0 0 1.5 1.5h4.5" />
    <path class="txt" d="M5 7h4M5 9.6h2.4" />
    <!-- Cadenas au coin. -->
    <path class="sh" d="M13 10V8.6a2.1 2.1 0 0 1 4.2 0V10" />
    <rect class="body" x="11.6" y="9.8" width="7" height="5" rx="1.5" />
  </svg>
</Tip>

<style>
  :global(.names-tip) {
    color: var(--text-2);
  }
  @media (hover: hover) {
    :global(.names-tip:hover) {
      color: var(--accent);
    }
  }
  svg {
    display: block;
    overflow: visible;
  }
  .tag,
  .txt,
  .sh {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .body {
    fill: var(--accent);
  }
  @media (forced-colors: active) {
    .body {
      fill: CanvasText;
    }
  }
</style>
