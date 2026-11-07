// @vitest-environment happy-dom
// Changer MAX_ITEMS change la ligne de preuves de l'accueil, la jauge et le voile de dépôt
// (UI M5, spec §41.2) : les textes ne portent aucun chiffre en dur.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../limits", async (importOriginal) => ({ ...(await importOriginal<typeof import("../limits")>()), MAX_ITEMS: 7 }));

const { setLang } = await import("../i18n/i18n.svelte");
const { default: Home } = await import("../routes/Home.svelte");
const { default: CapacityGauge } = await import("./CapacityGauge.svelte");
const { default: DropOverlay } = await import("./DropOverlay.svelte");

let c: Record<string, unknown> | null = null;
afterEach(() => {
  if (c) void unmount(c);
  c = null;
  document.body.innerHTML = "";
  setLang("fr");
});

describe("MAX_ITEMS à 7", () => {
  it("accueil, jauge et voile de dépôt suivent la constante", () => {
    setLang("fr");
    c = mount(Home as never, { target: document.body, props: {} }) as Record<string, unknown>;
    flushSync();
    expect(document.querySelector(".proof")!.textContent).toContain("7 éléments · 2 Go");
    void unmount(c);
    document.body.innerHTML = "";
    c = mount(CapacityGauge as never, { target: document.body, props: { bytes: 1, count: 2 } }) as Record<string, unknown>;
    flushSync();
    expect(document.body.textContent).toContain("2 / 7");
    expect(document.querySelector(".bar.count")!.getAttribute("aria-valuemax")).toBe("7");
    void unmount(c);
    document.body.innerHTML = "";
    c = mount(DropOverlay as never, { target: document.body, props: { open: true } }) as Record<string, unknown>;
    flushSync();
    expect(document.body.textContent).toContain("7 éléments et 2 Go au plus");
  });
});
