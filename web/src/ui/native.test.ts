import { describe, expect, it, vi } from "vitest";
import { canShareLink, haptic, shareText } from "./native";

describe("gestes natifs avec repli", () => {
  it("haptic : 10 ms si vibrate existe ; rien sans ; jamais d'erreur", () => {
    const vibrate = vi.fn(() => true);
    haptic({ vibrate });
    expect(vibrate).toHaveBeenCalledWith(10);
    expect(() => haptic({})).not.toThrow();
    expect(() => haptic(undefined)).not.toThrow();
    expect(() => haptic({ vibrate: () => { throw new Error("x"); } })).not.toThrow();
  });
  it("shareText : un texte seul ({ text }) ; repli « unavailable » ; annulation tolérée", async () => {
    const share = vi.fn(async () => undefined);
    expect(canShareLink({ share })).toBe(true);
    expect(await shareText("Lien : https://x.test/#k\nMot de passe : aC3!cD5?#Fg", { share })).toBe("shared");
    expect(share).toHaveBeenCalledWith({ text: "Lien : https://x.test/#k\nMot de passe : aC3!cD5?#Fg" });
    expect(Object.keys((share.mock.calls[0] as unknown as [object])[0])).toEqual(["text"]);
    expect(canShareLink({})).toBe(false);
    expect(await shareText("u", {})).toBe("unavailable");
    expect(await shareText("u", undefined)).toBe("unavailable");
    expect(await shareText("u", { share: async () => { throw new DOMException("AbortError"); } })).toBe("cancelled");
  });
});
