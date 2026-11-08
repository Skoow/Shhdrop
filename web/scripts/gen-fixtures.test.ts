// Les fichiers d'essai commités sont ceux que le script produit (relancé partout, mêmes octets).
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildFixtures } from "./gen-fixtures.mjs";

it("gen-fixtures.mjs redonne les fichiers commités", () => {
  for (const [name, bytes] of Object.entries(buildFixtures())) {
    expect(new Uint8Array(readFileSync(new URL(`../src/media/fixtures/${name}`, import.meta.url))), name).toEqual(bytes);
  }
});
