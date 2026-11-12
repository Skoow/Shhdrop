<script lang="ts">
  // Bande qui défile sous le héros (référence du propriétaire, 12 novembre) : des promesses
  // produit vraies, jamais une activité « en direct » (ce serait un faux, et le vrai une fuite).
  // Défilement CSS (transform seulement), arrêté hors écran, onglet caché, au survol, au focus
  // et par son bouton (WCAG 2.2.2) ; immobile en mouvement réduit.
  import { t, type Key } from "../i18n/i18n.svelte";
  import { Pause, Play } from "./Icon";

  const ITEMS: Key[] = ["band.1", "band.2", "band.3", "band.4", "band.5", "band.6"];

  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  let reduced = $state(mq?.matches === true);
  $effect(() => {
    if (!mq?.addEventListener) return;
    const on = () => (reduced = mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  });
  let stopped = $state(false);
  let onscreen = $state(true);
  let hidden = $state(typeof document !== "undefined" && document.hidden);
  let el: HTMLElement | undefined = $state();
  $effect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => (onscreen = e!.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  });
  const uid = $props.id();
</script>

<svelte:document onvisibilitychange={() => (hidden = document.hidden)} />

{#snippet star()}
  <svg class="mk" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false"><path d="M5 0v10M0 5h10" /></svg>
{/snippet}

<section bind:this={el} class={["band", { still: reduced, stopped, off: !onscreen || hidden }]} aria-labelledby="{uid}-t" data-band data-ambient>
  <h2 class="sr-only" id="{uid}-t">{t("band.label")}</h2>
  <div class="view">
    <div class="track">
      <ul>
        {#each ITEMS as k (k)}<li>{@render star()}{t(k)}</li>{/each}
      </ul>
      {#if !reduced}
        <ul aria-hidden="true">
          {#each ITEMS as k (k)}<li>{@render star()}{t(k)}</li>{/each}
        </ul>
      {/if}
    </div>
  </div>
  {#if !reduced}
    <button type="button" class="stop" data-band-toggle aria-label={stopped ? t("band.play") : t("band.pause")} onclick={() => (stopped = !stopped)}>
      {#if stopped}<Play size={14} strokeWidth={2.2} aria-hidden="true" />{:else}<Pause size={14} strokeWidth={2.2} aria-hidden="true" />{/if}
    </button>
  {/if}
</section>

<style>
  .band {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    border-radius: 14px;
    border: 1px solid rgb(150 175 255 / 0.12);
    background: rgb(6 10 24 / 0.6);
  }
  .view {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    -webkit-mask-image: linear-gradient(to right, transparent, #000 8%, #000 92%, transparent);
    mask-image: linear-gradient(to right, transparent, #000 8%, #000 92%, transparent);
  }
  .track {
    display: flex;
    width: max-content;
    animation: slide 48s linear infinite;
  }
  .band:hover .track,
  .band:focus-within .track,
  .stopped .track,
  .off .track {
    animation-play-state: paused;
  }
  @keyframes slide {
    to {
      transform: translateX(-50%);
    }
  }
  ul {
    display: flex;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: inline-flex;
    align-items: center;
    gap: 14px;
    padding: 14px 14px;
    color: #aab6d3;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .mk {
    flex: none;
    stroke: var(--accent);
    stroke-width: 1.4;
  }
  .stop {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin-inline-end: max(8px, env(safe-area-inset-right));
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
  }
  .stop:hover {
    color: var(--text);
    background: rgb(255 255 255 / 0.05);
  }
  .stop:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  /* Mouvement réduit : immobile, les promesses passent à la ligne. */
  .still .track {
    width: auto;
    animation: none;
  }
  .still .view {
    -webkit-mask-image: none;
    mask-image: none;
  }
  .still ul {
    flex-wrap: wrap;
    justify-content: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .track {
      animation: none;
    }
  }
  @media (forced-colors: active) {
    .band {
      border-color: CanvasText;
    }
  }
</style>
