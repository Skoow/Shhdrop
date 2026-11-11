//! Erreurs du salon : une variante par cause, `Display` en `snake_case` français. Les tâches
//! suivantes ajoutent leurs variantes ici.
use core::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    /// Erreur unique de toute ouverture de trame (taille, tag, en-tête, clé, bourrage) :
    /// aucun oracle sur la cause.
    TrameCorrompue,
    /// Texte vide après nettoyage ou pseudonyme hors des règles.
    TexteInvalide,
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
        assert_eq!(Error::TropGrand.to_string(), "trop_grand");
        assert_eq!(Error::EnTeteInvalide.to_string(), "en_tete_invalide");
    }
}
