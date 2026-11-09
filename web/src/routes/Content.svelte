<script lang="ts">
  // Contenu d'un partage ouvert (UI §9.8, §9.8.6, §9.10 ; décisions du propriétaire du
  // 7 novembre : listes compactes, icône par format, temps estimés, téléchargements contrôlés,
  // « Voir » vers un panneau). Éléments regroupés comme à l'envoi, dans l'ordre du manifeste.
  // Noms par safeName, visionneuse par previewKind ; rien n'est écrit dans la console, le
  // titre, l'adresse ni un stockage. « Voir seulement » : aucune action de téléchargement ni de
  // copie dans le DOM (ni barre, ni ligne, ni visionneuse).
  import { lowMemory } from "../app/env";
  import { guardUnload } from "../app/lifecycle";
  import { createDownloads, readSkipping, summarize, type Target } from "../flows/downloads.svelte";
  import { destroyFromContent, release, type DestroyOutcome } from "../flows/endoflife";
  import { transferSeconds } from "../flows/estimate";
  import { WATCH_READY } from "../flows/features";
  import type { Gone } from "../flows/gone.svelte";
  import { CATEGORY_ORDER, categoryOfReceived, extOf, type Category } from "../flows/kinds";
  import { createReadMeter } from "../flows/read-meter";
  import { browserWatchDeps, startWatch } from "../flows/watch";
  import { formatBytes, formatDuration } from "../i18n/format";
  import { getLang, t, type Key } from "../i18n/i18n.svelte";
  import { setProgressTitle } from "../app/title";
  import type { ItemSink } from "../flows/downloads.svelte";
  import type { Opened } from "../index";
  import { announce } from "../ui/announce";
  import Button from "../ui/Button.svelte";
  import { copyText } from "../ui/clipboard";
  import DownloadBar from "../ui/DownloadBar.svelte";
  import { formatOf } from "../ui/formats";
  import { Download, Eye, Flag, Pause, Play, Square, Trash2 } from "../ui/Icon";
  import IconButton from "../ui/IconButton.svelte";
  import InlineConfirm from "../ui/InlineConfirm.svelte";
  import { reducedMotion } from "../ui/motion";
  import ReceivedRow from "../ui/ReceivedRow.svelte";
  import ReportSheet from "../ui/ReportSheet.svelte";
  import NamesTip from "../ui/NamesTip.svelte";
  import { collectPreview, previewQueue } from "../viewers/collect";
  import { blobDownloads, clickDownload, inDirectory, pickFile, type DirHandle, type SavePicker } from "../viewers/save";
  import ViewerPanel, { type ViewItem } from "../viewers/ViewerPanel.svelte";
  import { ZIP_BLOB_MAX, ZIP_BLOB_MAX_SMALL, createZip, zipName } from "../zip/store-zip";

  type ContentEnd = Exclude<DestroyOutcome, "network" | "limit">;
  type Props = {
    opened: Opened;
    /** Compte à rebours à zéro (porté par la capsule d'Open). */
    expired: boolean;
    /** Fin de lecture : la capsule passe à l'état voulu. */
    onend: (kind: "destroyed" | "gone") => void;
    /** Fermeture « partage disparu » (spec §41.8) : suit les enregistrements en cours. */
    gone: Gone;
  };
  let { opened, expired, onend, gone: closer }: Props = $props();
  const lang = $derived(getLang());

  // Le manifeste ne change pas pendant la vie de l'écran : lu une fois.
  // svelte-ignore state_referenced_locally
  const o = opened;
  const viewOnly = o.manifest.rights === "voir";
  const entries = o.manifest.items;
  const enc = new TextEncoder();
  const totals = entries.map((e) => (e.kind === "text" ? enc.encode(e.text ?? "").length : e.size));
  const names = entries.map((_, i) => o.safeName(i));
  const kinds = entries.map((_, i) => o.previewKind(i));
  const formats = entries.map((e, i) => formatOf({ kind: e.kind, ext: extOf(names[i]!), preview: kinds[i] }));
  const viewKind = (i: number): ViewItem["kind"] | null => {
    const k = kinds[i];
    if (entries[i]!.kind === "text" || k === "text") return "text";
    return k === "image" || k === "video" || k === "audio" ? k : null; // PDF : Task 22 (pas de bouton d'ici là)
  };
  /** Nom de fichier d'un élément : une note devient un .txt. */
  const fileName = (i: number) => (entries[i]!.kind === "text" && !/\.txt$/i.test(names[i]!) ? `${names[i]}.txt` : names[i]!);

  const CAT_KEY: Record<Category, Key> = {
    texte: "compose.cat.text",
    photos: "compose.cat.photos",
    videos: "compose.cat.videos",
    audio: "compose.cat.audio",
    documents: "compose.cat.documents",
    archives: "compose.cat.archives",
    autres: "compose.cat.autres",
  };
  const groups = (() => {
    const by = new Map<Category, number[]>();
    entries.forEach((e, i) => {
      const c = categoryOfReceived(e.kind, kinds[i]!, names[i]!, e.mime);
      by.set(c, [...(by.get(c) ?? []), i]);
    });
    return CATEGORY_ORDER.filter((c) => by.has(c)).map((c) => ({ c, items: by.get(c)! }));
  })();
  const all = entries.map((_, i) => i);
  const viewItems: ViewItem[] = groups.flatMap((g) =>
    g.items.flatMap((i) => {
      const k = viewKind(i);
      return k ? [{ i, name: names[i]!, kind: k, size: totals[i]!, text: entries[i]!.kind === "text" ? (entries[i]!.text ?? "") : undefined }] : [];
    }),
  );

  // ---------- Lectures : budget estimé, aperçus en mémoire, file de téléchargements ----------
  const meter = createReadMeter(entries.map((e) => ({ kind: e.kind, offset: e.offset, size: e.size })));
  /** Aperçus déjà lus (Blob), réutilisés par « Télécharger » et l'archive (aucune relecture). */
  const previews = new Map<number, Blob>();
  const PREVIEW_CACHE_MAX = 256 * 1048576;
  function remember(i: number, b: Blob) {
    previews.set(i, b);
    let sum = 0;
    for (const x of previews.values()) sum += x.size;
    for (const k of previews.keys()) {
      if (sum <= PREVIEW_CACHE_MAX) break;
      if (k === i) continue;
      sum -= previews.get(k)!.size;
      previews.delete(k);
    }
  }
  const serverRead = readSkipping((i, sink) => o.saveItem(i, sink));
  async function blobRead(b: Blob, from: number, on: (c: Uint8Array<ArrayBuffer>) => Promise<void>) {
    const r = b.slice(from).stream().getReader();
    for (;;) {
      const { done, value } = await r.read();
      if (done) return;
      await on(new Uint8Array(value));
    }
  }
  const dl = createDownloads(totals, {
    read: (i, from, on) => {
      const b = previews.get(i);
      return b ? blobRead(b, from, on) : serverRead(i, from, on);
    },
    openSink: (i, target) => (target as (name: string) => Promise<ItemSink | null>)(fileName(i)),
    meter,
    now: () => performance.now(),
    track: (i) => closer.begin(names[i]!, totals[i]!),
    ongone: () => closer.closeToGone("http410"),
    cached: (i) => previews.has(i),
  });

  const queue = previewQueue();
  let previewing = $state(0);
  async function loadPreview(i: number, onBytes: (d: number) => void, signal: AbortSignal): Promise<Blob> {
    const hit = previews.get(i);
    if (hit) return hit;
    previewing++;
    try {
      return await queue(async () => {
        if (signal.aborted) throw new DOMException("annulé", "AbortError");
        const again = previews.get(i);
        if (again) return again;
        if (!meter.canRead(i)) throw Object.assign(new Error("budget_epuise"), { name: "ReadBudgetError" });
        meter.charge(i);
        try {
          const b = await collectPreview(o, i, (d) => onBytes(d), signal);
          remember(i, b);
          return b;
        } catch (e) {
          meter.interrupted();
          if (e instanceof Error && e.name === "NotFoundError") closer.closeToGone("http410");
          throw e;
        }
      });
    } finally {
      previewing--;
    }
  }

  // ---------- Destinations ----------
  type W = Window & { showSaveFilePicker?: SavePicker; showDirectoryPicker?: (o?: { mode?: string }) => Promise<DirHandle> };
  const w = typeof window === "undefined" ? undefined : (window as W);
  const savePicker = typeof w?.showSaveFilePicker === "function" ? w.showSaveFilePicker.bind(w) : undefined;
  const dirPicker = typeof w?.showDirectoryPicker === "function" ? w.showDirectoryPicker.bind(w) : undefined;
  const series = blobDownloads({ click: clickDownload, now: () => performance.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  const blobTarget = async (name: string) => series(name);
  const single: Target = savePicker ? (name: string) => pickFile(savePicker, name) : blobTarget;

  const named = (e: unknown, n: string) => typeof e === "object" && e !== null && (e as { name?: unknown }).name === n;
  /** Plusieurs fichiers : un dossier choisi une fois, sinon des téléchargements à la suite. */
  async function batch(items: number[]) {
    if (disabled) return;
    let target: Target = blobTarget;
    if (dirPicker) {
      try {
        target = inDirectory(await dirPicker({ mode: "readwrite" }));
      } catch (e) {
        if (named(e, "AbortError")) return;
        target = blobTarget;
      }
    }
    dl.start(items, target);
  }

  // ---------- Archive .zip (spec §41.6) ----------
  const zipBytes = totals.reduce((a, n) => a + n, 0) + entries.reduce((a, _, i) => a + 2 * fileName(i).length * 4 + 160, 0) + 120;
  const zipTooBig = !savePicker && typeof navigator !== "undefined" && zipBytes > (lowMemory(navigator, Number.MAX_SAFE_INTEGER) ? ZIP_BLOB_MAX_SMALL : ZIP_BLOB_MAX);
  async function startZip() {
    if (disabled) return;
    const name = "shhdrop.zip";
    let sink: ItemSink | null;
    try {
      sink = savePicker ? await pickFile(savePicker, name) : series(name);
    } catch {
      return;
    }
    if (!sink) return;
    const z = createZip(sink as Parameters<typeof createZip>[0]);
    dl.startZip({
      total: totals.reduce((a, n) => a + n, 0),
      abort: () => z.abort(),
      run: async (pipe) => {
        const taken = new Set<string>();
        for (const i of all) {
          const e = await z.entry(zipName(fileName(i), taken), totals[i]!);
          await pipe(i, (c) => e.write(c));
          await e.end();
        }
        await z.finish();
      },
    });
  }

  // ---------- Résumés ----------
  // Retours UI4 : une estimation seulement sur le débit MESURÉ dans cette session (après les
  // premières secondes de lecture, downloads.svelte.ts) ; jamais sur un débit supposé.
  const rate = $derived(dl.measured);
  const est = (i: number) => (entries[i]!.kind === "text" || rate === null ? null : transferSeconds(totals[i]!, rate));
  const sum = (items: number[]) => {
    const s = summarize(dl.rows, items);
    return { ...s, bytes: s.done, n: items.length, finished: s.count.done, running: s.count.downloading + s.count.queued, paused: s.count.paused };
  };
  const allSum = $derived(sum(all.filter((i) => entries[i]!.kind === "file")));
  // Titre de l'onglet pendant un téléchargement : « 42 % · Shhdrop » (jamais un nom de fichier),
  // puis le titre de l'écran revient.
  const dlPct = $derived.by(() => {
    const z = dl.zip;
    if (z && (z.state === "downloading" || z.state === "queued" || z.state === "paused")) return z.total > 0 ? (z.done * 100) / z.total : 0;
    const busy = all.filter((i) => entries[i]!.kind === "file" && dl.rows[i] && dl.rows[i]!.state !== "idle" && dl.rows[i]!.state !== "failed");
    const s0 = summarize(dl.rows, busy);
    return s0.active > 0 && s0.total > 0 ? (s0.done * 100) / s0.total : null;
  });
  $effect(() => setProgressTitle(dlPct, lang));
  $effect(() => () => setProgressTitle(null, getLang()));
  const totalBytes = totals.reduce((a, n) => a + n, 0);
  const lastOpen = o.opensLeft === 0;
  const risky = entries.flatMap((_, i) => (o.isRiskyFile(i) ? [names[i]!] : []));

  // ---------- Fin de vie ----------
  $effect(() => guardUnload(() => dl.busy || previewing > 0));

  let ended = $state<ContentEnd | null>(null);
  const disabled = $derived(expired || closer.closed || ended !== null);
  let wiped = false;

  // UI §12.2, spec §41.4 : sortie de page → wipe, révocation, mais plus de done : l'ouverture
  // reste valable le temps de son octroi, pour qu'un rechargement la rouvre sans en consommer.
  // Démontage (nouveau lien collé dans la barre, autre route) : même effacement. Partage disparu : la lecture en cours
  // continue (spec §41.8), le reste s'arrête ; la fin de lecture l'attend (gone.svelte.ts).
  function leave() {
    if (closer.closedNow()) {
      dl.close();
      return;
    }
    if (wiped) return;
    wiped = true;
    // D41-28 : dernière ouverture permise → « je pars » (le serveur supprime 3 min plus tard,
    // sauf rechargement, qui rouvre par l'octroi et annule).
    o.leave();
    dl.dispose();
    previews.clear();
    release(o);
  }
  $effect(() => () => leave());

  // Spec §41.8 : surveillance de la disparition (route serveur de la Task M2 ; drapeau).
  $effect(() => {
    if (!WATCH_READY) return;
    const wt = startWatch((s) => o.watch(s), () => closer.closeToGone("watch410"), browserWatchDeps());
    return () => wt.stop();
  });

  let heading: HTMLHeadingElement | undefined = $state();
  $effect(() => {
    if (!heading) return;
    heading.focus({ preventScroll: true });
    announce(t("content.title"));
  });

  // ---------- Dissolution (UI §7.4, repli fondu et flou) : après la réponse ou l'effacement ----------
  let panel: HTMLDivElement | undefined = $state();
  async function dissolve(): Promise<void> {
    if (!panel || typeof panel.animate !== "function") return;
    const reduce = reducedMotion();
    const a = panel.animate(
      reduce
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { opacity: 1, filter: "blur(0)", transform: "none" },
            { opacity: 0, filter: "blur(2px)", transform: "translateY(-4px)" },
          ],
      { duration: reduce ? 240 : 400, easing: "cubic-bezier(0.65, 0, 0.35, 1)", fill: "forwards" },
    );
    await a.finished.catch(() => undefined);
  }

  function arrive(kind: ContentEnd) {
    ended = kind;
    onend(kind);
  }

  let destroyError = $state("");
  async function destroy(report: boolean): Promise<string | null> {
    if (ended !== null || wiped) return null;
    destroyError = "";
    let dissolving: Promise<void> = Promise.resolve();
    const out = await destroyFromContent(o, report, { onDestroyed: () => (dissolving = dissolve()) });
    if (out === "network" || out === "limit") {
      const msg = t(out === "limit" ? "content.destroy.limit" : "content.destroy.net");
      if (!report) destroyError = msg;
      return msg;
    }
    wiped = true;
    reportOpen = false;
    viewAt = null;
    previews.clear();
    // Un téléchargement en cours : l'interface se ferme sur l'écran « partage disparu », qui le
    // montre jusqu'à sa fin (spec §41.8 ; un signalement coupe tout côté serveur). Sinon, la fin.
    if (closer.running > 0) {
      closer.closeToGone(out === "gone" ? "http410" : "destroyed-here");
      return null;
    }
    dl.dispose();
    await dissolving;
    arrive(out);
    return null;
  }
  let reportOpen = $state(false);

  // ---------- Visionneuse ----------
  let viewAt = $state<number | null>(null);
  function openViewer(i: number) {
    const k = viewItems.findIndex((v) => v.i === i);
    if (k >= 0 && !disabled) viewAt = k;
  }

  async function copy(i: number) {
    if (viewOnly || entries[i]!.kind !== "text") return;
    if ((await copyText(entries[i]!.text ?? "")) === "copied") announce(t("content.copied"));
  }
  const excerpt = (i: number) => (entries[i]!.kind === "text" ? (entries[i]!.text ?? "").split("\n").find((l) => l.trim() !== "")?.trim().slice(0, 80) : undefined);
</script>

<svelte:window onpagehide={leave} />

<div class="content" bind:this={panel}>
  <header class="top">
    <div class="tt">
      <h1 class="title" tabindex="-1" data-large-title bind:this={heading}>{t("content.title")}</h1>
      <NamesTip />
    </div>
    <p class="sum num">
      {viewOnly || rate === null
        ? t("content.summary.view", { n: entries.length, size: formatBytes(totalBytes, lang) })
        : t("content.summary", { n: entries.length, size: formatBytes(totalBytes, lang), time: formatDuration(transferSeconds(totalBytes, rate), lang) })}
    </p>
    <!-- Signaler : en haut à droite, toujours visible (décision du propriétaire, retours UI4). -->
    {#if !closer.closed}
      <div class="report">
        <Button variant="ghost" dense onpress={() => void (reportOpen = true)}>
          {#snippet icon()}<Flag size={18} />{/snippet}
          {t("content.report")}
        </Button>
      </div>
    {/if}
  </header>
  {#if viewOnly}
    <p class="notice"><Eye size={18} aria-hidden="true" /> <span>{t("content.viewOnly")}</span></p>
  {:else}
    <DownloadBar
      all={allSum}
      zip={dl.zip}
      {zipTooBig}
      {risky}
      multi={!dirPicker}
      {disabled}
      onall={() => batch(all)}
      onzip={startZip}
      onpause={() => dl.pause(all)}
      onresume={() => dl.resume(all)}
      onstop={() => dl.stop(all)}
      onpausezip={() => dl.pauseZip()}
      onresumezip={() => dl.resumeZip()}
      onstopzip={() => dl.stopZip()}
    />
  {/if}

  {#each groups as g (g.c)}
    {@const files = g.items.filter((i) => entries[i]!.kind === "file")}
    {@const s = sum(files)}
    {@const bytes = g.items.reduce((a, i) => a + totals[i]!, 0)}
    {@const cat = t(CAT_KEY[g.c])}
    {@const catRisky = files.filter((i) => o.isRiskyFile(i)).map((i) => names[i]!)}
    <section class="group" aria-labelledby="g-{g.c}" data-group={g.c}>
      <div class="gh">
        <h2 id="g-{g.c}" class="gt">{cat}</h2>
        <span class="gm num">{g.items.length} · {formatBytes(bytes, lang)}</span>
        {#if !viewOnly && rate !== null && files.length > 0 && s.active === 0}<span class="gm eta num" title={t("dl.estimate.title")}>{t("dl.estimate", { time: formatDuration(transferSeconds(bytes, rate!), lang) })}</span>{/if}
        {#if !viewOnly && files.length > 0}
          <div class="gacts">
            {#if s.active > 0}
              {#if s.running > 0}<IconButton label={t("dl.cat.pause", { cat })} onpress={() => dl.pause(files)}><Pause size={18} /></IconButton>{/if}
              {#if s.paused > 0}<IconButton label={t("dl.cat.resume", { cat })} onpress={() => dl.resume(files)}><Play size={18} /></IconButton>{/if}
              <IconButton label={t("dl.cat.stop", { cat })} onpress={() => dl.stop(files)}><Square size={16} /></IconButton>
            {:else if files.length > 1}
              {#if catRisky.length > 0}
                <InlineConfirm dense narrowIcon label={t("dl.download")} triggerName={t("dl.cat.download", { cat })} message={t("dl.risky.batch", { names: catRisky.join(", ") })} confirmLabel={t("dl.risky.confirm")} kind="warn" triggerVariant="ghost" {disabled} onconfirm={() => batch(files)}>
                  {#snippet icon()}<Download size={18} />{/snippet}
                </InlineConfirm>
              {:else}
                <Button variant="ghost" dense {disabled} onpress={() => batch(files)} aria-label={t("dl.cat.download", { cat })}>
                  {#snippet icon()}<Download size={18} />{/snippet}
                  <span class="hide-narrow">{t("dl.download")}</span>
                </Button>
              {/if}
            {/if}
          </div>
        {/if}
      </div>
      <ul class="items">
        {#each g.items as i (i)}
          <ReceivedRow
            {i}
            name={names[i]!}
            format={formats[i]!}
            kind={entries[i]!.kind}
            row={dl.rows[i]!}
            estimate={est(i)}
            canView={viewKind(i) !== null}
            risky={o.isRiskyFile(i)}
            {viewOnly}
            {disabled}
            excerpt={excerpt(i)}
            onview={() => openViewer(i)}
            ondownload={() => !disabled && dl.start([i], single)}
            onpause={() => dl.pause([i])}
            onresume={() => dl.resume([i])}
            onstop={() => dl.stop([i])}
            onretry={() => dl.retry(i)}
            oncopy={() => copy(i)}
          />
        {/each}
      </ul>
    </section>
  {/each}

  <!-- Pied (retours UI4) : « Détruire ce partage » seulement à la dernière ouverture permise
       (opens_left = 0 rendu par unlock) ; sinon, combien d'ouvertures restent. -->
  {#if !closer.closed}
    <footer class="eol" data-eol data-last={lastOpen ? "" : undefined}>
      {#if lastOpen}
        <p class="hint">{t("content.lastOpen")}</p>
        <InlineConfirm
          label={t("content.destroy")}
          message={t("content.destroy.confirm")}
          confirmLabel={t("content.destroy.yes")}
          kind="danger"
          triggerVariant="ghost"
          onconfirm={async () => void (await destroy(false))}
        >
          {#snippet icon()}<Trash2 size={18} />{/snippet}
        </InlineConfirm>
        {#if destroyError}<p class="err" role="alert">{destroyError}</p>{/if}
      {:else}
        <p class="hint num">{t("content.opensLeft", { n: o.opensLeft })}</p>
      {/if}
    </footer>
  {/if}
</div>
<ViewerPanel items={viewItems} bind:at={viewAt} {viewOnly} load={loadPreview} held={dl.readerHeld} ondownload={(i) => dl.start([i], single)} onclose={() => undefined} />
<ReportSheet bind:open={reportOpen} onconfirm={() => destroy(true)} />

<style>
  .content {
    display: grid;
    gap: var(--sp-4);
    min-width: 0;
  }
  .top {
    display: grid;
    gap: var(--sp-1);
  }
  .title {
    margin: 0;
    font-size: var(--fs-h2);
    font-weight: var(--fw-h2);
    font-stretch: var(--wd-h2);
    line-height: var(--lh-h2);
  }
  .tt {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .title:focus {
    outline: none;
  }
  .sum {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .notice {
    margin: 0;
    display: flex;
    align-items: flex-start;
    gap: var(--sp-2);
    padding: var(--sp-3) var(--sp-4);
    border-radius: var(--r-lg);
    background: var(--surface-1);
    border: 1px solid var(--hair-2);
    color: var(--text-2);
    font-size: var(--fs-small);
    max-width: 65ch;
  }
  /* Groupe (retours UI4) : un seul contenant ; le titre de catégorie sur un bandeau à part,
     séparé de ses éléments par un filet. */
  .group {
    display: grid;
    min-width: 0;
    border: 1px solid var(--hair-2);
    border-radius: var(--r-lg);
    background: var(--vessel);
    box-shadow: var(--edge-hi);
    overflow: clip;
  }
  .gh {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    min-height: 44px;
    padding-inline: var(--sp-3) var(--sp-1);
    background: var(--surface-2);
    border-bottom: 1px solid var(--hair-2);
  }
  .gt {
    margin: 0;
    font-size: var(--fs-small);
    font-weight: 640;
    letter-spacing: 0.01em;
  }
  .gm {
    color: var(--text-2);
    font-size: var(--fs-micro);
    min-width: 0;
  }
  .gm.eta::before {
    content: "·";
    margin-inline-end: 6px;
  }
  .gacts {
    margin-inline-start: auto;
  }
  .gacts {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 560px) {
    .gacts :global(button.ghost) {
      gap: 0;
      padding-inline: 10px;
    }
  }
  .items {
    margin: 0;
    padding: 0;
    list-style: none;
    min-width: 0;
  }
  /* En-tête : titre et « Signaler » sur la même ligne, le résumé dessous (retours UI4). */
  .top {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--sp-2);
  }
  .sum {
    grid-column: 1 / -1;
  }
  .report {
    grid-row: 1;
    grid-column: 2;
    margin-inline-end: -10px;
  }
  .report :global(button.ghost) {
    color: var(--text-2);
  }
  .eol {
    display: grid;
    justify-items: start;
    gap: var(--sp-3);
    margin-top: var(--sp-4);
    padding-top: var(--sp-5);
    border-top: 1px solid var(--line);
  }
  .eol :global(button.ghost) {
    color: var(--danger);
  }
  .hint {
    margin: 0;
    max-width: 60ch;
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  /* Téléphone : tout ce qui suit le contenu est centré (retours UI4). */
  @media (max-width: 559px) {
    .eol {
      justify-items: center;
      text-align: center;
    }
    .report :global(button.ghost) {
      gap: 6px;
      padding-inline: 10px;
    }
  }
  .err {
    margin: 0;
    color: var(--danger);
  }
</style>
