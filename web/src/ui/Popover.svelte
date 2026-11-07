<script lang="ts">
  // Menu ancré (ordinateur, scan UX : le menu « … » d'un élément n'est plus une fenêtre modale).
  // API Popover native (`popover="auto"`) : couche supérieure, Échap et clic dehors ferment ;
  // placé sous le déclencheur (au-dessus s'il manque de place), dans la fenêtre, et le suit. Position par
  // CSSOM seulement (aucun attribut style, CSP). Le focus va au premier bouton, puis revient
  // au déclencheur à la fermeture.
  import type { Snippet } from "svelte";

  type Props = {
    open: boolean;
    /** Élément auquel le menu s'accroche (le bouton « … »). */
    anchor: HTMLElement | null;
    title: string;
    children: Snippet;
  };
  let { open = $bindable(false), anchor, title, children }: Props = $props();

  const uid = $props.id();
  let pop: HTMLDivElement | undefined = $state();
  const GAP = 6;
  const MARGIN = 8;

  function place() {
    if (!pop || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    // Bord droit sur celui du déclencheur ; sinon bord gauche sur le sien.
    let left = a.right - w >= MARGIN ? a.right - w : a.left;
    left = Math.max(MARGIN, Math.min(left, innerWidth - w - MARGIN));
    let top = a.bottom + GAP;
    if (top + h > innerHeight - MARGIN && a.top - GAP - h >= MARGIN) top = a.top - GAP - h;
    top = Math.max(MARGIN, Math.min(top, innerHeight - h - MARGIN));
    pop.style.setProperty("left", `${Math.round(left)}px`);
    pop.style.setProperty("top", `${Math.round(top)}px`);
  }

  $effect(() => {
    if (!pop) return;
    if (open && !pop.matches(":popover-open")) {
      pop.showPopover();
      place();
      pop.querySelector<HTMLElement>("button, input")?.focus();
    } else if (!open && pop.matches(":popover-open")) pop.hidePopover();
  });

  // Tant qu'il est ouvert, il suit son déclencheur (défilement, « Monter », renommage) : une
  // lecture de deux rectangles par image, seulement pendant l'ouverture.
  $effect(() => {
    if (!open) return;
    let raf = requestAnimationFrame(function follow() {
      place();
      raf = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(raf);
  });

  function toggled(e: ToggleEvent) {
    if (e.newState !== "closed") return;
    const back = anchor;
    const inside = pop?.contains(document.activeElement) || document.activeElement === document.body;
    open = false;
    if (inside && back?.isConnected) back.focus();
  }
</script>

<div bind:this={pop} class="pop" popover="auto" role="dialog" aria-labelledby="{uid}-t" ontoggle={toggled}>
  {#if open}
    <p id="{uid}-t" class="pt" translate="no">{title}</p>
    {@render children()}
  {/if}
</div>

<style>
  .pop {
    position: fixed;
    inset: auto;
    box-sizing: border-box;
    width: max-content;
    min-width: 14rem;
    max-width: min(22rem, calc(100vw - 16px));
    margin: 0;
    padding: var(--sp-2);
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--surface-2);
    color: var(--text);
    box-shadow: var(--e-2), var(--edge);
  }
  .pop:popover-open {
    animation: pop-in var(--dur-fast) var(--ease-out);
  }
  .pt {
    margin: 0;
    padding: var(--sp-1) var(--sp-3) var(--sp-2);
    overflow: hidden;
    color: var(--text-2);
    font-size: var(--fs-small);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @keyframes pop-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pop:popover-open {
      animation: none;
    }
  }
  @media (forced-colors: active) {
    .pop {
      border-color: CanvasText;
    }
  }
</style>
