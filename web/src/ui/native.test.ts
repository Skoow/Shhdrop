import { describe, expect, it, vi } from "vitest";
import { canShareLink, haptic, shareLink, sharePassword } from "./native";

describe("gestes natifs avec repli", () => {
  it("haptic : 10 ms si vibrate existe ; rien sans ; jamais d'erreur", () => {
    const vibrate = vi.fn(() => true);
    haptic({ vibrate });
    expect(vibrate).toHaveBeenCalledWith(10);
    expect(() => haptic({})).not.toThrow();
    expect(() => haptic(undefined)).not.toThrow();
    expect(() => haptic({ vibrate: () => { throw new Error("x"); } })).not.toThrow();
  });
  it("shareLink : le lien seul ; repli « unavailable » ; annulation tolérée", async () => {
    const share = vi.fn(async () => undefined);
    expect(canShareLink({ share })).toBe(true);
    expect(await shareLink("https://x.test/#k", { share })).toBe("shared");
    expect(share).toHaveBeenCalledWith({ url: "https://x.test/#k" });
    expect(Object.keys((share.mock.calls[0] as unknown as [object])[0])).toEqual(["url"]);
    expect(canShareLink({})).toBe(false);
    expect(await shareLink("u", {})).toBe("unavailable");
    expect(await shareLink("u", undefined)).toBe("unavailable");
    expect(await shareLink("u", { share: async () => { throw new DOMException("AbortError"); } })).toBe("cancelled");
  });
  it("sharePassword : le mot de passe seul (texte), jamais avec le lien ; deux partages distincts", async () => {
    const share = vi.fn(async () => undefined);
    expect(await sharePassword("K7m4Xq2p9r", { share })).toBe("shared");
    expect(share).toHaveBeenCalledWith({ text: "K7m4Xq2p9r" });
    expect(Object.keys((share.mock.calls[0] as unknown as [object])[0])).toEqual(["text"]);
    expect(await sharePassword("x", {})).toBe("unavailable");
  });
});
