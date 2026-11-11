import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STALL_MS, stallGuard } from "./stall";

class FakeMedia extends EventTarget {
  readyState = 0;
  error: MediaError | null = null;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("stallGuard (lecteur qui ne lit ni ne signale d'erreur)", () => {
  it("rien chargé après STALL_MS → onstall, une seule fois", () => {
    const el = new FakeMedia();
    const onstall = vi.fn();
    stallGuard(el, { onstall });
    vi.advanceTimersByTime(STALL_MS - 1);
    expect(onstall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onstall).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(STALL_MS * 3);
    expect(onstall).toHaveBeenCalledTimes(1);
  });

  it("métadonnées reçues → jamais onstall", () => {
    const el = new FakeMedia();
    const onstall = vi.fn();
    stallGuard(el, { onstall });
    el.readyState = 1;
    el.dispatchEvent(new Event("loadedmetadata"));
    vi.advanceTimersByTime(STALL_MS * 2);
    expect(onstall).not.toHaveBeenCalled();
  });

  it("erreur déjà signalée → pas d'appel en double (onerror du lecteur s'en charge)", () => {
    const el = new FakeMedia();
    const onstall = vi.fn();
    stallGuard(el, { onstall });
    el.dispatchEvent(new Event("error"));
    vi.advanceTimersByTime(STALL_MS * 2);
    expect(onstall).not.toHaveBeenCalled();
  });

  it("données arrivées sans l'événement (readyState > 0) → pas d'appel", () => {
    const el = new FakeMedia();
    const onstall = vi.fn();
    stallGuard(el, { onstall });
    el.readyState = 2;
    vi.advanceTimersByTime(STALL_MS);
    expect(onstall).not.toHaveBeenCalled();
  });

  it("lecteur retiré avant l'échéance (élément suivant) → pas d'appel", () => {
    const el = new FakeMedia();
    const onstall = vi.fn();
    stallGuard(el, { onstall }).destroy();
    vi.advanceTimersByTime(STALL_MS * 2);
    expect(onstall).not.toHaveBeenCalled();
  });
});
