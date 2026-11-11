<script lang="ts">
  // Vidéo reçue (UI §9.8, spec §12) : affichée après le téléchargement complet,
  // <video controls playsinline>. « Voir seulement » : ni téléchargement, ni image dans
  // l'image, ni menu contextuel (dissuasion, spec §34).
  import { stallGuard } from "./stall";

  type Props = { url: string; label: string; viewOnly: boolean; onerror: () => void };
  let { url, label, viewOnly, onerror }: Props = $props();
</script>

<!-- svelte-ignore a11y_media_has_caption -->
<video
  controls
  playsinline
  src={url}
  aria-label={label}
  preload="metadata"
  controlslist={viewOnly ? "nodownload" : undefined}
  disablepictureinpicture={viewOnly || undefined}
  class={[viewOnly && "guarded"]}
  onerror={onerror}
  use:stallGuard={{ onstall: onerror }}
  oncontextmenu={viewOnly ? (e) => e.preventDefault() : undefined}
></video>

<style>
  video {
    display: block;
    width: 100%;
    max-height: 100%;
    border-radius: var(--r-lg);
    background: var(--bg-deep);
  }
  .guarded {
    -webkit-touch-callout: none;
  }
</style>
