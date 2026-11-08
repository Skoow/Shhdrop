<script lang="ts">
  // Marque à bulle (retours UI4) : le libellé d'un état n'est plus écrit sur la ligne ; il
  // s'affiche dans une bulle au survol (souris), au focus clavier, ou à l'appui (tactile,
  // bascule). Fermeture : appui ailleurs, Échap, défilement. Accessible : bouton nommé
  // (`label`), bulle `role="tooltip"` liée par `aria-describedby` (lue même cachée).
  // La bulle passe dans la couche supérieure (popover) : aucun parent ne peut la rogner.
  import type { Snippet } from "svelte";
  import type { ClassValue } from "svelte/elements";

  type Props = { label: string; tip: string; class?: ClassValue; children: Snippet; [data: `data-${string}`]: string | undefined };
  let { label, tip, class: cls, children, ...rest }: Props = $props();

  const id = $props.id();
  let btn: HTMLButtonElement | undefined = $state();
  let bubble: HTMLSpanElement | undefined = $state();
  let pinned = $state(false); // ouverte par un appui (tactile) ou un clic
  let hover = $state(false);
  let focused = $state(false);
  const open = $derived(pinned || hover || focused);

  // Position fixe calculée à l'ouverture : au-dessus du bouton, sinon dessous ; jamais hors écran.
  function place() {
    if (!btn || !bubble) return;
    const r = btn.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const m = 8;
    const left = Math.max(m, Math.min(r.left + r.width / 2 - b.width / 2, window.innerWidth - b.width - m));
    const above = r.top - b.height - m;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${above >= m ? above : r.bottom + m}px`;
    bubble.dataset.side = above >= m ? "top" : "bottom";
    bubble.style.setProperty("--ax", `${r.left + r.width / 2 - left}px`);
  }

  $effect(() => {
    const el = bubble;
    if (!el) return;
    const pop = typeof el.showPopover === "function";
    if (open) {
      if (pop && !el.matches(":popover-open")) el.showPopover();
      el.hidden = false;
      place();
    } else {
      if (pop && el.matches(":popover-open")) el.hidePopover();
      el.hidden = true;
    }
  });

  function close() {
    pinned = false;
    hover = false;
    focused = false;
  }
  function outside(e: PointerEvent) {
    if (pinned && btn && !btn.contains(e.target as Node)) pinned = false;
  }
  function key(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      close();
    }
  }
</script>

<svelte:document onpointerdown={outside} onkeydown={key} />
<svelte:window onscroll={() => open && close()} onresize={() => open && close()} />

<button
  bind:this={btn}
  type="button"
  class={["tip", cls]}
  aria-label={label}
  aria-describedby={id}
  {...rest}
  onclick={() => (pinned = !pinned)}
  onpointerenter={(e) => {
    if (e.pointerType === "mouse") hover = true;
  }}
  onpointerleave={(e) => {
    if (e.pointerType === "mouse") hover = false;
  }}
  onfocus={() => (focused = btn?.matches(":focus-visible") ?? false)}
  onblur={() => {
    focused = false;
    pinned = false;
  }}
>
  {@render children()}
</button>
<span bind:this={bubble} {id} role="tooltip" class="bubble" popover="manual" hidden>{tip}</span>

<style>
  /* Cible de 44 px (règle du projet) sans changer la ligne : marges négatives. Les pastilles
     (ItemNotes) gardent leur propre boîte. */
  .tip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-block-size: 44px;
    min-inline-size: 44px;
    margin: -14px -13px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: none;
    color: inherit;
    font: inherit;
    cursor: help;
    -webkit-tap-highlight-color: transparent;
  }
  .tip:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .bubble {
    position: fixed;
    inset: auto;
    margin: 0;
    z-index: 60;
    max-inline-size: min(280px, calc(100vw - 16px));
    padding: 7px 11px;
    border: 1px solid var(--hair-2);
    border-radius: 10px;
    background: var(--surface-3);
    color: var(--text);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.42);
    font-size: var(--fs-micro);
    font-weight: 520;
    line-height: 1.45;
    text-align: start;
    overflow: visible;
    pointer-events: none;
  }
  .bubble[hidden] {
    display: none;
  }
  /* Pointe vers le bouton. */
  .bubble::after {
    content: "";
    position: absolute;
    inset-inline-start: calc(var(--ax, 50%) - 5px);
    inset-block-end: -5px;
    inline-size: 9px;
    block-size: 9px;
    background: inherit;
    border: inherit;
    border-block-start: 0;
    border-inline-start: 0;
    rotate: 45deg;
  }
  .bubble[data-side="bottom"]::after {
    inset-block: -5px auto;
    rotate: -135deg;
  }
  @media (prefers-reduced-motion: no-preference) {
    .bubble:not([hidden]) {
      animation: tip-in 140ms var(--ease-out) both;
    }
  }
  @keyframes tip-in {
    from {
      opacity: 0;
      translate: 0 3px;
    }
  }
  @media (forced-colors: active) {
    .bubble {
      border-color: CanvasText;
    }
  }
</style>
