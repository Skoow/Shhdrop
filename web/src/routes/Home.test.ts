// @vitest-environment happy-dom
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/i18n.svelte";
import Home from "./Home.svelte";

let c: Record<string, unknown> | null = null;
function show(props: Record<string, unknown> = {}) {
  c = mount(Home as never, { target: document.body, props }) as Record<string, unknown>;
  flushSync();
}

beforeEach(() => setLang("fr"));
afterEach(() => {
  if (c) void unmount(c);
  c = null;
  document.body.innerHTML = "";
});

describe("Home (UI §9.1)", () => {
  it("titre, phrase, schéma nommé, lien Comment ça marche, emplacement du composeur", () => {
    show();
    const h1 = document.querySelector("h1")!;
    expect(h1.textContent).toBe("Un lien, un mot de passe, puis plus rien.");
    expect(h1.getAttribute("tabindex")).toBe("-1");
    expect(h1.classList.contains("compact")).toBe(false);
    expect(document.body.textContent).toContain(
      "Chiffrés sur votre appareil avant l'envoi\u202f: le serveur ne reçoit que des données chiffrées, jamais la clé.",
    );
    // Libellés visibles en HTML (taille de texte relative), cachés aux lecteurs d'écran : le nom est l'aria-label.
    const labels = [...document.querySelectorAll("[data-label]")].map((e) => e.textContent);
    expect(labels).toEqual(["chiffré", "chiffré", "Votre appareil", "Serveur", "ne lit rien", "Destinataire"]);
    expect(document.querySelector("svg text")).toBeNull();
    for (const e of document.querySelectorAll("[data-label]")) expect(e.closest('[aria-hidden="true"]')).not.toBeNull();
    const svg = document.querySelector('svg[role="img"]')!;
    expect(svg.getAttribute("aria-label")).toBe(
      "Votre appareil — chiffré — serveur (ne lit rien) — chiffré — destinataire",
    );
    const a = [...document.querySelectorAll("a")].find((x) => x.textContent === "Comment ça marche")!;
    expect(a.getAttribute("href")).toBe("/securite");
    expect(document.querySelector('[data-slot="compose"]')).not.toBeNull();
  });

  it("compact : titre replié, phrase et schéma retirés ; le titre reste le même h1", () => {
    show({ compact: true });
    const h1 = document.querySelector("h1")!;
    expect(h1.textContent).toBe("Un lien, un mot de passe, puis plus rien.");
    expect(h1.classList.contains("compact")).toBe(true);
    expect(document.querySelector('svg[role="img"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Chiffrés sur votre appareil");
    expect(document.querySelector("a")).toBeNull();
    expect(document.querySelector('[data-slot="compose"]')).not.toBeNull();
  });

  it("le composeur fourni remplace l'emplacement réservé", () => {
    const children = createRawSnippet(() => ({ render: () => `<div id="composeur">c</div>` }));
    show({ children });
    expect(document.getElementById("composeur")).not.toBeNull();
    expect(document.querySelector('[data-slot="compose"] #composeur')).not.toBeNull();
  });

  it("le trait n'est tracé qu'une fois par chargement de page (UI §9.1)", async () => {
    // Modules neufs = nouveau chargement de page : le drapeau « déjà tracé » est remis à zéro.
    vi.resetModules();
    const { default: Fresh } = await import("./Home.svelte");
    const { mount, flushSync, unmount } = await import("svelte");
    const a = mount(Fresh as never, { target: document.body, props: {} });
    flushSync();
    expect(document.querySelector("svg.draw")).not.toBeNull();
    void unmount(a);
    document.body.innerHTML = "";
    const b = mount(Fresh as never, { target: document.body, props: {} });
    flushSync();
    expect(document.querySelector('svg[role="img"]')).not.toBeNull();
    expect(document.querySelector("svg.draw")).toBeNull();
    void unmount(b);
  });

  it("anglais", () => {
    setLang("en");
    show();
    expect(document.querySelector("h1")!.textContent).toBe("One link, one password, then nothing.");
    expect(document.querySelector('svg[role="img"]')!.getAttribute("aria-label")).toBe(
      "Your device — encrypted — server (can't read it) — encrypted — recipient",
    );
  });
});
