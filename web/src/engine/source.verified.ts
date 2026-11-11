// Production (spec moteur §7) : le moteur est le fichier assets/engine-EMPREINTE.wasm, lu par
// fetch avec `integrity` (empreinte SHA-384 inscrite dans ce script par le greffon shh-engine) :
// le navigateur refuse des octets différents, et tout échec devient Error("reseau"), comme une
// coupure (aucun moteur partiel : load.ts ne garde rien). Pas d'import() dynamique (spec §28.3).
//
// Argon2id : un Worker NEUF par calcul, arrêté après (argon2.ts). new Worker(url) n'a pas de
// contrôle d'intégrité : son script (assets/engine-kdf-EMPREINTE.js) est lu une fois par fetch avec
// son empreinte, puis lancé depuis un Blob de notre origine (CSP : worker-src 'self' blob:) par
// la politique Trusted Types « shhdrop » (app/trusted.ts). Le Worker reçoit le module compilé
// des octets vérifiés ci-dessus : il ne lit aucun fichier.
import { integrity, src, workerIntegrity, workerSrc } from "virtual:shh-engine";
import { scriptUrl } from "../app/trusted";
import type { StartWorker } from "./argon2";

async function verified(url: string, sri: string): Promise<ArrayBuffer> {
  try {
    const res = await fetch(url, { integrity: sri, credentials: "omit", redirect: "error" });
    if (!res.ok) throw new Error("reseau");
    return await res.arrayBuffer();
  } catch {
    throw new Error("reseau");
  }
}

export function wasmBytes(): Promise<ArrayBuffer> {
  return verified(src, integrity);
}

// Adresse blob: du script vérifié, gardée pour la page (script public, sans secret).
let script: Promise<string> | undefined;

export const startWorker: StartWorker = async () => {
  if (!script) {
    script = verified(workerSrc, workerIntegrity).then((b) => URL.createObjectURL(new Blob([b], { type: "text/javascript" })));
    script.catch(() => (script = undefined));
  }
  return new Worker(scriptUrl(await script));
};
