// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { capPath, flip, iconPressScale, pressScale, reducedMotion } from "./motion";

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
  it("durée et courbe viennent des jetons --dur-fast et --ease-out", async () => {
    stubMedia(false);
    document.documentElement.style.setProperty("--dur-fast", "200ms");
    document.documentElement.style.setProperty("--ease-out", "ease-in");
    try {
      const a = box(0);
      await flip([a.el], () => a.moveTo(40));
      const [, opts] = a.animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
      expect(opts.duration).toBe(200);
      expect(opts.easing).toBe("ease-in");
    } finally {
      document.documentElement.style.removeProperty("--dur-fast");
      document.documentElement.style.removeProperty("--ease-out");
    }
  });
  it("mutate lève : l'erreur remonte, rien n'est animé", async () => {
    stubMedia(false);
    const a = box(0);
    await expect(flip([a.el], () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(a.animate).not.toHaveBeenCalled();
  });
});

describe("capPath (UI §20.4)", () => {
  it("part du milieu du bord haut, sens horaire, et y revient", () => {
    const d = capPath(200, 100, 32);
    expect(d.startsWith("M 100 0")).toBe(true);
    expect(d).toBe(
      "M 100 0 H 168 A 32 32 0 0 1 200 32 V 68 A 32 32 0 0 1 168 100 H 32 A 32 32 0 0 1 0 68 V 32 A 32 32 0 0 1 32 0 H 100",
    );
    // Drapeau de balayage 1 : sens horaire (y vers le bas).
    for (const m of d.matchAll(/A [\d.]+ [\d.]+ 0 0 (\d)/g)) expect(m[1]).toBe("1");
  });
  it("rayon borné à la moitié du petit côté ; tailles nulles sans NaN", () => {
    expect(capPath(200, 40, 32)).toContain("A 20 20 ");
    expect(capPath(0, 0, 32)).not.toMatch(/NaN|-/);
  });
  it("échelles de pression", () => {
    expect(pressScale).toBe(0.97);
    expect(iconPressScale).toBe(0.92);
  });
});
