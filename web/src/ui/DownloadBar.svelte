<script lang="ts">
  // Barre d'actions du destinataire (UI §9.8.6) : « Tout télécharger » et « Tout télécharger en
  // .zip » ; pendant un téléchargement : progression d'ensemble (nombre, octets, débit, temps
  // restant), Tout mettre en pause, Tout reprendre, Tout arrêter ; même chose pour l'archive.
  // Absente en « voir seulement » (Content ne la monte pas) ; désactivée à l'expiration.
  import type { Row } from "../flows/downloads.svelte";
  import { formatBytes, formatDuration, formatRate } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import Button from "./Button.svelte";
  import IconButton from "./IconButton.svelte";
  import InlineConfirm from "./InlineConfirm.svelte";
  import { Check, Download, FileArchive, Pause, Play, Square } from "./Icon";

  type Summary = { n: number; finished: number; bytes: number; total: number; rate: number; active: number; paused: number; running: number };
  type Props = {
    all: Summary;
    zip: Row | null;
    /** L'archive ne peut pas être assemblée sur cet appareil (Blob trop gros) : raison affichée. */
    zipTooBig: boolean;
    /** Noms des fichiers à risque inclus (confirmation avant de commencer). */
    risky: string[];
    /** Sans sélecteur de dossier : un téléchargement par fichier, à la suite. */
    multi: boolean;
    disabled: boolean;
    onall: () => void;
    onzip: () => void;
    onpause: () => void;
    onresume: () => void;
    onstop: () => void;
    onpausezip: () => void;
    onresumezip: () => void;
    onstopzip: () => void;
  };
  let { all, zip, zipTooBig, risky, multi, disabled, onall, onzip, onpause, onresume, onstop, onpausezip, onresumezip, onstopzip }: Props = $props();
  const lang = $derived(getLang());

  const left = $derived(all.rate > 0 ? (all.total - all.bytes) / all.rate : null);
  const zipPct = $derived(zip && zip.total > 0 ? Math.min(100, Math.floor((zip.done / zip.total) * 100)) : 0);
  const zipLeft = $derived(zip && zip.rate > 0 ? (zip.total - zip.done) / zip.rate : null);
  const zipLive = $derived(zip !== null && (zip.state === "queued" || zip.state === "downloading" || zip.state === "paused"));
  const riskyMsg = $derived(t("dl.risky.batch", { names: risky.join(", ") }));
</script>

<section class="bar" aria-label={t("dl.all")} data-download-bar>
  <div class="acts">
    {#if risky.length > 0}
      <InlineConfirm dense label={t("dl.all")} message={riskyMsg} confirmLabel={t("dl.risky.confirm")} kind="warn" triggerVariant="primary" disabled={disabled || all.active > 0} onconfirm={onall}>
        {#snippet icon()}<Download size={18} />{/snippet}
      </InlineConfirm>
    {:else}
      <Button variant="primary" dense disabled={disabled || all.active > 0} onpress={onall}>
        {#snippet icon()}<Download size={18} />{/snippet}
        {t("dl.all")}
      </Button>
    {/if}
    {#if !zipTooBig}
      {#if risky.length > 0}
        <InlineConfirm dense label={t("dl.zip")} message={riskyMsg} confirmLabel={t("dl.risky.confirm")} kind="warn" triggerVariant="secondary" disabled={disabled || zipLive} onconfirm={onzip}>
          {#snippet icon()}<FileArchive size={18} />{/snippet}
        </InlineConfirm>
      {:else}
        <Button variant="secondary" dense disabled={disabled || zipLive} onpress={onzip}>
          {#snippet icon()}<FileArchive size={18} />{/snippet}
          {t("dl.zip")}
        </Button>
      {/if}
    {/if}
  </div>
  {#if zipTooBig}<p class="note">{t("dl.zip.tooBig")}</p>{/if}

  {#if all.active > 0}
    <div class="prog" data-progress="all">
      <p class="line num" role="status">
        {left === null
          ? t("dl.all.progress.start", { done: all.finished, total: all.n, bytes: formatBytes(all.bytes, lang), size: formatBytes(all.total, lang) })
          : t("dl.all.progress", { done: all.finished, total: all.n, bytes: formatBytes(all.bytes, lang), size: formatBytes(all.total, lang), rate: formatRate(all.rate, lang), left: formatDuration(left, lang) })}
      </p>
      <div class="ctl">
        {#if all.running > 0}<IconButton label={t("dl.all.pause")} onpress={onpause}><Pause size={18} /></IconButton>{/if}
        {#if all.paused > 0}<IconButton label={t("dl.all.resume")} onpress={onresume}><Play size={18} /></IconButton>{/if}
        <IconButton label={t("dl.all.stop")} onpress={onstop}><Square size={16} /></IconButton>
      </div>
    </div>
    {#if multi}<p class="note">{t("dl.multi")}</p>{/if}
  {/if}

  {#if zip}
    <div class={["prog", zip.state]} data-progress="zip">
      <p class="line num" role="status">
        {#if zip.state === "done"}<Check size={16} aria-hidden="true" /> {t("dl.zip.done")}
        {:else if zip.state === "failed"}{t("dl.zip.failed")}
        {:else if zip.state === "paused"}{t("dl.zip.paused", { pct: zipPct })}
        {:else if zip.state === "queued"}{t("dl.zip.queued")}
        {:else}{zipLeft === null ? t("dl.progress.start", { pct: zipPct, rate: formatRate(zip.rate, lang) }) : t("dl.zip.progress", { pct: zipPct, rate: formatRate(zip.rate, lang), left: formatDuration(zipLeft, lang) })}{/if}
      </p>
      {#if zipLive}
        <div class="ctl">
          {#if zip.state === "paused"}
            <IconButton label={t("dl.zip.resume")} onpress={onresumezip}><Play size={18} /></IconButton>
          {:else}
            <IconButton label={t("dl.zip.pause")} onpress={onpausezip}><Pause size={18} /></IconButton>
          {/if}
          <IconButton label={t("dl.zip.stop")} onpress={onstopzip}><Square size={16} /></IconButton>
        </div>
      {/if}
      {#if zip.state === "downloading" || zip.state === "paused"}<progress max="100" value={zipPct} aria-label={t("dl.zip")}></progress>{/if}
    </div>
  {/if}
</section>

<style>
  .bar {
    display: grid;
    gap: var(--sp-2);
    min-width: 0;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
  .prog {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 2px var(--sp-3);
    padding: 4px 4px 4px var(--sp-4);
    border: 1px solid var(--hair-2);
    border-radius: var(--r-lg);
    background: var(--surface-1);
    min-height: 52px;
  }
  .line {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-small);
    color: var(--text);
    min-width: 0;
  }
  .done .line {
    color: var(--accent);
  }
  .failed .line {
    color: var(--warn);
  }
  .ctl {
    display: flex;
    gap: 2px;
  }
  progress {
    grid-column: 1 / -1;
    width: 100%;
    height: 3px;
    margin-bottom: 6px;
    appearance: none;
    border: 0;
    border-radius: var(--r-pill);
    background: var(--surface-3);
    overflow: hidden;
  }
  progress::-webkit-progress-bar {
    background: var(--surface-3);
  }
  progress::-webkit-progress-value {
    background: var(--accent);
  }
  progress::-moz-progress-bar {
    background: var(--accent);
  }
  .note {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-micro);
    max-width: 65ch;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  /* Téléphone : deux actions pleine largeur, empilées et alignées (zone du pouce). */
  @media (max-width: 759px) {
    .acts {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
    }
    .acts > :global(.btn),
    .acts > :global(* > .btn) {
      width: 100%;
      justify-content: center;
    }
  }
</style>
