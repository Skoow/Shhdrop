<script lang="ts">
  // Forme d'onde en barres DOM (Task 12) : hauteur par transform (scaleY), jamais d'attribut style
  // (la directive style: passe par le CSSOM). `onseek` : l'onde devient un curseur (toucher,
  // glisser, flèches) ; les barres déjà lues prennent la couleur d'accent.
  import { seekRatio } from "../media/recorder";

  type Props = {
    peaks: readonly number[];
    /** Part lue, de 0 à 1. */
    progress?: number;
    size?: "live" | "big" | "mini";
    /** Curseur : nom accessible et texte de la valeur (« 0:12 sur 0:42 »). */
    label?: string;
    valuetext?: string;
    onseek?: (ratio: number) => void;
  };
  let { peaks, progress = 0, size = "big", label, valuetext, onseek }: Props = $props();

  let el: HTMLDivElement | undefined = $state();
  let dragging = false;
  const at = (e: PointerEvent) => {
    const r = el!.getBoundingClientRect();
    onseek?.(seekRatio(e.clientX, r.left, r.width));
  };
  function down(e: PointerEvent) {
    if (!onseek || !el || !e.isPrimary) return;
    e.stopPropagation(); // le glisser sur l'onde déplace la lecture, jamais la ligne (retrait)
    dragging = true;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* pointeur déjà relâché */
    }
    at(e);
  }
  function move(e: PointerEvent) {
    if (!dragging) return;
    e.stopPropagation();
    at(e);
  }
  function up() {
    dragging = false;
  }
  function key(e: KeyboardEvent) {
    if (!onseek) return;
    const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 0.05 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -0.05 : null;
    if (e.key === "Home") onseek(0);
    else if (e.key === "End") onseek(1);
    else if (step !== null) onseek(Math.min(1, Math.max(0, progress + step)));
    else return;
    e.preventDefault();
  }
</script>

{#snippet bars()}
  {#each peaks as p, i (i)}
    <span class={["b", { on: (i + 0.5) / peaks.length <= progress }]} style:--h={p}></span>
  {/each}
{/snippet}

{#if onseek}
  <div
    bind:this={el}
    class={["wave", size, "seek"]}
    role="slider"
    tabindex="0"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(progress * 100)}
    aria-valuetext={valuetext}
    data-wave={size}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onkeydown={key}
  >
    {@render bars()}
    <span class="track" style:--p={progress} aria-hidden="true"><span class="knob"></span></span>
  </div>
{:else}
  <div class={["wave", size]} aria-hidden="true" data-wave={size}>{@render bars()}</div>
{/if}

<style>
  .wave {
    --bar: 3px;
    --gap: 1px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap);
    height: 48px;
    min-width: 0;
    overflow: hidden;
  }
  /* Vivante : les nouvelles barres entrent à droite et glissent vers la gauche, qui s'efface. */
  .wave.live {
    --bar: 4px;
    --gap: 3px;
    width: 100%;
    height: 64px;
    justify-content: space-between;
    mask-image: linear-gradient(to right, transparent, #000 22%);
  }
  .wave.mini {
    --bar: 2px;
    --gap: 1px;
    height: 22px;
  }
  .seek {
    position: relative;
    overflow: visible;
    cursor: pointer;
    touch-action: pan-y;
    border-radius: var(--r-sm);
  }
  .seek:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
  }
  .b {
    flex: 1 1 0;
    min-width: 1px;
    max-width: var(--bar);
    height: 100%;
    border-radius: var(--r-pill);
    background: var(--text-3);
    transform: scaleY(var(--h));
    transform-origin: center;
    transition:
      transform 90ms var(--ease-out),
      background-color 120ms var(--ease-out);
  }
  /* Curseur rond sur la position de lecture : la piste couvre l'onde, son décalage suit --p. */
  .track {
    position: absolute;
    inset: 0;
    pointer-events: none;
    transform: translateX(calc(var(--p, 0) * 100%));
  }
  .knob {
    position: absolute;
    top: 50%;
    left: -6px;
    width: 12px;
    height: 12px;
    margin-top: -6px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.45);
  }
  .mini .knob {
    left: -5px;
    width: 10px;
    height: 10px;
    margin-top: -5px;
  }
  .live .b {
    background: var(--text);
    opacity: 0.86;
  }
  .b.on {
    background: var(--accent);
  }
  @media (prefers-reduced-motion: reduce) {
    .b {
      transition: none;
    }
  }
  @media (forced-colors: active) {
    .b {
      background: CanvasText;
    }
    .b.on,
    .knob {
      background: Highlight;
    }
  }
</style>
