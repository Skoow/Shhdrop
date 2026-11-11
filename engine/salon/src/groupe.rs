//! Groupe MLS du salon (spec v3 §3) sur OpenMLS 0.9.2 : suite 0x0001, `PURE_CIPHERTEXT`, arbre
//! dans le Welcome, `max_past_epochs(1)`, aucun GroupInfo publié, aucun external commit ni
//! aucune proposition (externe ou d'un membre) acceptés.
//!
//! **Ordre des Commits** : le serveur numérote les trames (`seq`) et renvoie chacune à son
//! expéditeur. Un Commit créé ici reste *en attente* (non fusionné) jusqu'à son écho : le
//! premier Commit de l'époque dans l'ordre `seq` gagne chez tous. Si un Commit d'un autre
//! membre arrive avant l'écho du nôtre, le nôtre est abandonné (`clear_pending_commit`) et
//! `recevoir` rend `CommitPerdu` : l'appelant rejoue son intention (ajout, retrait,
//! renouvellement). Les Commits plus anciens que l'époque courante sont ignorés.
//!
//! Notre Commit gagnant revient en `CommitAccepte { welcome }` : le Welcome d'un ajout n'est
//! rendu qu'à ce moment, jamais avec le Commit.
//!
//! **Politique** (`politique.rs`) : vérifiée avant fusion sur chaque Commit reçu, sur nos
//! propres Commits à leur création et de nouveau à leur écho (les annonces ont pu changer).
//!
//! **Annonces du serveur (contrat de l'appelant)** : la politique dépend de ce que le serveur
//! a annoncé ; deux membres qui n'en savent pas autant divergent (l'un fusionne, l'autre
//! refuse et reste en arrière). L'appelant doit donc donner à `remplacer_annonces` la liste
//! complète `(siège, nonce_arrivee)` reçue à l'accueil du WebSocket (et à chaque
//! reconnexion) **avant tout `recevoir`**, puis chaque 0x02 / 0x0A à `annoncer` et chaque
//! 0x03 / 0x09 à `marquer_parti`, dans l'ordre `seq`, avant les trames qui les suivent.
//! Chaque trame va à `recevoir` avec le siège que le serveur atteste l'avoir envoyée, **y
//! compris en attente d'entrer** et pour la file rejouée à la (re)connexion : un ajout n'est
//! accepté que si l'on a vu le KeyPackage publié par le siège même de l'arrivant.
//!
//! **Membres fantômes (risque accepté, décision du 11 novembre)** : un serveur malveillant
//! peut annoncer un siège pour un KeyPackage à lui ; le membre désigné l'ajoutera, et ce
//! « membre » lira la suite. MLS ne peut pas l'empêcher sans service d'authentification ;
//! seuls les codes de vérification (`empreinte`, comparés hors du salon) le révèlent.
//!
//! **Siège du créateur** : porté par l'identifiant du groupe MLS (`tag_salon` ‖ siège), fixé
//! à la création et authentifié par MLS (contexte du groupe) chez tous les membres.
use crate::cles::ClesSalon;
use crate::error::{Error, Result};
use crate::message::{Enveloppe, decoder, encoder};
use crate::politique::{self, Changements};
use crate::stockage::Fournisseur;
use crate::trame::MAX_CHARGE;
use openmls::framing::errors::{MessageDecryptionError, SecretTreeError};
use openmls::prelude::tls_codec::{Deserialize as _, Serialize as _};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_traits::storage::StorageProvider as _;
use shhdrop_core::kdf::sha256;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

const SUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
/// Étiquette de l'exporteur MLS (Global Constraints du plan C-1).
const SFRAME: &str = "shhdrop/v2/salon/sframe";
/// Préfixe du code de vérification (spec v3 §9, point 4).
const VERIF: &[u8] = b"shhdrop/v2/salon/verif";

/// Code de vérification d'une clé publique Ed25519 (spec v3 §9, point 4) : SHA-256(« shhdrop/v2/salon/verif »
/// ‖ clé), quatre `u32` gros-boutistes pris modulo 100 000, 5 chiffres chacun, séparés par une espace.
pub fn code_verification(cle_publique: &[u8; 32]) -> String {
    let mut entree = VERIF.to_vec();
    entree.extend_from_slice(cle_publique);
    let h = sha256(&entree);
    let groupes: Vec<String> = h[..16]
        .as_chunks::<4>()
        .0
        .iter()
        .map(|c| format!("{:05}", u32::from_be_bytes(*c) % 100_000))
        .collect();
    groupes.join(" ")
}

/// Credential basique : siège (1 octet) ‖ `nonce_arrivee` (16 octets).
const TAILLE_CREDENTIAL: usize = 17;

/// Identité éphémère d'un participant : paire Ed25519 tirée à l'entrée, en mémoire seulement.
/// La clé privée (`SignatureKeyPair`, `SecretVLBytes`) est effacée à la destruction par
/// `tls_codec` ; elle n'est jamais exposée.
#[derive(ZeroizeOnDrop)]
pub struct Identite {
    #[zeroize(skip)]
    signataire: SignatureKeyPair,
    siege: u8,
    nonce_arrivee: [u8; 16],
}

impl Identite {
    pub fn siege(&self) -> u8 {
        self.siege
    }

    /// Clé publique Ed25519 (32 octets), celle du code de vérification.
    pub fn cle_publique(&self) -> &[u8] {
        self.signataire.public()
    }

    fn credential(&self) -> CredentialWithKey {
        let mut contenu = Vec::with_capacity(TAILLE_CREDENTIAL);
        contenu.push(self.siege);
        contenu.extend_from_slice(&self.nonce_arrivee);
        CredentialWithKey {
            credential: BasicCredential::new(contenu).into(),
            signature_key: self.signataire.public().into(),
        }
    }
}

impl core::fmt::Debug for Identite {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "Identite(siège {})", self.siege)
    }
}

/// Tire une identité éphémère pour le siège et le `nonce_arrivee` donnés par le serveur.
pub fn nouvelle_identite(siege: u8, nonce_arrivee: [u8; 16]) -> Result<Identite> {
    let signataire =
        SignatureKeyPair::new(SUITE.signature_algorithm()).map_err(|_| Error::MlsInterne)?;
    Ok(Identite {
        signataire,
        siege,
        nonce_arrivee,
    })
}

/// Résultat de la réception d'un message MLS.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Evenement {
    /// Message applicatif ; `de_siege` vient de la credential (authentifiée) de l'expéditeur.
    Message { de_siege: u8, enveloppe: Enveloppe },
    /// Commit d'un autre membre fusionné : sièges ajoutés et retirés
    /// (un retour après rechargement figure dans les deux listes).
    Membres { ajoutes: Vec<u8>, retires: Vec<u8> },
    /// Notre Commit en attente a perdu (un autre Commit de l'époque est passé avant, ou la
    /// politique le refuse à son écho) : l'appelant rejoue son intention. `ajoutes` et
    /// `retires` : ce qu'a changé le Commit gagnant (vides si la politique a refusé le nôtre
    /// à son écho, sans autre Commit).
    CommitPerdu { ajoutes: Vec<u8>, retires: Vec<u8> },
    /// Notre Commit en attente est revenu le premier de son époque et a été fusionné ; pour
    /// un ajout, le Welcome à envoyer maintenant à l'arrivant.
    CommitAccepte { welcome: Option<Vec<u8>> },
    /// KeyPackage d'un arrivant annoncé (valide, suite 0x0001, siège et nonce annoncés, pas
    /// déjà dans le groupe) : à passer à `ajouter` par le membre désigné.
    KeyPackage { octets: Vec<u8> },
    /// Rien à faire : écho de notre message, Commit perdant d'une époque passée, rejeu (`seq`
    /// déjà vu), Welcome destiné à d'autres, KeyPackage périmé ou non annoncé, proposition
    /// (jamais gardée).
    Ignore,
}

/// Un participant du salon et son état MLS (en mémoire, stockage qui efface).
pub struct Salon {
    fournisseur: Fournisseur,
    identite: Identite,
    tag: [u8; 16],
    groupe: Option<MlsGroup>,
    createur_siege: u8,
    /// Dernière annonce `(siège, nonce_arrivee)` du serveur pour chaque siège.
    annonces: Vec<(u8, [u8; 16])>,
    /// Sièges que le serveur a dits partis (0x03) ou exclus (0x09), non repris depuis.
    partis: Vec<u8>,
    /// Premier KeyPackage valide de chaque arrivée annoncée, envoyé par son propre siège.
    key_packages: Vec<politique::Arrivee>,
    /// Siège du créateur donné par le serveur avec la liste complète (vérifié au Welcome).
    createur_annonce: Option<u8>,
    /// Une liste complète des sièges occupés a été donnée (`remplacer_annonces`).
    liste_complete: bool,
    /// Octets de notre Commit en attente de son écho, et le Welcome qu'il rendra s'il gagne.
    commit_en_attente: Option<(Vec<u8>, Option<Vec<u8>>)>,
    dernier_seq: Option<u64>,
}

impl core::fmt::Debug for Salon {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("Salon(…)")
    }
}

/// Durée de vie de toute feuille de KeyPackage : sans borne, pour qu'aucune décision du groupe
/// ne dépende de l'horloge d'un membre (un membre en retard d'une heure divergerait sinon).
fn vie_sans_horloge() -> Lifetime {
    Lifetime::init(0, u64::MAX)
}

fn vie_acceptee(kp: &KeyPackage) -> bool {
    let v = kp.life_time();
    (v.not_before(), v.not_after()) == (0, u64::MAX)
}

/// KeyPackage reçu en octets : valide (signature), suite 0x0001, durée de vie sans horloge.
fn lire_key_package(kp: KeyPackageIn, crypto: &impl OpenMlsCrypto) -> Result<KeyPackage> {
    let kp = kp
        .validate(crypto, ProtocolVersion::Mls10)
        .map_err(|_| Error::MlsInvalide)?;
    if kp.ciphersuite() != SUITE || !vie_acceptee(&kp) {
        return Err(Error::MlsInvalide);
    }
    Ok(kp)
}

fn config_creation() -> MlsGroupCreateConfig {
    MlsGroupCreateConfig::builder()
        .lifetime(vie_sans_horloge())
        .ciphersuite(SUITE)
        .use_ratchet_tree_extension(true)
        .wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
        .max_past_epochs(1)
        .build()
}

fn config_jonction() -> MlsGroupJoinConfig {
    MlsGroupJoinConfig::builder()
        .use_ratchet_tree_extension(true)
        .wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
        .max_past_epochs(1)
        .build()
}

/// `(siège, nonce_arrivee)` d'une credential basique de 17 octets.
fn lire_credential(c: &Credential) -> Result<(u8, [u8; 16])> {
    if c.credential_type() != CredentialType::Basic {
        return Err(Error::MlsInvalide);
    }
    let basique = BasicCredential::try_from(c.clone()).map_err(|_| Error::MlsInvalide)?;
    let id = basique.identity();
    if id.len() != TAILLE_CREDENTIAL {
        return Err(Error::MlsInvalide);
    }
    let mut nonce = [0u8; 16];
    nonce.copy_from_slice(&id[1..]);
    Ok((id[0], nonce))
}

fn lire_mls(octets: &[u8]) -> Result<MlsMessageBodyIn> {
    if octets.len() > MAX_CHARGE {
        return Err(Error::TropGrand);
    }
    MlsMessageIn::tls_deserialize_exact(octets)
        .map(MlsMessageIn::extract)
        .map_err(|_| Error::MlsInvalide)
}

fn serialiser(m: &MlsMessageOut) -> Result<Vec<u8>> {
    m.tls_serialize_detached().map_err(|_| Error::MlsInterne)
}

/// Erreurs d'OpenMLS à la réception : l'époque perdue est distinguée, le reste est une entrée
/// invalide (aucune panique, aucun détail de plus).
fn erreur_reception<E>(e: ProcessMessageError<E>) -> Error {
    match e {
        ProcessMessageError::ValidationError(
            ValidationError::WrongEpoch
            | ValidationError::NoPastEpochData
            | ValidationError::UnableToDecrypt(MessageDecryptionError::SecretTreeError(
                SecretTreeError::TooDistantInThePast,
            )),
        ) => Error::EpoquePerdue,
        ProcessMessageError::GroupStateError(MlsGroupStateError::UseAfterEviction) => {
            Error::NonMembre
        }
        _ => Error::MlsInvalide,
    }
}

/// Lit ce que change un Commit préparé de l'auteur `auteur` (feuille), avant fusion.
fn changements(groupe: &MlsGroup, commit: &StagedCommit, auteur: LeafNodeIndex) -> Changements {
    let mut ch = Changements::default();
    let mut retirees = Vec::new();
    for qp in commit.queued_proposals() {
        if qp.proposal_or_ref_type() != ProposalOrRefType::Proposal
            || qp.sender() != &Sender::Member(auteur)
        {
            ch.interdit = true;
            continue;
        }
        match qp.proposal() {
            Proposal::Add(a) => {
                let feuille = a.key_package().leaf_node();
                if !vie_acceptee(a.key_package()) {
                    ch.interdit = true;
                }
                match lire_credential(feuille.credential()) {
                    Ok((s, n)) => {
                        ch.ajouts
                            .push((s, n, sha256(feuille.signature_key().as_slice())))
                    }
                    Err(_) => ch.interdit = true,
                }
            }
            Proposal::Remove(r) => {
                let siege = groupe
                    .member_at(r.removed())
                    .and_then(|m| lire_credential(&m.credential).ok());
                match siege {
                    Some(c) => {
                        ch.retraits.push(c);
                        retirees.push(r.removed());
                    }
                    None => ch.interdit = true,
                }
            }
            _ => ch.interdit = true,
        }
    }
    // Le chemin du Commit ne change ni la credential (siège) ni la clé de l'auteur.
    if let Some(feuille) = commit.update_path_leaf_node() {
        let garde = groupe.member_at(auteur).is_some_and(|m| {
            feuille.credential() == &m.credential
                && feuille.signature_key().as_slice() == m.signature_key.as_slice()
        });
        if !garde {
            ch.interdit = true;
        }
    }
    for m in groupe.members() {
        if retirees.contains(&m.index) {
            continue;
        }
        match lire_credential(&m.credential) {
            Ok((s, _)) => ch.restants.push(s),
            Err(_) => ch.interdit = true,
        }
    }
    ch
}

fn membres_de(ch: &Changements) -> Evenement {
    Evenement::Membres {
        ajoutes: ch.ajouts.iter().map(|a| a.0).collect(),
        retires: ch.retraits.iter().map(|r| r.0).collect(),
    }
}

/// Feuilles du siège `siege` (indices et credentials) et sièges des autres feuilles.
type Prevision = (Vec<LeafNodeIndex>, Vec<(u8, [u8; 16])>, Vec<u8>);

fn prevoir(groupe: &MlsGroup, siege: u8) -> Result<Prevision> {
    let (mut indices, mut retraits, mut restants) = (Vec::new(), Vec::new(), Vec::new());
    for m in groupe.members() {
        let c = lire_credential(&m.credential)?;
        if c.0 == siege {
            indices.push(m.index);
            retraits.push(c);
        } else {
            restants.push(c.0);
        }
    }
    Ok((indices, retraits, restants))
}

/// Sièges partis ou exclus : marqués (0x03, 0x09) ou, après une liste complète du serveur,
/// présents dans l'arbre mais absents des annonces.
fn partis_effectifs(
    groupe: &MlsGroup,
    partis: &[u8],
    annonces: &[(u8, [u8; 16])],
    liste_complete: bool,
) -> Vec<u8> {
    let mut p = partis.to_vec();
    if liste_complete {
        for m in groupe.members() {
            if let Ok((s, _)) = lire_credential(&m.credential)
                && !annonces.iter().any(|a| a.0 == s)
                && !p.contains(&s)
            {
                p.push(s);
            }
        }
    }
    p
}

impl Salon {
    /// Nouveau participant. `createur` : il crée le groupe MLS (premier membre, seul à pouvoir
    /// retirer autrui) ; sinon il attend un Welcome (`key_package`, puis `rejoindre`).
    pub fn creer(identite: Identite, cles: ClesSalon, createur: bool) -> Result<Salon> {
        let mut salon = Salon {
            fournisseur: Fournisseur::default(),
            tag: *cles.tag(),
            createur_siege: identite.siege,
            identite,
            groupe: None,
            annonces: Vec::new(),
            partis: Vec::new(),
            key_packages: Vec::new(),
            createur_annonce: None,
            liste_complete: false,
            commit_en_attente: None,
            dernier_seq: None,
        };
        drop(cles);
        if createur {
            let mut id = salon.tag.to_vec();
            id.push(salon.identite.siege);
            let groupe = MlsGroup::new_with_group_id(
                &salon.fournisseur,
                &salon.identite.signataire,
                &config_creation(),
                GroupId::from_slice(&id),
                salon.identite.credential(),
            )
            .map_err(|_| Error::MlsInterne)?;
            salon.groupe = Some(groupe);
        }
        Ok(salon)
    }

    /// KeyPackage à publier à l'arrivée (MlsMessage). Ses clés privées restent dans ce salon.
    pub fn key_package(&self) -> Result<Vec<u8>> {
        if self.groupe.is_some() {
            return Err(Error::DejaMembre);
        }
        // « Last resort » : OpenMLS n'efface pas la clé d'init au premier Welcome lu ; un faux
        // Welcome refusé ne grille donc pas le KeyPackage. `rejoindre` l'efface après l'entrée.
        let paquet = KeyPackage::builder()
            .key_package_lifetime(vie_sans_horloge())
            .leaf_node_capabilities(Capabilities::new(
                None,
                None,
                Some(&[ExtensionType::LastResort]),
                None,
                None,
            ))
            .mark_as_last_resort()
            .build(
                SUITE,
                &self.fournisseur,
                &self.identite.signataire,
                self.identite.credential(),
            )
            .map_err(|_| Error::MlsInterne)?;
        serialiser(&MlsMessageOut::from(paquet.key_package().clone()))
    }

    /// Entre dans le groupe par un Welcome (arbre inclus) fait pour un KeyPackage de ce salon.
    /// Refus : autre salon, autre suite, extensions de contexte (expéditeurs externes…),
    /// credential illisible ou siège en double dans l'arbre.
    pub fn rejoindre(&mut self, welcome: &[u8]) -> Result<()> {
        if self.groupe.is_some() {
            return Err(Error::DejaMembre);
        }
        let MlsMessageBodyIn::Welcome(welcome) = lire_mls(welcome)? else {
            return Err(Error::MlsInvalide);
        };
        let utilises: Vec<KeyPackageRef> =
            welcome.secrets().iter().map(|e| e.new_member()).collect();
        let prepare =
            StagedWelcome::new_from_welcome(&self.fournisseur, &config_jonction(), welcome, None)
                .map_err(|_| Error::MlsInvalide)?;
        let contexte = prepare.group_context();
        let id = contexte.group_id().as_slice();
        if contexte.ciphersuite() != SUITE
            || id.len() != 17
            || id[..16] != self.tag
            || contexte.extensions().iter().next().is_some()
        {
            return Err(Error::MlsInvalide);
        }
        // Le créateur est celui que le serveur a donné ; chaque feuille d'un siège occupé porte
        // le nonce annoncé (et la clé retenue si son KeyPackage nous est passé). Une feuille
        // d'un siège absent de la liste est un parti pas encore retiré.
        let createur_siege = id[16];
        if self.createur_annonce != Some(createur_siege) {
            return Err(Error::MlsInvalide);
        }
        let mut sieges = Vec::new();
        for m in prepare.members() {
            let (s, n) = lire_credential(&m.credential)?;
            let annonce = self.annonces.iter().find(|a| a.0 == s);
            let cle = sha256(&m.signature_key);
            let retenu = self.key_packages.iter().find(|k| (k.0, k.1) == (s, n));
            if sieges.contains(&s)
                || annonce.is_some_and(|a| a.1 != n)
                || retenu.is_some_and(|k| k.2 != cle)
            {
                return Err(Error::MlsInvalide);
            }
            sieges.push(s);
        }
        let groupe = prepare
            .into_group(&self.fournisseur)
            .map_err(|_| Error::MlsInvalide)?;
        self.createur_siege = createur_siege;
        self.groupe = Some(groupe);
        // Entré : la clé d'init du KeyPackage ne sert plus (confidentialité persistante).
        for r in &utilises {
            self.fournisseur
                .storage()
                .delete_key_package(r)
                .map_err(|_| Error::MlsInterne)?;
        }
        Ok(())
    }

    /// Enregistre une arrivée annoncée par le serveur (0x02) ou une reprise de siège (0x0A) :
    /// remplace l'annonce précédente du même siège (qui n'est plus « parti »). À appeler dans
    /// l'ordre `seq`, avant le `recevoir` des trames suivantes, pour que tous les membres
    /// appliquent la même politique.
    pub fn annoncer(&mut self, siege: u8, nonce_arrivee: [u8; 16]) {
        self.partis.retain(|&p| p != siege);
        self.key_packages
            .retain(|k| k.0 != siege || k.1 == nonce_arrivee);
        self.annonces.retain(|a| a.0 != siege);
        self.annonces.push((siege, nonce_arrivee));
    }

    /// Liste complète des sièges occupés et de leur `nonce_arrivee`, donnée par le serveur à
    /// l'accueil du WebSocket (et à chaque reconnexion) avant toute trame : remplace toutes les
    /// annonces connues. Un siège présent dans l'arbre MLS mais absent de cette liste compte
    /// ensuite comme parti (retirable par tout membre), jusqu'à sa prochaine annonce.
    pub fn remplacer_annonces(&mut self, createur_siege: u8, liste: &[(u8, [u8; 16])]) {
        self.annonces.clear();
        for &(siege, nonce) in liste {
            self.annoncer(siege, nonce);
        }
        let annonces = &self.annonces;
        self.key_packages.retain(|k| annonces.contains(&(k.0, k.1)));
        self.partis.clear();
        self.createur_annonce = Some(createur_siege);
        self.liste_complete = true;
    }

    /// Siège annoncé parti (0x03) ou exclu (0x09) par le serveur, dans l'ordre `seq` : tout
    /// membre peut alors en retirer la feuille ; son annonce est oubliée (une nouvelle arrivée
    /// sur ce siège sera annoncée de nouveau).
    pub fn marquer_parti(&mut self, siege: u8) {
        self.annonces.retain(|a| a.0 != siege);
        self.key_packages.retain(|k| k.0 != siege);
        if !self.partis.contains(&siege) {
            self.partis.push(siege);
        }
    }

    /// KeyPackage reçu dans le flux, envoyé par `emetteur` (siège attesté par le serveur). Le
    /// premier KeyPackage valide d'une arrivée annoncée, **envoyé par ce siège même**, est
    /// retenu (empreinte de sa clé) : seul lui pourra être ajouté. Signalé (`KeyPackage`) aux
    /// membres s'il peut l'être ; retenu aussi en attente d'entrer (rendu `Ignore`).
    fn key_package_recu(
        &mut self,
        kp: KeyPackageIn,
        octets: &[u8],
        emetteur: u8,
    ) -> Result<Evenement> {
        let kp = lire_key_package(kp, self.fournisseur.crypto())?;
        let (siege, nonce) = lire_credential(kp.leaf_node().credential())?;
        if emetteur != siege || !self.annonces.contains(&(siege, nonce)) {
            return Ok(Evenement::Ignore);
        }
        let cle = sha256(kp.leaf_node().signature_key().as_slice());
        match self
            .key_packages
            .iter()
            .find(|k| (k.0, k.1) == (siege, nonce))
        {
            Some(k) if k.2 != cle => return Ok(Evenement::Ignore),
            Some(_) => {}
            None => self.key_packages.push((siege, nonce, cle)),
        }
        let Some(groupe) = self.groupe.as_ref() else {
            return Ok(Evenement::Ignore);
        };
        let deja = groupe
            .members()
            .any(|m| lire_credential(&m.credential).is_ok_and(|c| c == (siege, nonce)));
        if deja {
            return Ok(Evenement::Ignore);
        }
        Ok(Evenement::KeyPackage {
            octets: octets.to_vec(),
        })
    }

    /// Abandonne notre Commit en attente (et son Welcome) sans attendre son écho : à appeler
    /// après une reconnexion si l'écho n'est pas dans les trames rejouées (la trame s'est
    /// perdue). Attention : si l'écho arrive quand même ensuite, ce membre ne le fusionnera
    /// pas alors que les autres l'auront fait.
    pub fn abandonner_commit(&mut self) -> Result<()> {
        self.commit_en_attente = None;
        if let Some(g) = self.groupe.as_mut()
            && g.pending_commit().is_some()
        {
            g.clear_pending_commit(self.fournisseur.storage())
                .map_err(|_| Error::MlsInterne)?;
        }
        Ok(())
    }

    /// Groupe actif, sans Commit en attente : seul état où l'on peut faire un Commit.
    fn groupe_libre(&mut self) -> Result<&mut MlsGroup> {
        let groupe = self.groupe.as_mut().ok_or(Error::NonMembre)?;
        if !groupe.is_active() {
            return Err(Error::NonMembre);
        }
        if self.commit_en_attente.is_some() || groupe.pending_commit().is_some() {
            return Err(Error::CommitEnCours);
        }
        Ok(groupe)
    }

    /// Prépare un Commit (en attente de son écho) après vérification de la politique.
    fn commit(
        &mut self,
        ajout: Option<KeyPackage>,
        retraits: Vec<LeafNodeIndex>,
    ) -> Result<(Vec<u8>, Option<Vec<u8>>)> {
        let groupe = self.groupe.as_mut().ok_or(Error::NonMembre)?;
        let renouvellement = ajout.is_none() && retraits.is_empty();
        let mut constructeur = groupe.commit_builder().propose_removals(retraits);
        if let Some(kp) = ajout {
            constructeur = constructeur.propose_adds([kp]);
        }
        if renouvellement {
            constructeur = constructeur.force_self_update(true);
        }
        let paquet = constructeur
            .load_psks(self.fournisseur.storage())
            .map_err(|_| Error::MlsInterne)?
            .create_group_info(false)
            .build(
                self.fournisseur.rand(),
                self.fournisseur.crypto(),
                &self.identite.signataire,
                |_| true,
            )
            .map_err(|_| Error::MlsInvalide)?
            .stage_commit(&self.fournisseur)
            .map_err(|_| Error::MlsInvalide)?;
        // Contrôle final avant envoi : la politique sur le Commit réellement préparé, puis la
        // taille. Tout échec abandonne le Commit en attente (aucun état à moitié fait).
        let auteur = groupe.own_leaf_index();
        let verdict = (|| {
            let sc = groupe.pending_commit().ok_or(Error::MlsInterne)?;
            politique::verifier(
                &changements(groupe, sc, auteur),
                self.createur_siege,
                self.identite.siege,
                &self.annonces,
                &partis_effectifs(groupe, &self.partis, &self.annonces, self.liste_complete),
                &self.key_packages,
            )?;
            let commit = serialiser(paquet.commit())?;
            let welcome = paquet
                .to_welcome_msg()
                .map(|w| serialiser(&w))
                .transpose()?;
            if commit.len() > MAX_CHARGE || welcome.as_ref().is_some_and(|w| w.len() > MAX_CHARGE) {
                return Err(Error::TropGrand);
            }
            Ok((commit, welcome))
        })();
        match verdict {
            Ok((commit, welcome)) => {
                self.commit_en_attente = Some((commit.clone(), welcome.clone()));
                Ok((commit, welcome))
            }
            Err(e) => {
                groupe
                    .clear_pending_commit(self.fournisseur.storage())
                    .map_err(|_| Error::MlsInterne)?;
                Err(e)
            }
        }
    }

    /// Ajoute l'arrivant dont voici le KeyPackage (reçu en `Evenement::KeyPackage`) : rend le
    /// Commit seul. Si son siège a déjà une feuille (retour après rechargement), le même Commit
    /// la retire. Le Welcome est gardé ici et rendu par `recevoir` à l'écho gagnant du Commit
    /// (`CommitAccepte { welcome }`) ; si le Commit perd (`CommitPerdu`), il est jeté : il
    /// mènerait l'arrivant sur une branche morte.
    pub fn ajouter(&mut self, key_package: &[u8]) -> Result<Vec<u8>> {
        self.groupe_libre()?;
        let MlsMessageBodyIn::KeyPackage(kp) = lire_mls(key_package)? else {
            return Err(Error::MlsInvalide);
        };
        let kp = lire_key_package(kp, self.fournisseur.crypto())?;
        let (siege, nonce) = lire_credential(kp.leaf_node().credential())?;
        let groupe = self.groupe.as_ref().ok_or(Error::NonMembre)?;
        let (indices, retraits, restants) = prevoir(groupe, siege)?;
        let prevu = Changements {
            ajouts: vec![(
                siege,
                nonce,
                sha256(kp.leaf_node().signature_key().as_slice()),
            )],
            retraits,
            restants,
            interdit: false,
        };
        politique::verifier(
            &prevu,
            self.createur_siege,
            self.identite.siege,
            &self.annonces,
            &partis_effectifs(groupe, &self.partis, &self.annonces, self.liste_complete),
            &self.key_packages,
        )?;
        Ok(self.commit(Some(kp), indices)?.0)
    }

    /// Retire toutes les feuilles du siège : réservé au créateur, sauf siège parti ou exclu.
    pub fn retirer(&mut self, siege: u8) -> Result<Vec<u8>> {
        self.groupe_libre()?;
        let groupe = self.groupe.as_ref().ok_or(Error::NonMembre)?;
        let (indices, retraits, restants) = prevoir(groupe, siege)?;
        if indices.is_empty() {
            return Err(Error::SiegeInconnu);
        }
        // MLS ne laisse pas l'auteur se retirer lui-même par son propre Commit.
        if siege == self.identite.siege {
            return Err(Error::CommitRefuse);
        }
        let prevu = Changements {
            ajouts: vec![],
            retraits,
            restants,
            interdit: false,
        };
        politique::verifier(
            &prevu,
            self.createur_siege,
            self.identite.siege,
            &self.annonces,
            &partis_effectifs(groupe, &self.partis, &self.annonces, self.liste_complete),
            &self.key_packages,
        )?;
        Ok(self.commit(None, indices)?.0)
    }

    /// Renouvellement (self-update) : nouvelles clés de feuille et de chemin.
    pub fn renouveler(&mut self) -> Result<Vec<u8>> {
        self.groupe_libre()?;
        Ok(self.commit(None, Vec::new())?.0)
    }

    /// Chiffre une enveloppe (JSON strict de `encoder`) en message MLS à passer à `sceller`.
    pub fn chiffrer(&mut self, e: &Enveloppe) -> Result<Vec<u8>> {
        let groupe = self.groupe.as_mut().ok_or(Error::NonMembre)?;
        if !groupe.is_active() {
            return Err(Error::NonMembre);
        }
        let json = encoder(e)?;
        let message = groupe
            .create_message(&self.fournisseur, &self.identite.signataire, &json)
            .map_err(|_| Error::MlsInterne)?;
        let octets = serialiser(&message)?;
        if octets.len() > MAX_CHARGE {
            return Err(Error::TropGrand);
        }
        Ok(octets)
    }

    /// Traite un message MLS rangé au rang `seq` par le serveur ; `siege_emetteur` est le siège
    /// que le serveur atteste avoir envoyé la trame (enregistrement 0x01). Les rangs déjà vus
    /// (rejeu, rattrapage après reconnexion) sont ignorés ; une erreur consomme aussi le rang.
    /// En attente d'entrer, seuls les KeyPackages sont lus (retenus), le reste rend `NonMembre`.
    pub fn recevoir(&mut self, mls: &[u8], seq: u64, siege_emetteur: u8) -> Result<Evenement> {
        let en_attente = match self.groupe.as_ref() {
            Some(g) if g.is_active() => false,
            Some(_) => return Err(Error::NonMembre),
            None => true,
        };
        if self.dernier_seq.is_some_and(|d| seq <= d) {
            return Ok(Evenement::Ignore);
        }
        self.dernier_seq = Some(seq);
        if mls.len() > MAX_CHARGE {
            return Err(Error::TropGrand);
        }
        // En attente d'entrer : seuls les KeyPackages des autres arrivants comptent (retenus
        // pour la politique, qui s'appliquera aux Commits après l'entrée).
        if en_attente {
            return match lire_mls(mls) {
                Ok(MlsMessageBodyIn::KeyPackage(kp)) => {
                    self.key_package_recu(kp, mls, siege_emetteur)
                }
                _ => Err(Error::NonMembre),
            };
        }
        if self.commit_en_attente.as_ref().is_some_and(|c| c.0 == mls) {
            return self.confirmer_commit();
        }
        let protocole = match lire_mls(mls)? {
            MlsMessageBodyIn::PrivateMessage(p) => ProtocolMessage::from(p),
            MlsMessageBodyIn::Welcome(_) => return Ok(Evenement::Ignore),
            MlsMessageBodyIn::KeyPackage(kp) => {
                return self.key_package_recu(kp, mls, siege_emetteur);
            }
            // Message en clair (dont external commit et proposition externe) et GroupInfo :
            // jamais acceptés.
            _ => return Err(Error::MlsInvalide),
        };
        let groupe = self.groupe.as_mut().ok_or(Error::NonMembre)?;
        if protocole.group_id() != groupe.group_id() {
            return Err(Error::MlsInvalide);
        }
        let epoque = protocole.epoch().as_u64();
        let courante = groupe.epoch().as_u64();
        match protocole.content_type() {
            ContentType::Application => {
                if epoque > courante || courante - epoque > 1 {
                    return Err(Error::EpoquePerdue);
                }
            }
            ContentType::Commit => {
                if epoque < courante {
                    // Commit perdant (un autre est passé avant dans l'ordre `seq`).
                    return Ok(Evenement::Ignore);
                }
                if epoque > courante {
                    return Err(Error::EpoquePerdue);
                }
            }
            // Propositions : jamais gardées (aucune proposition par référence acceptée).
            ContentType::Proposal => return Ok(Evenement::Ignore),
        }
        let traite = groupe
            .process_message(&self.fournisseur, protocole)
            .map_err(erreur_reception)?;
        let Sender::Member(auteur) = *traite.sender() else {
            return Err(Error::MlsInvalide);
        };
        let (de_siege, _) = lire_credential(traite.credential())?;
        // Message de l'époque précédente : son auteur doit être encore une feuille de l'arbre
        // courant (un retiré qui ignore son retrait ne peut plus écrire à n-1).
        if epoque < courante
            && !groupe
                .members()
                .any(|m| &m.credential == traite.credential())
        {
            return Err(Error::NonMembre);
        }
        match traite.into_content() {
            ProcessedMessageContent::ApplicationMessage(a) => {
                let octets = Zeroizing::new(a.into_bytes());
                Ok(Evenement::Message {
                    de_siege,
                    enveloppe: decoder(&octets)?,
                })
            }
            ProcessedMessageContent::StagedCommitMessage(sc) => {
                let ch = changements(groupe, &sc, auteur);
                politique::verifier(
                    &ch,
                    self.createur_siege,
                    de_siege,
                    &self.annonces,
                    &partis_effectifs(groupe, &self.partis, &self.annonces, self.liste_complete),
                    &self.key_packages,
                )?;
                let perdu = self.commit_en_attente.take().is_some();
                if perdu {
                    groupe
                        .clear_pending_commit(self.fournisseur.storage())
                        .map_err(|_| Error::MlsInterne)?;
                }
                groupe
                    .merge_staged_commit(&self.fournisseur, *sc)
                    .map_err(|_| Error::MlsInterne)?;
                Ok(match (perdu, membres_de(&ch)) {
                    (true, Evenement::Membres { ajoutes, retires }) => {
                        Evenement::CommitPerdu { ajoutes, retires }
                    }
                    (_, membres) => membres,
                })
            }
            ProcessedMessageContent::OwnPrivateMessage => Ok(Evenement::Ignore),
            _ => Ok(Evenement::Ignore),
        }
    }

    /// Écho de notre Commit : la politique est revérifiée (annonces reçues entre-temps), puis
    /// fusion ; sinon il est abandonné comme un Commit perdu.
    fn confirmer_commit(&mut self) -> Result<Evenement> {
        let welcome = self.commit_en_attente.take().and_then(|c| c.1);
        let groupe = self.groupe.as_mut().ok_or(Error::NonMembre)?;
        let Some(sc) = groupe.pending_commit() else {
            return Err(Error::MlsInterne);
        };
        let ch = changements(groupe, sc, groupe.own_leaf_index());
        if politique::verifier(
            &ch,
            self.createur_siege,
            self.identite.siege,
            &self.annonces,
            &partis_effectifs(groupe, &self.partis, &self.annonces, self.liste_complete),
            &self.key_packages,
        )
        .is_err()
        {
            groupe
                .clear_pending_commit(self.fournisseur.storage())
                .map_err(|_| Error::MlsInterne)?;
            return Ok(Evenement::CommitPerdu {
                ajoutes: vec![],
                retires: vec![],
            });
        }
        groupe
            .merge_pending_commit(&self.fournisseur)
            .map_err(|_| Error::MlsInterne)?;
        Ok(Evenement::CommitAccepte { welcome })
    }

    fn groupe_actif(&self) -> Result<&MlsGroup> {
        match self.groupe.as_ref() {
            Some(g) if g.is_active() => Ok(g),
            _ => Err(Error::NonMembre),
        }
    }

    /// Clé SFrame de l'époque (exporteur MLS, 32 octets) : la même chez tous les membres.
    pub fn exporter_sframe(&self) -> Result<Zeroizing<[u8; 32]>> {
        let groupe = self.groupe_actif()?;
        let mut v = groupe
            .export_secret(self.fournisseur.crypto(), SFRAME, b"", 32)
            .map_err(|_| Error::MlsInterne)?;
        let mut cle = Zeroizing::new([0u8; 32]);
        let resultat = if v.len() == 32 {
            cle.copy_from_slice(&v);
            Ok(cle)
        } else {
            Err(Error::MlsInterne)
        };
        v.zeroize();
        resultat
    }

    /// Code de vérification du siège (spec v3 §9, point 4) : 20 chiffres en 4 groupes de 5,
    /// tirés de SHA-256(« shhdrop/v2/salon/verif » ‖ clé publique Ed25519 de sa feuille).
    pub fn empreinte(&self, siege: u8) -> Result<String> {
        let groupe = self.groupe_actif()?;
        let membre = groupe
            .members()
            .find(|m| lire_credential(&m.credential).is_ok_and(|(s, _)| s == siege))
            .ok_or(Error::SiegeInconnu)?;
        Ok(code_verification(
            membre
                .signature_key
                .as_slice()
                .try_into()
                .map_err(|_| Error::MlsInterne)?,
        ))
    }

    /// Sièges des membres actuels, en ordre croissant (vide hors du groupe).
    pub fn membres(&self) -> Vec<u8> {
        let Ok(groupe) = self.groupe_actif() else {
            return Vec::new();
        };
        let mut s: Vec<u8> = groupe
            .members()
            .filter_map(|m| lire_credential(&m.credential).ok().map(|c| c.0))
            .collect();
        s.sort_unstable();
        s
    }

    /// Époque MLS courante (`None` hors du groupe).
    pub fn epoque(&self) -> Option<u64> {
        self.groupe_actif().ok().map(|g| g.epoch().as_u64())
    }
}

#[cfg(test)]
mod tests {
    //! Commits hostiles fabriqués avec OpenMLS par un membre (contournant `Salon`) : refusés
    //! avant fusion chez les autres, l'état ne change pas (Review Focus 4).
    use super::*;
    use crate::cles::cles_salon;
    use crate::message::Message;
    use crate::trame::Regle;
    use shhdrop_core::{KLien, KMdp};

    fn cles() -> ClesSalon {
        cles_salon(&KLien::from_bytes([1; 32]), &KMdp::from_bytes([2; 32]))
    }

    fn env() -> Enveloppe {
        Enveloppe {
            id: [1; 16],
            heure_ms: 1_700_000_000_000,
            regle: Regle::Desactive,
            message: Message::Texte { x: "a".into() },
        }
    }

    /// Sièges 0 (créateur), 1 et 2.
    fn trois() -> (Vec<Salon>, u64) {
        let mut m =
            vec![Salon::creer(nouvelle_identite(0, [0; 16]).unwrap(), cles(), true).unwrap()];
        m[0].remplacer_annonces(0, &[(0, [0; 16])]);
        let mut seq = 0;
        for s in 1..3u8 {
            let mut n =
                Salon::creer(nouvelle_identite(s, [s; 16]).unwrap(), cles(), false).unwrap();
            let liste: Vec<(u8, [u8; 16])> = (0..=s).map(|i| (i, [i; 16])).collect();
            n.remplacer_annonces(0, &liste);
            let kp = n.key_package().unwrap();
            for x in m.iter_mut() {
                x.annoncer(s, [s; 16]);
            }
            seq += 1;
            for x in m.iter_mut() {
                assert!(matches!(
                    x.recevoir(&kp, seq, s),
                    Ok(Evenement::KeyPackage { .. })
                ));
            }
            let c = m[0].ajouter(&kp).unwrap();
            seq += 1;
            let mut welcome = None;
            for x in m.iter_mut() {
                match x.recevoir(&c, seq, 0) {
                    Ok(Evenement::CommitAccepte { welcome: w }) => welcome = w,
                    ev => assert!(matches!(ev, Ok(Evenement::Membres { .. })), "{ev:?}"),
                }
            }
            n.rejoindre(&welcome.unwrap()).unwrap();
            m.push(n);
        }
        (m, seq)
    }

    /// Commit brut du membre `i`, puis abandon chez lui (il ne le fusionne pas).
    fn commit_brut(
        salon: &mut Salon,
        f: impl FnOnce(
            CommitBuilder<'_, openmls::group::Initial>,
        ) -> CommitBuilder<'_, openmls::group::Initial>,
    ) -> Vec<u8> {
        let g = salon.groupe.as_mut().unwrap();
        let paquet = f(g.commit_builder())
            .load_psks(salon.fournisseur.storage())
            .unwrap()
            .build(
                salon.fournisseur.rand(),
                salon.fournisseur.crypto(),
                &salon.identite.signataire,
                |_| true,
            )
            .unwrap()
            .stage_commit(&salon.fournisseur)
            .unwrap();
        let octets = serialiser(paquet.commit()).unwrap();
        g.clear_pending_commit(salon.fournisseur.storage()).unwrap();
        octets
    }

    fn refuse_partout(m: &mut [Salon], seq: &mut u64, commit: &[u8], attendu: Error) {
        let e0 = m[0].epoque();
        *seq += 1;
        for (i, x) in m.iter_mut().enumerate() {
            if i != 1 {
                assert_eq!(x.recevoir(commit, *seq, 1), Err(attendu), "membre {i}");
                assert_eq!(x.epoque(), e0);
                assert_eq!(x.membres(), vec![0, 1, 2]);
            }
        }
        // Le groupe fonctionne toujours.
        let mls = m[2].chiffrer(&env()).unwrap();
        *seq += 1;
        assert!(matches!(
            m[0].recevoir(&mls, *seq, 2),
            Ok(Evenement::Message { de_siege: 2, .. })
        ));
        assert!(matches!(
            m[1].recevoir(&mls, *seq, 2),
            Ok(Evenement::Message { de_siege: 2, .. })
        ));
    }

    #[test]
    fn retrait_par_non_createur_refuse() {
        let (mut m, mut seq) = trois();
        let cible = m[1]
            .groupe
            .as_ref()
            .unwrap()
            .members()
            .find(|x| lire_credential(&x.credential).unwrap().0 == 2)
            .unwrap()
            .index;
        let c = commit_brut(&mut m[1], |b| b.propose_removals([cible]));
        refuse_partout(&mut m, &mut seq, &c, Error::CommitRefuse);
    }

    #[test]
    fn extensions_de_contexte_refusees() {
        let (mut m, mut seq) = trois();
        let c = commit_brut(&mut m[1], |b| {
            b.propose_group_context_extensions(Extensions::empty())
                .unwrap()
        });
        refuse_partout(&mut m, &mut seq, &c, Error::CommitRefuse);
    }

    #[test]
    fn proposition_par_reference_refusee() {
        let (mut m, mut seq) = trois();
        // Proposition seule : ignorée (jamais gardée)…
        let s1 = &mut m[1];
        let g = s1.groupe.as_mut().unwrap();
        let cible = g
            .members()
            .find(|x| lire_credential(&x.credential).unwrap().0 == 2)
            .unwrap()
            .index;
        let (prop, _) = g
            .propose_remove_member(&s1.fournisseur, &s1.identite.signataire, cible)
            .unwrap();
        let prop = serialiser(&prop).unwrap();
        seq += 1;
        assert_eq!(m[0].recevoir(&prop, seq, 1), Ok(Evenement::Ignore));
        assert_eq!(m[2].recevoir(&prop, seq, 1), Ok(Evenement::Ignore));
        // … donc le Commit qui la cite par référence ne peut pas passer.
        let c = commit_brut(&mut m[1], |b| b.consume_proposal_store(true));
        let e0 = m[0].epoque();
        seq += 1;
        for i in [0, 2] {
            assert!(m[i].recevoir(&c, seq, 1).is_err(), "membre {i}");
            assert_eq!(m[i].epoque(), e0);
            assert_eq!(m[i].membres(), vec![0, 1, 2]);
        }
    }
}
