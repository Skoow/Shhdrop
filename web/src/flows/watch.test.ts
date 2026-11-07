// Spec §41.8 : surveillance tenue 25 s, en boucle tant que la page est visible et active.
import { describe, expect, it, vi } from "vitest";
import { IDLE_MS, startWatch, type WatchDeps } from "./watch";

const tick = () => new Promise((r) => setTimeout(r, 0));

function deps() {
  let t = 0;
  let visible = true;
  let wake: ((activity: boolean) => void) | null = null;
  const d: WatchDeps = {
    now: () => t,
    visible: () => visible,
    listen: (w) => {
      wake = w;
      return () => (wake = null);
    },
    pause: async (ms) => void (t += ms),
  };
  return {
    d,
    advance: (ms: number) => (t += ms),
    hide: () => ((visible = false), wake?.(false)),
    show: () => ((visible = true), wake?.(false)),
    act: () => wake?.(true),
    listening: () => wake !== null,
  };
}

describe("startWatch", () => {
  it("boucle après chaque réponse « alive » (204) ; « gone » → onGone une fois, puis plus rien", async () => {
    const h = deps();
    const answers = ["alive", "alive", "gone"] as const;
    let n = 0;
    const poll = vi.fn(async () => {
      h.advance(25_000);
      return answers[n++]!;
    });
    const onGone = vi.fn();
    startWatch(poll, onGone, h.d);
    for (let i = 0; i < 5; i++) await tick();
    expect(poll).toHaveBeenCalledTimes(3);
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(h.listening()).toBe(false);
  });

  it("page cachée : la requête tenue est relâchée, plus d'appel ; reprise au retour", async () => {
    const h = deps();
    const signals: AbortSignal[] = [];
    const poll = vi.fn((s: AbortSignal) => {
      signals.push(s);
      return new Promise<"alive">((res, rej) => s.addEventListener("abort", () => rej(new DOMException("x", "AbortError"))));
    });
    startWatch(poll, vi.fn(), h.d);
    await tick();
    expect(poll).toHaveBeenCalledTimes(1);
    h.hide();
    await tick();
    expect(signals[0]!.aborted).toBe(true);
    expect(poll).toHaveBeenCalledTimes(1);
    h.show();
    await tick();
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("30 min sans activité : s'arrête ; reprend à la prochaine activité", async () => {
    const h = deps();
    const poll = vi.fn(async () => {
      h.advance(IDLE_MS / 2);
      return "alive" as const;
    });
    startWatch(poll, vi.fn(), h.d);
    for (let i = 0; i < 5; i++) await tick();
    expect(poll).toHaveBeenCalledTimes(2);
    h.act();
    for (let i = 0; i < 5; i++) await tick();
    expect(poll).toHaveBeenCalledTimes(4); // 30 min de plus depuis l'activité, puis arrêt
  });

  it("route absente (404 d'un serveur sans M2) ou erreur : « stop », aucune boucle serrée", async () => {
    const h = deps();
    const poll = vi.fn(async () => "stop" as const);
    const onGone = vi.fn();
    startWatch(poll, onGone, h.d);
    for (let i = 0; i < 5; i++) await tick();
    expect(poll).toHaveBeenCalledTimes(1);
    expect(onGone).not.toHaveBeenCalled();
  });

  it("stop() : la requête en cours est annulée, aucune autre", async () => {
    const h = deps();
    let sig: AbortSignal | undefined;
    const poll = vi.fn((s: AbortSignal) => ((sig = s), new Promise<"alive">(() => undefined)));
    const w = startWatch(poll, vi.fn(), h.d);
    await tick();
    w.stop();
    expect(sig!.aborted).toBe(true);
    expect(h.listening()).toBe(false);
  });
});
