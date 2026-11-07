import { describe, expect, it, vi } from "vitest";
import { ASK_MS, TABS_CHANNEL, answerOtherTabs, askOtherTabs, type ChannelFactory } from "./tabs";

const TAG = "T".repeat(22);
const GRANT = "G".repeat(54);

/** Canaux en mémoire, comme BroadcastChannel : un message va à tous les autres du même nom. */
function bus() {
  const all: { name: string; ch: { onmessage: ((ev: MessageEvent) => void) | null } }[] = [];
  const sent: unknown[] = [];
  const open: ChannelFactory = (name) => {
    const me = {
      onmessage: null as ((ev: MessageEvent) => void) | null,
      postMessage(m: unknown) {
        sent.push(m);
        const copy = structuredClone(m);
        for (const o of all) if (o.ch !== me && o.name === name) queueMicrotask(() => o.ch.onmessage?.({ data: copy } as MessageEvent));
      },
      close() {
        const i = all.findIndex((o) => o.ch === me);
        if (i >= 0) all.splice(i, 1);
      },
    };
    all.push({ name, ch: me });
    return me;
  };
  return { open, sent, count: () => all.length };
}

describe("tabs (spec §41.4)", () => {
  it("canal shhdrop-og ; un onglet qui détient l'octroi répond avant 400 ms", async () => {
    const b = bus();
    const open: ChannelFactory = (n) => (expect(n).toBe(TABS_CHANNEL), b.open(n));
    const stop = answerOtherTabs((t) => (t === TAG ? GRANT : null), open);
    const t0 = Date.now();
    expect(await askOtherTabs(TAG, ASK_MS, open)).toBe(GRANT);
    expect(Date.now() - t0).toBeLessThan(ASK_MS);
    stop();
    expect(b.count()).toBe(0);
  });

  it("aucun onglet, autre étiquette ou canal absent → null", async () => {
    const b = bus();
    expect(await askOtherTabs(TAG, 30, b.open)).toBeNull();
    const stop = answerOtherTabs(() => null, b.open);
    expect(await askOtherTabs(TAG, 30, b.open)).toBeNull();
    stop();
    expect(await askOtherTabs(TAG, 30, () => null)).toBeNull();
  });

  it("seuls t, r, tag et grant circulent : jamais K_lien ; l'octroi n'est écrit nulle part par celui qui répond", async () => {
    const b = bus();
    const getGrant = vi.fn(() => GRANT);
    const setItem = vi.fn();
    vi.stubGlobal("sessionStorage", { setItem, getItem: () => null, removeItem: () => undefined });
    const stop = answerOtherTabs(getGrant, b.open);
    await askOtherTabs(TAG, ASK_MS, b.open);
    stop();
    vi.unstubAllGlobals();
    expect(setItem).not.toHaveBeenCalled();
    expect(b.sent.map((m) => Object.keys(m as object).sort().join(","))).toEqual(["r,t,tag", "grant,r,t"]);
    for (const m of b.sent) for (const v of Object.values(m as object)) expect(String(v).length).not.toBe(43); // K_lien : 43 caractères
  });

  it("réponse d'une autre demande (r différent) ou mal formée : ignorée", async () => {
    const b = bus();
    const rogue = b.open(TABS_CHANNEL)!;
    rogue.onmessage = (ev) => {
      const m = ev.data as { r: string };
      rogue.postMessage({ t: "have", r: "x".repeat(22), grant: GRANT });
      rogue.postMessage({ t: "have", r: m.r, grant: "court" });
    };
    expect(await askOtherTabs(TAG, 50, b.open)).toBeNull();
  });
});
