<script lang="ts">
  // Petite confirmation du nettoyage (retours du propriétaire du 12 novembre) : ouverte par le
  // balai d'une ligne ou par « Tout nettoyer », posée près du bouton (couche supérieure, rien ne
  // la rogne). Elle dit ce que le nettoyage retire ; rien n'est nettoyé avant « Nettoyer ».
  // Non modale : Échap, « Annuler » ou un appui ailleurs la ferment, le focus revient au bouton.
  // Le focus qui la quitte par Tab (au-delà de « Nettoyer ») ou Maj+Tab la ferme aussi :
  // jamais de dialogue affiché loin du focus (audit D4) ; le focus reste où il est allé.
  import { tick } from "svelte";
  import { t } from "../i18n/i18n.svelte";
  import Broom from "./icons/Broom.svelte";

  type Props = {
    /** Bouton qui l'a ouverte (position, retour du focus) ; null : fermée. */
    anchor: HTMLElement | null;
    title: string;
    body: string;
    onconfirm: () => void;
    onclose: () => void;
  };
  let { anchor, title, body, onconfirm, onclose }: Props = $props();

  const uid = $props.id();
  let box: HTMLDivElement | undefined = $state();
  let cancelBtn: HTMLButtonElement | undefined = $state();

  function place() {
    if (!anchor || !box) return;
    const r = anchor.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const m = 8;
    const left = Math.max(m, Math.min(r.right - b.width, window.innerWidth - b.width - m));
    const below = r.bottom + m;
    const top = below + b.height <= window.innerHeight - m ? below : Math.max(m, r.top - b.height - m);
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }

  $effect(() => {
    const el = box;
    if (!el || !anchor) return;
    if (typeof el.showPopover === "function" && !el.matches(":popover-open")) el.showPopover();
    place();
    void tick().then(() => cancelBtn?.focus());
    return () => {
      if (typeof el.hidePopover === "function" && el.matches(":popover-open")) el.hidePopover();
    };
  });

  function close(refocus = true) {
    const a = anchor;
    onclose();
    if (refocus && a?.isConnected) void tick().then(() => a.focus());
  }
  // Validation : le parent place le focus (le balai disparaît pendant le nettoyage).
  function confirm() {
    onconfirm();
    onclose();
  }
  function outside(e: PointerEvent) {
    if (!anchor || !box) return;
    const n = e.target as Node;
    if (!box.contains(n) && !anchor.contains(n)) close(false);
  }
  // Seul Tab (ou Maj+Tab) qui sort de la bulle la ferme : un focus déplacé par programme (la
  // feuille « … » qui se referme et rend le focus à son bouton, téléphone) ne la ferme pas.
  let tabbing = false;
  function left(e: FocusEvent) {
    if (!anchor || !box || !tabbing) return;
    const n = e.relatedTarget as Node | null;
    if (n && (box.contains(n) || anchor.contains(n))) return;
    close(false);
  }
  function key(e: KeyboardEvent) {
    if (e.key === "Tab") {
      tabbing = true;
      setTimeout(() => (tabbing = false));
    }
    if (anchor && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }
</script>

<svelte:document onpointerdown={outside} />
<svelte:window onresize={() => anchor && place()} onscroll={() => anchor && place()} />

{#if anchor}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div bind:this={box} class="cc" role="dialog" tabindex="-1" aria-labelledby="{uid}-t" aria-describedby="{uid}-b" popover="manual" onkeydown={key} onfocusout={left} data-clean-confirm>
    <p class="t" id="{uid}-t"><Broom size={18} strokeWidth={1.9} />{title}</p>
    <p class="b" id="{uid}-b">{body}</p>
    <div class="acts">
      <button type="button" class="btn ghost" bind:this={cancelBtn} onclick={() => close()}>{t("common.cancel")}</button>
      <button type="button" class="btn go" onclick={confirm}>{t("clean.confirm.go")}</button>
    </div>
  </div>
{/if}

<style>
  .cc {
    position: fixed;
    inset: auto;
    margin: 0;
    z-index: 61;
    display: grid;
    gap: 8px;
    inline-size: min(340px, calc(100vw - 16px));
    padding: 14px 14px 12px;
    border: 1px solid var(--hair-2);
    border-radius: 14px;
    background: var(--surface-3);
    color: var(--text);
    box-shadow: 0 16px 40px rgb(0 0 0 / 0.5);
    text-align: start;
  }
  .t {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-weight: 650;
  }
  .t :global(svg) {
    flex: none;
    color: var(--accent);
  }
  .b {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
    line-height: 1.5;
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
  .btn {
    min-height: 44px;
    padding: 0 16px;
    border: 0;
    border-radius: 10px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .ghost {
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--hair-2);
    color: var(--text);
  }
  .go {
    background: var(--accent);
    color: var(--ink);
  }
  .btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  @media (hover: hover) {
    .ghost:hover {
      background: rgb(255 255 255 / 0.06);
    }
    .go:hover {
      filter: brightness(1.08);
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .cc {
      animation: cc-in 160ms var(--ease-out) both;
    }
  }
  @keyframes cc-in {
    from {
      opacity: 0;
      translate: 0 -4px;
    }
  }
  @media (forced-colors: active) {
    .cc {
      border-color: CanvasText;
    }
    .btn {
      border: 1px solid ButtonText;
    }
  }
</style>
