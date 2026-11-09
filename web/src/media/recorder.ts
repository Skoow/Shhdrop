// Vocal enregistré dans l'interface (spec §35.3, Task 12) : MediaRecorder avec pause et reprise,
// minuteur qui exclut les pauses, arrêt propre à la durée maximale (limits.ts), niveau du micro
// lu par un AnalyserNode (onde vivante) et forme d'onde calculée depuis l'audio décodé pour la
// réécoute. Tout reste en mémoire ; à l'arrêt ou à l'annulation, chaque piste du micro est
// arrêtée (`track.stop()`) et le contexte audio fermé. Aucun appel réseau.
import { stopStream, type Picked } from "./capture";

export type VoiceState = "recording" | "paused" | "stopped";

type RecorderLike = {
  state: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  start(timeslice?: number): void;
  stop(): void;
  pause(): void;
  resume(): void;
};
export type VoiceRecorderCtor = new (s: MediaStream, o: { mimeType: string }) => RecorderLike;

type AnalyserLike = { fftSize: number; getFloatTimeDomainData(a: Float32Array<ArrayBuffer>): void };
type AudioCtxLike = {
  createMediaStreamSource(s: MediaStream): { connect(n: unknown): unknown; disconnect(): void };
  createAnalyser(): AnalyserLike;
  close(): Promise<void>;
};
export type AudioCtxCtor = new () => AudioCtxLike;

export type VoiceRecording = {
  state(): VoiceState;
  pause(): void;
  resume(): void;
  /** Fin : le fichier en mémoire ; micro éteint. */
  stop(): Promise<Blob>;
  /** Abandon : rien n'est gardé ; micro éteint. */
  cancel(): void;
  /** Temps enregistré, pauses exclues. */
  elapsedMs(): number;
  /** Niveau du micro, de 0 à 1 (0 en pause, ou sans analyseur). */
  level(): number;
};

/** RMS d'un échantillon → 0..1 sur une échelle en décibels (−60 dB → 0, −10 dB → 1). */
export function levelOf(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  if (rms <= 0) return 0;
  return Math.min(1, Math.max(0, (20 * Math.log10(rms) + 60) / 50));
}

export function startVoice(
  stream: MediaStream,
  picked: Picked,
  o: { Recorder?: VoiceRecorderCtor; Audio?: AudioCtxCtor | null; now?: () => number; maxMs: number; onlimit?: () => void },
): VoiceRecording {
  const Rec = o.Recorder ?? (globalThis.MediaRecorder as unknown as VoiceRecorderCtor);
  const now = o.now ?? (() => performance.now());
  const rec = new Rec(stream, { mimeType: picked.mime });
  const chunks: Blob[] = [];
  const type = picked.mime.split(";")[0]!;
  let cancelled = false;
  const done = new Promise<Blob>((resolve) => {
    rec.ondataavailable = (e) => {
      if (!cancelled && e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => resolve(new Blob(cancelled ? [] : chunks, { type }));
  });

  // Analyseur facultatif : sans Web Audio, l'enregistrement marche, l'onde reste au repos.
  let ctx: AudioCtxLike | null = null;
  let analyser: AnalyserLike | null = null;
  let buf: Float32Array<ArrayBuffer> | null = null;
  const Audio = o.Audio === undefined ? (globalThis.AudioContext as unknown as AudioCtxCtor | undefined) : o.Audio;
  if (Audio) {
    try {
      ctx = new Audio();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      buf = new Float32Array(analyser.fftSize);
    } catch {
      analyser = null;
    }
  }

  let state: VoiceState = "recording";
  let acc = 0; // temps enregistré avant la reprise en cours
  let since = now();
  let limit: ReturnType<typeof setTimeout> | undefined;
  const elapsed = () => (state === "recording" ? acc + now() - since : acc);
  const arm = () => {
    clearTimeout(limit);
    limit = setTimeout(() => o.onlimit?.(), Math.max(0, o.maxMs - elapsed()));
  };
  const halt = () => {
    clearTimeout(limit);
    if (state === "recording") acc += now() - since;
    state = "stopped";
    if (rec.state !== "inactive") rec.stop();
    stopStream(stream);
    void ctx?.close().catch(() => undefined);
    ctx = null;
    analyser = null;
  };

  rec.start(1000);
  arm();
  return {
    state: () => state,
    pause() {
      if (state !== "recording") return;
      acc += now() - since;
      state = "paused";
      clearTimeout(limit);
      rec.pause();
    },
    resume() {
      if (state !== "paused") return;
      since = now();
      state = "recording";
      rec.resume();
      arm();
    },
    stop() {
      halt();
      return done;
    },
    cancel() {
      cancelled = true;
      chunks.length = 0;
      halt();
    },
    elapsedMs: () => Math.min(elapsed(), o.maxMs),
    level() {
      if (state !== "recording" || !analyser || !buf) return 0;
      analyser.getFloatTimeDomainData(buf);
      return levelOf(buf);
    },
  };
}

/** Barres de la forme d'onde affichée à la réécoute. */
export const WAVE_BARS = 60;
/** Barres de la mini-onde sur la ligne du composeur. */
export const MINI_BARS = 28;
/** Barres de l'onde vivante pendant l'enregistrement. */
export const LIVE_BARS = 40;
const FLOOR = 0.06;

/**
 * Forme d'onde : RMS de chaque tranche (canaux mélangés), normalisée sur la plus forte,
 * plancher visible de 0,06 (le silence reste un trait). Toujours `bars` valeurs dans [0,06 ; 1].
 */
export function peaks(channels: readonly ArrayLike<number>[], bars = WAVE_BARS): number[] {
  const n = channels[0]?.length ?? 0;
  const out = new Array<number>(bars).fill(0);
  if (n === 0) return out.map(() => FLOOR);
  for (let b = 0; b < bars; b++) {
    const a = Math.floor((b * n) / bars);
    const z = Math.max(a + 1, Math.floor(((b + 1) * n) / bars));
    let sum = 0;
    for (const ch of channels) for (let i = a; i < z && i < n; i++) sum += ch[i]! * ch[i]!;
    out[b] = Math.sqrt(sum / ((z - a) * channels.length));
  }
  const max = Math.max(...out);
  return out.map((v) => (max > 0 ? Math.max(FLOOR, Math.round((v / max) * 1000) / 1000) : FLOOR));
}

/** Rééchantillonne une forme d'onde (moyenne par tranche) : mini-onde de la ligne. */
export function resample(p: readonly number[], bars: number): number[] {
  if (p.length === 0) return new Array<number>(bars).fill(FLOOR);
  return Array.from({ length: bars }, (_, b) => {
    const a = Math.floor((b * p.length) / bars);
    const z = Math.max(a + 1, Math.floor(((b + 1) * p.length) / bars));
    let s = 0;
    for (let i = a; i < z; i++) s += p[i]!;
    return s / (z - a);
  });
}

type OfflineCtor = new (channels: number, length: number, rate: number) => { decodeAudioData(b: ArrayBuffer): Promise<AudioBuffer> };
/** Fréquence de décodage basse : 30 min de vocal ≈ 58 Mo par canal, le temps du calcul. */
const DECODE_RATE = 8000;

/** Décode le vocal en mémoire pour sa forme d'onde et sa durée ; null si le navigateur ne sait pas. */
export async function decodeWave(blob: Blob, bars = WAVE_BARS, Offline?: OfflineCtor): Promise<{ peaks: number[]; ms: number } | null> {
  const Ctor = Offline ?? (globalThis.OfflineAudioContext as unknown as OfflineCtor | undefined);
  if (!Ctor) return null;
  try {
    const audio = await new Ctor(1, 1, DECODE_RATE).decodeAudioData(await blob.arrayBuffer());
    const chans = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    return { peaks: peaks(chans, bars), ms: Math.round(audio.duration * 1000) };
  } catch {
    return null;
  }
}

/** Position de lecture (0 à 1) d'un toucher à `x` sur une onde qui va de `left` à `left + width`. */
export function seekRatio(x: number, left: number, width: number): number {
  if (!(width > 0)) return 0;
  return Math.min(1, Math.max(0, (x - left) / width));
}

/** Vitesses de lecture d'un vocal, dans l'ordre du bouton (1× → 1,5× → 2× → 1×). */
export const RATES = [1, 1.5, 2] as const;
export function nextRate(r: number): number {
  const i = RATES.indexOf(r as (typeof RATES)[number]);
  return RATES[(i + 1) % RATES.length]!;
}
/** « 1,5× » en français, « 1.5× » en anglais. */
export function rateLabel(r: number, lang: string): string {
  return `${new Intl.NumberFormat(lang).format(r)}×`;
}
