// Interface publique du client Shhdrop (pour l'interface du Plan 2). Seules les fonctions
// sûres sont exportées : la couche HTTP (transfer/api) et les dérivations de clés restent
// internes, pour qu'aucun écran ne puisse envoyer un secret au serveur par erreur (audit M1).
export {
  BadPasswordError,
  CAPTCHA_MIN_MS,
  LimitError,
  NotFoundError,
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
export { safeName as cleanName } from "./transfer/safety";
export { PREVIEW_MAX } from "./crypto/container";
export { manageLink, parseLink, shareLink, type ParsedLink } from "./transfer/link";
export { PASSPHRASE_MIN_WORDS, PW_MIN_CHARS, checkPassword, generatePassphrase, type PwCheck } from "./crypto/passphrase";
export type { Item, Manifest, ManifestEntry } from "./crypto/container";
export type { KAcces, KLien, KPreuve, SGestion } from "./crypto/types";
