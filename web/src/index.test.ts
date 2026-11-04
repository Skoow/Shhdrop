// L'interface publique n'expose ni la couche HTTP ni les dérivations de clés (audit M1).
import { describe, expect, it } from "vitest";
import * as pub from "./index";

describe("interface publique", () => {
  it("exactement les fonctions sûres", () => {
    expect(Object.keys(pub).sort()).toEqual(
      [
        "BadPasswordError",
        "CAPTCHA_MIN_MS",
        "LimitError",
        "NotFoundError",
        "PASSPHRASE_MIN_WORDS",
        "PW_MIN_CHARS",
        "checkPassword",
        "collectToBlob",
        "createShare",
        "destroyShare",
        "fetchMeta",
        "generatePassphrase",
        "manageLink",
        "openShare",
        "parseLink",
        "shareLink",
        "shareStatus",
      ].sort(),
    );
  });
});
