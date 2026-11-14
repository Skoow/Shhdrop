// Vecteurs du compte v2 chiffrés par WebCrypto (conception compte v2 §6, §21.2.2) : sections
// `enveloppes`, `coffre_prive` et `coffre_profil` de engine/vectors/compte.json, avec des nonces
// fixés. Les autres sections (dérivations, clés, adresse, pseudo) sont écrites par le moteur Rust
// (engine/core/tests/compte.rs) ; ce script prend ses entrées dans ces sections (KEK_mdp de
// `deriver`, K_compte et s_profil de `cles`), puis réécrit le fichier sous forme canonique (clés
// triées, 2 espaces, LF final, comme serde_json). Le moteur Rust refait les mêmes chiffrés avec
// l'AES-256-GCM de RustCrypto (celui des apps), web/src/engine/compte.test.ts les ouvre avec
// WebCrypto.
//   SHH_GEN_COMPTE=1 cargo test -p shhdrop-core --test compte   (dans engine/, d'abord)
//   node scripts/gen-compte-vectors.mjs                         (dans web/, ensuite)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../../engine/vectors/compte.json", import.meta.url);
const PALIERS = [4096, 16384, 65536, 262144];

const hex = (b) => Buffer.from(b).toString("hex");
const unhex = (s) => new Uint8Array(Buffer.from(s, "hex"));
const utf8 = (s) => new TextEncoder().encode(s);
const cat = (...parts) => new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));
/** Octets déterministes : SHA-256(UTF-8(« shhdrop/vecteurs/compte/ » + étiquette)), tronqués. */
const derive = (label, n) => new Uint8Array(createHash("sha256").update(`shhdrop/vecteurs/compte/${label}`).digest()).slice(0, n);
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
/** Entier sur 8 octets gros-boutistes. */
const be64 = (n) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n));
  return b;
};

/** nonce ‖ AES-256-GCM(clé, nonce, clair, ad) (chiffré ‖ tag), par WebCrypto. */
async function seal(key, nonce, ad, plain) {
  const k = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: ad, tagLength: 128 }, k, plain));
  return cat(nonce, ct);
}

function sorted(v) {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]));
  return v;
}

const V = JSON.parse(readFileSync(FILE, "utf8"));
const byLabel = (section, label) => {
  const c = V[section].find((x) => x.label === label);
  if (!c) throw new Error(`${section}.${label} absent : lancer d'abord le moteur Rust`);
  return c;
};

// Enveloppe du mot de passe : nonce (12) ‖ AES-256-GCM(KEK_mdp, nonce, K_compte,
// AD = « SHH-CENV1 » ‖ h ‖ « mdp ») = 60 octets.
const enveloppes = [];
for (const [label, deriver, cles] of [
  ["a", "simple", "a"],
  ["b", "autre_adresse", "b"],
]) {
  const kek = unhex(byLabel("deriver", deriver).kek_mdp);
  const kCompte = unhex(byLabel("cles", cles).k_compte);
  const h = derive(`h/${label}`, 16);
  const nonce = derive(`nonce/enveloppe/${label}`, 12);
  const ad = cat(utf8("SHH-CENV1"), h, utf8("mdp"));
  const env = await seal(kek, nonce, ad, kCompte);
  if (env.length !== 60) throw new Error("enveloppe de 60 octets");
  enveloppes.push({ label, deriver, kek_mdp: hex(kek), k_compte: hex(kCompte), h: hex(h), nonce: hex(nonce), ad: hex(ad), env_mdp: hex(env) });
}

/** Plus petit palier qui contient longueur (4) ‖ JSON. */
const palierPour = (n) => {
  const p = PALIERS.find((x) => 4 + n <= x);
  if (p === undefined) throw new Error("JSON trop long pour le coffre");
  return p;
};

// Coffre : magie (9) ‖ gen (8, gros-boutiste) ‖ nonce (12) ‖ AES-256-GCM(clé, nonce, clair,
// AD = magie ‖ h ‖ gen) ; clair = longueur du JSON (4, gros-boutiste) ‖ JSON ‖ zéros jusqu'au palier.
async function coffre(magie, champ, cleField, cases) {
  const out = [];
  for (const { label, cles, gen, json, entier } of cases) {
    const c = byLabel("cles", cles);
    const key = unhex(c[cleField]);
    const h = derive(`h/${cles}`, 16);
    const nonce = derive(`nonce/${magie}/${label}`, 12);
    const g = be64(gen);
    const ad = cat(utf8(magie), h, g);
    const j = utf8(json);
    const palier = palierPour(j.length);
    const clair = new Uint8Array(palier);
    new DataView(clair.buffer).setUint32(0, j.length);
    clair.set(j, 4);
    const blob = cat(utf8(magie), g, await seal(key, nonce, ad, clair));
    const v = { label, [champ]: c[champ], cle: hex(key), h: hex(h), gen, nonce: hex(nonce), ad: hex(ad), json_hex: hex(j), palier, blob_len: blob.length, blob_sha256: sha256(blob) };
    if (entier) v.blob = hex(blob);
    out.push(v);
  }
  return out;
}

/** JSON de `n` octets exactement (remplissage dans un champ `x`). */
const remplir = (base, n) => {
  const vide = JSON.stringify({ ...base, x: "" });
  if (vide.length > n) throw new Error("base trop longue");
  return JSON.stringify({ ...base, x: "a".repeat(n - vide.length) });
};

const coffre_prive = await coffre("SHH-ACCT1", "k_compte", "k_prive", [
  { label: "petit", cles: "a", gen: 1, json: JSON.stringify({ v: 1, salons: [], recus: [], rejoints: [], envois: [] }), entier: true },
  { label: "plein_4_kio", cles: "a", gen: 2, json: remplir({ v: 1 }, 4092) },
  { label: "palier_16_kio", cles: "b", gen: 2 ** 40, json: remplir({ v: 1 }, 4093) },
]);
const coffre_profil = await coffre("SHH-PROF1", "s_profil", "k_profil", [
  { label: "petit", cles: "a", gen: 1, json: JSON.stringify({ v: 1, pseudo: "Léa", langue: "fr" }), entier: true },
  { label: "palier_64_kio", cles: "b", gen: 7, json: remplir({ v: 1, pseudo: "Лея" }, 16381) },
]);

V.enveloppes = enveloppes;
V.coffre_prive = coffre_prive;
V.coffre_profil = coffre_profil;
writeFileSync(FILE, JSON.stringify(sorted(V), null, 2) + "\n");
console.log(`compte.json : ${enveloppes.length} enveloppes, ${coffre_prive.length} + ${coffre_profil.length} coffres`);
