<script lang="ts">
  // Contenu d'un partage ouvert (UI §9.8, §9.8.6, §9.10 ; décisions du propriétaire du
  // 7 novembre : listes compactes, icône par format, temps estimés, téléchargements contrôlés,
  // « Voir » vers un panneau). Éléments regroupés comme à l'envoi, dans l'ordre du manifeste.
  // Noms par safeName, visionneuse par previewKind ; rien n'est écrit dans la console, le
  // titre, l'adresse ni un stockage. « Voir seulement » : aucune action de téléchargement ni de
  // copie dans le DOM (ni barre, ni ligne, ni visionneuse).
  import { lowMemory } from "../app/env";
  import { recordDownload } from "../downloads/live.svelte";
  import { afterSave } from "../downloads/store";
  import { guardUnload } from "../app/lifecycle";
  import { createDownloads, readSkipping, summarize, type Target } from "../flows/downloads.svelte";
  import { destroyFromContent, release, type DestroyOutcome } from "../flows/endoflife";
  import { transferSeconds } from "../flows/estimate";
  import { WATCH_READY } from "../flows/features";
  import type { Gone } from "../flows/gone.svelte";
  import { CATEGORY_ORDER, categoryOfReceived, extOf, type Category } from "../flows/kinds";
  import { createReadMeter } from "../flows/read-meter";
  import { browserWatchDeps, startWatch } from "../flows/watch";
  import { formatBytes, formatDayTime, formatDuration } from "../i18n/format";
  import { getLang, t, type Key } from "../i18n/i18n.svelte";
  import { setProgressTitle } from "../app/title";
  import type { ItemSink } from "../flows/downloads.svelte";
  import type { Opened } from "../index";
  import { announce } from "../ui/announce";
  import Button from "../ui/Button.svelte";
  import { copyText } from "../ui/clipboard";
  import DownloadBar from "../ui/DownloadBar.svelte";
  import { formatOf } from "../ui/formats";
  import { Clock, Download, Eye, Pause, Play, Square, Trash2 } from "../ui/Icon";
  import { chrome } from "../app/chrome.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import InlineConfirm from "../ui/InlineConfirm.svelte";
  import { reducedMotion } from "../ui/motion";
  import ReceivedRow from "../ui/ReceivedRow.svelte";
  import ReportSheet from "../ui/ReportSheet.svelte";
  import NamesTip from "../ui/NamesTip.svelte";
  import { collectPreview, previewQueue } from "../viewers/collect";
  import { blobDownloads, clickDownload, inDirectory, needsMemoryWarning, pickFile, type DirHandle, type SavePicker } from "../viewers/save";
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
    /** « Oublier ce partage sur cet appareil » (audit R2) : retour gardé et entrée de l'onglet effacés. */
    onforget?: () => Promise<void>;
    /** Échéance du partage (ms, horloge locale) : « Disponible jusqu'au … » (conception compte §21.9). */
    endsAt?: number;
  };
  let { opened, expired, onend, gone: closer, onforget, endsAt }: Props = $props();
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
    return k === "image" || k === "video" || k === "audio" || k === "pdf" ? k : null; // PDF : cadre isolé (UI §13)
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
    // Historique des téléchargements (conception compte §21.9) : une entrée quand le fichier est
    // entièrement écrit (close réussi) ; arrêt, échec ou sélecteur fermé : rien.
    openSink: async (i, target) => {
      const sink = await (target as (name: string) => Promise<ItemSink | null>)(fileName(i));
      return sink && afterSave(sink, () => recordDownload({ name: fileName(i), sizeBytes: totals[i]!, format: formats[i]!, source: "partage", savedAt: Date.now() }));
    },
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
  /**
   * Un fichier : avec « Enregistrer sous » (Chrome), le sélecteur s'ouvre AU CLIC, même si un
   * autre fichier est en cours (audit M3) : le navigateur le refuse hors d'un appui récent. Le
   * fichier choisi attend son tour dans la file ; un clic sans effet (déjà en file) n'ouvre rien.
   */
  function saveOne(i: number) {
    if (disabled) return;
    if (!savePicker) return dl.start([i], blobTarget);
    if (!dl.canStart(i)) return;
    let picked: Promise<ItemSink | null> | null = pickFile(savePicker, fileName(i));
    picked.catch(() => undefined);
    // Nouvel essai après un échec : un nouveau sélecteur (le premier fichier a été supprimé).
    dl.start([i], (name: string) => {
      const p = picked ?? pickFile(savePicker, name);
      picked = null;
      return p;
    });
  }

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
  // Sans sélecteur, un gros fichier est assemblé en mémoire : prévenir sur un petit appareil.
  const bigWarn = typeof navigator !== "undefined" && needsMemoryWarning(totals, savePicker !== undefined, navigator);
  async function startZip() {
    if (disabled) return;
    const name = "shhgone.zip";
    let sink: ItemSink | null;
    try {
      sink = savePicker ? await pickFile(savePicker, name) : series(name);
    } catch {
      return;
    }
    if (!sink) return;
    // L'archive enregistrée est un seul fichier : une seule entrée « shhgone.zip ».
    const zipTotal = totals.reduce((a, n) => a + n, 0);
    const saved = afterSave(sink, () => recordDownload({ name, sizeBytes: zipTotal, format: { family: "archive", label: "ZIP" }, source: "partage", savedAt: Date.now() }));
    const z = createZip(saved as Parameters<typeof createZip>[0]);
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
  // Titre de l'onglet pendant un téléchargement : « 42 % · Shhgone » (jamais un nom de fichier),
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
  // Revue D42-22 : rendu par le serveur (n = opens_issued et plus aucune ouverture) ; une
  // personne qui revient sans être la dernière ne l'a pas, même à 0 ouverture restante.
  const lastOpen = o.lastOpen;
  const risky = entries.flatMap((_, i) => (o.isRiskyFile(i) ? [names[i]!] : []));

  // ---------- Fin de vie ----------
  $effect(() => guardUnload(() => dl.busy || previewing > 0));

  let ended = $state<ContentEnd | null>(null);
  const disabled = $derived(expired || closer.closed || ended !== null);
  let wiped = false;

  // UI §12.2, spec §41.4, D42-22 : sortie de page → wipe, révocation, mais ni done ni « je
  // pars » : l'ouverture reste valable jusqu'à l'échéance, pour qu'un rechargement ou un retour
  // depuis ce navigateur la rouvre sans en consommer.
  // Démontage (nouveau lien collé dans la barre, autre route) : même effacement. Partage disparu : la lecture en cours
  // continue (spec §41.8), le reste s'arrête ; la fin de lecture l'attend (gone.svelte.ts).
  function leave() {
    if (closer.closedNow()) {
      dl.close();
      return;
    }
    if (wiped) return;
    wiped = true;
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
  // Audit R2 : le destinataire efface la trace du partage dans ce navigateur, sans attendre l'échéance.
  let forgotten = $state(false);
  let forgetting = false;
  async function forgetHere() {
    if (!onforget || forgetting || forgotten) return;
    forgetting = true;
    try {
      await onforget();
      forgotten = true;
    } finally {
      forgetting = false;
    }
  }
  // Signaler (retours UI7) : plus de bouton en haut ; le lien « Signaler » du pied de page ouvre
  // la confirmation de CE partage tant qu'il est ouvert (AppShell lit chrome.report).
  $effect(() => {
    if (closer.closed || wiped || ended !== null) return;
    const open = () => void (reportOpen = true);
    chrome.report = open;
    return () => {
      if (chrome.report === open) chrome.report = null;
    };
  });

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
  </header>
  <!-- Dernière ouverture : dit aussi en haut (audit I5), le détail et « Détruire » restent en bas. -->
  {#if lastOpen && !closer.closed}
    <p class="notice" data-last-top><Clock size={18} aria-hidden="true" /> <span>{t("content.lastOpen.top")}</span></p>
  {/if}
  {#if !viewOnly}
    <!-- « À télécharger » (conception compte §21.9) : nombre, taille et échéance du serveur. -->
    <div class="todo" data-todo>
      <h2 class="todo-t num">{t("downloads.todo", { n: entries.length, size: formatBytes(totalBytes, lang) })}</h2>
      {#if endsAt !== undefined}<p class="todo-m num">{t("downloads.until", { date: formatDayTime(endsAt, lang) })}</p>{/if}
    </div>
  {/if}
  {#if viewOnly}
    <p class="notice"><Eye size={18} aria-hidden="true" /> <span>{t("content.viewOnly")}</span></p>
  {:else}
    <DownloadBar
      all={allSum}
      zip={dl.zip}
      {zipTooBig}
      {bigWarn}
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
            clean={entries[i]!.clean}
            row={dl.rows[i]!}
            estimate={est(i)}
            canView={viewKind(i) !== null}
            risky={o.isRiskyFile(i)}
            {viewOnly}
            {disabled}
            onview={() => openViewer(i)}
            ondownload={() => saveOne(i)}
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

  <!-- Pied (retours UI4, revue D42-22) : « Détruire ce partage » seulement à la dernière
       ouverture permise (last_open rendu par unlock) ; sinon, combien d'ouvertures restent, ou
       « Toutes les ouvertures sont prises. » ; puis les limites du retour. -->
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
        <p class="hint num">{o.opensLeft > 0 ? t("content.opensLeft", { n: o.opensLeft }) : t("content.allTaken")}</p>
      {/if}
      <p class="hint" data-return-limits>{t("content.return.limits")}</p>
      {#if onforget}
        <!-- role=status toujours présent : l'annonce est lue quand son texte apparaît. -->
        <p class="hint" role="status" data-forgotten>{forgotten ? t("content.forgotten") : ""}</p>
        {#if !forgotten}<button type="button" class="forget" onclick={() => void forgetHere()} data-forget>{t("content.forget")}</button>{/if}
      {/if}
    </footer>
  {/if}
</div>
<ViewerPanel items={viewItems} bind:at={viewAt} {viewOnly} load={loadPreview} held={dl.readerHeld} ondownload={(i) => saveOne(i)} onclose={() => undefined} />
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
  .todo {
    display: grid;
    gap: 2px;
  }
  .todo-t {
    margin: 0;
    font-size: var(--fs-small);
    font-weight: 600;
    color: var(--text);
  }
  .todo-m {
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
  /* Groupe (retours LIGHT) : aucun contenant ni bandeau ; un en-tête discret, puis les lignes
     séparées par un seul filet fin. L'espace entre les groupes suffit à les délimiter. */
  .group {
    display: grid;
    min-width: 0;
  }
  .gh {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    min-height: 40px;
    padding-inline: var(--sp-3) var(--sp-1);
  }
  .gt {
    margin: 0;
    font-size: var(--fs-small);
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--text-2);
  }
  .gm {
    color: var(--text-3);
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
  .hint:empty {
    display: none;
  }
  /* Lien discret (audit R2) : texte souligné, cible d'appui de 44 px. */
  .forget {
    min-height: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-small);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .forget:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 4px;
  }
  @media (hover: hover) {
    .forget:hover {
      color: var(--text);
    }
  }
  /* Téléphone : tout ce qui suit le contenu est centré (retours UI4). */
  @media (max-width: 559px) {
    .eol {
      justify-items: center;
      text-align: center;
    }
  }
  .err {
    margin: 0;
    color: var(--danger);
  }
</style>
