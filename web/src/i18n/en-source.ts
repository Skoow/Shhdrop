// Dictionnaire anglais : tests, `vite dev` et démo (sa CSP, connect-src 'none', interdit tout
// fetch) : intégré au script. En production, le greffon shh-lang (vite.config.ts) remplace ce
// module par en-source.verified.ts : fichier à part, lu seulement pour un visiteur anglophone.
import { en } from "./en";

/** Dictionnaire déjà là (sans requête), ou undefined s'il faut le lire. */
export const bundled: Record<string, string> | undefined = en;

export function fetchEn(): Promise<unknown> {
  return Promise.resolve(en);
}
