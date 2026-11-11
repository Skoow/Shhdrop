// Worker d'Argon2id (64 Mio) : instancie le moteur à partir du module compilé que lui donne la
// page (déjà vérifié par son empreinte, Task 10), calcule K_mdp, répond { k } ou { error }, puis
// est arrêté par la page (argon2.ts) : sa mémoire est rendue, la clé n'y reste pas. Ne reçoit que
// le mot de passe et le sel ; ne fait aucune requête.
import { initSync, passwordKey, passwordKeyForCreate } from "./pkg/shhdrop_wasm.js";

export type KdfJob = { module: WebAssembly.Module; pw: Uint8Array; salt: Uint8Array; ops: number; mem: number; create: boolean };
export type KdfReply = { k: Uint8Array } | { error: string };

/** Calcule K_mdp ; le mot de passe reçu (copie du Worker) est effacé dans tous les cas. */
export function handle(job: KdfJob): KdfReply {
  try {
    initSync({ module: job.module });
    const k = job.create ? passwordKeyForCreate(job.pw, job.salt) : passwordKey(job.pw, job.salt, job.ops, job.mem);
    return { k };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "argon2_echec" };
  } finally {
    job.pw.fill(0);
  }
}

type Scope = { onmessage: ((e: MessageEvent<KdfJob>) => void) | null; postMessage(m: KdfReply, t?: Transferable[]): void };
const g = globalThis as unknown as Partial<Scope> & { WorkerGlobalScope?: unknown };
if (g.WorkerGlobalScope !== undefined) {
  g.onmessage = (e) => {
    const r = handle(e.data);
    g.postMessage!(r, "k" in r ? [r.k.buffer as ArrayBuffer] : []);
  };
}
