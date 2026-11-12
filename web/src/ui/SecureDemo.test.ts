// @vitest-environment happy-dom
// Infographie de l'accueil (refonte du 12 novembre) : boucle d'étapes, pause (bouton, survol,
// focus : WCAG 2.2.2), storyboard statique en mouvement réduit, étapes lisibles au lecteur
// d'écran, textes vrais (jamais « 100 % sécurisé », ni « inviolable », « aucune donnée »…).
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { setLang } from "../i18n/i18n.svelte";
import { STEP_MS, STEPS } from "./demo-steps";
import SecureDemo from "./SecureDemo.svelte";

let c: Record<string, unknown> | null = null;
function show() {
  c = mount(SecureDemo as never, { target: document.body, props: {} }) as Record<string, unknown>;
  flushSync();
}
const root = () => document.querySelector<HTMLElement>("[data-demo]")!;
const toggle = () => document.querySelector<HTMLButtonElement>("[data-demo-toggle]")!;
const step = () => Number(root().dataset.step);
function tickSteps(n: number) {
  for (let i = 0; i < n; i++) {
    vi.advanceTimersByTime(STEP_MS);
    flushSync();
  }
}

function reduce(on: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q.includes("reduced-motion"), media: q, addEventListener() {}, removeEventListener() {} }));
}

beforeEach(() => {
  setLang("fr");
  vi.useFakeTimers();
  reduce(false);
});
afterEach(() => {
  if (c) void unmount(c);
  c = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SecureDemo", () => {
  it("sept étapes, dans l'ordre, lisibles au lecteur d'écran ; dessin caché", () => {
    show();
    expect(STEPS).toHaveLength(7);
    const items = [...document.querySelectorAll("[data-demo-steps] li")].map((l) => l.textContent!.replace(/\s+/g, " ").trim());
    expect(items).toHaveLength(7);
    expect(items[0]).toContain("photo.jpg");
    expect(items[1]).toContain("Chiffré dans votre appareil");
    expect(items[3]).toContain("ni nom de fichier, ni mot de passe, ni adresse IP");
    expect(items[4]).toContain("Le mot de passe ne part jamais");
    expect(items[6]).toContain("Puis plus rien");
    const svg = root().querySelector("svg")!;
    expect(svg.closest('[aria-hidden="true"]')).not.toBeNull();
    // Nom du groupe : le titre de l'infographie.
    const g = root().closest("[role=group]") ?? root();
    expect(g.getAttribute("aria-labelledby")).toBeTruthy();
  });

  it("boucle : une étape toutes les STEP_MS, puis retour au début", () => {
    show();
    expect(step()).toBe(1);
    tickSteps(1);
    expect(step()).toBe(2);
    tickSteps(5);
    expect(step()).toBe(7);
    tickSteps(1);
    expect(step()).toBe(1);
    expect(STEP_MS * 7).toBeGreaterThanOrEqual(10_000);
    expect(STEP_MS * 7).toBeLessThanOrEqual(14_000);
  });

  it("bouton pause/lecture visible : arrête puis reprend la boucle", () => {
    show();
    expect(toggle().getAttribute("aria-label")).toBe("Mettre l'animation en pause");
    toggle().click();
    flushSync();
    expect(toggle().getAttribute("aria-label")).toBe("Lire l'animation");
    expect(root().classList.contains("paused")).toBe(true);
    tickSteps(3);
    expect(step()).toBe(1);
    toggle().click();
    flushSync();
    tickSteps(1);
    expect(step()).toBe(2);
  });

  it("pause au survol et au focus, reprise ensuite", () => {
    show();
    const view = document.querySelector("[data-demo-view]")!;
    view.dispatchEvent(new Event("pointerenter"));
    flushSync();
    tickSteps(2);
    expect(step()).toBe(1);
    view.dispatchEvent(new Event("pointerleave"));
    flushSync();
    tickSteps(1);
    expect(step()).toBe(2);
    toggle().dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    flushSync();
    tickSteps(2);
    expect(step()).toBe(2);
    toggle().dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
    flushSync();
    tickSteps(1);
    expect(step()).toBe(3);
  });

  it("mouvement réduit : storyboard statique, toutes les étapes visibles, aucun minuteur", () => {
    reduce(true);
    show();
    expect(root().classList.contains("board")).toBe(true);
    const list = document.querySelector("[data-demo-steps]")!;
    expect(list.classList.contains("sr-only")).toBe(false);
    expect(list.querySelectorAll("li")).toHaveLength(7);
    expect(vi.getTimerCount()).toBe(0);
    expect(document.querySelector("[data-demo-toggle]")).toBeNull();
  });

  it("anglais", () => {
    setLang("en");
    show();
    expect(toggle().getAttribute("aria-label")).toBe("Pause the animation");
    expect(document.querySelector("[data-demo-steps]")!.textContent).toContain("Encrypted on your device");
  });

  it("textes vrais : aucune promesse absolue, en français comme en anglais", () => {
    const all: [string, string][] = [...Object.entries(fr), ...Object.entries(en)];
    const mine = all.filter(([k]) => k.startsWith("demo.") || k.startsWith("hero.") || k.startsWith("nav.") || k.startsWith("home."));
    expect(mine.length).toBeGreaterThan(40);
    for (const [k, v] of mine) {
      expect(v, k).not.toMatch(/100\s*%|inviolable|aucune donnée|intraçable|unbreakable|no data|untraceable|100% secure/i);
    }
  });
});
