<script lang="ts" module>
  // Une seule annonce à la fois : une nouvelle fait fermer la précédente (son parent la retire).
  let current: (() => void) | null = null;
</script>

<script lang="ts">
  import { t } from "../i18n/i18n.svelte";
  import Button from "./Button.svelte";

  type Props = {
    message: string;
    /** « Annuler » pressé : le parent remet l'élément à sa place. */
    onundo: () => void;
    /** Fin de vie sans annulation (6 s écoulées, Échap, ou remplacement par une autre annonce). */
    ondismiss: () => void;
    durationMs?: number;
  };
  let { message, onundo, ondismiss, durationMs = 6000 }: Props = $props();

  let done = false;
  function finish(undo: boolean) {
    if (done) return;
    done = true;
    if (current === dismissSelf) current = null;
    (undo ? onundo : ondismiss)();
  }
  const dismissSelf = () => finish(false);

  $effect(() => {
    if (current && current !== dismissSelf) current();
    current = dismissSelf;
    const timer = setTimeout(dismissSelf, durationMs);
    return () => {
      clearTimeout(timer);
      if (current === dismissSelf) current = null;
    };
  });

  function key(e: KeyboardEvent) {
    // Échap appartient d'abord à une feuille ouverte ou à un autre gestionnaire.
    if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
    dismissSelf();
  }
</script>

<svelte:window onkeydown={key} />

<div class="toast" role="status">
  <span class="msg">{message}</span>
  <Button variant="ghost" dense onpress={() => finish(true)}>{t("common.undo")}</Button>
</div>

<style>
  .toast {
    position: fixed;
    inset-inline: var(--sp-4);
    inset-block-end: calc(var(--sp-4) + env(safe-area-inset-bottom, 0px));
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    max-width: 28rem;
    margin-inline: auto;
    padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-4);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-lg);
    background: var(--surface-3);
    color: var(--text);
    box-shadow: var(--e-2), var(--edge);
    animation: in var(--dur-base) var(--ease-out);
  }
  .msg {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  @keyframes in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .toast {
      animation: none;
    }
  }
</style>
