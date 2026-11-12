//! Enveloppe de taille fixe (spec §39) : toute trame fait 4 140 octets, quel que soit le
//! message. `"SHC3"` ‖ drapeaux (1) ‖ nonce (24) ‖ XChaCha20-Poly1305(`K_trame`, nonce, `O`) où
//! `O` (4 095 octets) = `len` (2, gros-boutiste) ‖ charge ‖ zéros. Données authentifiées :
//! `"SHC3"` ‖ drapeaux ‖ tag du salon (16) : un en-tête modifié ou une trame d'un autre salon
//! ne s'ouvre pas. Toute ouverture ratée donne la seule erreur `trame_corrompue`.
use crate::cles::ClesSalon;
use crate::error::{Error, Result};
use crate::message::{Enveloppe, Message, est_volatile};
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
    pub(crate) fn depuis_bits(b: u8) -> Self {
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
    /// Octet `drapeaux` de la trame (aussi les données authentifiées MLS de son message).
    pub(crate) fn drapeaux(self) -> u8 {
        u8::from(self.volatile) | ((self.regle as u8) << 1)
    }
}

/// En-tête de toute trame de contrôle MLS (Commit, Welcome, KeyPackage) : non volatile, règle
/// « désactivé » (le serveur les garde jusqu'à la fin du salon).
pub const EN_TETE_CONTROLE: EnTete = EnTete {
    volatile: false,
    regle: Regle::Desactive,
};

/// En-tête de la trame d'une enveloppe : volatile = `est_volatile(message)`, règle = `e.regle`.
pub fn en_tete_de(e: &Enveloppe) -> EnTete {
    EnTete {
        volatile: est_volatile(&e.message),
        regle: e.regle,
    }
}

/// Contrôle à la réception (spec v3 §3.2.1) : l'en-tête, lu en clair par le serveur, dit ce que dit
/// le contenu chiffré. `None` : message de contrôle MLS, qui exige `EN_TETE_CONTROLE`. `Some(e)` :
/// même règle que `e.regle` et même bit volatil que `est_volatile`, sauf pour une sorte inconnue de
/// ce moteur (`Message::Inconnu`), dont le bit volatil est libre (une version future en décide).
/// Tout écart : `message_invalide`.
pub fn en_tete_coherent(en_tete: EnTete, contenu: Option<&Enveloppe>) -> Result<()> {
    let ok = match contenu {
        None => en_tete == EN_TETE_CONTROLE,
        Some(e) => {
            en_tete.regle == e.regle
                && (matches!(e.message, Message::Inconnu { .. })
                    || en_tete.volatile == est_volatile(&e.message))
        }
    };
    if ok {
        Ok(())
    } else {
        Err(Error::MessageInvalide)
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

/// Scelle `charge` (au plus 4 093 octets) dans une trame de 4 140 octets, sous un nonce de 24
/// octets tiré ici (getrandom : aléa du système ; `crypto.getRandomValues` dans le navigateur).
/// Les trames du groupe se font par `Salon` (`envoyer`, `ajouter`…), qui fixe l'en-tête.
pub fn sceller(cles: &ClesSalon, en_tete: EnTete, charge: &[u8]) -> Result<[u8; TAILLE_TRAME]> {
    let mut nonce = [0u8; 24];
    getrandom::fill(&mut nonce).map_err(|_| Error::MlsInterne)?;
    sceller_avec_nonce(cles, en_tete, charge, &nonce)
}

/// Forme à nonce donné, interne au moteur : seuls ses tests (vecteurs fixes) choisissent le nonce,
/// jamais un appelant (un nonce réutilisé avec la même clé casserait XChaCha20-Poly1305).
pub(crate) fn sceller_avec_nonce(
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
            let trame = sceller_avec_nonce(&c, ET, &charge, &NONCE).unwrap();
            let (et, o) = ouvrir(&c, &trame).unwrap();
            assert_eq!(et, ET);
            assert_eq!(&*o, &charge);
        }
        let et = EnTete {
            volatile: true,
            regle: Regle::Instantane,
        };
        let trame = sceller_avec_nonce(&c, et, b"x", &NONCE).unwrap();
        assert_eq!(ouvrir(&c, &trame).unwrap().0, et);
        assert_eq!(lire_en_tete(&trame).unwrap(), et);
    }

    #[test]
    fn taille_fixe() {
        let c = cles(1);
        for n in [0usize, 1, 100, 4093] {
            assert_eq!(
                sceller_avec_nonce(&c, ET, &vec![9; n], &NONCE)
                    .unwrap()
                    .len(),
                4140
            );
        }
        // Une charge de 0 octet ne laisse pas voir sa taille.
        let vide = sceller_avec_nonce(&c, ET, b"", &NONCE).unwrap();
        assert_eq!(&vide[..4], b"SHC3");
    }

    #[test]
    fn charge_trop_grande() {
        let c = cles(1);
        let e = sceller_avec_nonce(&c, ET, &vec![1; 4094], &NONCE).unwrap_err();
        assert_eq!(e, Error::TropGrand);
        assert_eq!(e.to_string(), "trop_grand");
    }

    #[test]
    fn en_tete_altere() {
        let c = cles(1);
        let trame = sceller_avec_nonce(&c, ET, b"salut", &NONCE).unwrap();
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
        let mut t = sceller_avec_nonce(&c, ET, b"salut", &NONCE).unwrap();
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
        let t = sceller_avec_nonce(&c, ET, b"salut", &NONCE).unwrap();
        for n in [4139usize, 4141, 0] {
            let mut v = t.to_vec();
            v.resize(n, 0);
            assert_eq!(ouvrir(&c, &v).unwrap_err(), Error::TrameCorrompue);
            assert_eq!(lire_en_tete(&v).unwrap_err(), Error::EnTeteInvalide);
        }
    }

    #[test]
    fn autre_salon() {
        let t = sceller_avec_nonce(&cles(1), ET, b"salut", &NONCE).unwrap();
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

    /// M5 : la forme publique tire le nonce (getrandom) ; deux trames de la même charge diffèrent.
    #[test]
    fn sceller_tire_son_nonce() {
        let c = cles(1);
        let a = sceller(&c, ET, b"salut").unwrap();
        let b = sceller(&c, ET, b"salut").unwrap();
        assert_ne!(a[DEBUT_NONCE..DEBUT_CHIFFRE], b[DEBUT_NONCE..DEBUT_CHIFFRE]);
        assert_eq!(&*ouvrir(&c, &a).unwrap().1, b"salut");
        assert_eq!(sceller(&c, ET, &[0; 4094]).unwrap_err(), Error::TropGrand);
        assert_ne!(crate::nouvel_id().unwrap(), crate::nouvel_id().unwrap());
    }

    /// I2 : l'en-tête d'une enveloppe suit son contenu ; tout écart est refusé.
    #[test]
    fn en_tete_lie_au_contenu() {
        use crate::message::{Enveloppe, Message};
        let regles = [
            Regle::Desactive,
            Regle::Instantane,
            Regle::DixMinutes,
            Regle::UneHeure,
        ];
        let env = |regle, message| Enveloppe {
            id: [1; 16],
            heure_ms: 1,
            regle,
            message,
        };
        for regle in regles {
            for (message, volatile) in [
                (Message::Texte { x: "a".into() }, false),
                (Message::Ecrit, true),
            ] {
                let e = env(regle, message);
                assert_eq!(en_tete_de(&e), EnTete { volatile, regle });
                for v in [false, true] {
                    for r in regles {
                        let et = EnTete {
                            volatile: v,
                            regle: r,
                        };
                        let attendu = if (v, r) == (volatile, regle) {
                            Ok(())
                        } else {
                            Err(Error::MessageInvalide)
                        };
                        assert_eq!(en_tete_coherent(et, Some(&e)), attendu, "{et:?} {e:?}");
                    }
                }
            }
            // Sorte inconnue : le bit volatil est libre, la règle non.
            let e = env(
                regle,
                Message::Inconnu {
                    sorte: "appel".into(),
                },
            );
            for v in [false, true] {
                assert_eq!(
                    en_tete_coherent(EnTete { volatile: v, regle }, Some(&e)),
                    Ok(())
                );
            }
        }
        // Contrôle MLS (Commit, Welcome, KeyPackage) : non volatil, désactivé, seulement.
        for v in [false, true] {
            for r in regles {
                let et = EnTete {
                    volatile: v,
                    regle: r,
                };
                let ok = et == EN_TETE_CONTROLE;
                assert_eq!(en_tete_coherent(et, None).is_ok(), ok, "{et:?}");
            }
        }
        assert_eq!(EN_TETE_CONTROLE.drapeaux(), 0);
    }

    /// La forme à nonce donné (interne) redonne chaque trame scellée de salon-v3.json.
    #[test]
    fn vecteurs_a_nonce_donne() {
        let v: serde_json::Value =
            serde_json::from_str(include_str!("../../vectors/salon-v3.json")).unwrap();
        let unhex = |s: &str| -> Vec<u8> {
            (0..s.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
                .collect()
        };
        let mut n = 0;
        for c in v["trames"]["seal"].as_array().unwrap() {
            let Some(attendu) = c["seal"]["trame_hex"].as_str() else {
                continue;
            };
            let cles = crate::cles_salon(
                &KLien::from_slice(&unhex(c["k_lien"].as_str().unwrap())).unwrap(),
                &KMdp::from_slice(&unhex(c["k_mdp"].as_str().unwrap())).unwrap(),
            );
            let et = EnTete {
                volatile: c["en_tete"]["volatile"].as_bool().unwrap(),
                regle: Regle::depuis_bits(c["en_tete"]["regle"].as_u64().unwrap() as u8),
            };
            let o = ouvrir(&cles, &unhex(attendu)).unwrap().1;
            let nonce: [u8; 24] = unhex(c["nonce"].as_str().unwrap()).try_into().unwrap();
            let t = sceller_avec_nonce(&cles, et, &o, &nonce).unwrap();
            assert_eq!(t.to_vec(), unhex(attendu), "{}", c["label"]);
            n += 1;
        }
        assert!(n > 5);
    }

    #[test]
    fn nonce_different_chiffre_different() {
        let c = cles(1);
        let a = sceller_avec_nonce(&c, ET, b"salut", &[1; 24]).unwrap();
        let b = sceller_avec_nonce(&c, ET, b"salut", &[2; 24]).unwrap();
        assert_ne!(a[DEBUT_CHIFFRE..], b[DEBUT_CHIFFRE..]);
    }
}
