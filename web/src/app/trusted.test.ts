import { describe, expect, it } from "vitest";
import { allowedScriptUrl } from "./trusted";

describe("adresses de script permises (Trusted Types)", () => {
  const origin = "https://shhdrop.app";
  it("fichiers du site sous assets/ (base comprise) et Blob de cette origine", () => {
    expect(allowedScriptUrl("https://shhdrop.app/assets/argon2-6xTok3Cm.js", origin)).toBe(true);
    expect(allowedScriptUrl("/assets/pow.worker-CqXgVHIX.js", origin)).toBe(true);
    expect(allowedScriptUrl("https://shhdrop.app/shhdrop/assets/x-AbCd1234.js", origin)).toBe(true);
    expect(allowedScriptUrl("blob:https://shhdrop.app/0b6c2f3e-1d2a-4c5b-9e8f-112233445566", origin)).toBe(true);
  });
  it("tout le reste est refusé : autre origine, autre dossier, data:, javascript:, Blob d'ailleurs", () => {
    for (const u of [
      "https://evil.example/assets/a.js",
      "//evil.example/assets/a.js",
      "https://shhdrop.app/api/x.js",
      "https://shhdrop.app/assets/../api/x.js",
      "https://shhdrop.app/assets/a.txt",
      "data:text/javascript,alert(1)",
      "javascript:alert(1)",
      "blob:https://evil.example/0b6c2f3e-1d2a-4c5b-9e8f-112233445566",
      "",
    ])
      expect(allowedScriptUrl(u, origin), u).toBe(false);
  });
});
