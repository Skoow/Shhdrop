// Preuve de travail anti-robot (UI §9.4.2), version minimale : un Worker dédié (fichier de
// notre origine, permis par script-src 'self') cherche la solution ; arrêt par `signal`.
// Pas encore de pré-calcul ni de borne vraie avec repli (Task 14) : sans repli, le calcul va
// jusqu'au bout, comme le prévoit la spécification.
import type { CaptchaCtx, CaptchaProof } from "../index";
import { parseChallenge, payload } from "./search";

export function solvePow(challenge: unknown, ctx: CaptchaCtx, signal?: AbortSignal, onTried?: (tried: number) => void): Promise<CaptchaProof> {
  return new Promise((resolve, reject) => {
    if (ctx.mode !== "pow") return reject(new Error("repli_indisponible")); // Tasks 15–16
    let c: ReturnType<typeof parseChallenge>;
    let w: Worker;
    try {
      c = parseChallenge(challenge);
      w = new Worker(new URL("./pow.worker.ts", import.meta.url), { type: "module" });
    } catch {
      return reject(new Error("pow_indisponible"));
    }
    const stop = () => {
      w.terminate();
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) return stop();
    signal?.addEventListener("abort", stop, { once: true });
    const done = () => {
      signal?.removeEventListener("abort", stop);
      w.terminate();
    };
    w.onmessage = (e: MessageEvent<{ tried?: number; number?: number | null; took?: number }>) => {
      const d = e.data;
      if (typeof d.tried === "number") return onTried?.(d.tried);
      done();
      if (typeof d.number === "number") resolve({ kind: "pow", payload: payload(c, d.number, d.took ?? 0) });
      else reject(new Error("pow_echec"));
    };
    w.onerror = () => {
      done();
      reject(new Error("pow_indisponible"));
    };
    w.postMessage(c);
  });
}
