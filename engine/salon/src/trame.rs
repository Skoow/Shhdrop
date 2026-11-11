//! Enveloppe de taille fixe (spec §39) : toute trame fait 4 140 octets, quel que soit le
//! message. `"SHC3"` ‖ drapeaux (1) ‖ nonce (24) ‖ XChaCha20-Poly1305(`K_trame`, nonce, `O`) où
//! `O` (4 095 octets) = `len` (2, gros-boutiste) ‖ charge ‖ zéros. Données authentifiées :
//! `"SHC3"` ‖ drapeaux ‖ tag du salon (16) : un en-tête modifié ou une trame d'un autre salon
//! ne s'ouvre pas. Toute ouverture ratée donne la seule erreur `trame_corrompue`.
use crate::cles::ClesSalon;
use crate::error::{Error, Result};
use chacha20poly1305::aead::{AeadInPlace, KeyInit};
use chacha20poly1305::{Tag, XChaCha20Poly1305, XNonce};
use zeroize::Zeroizing;

pub const TAILLE_TRAME: usize = 4140;
pub const TAILLE_O: usize = 4095;
pub const MAX_CHARGE: usize = 4093;

const MARQUE: &[u8; 4] = b"SHC3";
const DEBUT_NONCE: usize = 5;
const DEBUT_CHIFFRE: usize = DEBUT_NONCE + 24;
const TAILLE_TAG_AEAD: usize = 16;
const _: () = assert!(DEBUT_CHIFFRE + TAILLE_O + TAILLE_TAG_AEAD == TAILLE_TRAME);

/// Règle d'effacement du message (2 bits des drapeaux).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Regle {
    Desactive = 0,
    Instantane = 1,
    DixMinutes = 2,
    UneHeure = 3,
}

impl Regle {
    fn depuis_bits(b: u8) -> Self {
        match b & 3 {
            0 => Regle::Desactive,
            1 => Regle::Instantane,
            2 => Regle::DixMinutes,
            _ => Regle::UneHeure,
        }
    }
}

/// Partie lisible sans clé (le serveur la lit pour sa rétention) mais authentifiée.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EnTete {
    pub volatile: bool,
    pub regle: Regle,
}

impl EnTete {
    fn drapeaux(self) -> u8 {
        u8::from(self.volatile) | ((self.regle as u8) << 1)
    }
}

/// Lit l'en-tête sans clé : taille, marque, bits réservés à zéro.
pub fn lire_en_tete(trame: &[u8]) -> Result<EnTete> {
    if trame.len() != TAILLE_TRAME || &trame[..4] != MARQUE {
        return Err(Error::EnTeteInvalide);
    }
    let d = trame[4];
    if d & !0b111 != 0 {
        return Err(Error::EnTeteInvalide);
    }
    Ok(EnTete {
        volatile: d & 1 == 1,
        regle: Regle::depuis_bits(d >> 1),
    })
}

fn donnees_associees(drapeaux: u8, tag: &[u8; 16]) -> [u8; 21] {
    let mut aad = [0u8; 21];
    aad[..4].copy_from_slice(MARQUE);
    aad[4] = drapeaux;
    aad[5..].copy_from_slice(tag);
    aad
}

/// Scelle `o` (déjà complet, 4 095 octets) : sépare la mise en forme de `O` du chiffrement,
/// pour que les tests fabriquent des `O` invalides.
fn sceller_o(
    cles: &ClesSalon,
    en_tete: EnTete,
    o: &mut [u8; TAILLE_O],
    nonce: &[u8; 24],
) -> [u8; TAILLE_TRAME] {
    let d = en_tete.drapeaux();
    let chiffre = XChaCha20Poly1305::new(cles.k_trame().into());
    let aad = donnees_associees(d, cles.tag());
    let tag_aead = chiffre
        .encrypt_in_place_detached(XNonce::from_slice(nonce), &aad, o)
        // Seule une entrée de plus de 2^38 octets échoue : exclue (4 095 octets).
        .expect("chiffrement de 4 095 octets");
    let mut trame = [0u8; TAILLE_TRAME];
    trame[..4].copy_from_slice(MARQUE);
    trame[4] = d;
    trame[DEBUT_NONCE..DEBUT_CHIFFRE].copy_from_slice(nonce);
    trame[DEBUT_CHIFFRE..DEBUT_CHIFFRE + TAILLE_O].copy_from_slice(o);
    trame[DEBUT_CHIFFRE + TAILLE_O..].copy_from_slice(&tag_aead);
    trame
}

/// Scelle `charge` (au plus 4 093 octets) dans une trame de 4 140 octets. Le nonce vient de
/// l'appelant (24 octets aléatoires du fournisseur ; fixe seulement dans les vecteurs de test) :
/// ne jamais le réutiliser avec la même clé.
pub fn sceller(
    cles: &ClesSalon,
    en_tete: EnTete,
    charge: &[u8],
    nonce: &[u8; 24],
) -> Result<[u8; TAILLE_TRAME]> {
    if charge.len() > MAX_CHARGE {
        return Err(Error::TropGrand);
    }
    let mut o = Zeroizing::new([0u8; TAILLE_O]);
    o[..2].copy_from_slice(&(charge.len() as u16).to_be_bytes());
    o[2..2 + charge.len()].copy_from_slice(charge);
    Ok(sceller_o(cles, en_tete, &mut o, nonce))
}

/// Ouvre une trame. Toute cause d'échec (taille, marque, bits réservés, authentification,
/// `len`, bourrage non nul) donne `TrameCorrompue`. La charge rendue est effacée à la
/// destruction.
pub fn ouvrir(cles: &ClesSalon, trame: &[u8]) -> Result<(EnTete, Zeroizing<Vec<u8>>)> {
    let corrompue = Error::TrameCorrompue;
    let en_tete = lire_en_tete(trame).map_err(|_| corrompue)?;
    let nonce = XNonce::from_slice(&trame[DEBUT_NONCE..DEBUT_CHIFFRE]);
    let tag_aead = Tag::from_slice(&trame[DEBUT_CHIFFRE + TAILLE_O..]);
    let mut o = Zeroizing::new([0u8; TAILLE_O]);
    o.copy_from_slice(&trame[DEBUT_CHIFFRE..DEBUT_CHIFFRE + TAILLE_O]);
    let aad = donnees_associees(trame[4], cles.tag());
    XChaCha20Poly1305::new(cles.k_trame().into())
        .decrypt_in_place_detached(nonce, &aad, &mut *o, tag_aead)
        .map_err(|_| corrompue)?;
    let len = usize::from(u16::from_be_bytes([o[0], o[1]]));
    if len > MAX_CHARGE || o[2 + len..].iter().any(|&b| b != 0) {
        return Err(corrompue);
    }
    Ok((en_tete, Zeroizing::new(o[2..2 + len].to_vec())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cles::cles_salon;
    use shhdrop_core::{KLien, KMdp};

    fn cles(n: u8) -> ClesSalon {
        cles_salon(&KLien::from_bytes([n; 32]), &KMdp::from_bytes([2; 32]))
    }

    const ET: EnTete = EnTete {
        volatile: false,
        regle: Regle::UneHeure,
    };
    const NONCE: [u8; 24] = [7; 24];

    #[test]
    fn aller_retour() {
        let c = cles(1);
        for n in [0usize, 1, 4093] {
            let charge: Vec<u8> = (0..n).map(|i| (i % 251) as u8 + 1).collect();
            let trame = sceller(&c, ET, &charge, &NONCE).unwrap();
            let (et, o) = ouvrir(&c, &trame).unwrap();
            assert_eq!(et, ET);
            assert_eq!(&*o, &charge);
        }
        let et = EnTete {
            volatile: true,
            regle: Regle::Instantane,
        };
        let trame = sceller(&c, et, b"x", &NONCE).unwrap();
        assert_eq!(ouvrir(&c, &trame).unwrap().0, et);
        assert_eq!(lire_en_tete(&trame).unwrap(), et);
    }

    #[test]
    fn taille_fixe() {
        let c = cles(1);
        for n in [0usize, 1, 100, 4093] {
            assert_eq!(sceller(&c, ET, &vec![9; n], &NONCE).unwrap().len(), 4140);
        }
        // Une charge de 0 octet ne laisse pas voir sa taille.
        let vide = sceller(&c, ET, b"", &NONCE).unwrap();
        assert_eq!(&vide[..4], b"SHC3");
    }

    #[test]
    fn charge_trop_grande() {
        let c = cles(1);
        let e = sceller(&c, ET, &vec![1; 4094], &NONCE).unwrap_err();
        assert_eq!(e, Error::TropGrand);
        assert_eq!(e.to_string(), "trop_grand");
    }

    #[test]
    fn en_tete_altere() {
        let c = cles(1);
        let trame = sceller(&c, ET, b"salut", &NONCE).unwrap();
        for masque in [0b001u8, 0b010, 0b100, 0b110] {
            let mut t = trame;
            t[4] ^= masque;
            assert_eq!(ouvrir(&c, &t).unwrap_err().to_string(), "trame_corrompue");
        }
        let mut t = trame;
        t[0] ^= 1;
        assert_eq!(ouvrir(&c, &t).unwrap_err(), Error::TrameCorrompue);
        // Nonce, chiffré et étiquette AEAD aussi.
        for i in [10, 100, TAILLE_TRAME - 1] {
            let mut t = trame;
            t[i] ^= 1;
            assert_eq!(ouvrir(&c, &t).unwrap_err(), Error::TrameCorrompue);
        }
    }

    #[test]
    fn bits_reserves() {
        let c = cles(1);
        let mut t = sceller(&c, ET, b"salut", &NONCE).unwrap();
        t[4] |= 0b1000;
        assert_eq!(ouvrir(&c, &t).unwrap_err().to_string(), "trame_corrompue");
        assert_eq!(
            lire_en_tete(&t).unwrap_err().to_string(),
            "en_tete_invalide"
        );
        t[4] = 0b1000_0000;
        assert_eq!(lire_en_tete(&t).unwrap_err(), Error::EnTeteInvalide);
    }

    #[test]
    fn mauvaise_taille() {
        let c = cles(1);
        let t = sceller(&c, ET, b"salut", &NONCE).unwrap();
        for n in [4139usize, 4141, 0] {
            let mut v = t.to_vec();
            v.resize(n, 0);
            assert_eq!(ouvrir(&c, &v).unwrap_err(), Error::TrameCorrompue);
            assert_eq!(lire_en_tete(&v).unwrap_err(), Error::EnTeteInvalide);
        }
    }

    #[test]
    fn autre_salon() {
        let t = sceller(&cles(1), ET, b"salut", &NONCE).unwrap();
        assert_eq!(ouvrir(&cles(2), &t).unwrap_err(), Error::TrameCorrompue);
        // Même K_trame mais autre tag : fabriqué en changeant seulement les AAD.
        let c = cles(1);
        let mut autre = cles(1);
        autre.tag_pour_test([0xAA; 16]);
        assert_eq!(c.k_trame(), autre.k_trame());
        assert_eq!(ouvrir(&autre, &t).unwrap_err(), Error::TrameCorrompue);
    }

    #[test]
    fn bourrage_non_nul() {
        let c = cles(1);
        let mut o = Zeroizing::new([0u8; TAILLE_O]);
        o[..2].copy_from_slice(&3u16.to_be_bytes());
        o[2..5].copy_from_slice(b"abc");
        // Contrôle : la même forme avec bourrage nul s'ouvre.
        let mut ok = o.clone();
        let t = sceller_o(&c, ET, &mut ok, &NONCE);
        assert_eq!(&*ouvrir(&c, &t).unwrap().1, b"abc");
        o[4000] = 1;
        let t = sceller_o(&c, ET, &mut o, &NONCE);
        assert_eq!(ouvrir(&c, &t).unwrap_err(), Error::TrameCorrompue);
    }

    #[test]
    fn len_impossible() {
        let c = cles(1);
        for len in [4094u16, 4095, 65535] {
            let mut o = Zeroizing::new([0u8; TAILLE_O]);
            o[..2].copy_from_slice(&len.to_be_bytes());
            let t = sceller_o(&c, ET, &mut o, &NONCE);
            assert_eq!(ouvrir(&c, &t).unwrap_err(), Error::TrameCorrompue);
        }
    }

    #[test]
    fn nonce_different_chiffre_different() {
        let c = cles(1);
        let a = sceller(&c, ET, b"salut", &[1; 24]).unwrap();
        let b = sceller(&c, ET, b"salut", &[2; 24]).unwrap();
        assert_ne!(a[DEBUT_CHIFFRE..], b[DEBUT_CHIFFRE..]);
    }
}
