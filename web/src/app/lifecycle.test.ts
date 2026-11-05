// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardFileDrop, guardUnload, onPageHide, reloadIfRestored } from "./lifecycle";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function dragEvent(type: "dragover" | "drop"): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", { value: { dropEffect: "copy", types: ["Files"] } });
  return e;
}

describe("guardFileDrop", () => {
  it("allow() faux : preventDefault sur dragover et drop, effet « none », où que tombe le fichier", () => {
    cleanups.push(guardFileDrop(window, () => false));
    const target = document.createElement("input");
    document.body.append(target);
    target.addEventListener("drop", (e) => e.stopPropagation()); // un enfant ne peut pas y échapper
    for (const type of ["dragover", "drop"] as const) {
      const e = dragEvent(type);
      target.dispatchEvent(e);
      expect(e.defaultPrevented, type).toBe(true);
      expect((e as DragEvent).dataTransfer!.dropEffect).toBe("none");
    }
    target.remove();
  });

  it("allow() vrai : laisse faire le composeur", () => {
    cleanups.push(guardFileDrop(window, () => true));
    for (const type of ["dragover", "drop"] as const) {
      const e = dragEvent(type);
      document.body.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false);
    }
  });

  it("allow() relu à chaque événement ; la fonction rendue retire la garde", () => {
    let ok = false;
    const off = guardFileDrop(window, () => ok);
    let e = dragEvent("drop");
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    ok = true;
    e = dragEvent("drop");
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    ok = false;
    off();
    e = dragEvent("drop");
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});

describe("guardUnload", () => {
  const fire = () => {
    const e = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(e);
    return e;
  };

  it("actif → la sortie demande confirmation ; inactif → rien", () => {
    let active = true;
    cleanups.push(guardUnload(() => active));
    expect(fire().defaultPrevented).toBe(true);
    active = false;
    expect(fire().defaultPrevented).toBe(false);
  });

  it("la fonction rendue retire l'écouteur", () => {
    const off = guardUnload(() => true);
    off();
    expect(fire().defaultPrevented).toBe(false);
  });
});

describe("onPageHide", () => {
  it("appelle le rappel à pagehide, sans argument, jusqu'au retrait", () => {
    const cb = vi.fn();
    const off = onPageHide(cb);
    window.dispatchEvent(new Event("pagehide"));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith();
    off();
    window.dispatchEvent(new Event("pagehide"));
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("reloadIfRestored", () => {
  function fakeWindow() {
    const t = new EventTarget();
    const reload = vi.fn();
    return { w: Object.assign(t, { location: { reload } }) as unknown as Window, t, reload };
  }
  const pageshow = (persisted: boolean) => Object.assign(new Event("pageshow"), { persisted });

  it("pageshow persisted (cache « page précédente ») → rechargement", () => {
    const { w, t, reload } = fakeWindow();
    reloadIfRestored(w);
    t.dispatchEvent(pageshow(false));
    expect(reload).not.toHaveBeenCalled();
    t.dispatchEvent(pageshow(true));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
