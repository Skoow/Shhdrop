<script lang="ts">
  // Voile de dépôt pleine page (UI §9.2.2) : voile --scrim, capsule menthe à 16 px des bords qui
  // se referme (ouverture de 60° → 14°), texte centré. Affiché seulement pendant un glisser de
  // fichiers ; la logique (compteur, Échap, dépôt) est dans l'écran qui l'utilise.
  import { t } from "../i18n/i18n.svelte";
  import { Paperclip } from "./Icon";
  import { capPath } from "./motion";

  let { open = false }: { open?: boolean } = $props();
  let w = $state(0);
  let h = $state(0);
  const d = $derived(w > 32 && h > 32 ? capPath(w - 32, h - 32, 32) : "");
</script>

<svelte:window bind:innerWidth={w} bind:innerHeight={h} />

<div class={["overlay", { open }]} aria-hidden="true">
  <svg class="frame" viewBox="0 0 {Math.max(1, w - 32)} {Math.max(1, h - 32)}" focusable="false">
    {#if d}<path {d} pathLength="100" />{/if}
  </svg>
  <div class="say">
    <span class="mark"><Paperclip size={28} strokeWidth={1.75} /></span>
    <p class="t">{t("compose.drop")}</p>
    <p class="s">{t("compose.drop.limit")}</p>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgb(5 7 10 / 0.84);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      visibility 0s linear var(--dur-fast);
  }
  .open {
    opacity: 1;
    visibility: visible;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .frame {
    position: absolute;
    inset: 16px;
    width: calc(100% - 32px);
    height: calc(100% - 32px);
    overflow: visible;
    fill: rgb(16 42 35 / 0.32);
    stroke: var(--accent);
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-dasharray: 83.33 100;
    transition: stroke-dasharray 520ms var(--ease-out);
  }
  .open .frame {
    stroke-dasharray: 96 100;
  }
  .say {
    position: relative;
    display: grid;
    justify-items: center;
    gap: var(--sp-3);
    text-align: center;
    transform: scale(0.95);
    transition: transform 600ms var(--ease-settle);
  }
  .open .say {
    transform: none;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 72px;
    height: 72px;
    margin-bottom: var(--sp-2);
    border-radius: 22px;
    background: var(--accent);
    color: var(--on-accent);
    box-shadow:
      0 0 0 10px rgb(95 227 181 / 0.12),
      0 0 0 22px rgb(95 227 181 / 0.05);
  }
  @media (prefers-reduced-motion: no-preference) {
    .open .mark {
      animation: hover-up 1.2s var(--ease-in-out) infinite alternate;
    }
  }
  @keyframes hover-up {
    to {
      transform: translateY(-8px);
    }
  }
  .t {
    margin: 0;
    font-size: clamp(2rem, 1.2rem + 3vw, 3.5rem);
    line-height: 1.05;
    font-weight: 640;
    font-stretch: 110%;
    letter-spacing: -0.025em;
  }
  .s {
    margin: 0;
    color: var(--text-2);
  }
  @media (prefers-reduced-motion: reduce) {
    .overlay,
    .frame,
    .say {
      transition: none;
    }
    .say {
      transform: none;
    }
  }
  @media (forced-colors: active) {
    .overlay {
      background: Canvas;
    }
    .frame {
      stroke: Highlight;
      fill: none;
    }
    .mark {
      background: Highlight;
      color: HighlightText;
      box-shadow: none;
    }
  }
</style>
