import { describe, expect, it, vi } from "vitest";
import { STAY_MARK, createLeaveGuard, type HistoryWindow } from "./leave-guard";

/** Historique factice : pile d'entrées (état, chemin) ; back() et go() rendent un popstate (asynchrone dans un vrai navigateur, ici à la demande). */
function fakeWindow(path = "/envoyer") {
  const stack: { state: unknown; path: string }[] = [{ state: null, path: "/" }, { state: null, path }];
  let at = 1;
  const pops: number[] = [];
  const w: HistoryWindow = {
    history: {
      get state() {
        return stack[at]!.state;
      },
      pushState(state: unknown, _t: string, url?: string | URL | null) {
        stack.splice(at + 1);
        stack.push({ state, path: String(url ?? stack[at]!.path) });
        at++;
      },
      back() {
        pops.push(-1);
      },
    },
    location: {
      get pathname() {
        return stack[at]!.path;
      },
      search: "",
    },
  };
  /** Le navigateur applique un retour de `n` entrées (bouton ou back()). */
  const travel = (n: number) => {
    at = Math.max(0, at - n);
  };
  return { w, stack, travel, pops, at: () => at };
}

describe("garde de sortie (audit I2)", () => {
  it("armée : une entrée de garde est ajoutée ; Retour → confirmation ; refus → on reste (entrée remise)", () => {
    const f = fakeWindow();
    const g = createLeaveGuard(f.w);
    const confirm = vi.fn(() => false);
    const onleave = vi.fn();
    g.arm({ confirm, onleave });
    expect(f.stack).toHaveLength(3);
    expect((f.w.history.state as Record<string, unknown>)[STAY_MARK]).toBe(true);
    f.travel(1); // bouton Retour
    expect(g.onPop()).toBe(true); // absorbé : la route ne change pas
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onleave).not.toHaveBeenCalled();
    expect(f.at()).toBe(2); // entrée de garde remise
    expect(f.w.location.pathname).toBe("/envoyer");
  });

  it("confirmation : onleave, puis le vrai retour (un back() de plus), qui passe ensuite normalement", () => {
    const f = fakeWindow();
    const g = createLeaveGuard(f.w);
    const onleave = vi.fn();
    g.arm({ confirm: () => true, onleave });
    f.travel(1);
    expect(g.onPop()).toBe(true);
    expect(onleave).toHaveBeenCalledTimes(1);
    expect(f.pops).toEqual([-1]);
    f.travel(1);
    expect(g.onPop()).toBe(false); // plus de garde : le routeur suit
  });

  it("saut de plusieurs entrées (autre route) : refus → l'adresse de l'envoi est remise ; accord → le routeur suit", () => {
    const f = fakeWindow();
    const g = createLeaveGuard(f.w);
    g.arm({ confirm: () => false, onleave: vi.fn() });
    f.travel(2); // « / »
    expect(g.onPop()).toBe(true);
    expect(f.w.location.pathname).toBe("/envoyer");
    const onleave = vi.fn();
    const f2 = fakeWindow();
    const g2 = createLeaveGuard(f2.w);
    g2.arm({ confirm: () => true, onleave });
    f2.travel(2);
    expect(g2.onPop()).toBe(false);
    expect(onleave).toHaveBeenCalledTimes(1);
    expect(f2.pops).toEqual([]);
  });

  it("désarmée (Terminé, annulation) : l'entrée de garde est retirée par un back() absorbé ; plus aucune confirmation", () => {
    const f = fakeWindow();
    const g = createLeaveGuard(f.w);
    const confirm = vi.fn(() => false);
    const off = g.arm({ confirm, onleave: vi.fn() });
    off();
    expect(f.pops).toEqual([-1]);
    f.travel(1);
    expect(g.onPop()).toBe(true); // retour de nettoyage : absorbé
    f.travel(1);
    expect(g.onPop()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("désarmée après une navigation (entrée de garde recouverte) : aucun back()", () => {
    const f = fakeWindow();
    const g = createLeaveGuard(f.w);
    const off = g.arm({ confirm: () => false, onleave: vi.fn() });
    f.w.history.pushState(null, "", "/securite");
    off();
    expect(f.pops).toEqual([]);
  });

  it("réarmée sur l'entrée de garde (envoi → « Lien prêt ») : pas de seconde entrée", () => {
    const f = fakeWindow();
    const g = createLeaveGuard(f.w);
    g.arm({ confirm: () => false, onleave: vi.fn() });
    g.arm({ confirm: () => false, onleave: vi.fn() });
    expect(f.stack).toHaveLength(3);
  });
});
