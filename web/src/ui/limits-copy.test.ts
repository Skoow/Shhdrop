// @vitest-environment happy-dom
// Limites gratuites à l'écran (spec §41.2) : « 15 éléments · 2 Go » vient des constantes ;
// aucune occurrence des anciennes valeurs dans les textes ni dans les écrans.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTENT_MAX, MAX_ITEMS } from "../limits";
import { setLang } from "../i18n/i18n.svelte";
import Home from "../routes/Home.svelte";
import CapacityGauge from "./CapacityGauge.svelte";

const src = (f: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", f), "utf8");
const MIB = 1048576;
/** Séparateur nombre/unité, lu dans la source : espace réelle ou séquence \\u202f / \\u00a0 écrite. */
const SEP = String.raw`(?:[\s\u202f\u00a0]|\\u202f|\\u00a0)`;
let c: Record<string, unknown> | null = null;
function show(C: unknown, props: Record<string, unknown> = {}) {
  c = mount(C as never, { target: document.body, props }) as Record<string, unknown>;
  flushSync();
}
beforeEach(() => setLang("fr"));
afterEach(() => {
  if (c) void unmount(c);
  c = null;
  document.body.innerHTML = "";
});

describe("limites gratuites : 15 éléments, 2 Go", () => {
  it("constantes", () => {
    expect(MAX_ITEMS).toBe(15);
    expect(CONTENT_MAX).toBe(2 * 1024 * MIB);
  });

  it("accueil : ligne de preuves, en français et en anglais", () => {
    show(Home);
    expect(document.querySelector(".proof")!.textContent).toContain("15 éléments · 2 Go · 24 h au plus");
    setLang("en");
    flushSync();
    expect(document.querySelector(".proof")!.textContent).toContain("15 items · 2 GB · 24 h at most");
  });

  it("jauge : « 340 Mo / 2 Go » et « 3 / 15 », 15 crans", () => {
    show(CapacityGauge, { bytes: 340 * MIB, count: 3 });
    const t = document.body.textContent!;
    expect(t).toContain("340 Mo");
    expect(t).toContain("/ 2 Go");
    expect(t).toContain("3 / 15");
    expect(document.querySelectorAll(".tick")).toHaveLength(15);
    expect(document.querySelectorAll(".tick.on")).toHaveLength(3);
    expect(document.querySelector(".ticks")!.getAttribute("aria-valuemax")).toBe("15");
  });

  it("jauge : exactement 2 Go ne bloque pas, 2 Go + 1 octet est « trop gros » avec la même constante", () => {
    show(CapacityGauge, { bytes: CONTENT_MAX, count: 1 });
    expect(document.querySelector('[role="alert"]')).toBeNull();
    void unmount(c!);
    document.body.innerHTML = "";
    show(CapacityGauge, { bytes: CONTENT_MAX + 1, count: 1 });
    expect(document.querySelector('[role="alert"]')!.textContent).toBe("Trop gros : 1 octet de trop (limite : 2 Go).");
  });

  it("jauge : 2,2 Go sur 2 Go → « Trop gros : 2,2 Go sur 2 Go. Retirez 200 Mo. »", () => {
    show(CapacityGauge, { bytes: CONTENT_MAX + 200 * MIB, count: 2 });
    expect(document.querySelector('[role="alert"]')!.textContent).toBe("Trop gros : 2,2 Go sur 2 Go. Retirez 200 Mo.");
  });

  it("aucune ancienne valeur écrite en dur dans les textes et les écrans", () => {
    for (const f of ["i18n/fr.ts", "i18n/en.ts", "routes/Home.svelte", "ui/CapacityGauge.svelte", "ui/DropOverlay.svelte"]) {
      const s = src(f);
      expect(s, f).not.toMatch(new RegExp(String.raw`\b1${SEP}(Go|GB|Gio)\b`));
      expect(s, f).not.toMatch(new RegExp(String.raw`\b10${SEP}(éléments|items)`));
      expect(s, f).not.toMatch(/\b16384\b/);
    }
    for (const f of ["i18n/fr.ts", "i18n/en.ts"]) {
      expect(src(f), f).not.toMatch(/\b(dix éléments|ten items|gigaoctet|gigabyte)\b/);
      expect(src(f), f).not.toMatch(/\b(15|2)\\u(202f|00a0)(éléments|items|Go|GB)/);
    }
  });
});
