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
  it("accueil (refonte du 12 novembre) : sur-titre, titre, phrase, deux boutons, méta, infographie, composeur, sections", () => {
    show();
    const h1 = document.querySelector("h1")!;
    expect(title(h1)).toBe("Un lien, un mot de passe, puis plus rien.");
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(h1.getAttribute("tabindex")).toBe("-1");
    expect(h1.classList.contains("compact")).toBe(false);
    expect(document.querySelector("[data-eyebrow]")!.textContent).toBe("Chiffré de bout en bout · Hébergé en Europe");
    expect(document.querySelector(".lede")!.textContent!.length).toBeGreaterThan(20);
    const pick = document.querySelector<HTMLButtonElement>("[data-pick]")!;
    expect(pick.textContent!.trim()).toBe("Choisir des fichiers");
    expect(pick.querySelector("svg")).not.toBeNull();
    const room = document.querySelector<HTMLButtonElement>("[data-room] button")!;
    expect(room.textContent).toContain("Ouvrir un salon");
    expect(room.textContent).toContain("bientôt");
    expect(room.getAttribute("aria-disabled")).toBe("true");
    const meta = [...document.querySelectorAll("[data-meta] li")].map((l) => l.textContent!.trim());
    expect(meta).toEqual(["Gratuit jusqu'à 2\u202fGo", "Sans compte", "S'efface après ouverture"]);
    expect(document.querySelector("[data-demo]")).not.toBeNull();
    const a = [...document.querySelectorAll("a")].find((x) => x.textContent?.trim() === "Tous les détails de sécurité")!;
    expect(a.getAttribute("href")).toBe("/securite");
    expect([...document.querySelectorAll("a")].some((x) => x.getAttribute("href")?.includes("#"))).toBe(false);
    // Sections sous le pli, chacune titrée.
    const h2 = [...document.querySelectorAll("h2")].map((h) => h.textContent!.trim());
    expect(h2).toEqual([
      "Ce qui se passe quand vous partagez",
      "Nos engagements",
      "Glissez vos fichiers iciQue voulez-vous envoyer\u202f?",
      "Comment ça marche",
      "Pensé pour la confidentialité",
      "Offres",
      "Vos questions",
    ]);
    expect(document.querySelectorAll("[data-how-card]")).toHaveLength(3);
    const priv = [...document.querySelectorAll("[data-priv-card]")];
    expect(priv).toHaveLength(4);
    expect(priv.map((c) => c.querySelector("h3")!.textContent!.trim())).toEqual(["Sans compte", "Rien de lisible sur le serveur", "Photos nettoyées", "Salon éphémère bientôt"]);
    for (const c of [...document.querySelectorAll("[data-how-card], [data-priv-card]")]) expect(c.querySelector(".tile-ic svg")).not.toBeNull();
    // La clé après le « # » (retirée par la refonte, remise le 12 novembre) : une ligne courte et vraie.
    const key = document.querySelector("section.priv [data-key-note]")!;
    expect(key.textContent!.trim()).toBe("La clé du lien est après le «\u00a0#\u00a0»\u202f: les navigateurs n'envoient jamais cette partie au serveur.");
    expect(key.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect([...document.querySelectorAll("[data-offer]")].map((o) => o.getAttribute("data-offer"))).toEqual(["free", "plus", "pro"]);
    expect(document.querySelectorAll("details[name=faq]")).toHaveLength(5);
    expect(document.querySelector('[data-slot="compose"]')).not.toBeNull();
  });

  it("compact : titre replié, phrase et schéma retirés ; le titre reste le même h1", () => {
    show({ compact: true });
    const h1 = document.querySelector("h1")!;
    expect(title(h1)).toBe("Un lien, un mot de passe, puis plus rien.");
    expect(h1.classList.contains("compact")).toBe(true);
    expect(document.querySelector("[data-demo]")).toBeNull();
    expect(document.querySelector("[data-pick]")).toBeNull();
    expect(document.querySelector("[data-eyebrow]")).toBeNull();
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

  it("« Choisir des fichiers » ouvre le sélecteur du composeur (onpick) ; « Commencer » (fenêtre, téléphone) mène à la page d'envoi (onadd) ; un clic sur le verre n'ouvre rien", () => {
    const onfiles = vi.fn();
    const onaction = vi.fn();
    const onadd = vi.fn();
    const onpick = vi.fn();
    show({ onfiles, onaction, onadd, onpick });
    // Plus de sélecteur propre à l'accueil : le composeur tient le seul champ fichier.
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(0);
    (document.querySelector("[data-pick]") as HTMLButtonElement).click();
    expect(onpick).toHaveBeenCalledTimes(1);
    expect(onadd).not.toHaveBeenCalled();
    const buttons = (name: string) => [...document.querySelectorAll("button")].filter((b) => b.textContent!.trim() === name);
    const starts = buttons("Commencer");
    expect(starts).toHaveLength(1); // fenêtre de dépôt ; le grand bouton du téléphone a aussi un sous-titre
    expect(starts[0]!.hasAttribute("aria-haspopup")).toBe(false); // une navigation, pas une feuille
    starts[0]!.click();
    expect(onadd).toHaveBeenCalledTimes(1);
    buttons("Photo ou vidéo")[0]!.click();
    expect(onaction.mock.calls).toEqual([["media"]]);
    const big = document.querySelector(".add-big") as HTMLButtonElement;
    expect(big.querySelector(".ab-t")!.textContent).toBe("Commencer");
    big.click();
    expect(onadd).toHaveBeenCalledTimes(2);
    // Le verre n'est qu'une cible de dépôt (décision du propriétaire).
    (document.querySelector(".empty") as HTMLElement).click();
    (document.querySelector(".drop-title") as HTMLElement).click();
    expect(onadd).toHaveBeenCalledTimes(2);
    expect(onpick).toHaveBeenCalledTimes(1);
    expect(onfiles).not.toHaveBeenCalled();
  });

  it("actions : groupe nommé ; Vocal masqué sans MediaRecorder ; jamais de bouton Coller (Ctrl/Cmd + V suffit)", () => {
    const clip = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { read: async () => [] } });
    try {
      show();
    } finally {
      if (clip) Object.defineProperty(navigator, "clipboard", clip);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
    const group = document.querySelector('.make[role="group"]')!;
    expect(document.getElementById(group.getAttribute("aria-labelledby")!)!.textContent).toBe("Ou créez sur place");
    const names = [...group.querySelectorAll("button")].map((b) => b.textContent!.trim());
    expect(names).toEqual(["Photo ou vidéo", "Note"]);
  });

  it("actions : Vocal présent quand MediaRecorder existe ; rappel onaction", () => {
    vi.stubGlobal("MediaRecorder", class {});
    try {
      const onaction = vi.fn();
      show({ onaction });
      const group = document.querySelector('.make[role="group"]')!;
      const buttons = [...group.querySelectorAll("button")];
      expect(buttons.map((b) => b.textContent!.trim())).toEqual(["Photo ou vidéo", "Vocal", "Note"]);
      buttons[1]!.click();
      buttons[2]!.click();
      expect(onaction.mock.calls).toEqual([["vocal"], ["texte"]]);
    } finally {
      vi.unstubAllGlobals();
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

  it("démo (GitHub Pages, hors d'Europe) : sur-titre sans « Hébergé en Europe », en français comme en anglais", () => {
    vi.stubEnv("MODE", "demo");
    try {
      show();
      expect(document.querySelector("[data-eyebrow]")!.textContent).toBe("Chiffré de bout en bout");
      if (c) void unmount(c);
      document.body.innerHTML = "";
      setLang("en");
      show();
      expect(document.querySelector("[data-eyebrow]")!.textContent).toBe("End-to-end encrypted");
      expect(document.body.textContent).not.toMatch(/Europe/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("anglais", () => {
    setLang("en");
    show();
    expect(title(document.querySelector("h1")!)).toBe("One link, one password, then nothing.");
    expect(document.querySelector("[data-eyebrow]")!.textContent).toBe("End-to-end encrypted · Hosted in Europe");
    expect(document.querySelector("[data-pick]")!.textContent!.trim()).toBe("Choose files");
    expect(document.querySelector("[data-key-note]")!.textContent!.trim()).toBe("The link's key comes after the “#”: browsers never send that part to the server.");
    expect([...document.querySelectorAll("[data-meta] li")].map((l) => l.textContent!.trim())).toEqual(["Free up to 2\u00a0GB", "No account", "Erased after opening"]);
  });
});
