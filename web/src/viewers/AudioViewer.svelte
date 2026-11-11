<script lang="ts">
  // Audio reçu (UI §9.8) : <audio controls> natif. « Voir seulement » : sans téléchargement
  // dans les contrôles, menu contextuel neutralisé (dissuasion, spec §34).
  import { stallGuard } from "./stall";

  type Props = { url: string; label: string; viewOnly: boolean; onerror: () => void };
  let { url, label, viewOnly, onerror }: Props = $props();
</script>

<audio
  controls
  src={url}
  aria-label={label}
  preload="metadata"
  controlslist={viewOnly ? "nodownload" : undefined}
  onerror={onerror}
  use:stallGuard={{ onstall: onerror }}
  oncontextmenu={viewOnly ? (e) => e.preventDefault() : undefined}
></audio>

<style>
  audio {
    display: block;
    width: min(100%, 520px);
    color-scheme: dark;
  }
</style>
