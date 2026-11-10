// Vecteurs de test communs (spec du moteur Rust §9) : engine/vectors/v2.json est la référence
// octet pour octet du moteur Rust, de son build WebAssembly et des futures apps. Ce test refait
// chaque vecteur avec l'ancien moteur TypeScript et exige le même fichier, au caractère près :
// il échoue si le fichier manque ou n'est plus à jour.
// Régénérer (après un changement voulu du format) : GEN_VECTORS=1 npx vitest run src/engine/vectors.test.ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { VECTORS_URL, buildVectors, serialize, tokenShapes, writeVectors } from "../../scripts/gen-vectors";

// Argon2id à 64 Mio (quatre calculs) et un fichier de 9 Mio chiffré puis rouvert.
const TIMEOUT = 300_000;

if (process.env.GEN_VECTORS === "1") {
  it("écrit engine/vectors/v2.json", async () => {
    await writeVectors();
  }, TIMEOUT);
} else {
  it("l'ancien moteur redonne chaque vecteur de engine/vectors/v2.json", async () => {
    const text = readFileSync(VECTORS_URL, "utf8");
    const want = JSON.parse(text) as Record<string, unknown>;
    const got = JSON.parse(serialize(await buildVectors())) as Record<string, unknown>;
    expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
    // Section par section : un écart est localisé sans afficher tout le fichier.
    for (const k of Object.keys(want)) expect(got[k], k).toEqual(want[k]);
    // Forme exacte aussi (clés triées, indentation, LF final) : relancer le générateur ne change rien.
    expect(serialize(got) === text, "v2.json n'est pas la sortie exacte du générateur").toBe(true);
    // Aucune chaîne que les détecteurs de secrets prendraient pour un jeton (push refusé).
    expect(tokenShapes(text)).toEqual([]);
  }, TIMEOUT);
}
