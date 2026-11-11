// @vitest-environment happy-dom
// Accueil « Vos partages actifs » (spec §33.1, UI §9.6.1) : rien sans partage actif, au plus
// trois cartes, et AUCUNE requête au chargement (lecture locale seulement).
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/i18n.svelte";
import type { HistoryEntry } from "../history/store";

const net = vi.hoisted(() => ({ status: vi.fn(), destroy: vi.fn() }));
vi.mock("../index", async (orig) => ({ ...(await orig<typeof import("../index")>()), shareStatus: net.status, destroyShare: net.destroy }));

const { loadHistory, shares } = await import("../history/live.svelte");
const { default: Strip } = await import("./ActiveSharesStrip.svelte");

const T = Date.now();
const entry = (i: number, o: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: String(i).repeat(22),
  manage: "https://x.example/#m" + String(i).repeat(43),
  createdAt: T - 60_000,
  sizeBytes: 148_897_792,
  itemsCount: 6,
  expiresAt: T + 3600_000 * (i + 1),
  maxOpens: 3,
  opensUsed: 1,
  opens: [],
  state: "ready",
  lastSeenAt: T - 60_000,
  endedAt: 0,
  destroyedHere: false,
  ...o,
});

let c: Record<string, unknown> | null = null;
beforeEach(() => setLang("fr"));
afterEach(() => {
  if (c) void unmount(c);
  c = null;
  document.body.innerHTML = "";
});

describe("ActiveSharesStrip", () => {
  it("historique vide ou indisponible : rien n'est rendu", async () => {
    await loadHistory();
    c = mount(Strip as never, { target: document.body }) as Record<string, unknown>;
    flushSync();
    expect(document.querySelector("[data-active-shares]")).toBeNull();
    expect(document.body.textContent?.trim()).toBe("");
  });

  it("seulement des partages terminés : rien n'est rendu", () => {
    shares.entries = [entry(1, { state: "gone", endedAt: T }), entry(2, { expiresAt: T - 1 })];
    c = mount(Strip as never, { target: document.body }) as Record<string, unknown>;
    flushSync();
    expect(document.querySelector("[data-active-shares]")).toBeNull();
  });

  it("partages actifs : titre, trois cartes au plus, « Tout voir (n) », aucune requête au chargement", async () => {
    shares.entries = [1, 2, 3, 4].map((i) => entry(i));
    c = mount(Strip as never, { target: document.body }) as Record<string, unknown>;
    flushSync();
    await new Promise((r) => setTimeout(r, 20));
    flushSync();
    expect(document.querySelector("h2")?.textContent).toBe("Vos partages actifs");
    expect(document.querySelectorAll("[data-share-card]")).toHaveLength(3);
    expect(document.body.textContent).toContain("Tout voir (4)");
    expect(document.body.textContent).toContain("Ouvert 1 / 3");
    expect(document.body.textContent).toContain("6 éléments");
    expect(document.body.textContent).not.toContain("#m");
    expect(net.status).not.toHaveBeenCalled();
    expect(net.destroy).not.toHaveBeenCalled();
  });
});
