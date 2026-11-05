// Options de l'envoi (UI §9.3, spec §31, §34) : durée, ouvertures, mot de passe, droits du
// destinataire. En mémoire seulement : le mot de passe n'est jamais rangé ni journalisé.
import type { PwCheck } from "../index";
import { MAX_OPENS, OPENS_DEFAULT, PREVIEW_MAX, TTL_DEFAULT, TTL_HOURS, type TtlHours } from "./limits";

export type Rights = "voir" | "enregistrer" | "coffre";
export type OptionsBlock = "mdp_trop_court" | "mdp_trop_courant" | "mdp_verif";

export type OptionsDeps = {
  /** Mot de passe généré (spec §31). */
  generate: () => string;
  /** Contrôle d'un mot de passe saisi (12 caractères, liste noire) ; null tant que le contrôle n'est pas chargé. */
  check: (pw: string) => PwCheck | null;
  /** Le droit « coffre » est-il proposé ici (spec §27 : pas en démo) ? */
  vaultAllowed?: () => boolean;
};

export function createOptions(deps: OptionsDeps) {
  let ttl = $state<TtlHours>(TTL_DEFAULT);
  let opens = $state(OPENS_DEFAULT);
  let mode = $state<"generated" | "custom">("generated");
  let generated = $state(deps.generate());
  let custom = $state("");
  let rights = $state<Rights>("enregistrer");

  function check(): PwCheck | null {
    return mode === "generated" ? { ok: true } : deps.check(custom);
  }

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
    get mode() {
      return mode;
    },
    /** Mot de passe qui sera utilisé. */
    get password() {
      return mode === "generated" ? generated : custom;
    },
    get generated() {
      return generated;
    },
    get custom() {
      return custom;
    },
    get rights() {
      return rights;
    },
    set rights(v: Rights) {
      if (v === "coffre" && !deps.vaultAllowed?.()) v = "enregistrer";
      if (v === "voir" || v === "enregistrer" || v === "coffre") rights = v;
    },
    regenerate() {
      generated = deps.generate();
    },
    setCustom(pw: string) {
      mode = "custom";
      custom = pw;
    },
    useGenerated() {
      mode = "generated";
    },
    check,
    blockReason(): OptionsBlock | null {
      const c = check();
      if (c === null) return "mdp_verif";
      if (c.ok) return null;
      return c.reason === "trop_court" ? "mdp_trop_court" : "mdp_trop_courant";
    },
  };
}
export type Options = ReturnType<typeof createOptions>;

// Débits de référence pour l'estimation (octets par seconde, envoi) : honnêtes et prudents.
const FAST = 5_000_000; // fibre ou bon wifi, environ 40 Mbit/s en envoi
const SLOW = 1_000_000; // réseau mobile moyen, environ 8 Mbit/s en envoi
const MANIFEST_RESERVED = 65536 + 4;
const TAG_RATIO = 16 / 65536;

/**
 * Estimation du temps d'envoi, avant l'envoi : contenu + manifeste réservé + étiquettes de
 * chiffrement. Le bourrage du palier n'est pas envoyé (rempli par le serveur, spec §29.3).
 */
export function estimateUpload(contentBytes: number): { bytes: number; fastS: number; slowS: number } {
  const bytes = Math.ceil((contentBytes + MANIFEST_RESERVED) * (1 + TAG_RATIO));
  return { bytes, fastS: bytes / FAST, slowS: bytes / SLOW };
}

const VIEWABLE = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/svg+xml",
  "audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "audio/wav",
  "video/mp4", "video/webm", "video/quicktime", "application/pdf",
]);
type Viewable = { kind: "file" | "text"; base: string; ext: string; mime: string; size: number };

/**
 * Éléments que le destinataire ne pourrait pas voir dans le navigateur (spec §34) : « Voir
 * seulement » les rendrait inaccessibles. Même liste blanche que la visionneuse (previewKind).
 */
export function viewOnlyBlockers(items: readonly Viewable[]): string[] {
  return items
    .filter((i) => i.kind === "file" && (i.size > PREVIEW_MAX || !VIEWABLE.has(i.mime.split(";")[0]!.trim().toLowerCase())))
    .map((i) => i.base + i.ext);
}
