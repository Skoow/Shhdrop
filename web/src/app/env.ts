// Environnement : navigateur pris en charge (UI §9), navigateur intégré d'application
// (UI §9.7), mémoire faible (UI §9.8).

/** Capacités exigées avant toute route (UI §9). `Worker` n'est pas exigé (repli anti-robot). */
export function isSupported(g: typeof globalThis): boolean {
  const c = g.crypto as Partial<Crypto> | undefined;
  return (
    typeof c?.subtle === "object" &&
    c.subtle !== null &&
    typeof c.getRandomValues === "function" &&
    typeof g.WebAssembly === "object" &&
    g.WebAssembly !== null &&
    typeof g.Blob?.prototype?.stream === "function" &&
    typeof g.TextDecoder === "function" &&
    typeof g.AbortController === "function"
  );
}

// Ordre significatif : WeChat (« MicroMessenger ») avant Messenger, Messenger avant Facebook
// (ses agents portent aussi FBAN / FB_IAB).
const IN_APP: readonly [RegExp, string][] = [
  [/\bInstagram\b/, "Instagram"],
  [/MicroMessenger\//, "WeChat"],
  [/FBAN\/Messenger|FB_IAB\/Orca-Android|\bMessenger\b/, "Messenger"],
  [/FBAN\/|FBAV\/|FB_IAB\//, "Facebook"],
  [/\bLinkedInApp\b/, "LinkedIn"],
  [/\bSnapchat\b/, "Snapchat"],
  [/musical_ly|BytedanceWebview/, "TikTok"],
  [/\bLine\/\d/, "LINE"],
  [/\bTelegram\b/, "Telegram"],
  [/Twitter for iPhone|\bTwitterAndroid\b/, "X"],
  [/\bPinterest\b/, "Pinterest"],
  [/\bDiscord(?:-Android)?\//, "Discord"],
  // Gmail avant Google : l'application Gmail peut aussi porter « GSA/ ».
  [/\bGmail\//, "Gmail"],
  [/\bGSA\//, "Google"],
];

/** Nom de l'application dont le navigateur intégré affiche la page, ou `null`. Une PWA installée n'est jamais signalée. */
export function inAppBrowser(ua: string, standalone: boolean): string | null {
  if (standalone) return null;
  for (const [re, app] of IN_APP) if (re.test(ua)) return app;
  return null;
}

/** Application installée (PWA) : jamais signalée comme navigateur intégré. */
export function isStandalone(w: Window): boolean {
  return (
    w.matchMedia?.("(display-mode: standalone)").matches === true ||
    (w.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

const LOW_MEMORY_BYTES = 200 * 1024 * 1024;

/** Vrai si un fichier de `size` octets risque d'épuiser la mémoire : > 200 Mio et (deviceMemory < 4, ou iPhone/iPad). */
export function lowMemory(n: Navigator, size: number): boolean {
  if (!(size > LOW_MEMORY_BYTES)) return false;
  const mem = (n as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof mem === "number" && mem < 4) return true;
  const ua = n.userAgent;
  // iPadOS se présente comme un Mac ; seul l'écran tactile le distingue.
  return /\b(iPhone|iPad|iPod)\b/.test(ua) || (/\bMacintosh\b/.test(ua) && n.maxTouchPoints > 1);
}
