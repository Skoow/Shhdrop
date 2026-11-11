// buildId (vite.config.ts) : un build sans identifiant valide échoue (audit du 11 novembre, I6) ;
// « dev » reste possible pour vite dev et les tests.
import { afterEach, describe, expect, it } from "vitest";
import { buildId } from "../vite.config";

const saved = process.env.SHH_BUILD_ID;
afterEach(() => {
  if (saved === undefined) delete process.env.SHH_BUILD_ID;
  else process.env.SHH_BUILD_ID = saved;
});

describe("buildId", () => {
  it("prend SHH_BUILD_ID, ramené à 7 caractères (7 à 40 chiffres hexadécimaux)", () => {
    process.env.SHH_BUILD_ID = "abcdef0";
    expect(buildId("build")).toBe("abcdef0");
    process.env.SHH_BUILD_ID = "0123456789abcdef0123456789abcdef01234567";
    expect(buildId("build")).toBe("0123456");
  });

  it.each(["dev", "abc123", "ABCDEF0", "abcdef0 ", "0123456789abcdef0123456789abcdef012345678", "abcdefg"])(
    "build : SHH_BUILD_ID « %s » refusé, aucun repli « dev »",
    (id) => {
      process.env.SHH_BUILD_ID = id;
      expect(() => buildId("build")).toThrow(/identifiant de build/);
    },
  );

  it("vite dev et tests : « dev » si l'identifiant est invalide", () => {
    process.env.SHH_BUILD_ID = "pas-un-hash";
    expect(buildId("serve")).toBe("dev");
  });

  it("sans SHH_BUILD_ID, dans le dépôt : le commit courant (git)", () => {
    delete process.env.SHH_BUILD_ID;
    expect(buildId("build")).toMatch(/^[0-9a-f]{7}$/);
  });
});
