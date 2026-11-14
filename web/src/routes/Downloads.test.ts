// @vitest-environment happy-dom
// Page « Téléchargements » (/telechargements, conception compte §21.15.5) : textes exacts,
// groupes par jour, lignes (nom, taille, source, heure, Retirer), « Effacer tout » confirmé,
// états vide et désactivé. Stockage en mémoire (chemin de la démo) : rien n'est écrit ailleurs.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/i18n.svelte";

vi.mock("../app/demo-hooks", () => ({ getDemo: () => ({}) }));
const live = await import("../downloads/live.svelte");
const { default: Downloads } = await import("./Downloads.svelte");

const NNBSP = " ";
const NOW = new Date(2026, 10, 14, 16, 0);
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
  flushSync();
};
let app: Record<string, unknown> | null = null;
const show = async () => {
  app = mount(Downloads as never, { target: document.body }) as Record<string, unknown>;
  await settle();
};
const text = () => document.body.textContent!.replace(/[ \n\t]+/g, " ");
const button = (name: string) => [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent!.trim()) === name)!;

beforeEach(async () => {
  setLang("fr");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await live.setDownloadsEnabled(true);
  await live.clearDownloads();
});
afterEach(() => {
  if (app) void unmount(app);
  app = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("Téléchargements", () => {
  it("vide : titre, sous-titre, outils, message et pied exacts", async () => {
    await show();
    expect(document.querySelector("h1")!.textContent).toBe("Téléchargements");
    expect(text()).toContain(`Sur cet appareil seulement. Nous ne gardons rien${NNBSP}: les fichiers sont dans le dossier Téléchargements de votre appareil.`);
    expect(document.querySelector("[role=switch]")!.textContent).toContain("Garder l'historique");
    expect(document.querySelector("[role=switch]")!.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector("[data-downloads-empty]")!.textContent).toContain("Aucun téléchargement pour l'instant.");
    expect(text()).toContain(`Les entrées de plus de 30${NNBSP}jours sont effacées.`);
  });

  it("groupes par jour (Aujourd'hui, Hier, 12 novembre) ; ligne : nom, taille, source, heure, Retirer", async () => {
    await live.recordDownload({ name: "rapport annuel 2026.pdf", sizeBytes: 148_897_792, format: { family: "pdf", label: "PDF" }, source: "partage", savedAt: at(14, 9, 41) });
    await live.recordDownload({ name: "photo.jpg", sizeBytes: 2048, format: { family: "image", label: "JPG" }, source: "salon", savedAt: at(13, 22, 5) });
    await live.recordDownload({ name: "notes.txt", sizeBytes: 10, format: { family: "text", label: "TXT" }, source: "partage", savedAt: at(12, 8, 0) });
    await show();
    expect([...document.querySelectorAll("[data-day] h2")].map((h) => h.textContent!.trim())).toEqual(["Aujourd'hui", "Hier", "12 novembre"]);
    const rows = [...document.querySelectorAll("[data-download-row]")];
    expect(rows).toHaveLength(3);
    const r0 = rows[0]!.textContent!.replace(/[ \n\t]+/g, " ");
    expect(rows[0]!.querySelector("bdi")!.getAttribute("title")).toBe("rapport annuel 2026.pdf");
    expect(r0).toContain(`142${NNBSP}Mo`);
    expect(r0).toContain("Partage reçu");
    expect(r0).toContain("9 h 41");
    expect(rows[1]!.textContent).toContain("Salon");
    expect(rows[0]!.querySelector("button")!.getAttribute("aria-label")).toBe("Retirer de l'historique");
  });

  it("Retirer : la ligne part ; « Effacer tout » demande « Effacer tout l'historique de cet appareil ? »", async () => {
    await live.recordDownload({ name: "a.txt", sizeBytes: 1, format: { family: "text", label: "TXT" }, source: "partage", savedAt: at(14, 10) });
    await live.recordDownload({ name: "b.txt", sizeBytes: 1, format: { family: "text", label: "TXT" }, source: "partage", savedAt: at(14, 11) });
    await show();
    document.querySelector<HTMLButtonElement>("[data-download-row] button")!.click();
    await settle();
    expect(document.querySelectorAll("[data-download-row]")).toHaveLength(1);
    button("Effacer tout").click();
    await settle();
    expect(text()).toContain(`Effacer tout l'historique de cet appareil${NNBSP}?`);
    button("Effacer").click();
    await settle();
    expect(document.querySelectorAll("[data-download-row]")).toHaveLength(0);
    expect(document.querySelector("[data-downloads-empty]")).not.toBeNull();
  });

  it("désactivé : historique effacé, « L'historique est désactivé » et « L'activer » ; rien n'est noté", async () => {
    await live.recordDownload({ name: "a.txt", sizeBytes: 1, format: { family: "text", label: "TXT" }, source: "partage", savedAt: at(14, 10) });
    await show();
    document.querySelector<HTMLButtonElement>("[role=switch]")!.click();
    await settle();
    expect(document.querySelectorAll("[data-download-row]")).toHaveLength(0);
    const off = document.querySelector("[data-downloads-off]")!;
    expect(off.textContent).toContain("L'historique est désactivé");
    await live.recordDownload({ name: "b.txt", sizeBytes: 1, format: { family: "text", label: "TXT" }, source: "partage", savedAt: at(14, 11) });
    await settle();
    expect(document.querySelectorAll("[data-download-row]")).toHaveLength(0);
    button("L'activer").click();
    await settle();
    expect(document.querySelector("[data-downloads-off]")).toBeNull();
    expect(document.querySelector("[role=switch]")!.getAttribute("aria-checked")).toBe("true");
  });

  it("anglais : mêmes écrans, textes de en.ts", async () => {
    setLang("en");
    await live.recordDownload({ name: "a.txt", sizeBytes: 1, format: { family: "text", label: "TXT" }, source: "salon", savedAt: at(12, 10) });
    await show();
    expect(document.querySelector("h1")!.textContent).toBe("Downloads");
    expect([...document.querySelectorAll("[data-day] h2")].map((h) => h.textContent!.trim())).toEqual(["November 12"]);
    expect(text()).toContain("Room");
  });
});
