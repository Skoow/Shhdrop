// L'interface publique n'expose ni la couche HTTP ni les dérivations de clés (audit M1).
import { describe, expect, it } from "vitest";
import * as pub from "./index";

describe("interface publique", () => {
  it("exactement les fonctions sûres", () => {
    expect(Object.keys(pub).sort()).toEqual(
      [
        "BadPasswordError",
        "CAPTCHA_MIN_MS",
        "GrantInvalidError",
        "ReopenLimitError",
        "grantTag",
        "CHUNK",
        "SEG_CHUNKS",
        "bucketFor",
        "segmentCount",
        "segmentSize",
        "DATA_SEGMENTS",
        "segmentsFor",
        "createDraft",
        "CONTENT_MAX",
        "MAX_ITEMS",
        "MANIFEST_MAX",
        "MAX_OPENS",
        "NAME_MAX",
        "OPENS_DEFAULT",
        "STRIP_MAX",
        "TEXT_MAX",
        "TTL_DEFAULT",
        "PASSWORD_ALPHABET",
        "PASSWORD_LEN",
        "PW_TRIES",
        "ReadBudgetError",
        "ServerError",
        "TTL_HOURS",
        "TTL_MAX_HOURS",
        "generatePassword",
        "LimitError",
        "NotFoundError",
        "PREVIEW_MAX",
        "SERVER_STALL_MS",
        "cleanName",
        "isRiskyName",
        "collectToBlob",
        "createShare",
        "destroyShare",
        "fetchMeta",
        "MANAGE_FRAGMENT",
        "SHARE_FRAGMENT",
        "SHARE_LINK_SHAPE",
        "manageLink",
        "openShare",
        "parseLink",
        "prepareCaptcha",
        "shareLink",
        "shareStatus",
      ].sort(),
    );
  });
  it("constantes et nettoyage des noms", () => {
    expect(pub.SERVER_STALL_MS).toBe(780_000);
    expect(pub.PREVIEW_MAX).toBe(200 * 1048576);
    expect(pub.cleanName("../a\u202E.txt")).toBe("a.txt");
  });
});

// Types exportés (contrôle à la compilation par tsc).
export type _Types = [pub.CaptchaProof, pub.CaptchaCtx, pub.PreparedCaptcha, pub.GeneratedPassword, pub.Rights, pub.KeepTtl, pub.ManifestV2, pub.TtlHours];
