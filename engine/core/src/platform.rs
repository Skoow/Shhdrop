//! Fournisseur de la plateforme (spec §5) : le moteur ne fait lui-même ni AES ni tirage
//! aléatoire. Site : `crypto.getRandomValues` et WebCrypto (couche TypeScript) ; tests et apps :
//! `native::RustCrypto`.
//!
//! - Les fonctions AES sont asynchrones (WebCrypto l'est) et sans `Send` (WebAssembly a un seul
//!   fil) ; un lot de morceaux est confié en un seul appel, que la plateforme peut traiter en
//!   parallèle.
//! - Une clé AES n'entre qu'une fois dans le fournisseur (`aes_import`), qui rend une poignée
//!   opaque ; aucune fonction ne rend une clé AES en clair. Le moteur met ses octets à zéro dès
//!   l'import (le `Zeroizing` passé est détruit par le fournisseur).
//! - Tout échec d'ouverture d'un lot devient `paquet_corrompu` (aucun oracle).
use crate::error::Result;
use core::future::Future;
use zeroize::Zeroizing;

/// Taille du tag AES-GCM (128 bits), ajouté à chaque morceau chiffré.
pub const TAG_LEN: usize = 16;
/// Taille d'un nonce AES-GCM.
pub const NONCE_LEN: usize = 12;

/// Poignée opaque d'une clé AES-256-GCM tenue par le fournisseur (côté site : indice dans la
/// table des `CryptoKey` non extractibles de la couche TypeScript).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct KeyHandle(u32);

impl KeyHandle {
    /// Réservé aux fournisseurs : la valeur n'a de sens que pour celui qui l'a rendue.
    pub const fn from_raw(raw: u32) -> Self {
        Self(raw)
    }

    pub const fn raw(self) -> u32 {
        self.0
    }
}

/// Contrat d'un fournisseur. Lots : `plain` (ou `cipher`) est découpé en `nonces.len()` morceaux
/// de `chunk` (ou `chunk_ct`) octets exactement, le morceau i est chiffré sous `nonces[i]` avec
/// les mêmes données authentifiées `ad` ; le résultat est la concaténation des morceaux, chacun
/// de `chunk + 16` octets (ou `chunk_ct − 16` à l'ouverture). Une taille qui ne tombe pas juste
/// est refusée (`chiffrement_echec` au scellement, `paquet_corrompu` à l'ouverture).
pub trait Platform {
    /// Remplit `out` d'aléa cryptographique ; `aleatoire_indisponible` si la source échoue.
    fn random(&self, out: &mut [u8]) -> Result<()>;

    /// Importe une clé AES-256-GCM ; ses octets sont mis à zéro à la destruction de `key`.
    fn aes_import(&self, key: Zeroizing<[u8; 32]>) -> impl Future<Output = Result<KeyHandle>>;

    /// Chiffre un lot de morceaux (voir le contrat du trait).
    fn aes_seal_batch(
        &self,
        k: KeyHandle,
        ad: &[u8],
        nonces: &[[u8; NONCE_LEN]],
        plain: &[u8],
        chunk: usize,
    ) -> impl Future<Output = Result<Vec<u8>>>;

    /// Déchiffre un lot de morceaux ; un seul tag faux fait échouer tout le lot
    /// (`paquet_corrompu`), sans rendre aucun clair.
    fn aes_open_batch(
        &self,
        k: KeyHandle,
        ad: &[u8],
        nonces: &[[u8; NONCE_LEN]],
        cipher: &[u8],
        chunk_ct: usize,
    ) -> impl Future<Output = Result<Zeroizing<Vec<u8>>>>;

    /// Oublie la clé (le fournisseur natif la met à zéro). Poignée inconnue : sans effet.
    fn aes_drop(&self, k: KeyHandle);
}
