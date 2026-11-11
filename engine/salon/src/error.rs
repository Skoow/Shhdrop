//! Erreurs du salon : une variante par cause, `Display` en `snake_case` français. Les tâches
//! suivantes ajoutent leurs variantes ici.
use core::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    /// Erreur unique de toute ouverture de trame (taille, tag, en-tête, clé, bourrage) :
    /// aucun oracle sur la cause.
    TrameCorrompue,
    /// Texte vide après nettoyage.
    TexteInvalide,
    /// Texte de plus de 2 000 graphèmes ou de plus de 3 500 octets (extrait : 140 graphèmes).
    TexteTropLong,
    /// Pseudonyme hors des règles de la spécification (§39.4, point 4).
    PseudoInvalide,
    /// Message (JSON) illisible, d'un mauvais format, ou champ hors des règles.
    MessageInvalide,
    /// Charge supérieure à `MAX_CHARGE` octets (à l'envoi : l'appelant connaît la cause).
    TropGrand,
    /// En-tête de trame illisible sans clé (taille, marque, bits réservés) : ne sert qu'à
    /// `lire_en_tete` ; `ouvrir` renvoie toujours `TrameCorrompue`.
    EnTeteInvalide,
    /// Message MLS d'une époque que ce membre n'a plus (plus d'une époque de retard) ou pas
    /// encore (Commit manqué).
    EpoquePerdue,
    /// Commit contraire à la politique d'adhésion : refusé avant fusion, l'état ne change pas.
    CommitRefuse,
    /// Ce salon n'est pas (ou plus) membre du groupe MLS.
    NonMembre,
    /// Octets MLS illisibles, mal formés, d'un autre groupe ou d'une forme refusée
    /// (GroupInfo, message en clair, external commit ou proposition externe).
    MlsInvalide,
    /// Un Commit de ce membre attend encore son écho du serveur.
    CommitEnCours,
    /// Déjà membre du groupe (rejoindre ou KeyPackage demandés deux fois).
    DejaMembre,
    /// Aucun membre du groupe n'occupe ce siège.
    SiegeInconnu,
    /// Erreur interne d'OpenMLS (aléa, stockage) : jamais causée par une entrée.
    MlsInterne,
}

pub type Result<T> = core::result::Result<T, Error>;

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Error::TrameCorrompue => "trame_corrompue",
            Error::TexteInvalide => "texte_invalide",
            Error::TexteTropLong => "texte_trop_long",
            Error::PseudoInvalide => "pseudo_invalide",
            Error::MessageInvalide => "message_invalide",
            Error::TropGrand => "trop_grand",
            Error::EnTeteInvalide => "en_tete_invalide",
            Error::EpoquePerdue => "epoque_perdue",
            Error::CommitRefuse => "commit_refuse",
            Error::NonMembre => "non_membre",
            Error::MlsInvalide => "mls_invalide",
            Error::CommitEnCours => "commit_en_cours",
            Error::DejaMembre => "deja_membre",
            Error::SiegeInconnu => "siege_inconnu",
            Error::MlsInterne => "mls_interne",
        })
    }
}

impl core::error::Error for Error {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_snake_case() {
        assert_eq!(Error::TrameCorrompue.to_string(), "trame_corrompue");
        assert_eq!(Error::TexteInvalide.to_string(), "texte_invalide");
        assert_eq!(Error::TexteTropLong.to_string(), "texte_trop_long");
        assert_eq!(Error::PseudoInvalide.to_string(), "pseudo_invalide");
        assert_eq!(Error::MessageInvalide.to_string(), "message_invalide");
        assert_eq!(Error::TropGrand.to_string(), "trop_grand");
        assert_eq!(Error::EnTeteInvalide.to_string(), "en_tete_invalide");
        assert_eq!(Error::EpoquePerdue.to_string(), "epoque_perdue");
        assert_eq!(Error::CommitRefuse.to_string(), "commit_refuse");
        assert_eq!(Error::NonMembre.to_string(), "non_membre");
        assert_eq!(Error::MlsInvalide.to_string(), "mls_invalide");
        assert_eq!(Error::CommitEnCours.to_string(), "commit_en_cours");
        assert_eq!(Error::DejaMembre.to_string(), "deja_membre");
        assert_eq!(Error::SiegeInconnu.to_string(), "siege_inconnu");
        assert_eq!(Error::MlsInterne.to_string(), "mls_interne");
    }
}
