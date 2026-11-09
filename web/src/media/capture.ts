// Prise de vue et enregistrement dans l'interface (spec §35.3, Q-REC1 acceptée) : photo par
// <canvas> (aucune métadonnée EXIF ni position par construction), vidéo et vocal par
// MediaRecorder. Tout reste en mémoire : rien n'est écrit sur l'appareil ni envoyé tel quel.
// Les pistes sont arrêtées dès qu'on n'en a plus besoin (stopStream). Aucun appel réseau.
import { CAPTURE_MAX_S, CAPTURE_TIER, type CaptureTier } from "../limits";

export type CaptureMode = "photo" | "video" | "voice";
export type Facing = "user" | "environment";
/** indisponible : API absente ; refuse : permission refusée ; absent : aucun appareil ; occupe : déjà utilisé ; bloque : refusé par la page. */
export type CaptureError = "indisponible" | "refuse" | "absent" | "occupe" | "bloque" | "inconnu";

type MediaLike = { getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream> };
type RecorderStatic = { isTypeSupported?: (m: string) => boolean };

/** Débit vidéo plafonné : 5 min ≈ 94 Mo en mémoire. */
export const VIDEO_BPS = 2_500_000;
/** Débit des vocaux : meilleure qualité utile (Opus et AAC transparents pour la voix) ; ≈ 0,96 Mo par minute, ≈ 29 Mo pour 30 min. */
export const VOICE_BPS = 128_000;

/** Durée maximale d'enregistrement en ms (limits.ts : formule en vigueur par défaut). */
export function limitMs(mode: "video" | "voice", tier: CaptureTier = CAPTURE_TIER): number {
  return CAPTURE_MAX_S[tier][mode] * 1000;
}

/** Minuteur : « 4:12 », « 30:00 », « 1:02:05 » (secondes entières, arrondi vers le bas). */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const MIMES = {
  // Voix : Opus d'abord (meilleure qualité au même débit), AAC ensuite (Safari ancien).
  // Pas d'Ogg : strip-capture ne sait pas l'effacer, et tout navigateur qui fait de l'Ogg Opus fait aussi du WebM Opus.
  voice: [
    ["audio/webm;codecs=opus", "webm"],
    ["audio/mp4;codecs=mp4a.40.2", "m4a"],
    ["audio/mp4", "m4a"],
    ["audio/webm", "webm"],
  ],
  video: [
    ["video/mp4;codecs=avc1,mp4a", "mp4"],
    ["video/mp4", "mp4"],
    ["video/webm;codecs=vp9,opus", "webm"],
    ["video/webm;codecs=vp8,opus", "webm"],
    ["video/webm", "webm"],
  ],
} as const;

export type Picked = { mime: string; ext: string };

/** Premier format accepté par le navigateur, dans l'ordre de MIMES. */
export function pickMime(mode: "video" | "voice", isSupported: (m: string) => boolean): Picked | null {
  for (const [mime, ext] of MIMES[mode]) if (isSupported(mime)) return { mime, ext };
  return null;
}

/** Ce que l'appareil sait faire dans la page ; sinon, repli sur le sélecteur (<input capture>). */
export function captureSupport(g: { mediaDevices?: MediaLike; MediaRecorder?: RecorderStatic }): Record<CaptureMode, boolean> {
  const cam = typeof g.mediaDevices?.getUserMedia === "function";
  const sup = g.MediaRecorder?.isTypeSupported?.bind(g.MediaRecorder);
  return {
    photo: cam,
    video: cam && !!sup && pickMime("video", sup) !== null,
    voice: cam && !!sup && pickMime("voice", sup) !== null,
  };
}

export function constraintsFor(mode: CaptureMode, facing: Facing): MediaStreamConstraints {
  if (mode === "voice")
    return {
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: { ideal: 48_000 } },
      video: false,
    };
  const video = { facingMode: { ideal: facing }, width: { ideal: mode === "photo" ? 1920 : 1280 }, height: { ideal: mode === "photo" ? 1080 : 720 } };
  return { video, audio: mode === "video" };
}

export function errorKind(e: unknown): CaptureError {
  switch ((e as { name?: string } | null)?.name) {
    case "NotAllowedError":
      return "refuse";
    case "NotFoundError":
    case "OverconstrainedError":
      return "absent";
    case "NotReadableError":
    case "AbortError":
      return "occupe";
    case "SecurityError":
      return "bloque";
    default:
      return "inconnu";
  }
}

export class CaptureFailure extends Error {
  constructor(readonly kind: CaptureError) {
    super(kind);
  }
}

/** Ouvre la caméra et/ou le micro ; rejette avec un CaptureFailure typé. */
export async function openStream(media: MediaLike | undefined, mode: CaptureMode, facing: Facing): Promise<MediaStream> {
  if (typeof media?.getUserMedia !== "function") throw new CaptureFailure("indisponible");
  try {
    return await media.getUserMedia(constraintsFor(mode, facing));
  } catch (e) {
    // Vocal : contraintes de qualité refusées par l'appareil → micro brut plutôt qu'un échec.
    const name = (e as { name?: string } | null)?.name;
    if (mode !== "voice" || (name !== "OverconstrainedError" && name !== "TypeError")) throw new CaptureFailure(errorKind(e));
    try {
      return await media.getUserMedia({ audio: true, video: false });
    } catch (e2) {
      throw new CaptureFailure(errorKind(e2));
    }
  }
}

/** Éteint caméra et micro : chaque piste est arrêtée (le témoin du système s'éteint). */
export function stopStream(s: MediaStream | null | undefined): void {
  for (const t of s?.getTracks() ?? []) t.stop();
}

/** Image de l'aperçu → JPEG. Le canvas ne recopie que les pixels : ni EXIF, ni position, ni appareil. */
export function snapshot(video: HTMLVideoElement, quality = 0.92): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width === 0) return Promise.reject(new CaptureFailure("inconnu"));
  ctx.drawImage(video, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new CaptureFailure("inconnu"))), "image/jpeg", quality));
}

type RecorderCtor = new (s: MediaStream, o: { mimeType: string; videoBitsPerSecond?: number; audioBitsPerSecond?: number }) => {
  state: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  start(timeslice?: number): void;
  stop(): void;
};

export type Recording = { stop(): Promise<Blob>; cancel(): void; elapsedMs(): number };

export function startRecorder(
  stream: MediaStream,
  picked: Picked,
  mode: "video" | "voice",
  o: { Recorder?: RecorderCtor; now?: () => number; onlimit?: () => void; maxMs?: number } = {},
): Recording {
  const Rec = o.Recorder ?? (globalThis.MediaRecorder as unknown as RecorderCtor);
  const now = o.now ?? (() => performance.now());
  const rec = new Rec(stream, mode === "video" ? { mimeType: picked.mime, videoBitsPerSecond: VIDEO_BPS } : { mimeType: picked.mime, audioBitsPerSecond: VOICE_BPS });
  const chunks: Blob[] = [];
  let cancelled = false;
  const type = picked.mime.split(";")[0]!;
  const done = new Promise<Blob>((resolve) => {
    rec.ondataavailable = (e) => {
      if (!cancelled && e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => resolve(new Blob(chunks, { type }));
  });
  const t0 = now();
  rec.start(1000);
  const limit = setTimeout(() => o.onlimit?.(), o.maxMs ?? limitMs(mode));
  const halt = () => {
    clearTimeout(limit);
    if (rec.state !== "inactive") rec.stop();
  };
  return {
    stop() {
      halt();
      return done;
    },
    cancel() {
      cancelled = true;
      chunks.length = 0;
      halt();
    },
    elapsedMs: () => now() - t0,
  };
}
