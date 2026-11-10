// Fichier que ce navigateur ne sait pas décoder (retours CLEAN4) : quel autre navigateur
// essayer, d'après l'extension du nom. Indicatif seulement : le décodage réel décide.
//   - HEIC/HEIF (photos d'iPhone) et MOV (souvent en HEVC) : Safari les lit ;
//   - WebM, Ogg, Opus, MKV, FLAC : Chrome et Firefox les lisent.
const SAFARI = new Set(["heic", "heif", "hif", "mov", "hevc"]);
const CHROME = new Set(["webm", "ogg", "oga", "ogv", "opus", "mkv", "mka", "flac"]);

export type OtherBrowser = "safari" | "chrome" | null;

export function otherBrowser(name: string): OtherBrowser {
  const d = name.lastIndexOf(".");
  const ext = d > 0 ? name.slice(d + 1).toLowerCase() : "";
  return SAFARI.has(ext) ? "safari" : CHROME.has(ext) ? "chrome" : null;
}

/** Extension en capitales pour le message (« HEIC ») ; vide sans extension. */
export function extLabel(name: string): string {
  const d = name.lastIndexOf(".");
  return d > 0 ? name.slice(d + 1).toUpperCase() : "";
}
