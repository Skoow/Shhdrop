// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { arrive } from "./arrive";

afterEach(() => vi.restoreAllMocks());

describe("arrive (audit I4)", () => {
  it("remonte en haut de page puis met le focus sur le titre, sans défilement de plus", () => {
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const h = document.createElement("h2");
    h.tabIndex = -1;
    document.body.append(h);
    const focus = vi.spyOn(h, "focus");
    arrive(h);
    expect(scroll).toHaveBeenCalledWith(0, 0);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(h);
    h.remove();
  });
  it("sans titre : rien", () => {
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    arrive(undefined);
    expect(scroll).not.toHaveBeenCalled();
  });
});
