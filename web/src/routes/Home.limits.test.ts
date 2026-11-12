// @vitest-environment happy-dom
// Ligne de méta de l'accueil : la limite gratuite vient de limits.ts, jamais écrite en dur.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../limits", async (orig) => ({ ...(await orig<typeof import("../limits")>()), CONTENT_MAX: 5 * 1024 ** 3 }));
const { setLang } = await import("../i18n/i18n.svelte");
const { default: Home } = await import("./Home.svelte");

let c: Record<string, unknown> | null = null;
afterEach(() => {
  if (c) void unmount(c);
  document.body.innerHTML = "";
});

it("« Gratuit jusqu'à … » suit CONTENT_MAX", () => {
  setLang("fr");
  c = mount(Home as never, { target: document.body, props: {} }) as Record<string, unknown>;
  flushSync();
  expect(document.querySelector("[data-meta] li")!.textContent!.trim()).toBe("Gratuit jusqu'à 5 Go");
});
