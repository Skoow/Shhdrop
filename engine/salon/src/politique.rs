//! Politique d'adhésion du salon (spec v3 §3.6, « Règles retenues ») : chaque Commit reçu est
//! vérifié **avant fusion**. Seul le créateur retire autrui ; un membre peut retirer une
//! feuille de son propre siège ; un Commit qui ajoute la nouvelle feuille d'un siège peut
//! retirer l'ancienne (retour après rechargement, avec un nouveau `nonce_arrivee`) ; tout
//! membre peut retirer un siège que le serveur a dit parti (0x03) ou exclu (0x09) ; tout ajout
//! porte un `(siège, nonce_arrivee)` annoncé par le serveur (enregistrements 0x02 et 0x0A,
//! §39.3.1).
use crate::error::{Error, Result};

/// Ce qu'un Commit change, lu dans le Commit préparé (non fusionné) par `groupe.rs`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Changements {
    /// `(siège, nonce_arrivee)` de la credential de chaque feuille ajoutée.
    pub ajouts: Vec<(u8, [u8; 16])>,
    /// `(siège, nonce_arrivee)` de la credential de chaque feuille retirée.
    pub retraits: Vec<(u8, [u8; 16])>,
    /// Sièges des feuilles qui restent dans le groupe (membres actuels non retirés).
    pub restants: Vec<u8>,
    /// Le Commit porte autre chose que des ajouts et retraits en ligne : proposition par
    /// référence ou d'un autre membre, autre type (Update, PSK, ReInit, ExternalInit,
    /// GroupContextExtensions, SelfRemove, Custom), credential illisible, ou chemin qui
    /// change la credential ou la clé de signature de l'auteur.
    pub interdit: bool,
}

/// Vérifie un Commit de l'auteur `auteur_siege` ; `Err(CommitRefuse)` sinon (sans fusion).
/// `sieges_partis` : sièges que le serveur a dits partis (0x03) ou exclus (0x09).
pub fn verifier(
    commit: &Changements,
    createur_siege: u8,
    auteur_siege: u8,
    sieges_annonces: &[(u8, [u8; 16])],
    sieges_partis: &[u8],
) -> Result<()> {
    let refus = Err(Error::CommitRefuse);
    if commit.interdit {
        return refus;
    }
    for (i, ajout) in commit.ajouts.iter().enumerate() {
        // Siège annoncé avec ce nonce exactement (une annonce plus récente remplace l'ancienne).
        if !sieges_annonces.contains(ajout) {
            return refus;
        }
        // Une seule feuille par siège après le Commit : ni deux ajouts du même siège, ni un
        // ajout à côté d'une feuille du même siège qui reste.
        if commit.ajouts[..i].iter().any(|a| a.0 == ajout.0) || commit.restants.contains(&ajout.0) {
            return refus;
        }
        // Un retour exige un nouveau nonce : rajouter la feuille retirée (même arrivée), c'est
        // rejouer un ancien KeyPackage, qui chasserait la feuille vivante du siège.
        if commit.retraits.contains(ajout) {
            return refus;
        }
    }
    for &(siege, _) in &commit.retraits {
        let permis = auteur_siege == createur_siege
            || siege == auteur_siege
            || sieges_partis.contains(&siege)
            || commit.ajouts.iter().any(|a| a.0 == siege);
        if !permis {
            return refus;
        }
    }
    Ok(())
}
