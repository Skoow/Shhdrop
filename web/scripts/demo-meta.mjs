// Balises de la démo GitHub Pages (UI §14.3), injectées en tête de <head> par le greffon
// demoMeta de vite.config.ts et vérifiées par check-dist.mjs. Pages n'envoie pas nos en-têtes :
// la CSP passe par une balise meta (écarts avec la production : UI §14.3).
// connect-src 'none' (production : 'self') : le faux serveur répond dans la page, sans réseau ;
// si un envoi contournait un jour le détournement, le navigateur le refuserait au lieu de le
// transmettre à skoow.github.io (défaut fermé).
export const DEMO_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'none'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'";

/** Dans l'ordre : la CSP d'abord. */
export const DEMO_META = [
  { "http-equiv": "Content-Security-Policy", content: DEMO_CSP },
  { name: "referrer", content: "no-referrer" },
  { name: "robots", content: "noindex" },
];

/** Base de la démo (dépôt Shhdrop sur skoow.github.io). */
export const DEMO_BASE = "/Shhdrop/";
