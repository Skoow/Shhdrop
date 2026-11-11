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
    /// L'aléa de la plateforme a échoué (`getRandomValues` qui lève, générateur du système
    /// indisponible) : jamais de tampon nul utilisé à la place.
    AleatoireIndisponible,
    /// Erreur unique de toute ouverture (taille, tag, autre id, autre en-tête, autre clé,
    /// engagement faux) : aucun oracle sur la cause.
    PaquetCorrompu,
    /// Graine de contenu R qui ne fait pas 32 octets (`checkSeed`).
    GraineInvalide,
    /// Le fournisseur n'a pas pu importer une clé ou chiffrer (lot mal formé, poignée inconnue,
    /// échec de WebCrypto) : jamais un échec d'ouverture, qui reste `PaquetCorrompu`.
    ChiffrementEchec,
    /// `bucketFor` : fin des données au-delà de 2^53 − 1 (`Number.isSafeInteger`).
    TailleNonSure,
    /// Données au-delà du plus grand palier (2 Gio).
    TropGros,
    /// Droits de création inconnus, « coffre » sans durée valide, ou durée hors « coffre ».
    DroitsInvalides,
    /// `elementSealer` : petit élément à cheval sur deux segments, ou élément d'un segment ou plus
    /// hors d'une frontière de segment.
    PlaceInvalide,
    /// Pièce demandée qui n'existe pas (indice hors de `pieces`).
    SegmentInvalide,
    /// Pièce déjà chiffrée une fois : jamais deux chiffrements sous la même clé et le même nonce.
    SegmentDejaProduit,
    /// Octets lus par l'hôte qui ne font pas exactement la plage demandée (fichier modifié).
    LectureIncomplete,
    /// `sealFinal` : aucun élément gardé.
    Vide,
    /// Manifeste de plus de MANIFEST_MAX octets, ou de plus de MAX_ITEMS éléments.
    ManifesteTropGros,
    /// Note de plus de 4 × TEXT_MAX octets UTF-8, ou de plus de TEXT_MAX points de code.
    TexteTropLong,
    /// Note qui n'est pas de l'UTF-8 strict, ou dont le scelleur n'a pas chiffré le texte.
    TexteInvalide,
    /// Deux éléments gardés qui partagent un morceau.
    Chevauchement,
    /// K_contenu qui a déjà chiffré un manifeste : une finalisation tire une R neuve.
    CleDejaUtilisee,
    /// Lecteur : indice d'élément hors du manifeste.
    ElementInexistant,
    /// Lecteur : aperçu (`item`) d'un fichier de plus de PREVIEW_MAX octets, ou dont la mémoire est
    /// refusée ; `stream_item` le lit.
    TropGrosPourApercu,
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
            Error::AleatoireIndisponible => "aleatoire_indisponible",
            Error::PaquetCorrompu => "paquet_corrompu",
            Error::GraineInvalide => "graine invalide",
            Error::ChiffrementEchec => "chiffrement_echec",
            Error::TailleNonSure => "taille_invalide",
            Error::TropGros => "trop_gros",
            Error::DroitsInvalides => "droits_invalides",
            Error::PlaceInvalide => "place_invalide",
            Error::SegmentInvalide => "segment_invalide",
            Error::SegmentDejaProduit => "segment_deja_produit",
            Error::LectureIncomplete => "lecture_incomplete",
            Error::Vide => "vide",
            Error::ManifesteTropGros => "manifeste_trop_gros",
            Error::TexteTropLong => "texte_trop_long",
            Error::TexteInvalide => "texte_invalide",
            Error::Chevauchement => "chevauchement",
            Error::CleDejaUtilisee => "cle_deja_utilisee",
            Error::ElementInexistant => "element_inexistant",
            Error::TropGrosPourApercu => "trop_gros_pour_apercu",
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
        assert_eq!(
            Error::AleatoireIndisponible.to_string(),
            "aleatoire_indisponible"
        );
        assert_eq!(Error::PaquetCorrompu.to_string(), "paquet_corrompu");
        assert_eq!(Error::GraineInvalide.to_string(), "graine invalide");
        assert_eq!(Error::ChiffrementEchec.to_string(), "chiffrement_echec");
        assert_eq!(Error::TailleNonSure.to_string(), "taille_invalide");
        assert_eq!(Error::TropGros.to_string(), "trop_gros");
        assert_eq!(Error::DroitsInvalides.to_string(), "droits_invalides");
        assert_eq!(Error::PlaceInvalide.to_string(), "place_invalide");
        assert_eq!(Error::SegmentInvalide.to_string(), "segment_invalide");
        assert_eq!(
            Error::SegmentDejaProduit.to_string(),
            "segment_deja_produit"
        );
        assert_eq!(Error::LectureIncomplete.to_string(), "lecture_incomplete");
        assert_eq!(Error::Vide.to_string(), "vide");
        assert_eq!(Error::ManifesteTropGros.to_string(), "manifeste_trop_gros");
        assert_eq!(Error::TexteTropLong.to_string(), "texte_trop_long");
        assert_eq!(Error::TexteInvalide.to_string(), "texte_invalide");
        assert_eq!(Error::Chevauchement.to_string(), "chevauchement");
        assert_eq!(Error::CleDejaUtilisee.to_string(), "cle_deja_utilisee");
        assert_eq!(Error::ElementInexistant.to_string(), "element_inexistant");
        assert_eq!(
            Error::TropGrosPourApercu.to_string(),
            "trop_gros_pour_apercu"
        );
    }
}
