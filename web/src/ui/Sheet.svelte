<script lang="ts">
  import type { Snippet } from "svelte";
  import { t } from "../i18n/i18n.svelte";
  import { X } from "./Icon";
  import IconButton from "./IconButton.svelte";

  type Props = {
    open: boolean;
    title: string;
    children: Snippet;
    /** Appelé à chaque fermeture (Échap, croix, fond, ou `open` repassé à faux). */
    onclose?: () => void;
  };
  let { open = $bindable(false), title, children, onclose }: Props = $props();

  const uid = $props.id();
  let dlg: HTMLDialogElement | undefined = $state();
  let opener: Element | null = null;

  // <dialog> natif : showModal() fournit l'inertie du reste de la page, le piège à focus et Échap.
  $effect(() => {
    if (!dlg) return;
    if (open && !dlg.open) {
      opener = document.activeElement;
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  });

  // Seul point de sortie (Échap, close(), croix) : le focus retourne au déclencheur.
  function closed() {
    const was = open;
    open = false;
    const back = opener;
    opener = null;
    if (back instanceof HTMLElement && back.isConnected) back.focus();
    if (was || back) onclose?.();
  }

  function backdrop(e: MouseEvent) {
    // Le fond (::backdrop) compte comme un clic sur le <dialog> lui-même, hors de son cadre.
    if (e.target !== dlg || !dlg) return;
    const r = dlg.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) dlg.close();
  }
</script>

<dialog bind:this={dlg} class="sheet" aria-labelledby="{uid}-t" onclose={closed} onclick={backdrop}>
  {#if open}
    <div class="head">
      <h2 id="{uid}-t">{title}</h2>
      <IconButton label={t("common.close")} onpress={() => dlg?.close()}>
        <X size={20} strokeWidth={1.75} />
      </IconButton>
    </div>
    <div class="body">{@render children()}</div>
  {/if}
</dialog>

<style>
  .sheet {
    box-sizing: border-box;
    width: min(32rem, 100vw);
    max-width: 100vw;
    max-height: 90dvh;
    margin: auto;
    padding: var(--sp-5);
    border: 1px solid var(--line);
    border-radius: var(--r-xl);
    background: var(--surface-2);
    color: var(--text);
    box-shadow: var(--e-3), var(--edge);
    overflow: auto;
    overscroll-behavior: contain;
  }
  /* UI §5.4 : scrim + flou de 8 px ; repli en surface pleine. */
  .sheet::backdrop {
    background: var(--scrim);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .sheet::backdrop {
      background: var(--surface-1);
    }
  }
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    .sheet::backdrop {
      background: var(--surface-1);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
  }
  .sheet[open] {
    animation: sheet-in var(--dur-slow) var(--ease-out);
  }
  .sheet[open]::backdrop {
    animation: fade var(--dur-slow) var(--ease-out);
  }
  /* Téléphone : feuille ancrée en bas, qui monte depuis le bord (UI §20.4, courbe sans rebond). */
  @media (max-width: 899px) {
    .sheet {
      margin: auto 0 0;
      width: 100%;
      padding-top: var(--sp-5);
      border-end-start-radius: 0;
      border-end-end-radius: 0;
      border-inline: 0;
      border-bottom: 0;
      padding-bottom: calc(var(--sp-5) + env(safe-area-inset-bottom, 0px));
      padding-inline: max(var(--sp-5), env(safe-area-inset-left, 0px)) max(var(--sp-5), env(safe-area-inset-right, 0px));
    }
    /* Poignée : repère visuel d'une feuille, comme une app. */
    .sheet::before {
      content: "";
      position: absolute;
      top: 8px;
      left: 50%;
      width: 36px;
      height: 4px;
      margin-left: -18px;
      border-radius: 2px;
      background: rgb(233 236 242 / 0.22);
    }
    .sheet[open] {
      animation: sheet-up 340ms var(--ease-view);
    }
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    margin-bottom: var(--sp-4);
  }
  .head h2 {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* Fermer : toujours en haut à droite, 44 × 44 px même sous un titre long. */
  .head > :global(button) {
    flex-shrink: 0;
    align-self: flex-start;
  }
  @keyframes sheet-in {
    from {
      opacity: 0;
      transform: translateY(16px);
    }
  }
  @keyframes sheet-up {
    from {
      transform: translateY(100%);
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sheet[open],
    .sheet[open]::backdrop {
      animation: fade var(--dur-instant) linear;
    }
  }
  @media (forced-colors: active) {
    .sheet {
      border-color: CanvasText;
    }
  }
</style>
