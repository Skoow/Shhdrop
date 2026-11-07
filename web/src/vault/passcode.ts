// Contrôle d'un code du coffre choisi par la personne (spec §27.2 : « le code suit les règles
// de §31 »). Depuis le 7 novembre (D41-15), le mot de passe d'un partage est toujours généré :
// ce contrôle et ses listes ne servent plus qu'au coffre. Ils vivent ici, importés par le seul
// code du coffre (aucun import depuis l'envoi, l'ouverture ni src/index.ts) : ils restent hors
// du paquet principal (environ 15 Ko gzip de listes), sans import() dynamique (§28.3).
import { BLOCK, CORES_PACKED } from "./blocklist";
import { decodeCores, weakReason, type WeakReason } from "./weakpw";

/** Longueur minimale d'un code du coffre, en points de code NFC (spec §27.2, §31). */
export const PASSCODE_MIN_CHARS = 10;

export type PasscodeCheck = { ok: true } | { ok: false; reason: "trop_court" | WeakReason };

let lists: { block: ReadonlySet<string>; cores: ReadonlySet<string> } | undefined;

/**
 * Code du coffre accepté : 10 caractères au moins (points de code NFC), ni répétition, ni
 * suite, ni rangée de clavier, ni mot de passe courant ou mot courant entouré de chiffres et
 * de symboles (weakpw.ts, audit M1) : un humain choisit moins bien qu'un tirage.
 */
export function checkPasscode(code: string): PasscodeCheck {
  const nfc = code.normalize("NFC");
  if ([...nfc].length < PASSCODE_MIN_CHARS) return { ok: false, reason: "trop_court" };
  lists ??= { block: new Set(BLOCK), cores: decodeCores(CORES_PACKED) };
  const weak = weakReason(nfc, lists);
  return weak === null ? { ok: true } : { ok: false, reason: weak };
}
