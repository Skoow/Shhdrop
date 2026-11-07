/// <reference lib="webworker" />
// Worker de la preuve de travail (UI §9.4.2) : ne calcule que des SHA-256 sur le défi public.
// Message reçu : le défi ; messages rendus : { tried } toutes les 250 ms, puis { number, took }
// ou { number: null }.
import { parseChallenge, search } from "./search";

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (e: MessageEvent<unknown>) => {
  const t0 = performance.now();
  let last = 0;
  try {
    const c = parseChallenge(e.data);
    const number = await search(c, crypto.subtle, (tried) => {
      const t = performance.now();
      if (t - last >= 250) {
        last = t;
        scope.postMessage({ tried });
      }
    });
    scope.postMessage({ number, took: Math.round(performance.now() - t0) });
  } catch {
    scope.postMessage({ number: null, took: 0 });
  }
};
