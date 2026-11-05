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
/** Nom lu par les lecteurs d'écran : le texte hors des parties aria-hidden (K8). */
function title(h1: Element): string {
  const c = h1.cloneNode(true) as Element;
  c.querySelectorAll('[aria-hidden="true"]').forEach((e) => e.remove());
  return c.textContent!.trim();
}
afterEach(() => {
  if (c) void unmount(c);
  c = null;
  document.body.innerHTML = "";
});

describe("Home (UI §9.1)", () => {
  it("titre, phrase, schéma nommé, lien Comment ça marche, emplacement du composeur", () => {
    show();
    const h1 = document.querySelector("h1")!;
    expect(title(h1)).toBe("Un lien, un mot de passe, puis plus rien.");
    expect(h1.getAttribute("tabindex")).toBe("-1");
    expect(h1.classList.contains("compact")).toBe(false);
    expect(document.body.textContent).toContain(
      "Chiffrés sur votre appareil avant l'envoi\u202f: le serveur ne reçoit que des données chiffrées, jamais la clé.",
    );
    // Libellés visibles en HTML (taille de texte relative), cachés aux lecteurs d'écran : le nom est l'aria-label.
    const labels = [...document.querySelectorAll("[data-label]")].map((e) => e.textContent);
    expect(labels).toEqual(["chiffré", "chiffré", "Votre appareil", "Serveur", "ne lit rien", "Destinataire"]);
    for (const e of document.querySelectorAll("[data-label]")) expect(e.closest('[aria-hidden="true"]')).not.toBeNull();
    const svg = document.querySelector('[role="img"]')!;
    expect(svg.getAttribute("aria-label")).toBe(
      "Votre appareil — chiffré — serveur (ne lit rien) — chiffré — destinataire",
    );
    const a = [...document.querySelectorAll("a")].find((x) => x.textContent?.trim() === "Comment ça marche")!;
    expect(a.getAttribute("href")).toBe("/securite");
    expect(document.querySelector('[data-slot="compose"]')).not.toBeNull();
  });

  it("compact : titre replié, phrase et schéma retirés ; le titre reste le même h1", () => {
    show({ compact: true });
    const h1 = document.querySelector("h1")!;
    expect(title(h1)).toBe("Un lien, un mot de passe, puis plus rien.");
    expect(h1.classList.contains("compact")).toBe(true);
    expect(document.querySelector('[role="img"]')).toBeNull();
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

  it("titre (K1, K8) : phrase entière lisible, copie mot par mot cachée, respiration avant « puis »", () => {
    show();
    const h1 = document.querySelector("h1")!;
    expect(h1.querySelector(".sr-only")!.textContent).toBe("Un lien, un mot de passe, puis plus rien.");
    const copy = h1.querySelector('[aria-hidden="true"]')!;
    const words = [...copy.querySelectorAll<HTMLElement>(".w")];
    expect(words.map((w) => w.textContent)).toEqual(["Un", "lien,", "un", "mot", "de", "passe,", "puis", "plus", "rien."]);
    const delays = words.map((w) => w.style.getPropertyValue("--d"));
    expect(delays).toEqual(["0ms", "35ms", "70ms", "105ms", "140ms", "175ms", "240ms", "275ms", "310ms"]);
  });

  it("réceptacle vide : Fichiers et Photo ouvrent leur sélecteur ; les fichiers choisis sont remis", () => {
    const onfiles = vi.fn();
    show({ onfiles });
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')];
    expect(inputs).toHaveLength(2);
    expect(inputs[1]!.accept).toBe("image/*");
    expect(inputs[1]!.getAttribute("capture")).toBe("environment");
    const clicks = inputs.map((i) => vi.spyOn(i, "click").mockImplementation(() => undefined));
    const [files, photo] = [...document.querySelectorAll<HTMLButtonElement>(".add")];
    expect(files!.textContent!.trim()).toBe("Fichiers");
    files!.click();
    photo!.click();
    expect(clicks[0]).toHaveBeenCalledTimes(1);
    expect(clicks[1]).toHaveBeenCalledTimes(1);
    // Un clic sur le verre (hors bouton) ouvre aussi le sélecteur de fichiers.
    (document.querySelector(".empty") as HTMLElement).click();
    expect(clicks[0]).toHaveBeenCalledTimes(2);
  });

  it("anglais", () => {
    setLang("en");
    show();
    expect(title(document.querySelector("h1")!)).toBe("One link, one password, then nothing.");
    expect(document.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe(
      "Your device — encrypted — server (can't read it) — encrypted — recipient",
    );
  });
});
