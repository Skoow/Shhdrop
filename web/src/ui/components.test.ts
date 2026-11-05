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
import TextArea from "./TextArea.svelte";
import { onAnnounce } from "./announce";

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
    expect(document.getElementById(ids[1]!)!.getAttribute("role")).toBe("alert");
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
    // Troncature par CSS seulement : le texte visible est la valeur entière en deux morceaux
    // (tête qui s'ellipse, queue fixe de 8 caractères), non sélectionnable.
    expect(document.querySelector(".head")!.textContent! + document.querySelector(".tail")!.textContent!).toBe(value);
    expect(document.querySelector(".tail")!.textContent).toBe("k".repeat(8));
    expect(document.querySelector(".val")!.textContent).not.toContain("…");
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
    expect(document.querySelector(".toast")!.textContent).toContain("a.txt retiré");
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
  it("pause du minuteur au survol et au focus, reprise avec le temps restant", async () => {
    vi.useFakeTimers();
    const ondismiss = vi.fn();
    show(UndoToast, { message: "x", onundo() {}, ondismiss });
    const toast = document.querySelector(".toast")!;
    await vi.advanceTimersByTimeAsync(4000);
    toast.dispatchEvent(new Event("pointerenter"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ondismiss).not.toHaveBeenCalled();
    toast.dispatchEvent(new Event("pointerleave"));
    await vi.advanceTimersByTimeAsync(1900);
    expect(ondismiss).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(ondismiss).toHaveBeenCalledTimes(1);
  });
  it("focus : même pause", async () => {
    vi.useFakeTimers();
    const ondismiss = vi.fn();
    show(UndoToast, { message: "x", onundo() {}, ondismiss });
    const btn = document.querySelector("button")!;
    btn.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ondismiss).not.toHaveBeenCalled();
    btn.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(6100);
    expect(ondismiss).toHaveBeenCalledTimes(1);
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

describe("langue : aucun libellé visible hors de t()", () => {
  it("FR : CopyField, UndoToast, Countdown", () => {
    setLang("fr");
    show(CopyField, { label: "Lien", value: "abc" });
    show(UndoToast, { message: "x", onundo() {}, ondismiss() {} });
    show(Countdown, { expiresInS: 15300 });
    const btns = [...document.querySelectorAll("button")].map((b) => b.textContent!.trim());
    expect(btns).toEqual(["Copier", "Annuler"]);
    expect(document.querySelector(".cd")!.textContent).toBe("4\u202fh\u202f15");
  });
  it("EN : mêmes composants", () => {
    setLang("en");
    show(CopyField, { label: "Link", value: "abc" });
    show(UndoToast, { message: "x", onundo() {}, ondismiss() {} });
    show(Countdown, { expiresInS: 15300 });
    const btns = [...document.querySelectorAll("button")].map((b) => b.textContent!.trim());
    expect(btns).toEqual(["Copy", "Undo"]);
    expect(document.querySelector(".cd")!.textContent).toBe("4h\u00a015m");
  });
  it("le Countdown suit un changement de langue", () => {
    setLang("fr");
    show(Countdown, { expiresInS: 15300 });
    expect(document.querySelector(".cd")!.textContent).toBe("4\u202fh\u202f15");
    setLang("en");
    flushSync();
    expect(document.querySelector(".cd")!.textContent).toBe("4h\u00a015m");
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


function announcements() {
  const got: string[] = [];
  const off = onAnnounce((x) => got.push(x));
  return { got, off };
}

describe("Countdown : délai déjà nul (I1)", () => {
  it("onexpire une seule fois, une seule annonce, aucune erreur d'effet", async () => {
    vi.useFakeTimers();
    const { got, off } = announcements();
    const onexpire = vi.fn();
    expect(() => show(Countdown, { expiresInS: 0, onexpire })).not.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
    expect(onexpire).toHaveBeenCalledTimes(1);
    expect(got).toEqual(["Le partage a expiré"]);
    expect(document.querySelector(".cd")!.textContent).toBe("moins d'une minute");
    off();
  });
  it("recalcule dès le retour de l'onglet (visibilitychange)", () => {
    vi.useFakeTimers();
    let ms = 0;
    show(Countdown, { expiresInS: 600, now: () => ms });
    expect(document.querySelector(".cd")!.textContent).toContain("10");
    ms = 400_000; // onglet endormi : aucun minuteur n'a tourné
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    flushSync();
    expect(document.querySelector(".cd")!.textContent).toBe("3\u202fmin\u202f20\u202fs");
  });
});

describe("UndoToast : accessibilité (I3)", () => {
  it("annonce par announce() (LiveRegion partagée), sans role=status pré-rempli", async () => {
    vi.useFakeTimers();
    const { got, off } = announcements();
    show(UndoToast, { message: "a.txt retiré", onundo() {}, ondismiss() {} });
    expect(document.querySelector(".toast")!.getAttribute("role")).not.toBe("status");
    expect(document.querySelector(".toast [aria-live]")).toBeNull();
    await vi.advanceTimersByTimeAsync(10);
    expect(got.length).toBe(1);
    expect(got[0]).toContain("a.txt retiré");
    expect(got[0]).toMatch(/Ctrl ou Cmd/);
    off();
  });
  it("Ctrl+Z et Cmd+Z annulent ; ni Maj, ni dans un champ de texte", () => {
    const onundo = vi.fn();
    show(UndoToast, { message: "x", onundo, ondismiss() {} });
    const key = (init: KeyboardEventInit, target: EventTarget = window) => {
      const e = new KeyboardEvent("keydown", { key: "z", bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(e);
      return e;
    };
    const input = document.createElement("input");
    input.type = "text";
    document.body.append(input);
    key({ ctrlKey: true }, input);
    expect(onundo).not.toHaveBeenCalled(); // l'annulation de saisie appartient au champ
    key({ ctrlKey: true, shiftKey: true });
    key({});
    expect(onundo).not.toHaveBeenCalled();
    const e = key({ metaKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(onundo).toHaveBeenCalledTimes(1);
  });
  it("fermeture avec le focus dedans : focus vers la cible d'onclose", async () => {
    const target = document.createElement("button");
    document.body.append(target);
    const onclose = vi.fn(() => target);
    show(UndoToast, { message: "x", onundo() {}, ondismiss() {}, onclose });
    const btn = document.querySelector<HTMLButtonElement>(".toast button")!;
    btn.focus();
    btn.click();
    await settle();
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(target);
  });
  it("sans cible : focus sur <main>, jamais body", async () => {
    const main = document.createElement("main");
    main.tabIndex = -1;
    document.body.append(main);
    show(UndoToast, { message: "x", onundo() {}, ondismiss() {} });
    const btn = document.querySelector<HTMLButtonElement>(".toast button")!;
    btn.focus();
    btn.click();
    await settle();
    expect(document.activeElement).toBe(main);
  });
  it("focus ailleurs : le focus n'est pas déplacé", async () => {
    const other = document.createElement("button");
    document.body.append(other);
    const target = document.createElement("button");
    document.body.append(target);
    show(UndoToast, { message: "x", onundo() {}, ondismiss() {}, onclose: () => target });
    other.focus();
    document.querySelector<HTMLButtonElement>(".toast button")!.click();
    await settle();
    expect(document.activeElement).toBe(other);
  });
});

describe("InlineConfirm : Annuler inactif pendant l'action (mineur 5)", () => {
  it("Annuler désactivé tant que onconfirm s'exécute", async () => {
    let release!: () => void;
    const onconfirm = vi.fn(() => new Promise<void>((r) => (release = r)));
    show(InlineConfirm, { label: "Go", message: "Sûr ?", confirmLabel: "Oui", onconfirm });
    document.querySelector("button")!.click();
    await settle();
    const [cancel, yes] = [...document.querySelectorAll<HTMLButtonElement>('[role="group"] button')];
    yes!.click();
    flushSync();
    expect(cancel!.disabled).toBe(true);
    cancel!.click();
    expect(document.querySelector('[role="group"]')).not.toBeNull(); // pas de retour au bouton d'origine
    release();
    await settle();
    expect(document.querySelector('[role="group"]')).toBeNull();
  });
});

describe("TextArea : erreur annoncée (mineur 6)", () => {
  it("role=alert relié par aria-describedby", () => {
    show(TextArea, { label: "Texte", error: "Vide" });
    const ta = document.querySelector("textarea")!;
    const err = document.getElementById(ta.getAttribute("aria-describedby")!)!;
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent).toBe("Vide");
  });
});
