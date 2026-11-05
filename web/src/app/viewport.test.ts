import { describe, expect, it, vi } from "vitest";
import { keyboardOpen, watchKeyboard } from "./viewport";

const vv = (height: number) => ({ height }) as VisualViewport;

describe("keyboardOpen", () => {
  it("vv.height < 0,75 × innerHeight", () => {
    expect(keyboardOpen(vv(500), 844)).toBe(true);
    expect(keyboardOpen(vv(632), 844)).toBe(true); // 0,75 × 844 = 633
    expect(keyboardOpen(vv(633), 844)).toBe(false);
    expect(keyboardOpen(vv(750), 1000)).toBe(false); // égalité : fermé
    expect(keyboardOpen(vv(844), 844)).toBe(false);
  });
  it("sans visualViewport, ou hauteur nulle : fermé", () => {
    expect(keyboardOpen(null, 844)).toBe(false);
    expect(keyboardOpen(vv(0), 0)).toBe(false);
  });
});

// Fenêtre factice : innerWidth/innerHeight modifiables, événements « resize » sur la fenêtre
// et sur visualViewport.
function fakeWindow(width: number, height: number) {
  const viewport = Object.assign(new EventTarget(), { height });
  const w = Object.assign(new EventTarget(), { innerWidth: width, innerHeight: height, visualViewport: viewport, document: { activeElement: null } });
  const resize = (o: { innerWidth?: number; innerHeight?: number; vv?: number }) => {
    if (o.innerWidth !== undefined) w.innerWidth = o.innerWidth;
    if (o.innerHeight !== undefined) w.innerHeight = o.innerHeight;
    if (o.vv !== undefined) viewport.height = o.vv;
    w.dispatchEvent(new Event("resize"));
    viewport.dispatchEvent(new Event("resize"));
  };
  return { w: w as unknown as Window, resize, viewport };
}
const coarse = () => true;

describe("watchKeyboard", () => {
  it("Safari iOS (innerHeight fixe) : ouvert quand visualViewport rétrécit, une notification par changement", () => {
    const { w, resize } = fakeWindow(390, 844);
    const set = vi.fn();
    const off = watchKeyboard(w, set, coarse);
    expect(set).toHaveBeenLastCalledWith(false);
    resize({ vv: 500 });
    expect(set).toHaveBeenLastCalledWith(true);
    const calls = set.mock.calls.length;
    resize({ vv: 480 });
    expect(set.mock.calls.length).toBe(calls); // pas de répétition
    resize({ vv: 844 });
    expect(set).toHaveBeenLastCalledWith(false);
    off();
  });

  it("Chrome Android avec resizes-content (innerHeight rétrécit aussi) : comparé à la plus grande hauteur vue", () => {
    const { w, resize } = fakeWindow(412, 915);
    const set = vi.fn();
    watchKeyboard(w, set, coarse);
    resize({ innerHeight: 500, vv: 500 });
    expect(set).toHaveBeenLastCalledWith(true);
    resize({ innerHeight: 915, vv: 915 });
    expect(set).toHaveBeenLastCalledWith(false);
  });

  it("rotation (largeur changée) : la référence repart de la nouvelle hauteur", () => {
    const { w, resize } = fakeWindow(412, 915);
    const set = vi.fn();
    watchKeyboard(w, set, coarse);
    resize({ innerWidth: 915, innerHeight: 412, vv: 412 }); // paysage, clavier fermé
    expect(set).toHaveBeenLastCalledWith(false);
  });

  it("à l'ouverture, le champ actif est amené au centre", () => {
    const { w, resize } = fakeWindow(390, 844);
    const scrollIntoView = vi.fn();
    const field = { scrollIntoView, matches: () => true } as unknown as Element;
    watchKeyboard(w, () => {}, coarse, () => field);
    resize({ vv: 500 });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("le retrait coupe les notifications ; sans visualViewport : toujours fermé", () => {
    const { w, resize } = fakeWindow(390, 844);
    const set = vi.fn();
    watchKeyboard(w, set, coarse)();
    resize({ vv: 500 });
    expect(set).toHaveBeenCalledTimes(1);
    const bare = Object.assign(new EventTarget(), { innerWidth: 390, innerHeight: 844, visualViewport: null }) as unknown as Window;
    const set2 = vi.fn();
    watchKeyboard(bare, set2, coarse);
    expect(set2).toHaveBeenCalledWith(false);
  });

  it("pointeur fin (ordinateur : fenêtre réduite, outils de développement) : jamais ouvert", () => {
    const { w, resize } = fakeWindow(1440, 900);
    const set = vi.fn();
    watchKeyboard(w, set, () => false);
    resize({ vv: 400 });
    expect(set.mock.calls).toEqual([[false]]);
  });

  it("par défaut, lit matchMedia(\"(pointer: coarse)\") à chaque mesure", () => {
    const { w, resize } = fakeWindow(390, 844);
    let isCoarse = false;
    const queries: string[] = [];
    Object.assign(w, {
      matchMedia: (q: string) => {
        queries.push(q);
        return { matches: isCoarse };
      },
    });
    const set = vi.fn();
    watchKeyboard(w, set);
    resize({ vv: 500 });
    expect(set).toHaveBeenLastCalledWith(false);
    isCoarse = true;
    resize({ vv: 490 });
    expect(set).toHaveBeenLastCalledWith(true);
    expect(new Set(queries)).toEqual(new Set(["(pointer: coarse)"]));
  });
});
