// Partie du moteur gardée en TypeScript (décisions du contrôleur, Task 11) : ce que le site
// appelle de façon synchrone, avant tout chargement du moteur (page d'accueil, routeur, lecture
// de l'adresse), et qui ne déchiffre ni ne dérive rien :
//   - constantes et géométrie du format (tailles, paliers, segments), sans secret ;
//   - base64url, origine, forme des liens (sans décoder la clé), mot de passe du QR code
//     (chaînes déjà présentes en JavaScript : l'adresse, le mot de passe affiché) ;
//   - mot de passe généré et sa forme (accueil : le composeur le tire à son montage, spec moteur
//     §7 : la page d'accueil ne charge pas le moteur) ; les apps utilisent celui du moteur.
// Chaque fonction est prouvée égale au moteur Rust sur les vecteurs communs (pure.test.ts) ;
// tout ce qui touche une clé passe par le moteur après son chargement (index.ts).

// --- Types marqués des secrets (audit M1) ----------------------------------------------------
// Tous sont des Uint8Array de 32 octets, mais le
// compilateur refuse de les confondre : K_lien ne peut pas être passé
// là où le serveur attend K_accès ou K_preuve. Ils ne sont produits que par :
//   - newKLien(), newSGestion() (tirage aléatoire, ici) ;
//   - deriveAccess (K_accès), passwordKey / passwordKeyForCreate (K_mdp), accessKeys (K_preuve), dans engine/index.ts ;
//   - parseLink (K_lien ou S_gestion lus dans le fragment du lien).
// Aucun autre code ne doit écrire « as KLien » (sauf les tests).

/** Clé du lien, dans le fragment (#) : ne quitte jamais le navigateur. */
export type KLien = Uint8Array<ArrayBuffer> & { readonly __brand: "KLien" };
/** Clé d'accès, dérivée de K_lien : envoyée au serveur (X-Shh-Access). */
export type KAcces = Uint8Array<ArrayBuffer> & { readonly __brand: "KAcces" };
/** Preuve du mot de passe, dérivée de K_lien et du mot de passe : envoyée au serveur. */
export type KPreuve = Uint8Array<ArrayBuffer> & { readonly __brand: "KPreuve" };
/** Secret de gestion, dans le fragment du lien de gestion : envoyé au serveur (X-Shh-Manage). */
export type SGestion = Uint8Array<ArrayBuffer> & { readonly __brand: "SGestion" };
/** Clé du mot de passe (Argon2id) : ne quitte jamais le navigateur, mise à zéro après usage. */
export type KMdp = Uint8Array<ArrayBuffer> & { readonly __brand: "KMdp" };

// --- Encodage ---------------------------------------------------------------------------------

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function b64u(bytes: Uint8Array<ArrayBuffer>): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63];
  }
  return out;
}

export function unb64u(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error("base64url invalide");
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (const ch of s) {
    acc = (acc << 6) | ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
      acc &= (1 << bits) - 1;
    }
  }
  // bits de bourrage non nuls : encodage non canonique
  if (acc !== 0) throw new Error("base64url invalide");
  return out;
}

export function utf8(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// --- Format : constantes et géométrie (spec §29.3) ------------------------------------------

export const CHUNK = 65536, TAG = 16, CHUNK_CT = 65552, HEADER = 48, SEG_CHUNKS = 64;
/**
 * Paliers gratuits en morceaux de 64 Kio (spec §24, §29.3, §41.2). Chaque palier garde son
 * dernier morceau pour le manifeste : le palier 1 sert aux partages de texte seul, et le plus
 * grand (32 769 morceaux) contient exactement 2 Gio de données plus le morceau du manifeste.
 */
export const BUCKETS = [1, 16, 80, 160, 400, 800, 1600, 4000, 8000, 16385, 32769] as const;
/** Au-delà, pas d'aperçu sur le site : téléchargement en flux seulement (spec §24). */
export const PREVIEW_MAX = 200 * 1048576;
/**
 * Taille maximale du manifeste : avec sa longueur (4 octets), il tient dans un morceau de
 * 64 Kio, réservé en fin de paquet quelle que soit sa taille réelle (spec §29.3).
 */
export const MANIFEST_MAX = 65532;
const TAIL = 4 + MANIFEST_MAX;
/** Octets de données au plus (fichiers et notes, D41-36) : exactement 2 Gio (2 147 483 648). */
export const CONTENT_MAX = BUCKETS[BUCKETS.length - 1] * CHUNK - TAIL;
/**
 * Éléments par partage au plus, pour toutes les formules (décision du 7 novembre, D41-17 :
 * le nombre d'éléments n'est plus un critère de formule, une archive .zip le contourne).
 * Borne technique d'un manifeste d'un morceau (MANIFEST_MAX = 65 532 octets) : une entrée de
 * fichier au nom ASCII de 120 caractères et au type de 40 caractères fait environ 220 octets,
 * soit environ 290 entrées ; 200 laisse de la marge. Des noms en écriture non latine (jusqu'à
 * 4 octets par caractère) peuvent remplir le manifeste avant : le composeur
 * le mesure et bloque l'envoi avec sa raison (« manifeste »), jamais un échec au scellement.
 */
export const MAX_ITEMS = 200;
/**
 * Points de code d'une note au plus (D41-36 : 100 000, contre 10 000 quand le texte était dans
 * le manifeste). Le texte est la donnée d'un élément (segments chiffrés sous sa clé, §41.14),
 * plus dans le manifeste ; les anciens partages (texte dans le manifeste) restent lisibles.
 */
export const TEXT_MAX = 100_000;
/** Octets UTF-8 d'une note au plus : un point de code fait au plus 4 octets. */
export const TEXT_BYTES_MAX = 4 * TEXT_MAX;

/** Droits du destinataire (spec §34), dans le manifeste chiffré. */
export type Rights = "voir" | "enregistrer" | "coffre";
export type KeepTtl = 1 | 6 | 12 | 24;
const KEEP_TTLS: readonly number[] = [1, 6, 12, 24];

/** Élément à chiffrer. Un fichier (File est un Blob) n'est jamais lu en entier en mémoire. */
export type Item = { kind: "text" | "file"; name: string; mime: string; data: Uint8Array<ArrayBuffer> | Blob; clean?: ManifestClean };

/**
 * Nettoyage d'un fichier avant l'envoi (D41-35), dit au destinataire dans le manifeste CHIFFRÉ
 * (le serveur n'en voit rien ; le morceau du manifeste a une taille fixe) : famille nettoyée,
 * échec (`echec`, `protege`) ou fichier tel quel. Absent (ancien partage, texte) : rien n'est dit.
 */
export const MANIFEST_CLEAN = ["image", "video", "audio", "pdf", "bureautique", "vocal", "echec", "protege", "tel_quel"] as const;
export type ManifestClean = (typeof MANIFEST_CLEAN)[number];
export type ManifestEntry = {
  kind: "text" | "file";
  name: string;
  mime: string;
  size: number;
  offset: number;
  text?: string;
  /**
   * Graine de la clé de l'élément (spec §41.14), base64url de 32 octets, écrite dans le manifeste
   * chiffré ; absente du manifeste rendu à l'ouverture (le lecteur du moteur garde les clés).
   */
  k?: string;
  /** Fichier seulement : nettoyage avant l'envoi (D41-35) ; absent ou inconnu : rien n'est dit. */
  clean?: ManifestClean;
};

export type ManifestV2 = { v: 2; rights: Rights; keep_ttl_h?: KeepTtl; items: ManifestEntry[] };
export type Manifest = ManifestV2;

/** Palier canonique v2 : le plus petit palier de capacité ≥ fin des données + 4 + MANIFEST_MAX. */
export function bucketFor(dataEnd: number): number {
  if (!Number.isSafeInteger(dataEnd) || dataEnd < 0) throw new Error("taille_invalide");
  for (const b of BUCKETS) if (dataEnd + TAIL <= b * CHUNK) return b;
  throw new Error("trop_gros");
}

/** Palier ou numéro de segment : entier de 0 à 2^32 − 1 (u32 du moteur), sinon taille_invalide. */
function u32(x: number): number {
  if (!Number.isSafeInteger(x) || x < 0 || x > 0xffff_ffff) throw new Error("taille_invalide");
  return x === 0 ? 0 : x; // −0 → 0, comme le moteur
}

/** Segments d'un palier ; taille_invalide hors des entiers de 0 à 2^32 − 1 (comme le moteur). */
export function segmentCount(bucket: number): number {
  return Math.ceil(u32(bucket) / SEG_CHUNKS);
}

/** Octets chiffrés du segment `n` (en-tête compris pour le segment 0) ; taille_invalide, segment_invalide hors du palier. */
export function segmentSize(bucket: number, n: number): number {
  const b = u32(bucket);
  const k = u32(n);
  if (k >= segmentCount(b)) throw new Error("segment_invalide");
  const chunks = Math.min(SEG_CHUNKS, b - k * SEG_CHUNKS);
  return (k === 0 ? HEADER : 0) + chunks * CHUNK_CT;
}

/** Clair d'un segment de transport : 64 morceaux de 64 Kio (4 Mio). */
export const SEG_PLAIN = SEG_CHUNKS * CHUNK;
/** Segments de données au plus : 2 Gio (le plus grand palier garde un morceau pour le manifeste). */
export const DATA_SEGMENTS = Math.floor((BUCKETS[BUCKETS.length - 1] - 1) / SEG_CHUNKS);

/** Segments entiers occupés par un fichier de `size` octets (0 pour un fichier vide). */
export function segmentsFor(size: number): number {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("taille_invalide");
  return Math.ceil(size / SEG_PLAIN);
}

/**
 * Plus petit palier qui contient `used` segments de données pleins suivis du morceau du
 * manifeste : réservation d'un brouillon (segments 0 à used − 1 tous pleins).
 */
export function reservationFor(used: number): number {
  if (!Number.isSafeInteger(used) || used < 0 || used > DATA_SEGMENTS) throw new Error("trop_gros");
  for (const b of BUCKETS) if (b >= used * SEG_CHUNKS + 1) return b;
  throw new Error("trop_gros");
}

/** Morceaux de données au plus (2 Gio). */
export const DATA_CHUNKS = DATA_SEGMENTS * SEG_CHUNKS;

/** Morceaux occupés par un fichier de `size` octets (0 pour un fichier vide). */
export function chunksFor(size: number): number {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("taille_invalide");
  return Math.ceil(size / CHUNK);
}

/**
 * Petit élément (audit H-2) : moins d'un segment ; empaqueté avec d'autres dans un segment
 * partagé, n'importe où sur une frontière de morceau, sans déborder de son segment. Un élément
 * d'un segment ou plus commence sur une frontière de segment et occupe ses segments seul.
 */
export function isSmall(size: number): boolean {
  return size > 0 && size < SEG_PLAIN;
}

/**
 * Emprise d'un élément, en morceaux : ses seuls morceaux nécessaires, ⌈taille / 64 Kio⌉
 * (D41-38, remplace l'arrondi en puissance de deux de D41-20 et D41-21) ; seule la fin de son
 * dernier morceau est faite de zéros chiffrés. Le serveur voit donc, pendant l'envoi, la taille
 * de chaque élément à 64 Kio près (fuite acceptée par le propriétaire).
 */
export function footprintFor(size: number): number {
  return chunksFor(size);
}

/**
 * Segments d'une liste de fichiers, empaquetage compris (estimation de la place : les petits
 * éléments, à 64 Kio près, se partagent des segments) ; borne « trop gros » de l'interface.
 */
export function segmentsNeeded(sizes: readonly number[]): number {
  let big = 0, small = 0;
  for (const n of sizes) {
    if (isSmall(n)) small += footprintFor(n);
    else big += segmentsFor(n);
  }
  return big + Math.ceil(small / SEG_CHUNKS);
}

/** Plage de morceaux d'un même segment, envoyée en une requête. */
export type Piece = { seg: number; from: number; chunks: number };


// --- Argon2id : paramètres (spec §29.2) -------------------------------------------------------

export const KDF_MIN = { ops: 3, mem: 67108864 } as const;
/**
 * Plafond accepté du serveur (audit F4) : les paramètres de création, seuls utilisés. Plus haut,
 * un serveur compromis ferait allouer jusqu'à 256 Mio et planter l'onglet d'un petit téléphone.
 */
export const KDF_MAX = { ops: 3, mem: 67108864 } as const;
export type KdfParams = { ops: number; mem: number };
/** Paramètres Argon2id des nouveaux partages (spec §29.2 : 64 Mio, 3 passes), imposés par passwordKeyForCreate. */
export const KDF_CREATE = { ops: KDF_MIN.ops, mem: KDF_MIN.mem } as const;
export function checkKdfParams(p: KdfParams): void {
  if (
    !Number.isInteger(p.ops) ||
    !Number.isInteger(p.mem) ||
    p.ops > KDF_MAX.ops ||
    p.mem > KDF_MAX.mem
  ) {
    throw new Error("paramètres KDF invalides");
  }
  // Le navigateur refuse tout paramètre inférieur au minimum, même proposé par le serveur.
  if (p.ops < KDF_MIN.ops || p.mem < KDF_MIN.mem) {
    throw new Error("paramètres KDF trop faibles");
  }
}

// --- Aléa (crypto.getRandomValues, spec moteur §3 : reste dans la plateforme) -----------------

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Nouvelle K_lien (32 octets aléatoires). */
export function newKLien(): KLien {
  return randomBytes(32) as KLien;
}

/** Nouveau S_gestion (32 octets aléatoires). */
export function newSGestion(): SGestion {
  return randomBytes(32) as SGestion;
}

// --- Mot de passe généré (spec §31) ------------------------------------------------------------

// Mot de passe généré par défaut (spec §31, 11 caractères depuis le 8 novembre, décision du
// propriétaire) : tirés uniformément dans un alphabet de 63 symboles : lettres et chiffres sans
// les ambigus ni les sosies (ni 0 O o 1 l I i j, ni les sosies S s Z z B ;
// 5, 2 et 8 n'ont donc plus de sosie), 14 caractères spéciaux courants sur un clavier de téléphone, aucun espace.
// Le mot de passe entier est recommencé tant que la contrainte n'est pas tenue (au moins une
// minuscule, une majuscule, un chiffre et EXACTEMENT TROIS caractères spéciaux, décision du
// propriétaire du 9 novembre) : chaque mot de passe valide a la même probabilité.
// 11 062 464 629 113 497 600 possibilités, soit 2^63,26 (exigence : au moins 60 bits). Environ
// 17,8 % des tirages bruts passent : un peu moins de six tirages en moyenne. Ce contrôle de forme ne sert qu'à la création ; à l'ouverture, tout mot de passe non
// vide est accepté (anciens alphabets et longueurs compris).

/** Nombre exact de caractères spéciaux (famille 4) dans un mot de passe généré (ni plus ni moins). */
export const PASSWORD_SPECIALS = 3;

/** Mot de passe produit par generatePassword (11 caractères), seul accepté à la création (D41-15). */
export type GeneratedPassword = string & { readonly __gen: unique symbol };

/** Minuscules sans i j l o s z (20), majuscules sans B I O S Z (21), chiffres 2 à 9 (8), 14 spéciaux courants. */
export const PASSWORD_FAMILIES = ["abcdefghkmnpqrtuvwxy", "ACDEFGHJKLMNPQRTUVWXY", "23456789", "!?@#$%&*+-=/()"] as const;
export const PASSWORD_ALPHABET = PASSWORD_FAMILIES.join("");
export const PASSWORD_LEN = 11;

/**
 * Vrai si `pw` a la forme d'un mot de passe généré : exactement 11 caractères de l'alphabet,
 * les quatre familles présentes dont exactement 3 spéciaux (D41-15 : le mot de passe d'un partage est toujours généré,
 * plus aucune saisie). La forme ne prouve pas le tirage ; elle refuse toute autre chaîne qui
 * arriverait jusqu'à la création (erreur de programmation), sans liste ni copie gardée.
 */
export function isGeneratedPassword(pw: string): pw is GeneratedPassword {
  const chars = [...pw];
  return (
    chars.length === PASSWORD_LEN && chars.every((c) => PASSWORD_ALPHABET.includes(c)) && PASSWORD_FAMILIES.every((f) => chars.some((c) => f.includes(c))) &&
    chars.filter((c) => PASSWORD_FAMILIES[3].includes(c)).length === PASSWORD_SPECIALS
  );
}

export function generatePassword(): GeneratedPassword {
  const n = PASSWORD_ALPHABET.length;
  if (n !== 63) throw new Error("alphabet invalide");
  // Tirage par rejet : un octet uniforme n'est gardé que sous 252 = 4 × 63 ; octet % 63 est
  // alors uniforme (aucun biais de modulo). Les octets ≥ 252 sont jetés.
  const limit = 256 - (256 % n);
  const buf = new Uint8Array(PASSWORD_LEN * 2);
  for (;;) {
    let pw = "";
    while (pw.length < PASSWORD_LEN) {
      crypto.getRandomValues(buf);
      for (const b of buf) if (b < limit && pw.length < PASSWORD_LEN) pw += PASSWORD_ALPHABET[b % n]!;
    }
    buf.fill(0);
    if (isGeneratedPassword(pw)) return pw;
  }
}

// --- Liens (spec §32) : forme, origine, mot de passe du QR code ------------------------------

/** Secret de 32 octets en base64url sans bourrage : 43 caractères. */
export const KEY_CHARS = 43;

/**
 * Forme du fragment, sans le décoder (routeur) : « # » + 43 caractères base64url pour un
 * partage, « #m » + 43 pour la gestion. Les longueurs diffèrent (44 et 45) : aucune ambiguïté.
 */
export const SHARE_FRAGMENT = /^#[A-Za-z0-9_-]{43}$/;
export const MANAGE_FRAGMENT = /^#m[A-Za-z0-9_-]{43}$/;

/**
 * Forme d'un lien de partage de production (benchmark M13, réutilisée par les tests de
 * pages) : `https://hôte/#` + 43 caractères, rien d'autre (ni chemin, ni requête, ni mot de passe).
 */
export const SHARE_LINK_SHAPE = /^https:\/\/[a-z0-9.-]+(?::\d+)?\/#[A-Za-z0-9_-]{43}$/;

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

// https: obligatoire, sauf http: vers la boucle locale (développement et tests).
const allowedScheme = (u: URL) => u.protocol === "https:" || (u.protocol === "http:" && LOCAL.has(u.hostname));

/**
 * Vérifie une origine (audit F1) : forme canonique exacte `https://hôte[:port]` (http
 * seulement pour localhost, 127.0.0.1, [::1]), sans chemin, requête, fragment ni
 * identifiants. Rend l'origine, ou lève Error("origine_invalide").
 */
export function checkOrigin(origin: string): string {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    throw new Error("origine_invalide");
  }
  if (u.origin !== origin || !allowedScheme(u)) throw new Error("origine_invalide");
  return origin;
}

// Base de dépôt : « / » en production, « /shhdrop/ » pour la démo GitHub Pages.
const BASE = /^\/(?:[A-Za-z0-9_-]+\/)*$/;

function checkBase(base: string): string {
  if (!BASE.test(base)) throw new Error("base_invalide");
  return base;
}

function invalid(): Error {
  return new Error("lien_invalide");
}

/** Forme d'un lien, sans décoder sa clé : la chaîne de 43 caractères telle quelle. */
export type LinkForm = { kind: "s" | "m"; origin: string; key: string };

// Encodage canonique de 32 octets en 43 caractères : les 2 bits de bourrage du dernier caractère
// sont nuls (unb64u refuse sinon), soit un dernier caractère d'indice multiple de 4.
const canonical = (key: string) => ALPHABET.indexOf(key[key.length - 1]!) % 4 === 0;

/**
 * Vérifie la forme d'un lien comme parseLink (moteur), sans décoder la clé (décision B3 du
 * contrôleur, Task 11) : schéma, identifiants, chemin égal à `base` (« /shhdrop » sans barre
 * finale toléré pour la démo), requête ignorée, fragment « # » + 43 ou « #m » + 43 caractères
 * base64url d'encodage canonique. Rend l'origine normalisée et la clé en texte ; sinon
 * Error("lien_invalide") (Error("base_invalide") pour une base mal formée). La clé n'est lue en
 * octets que par le moteur (engine/index.ts : parseLink), au moment de l'utiliser.
 */
export function linkForm(url: string, base = "/"): LinkForm {
  checkBase(base);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw invalid();
  }
  if (!allowedScheme(u) || u.username !== "" || u.password !== "") throw invalid();
  if (u.pathname !== base && u.pathname + "/" !== base) throw invalid();
  // Le genre vient de la forme entière (longueur), jamais du seul « m » de tête : une clé de
  // partage commence par « m » une fois sur 64 (« #m » + 42 caractères = partage).
  const kind = SHARE_FRAGMENT.test(u.hash) ? "s" : MANAGE_FRAGMENT.test(u.hash) ? "m" : null;
  const key = kind === "s" ? u.hash.slice(1) : kind === "m" ? u.hash.slice(2) : null;
  if (kind === null || key === null || key.length !== KEY_CHARS || !canonical(key)) throw invalid();
  return { kind, origin: u.origin, key };
}

/**
 * Fragment « lien + mot de passe » du QR code (D41-29) : « # » + K_lien (43) + « . » +
 * base64url de l'UTF-8 du mot de passe. Le « . » n'est pas dans l'alphabet base64url :
 * aucune ambiguïté avec un lien simple. Le routeur l'envoie à l'ouverture ; le client lit le
 * mot de passe, puis retire tout le fragment de l'adresse (comme pour un lien simple).
 */
export const SHARE_PW_FRAGMENT = /^#[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{2,64}$/;

/** Lien de partage suivi du mot de passe (QR code, D41-29). Lève si `link` n'est pas un lien de partage. */
export function shareLinkWithPassword(link: string, password: string): string {
  const u = new URL(link);
  if (!SHARE_FRAGMENT.test(u.hash) || password === "") throw invalid();
  const pw = b64u(new TextEncoder().encode(password));
  if (pw.length > 64) throw invalid();
  return `${link}.${pw}`;
}

/**
 * Sépare le mot de passe d'un lien de QR code (D41-29). Toujours sans lever : un fragment
 * « #<K_lien>.<…> » rend le lien simple et le mot de passe s'il est un base64url canonique
 * d'UTF-8 valide (sinon null : écran de saisie normal) ; tout autre lien est rendu tel quel.
 */
export function splitPassword(href: string): { href: string; password: string | null } {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return { href, password: null };
  }
  const m = /^#([A-Za-z0-9_-]{43})\.(.*)$/s.exec(u.hash);
  if (m === null) return { href, password: null };
  u.hash = "#" + m[1]!;
  let password: string | null = null;
  try {
    if (/^[A-Za-z0-9_-]{2,64}$/.test(m[2]!)) password = new TextDecoder("utf-8", { fatal: true }).decode(unb64u(m[2]!));
  } catch {
    password = null;
  }
  return { href: u.href, password: password === "" ? null : password };
}
