// Installation de la démo GitHub Pages (UI §14.3), appelée par main.ts en mode « demo »
// seulement, avant le montage de l'application. Remplace fetch et XMLHttpRequest pour les
// seules URL /api/* de l'origine (faux serveur en mémoire), préfixe le titre de l'onglet et
// remplit les crochets lus par les écrans (app/demo-hooks.ts). Aucun stockage navigateur.
import { setDemo } from "../app/demo-hooks";
import { getLang } from "../i18n/i18n.svelte";
import { SHARE_FRAGMENT, type CaptchaProof } from "../index";
import DemoBanner from "./DemoBanner.svelte";
import { createFakeServer } from "./fake-server";
import { fakeXHRClass } from "./fake-xhr";

export const MARK = "__SHH_DEMO__";

/** Débit simulé des segments : 20 Mo/s ; `?lent` : 1 Mo/s. */
const RATE = 20_000_000;
const SLOW_RATE = 1_000_000;
/** `?coupure` : réseau coupé 20 s au milieu du premier envoi. */
const OUTAGE = { atFraction: 0.5, ms: 20_000 };

const TITLE_PREFIX = "Démo · ";

const INVALID_LINK_NOTE = {
  fr: "(normal en démo : le partage n'existait que dans l'onglet d'origine)",
  en: "(expected in the demo: the share only existed in the original tab)",
} as const;

// Écarts avec la production (UI §14.3), pour la page Sécurité de la démo : une ligne par écart.
const SECURITY_GAPS = {
  fr: [
    "frame-ancestors 'none' : absent (ignoré dans une balise meta) ; la démo peut être affichée dans le cadre d'un autre site, sans enjeu : aucun secret réel.",
    "report-uri et sandbox de CSP : absents (non pris en charge en meta).",
    "Strict-Transport-Security : le nôtre est absent ; github.io est dans la liste HSTS préchargée des navigateurs et Pages force HTTPS.",
    "Permissions-Policy (micro limité au site, caméra et position refusées) : absent, aucun équivalent meta.",
    "Cross-Origin-Opener-Policy et Cross-Origin-Resource-Policy : absents.",
    "X-Content-Type-Options: nosniff : dépend de GitHub Pages, non garanti par nous.",
    "Cache-Control: no-store : absent (Pages met en cache) ; le cache « page précédente » est neutralisé comme en production.",
    "Origine propre : partagée (skoow.github.io est commune à tous les sites Pages du propriétaire) ; à ne jamais réutiliser pour la production.",
    "Trusted Types : absent, comme en production.",
    "Connexions : connect-src 'none' (plus strict qu'en production) : seul le faux serveur de la page répond à /api, tout autre envoi du navigateur est refusé.",
    "Hébergeur : GitHub reçoit votre adresse IP et peut la journaliser (sa déclaration de confidentialité s'applique) ; aucun contenu, nom de fichier ni clé ne lui est envoyé.",
  ],
  en: [
    "frame-ancestors 'none': missing (ignored in a meta tag); the demo can be framed by another site, harmless: no real secret.",
    "CSP report-uri and sandbox: missing (not supported in meta).",
    "Strict-Transport-Security: ours is missing; github.io is on the browsers' HSTS preload list and Pages forces HTTPS.",
    "Permissions-Policy (microphone limited to the site, camera and location denied): missing, no meta equivalent.",
    "Cross-Origin-Opener-Policy and Cross-Origin-Resource-Policy: missing.",
    "X-Content-Type-Options: nosniff: up to GitHub Pages, not guaranteed by us.",
    "Cache-Control: no-store: missing (Pages caches); the back-forward cache is neutralised as in production.",
    "Own origin: shared (skoow.github.io is common to all the owner's Pages sites); never to be reused for production.",
    "Trusted Types: missing, as in production.",
    "Connections: connect-src 'none' (stricter than production): only the in-page fake server answers /api, any other request from the browser is refused.",
    "Host: GitHub receives your IP address and may log it (its privacy statement applies); no content, file name or key is sent to it.",
  ],
} as const;

const isApiPath = (p: string) => /^\/api(\/|$)/i.test(p);

export function installDemo(w: Window): void {
  const q = new URLSearchParams(w.location.search);
  const rate = q.has("lent") ? SLOW_RATE : RATE;
  const fake = createFakeServer({ rateBytesPerS: rate, outage: q.has("coupure") ? OUTAGE : undefined });
  const isApi = (u: URL) => u.origin === w.location.origin && isApiPath(u.pathname);

  // Seules les URL /api/* de l'origine sont détournées ; le reste (fichiers du site) part normalement.
  const original = w.fetch.bind(w);
  w.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    return isApi(new URL(req.url)) ? fake.handle(req) : original(req);
  };
  const g = w as Window & { XMLHttpRequest: typeof XMLHttpRequest };
  g.XMLHttpRequest = fakeXHRClass(g.XMLHttpRequest, isApi, (r) => fake.handle(r), rate);

  // Titre des onglets : toujours « Démo · … », même si un écran le change.
  const d = w.document;
  d.documentElement.setAttribute("data-shh-demo", MARK);
  const prefix = () => {
    if (!d.title.startsWith(TITLE_PREFIX)) d.title = TITLE_PREFIX + d.title;
  };
  prefix();
  new MutationObserver(prefix).observe(d.head, { subtree: true, childList: true, characterData: true });

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  setDemo({
    solveCaptcha: async (): Promise<CaptchaProof> => ({ kind: "pow", payload: "demo" }),
    openAsRecipient(link: string) {
      // Lien de partage de cet onglet (spec §32 : `${origin}${base}#<43>`) : navigation interne,
      // sans rechargement ; App.svelte lit puis retire le « # » comme pour un lien ouvert.
      const u = new URL(link);
      const ok = u.origin === w.location.origin && (u.pathname === base + "/" || u.pathname === base || (base === "" && u.pathname === "/")) && u.search === "" && SHARE_FRAGMENT.test(u.hash);
      if (!ok) throw new Error("lien_invalide");
      w.history.pushState(null, "", base + "/" + u.hash);
      w.dispatchEvent(new PopStateEvent("popstate"));
    },
    get invalidLinkNote() {
      return INVALID_LINK_NOTE[getLang()];
    },
    get securityGaps() {
      return SECURITY_GAPS[getLang()].join("\n");
    },
    Banner: DemoBanner,
  });
}
