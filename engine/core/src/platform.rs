//! Fournisseur de la plateforme (spec §5) : le moteur ne fait lui-même ni AES ni tirage
//! aléatoire. Site : `crypto.getRandomValues` et WebCrypto (couche TypeScript) ; tests et apps :
//! `native::RustCrypto`.
//!
//! - Les fonctions AES sont asynchrones (WebCrypto l'est) et sans `Send` (WebAssembly a un seul
//!   fil) ; un lot de morceaux est confié en un seul appel, que la plateforme peut traiter en
//!   parallèle.
//! - Une clé AES n'entre qu'une fois dans le fournisseur (`Key::import`), qui la garde ; aucune
//!   fonction ne rend une clé AES en clair. Le moteur met ses octets à zéro dès l'import (le
//!   `Zeroizing` passé est détruit par le fournisseur).
//! - Le moteur ne manie jamais une poignée nue : il tient un [`Key`], qui n'est ni `Clone` ni
//!   `Copy` et oublie la clé chez le fournisseur à sa destruction, sur tous les chemins (`?`
//!   compris). Une clé ne peut donc pas servir après son oubli.
//! - Tout échec d'ouverture d'un lot devient `paquet_corrompu` (aucun oracle).
use crate::error::{Error, Result};
use core::fmt;
use core::future::Future;
use std::rc::Rc;
use zeroize::Zeroizing;

/// Taille du tag AES-GCM (128 bits), ajouté à chaque morceau chiffré.
pub const TAG_LEN: usize = 16;
/// Taille d'un nonce AES-GCM.
pub const NONCE_LEN: usize = 12;

/// Poignée d'une clé AES-256-GCM tenue par le fournisseur (côté site : indice dans la table des
/// `CryptoKey` non extractibles de la couche TypeScript). Le fournisseur la reçoit dans ses
/// fonctions et en lit la valeur (`raw`) ; il n'existe aucun constructeur public : seule
/// [`Key::import`] en crée une, à partir de l'entier rendu par `aes_import`, et le moteur ne la
/// sort jamais de `Key`. Personne ne peut donc fabriquer une poignée, ni en garder une nue
/// après l'oubli de sa clé.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct KeyHandle(pub(crate) u32);

impl KeyHandle {
    /// Valeur rendue par `aes_import` du fournisseur.
    pub const fn raw(self) -> u32 {
        self.0
    }
}

/// Contrat d'un fournisseur. Lots : `plain` (ou `cipher`) est découpé en `nonces.len()` morceaux
/// de `chunk` (ou `chunk_ct`) octets exactement, le morceau i est chiffré sous `nonces[i]` avec
/// les mêmes données authentifiées `ad` ; le résultat est la concaténation des morceaux, chacun
/// de `chunk + 16` octets (ou `chunk_ct − 16` à l'ouverture). Une taille qui ne tombe pas juste,
/// ou un morceau vide (`chunk == 0`, `chunk_ct <= 16`), est refusée (`chiffrement_echec` au
/// scellement, `paquet_corrompu` à l'ouverture).
///
/// Le moteur n'appelle ces fonctions qu'à travers [`Key`] ; un fournisseur les implémente.
pub trait Platform {
    /// Remplit `out` d'aléa cryptographique ; `aleatoire_indisponible` si la source échoue.
    fn random(&self, out: &mut [u8]) -> Result<()>;

    /// Importe une clé AES-256-GCM et rend sa valeur de poignée (jamais deux fois la même tant
    /// que le fournisseur vit) ; les octets sont mis à zéro à la destruction de `key`.
    fn aes_import(&self, key: Zeroizing<[u8; 32]>) -> impl Future<Output = Result<u32>>;

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

    /// Oublie la clé (le fournisseur natif la met à zéro). Appelée par `Key` à sa destruction.
    fn aes_drop(&self, k: KeyHandle);
}

/// Clé AES-256-GCM tenue par le fournisseur : l'oublie (`aes_drop`) à sa destruction.
///
/// Le fournisseur est partagé par `Rc` plutôt qu'emprunté (`&'p P`) : les objets du moteur qui
/// tiennent des clés (lecteur, scelleur d'éléments) seront des classes `wasm-bindgen` possédées
/// par JavaScript (Task 9), qui ne peuvent pas porter de durée de vie. Un `Rc` les garde
/// valides aussi longtemps qu'il le faut, sans `unsafe` ni `'static` forcé.
pub struct Key<P: Platform> {
    p: Rc<P>,
    h: KeyHandle,
}

impl<P: Platform> Key<P> {
    /// Importe `raw` dans le fournisseur (octets effacés à la destruction de `raw`).
    pub async fn import(p: &Rc<P>, raw: Zeroizing<[u8; 32]>) -> Result<Self> {
        let h = KeyHandle(p.aes_import(raw).await?);
        Ok(Self { p: Rc::clone(p), h })
    }

    /// Fournisseur qui tient la clé (aléa du même fournisseur, par exemple pour un nonce).
    pub fn platform(&self) -> &P {
        &self.p
    }

    /// Chiffre un lot de morceaux sous cette clé (contrat de [`Platform`]). Des nonces répétés
    /// dans un lot sont un bogue du moteur : vérifié en mode debug.
    pub async fn seal_batch(
        &self,
        ad: &[u8],
        nonces: &[[u8; NONCE_LEN]],
        plain: &[u8],
        chunk: usize,
    ) -> Result<Vec<u8>> {
        debug_assert!(
            nonces
                .iter()
                .enumerate()
                .all(|(i, n)| !nonces[..i].contains(n)),
            "nonce répété dans un lot"
        );
        let ct = self
            .p
            .aes_seal_batch(self.h, ad, nonces, plain, chunk)
            .await?;
        // Un fournisseur qui ne tient pas le contrat de taille ne passe pas inaperçu.
        if Some(ct.len()) != nonces.len().checked_mul(chunk.saturating_add(TAG_LEN)) {
            return Err(Error::ChiffrementEchec);
        }
        Ok(ct)
    }

    /// Déchiffre un lot de morceaux sous cette clé ; tout échec devient `paquet_corrompu`.
    pub async fn open_batch(
        &self,
        ad: &[u8],
        nonces: &[[u8; NONCE_LEN]],
        cipher: &[u8],
        chunk_ct: usize,
    ) -> Result<Zeroizing<Vec<u8>>> {
        let pt = self
            .p
            .aes_open_batch(self.h, ad, nonces, cipher, chunk_ct)
            .await
            .map_err(|_| Error::PaquetCorrompu)?;
        if Some(pt.len()) != nonces.len().checked_mul(chunk_ct.saturating_sub(TAG_LEN)) {
            return Err(Error::PaquetCorrompu);
        }
        Ok(pt)
    }
}

impl<P: Platform> Drop for Key<P> {
    fn drop(&mut self) {
        self.p.aes_drop(self.h);
    }
}

impl<P: Platform> fmt::Debug for Key<P> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Key(…)")
    }
}
