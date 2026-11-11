// K_mdp = Argon2id(mot de passe NFC, sel) par le moteur (décision du contrôleur, Task 4 : Rust
// plus rapide que libsodium dans ce mode). Production : un Worker NEUF par calcul (argon2.worker.ts),
// arrêté après, comme aujourd'hui (crypto/argon2-run.worker.ts) : les 64 Mio ne restent pas dans
// la mémoire du moteur de la page, qui ne rétrécit jamais. `start` crée ce Worker ; il sera fourni
// par le chargement vérifié (Task 10 : script lu avec son empreinte, Trusted Types par
// app/trusted.ts). Sans `start` (tests, développement), le calcul a lieu dans la page.
//
// Les paramètres lus sur le serveur sont refusés ici s'ils ne sont pas des entiers sûrs, avant le
// moteur, avec les messages et l'ordre de l'ancien moteur (le moteur les refuse aussi).
import type { Engine } from "./load";
import type { KdfJob, KdfReply } from "./argon2.worker";

export type KdfParams = { ops: number; mem: number };
export type StartWorker = () => Promise<Worker>;

async function inWorker(start: StartWorker, job: KdfJob): Promise<Uint8Array<ArrayBuffer>> {
  const w = await start();
  try {
    return await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<KdfReply>) => {
        const r = e.data;
        if ("k" in r && r.k instanceof Uint8Array && r.k.length === 32) resolve(r.k as Uint8Array<ArrayBuffer>);
        else reject(new Error("error" in r && typeof r.error === "string" ? r.error : "argon2_echec"));
      };
      w.onerror = (e) => {
        e.preventDefault();
        reject(new Error("argon2_worker"));
      };
      w.onmessageerror = () => reject(new Error("argon2_worker"));
      // Copie pour le Worker (clonage) : l'appelant garde et efface la sienne.
      w.postMessage(job);
    });
  } finally {
    w.terminate();
  }
}

async function run(engine: Engine, password: string, salt: Uint8Array, params: KdfParams, create: boolean, start?: StartWorker): Promise<Uint8Array<ArrayBuffer>> {
  const pw = new TextEncoder().encode(password);
  try {
    const job: KdfJob = { module: engine.module, pw, salt, ops: params.ops, mem: params.mem, create };
    if (start) return await inWorker(start, job);
    const w = engine.wasm;
    return (create ? w.passwordKeyForCreate(pw, salt) : w.passwordKey(pw, salt, params.ops, params.mem)) as Uint8Array<ArrayBuffer>;
  } finally {
    pw.fill(0);
  }
}

/** K_mdp pour OUVRIR (paramètres lus sur le serveur) ; l'appelant efface la clé après usage. */
export function passwordKey(engine: Engine, password: string, salt: Uint8Array, params: KdfParams, start?: StartWorker): Promise<Uint8Array<ArrayBuffer>> {
  if (password.length === 0) return Promise.reject(new Error("mot_de_passe_vide"));
  if (salt.length !== 16) return Promise.reject(new Error("clé ou sel de taille invalide"));
  if (!Number.isSafeInteger(params.ops) || !Number.isSafeInteger(params.mem)) return Promise.reject(new Error("paramètres KDF invalides"));
  return run(engine, password, salt, params, false, start);
}

/** K_mdp pour CRÉER : mot de passe de la forme de generatePassword, KDF_CREATE (vérifiés par le moteur). */
export function passwordKeyForCreate(engine: Engine, password: string, salt: Uint8Array, start?: StartWorker): Promise<Uint8Array<ArrayBuffer>> {
  return run(engine, password, salt, { ops: 0, mem: 0 }, true, start);
}
