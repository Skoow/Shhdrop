<script lang="ts">
  // Cadenas d'état d'un élément (D41-25), icône maison : gris (en cours, encore chiffré), vert
  // avec coche (confirmé), rouge avec « ! » (échec). Le texte n'est plus écrit sur la ligne
  // (retours UI4) : il est le nom du bouton et le contenu de sa bulle (Tip) ; la couleur n'est
  // donc jamais la seule information. Le vert n'arrive qu'à l'événement réel (lock.ts).
  import type { Snippet } from "svelte";
  import type { LockTone } from "./lock";
  import Tip from "./Tip.svelte";

  type Props = { tone: LockTone; text: string; role?: "alert"; children?: Snippet };
  let { tone, text, role, children }: Props = $props();
</script>

<span class={["lock", tone]} data-lock={tone}>
  <Tip label={text} tip={text}>
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
    <path class="sh" d="M5 7.2V5.1a3 3 0 0 1 6 0v2.1" />
    <rect class="body" x="2.75" y="7" width="10.5" height="7.25" rx="2.2" />
    {#if tone === "ok"}
      <path class="mark" d="M5.7 10.7l1.6 1.5 3-3.1" />
    {:else if tone === "error"}
      <path class="mark" d="M8 9.1v1.9" /><circle class="dot" cx="8" cy="12.65" r="0.85" />
    {:else}
      <circle class="dot" cx="8" cy="10.6" r="1.05" />
    {/if}
  </svg>
  </Tip>
  {#if role === "alert"}<span class="sr-only" role="alert">{text}</span>{/if}
  {@render children?.()}
</span>

<style>
  .lock {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-2);
  }
  svg {
    flex: none;
    overflow: visible;
  }
  .sh,
  .mark {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .body {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
  }
  .dot {
    fill: currentColor;
  }
  .ok {
    color: var(--accent);
  }
  .error {
    color: var(--danger);
  }
  /* Plein : le cadenas fermé se lit d'un coup d'œil ; la marque se détache en creux. */
  .ok .body,
  .error .body {
    fill: currentColor;
  }
  .ok .mark,
  .error .mark {
    stroke: var(--bg);
    stroke-width: 1.7;
  }
  .error .dot {
    fill: var(--bg);
  }
  @media (prefers-reduced-motion: no-preference) {
    /* Un seul moment : l'anse se referme et la coche se trace quand la confirmation arrive. */
    .ok .sh {
      animation: lock-close var(--dur-slow) var(--ease-out) both;
    }
    .ok .mark {
      stroke-dasharray: 8;
      animation: lock-tick var(--dur-slow) var(--ease-out) 120ms both;
    }
  }
  @keyframes lock-close {
    from {
      transform: translateY(-1.6px);
    }
  }
  @keyframes lock-tick {
    from {
      stroke-dashoffset: 8;
    }
  }
  @media (forced-colors: active) {
    .lock {
      color: CanvasText;
    }
    .ok .mark,
    .error .mark {
      stroke: Canvas;
    }
  }
</style>
