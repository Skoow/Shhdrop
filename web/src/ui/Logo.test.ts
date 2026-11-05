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

  it("mouvement réduit : pas de dissolution animée", async () => {
    reduce(true);
    const animate = vi.fn();
    vi.spyOn(Element.prototype, "animate").mockImplementation(animate as never);
    const c = show({});
    expect(animate).not.toHaveBeenCalled();
    await (c.dissolve as () => Promise<void>)();
    flushSync();
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector("svg")!.classList.contains("gone")).toBe(true);
  });

  it("arrivée : logo au repos tout de suite, aucune animation lancée, « shhd » plein et « rop » en trame", async () => {
    reduce(false);
    const animate = vi.spyOn(Element.prototype, "animate");
    show({});
    await Promise.resolve();
    flushSync();
    expect(animate).not.toHaveBeenCalled();
    const svg = document.querySelector("svg")!;
    expect(svg.getAttribute("aria-label")).toBe("Shhdrop");
    expect(svg.classList.contains("gone")).toBe(false);
    expect(svg.querySelector(".head")).not.toBeNull();
    expect(svg.querySelectorAll(".dots")).toHaveLength(6);
    expect(svg.querySelector(".finger, .wave, mask")).toBeNull();
  });

  it("erase() : en mouvement réduit, tout de suite et sans animation ; le mot reste effacé", async () => {
    reduce(true);
    const animate = vi.spyOn(Element.prototype, "animate");
    const c = show({});
    await (c.erase as () => Promise<void>)();
    flushSync();
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector("svg")!.classList.contains("gone")).toBe(true);
  });

  it("chronologie de la gomme : première et dernière image ordonnées ; mot laissé effacé ; gomme alignée sur le masque", async () => {
    const { eraseTimeline, ERASE } = await import("./logoMotion");
    const erase = eraseTimeline();
    for (const t of erase.tracks) {
      const offs = t.frames.map((f) => f.offset as number);
      expect([...offs].sort((a, b) => a - b)).toEqual(offs);
      expect(offs[0]).toBe(0);
      expect(offs.at(-1)).toBe(1);
    }
    const m1 = erase.tracks.find((t) => t.target === ".m1")!;
    expect(m1.frames.some((f) => f.transform === `translateX(${ERASE.x1 - ERASE.x0}px)`)).toBe(true);
    expect(erase.tracks.find((t) => t.target === ".ink")!.fill).toBe("forwards");
  });

  it("erase() : la gomme passe, puis le mot reste effacé et les effets disparaissent", async () => {
    reduce(false);
    const animate = vi
      .spyOn(Element.prototype, "animate")
      .mockImplementation(() => ({ finished: Promise.resolve(), finish() {} }) as unknown as Animation);
    const c = show({});
    const done = (c.erase as () => Promise<void>)();
    await Promise.resolve();
    flushSync();
    await done;
    flushSync();
    expect(animate.mock.calls.length).toBeGreaterThan(5);
    expect(document.querySelector("mask")).toBeNull();
    expect(document.querySelector("svg")!.classList.contains("gone")).toBe(true);
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
