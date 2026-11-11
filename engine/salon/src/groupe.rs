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
//! **Politique** (`politique.rs`) : vérifiée avant fusion sur chaque Commit reçu, sur nos
//! propres Commits à leur création et de nouveau à leur écho (les annonces ont pu changer).
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
use shhdrop_core::kdf::sha256;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

const SUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
/// Étiquette de l'exporteur MLS (Global Constraints du plan C-1).
const SFRAME: &str = "shhdrop/v2/salon/sframe";
/// Préfixe du code de vérification (spec v3 §9, point 4).
const VERIF: &[u8] = b"shhdrop/v2/salon/verif";
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
    /// Commit fusionné (le nôtre à son écho, ou celui d'un autre) : sièges ajoutés et retirés
    /// (un retour après rechargement figure dans les deux listes).
    Membres { ajoutes: Vec<u8>, retires: Vec<u8> },
    /// Notre Commit en attente a perdu (un autre Commit de l'époque est passé avant, ou la
    /// politique le refuse à son écho) : l'appelant rejoue son intention.
    CommitPerdu,
    /// Rien à faire : écho de notre message, Commit perdant d'une époque passée, rejeu (`seq`
    /// déjà vu), Welcome ou KeyPackage destinés à d'autres, proposition (jamais gardée).
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
    /// Octets de notre Commit en attente de son écho.
    commit_en_attente: Option<Vec<u8>>,
    dernier_seq: Option<u64>,
}

impl core::fmt::Debug for Salon {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("Salon(…)")
    }
}

fn config_creation() -> MlsGroupCreateConfig {
    MlsGroupCreateConfig::builder()
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
            Proposal::Add(a) => match lire_credential(a.key_package().leaf_node().credential()) {
                Ok(c) => ch.ajouts.push(c),
                Err(_) => ch.interdit = true,
            },
            Proposal::Remove(r) => {
                let siege = groupe
                    .member_at(r.removed())
                    .and_then(|m| lire_credential(&m.credential).ok());
                match siege {
                    Some((s, _)) => {
                        ch.retraits.push(s);
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
        retires: ch.retraits.clone(),
    }
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
        let paquet = KeyPackage::builder()
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
        let createur_siege = id[16];
        let mut sieges = Vec::new();
        for m in prepare.members() {
            let (s, _) = lire_credential(&m.credential)?;
            if sieges.contains(&s) {
                return Err(Error::MlsInvalide);
            }
            sieges.push(s);
        }
        let groupe = prepare
            .into_group(&self.fournisseur)
            .map_err(|_| Error::MlsInvalide)?;
        self.createur_siege = createur_siege;
        self.groupe = Some(groupe);
        Ok(())
    }

    /// Enregistre une arrivée annoncée par le serveur (0x02) ou une reprise de siège (0x0A) :
    /// remplace l'annonce précédente du même siège. À appeler dans l'ordre `seq`, comme
    /// `recevoir`, pour que tous les membres appliquent la même politique.
    pub fn annoncer(&mut self, siege: u8, nonce_arrivee: [u8; 16]) {
        self.annonces.retain(|a| a.0 != siege);
        self.annonces.push((siege, nonce_arrivee));
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
                self.commit_en_attente = Some(commit.clone());
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

    /// Ajoute l'arrivant dont voici le KeyPackage : rend (Commit, Welcome). Si son siège a
    /// déjà une feuille (retour après rechargement), le même Commit la retire. **Le Welcome
    /// n'est à envoyer qu'après l'écho du Commit** (`recevoir` → `Membres`) : si le Commit
    /// perd (`CommitPerdu`), ce Welcome mènerait l'arrivant sur une branche morte.
    pub fn ajouter(&mut self, key_package: &[u8]) -> Result<(Vec<u8>, Vec<u8>)> {
        self.groupe_libre()?;
        let MlsMessageBodyIn::KeyPackage(kp) = lire_mls(key_package)? else {
            return Err(Error::MlsInvalide);
        };
        let kp = kp
            .validate(self.fournisseur.crypto(), ProtocolVersion::Mls10)
            .map_err(|_| Error::MlsInvalide)?;
        if kp.ciphersuite() != SUITE {
            return Err(Error::MlsInvalide);
        }
        let (siege, nonce) = lire_credential(kp.leaf_node().credential())?;
        let groupe = self.groupe.as_ref().ok_or(Error::NonMembre)?;
        let mut retraits = Vec::new();
        let mut restants = Vec::new();
        for m in groupe.members() {
            let (s, _) = lire_credential(&m.credential)?;
            if s == siege {
                retraits.push(m.index);
            } else {
                restants.push(s);
            }
        }
        let prevu = Changements {
            ajouts: vec![(siege, nonce)],
            retraits: vec![siege; retraits.len()],
            restants,
            interdit: false,
        };
        politique::verifier(
            &prevu,
            self.createur_siege,
            self.identite.siege,
            &self.annonces,
        )?;
        let (commit, welcome) = self.commit(Some(kp), retraits)?;
        Ok((commit, welcome.ok_or(Error::MlsInterne)?))
    }

    /// Retire toutes les feuilles du siège (réservé au créateur, politique).
    pub fn retirer(&mut self, siege: u8) -> Result<Vec<u8>> {
        let groupe = &*self.groupe_libre()?;
        let mut retraits = Vec::new();
        let mut restants = Vec::new();
        for m in groupe.members() {
            let (s, _) = lire_credential(&m.credential)?;
            if s == siege {
                retraits.push(m.index);
            } else {
                restants.push(s);
            }
        }
        if retraits.is_empty() {
            return Err(Error::SiegeInconnu);
        }
        // MLS ne laisse pas l'auteur se retirer lui-même par son propre Commit.
        if siege == self.identite.siege {
            return Err(Error::CommitRefuse);
        }
        let prevu = Changements {
            ajouts: vec![],
            retraits: vec![siege; retraits.len()],
            restants,
            interdit: false,
        };
        politique::verifier(
            &prevu,
            self.createur_siege,
            self.identite.siege,
            &self.annonces,
        )?;
        Ok(self.commit(None, retraits)?.0)
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

    /// Traite un message MLS rangé au rang `seq` par le serveur. Les rangs déjà vus (rejeu,
    /// rattrapage après reconnexion) sont ignorés ; une erreur consomme aussi le rang.
    pub fn recevoir(&mut self, mls: &[u8], seq: u64) -> Result<Evenement> {
        match self.groupe.as_ref() {
            Some(g) if g.is_active() => {}
            _ => return Err(Error::NonMembre),
        }
        if self.dernier_seq.is_some_and(|d| seq <= d) {
            return Ok(Evenement::Ignore);
        }
        self.dernier_seq = Some(seq);
        if mls.len() > MAX_CHARGE {
            return Err(Error::TropGrand);
        }
        if self.commit_en_attente.as_deref() == Some(mls) {
            return self.confirmer_commit();
        }
        let protocole = match lire_mls(mls)? {
            MlsMessageBodyIn::PrivateMessage(p) => ProtocolMessage::from(p),
            MlsMessageBodyIn::Welcome(_) | MlsMessageBodyIn::KeyPackage(_) => {
                return Ok(Evenement::Ignore);
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
                politique::verifier(&ch, self.createur_siege, de_siege, &self.annonces)?;
                let perdu = self.commit_en_attente.take().is_some();
                if perdu {
                    groupe
                        .clear_pending_commit(self.fournisseur.storage())
                        .map_err(|_| Error::MlsInterne)?;
                }
                groupe
                    .merge_staged_commit(&self.fournisseur, *sc)
                    .map_err(|_| Error::MlsInterne)?;
                Ok(if perdu {
                    Evenement::CommitPerdu
                } else {
                    membres_de(&ch)
                })
            }
            ProcessedMessageContent::OwnPrivateMessage => Ok(Evenement::Ignore),
            _ => Ok(Evenement::Ignore),
        }
    }

    /// Écho de notre Commit : la politique est revérifiée (annonces reçues entre-temps), puis
    /// fusion ; sinon il est abandonné comme un Commit perdu.
    fn confirmer_commit(&mut self) -> Result<Evenement> {
        self.commit_en_attente = None;
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
        )
        .is_err()
        {
            groupe
                .clear_pending_commit(self.fournisseur.storage())
                .map_err(|_| Error::MlsInterne)?;
            return Ok(Evenement::CommitPerdu);
        }
        groupe
            .merge_pending_commit(&self.fournisseur)
            .map_err(|_| Error::MlsInterne)?;
        Ok(membres_de(&ch))
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
        let mut entree = VERIF.to_vec();
        entree.extend_from_slice(&membre.signature_key);
        let h = sha256(&entree);
        let groupes: Vec<String> = h[..16]
            .as_chunks::<4>()
            .0
            .iter()
            .map(|c| format!("{:05}", u32::from_be_bytes(*c) % 100_000))
            .collect();
        Ok(groupes.join(" "))
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
        let mut seq = 0;
        for s in 1..3u8 {
            let mut n =
                Salon::creer(nouvelle_identite(s, [s; 16]).unwrap(), cles(), false).unwrap();
            let kp = n.key_package().unwrap();
            for x in m.iter_mut() {
                x.annoncer(s, [s; 16]);
            }
            let (c, w) = m[0].ajouter(&kp).unwrap();
            seq += 1;
            for x in m.iter_mut() {
                assert!(matches!(x.recevoir(&c, seq), Ok(Evenement::Membres { .. })));
            }
            n.rejoindre(&w).unwrap();
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
                assert_eq!(x.recevoir(commit, *seq), Err(attendu), "membre {i}");
                assert_eq!(x.epoque(), e0);
                assert_eq!(x.membres(), vec![0, 1, 2]);
            }
        }
        // Le groupe fonctionne toujours.
        let mls = m[2].chiffrer(&env()).unwrap();
        *seq += 1;
        assert!(matches!(
            m[0].recevoir(&mls, *seq),
            Ok(Evenement::Message { de_siege: 2, .. })
        ));
        assert!(matches!(
            m[1].recevoir(&mls, *seq),
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
        assert_eq!(m[0].recevoir(&prop, seq), Ok(Evenement::Ignore));
        assert_eq!(m[2].recevoir(&prop, seq), Ok(Evenement::Ignore));
        // … donc le Commit qui la cite par référence ne peut pas passer.
        let c = commit_brut(&mut m[1], |b| b.consume_proposal_store(true));
        let e0 = m[0].epoque();
        seq += 1;
        for i in [0, 2] {
            assert!(m[i].recevoir(&c, seq).is_err(), "membre {i}");
            assert_eq!(m[i].epoque(), e0);
            assert_eq!(m[i].membres(), vec![0, 1, 2]);
        }
    }
}
