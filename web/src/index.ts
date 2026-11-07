// Interface publique du client Shhdrop (pour l'interface du Plan 2). Seules les fonctions
// sûres sont exportées : la couche HTTP (transfer/api) et les dérivations de clés restent
// internes, pour qu'aucun écran ne puisse envoyer un secret au serveur par erreur (audit M1).
export {
  BadPasswordError,
  CAPTCHA_MIN_MS,
  LimitError,
  NotFoundError,
  ReadBudgetError,
  ServerError,
  collectToBlob,
  createShare,
  destroyShare,
  fetchMeta,
  openShare,
  shareStatus,
  type CaptchaCtx,
  type CaptchaProof,
  type CreateOpts,
  type Net,
  type Opened,
  type PreviewKind,
} from "./transfer/client";
export { prepareCaptcha, type PreparedCaptcha } from "./transfer/prepare";
export { SERVER_STALL_MS } from "./transfer/upload";
export { isRiskyName, safeName as cleanName } from "./transfer/safety";
export { MANIFEST_MAX, PREVIEW_MAX, type KeepTtl, type Rights } from "./crypto/container";
// Géométrie publique du paquet (aucune clé) : budget de lecture estimé par la page (flows/read-meter.ts).
export { CHUNK, SEG_CHUNKS, bucketFor, segmentCount, segmentSize } from "./crypto/container";
export {
  CONTENT_MAX,
  MAX_ITEMS,
  MAX_OPENS,
  NAME_MAX,
  OPENS_DEFAULT,
  PW_TRIES,
  STRIP_MAX,
  TEXT_MAX,
  TTL_DEFAULT,
  TTL_HOURS,
  TTL_MAX_HOURS,
  type TtlHours,
} from "./limits";
export { PASSWORD_ALPHABET, PASSWORD_LEN, generatePassword, type GeneratedPassword } from "./crypto/password";
export { MANAGE_FRAGMENT, SHARE_FRAGMENT, SHARE_LINK_SHAPE, manageLink, parseLink, shareLink, type ParsedLink } from "./transfer/link";
export type { Item, Manifest, ManifestEntry, ManifestV2 } from "./crypto/container";
export type { KAcces, KLien, KPreuve, SGestion } from "./crypto/types";
