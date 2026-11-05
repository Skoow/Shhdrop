// @vitest-environment happy-dom
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import Logo from "./Logo.svelte";

const mounted: Record<string, unknown>[] = [];
function show(props: Record<string, unknown>) {
  const c = mount(Logo as never, { target: document.body, props }) as Record<string, unknown>;
  mounted.push(c);
  flushSync();
  return c;
}
const reduce = (on: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q.includes("reduced-motion"), media: q }));

afterEach(() => {
  while (mounted.length) void unmount(mounted.pop()!);
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Logo", () => {
  it("mot-symbole : image nommée « Shhdrop », trame en 6 tranches, aucun attribut style", () => {
    show({});
    const svg = document.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Shhdrop");
    expect(svg.querySelectorAll(".dots")).toHaveLength(6);
    expect(svg.querySelectorAll("*").length).toBeLessThanOrEqual(10);
    expect(document.body.innerHTML).not.toContain("style=");
  });

  it("marque seule : le o rayé, même nom accessible", () => {
    show({ variant: "mark" });
    const svg = document.querySelector("svg")!;
    expect(svg.getAttribute("aria-label")).toBe("Shhdrop");
    expect(svg.querySelectorAll(".stripes")).toHaveLength(1);
  });

  it("mouvement réduit : ni introduction ni dissolution animées", async () => {
    reduce(true);
    const animate = vi.fn();
    vi.spyOn(Element.prototype, "animate").mockImplementation(animate as never);
    const c = show({ animated: true });
    expect(animate).not.toHaveBeenCalled();
    await (c.dissolve as () => Promise<void>)();
    flushSync();
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector("svg")!.classList.contains("gone")).toBe(true);
  });

  it("introduction : une seule fois par chargement ; transform et opacity seulement", async () => {
    reduce(false);
    vi.resetModules(); // nouveau « chargement de page » : drapeau de module remis à zéro
    const svelte = await import("svelte"); // même exécution Svelte que le composant rechargé
    const { default: Fresh } = await import("./Logo.svelte");
    const fresh: Record<string, unknown>[] = [];
    const showFresh = (props: Record<string, unknown>) => {
      fresh.push(svelte.mount(Fresh as never, { target: document.body, props }) as Record<string, unknown>);
      svelte.flushSync();
    };
    const calls: Keyframe[][] = [];
    vi.spyOn(Element.prototype, "animate").mockImplementation(function (k: Keyframe[] | PropertyIndexedKeyframes | null) {
      calls.push(k as Keyframe[]);
      return { finished: Promise.resolve() } as unknown as Animation;
    });
    showFresh({ animated: true });
    expect(calls.length).toBe(8); // tête, fin pleine, 6 tranches
    for (const frames of calls)
      for (const f of frames) for (const key of Object.keys(f)) expect(["opacity", "transform", "offset"]).toContain(key);
    showFresh({ animated: true });
    expect(calls.length).toBe(8);
    for (const c of fresh) void svelte.unmount(c);
  });

  it("dissolve() : les 6 tranches s'effacent puis la promesse se résout", async () => {
    reduce(false);
    const animate = vi
      .spyOn(Element.prototype, "animate")
      .mockImplementation(() => ({ finished: Promise.resolve() }) as unknown as Animation);
    const c = show({});
    await (c.dissolve as () => Promise<void>)();
    flushSync();
    expect(animate).toHaveBeenCalledTimes(6);
    expect(document.querySelector("svg")!.classList.contains("gone")).toBe(true);
  });
});
