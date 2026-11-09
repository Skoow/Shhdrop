// Enregistreur vocal (Task 12) : faux MediaRecorder, faux flux, fausse horloge.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MINI_BARS, RATES, WAVE_BARS, decodeWave, levelOf, nextRate, peaks, rateLabel, resample, seekRatio, startVoice, type AudioCtxCtor, type VoiceRecorderCtor } from "./recorder";

class FakeRec {
  static last: FakeRec;
  state = "inactive";
  calls: string[] = [];
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    readonly stream: MediaStream,
    readonly opts: { mimeType: string },
  ) {
    FakeRec.last = this;
  }
  start() {
    this.state = "recording";
    this.calls.push("start");
  }
  pause() {
    this.state = "paused";
    this.calls.push("pause");
  }
  resume() {
    this.state = "recording";
    this.calls.push("resume");
  }
  stop() {
    this.state = "inactive";
    this.calls.push("stop");
    this.ondataavailable?.({ data: new Blob(["voix"]) });
    this.onstop?.();
  }
}

function fakeStream() {
  const tracks = [{ stop: vi.fn(), kind: "audio" }];
  return { stream: { getTracks: () => tracks } as unknown as MediaStream, tracks };
}

function fakeAudio(samples: number[]) {
  const closed = vi.fn(async () => undefined);
  class Ctx {
    createMediaStreamSource() {
      return { connect: () => undefined, disconnect: () => undefined };
    }
    createAnalyser() {
      return {
        fftSize: 0,
        getFloatTimeDomainData(a: Float32Array) {
          for (let i = 0; i < a.length; i++) a[i] = samples[i % samples.length]!;
        },
      };
    }
    close = closed;
  }
  return { Audio: Ctx as unknown as AudioCtxCtor, closed };
}

const PICK = { mime: "audio/webm;codecs=opus", ext: "webm" };
let t = 0;
const now = () => t;
beforeEach(() => {
  t = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("startVoice", () => {
  it("enregistrement → pause (minuteur figé) → reprise → arrêt : fichier typé, pistes et contexte arrêtés", async () => {
    const { stream, tracks } = fakeStream();
    const { Audio, closed } = fakeAudio([0.3, -0.3]);
    const r = startVoice(stream, PICK, { Recorder: FakeRec as unknown as VoiceRecorderCtor, Audio, now, maxMs: 60_000 });
    expect(r.state()).toBe("recording");
    t = 2000;
    expect(r.elapsedMs()).toBe(2000);
    expect(r.level()).toBeGreaterThan(0.5);
    r.pause();
    expect(r.state()).toBe("paused");
    t = 9000;
    expect(r.elapsedMs()).toBe(2000); // figé pendant la pause
    expect(r.level()).toBe(0);
    r.resume();
    t = 10_500;
    expect(r.elapsedMs()).toBe(3500);
    const blob = await r.stop();
    expect(blob.type).toBe("audio/webm");
    expect(await blob.text()).toBe("voix");
    expect(FakeRec.last.calls).toEqual(["start", "pause", "resume", "stop"]);
    expect(r.state()).toBe("stopped");
    expect(r.elapsedMs()).toBe(3500);
    expect(tracks[0]!.stop).toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
  });

  it("annulation : rien n'est gardé, pistes arrêtées, contexte fermé", async () => {
    const { stream, tracks } = fakeStream();
    const { Audio, closed } = fakeAudio([0]);
    const r = startVoice(stream, PICK, { Recorder: FakeRec as unknown as VoiceRecorderCtor, Audio, now, maxMs: 60_000 });
    r.cancel();
    expect(tracks[0]!.stop).toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
    expect((await r.stop()).size).toBe(0);
  });

  it("durée maximale : onlimit au temps enregistré, pauses exclues", () => {
    const { stream } = fakeStream();
    const onlimit = vi.fn();
    const r = startVoice(stream, PICK, { Recorder: FakeRec as unknown as VoiceRecorderCtor, Audio: null, now, maxMs: 5000, onlimit });
    vi.advanceTimersByTime(3000);
    t = 3000;
    r.pause();
    vi.advanceTimersByTime(10_000);
    t = 13_000;
    expect(onlimit).not.toHaveBeenCalled();
    r.resume();
    vi.advanceTimersByTime(1999);
    expect(onlimit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onlimit).toHaveBeenCalledTimes(1);
    expect(r.level()).toBe(0); // sans Web Audio : onde au repos, enregistrement normal
  });

  it("pause et reprise ignorées hors de leur état", () => {
    const { stream } = fakeStream();
    const r = startVoice(stream, PICK, { Recorder: FakeRec as unknown as VoiceRecorderCtor, Audio: null, now, maxMs: 5000 });
    r.resume();
    r.pause();
    r.pause();
    expect(FakeRec.last.calls).toEqual(["start", "pause"]);
  });
});

describe("onde", () => {
  it("levelOf : silence 0, plein niveau 1, borné", () => {
    expect(levelOf([0, 0, 0])).toBe(0);
    expect(levelOf([1, -1])).toBe(1);
    const mid = levelOf([0.01, -0.01]);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.5);
  });

  it("peaks : nombre de barres fixe, plus forte à 1, silence au plancher, canaux mélangés", () => {
    const n = 6000;
    const ch = Float32Array.from({ length: n }, (_, i) => (i < n / 2 ? 0 : Math.sin(i) * 0.5));
    const p = peaks([ch], WAVE_BARS);
    expect(p).toHaveLength(WAVE_BARS);
    expect(Math.max(...p)).toBe(1);
    expect(p[0]).toBe(0.06);
    expect(p[WAVE_BARS - 1]).toBeGreaterThan(0.8);
    expect(peaks([], 10)).toEqual(new Array(10).fill(0.06));
    expect(peaks([new Float32Array(100)], 4)).toEqual([0.06, 0.06, 0.06, 0.06]);
    // Plus court que le nombre de barres : jamais NaN.
    expect(peaks([Float32Array.from([0.5, 0.2])], 5).every((v) => v >= 0.06 && v <= 1)).toBe(true);
  });

  it("resample et seekRatio", () => {
    expect(resample([1, 0, 1, 0], 2)).toEqual([0.5, 0.5]);
    expect(resample(new Array(WAVE_BARS).fill(0.4), MINI_BARS)).toHaveLength(MINI_BARS);
    expect(seekRatio(50, 0, 200)).toBe(0.25);
    expect(seekRatio(-10, 0, 200)).toBe(0);
    expect(seekRatio(500, 0, 200)).toBe(1);
    expect(seekRatio(5, 0, 0)).toBe(0);
  });

  it("decodeWave : forme d'onde et durée depuis l'audio décodé ; échec de décodage → null", async () => {
    const data = Float32Array.from({ length: 8000 }, (_, i) => Math.sin(i / 3));
    class Ok {
      async decodeAudioData() {
        return { numberOfChannels: 1, duration: 1.25, getChannelData: () => data } as unknown as AudioBuffer;
      }
    }
    class Ko {
      async decodeAudioData(): Promise<AudioBuffer> {
        throw new Error("format");
      }
    }
    const w = await decodeWave(new Blob(["x"]), 12, Ok);
    expect(w?.ms).toBe(1250);
    expect(w?.peaks).toHaveLength(12);
    expect(await decodeWave(new Blob(["x"]), 12, Ko)).toBeNull();
  });
});

describe("vitesse de lecture", () => {
  it("alterne 1× → 1,5× → 2× → 1×, et revient à 1× sur une valeur inconnue", () => {
    expect(RATES).toEqual([1, 1.5, 2]);
    expect(nextRate(1)).toBe(1.5);
    expect(nextRate(1.5)).toBe(2);
    expect(nextRate(2)).toBe(1);
    expect(nextRate(3)).toBe(1);
  });
  it("libellé selon la langue", () => {
    expect(rateLabel(1.5, "fr")).toBe("1,5×");
    expect(rateLabel(1.5, "en")).toBe("1.5×");
    expect(rateLabel(2, "fr")).toBe("2×");
  });
});
