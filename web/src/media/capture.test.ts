import { describe, expect, it, vi } from "vitest";
import { captureSupport, clock, constraintsFor, errorKind, limitMs, openStream, pickMime, startRecorder, stopStream } from "./capture";

/** Faux MediaStream : des pistes dont on suit l'arrêt. */
function fakeStream(kinds: ("audio" | "video")[] = ["video", "audio"]) {
  const tracks = kinds.map((kind) => ({ kind, readyState: "live" as "live" | "ended", stop: vi.fn(function (this: { readyState: string }) { this.readyState = "ended"; }) }));
  return { getTracks: () => tracks, tracks } as unknown as MediaStream & { tracks: typeof tracks };
}
const dom = (name: string) => Object.assign(new Error(name), { name });

describe("capacités (repli sur le sélecteur sans elles)", () => {
  const media = { getUserMedia: async () => fakeStream() };
  it("photo : getUserMedia suffit ; vidéo et vocal : MediaRecorder et un format aussi", () => {
    const rec = { isTypeSupported: (m: string) => m.startsWith("video/webm") || m.startsWith("audio/webm") };
    expect(captureSupport({ mediaDevices: media, MediaRecorder: rec })).toEqual({ photo: true, video: true, voice: true });
    expect(captureSupport({ mediaDevices: media })).toEqual({ photo: true, video: false, voice: false });
    expect(captureSupport({})).toEqual({ photo: false, video: false, voice: false });
    expect(captureSupport({ mediaDevices: {} as never, MediaRecorder: rec })).toEqual({ photo: false, video: false, voice: false });
  });
  it("pickMime : vocal en Opus d'abord, AAC sinon (Safari), jamais d'Ogg ; vidéo MP4 d'abord ; null si rien", () => {
    expect(pickMime("voice", () => true)).toEqual({ mime: "audio/webm;codecs=opus", ext: "webm" });
    const safari = (m: string) => m.startsWith("audio/mp4");
    expect(pickMime("voice", safari)).toEqual({ mime: "audio/mp4;codecs=mp4a.40.2", ext: "m4a" });
    expect(pickMime("voice", (m) => m === "audio/ogg;codecs=opus")).toBeNull();
    expect(pickMime("video", (m) => m === "video/mp4")).toEqual({ mime: "video/mp4", ext: "mp4" });
    expect(pickMime("video", (m) => m === "video/webm;codecs=vp8,opus")).toEqual({ mime: "video/webm;codecs=vp8,opus", ext: "webm" });
    expect(pickMime("video", () => false)).toBeNull();
  });
});

describe("demandes au navigateur", () => {
  it("photo : caméra seule ; vidéo : caméra et micro ; vocal : micro seul, jamais la caméra", () => {
    expect(constraintsFor("photo", "environment")).toMatchObject({ audio: false, video: { facingMode: { ideal: "environment" } } });
    expect(constraintsFor("video", "user")).toMatchObject({ audio: true, video: { facingMode: { ideal: "user" } } });
    const v = constraintsFor("voice", "user");
    expect(v.video).toBe(false);
    expect(v.audio).toEqual({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: { ideal: 48_000 } });
  });
  it("openStream vocal : contraintes refusées → nouvel essai avec le micro brut ; refus de permission → pas de nouvel essai", async () => {
    const ok = { getTracks: () => [] } as unknown as MediaStream;
    const calls: MediaStreamConstraints[] = [];
    const over = { getUserMedia: async (c: MediaStreamConstraints) => (calls.push(c), calls.length === 1 ? Promise.reject(dom("OverconstrainedError")) : ok) };
    await expect(openStream(over, "voice", "user")).resolves.toBe(ok);
    expect(calls[1]).toEqual({ audio: true, video: false });
    let n = 0;
    const refuse = { getUserMedia: async () => (n++, Promise.reject(dom("NotAllowedError"))) };
    await expect(openStream(refuse, "voice", "user")).rejects.toMatchObject({ kind: "refuse" });
    expect(n).toBe(1);
    let m = 0;
    const photo = { getUserMedia: async () => (m++, Promise.reject(dom("OverconstrainedError"))) };
    await expect(openStream(photo, "photo", "environment")).rejects.toMatchObject({ kind: "absent" });
    expect(m).toBe(1);
  });
  it("erreurs : permission refusée, aucun appareil, occupé, bloqué par la page, autre", () => {
    expect(errorKind(dom("NotAllowedError"))).toBe("refuse");
    expect(errorKind(dom("NotFoundError"))).toBe("absent");
    expect(errorKind(dom("OverconstrainedError"))).toBe("absent");
    expect(errorKind(dom("NotReadableError"))).toBe("occupe");
    expect(errorKind(dom("SecurityError"))).toBe("bloque");
    expect(errorKind(new Error("x"))).toBe("inconnu");
  });
  it("openStream : API absente → « absent » sans appel ; refus → erreur typée", async () => {
    await expect(openStream(undefined, "photo", "environment")).rejects.toMatchObject({ kind: "indisponible" });
    const refuse = { getUserMedia: vi.fn(async () => { throw dom("NotAllowedError"); }) };
    await expect(openStream(refuse, "photo", "environment")).rejects.toMatchObject({ kind: "refuse" });
    const ok = fakeStream();
    await expect(openStream({ getUserMedia: async () => ok }, "photo", "environment")).resolves.toBe(ok);
  });
  it("stopStream : toutes les pistes arrêtées (caméra et micro éteints), sans erreur sur null", () => {
    const s = fakeStream();
    stopStream(s);
    expect(s.tracks.every((t) => t.stop.mock.calls.length === 1 && t.readyState === "ended")).toBe(true);
    expect(() => stopStream(null)).not.toThrow();
  });
});

describe("enregistreur", () => {
  class FakeRecorder {
    static last: FakeRecorder;
    state = "inactive";
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(public stream: MediaStream, public opts: { mimeType: string; videoBitsPerSecond?: number }) {
      FakeRecorder.last = this;
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob([new Uint8Array(5)]) });
      this.onstop?.();
    }
  }

  it("stop : Blob du bon type ; débit vidéo plafonné ; durée suivie", async () => {
    let now = 1000;
    const r = startRecorder(fakeStream(), { mime: "video/webm", ext: "webm" }, "video", { Recorder: FakeRecorder as never, now: () => now });
    expect(FakeRecorder.last.opts).toEqual({ mimeType: "video/webm", videoBitsPerSecond: 2_500_000 });
    now = 4500;
    expect(r.elapsedMs()).toBe(3500);
    const blob = await r.stop();
    expect(blob.type).toBe("video/webm");
    expect(blob.size).toBe(5);
  });
  it("arrêt automatique à la durée maximale de la formule en vigueur (gratuit : vidéo 5 min, vocal 30 min)", async () => {
    vi.useFakeTimers();
    try {
      expect(limitMs("video")).toBe(300_000);
      expect(limitMs("voice")).toBe(1_800_000);
      expect(limitMs("video", "plus")).toBe(900_000);
      expect(limitMs("voice", "pro")).toBe(7_200_000);
      const onlimit = vi.fn();
      startRecorder(fakeStream(["audio"]), { mime: "audio/webm", ext: "webm" }, "voice", { Recorder: FakeRecorder as never, onlimit });
      vi.advanceTimersByTime(1_799_999);
      expect(onlimit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onlimit).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
  it("cancel : rien n'est rendu, l'enregistreur s'arrête", () => {
    const r = startRecorder(fakeStream(), { mime: "video/webm", ext: "webm" }, "video", { Recorder: FakeRecorder as never });
    r.cancel();
    expect(FakeRecorder.last.state).toBe("inactive");
  });
});

describe("minuteur affiché (« 4:12 / 5:00 maximum »)", () => {
  it("m:ss sous une heure, h:mm:ss au-delà ; jamais négatif", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(252_400)).toBe("4:12");
    expect(clock(300_000)).toBe("5:00");
    expect(clock(1_800_000)).toBe("30:00");
    expect(clock(7_200_000)).toBe("2:00:00");
    expect(clock(3_725_000)).toBe("1:02:05");
    expect(clock(-5)).toBe("0:00");
  });
});
