// Fichier autonome assets/argon2-EMPREINTE.js (script classique). Dans un Worker : répond à un
// message { pw, salt, ops, mem } par { k } (ou { error: true }) ; dans la page (repli) : expose
// la fonction. Ne reçoit que le mot de passe et le sel ; ne fait aucune requête.
import { argon2id } from "./argon2";

type Job = { pw: Uint8Array; salt: Uint8Array; ops: number; mem: number };
const g = globalThis as unknown as { __shhArgon2id?: typeof argon2id; document?: unknown; onmessage: ((e: MessageEvent<Job>) => void) | null; postMessage(m: unknown, t?: Transferable[]): void };

if (g.document !== undefined) g.__shhArgon2id = argon2id;
else
  g.onmessage = (e) => {
    const { pw, salt, ops, mem } = e.data;
    argon2id(pw, salt, ops, mem).then(
      (k) => {
        pw.fill(0);
        g.postMessage({ k }, [k.buffer]);
      },
      () => {
        pw.fill(0);
        g.postMessage({ error: true });
      },
    );
  };
