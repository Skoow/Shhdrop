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
    }
}
