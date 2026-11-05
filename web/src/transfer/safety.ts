// Réception : nom de fichier nettoyé, aperçu sur liste blanche, types dangereux (spec §12,
// audit M4). Le manifeste vient de l'expéditeur : son nom et son type MIME sont hostiles.
import { PREVIEW_MAX, type ManifestEntry } from "../crypto/container";

export type PreviewKind = "image" | "audio" | "video" | "text" | "pdf" | "none";

const NAME_MAX = 120; // points de code
const EXT_MAX = 16; // au-delà, « l'extension » n'en est pas une : coupe simple

// Inversions de sens d'écriture (U+202A–U+202E, U+2066–U+2069), marques LRM/RLM/ALM,
// contrôles C0, DEL et C1, séparateurs de chemin, et toute la classe Default_Ignorable_Code_Point
// (largeur nulle, U+00AD, U+034F, remplissages hangul, sélecteurs de variante, étiquettes…) :
// invisibles, ils permettent de camoufler une extension ou de rendre deux noms identiques à l'œil.
// Exceptions traitées à part : U+200D et U+FE0F, nécessaires aux emoji.
const STRIP = /[‪-‮⁦-⁩‎‏؜\u0000-\u001F\u007F-\u009F/\\]|(?![\u200D\uFE0F])\p{Default_Ignorable_Code_Point}/gu;

// U+FE0F (sélecteur d'emoji) : gardé seulement après un pictogramme.
const VS16_OUTSIDE_EMOJI = /(?<!\p{Extended_Pictographic})\uFE0F/gu;

// U+200D (liant de séquences emoji) : gardé seulement entre deux emoji (avant : pictogramme,
// suivi au plus d'un sélecteur de variante et d'une teinte ; après : pictogramme), retiré ailleurs.
const ZWJ_OUTSIDE_EMOJI = /(?<!\p{Extended_Pictographic}\uFE0F?[\u{1F3FB}-\u{1F3FF}]?)\u200D|\u200D(?!\p{Extended_Pictographic})/gu;

/**
 * Nom à proposer au téléchargement : NFC ; sans inversion de sens, caractère de largeur nulle, contrôle ni séparateur ;
 * espaces regroupés ; sans points initiaux (fichier caché) ni points et espaces finaux
 * (Windows les retire : « a.exe. » deviendrait « a.exe ») ; 120 points de code au plus (coupé entre deux graphèmes),
 * extension gardée ; « fichier » si rien ne reste.
 */
export function safeName(raw: string): string {
  // Retrait avant la normalisation : « e » + largeur nulle + accent se compose en « é ».
  let s = raw.replace(STRIP, "").replace(VS16_OUTSIDE_EMOJI, "").replace(ZWJ_OUTSIDE_EMOJI, "").normalize("NFC").replace(/\s+/gu, " ");
  s = s.replace(/^[\s.]+/u, "").replace(/[\s.]+$/u, "");
  if ([...s].length > NAME_MAX) {
    const dot = s.lastIndexOf(".");
    const ext = dot > 0 ? [...s.slice(dot)] : [];
    // Un premier graphème démesuré (centaines de marques combinantes) peut ne rien laisser
    // devant l'extension : « fichier » plutôt que « .exe » (fichier caché, sans avertissement).
    s =
      ext.length > 1 && ext.length <= EXT_MAX
        ? (takeGraphemes(s.slice(0, dot), NAME_MAX - ext.length).replace(/[\s.]+$/u, "") || "fichier") + ext.join("")
        : takeGraphemes(s, NAME_MAX).replace(/[\s.]+$/u, "");
  }
  return s === "" ? "fichier" : s;
}

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Début de s fait de graphèmes entiers, d'au plus `budget` points de code. */
function takeGraphemes(s: string, budget: number): string {
  let out = "";
  let used = 0;
  for (const { segment } of GRAPHEMES.segment(s)) {
    const n = [...segment].length;
    if (used + n > budget) break;
    out += segment;
    used += n;
  }
  return out;
}

const PREVIEW: Record<string, PreviewKind> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "image/avif": "image",
  "image/heic": "image",
  "image/svg+xml": "image", // dans <img> uniquement : aucun script ne s'y exécute
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/aac": "audio",
  "audio/ogg": "audio",
  "audio/webm": "audio",
  "audio/wav": "audio",
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
  "application/pdf": "pdf",
};

/**
 * Aperçu permis : élément texte → « text » (toujours affiché en texte brut) ; fichier dont
 * le type MIME (sans paramètres, casse ignorée) est sur la liste blanche et la taille
 * ≤ 200 Mio ; sinon « none » (téléchargement seulement). Le contenu peut mentir sur son
 * type : l'écran doit encore traiter un échec de décodage comme « none ».
 */
export function previewKindOf(e: ManifestEntry): PreviewKind {
  if (e.kind === "text") return "text";
  if (e.size > PREVIEW_MAX) return "none";
  const mime = e.mime.split(";")[0]!.toLowerCase();
  return Object.hasOwn(PREVIEW, mime) ? PREVIEW[mime]! : "none";
}

const RISKY = new Set(["exe", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "jar", "apk", "app", "dmg", "pkg", "sh", "html", "htm", "hta", "lnk", "iso", "msix", "appx", "reg", "wsf", "cpl", "pif", "url", "command", "desktop"]);

/** Extension exécutable ou interprétée : avertir avant l'enregistrement (spec §12). À appeler sur un nom passé par safeName. */
export function isRiskyName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && RISKY.has(name.slice(dot + 1).toLowerCase());
}
