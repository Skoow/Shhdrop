<script lang="ts">
  // Un élément reçu (UI §9.8) : nom nettoyé (safeName), taille, visionneuse choisie par
  // previewKind seulement, Enregistrer si l'expéditeur l'a permis. Un aperçu à la fois (file
  // d'attente partagée), progression en octets, Annuler ; échec de décodage → message et
  // Enregistrer ; erreurs de lecture → message et Réessayer.
  import { untrack } from "svelte";
  import { lowMemory } from "../app/env";
  import { formatBytes } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { NotFoundError, type Opened } from "../index";
  import { announce } from "../ui/announce";
  import Button from "../ui/Button.svelte";
  import { copyText } from "../ui/clipboard";
  import { Copy, File, FileText, Film, Image, Music, Play, Type } from "../ui/Icon";
  import SaveButton from "../ui/SaveButton.svelte";
  import AudioViewer from "./AudioViewer.svelte";
  import { AUTO_IMAGE_MAX, revoke, trackUrl } from "./blobs";
  import { collectPreview } from "./collect";
  import ImageViewer from "./ImageViewer.svelte";
  import TextViewer from "./TextViewer.svelte";
  import VideoViewer from "./VideoViewer.svelte";

  type Props = {
    opened: Opened;
    i: number;
    queue: <T>(job: () => Promise<T>) => Promise<T>;
    /** Expiré, plus disponible, ou fin de lecture : aucune lecture ni enregistrement. */
    disabled: boolean;
    expired: boolean;
    viewOnly: boolean;
    onbusy: (delta: 1 | -1) => void;
    /** Le serveur ne connaît plus le partage (NotFoundError pendant une lecture). */
    ongone: () => void;
  };
  let { opened, i, queue, disabled, expired, viewOnly, onbusy, ongone }: Props = $props();
  const lang = $derived(getLang());

  const entry = $derived(opened.manifest.items[i]!);
  const kind = $derived(opened.previewKind(i));
  const name = $derived(opened.safeName(i));
  const size = $derived(entry.size);
  const media = $derived(kind === "image" || kind === "audio" || kind === "video");
  const ICON = { image: Image, audio: Music, video: Film, text: Type, pdf: FileText, none: File } as const;
  const Ico = $derived(ICON[kind]);
  const memoryRisk = $derived(typeof navigator !== "undefined" && lowMemory(navigator, size) && (kind === "video" || !viewOnly));

  type Phase = "idle" | "loading" | "shown" | "undecodable" | "error";
  let phase = $state<Phase>("idle");
  let got = $state(0);
  let url = $state<string | null>(null);
  let ac: AbortController | null = null;

  const isAbort = (e: unknown) => typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";

  async function load() {
    if (phase === "loading" || phase === "shown" || disabled || !media) return;
    phase = "loading";
    got = 0;
    const ctl = new AbortController();
    ac = ctl;
    onbusy(1);
    try {
      const blob = await queue(() => collectPreview(opened, i, (d) => (got = d), ctl.signal));
      if (ctl.signal.aborted) throw new DOMException("annulé", "AbortError");
      url = trackUrl(blob);
      phase = "shown";
    } catch (e) {
      if (isAbort(e)) phase = "idle";
      else if (e instanceof NotFoundError) {
        phase = expired ? "error" : "idle";
        ongone();
      } else phase = "error";
    } finally {
      if (ac === ctl) ac = null;
      onbusy(-1);
    }
  }
  function cancel() {
    ac?.abort();
  }
  function undecodable() {
    if (url) revoke(url);
    url = null;
    phase = "undecodable";
  }

  // Image de 20 Mio au plus : chargée tout de suite (une fois, à l'arrivée).
  $effect(() => {
    untrack(() => {
      if (kind === "image" && size <= AUTO_IMAGE_MAX && !disabled) void load();
    });
  });
  // Sortie de l'écran (Terminer, détruire, nouveau lien) : lecture en cours arrêtée.
  $effect(() => () => ac?.abort());

  async function copy() {
    if (entry.kind !== "text") return;
    if ((await copyText(entry.text ?? "")) === "copied") announce(t("content.copied"));
  }

  const action = $derived(kind === "image" ? t("content.show") : kind === "audio" ? t("content.listen") : t("content.watch"));
  const percent = $derived(size > 0 ? Math.min(100, Math.floor((got / size) * 100)) : 0);
</script>

<li class="item" data-item={i} data-kind={kind} data-phase={phase}>
  <div class="row">
    <span class="ic" aria-hidden="true"><Ico size={20} strokeWidth={1.75} /></span>
    <div class="meta">
      <bdi class="name" translate="no">{name}</bdi>
      {#if entry.kind === "file"}<span class="size num">{formatBytes(size, lang)}</span>{/if}
    </div>
    <div class="actions">
      {#if entry.kind === "text"}
        {#if !viewOnly}
          <Button variant="ghost" dense {disabled} onpress={copy} aria-label={`${t("common.copy")} ${name}`}>
            {#snippet icon()}<Copy size={18} />{/snippet}
            {t("common.copy")}
          </Button>
        {/if}
      {:else}
        {#if media && (phase === "idle" || phase === "error")}
          <Button variant="secondary" dense {disabled} onpress={load} aria-label={`${phase === "error" ? t("common.retry") : action} ${name}`}>
            {#snippet icon()}<Play size={18} />{/snippet}
            {phase === "error" ? t("common.retry") : action}
          </Button>
        {/if}
        {#if !viewOnly}<SaveButton {opened} {i} {disabled} {onbusy} />{/if}
      {/if}
    </div>
  </div>

  {#if entry.kind === "text"}
    <TextViewer text={entry.text ?? ""} label={name} {viewOnly} />
  {:else if phase === "loading"}
    <div class="loading" role="status">
      <progress max="100" value={percent} aria-label={name}></progress>
      <span class="num">{t("content.progress", { done: formatBytes(got, lang), total: formatBytes(size, lang) })} · {percent}&#8239;%</span>
      <Button variant="ghost" dense onpress={cancel}>{t("common.cancel")}</Button>
    </div>
  {:else if phase === "shown" && url}
    <div class="viewer">
      {#if kind === "image"}
        <ImageViewer {url} alt={name} {viewOnly} onerror={undecodable} />
      {:else if kind === "audio"}
        <AudioViewer {url} label={name} {viewOnly} onerror={undecodable} />
      {:else if kind === "video"}
        <VideoViewer {url} label={name} {viewOnly} onerror={undecodable} />
      {/if}
    </div>
  {/if}

  {#if phase === "undecodable"}
    <p class="note warn" role="alert">{viewOnly ? t("content.notViewable") : t("content.undecodable")}</p>
  {:else if phase === "error"}
    <p class="note warn" role="alert">{expired ? t("content.interrupted.expired") : t("content.interrupted")}</p>
  {/if}
  {#if kind === "pdf"}
    <p class="note">{viewOnly ? t("content.notViewable") : t("content.pdf")}</p>
  {:else if kind === "none" && viewOnly}
    <p class="note">{t("content.notViewable")}</p>
  {/if}
  {#if memoryRisk}<p class="note warn">{t("content.memory")}</p>{/if}
</li>

<style>
  .item {
    display: grid;
    gap: var(--sp-3);
    padding-block: var(--sp-3);
    border-top: 1px solid var(--hair);
    min-width: 0;
  }
  .item:first-child {
    border-top: 0;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2) var(--sp-3);
    min-width: 0;
  }
  .ic {
    flex: none;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: var(--r-md);
    background: var(--surface-2);
    color: var(--text-2);
  }
  .meta {
    flex: 1 1 12rem;
    display: grid;
    min-width: 0;
  }
  .name {
    font-weight: 560;
    overflow-wrap: anywhere;
  }
  .size {
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
  }
  .loading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2) var(--sp-3);
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  progress {
    flex: 1 1 10rem;
    max-width: 320px;
    height: 4px;
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
  .viewer {
    min-width: 0;
  }
  .note {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
    max-width: 65ch;
  }
  .note.warn {
    color: var(--warn);
  }
</style>
