<script module lang="ts">
  export type ViewItem = { i: number; name: string; kind: "image" | "video" | "audio" | "pdf" | "text"; size: number; text?: string };
</script>

<script lang="ts">
  // Visionneuse en panneau (décision du 7 novembre : un panneau, jamais toute la page) :
  // <dialog> natif (showModal : focus piégé, Échap), précédent / suivant, ← → Début Fin,
  // balayage horizontal au doigt (48 px), balayage vers le bas pour fermer. Images, vidéos,
  // sons et textes seulement (previewKind) ; SVG, HTML et PDF n'arrivent jamais ici.
  // « Voir seulement » : aucun bouton de téléchargement, mention honnête dans le panneau.
  import { midSplitName } from "../ui/midname";
  import { extLabel, otherBrowser } from "./hint";
  import PdfViewer from "./PdfViewer.svelte";
  import { untrack } from "svelte";
  import { formatBytes } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { announce } from "../ui/announce";
  import Button from "../ui/Button.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import { ChevronLeft, Download, Eye, X } from "../ui/Icon";
  import AudioViewer from "./AudioViewer.svelte";
  import { revoke, trackUrl } from "./blobs";
  import ImageViewer from "./ImageViewer.svelte";
  import { previewable } from "../media/dimensions";
  import TextViewer from "./TextViewer.svelte";
  import VideoViewer from "./VideoViewer.svelte";

  type Props = {
    items: ViewItem[];
    /** Position dans `items` de l'élément montré ; null : fermé. */
    at: number | null;
    viewOnly: boolean;
    /** Lecture du Blob d'aperçu (cache, file d'attente, budget : Content). */
    load: (i: number, onBytes: (done: number) => void, signal: AbortSignal) => Promise<Blob>;
    /** Une lecture en pause tient le lecteur : l'aperçu attendrait. */
    held: boolean;
    /** Absent (aperçu de l'expéditeur, dans le composeur) : aucun bouton « Télécharger ». */
    ondownload?: (i: number) => void;
    onclose: () => void;
  };
  let { items, at = $bindable(), viewOnly, load, held, ondownload, onclose }: Props = $props();
  const lang = $derived(getLang());
  const uid = $props.id();

  let dlg: HTMLDialogElement | undefined = $state();
  let opener: Element | null = null;
  const cur = $derived(at === null ? null : (items[at] ?? null));

  $effect(() => {
    if (!dlg) return;
    if (at !== null && !dlg.open) {
      opener = document.activeElement;
      dlg.showModal();
    } else if (at === null && dlg.open) dlg.close();
  });
  function closed() {
    at = null;
    const back = opener;
    opener = null;
    if (back instanceof HTMLElement && back.isConnected) back.focus();
    onclose();
  }

  // Chargement de l'élément montré ; le précédent est abandonné, son URL révoquée.
  // noPreview : image de plus de 50 mégapixels ou aux dimensions introuvables (media/dimensions).
  type Phase = "loading" | "shown" | "undecodable" | "noPreview" | "error" | "corrupt";
  let phase = $state<Phase>("loading");
  let got = $state(0);
  let url = $state<string | null>(null);
  /** PDF : le Blob lui-même (transféré au cadre isolé), jamais une URL de la page. */
  let pdf = $state<Blob | null>(null);
  $effect(() => {
    const c = cur;
    if (!c) return;
    const k = (at ?? 0) + 1;
    untrack(() => announce(t("viewer.announce", { k, n: items.length, name: c.name })));
    if (c.kind === "text") {
      phase = "shown";
      return;
    }
    const ctl = new AbortController();
    phase = "loading";
    got = 0;
    let mine: string | null = null;
    // Hors suivi : la lecture touche à l'état du parent (compteurs), qui ne doit pas relancer cet effet.
    untrack(() => load(c.i, (d) => (got = d), ctl.signal)).then(
      async (blob) => {
        if (ctl.signal.aborted) return;
        // Bombe de décompression : dimensions lues dans l'en-tête, jamais décodée au-delà de la borne.
        if (c.kind === "image" && !(await previewable(blob))) {
          if (!ctl.signal.aborted) phase = "noPreview";
          return;
        }
        if (ctl.signal.aborted) return;
        if (c.kind === "pdf") pdf = blob;
        else {
          mine = trackUrl(blob);
          url = mine;
        }
        phase = "shown";
      },
      (e: unknown) => {
        // Contenu modifié en route (audit web D3) : texte fixe, distinct d'une coupure.
        if (!ctl.signal.aborted) phase = e instanceof Error && e.name === "CorruptError" ? "corrupt" : "error";
      },
    );
    return () => {
      ctl.abort();
      if (mine) revoke(mine);
      url = null;
      pdf = null;
    };
  });

  function go(k: number) {
    if (at === null || items.length === 0) return;
    at = Math.max(0, Math.min(items.length - 1, k));
  }
  function key(e: KeyboardEvent) {
    if (at === null) return;
    // Les flèches restent aux contrôles d'un lecteur (avance) et au texte (défilement).
    const tg = e.target as HTMLElement | null;
    if (tg && (tg.closest("video, audio, pre") || tg.tagName === "INPUT")) return;
    if (e.key === "ArrowLeft") go(at - 1);
    else if (e.key === "ArrowRight") go(at + 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else return;
    e.preventDefault();
  }

  // Balayage au doigt (et au stylet) sur la scène ; la souris garde ses clics.
  let start: { x: number; y: number; id: number } | null = null;
  function down(e: PointerEvent) {
    if (e.pointerType === "mouse" || (e.target as HTMLElement).closest("video, audio")) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }
  function up(e: PointerEvent) {
    const s = start;
    start = null;
    if (!s || s.id !== e.pointerId || at === null) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? at + 1 : at - 1);
    else if (dy >= 80 && Math.abs(dy) > Math.abs(dx)) dlg?.close();
  }

  function backdrop(e: MouseEvent) {
    if (e.target !== dlg || !dlg) return;
    const r = dlg.getBoundingClientRect();
    if (!(e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom)) dlg.close();
  }
  const pct = $derived(cur && cur.size > 0 ? Math.min(100, Math.floor((got / cur.size) * 100)) : 0);
</script>

<dialog bind:this={dlg} class="vp" aria-labelledby="{uid}-t" aria-roledescription="carousel" onclose={closed} onclick={backdrop} onkeydown={key}>
  {#if cur}
    <div class="head">
      <!-- Nom lu d'un seul tenant (aria-label) ; texte affiché une seule fois (pas de copie masquée). -->
      <h2 id="{uid}-t" class="nm" title={cur.name} aria-label={cur.name}><bdi translate="no"><span class="h">{midSplitName(cur.name).head}</span><span class="tl">{midSplitName(cur.name).tail}</span></bdi></h2>
      <span class="count num" aria-hidden="true">{t("viewer.count", { k: (at ?? 0) + 1, n: items.length })}</span>
      <IconButton label={t("common.close")} onpress={() => dlg?.close()}><X size={20} strokeWidth={1.75} /></IconButton>
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="stage" data-kind={cur.kind} onpointerdown={down} onpointerup={up} onpointercancel={() => (start = null)}>
      {#if cur.kind === "text"}
        <TextViewer text={cur.text ?? ""} label={cur.name} {viewOnly} />
      {:else if phase === "loading"}
        <div class="wait" role="status">
          {#if held}
            <p>{t("dl.held")}</p>
          {:else}
            <progress max="100" value={pct} aria-label={cur.name}></progress>
            <p class="num">{t("viewer.loading", { done: formatBytes(got, lang), total: formatBytes(cur.size, lang) })}</p>
          {/if}
        </div>
      {:else if phase === "error"}
        <p class="msg" role="alert">{t("content.interrupted")}</p>
      {:else if phase === "corrupt"}
        <p class="msg" role="alert">{t("content.corrupt")}</p>
      {:else if phase === "noPreview"}
        <p class="msg" role="alert">{viewOnly ? t("content.notViewable") : t("content.undecodable")}</p>
      {:else if phase === "undecodable"}
        <!-- Format que ce navigateur ne décode pas (retours CLEAN4) : le format, et quel navigateur essayer. -->
        {@const other = otherBrowser(cur.name)}
        <p class="msg" role="alert">
          {#if other && extLabel(cur.name)}{t(viewOnly ? "content.undecodable.fmt.viewOnly" : "content.undecodable.fmt", { fmt: extLabel(cur.name), browser: t(other === "safari" ? "content.browser.safari" : "content.browser.chrome") })}
          {:else}{viewOnly ? t("content.notViewable") : t("content.undecodable")}{/if}
        </p>
      {:else if pdf && cur.kind === "pdf"}
        <PdfViewer blob={pdf} label={cur.name} onerror={() => (phase = "undecodable")} />
      {:else if url}
        {#if cur.kind === "image"}
          <ImageViewer {url} alt={cur.name} {viewOnly} onerror={() => (phase = "undecodable")} />
        {:else if cur.kind === "video"}
          <VideoViewer {url} label={cur.name} {viewOnly} onerror={() => (phase = "undecodable")} />
        {:else}
          <AudioViewer {url} label={cur.name} {viewOnly} onerror={() => (phase = "undecodable")} />
        {/if}
      {/if}
    </div>
    <div class="foot">
      <div class="nav">
        <IconButton label={t("viewer.prev")} disabled={at === 0} onpress={() => go((at ?? 0) - 1)}><ChevronLeft size={20} /></IconButton>
        <IconButton label={t("viewer.next")} disabled={at === items.length - 1} onpress={() => go((at ?? 0) + 1)}><span class="flip"><ChevronLeft size={20} /></span></IconButton>
      </div>
      {#if viewOnly}
        <p class="vo"><Eye size={16} aria-hidden="true" /> <span>{t("content.viewOnly")}</span></p>
      {:else if cur.kind !== "text" && ondownload}
        <Button variant="secondary" dense onpress={() => ondownload(cur.i)} aria-label={t("dl.row.download", { name: cur.name })}>
          {#snippet icon()}<Download size={18} />{/snippet}
          {t("dl.download")}
        </Button>
      {/if}
    </div>
  {/if}
</dialog>

<style>
  .vp {
    box-sizing: border-box;
    width: min(920px, calc(100vw - 32px));
    max-width: none;
    height: min(760px, 86dvh);
    max-height: none;
    margin: auto;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--r-xl);
    background: var(--surface-1);
    color: var(--text);
    box-shadow: var(--e-3), var(--edge);
    overflow: hidden;
    overscroll-behavior: contain;
  }
  .vp[open] {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
  }
  .vp::backdrop {
    background: var(--scrim);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-4);
    border-bottom: 1px solid var(--line);
    min-width: 0;
  }
  .nm {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: var(--fs-small);
    font-weight: 600;
    white-space: nowrap;
  }
  .nm bdi {
    display: flex;
    min-width: 0;
  }
  .nm .h {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .nm .tl {
    flex: none;
    white-space: pre;
  }
  .count {
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .stage {
    display: grid;
    place-items: center;
    min-height: 0;
    padding: var(--sp-4);
    overflow: auto;
    background: var(--bg-deep);
    touch-action: pan-y pinch-zoom;
  }
  .stage[data-kind="text"] {
    place-items: start center;
    background: var(--surface-1);
  }
  .stage :global(img),
  .stage :global(video) {
    max-height: 100%;
  }
  .wait {
    display: grid;
    justify-items: center;
    gap: var(--sp-2);
    color: var(--text-2);
    font-size: var(--fs-small);
    text-align: center;
    max-width: 40ch;
  }
  .wait p,
  .msg {
    margin: 0;
  }
  .msg {
    color: var(--warn);
    max-width: 50ch;
    text-align: center;
  }
  progress {
    width: 240px;
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
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    padding: var(--sp-2) var(--sp-3);
    border-top: 1px solid var(--line);
  }
  .nav {
    display: flex;
    gap: var(--sp-1);
  }
  .flip {
    display: inline-flex;
    transform: scaleX(-1);
  }
  .vo {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    color: var(--text-2);
    font-size: var(--fs-micro);
    max-width: 48ch;
  }
  /* Téléphone : visionneuse plein écran, comme une app (zones sûres respectées). */
  @media (max-width: 759px) {
    .vp {
      width: 100vw;
      height: 100dvh;
      border: 0;
      border-radius: 0;
      background: var(--bg-deep);
      box-shadow: none;
    }
    .head {
      padding-top: max(var(--sp-2), env(safe-area-inset-top));
      padding-right: max(var(--sp-2), env(safe-area-inset-right));
    }
    .stage {
      padding: var(--sp-2);
    }
  }
  @media (forced-colors: active) {
    .vp {
      border-color: CanvasText;
    }
  }
</style>
