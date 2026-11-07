import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { encode } from "./vendor/uqr.mjs";
import { QUIET, qrPath } from "./qr";

describe("qrPath (UI §9.5)", () => {
  it("lien de 80 caractères : taille attendue, chemin M h v z, autant de modules sombres que la matrice uqr", () => {
    const link = "https://shhdrop.example/#" + "A".repeat(43) + "x".repeat(80 - 25 - 43);
    expect(link).toHaveLength(80);
    const m = encode(link, { ecc: "M", border: 0 }).data;
    const { size, d } = qrPath(link);
    expect(size).toBe(m.length + 2 * QUIET);
    expect(m.length).toBe(37); // version 5 en correction M pour 80 octets
    expect(d).toMatch(/^[Mhvz0-9 -]+$/);
    const dark = m.flat().filter(Boolean).length;
    expect((d.match(/M/g) ?? []).length).toBe(dark);
  });
});

describe("uqr recopié (audit F3)", () => {
  // Fichiers de uqr 0.1.3 recopiés tels quels depuis l'archive npm (intégrité sha512 du verrou :
  // 0rjE8iEJe4YmT9TOhwsZtqCMRLc5DXZUI2UEYUUg63ikBkqqE5EYWaI0etFe/5KUcmcYwLih2RND1kq+hrUJXA==).
  // Toute modification doit être relue puis changer ces empreintes.
  it.each([
    ["uqr.mjs", "7f0e61c2f13bb3724edee7bfb876e13c54ac9ee4fcfa283c9fa93cfb1241c325"],
    ["uqr.d.mts", "81f61380f15a2e782ae423f6df08796a3562da20354d735ae79c88117b83e65b"],
    ["LICENSE", "b39d50e24727f341a0ebdb2ab040c57efaf4076a8ad5b1d0c8c45beb975b4571"],
  ])("%s : empreinte SHA-256 épinglée", (name, sha) => {
    const buf = readFileSync(new URL(`./vendor/${name}`, import.meta.url));
    expect(createHash("sha256").update(buf).digest("hex")).toBe(sha);
  });
  it("plus de dépendance npm uqr", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies).not.toHaveProperty("uqr");
  });
});
