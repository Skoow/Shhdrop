// @vitest-environment happy-dom
// Barre du haut (refonte du 12 novembre), ordinateur et tablette : menus déroulants en motif
// « disclosure » (bouton aria-expanded, liste de liens ou boutons), clavier (Entrée, Échap,
// flèches, Tab), fermeture au clic extérieur ; « Envoyer ▾ » ouvre les gestes du composeur.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chrome } from "../app/chrome.svelte";
import { setLang } from "../i18n/i18n.svelte";
import TopNav from "./TopNav.svelte";

let c: Record<string, unknown> | null = null;
function show(props: Record<string, unknown> = {}) {
  c = mount(TopNav as never, { target: document.body, props }) as Record<string, unknown>;
  flushSync();
}
const btn = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find((b) => b.textContent!.trim() === name)!;
const panel = (b: HTMLButtonElement) => document.getElementById(b.getAttribute("aria-controls")!)!;
const key = (el: Element, k: string) => {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  flushSync();
};

beforeEach(() => setLang("fr"));
afterEach(() => {
  if (c) void unmount(c);
  c = null;
  document.body.innerHTML = "";
  chrome.add = null;
});

describe("TopNav", () => {
  it("menus, Salon bientôt, Offres, Mes partages et Partager ; le menu s'appelle « Envoyer », le bouton plein seul « Partager »", () => {
    show();
    const nav = document.querySelector("nav")!;
    expect(nav.getAttribute("aria-label")).toBe("Menu principal");
    for (const n of ["Envoyer", "Sécurité"]) {
      const b = btn(n);
      expect(b.getAttribute("aria-expanded")).toBe("false");
      expect(panel(b).hidden).toBe(true);
    }
    const room = [...nav.querySelectorAll("button")].find((b) => b.textContent!.includes("Salon"))!;
    expect(room.getAttribute("aria-disabled")).toBe("true");
    expect(room.textContent).toContain("bientôt");
    const links = [...document.querySelectorAll("a")].map((a) => [a.textContent!.trim(), a.getAttribute("href")]);
    expect(links).toEqual(expect.arrayContaining([["Offres", "/offres"], ["Mes partages", "/envois"], ["Partager", "/envoyer"]]));
    const named = (n: string) => [...nav.querySelectorAll("a, button")].filter((e) => e.textContent!.trim() === n);
    expect(named("Partager")).toHaveLength(1);
    expect(named("Partager")[0]!.tagName).toBe("A");
  });

  it("Envoyer : quatre gestes, chacun avec icône, titre et une ligne", () => {
    show();
    btn("Envoyer").click();
    flushSync();
    expect(btn("Envoyer").getAttribute("aria-expanded")).toBe("true");
    const items = [...panel(btn("Envoyer")).querySelectorAll("[data-nav-item]")];
    expect(items.map((i) => i.querySelector(".it-t")!.textContent)).toEqual(["Fichiers", "Note", "Vocal", "Photo ou vidéo"]);
    for (const i of items) {
      expect(i.querySelector(".it-ic svg")).not.toBeNull();
      expect(i.querySelector(".it-d")!.textContent!.length).toBeGreaterThan(5);
    }
    expect(items[0]!.querySelector(".it-d")!.textContent).toContain("2 Go");
  });

  it("Sécurité : comment ça marche, ce que voit le serveur et les pages existantes", () => {
    show();
    btn("Sécurité").click();
    flushSync();
    const p = panel(btn("Sécurité"));
    const titles = [...p.querySelectorAll(".it-t")].map((e) => e.textContent);
    expect(titles).toEqual(["Comment ça marche", "Ce que voit le serveur", "Sécurité en détail", "Confidentialité", "Signaler un abus"]);
    const hrefs = [...p.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["/securite", "/confidentialite", "/signaler"]));
    expect(hrefs.some((h) => h?.includes("#"))).toBe(false);
  });

  it("clavier : flèche bas ouvre et va au premier élément, flèches et Échap ; le focus revient au bouton", () => {
    show();
    const b = btn("Envoyer");
    b.focus();
    key(b, "ArrowDown");
    expect(b.getAttribute("aria-expanded")).toBe("true");
    const items = [...panel(b).querySelectorAll<HTMLElement>("[data-nav-item]")];
    expect(document.activeElement).toBe(items[0]);
    key(items[0]!, "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    key(items[1]!, "ArrowUp");
    expect(document.activeElement).toBe(items[0]);
    key(items[0]!, "ArrowUp");
    expect(document.activeElement).toBe(items[3]);
    key(items[3]!, "Escape");
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(b);
  });

  it("un seul menu ouvert ; clic extérieur et sortie au Tab ferment", () => {
    show();
    btn("Envoyer").click();
    flushSync();
    btn("Sécurité").click();
    flushSync();
    expect(btn("Envoyer").getAttribute("aria-expanded")).toBe("false");
    expect(btn("Sécurité").getAttribute("aria-expanded")).toBe("true");
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    flushSync();
    expect(btn("Sécurité").getAttribute("aria-expanded")).toBe("false");
    btn("Sécurité").click();
    flushSync();
    const p = panel(btn("Sécurité"));
    p.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
    flushSync();
    expect(btn("Sécurité").getAttribute("aria-expanded")).toBe("false");
  });

  it("un geste du menu Envoyer passe au composeur monté (chrome.add) et ferme le menu", () => {
    const add = vi.fn();
    chrome.add = add;
    show();
    btn("Envoyer").click();
    flushSync();
    const items = [...panel(btn("Envoyer")).querySelectorAll<HTMLButtonElement>("[data-nav-item]")];
    items[0]!.click();
    items[1]!.click();
    flushSync();
    expect(add.mock.calls).toEqual([["fichiers"], ["texte"]]);
    expect(btn("Envoyer").getAttribute("aria-expanded")).toBe("false");
  });

  it("pendant un envoi : menus et liens désactivés, raison donnée", () => {
    show({ busy: true });
    for (const a of document.querySelectorAll("a")) expect(a.getAttribute("aria-disabled")).toBe("true");
    for (const b of document.querySelectorAll("button[aria-expanded]")) expect(b.getAttribute("aria-disabled")).toBe("true");
    btn("Envoyer").click();
    flushSync();
    expect(btn("Envoyer").getAttribute("aria-expanded")).toBe("false");
  });

  it("anglais", () => {
    setLang("en");
    show();
    expect(btn("Send")).toBeDefined();
    expect(btn("Share")).toBeUndefined();
    expect(btn("Security")).toBeDefined();
  });
});
