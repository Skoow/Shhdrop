//! Fournisseur natif (tests Rust aujourd'hui, apps plus tard) : AES-256-GCM de RustCrypto
//! (`aes-gcm`, fonction `zeroize`). N'entre pas dans le `.wasm` du site (spec §5).
//!
//! L'aléa vient du constructeur : générateur déterministe dans les tests ; pour les apps, le
//! générateur du système (crate `getrandom`) sera branché avec elles, pas maintenant.
use crate::error::{Error, Result};
use crate::platform::{KeyHandle, NONCE_LEN, Platform, TAG_LEN};
use aes_gcm::aead::{AeadInOut, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce, Tag};
use core::cell::{Cell, RefCell};
use core::mem;
use std::collections::BTreeMap;
use zeroize::Zeroizing;

/// Source d'aléa : remplit le tampon, ou échoue (`aleatoire_indisponible`).
pub type Rng = Box<dyn FnMut(&mut [u8]) -> Result<()>>;

// Les clés tenues sont effacées à la destruction (oubli par `aes_drop`, ou fin du fournisseur) :
// vérifié à la compilation.
const _: fn() = || {
    fn zeroize_on_drop<T: zeroize::ZeroizeOnDrop>() {}
    zeroize_on_drop::<Aes256Gcm>();
};

/// Fournisseur RustCrypto. Un seul fil (comme WebAssembly) : état intérieur en `RefCell`.
pub struct RustCrypto {
    rng: RefCell<Rng>,
    /// Clés importées (tableau de tours AES et clé GHASH), dans une boîte : jamais déplacées.
    keys: RefCell<BTreeMap<u32, Box<Aes256Gcm>>>,
    /// Prochaine poignée : jamais réutilisée, même après `aes_drop`.
    next: Cell<u32>,
}

impl RustCrypto {
    pub fn new(rng: Rng) -> Self {
        Self {
            rng: RefCell::new(rng),
            keys: RefCell::new(BTreeMap::new()),
            next: Cell::new(0),
        }
    }
}

/// Vrai si `total` octets font exactement `count` morceaux de `len` octets.
fn fits(total: usize, count: usize, len: usize) -> bool {
    count.checked_mul(len) == Some(total)
}

impl Platform for RustCrypto {
    fn random(&self, out: &mut [u8]) -> Result<()> {
        (self.rng.borrow_mut())(out)
    }

    async fn aes_import(&self, key: Zeroizing<[u8; 32]>) -> Result<u32> {
        let id = self.next.get();
        self.next
            .set(id.checked_add(1).ok_or(Error::ChiffrementEchec)?);
        // Référence vers les octets de `key` (aucune copie), effacés quand `key` est détruite.
        let cipher = Box::new(Aes256Gcm::new((&*key).into()));
        self.keys.borrow_mut().insert(id, cipher);
        Ok(id)
    }

    async fn aes_seal_batch(
        &self,
        k: KeyHandle,
        ad: &[u8],
        nonces: &[[u8; NONCE_LEN]],
        plain: &[u8],
        chunk: usize,
    ) -> Result<Vec<u8>> {
        let keys = self.keys.borrow();
        let cipher = keys.get(&k.raw()).ok_or(Error::ChiffrementEchec)?;
        let chunk_ct = chunk.checked_add(TAG_LEN).ok_or(Error::ChiffrementEchec)?;
        if chunk == 0 || !fits(plain.len(), nonces.len(), chunk) {
            return Err(Error::ChiffrementEchec);
        }
        let cap = nonces
            .len()
            .checked_mul(chunk_ct)
            .ok_or(Error::ChiffrementEchec)?;
        // Zeroizing : le clair recopié d'un lot interrompu (échec au morceau i) est effacé.
        // Capacité réservée d'avance : aucune réallocation ne laisse de copie non effacée.
        let mut out = Zeroizing::new(Vec::new());
        out.try_reserve_exact(cap)
            .map_err(|_| Error::ChiffrementEchec)?;
        for (nonce, piece) in nonces.iter().zip(plain.chunks_exact(chunk)) {
            let start = out.len();
            out.extend_from_slice(piece);
            let tag = cipher
                .encrypt_inout_detached(&Nonce::from(*nonce), ad, (&mut out[start..]).into())
                .map_err(|_| Error::ChiffrementEchec)?;
            out.extend_from_slice(&tag);
        }
        // Lot complet : que du chiffré, rendu tel quel (le `Zeroizing` vidé n'efface rien).
        Ok(mem::take(&mut *out))
    }

    async fn aes_open_batch(
        &self,
        k: KeyHandle,
        ad: &[u8],
        nonces: &[[u8; NONCE_LEN]],
        cipher: &[u8],
        chunk_ct: usize,
    ) -> Result<Zeroizing<Vec<u8>>> {
        let keys = self.keys.borrow();
        let aes = keys.get(&k.raw()).ok_or(Error::PaquetCorrompu)?;
        if chunk_ct <= TAG_LEN || !fits(cipher.len(), nonces.len(), chunk_ct) {
            return Err(Error::PaquetCorrompu);
        }
        let chunk = chunk_ct - TAG_LEN;
        // Zeroizing : un clair partiel (lot refusé au morceau i) est effacé à la destruction.
        // Capacité réservée d'avance : aucune réallocation ne laisse de copie non effacée.
        let mut out = Zeroizing::new(Vec::new());
        out.try_reserve_exact(cipher.len() - nonces.len() * TAG_LEN)
            .map_err(|_| Error::PaquetCorrompu)?;
        for (nonce, piece) in nonces.iter().zip(cipher.chunks_exact(chunk_ct)) {
            let (ct, tag) = piece.split_at(chunk);
            let start = out.len();
            out.extend_from_slice(ct);
            aes.decrypt_inout_detached(
                &Nonce::from(*nonce),
                ad,
                (&mut out[start..]).into(),
                &Tag::try_from(tag).map_err(|_| Error::PaquetCorrompu)?,
            )
            .map_err(|_| Error::PaquetCorrompu)?;
        }
        Ok(out)
    }

    fn aes_drop(&self, k: KeyHandle) {
        // La boîte retirée est détruite ici : `Aes256Gcm` met sa clé à zéro (ZeroizeOnDrop).
        drop(self.keys.borrow_mut().remove(&k.raw()));
    }
}

/// Le fournisseur seul, poignées nues (le moteur, lui, ne passe que par `Key`).
#[cfg(test)]
mod tests {
    use super::*;
    use core::future::Future;
    use core::task::{Context, Poll, Waker};

    /// Les futurs de ce fournisseur sont prêts dès le premier appel.
    fn block_on<F: Future>(f: F) -> F::Output {
        let mut f = core::pin::pin!(f);
        match f.as_mut().poll(&mut Context::from_waker(Waker::noop())) {
            Poll::Ready(v) => v,
            Poll::Pending => panic!("futur en attente"),
        }
    }

    fn p() -> RustCrypto {
        RustCrypto::new(Box::new(|b: &mut [u8]| {
            b.fill(1);
            Ok(())
        }))
    }

    #[test]
    fn poignee_oubliee_ou_inconnue_refusee() {
        let p = p();
        let k = KeyHandle(block_on(p.aes_import(Zeroizing::new([7; 32]))).unwrap());
        let ct = block_on(p.aes_seal_batch(k, b"", &[[0; 12]], b"abc", 3)).unwrap();
        assert_eq!(p.keys.borrow().len(), 1);
        p.aes_drop(k);
        assert!(
            p.keys.borrow().is_empty(),
            "clé retirée, donc détruite et effacée"
        );
        p.aes_drop(k); // deux fois : sans effet
        let got = block_on(p.aes_seal_batch(k, b"", &[[0; 12]], b"abc", 3));
        assert_eq!(got.unwrap_err(), Error::ChiffrementEchec);
        let got = block_on(p.aes_open_batch(k, b"", &[[0; 12]], &ct, 19));
        assert_eq!(got.unwrap_err(), Error::PaquetCorrompu);
        let k2 = block_on(p.aes_import(Zeroizing::new([7; 32]))).unwrap();
        assert_ne!(k2, k.raw(), "jamais réutilisée");
        let got = block_on(p.aes_seal_batch(KeyHandle(9999), b"", &[[0; 12]], b"abc", 3));
        assert_eq!(got.unwrap_err(), Error::ChiffrementEchec);
    }

    #[test]
    fn morceaux_vides_refuses() {
        let p = p();
        let k = KeyHandle(block_on(p.aes_import(Zeroizing::new([7; 32]))).unwrap());
        let got = block_on(p.aes_seal_batch(k, b"", &[[0; 12]], b"", 0));
        assert_eq!(got.unwrap_err(), Error::ChiffrementEchec);
        // 16 octets = un tag seul, morceau vide : refusé à l'ouverture comme au scellement.
        let got = block_on(p.aes_open_batch(k, b"", &[[0; 12]], &[0; 16], 16));
        assert_eq!(got.unwrap_err(), Error::PaquetCorrompu);
    }
}
