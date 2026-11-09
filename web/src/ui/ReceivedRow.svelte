<script lang="ts">
  import LockMark from "./LockMark.svelte";
  import { receiveLock } from "./lock";
  // Ligne compacte d'un élément reçu (UI §9.8, décisions du 7 novembre) : icône de format, nom
  // nettoyé (extension toujours visible), type, taille, temps estimé ; pendant un
  // téléchargement : barre, pourcentage, débit, temps restant ; actions selon l'état et les
  // droits. « Voir seulement » : aucune action de téléchargement ni de copie dans le DOM.
  import { midSplit } from "./midname";
  import type { Row } from "../flows/downloads.svelte";
  import { formatBytes, formatDuration, formatRate } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import FormatIcon from "./FormatIcon.svelte";
  import { typeKey, type Format } from "./formats";
  import Button from "./Button.svelte";
  import IconButton from "./IconButton.svelte";
  import InlineConfirm from "./InlineConfirm.svelte";
  import { Copy, Download, Eye, Pause, Play, RefreshCw, Square } from "./Icon";

  type Props = {
    i: number;
    name: string;
    format: Format;
    kind: "file" | "text";
    row: Row;
    /** Secondes estimées pour le télécharger (null : rien à dire, un texte). */
    estimate: number | null;
    canView: boolean;
    risky: boolean;
    viewOnly: boolean;
    disabled: boolean;
    /** Ligne de texte : première ligne du message, sous le nom. */
    excerpt?: string;
    onview: (el: HTMLElement | null) => void;
    ondownload: () => void;
    onpause: () => void;
    onresume: () => void;
    onstop: () => void;
    onretry: () => void;
    oncopy: () => void;
  };
  let { i, name, format, kind, row, estimate, canView, risky, viewOnly, disabled, excerpt, onview, ondownload, onpause, onresume, onstop, onretry, oncopy }: Props = $props();
  const lang = $derived(getLang());

  const dot = $derived(name.lastIndexOf("."));
  const base = $derived(kind === "file" && dot > 0 ? name.slice(0, dot) : name);
  const ext = $derived(kind === "file" && dot > 0 ? name.slice(dot) : "");
  const mid = $derived(midSplit(base));
  const pct = $derived(row.total > 0 ? Math.min(100, Math.floor((row.done / row.total) * 100)) : row.state === "done" ? 100 : 0);
  // Temps restant : seulement quand le débit de cette session est mesuré (estimate non nul,
  // retours UI4), jamais sur les premiers instants.
  const left = $derived(estimate !== null && row.rate > 0 ? (row.total - row.done) / row.rate : null);
  const FAIL = { network: "dl.fail.network", budget: "dl.fail.budget", limit: "dl.fail.limit", disk_full: "dl.fail.disk", write: "dl.fail.write", gone: "dl.fail.gone" } as const;
  let viewBtn: HTMLButtonElement | undefined = $state();
  const lock = $derived(receiveLock(kind, row.state));
</script>

<li class="row" data-item={i} data-kind={format.family} data-state={row.state}>
  <span class="pic">
    <FormatIcon {format} />
    <LockMark badge tone={lock.tone} text={t(lock.key)} />
  </span>
  <div class="main">
    <bdi class="name" title={name} translate="no"><span class="b">{mid.head}</span><span class="e">{mid.tail}{ext}</span></bdi>
    <span class="meta num">
      {#if row.state === "downloading"}
        <span class="st">{left === null ? t("dl.progress.start", { pct, rate: formatRate(row.rate, lang) }) : t("dl.progress", { pct, rate: formatRate(row.rate, lang), left: formatDuration(left, lang) })}</span>
      {:else if row.state === "paused"}
        <span class="st">{t("dl.paused", { pct })}</span>
      {:else if row.state === "queued"}
        <span class="st">{t("dl.queued")}</span>
      {:else}
        {#if excerpt}<bdi class="ex" translate="no">{excerpt}</bdi>{/if}
        {#if kind === "file"}<span>{t(typeKey(format))}</span><span aria-hidden="true">·</span><span>{formatBytes(row.total, lang)}</span>{:else if !excerpt}<span>{t(typeKey(format))}</span>{/if}
        <!-- Téléchargé : dit par l'icône verte de la ligne (retours UI4) ; le texte reste pour les lecteurs d'écran. -->
        {#if row.state === "done"}
          <span class="sr-only">{t("dl.done")}</span>
        {:else if estimate !== null && !viewOnly}
          <span aria-hidden="true">·</span><span class="eta" title={t("dl.estimate.title")}>{t("dl.estimate", { time: formatDuration(estimate, lang) })}<span class="sr-only"> ({t("dl.estimate.title")})</span></span>
        {/if}
      {/if}
    </span>
    {#if row.state === "downloading" || row.state === "paused"}
      <progress max="100" value={pct} aria-label={name}></progress>
    {/if}
  </div>

  <div class="actions">
    {#if canView}
      <Button variant="secondary" dense {disabled} bind:el={viewBtn} onpress={() => onview(viewBtn ?? null)} aria-label={t("dl.row.view", { name })}>
        {#snippet icon()}<Eye size={18} />{/snippet}
        <span class="hide-narrow">{t("dl.view")}</span>
      </Button>
    {/if}
    {#if !viewOnly}
      {#if kind === "text"}
        <IconButton label={t("dl.row.copy", { name })} {disabled} onpress={oncopy}><Copy size={18} /></IconButton>
      {:else if row.state === "downloading" || row.state === "queued"}
        <IconButton label={t("dl.row.pause", { name })} onpress={onpause}><Pause size={18} /></IconButton>
        <IconButton label={t("dl.row.stop", { name })} onpress={onstop}><Square size={16} /></IconButton>
      {:else if row.state === "paused"}
        <IconButton label={t("dl.row.resume", { name })} onpress={onresume}><Play size={18} /></IconButton>
        <IconButton label={t("dl.row.stop", { name })} onpress={onstop}><Square size={16} /></IconButton>
      {:else if row.state === "failed"}
        {#if row.retryable}
          <IconButton label={t("dl.row.retry", { name })} {disabled} onpress={onretry}><RefreshCw size={18} /></IconButton>
          <IconButton label={t("dl.row.stop", { name })} onpress={onstop}><Square size={16} /></IconButton>
        {/if}
      {:else if risky}
        <InlineConfirm
          dense
          narrowIcon
          label={t("dl.download")}
          triggerName={t(row.state === "done" ? "dl.row.again" : "dl.row.download", { name })}
          message={t("content.risky", { name })}
          confirmLabel={t("dl.risky.confirm")}
          kind="warn"
          triggerVariant="ghost"
          {disabled}
          onconfirm={ondownload}
        >
          {#snippet icon()}<Download size={18} />{/snippet}
        </InlineConfirm>
      {:else}
        <Button variant="ghost" dense {disabled} onpress={ondownload} aria-label={t(row.state === "done" ? "dl.row.again" : "dl.row.download", { name })} title={row.state === "done" ? t("dl.done") : undefined} data-done={row.state === "done" ? "" : undefined}>
          {#snippet icon()}<Download size={18} />{/snippet}
          <span class="hide-narrow">{t("dl.download")}</span>
        </Button>
      {/if}
    {/if}
  </div>
  {#if viewOnly && !canView}
    <p class="note">{t("content.notViewable")}</p>
  {/if}
  {#if row.state === "failed" && row.reason && kind === "file"}
    <p class="err" role="alert">{t(FAIL[row.reason])}</p>
  {/if}
</li>

<style>
  /* Icône de format et sa pastille cadenas (UI5). */
  .pic {
    position: relative;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
  }
  .row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 2px var(--sp-3);
    min-height: 56px;
    padding: 6px var(--sp-2) 6px var(--sp-3);
    border-top: 1px solid var(--hair);
    min-width: 0;
  }
  .row:first-child {
    border-top: 0;
  }
  .main {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .name {
    display: flex;
    min-width: 0;
    font-size: var(--fs-small);
    font-weight: 560;
    line-height: 1.35;
    color: var(--text);
  }
  .b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .e {
    flex: none;
    /* pre : l'espace en tête de la queue (« … 2026.jpg ») reste visible. */
    white-space: pre;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 6px;
    min-width: 0;
    color: var(--text-2);
    font-size: var(--fs-micro);
    line-height: var(--lh-micro);
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .ex {
    max-width: 24ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .st {
    color: var(--text);
  }
  /* Téléchargé : l'icône de téléchargement passe au vert (retours UI4). */
  [data-state="done"] .actions :global(button.ghost) {
    color: var(--accent);
  }
  progress {
    width: 100%;
    max-width: 320px;
    height: 3px;
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
  [data-state="paused"] progress::-webkit-progress-value {
    background: var(--text-3);
  }
  [data-state="paused"] progress::-moz-progress-bar {
    background: var(--text-3);
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
  }
  .note {
    grid-column: 2 / -1;
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-micro);
  }
  .err {
    grid-column: 2 / -1;
    margin: 0;
    color: var(--warn);
    font-size: var(--fs-micro);
  }
  /* Téléphone : « Voir » et « Télécharger » en icône seule (nom accessible inchangé) : le nom a la place. */
  @media (max-width: 560px) {
    .row {
      padding-inline: var(--sp-2) 0;
      gap: 2px var(--sp-2);
    }
    .actions :global(button.ghost),
    .actions :global(button.secondary) {
      min-width: 44px;
      padding-inline: 10px;
      gap: 0;
    }
  }
  @media (forced-colors: active) {
    progress {
      border: 1px solid CanvasText;
    }
  }
</style>
