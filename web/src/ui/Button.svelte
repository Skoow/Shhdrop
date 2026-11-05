<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  type Props = Omit<HTMLButtonAttributes, "onclick" | "children" | "type" | "disabled" | "class"> & {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    /** 44 px au lieu de 48 px. */
    dense?: boolean;
    /** Chargement imposé de l'extérieur (en plus de celui d'un `onpress` en cours). */
    busy?: boolean;
    disabled?: boolean;
    type?: "button" | "submit";
    /**
     * Appelé au plus une fois à la fois : le bouton se verrouille de façon synchrone, avant tout
     * `await`, jusqu'à la fin de la promesse. `onpress` gère ses propres erreurs (un rejet est ici
     * absorbé : il ne sert qu'à libérer le bouton).
     */
    onpress?: () => void | Promise<void>;
    icon?: Snippet;
    children: Snippet;
    el?: HTMLButtonElement | undefined;
  };
  let {
    variant = "primary",
    dense = false,
    busy = false,
    disabled = false,
    type = "button",
    onpress,
    icon,
    children,
    el = $bindable(),
    ...rest
  }: Props = $props();

  // Garde de ré-entrée : variable ordinaire, lue et écrite de façon synchrone (un $state ne
  // serait répercuté dans le DOM qu'au micro-cycle suivant, trop tard pour un double clic).
  let running = false;
  let pending = $state(false);
  const loading = $derived(busy || pending);

  function click(e: MouseEvent) {
    if (disabled || loading || running) {
      e.preventDefault();
      return;
    }
    if (!onpress) return;
    running = true;
    pending = true;
    const release = () => {
      running = false;
      pending = false;
    };
    let result: void | Promise<void>;
    try {
      result = onpress();
    } catch {
      release();
      return;
    }
    Promise.resolve(result).catch(() => undefined).finally(release);
  }
</script>

<button
  bind:this={el}
  {...rest}
  {type}
  {disabled}
  class={["btn", variant, { dense }]}
  aria-busy={loading ? "true" : undefined}
  aria-disabled={loading ? "true" : undefined}
  onclick={click}
>
  {#if loading}
    <span class="spin" aria-hidden="true"></span>
  {:else if icon}
    <span class="ic" aria-hidden="true">{@render icon()}</span>
  {/if}
  <span class="label">{@render children()}</span>
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-2);
    min-height: 48px;
    min-width: 44px;
    padding: 0 var(--sp-5);
    border: 1px solid transparent;
    border-radius: var(--r-md);
    font: inherit;
    font-weight: 600;
    line-height: 1.2;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-instant) var(--ease-out);
  }
  .dense {
    min-height: 44px;
    padding: 0 var(--sp-4);
  }
  .btn:active:not(:disabled, [aria-disabled="true"]) {
    transform: scale(0.98);
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
  }
  .secondary {
    background: var(--surface-3);
    color: var(--text);
    border-color: var(--line-strong);
  }
  .ghost {
    background: transparent;
    color: var(--text);
  }
  .danger {
    background: var(--danger);
    color: var(--on-danger);
  }
  @media (hover: hover) {
    .primary:hover:not(:disabled, [aria-disabled="true"]) {
      background: var(--accent-hover);
    }
    .secondary:hover:not(:disabled, [aria-disabled="true"]) {
      background: var(--surface-2);
    }
    .ghost:hover:not(:disabled, [aria-disabled="true"]) {
      background: var(--surface-2);
    }
    .danger:hover:not(:disabled, [aria-disabled="true"]) {
      filter: brightness(1.08);
    }
  }
  .btn:disabled {
    cursor: not-allowed;
    background: var(--surface-2);
    color: var(--text-disabled);
    border-color: transparent;
  }
  .btn[aria-disabled="true"] {
    cursor: progress;
  }
  .ic {
    display: inline-flex;
  }
  .spin {
    width: 16px;
    height: 16px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
    .btn {
      transition: none;
    }
    .btn:active:not(:disabled, [aria-disabled="true"]) {
      transform: none;
    }
  }
  @media (forced-colors: active) {
    .btn {
      border-color: ButtonText;
    }
    .btn:disabled {
      border-color: GrayText;
    }
  }
</style>
