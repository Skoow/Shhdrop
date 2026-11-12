//! Règles d'effacement côté appareil (spec v3 §5) : fonctions pures, sans horloge ni E/S.
//! Le temps est passé en paramètre (millisecondes) ; l'arithmétique est saturante.

use crate::trame::Regle;

/// État d'un message à l'écran.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Etat {
    Visible,
    /// Compte à rebours : le message s'efface à `fin_ms` (inclus).
    Rebours {
        fin_ms: u64,
    },
    Efface,
}

/// Calcule l'état d'un message pour cet appareil.
///
/// `envoye_ms` : **heure de réception de la trame par le serveur**, remise avec elle (spec v3
/// §3.6.1, exigence C-2 6), jamais `heure_ms` de l'enveloppe, que l'expéditeur choisit (il
/// pourrait sinon allonger ou raccourcir 10 min et 1 h).
/// `vu_par_moi_ms` : instant où ce lecteur l'a vu (affiché, page visible, 1 s).
/// `encore_dans_conversation` : le lecteur n'a pas quitté la conversation depuis.
/// `lu_par_tous` : tous les participants encore présents l'ont lu.
pub fn etat(
    regle: Regle,
    envoye_ms: u64,
    maintenant_ms: u64,
    moi_expediteur: bool,
    vu_par_moi_ms: Option<u64>,
    encore_dans_conversation: bool,
    lu_par_tous: bool,
) -> Etat {
    let avec_echeance = |fin_ms: u64| {
        if maintenant_ms >= fin_ms {
            Etat::Efface
        } else {
            Etat::Rebours { fin_ms }
        }
    };
    match regle {
        Regle::Desactive => Etat::Visible,
        Regle::DixMinutes => avec_echeance(envoye_ms.saturating_add(600_000)),
        Regle::UneHeure => avec_echeance(envoye_ms.saturating_add(3_600_000)),
        Regle::Instantane => {
            if lu_par_tous {
                return Etat::Efface;
            }
            match vu_par_moi_ms {
                _ if moi_expediteur => Etat::Visible,
                None => Etat::Visible,
                Some(_) if !encore_dans_conversation => Etat::Efface,
                Some(vu) => avec_echeance(vu.saturating_add(60_000)),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIX: u64 = 600_000;
    const HEURE: u64 = 3_600_000;

    #[allow(clippy::too_many_arguments)]
    fn e(
        r: Regle,
        env: u64,
        now: u64,
        exp: bool,
        vu: Option<u64>,
        reste: bool,
        tous: bool,
    ) -> Etat {
        etat(r, env, now, exp, vu, reste, tous)
    }

    #[test]
    fn desactive_toujours_visible() {
        for exp in [false, true] {
            assert_eq!(
                e(Regle::Desactive, 0, u64::MAX, exp, Some(1), false, true),
                Etat::Visible
            );
        }
    }

    #[test]
    fn dix_minutes_et_une_heure_rebours_puis_efface_pour_tous() {
        for (r, d) in [(Regle::DixMinutes, DIX), (Regle::UneHeure, HEURE)] {
            for exp in [false, true] {
                for vu in [None, Some(1_500)] {
                    assert_eq!(
                        e(r, 1_000, 2_000, exp, vu, true, false),
                        Etat::Rebours { fin_ms: 1_000 + d }
                    );
                    assert_eq!(e(r, 1_000, 1_000 + d, exp, vu, true, false), Etat::Efface);
                }
            }
        }
    }

    #[test]
    fn instantane_expediteur_visible_tant_que_pas_lu_par_tous() {
        let i = Regle::Instantane;
        assert_eq!(e(i, 0, u64::MAX, true, None, true, false), Etat::Visible);
        assert_eq!(e(i, 0, 5, true, None, false, false), Etat::Visible);
        assert_eq!(e(i, 0, 5, true, None, true, true), Etat::Efface);
    }

    #[test]
    fn instantane_lecteur_non_vu_visible() {
        let i = Regle::Instantane;
        assert_eq!(e(i, 0, 5, false, None, true, false), Etat::Visible);
        assert_eq!(e(i, 0, 5, false, None, false, false), Etat::Visible);
    }

    #[test]
    fn instantane_vu_et_reste_rebours_une_minute() {
        let i = Regle::Instantane;
        assert_eq!(
            e(i, 0, 10_000, false, Some(5_000), true, false),
            Etat::Rebours { fin_ms: 65_000 }
        );
        assert_eq!(
            e(i, 0, 70_000, false, Some(5_000), true, false),
            Etat::Efface
        );
    }

    #[test]
    fn instantane_vu_puis_sorti_efface() {
        assert_eq!(
            e(
                Regle::Instantane,
                0,
                6_000,
                false,
                Some(5_000),
                false,
                false
            ),
            Etat::Efface
        );
    }

    #[test]
    fn instantane_lu_par_tous_efface_pour_tous() {
        let i = Regle::Instantane;
        assert_eq!(e(i, 0, 5, false, None, true, true), Etat::Efface);
        assert_eq!(e(i, 0, 5, false, Some(1), true, true), Etat::Efface);
        assert_eq!(e(i, 0, 5, true, None, true, true), Etat::Efface);
    }

    #[test]
    fn instantane_absent_puis_revient() {
        // Non vu : visible quel que soit le temps écoulé (même après des jours).
        for now in [0, 86_400_000, u64::MAX] {
            assert_eq!(
                e(Regle::Instantane, 0, now, false, None, true, false),
                Etat::Visible
            );
        }
    }

    #[test]
    fn bornes() {
        let i = Regle::Instantane;
        assert_eq!(
            e(i, 0, 64_999, false, Some(5_000), true, false),
            Etat::Rebours { fin_ms: 65_000 }
        );
        assert_eq!(
            e(i, 0, 65_000, false, Some(5_000), true, false),
            Etat::Efface
        );
        let r = Regle::DixMinutes;
        assert_eq!(
            e(r, 0, DIX - 1, false, None, true, false),
            Etat::Rebours { fin_ms: DIX }
        );
        assert_eq!(e(r, 0, DIX, false, None, true, false), Etat::Efface);
    }

    #[test]
    fn arithmetique_saturante() {
        let max = u64::MAX;
        assert_eq!(
            e(Regle::UneHeure, max, max, false, None, true, false),
            Etat::Efface
        );
        assert_eq!(
            e(Regle::Instantane, 0, max - 1, false, Some(max), true, false),
            Etat::Rebours { fin_ms: max }
        );
        assert_eq!(
            e(Regle::Instantane, 0, max, false, Some(max), true, false),
            Etat::Efface
        );
    }
}
