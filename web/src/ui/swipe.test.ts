// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { swipeAxis, swipeEnd, swipeToRemove } from "./swipe";

describe("glisser vers la gauche pour retirer (composeur, téléphone)", () => {
  it("axe : rien sous 10 px ; horizontal seulement s'il domine nettement le vertical (le défilement gagne)", () => {
    expect(swipeAxis(6, 2)).toBe(null);
    expect(swipeAxis(-30, 5)).toBe("x");
    expect(swipeAxis(-20, 18)).toBe("y");
    expect(swipeAxis(4, 40)).toBe("y");
  });
  it("fin : au-delà de 35 % de la largeur vers la gauche → retirer ; sinon retour ; vers la droite jamais", () => {
    expect(swipeEnd(-140, 390)).toBe("remove");
    expect(swipeEnd(-100, 390)).toBe("back");
    expect(swipeEnd(200, 390)).toBe("back");
  });
  it("attache : toucher seulement (pas la souris, qui sert au glisser-déposer) ; retire après un geste franc", () => {
    const node = document.createElement("div");
    Object.defineProperty(node, "offsetWidth", { value: 390 });
    node.setPointerCapture = vi.fn();
    const onremove = vi.fn();
    const off = swipeToRemove(onremove, { reduced: true })(node);
    const ev = (type: string, x: number, y = 0, pointerType = "touch") => {
      const e = new Event(type, { bubbles: true }) as Event & Record<string, unknown>;
      Object.assign(e, { clientX: x, clientY: y, pointerType, pointerId: 1, isPrimary: true });
      node.dispatchEvent(e);
    };
    ev("pointerdown", 300, 0, "mouse");
    ev("pointermove", 100);
    ev("pointerup", 100);
    expect(onremove).not.toHaveBeenCalled();
    ev("pointerdown", 300);
    ev("pointermove", 280);
    ev("pointermove", 120);
    ev("pointerup", 120);
    expect(onremove).toHaveBeenCalledOnce();
    off?.();
  });
});
