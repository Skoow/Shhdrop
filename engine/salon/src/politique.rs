//! Politique d'adhésion du salon (spec v3 §3.6, « Règles retenues ») : chaque Commit reçu est
//! vérifié **avant fusion**. Seul le créateur retire autrui ; un membre peut retirer une
//! feuille de son propre siège ; un Commit qui ajoute la nouvelle feuille d'un siège peut
//! retirer l'ancienne (retour après rechargement, avec un nouveau `nonce_arrivee`) ; tout
//! membre peut retirer un siège que le serveur a dit parti (0x03) ou exclu (0x09) ; tout ajout
//! porte un `(siège, nonce_arrivee)` annoncé par le serveur (enregistrements 0x02 et 0x0A,
//! §39.3.1) **et la clé du KeyPackage que ce siège a lui-même publié** (le `nonce_arrivee` est
//! public : sans ce lien, n'importe quel membre fabriquerait la feuille d'un arrivant).
//! **13 novembre (relecture, à valider par le propriétaire)** : « parti ou exclu » se dit d'une
//! **arrivée** `(siège, nonce_arrivee)`, pas d'un numéro de siège ; le créateur est reconnu par
//! son siège **et** sa clé d'identité ; tant qu'une feuille est à retirer, tout Commit doit la
//! retirer (priorité du retrait).
//! **14 novembre (décision du propriétaire)** : la clé d'identité du créateur est la clé de rôle
//! tirée de `S_gestion` (`groupe::identite_createur`) ; elle n'est admise qu'au siège du créateur
//! (contrôle dans `groupe.rs`, qui connaît l'identifiant du groupe).
//! **Auteur** (audit du 13 novembre, F2) : un Commit dont l'auteur est un siège que le serveur a
//! dit parti ou exclu est refusé, quel que soit son contenu (un renouvellement lui redonnerait
//! les secrets de la nouvelle époque et ferait perdre le Commit qui le retire).
use crate::error::{Error, Result};

/// Une arrivée : siège, `nonce_arrivee` et SHA-256 de la clé de signature Ed25519 de sa
/// feuille.
pub type Arrivee = (u8, [u8; 16], [u8; 32]);

/// Ce qu'un Commit change, lu dans le Commit préparé (non fusionné) par `groupe.rs`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Changements {
    /// Chaque feuille ajoutée : credential `(siège, nonce_arrivee)` et empreinte de sa clé.
    pub ajouts: Vec<Arrivee>,
    /// `(siège, nonce_arrivee)` de la credential de chaque feuille retirée.
    pub retraits: Vec<(u8, [u8; 16])>,
    /// Sièges des feuilles qui restent dans le groupe (membres actuels non retirés).
    pub restants: Vec<u8>,
    /// Le Commit porte autre chose que des ajouts et retraits en ligne : proposition par
    /// référence ou d'un autre membre, autre type (Update, PSK, ReInit, ExternalInit,
    /// GroupContextExtensions, SelfRemove, Custom), credential illisible, KeyPackage d'une
    /// autre durée de vie que (0, u64::MAX), ou chemin qui change la credential ou la clé de
    /// signature de l'auteur.
    pub interdit: bool,
}

/// Vérifie un Commit ; `Err(CommitRefuse)` sinon (sans fusion).
/// `auteur_createur` : la feuille de l'auteur est celle du créateur (siège **et** clé d'identité
/// portés par l'identifiant du groupe, 13 novembre). `auteur` : credential `(siège,
/// nonce_arrivee)` de sa feuille. `a_retirer` : credentials des feuilles de l'arbre dont
/// l'arrivée est partie (0x03), exclue (0x09) ou inconnue du serveur : suivies par arrivée
/// `(siège, nonce_arrivee)`, pas par numéro de siège (une nouvelle arrivée sur le même siège
/// n'efface rien). `key_packages` : premier KeyPackage valide reçu pour chaque arrivée
/// annoncée, **envoyé par le siège même** (siège attesté par le serveur, enregistrement 0x01).
///
/// **Priorité du retrait** (13 novembre) : tant qu'il reste des feuilles à retirer, un Commit
/// qui ne les retire pas **toutes** est refusé. Sans cela, un membre encore admis qui enchaîne
/// des renouvellements ferait perdre sans fin la course au Commit de retrait, et tout envoi
/// resterait refusé (`retrait_en_attente`).
pub fn verifier(
    commit: &Changements,
    auteur_createur: bool,
    auteur: (u8, [u8; 16]),
    sieges_annonces: &[(u8, [u8; 16])],
    a_retirer: &[(u8, [u8; 16])],
    key_packages: &[Arrivee],
) -> Result<()> {
    let refus = Err(Error::CommitRefuse);
    if commit.interdit || a_retirer.contains(&auteur) {
        return refus;
    }
    if a_retirer.iter().any(|f| !commit.retraits.contains(f)) {
        return refus;
    }
    for (i, &(siege, nonce, cle)) in commit.ajouts.iter().enumerate() {
        // Siège annoncé avec ce nonce exactement (une annonce plus récente remplace l'ancienne).
        if !sieges_annonces.contains(&(siege, nonce)) {
            return refus;
        }
        // La feuille ajoutée est celle que le siège a publiée lui-même, pas une copie.
        if !key_packages.contains(&(siege, nonce, cle)) {
            return refus;
        }
        // Une seule feuille par siège après le Commit : ni deux ajouts du même siège, ni un
        // ajout à côté d'une feuille du même siège qui reste.
        if commit.ajouts[..i].iter().any(|a| a.0 == siege) || commit.restants.contains(&siege) {
            return refus;
        }
        // Un retour exige un nouveau nonce : rajouter la feuille retirée (même arrivée), c'est
        // rejouer un ancien KeyPackage, qui chasserait la feuille vivante du siège.
        if commit.retraits.contains(&(siege, nonce)) {
            return refus;
        }
    }
    for retrait in &commit.retraits {
        let permis = auteur_createur
            || retrait.0 == auteur.0
            || a_retirer.contains(retrait)
            || commit.ajouts.iter().any(|a| a.0 == retrait.0);
        if !permis {
            return refus;
        }
    }
    Ok(())
}
