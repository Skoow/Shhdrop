<script lang="ts" module>
  // Une seule annonce à la fois : une nouvelle fait fermer la précédente (son parent la retire).
  let current: (() => void) | null = null;
</script>

<script lang="ts">
  import { tick, untrack } from "svelte";
  import { t } from "../i18n/i18n.svelte";
  import { announce } from "./announce";
  import Button from "./Button.svelte";

  type Props = {
    message: string;
    /** « Annuler » pressé : le parent remet l'élément à sa place. */
    onundo: () => void;
    /** Fin de vie sans annulation (6 s écoulées, Échap, ou remplacement par une autre annonce). */
    ondismiss: () => void;
    durationMs?: number;
    /**
     * Appelé à la fermeture, quelle qu'en soit la cause. Si le focus était dans la notification,
     * l'élément rendu ici le reçoit (typiquement la ligne voisine, ou le bouton d'ajout si la
     * liste est vide) ; à défaut, `<main>`, jamais `<body>`. LES ÉCRANS DOIVENT FOURNIR CETTE
     * CIBLE. Un nouveau message sur la même instance relance le minuteur et l'annonce.
     */
    onclose?: () => HTMLElement | null | undefined | void;
  };
  let { message, onundo, ondismiss, durationMs = 6000, onclose }: Props = $props();

  let el: HTMLElement | undefined = $state();

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
  async function finish(undo: boolean) {
    if (done) return;
    done = true;
    if (current === dismissSelf) current = null;
    const hadFocus = !!el && el.contains(document.activeElement);
    (undo ? onundo : ondismiss)();
    const target = onclose?.();
    if (hadFocus) {
      await tick(); // le parent a retiré la notification : le focus ne doit pas tomber sur <body>
      (target ?? document.querySelector<HTMLElement>("main"))?.focus({ preventScroll: true });
    }
  }
  const dismissSelf = () => void finish(false);

  $effect(() => {
    if (current && current !== dismissSelf) current();
    current = dismissSelf;
    left = durationMs;
    arm();
    // Annonce par la région partagée (une région live insérée déjà remplie n'est pas fiable).
    const m = message;
    untrack(() => announce(t("toast.announce", { message: m })));
    return () => {
      clearTimeout(timer);
      timer = undefined;
      if (current === dismissSelf) current = null;
    };
  });

  const isTextEntry = (n: EventTarget | null) =>
    n instanceof HTMLElement &&
    (n.isContentEditable ||
      n instanceof HTMLTextAreaElement ||
      n instanceof HTMLSelectElement ||
      (n instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit", "reset", "file", "range", "color", "image"].includes(n.type)));

  function key(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    // Ctrl/Cmd + Z : annule le retrait, sauf dans un champ de texte (sa propre annulation).
    if (e.key.toLowerCase() === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      if (isTextEntry(e.target)) return;
      e.preventDefault();
      void finish(true);
      return;
    }
    // Échap appartient d'abord à une feuille ouverte ou à un autre gestionnaire.
    if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
    dismissSelf();
  }
</script>

<svelte:window onkeydown={key} />

<div
  bind:this={el}
  class="toast"
  role="group"
  aria-label={message}
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
