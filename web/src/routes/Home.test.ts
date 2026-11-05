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
    expect(labels).toEqual([
      "Votre appareil",
      "Chiffré ici",
      "Serveur",
      "Illisible",
      "Destinataire",
      "Déchiffré ici",
      "La clé ne passe jamais par le serveur",
    ]);
    for (const e of document.querySelectorAll("[data-label]")) expect(e.closest('[aria-hidden="true"]')).not.toBeNull();
    const svg = document.querySelector('[role="img"]')!;
    expect(svg.getAttribute("aria-label")).toBe(
      "Chiffré sur votre appareil, illisible pour le serveur, déchiffré chez le destinataire\u202f; la clé passe à part, jamais par le serveur.",
    );
    const a = [...document.querySelectorAll("a")].find((x) => x.textContent?.trim() === "Tous les détails de sécurité")!;
    expect(a.getAttribute("href")).toBe("/securite");
    // « Comment ça marche » fait défiler vers sa section : un bouton, jamais un « # » dans l'adresse.
    const how = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === "Comment ça marche")!;
    expect(how).toBeDefined();
    expect([...document.querySelectorAll("a")].some((x) => x.getAttribute("href")?.includes("#"))).toBe(false);
    // Sections sous le pli, chacune titrée.
    const h2 = [...document.querySelectorAll("h2")].map((h) => h.textContent!.trim());
    expect(h2).toEqual([
      "Glissez vos fichiers iciQue voulez-vous envoyer\u202f?",
      "Comment ça marche",
      "Pourquoi c'est sûr",
      "Ce que Shhdrop ne peut pas faire",
      "Vos questions",
      "Quelque chose à transmettre\u202f?",
    ]);
    expect(document.querySelectorAll(".claim")).toHaveLength(9);
    expect(document.querySelectorAll("details[name=faq]")).toHaveLength(6);
    expect(document.querySelectorAll(".certs > li")).toHaveLength(3);
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

  it("entrée une seule fois (§20.4) : la classe reveal part après 900 ms, jamais rejouée", async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules(); // nouveau chargement de page : le drapeau « déjà joué » repart de zéro
      const { default: Fresh } = await import("./Home.svelte");
      const { mount, flushSync, unmount } = await import("svelte");
      const a = mount(Fresh as never, { target: document.body, props: {} });
      flushSync();
      expect(document.querySelector(".home")!.classList.contains("reveal")).toBe(true);
      vi.advanceTimersByTime(899);
      flushSync();
      expect(document.querySelector(".home")!.classList.contains("reveal")).toBe(true);
      vi.advanceTimersByTime(1);
      flushSync();
      expect(document.querySelector(".home")!.classList.contains("reveal")).toBe(false);
      // Changement de langue : les mots recréés n'ont plus d'entrée.
      setLang("en");
      flushSync();
      expect(document.querySelector(".home")!.classList.contains("reveal")).toBe(false);
      void unmount(a);
      document.body.innerHTML = "";
      // Second montage dans le même chargement : pas d'entrée du tout.
      const b = mount(Fresh as never, { target: document.body, props: {} });
      flushSync();
      expect(document.querySelector(".home")!.classList.contains("reveal")).toBe(false);
      void unmount(b);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fenêtre de dépôt : Parcourir, Photo et Vidéo ouvrent leur sélecteur ; un clic sur le verre n'ouvre rien", () => {
    const onfiles = vi.fn();
    show({ onfiles });
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')];
    expect(inputs).toHaveLength(3);
    const [files, photo, video] = inputs as [HTMLInputElement, HTMLInputElement, HTMLInputElement];
    expect(files.multiple).toBe(true);
    expect(files.accept).toBe("");
    expect(photo.accept).toBe("image/*");
    expect(photo.getAttribute("capture")).toBe("environment");
    expect(video.accept).toBe("video/*");
    expect(video.getAttribute("capture")).toBe("environment");
    const clicks = inputs.map((i) => vi.spyOn(i, "click").mockImplementation(() => undefined));
    const button = (name: string) => [...document.querySelectorAll("button")].find((b) => b.textContent!.trim() === name)!;
    button("Parcourir les fichiers").click();
    button("Photo").click();
    button("Vidéo").click();
    expect(clicks.map((c) => c.mock.calls.length)).toEqual([1, 1, 1]);
    // Le verre n'est qu'une cible de dépôt : aucun sélecteur sans contexte (décision du propriétaire).
    (document.querySelector(".empty") as HTMLElement).click();
    (document.querySelector(".drop-title") as HTMLElement).click();
    expect(clicks.map((c) => c.mock.calls.length)).toEqual([1, 1, 1]);
    // Les fichiers choisis sont remis avec leur source ; le champ est vidé.
    const f = new File(["x"], "a.txt");
    Object.defineProperty(video, "files", { configurable: true, value: [f] });
    video.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onfiles).toHaveBeenCalledWith([f], "video", []);
  });

  it("actions : groupe nommé ; Vocal sans MediaRecorder et Coller sans clipboard.read sont masqués (§9.2.1)", () => {
    const clip = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {} });
    try {
      show();
    } finally {
      if (clip) Object.defineProperty(navigator, "clipboard", clip);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
    const group = document.querySelector('[role="group"]')!;
    expect(document.getElementById(group.getAttribute("aria-labelledby")!)!.textContent).toBe("Ou créez sur place");
    const names = [...group.querySelectorAll("button")].map((b) => b.textContent!.trim());
    expect(names).toEqual(["Photo", "Vidéo", "Texte"]);
  });

  it("actions : Vocal et Coller présents quand le navigateur les permet ; rappel onaction", () => {
    vi.stubGlobal("MediaRecorder", class {});
    const clip = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { read: async () => [] } });
    try {
      const onaction = vi.fn();
      show({ onaction });
      const group = document.querySelector('[role="group"]')!;
      const buttons = [...group.querySelectorAll("button")];
      expect(buttons.map((b) => b.textContent!.trim())).toEqual(["Photo", "Vidéo", "Vocal", "Texte", "Coller"]);
      buttons[2]!.click();
      buttons[3]!.click();
      buttons[4]!.click();
      expect(onaction.mock.calls).toEqual([["vocal"], ["texte"], ["coller"]]);
    } finally {
      vi.unstubAllGlobals();
      if (clip) Object.defineProperty(navigator, "clipboard", clip);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it("dépôt : les fichiers vont à onfiles, les dossiers sont remis à part (refusés, pas aplatis)", async () => {
    const onfiles = vi.fn();
    show({ onfiles });
    const a = new File(["a"], "a.txt");
    const dir = new File([], "Vacances");
    const items = [
      { kind: "file", getAsFile: () => a, webkitGetAsEntry: () => ({ isDirectory: false, name: "a.txt" }) },
      { kind: "file", getAsFile: () => null, webkitGetAsEntry: () => ({ isDirectory: true, name: dir.name }) },
    ];
    const e = new Event("drop", { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(e, "dataTransfer", { value: { types: ["Files"], items, files: [] } });
    window.dispatchEvent(e as unknown as Event);
    await Promise.resolve();
    expect(e.defaultPrevented).toBe(true);
    expect(onfiles).toHaveBeenCalledWith([a], "depot", ["Vacances"]);
  });

  it("anglais", () => {
    setLang("en");
    show();
    expect(title(document.querySelector("h1")!)).toBe("One link, one password, then nothing.");
    expect(document.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe(
      "Encrypted on your device, unreadable to the server, decrypted at the recipient; the key travels separately, never through the server.",
    );
  });
});
