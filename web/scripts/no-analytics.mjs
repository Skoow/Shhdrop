// Liste « aucune statistique » de la spec §35.1 (Task M2), partagée par le test des sources
// (src/no-analytics.test.ts) et par check-dist.mjs (dist/, dist-verif/, dist-demo/).
// Recherche insensible à la casse. Ce fichier et les tests qui l'importent sont les seuls à
// contenir ces mots : ils sont exclus de la recherche dans les sources.
export const ANALYTICS = [
  "google-analytics", "googletagmanager", "gtag(", "analytics.js", "plausible", "matomo", "piwik", "posthog",
  "mixpanel", "segment.io", "cdn.segment.com", "amplitude", "hotjar", "clarity.ms", "@sentry/", "sentry.io",
  "bugsnag", "rollbar", "datadog", "newrelic", "nr-data.net", "logrocket", "fullstory", "umami", "usefathom",
  "cloudflareinsights", "web-vitals", "heapanalytics", "mc.yandex", "fbq(", "doubleclick", "honeybadger",
  "trackjs", "raygun", "@opentelemetry", "elastic-apm", "sendbeacon",
];

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Un mot qui commence ou finit par une lettre ne compte pas collé à une autre lettre :
// « scrollbar » (CSS) ne contient pas « rollbar ».
const RES = ANALYTICS.map((w) => [w, new RegExp(`${/^[a-z]/.test(w) ? "(?<![a-z])" : ""}${esc(w)}${/[a-z]$/.test(w) ? "(?![a-z])" : ""}`, "i")]);

/** Mots de la liste présents dans text (insensible à la casse). */
export function findAnalytics(text) {
  return RES.filter(([, re]) => re.test(text)).map(([w]) => w);
}

/**
 * Écouteurs globaux d'erreurs (spec §35.1) : window/self/globalThis.onerror,
 * onunhandledrejection, addEventListener("error" | "unhandledrejection") sur window, self,
 * globalThis ou document. Liste blanche : vide.
 */
export function findErrorListeners(text) {
  const re = /(?:\b(?:window|self|globalThis|document)\s*\.\s*(?:onerror|onunhandledrejection)\s*=)|(?:\b(?:window|self|globalThis|document)\s*\.\s*addEventListener\s*\(\s*["'`](?:error|unhandledrejection)["'`])|(?:\bonunhandledrejection\b)|(?:addEventListener\s*\(\s*["'`]unhandledrejection)/g;
  return [...text.matchAll(re)].map((m) => m[0]);
}
