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

  it("arrivée : le « chut » une seule fois par chargement ; transform et opacity seulement ; nœuds retirés à la fin", async () => {
    reduce(false);
    vi.resetModules(); // nouveau « chargement de page » : drapeau de module remis à zéro
    const svelte = await import("svelte"); // même exécution Svelte que le composant rechargé
    const { default: Fresh } = await import("./Logo.svelte");
    const { hushTimeline } = await import("./logoMotion");
    const calls: Keyframe[][] = [];
    const finished: (() => void)[] = [];
    vi.spyOn(Element.prototype, "animate").mockImplementation(function (k: Keyframe[] | PropertyIndexedKeyframes | null) {
      calls.push(k as Keyframe[]);
      let done!: () => void;
      const p = new Promise<void>((r) => (done = r));
      finished.push(done);
      return { finished: p, finish: done } as unknown as Animation;
    });
    const fresh: Record<string, unknown>[] = [];
    const showFresh = (props: Record<string, unknown>) => {
      fresh.push(svelte.mount(Fresh as never, { target: document.body, props }) as Record<string, unknown>);
      svelte.flushSync();
    };
    showFresh({ animated: true });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    svelte.flushSync();
    // doigt, 6 tranches de trame, 2 ondes
    const expected = hushTimeline(6).tracks.length;
    expect(calls.length).toBe(expected);
    expect(document.querySelector(".finger")).not.toBeNull();
    expect(document.querySelector("mask")).toBeNull();
    for (const frames of calls)
      for (const f of frames) for (const key of Object.keys(f)) expect(["opacity", "transform", "offset", "easing"]).toContain(key);
    // Un clic n'importe où termine l'animation (jamais bloquante).
    window.dispatchEvent(new Event("pointerdown"));
    for (let i = 0; i < 6; i++) await Promise.resolve();
    svelte.flushSync();
    expect(document.querySelector(".finger")).toBeNull();
    expect(document.querySelector("svg")!.querySelectorAll("*").length).toBeLessThanOrEqual(10);
    // Second affichage (retour sur l'accueil) : rien.
    showFresh({ animated: true });
    expect(calls.length).toBe(expected);
    for (const c of fresh) void svelte.unmount(c);
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

  it("chronologies : « chut » de 1,8 à 2,4 s, première et dernière image = repos ; gomme alignée sur le masque", async () => {
    const { eraseTimeline, hushTimeline, ERASE } = await import("./logoMotion");
    const hush = hushTimeline(6);
    expect(hush.duration).toBeGreaterThanOrEqual(1800);
    expect(hush.duration).toBeLessThanOrEqual(2400);
    const rest: Record<string, Keyframe> = {
      ".finger": { opacity: 0 },
      ".dots": { opacity: 1, transform: "scale(1)" },
      ".wave0": { opacity: 0 },
      ".wave1": { opacity: 0 },
    };
    for (const t of [...hush.tracks, ...eraseTimeline(true).tracks, ...eraseTimeline(false).tracks]) {
      const offs = t.frames.map((f) => f.offset as number);
      expect([...offs].sort((a, b) => a - b)).toEqual(offs);
      expect(offs[0]).toBe(0);
      expect(offs.at(-1)).toBe(1);
    }
    for (const t of hush.tracks) {
      expect(t.fill ?? "none").toBe("none"); // rien ne reste appliqué après la fin
      for (const f of [t.frames[0]!, t.frames.at(-1)!]) expect(f).toMatchObject(rest[t.target]!);
    }
    const arrive = eraseTimeline(true);
    const m1 = arrive.tracks.find((t) => t.target === ".m1")!;
    expect(m1.frames.some((f) => f.transform === `translateX(${ERASE.x1 - ERASE.x0}px)`)).toBe(true);
    expect(eraseTimeline(false).tracks.find((t) => t.target === ".ink")!.fill).toBe("forwards");
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
