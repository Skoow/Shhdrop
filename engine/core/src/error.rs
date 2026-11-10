//! Erreurs du moteur : une variante par message, et `Display` donne le message exact des
//! fonctions TypeScript remplacées (le site les affiche ou les compare tels quels). Les tâches
//! suivantes ajoutent leurs variantes ici.
use core::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    /// `unb64u` : caractère hors alphabet, longueur impossible ou bits de bourrage non nuls.
    Base64Invalide,
    /// `check_origin` : origine qui n'est pas exactement `https://hôte[:port]` (ou http local).
    OrigineInvalide,
    /// Base de dépôt qui n'est pas `/` ou `/seg/…/`.
    BaseInvalide,
    /// Lien de partage ou de gestion illisible ou refusé.
    LienInvalide,
    /// `passwordKey` : mot de passe vide.
    MotDePasseVide,
    /// `passwordKeyForCreate` : mot de passe qui n'a pas la forme de `generatePassword`.
    MotDePasseNonGenere,
    /// `checkKdfParams` : paramètres au-dessus du plafond (KDF_MAX).
    KdfInvalides,
    /// `checkKdfParams` : paramètres en dessous du minimum (KDF_MIN).
    KdfTropFaibles,
    /// K_lien, K_mdp ou sel de mauvaise taille.
    TailleInvalide,
    /// Argon2id n'a pas pu s'exécuter (mémoire de 64 Mio refusée) : message de `argon2-run.ts`.
    Argon2Echec,
}

impl Error {
    /// Message exact, identique à celui de l'ancien moteur TypeScript.
    pub const fn message(self) -> &'static str {
        match self {
            Error::Base64Invalide => "base64url invalide",
            Error::OrigineInvalide => "origine_invalide",
            Error::BaseInvalide => "base_invalide",
            Error::LienInvalide => "lien_invalide",
            Error::MotDePasseVide => "mot_de_passe_vide",
            Error::MotDePasseNonGenere => "mot_de_passe_non_genere",
            Error::KdfInvalides => "paramètres KDF invalides",
            Error::KdfTropFaibles => "paramètres KDF trop faibles",
            Error::TailleInvalide => "clé ou sel de taille invalide",
            Error::Argon2Echec => "argon2_echec",
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for Error {}

pub type Result<T> = core::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    use super::Error;

    #[test]
    fn messages_exacts() {
        assert_eq!(Error::Base64Invalide.to_string(), "base64url invalide");
        assert_eq!(Error::OrigineInvalide.to_string(), "origine_invalide");
        assert_eq!(Error::BaseInvalide.to_string(), "base_invalide");
        assert_eq!(Error::LienInvalide.to_string(), "lien_invalide");
        assert_eq!(Error::MotDePasseVide.to_string(), "mot_de_passe_vide");
        assert_eq!(
            Error::MotDePasseNonGenere.to_string(),
            "mot_de_passe_non_genere"
        );
        assert_eq!(Error::KdfInvalides.to_string(), "paramètres KDF invalides");
        assert_eq!(
            Error::KdfTropFaibles.to_string(),
            "paramètres KDF trop faibles"
        );
        assert_eq!(
            Error::TailleInvalide.to_string(),
            "clé ou sel de taille invalide"
        );
        assert_eq!(Error::Argon2Echec.to_string(), "argon2_echec");
    }
}
