// Installation de la démo GitHub Pages (UI §14.3), appelée par main.ts en mode « demo »
// seulement, avant le montage de l'application. Remplace fetch et XMLHttpRequest pour les
// seules URL /api/* de l'origine (faux serveur en mémoire), préfixe le titre de l'onglet et
// remplit les crochets lus par les écrans (app/demo-hooks.ts). Seul stockage : l'état du faux
// serveur de cet onglet (demo/persist.ts, exception démo), pour survivre à un rechargement.
import { setDemo } from "../app/demo-hooks";
import { leaveGuard } from "../app/router.svelte";
import { demoPrefixed } from "../app/title";
import { getLang } from "../i18n/i18n.svelte";
import { SHARE_FRAGMENT, type CaptchaProof } from "../index";
import DemoBanner from "./DemoBanner.svelte";
import { createFakeServer } from "./fake-server";
import { fakeXHRClass } from "./fake-xhr";
import { openDemoStore } from "./persist";

export const MARK = "__SHH_DEMO__";

/** Débit simulé des segments : 20 Mo/s ; `?lent` : 1 Mo/s. */
const RATE = 20_000_000;
const SLOW_RATE = 1_000_000;
/** `?coupure` : réseau coupé 20 s au milieu du premier envoi. */
const OUTAGE = { atFraction: 0.5, ms: 20_000 };


const INVALID_LINK_NOTE = {
  fr: "(normal en démo : un partage n'existe que dans l'onglet qui l'a créé)",
  en: "(expected in the demo: a share only exists in the tab that created it)",
} as const;

// Écarts avec la production (UI §14.3), pour la page Sécurité de la démo : une ligne par écart.
const SECURITY_GAPS = {
  fr: [
    "frame-ancestors 'none' : absent (ignoré dans une balise meta) ; la démo peut être affichée dans le cadre d'un autre site, sans enjeu : aucun secret réel.",
    "report-uri et sandbox de CSP : absents (non pris en charge en meta).",
    "Strict-Transport-Security : le nôtre est absent ; github.io est dans la liste HSTS préchargée des navigateurs et Pages force HTTPS.",
    "Permissions-Policy (micro et caméra limités au site, presse-papiers en lecture, capture d'écran, position, capteurs et périphériques refusés) : absent, aucun équivalent meta.",
    "Cross-Origin-Opener-Policy et Cross-Origin-Resource-Policy : absents.",
    "X-Content-Type-Options: nosniff : dépend de GitHub Pages, non garanti par nous.",
    "Cache-Control: no-store : absent (Pages met en cache) ; le cache « page précédente » est neutralisé comme en production.",
    "Origine propre : partagée (skoow.github.io est commune à tous les sites Pages du propriétaire) ; à ne jamais réutiliser pour la production.",
    "Connexions : connect-src 'none' (plus strict qu'en production) : seul le faux serveur de la page répond à /api, tout autre envoi du navigateur est refusé.",
    "Hébergeur : GitHub reçoit votre adresse IP et peut la journaliser (sa déclaration de confidentialité s'applique) ; aucun contenu, nom de fichier ni clé ne lui est envoyé.",
  ],
  en: [
    "frame-ancestors 'none': missing (ignored in a meta tag); the demo can be framed by another site, harmless: no real secret.",
    "CSP report-uri and sandbox: missing (not supported in meta).",
    "Strict-Transport-Security: ours is missing; github.io is on the browsers' HSTS preload list and Pages forces HTTPS.",
    "Permissions-Policy (microphone and camera limited to the site; clipboard reading, screen capture, location, sensors and devices denied): missing, no meta equivalent.",
    "Cross-Origin-Opener-Policy and Cross-Origin-Resource-Policy: missing.",
    "X-Content-Type-Options: nosniff: up to GitHub Pages, not guaranteed by us.",
    "Cache-Control: no-store: missing (Pages caches); the back-forward cache is neutralised as in production.",
    "Own origin: shared (skoow.github.io is common to all the owner's Pages sites); never to be reused for production.",
    "Connections: connect-src 'none' (stricter than production): only the in-page fake server answers /api, any other request from the browser is refused.",
    "Host: GitHub receives your IP address and may log it (its privacy statement applies); no content, file name or key is sent to it.",
  ],
} as const;

const isApiPath = (p: string) => /^\/api(\/|$)/i.test(p);

export async function installDemo(w: Window): Promise<void> {
  const q = new URLSearchParams(w.location.search);
  const rate = q.has("lent") ? SLOW_RATE : RATE;
  const store = await openDemoStore(w).catch(() => null);
  const fake = createFakeServer({
    rateBytesPerS: rate,
    outage: q.has("coupure") ? OUTAGE : undefined,
    restore: store?.snap ? { snap: store.snap, segment: (id, n) => store.segment(id, n) } : undefined,
    onChange: store ? (s) => store.saveMeta(s) : undefined,
    onSegment: store ? (id, n, d) => store.saveSegment(id, n, d) : undefined,
  });
  store?.release();
  const isApi = (u: URL) => u.origin === w.location.origin && isApiPath(u.pathname);

  // Seules les URL /api/* de l'origine sont détournées ; le reste (fichiers du site) part normalement.
  const original = w.fetch.bind(w);
  w.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    return isApi(new URL(req.url)) ? fake.handle(req) : original(req);
  };
  const g = w as Window & { XMLHttpRequest: typeof XMLHttpRequest };
  g.XMLHttpRequest = fakeXHRClass(g.XMLHttpRequest, isApi, (r) => fake.handle(r), rate);

  // Titre des onglets : toujours « Démo · … » (« Demo · … » en anglais), même si un écran le change.
  const d = w.document;
  d.documentElement.setAttribute("data-shh-demo", MARK);
  const prefix = () => {
    const want = demoPrefixed(d.title, d.documentElement.lang);
    if (d.title !== want) d.title = want;
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
      // Navigation voulue : la garde du bouton Retour (« Lien prêt ») ne la retient pas.
      leaveGuard?.release();
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
