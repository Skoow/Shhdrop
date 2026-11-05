<script lang="ts">
  import { tick } from "svelte";
  import { t } from "../i18n/i18n.svelte";
  import { announce } from "./announce";
  import { copyText } from "./clipboard";
  import Button from "./Button.svelte";
  import { Check, Copy } from "./Icon";

  /** Tronque au milieu : le début (domaine) et la fin (fin de la clé) restent lisibles. */
  function truncateMiddle(v: string, head = 24, tail = 12): string {
    return v.length <= head + tail + 1 ? v : `${v.slice(0, head)}\u2026${v.slice(-tail)}`;
  }

  type Props = { label: string; value: string };
  let { label, value }: Props = $props();

  const uid = $props.id();
  let copied = $state(false);
  let manual = $state(false);
  let manualInput: HTMLInputElement | undefined = $state();
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => () => clearTimeout(timer));

  async function copy() {
    const r = await copyText(value);
    clearTimeout(timer);
    if (r === "copied") {
      manual = false;
      copied = true;
      announce(t("copy.done", { label }));
      timer = setTimeout(() => (copied = false), 2000);
    } else {
      // Pas d'API ou refus : la valeur entière est montrée, sélectionnée, pour une copie à la main.
      copied = false;
      manual = true;
      announce(t("copy.manual"));
      await tick();
      manualInput?.focus();
      manualInput?.select();
    }
  }
</script>

<div class="cf">
  <span id="{uid}-lbl" class="lbl">{label}</span>
  <div class="row">
    {#if manual}
      <input
        bind:this={manualInput}
        class="val manual"
        readonly
        translate="no"
        spellcheck="false"
        autocomplete="off"
        value={value}
        aria-labelledby="{uid}-lbl"
        aria-describedby="{uid}-hint"
      />
    {:else}
      <span class="val" translate="no" aria-hidden="true">{truncateMiddle(value)}</span>
      <span class="sr-only">{value}</span>
    {/if}
    <Button variant="secondary" dense onpress={copy} aria-label="{t('common.copy')} {label}">
      {#snippet icon()}
        {#if copied}<Check size={20} strokeWidth={1.75} />{:else}<Copy size={20} strokeWidth={1.75} />{/if}
      {/snippet}
      {copied ? t("common.copied") : t("common.copy")}
    </Button>
  </div>
  {#if manual}<p id="{uid}-hint" class="hint">{t("copy.manual")}</p>{/if}
</div>

<style>
  .cf {
    min-width: 0; /* dans une grille parente, la valeur tronquée ne doit pas élargir la colonne */
    display: grid;
    gap: var(--sp-2);
  }
  .lbl {
    font-size: var(--fs-small);
    line-height: var(--lh-small);
    font-weight: 600;
    color: var(--text-2);
  }
  .row {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .val {
    flex: 1;
    min-width: 0;
    min-height: 48px;
    display: flex;
    align-items: center;
    padding: 0 var(--sp-4);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--surface-1);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--fs-small);
    white-space: nowrap;
    overflow: hidden;
  }
  .manual {
    font-size: max(1rem, 16px);
    border-color: var(--line-strong);
  }
  .hint {
    margin: 0;
    font-size: var(--fs-small);
    color: var(--text-3);
  }
</style>
