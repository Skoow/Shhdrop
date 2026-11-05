<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  type Props = Omit<HTMLButtonAttributes, "onclick" | "children" | "type" | "class" | "aria-label"> & {
    /** Nom accessible, obligatoire : un bouton à icône seule n'a pas d'autre texte. */
    label: string;
    variant?: "ghost" | "secondary" | "danger";
    onpress?: () => void;
    children: Snippet;
    el?: HTMLButtonElement | undefined;
  };
  let { label, variant = "ghost", onpress, children, el = $bindable(), ...rest }: Props = $props();
</script>

<button bind:this={el} {...rest} type="button" class={["ib", variant]} aria-label={label} onclick={() => onpress?.()}>
  <span aria-hidden="true" class="ic">{@render children()}</span>
</button>

<style>
  .ib {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 10px;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-press) var(--ease-out);
  }
  .ic {
    display: inline-flex;
  }
  .secondary {
    background: rgb(255 255 255 / 0.045);
    color: var(--text);
    border-color: var(--hair-2);
  }
  .danger {
    color: var(--danger);
  }
  @media (hover: hover) {
    .ib:hover:not(:disabled) {
      background: rgb(255 255 255 / 0.06);
      color: var(--text);
    }
  }
  /* Pression : 0,92 (motion.ts, iconPressScale). */
  .ib:active:not(:disabled) {
    background: rgb(255 255 255 / 0.06);
    transform: scale(0.92);
  }
  .ib:disabled {
    color: var(--text-disabled);
    cursor: not-allowed;
  }
  @media (prefers-reduced-motion: reduce) {
    .ib {
      transition: none;
    }
    .ib:active:not(:disabled) {
      transform: none;
    }
  }
  @media (forced-colors: active) {
    .ib {
      border-color: ButtonText;
    }
    .ib:disabled {
      border-color: GrayText;
    }
  }
</style>
