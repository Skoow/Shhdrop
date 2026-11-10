// Trusted Types (CSP : require-trusted-types-for 'script'; trusted-types svelte-trusted-html
// shhdrop). Avec cette règle, le navigateur refuse toute chaîne brute donnée à un point
// d'injection de script (innerHTML, script.src, new Worker(url)…). Notre code n'écrit aucun
// HTML ; Svelte a sa propre politique pour ses gabarits. Il reste les adresses de script que
// nous créons nous-mêmes : elles passent par la politique « shhdrop », qui ne laisse passer que
// nos fichiers de assets/ et les Blob de cette origine (décision du 10 novembre).

/** Vrai si `url` est un script de notre site (…/assets/….js) ou un Blob de notre origine. */
export function allowedScriptUrl(url: string, origin: string): boolean {
  if (url.startsWith("blob:")) return url.startsWith(`blob:${origin}/`);
  let u: URL;
  try {
    u = new URL(url, origin + "/");
  } catch {
    return false;
  }
  return u.origin === origin && /^\/(?:[A-Za-z0-9_-]+\/)?assets\/[A-Za-z0-9._-]+\.js$/.test(u.pathname);
}

type Policy = { createScriptURL(url: string): unknown };
type Factory = { createPolicy(name: string, rules: { createScriptURL(url: string): string }): Policy };
let policy: Policy | null | undefined;

/**
 * Adresse de script à donner à new Worker() ou à script.src. Navigateur sans Trusted Types :
 * la chaîne elle-même (après le même contrôle). Adresse non permise : Error("script_refuse").
 */
export function scriptUrl(url: string | URL): string {
  const s = String(url);
  if (!allowedScriptUrl(s, location.origin)) throw new Error("script_refuse");
  if (policy === undefined) {
    const tt = (globalThis as unknown as { trustedTypes?: Factory }).trustedTypes;
    policy = tt
      ? tt.createPolicy("shhdrop", {
          createScriptURL: (x) => {
            if (!allowedScriptUrl(x, location.origin)) throw new Error("script_refuse");
            return x;
          },
        })
      : null;
  }
  // Le type rendu est un TrustedScriptURL : accepté partout où une adresse de script est attendue.
  return policy ? (policy.createScriptURL(s) as string) : s;
}
