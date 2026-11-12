// @vitest-environment happy-dom
// Carte de « Mes partages » (audit R3) : l'heure de la dernière lecture du serveur est dite telle
// quelle, avec le rythme des relectures ; jamais « à l'instant » à côté d'un compteur qui peut
// dater de 5 minutes.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "../i18n/i18n.svelte";
import type { HistoryEntry } from "../history/store";
import ShareCard from "./ShareCard.svelte";

const T = new Date(2026, 10, 12, 18, 58, 30).getTime();
const entry = (o: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: "a".repeat(22),
  manage: "https://x.example/#m" + "b".repeat(43),
  createdAt: T - 120_000,
  sizeBytes: 1000,
  itemsCount: 1,
  expiresAt: T + 3600_000,
  maxOpens: 2,
  opensUsed: 0,
  opens: [],
  state: "ready",
  lastSeenAt: T - 20_000,
  endedAt: 0,
  destroyedHere: false,
  ...o,
});

let c: Record<string, unknown> | null = null;
afterEach(() => {
  if (c) void unmount(c);
  c = null;
  document.body.innerHTML = "";
});
const render = (e: HistoryEntry, now: number, compact: boolean) => {
  c = mount(ShareCard as never, { target: document.body, props: { entry: e, now, compact, onrefresh: async () => undefined, ondestroy: async () => false, onremove: () => undefined } }) as Record<string, unknown>;
  flushSync();
  return document.querySelector("[data-seen]")?.textContent ?? "";
};

describe("ShareCard : dernière lecture (audit R3)", () => {
  it("heure réelle de la lecture et rythme des relectures, en français et en anglais ; jamais « à l'instant »", () => {
    setLang("fr");
    const fr = render(entry(), T, true);
    expect(fr).toBe("État lu à 18 h 58 · relu au plus toutes les 5\u202fmin");
    expect(fr).not.toMatch(/instant/);
    void unmount(c!);
    setLang("en");
    const en = render(entry(), T, true);
    expect(en).toMatch(/^Status read at 6:58\sPM · re-read at most every 5 min$/);
    expect(en).not.toMatch(/just now/);
  });

  it("lecture d'un autre jour : la date est dite aussi", () => {
    setLang("fr");
    expect(render(entry({ lastSeenAt: T - 26 * 3600_000 }), T, true)).toMatch(/^État lu le 11 nov\., 16 h 58 · /);
  });
});
