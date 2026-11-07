// Prise de vue et enregistrement dans l'interface (spec §35.3, Q-REC1 acceptée) : photo par
// <canvas> (aucune métadonnée EXIF ni position par construction), vidéo et vocal par
// MediaRecorder. Tout reste en mémoire : rien n'est écrit sur l'appareil ni envoyé tel quel.
// Les pistes sont arrêtées dès qu'on n'en a plus besoin (stopStream). Aucun appel réseau.

export type CaptureMode = "photo" | "video" | "voice";
export type Facing = "user" | "environment";
/** indisponible : API absente ; refuse : permission refusée ; absent : aucun appareil ; occupe : déjà utilisé ; bloque : refusé par la page. */
export type CaptureError = "indisponible" | "refuse" | "absent" | "occupe" | "bloque" | "inconnu";

type MediaLike = { getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream> };
type RecorderStatic = { isTypeSupported?: (m: string) => boolean };

/** Durées maximales d'enregistrement (vidéo : 5 min à 2,5 Mbit/s ≈ 94 Mo ; vocal : 30 min). */
export const LIMIT_MS = { video: 300_000, voice: 1_800_000 } as const;
export const VIDEO_BPS = 2_500_000;

const MIMES = {
  voice: [
    ["audio/mp4;codecs=mp4a.40.2", "m4a"],
    ["audio/mp4", "m4a"],
    ["audio/webm;codecs=opus", "webm"],
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

/** Premier format accepté par le navigateur ; MP4 d'abord (lisible partout). */
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
  if (mode === "voice") return { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false };
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
    throw new CaptureFailure(errorKind(e));
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

type RecorderCtor = new (s: MediaStream, o: { mimeType: string; videoBitsPerSecond?: number }) => {
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
  o: { Recorder?: RecorderCtor; now?: () => number; onlimit?: () => void } = {},
): Recording {
  const Rec = o.Recorder ?? (globalThis.MediaRecorder as unknown as RecorderCtor);
  const now = o.now ?? (() => performance.now());
  const rec = new Rec(stream, mode === "video" ? { mimeType: picked.mime, videoBitsPerSecond: VIDEO_BPS } : { mimeType: picked.mime });
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
  const limit = setTimeout(() => o.onlimit?.(), LIMIT_MS[mode]);
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
