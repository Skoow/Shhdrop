// Exécution d'Argon2id en production : hors du fil principal, dans un Worker dont les octets
// sont vérifiés avant de s'exécuter. new Worker(url) n'a pas d'attribut integrity (spec §28.3) :
// le fichier est donc lu par fetch avec `integrity` (le navigateur refuse des octets différents),
// puis lancé depuis un Blob (CSP : worker-src 'self' blob:). Le Worker est arrêté après chaque
// calcul : ses 64 Mio de mémoire sont rendus, et la clé n'y reste pas.
// Repli (navigateur sans Worker depuis un Blob, CSP plus ancienne) : le même fichier chargé dans
// la page par <script integrity>, calcul sur le fil principal comme avant.
import { integrity, src } from "virtual:shh-argon2";

type Run = (pw: Uint8Array, salt: Uint8Array, ops: number, mem: number) => Promise<Uint8Array<ArrayBuffer>>;

async function inWorker(pw: Uint8Array, salt: Uint8Array, ops: number, mem: number): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(src, { integrity, credentials: "omit", redirect: "error" });
  if (!res.ok) throw new Error("argon2_indisponible");
  const url = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: "text/javascript" }));
  let w: Worker | undefined;
  try {
    w = new Worker(url);
    const worker = w;
    return await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ k?: Uint8Array<ArrayBuffer>; error?: boolean }>) => (e.data.k instanceof Uint8Array && e.data.k.length === 32 ? resolve(e.data.k) : reject(new Error("argon2_echec")));
      worker.onerror = (e) => {
        e.preventDefault();
        reject(new Error("argon2_worker"));
      };
      worker.onmessageerror = () => reject(new Error("argon2_worker"));
      // Copie pour le Worker (clonage) : l'appelant garde et efface la sienne.
      worker.postMessage({ pw, salt, ops, mem });
    });
  } finally {
    w?.terminate();
    URL.revokeObjectURL(url);
  }
}

let page: Promise<Run> | undefined;
function inPage(): Promise<Run> {
  page ??= new Promise<Run>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.integrity = integrity;
    s.onload = () => {
      const f = (globalThis as unknown as { __shhArgon2id?: Run }).__shhArgon2id;
      if (f) resolve(f);
      else reject(new Error("argon2_indisponible"));
    };
    s.onerror = () => reject(new Error("argon2_indisponible"));
    document.head.append(s);
  });
  page.catch(() => (page = undefined));
  return page;
}

export async function runArgon2id(pw: Uint8Array, salt: Uint8Array, ops: number, mem: number): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return await inWorker(pw, salt, ops, mem);
  } catch {
    return (await inPage())(pw, salt, ops, mem);
  }
}
