<script lang="ts">
  // Interrupteur (role="switch") : un vrai bouton, nommé par son libellé, décrit par sa ligne
  // d'aide. Pas une case à cocher (aucune case sur l'écran d'envoi, benchmark M1).
  // `disabled` : non cliquable (bouton désactivé) ; `reason` : id de l'élément qui dit pourquoi.
  type Props = { label: string; hint?: string; checked: boolean; onchange: (v: boolean) => void; sub?: boolean; disabled?: boolean; reason?: string };
  let { label, hint, checked, onchange, sub = false, disabled = false, reason }: Props = $props();
  const uid = $props.id();
</script>

<div class={["sw", { sub }]}>
  <button
    type="button"
    role="switch"
    class="tg"
    aria-checked={checked}
    aria-labelledby="{uid}-l"
    aria-describedby={[hint ? `${uid}-h` : "", disabled && reason ? reason : ""].filter(Boolean).join(" ") || undefined}
    {disabled}
    onclick={() => onchange(!checked)}
  >
    <span class="txt">
      <span class="l" id="{uid}-l">{label}</span>
      {#if hint}<span class="h" id="{uid}-h">{hint}</span>{/if}
    </span>
    <span class="track" aria-hidden="true"><span class="knob"></span></span>
  </button>
</div>

<style>
  .tg {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--sp-3);
    width: 100%;
    min-height: 52px;
    padding: 10px 14px;
    border: 0;
    border-radius: 14px;
    background: rgb(255 255 255 / 0.035);
    box-shadow: inset 0 0 0 1px var(--hair);
    color: var(--text);
    font: inherit;
    text-align: start;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      transform var(--dur-press) var(--ease-out);
  }
  .tg:active {
    transform: scale(0.985);
  }
  .tg:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .tg:disabled:active {
    transform: none;
  }
  .sub .tg {
    min-height: 48px;
    background: transparent;
    box-shadow: none;
    padding-inline: 14px 14px;
  }
  .txt {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .l {
    font-weight: 600;
    font-size: 0.9375rem;
    line-height: 1.35;
  }
  .sub .l {
    font-weight: 500;
    font-size: var(--fs-small);
    color: var(--text-2);
  }
  .h {
    color: var(--text-2);
    font-size: var(--fs-small);
    line-height: 1.4;
  }
  .track {
    position: relative;
    width: 44px;
    height: 26px;
    border-radius: 13px;
    background: rgb(233 236 242 / 0.18);
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--text);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
    transition: transform 240ms var(--ease-settle);
  }
  [aria-checked="true"] .track {
    background: var(--accent);
  }
  [aria-checked="true"] .knob {
    transform: translateX(18px);
    background: var(--on-accent);
  }
  @media (prefers-reduced-motion: reduce) {
    .tg,
    .knob,
    .track {
      transition: none;
    }
    .tg:active {
      transform: none;
    }
  }
  @media (forced-colors: active) {
    .track {
      border: 1px solid ButtonText;
    }
    [aria-checked="true"] .track {
      background: Highlight;
      forced-color-adjust: none;
    }
  }
</style>
