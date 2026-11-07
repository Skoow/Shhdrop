<script lang="ts">
  // Image reçue (UI §9.8, §12.4) : <img> depuis une URL blob, révoquée dès le chargement ;
  // plein écran au toucher, zoom natif. Échec de décodage → onerror (le parent retire la
  // visionneuse). « Voir seulement » : glisser et menu contextuel neutralisés (dissuasion).
  import { revoke } from "./blobs";

  type Props = { url: string; alt: string; viewOnly: boolean; onerror: () => void };
  let { url, alt, viewOnly, onerror }: Props = $props();
  let img: HTMLImageElement | undefined = $state();

  function loaded() {
    revoke(url);
  }
  function failed() {
    revoke(url);
    onerror();
  }
  function full() {
    void img?.requestFullscreen?.().catch(() => undefined);
  }
</script>

<button type="button" class="frame" onclick={full}>
  <img
    bind:this={img}
    src={url}
    {alt}
    decoding="async"
    draggable={viewOnly ? false : undefined}
    class={[viewOnly && "guarded"]}
    onload={loaded}
    onerror={failed}
    oncontextmenu={viewOnly ? (e) => e.preventDefault() : undefined}
  />
</button>

<style>
  .frame {
    display: block;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
    border-radius: var(--r-lg);
    max-width: 100%;
  }
  img {
    display: block;
    max-width: 100%;
    max-height: min(70vh, 720px);
    height: auto;
    border-radius: var(--r-lg);
    background: var(--surface-2);
  }
  img:fullscreen {
    max-height: none;
    object-fit: contain;
    background: var(--bg-deep);
  }
  .guarded {
    -webkit-touch-callout: none;
    user-select: none;
  }
  @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    img {
      transition: transform var(--dur-fast) var(--ease-out);
    }
    .frame:hover img {
      transform: scale(1.03);
    }
  }
</style>
