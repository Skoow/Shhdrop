// Vecteurs de test communs (spec du moteur Rust §9), produits par l'ancien moteur TypeScript
// (web/src/crypto, web/src/transfer/link.ts) avant sa suppression. Format : engine/vectors/README.md.
//
// L'aléa est remplacé par une suite connue : pour chaque cas, un flux SHA-256 en mode compteur,
// bloc i = SHA-256(UTF-8(« shhdrop/vecteurs/v2/ » + étiquette du cas) ‖ i sur 4 octets
// gros-boutistes), i = 0, 1, … ; chaque appel à crypto.getRandomValues prend les octets suivants.
// Chaque cas note aussi, dans l'ordre, les octets que chaque appel a reçus (`random`) : un test
// Rust les rejoue sans rien recalculer de ce flux.
//
// Lancement (aucun exécuteur TypeScript hors vitest dans le dépôt) :
//   cd web && GEN_VECTORS=1 npx vitest run src/engine/vectors.test.ts
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import * as C from "../src/crypto/container";
import * as El from "../src/crypto/elements";
import { b64u, unb64u, utf8 } from "../src/crypto/encoding";
import * as Env from "../src/crypto/envelope";
import * as K from "../src/crypto/kdf";
import * as Pw from "../src/crypto/password";
import type { KLien, KMdp, SGestion } from "../src/crypto/types";
import * as L from "../src/transfer/link";

export const VECTORS_URL = new URL("../../engine/vectors/v2.json", import.meta.url);

type Bytes = Uint8Array<ArrayBuffer>;
type Json = unknown;

// --- outils -----------------------------------------------------------------------------

const hex = (b: Uint8Array): string => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("hex");

function unhex(s: string): Bytes {
  if (s.length % 2 !== 0 || !/^[0-9a-f]*$/.test(s)) throw new Error(`hex invalide : ${s}`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}

const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** Octets fixes 0, 1, 2, … (mod 256) à partir de `start`. */
function seq(n: number, start = 0): Bytes {
  return Uint8Array.from({ length: n }, (_, i) => (start + i) & 0xff);
}

/** 32 octets fixés par une étiquette : SHA-256(UTF-8(« shhdrop/vecteurs/v2/fixe/ » + étiquette)). */
function fixed(label: string, n = 32): Bytes {
  const d = createHash("sha256").update(`shhdrop/vecteurs/v2/fixe/${label}`).digest();
  return new Uint8Array(d.subarray(0, n));
}

/**
 * Clair pseudo-aléatoire des gros fichiers : xorshift32 (x ^= x << 13 ; x ^= x >>> 17 ;
 * x ^= x << 5, sur 32 bits), état de départ `seed` ; chaque nouvel état donne 4 octets
 * petit-boutistes, le dernier groupe est tronqué à `len`.
 */
export function xorshift32(seed: number, len: number): Bytes {
  const out = new Uint8Array(len);
  let x = seed >>> 0;
  for (let i = 0; i < len; i += 4) {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    for (let j = 0; j < 4 && i + j < len; j++) out[i + j] = (x >>> (8 * j)) & 0xff;
  }
  return out;
}

/** Flux SHA-256 en mode compteur (voir l'en-tête du fichier). */
class Stream {
  private block: Uint8Array = new Uint8Array(0);
  private pos = 0;
  private ctr = 0;
  constructor(private readonly label: string) {}
  take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let o = 0; o < n; ) {
      if (this.pos === this.block.length) {
        const c = Buffer.alloc(4);
        c.writeUInt32BE(this.ctr++);
        this.block = createHash("sha256").update(`shhdrop/vecteurs/v2/${this.label}`).update(c).digest();
        this.pos = 0;
      }
      const m = Math.min(n - o, this.block.length - this.pos);
      out.set(this.block.subarray(this.pos, this.pos + m), o);
      o += m;
      this.pos += m;
    }
    return out;
  }
}

/** Exécute `f` avec crypto.getRandomValues remplacé par le flux `label` ; rend les octets tirés, appel par appel. */
async function withRng<T>(label: string, f: () => Promise<T> | T): Promise<{ value: T; random: string[] }> {
  const s = new Stream(label);
  const random: string[] = [];
  const c = globalThis.crypto as unknown as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(c, "getRandomValues")) throw new Error("getRandomValues déjà remplacé");
  Object.defineProperty(c, "getRandomValues", {
    configurable: true,
    writable: true,
    value: (a: ArrayBufferView) => {
      if (!(a instanceof Uint8Array)) throw new Error("vecteurs : Uint8Array attendu");
      const b = s.take(a.length);
      a.set(b);
      random.push(hex(b));
      return a;
    },
  });
  try {
    return { value: await f(), random };
  } finally {
    delete c.getRandomValues;
  }
}

/** Résultat d'un appel, ou { error: message } s'il lève. */
async function outcome<T>(f: () => Promise<T> | T, ok: (v: T) => Json): Promise<Json> {
  let v: T;
  try {
    v = await f();
  } catch (e) {
    return { error: (e as Error).message };
  }
  return ok(v);
}

function check(cond: boolean, what: string): void {
  if (!cond) throw new Error(`vecteurs incohérents : ${what}`);
}

async function aesRaw(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function gcm(key: CryptoKey, iv: Bytes, ad: Bytes, plain: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: ad, tagLength: 128 }, key, plain));
}

async function ungcm(key: CryptoKey, iv: Bytes, ad: Bytes, ct: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: ad, tagLength: 128 }, key, ct));
}

/** Manifeste JSON lu dans le morceau du manifeste (tail) : clair = … ‖ manifeste ‖ longueur (4 octets, gros-boutiste). */
async function manifestOf(r: Bytes, bucket: number, hdr: Bytes, tail: Bytes): Promise<string> {
  const kc = await aesRaw(await K.hkdf(r, "shhdrop/v2/contenu"));
  const plain = await ungcm(kc, C.nonce(bucket - 1, true), hdr, tail);
  const len = new DataView(plain.buffer).getUint32(C.CHUNK - 4);
  check(plain.subarray(0, C.CHUNK - 4 - len).every((x) => x === 0), "zéros avant le manifeste");
  return new TextDecoder("utf-8", { fatal: true }).decode(plain.subarray(C.CHUNK - 4 - len, C.CHUNK - 4));
}

// --- sections ---------------------------------------------------------------------------

function constants(): Json {
  return {
    CHUNK: C.CHUNK,
    TAG: C.TAG,
    CHUNK_CT: C.CHUNK_CT,
    HEADER: C.HEADER,
    SEG_CHUNKS: C.SEG_CHUNKS,
    SEG_PLAIN: El.SEG_PLAIN,
    BUCKETS: [...C.BUCKETS],
    MANIFEST_MAX: C.MANIFEST_MAX,
    MAX_ITEMS: C.MAX_ITEMS,
    TEXT_MAX: C.TEXT_MAX,
    TEXT_BYTES_MAX: C.TEXT_BYTES_MAX,
    PREVIEW_MAX: C.PREVIEW_MAX,
    CONTENT_MAX: C.CONTENT_MAX,
    DATA_SEGMENTS: El.DATA_SEGMENTS,
    DATA_CHUNKS: El.DATA_CHUNKS,
    SEED_LEN: Env.SEED_LEN,
    ID_LEN: Env.ID_LEN,
    ENVELOPE_LEN: Env.ENVELOPE_LEN,
    KDF_MIN: { ...K.KDF_MIN },
    KDF_MAX: { ...K.KDF_MAX },
    KDF_CREATE: { ...K.KDF_CREATE },
    PASSWORD_LEN: Pw.PASSWORD_LEN,
    PASSWORD_SPECIALS: Pw.PASSWORD_SPECIALS,
    PASSWORD_FAMILIES: [...Pw.PASSWORD_FAMILIES],
    PASSWORD_ALPHABET: Pw.PASSWORD_ALPHABET,
    KEY_CHARS: L.KEY_CHARS,
    ELEMENT_AD: hex(C.ELEMENT_AD),
    ENVELOPE_AD: hex(utf8("shhdrop/v2/enveloppe-ad")),
  };
}

const LABELS = [
  "shhdrop/v2/acces",
  "shhdrop/v2/id",
  "shhdrop/v2/contenu",
  "shhdrop/v2/maitre",
  "shhdrop/v2/enveloppe",
  "shhdrop/v2/preuve",
  "shhdrop/v2/element",
];

async function hkdfCases(): Promise<Json[]> {
  const out: Json[] = [];
  const add = async (name: string, ikm: Bytes, info: string, len: number) =>
    out.push({ name, ikm: hex(ikm), info, len, okm: hex(await K.hkdf(ikm, info, len)) });
  for (const info of LABELS) await add(info, seq(32), info, info === "shhdrop/v2/id" ? Env.ID_LEN : 32);
  await add("maitre sur 64 octets (K_lien ‖ K_mdp)", seq(64, 0x40), "shhdrop/v2/maitre", 32);
  await add("id sur 32 octets (longueur demandée différente)", seq(32), "shhdrop/v2/id", 32);
  // RFC 5869, annexe A.3 (sel vide, info vide) : le moteur suit bien la norme.
  await add("RFC 5869 A.3", new Uint8Array(22).fill(0x0b), "", 42);
  const rfc = out[out.length - 1] as { okm: string };
  check(rfc.okm === "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8", "RFC 5869 A.3");
  return out;
}

async function sha256Cases(): Promise<Json[]> {
  const out: Json[] = [];
  for (const b of [new Uint8Array(0), utf8("abc"), seq(32), seq(1000)]) out.push({ input: hex(b), digest: hex(await K.sha256(b)) });
  check((out[1] as { digest: string }).digest === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "SHA-256(abc)");
  return out;
}

const GEN_PW = "aC3!cD5?#Fg";
const SALT = seq(16, 0x10);

async function argon2Cases(): Promise<Json[]> {
  const out: Json[] = [];
  const P = K.KDF_CREATE;
  const add = async (name: string, fn: "passwordKey" | "passwordKeyForCreate", password: string, salt: Bytes, params: { ops: number; mem: number }) =>
    out.push({
      name,
      fn,
      password,
      password_utf8: hex(utf8(password)),
      salt: hex(salt),
      ops: params.ops,
      mem: params.mem,
      ...((await outcome(
        () => (fn === "passwordKey" ? K.passwordKey(password, salt, params) : K.passwordKeyForCreate(password, salt)),
        (k) => ({ key: hex(k) }),
      )) as object),
    });
  await add("mot de passe généré", "passwordKeyForCreate", GEN_PW, SALT, P);
  // NFC : « é » composé (U+00E9) et décomposé (e + U+0301) donnent la même clé.
  await add("NFC, forme composée", "passwordKey", "Café-Ω été", SALT, P);
  await add("NFC, forme décomposée", "passwordKey", "Cafe\u0301-\u2126 e\u0301te\u0301", SALT, P);
  const nfc = out.slice(1) as { key: string }[];
  check(nfc[0]!.key === nfc[1]!.key, "NFC");
  // Refus (aucun calcul Argon2id).
  await add("mot de passe vide", "passwordKey", "", SALT, P);
  await add("sel de 15 octets", "passwordKey", GEN_PW, seq(15), P);
  await add("sel de 17 octets", "passwordKey", GEN_PW, seq(17), P);
  await add("passes en dessous", "passwordKey", GEN_PW, SALT, { ops: 2, mem: P.mem });
  await add("mémoire en dessous", "passwordKey", GEN_PW, SALT, { ops: 3, mem: P.mem / 2 });
  await add("passes au-dessus", "passwordKey", GEN_PW, SALT, { ops: 4, mem: P.mem });
  await add("mémoire au-dessus", "passwordKey", GEN_PW, SALT, { ops: 3, mem: P.mem * 2 });
  await add("passes non entières", "passwordKey", GEN_PW, SALT, { ops: 2.5, mem: P.mem });
  await add("création : mot de passe non généré", "passwordKeyForCreate", "motdepasse", SALT, P);
  await add("création : 10 caractères", "passwordKeyForCreate", GEN_PW.slice(0, 10), SALT, P);
  return out;
}

async function accessCases(): Promise<Json[]> {
  const out: Json[] = [];
  for (const [name, kLien, kMdp] of [
    ["séquence", seq(32), seq(32, 0x80)],
    ["fixe", fixed("access/k_lien"), fixed("access/k_mdp")],
  ] as const) {
    const da = await K.deriveAccess(kLien as KLien);
    const ak = await Env.accessKeys(kLien as KLien, kMdp as KMdp);
    const kMaitre = await K.hkdf(new Uint8Array([...kLien, ...kMdp]), "shhdrop/v2/maitre");
    const kEnv = await K.hkdf(kMaitre, "shhdrop/v2/enveloppe");
    check(hex(ak.kPreuve) === hex(await K.hkdf(kMaitre, "shhdrop/v2/preuve")), "K_preuve");
    // K_env n'est pas extractible : on vérifie que la clé tirée par HKDF chiffre comme elle.
    const iv = new Uint8Array(12), probe = new Uint8Array(32);
    check(hex(await gcm(ak.kEnv, iv, new Uint8Array(0), probe)) === hex(await gcm(await aesRaw(kEnv), iv, new Uint8Array(0), probe)), "K_env");
    out.push({
      name,
      k_lien: hex(kLien),
      k_mdp: hex(kMdp),
      k_acces: hex(da.kAcces),
      v_acces: hex(da.vAcces),
      id: hex(await Env.shareId(kLien as KLien)),
      k_maitre: hex(kMaitre),
      k_env: hex(kEnv),
      k_preuve: hex(ak.kPreuve),
      v_preuve: hex(ak.vPreuve),
    });
  }
  // Refus de taille : les entrées (k_lien, k_mdp quand la fonction le prend) sont écrites dans le
  // cas, pour être rejouées sans connaître le générateur.
  const bad = async (name: string, fn: string, kLien: Bytes, kMdp: Bytes | null, f: () => Promise<unknown>) =>
    out.push({ name, fn, k_lien: hex(kLien), ...(kMdp ? { k_mdp: hex(kMdp) } : {}), ...((await outcome(f, () => ({}))) as object) });
  await bad("deriveAccess : K_lien de 31 octets", "deriveAccess", seq(31), null, () => K.deriveAccess(seq(31) as KLien));
  await bad("shareId : K_lien de 33 octets", "shareId", seq(33), null, () => Env.shareId(seq(33) as KLien));
  await bad("accessKeys : K_lien de 31 octets", "accessKeys", seq(31), seq(32), () => Env.accessKeys(seq(31) as KLien, seq(32) as KMdp));
  await bad("accessKeys : K_mdp de 31 octets", "accessKeys", seq(32), seq(31), () => Env.accessKeys(seq(32) as KLien, seq(31) as KMdp));
  return out;
}

/** Sonde de K_contenu (non extractible) : AES-GCM(K_contenu, nonce(0, non dernier), en-tête, 16 octets 0..15). */
async function contentProbe(k: CryptoKey, engagement: Bytes): Promise<string> {
  return hex(await gcm(k, C.nonce(0, false), C.header(engagement), seq(16)));
}

async function contentCases(): Promise<Json[]> {
  const out: Json[] = [];
  for (const [name, r] of [["séquence", seq(32)], ["fixe", fixed("content/r")]] as const) {
    const ck = await Env.contentKeys(r as Env.Seed);
    const kContenu = await K.hkdf(r, "shhdrop/v2/contenu");
    const probe = await contentProbe(ck.kContenu, ck.engagement);
    check(probe === (await contentProbe(await aesRaw(kContenu), ck.engagement)), "K_contenu");
    const checked = await Env.contentKeysChecked(r as Env.Seed, ck.engagement);
    check(probe === (await contentProbe(checked.kContenu, checked.engagement)), "contentKeysChecked");
    out.push({ name, r: hex(r), k_contenu: hex(kContenu), engagement: hex(ck.engagement), probe_plain: hex(seq(16)), probe });
  }
  const r = seq(32) as Env.Seed;
  const eng = (await Env.contentKeys(r)).engagement;
  const flipped = new Uint8Array(eng);
  flipped[31]! ^= 1;
  const bad = async (name: string, rr: Bytes, e: Bytes, f: () => Promise<unknown>) =>
    out.push({ name, fn: "contentKeysChecked", r: hex(rr), engagement: hex(e), ...((await outcome(f, () => ({}))) as object) });
  await bad("engagement modifié", r, flipped, () => Env.contentKeysChecked(r, flipped));
  await bad("engagement de 31 octets", r, eng.slice(0, 31), () => Env.contentKeysChecked(r, eng.slice(0, 31)));
  await bad("graine de 31 octets", seq(31), eng, () => Env.contentKeysChecked(seq(31) as Env.Seed, eng));
  out.push({ name: "contentKeys : graine de 33 octets", fn: "contentKeys", r: hex(seq(33)), ...((await outcome(() => Env.contentKeys(seq(33) as Env.Seed), () => ({}))) as object) });
  return out;
}

async function envelopeCases(): Promise<Json[]> {
  const out: Json[] = [];
  const kLien = fixed("envelope/k_lien") as KLien, kMdp = fixed("envelope/k_mdp") as KMdp;
  const r = fixed("envelope/r") as Env.Seed;
  const id = await Env.shareId(kLien);
  const { kEnv } = await Env.accessKeys(kLien, kMdp);
  const hdr = C.header((await Env.contentKeys(r)).engagement);
  const { value: e, random } = await withRng("envelope/seal", () => Env.seal(kEnv, r, id, hdr));
  check(hex(await Env.open(kEnv, e, id, hdr)) === hex(r), "aller-retour enveloppe");
  out.push({ name: "seal", fn: "seal", k_lien: hex(kLien), k_mdp: hex(kMdp), r: hex(r), id: hex(id), header: hex(hdr), random, e: hex(e) });
  const open = async (name: string, ee: Bytes, ii: Bytes, hh: Bytes) =>
    out.push({ name, fn: "open", k_lien: hex(kLien), k_mdp: hex(kMdp), e: hex(ee), id: hex(ii), header: hex(hh), ...((await outcome(() => Env.open(kEnv, ee, ii, hh), (v) => ({ r: hex(v) }))) as object) });
  await open("ouverture", e, id, hdr);
  const flip = (b: Bytes, i: number) => {
    const c = new Uint8Array(b);
    c[i]! ^= 1;
    return c;
  };
  await open("nonce modifié", flip(e, 0), id, hdr);
  await open("chiffré modifié", flip(e, 20), id, hdr);
  await open("tag modifié", flip(e, 59), id, hdr);
  await open("autre id", e, flip(id, 0), hdr);
  await open("autre en-tête", e, id, flip(hdr, 47));
  await open("E de 59 octets", e.slice(0, 59), id, hdr);
  await open("E de 61 octets", new Uint8Array([...e, 0]), id, hdr);
  await open("id de 15 octets", e, id.slice(0, 15), hdr);
  await open("en-tête de 47 octets", e, id, hdr.slice(0, 47));
  // Autre mot de passe : autre K_env.
  const other = await Env.accessKeys(kLien, fixed("envelope/autre_k_mdp") as KMdp);
  out.push({ name: "autre K_mdp", fn: "open", k_lien: hex(kLien), k_mdp: hex(fixed("envelope/autre_k_mdp")), e: hex(e), id: hex(id), header: hex(hdr), ...((await outcome(() => Env.open(other.kEnv, e, id, hdr), (v) => ({ r: hex(v) }))) as object) });
  return out;
}

async function headerCases(): Promise<Json[]> {
  const out: Json[] = [];
  for (const eng of [new Uint8Array(32), seq(32), new Uint8Array(32).fill(0xff)]) {
    out.push({ fn: "header", engagement: hex(eng), ...((await outcome(() => C.header(eng), (h) => ({ header: hex(h) }))) as object) });
  }
  for (const eng of [seq(31), seq(33)]) out.push({ fn: "header", engagement: hex(eng), ...((await outcome(() => C.header(eng), (h) => ({ header: hex(h) }))) as object) });
  const good = C.header(seq(32, 0xa0));
  const read = async (name: string, seg0: Bytes) =>
    out.push({ name, fn: "readHeader", seg0: hex(seg0), ...((await outcome(() => C.readHeader(seg0), (v) => ({ header: hex(v.header), engagement: hex(v.engagement) }))) as object) });
  const mod = (i: number, v: number) => {
    const c = new Uint8Array(good);
    c[i] = v;
    return c;
  };
  await read("en-tête seul", good);
  await read("en-tête suivi d'octets", new Uint8Array([...good, 1, 2, 3]));
  await read("47 octets", good.slice(0, 47));
  await read("vide", new Uint8Array(0));
  await read("magie « shh2 »", mod(0, 0x73));
  await read("version 1", mod(4, 1));
  await read("version 3", mod(4, 3));
  await read("octet réservé non nul (5)", mod(5, 1));
  await read("octet réservé non nul (15)", mod(15, 0x80));
  return out;
}

function nonceCases(): Json[] {
  const out: Json[] = [];
  for (const i of [0, 1, 63, 64, 255, 256, 65535, 65536, 32767, 32768, 2 ** 32 - 1, 2 ** 32, 2 ** 40 + 5, Number.MAX_SAFE_INTEGER]) {
    for (const last of [false, true]) out.push({ index: i, last, nonce: hex(C.nonce(i, last)) });
  }
  return out;
}

async function passwordCases(): Promise<Json> {
  const generate: Json[] = [];
  for (const label of ["password/1", "password/2", "password/3", "password/4"]) {
    const { value, random } = await withRng(label, () => Pw.generatePassword());
    check(Pw.isGeneratedPassword(value), "mot de passe généré");
    generate.push({ label, random, password: value });
  }
  const shapes = [
    GEN_PW,
    "aC3!cD5?#F", // 10
    "aC3!cD5?#Fgh", // 12
    "aC3!cD5?xFg", // 2 spéciaux
    "aC3!cD5?#F!", // 4 spéciaux
    "ac3!cd5?#fg", // sans majuscule
    "AC3!CD5?#FG", // sans minuscule
    "aCx!cDy?#Fg", // sans chiffre
    "aCxkcDyrmFg", // sans spécial
    "aO3!cD5?#Fg", // O ambigu
    "aC0!cD5?#Fg", // 0 ambigu
    "aC3!cD5?#Fé", // hors alphabet
    "aC3 cD5?#Fg", // espace
    "aC3!cD5?#F😀", // 11 points de code, hors alphabet
    "",
    "((()))aA2bB",
  ];
  // Les cas couvrent un nouveau tirage complet et le rejet des octets ≥ 252.
  const raw = generate.map((g) => (g as { random: string[] }).random);
  check(raw.some((r) => r.length > 1) && raw.some((r) => r.join("").match(/../g)!.some((x) => parseInt(x, 16) >= 252)), "couverture du tirage par rejet");
  return { generate, is_generated: shapes.map((p) => ({ password: p, ok: Pw.isGeneratedPassword(p) })) };
}

function encodingCases(): Json {
  const b64: Json[] = [];
  for (const n of [0, 1, 2, 3, 4, 5, 6, 32]) {
    const b = seq(n, 0xf8);
    b64.push({ bytes: hex(b), b64u: b64u(b) });
  }
  const unb: Json[] = [];
  for (const s of ["", "AA", "AAA", "AAAA", "-_8", "__-_", "A", "AAAAA", "AB", "AAB", "A=", "AA==", "A+", "A/", "A A", "é"]) {
    let r: Json;
    try {
      r = { bytes: hex(unb64u(s)) };
    } catch (e) {
      r = { error: (e as Error).message };
    }
    unb.push({ input: s, ...(r as object) });
  }
  return { b64u: b64, unb64u: unb };
}

async function linkCases(): Promise<Json[]> {
  const k = seq(32, 0x30), K43 = b64u(k);
  const out: Json[] = [];
  const run = async (fn: string, args: Json[], f: () => unknown) => out.push({ fn, args, ...((await outcome(f, (v) => ({ result: v }))) as object) });
  const parsed = (p: L.ParsedLink) => (p.kind === "s" ? { kind: "s", origin: p.origin, key: hex(p.kLien) } : { kind: "m", origin: p.origin, key: hex(p.sGestion) });

  for (const [o, base] of [["https://example.org", "/"], ["https://srv.test:8443", "/"], ["http://localhost:8080", "/"], ["http://[::1]:4000", "/"], ["https://skoow.github.io", "/shhdrop/"], ["http://srv.test/", "/"], ["https://srv.test/x", "/"], ["https://x.test", ""], ["https://x.test", "/shhdrop"], ["https://x.test", "/a b/"], ["https://x.test", "//"]] as const) {
    await run("shareLink", [o, hex(k), base], () => L.shareLink(o, k as KLien, base));
    await run("manageLink", [o, hex(k), base], () => L.manageLink(o, k as SGestion, base));
  }
  for (const o of ["https://srv.test", "https://srv.test:8443", "http://localhost:8080", "http://127.0.0.1:4000", "http://[::1]:4000", "http://srv.test/", "https://srv.test/", "https://srv.test/app", "https://srv.test?x=1", "https://srv.test#x", "https://u:p@srv.test", "http://srv.test", "ftp://srv.test", "srv.test", "", "HTTPS://SRV.TEST", "https://srv.test:443", "https://été.example", "https://xn--t-9fab.example", "https://srv.test.", "https://1.2.3.4", "https://[2001:db8::1]"]) {
    await run("checkOrigin", [o], () => L.checkOrigin(o));
  }
  const urls: [string, string][] = [];
  const add = (u: string, base = "/") => urls.push([u, base]);
  for (const u of [
    `https://x.test/#${K43}`,
    `https://x.test/#m${K43}`,
    `https://x.test/?fbclid=abc&utm=1#${K43}`,
    `https://srv.test:8443/#${K43}`,
    `https://X.TEST/#${K43}`,
    `https://x.test:443/#${K43}`,
    `https://été.example/#${K43}`,
    `  https://x.test/#${K43}  `,
    `https://x.test/\n#${K43}`,
    `https:\\\\x.test\\#${K43}`,
    `https://x.test#${K43}`,
    `https://x.test/%2e/#${K43}`,
    `https://x.test/./#${K43}`,
    `http://localhost/#${K43}`,
    `http://localhost:8080/#${K43}`,
    `http://127.0.0.1:4000/#${K43}`,
    `http://[::1]:4000/#${K43}`,
    `http://shhdrop.example/#${K43}`,
    `http://127.0.0.2/#${K43}`,
    `http://localhost.example/#${K43}`,
    `http://[::2]/#${K43}`,
    `ftp://x/#${K43}`,
    `file://x/#${K43}`,
    `javascript://x/#${K43}`,
    "pas une url",
    "https://x/",
    "https://x/#",
    `https://x/#${K43.slice(1)}`,
    `https://x/#${K43}A`,
    `https://x/#m${K43.slice(2)}`,
    `https://x/#m${K43}A`,
    `https://x/#${K43.slice(0, 42)}+`,
    `https://x/#${K43.slice(0, 42)}=`,
    `https://x/#${K43.slice(0, 42)}B`,
    `https://x/#${K43}=`,
    `https://x/#x${K43}`,
    `https://x/#M${K43}`,
    `https://x/x#${K43}`,
    `https://x/s#${K43}`,
    `https://x/s/AAAAAAAAAAAAAAAAAAAAAA#${K43}`,
    `https://x//#${K43}`,
    `https://x/shhdrop/#${K43}`,
    `https://user:pw@srv.test/#${K43}`,
    `https://user@srv.test/#${K43}`,
    `https://:pw@srv.test/#${K43}`,
    `https://x.test/#${K43}.YUMzIWNENT8jRmc`,
  ])
    add(u);
  for (const u of [`https://skoow.github.io/shhdrop/#${K43}`, `https://skoow.github.io/shhdrop#${K43}`, `https://x/shhdrop/#m${K43}`, `https://x/#${K43}`, `https://x/shhdropx/#${K43}`, `https://x/shhdrop/shhdrop/#${K43}`, `https://x/shhdrop/s#${K43}`]) add(u, "/shhdrop/");
  for (const b of ["", "Shhdrop/", "/shhdrop", "//", "/a b/"]) add(`https://x/#${K43}`, b);
  for (const [u, base] of urls) await run("parseLink", [u, base], () => parsed(L.parseLink(u, base)));

  const link = L.shareLink("https://shhdrop.test", new Uint8Array(32).fill(7) as KLien);
  const manage = L.manageLink("https://shhdrop.test", new Uint8Array(32).fill(7) as SGestion);
  for (const [l, pw] of [[link, GEN_PW], [link, "Café-Ω été"], [link, ""], [link, "a".repeat(48)], [link, "a".repeat(49)], [manage, GEN_PW], ["pas une url", GEN_PW], [link + "?x=1", GEN_PW]] as const) {
    await run("shareLinkWithPassword", [l, pw], () => L.shareLinkWithPassword(l, pw));
  }
  for (const h of [
    link,
    `${link}.YUMzIWNENT8jRmc`,
    `${link}?fbclid=1.YUMzIWNENT8jRmc`,
    ...[".", ".a", ".!!", ".YUMzIWNENT8jRmc=", ".gA", ".YUMzIWNENT8jRmd", "." + "a".repeat(65), ".YUMz.IWNE", ".AA", ".w4k"].map((s) => link + s),
    "pas une url",
    "https://shhdrop.test/#m" + "A".repeat(43),
    "https://shhdrop.test/#m" + "A".repeat(43) + ".YUMz",
  ]) {
    await run("splitPassword", [h], () => L.splitPassword(h));
  }
  return out;
}

function sizingCases(): Json {
  const res = (f: () => number): Json => {
    try {
      return { result: f() };
    } catch (e) {
      return { error: (e as Error).message };
    }
  };
  const CH = C.CHUNK, SP = El.SEG_PLAIN;
  const bucketIn = new Set<number>([0, 1, CH - 1, CH, CH + 1, SP - 1, SP, SP + 1, C.CONTENT_MAX, C.CONTENT_MAX + 1, Number.MAX_SAFE_INTEGER, -1, 0.5, 2 ** 53]);
  for (const b of C.BUCKETS) for (const d of [-1, 0, 1]) if ((b - 1) * CH + d >= 0) bucketIn.add((b - 1) * CH + d);
  const sizes = [0, 1, CH - 1, CH, CH + 1, SP - 1, SP, SP + 1, 2 * SP, 2 * SP + 1, 9 * 1048576, C.CONTENT_MAX, -1, 0.5];
  const segSize: Json[] = [];
  for (const b of C.BUCKETS) {
    const n = C.segmentCount(b);
    for (const i of new Set([0, 1, n - 2, n - 1].filter((x) => x >= 0 && x < n))) segSize.push({ bucket: b, n: i, result: C.segmentSize(b, i) });
  }
  const needed: number[][] = [[], [0], [1], [1, 1], [SP - 1, 1], Array(64).fill(1), Array(65).fill(1), [SP, 1], [CH + 1, CH + 1], [9 * 1048576, 100000, 10], [0, SP, 2 * SP + 1]];
  return {
    bucketFor: [...bucketIn].sort((a, b) => a - b).map((d) => ({ input: d, ...(res(() => C.bucketFor(d)) as object) })),
    segmentCount: C.BUCKETS.map((b) => ({ input: b, result: C.segmentCount(b) })),
    segmentSize: segSize,
    segmentsFor: sizes.map((s) => ({ input: s, ...(res(() => El.segmentsFor(s)) as object) })),
    chunksFor: sizes.map((s) => ({ input: s, ...(res(() => El.chunksFor(s)) as object) })),
    footprintFor: sizes.map((s) => ({ input: s, ...(res(() => El.footprintFor(s)) as object) })),
    isSmall: sizes.map((s) => ({ input: s, result: El.isSmall(s) })),
    reservationFor: [-1, 0.5, ...Array.from({ length: El.DATA_SEGMENTS + 2 }, (_, i) => i)].map((u) => ({ input: u, ...(res(() => El.reservationFor(u)) as object) })),
    segmentsNeeded: needed.map((s) => ({ input: s, result: El.segmentsNeeded(s) })),
  };
}

async function elementCases(): Promise<Json[]> {
  const out: Json[] = [];
  const CH = C.CHUNK, SP = El.SEG_PLAIN;
  for (const [size, first] of [
    [0, 0],
    [10, 0],
    [10, 63],
    [CH, 5],
    [CH + 1, 62],
    [CH + 1, 63],
    [SP - 1, 0],
    [SP - 1, 1],
    [SP, 0],
    [SP, 64],
    [SP, 32],
    [SP + 1, 128],
    [9 * 1048576, 64],
    [1, El.DATA_CHUNKS - 1],
    [1, El.DATA_CHUNKS],
    [2 * SP, El.DATA_CHUNKS - 128],
    [2 * SP + 1, El.DATA_CHUNKS - 128],
    [10, -1],
    [10, 1.5],
  ] as const) {
    const label = `element/${size}@${first}`;
    // Seule la taille compte ici (aucune plage n'est chiffrée) : pas de Blob de 4 Mio.
    const { value, random } = await withRng(label, () => outcome(() => El.elementSealer({ size } as Blob, first), (s) => ({ k: hex(s.k), pieces: s.pieces })));
    out.push({ label, size, first, random, ...(value as object) });
  }
  return out;
}

type FinalIn = { kind: "text" | "file"; name: string; mime: string; size: number; first: number; k: Bytes; clean?: C.ManifestClean };

async function manifestCases(): Promise<Json[]> {
  const out: Json[] = [];
  const ent = (i: number, e: Omit<FinalIn, "k">): FinalIn => ({ ...e, k: fixed(`manifest/k${i}`) });
  const run = async (name: string, entries: FinalIn[], opts: { rights?: C.Rights; keepTtlH?: C.KeepTtl }) => {
    const r = fixed(`manifest/r/${name}`);
    const keys = await Env.contentKeys(r as Env.Seed);
    const res = await outcome(() => El.sealFinal(entries, keys, opts), async (v) => ({
      bucket: v.bucket,
      header: hex(v.header),
      // Morceau chiffré entier seulement dans `share` (taille du fichier) : ici son empreinte.
      tail_sha256: sha(v.tail),
      manifest_json: await manifestOf(r, v.bucket, v.header, v.tail),
    }));
    out.push({
      name,
      r: hex(r),
      entries: entries.map((e) => ({ kind: e.kind, name: e.name, mime: e.mime, size: e.size, first: e.first, k: hex(e.k), ...(e.clean ? { clean: e.clean } : {}) })),
      ...(opts.rights !== undefined ? { rights: opts.rights } : {}),
      ...(opts.keepTtlH !== undefined ? { keep_ttl_h: opts.keepTtlH } : {}),
      ...((await res) as object),
    });
  };
  const note = (i: number, size: number, first: number) => ent(i, { kind: "text", name: "Note", mime: "text/plain;charset=utf-8", size, first });
  await run("note seule, droits par défaut", [note(0, 10, 0)], {});
  await run("voir", [note(0, 10, 0), ent(1, { kind: "file", name: "a.bin", mime: "application/octet-stream", size: 100000, first: 1 })], { rights: "voir" });
  await run("coffre 6 h, nettoyage, fichier vide", [
    ent(0, { kind: "file", name: "photo.jpg", mime: "image/jpeg", size: 70000, first: 0, clean: "image" }),
    ent(1, { kind: "file", name: "vide.txt", mime: "text/plain", size: 0, first: 0 }),
    ent(2, { kind: "file", name: "doc.pdf", mime: "application/pdf", size: El.SEG_PLAIN, first: 64, clean: "echec" }),
  ], { rights: "coffre", keepTtlH: 6 });
  await run("noms à échapper", [
    // Pas de demi-paire UTF-16 isolée (\ud800) : JSON.stringify l'écrit « \ud800 », qu'un &str Rust ne
    // peut pas porter ni serde_json lire ; ce cas (lu en U+FFFD) relève des tests de la Task 6 (Review Focus 1).
    ent(0, { kind: "file", name: "q\"b\\s/\t\n\b\f\r\u0001\u001f\u007f\u2028\u2029é😀x", mime: "", size: 1, first: 3, clean: "tel_quel" }),
  ], { rights: "enregistrer" });
  // Manifeste d'exactement MANIFEST_MAX octets, puis un de plus.
  const big = (n: number) => [ent(0, { kind: "file", name: "a".repeat(n), mime: "x", size: 1, first: 0 })];
  const r0 = fixed("manifest/r/mesure");
  const m0 = utf8(await (async () => {
    const v = await El.sealFinal(big(0), await Env.contentKeys(r0 as Env.Seed), {});
    return manifestOf(r0, v.bucket, v.header, v.tail);
  })()).length;
  await run("manifeste de MANIFEST_MAX octets", big(C.MANIFEST_MAX - m0), {});
  await run("manifeste de MANIFEST_MAX + 1 octets", big(C.MANIFEST_MAX - m0 + 1), {});
  await run("palier 16 : fin des données à 15 morceaux", [ent(0, { kind: "file", name: "f", mime: "", size: 15 * C.CHUNK, first: 0 })], {});
  await run("palier 80 : un octet de plus", [ent(0, { kind: "file", name: "f", mime: "", size: 15 * C.CHUNK + 1, first: 0 })], {});
  await run("plus grand palier", [ent(0, { kind: "file", name: "f", mime: "", size: El.DATA_CHUNKS * C.CHUNK, first: 0 })], {});
  await run("vide", [], {});
  await run("coffre sans durée", [note(0, 1, 0)], { rights: "coffre" });
  await run("voir avec durée", [note(0, 1, 0)], { rights: "voir", keepTtlH: 6 });
  await run("chevauchement", [note(0, 10, 0), ent(1, { kind: "file", name: "f", mime: "", size: 2 * C.CHUNK, first: 0 })], {});
  await run("hors des 2 Gio", [ent(0, { kind: "file", name: "f", mime: "", size: 1, first: El.DATA_CHUNKS })], {});
  await run("texte trop long", [note(0, C.TEXT_BYTES_MAX + 1, 0)], {});
  return out;
}

// --- partage complet --------------------------------------------------------------------

const MIB = 1048576;
const ORIGIN = "https://example.org";
/** Pièces hors du segment 0 (≈ 9 Mio) : empreinte, 64 premiers et 64 derniers octets seulement. */
const EDGE = 64;

async function shareCase(): Promise<Json> {
  const random: { step: string; bytes: string[] }[] = [];
  const draw = async <T>(step: string, f: () => Promise<T> | T): Promise<T> => {
    const { value, random: b } = await withRng(`share/${step}`, f);
    random.push({ step, bytes: b });
    return value;
  };
  // Même ordre que transfer/draft.ts : création, éléments à l'ajout, puis finalisation.
  const kLien = await draw("k_lien", () => K.newKLien());
  const sGestion = await draw("s_gestion", () => K.newSGestion());
  const acc = await K.deriveAccess(kLien);
  const noteText = "Allo été";
  const items = [
    { kind: "text" as const, name: "Note", mime: "text/plain;charset=utf-8", data: utf8(noteText), first: 0, plain: { utf8: noteText } },
    { kind: "file" as const, name: "petit fichier.bin", mime: "application/octet-stream", data: xorshift32(1, 100000), first: 1, plain: { xorshift32: { seed: 1, len: 100000 } } },
    { kind: "file" as const, name: "photo été.jpg", mime: "image/jpeg", data: xorshift32(2, 9 * MIB), first: 64, clean: "image" as const, plain: { xorshift32: { seed: 2, len: 9 * MIB } } },
  ];
  check(utf8(noteText).length === 10, "note de 10 octets");
  const sent: { p: El.Piece; data: Bytes }[] = []; // pièces, dans l'ordre d'envoi
  const outItems: Json[] = [];
  const finals: El.FinalEntry[] = [];
  for (const [i, it] of items.entries()) {
    const sealer = await draw(`k${i}`, () => El.elementSealer(new Blob([it.data]), it.first));
    const pieces: Json[] = [];
    for (const [j, p] of sealer.pieces.entries()) {
      const data = await sealer.piece(j);
      sent.push({ p, data });
      pieces.push({
        ...p,
        len: data.length,
        sha256: sha(data),
        ...(p.seg === 0 ? { b64u: b64u(data) } : { first64: hex(data.subarray(0, EDGE)), last64: hex(data.subarray(data.length - EDGE)) }),
      });
    }
    outItems.push({ kind: it.kind, name: it.name, mime: it.mime, size: it.data.length, first: it.first, ...("clean" in it ? { clean: it.clean } : {}), plain: it.plain, plain_sha256: sha(it.data), k: hex(sealer.k), pieces });
    finals.push({ kind: it.kind, name: it.name, mime: it.mime, size: it.data.length, first: it.first, k: sealer.k, ...("clean" in it ? { clean: it.clean } : {}) } as El.FinalEntry);
  }
  const password = await draw("password", () => Pw.generatePassword());
  const r = await draw("r", () => Env.newSeed());
  const salt = await draw("salt", () => K.randomBytes(16));
  const keys = await Env.contentKeys(r);
  const fin = await El.sealFinal(finals, keys, { rights: "enregistrer" });
  const kMdp = await K.passwordKeyForCreate(password, salt);
  const ak = await Env.accessKeys(kLien, kMdp);
  const id = await Env.shareId(kLien);
  const e = await draw("envelope_nonce", () => Env.seal(ak.kEnv, r, id, fin.header));
  const manifestJson = await manifestOf(r, fin.bucket, fin.header, fin.tail);

  // Fichier du serveur après finalisation : pièces reçues, en-tête au début du segment 0,
  // morceau du manifeste en dernier ; tout le reste (jamais lu) est mis à zéro ici.
  const segments: Bytes[] = [];
  for (let n = 0; n < C.segmentCount(fin.bucket); n++) segments.push(new Uint8Array(C.segmentSize(fin.bucket, n)));
  // Une pièce qui commence au morceau 0 porte déjà ses 48 octets d'en-tête (nuls).
  for (const { p, data } of sent) segments[p.seg]!.set(data, p.seg === 0 && p.from === 0 ? 0 : (p.seg === 0 ? C.HEADER : 0) + p.from * C.CHUNK_CT);
  segments[0]!.set(fin.header, 0);
  const lastSeg = segments[segments.length - 1]!;
  lastSeg.set(fin.tail, lastSeg.length - C.CHUNK_CT);

  // Ouverture comme transfer/client.ts : en-tête, Argon2id, enveloppe, engagement, lecture.
  const link = L.shareLink(ORIGIN, kLien);
  const parsed = L.parseLink(link);
  if (parsed.kind !== "s") throw new Error("lien de partage attendu");
  const { header, engagement } = C.readHeader(segments[0]!);
  const kMdp2 = await K.passwordKey(password, salt, K.KDF_CREATE);
  const ak2 = await Env.accessKeys(parsed.kLien, kMdp2);
  const r2 = await Env.open(ak2.kEnv, e, id, header);
  // Copie : le lecteur met à zéro le segment qu'il quitte (wipe).
  const reader = await C.openStream(async (n) => segments[n]!.slice(), fin.bucket, await Env.contentKeysChecked(r2, engagement));
  const opened: Json[] = [];
  for (const [i, it] of items.entries()) {
    const got = await reader.item(i);
    check(hex(got) === hex(it.data), `élément ${i} rouvert`);
    opened.push({ sha256: sha(got), len: got.length });
  }

  return {
    origin: ORIGIN,
    random,
    k_lien: hex(kLien),
    s_gestion: hex(sGestion),
    k_acces: hex(acc.kAcces),
    v_acces: hex(acc.vAcces),
    link,
    manage_link: L.manageLink(ORIGIN, sGestion),
    link_with_password: L.shareLinkWithPassword(link, password),
    password,
    salt: hex(salt),
    kdf_ops: K.KDF_CREATE.ops,
    kdf_mem: K.KDF_CREATE.mem,
    k_mdp: hex(kMdp),
    id: hex(id),
    k_preuve: hex(ak.kPreuve),
    v_preuve: hex(ak.vPreuve),
    r: hex(r),
    k_contenu: hex(await K.hkdf(r, "shhdrop/v2/contenu")),
    engagement: hex(keys.engagement),
    rights: "enregistrer",
    items: outItems,
    bucket: fin.bucket,
    header: hex(fin.header),
    tail: b64u(fin.tail),
    tail_sha256: sha(fin.tail),
    manifest_json: manifestJson,
    envelope: hex(e),
    segments: segments.map((s, n) => ({ n, size: s.length, sha256_zero_filled: sha(s) })),
    opened: { manifest: reader.manifest as Json, items: opened },
    // Corps de finalisation : le serveur reçoit ces octets en base64url sous le nom sans « _hex »
    // (tail : voir `tail` ci-dessus). Écrits ici en hex : le base64url de 48 octets (64 caractères,
    // 10 « A » après le 11e) a la forme d'un jeton Dropbox pour les détecteurs de secrets (push refusé).
    finalize_body: {
      salt_hex: hex(salt),
      kdf_ops: K.KDF_CREATE.ops,
      kdf_mem: K.KDF_CREATE.mem,
      proof_v_hex: hex(ak.vPreuve),
      envelope_hex: hex(e),
      bucket: fin.bucket,
      header_hex: hex(fin.header),
      tail_sha256: sha(fin.tail),
    },
  };
}

// --- assemblage -------------------------------------------------------------------------

export async function buildVectors(): Promise<Record<string, Json>> {
  // Argon2id d'abord : libsodium est initialisé avant tout remplacement de l'aléa.
  const argon2id = await argon2Cases();
  return {
    format: "shhdrop/vecteurs/v2",
    constants: constants(),
    hkdf: await hkdfCases(),
    sha256: await sha256Cases(),
    argon2id,
    access: await accessCases(),
    content: await contentCases(),
    envelope: await envelopeCases(),
    header: await headerCases(),
    nonce: nonceCases(),
    password: await passwordCases(),
    encoding: encodingCases(),
    link: await linkCases(),
    sizing: sizingCases(),
    element: await elementCases(),
    manifest: await manifestCases(),
    share: await shareCase(),
  };
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]));
  }
  return v;
}

/** JSON à clés triées, indentation de 2 espaces, LF final. */
export function serialize(v: unknown): string {
  return JSON.stringify(sortKeys(v), null, 2) + "\n";
}

/**
 * Chaînes bornées en forme de jeton Dropbox (motif des détecteurs de secrets de GitHub) : le
 * push serait refusé. Les champs d'octets courts sont en hex (README, « Règle anti-détecteur »).
 */
export function tokenShapes(text: string): string[] {
  return text.match(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{11}A{10}[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g) ?? [];
}

export async function writeVectors(): Promise<void> {
  const text = serialize(await buildVectors());
  check(tokenShapes(text).length === 0, "chaîne en forme de jeton dans v2.json");
  writeFileSync(VECTORS_URL, text);
}
