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

  // Le minuteur s'arrête tant que la notification a le survol ou le focus (WCAG 2.2.1), puis
  // reprend avec le temps restant. Elle est fixe en bas de page : la marge nécessaire pour
  // qu'elle ne couvre rien est l'affaire des écrans.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let left = 0;
  let startedAt = 0;
  let hovered = false;
  let focused = false;
  function arm() {
    clearTimeout(timer);
    startedAt = Date.now();
    timer = setTimeout(dismissSelf, left);
  }
  function hold() {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    left = Math.max(0, left - (Date.now() - startedAt));
  }
  function update() {
    if (hovered || focused) hold();
    else if (timer === undefined && !done) arm();
  }

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
    left = durationMs;
    arm();
    return () => {
      clearTimeout(timer);
      timer = undefined;
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

<div
  class="toast"
  role="status"
  onpointerenter={() => ((hovered = true), update())}
  onpointerleave={() => ((hovered = false), update())}
  onfocusin={() => ((focused = true), update())}
  onfocusout={() => ((focused = false), update())}
>
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
