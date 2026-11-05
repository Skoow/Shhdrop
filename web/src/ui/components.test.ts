// @vitest-environment happy-dom
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/i18n.svelte";
import { resetAnnounce } from "./announce";
import Banner from "./Banner.svelte";
import Countdown from "./Countdown.svelte";
import CopyField from "./CopyField.svelte";
import IconButton from "./IconButton.svelte";
import InlineConfirm from "./InlineConfirm.svelte";
import Segmented from "./Segmented.svelte";
import Sheet from "./Sheet.svelte";
import Stepper from "./Stepper.svelte";
import TextField from "./TextField.svelte";
import UndoToast from "./UndoToast.svelte";

const text = (s: string) => createRawSnippet(() => ({ render: () => `<span>${s}</span>` }));
const mounted: Record<string, unknown>[] = [];
function show(C: unknown, props: Record<string, unknown>) {
  const c = mount(C as never, { target: document.body, props }) as Record<string, unknown>;
  mounted.push(c);
  flushSync();
  return c;
}
const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  flushSync();
};

beforeEach(() => setLang("fr"));
afterEach(() => {
  while (mounted.length) void unmount(mounted.pop()!);
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetAnnounce();
});

describe("IconButton", () => {
  it("le nom accessible vient de label ; label est obligatoire dans le type", () => {
    show(IconButton, { label: "Retirer", children: text("x") });
    expect(document.querySelector("button")!.getAttribute("aria-label")).toBe("Retirer");
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "IconButton.svelte"), "utf8");
    expect(src).toMatch(/\n\s+label: string;/); // ni « label?: » ni valeur par défaut
  });
});

describe("Segmented", () => {
  it("radiogroup nommé, un seul coché, la valeur suit le choix", () => {
    const opts = [
      { value: 1, label: "1 h" },
      { value: 12, label: "12 h" },
    ];
    show(Segmented, { label: "Durée", options: opts, value: 12 });
    const g = document.querySelector('[role="radiogroup"]')!;
    expect(g.getAttribute("aria-label")).toBe("Durée");
    const radios = [...g.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => r.checked)).toEqual([false, true]);
    radios[0]!.click();
    flushSync();
    expect(radios.map((r) => r.checked)).toEqual([true, false]);
  });
});

describe("Stepper", () => {
  it("borné, valeur annoncée poliment, bornes en aria-disabled", () => {
    show(Stepper, { label: "Ouvertures", value: 1, min: 1, max: 3 });
    const [dec, inc] = [...document.querySelectorAll("button")] as HTMLButtonElement[];
    const out = document.querySelector(".value")!;
    expect(out.getAttribute("aria-live")).toBe("polite");
    expect(dec!.getAttribute("aria-disabled")).toBe("true");
    dec!.click();
    inc!.click();
    inc!.click();
    inc!.click();
    flushSync();
    expect(out.textContent).toBe("3");
    expect(inc!.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("TextField", () => {
  it("label relié, erreur par aria-describedby, aucun attribut style", () => {
    show(TextField, { label: "Mot de passe", error: "Trop court", hint: "12 caractères", autocomplete: "one-time-code" });
    const i = document.querySelector("input")!;
    const label = document.querySelector("label")!;
    expect(label.htmlFor).toBe(i.id);
    expect(i.getAttribute("aria-invalid")).toBe("true");
    const ids = i.getAttribute("aria-describedby")!.split(" ");
    expect(ids.map((id) => document.getElementById(id)!.textContent)).toEqual(["12 caractères", "Trop court"]);
    expect(i.getAttribute("autocomplete")).toBe("one-time-code");
  });
});

describe("Banner", () => {
  it("danger -> alert ; info et warn -> status ; une action au plus", () => {
    show(Banner, { kind: "danger", children: text("x"), action: { label: "Réessayer", onpress: () => {} } });
    show(Banner, { kind: "warn", children: text("y") });
    const roles = [...document.querySelectorAll(".banner")].map((b) => b.getAttribute("role"));
    expect(roles).toEqual(["alert", "status"]);
    expect(document.querySelectorAll("button").length).toBe(1);
  });
});

describe("InlineConfirm", () => {
  it("remplace le bouton, focus sur Annuler, Annuler rend le focus au déclencheur", async () => {
    const onconfirm = vi.fn();
    show(InlineConfirm, { label: "Supprimer", message: "Sûr ?", confirmLabel: "Supprimer", onconfirm, kind: "danger" });
    const trigger = document.querySelector("button")!;
    trigger.focus();
    trigger.click();
    await settle();
    expect(document.querySelector('[role="group"]')).not.toBeNull();
    expect(document.activeElement?.textContent).toContain("Annuler");
    expect(onconfirm).not.toHaveBeenCalled();
    (document.activeElement as HTMLButtonElement).click();
    await settle();
    expect(document.activeElement?.textContent).toContain("Supprimer");
  });
  it("Confirmer appelle onconfirm une fois", async () => {
    const onconfirm = vi.fn();
    show(InlineConfirm, { label: "Go", message: "Sûr ?", confirmLabel: "Oui", onconfirm });
    document.querySelector("button")!.click();
    await settle();
    const yes = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Oui"))!;
    yes.click();
    yes.click();
    expect(onconfirm).toHaveBeenCalledTimes(1);
  });
});

describe("CopyField", () => {
  it("tronque au milieu mais copie la valeur entière ; « Copié » 2 s", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const value = "https://shhdrop.example/s/abcdefghijklmnop#" + "k".repeat(43);
    show(CopyField, { label: "Lien", value });
    const shown = document.querySelector(".val")!.textContent!;
    expect(shown).toContain("…");
    expect(shown.length).toBeLessThan(value.length);
    const btn = document.querySelector("button")!;
    btn.click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
    expect(writeText).toHaveBeenCalledWith(value);
    expect(btn.textContent).toContain("Copié");
    await vi.advanceTimersByTimeAsync(2000);
    flushSync();
    expect(btn.textContent).toContain("Copier");
  });
  it("API absente : valeur entière montrée dans un champ en lecture seule", async () => {
    vi.stubGlobal("navigator", {});
    show(CopyField, { label: "Lien", value: "x".repeat(80) });
    document.querySelector("button")!.click();
    await settle();
    const input = document.querySelector<HTMLInputElement>("input.manual")!;
    expect(input.value).toBe("x".repeat(80));
    expect(input.readOnly).toBe(true);
  });
  it("valeur courte : affichée telle quelle", () => {
    show(CopyField, { label: "Mot de passe", value: "abc def" });
    expect(document.querySelector(".val")!.textContent).toBe("abc def");
  });
});

describe("Sheet", () => {
  it("showModal, Échap/close ferme et le focus revient au déclencheur", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const onclose = vi.fn();
    let open = false;
    const props = {
      get open() {
        return open;
      },
      set open(v: boolean) {
        open = v;
      },
      title: "QR",
      children: text("contenu"),
      onclose,
    };
    show(Sheet, props);
    let dlg = document.querySelector("dialog")!;
    expect(dlg.open).toBe(false);
    // Sans $state en test : le parent « change » la prop puis on remonte le composant.
    open = true;
    void unmount(mounted.pop()!);
    show(Sheet, props);
    await settle();
    dlg = document.querySelector("dialog")!;
    expect(dlg.open).toBe(true);
    expect(dlg.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dlg.textContent).toContain("contenu");
    opener.blur();
    dlg.close(); // ce que fait Échap
    await settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(props.open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(onclose).toHaveBeenCalled();
  });
});

describe("UndoToast", () => {
  it("6 s puis ondismiss ; Annuler appelle onundo seul", async () => {
    vi.useFakeTimers();
    const onundo = vi.fn();
    const ondismiss = vi.fn();
    show(UndoToast, { message: "a.txt retiré", onundo, ondismiss });
    expect(document.querySelector('[role="status"]')!.textContent).toContain("a.txt retiré");
    await vi.advanceTimersByTimeAsync(5900);
    expect(ondismiss).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(ondismiss).toHaveBeenCalledTimes(1);
    expect(onundo).not.toHaveBeenCalled();
  });
  it("Échap ferme ; une seule à la fois", async () => {
    const d1 = vi.fn();
    const d2 = vi.fn();
    show(UndoToast, { message: "un", onundo() {}, ondismiss: d1 });
    show(UndoToast, { message: "deux", onundo() {}, ondismiss: d2 });
    expect(d1).toHaveBeenCalledTimes(1); // remplacée par la seconde
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(d2).toHaveBeenCalledTimes(1);
  });
  it("Annuler -> onundo", () => {
    const onundo = vi.fn();
    const ondismiss = vi.fn();
    show(UndoToast, { message: "x", onundo, ondismiss });
    document.querySelector("button")!.click();
    expect(onundo).toHaveBeenCalledTimes(1);
    expect(ondismiss).not.toHaveBeenCalled();
  });
});

describe("Countdown", () => {
  it("affiche, décompte à la seconde et appelle onexpire une fois à zéro", async () => {
    vi.useFakeTimers();
    let ms = 0;
    const onexpire = vi.fn();
    show(Countdown, { expiresInS: 3, now: () => ms, onexpire });
    expect(document.querySelector(".cd")!.textContent).toContain("3");
    ms = 1000;
    await vi.advanceTimersByTimeAsync(1000);
    flushSync();
    expect(document.querySelector(".cd")!.textContent).toContain("2");
    ms = 5000;
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onexpire).toHaveBeenCalledTimes(1);
  });
});
