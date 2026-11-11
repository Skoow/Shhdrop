// Balises de la démo GitHub Pages (UI §14.3), injectées en tête de <head> par le greffon
// demoMeta de vite.config.ts et vérifiées par check-dist.mjs. Pages n'envoie pas nos en-têtes :
// la CSP passe par une balise meta (écarts avec la production : UI §14.3).
// connect-src 'none' (production : 'self') : le faux serveur répond dans la page, sans réseau ;
// si un envoi contournait un jour le détournement, le navigateur le refuserait au lieu de le
// transmettre à skoow.github.io (défaut fermé).
// Trusted Types et worker-src : comme la production (test d'intrusion du 11 novembre ;
// demo-meta.test.ts compare les deux CSP directive par directive).
// frame-ancestors : sans effet dans une balise meta, et Pages ne pose aucun en-tête : la démo
// reste cadrable par un autre site (détournement de clic). Risque accepté : la démo ne détient
// aucun secret réel (UI §14.3, A43).
export const DEMO_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'none'; worker-src 'self' blob:; frame-src 'self'; " +
  "object-src 'none'; base-uri 'none'; form-action 'self'; require-trusted-types-for 'script'; trusted-types svelte-trusted-html shhdrop";

/** Dans l'ordre : la CSP d'abord. */
export const DEMO_META = [
  { "http-equiv": "Content-Security-Policy", content: DEMO_CSP },
  { name: "referrer", content: "no-referrer" },
  { name: "robots", content: "noindex" },
];

/** Base de la démo (dépôt Shhdrop sur skoow.github.io). */
export const DEMO_BASE = "/shhdrop/";
