//! Outils communs des tests d'intégration : exécuteur minimal et aléa déterministe.
#![allow(dead_code)] // chaque fichier de test n'utilise qu'une partie de ces outils

use core::future::Future;
use core::task::{Context, Poll, Waker};
use shhdrop_core::native::RustCrypto;
use shhdrop_core::{Error, Result};

/// Exécute un futur du fournisseur natif, toujours prêt dès le premier appel (aucune attente
/// réelle) : un futur en attente est un bogue du test ou du fournisseur.
pub fn block_on<F: Future>(f: F) -> F::Output {
    let mut f = core::pin::pin!(f);
    let mut cx = Context::from_waker(Waker::noop());
    match f.as_mut().poll(&mut cx) {
        Poll::Ready(v) => v,
        Poll::Pending => panic!("futur du fournisseur natif en attente"),
    }
}

pub fn unhex(s: &str) -> Vec<u8> {
    assert!(s.len().is_multiple_of(2), "hex de longueur impaire : {s}");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex"))
        .collect()
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// splitmix64 : aléa de test déterministe (jamais utilisé hors des tests).
pub fn splitmix(seed: u64) -> impl FnMut(&mut [u8]) -> Result<()> {
    let mut s = seed;
    move |buf: &mut [u8]| {
        for b in buf.iter_mut() {
            s = s.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut z = s;
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            *b = (z ^ (z >> 31)) as u8;
        }
        Ok(())
    }
}

/// Fournisseur natif à aléa déterministe.
pub fn platform(seed: u64) -> RustCrypto {
    RustCrypto::new(Box::new(splitmix(seed)))
}

/// Fournisseur natif qui rejoue des tirages connus (champ `random` des vecteurs), dans l'ordre ;
/// un tirage de mauvaise taille fait échouer le test ; au-delà du dernier, l'aléa échoue.
pub fn replay(draws: Vec<Vec<u8>>) -> RustCrypto {
    let mut draws: Vec<Vec<u8>> = draws.into_iter().rev().collect();
    RustCrypto::new(Box::new(move |buf: &mut [u8]| {
        let Some(d) = draws.pop() else {
            return Err(Error::AleatoireIndisponible);
        };
        assert_eq!(buf.len(), d.len(), "taille du tirage");
        buf.copy_from_slice(&d);
        Ok(())
    }))
}

/// Fournisseur dont l'aléa échoue toujours.
pub fn no_random() -> RustCrypto {
    RustCrypto::new(Box::new(|_: &mut [u8]| Err(Error::AleatoireIndisponible)))
}
