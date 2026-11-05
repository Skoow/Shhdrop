// @vitest-environment happy-dom
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    expect(document.body.textContent).toContain("Chiffrés sur votre appareil avant l'envoi");
    const svg = document.querySelector('svg[role="img"]')!;
    expect(svg.getAttribute("aria-label")).toBe(
      "Votre appareil — chiffré — serveur (ne voit rien) — chiffré — destinataire",
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

  it("anglais", () => {
    setLang("en");
    show();
    expect(document.querySelector("h1")!.textContent).toBe("One link, one password, then nothing.");
    expect(document.querySelector('svg[role="img"]')!.getAttribute("aria-label")).toBe(
      "Your device — encrypted — server (sees nothing) — encrypted — recipient",
    );
  });
});
