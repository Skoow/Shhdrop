<script lang="ts">
  // Réécoute d'un vocal en mémoire (Task 12) : lecture / pause, onde qui se colore avec la
  // progression, toucher ou glisser sur l'onde pour se déplacer, durée. L'URL blob n'existe que
  // pendant la lecture du composant et est révoquée à sa sortie. Rien n'est écrit sur l'appareil.
  // Vitesse : 1× → 1,5× → 2× → 1×, hauteur de la voix conservée.
  import { getLang, t } from "../i18n/i18n.svelte";
  import { clock } from "../media/capture";
  import { MINI_BARS, nextRate, rateLabel, resample } from "../media/recorder";
  import { Pause, Play } from "./Icon";
  import Waveform from "./Waveform.svelte";

  type Props = { blob: Blob; peaks: readonly number[]; ms: number; name: string; size?: "big" | "mini" };
  let { blob, peaks, ms, name, size = "big" }: Props = $props();

  const shown = $derived(size === "mini" ? resample(peaks, MINI_BARS) : peaks);
  let playing = $state(false);
  let pos = $state(0); // ms
  let rate = $state(1);
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;
  let raf = 0;

  function ensure(): HTMLAudioElement {
    if (audio) return audio;
    url = URL.createObjectURL(blob);
    const a = new Audio(url);
    a.preload = "auto";
    a.preservesPitch = true;
    a.defaultPlaybackRate = a.playbackRate = rate;
    a.onended = () => {
      playing = false;
      cancelAnimationFrame(raf);
      pos = 0;
      a.currentTime = 0;
    };
    a.onpause = () => {
      playing = false;
      cancelAnimationFrame(raf);
    };
    a.onplay = () => {
      playing = true;
      const step = () => {
        pos = Math.min(ms, a.currentTime * 1000);
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    audio = a;
    return a;
  }
  function toggle() {
    const a = ensure();
    if (a.paused) void a.play().catch(() => (playing = false));
    else a.pause();
  }
  function speed() {
    rate = nextRate(rate);
    if (audio) audio.defaultPlaybackRate = audio.playbackRate = rate;
  }
  function seek(r: number) {
    const a = ensure();
    pos = r * ms;
    a.currentTime = pos / 1000;
  }
  // Nouveau fichier (réenregistrement) ou sortie : lecture arrêtée, URL révoquée.
  $effect(() => {
    void blob;
    return () => {
      cancelAnimationFrame(raf);
      if (audio) {
        audio.onpause = audio.onplay = audio.onended = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      if (url) URL.revokeObjectURL(url);
      audio = null;
      url = null;
      playing = false;
      pos = 0;
    };
  });
  const progress = $derived(ms > 0 ? pos / ms : 0);
</script>

<div class={["clip", size]} data-voice-clip>
  <button type="button" class="play" aria-label={t(playing ? "voice.pause" : "voice.play", { name })} aria-pressed={playing} onclick={toggle}>
    {#if playing}<Pause size={size === "mini" ? 15 : 20} strokeWidth={2.2} />{:else}<Play size={size === "mini" ? 15 : 20} strokeWidth={2.2} />{/if}
  </button>
  <Waveform
    peaks={shown}
    {progress}
    size={size === "mini" ? "mini" : "big"}
    label={t("voice.seek", { name })}
    valuetext={t("voice.at", { at: clock(pos), total: clock(ms) })}
    onseek={seek}
  />
  <span class="time num">{clock(playing || pos > 0 ? pos : ms)}</span>
  <button type="button" class={["rate", "num", { fast: rate !== 1 }]} aria-label={t("voice.rate", { r: rateLabel(rate, getLang()) })} onclick={speed}>{rateLabel(rate, getLang())}</button>
</div>

<style>
  /* Bulle vocale : pilule au contour fin, fond un cran au-dessus de la surface. */
  .clip {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: var(--sp-3);
    min-width: 0;
    padding: 6px var(--sp-2) 6px 6px;
    border: 1px solid var(--hair-2);
    border-radius: var(--r-pill);
    background: var(--surface-2);
    box-shadow: var(--edge-hi);
  }
  .clip.mini {
    gap: var(--sp-2);
    max-width: 16rem;
    padding: 4px 6px 4px 4px;
  }
  .play {
    position: relative;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--accent);
    color: var(--on-accent);
    cursor: pointer;
    transition: transform var(--dur-press, 120ms) var(--ease-out);
  }
  .mini .play {
    width: 32px;
    height: 32px;
  }
  /* Zone tactile de 44 px autour du petit bouton. */
  .mini .play::after {
    content: "";
    position: absolute;
    inset: -6px;
  }
  .play:active {
    transform: scale(0.94);
  }
  .play:focus-visible,
  .rate:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .time {
    min-width: 2.6em;
    color: var(--text-2);
    font-size: var(--fs-small);
    font-variant-numeric: tabular-nums;
    text-align: end;
  }
  .mini .time {
    font-size: var(--fs-micro);
  }
  /* Pastille de vitesse, dans la bulle. */
  .rate {
    position: relative;
    min-width: 2.9em;
    height: 28px;
    padding: 0 var(--sp-2);
    border: 0;
    border-radius: var(--r-pill);
    background: var(--surface-3);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-micro);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition: transform var(--dur-press, 120ms) var(--ease-out);
  }
  .rate.fast {
    background: var(--accent-tint);
    color: var(--accent);
  }
  .mini .rate {
    min-width: 2.6em;
    height: 24px;
    padding: 0 6px;
  }
  .rate:active {
    transform: scale(0.94);
  }
  /* Zone tactile d'au moins 44 px. */
  .rate::after {
    content: "";
    position: absolute;
    inset: -10px -4px;
  }
  @media (prefers-reduced-motion: reduce) {
    .play,
    .rate {
      transition: none;
    }
  }
</style>
