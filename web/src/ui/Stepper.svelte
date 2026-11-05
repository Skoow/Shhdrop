<script lang="ts">
  import { t } from "../i18n/i18n.svelte";

  type Props = { label: string; value: number; min?: number; max?: number };
  let { label, value = $bindable(), min = 1, max = 10 }: Props = $props();

  const atMin = $derived(value <= min);
  const atMax = $derived(value >= max);
  // aria-disabled (pas disabled) : le focus reste sur le bouton quand on atteint la borne.
  function step(delta: number) {
    value = Math.min(max, Math.max(min, value + delta));
  }
</script>

<div class="stepper" role="group" aria-label={label}>
  <button type="button" class="b" aria-label={t("stepper.dec")} aria-disabled={atMin} onclick={() => step(-1)}>
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M5 12h14" /></svg>
  </button>
  <span class="value num" aria-live="polite" aria-atomic="true">{value}</span>
  <button type="button" class="b" aria-label={t("stepper.inc")} aria-disabled={atMax} onclick={() => step(1)}>
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M5 12h14M12 5v14" /></svg>
  </button>
</div>

<style>
  .stepper {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .b {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    background: var(--surface-3);
    color: var(--text);
    cursor: pointer;
    touch-action: manipulation;
  }
  .b svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
  }
  .b[aria-disabled="true"] {
    color: var(--text-disabled);
    background: var(--surface-2);
    cursor: not-allowed;
  }
  @media (hover: hover) {
    .b:hover:not([aria-disabled="true"]) {
      background: var(--surface-2);
    }
  }
  .value {
    min-width: 3ch;
    text-align: center;
    font-size: var(--fs-h3);
    font-weight: 600;
  }
  @media (forced-colors: active) {
    .b[aria-disabled="true"] {
      border-color: GrayText;
    }
  }
</style>
