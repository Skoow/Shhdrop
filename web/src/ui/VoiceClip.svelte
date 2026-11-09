<script lang="ts">
  // Réécoute d'un vocal en mémoire (Task 12) : lecture / pause, onde qui se colore avec la
  // progression, toucher ou glisser sur l'onde pour se déplacer, durée. L'URL blob n'existe que
  // pendant la lecture du composant et est révoquée à sa sortie. Rien n'est écrit sur l'appareil.
  import { t } from "../i18n/i18n.svelte";
  import { clock } from "../media/capture";
  import { MINI_BARS, resample } from "../media/recorder";
  import { Pause, Play } from "./Icon";
  import Waveform from "./Waveform.svelte";

  type Props = { blob: Blob; peaks: readonly number[]; ms: number; name: string; size?: "big" | "mini" };
  let { blob, peaks, ms, name, size = "big" }: Props = $props();

  const shown = $derived(size === "mini" ? resample(peaks, MINI_BARS) : peaks);
  let playing = $state(false);
  let pos = $state(0); // ms
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;
  let raf = 0;

  function ensure(): HTMLAudioElement {
    if (audio) return audio;
    url = URL.createObjectURL(blob);
    const a = new Audio(url);
    a.preload = "auto";
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
    {#if playing}<Pause size={size === "mini" ? 14 : 20} strokeWidth={2.2} />{:else}<Play size={size === "mini" ? 14 : 20} strokeWidth={2.2} />{/if}
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
</div>

<style>
  .clip {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--sp-3);
    min-width: 0;
  }
  .clip.mini {
    gap: var(--sp-2);
    max-width: 15rem;
  }
  .play {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--accent);
    color: var(--on-accent);
    cursor: pointer;
    transition: transform var(--dur-press, 120ms) var(--ease-out);
  }
  .mini .play {
    position: relative;
    width: 28px;
    height: 28px;
    background: var(--accent-tint);
    color: var(--accent);
  }
  /* Zone tactile de 44 px autour du petit bouton. */
  .mini .play::after {
    content: "";
    position: absolute;
    inset: -8px;
  }
  .play:active {
    transform: scale(0.94);
  }
  .play:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .time {
    min-width: 3.2em;
    color: var(--text-2);
    font-size: var(--fs-small);
    font-variant-numeric: tabular-nums;
    text-align: end;
  }
  .mini .time {
    min-width: 2.6em;
  }
  @media (prefers-reduced-motion: reduce) {
    .play {
      transition: none;
    }
  }
</style>
