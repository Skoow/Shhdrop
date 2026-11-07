<script lang="ts">
  // Image reçue (UI §9.8, §12.4) : <img> depuis une URL blob, révoquée dès le chargement ; dans
  // le panneau de la visionneuse (jamais en plein écran imposé). Échec de décodage → onerror.
  // « Voir seulement » : glisser et menu contextuel neutralisés (dissuasion seulement).
  import { revoke } from "./blobs";

  type Props = { url: string; alt: string; viewOnly: boolean; onerror: () => void };
  let { url, alt, viewOnly, onerror }: Props = $props();

  function failed() {
    revoke(url);
    onerror();
  }
</script>

<img
  src={url}
  {alt}
  decoding="async"
  draggable={viewOnly ? false : undefined}
  class={[viewOnly && "guarded"]}
  onload={() => revoke(url)}
  onerror={failed}
  oncontextmenu={viewOnly ? (e) => e.preventDefault() : undefined}
/>

<style>
  img {
    display: block;
    max-width: 100%;
    max-height: 100%;
    height: auto;
    object-fit: contain;
    border-radius: var(--r-md);
  }
  .guarded {
    -webkit-touch-callout: none;
    user-select: none;
  }
</style>
