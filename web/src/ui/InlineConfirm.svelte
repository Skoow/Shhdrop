<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { t } from "../i18n/i18n.svelte";
  import Button from "./Button.svelte";
  import Sheet from "./Sheet.svelte";

  type Props = {
    /** Libellé du bouton d'origine. */
    label: string;
    /** Question posée à la place du bouton. */
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    onconfirm: () => void | Promise<void>;
    kind?: "default" | "danger" | "warn";
    triggerVariant?: "primary" | "secondary" | "ghost" | "danger";
    icon?: Snippet;
    disabled?: boolean;
    /** Nom accessible du bouton d'origine, s'il doit en dire plus que `label` (il commence par `label`, WCAG 2.5.3). */
    triggerName?: string;
    /** Bouton d'origine de 44 px (listes compactes). */
    dense?: boolean;
    /** Libellé du bouton d'origine caché sur téléphone (icône seule ; nom accessible inchangé). */
    narrowIcon?: boolean;
  };
  let {
    label,
    message,
    confirmLabel,
    cancelLabel,
    onconfirm,
    kind = "default",
    triggerVariant = "secondary",
    icon,
    disabled = false,
    triggerName,
    dense = false,
    narrowIcon = false,
  }: Props = $props();

  let asking = $state(false);
  let running = $state(false);
  let trigger: HTMLButtonElement | undefined = $state();
  let cancel: HTMLButtonElement | undefined = $state();
  const uid = $props.id();
  // Téléphone (< 900 px), façon app : la question monte dans une feuille du bas, gros boutons.
  // Ordinateur : pas de modale, le bouton est remplacé sur place.
  const narrow = new MediaQuery("max-width: 899px");
  let sheet = $state(false);

  // Le focus va sur « Annuler » (le choix sûr).
  async function ask() {
    asking = true;
    sheet = narrow.current;
    await tick();
    cancel?.focus();
  }
  async function dismiss() {
    if (sheet) {
      sheet = false; // la feuille rend le focus au bouton d'origine
      asking = false;
      return;
    }
    asking = false;
    await tick();
    trigger?.focus();
  }
  function sheetClosed() {
    if (!running) asking = false;
  }
  async function confirm() {
    running = true; // « Annuler » est inactif : l'action destructive ne peut plus être « annulée » à l'écran
    try {
      await onconfirm();
    } finally {
      running = false;
      asking = false; // le parent a pu démonter ce composant : sans effet alors
      sheet = false;
    }
  }
</script>

{#if asking && !sheet}
  <div class={["confirm", kind]} role="group" aria-labelledby="{uid}-msg">
    <p id="{uid}-msg" class="msg">{message}</p>
    <div class="actions">
      <Button variant="secondary" dense disabled={running} bind:el={cancel} onpress={dismiss}>{cancelLabel ?? t("common.cancel")}</Button>
      <Button variant={kind === "danger" ? "danger" : "primary"} dense onpress={confirm}>{confirmLabel}</Button>
    </div>
  </div>
{:else}
  <Button variant={triggerVariant} {dense} bind:el={trigger} {icon} {disabled} onpress={ask} aria-label={triggerName}>{#if narrowIcon}<span class="hide-narrow">{label}</span>{:else}{label}{/if}</Button>
{/if}

<Sheet bind:open={sheet} title={label} onclose={sheetClosed}>
  <div class={["sheet-confirm", kind]} role="group" aria-labelledby="{uid}-smsg">
    <p id="{uid}-smsg" class="msg">{message}</p>
    <div class="big">
      <Button variant={kind === "danger" ? "danger" : "primary"} onpress={confirm}>{confirmLabel}</Button>
      <Button variant="secondary" disabled={running} bind:el={cancel} onpress={dismiss}>{cancelLabel ?? t("common.cancel")}</Button>
    </div>
  </div>
</Sheet>

<style>
  .confirm {
    display: grid;
    gap: var(--sp-3);
    padding: var(--sp-4);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    background: var(--surface-2);
  }
  .danger {
    background: var(--danger-tint);
    border-color: var(--danger);
  }
  .warn {
    background: var(--warn-tint);
    border-color: var(--warn);
  }
  .msg {
    margin: 0;
  }
  .sheet-confirm {
    display: grid;
    gap: var(--sp-5);
  }
  .sheet-confirm .msg {
    color: var(--text-2);
    font-size: 1.0625rem;
  }
  .big {
    display: grid;
    gap: var(--sp-3);
  }
  .big :global(.btn) {
    width: 100%;
    min-height: 56px;
    border-radius: 14px;
    font-size: 1.0625rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
</style>
