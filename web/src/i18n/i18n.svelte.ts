import { en } from "./en";
import { fr } from "./fr";
import { plural, type Lang } from "./format";

type Dict = Record<keyof typeof fr, string>;
const dicts: Record<Lang, Dict> = { fr, en };

// Les clés à pluriel s'écrivent « base.one » / « base.other » ; on appelle t("base", { n }).
type Strip<K> = K extends `${infer B}.${"one" | "other"}` ? B : K;
export type Key = Strip<keyof typeof fr>;

/** UI §10 : la première langue du navigateur dont la langue primaire est fr ou en décide ; sinon français. */
export function detectLang(languages: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages): Lang {
  for (const l of languages) {
    const primary = l.split("-")[0]!.toLowerCase();
    if (primary === "fr" || primary === "en") return primary;
  }
  return "fr";
}

// Sans mémorisation (aucun stockage) : la langue est recalculée à chaque visite.
let lang = $state<Lang>(detectLang());

function applyHtmlLang(l: Lang): void {
  if (typeof document !== "undefined") document.documentElement.lang = l;
}
applyHtmlLang(lang);

export function getLang(): Lang {
  return lang;
}

export function setLang(l: Lang): void {
  lang = l;
  applyHtmlLang(l);
}

export function t(key: Key, params?: Record<string, string | number>): string {
  const d = dicts[lang];
  let k: string = key;
  if (typeof params?.n === "number" && `${key}.${plural(lang, params.n)}` in d) k = `${key}.${plural(lang, params.n)}`;
  const raw = (d as Record<string, string>)[k];
  if (raw === undefined) return key;
  // Un seul passage : une valeur (nom de fichier) n'est jamais réinterprétée comme paramètre.
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (params && name in params ? String(params[name]) : m));
}
