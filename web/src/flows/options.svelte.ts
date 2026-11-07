// Options de l'envoi (UI §9.3, spec §31, §34) : durée, ouvertures, mot de passe, droits du
// destinataire. En mémoire seulement : le mot de passe n'est jamais rangé ni journalisé.
// Le mot de passe est toujours généré (D41-15) : aucune saisie, donc aucun contrôle ici.
import { ASSUMED_UP_BPS } from "./estimate";
import { MAX_OPENS, OPENS_DEFAULT, PREVIEW_MAX, TTL_DEFAULT, TTL_HOURS, type TtlHours } from "../index";

export type Rights = "voir" | "enregistrer" | "coffre";

export type OptionsDeps = {
  /** Mot de passe généré (spec §31). */
  generate: () => string;
  /** Le droit « coffre » est-il proposé ici (spec §27 : pas en démo) ? */
  vaultAllowed?: () => boolean;
};

export function createOptions(deps: OptionsDeps) {
  let ttl = $state<TtlHours>(TTL_DEFAULT);
  let opens = $state(OPENS_DEFAULT);
  let generated = $state(deps.generate());
  // Droits (spec §34, simplifiés par le propriétaire le 5 novembre) : un interrupteur
  // « Autoriser le téléchargement » (activé par défaut) et, seulement s'il est activé et là où
  // le coffre existe, la sous-option « Garder une copie chiffrée dans l'app du destinataire ».
  let download = $state(true);
  let vault = $state(false);
  const vaultOk = () => deps.vaultAllowed?.() === true;
  const rights = $derived<Rights>(!download ? "voir" : vault && vaultOk() ? "coffre" : "enregistrer");

  return {
    get ttlHours(): TtlHours {
      return ttl;
    },
    set ttlHours(v: TtlHours) {
      if ((TTL_HOURS as readonly number[]).includes(v)) ttl = v;
    },
    get maxOpens() {
      return opens;
    },
    set maxOpens(v: number) {
      opens = Math.min(MAX_OPENS, Math.max(1, Number.isFinite(v) ? Math.trunc(v) : 1));
    },
    /** Mot de passe qui sera utilisé : toujours le dernier généré. */
    get password() {
      return generated;
    },
    /** Droit écrit dans le manifeste : voir, enregistrer ou coffre. */
    get rights(): Rights {
      return rights;
    },
    set rights(v: Rights) {
      if (v === "voir") download = false;
      else if (v === "enregistrer") (download = true), (vault = false);
      else if (v === "coffre" && vaultOk()) (download = true), (vault = true);
    },
    get allowDownload() {
      return download;
    },
    set allowDownload(v: boolean) {
      download = v === true;
    },
    /** Sous-option du téléchargement ; sans effet si le coffre n'est pas proposé ici. */
    get keepVault() {
      return download && vault && vaultOk();
    },
    set keepVault(v: boolean) {
      vault = v === true && vaultOk();
    },
    regenerate() {
      generated = deps.generate();
    },
  };
}
export type Options = ReturnType<typeof createOptions>;

/**
 * Droit écrit dans le manifeste et, pour le coffre, la durée de garde (spec §27.4, §34.1) :
 * `keep_ttl_h` = durée du partage. Sans elle, createShare refuse « coffre » (S5).
 */
export function sendRights(o: Pick<Options, "rights" | "ttlHours">): { rights: Rights; keepTtlH?: TtlHours } {
  return o.rights === "coffre" ? { rights: "coffre", keepTtlH: o.ttlHours } : { rights: o.rights };
}

// Débits de référence pour l'estimation (octets par seconde, envoi) : honnêtes et prudents.
const FAST = 5_000_000; // fibre ou bon wifi, environ 40 Mbit/s en envoi
const SLOW = ASSUMED_UP_BPS; // réseau mobile moyen, environ 8 Mbit/s en envoi (flows/estimate.ts)
const MANIFEST_RESERVED = 65536; // un morceau : manifeste ≤ 65 532 octets + sa longueur (spec §29.3)
const TAG_RATIO = 16 / 65536;

/**
 * Estimation du temps d'envoi, avant l'envoi : contenu + manifeste réservé + étiquettes de
 * chiffrement. Le bourrage du palier n'est pas envoyé (rempli par le serveur, spec §29.3).
 */
export function estimateUpload(contentBytes: number): { bytes: number; fastS: number; slowS: number } {
  const bytes = Math.ceil((contentBytes + MANIFEST_RESERVED) * (1 + TAG_RATIO));
  return { bytes, fastS: bytes / FAST, slowS: bytes / SLOW };
}

// SVG : jamais affiché (scan de sécurité du 7 novembre). PDF : pas de visionneuse tant que la
// Task 22 (cadre isolé) n'est pas livrée ; le remettre ici avec elle.
const VIEWABLE = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic",
  "audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "audio/wav",
  "video/mp4", "video/webm", "video/quicktime",
]);
type Viewable = { kind: "file" | "text"; base: string; ext: string; mime: string; size: number };

/** Le destinataire peut-il ouvrir cet élément dans le navigateur, sans le télécharger ? Même liste blanche que la visionneuse (previewKind). */
export function viewableInBrowser(i: Viewable): boolean {
  return i.kind === "text" || (i.size <= PREVIEW_MAX && VIEWABLE.has(i.mime.split(";")[0]!.trim().toLowerCase()));
}

/** Éléments qui ne pourront pas être ouverts sans téléchargement (spec §34). */
export function viewOnlyBlockers(items: readonly Viewable[]): string[] {
  return items.filter((i) => !viewableInBrowser(i)).map((i) => i.base + i.ext);
}
