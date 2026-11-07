<script lang="ts">
  // Enregistrer un élément reçu (UI §9.9) : avertissement avant un fichier à risque,
  // progression réelle (octets, vitesse), Annuler, messages honnêtes. « Enregistré » n'apparaît
  // qu'après close() réussi (ou le lien de repli déclenché), jamais après une annulation.
  import { formatBytes, formatRate } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import type { Gone } from "../flows/gone.svelte";
  import { collectToBlob, PREVIEW_MAX, type Opened } from "../index";
  import { clickDownload, saveItemTo, type SaveDeps, type SaveResult } from "../viewers/save";
  import { announce } from "./announce";
  import Button from "./Button.svelte";
  import { Check, Download } from "./Icon";
  import InlineConfirm from "./InlineConfirm.svelte";

  type Props = {
    opened: Opened;
    i: number;
    disabled?: boolean;
    /** +1 au début d'un enregistrement, −1 à la fin (garde de sortie de page). */
    onbusy?: (delta: 1 | -1) => void;
    /**
     * Spec §41.8 (E1) : l'enregistrement est suivi par la fermeture « partage disparu » ; s'il
     * est en cours quand l'interface se ferme, il continue et l'écran de fin le montre.
     */
    gone?: Gone;
    /** Le serveur ne sert plus ce partage (refus pendant l'enregistrement). */
    ongone?: () => void;
  };
  let { opened, i, disabled = false, onbusy, gone, ongone }: Props = $props();
  const lang = $derived(getLang());

  type Picker = SaveDeps["showSaveFilePicker"];
  const picker = (): Picker => {
    const f = (window as Window & { showSaveFilePicker?: Picker }).showSaveFilePicker;
    return typeof f === "function" ? f.bind(window) : undefined;
  };
  const name = $derived(opened.safeName(i));
  const total = $derived(opened.manifest.items[i]?.size ?? 0);
  const risky = $derived(opened.isRiskyFile(i));
  const inMemory = $derived(picker() === undefined && total > PREVIEW_MAX);

  let saving = $state(false);
  let done = $state(0);
  let rate = $state(0);
  let result = $state<SaveResult | null>(null);
  let usedPicker = false;
  let ac: AbortController | null = null;

  async function save() {
    if (saving || disabled || gone?.closed) return;
    const tracker = gone?.begin(name, total) ?? null;
    saving = true;
    result = null;
    done = 0;
    rate = 0;
    ac = new AbortController();
    const p = picker();
    usedPicker = p !== undefined;
    onbusy?.(1);
    try {
      result = await saveItemTo(
        opened,
        i,
        { showSaveFilePicker: p, collectToBlob: (o, j) => collectToBlob(o, j), click: clickDownload, now: () => performance.now() },
        (d, _t, r) => {
          done = d;
          rate = r;
          tracker?.progress(d);
        },
        ac.signal,
      );
    } finally {
      saving = false;
      ac = null;
      onbusy?.(-1);
      tracker?.end(result === "saved");
    }
    if (result === "gone") ongone?.();
    if (result === "saved") announce(t("save.done"));
    if (result === "cancelled") result = null; // retour silencieux
  }
  function cancel() {
    ac?.abort();
  }
  const message = $derived(
    result === "failed" || result === "gone" ? t(usedPicker ? "save.interrupted" : "save.failed") : result === "disk_full" ? t("save.diskFull") : "",
  );
</script>

<div class="save">
  {#if saving}
    <p class="progress num" role="status">
      {t("save.progress", { done: formatBytes(done, lang), total: formatBytes(total, lang), rate: formatRate(rate, lang) })}
    </p>
    <Button variant="ghost" dense onpress={cancel}>{t("common.cancel")}</Button>
  {:else if risky}
    <InlineConfirm
      label={result === "saved" ? t("save.again") : t("save.button")}
      message={t("content.risky", { name })}
      confirmLabel={t("save.confirm")}
      kind="warn"
      triggerVariant="secondary"
      triggerName={`${result === "saved" ? t("save.again") : t("save.button")} ${name}`}
      {disabled}
      onconfirm={save}
    >
      {#snippet icon()}<Download size={18} aria-hidden="true" />{/snippet}
    </InlineConfirm>
  {:else}
    <Button variant="secondary" dense {disabled} onpress={save} aria-label={`${result === "saved" ? t("save.again") : t("save.button")} ${name}`}>
      {#snippet icon()}<Download size={18} aria-hidden="true" />{/snippet}
      {result === "saved" ? t("save.again") : t("save.button")}
    </Button>
  {/if}
  {#if result === "saved" && !saving}
    <p class="ok"><Check size={16} aria-hidden="true" /> {t("save.done")} · <span class="num">{formatBytes(done, lang)}</span></p>
  {/if}
  {#if message}<p class="err" role="alert">{message}</p>{/if}
  {#if inMemory}<p class="note">{t("save.memoryNote")}</p>{/if}
</div>

<style>
  .save {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2) var(--sp-3);
  }
  .num,
  .progress {
    font-variant-numeric: tabular-nums;
  }
  .progress {
    margin: 0;
    color: var(--text);
  }
  .ok {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    color: var(--accent);
    font-size: var(--fs-small);
  }
  .err {
    margin: 0;
    color: var(--danger);
    font-size: var(--fs-small);
    flex-basis: 100%;
  }
  .note {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
    flex-basis: 100%;
  }
</style>
