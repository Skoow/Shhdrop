// @vitest-environment happy-dom
// Bande qui défile sous le héros (référence du propriétaire, 12 novembre) : seulement des
// promesses produit vraies, jamais une fausse activité « en direct » ; lue une fois par le
// lecteur d'écran (copie de défilement cachée) ; bouton d'arrêt (WCAG 2.2.2) ; immobile en
// mouvement réduit.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/i18n.svelte";
import PromiseBand from "./PromiseBand.svelte";

let c: Record<string, unknown> | null = null;
function show() {
  c = mount(PromiseBand as never, { target: document.body, props: {} }) as Record<string, unknown>;
  flushSync();
}
function reduce(on: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q.includes("reduced-motion"), media: q, addEventListener() {}, removeEventListener() {} }));
}
beforeEach(() => {
  setLang("fr");
  reduce(false);
});
afterEach(() => {
  if (c) void unmount(c);
  c = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("PromiseBand", () => {
  it("six promesses vraies, une seule fois pour le lecteur d'écran", () => {
    show();
    const band = document.querySelector("[data-band]")!;
    const read = [...band.querySelectorAll("ul:not([aria-hidden]) li")].map((l) => l.textContent!.trim());
    expect(read).toEqual([
      "Chiffré dans votre appareil",
      "Sans compte",
      "Effacé après ouverture ou à l'échéance",
      "Aucune adresse IP écrite sur disque",
      "Ni nom de fichier ni mot de passe sur le serveur",
      "Code ouvert, licence AGPL-3.0",
    ]);
    // La copie qui boucle le défilement est cachée aux lecteurs d'écran.
    expect(band.querySelectorAll('ul[aria-hidden="true"] li')).toHaveLength(6);
    // Jamais de fausse activité en direct (lieux, « il y a … »).
    expect(band.textContent).not.toMatch(/il y a|en direct|\bà [A-Z][a-z]+/);
  });

  it("bouton d'arrêt et de reprise", () => {
    show();
    const b = document.querySelector<HTMLButtonElement>("[data-band-toggle]")!;
    expect(b.getAttribute("aria-label")).toBe("Arrêter le défilement");
    b.click();
    flushSync();
    expect(document.querySelector("[data-band]")!.classList.contains("stopped")).toBe(true);
    expect(b.getAttribute("aria-label")).toBe("Reprendre le défilement");
  });

  it("mouvement réduit : bande immobile, sans copie ni bouton", () => {
    reduce(true);
    show();
    const band = document.querySelector("[data-band]")!;
    expect(band.classList.contains("still")).toBe(true);
    expect(band.querySelector('ul[aria-hidden="true"]')).toBeNull();
    expect(document.querySelector("[data-band-toggle]")).toBeNull();
  });
});
