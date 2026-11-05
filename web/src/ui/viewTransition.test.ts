// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTransition, STALL_MS } from "./viewTransition";

type Doc = { startViewTransition?: unknown };
afterEach(() => {
  delete (document as unknown as Doc).startViewTransition;
  document.documentElement.className = "";
  vi.unstubAllGlobals();
});

/** API simulée : le rappel est appelé tout de suite ; `finished` se résout quand on le décide. */
function fakeApi() {
  let finish!: () => void;
  const finished = new Promise<void>((r) => (finish = r));
  const skipTransition = vi.fn(() => finish());
  const start = vi.fn((cb: () => void) => {
    let done: Promise<void>;
    try {
      cb();
      done = Promise.resolve();
    } catch (e) {
      done = Promise.reject(e);
      done.catch(() => undefined);
    }
    return { finished, updateCallbackDone: done, skipTransition };
  });
  (document as unknown as Doc).startViewTransition = start;
  return { start, skipTransition, finish };
}

describe("runTransition (UI §20.2 K2)", () => {
  it("sans startViewTransition : update appelé une fois, de façon synchrone", () => {
    const update = vi.fn();
    const p = runTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
    return p;
  });

  it("avec l'API : skipTransition au premier pointerdown, écouteurs retirés ensuite", async () => {
    const api = fakeApi();
    const update = vi.fn();
    const p = runTransition(update, { reduced: false });
    expect(api.start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event("pointerdown"));
    expect(api.skipTransition).toHaveBeenCalledTimes(1);
    await p;
    document.dispatchEvent(new Event("keydown"));
    expect(api.skipTransition).toHaveBeenCalledTimes(1);
  });

  it("avec l'API : une touche saute aussi la transition", async () => {
    const api = fakeApi();
    const p = runTransition(() => undefined, { reduced: false });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(api.skipTransition).toHaveBeenCalledTimes(1);
    await p;
  });

  it("reduced: true → classe vt-reduced posée pendant la transition, retirée après", async () => {
    const api = fakeApi();
    const p = runTransition(() => undefined, { reduced: true });
    expect(document.documentElement.classList.contains("vt-reduced")).toBe(true);
    api.finish();
    await p;
    expect(document.documentElement.classList.contains("vt-reduced")).toBe(false);
  });

  it("reduced par défaut : suit prefers-reduced-motion", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduced-motion"), media: q }));
    const api = fakeApi();
    const p = runTransition(() => undefined);
    expect(document.documentElement.classList.contains("vt-reduced")).toBe(true);
    api.finish();
    await p;
  });

  it("le rappel lève : l'erreur remonte", async () => {
    const api = fakeApi();
    const p = runTransition(() => {
      throw new Error("boom");
    }, { reduced: false });
    api.finish();
    await expect(p).rejects.toThrow("boom");
  });

  it("rappel jamais appelé (peinture bloquée) : la transition saute après STALL_MS et la mise à jour a lieu", async () => {
    vi.useFakeTimers();
    try {
      let cb!: () => void;
      let finish!: () => void;
      const finished = new Promise<void>((r) => (finish = r));
      const skipTransition = vi.fn(() => {
        cb(); // comme le navigateur : sauter avant l'appel du rappel l'appelle aussitôt
        finish();
      });
      (document as unknown as Doc).startViewTransition = vi.fn((c: () => void) => {
        cb = c;
        return { finished, updateCallbackDone: Promise.resolve(), skipTransition };
      });
      const update = vi.fn();
      const p = runTransition(update, { reduced: false });
      vi.advanceTimersByTime(STALL_MS - 1);
      expect(skipTransition).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(skipTransition).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledTimes(1);
      await p;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rappel appelé à temps : aucun saut forcé", async () => {
    vi.useFakeTimers();
    try {
      const api = fakeApi();
      const p = runTransition(() => undefined, { reduced: false });
      vi.advanceTimersByTime(STALL_MS * 3);
      expect(api.skipTransition).not.toHaveBeenCalled();
      api.finish();
      await p;
    } finally {
      vi.useRealTimers();
    }
  });
});
