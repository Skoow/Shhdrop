<script module lang="ts">
  export type Voice = { blob: Blob; mime: string; ext: string; stripped: boolean; peaks: number[]; ms: number };
</script>

<script lang="ts">
  // Enregistreur vocal (spec §35.3, Task 12) : onde vivante, minuteur « 0:42 / 30:00 max » sur une ligne,
  // pastille rouge pulsée, Pause / Reprendre (minuteur figé), Arrêter, Annuler (bouton, ou glisser
  // vers la gauche au doigt ; confirmation au-delà de 5 s). Dès l'arrêt, « Valider » ajoute au
  // partage ; la réécoute (onde, vitesse) reste possible, sans obligation, et « Réenregistrer »
  // en secondaire. Tout reste en mémoire ; le nom
  // du navigateur et les dates sont effacés (strip-capture.ts) ; le micro s'éteint dès l'arrêt,
  // à l'annulation, à la fermeture, en arrière-plan et quand la page se ferme.
  import { getLang, t } from "../i18n/i18n.svelte";
  import { formatDuration } from "../i18n/format";
  import { CAPTURE_MAX_S, CAPTURE_TIER } from "../limits";
  import { CaptureFailure, clock, limitMs, openStream, pickMime, stopStream, type CaptureError } from "../media/capture";
  import { LIVE_BARS, WAVE_BARS, startVoice, type VoiceRecording } from "../media/recorder";
  import { stripCaptureMeta } from "../media/strip-capture";
  import { ChevronLeft, Mic, Pause, X } from "./Icon";
  import { reducedMotion } from "./motion";
  import { swipeToRemove } from "./swipe";
  import VoiceClip from "./VoiceClip.svelte";
  import Waveform from "./Waveform.svelte";

  type Props = { open: boolean; ondone: (v: Voice) => void };
  let { open = $bindable(false), ondone }: Props = $props();

  type Phase = "starting" | "ready" | "recording" | "paused" | "finishing" | "review" | "error";
  /** Au-delà, Annuler demande confirmation. */
  const CONFIRM_MS = 5000;
  const SAMPLE_MS = 80;
  const REST = Array.from({ length: LIVE_BARS }, (_, i) => 0.08 + 0.05 * Math.abs(Math.sin(i * 0.7)));

  let phase = $state<Phase>("starting");
  let error = $state<CaptureError | null>(null);
  let elapsed = $state(0);
  let levels = $state<number[]>(REST);
  let confirming = $state(false);
  let limitHit = $state(false);
  let unclean = $state(false);
  let result = $state.raw<Voice | null>(null);

  let dlg: HTMLDialogElement | undefined = $state();
  let stream: MediaStream | null = null;
  let rec: VoiceRecording | null = null;
  let tick: ReturnType<typeof setInterval> | undefined;
  let pickedNow: { mime: string; ext: string } | null = null;
  let meterEl: HTMLDivElement | undefined = $state();
  let resumeAfter = false; // Annuler a mis en pause : « Continuer » reprend
  let gen = 0;
  const maxMs = limitMs("voice");
  const lang = $derived(getLang());
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const live = $derived(phase === "recording" || phase === "paused");

  async function start() {
    const my = ++gen;
    phase = "starting";
    error = null;
    stopStream(stream);
    stream = null;
    try {
      const s = await openStream(navigator.mediaDevices, "voice", "user");
      if (my !== gen || !open) return stopStream(s);
      stream = s;
      phase = "ready";
    } catch (e) {
      if (my !== gen) return;
      error = e instanceof CaptureFailure ? e.kind : "inconnu";
      phase = "error";
    }
  }

  function teardown() {
    gen++;
    clearInterval(tick);
    rec?.cancel();
    rec = null;
    stopStream(stream);
    stream = null;
    result = null;
    elapsed = 0;
    levels = REST;
    confirming = false;
    limitHit = false;
    unclean = false;
  }

  $effect(() => {
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
      void start();
    } else if (!open && dlg.open) dlg.close();
  });
  $effect(() => () => teardown());

  function closed() {
    teardown();
    open = false;
  }

  function record() {
    if (!stream || phase !== "ready") return;
    const picked = pickMime("voice", (m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));
    if (!picked) {
      error = "indisponible";
      phase = "error";
      return;
    }
    const r = startVoice(stream, picked, {
      maxMs,
      onlimit: () => {
        limitHit = true;
        void finish();
      },
    });
    stream = null; // l'enregistreur s'en charge : il arrête les pistes à la fin
    rec = r;
    elapsed = 0;
    levels = REST;
    const still = reducedMotion(); // mouvement réduit : onde statique
    tick = setInterval(() => {
      elapsed = r.elapsedMs();
      if (!still && r.state() === "recording") levels = [...levels.slice(1), Math.max(0.06, r.level())];
    }, SAMPLE_MS);
    phase = "recording";
    pickedNow = picked;
  }

  function pause() {
    if (!rec) return;
    rec.pause();
    elapsed = rec.elapsedMs();
    phase = "paused";
  }
  function resume() {
    if (!rec) return;
    rec.resume();
    phase = "recording";
  }

  async function finish() {
    if (!rec || !pickedNow) return;
    clearInterval(tick);
    confirming = false;
    const r = rec;
    const my = gen;
    rec = null;
    elapsed = r.elapsedMs();
    phase = "finishing";
    const raw = await r.stop(); // micro éteint ici
    const { blob, stripped } = await stripCaptureMeta(raw);
    if (my !== gen) return; // fermé entre-temps
    unclean = !stripped;
    result = {
      blob,
      mime: pickedNow.mime.split(";")[0]!,
      ext: pickedNow.ext,
      stripped,
      // Onde mesurée pendant la prise (jamais de décodage de tout l'audio) ; neutre sans analyseur.
      peaks: r.wave(WAVE_BARS) ?? new Array<number>(WAVE_BARS).fill(0.06),
      ms: elapsed,
    };
    phase = "review";
  }

  /** Annuler : tout de suite sous 5 s, sinon après confirmation. */
  function askCancel() {
    if (!rec) return;
    if (rec.elapsedMs() > CONFIRM_MS) {
      resumeAfter = phase === "recording";
      if (resumeAfter) pause();
      confirming = true;
      // Le panneau glissé revient en place sous la question.
      if (meterEl) {
        meterEl.style.translate = "";
        meterEl.classList.remove("swiping");
      }
    } else discard();
  }
  function keep() {
    confirming = false;
    if (resumeAfter) resume();
  }
  function discard() {
    clearInterval(tick);
    rec?.cancel();
    rec = null;
    confirming = false;
    elapsed = 0;
    levels = REST;
    limitHit = false;
    void start(); // de nouveau prêt, micro rouvert
  }
  function rerecord() {
    result = null;
    unclean = false;
    limitHit = false;
    elapsed = 0;
    void start();
  }
  function use() {
    const r = result;
    if (!r) return;
    dlg?.close();
    ondone(r);
  }

  // Arrière-plan : ce qui est enregistré est gardé (passage en réécoute), le micro s'éteint.
  async function onvisibility() {
    if (!open) return;
    if (document.visibilityState === "hidden") {
      if (live) await finish();
      else if (phase === "ready" || phase === "starting") {
        gen++;
        stopStream(stream);
        stream = null;
        phase = "starting";
      }
    } else if (phase === "starting" && !stream) void start();
  }

  const errText = $derived(
    error === "refuse"
      ? t("voice.err.refuse")
      : error === "absent"
        ? t("voice.err.absent")
        : error === "occupe"
          ? t("cap.err.occupe")
          : error === "indisponible"
            ? t("voice.err.indisponible")
            : t("cap.err.misc"),
  );
  const statusText = $derived(
    phase === "starting"
      ? t("cap.starting.mic")
      : phase === "ready"
        ? t(touch ? "voice.ready" : "voice.readyClick")
        : t(phase === "paused" ? "voice.paused" : "cap.recording"),
  );
  const upsell = $derived(CAPTURE_TIER === "free" ? t("cap.upsell", { max: formatDuration(CAPTURE_MAX_S.plus.voice, lang) }) : "");
</script>

<svelte:document onvisibilitychange={onvisibility} />
<svelte:window onpagehide={teardown} />

<dialog bind:this={dlg} class="vr" aria-labelledby="vr-title" onclose={closed} data-recorder="voice" data-phase={phase}>
  {#if open}
    <header class="top">
      <span class="round ghost" aria-hidden="true"></span>
      <h2 id="vr-title">{t("cap.title.voice")}</h2>
      <button type="button" class="round" aria-label={t("common.close")} onclick={() => dlg?.close()}><X size={22} strokeWidth={2} /></button>
    </header>

    <div class="stage">
      {#if phase === "error"}
        <div class="err" role="alert">
          <span class="err-ic" aria-hidden="true"><Mic size={28} strokeWidth={1.75} /></span>
          <p>{errText}</p>
          {#if error === "refuse"}<p class="how">{t("voice.err.refuse.how")}</p>{/if}
          <button type="button" class="pill solid" onclick={() => void start()}>{t("cap.retry")}</button>
        </div>
      {:else if phase !== "review"}
        <!-- Prêt, en cours, en pause : même bulle au même endroit (pas de saut entre les états). -->
        <div class="meter" bind:this={meterEl} {@attach touch && live && !confirming ? swipeToRemove(askCancel, { reduced: true }) : null}>
          <div class={["state", { paused: phase !== "recording" }]}>
            <span class="dot" aria-hidden="true"></span>
            <p class="timer num" data-timer>
              <span class="now">{clock(elapsed)}</span><span class="max">{t("voice.max", { max: clock(maxMs) })}</span>
            </p>
          </div>
          <div class={["bubble", "rec", { still: phase !== "recording" }]}>
            <Waveform peaks={levels} size="live" />
          </div>
          <p class="status" role="status">{statusText}</p>
          {#if touch}<p class={["swipe-hint", { off: !live }]} aria-hidden="true"><ChevronLeft size={14} strokeWidth={2} />{t("voice.swipe")}</p>{/if}
        </div>
      {:else if phase === "review" && result}
        <div class="review">
          <p class="status done">{t("voice.review")}</p>
          <VoiceClip blob={result.blob} peaks={result.peaks} ms={result.ms} name={t("voice.this")} />
        </div>
      {/if}

      {#if confirming}
        <div class="confirm" role="alertdialog" aria-labelledby="vr-confirm" aria-modal="false">
          <p id="vr-confirm">{t("voice.confirm", { d: clock(elapsed) })}</p>
          <div class="row2">
            <button type="button" class="pill" onclick={keep}>{t("voice.keep")}</button>
            <button type="button" class="pill danger" onclick={discard}>{t("voice.delete")}</button>
          </div>
        </div>
      {/if}
    </div>

    <footer class="bottom">
      {#if phase === "review" && unclean}<p class="note warn" role="alert">{t("cap.unclean")}</p>{/if}
      {#if limitHit}<p class="note warn" role="status">{t("cap.limit")}{#if upsell}<span class="up">{upsell}</span>{/if}</p>{/if}
      <p class="note">{t("voice.note")}</p>
      {#if phase === "review"}
        <div class="ctl done">
          {#if unclean}
            <button type="button" class="pill" onclick={() => dlg?.close()}>{t("common.cancel")}</button>
            <button type="button" class="pill solid" onclick={use}>{t("cap.keepAsIs")}</button>
          {:else}
            <button type="button" class="side" aria-label={t("voice.rerecord")} onclick={rerecord}><Mic size={22} strokeWidth={1.9} /></button>
            <button type="button" class="pill solid" onclick={use}>{t("voice.done")}</button>
          {/if}
        </div>
      {:else if phase !== "error"}
        <!-- Pause à gauche, micro / arrêt au centre, Annuler à droite : positions fixes. -->
        <div class="ctl">
          {#if live && !confirming}
            {#if phase === "paused"}
              <button type="button" class="side" aria-label={t("voice.resume")} onclick={resume}><span class="resume-dot"></span></button>
            {:else}
              <button type="button" class="side" aria-label={t("voice.pauseRec")} onclick={pause}><Pause size={22} strokeWidth={2} /></button>
            {/if}
          {:else}
            <span class="side ghost" aria-hidden="true"></span>
          {/if}
          <button
            type="button"
            class={["big", { on: phase !== "ready" && phase !== "starting" }]}
            style:--lvl={phase === "recording" ? (levels.at(-1) ?? 0) : 0}
            aria-label={t(phase === "ready" || phase === "starting" ? "cap.rec.start" : "cap.rec.stop")}
            disabled={phase === "starting" || phase === "finishing" || confirming}
            onclick={() => (phase === "ready" ? record() : void finish())}
          >
            <span class="ring" aria-hidden="true"></span>
            <span class="ic mic" aria-hidden="true"><Mic size={32} strokeWidth={1.9} /></span>
            <span class="ic sq" aria-hidden="true"></span>
          </button>
          {#if live && !confirming}
            <button type="button" class="side" aria-label={t("voice.cancel")} onclick={askCancel}><X size={22} strokeWidth={2} /></button>
          {:else}
            <span class="side ghost" aria-hidden="true"></span>
          {/if}
        </div>
      {/if}
    </footer>
  {/if}
</dialog>

<style>
  .vr {
    box-sizing: border-box;
    width: 100vw;
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    margin: 0;
    padding: 0;
    border: 0;
    background: var(--bg-deep);
    color: var(--text);
    overflow: hidden;
    overscroll-behavior: contain;
  }
  .vr[open] {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
  }
  .vr::backdrop {
    background: var(--bg-deep);
  }
  @media (min-width: 900px) {
    .vr {
      width: min(520px, calc(100vw - 48px));
      height: min(640px, calc(100dvh - 48px));
      margin: auto;
      border: 1px solid var(--line);
      border-radius: var(--r-xl);
      box-shadow: var(--e-3);
    }
    .vr::backdrop {
      background: var(--scrim);
    }
  }
  .top {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 44px;
    align-items: center;
    gap: var(--sp-3);
    padding: max(var(--sp-3), env(safe-area-inset-top)) max(var(--sp-4), env(safe-area-inset-right)) var(--sp-3) max(var(--sp-4), env(safe-area-inset-left));
  }
  .top h2 {
    margin: 0;
    font-size: var(--fs-body);
    font-weight: 600;
    text-align: center;
  }
  .round {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--text);
    cursor: pointer;
  }
  .round.ghost {
    background: none;
  }
  .stage {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 0;
    padding: var(--sp-4);
  }
  .meter,
  .review {
    display: grid;
    justify-items: center;
    gap: var(--sp-4);
    width: min(100%, 26rem);
    touch-action: pan-y;
  }
  .meter:global(.swipe-back) {
    transition: translate 220ms var(--ease-out);
  }
  .meter:global(.swiping) {
    opacity: calc(1 - var(--swipe, 0) * 0.5);
  }
  .review {
    justify-items: stretch;
  }
  /* Point pulsé et minuteur, sur une ligne. */
  .state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-3);
  }
  .dot {
    flex: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--danger);
    animation: pulse 1.4s var(--ease-in-out) infinite;
  }
  .state.paused .dot {
    animation: none;
    background: var(--text-3);
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
      transform: scale(0.75);
    }
  }
  .timer {
    display: flex;
    align-items: baseline;
    gap: var(--sp-2);
    margin: 0;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .timer .now {
    font-size: var(--fs-h1);
    font-weight: 600;
    line-height: 1;
    letter-spacing: -0.01em;
  }
  .timer .max {
    color: var(--text-3);
    font-size: var(--fs-small);
  }
  /* Même bulle que le lecteur (VoiceClip) : pilule au contour fin, qui respire pendant la prise. */
  .bubble {
    position: relative;
    box-sizing: border-box;
    width: 100%;
    padding: var(--sp-2) var(--sp-5);
    border: 1px solid var(--hair-2);
    border-radius: var(--r-pill);
    background: var(--surface-2);
    box-shadow: var(--edge-hi);
  }
  .bubble::after {
    content: "";
    position: absolute;
    inset: -1px;
    border: 1px solid var(--danger);
    border-radius: inherit;
    pointer-events: none;
    opacity: 0.25;
    animation: breathe 2.8s var(--ease-in-out) infinite;
  }
  .bubble.still::after {
    animation: none;
    opacity: 0;
  }
  @keyframes breathe {
    50% {
      opacity: 0.7;
      transform: scale(1.012, 1.04);
    }
  }
  .status {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
    font-weight: 600;
    letter-spacing: 0.02em;
    text-align: center;
  }
  .swipe-hint.off {
    visibility: hidden;
  }
  .swipe-hint {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1, 4px);
    margin: 0;
    color: var(--text-3);
    font-size: var(--fs-small);
  }
  .err {
    display: grid;
    justify-items: center;
    gap: var(--sp-3);
    max-width: 22rem;
    padding: var(--sp-6) var(--sp-5);
    border: 1px solid var(--line);
    border-radius: var(--r-xl);
    background: var(--surface-1);
    text-align: center;
  }
  .err p {
    margin: 0;
  }
  .err .how {
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .err-ic {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--danger-tint);
    color: var(--danger);
  }
  .confirm {
    position: absolute;
    inset: auto var(--sp-4) var(--sp-4);
    display: grid;
    gap: var(--sp-4);
    max-width: 26rem;
    margin-inline: auto;
    padding: var(--sp-5);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-xl);
    background: var(--surface-2);
    box-shadow: var(--e-2);
    text-align: center;
    animation: rise 200ms var(--ease-out);
  }
  .confirm p {
    margin: 0;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  .row2 {
    display: flex;
    justify-content: center;
    gap: var(--sp-3);
  }
  .bottom {
    display: grid;
    gap: var(--sp-4);
    padding: var(--sp-4) var(--sp-4) max(var(--sp-5), env(safe-area-inset-bottom));
  }
  .note {
    margin: 0 auto;
    max-width: 30rem;
    color: var(--text-2);
    font-size: var(--fs-small);
    line-height: var(--lh-small);
    text-align: center;
  }
  .note.warn {
    color: var(--warn);
  }
  .note .up {
    display: block;
    color: var(--plus);
  }
  .ctl {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    justify-items: center;
    align-items: center;
    gap: var(--sp-3);
    min-height: 88px;
    width: 100%;
    max-width: 420px;
    margin-inline: auto;
  }
  /* Après l'arrêt : « Réenregistrer » en petite icône micro, « Valider » principal sur le reste. */
  .ctl.done {
    display: flex;
    gap: var(--sp-3);
    max-width: 26rem;
  }
  .ctl.done .pill {
    flex: 1 1 0;
    min-width: 0;
    min-height: 52px;
  }
  .ctl.done .side {
    flex: none;
  }
  .side {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--text);
    cursor: pointer;
    transition: transform var(--dur-press, 120ms) var(--ease-out);
  }
  .side.ghost {
    background: none;
    pointer-events: none;
  }
  .resume-dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--danger);
  }
  /* Le micro est le bouton : il démarre, puis devient l'arrêt (carré) au même endroit ;
     l'anneau autour suit le niveau de la voix. */
  .big {
    position: relative;
    display: grid;
    place-items: center;
    width: 80px;
    height: 80px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--danger);
    color: var(--on-danger);
    cursor: pointer;
    transition: transform var(--dur-press, 120ms) var(--ease-out);
  }
  .big > * {
    grid-area: 1 / 1;
  }
  .ring {
    position: absolute;
    inset: -6px;
    border: 2px solid var(--danger);
    border-radius: 50%;
    opacity: 0;
    transform: scale(calc(1 + var(--lvl, 0) * 0.35));
    transition:
      transform 90ms linear,
      opacity 200ms var(--ease-out);
    pointer-events: none;
  }
  .big.on .ring {
    opacity: 0.55;
  }
  .ic {
    display: grid;
    place-items: center;
    transition:
      opacity 160ms var(--ease-out),
      transform 160ms var(--ease-out);
  }
  .sq {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    background: currentColor;
    opacity: 0;
    transform: scale(0.6);
  }
  .big.on .mic {
    opacity: 0;
    transform: scale(0.6);
  }
  .big.on .sq {
    opacity: 1;
    transform: none;
  }
  .big:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .side:active,
  .big:active:not(:disabled) {
    transform: scale(0.94);
  }
  .pill {
    min-height: 48px;
    min-width: 9rem;
    padding: 0 var(--sp-5);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-pill);
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .pill.solid {
    border-color: transparent;
    background: var(--accent);
    color: var(--on-accent);
  }
  .pill.danger {
    border-color: transparent;
    background: var(--danger);
    color: var(--on-danger);
  }
  .pill:active {
    transform: scale(0.97);
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  @media (prefers-reduced-motion: reduce) {
    .dot,
    .bubble::after,
    .confirm {
      animation: none;
    }
    .side,
    .big,
    .ring,
    .ic {
      transition: none;
    }
  }
</style>
