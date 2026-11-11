//! Liaison WebAssembly du moteur pour le site (spec §5 à §7). Fonctions et classes exportées par
//! `wasm-bindgen` ; la couche TypeScript (`web/src/engine/`) les appelle avec un fournisseur
//! WebCrypto (`web/src/engine/provider.ts`) qui fait l'AES-GCM et l'aléa.
//!
//! Règles aux frontières :
//! - Un secret venu de JavaScript (clé, mot de passe, lien, clair) arrive comme `Uint8Array`
//!   et est recopié dans un tampon `Zeroizing`, mis à zéro après usage. Les paramètres `&[u8]`,
//!   `&str` et `String` de `wasm-bindgen` laissent leur copie dans la mémoire libérée sans
//!   l'effacer : ils ne servent qu'aux données publiques (origine, base, en-tête, chiffré…).
//! - Un secret rendu à JavaScript est un `Uint8Array` (ou une chaîne) copié depuis un tampon
//!   `Zeroizing` ; aucune fonction ne rend une clé AES : K_contenu et K_env restent chez le
//!   fournisseur, derrière des objets opaques (`JsContentKeys`, `JsAccessKeys`).
//! - Les nombres JavaScript arrivent en `f64`, jamais en entier : `wasm-bindgen` tronquerait
//!   3,5 en 3. Une valeur qui n'est pas un entier sûr (`Number.isSafeInteger`) devient une
//!   valeur que le moteur refuse au même endroit et avec le même message que l'ancien moteur.
//! - Les fonctions asynchrones rendent une `Promise` ; les objets qu'elles utilisent sont tenus
//!   par `Rc` (méthodes en `&self`), et aucun emprunt de `RefCell` n'est tenu pendant une attente.
#![forbid(unsafe_code)]

use core::cell::{Cell, RefCell};
use js_sys::{Array, ArrayBuffer, Function, JsString, Object, Promise, Reflect, Uint8Array};
use shhdrop_core::elements::{self, ElementSealer, FinalEntry, FinalKind};
use shhdrop_core::envelope::{self, AccessKeys, ContentKeys};
use shhdrop_core::format::{self, MAX_SAFE};
use shhdrop_core::kdf::{self, KDF_CREATE, KDF_MAX, KDF_MIN};
use shhdrop_core::link::{self, ParsedLink};
use shhdrop_core::manifest::{Clean, Kind, Manifest};
use shhdrop_core::platform::{KeyHandle, NONCE_LEN, Opened, Platform, SecretBuf, TAG_LEN};
use shhdrop_core::reader::{Part, Reader, Segments};
use shhdrop_core::{Error, KLien, KMdp, Result, SGestion, Seed, encoding, password};
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{JsFuture, future_to_promise};
use zeroize::{Zeroize, Zeroizing};

// ---------------------------------------------------------------------------------------------
// Fournisseur JavaScript (spec §5)
// ---------------------------------------------------------------------------------------------

#[wasm_bindgen(typescript_custom_section)]
const TS_PROVIDER: &str = r#"
/** Fournisseur de la plateforme (spec §5), implémenté par web/src/engine/provider.ts. */
export interface Provider {
  /** n octets de crypto.getRandomValues ; le moteur les recopie puis met ce tableau à zéro. */
  random(n: number): Uint8Array;
  /** Importe une clé AES-256-GCM non extractible ; rend sa poignée (jamais réutilisée). */
  aesImport(raw: Uint8Array): Promise<number>;
  /**
   * Chiffre nonces.length / 12 morceaux de `chunk` octets ; un ArrayBuffer par morceau.
   * `plain` et `cipher` (ci-dessous) ne sont valides que pendant l'appel synchrone : le moteur
   * réutilise et efface ce tableau dès le retour. Les lire avant toute attente (WebCrypto en
   * prend copie à l'appel de encrypt et decrypt), ne jamais les garder.
   */
  aesSealBatch(h: number, ad: Uint8Array, nonces: Uint8Array, plain: Uint8Array, chunk: number): Promise<ArrayBuffer[]>;
  /** Déchiffre nonces.length / 12 morceaux de `chunkCt` octets ; rejet si un seul tag est faux. */
  aesOpenBatch(h: number, ad: Uint8Array, nonces: Uint8Array, cipher: Uint8Array, chunkCt: number): Promise<ArrayBuffer[]>;
  /** Oublie la clé (synchrone). */
  aesDrop(h: number): void;
}
"#;

#[wasm_bindgen]
extern "C" {
    /// Objet fournisseur passé par la couche TypeScript.
    #[wasm_bindgen(typescript_type = "Provider")]
    #[derive(Clone)]
    pub type Provider;

    #[wasm_bindgen(method, catch)]
    fn random(this: &Provider, n: u32) -> core::result::Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = aesImport)]
    fn aes_import(this: &Provider, raw: &Uint8Array) -> core::result::Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = aesSealBatch)]
    fn aes_seal_batch(
        this: &Provider,
        h: u32,
        ad: &Uint8Array,
        nonces: &Uint8Array,
        plain: &Uint8Array,
        chunk: u32,
    ) -> core::result::Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = aesOpenBatch)]
    fn aes_open_batch(
        this: &Provider,
        h: u32,
        ad: &Uint8Array,
        nonces: &Uint8Array,
        cipher: &Uint8Array,
        chunk_ct: u32,
    ) -> core::result::Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = aesDrop)]
    fn aes_drop(this: &Provider, h: u32) -> core::result::Result<JsValue, JsValue>;
    /// Même fonction, pour une poignée rendue hors des bornes (oubliée aussitôt).
    #[wasm_bindgen(method, catch, js_name = aesDrop)]
    fn aes_drop_value(this: &Provider, h: &JsValue) -> core::result::Result<JsValue, JsValue>;
}

/// Plateforme du site : le fournisseur JavaScript. Aucun état côté Rust (la table des
/// `CryptoKey` vit en JavaScript), donc aucun emprunt tenu pendant une attente.
struct Web(Provider);

/// Attend une valeur ou une promesse JavaScript.
async fn settle(v: JsValue) -> core::result::Result<JsValue, JsValue> {
    JsFuture::from(Promise::resolve(&v)).await
}

/// Copie JavaScript d'octets du moteur. Le fournisseur reçoit des tableaux à lui, jamais des
/// vues sur la mémoire WebAssembly (qu'une croissance de la mémoire détacherait).
fn js_copy(b: &[u8]) -> Uint8Array {
    Uint8Array::from(b)
}

/// Taille du tampon d'entrée : le plus grand lot du moteur (64 morceaux chiffrés de 64 Kio).
const STAGE_LEN: u32 = 64 * (65_536 + TAG_LEN as u32);

thread_local! {
    /// Tampon JavaScript réutilisé pour le clair ou le chiffré d'un lot donné au fournisseur :
    /// évite d'allouer 4 Mio par lot (mesuré : la moitié du surcoût du moteur, perf-report.md).
    /// Le fournisseur ne le lit que pendant son appel synchrone (contrat de `Provider`).
    static STAGE: RefCell<Option<Uint8Array>> = const { RefCell::new(None) };
}

/// Appelle `f` avec une copie JavaScript de `b` dans le tampon d'entrée (ou, s'il est pris ou
/// trop petit, dans un tableau neuf), puis met ce tableau à zéro s'il porte du clair (`wipe`).
/// Aucune attente entre la copie, l'appel et l'effacement : le tampon n'est jamais vu par deux
/// lots à la fois.
fn staged<T>(b: &[u8], wipe: bool, f: impl FnOnce(&Uint8Array) -> T) -> T {
    let len = u32::try_from(b.len()).ok().filter(|&n| n <= STAGE_LEN);
    // Pris du tampon pendant l'appel : un appel imbriqué en ferait un neuf.
    let buf = len.map(|_| {
        STAGE
            .with(|s| s.borrow_mut().take())
            .unwrap_or_else(|| Uint8Array::new_with_length(STAGE_LEN))
    });
    let view = match (&buf, len) {
        (Some(buf), Some(n)) => {
            let v = buf.subarray(0, n);
            v.copy_from(b);
            v
        }
        _ => js_copy(b),
    };
    let r = f(&view);
    if wipe {
        view.fill(0, 0, view.length());
    }
    if let Some(buf) = buf {
        STAGE.with(|s| *s.borrow_mut() = Some(buf));
    }
    r
}

/// Morceaux rendus par le fournisseur : un ArrayBuffer de `len` octets chacun, `count` en tout.
/// `Err` (avec les tampons reçus, pour que l'appelant efface du clair) si la forme ne tient pas
/// le contrat.
fn chunk_parts(
    v: &JsValue,
    count: usize,
    len: usize,
) -> core::result::Result<Vec<Uint8Array>, Vec<Uint8Array>> {
    let Some(arr) = v.dyn_ref::<Array>() else {
        return Err(Vec::new());
    };
    let parts: Vec<Uint8Array> = arr
        .iter()
        .filter_map(|x| x.dyn_into::<ArrayBuffer>().ok())
        .map(|b| Uint8Array::new(&b))
        .collect();
    let ok = parts.len() == count
        && arr.length() as usize == count
        && parts.iter().all(|p| p.length() as usize == len);
    if ok { Ok(parts) } else { Err(parts) }
}

/// Clair d'un lot ouvert, gardé en JavaScript (les ArrayBuffers de WebCrypto) : le puits de
/// `streamItem` reçoit un morceau entier tel quel, sans copie ; le reste est mis à zéro à la
/// destruction du lot (ou recopié, pour le manifeste, une note ou un aperçu).
pub struct JsOpened {
    parts: Vec<Uint8Array>,
    chunk: usize,
    /// Morceaux donnés au puits : à lui désormais, ni relus ni effacés ici.
    given: Vec<Cell<bool>>,
}

impl JsOpened {
    /// Octets `[at, at + len)`, dans un seul morceau, pour le puits : le morceau lui-même s'il
    /// est entier (donné une fois), sinon une copie de la tranche. `None` hors des bornes.
    fn give(&self, at: usize, len: usize) -> Option<Uint8Array> {
        let (c, off) = (at / self.chunk, at % self.chunk);
        let (p, given) = (self.parts.get(c)?, self.given.get(c)?);
        let end = off.checked_add(len).filter(|&e| e <= self.chunk)?;
        if given.get() {
            return None;
        }
        if off == 0 && len == self.chunk {
            given.set(true);
            return Some(p.clone());
        }
        Some(p.slice(off as u32, end as u32))
    }
}

impl Opened for JsOpened {
    fn len(&self) -> usize {
        self.parts.len() * self.chunk
    }

    fn copy_out(&self, at: usize, out: &mut [u8]) -> bool {
        let Some(end) = at.checked_add(out.len()).filter(|&e| e <= self.len()) else {
            return false;
        };
        let (mut pos, mut done) = (at, 0);
        while pos < end {
            let (c, off) = (pos / self.chunk, pos % self.chunk);
            if self.given[c].get() {
                return false;
            }
            let n = (self.chunk - off).min(end - pos);
            self.parts[c]
                .subarray(off as u32, (off + n) as u32)
                .copy_to(&mut out[done..done + n]);
            pos += n;
            done += n;
        }
        true
    }
}

impl Drop for JsOpened {
    fn drop(&mut self) {
        for (p, given) in self.parts.iter().zip(&self.given) {
            if !given.get() {
                p.fill(0, 0, p.length());
            }
        }
    }
}

impl Platform for Web {
    type Opened = JsOpened;

    fn random(&self, out: &mut [u8]) -> Result<()> {
        let n = u32::try_from(out.len()).map_err(|_| Error::AleatoireIndisponible)?;
        // Une exception JavaScript (getRandomValues qui lève) devient une erreur : jamais un
        // tampon nul utilisé à la place.
        let a = self
            .0
            .random(n)
            .ok()
            .and_then(|v| v.dyn_into::<Uint8Array>().ok())
            .ok_or(Error::AleatoireIndisponible)?;
        let ok = a.length() == n;
        if ok {
            a.copy_to(out);
        }
        a.fill(0, 0, a.length());
        if ok {
            Ok(())
        } else {
            Err(Error::AleatoireIndisponible)
        }
    }

    async fn aes_import(&self, key: Zeroizing<[u8; 32]>) -> Result<u32> {
        let raw = js_copy(&*key);
        drop(key);
        let got = match self.0.aes_import(&raw) {
            Ok(v) => settle(v).await.ok(),
            Err(_) => None,
        };
        // La copie JavaScript est effacée une fois l'import fini (WebCrypto la lit d'abord).
        raw.fill(0, 0, 32);
        let got = got.ok_or(Error::ChiffrementEchec)?;
        let h = got
            .as_f64()
            .filter(|h| h.fract() == 0.0 && (0.0..=f64::from(u32::MAX)).contains(h));
        match h {
            Some(h) => Ok(h as u32),
            None => {
                // Poignée numérique hors bornes : la clé a pu entrer dans la table ; oubliée.
                if got.as_f64().is_some() {
                    let _ = self.0.aes_drop_value(&got);
                }
                Err(Error::ChiffrementEchec)
            }
        }
    }

    async fn aes_seal_batch(
        &self,
        k: KeyHandle,
        ad: &[u8],
        nonces: &[[u8; NONCE_LEN]],
        plain: &[u8],
        chunk: usize,
    ) -> Result<Vec<u8>> {
        let chunk32 = u32::try_from(chunk).map_err(|_| Error::ChiffrementEchec)?;
        if chunk == 0 || nonces.len().checked_mul(chunk) != Some(plain.len()) {
            return Err(Error::ChiffrementEchec);
        }
        let (ad, nonces_js) = (js_copy(ad), js_copy(nonces.as_flattened()));
        // Le clair n'est lu que pendant l'appel (WebCrypto en prend copie) ; effacé aussitôt.
        let call = staged(plain, true, |p| {
            self.0.aes_seal_batch(k.raw(), &ad, &nonces_js, p, chunk32)
        });
        let got = match call {
            Ok(v) => settle(v).await.ok(),
            Err(_) => None,
        };
        let got = got.ok_or(Error::ChiffrementEchec)?;
        let parts = chunk_parts(&got, nonces.len(), chunk + TAG_LEN)
            .map_err(|_| Error::ChiffrementEchec)?;
        let mut out = Vec::new();
        out.try_reserve_exact(plain.len() + nonces.len() * TAG_LEN)
            .map_err(|_| Error::ChiffrementEchec)?;
        for p in &parts {
            let start = out.len();
            out.resize(start + chunk + TAG_LEN, 0);
            p.copy_to(&mut out[start..]);
        }
        Ok(out)
    }

    async fn aes_open_batch(
        &self,
        k: KeyHandle,
        ad: &[u8],
        nonces: &[[u8; NONCE_LEN]],
        cipher: &[u8],
        chunk_ct: usize,
    ) -> Result<JsOpened> {
        let ct32 = u32::try_from(chunk_ct).map_err(|_| Error::PaquetCorrompu)?;
        if chunk_ct <= TAG_LEN || nonces.len().checked_mul(chunk_ct) != Some(cipher.len()) {
            return Err(Error::PaquetCorrompu);
        }
        let (ad, nonces_js) = (js_copy(ad), js_copy(nonces.as_flattened()));
        let call = staged(cipher, false, |c| {
            self.0.aes_open_batch(k.raw(), &ad, &nonces_js, c, ct32)
        });
        let got = match call {
            Ok(v) => settle(v).await.ok(),
            Err(_) => None,
        };
        let got = got.ok_or(Error::PaquetCorrompu)?;
        let chunk = chunk_ct - TAG_LEN;
        match chunk_parts(&got, nonces.len(), chunk) {
            Ok(parts) => Ok(JsOpened {
                given: parts.iter().map(|_| Cell::new(false)).collect(),
                parts,
                chunk,
            }),
            Err(parts) => {
                // Forme refusée : le clair reçu est effacé quand même.
                for p in &parts {
                    p.fill(0, 0, p.length());
                }
                Err(Error::PaquetCorrompu)
            }
        }
    }

    fn aes_drop(&self, k: KeyHandle) {
        // Une exception de l'hôte ne traverse pas le moteur (Drop) : ignorée.
        let _ = self.0.aes_drop(k.raw());
    }
}

// ---------------------------------------------------------------------------------------------
// Panique (spec §7 : convertie en « paquet corrompu »)
// ---------------------------------------------------------------------------------------------

thread_local! {
    static ON_PANIC: RefCell<Option<Function>> = const { RefCell::new(None) };
}

/// Fonction JavaScript appelée (sans argument, ni message : rien de ce qui a paniqué ne sort) juste
/// avant l'arrêt de l'instance sur une panique (un bogue : le moteur ne panique sur aucune entrée).
/// Sur wasm32, une panique arrête l'instance (`RuntimeError: unreachable`) ; dans une opération
/// asynchrone, cet arrêt n'atteint pas la promesse de l'appelant. La couche TypeScript
/// (web/src/engine/index.ts) rejette alors ses opérations en cours par `paquet_corrompu` et
/// refait une instance neuve au prochain appel.
#[wasm_bindgen(js_name = setPanicHandler)]
pub fn set_panic_handler(f: Function) {
    ON_PANIC.with(|h| *h.borrow_mut() = Some(f));
    std::panic::set_hook(Box::new(|_| {
        // try_borrow : jamais une seconde panique pendant la première.
        let f = ON_PANIC.with(|h| h.try_borrow().ok().and_then(|g| g.clone()));
        if let Some(f) = f {
            let _ = f.call0(&JsValue::NULL);
        }
    }));
}

// ---------------------------------------------------------------------------------------------
// Conversions aux frontières
// ---------------------------------------------------------------------------------------------

/// Erreur du moteur → `Error` JavaScript au message exact.
fn js_err(e: Error) -> JsValue {
    JsError::new(e.message()).into()
}

fn js_msg(m: &str) -> JsValue {
    JsError::new(m).into()
}

/// Entier sûr (`Number.isSafeInteger(x) && x >= 0`).
fn uint(x: f64) -> Option<u64> {
    (x.is_finite() && x >= 0.0 && x.fract() == 0.0 && x <= MAX_SAFE as f64).then_some(x as u64)
}

/// Taille, indice ou durée venus de JavaScript : hors entier sûr, `u64::MAX`, que chaque
/// fonction du moteur refuse au même endroit et avec le même message que l'ancien moteur
/// (`taille_invalide`, `trop_gros`, `droits_invalides`, `segment_invalide`…).
fn n64(x: f64) -> u64 {
    uint(x).unwrap_or(u64::MAX)
}

fn index(x: f64) -> usize {
    uint(x)
        .and_then(|n| usize::try_from(n).ok())
        .unwrap_or(usize::MAX)
}

/// Paramètre Argon2id, comme `checkKdfParams` : non entier (2,5, NaN, infini) ou au-delà de
/// u32 → `u32::MAX` (« invalides ») ; entier négatif → 0 (« trop faibles »). L'ordre des refus
/// du moteur (mot de passe, sel, puis paramètres) est gardé.
fn kdf_param(x: f64) -> u32 {
    if !(x.is_finite() && x.fract() == 0.0) || x > f64::from(u32::MAX) {
        u32::MAX
    } else if x < 0.0 {
        0
    } else {
        x as u32
    }
}
const _: () = assert!(KDF_MAX.ops < u32::MAX && KDF_MAX.mem < u32::MAX);

/// Copie effaçable d'octets secrets venus de JavaScript.
fn secret(a: &Uint8Array) -> Zeroizing<Vec<u8>> {
    Zeroizing::new(a.to_vec())
}

/// Texte secret (mot de passe, lien) venu de JavaScript en UTF-8 (TextEncoder).
fn secret_text(a: &Uint8Array, bad: Error) -> Result<Zeroizing<String>> {
    match String::from_utf8(a.to_vec()) {
        Ok(s) => Ok(Zeroizing::new(s)),
        Err(e) => {
            e.into_bytes().zeroize();
            Err(bad)
        }
    }
}

fn set(o: &Object, k: &str, v: &JsValue) {
    // Reflect.set sur un objet ordinaire neuf ne peut pas échouer.
    let _ = Reflect::set(o, &JsValue::from_str(k), v);
}

fn get(o: &JsValue, k: &str) -> JsValue {
    Reflect::get(o, &JsValue::from_str(k)).unwrap_or(JsValue::UNDEFINED)
}

/// Octets rendus à JavaScript (copie ; le tampon du moteur est effacé par l'appelant).
fn bytes(b: &[u8]) -> JsValue {
    Uint8Array::from(b).into()
}

fn arr<const N: usize>(b: &[u8]) -> core::result::Result<[u8; N], ()> {
    b.try_into().map_err(|_| ())
}

// ---------------------------------------------------------------------------------------------
// Constantes, encodage, liens, mot de passe (Task 3)
// ---------------------------------------------------------------------------------------------

/// Constantes du format, du KDF et du mot de passe (même nom que `engine/vectors/v2.json`).
#[wasm_bindgen]
pub fn constants() -> Object {
    let o = Object::new();
    let n = |k: &str, v: f64| set(&o, k, &JsValue::from_f64(v));
    n("CHUNK", format::CHUNK as f64);
    n("TAG", format::TAG as f64);
    n("CHUNK_CT", format::CHUNK_CT as f64);
    n("HEADER", format::HEADER as f64);
    n("SEG_CHUNKS", f64::from(format::SEG_CHUNKS));
    n("MANIFEST_MAX", format::MANIFEST_MAX as f64);
    n("CONTENT_MAX", format::CONTENT_MAX as f64);
    n("MAX_ITEMS", format::MAX_ITEMS as f64);
    n("TEXT_MAX", format::TEXT_MAX as f64);
    n("TEXT_BYTES_MAX", format::TEXT_BYTES_MAX as f64);
    n("PREVIEW_MAX", format::PREVIEW_MAX as f64);
    n("SEG_PLAIN", elements::SEG_PLAIN as f64);
    n("DATA_SEGMENTS", f64::from(elements::DATA_SEGMENTS));
    n("DATA_CHUNKS", elements::DATA_CHUNKS as f64);
    n("SEED_LEN", envelope::SEED_LEN as f64);
    n("ID_LEN", envelope::ID_LEN as f64);
    n("ENVELOPE_LEN", envelope::ENVELOPE_LEN as f64);
    n("KEY_CHARS", link::KEY_CHARS as f64);
    n("PASSWORD_LEN", password::PASSWORD_LEN as f64);
    n("PASSWORD_SPECIALS", password::PASSWORD_SPECIALS as f64);
    let buckets: Array = format::BUCKETS
        .iter()
        .map(|&b| JsValue::from_f64(f64::from(b)))
        .collect();
    set(&o, "BUCKETS", &buckets);
    for (name, p) in [
        ("KDF_MIN", KDF_MIN),
        ("KDF_MAX", KDF_MAX),
        ("KDF_CREATE", KDF_CREATE),
    ] {
        let k = Object::new();
        set(&k, "ops", &JsValue::from_f64(f64::from(p.ops)));
        set(&k, "mem", &JsValue::from_f64(f64::from(p.mem)));
        set(&o, name, &k);
    }
    set(
        &o,
        "PASSWORD_ALPHABET",
        &JsValue::from_str(password::PASSWORD_ALPHABET),
    );
    let fam: Array = password::PASSWORD_FAMILIES
        .iter()
        .map(|f| JsValue::from_str(f))
        .collect();
    set(&o, "PASSWORD_FAMILIES", &fam);
    set(&o, "ELEMENT_AD", &bytes(elements::ELEMENT_AD));
    o
}

/// base64url sans bourrage.
#[wasm_bindgen]
pub fn b64u(b: &[u8]) -> String {
    encoding::b64u(b)
}

/// Inverse de `b64u` ; « base64url invalide ».
#[wasm_bindgen]
pub fn unb64u(s: &str) -> core::result::Result<Uint8Array, JsValue> {
    let b = Zeroizing::new(encoding::unb64u(s).map_err(js_err)?);
    Ok(Uint8Array::from(&b[..]))
}

/// `checkOrigin` : origine normalisée, ou « origine_invalide ».
#[wasm_bindgen(js_name = checkOrigin)]
pub fn check_origin(origin: &str) -> core::result::Result<String, JsValue> {
    link::check_origin(origin).map_err(js_err)
}

fn secret_string(s: Zeroizing<String>) -> JsString {
    JsString::from(s.as_str())
}

/// Lien de partage `origine + base + # + K_lien`.
#[wasm_bindgen(js_name = shareLink)]
pub fn share_link(
    origin: &str,
    k_lien: &Uint8Array,
    base: &str,
) -> core::result::Result<JsString, JsValue> {
    let k = KLien::from_slice(&secret(k_lien)).map_err(js_err)?;
    let l = link::share_link(origin, &k, base).map_err(js_err)?;
    Ok(secret_string(Zeroizing::new(l)))
}

/// Lien de gestion `origine + base + #m + S_gestion`.
#[wasm_bindgen(js_name = manageLink)]
pub fn manage_link(
    origin: &str,
    s_gestion: &Uint8Array,
    base: &str,
) -> core::result::Result<JsString, JsValue> {
    let s = SGestion::from_slice(&secret(s_gestion)).map_err(js_err)?;
    let l = link::manage_link(origin, &s, base).map_err(js_err)?;
    Ok(secret_string(Zeroizing::new(l)))
}

/// Lit un lien (UTF-8) : `{ kind: "s", origin, kLien }` ou `{ kind: "m", origin, sGestion }`.
#[wasm_bindgen(
    js_name = parseLink,
    unchecked_return_type = "{ kind: \"s\"; origin: string; kLien: Uint8Array } | { kind: \"m\"; origin: string; sGestion: Uint8Array }"
)]
pub fn parse_link(url: &Uint8Array, base: &str) -> core::result::Result<Object, JsValue> {
    let url = secret_text(url, Error::LienInvalide).map_err(js_err)?;
    let o = Object::new();
    match link::parse_link(&url, base).map_err(js_err)? {
        ParsedLink::Share { origin, k_lien } => {
            set(&o, "kind", &"s".into());
            set(&o, "origin", &origin.into());
            set(&o, "kLien", &bytes(k_lien.as_bytes()));
        }
        ParsedLink::Manage { origin, s_gestion } => {
            set(&o, "kind", &"m".into());
            set(&o, "origin", &origin.into());
            set(&o, "sGestion", &bytes(s_gestion.as_bytes()));
        }
    }
    Ok(o)
}

/// Lien du QR code : lien de partage suivi de `.` et du mot de passe en base64url.
#[wasm_bindgen(js_name = shareLinkWithPassword)]
pub fn share_link_with_password(
    link: &Uint8Array,
    pw: &Uint8Array,
) -> core::result::Result<JsString, JsValue> {
    let l = secret_text(link, Error::LienInvalide).map_err(js_err)?;
    let p = secret_text(pw, Error::LienInvalide).map_err(js_err)?;
    let out = link::share_link_with_password(&l, &p).map_err(js_err)?;
    Ok(secret_string(Zeroizing::new(out)))
}

/// Sépare le mot de passe d'un lien de QR code : `{ href, password }` (`null` sans mot de passe).
#[wasm_bindgen(
    js_name = splitPassword,
    unchecked_return_type = "{ href: string; password: string | null }"
)]
pub fn split_password(href: &Uint8Array) -> core::result::Result<Object, JsValue> {
    let h = secret_text(href, Error::LienInvalide).map_err(js_err)?;
    let (href, pw) = link::split_password(&h);
    let (href, pw) = (Zeroizing::new(href), pw.map(Zeroizing::new));
    let o = Object::new();
    set(&o, "href", &secret_string(href).into());
    set(
        &o,
        "password",
        &pw.map_or(JsValue::NULL, |p| secret_string(p).into()),
    );
    Ok(o)
}

/// `generatePassword` : 11 caractères, aléa du fournisseur.
#[wasm_bindgen(js_name = generatePassword)]
pub fn generate_password(provider: &Provider) -> core::result::Result<JsString, JsValue> {
    let w = Web(provider.clone());
    let pw = password::generate(&mut |b: &mut [u8]| w.random(b)).map_err(js_err)?;
    Ok(secret_string(Zeroizing::new(pw)))
}

/// `isGeneratedPassword` (mot de passe en UTF-8).
#[wasm_bindgen(js_name = isGeneratedPassword)]
pub fn is_generated_password(pw: &Uint8Array) -> bool {
    secret_text(pw, Error::MotDePasseNonGenere).is_ok_and(|p| password::is_generated(&p))
}

// ---------------------------------------------------------------------------------------------
// Dérivations (Task 4)
// ---------------------------------------------------------------------------------------------

/// SHA-256 (vecteurs communs, §9).
#[wasm_bindgen]
pub fn sha256(data: &Uint8Array) -> Uint8Array {
    Uint8Array::from(&kdf::sha256(&secret(data))[..])
}

/// HKDF-SHA-256 à sel vide (vecteurs communs, §9) : longueurs du moteur (16, 32) et celle de
/// la RFC 5869 A.3 (42). Ne rend qu'une fonction d'octets que JavaScript détient déjà.
#[wasm_bindgen]
pub fn hkdf(ikm: &Uint8Array, info: &str, len: f64) -> core::result::Result<Uint8Array, JsValue> {
    let ikm = secret(ikm);
    // Longueur en f64 : wasm-bindgen tronquerait 32,5 en 32 (refusée ici).
    Ok(match uint(len) {
        Some(16) => Uint8Array::from(&kdf::hkdf::<16>(&ikm, info)[..]),
        Some(32) => Uint8Array::from(&kdf::hkdf::<32>(&ikm, info)[..]),
        Some(42) => Uint8Array::from(&kdf::hkdf::<42>(&ikm, info)[..]),
        _ => return Err(js_err(Error::TailleInvalide)),
    })
}

/// K_accès et V_accès : `{ kAcces, vAcces }`.
#[wasm_bindgen(
    js_name = deriveAccess,
    unchecked_return_type = "{ kAcces: Uint8Array; vAcces: Uint8Array }"
)]
pub fn derive_access(k_lien: &Uint8Array) -> core::result::Result<Object, JsValue> {
    let k = KLien::from_slice(&secret(k_lien)).map_err(js_err)?;
    let a = kdf::derive_access(&k);
    let o = Object::new();
    set(&o, "kAcces", &bytes(a.k_acces.as_bytes()));
    set(&o, "vAcces", &bytes(&a.v_acces));
    Ok(o)
}

/// id du partage (16 octets).
#[wasm_bindgen(js_name = shareId)]
pub fn share_id(k_lien: &Uint8Array) -> core::result::Result<Uint8Array, JsValue> {
    let k = KLien::from_slice(&secret(k_lien)).map_err(js_err)?;
    Ok(Uint8Array::from(&envelope::share_id(&k)[..]))
}

/// K_mdp pour ouvrir (mot de passe en UTF-8, paramètres lus sur le serveur). Calcul de
/// 64 Mio : la couche TypeScript l'appelle dans un Worker neuf (web/src/engine/argon2.ts).
#[wasm_bindgen(js_name = passwordKey)]
pub fn password_key(
    pw: &Uint8Array,
    salt: &[u8],
    ops: f64,
    mem: f64,
) -> core::result::Result<Uint8Array, JsValue> {
    let pw = secret_text(pw, Error::MotDePasseVide).map_err(js_err)?;
    let k = kdf::password_key(&pw, salt, kdf_param(ops), kdf_param(mem)).map_err(js_err)?;
    Ok(Uint8Array::from(&k.as_bytes()[..]))
}

/// K_mdp pour créer : mot de passe de la forme de `generatePassword`, KDF_CREATE.
#[wasm_bindgen(js_name = passwordKeyForCreate)]
pub fn password_key_for_create(
    pw: &Uint8Array,
    salt: &[u8],
) -> core::result::Result<Uint8Array, JsValue> {
    let pw = secret_text(pw, Error::MotDePasseNonGenere).map_err(js_err)?;
    let k = kdf::password_key_for_create(&pw, salt).map_err(js_err)?;
    Ok(Uint8Array::from(&k.as_bytes()[..]))
}

// ---------------------------------------------------------------------------------------------
// Graine, clés et enveloppe (Task 5)
// ---------------------------------------------------------------------------------------------

/// Graine de contenu R, opaque pour JavaScript (jamais rendue en clair). Tirée par `newSeed`
/// (création) ou déballée par `open` (ouverture).
#[wasm_bindgen]
pub struct JsSeed(Rc<SeedCell>);

struct SeedCell {
    p: Rc<Web>,
    r: Seed,
    /// Vrai pour une R tirée par `newSeed` : elle ne donne des ContentKeys qu'une fois.
    fresh: bool,
    keys_made: Cell<bool>,
}

/// Nouvelle graine R (aléa du fournisseur).
#[wasm_bindgen(js_name = newSeed)]
pub fn new_seed(provider: &Provider) -> core::result::Result<JsSeed, JsValue> {
    let p = Rc::new(Web(provider.clone()));
    let r = envelope::new_seed(&*p).map_err(js_err)?;
    Ok(JsSeed(Rc::new(SeedCell {
        p,
        r,
        fresh: true,
        keys_made: Cell::new(false),
    })))
}

/// Clés de contenu d'un paquet : K_contenu (chez le fournisseur) et engagement. `creatable` :
/// tirées d'une R neuve par `contentKeys`, seules à pouvoir chiffrer un manifeste.
#[wasm_bindgen]
pub struct JsContentKeys {
    p: Rc<Web>,
    keys: Rc<ContentKeys<Web>>,
    creatable: bool,
}

#[wasm_bindgen]
impl JsContentKeys {
    /// Engagement (32 octets, public : dans l'en-tête en clair).
    #[wasm_bindgen(getter)]
    pub fn engagement(&self) -> Uint8Array {
        Uint8Array::from(&self.keys.engagement[..])
    }
}

/// Clés de création : une seule fois par graine neuve (`cle_deja_utilisee` ensuite). Une R
/// déballée par `open` ne donne que `contentKeysChecked`. Ainsi aucune K_contenu n'est
/// recréée depuis une même R pour chiffrer un second manifeste (nonce fixe du manifeste).
#[wasm_bindgen(js_name = contentKeys, unchecked_return_type = "Promise<JsContentKeys>")]
pub fn content_keys(seed: &JsSeed) -> Promise {
    let s = Rc::clone(&seed.0);
    future_to_promise(async move {
        if !s.fresh || s.keys_made.replace(true) {
            return Err(js_err(Error::CleDejaUtilisee));
        }
        let keys = envelope::content_keys(&s.p, &s.r).await.map_err(js_err)?;
        Ok(JsContentKeys {
            p: Rc::clone(&s.p),
            keys: Rc::new(keys),
            creatable: true,
        }
        .into())
    })
}

/// Clés d'ouverture : engagement lu dans l'en-tête vérifié contre R (`paquet_corrompu`). Pour
/// une R déballée par `open` seulement ; ces clés ne chiffrent jamais de manifeste.
#[wasm_bindgen(
    js_name = contentKeysChecked,
    unchecked_return_type = "Promise<JsContentKeys>"
)]
pub fn content_keys_checked(seed: &JsSeed, engagement: &[u8]) -> Promise {
    let s = Rc::clone(&seed.0);
    let engagement = engagement.to_vec();
    future_to_promise(async move {
        if s.fresh {
            return Err(js_err(Error::CleDejaUtilisee));
        }
        let keys = envelope::content_keys_checked(&s.p, &s.r, &engagement)
            .await
            .map_err(js_err)?;
        Ok(JsContentKeys {
            p: Rc::clone(&s.p),
            keys: Rc::new(keys),
            creatable: false,
        }
        .into())
    })
}

/// K_env (chez le fournisseur), K_preuve et V_preuve.
#[wasm_bindgen]
pub struct JsAccessKeys(Rc<AccessKeys<Web>>);

#[wasm_bindgen]
impl JsAccessKeys {
    /// K_preuve (32 octets), montrée au serveur pour détruire ; copie que l'appelant efface.
    #[wasm_bindgen(getter, js_name = kPreuve)]
    pub fn k_preuve(&self) -> Uint8Array {
        Uint8Array::from(&self.0.k_preuve.as_bytes()[..])
    }

    /// V_preuve = SHA-256(K_preuve), donnée au serveur à la création.
    #[wasm_bindgen(getter, js_name = vPreuve)]
    pub fn v_preuve(&self) -> Uint8Array {
        Uint8Array::from(&self.0.v_preuve[..])
    }
}

/// Clés tirées de K_lien et K_mdp.
#[wasm_bindgen(js_name = accessKeys, unchecked_return_type = "Promise<JsAccessKeys>")]
pub fn access_keys(provider: &Provider, k_lien: &Uint8Array, k_mdp: &Uint8Array) -> Promise {
    let p = Rc::new(Web(provider.clone()));
    // Lus tout de suite (avant la promesse) : K_lien est vérifiée avant K_mdp.
    let keys = KLien::from_slice(&secret(k_lien))
        .and_then(|l| KMdp::from_slice(&secret(k_mdp)).map(|m| (l, m)));
    future_to_promise(async move {
        let (l, m) = keys.map_err(js_err)?;
        let ak = envelope::access_keys(&p, &l, &m).await.map_err(js_err)?;
        Ok(JsAccessKeys(Rc::new(ak)).into())
    })
}

const ENV_ARGS: &str = "enveloppe : id ou en-tête invalide";

/// Enveloppe R sous K_env : E (60 octets), nonce tiré de l'aléa du fournisseur de K_env.
#[wasm_bindgen(unchecked_return_type = "Promise<Uint8Array>")]
pub fn seal(keys: &JsAccessKeys, seed: &JsSeed, id: &[u8], header: &[u8]) -> Promise {
    let (ak, s) = (Rc::clone(&keys.0), Rc::clone(&seed.0));
    let args = arr::<16>(id).and_then(|i| arr::<48>(header).map(|h| (i, h)));
    future_to_promise(async move {
        let (id, hdr) = args.map_err(|()| js_msg(ENV_ARGS))?;
        let e = envelope::seal(&ak.k_env, &s.r, &id, &hdr)
            .await
            .map_err(js_err)?;
        Ok(bytes(&e))
    })
}

/// Déballe R (`paquet_corrompu` pour tout défaut).
#[wasm_bindgen(unchecked_return_type = "Promise<JsSeed>")]
pub fn open(keys: &JsAccessKeys, e: &[u8], id: &[u8], header: &[u8]) -> Promise {
    let ak = Rc::clone(&keys.0);
    let (e, id, header) = (e.to_vec(), id.to_vec(), header.to_vec());
    future_to_promise(async move {
        let r = envelope::open(&ak.k_env, &e, &id, &header)
            .await
            .map_err(js_err)?;
        // Le fournisseur de K_env sert aussi aux clés de contenu de ce paquet.
        let p = Rc::new(Web(ak.k_env.platform().0.clone()));
        Ok(JsSeed(Rc::new(SeedCell {
            p,
            r,
            fresh: false,
            keys_made: Cell::new(false),
        }))
        .into())
    })
}

// ---------------------------------------------------------------------------------------------
// Format (Task 6)
// ---------------------------------------------------------------------------------------------

/// En-tête de 48 octets : « SHH2 », version 2, 11 octets nuls, engagement.
#[wasm_bindgen]
pub fn header(engagement: &[u8]) -> core::result::Result<Uint8Array, JsValue> {
    let e = arr::<32>(engagement).map_err(|()| js_msg("engagement invalide"))?;
    Ok(Uint8Array::from(&format::header(&e)[..]))
}

/// Lit l'en-tête en clair du segment 0 : `{ header, engagement }` ou `paquet_corrompu`.
#[wasm_bindgen(
    js_name = readHeader,
    unchecked_return_type = "{ header: Uint8Array; engagement: Uint8Array }"
)]
pub fn read_header(seg0: &[u8]) -> core::result::Result<Object, JsValue> {
    let (h, e) = format::read_header(seg0).map_err(js_err)?;
    let o = Object::new();
    set(&o, "header", &bytes(&h));
    set(&o, "engagement", &bytes(&e));
    Ok(o)
}

/// Nonce du morceau `index` (entier sûr, sinon `taille_invalide`).
#[wasm_bindgen]
pub fn nonce(index: f64, last: bool) -> core::result::Result<Uint8Array, JsValue> {
    let i = uint(index).ok_or_else(|| js_err(Error::TailleNonSure))?;
    Ok(Uint8Array::from(&format::nonce(i, last)[..]))
}

/// Palier canonique pour une fin des données ; `taille_invalide`, `trop_gros`.
#[wasm_bindgen(js_name = bucketFor)]
pub fn bucket_for(data_end: f64) -> core::result::Result<u32, JsValue> {
    format::bucket_for(n64(data_end)).map_err(js_err)
}

fn bucket32(b: f64) -> core::result::Result<u32, JsValue> {
    uint(b)
        .and_then(|b| u32::try_from(b).ok())
        .ok_or_else(|| js_err(Error::TailleNonSure))
}

/// Segments d'un palier.
#[wasm_bindgen(js_name = segmentCount)]
pub fn segment_count(bucket: f64) -> core::result::Result<u32, JsValue> {
    Ok(format::segment_count(bucket32(bucket)?))
}

/// Taille du segment `n` d'un palier ; `segment_invalide` hors du palier.
#[wasm_bindgen(js_name = segmentSize)]
pub fn segment_size(bucket: f64, n: f64) -> core::result::Result<f64, JsValue> {
    let (b, n) = (bucket32(bucket)?, bucket32(n)?);
    format::segment_size(b, n)
        .map(|s| s as f64)
        .ok_or_else(|| js_err(Error::SegmentInvalide))
}

// ---------------------------------------------------------------------------------------------
// Éléments et manifeste final (Task 7)
// ---------------------------------------------------------------------------------------------

fn sized(r: Result<u64>) -> core::result::Result<f64, JsValue> {
    r.map(|n| n as f64).map_err(js_err)
}

#[wasm_bindgen(js_name = segmentsFor)]
pub fn segments_for(size: f64) -> core::result::Result<f64, JsValue> {
    sized(elements::segments_for(n64(size)))
}

#[wasm_bindgen(js_name = chunksFor)]
pub fn chunks_for(size: f64) -> core::result::Result<f64, JsValue> {
    sized(elements::chunks_for(n64(size)))
}

#[wasm_bindgen(js_name = footprintFor)]
pub fn footprint_for(size: f64) -> core::result::Result<f64, JsValue> {
    sized(elements::footprint_for(n64(size)))
}

/// Petit élément. Comme `isSmall`, une simple comparaison, même pour un nombre non entier
/// (0,5 → vrai) : les fonctions qui suivent (`footprintFor`…) le refusent ensuite.
#[wasm_bindgen(js_name = isSmall)]
pub fn is_small(size: f64) -> bool {
    match uint(size) {
        Some(n) => elements::is_small(n),
        None => size > 0.0 && size < elements::SEG_PLAIN as f64,
    }
}

#[wasm_bindgen(js_name = reservationFor)]
pub fn reservation_for(used: f64) -> core::result::Result<u32, JsValue> {
    elements::reservation_for(n64(used)).map_err(js_err)
}

#[wasm_bindgen(js_name = segmentsNeeded)]
pub fn segments_needed(sizes: Vec<f64>) -> core::result::Result<f64, JsValue> {
    let sizes: Vec<u64> = sizes.into_iter().map(n64).collect();
    sized(elements::segments_needed(&sizes))
}

/// Scelleur d'un élément (clé neuve) : l'hôte lit `range(j)` du fichier et le passe à
/// `piece(j, octets)`. Sa graine k ne sort jamais du moteur : `sealFinal` la retrouve par
/// `id`, tant que le scelleur existe (`free()` l'oublie).
#[wasm_bindgen]
pub struct JsElementSealer {
    el: Rc<ElementSealer<Web>>,
    id: u32,
}

thread_local! {
    /// Scelleurs vivants, par numéro (jamais réutilisé) ; tenus faiblement : `free()` (ou le
    /// ramasse-miettes) les retire, et leur graine est effacée avec eux.
    static SEALERS: RefCell<Vec<(u32, std::rc::Weak<ElementSealer<Web>>)>> = const { RefCell::new(Vec::new()) };
    static NEXT_SEALER: Cell<u32> = const { Cell::new(1) };
}

fn sealer_by_id(id: u32) -> Option<Rc<ElementSealer<Web>>> {
    SEALERS.with(|m| {
        m.borrow()
            .iter()
            .find(|(i, _)| *i == id)
            .and_then(|(_, w)| w.upgrade())
    })
}

impl Drop for JsElementSealer {
    fn drop(&mut self) {
        let id = self.id;
        SEALERS.with(|m| m.borrow_mut().retain(|(i, _)| *i != id));
    }
}

#[wasm_bindgen]
impl JsElementSealer {
    /// Numéro du scelleur, donné à `sealFinal` à la place de la graine.
    #[wasm_bindgen(getter)]
    pub fn id(&self) -> u32 {
        self.id
    }

    /// Plages à envoyer : `[{ seg, from, chunks }]`.
    #[wasm_bindgen(unchecked_return_type = "{ seg: number; from: number; chunks: number }[]")]
    pub fn pieces(&self) -> Array {
        self.el
            .pieces()
            .iter()
            .map(|p| {
                let o = Object::new();
                set(&o, "seg", &JsValue::from_f64(f64::from(p.seg)));
                set(&o, "from", &JsValue::from_f64(f64::from(p.from)));
                set(&o, "chunks", &JsValue::from_f64(f64::from(p.chunks)));
                JsValue::from(o)
            })
            .collect()
    }

    /// Octets `[lo, hi)` du fichier à lire pour la pièce `j` ; `segment_invalide`.
    #[wasm_bindgen(unchecked_return_type = "[number, number]")]
    pub fn range(&self, j: f64) -> core::result::Result<Array, JsValue> {
        let (lo, hi) = self.el.range(index(j)).map_err(js_err)?;
        Ok([lo as f64, hi as f64]
            .into_iter()
            .map(JsValue::from_f64)
            .collect())
    }

    /// Chiffre la pièce `j` une seule fois ; `plain` : exactement les octets de `range(j)`
    /// (recopiés et effacés par le moteur ; l'appelant efface les siens).
    #[wasm_bindgen(unchecked_return_type = "Promise<Uint8Array>")]
    pub fn piece(&self, j: f64, plain: &Uint8Array) -> Promise {
        let (el, j, plain) = (
            Rc::clone(&self.el),
            index(j),
            SecretBuf::new(plain.to_vec()),
        );
        future_to_promise(async move {
            let ct = el.piece(j, &plain).await.map_err(js_err)?;
            Ok(bytes(&ct))
        })
    }
}

/// Prépare un élément de `size` octets placé au morceau `first`.
#[wasm_bindgen(
    js_name = elementSealer,
    unchecked_return_type = "Promise<JsElementSealer>"
)]
pub fn element_sealer(provider: &Provider, size: f64, first: f64) -> Promise {
    let p = Rc::new(Web(provider.clone()));
    let (size, first) = (n64(size), n64(first));
    future_to_promise(async move {
        let el = Rc::new(ElementSealer::new(&p, size, first).await.map_err(js_err)?);
        let id = NEXT_SEALER.with(|n| {
            let id = n.get();
            n.set(id.wrapping_add(1).max(1));
            id
        });
        SEALERS.with(|m| m.borrow_mut().push((id, Rc::downgrade(&el))));
        Ok(JsElementSealer { el, id }.into())
    })
}

#[wasm_bindgen(typescript_custom_section)]
const TS_FINAL: &str = r#"
/** Élément gardé (sealFinal) : `sealer`, numéro (`id`) du scelleur qui l'a chiffré, dont le moteur reprend la graine ; `clean` seulement pour un fichier. */
export type FinalEntry = { kind: "text" | "file"; name: string; mime: string; size: number; first: number; sealer: number; clean?: string };
"#;

const BAD_ENTRY: &str = "entree_invalide";

/// Entrée de `sealFinal` lue sur un objet JavaScript. Taille ou place non entière : valeur que
/// `seal_final` refuse à son tour (`texte_trop_long`, `taille_invalide`, `trop_gros`).
fn final_entry(v: &JsValue) -> core::result::Result<FinalEntry, JsValue> {
    let text = |k: &str| get(v, k).as_string().ok_or_else(|| js_msg(BAD_ENTRY));
    let num = |k: &str| get(v, k).as_f64().ok_or_else(|| js_msg(BAD_ENTRY));
    let kind = match text("kind")?.as_str() {
        "text" => FinalKind::Text,
        "file" => {
            let c = get(v, "clean");
            if c.is_undefined() {
                FinalKind::File(None)
            } else {
                // Valeur inconnue : refusée (l'ancien moteur l'écrivait, la lecture l'ignorait).
                let c = c.as_string().and_then(|s| Clean::from_name(&s));
                FinalKind::File(Some(c.ok_or_else(|| js_msg(BAD_ENTRY))?))
            }
        }
        _ => return Err(js_msg(BAD_ENTRY)),
    };
    // Graine reprise du scelleur vivant (jamais lue depuis JavaScript).
    let el = num("sealer")
        .ok()
        .and_then(uint)
        .and_then(|i| u32::try_from(i).ok())
        .and_then(sealer_by_id)
        .ok_or_else(|| js_msg(BAD_ENTRY))?;
    let size = n64(num("size")?);
    // Note : texte vu par le scelleur, que le lecteur acceptera (audit M6 : UTF-8 strict, au
    // plus TEXT_MAX points de code) ; au-delà de TEXT_BYTES_MAX, `seal_final` la refuse.
    if kind == FinalKind::Text && size <= format::TEXT_BYTES_MAX {
        el.check_note().map_err(js_err)?;
    }
    Ok(FinalEntry {
        kind,
        name: text("name")?,
        mime: text("mime")?,
        size,
        first: n64(num("first")?),
        k: el.k(),
    })
}

/// Manifeste final : `{ bucket, header, tail }`. Refus de l'ancien moteur (`vide`,
/// `droits_invalides`, `manifeste_trop_gros`, `texte_trop_long`, `trop_gros`,
/// `chevauchement`, `cle_deja_utilisee`) ; clés d'ouverture refusées (`cle_deja_utilisee`) ;
/// note que le lecteur refuserait (`texte_invalide`, `texte_trop_long`, audit M6).
#[wasm_bindgen(
    js_name = sealFinal,
    unchecked_return_type = "Promise<{ bucket: number; header: Uint8Array; tail: Uint8Array }>"
)]
pub fn seal_final(
    #[wasm_bindgen(unchecked_param_type = "FinalEntry[]")] entries: &Array,
    keys: &JsContentKeys,
    rights: Option<String>,
    keep_ttl_h: Option<f64>,
) -> Promise {
    let entries: core::result::Result<Vec<FinalEntry>, JsValue> =
        entries.iter().map(|e| final_entry(&e)).collect();
    let (keys, creatable) = (Rc::clone(&keys.keys), keys.creatable);
    future_to_promise(async move {
        let entries = entries?;
        if !creatable {
            return Err(js_err(Error::CleDejaUtilisee));
        }
        let fin = elements::seal_final(&entries, &keys, rights.as_deref(), keep_ttl_h.map(n64))
            .await
            .map_err(js_err)?;
        let o = Object::new();
        set(&o, "bucket", &JsValue::from_f64(f64::from(fin.bucket)));
        set(&o, "header", &bytes(&fin.header));
        set(&o, "tail", &bytes(&fin.tail));
        Ok(o.into())
    })
}

// ---------------------------------------------------------------------------------------------
// Ouverture en flux (Task 8)
// ---------------------------------------------------------------------------------------------

/// Erreur de l'hôte (rejet de `fetchSegment` ou du puits), rendue telle quelle à l'appelant.
/// Elle est posée et reprise dans la même exécution (aucune attente entre l'échec et la fin de
/// l'opération) : une autre opération ne peut pas la prendre.
type HostError = Rc<RefCell<Option<JsValue>>>;

fn fail(host: &HostError, e: Error) -> JsValue {
    host.borrow_mut().take().unwrap_or_else(|| js_err(e))
}

/// Appelle une fonction JavaScript (synchrone ou asynchrone) ; un rejet est gardé dans `host`.
async fn call(f: &Function, arg: &JsValue, host: &HostError) -> Result<JsValue> {
    let r = match f.call1(&JsValue::NULL, arg) {
        Ok(v) => settle(v).await,
        Err(e) => Err(e),
    };
    r.map_err(|e| {
        *host.borrow_mut() = Some(e);
        Error::PaquetCorrompu
    })
}

struct JsSegments {
    fetch: Function,
    host: HostError,
}

impl Segments for JsSegments {
    async fn fetch(&self, n: u32) -> Result<Vec<u8>> {
        let v = call(&self.fetch, &JsValue::from_f64(f64::from(n)), &self.host).await?;
        // Autre chose que des octets : le serveur n'a pas rendu un segment.
        let a = v
            .dyn_into::<Uint8Array>()
            .map_err(|_| Error::PaquetCorrompu)?;
        Ok(a.to_vec())
    }
}

/// Lecteur d'un paquet ouvert ; opérations sérialisées, un seul segment en cache. Les clés des
/// éléments sont oubliées chez le fournisseur à sa destruction (`free()`, ou ramasse-miettes).
#[wasm_bindgen]
pub struct JsReader {
    rd: Rc<Reader<Web, JsSegments>>,
    host: HostError,
}

#[wasm_bindgen(typescript_custom_section)]
const TS_MANIFEST: &str = r#"
/** Manifeste authentifié, sans les graines `k` (le lecteur garde les clés) ; une note porte son texte. */
export type OpenedManifest = {
  v: 2; rights: "voir" | "enregistrer" | "coffre"; keep_ttl_h?: 1 | 6 | 12 | 24;
  items: { kind: "text" | "file"; name: string; mime: string; size: number; offset: number; clean?: string; text?: string }[];
};
"#;

fn manifest_js(m: &Manifest) -> Object {
    let o = Object::new();
    set(&o, "v", &JsValue::from_f64(2.0));
    set(&o, "rights", &m.rights.name().into());
    if let Some(h) = m.rights.keep_ttl_h() {
        set(&o, "keep_ttl_h", &JsValue::from_f64(f64::from(h)));
    }
    let items: Array = m
        .items
        .iter()
        .map(|e| {
            let i = Object::new();
            set(&i, "kind", &e.kind.name().into());
            set(&i, "name", &e.name.as_str().into());
            set(&i, "mime", &e.mime.as_str().into());
            set(&i, "size", &JsValue::from_f64(e.size as f64));
            set(&i, "offset", &JsValue::from_f64(e.offset as f64));
            // Graine `k` omise : le lecteur tient les clés des éléments (jamais rendue à JS).
            if let Some(c) = e.clean {
                set(&i, "clean", &c.name().into());
            }
            if e.kind == Kind::Text {
                set(&i, "text", &e.text.as_deref().unwrap_or_default().into());
            }
            JsValue::from(i)
        })
        .collect();
    set(&o, "items", &items);
    o
}

#[wasm_bindgen]
impl JsReader {
    /// Manifeste authentifié (copie neuve à chaque appel).
    #[wasm_bindgen(unchecked_return_type = "OpenedManifest")]
    pub fn manifest(&self) -> Object {
        manifest_js(self.rd.manifest())
    }

    /// Passe l'élément `i` à `sink`, tranche par tranche (≤ 64 Kio, copie que `sink` garde).
    /// Un rejet de `fetchSegment` ou de `sink` est rendu tel quel.
    #[wasm_bindgen(js_name = streamItem, unchecked_return_type = "Promise<void>")]
    pub fn stream_item(
        &self,
        i: f64,
        #[wasm_bindgen(unchecked_param_type = "(chunk: Uint8Array) => Promise<void> | void")]
        sink: Function,
    ) -> Promise {
        let (rd, host, i) = (Rc::clone(&self.rd), Rc::clone(&self.host), index(i));
        future_to_promise(async move {
            let h = Rc::clone(&host);
            rd.stream_parts(i, async |p: Part<'_, JsOpened>| {
                let c = match p {
                    Part::Text(t) => bytes(t),
                    Part::Plain { batch, at, len } => {
                        batch.give(at, len).ok_or(Error::PaquetCorrompu)?.into()
                    }
                };
                call(&sink, &c, &h).await.map(drop)
            })
            .await
            .map_err(|e| fail(&host, e))?;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Met à zéro le segment chiffré en cache.
    pub fn wipe(&self) {
        self.rd.wipe();
    }
}

/// Ouvre un paquet en flux : `fetchSegment(n)` rend le segment `n` (ses rejets sont rendus
/// tels quels) ; `bucket` vient du serveur et n'est cru qu'après vérification ; `keys` vient de
/// `contentKeysChecked`.
#[wasm_bindgen(js_name = openReader, unchecked_return_type = "Promise<JsReader>")]
pub fn open_reader(
    keys: &JsContentKeys,
    #[wasm_bindgen(unchecked_param_type = "(n: number) => Promise<Uint8Array>")]
    fetch_segment: Function,
    bucket: f64,
) -> Promise {
    let (p, keys) = (Rc::clone(&keys.p), Rc::clone(&keys.keys));
    let bucket = u32::try_from(n64(bucket)).unwrap_or(u32::MAX);
    future_to_promise(async move {
        let host: HostError = Rc::default();
        let src = JsSegments {
            fetch: fetch_segment,
            host: Rc::clone(&host),
        };
        let rd = Reader::open(&p, src, bucket, &keys)
            .await
            .map_err(|e| fail(&host, e))?;
        Ok(JsReader {
            rd: Rc::new(rd),
            host,
        }
        .into())
    })
}
