//! Règles d'effacement côté appareil (spec v3 §5, décision du propriétaire du 13 novembre) :
//! fonction pure, sans horloge ni E/S. Le temps est passé en paramètre (millisecondes) ;
//! l'arithmétique est saturante.
//!
//! - Règle 0 (`Desactive`) : le message reste jusqu'à la fin du salon ou à son renouvellement
//!   (`0x10`), que l'appareil applique à tout l'historique, hors de cette fonction.
//! - Règles 1, 2, 3 (`UneMinute`, `CinqMinutes`, `UneHeure`) : le serveur efface la trame 1 min,
//!   5 min ou 1 h après la **dernière** lecture par les lecteurs attendus (ou après le départ du
//!   dernier attendu), et diffuse un `0x0E`. **Le `0x0E` fait foi** : le moteur ne déclare jamais
//!   un tel message effacé avant lui. Il peut seulement afficher un compte à rebours local, depuis
//!   l'instant où **cet** appareil l'a vu ; le serveur ne peut effacer qu'après (la dernière
//!   lecture suit celle de cet appareil, ou l'envoi pour l'expéditeur), si bien que ce compte à
//!   rebours ne promet jamais un effacement plus tard que le vrai. Une fois écoulé sans `0x0E`
//!   (un autre lecteur attendu n'a pas encore lu), le message reste visible.

use crate::trame::Regle;

/// État d'un message à l'écran.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Etat {
    Visible,
    /// Compte à rebours local (au plus tôt) : effacement attendu vers `fin_ms`, jamais avant le
    /// `0x0E` du serveur. Rendu seulement tant que `maintenant_ms < fin_ms`.
    Rebours {
        fin_ms: u64,
    },
    Efface,
}

/// Délai d'effacement après la dernière lecture (règles 1 à 3) ; `None` pour la règle 0.
pub fn delai_ms(regle: Regle) -> Option<u64> {
    match regle {
        Regle::Desactive => None,
        Regle::UneMinute => Some(60_000),
        Regle::CinqMinutes => Some(300_000),
        Regle::UneHeure => Some(3_600_000),
    }
}

/// Calcule l'état d'un message pour cet appareil.
///
/// `vu_par_moi_ms` : instant (horloge de cet appareil, comme `maintenant_ms`) où cet appareil l'a
/// vu (affiché, page visible, 1 s ; pour l'expéditeur, l'envoi), ou `None`.
/// `efface_par_serveur` : un `0x0E` a été reçu pour cette trame. Ignoré pour la règle 0 (le
/// serveur n'en envoie jamais pour elle).
pub fn etat(
    regle: Regle,
    maintenant_ms: u64,
    vu_par_moi_ms: Option<u64>,
    efface_par_serveur: bool,
) -> Etat {
    let Some(d) = delai_ms(regle) else {
        return Etat::Visible;
    };
    if efface_par_serveur {
        return Etat::Efface;
    }
    match vu_par_moi_ms {
        Some(vu) if maintenant_ms < vu.saturating_add(d) => Etat::Rebours {
            fin_ms: vu.saturating_add(d),
        },
        _ => Etat::Visible,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAX: u64 = u64::MAX;
    const REGLES: [(Regle, u64); 3] = [
        (Regle::UneMinute, 60_000),
        (Regle::CinqMinutes, 300_000),
        (Regle::UneHeure, 3_600_000),
    ];

    #[test]
    fn desactive_toujours_visible() {
        for vu in [None, Some(0), Some(MAX)] {
            for e in [false, true] {
                assert_eq!(etat(Regle::Desactive, MAX, vu, e), Etat::Visible);
            }
        }
        assert_eq!(delai_ms(Regle::Desactive), None);
    }

    #[test]
    fn delais() {
        for (r, d) in REGLES {
            assert_eq!(delai_ms(r), Some(d));
        }
    }

    #[test]
    fn jamais_efface_sans_0x0e() {
        // Ni le temps écoulé ni la lecture locale n'effacent : seul le 0x0E du serveur.
        for (r, _) in REGLES {
            for vu in [None, Some(0), Some(1_000)] {
                for now in [0, 86_400_000, MAX] {
                    assert_ne!(etat(r, now, vu, false), Etat::Efface, "{r:?} {vu:?} {now}");
                }
            }
        }
    }

    #[test]
    fn efface_au_0x0e() {
        for (r, _) in REGLES {
            for vu in [None, Some(5), Some(MAX)] {
                assert_eq!(etat(r, 0, vu, true), Etat::Efface);
            }
        }
    }

    #[test]
    fn non_vu_visible() {
        for (r, _) in REGLES {
            for now in [0, 86_400_000, MAX] {
                assert_eq!(etat(r, now, None, false), Etat::Visible);
            }
        }
    }

    #[test]
    fn rebours_local_depuis_le_vu_de_cet_appareil() {
        for (r, d) in REGLES {
            let fin = 5_000 + d;
            assert_eq!(
                etat(r, 5_000, Some(5_000), false),
                Etat::Rebours { fin_ms: fin }
            );
            assert_eq!(
                etat(r, fin - 1, Some(5_000), false),
                Etat::Rebours { fin_ms: fin }
            );
            // Délai local écoulé sans 0x0E : un autre attendu n'a pas lu, le message reste.
            assert_eq!(etat(r, fin, Some(5_000), false), Etat::Visible);
            assert_eq!(etat(r, fin + 1, Some(5_000), false), Etat::Visible);
        }
    }

    #[test]
    fn arithmetique_saturante() {
        for (r, _) in REGLES {
            assert_eq!(
                etat(r, MAX - 1, Some(MAX - 10), false),
                Etat::Rebours { fin_ms: MAX }
            );
            assert_eq!(etat(r, MAX, Some(MAX - 10), false), Etat::Visible);
        }
    }
}
