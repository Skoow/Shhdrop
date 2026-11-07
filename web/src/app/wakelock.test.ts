import { describe, expect, it, vi } from "vitest";
import { createWakeLock } from "./wakelock";

function fakeDoc() {
  const listeners: (() => void)[] = [];
  const doc = {
    visibilityState: "visible",
    addEventListener: (_: string, f: () => void) => listeners.push(f),
    removeEventListener: vi.fn(),
  };
  return { doc: doc as unknown as Document, set: (v: string) => ((doc.visibilityState = v), listeners.forEach((f) => f())) };
}

describe("verrou d'écran (UI §9.4.3)", () => {
  it("demande, relâche, redemande au retour en visible ; sans API : sans effet", async () => {
    const release = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ release }));
    const d = fakeDoc();
    const w = createWakeLock({ wakeLock: { request } }, d.doc);
    w.acquire();
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith("screen");
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    d.set("hidden");
    d.set("visible");
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    w.release();
    expect(release).toHaveBeenCalledTimes(1);
    d.set("hidden");
    d.set("visible");
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    const none = createWakeLock({}, fakeDoc().doc);
    expect(() => (none.acquire(), none.release())).not.toThrow();
  });
});
