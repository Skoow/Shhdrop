<script lang="ts">
  // Accueil v3, appel final (UI §9.1) : grande capsule du logo dont la lumière fait le tour
  // (ambiance), bouton « Commencer » dont l'anse du cadenas se ferme au survol et au focus.
  import { t } from "../../i18n/i18n.svelte";
  import { ambient, reveal } from "../../ui/attach";
  import { capPath } from "../../ui/motion";

  let { onstart }: { onstart: () => void } = $props();
  let w = $state(0);
  let h = $state(0);
  const d = $derived(w > 0 && h > 0 ? capPath(w, h, Math.min(h / 2, 160)) : "");
</script>

<section class="end" aria-labelledby="end-title">
  <div class="box rv" bind:clientWidth={w} bind:clientHeight={h} {@attach reveal}>
    <svg class="cap" viewBox="0 0 {w || 1} {h || 1}" aria-hidden="true" focusable="false">
      {#if d}
        <path class="track" {d} pathLength="100" />
        <g data-ambient {@attach ambient}><path class="comet" {d} pathLength="100" /></g>
      {/if}
    </svg>
    <h2 id="end-title">{t("home.end.title")}</h2>
    <p>{t("home.end.lede")}</p>
    <button type="button" class="cta" onclick={onstart}>
      <svg class="lk" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path class="shackle" d="M7 11V7a5 5 0 0 1 10 0v4" />
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path class="hole" d="M12 15v3" />
      </svg>
      <span>{t("home.end.cta")}</span>
    </button>
  </div>
</section>

<style>
  .end {
    padding-block: 120px var(--sp-6);
  }
  .box {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
    gap: var(--sp-4);
    padding: 72px var(--sp-5);
    text-align: center;
  }
  .cap {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    fill: none;
    pointer-events: none;
  }
  .track {
    stroke: rgb(233 236 242 / 0.22);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-dasharray: 83.33 100;
  }
  .comet {
    stroke: var(--seal-light);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-dasharray: 0 100;
    opacity: 0;
  }
  @media (prefers-reduced-motion: no-preference) {
    .comet {
      animation: orbit var(--dur-orbit) var(--ease-in-out) infinite;
    }
    g:global(.still) .comet {
      animation-play-state: paused;
    }
  }
  @keyframes orbit {
    0% { stroke-dasharray: 0 100; stroke-dashoffset: 0; opacity: 0; }
    6% { stroke-dasharray: 9 100; opacity: 1; }
    62% { stroke-dasharray: 9 100; stroke-dashoffset: -74; opacity: 1; }
    70%, 100% { stroke-dasharray: 0 100; stroke-dashoffset: -83; opacity: 0; }
  }
  h2 {
    width: 100%;
    max-width: 16ch;
    min-width: 0;
    overflow-wrap: break-word;
    font-size: var(--fs-section);
    line-height: 1.04;
    font-weight: 620;
    font-stretch: 110%;
    letter-spacing: -0.03em;
  }
  p {
    justify-self: stretch;
    margin: 0;
    color: var(--text-2);
    font-size: 1.125rem;
  }
  .cta {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-3);
    min-height: 56px;
    margin-top: var(--sp-2);
    padding: 0 26px 0 22px;
    border: 0;
    border-radius: 14px;
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 1.0625rem;
    font-weight: 620;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition:
      transform var(--dur-press) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out);
  }
  .cta:active {
    transform: scale(0.97);
  }
  @media (hover: hover) {
    .cta:hover {
      background: #fff;
    }
  }
  /* Clé et cadenas : l'anse ouverte se referme au survol, au focus et à l'appui. */
  .lk {
    width: 20px;
    height: 20px;
    overflow: visible;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .shackle {
    transform: translateY(-3px) rotate(-18deg);
    transform-origin: 17px 11px;
    transition: transform 420ms var(--ease-settle);
  }
  .hole {
    opacity: 0;
    transition: opacity 200ms var(--ease-out) 160ms;
  }
  .cta:hover .shackle,
  .cta:focus-visible .shackle,
  .cta:active .shackle {
    transform: none;
  }
  .cta:hover .hole,
  .cta:focus-visible .hole {
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .cta,
    .shackle,
    .hole {
      transition: none;
    }
    .cta:active {
      transform: none;
    }
  }
  @media (min-width: 1024px) {
    .end {
      padding-block-start: 200px;
    }
    .box {
      padding: 96px var(--sp-7);
    }
  }
  @media (forced-colors: active) {
    .track {
      stroke: CanvasText;
    }
    .comet {
      display: none;
    }
    .cta {
      border: 2px solid ButtonText;
    }
  }
</style>
