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
     * `await`, jusqu'à la fin de la promesse. Pendant ce temps : `aria-disabled` + `aria-busy`
     * (pas `disabled`, pour garder le focus). Un rejet ou une exception de `onpress` est ABSORBÉ
     * ici (il ne sert qu'à libérer le bouton) : chaque écran gère ses propres erreurs.
     */
    onpress?: () => void | Promise<void>;
    icon?: Snippet;
    /**
     * Cadenas en deux tracés (UI §20.4, « Chiffrer et envoyer ») : l'anse ouverte laisse place à
     * l'anse fermée au survol et au focus. Ignoré si `icon` est fourni.
     */
    lock?: boolean;
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
    lock = false,
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
  {:else if lock}
    <svg class="lk" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path class="lk-open" d="M7 11V7a5 5 0 0 1 9.9-1" />
      <path class="lk-closed" d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  {/if}
  <span class="label">{@render children()}</span>
</button>

<style>
  .btn {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-2);
    min-height: 48px;
    min-width: 44px;
    padding: 0 20px;
    border: 1px solid transparent;
    /* UI §20.3 : 12 px à 48 px de haut, 10 px à 44 px. */
    border-radius: 12px;
    font: inherit;
    font-size: 0.9375rem;
    font-weight: 560;
    letter-spacing: 0.005em;
    line-height: 1.2;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-press) var(--ease-out);
  }
  .dense {
    min-height: 44px;
    padding: 0 14px;
    border-radius: 10px;
    font-size: var(--fs-small);
  }
  /* Pression : 0,97 (motion.ts, pressScale). */
  .btn:active:not(:disabled, [aria-disabled="true"]) {
    transform: scale(0.97);
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.4),
      inset 0 -1px 0 rgb(0 0 0 / 0.14),
      0 10px 24px -14px rgb(0 0 0 / 0.9);
  }
  /* Reflet : une bande claire traverse le bouton principal une fois au survol (transform seulement). */
  .primary::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    background: linear-gradient(100deg, transparent 30%, rgb(255 255 255 / 0.45) 50%, transparent 70%);
    transform: translateX(-120%);
    pointer-events: none;
  }
  .secondary {
    background: rgb(255 255 255 / 0.045);
    color: var(--text);
    border-color: var(--hair-2);
    box-shadow: var(--edge-hi);
  }
  .ghost {
    background: transparent;
    color: var(--text);
  }
  .danger {
    background: var(--danger);
    color: var(--on-danger);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.35);
  }
  @media (hover: hover) {
    .primary:hover:not(:disabled, [aria-disabled="true"]) {
      background: var(--accent-hover);
    }
    .primary:hover:not(:disabled, [aria-disabled="true"])::after {
      transform: translateX(120%);
      transition: transform 760ms var(--ease-out);
    }
    .secondary:hover:not(:disabled, [aria-disabled="true"]) {
      background: rgb(255 255 255 / 0.08);
      border-color: rgb(233 236 242 / 0.2);
    }
    .ghost:hover:not(:disabled, [aria-disabled="true"]) {
      background: rgb(255 255 255 / 0.05);
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
    box-shadow: none;
  }
  .btn:disabled::after {
    display: none;
  }
  .btn[aria-disabled="true"] {
    cursor: progress;
  }
  .ic {
    display: inline-flex;
  }
  .lk {
    flex: none;
  }
  /* Cadenas : l'anse ouverte disparaît, l'anse fermée descend de 3 px (220 ms). */
  .lk-open,
  .lk-closed {
    transition:
      opacity var(--dur-fast) var(--ease-out),
      transform 220ms var(--ease-out);
  }
  .lk-closed {
    opacity: 0;
    transform: translateY(-3px);
  }
  @media (hover: hover) {
    .btn:hover .lk-open {
      opacity: 0;
      transform: translateY(-2px);
    }
    .btn:hover .lk-closed {
      opacity: 1;
      transform: none;
    }
  }
  .btn:focus-visible .lk-open {
    opacity: 0;
    transform: translateY(-2px);
  }
  .btn:focus-visible .lk-closed {
    opacity: 1;
    transform: none;
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
      transition:
        background-color var(--dur-fast) var(--ease-out),
        color var(--dur-fast) var(--ease-out);
    }
    .btn:active:not(:disabled, [aria-disabled="true"]) {
      transform: none;
    }
    .primary::after {
      display: none;
    }
    .lk-open,
    .lk-closed {
      transform: none !important;
    }
  }
  @media (forced-colors: active) {
    .btn {
      border-color: ButtonText;
    }
    .btn:disabled {
      border-color: GrayText;
    }
    .primary::after {
      display: none;
    }
  }
</style>
