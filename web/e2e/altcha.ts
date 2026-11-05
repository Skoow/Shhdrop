// Résolution d'un défi ALTCHA pour les tests (le widget du navigateur le fera au Plan 2) :
// force brute de SHA-256(sel ‖ nombre) jusqu'à maxNumber.
import { createHash } from "node:crypto";
import type { CaptchaProof } from "../src/transfer/client";

type Challenge = { algorithm: string; challenge: string; maxNumber: number; salt: string; signature: string };

export async function solveAltcha(c: unknown): Promise<CaptchaProof> {
  const { algorithm, challenge, maxNumber, salt, signature } = c as Challenge;
  if (algorithm !== "SHA-256") throw new Error(`algorithme inattendu : ${algorithm}`);
  for (let number = 0; number <= maxNumber; number++) {
    if (createHash("sha256").update(salt + number).digest("hex") === challenge) {
      return { kind: "pow", payload: Buffer.from(JSON.stringify({ algorithm, challenge, number, salt, signature })).toString("base64") };
    }
  }
  throw new Error("défi ALTCHA sans solution");
}
