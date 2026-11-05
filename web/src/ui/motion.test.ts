// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flip, reducedMotion } from "./motion";

function stubMedia(reduce: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduced-motion"), media: q }));
}
afterEach(() => vi.unstubAllGlobals());

function box(top: number) {
  const el = document.createElement("li");
  let y = top;
  el.getBoundingClientRect = () => ({ top: y, left: 0, width: 100, height: 40 }) as DOMRect;
  const animate = vi.fn(() => ({ finished: Promise.resolve() }));
  (el as unknown as { animate: unknown }).animate = animate;
  return { el, animate, moveTo: (v: number) => void (y = v) };
}

describe("reducedMotion", () => {
  it("suit la préférence à chaud", () => {
    stubMedia(false);
    expect(reducedMotion()).toBe(false);
    stubMedia(true);
    expect(reducedMotion()).toBe(true);
  });
  it("sans matchMedia : faux", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(reducedMotion()).toBe(false);
  });
});

describe("flip", () => {
  it("mouvement réduit : mutate appelé, aucune animation", async () => {
    stubMedia(true);
    const a = box(0);
    const mutate = vi.fn(() => a.moveTo(50));
    await flip([a.el], mutate);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(a.animate).not.toHaveBeenCalled();
  });
  it("sinon : anime seulement transform (et opacity exclue) pour les éléments déplacés", async () => {
    stubMedia(false);
    const a = box(0);
    const b = box(40);
    await flip([a.el, b.el], () => a.moveTo(40));
    expect(a.animate).toHaveBeenCalledTimes(1);
    expect(b.animate).not.toHaveBeenCalled();
    const [frames, opts] = a.animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
    expect(Object.keys(frames[0]!)).toEqual(["transform"]);
    expect(frames[0]!.transform).toContain("-40px");
    expect(opts.duration).toBe(180);
  });
  it("mutate lève : l'erreur remonte, rien n'est animé", async () => {
    stubMedia(false);
    const a = box(0);
    await expect(flip([a.el], () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(a.animate).not.toHaveBeenCalled();
  });
});
