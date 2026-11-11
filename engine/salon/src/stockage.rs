//! Stockage MLS en mémoire dont les valeurs sont effacées à l'écrasement, à la suppression et à
//! la destruction.
//!
//! Dérivé de `openmls_memory_storage` 0.6.0 (MIT, Copyright (c) 2020 OpenMLS Authors, texte dans
//! `LICENSE-openmls-memory-storage`) : mêmes étiquettes de clés, mais les valeurs sont en
//! postcard (préfixées par leur longueur, donc lues sans agrandissement de tampon) au lieu de
//! JSON. Toute valeur rangée est un `Valeur` (octets effacés par `zeroize` quand ils sont
//! détruits) et les tampons d'écriture sont à taille exacte,
//! les `unwrap` deviennent des erreurs typées, et `clear_proposal_queue` retire bien les
//! propositions (la version d'origine cherchait leurs clés sans l'étiquette et ne les retirait
//! jamais). Les fonctionnalités `persistence`, `test-utils`, `extensions-draft` et
//! `virtual-clients-draft` ne sont pas reprises.
//!
//! Limites assumées : ce stockage ne laisse aucune copie des valeurs dans son propre format
//! (écriture à taille exacte, lecture sans agrandissement : les tableaux ont leur longueur en
//! tête, la taille annoncée est exacte). Restent hors de son contrôle : les tampons temporaires
//! d'OpenMLS lui-même, les objets qu'il reconstruit à la lecture une fois remis à l'appelant, et
//! l'allocateur, qui ne garantit rien sur les pages libérées au-delà de ce que `zeroize` a
//! écrasé avant. Les clés de la carte (étiquette, identifiants de groupe, clés publiques) sont du
//! JSON ordinaire, non secret, et ne sont pas effacées.
use std::collections::HashMap;
use std::fmt;
use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

use openmls_rust_crypto::RustCrypto;
use openmls_traits::OpenMlsProvider;
use openmls_traits::storage::*;
use serde::Serialize;
use zeroize::{Zeroize, ZeroizeOnDrop};

/// Octets rangés : effacés (contenu puis capacité inutilisée) quand la valeur est détruite, donc
/// à l'écrasement d'une entrée, à sa suppression et à la destruction du stockage.
struct Valeur(Vec<u8>);

impl Valeur {
    fn octets(&self) -> &[u8] {
        &self.0
    }
}

impl From<Vec<u8>> for Valeur {
    fn from(v: Vec<u8>) -> Self {
        Self(v)
    }
}

impl Drop for Valeur {
    fn drop(&mut self) {
        #[cfg(test)]
        let non_nul_avant = self.0.iter().any(|&o| o != 0);
        self.0.as_mut_slice().zeroize();
        #[cfg(test)]
        journal_ajouter(self.0.len(), non_nul_avant, self.0.iter().all(|&o| o == 0));
        // Efface aussi la capacité inutilisée, puis vide le tampon.
        self.0.zeroize();
    }
}

impl ZeroizeOnDrop for Valeur {}

impl fmt::Debug for Valeur {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Valeur({} octets)", self.0.len())
    }
}

impl std::ops::Deref for Valeur {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        self.octets()
    }
}

#[cfg(test)]
thread_local! {
    static JOURNAL: std::cell::RefCell<Vec<(usize, bool, bool)>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

/// Test seulement : note un effacement `(longueur, non nul avant, tout nul après)`.
#[cfg(test)]
fn journal_ajouter(longueur: usize, non_nul_avant: bool, nul_apres: bool) {
    JOURNAL.with(|j| j.borrow_mut().push((longueur, non_nul_avant, nul_apres)));
}

/// Test seulement : remet le journal de ce fil à zéro (les tests ne dépendent pas d'un fil à eux).
#[cfg(test)]
fn journal_vider() {
    JOURNAL.with(|j| j.borrow_mut().clear());
}

/// Test seulement : effacements observés dans ce fil depuis son début.
#[cfg(test)]
fn journal_effacements() -> Vec<(usize, bool, bool)> {
    JOURNAL.with(|j| j.borrow().clone())
}

/// Sérialise une valeur en postcard dans un tampon de taille exacte : une passe pour mesurer,
/// puis l'écriture dans un tampon alloué une fois, sans agrandissement donc sans copie
/// intermédiaire laissée sans effacement.
fn serialiser<T: Serialize + ?Sized>(valeur: &T) -> Result<Valeur, StockageError> {
    let taille = postcard::serialize_with_flavor(valeur, postcard::ser_flavors::Size::default())?;
    let mut tampon = Valeur(vec![0u8; taille]);
    let ecrit = postcard::to_slice(valeur, &mut tampon.0)?.len();
    if ecrit != taille {
        return Err(StockageError::Incoherent);
    }
    Ok(tampon)
}

/// Clé de la carte : JSON ordinaire (identifiants et clés publiques, pas des secrets).
fn cle_json<T: Serialize + ?Sized>(cle: &T) -> R<Vec<u8>> {
    Ok(serde_json::to_vec(cle)?)
}

/// Stockage MLS en mémoire : carte clé → `Valeur`.
#[derive(Default)]
pub struct Stockage {
    valeurs: RwLock<HashMap<Vec<u8>, Valeur>>,
}

impl fmt::Debug for Stockage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Jamais le contenu.
        f.debug_struct("Stockage").finish_non_exhaustive()
    }
}

/// Fournisseur OpenMLS : crypto et aléa RustCrypto, stockage qui efface.
#[derive(Default, Debug)]
pub struct Fournisseur {
    crypto: RustCrypto,
    stockage: Stockage,
}

impl OpenMlsProvider for Fournisseur {
    type CryptoProvider = RustCrypto;
    type RandProvider = RustCrypto;
    type StorageProvider = Stockage;

    fn storage(&self) -> &Self::StorageProvider {
        &self.stockage
    }

    fn crypto(&self) -> &Self::CryptoProvider {
        &self.crypto
    }

    fn rand(&self) -> &Self::RandProvider {
        &self.crypto
    }
}

/// Erreurs du stockage.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum StockageError {
    /// Sérialisation ou désérialisation JSON impossible.
    Serialisation,
    /// Verrou empoisonné par une panique dans un autre fil.
    Verrou,
    /// État interne incohérent (référence sans valeur).
    Incoherent,
}

impl fmt::Display for StockageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Serialisation => "stockage_serialisation",
            Self::Verrou => "stockage_verrou",
            Self::Incoherent => "stockage_incoherent",
        })
    }
}

impl std::error::Error for StockageError {}

impl From<serde_json::Error> for StockageError {
    fn from(_: serde_json::Error) -> Self {
        Self::Serialisation
    }
}

impl From<postcard::Error> for StockageError {
    fn from(_: postcard::Error) -> Self {
        Self::Serialisation
    }
}

type R<T> = Result<T, StockageError>;

impl Stockage {
    fn valeurs_lecture(&self) -> R<RwLockReadGuard<'_, HashMap<Vec<u8>, Valeur>>> {
        self.valeurs.read().map_err(|_| StockageError::Verrou)
    }

    fn valeurs_ecriture(&self) -> R<RwLockWriteGuard<'_, HashMap<Vec<u8>, Valeur>>> {
        self.valeurs.write().map_err(|_| StockageError::Verrou)
    }

    /// Range une valeur ; l'ancienne valeur de la même clé est effacée (détruite ici).
    fn ecrire(&self, etiquette: &[u8], cle: &[u8], valeur: impl Into<Valeur>) -> R<()> {
        let mut valeurs = self.valeurs_ecriture()?;
        valeurs.insert(
            build_key_from_vec::<CURRENT_VERSION>(etiquette, cle.to_vec()),
            valeur.into(),
        );
        Ok(())
    }

    /// Ajoute un élément à la liste rangée sous cette clé ; la liste est réécrite en entier et
    /// l'ancienne sérialisation est effacée.
    fn ajouter(&self, etiquette: &[u8], cle: &[u8], element: impl Into<Valeur>) -> R<()> {
        let mut valeurs = self.valeurs_ecriture()?;
        let cle_complete = build_key_from_vec::<CURRENT_VERSION>(etiquette, cle.to_vec());
        let mut liste = lire_liste_brute(valeurs.get(&cle_complete))?;
        liste.push(element.into());
        valeurs.insert(cle_complete, serialiser_liste(&liste)?);
        Ok(())
    }

    /// Retire la première occurrence de `element` de la liste rangée sous cette clé.
    fn retirer_element(&self, etiquette: &[u8], cle: &[u8], element: impl Into<Valeur>) -> R<()> {
        let element = element.into();
        let mut valeurs = self.valeurs_ecriture()?;
        let cle_complete = build_key_from_vec::<CURRENT_VERSION>(etiquette, cle.to_vec());
        let mut liste = lire_liste_brute(valeurs.get(&cle_complete))?;
        if let Some(pos) = liste.iter().position(|x| x.octets() == element.octets()) {
            liste.remove(pos);
        }
        valeurs.insert(cle_complete, serialiser_liste(&liste)?);
        Ok(())
    }

    /// Supprime une entrée ; sa valeur est effacée.
    fn supprimer(&self, etiquette: &[u8], cle: &[u8]) -> R<()> {
        let mut valeurs = self.valeurs_ecriture()?;
        valeurs.remove(&build_key_from_vec::<CURRENT_VERSION>(
            etiquette,
            cle.to_vec(),
        ));
        Ok(())
    }

    fn read<const VERSION: u16, V: Entity<VERSION>>(
        &self,
        etiquette: &[u8],
        cle: &[u8],
    ) -> R<Option<V>> {
        let valeurs = self.valeurs_lecture()?;
        match valeurs.get(&build_key_from_vec::<VERSION>(etiquette, cle.to_vec())) {
            Some(v) => Ok(Some(postcard::from_bytes(v)?)),
            None => Ok(None),
        }
    }

    fn read_list<const VERSION: u16, V: Entity<VERSION>>(
        &self,
        etiquette: &[u8],
        cle: &[u8],
    ) -> R<Vec<V>> {
        let valeurs = self.valeurs_lecture()?;
        let cle_complete = build_key_from_vec::<VERSION>(etiquette, cle.to_vec());
        let liste = lire_liste_brute(valeurs.get(&cle_complete))?;
        liste
            .iter()
            .map(|v| postcard::from_bytes(v).map_err(StockageError::from))
            .collect()
    }
}

/// Relit une liste rangée (JSON : tableau d'éléments eux-mêmes en octets) ; absente = vide.
fn lire_liste_brute(valeur: Option<&Valeur>) -> R<Vec<Valeur>> {
    match valeur {
        None => Ok(Vec::new()),
        Some(v) => {
            let brut: Vec<Vec<u8>> = postcard::from_bytes(v)?;
            Ok(brut.into_iter().map(Valeur).collect())
        }
    }
}

fn serialiser_liste(liste: &[Valeur]) -> R<Valeur> {
    let vues: Vec<&[u8]> = liste.iter().map(|v| v.octets()).collect();
    serialiser(&vues)
}

const KEY_PACKAGE_LABEL: &[u8] = b"KeyPackage";
const PSK_LABEL: &[u8] = b"Psk";
const ENCRYPTION_KEY_PAIR_LABEL: &[u8] = b"EncryptionKeyPair";
const SIGNATURE_KEY_PAIR_LABEL: &[u8] = b"SignatureKeyPair";
const EPOCH_KEY_PAIRS_LABEL: &[u8] = b"EpochKeyPairs";

// related to PublicGroup
const TREE_LABEL: &[u8] = b"Tree";
const GROUP_CONTEXT_LABEL: &[u8] = b"GroupContext";
const INTERIM_TRANSCRIPT_HASH_LABEL: &[u8] = b"InterimTranscriptHash";
const CONFIRMATION_TAG_LABEL: &[u8] = b"ConfirmationTag";

// related to MlsGroup
const JOIN_CONFIG_LABEL: &[u8] = b"MlsGroupJoinConfig";
const OWN_LEAF_NODES_LABEL: &[u8] = b"OwnLeafNodes";
const GROUP_STATE_LABEL: &[u8] = b"GroupState";
const QUEUED_PROPOSAL_LABEL: &[u8] = b"QueuedProposal";
const PROPOSAL_QUEUE_REFS_LABEL: &[u8] = b"ProposalQueueRefs";
const OWN_LEAF_NODE_INDEX_LABEL: &[u8] = b"OwnLeafNodeIndex";
const EPOCH_SECRETS_LABEL: &[u8] = b"EpochSecrets";
const RESUMPTION_PSK_STORE_LABEL: &[u8] = b"ResumptionPsk";
const MESSAGE_SECRETS_LABEL: &[u8] = b"MessageSecrets";

impl StorageProvider<CURRENT_VERSION> for Stockage {
    type Error = StockageError;

    fn queue_proposal<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        ProposalRef: traits::ProposalRef<CURRENT_VERSION>,
        QueuedProposal: traits::QueuedProposal<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        proposal_ref: &ProposalRef,
        proposal: &QueuedProposal,
    ) -> Result<(), Self::Error> {
        // write proposal to key (group_id, proposal_ref)
        let key = cle_json(&(group_id, proposal_ref))?;
        let value = serialiser(proposal)?;
        self.ecrire(QUEUED_PROPOSAL_LABEL, &key, value)?;

        // update proposal list for group_id
        let key = cle_json(group_id)?;
        let value = serialiser(proposal_ref)?;
        self.ajouter(PROPOSAL_QUEUE_REFS_LABEL, &key, value)?;

        Ok(())
    }

    fn write_tree<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        TreeSync: traits::TreeSync<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        tree: &TreeSync,
    ) -> Result<(), Self::Error> {
        self.ecrire(TREE_LABEL, &cle_json(&group_id)?, serialiser(&tree)?)
    }

    fn write_interim_transcript_hash<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        InterimTranscriptHash: traits::InterimTranscriptHash<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        interim_transcript_hash: &InterimTranscriptHash,
    ) -> Result<(), Self::Error> {
        let mut values = self.valeurs_ecriture()?;
        let key = build_key::<CURRENT_VERSION, &GroupId>(INTERIM_TRANSCRIPT_HASH_LABEL, group_id)?;
        let value = serialiser(&interim_transcript_hash)?;

        values.insert(key, value);
        Ok(())
    }

    fn write_context<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        GroupContext: traits::GroupContext<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        group_context: &GroupContext,
    ) -> Result<(), Self::Error> {
        let mut values = self.valeurs_ecriture()?;
        let key = build_key::<CURRENT_VERSION, &GroupId>(GROUP_CONTEXT_LABEL, group_id)?;
        let value = serialiser(&group_context)?;

        values.insert(key, value);
        Ok(())
    }

    fn write_confirmation_tag<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        ConfirmationTag: traits::ConfirmationTag<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        confirmation_tag: &ConfirmationTag,
    ) -> Result<(), Self::Error> {
        let mut values = self.valeurs_ecriture()?;
        let key = build_key::<CURRENT_VERSION, &GroupId>(CONFIRMATION_TAG_LABEL, group_id)?;
        let value = serialiser(&confirmation_tag)?;

        values.insert(key, value);
        Ok(())
    }

    fn write_signature_key_pair<
        SignaturePublicKey: traits::SignaturePublicKey<CURRENT_VERSION>,
        SignatureKeyPair: traits::SignatureKeyPair<CURRENT_VERSION>,
    >(
        &self,
        public_key: &SignaturePublicKey,
        signature_key_pair: &SignatureKeyPair,
    ) -> Result<(), Self::Error> {
        let mut values = self.valeurs_ecriture()?;
        let key = build_key::<CURRENT_VERSION, &SignaturePublicKey>(
            SIGNATURE_KEY_PAIR_LABEL,
            public_key,
        )?;
        let value = serialiser(&signature_key_pair)?;

        values.insert(key, value);
        Ok(())
    }

    fn queued_proposal_refs<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        ProposalRef: traits::ProposalRef<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Vec<ProposalRef>, Self::Error> {
        self.read_list(PROPOSAL_QUEUE_REFS_LABEL, &cle_json(group_id)?)
    }

    fn queued_proposals<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        ProposalRef: traits::ProposalRef<CURRENT_VERSION>,
        QueuedProposal: traits::QueuedProposal<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Vec<(ProposalRef, QueuedProposal)>, Self::Error> {
        let refs: Vec<ProposalRef> =
            self.read_list(PROPOSAL_QUEUE_REFS_LABEL, &cle_json(group_id)?)?;

        refs.into_iter()
            .map(|proposal_ref| -> Result<_, _> {
                let key = (group_id, &proposal_ref);
                let key = cle_json(&key)?;

                let proposal = self
                    .read(QUEUED_PROPOSAL_LABEL, &key)?
                    .ok_or(StockageError::Incoherent)?;
                Ok((proposal_ref, proposal))
            })
            .collect::<Result<Vec<_>, _>>()
    }

    fn tree<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        TreeSync: traits::TreeSync<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<TreeSync>, Self::Error> {
        let values = self.valeurs_lecture()?;
        let key = build_key::<CURRENT_VERSION, &GroupId>(TREE_LABEL, group_id)?;

        let Some(value) = values.get(&key) else {
            return Ok(None);
        };
        Ok(Some(postcard::from_bytes(value)?))
    }

    fn group_context<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        GroupContext: traits::GroupContext<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<GroupContext>, Self::Error> {
        let values = self.valeurs_lecture()?;
        let key = build_key::<CURRENT_VERSION, &GroupId>(GROUP_CONTEXT_LABEL, group_id)?;

        let Some(value) = values.get(&key) else {
            return Ok(None);
        };
        Ok(Some(postcard::from_bytes(value)?))
    }

    fn interim_transcript_hash<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        InterimTranscriptHash: traits::InterimTranscriptHash<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<InterimTranscriptHash>, Self::Error> {
        let values = self.valeurs_lecture()?;
        let key = build_key::<CURRENT_VERSION, &GroupId>(INTERIM_TRANSCRIPT_HASH_LABEL, group_id)?;

        let Some(value) = values.get(&key) else {
            return Ok(None);
        };
        Ok(Some(postcard::from_bytes(value)?))
    }

    fn confirmation_tag<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        ConfirmationTag: traits::ConfirmationTag<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<ConfirmationTag>, Self::Error> {
        let values = self.valeurs_lecture()?;
        let key = build_key::<CURRENT_VERSION, &GroupId>(CONFIRMATION_TAG_LABEL, group_id)?;

        let Some(value) = values.get(&key) else {
            return Ok(None);
        };
        Ok(Some(postcard::from_bytes(value)?))
    }

    fn signature_key_pair<
        SignaturePublicKey: traits::SignaturePublicKey<CURRENT_VERSION>,
        SignatureKeyPair: traits::SignatureKeyPair<CURRENT_VERSION>,
    >(
        &self,
        public_key: &SignaturePublicKey,
    ) -> Result<Option<SignatureKeyPair>, Self::Error> {
        let values = self.valeurs_lecture()?;

        let key = build_key::<CURRENT_VERSION, &SignaturePublicKey>(
            SIGNATURE_KEY_PAIR_LABEL,
            public_key,
        )?;

        let Some(value) = values.get(&key) else {
            return Ok(None);
        };
        Ok(Some(postcard::from_bytes(value)?))
    }

    fn write_key_package<
        HashReference: traits::HashReference<CURRENT_VERSION>,
        KeyPackage: traits::KeyPackage<CURRENT_VERSION>,
    >(
        &self,
        hash_ref: &HashReference,
        key_package: &KeyPackage,
    ) -> Result<(), Self::Error> {
        let key = cle_json(&hash_ref)?;
        let value = serialiser(&key_package)?;

        self.ecrire(KEY_PACKAGE_LABEL, &key, value)
    }

    fn write_psk<
        PskId: traits::PskId<CURRENT_VERSION>,
        PskBundle: traits::PskBundle<CURRENT_VERSION>,
    >(
        &self,
        psk_id: &PskId,
        psk: &PskBundle,
    ) -> Result<(), Self::Error> {
        self.ecrire(PSK_LABEL, &cle_json(&psk_id)?, serialiser(&psk)?)
    }

    fn write_encryption_key_pair<
        EncryptionKey: traits::EncryptionKey<CURRENT_VERSION>,
        HpkeKeyPair: traits::HpkeKeyPair<CURRENT_VERSION>,
    >(
        &self,
        public_key: &EncryptionKey,
        key_pair: &HpkeKeyPair,
    ) -> Result<(), Self::Error> {
        self.ecrire(
            ENCRYPTION_KEY_PAIR_LABEL,
            &cle_json(public_key)?,
            serialiser(key_pair)?,
        )
    }

    fn key_package<
        KeyPackageRef: traits::HashReference<CURRENT_VERSION>,
        KeyPackage: traits::KeyPackage<CURRENT_VERSION>,
    >(
        &self,
        hash_ref: &KeyPackageRef,
    ) -> Result<Option<KeyPackage>, Self::Error> {
        let key = cle_json(&hash_ref)?;
        self.read(KEY_PACKAGE_LABEL, &key)
    }

    fn psk<PskBundle: traits::PskBundle<CURRENT_VERSION>, PskId: traits::PskId<CURRENT_VERSION>>(
        &self,
        psk_id: &PskId,
    ) -> Result<Option<PskBundle>, Self::Error> {
        self.read(PSK_LABEL, &cle_json(&psk_id)?)
    }

    fn encryption_key_pair<
        HpkeKeyPair: traits::HpkeKeyPair<CURRENT_VERSION>,
        EncryptionKey: traits::EncryptionKey<CURRENT_VERSION>,
    >(
        &self,
        public_key: &EncryptionKey,
    ) -> Result<Option<HpkeKeyPair>, Self::Error> {
        self.read(ENCRYPTION_KEY_PAIR_LABEL, &cle_json(public_key)?)
    }

    fn delete_signature_key_pair<
        SignaturePublicKey: traits::SignaturePublicKey<CURRENT_VERSION>,
    >(
        &self,
        public_key: &SignaturePublicKey,
    ) -> Result<(), Self::Error> {
        self.supprimer(SIGNATURE_KEY_PAIR_LABEL, &cle_json(public_key)?)
    }

    fn delete_encryption_key_pair<EncryptionKey: traits::EncryptionKey<CURRENT_VERSION>>(
        &self,
        public_key: &EncryptionKey,
    ) -> Result<(), Self::Error> {
        self.supprimer(ENCRYPTION_KEY_PAIR_LABEL, &cle_json(&public_key)?)
    }

    fn delete_key_package<KeyPackageRef: traits::HashReference<CURRENT_VERSION>>(
        &self,
        hash_ref: &KeyPackageRef,
    ) -> Result<(), Self::Error> {
        self.supprimer(KEY_PACKAGE_LABEL, &cle_json(&hash_ref)?)
    }

    fn delete_psk<PskKey: traits::PskId<CURRENT_VERSION>>(
        &self,
        psk_id: &PskKey,
    ) -> Result<(), Self::Error> {
        self.supprimer(PSK_LABEL, &cle_json(&psk_id)?)
    }

    fn group_state<
        GroupState: traits::GroupState<CURRENT_VERSION>,
        GroupId: traits::GroupId<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<GroupState>, Self::Error> {
        self.read(GROUP_STATE_LABEL, &cle_json(&group_id)?)
    }

    fn write_group_state<
        GroupState: traits::GroupState<CURRENT_VERSION>,
        GroupId: traits::GroupId<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        group_state: &GroupState,
    ) -> Result<(), Self::Error> {
        self.ecrire(
            GROUP_STATE_LABEL,
            &cle_json(group_id)?,
            serialiser(group_state)?,
        )
    }

    fn delete_group_state<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.supprimer(GROUP_STATE_LABEL, &cle_json(group_id)?)
    }

    fn message_secrets<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        MessageSecrets: traits::MessageSecrets<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<MessageSecrets>, Self::Error> {
        self.read(MESSAGE_SECRETS_LABEL, &cle_json(group_id)?)
    }

    fn write_message_secrets<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        MessageSecrets: traits::MessageSecrets<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        message_secrets: &MessageSecrets,
    ) -> Result<(), Self::Error> {
        self.ecrire(
            MESSAGE_SECRETS_LABEL,
            &cle_json(group_id)?,
            serialiser(message_secrets)?,
        )
    }

    fn delete_message_secrets<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.supprimer(MESSAGE_SECRETS_LABEL, &cle_json(group_id)?)
    }

    fn resumption_psk_store<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        ResumptionPskStore: traits::ResumptionPskStore<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<ResumptionPskStore>, Self::Error> {
        self.read(RESUMPTION_PSK_STORE_LABEL, &cle_json(group_id)?)
    }

    fn write_resumption_psk_store<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        ResumptionPskStore: traits::ResumptionPskStore<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        resumption_psk_store: &ResumptionPskStore,
    ) -> Result<(), Self::Error> {
        self.ecrire(
            RESUMPTION_PSK_STORE_LABEL,
            &cle_json(group_id)?,
            serialiser(resumption_psk_store)?,
        )
    }

    fn delete_all_resumption_psk_secrets<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.supprimer(RESUMPTION_PSK_STORE_LABEL, &cle_json(group_id)?)
    }

    fn own_leaf_index<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        LeafNodeIndex: traits::LeafNodeIndex<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<LeafNodeIndex>, Self::Error> {
        self.read(OWN_LEAF_NODE_INDEX_LABEL, &cle_json(group_id)?)
    }

    fn write_own_leaf_index<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        LeafNodeIndex: traits::LeafNodeIndex<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        own_leaf_index: &LeafNodeIndex,
    ) -> Result<(), Self::Error> {
        self.ecrire(
            OWN_LEAF_NODE_INDEX_LABEL,
            &cle_json(group_id)?,
            serialiser(own_leaf_index)?,
        )
    }

    fn delete_own_leaf_index<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.supprimer(OWN_LEAF_NODE_INDEX_LABEL, &cle_json(group_id)?)
    }

    fn group_epoch_secrets<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        GroupEpochSecrets: traits::GroupEpochSecrets<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<GroupEpochSecrets>, Self::Error> {
        self.read(EPOCH_SECRETS_LABEL, &cle_json(group_id)?)
    }

    fn write_group_epoch_secrets<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        GroupEpochSecrets: traits::GroupEpochSecrets<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        group_epoch_secrets: &GroupEpochSecrets,
    ) -> Result<(), Self::Error> {
        self.ecrire(
            EPOCH_SECRETS_LABEL,
            &cle_json(group_id)?,
            serialiser(group_epoch_secrets)?,
        )
    }

    fn delete_group_epoch_secrets<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.supprimer(EPOCH_SECRETS_LABEL, &cle_json(group_id)?)
    }

    fn write_encryption_epoch_key_pairs<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        EpochKey: traits::EpochKey<CURRENT_VERSION>,
        HpkeKeyPair: traits::HpkeKeyPair<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        epoch: &EpochKey,
        leaf_index: u32,
        key_pairs: &[HpkeKeyPair],
    ) -> Result<(), Self::Error> {
        let key = epoch_key_pairs_id(group_id, epoch, leaf_index)?;
        let value = serialiser(key_pairs)?;

        self.ecrire(EPOCH_KEY_PAIRS_LABEL, &key, value)
    }

    fn encryption_epoch_key_pairs<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        EpochKey: traits::EpochKey<CURRENT_VERSION>,
        HpkeKeyPair: traits::HpkeKeyPair<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        epoch: &EpochKey,
        leaf_index: u32,
    ) -> Result<Vec<HpkeKeyPair>, Self::Error> {
        let key = epoch_key_pairs_id(group_id, epoch, leaf_index)?;
        let storage_key = build_key_from_vec::<CURRENT_VERSION>(EPOCH_KEY_PAIRS_LABEL, key);

        let values = self.valeurs_lecture()?;
        let value = values.get(&storage_key);

        if let Some(value) = value {
            return Ok(postcard::from_bytes(value)?);
        }

        Ok(vec![])
    }

    fn delete_encryption_epoch_key_pairs<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        EpochKey: traits::EpochKey<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        epoch: &EpochKey,
        leaf_index: u32,
    ) -> Result<(), Self::Error> {
        let key = epoch_key_pairs_id(group_id, epoch, leaf_index)?;
        self.supprimer(EPOCH_KEY_PAIRS_LABEL, &key)
    }

    fn clear_proposal_queue<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        ProposalRef: traits::ProposalRef<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        // Get all proposal refs for this group.
        let proposal_refs: Vec<ProposalRef> =
            self.read_list(PROPOSAL_QUEUE_REFS_LABEL, &cle_json(group_id)?)?;
        let mut values = self.valeurs_ecriture()?;
        for proposal_ref in proposal_refs {
            // Delete all proposals (leur clé porte l'étiquette ; la version d'origine l'oubliait).
            let key = build_key_from_vec::<CURRENT_VERSION>(
                QUEUED_PROPOSAL_LABEL,
                cle_json(&(group_id, proposal_ref))?,
            );
            values.remove(&key);
        }

        // Delete the proposal refs from the store.
        let key = build_key::<CURRENT_VERSION, &GroupId>(PROPOSAL_QUEUE_REFS_LABEL, group_id)?;
        values.remove(&key);

        Ok(())
    }

    fn mls_group_join_config<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        MlsGroupJoinConfig: traits::MlsGroupJoinConfig<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<MlsGroupJoinConfig>, Self::Error> {
        self.read(JOIN_CONFIG_LABEL, &cle_json(group_id)?)
    }

    fn write_mls_join_config<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        MlsGroupJoinConfig: traits::MlsGroupJoinConfig<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        config: &MlsGroupJoinConfig,
    ) -> Result<(), Self::Error> {
        let key = cle_json(group_id)?;
        let value = serialiser(config)?;

        self.ecrire(JOIN_CONFIG_LABEL, &key, value)
    }

    fn own_leaf_nodes<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        LeafNode: traits::LeafNode<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Vec<LeafNode>, Self::Error> {
        self.read_list(OWN_LEAF_NODES_LABEL, &cle_json(group_id)?)
    }

    fn append_own_leaf_node<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        LeafNode: traits::LeafNode<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        leaf_node: &LeafNode,
    ) -> Result<(), Self::Error> {
        let key = cle_json(group_id)?;
        let value = serialiser(leaf_node)?;
        self.ajouter(OWN_LEAF_NODES_LABEL, &key, value)
    }

    fn delete_own_leaf_nodes<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.supprimer(OWN_LEAF_NODES_LABEL, &cle_json(group_id)?)
    }

    fn delete_group_config<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.supprimer(JOIN_CONFIG_LABEL, &cle_json(group_id)?)
    }

    fn delete_tree<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.supprimer(TREE_LABEL, &cle_json(group_id)?)
    }

    fn delete_confirmation_tag<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.supprimer(CONFIRMATION_TAG_LABEL, &cle_json(group_id)?)
    }

    fn delete_context<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.supprimer(GROUP_CONTEXT_LABEL, &cle_json(group_id)?)
    }

    fn delete_interim_transcript_hash<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.supprimer(INTERIM_TRANSCRIPT_HASH_LABEL, &cle_json(group_id)?)
    }

    fn remove_proposal<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        ProposalRef: traits::ProposalRef<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        proposal_ref: &ProposalRef,
    ) -> Result<(), Self::Error> {
        let key = cle_json(group_id)?;
        let value = serialiser(proposal_ref)?;

        self.retirer_element(PROPOSAL_QUEUE_REFS_LABEL, &key, value)?;

        let key = cle_json(&(group_id, proposal_ref))?;
        self.supprimer(QUEUED_PROPOSAL_LABEL, &key)
    }
}

/// Build a key with version and label.
fn build_key_from_vec<const V: u16>(label: &[u8], key: Vec<u8>) -> Vec<u8> {
    let mut key_out = label.to_vec();
    key_out.extend_from_slice(&key);
    key_out.extend_from_slice(&u16::to_be_bytes(V));
    key_out
}

/// Build a key with version and label.
fn build_key<const V: u16, K: Serialize>(label: &[u8], key: K) -> R<Vec<u8>> {
    Ok(build_key_from_vec::<V>(label, cle_json(&key)?))
}

fn epoch_key_pairs_id(
    group_id: &impl traits::GroupId<CURRENT_VERSION>,
    epoch: &impl traits::EpochKey<CURRENT_VERSION>,
    leaf_index: u32,
) -> R<Vec<u8>> {
    let mut key = cle_json(group_id)?;
    key.extend_from_slice(&cle_json(epoch)?);
    key.extend_from_slice(&cle_json(&leaf_index)?);
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use openmls_basic_credential::SignatureKeyPair;
    use openmls_traits::types::SignatureScheme;

    /// Effacements observés dans ce fil de test, `(longueur, était non nul, nul après effacement)`.
    fn journal() -> Vec<(usize, bool, bool)> {
        journal_effacements()
    }

    #[test]
    fn ecrase_efface() {
        journal_vider();
        let s = Stockage::default();
        s.ecrire(b"L", b"k", vec![0xAA; 37]).unwrap();
        assert!(journal().is_empty());
        s.ecrire(b"L", b"k", vec![0xBB; 41]).unwrap();
        // L'ancienne valeur (37 octets non nuls) a été effacée ; la nouvelle ne l'est pas.
        assert_eq!(journal(), vec![(37, true, true)]);
    }

    #[test]
    fn supprime_efface() {
        journal_vider();
        let s = Stockage::default();
        s.ecrire(b"L", b"k", vec![0xCC; 53]).unwrap();
        s.supprimer(b"L", b"k").unwrap();
        assert_eq!(journal(), vec![(53, true, true)]);
        // Supprimer une entrée absente ne fait rien.
        s.supprimer(b"L", b"k").unwrap();
        assert_eq!(journal().len(), 1);
    }

    #[test]
    fn drop_efface_tout() {
        journal_vider();
        let s = Stockage::default();
        s.ecrire(b"L", b"a", vec![1; 11]).unwrap();
        s.ecrire(b"L", b"b", vec![2; 12]).unwrap();
        s.ecrire(b"M", b"a", vec![3; 13]).unwrap();
        assert!(journal().is_empty());
        drop(s);
        let mut longueurs = journal();
        longueurs.sort();
        assert_eq!(
            longueurs,
            vec![(11, true, true), (12, true, true), (13, true, true)]
        );
    }

    #[test]
    fn ajout_et_retrait_de_liste_effacent() {
        journal_vider();
        let s = Stockage::default();
        s.ajouter(b"Liste", b"g", vec![7; 5]).unwrap();
        // Liste d'un élément de 5 octets en postcard : 1 (longueur) + 1 (longueur) + 5 = 7 octets.
        journal_vider();
        s.ajouter(b"Liste", b"g", vec![8; 6]).unwrap();
        // L'ancienne sérialisation de la liste (7 octets non nuls) a été effacée.
        assert!(journal().contains(&(7, true, true)));
        journal_vider();
        s.retirer_element(b"Liste", b"g", vec![7; 5]).unwrap();
        // Liste de deux éléments (1 + 6 + 7 = 14 octets) effacée à la réécriture.
        assert!(journal().contains(&(14, true, true)));
        assert!(journal().iter().all(|&(_, nn, z)| nn && z));
    }

    #[test]
    fn cle_de_signature_ecrasee_puis_supprimee_efface() {
        journal_vider();
        let f = Fournisseur::default();
        let paire = SignatureKeyPair::new(SignatureScheme::ED25519).unwrap();
        paire.store(f.storage()).unwrap();
        assert!(journal().is_empty());
        // Même clé publique : la seconde écriture écrase la première, qui doit être effacée.
        paire.store(f.storage()).unwrap();
        assert_eq!(journal().len(), 1);
        assert!(journal()[0].1 && journal()[0].2);
        let relue =
            SignatureKeyPair::read(f.storage(), paire.public(), SignatureScheme::ED25519).unwrap();
        assert_eq!(relue.public(), paire.public());
        SignatureKeyPair::delete(f.storage(), paire.public(), SignatureScheme::ED25519).unwrap();
        assert_eq!(journal().len(), 2);
        assert!(
            SignatureKeyPair::read(f.storage(), paire.public(), SignatureScheme::ED25519).is_none()
        );
    }

    #[derive(Serialize, serde::Deserialize)]
    struct Groupe(u8);
    #[derive(Serialize, serde::Deserialize)]
    struct Ref(u8);
    #[derive(Serialize, serde::Deserialize)]
    struct Proposition(Vec<u8>);
    impl Key<CURRENT_VERSION> for Groupe {}
    impl traits::GroupId<CURRENT_VERSION> for Groupe {}
    impl Key<CURRENT_VERSION> for Ref {}
    impl Entity<CURRENT_VERSION> for Ref {}
    impl traits::ProposalRef<CURRENT_VERSION> for Ref {}
    impl Entity<CURRENT_VERSION> for Proposition {}
    impl traits::QueuedProposal<CURRENT_VERSION> for Proposition {}

    #[test]
    fn file_de_propositions_videe_et_efface() {
        journal_vider();
        let s = Stockage::default();
        s.queue_proposal(&Groupe(1), &Ref(2), &Proposition(vec![0x5A; 64]))
            .unwrap();
        let en_file: Vec<(Ref, Proposition)> = s.queued_proposals(&Groupe(1)).unwrap();
        assert_eq!(en_file.len(), 1);
        drop(en_file);
        let avant = journal().len();
        s.clear_proposal_queue::<Groupe, Ref>(&Groupe(1)).unwrap();
        assert!(journal().len() > avant);
        let apres: Vec<(Ref, Proposition)> = s.queued_proposals(&Groupe(1)).unwrap();
        assert!(apres.is_empty());
        // Plus aucune entrée : la proposition a bien été retirée (et donc effacée), pas seulement
        // la liste de références.
        assert!(s.valeurs_lecture().unwrap().is_empty());
    }

    #[derive(Serialize, serde::Deserialize)]
    struct Paire(openmls_traits::types::HpkeKeyPair);
    #[derive(Serialize, serde::Deserialize)]
    struct ClePublique(Vec<u8>);
    impl Key<CURRENT_VERSION> for ClePublique {}
    impl traits::EncryptionKey<CURRENT_VERSION> for ClePublique {}
    impl Entity<CURRENT_VERSION> for Paire {}
    impl traits::HpkeKeyPair<CURRENT_VERSION> for Paire {}

    #[test]
    fn paire_hpke_aller_retour_postcard() {
        journal_vider();
        let s = Stockage::default();
        let paire = Paire(openmls_traits::types::HpkeKeyPair {
            private: vec![0x42; 32].into(),
            public: vec![0x24; 32],
        });
        let cle = ClePublique(vec![0x24; 32]);
        s.write_encryption_key_pair(&cle, &paire).unwrap();
        let relue: Paire = s.encryption_key_pair(&cle).unwrap().unwrap();
        assert_eq!(&*relue.0.private, &[0x42u8; 32][..]);
        assert_eq!(relue.0.public, vec![0x24u8; 32]);
        // Format stocké : postcard à longueur exacte, pas de JSON.
        let stocke = s.valeurs_lecture().unwrap();
        let (_, v) = stocke
            .iter()
            .find(|(k, _)| k.starts_with(ENCRYPTION_KEY_PAIR_LABEL))
            .unwrap();
        assert_eq!(v.len(), 1 + 32 + 1 + 32);
        drop(stocke);
        s.delete_encryption_key_pair(&cle).unwrap();
        assert!(s.encryption_key_pair::<Paire, _>(&cle).unwrap().is_none());
    }
}
