<script lang="ts">
  // Caméra dans NOTRE interface (spec §35.3, Q-REC1 acceptée), comme une app photo :
  // bascule Photo / Vidéo, déclencheur, caméra avant / arrière, et en bas à gauche la vignette
  // « Galerie » (sélecteur du système, géré par le parent). Plein écran sur téléphone. Photo :
  // <canvas> → JPEG (aucune métadonnée par construction) ; vidéo : MediaRecorder,
  // minuteur « 4:12 / 5:00 maximum », arrêt propre à la limite (limits.ts), puis nom du navigateur
  // et dates effacés de l'en-tête (media/strip-capture.ts). Tout reste en mémoire ; les pistes sont
  // arrêtées à la sortie, au passage en arrière-plan et quand la page se ferme. Refus ou API
  // absente : message clair et repli sur l'appareil photo du système (<input capture>, parent).
  // Le vocal a son propre écran (VoiceRecorder.svelte, Task 12).
  import { getLang, t } from "../i18n/i18n.svelte";
  import { formatDuration } from "../i18n/format";
  import { CAPTURE_MAX_S, CAPTURE_TIER } from "../limits";
  import {
    CaptureFailure,
    clock,
    limitMs,
    openStream,
    pickMime,
    snapshot,
    startRecorder,
    stopStream,
    type CaptureError,
    type Facing,
    type Recording,
  } from "../media/capture";
  import { stripCaptureMeta } from "../media/strip-capture";
  import AddIcon from "./AddIcon.svelte";
  import { RefreshCw, X } from "./Icon";

  /** `stripped` : métadonnées de l'enregistrement effacées (faux : « Garder tel quel » choisi). */
  export type Captured = { mode: "photo" | "video"; blob: Blob; mime: string; ext: string; stripped: boolean };
  type Props = {
    open: boolean;
    canVideo?: boolean;
    ondone: (c: Captured) => void;
    /** Photo, vidéo : repli sur l'appareil photo du système (appel synchrone, même geste). */
    onfallback?: (mode: "photo" | "video") => void;
    /** Vignette « Galerie » : ouvre le sélecteur photos et vidéos du système (même geste). */
    ongallery?: () => void;
  };
  let { open = $bindable(false), canVideo = false, ondone, onfallback, ongallery }: Props = $props();

  type Phase = "starting" | "live" | "recording" | "review" | "error";
  let phase = $state<Phase>("starting");
  let kind = $state<"photo" | "video">("photo");
  let error = $state<CaptureError | null>(null);
  let facing = $state<Facing>("environment");
  let elapsed = $state(0);
  let limitHit = $state(false);
  let url = $state<string | null>(null);
  let flash = $state(false);
  // Audit F7 : format que le nettoyage ne reconnaît pas (dates, nom du navigateur peut-être
  // restés) : dit à l'écran, et la personne choisit « Garder tel quel » ou « Annuler ».
  let unclean = $state(false);

  let dlg: HTMLDialogElement | undefined = $state();
  let live: HTMLVideoElement | undefined = $state();
  let stream: MediaStream | null = null;
  let rec: Recording | null = null;
  let result: Captured | null = null;
  let pickedNow: { mime: string; ext: string } | null = null;
  let tick: ReturnType<typeof setInterval> | undefined;
  let gen = 0; // une ouverture de flux plus récente annule les précédentes

  // Repli : « l'appareil photo du téléphone » au doigt ; sinon le sélecteur de fichiers.
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const title = $derived(t(`cap.title.${kind}`));
  const maxMs = limitMs("video");
  const lang = $derived(getLang());

  async function start() {
    const my = ++gen;
    phase = "starting";
    error = null;
    stopStream(stream);
    stream = null;
    try {
      const s = await openStream(navigator.mediaDevices, kind, facing);
      if (my !== gen || !open) return stopStream(s);
      stream = s;
      phase = "live";
      if (live) {
        live.srcObject = s;
        await live.play().catch(() => undefined);
      }
    } catch (e) {
      if (my !== gen) return;
      error = e instanceof CaptureFailure ? e.kind : "inconnu";
      phase = "error";
    }
  }

  function clearUrl() {
    if (url) URL.revokeObjectURL(url);
    url = null;
  }

  /** Tout éteindre : caméra, micro, enregistrement, minuteur, aperçu. */
  function teardown() {
    gen++;
    clearInterval(tick);
    rec?.cancel();
    rec = null;
    stopStream(stream);
    stream = null;
    if (live) live.srcObject = null;
    clearUrl();
    result = null;
    elapsed = 0;
    limitHit = false;
  }

  $effect(() => {
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
      facing = "environment";
      kind = "photo";
      void start();
    } else if (!open && dlg.open) dlg.close();
  });
  $effect(() => () => teardown());

  function closed() {
    teardown();
    open = false;
  }

  /** Bascule Photo / Vidéo (la vidéo demande aussi le micro : nouveau flux). */
  function setKind(k: "photo" | "video") {
    if (k === kind || (phase !== "live" && phase !== "starting" && phase !== "error")) return;
    kind = k;
    void start();
  }

  async function shoot() {
    if (!live || phase !== "live") return;
    flash = true;
    setTimeout(() => (flash = false), 160);
    try {
      const blob = await snapshot(live);
      stopStream(stream); // l'aperçu suffit : la caméra s'éteint pendant la relecture
      stream = null;
      result = { mode: "photo", blob, mime: "image/jpeg", ext: "jpg", stripped: true };
      url = URL.createObjectURL(blob);
      phase = "review";
    } catch {
      error = "inconnu";
      phase = "error";
    }
  }

  function record() {
    if (!stream || phase !== "live") return;
    const sup = (m: string) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m);
    const picked = pickMime("video", sup);
    if (!picked) {
      error = "inconnu";
      phase = "error";
      return;
    }
    limitHit = false;
    rec = startRecorder(stream, picked, "video", {
      maxMs,
      onlimit: () => {
        limitHit = true;
        void finish();
      },
    });
    const r = rec;
    elapsed = 0;
    tick = setInterval(() => (elapsed = Math.min(r.elapsedMs(), maxMs)), 250);
    phase = "recording";
    result = null;
    pickedNow = picked;
  }

  async function finish() {
    if (!rec || !pickedNow) return;
    clearInterval(tick);
    const r = rec;
    const my = gen;
    rec = null;
    elapsed = Math.min(r.elapsedMs(), maxMs);
    const raw = await r.stop();
    stopStream(stream);
    stream = null;
    if (live) live.srcObject = null;
    // Nom du navigateur (WebM) et dates (MP4) effacés ; format inattendu : rien ne part sans
    // que la personne l'ait choisi (unclean).
    const { blob, stripped } = await stripCaptureMeta(raw);
    if (my !== gen) return; // fermé entre-temps
    unclean = !stripped;
    result = { mode: kind, blob, mime: pickedNow.mime.split(";")[0]!, ext: pickedNow.ext, stripped };
    url = URL.createObjectURL(blob);
    phase = "review";
  }

  function retake() {
    clearUrl();
    result = null;
    unclean = false;
    elapsed = 0;
    limitHit = false;
    void start();
  }
  function use() {
    const r = result;
    if (!r) return;
    dlg?.close(); // teardown via onclose : pistes arrêtées, URL révoquée
    ondone(r);
  }
  function flip() {
    facing = facing === "environment" ? "user" : "environment";
    void start(); // start() coupe l'ancienne piste avant d'ouvrir la nouvelle
  }
  function fallback() {
    const m = kind;
    dlg?.close();
    onfallback?.(m);
  }
  function gallery() {
    teardown(); // caméra éteinte tout de suite (l'événement close arrive plus tard), même geste
    dlg?.close();
    ongallery?.();
  }

  // Arrière-plan : on garde ce qui est enregistré, mais caméra et micro s'éteignent.
  async function onvisibility() {
    if (!open) return;
    if (document.visibilityState === "hidden") {
      if (phase === "recording") await finish();
      else if (phase === "live" || phase === "starting") {
        gen++;
        stopStream(stream);
        stream = null;
        phase = "starting";
      }
    } else if (phase === "starting") void start();
  }

  const errText = $derived(
    error === "refuse" ? t("cap.err.refuse.cam") : error === "absent" ? t("cap.err.absent") : error === "occupe" ? t("cap.err.occupe") : t("cap.err.misc"),
  );
  const ready = $derived(phase === "live" || phase === "starting");
  const canFlip = $derived(ready);
  const showModes = $derived(canVideo && (ready || phase === "error"));
  const upsell = $derived(
    CAPTURE_TIER === "free" && kind === "video" ? t("cap.upsell", { max: formatDuration(CAPTURE_MAX_S.plus.video, lang) }) : "",
  );
</script>

<svelte:document onvisibilitychange={onvisibility} />
<svelte:window onpagehide={teardown} />

<dialog bind:this={dlg} class="cam" aria-labelledby="cap-title" onclose={closed} data-capture={kind}>
  {#if open}
    <div class="stage">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={live}
        class={["live", { mirror: facing === "user", gone: phase === "review" }]}
        autoplay
        muted
        playsinline
        aria-label={t("cap.preview.live")}
      ></video>
      {#if phase === "review" && url}
        {#if kind === "photo"}
          <img class="still" src={url} alt={t("cap.preview.photo")} />
        {:else}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video class="still" src={url} controls playsinline></video>
        {/if}
      {/if}
      {#if phase === "starting"}<p class="msg" role="status">{t("cap.starting.cam")}</p>{/if}
      {#if phase === "error"}
        <div class="err" role="alert">
          <p>{errText}</p>
          <div class="err-act">
            {#if onfallback}<button type="button" class="pill solid" onclick={fallback}>{t(kind === "photo" ? (touch ? "cap.fallback.photo" : "cap.fallback.photo.pick") : touch ? "cap.fallback.video" : "cap.fallback.video.pick")}</button>{/if}
            <button type="button" class="pill" onclick={() => void start()}>{t("cap.retry")}</button>
          </div>
        </div>
      {/if}
      {#if flash}<span class="flash" aria-hidden="true"></span>{/if}
    </div>

    <div class="top">
      <button type="button" class="round" aria-label={t("common.close")} onclick={() => dlg?.close()}><X size={22} strokeWidth={2} /></button>
      <h2 id="cap-title" class={{ hide: phase === "recording" || (phase === "review" && kind !== "photo"), "sr-only": true }}>{title}</h2>
      {#if phase === "recording"}
        <p class="timer num rec"><span class="dot" aria-hidden="true"></span><span class="sr-only">{t("cap.recording")} </span>{t("cap.timer", { elapsed: clock(elapsed), max: clock(maxMs) })}</p>
      {:else if phase === "review" && kind !== "photo"}
        <p class="timer num"><span class="dot" aria-hidden="true"></span>{clock(elapsed)}</p>
      {/if}
      <span class="round ghost" aria-hidden="true"></span>
    </div>

    <div class="bottom">
      {#if phase === "review" && unclean}
        <p class="note warn" role="alert">{t("cap.unclean")}</p>
      {/if}
      {#if limitHit}
        <p class="note warn" role="status">{t("cap.limit")}{#if upsell}<span class="up">{upsell}</span>{/if}</p>
      {/if}
      <p class="note">{t("cap.note.camera")}</p>
      {#if showModes}
        <div class="modes" role="group" aria-label={t("cap.mode")}>
          <button type="button" class="mode" aria-pressed={kind === "photo"} onclick={() => setKind("photo")}>{t("cap.mode.photo")}</button>
          <button type="button" class="mode" aria-pressed={kind === "video"} onclick={() => setKind("video")}>{t("cap.mode.video")}</button>
        </div>
      {/if}
      <div class={["ctl", { three: phase !== "review" }]}>
        {#if phase === "review" && unclean}
          <button type="button" class="pill" onclick={() => dlg?.close()}>{t("common.cancel")}</button>
          <button type="button" class="pill solid" onclick={use}>{t("cap.keepAsIs")}</button>
        {:else if phase === "review"}
          <button type="button" class="pill" onclick={retake}>{t("cap.retake")}</button>
          <button type="button" class="pill solid" onclick={use}>{t(`cap.use.${kind}`)}</button>
        {:else}
          {#if ongallery && phase !== "recording"}
            <button type="button" class="side gal" aria-label={t("cap.gallery")} onclick={gallery}><AddIcon id="gallery" size={24} /></button>
          {:else}
            <span class="side ghost" aria-hidden="true"></span>
          {/if}
          {#if phase === "recording"}
            <button type="button" class="shutter stop" aria-label={t("cap.rec.stop")} onclick={() => void finish()}><span></span></button>
          {:else if kind === "photo"}
            <button type="button" class="shutter" aria-label={t("cap.shoot")} disabled={phase !== "live"} onclick={() => void shoot()}><span></span></button>
          {:else}
            <button type="button" class="shutter recb" aria-label={t("cap.rec.start")} disabled={phase !== "live"} onclick={record}><span></span></button>
          {/if}
          {#if canFlip}
            <button type="button" class="side flip" aria-label={t("cap.flip")} onclick={flip}><RefreshCw size={22} strokeWidth={2} /></button>
          {:else}
            <span class="side ghost" aria-hidden="true"></span>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</dialog>

<style>
  .cam {
    box-sizing: border-box;
    width: 100vw;
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    margin: 0;
    padding: 0;
    border: 0;
    background: #000;
    color: #fff;
    overflow: hidden;
    overscroll-behavior: contain;
  }
  .cam[open] {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
  }
  .cam::backdrop {
    background: #000;
  }
  @media (min-width: 900px) {
    /* Ordinateur : grand panneau centré (webcam), pas tout l'écran. */
    .cam {
      width: min(960px, calc(100vw - 48px));
      height: min(760px, calc(100dvh - 48px));
      margin: auto;
      border-radius: var(--r-xl);
      box-shadow: var(--e-3);
    }
    .cam::backdrop {
      background: var(--scrim);
    }
  }
  .stage {
    grid-row: 1 / -1;
    grid-column: 1;
    position: relative;
    display: grid;
    place-items: center;
    min-height: 0;
    overflow: hidden;
  }
  .live,
  .still {
    grid-area: 1 / 1;
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: #000;
  }
  video.still {
    object-fit: contain;
  }
  img.still {
    object-fit: contain;
  }
  .live.mirror {
    transform: scaleX(-1);
  }
  .live.gone {
    visibility: hidden;
  }
  .msg {
    grid-area: 1 / 1;
    margin: 0;
    color: rgb(255 255 255 / 0.8);
  }
  .err {
    grid-area: 1 / 1;
    display: grid;
    gap: var(--sp-4);
    max-width: 22rem;
    margin: var(--sp-5);
    padding: var(--sp-5);
    border-radius: var(--r-xl);
    background: var(--surface-2);
    color: var(--text);
    text-align: center;
  }
  .err p {
    margin: 0;
  }
  .err-act {
    display: grid;
    gap: var(--sp-2);
  }
  .flash {
    position: absolute;
    inset: 0;
    background: #fff;
    animation: flash 160ms ease-out forwards;
    pointer-events: none;
  }
  @keyframes flash {
    from {
      opacity: 0.85;
    }
    to {
      opacity: 0;
    }
  }

  .top,
  .bottom {
    grid-column: 1;
    position: relative;
    z-index: 1;
    padding-inline: max(var(--sp-4), env(safe-area-inset-left)) max(var(--sp-4), env(safe-area-inset-right));
  }
  .top {
    grid-row: 1;
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 44px;
    align-items: center;
    gap: var(--sp-3);
    padding-block: max(var(--sp-3), env(safe-area-inset-top)) var(--sp-5);
    background: linear-gradient(rgb(0 0 0 / 0.55), transparent);
  }
  .top h2 {
    grid-column: 2;
    grid-row: 1;
    margin: 0;
    font-size: var(--fs-body);
    font-weight: 600;
    text-align: center;
  }
  .top h2.hide {
    visibility: hidden;
  }
  .top h2.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .timer {
    grid-column: 2;
    grid-row: 1;
    justify-self: center;
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    margin: 0;
    padding: 4px 12px;
    border-radius: var(--r-pill);
    background: rgb(0 0 0 / 0.5);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .timer .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.6);
  }
  .timer.rec .dot {
    background: var(--danger);
  }
  .bottom {
    grid-row: 3;
    display: grid;
    gap: var(--sp-4);
    padding-block: var(--sp-6) max(var(--sp-5), env(safe-area-inset-bottom));
    background: linear-gradient(transparent, rgb(0 0 0 / 0.65) 35%);
  }
  .note {
    margin: 0 auto;
    max-width: 30rem;
    color: rgb(255 255 255 / 0.82);
    font-size: var(--fs-small);
    line-height: var(--lh-small);
    text-align: center;
  }
  .note.warn {
    color: var(--warn);
  }
  /* « Avec Plus… » en bleu, comme toute mention des formules payantes (retours UI4). */
  .note .up {
    display: block;
    color: var(--plus);
  }
  /* Bascule Photo / Vidéo, comme l'app photo du téléphone : le mode choisi en jaune clair. */
  .modes {
    display: flex;
    justify-content: center;
    gap: var(--sp-1);
  }
  .mode {
    min-height: 36px;
    padding: 0 var(--sp-4);
    border: 0;
    border-radius: var(--r-pill);
    background: transparent;
    color: rgb(255 255 255 / 0.78);
    font: inherit;
    font-size: var(--fs-small);
    font-weight: 640;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    transition: color 140ms var(--ease-out), background-color 140ms var(--ease-out);
  }
  .mode[aria-pressed="true"] {
    background: rgb(0 0 0 / 0.45);
    color: var(--warn);
  }
  .ctl {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: var(--sp-3);
    min-height: 76px;
  }
  /* Galerie à gauche, déclencheur au centre, caméra avant / arrière à droite. */
  .ctl.three {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    justify-items: center;
    max-width: 420px;
    width: 100%;
    margin-inline: auto;
  }
  .side {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    padding: 0;
    border: 0;
    color: #fff;
    cursor: pointer;
    transition: transform 120ms var(--ease-out);
  }
  .side.ghost {
    visibility: hidden;
  }
  .side.gal {
    border-radius: 14px;
    background: rgb(255 255 255 / 0.12);
    box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.85);
  }
  .side.flip {
    border-radius: 50%;
    background: rgb(255 255 255 / 0.16);
  }
  .side:active {
    transform: scale(0.94);
  }
  .round {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 50%;
    background: rgb(0 0 0 / 0.45);
    color: #fff;
    cursor: pointer;
  }
  .round.ghost {
    background: none;
  }
  .round:active {
    transform: scale(0.94);
  }
  .shutter {
    display: grid;
    place-items: center;
    width: 76px;
    height: 76px;
    padding: 0;
    border: 4px solid #fff;
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
    transition: transform 120ms var(--ease-out);
  }
  .shutter span {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: #fff;
    transition: all 160ms var(--ease-out);
  }
  .shutter.recb span {
    background: var(--danger);
  }
  .shutter.stop span {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: var(--danger);
  }
  .shutter:active {
    transform: scale(0.94);
  }
  .shutter:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .pill {
    min-height: 48px;
    min-width: 9rem;
    padding: 0 var(--sp-5);
    border: 1px solid rgb(255 255 255 / 0.3);
    border-radius: var(--r-pill);
    background: rgb(0 0 0 / 0.35);
    color: inherit;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .err .pill {
    border-color: var(--line-strong);
    background: transparent;
  }
  .pill.solid,
  .err .pill.solid {
    border-color: transparent;
    background: var(--accent);
    color: var(--on-accent);
  }
  .pill:active {
    transform: scale(0.97);
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  @media (prefers-reduced-motion: reduce) {
    .mode,
    .side {
      transition: none;
    }
    .flash {
      animation: none;
    }
    .flash {
      display: none;
    }
  }
</style>
