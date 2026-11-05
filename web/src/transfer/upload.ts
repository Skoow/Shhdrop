// Transport des PUT de segment (envoi). XMLHttpRequest dans le navigateur, pour suivre les
// octets envoyés (upload.onprogress, que fetch ne donne pas) ; fetch en Node et dans les tests.
// Le corps est un segment chiffré ; le jeton d'envoi passe en en-tête, jamais dans l'URL.
// Aucun nouvel essai ici : c'est le budget de coupure de createShare qui réessaie.
// Module interne : l'interface publique est src/index.ts.

/**
 * Échéance unique de la pause et de la coupure : 13 min après le dernier segment acquitté,
 * puis Error("reseau"). Le serveur efface un envoi sans segment depuis 15 min (spec §7.4,
 * §24) : marge de 2 min.
 */
export const SERVER_STALL_MS = 780_000;

/** Envoie `body` en PUT ; `onBytes(n)` : octets du corps envoyés par cet essai. */
export type Uploader = (
  url: string,
  headers: Record<string, string>,
  body: Uint8Array<ArrayBuffer>,
  onBytes: (n: number) => void,
  signal?: AbortSignal,
) => Promise<{ status: number; json: unknown }>;

export const abortError = () => new DOMException("Aborted", "AbortError");

function parse(text: string): unknown {
  if (text === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null; // corps illisible : le statut seul fait foi
  }
}

/** Navigateur. Une redirection (que XMLHttpRequest suivrait en silence) est traitée comme une coupure. */
export const xhrUploader: Uploader = (url, headers, body, onBytes, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const x = new XMLHttpRequest();
    const onAbort = () => x.abort();
    const end = () => signal?.removeEventListener("abort", onAbort);
    x.open("PUT", url);
    x.withCredentials = false;
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => onBytes(e.loaded);
    x.onload = () => {
      end();
      if (new URL(x.responseURL || url).href !== new URL(url).href) return reject(new TypeError("redirection"));
      resolve({ status: x.status, json: parse(x.responseText) });
    };
    x.onerror = x.ontimeout = () => {
      end();
      reject(new TypeError("reseau"));
    };
    x.onabort = () => {
      end();
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    x.send(body);
  });

/** Node, tests, ou `fetch` fourni par l'appelant : les octets ne sont annoncés qu'à l'acquittement. */
export function fetchUploader(f: typeof fetch): Uploader {
  return async (url, headers, body, onBytes, signal) => {
    const r = await f(url, { method: "PUT", headers, body, credentials: "omit", redirect: "error", signal });
    let text: string;
    try {
      text = await r.text();
    } catch (e) {
      if (signal?.aborted) throw abortError();
      throw new TypeError("reseau", { cause: e }); // corps interrompu
    }
    if (r.ok) onBytes(body.length);
    return { status: r.status, json: parse(text) };
  };
}
