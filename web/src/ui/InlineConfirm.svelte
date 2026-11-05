<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import { t } from "../i18n/i18n.svelte";
  import Button from "./Button.svelte";

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
  }: Props = $props();

  let asking = $state(false);
  let trigger: HTMLButtonElement | undefined = $state();
  let cancel: HTMLButtonElement | undefined = $state();
  const uid = $props.id();

  // Pas de modale : le bouton est remplacé sur place, le focus va sur « Annuler » (le choix sûr).
  async function ask() {
    asking = true;
    await tick();
    cancel?.focus();
  }
  async function dismiss() {
    asking = false;
    await tick();
    trigger?.focus();
  }
  async function confirm() {
    try {
      await onconfirm();
    } finally {
      asking = false; // le parent a pu démonter ce composant : sans effet alors
    }
  }
</script>

{#if asking}
  <div class={["confirm", kind]} role="group" aria-labelledby="{uid}-msg">
    <p id="{uid}-msg" class="msg">{message}</p>
    <div class="actions">
      <Button variant="secondary" dense bind:el={cancel} onpress={dismiss}>{cancelLabel ?? t("common.cancel")}</Button>
      <Button variant={kind === "danger" ? "danger" : "primary"} dense onpress={confirm}>{confirmLabel}</Button>
    </div>
  </div>
{:else}
  <Button variant={triggerVariant} bind:el={trigger} {icon} {disabled} onpress={ask}>{label}</Button>
{/if}

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
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
</style>
