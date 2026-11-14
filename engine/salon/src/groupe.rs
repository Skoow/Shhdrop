//! Groupe MLS du salon (spec v3 §3) sur OpenMLS 0.9.2 : suite 0x0001, `PURE_CIPHERTEXT`, arbre
//! dans le Welcome, `max_past_epochs(1)`, aucun GroupInfo publié, aucun external commit ni
//! aucune proposition (externe ou d'un membre) acceptés.
//!
//! **Trames** : `Salon` ne parle qu'en trames de 4 140 octets (`trame.rs`). Il les fait lui-même
//! (`envoyer`, `key_package`, `ajouter`, `retirer`, `renouveler`, et le Welcome rendu par
//! `CommitAccepte`) et les lit par `recevoir_trame`. L'en-tête, lu en clair par le serveur, est
//! tiré du contenu : pour une enveloppe, volatile = `est_volatile(message)` et règle = `e.regle` ;
//! pour un Commit, un Welcome ou un KeyPackage, `EN_TETE_CONTROLE` (non volatile, désactivé).
//! L'octet des drapeaux est aussi mis en données authentifiées MLS (`set_aad`, signées par
//! l'auteur) de chaque message et Commit. À la réception, tout écart (en-tête ≠ contenu, données
//! authentifiées ≠ drapeaux, siège de la credential ≠ siège attesté par le serveur) est refusé
//! (`message_invalide`), avant toute fusion : une trame rescellée par quiconque connaît `K_trame`
//! (le lien et le mot de passe suffisent) ne passe pas.
//!
//! **Ordre des Commits** : le serveur numérote les trames (`seq`) et renvoie chacune à son
//! expéditeur. Un Commit créé ici reste *en attente* (non fusionné) jusqu'à son écho : le
//! premier Commit de l'époque dans l'ordre `seq` gagne chez tous. Si un Commit d'un autre
//! membre arrive avant l'écho du nôtre, le nôtre est abandonné (`clear_pending_commit`) et
//! `recevoir_trame` rend `CommitPerdu` : l'appelant rejoue son intention (ajout, retrait,
//! renouvellement). Les Commits plus anciens que l'époque courante sont ignorés.
//!
//! Notre Commit gagnant revient en `CommitAccepte { welcome }` : le Welcome d'un ajout n'est
//! rendu qu'à ce moment, jamais avec le Commit.
//!
//! **Arrivée** : l'arrivant crée son `Salon`, publie la trame de `key_package` et passe **toutes**
//! les trames à `recevoir_trame` dès sa création. Il garde tout ce qui arrive avant son Welcome
//! (trames et annonces, `ATTENTE_MAX` entrées au plus, au-delà `attente_pleine`) ; le Welcome fait
//! pour son KeyPackage le fait entrer (vérifié avec les annonces au rang du Commit qui l'ajoute,
//! Commit de l'époque précédente envoyé par le siège attesté du Welcome) et la file est rejouée
//! dans l'ordre : `Entree { rejoues }` rend ce que chaque trame a donné.
//! Rien n'est perdu entre le Commit qui l'ajoute et son Welcome (messages, renouvellements).
//!
//! **Politique** (`politique.rs`) : vérifiée avant fusion sur chaque Commit reçu, sur nos
//! propres Commits à leur création et de nouveau à leur écho (les annonces ont pu changer).
//!
//! **Annonces du serveur (contrat de l'appelant)** : la politique dépend de ce que le serveur
//! a annoncé ; deux membres qui n'en savent pas autant divergent (l'un fusionne, l'autre
//! refuse et reste en arrière). L'appelant doit donc donner à `remplacer_annonces` la liste
//! complète `(siège, nonce_arrivee)` reçue à l'accueil du WebSocket (et à chaque
//! reconnexion) **avant tout `recevoir_trame`**, puis chaque 0x02 / 0x0A à `annoncer`, chaque
//! 0x03 à `marquer_parti` et chaque 0x09 à `marquer_exclu` (siège, ou aucun, et numéro `r`),
//! dans l'ordre `seq`, avant les trames qui les suivent.
//! Chaque trame va à `recevoir_trame` avec le siège que le serveur atteste l'avoir envoyée, **y
//! compris en attente d'entrer** et pour la file rejouée à la (re)connexion : un ajout n'est
//! accepté que si l'on a vu le KeyPackage publié par le siège même de l'arrivant.
//!
//! **Renouvellement (contrat de l'appelant)** : `renouveler` toutes les 100 trames envoyées
//! (volatiles comprises : elles avancent le même compteur MLS) et toutes les heures. OpenMLS
//! saute au plus 1 000 générations d'un expéditeur : au-delà, ses messages sont refusés
//! (`mls_invalide`).
//!
//! **Membres fantômes (risque accepté, décision du 11 novembre)** : un serveur malveillant
//! peut annoncer un siège pour un KeyPackage à lui ; le membre désigné l'ajoutera, et ce
//! « membre » lira la suite. MLS ne peut pas l'empêcher sans service d'authentification ;
//! seuls les codes de vérification (`empreinte`, comparés hors du salon) le révèlent.
//!
//! **Créateur** : l'identifiant du groupe MLS est `tag_salon` (16) ‖ siège du créateur (1) ‖ sa
//! clé d'identité Ed25519 (32), fixé à la création et authentifié par MLS (contexte du groupe)
//! chez tous les membres, arrivés plus tard compris. Le rôle (retirer un membre présent, envoyer
//! la rotation, recréer le groupe) tient au siège **et** à cette clé (relecture du 13 novembre,
//! point 4). **Depuis le 14 novembre (décision du propriétaire : « L'admin ne doit jamais perdre
//! ses rôles admin »)**, cette clé est la **clé de rôle**, tirée de `S_gestion`
//! (`identite_createur` : HKDF « shhdrop/v2/salon/role », puis Ed25519) et non plus tirée au
//! hasard : le créateur revenu (rechargement, page fermée, « Quitter » puis retour, autre
//! appareil muni du lien de gestion) entre avec la même clé, et la feuille de son KeyPackage,
//! signée par elle (signature du KeyPackage, puis de chaque message et Commit), **est** la preuve
//! de rôle : rendu dès le Commit qui l'ajoute, sans attendre un renouvellement. Une preuve ne se
//! rejoue pas sur une autre feuille (il faudrait signer avec la clé privée de rôle) ; une feuille
//! d'une autre clé au siège du créateur est un membre ordinaire. **La clé de rôle n'est admise
//! qu'au siège du créateur** (KeyPackage ignoré, ajout et Welcome refusés ailleurs) et MLS refuse
//! deux feuilles de même clé : il y a au plus **une** feuille créatrice, la plus récente (le
//! Commit qui ajoute la nouvelle retire l'ancienne, une feuille par siège). Ce Commit porte
//! `createur_revenu` chez tous (`Membres`, `CommitPerdu`, `CommitAccepte`) : l'écran le dit.
//!
//! **Parti ou exclu : par arrivée, pas par siège** (relecture du 13 novembre, point 1) : la
//! marque porte sur l'arrivée `(siège, nonce_arrivee)` de la feuille. Une nouvelle annonce sur
//! le même siège ne l'efface pas ; l'arrivée marquée n'est jamais réadmise. Après une liste
//! complète, une feuille qui n'est pas l'annonce courante de son siège est à retirer, y compris
//! l'ancienne feuille d'une reprise (0x0A) jusqu'au Commit qui la remplace (14 novembre : la
//! liste ne distingue pas une reprise d'un départ suivi d'une arrivée ; le flux et la liste
//! doivent donner le même jugement chez tous).
//!
//! **Priorité du retrait** (point 6) : tant qu'une feuille est à retirer, un Commit qui ne les
//! retire pas toutes est refusé ; `ajouter`, `retirer` et `renouveler` les retirent d'office.
//!
//! **Exclusion et départ : le moteur impose l'ordre** (audit adverse du 13 novembre, F1 et F2 ;
//! spec salon v3 §15). Une erreur de l'appelant donne un refus, jamais une fuite :
//! - `envoyer` est refusé tant qu'un Commit de ce membre attend son écho (`commit_en_cours`) :
//!   le message serait chiffré à l'époque que ce Commit ferme, lisible par le membre qu'il
//!   retire ;
//! - `envoyer` est refusé tant qu'un siège que le serveur a dit parti (0x03) ou exclu (0x09) a
//!   encore une feuille dans l'arbre (`retrait_en_attente`) : tout membre peut le retirer
//!   (`a_retirer`, `retirer`), puis renvoyer ; `exporter_sframe` (clé des appels) suit les
//!   mêmes refus ;
//! - un Commit dont l'auteur est un siège parti ou exclu est refusé (`commit_refuse`), un
//!   message de lui aussi (`non_membre`) ; les propositions ne sont jamais gardées ;
//! - chaque `Message` rendu porte l'époque à laquelle il a été chiffré (un message de l'époque
//!   précédente reste lisible, `max_past_epochs(1)` : l'appelant voit qu'il date d'avant le
//!   dernier Commit) ;
//! - le message `rotation` (`K_maître_s'`) n'est envoyé que par le créateur et n'est accepté
//!   que de lui, à l'**époque courante** (jamais la précédente), chaque feuille de l'arbre
//!   étant l'annonce courante de son siège, et son numéro `n` étant le `r` du dernier 0x09
//!   (`marquer_exclu`), jamais déjà servi : sinon `rotation_refusee`, et la clé ne doit pas
//!   servir ;
//! - à l'écho de sa rotation, le créateur reçoit `RotationAcceptee` ou `RotationARenvoyer`
//!   (mêmes conditions que chez les destinataires, au même rang).
//!
//! Ordre d'une exclusion (contrat de l'appelant) : `POST exclure` (le serveur émet `0x09` →
//! `marquer_exclu`) ; `retirer` par le créateur (ou tout membre) ; écho (`CommitAccepte`, ou
//! `Membres`/`CommitPerdu` avec le siège dans `retires`) ; `envoyer` du message `rotation` par
//! le créateur ; à sa réception, chaque membre restant passe aux nouvelles clés
//! (`cles_depuis_maitre`) et **refonde le groupe** (`refonder`) : l'identifiant du groupe MLS
//! porte l'étiquette de l'invitation, une arrivante munie de la nouvelle invitation ne peut
//! entrer que dans un groupe créé sous elle (F3). Le créateur ne refonde qu'à l'écho
//! `RotationAcceptee` ; à `RotationARenvoyer` (Commit, départ ou reprise passés entre l'envoi et
//! l'écho), les membres l'ont refusée : il règle ce qui manque et la renvoie.
use crate::cles::{ClesSalon, graine_role};
use crate::error::{Error, Result};
use crate::message::{Enveloppe, Message, decoder, encoder};
use crate::politique::{self, Changements};
use crate::stockage::Fournisseur;
use crate::trame::{
    EN_TETE_CONTROLE, EnTete, MAX_CHARGE, TAILLE_TRAME, en_tete_coherent, en_tete_de, ouvrir,
    sceller,
};
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
/// ‖ clé), cinq `u32` gros-boutistes pris modulo 100 000, 5 chiffres chacun, séparés par une espace
/// (25 chiffres, 10^25 ≈ 2^83 codes ; 20 chiffres, ≈ 2^66, jusqu'au 13 novembre : fabriquer une
/// clé du même code restait à la portée d'un État, audit du 13 novembre).
pub fn code_verification(cle_publique: &[u8; 32]) -> String {
    let mut entree = VERIF.to_vec();
    entree.extend_from_slice(cle_publique);
    let h = sha256(&entree);
    let groupes: Vec<String> = h[..20]
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

/// Clé publique de rôle (Ed25519, 32 octets) tirée de `S_gestion` : la clé d'identité de
/// `identite_createur`, donc celle de l'identifiant du groupe et du code de vérification du
/// créateur. Publique (voir spec salon v3 §15.2) ; vecteurs `role` de `salon-v3.json`.
pub fn cle_publique_role(s_gestion: &[u8; 32]) -> [u8; 32] {
    let graine = graine_role(s_gestion);
    ed25519_dalek::SigningKey::from_bytes(&graine)
        .verifying_key()
        .to_bytes()
}

/// Identité du créateur pour le siège et le `nonce_arrivee` donnés par le serveur : la paire
/// Ed25519 est la **clé de rôle**, tirée de `S_gestion` (graine = HKDF(`S_gestion`,
/// « shhdrop/v2/salon/role »), RFC 8032), la même sur tout appareil et à chaque retour (même code
/// de vérification). Pour créer le groupe (`Salon::creer(…, true)`) et pour tout retour du
/// créateur (KeyPackage). La clé privée reste dans `SignatureKeyPair`, effacée à la destruction.
pub fn identite_createur(
    siege: u8,
    nonce_arrivee: [u8; 16],
    s_gestion: &[u8; 32],
) -> Result<Identite> {
    let graine = graine_role(s_gestion);
    let publique = ed25519_dalek::SigningKey::from_bytes(&graine)
        .verifying_key()
        .to_bytes();
    let signataire = SignatureKeyPair::from_raw(
        SUITE.signature_algorithm(),
        graine.to_vec(),
        publique.to_vec(),
    );
    Ok(Identite {
        signataire,
        siege,
        nonce_arrivee,
    })
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
    /// `epoque` : époque MLS à laquelle il a été chiffré, l'époque courante ou la précédente
    /// (`max_past_epochs(1)`) ; à la précédente, il a été écrit avant le dernier Commit, donc
    /// peut-être pour un membre que ce Commit a retiré. Un message `rotation` n'est rendu qu'à
    /// l'époque courante.
    Message {
        de_siege: u8,
        epoque: u64,
        enveloppe: Enveloppe,
    },
    /// Commit d'un autre membre fusionné : sièges ajoutés et retirés
    /// (un retour après rechargement figure dans les deux listes). `createur_revenu` : ce Commit
    /// ajoute la feuille de la clé de rôle (le créateur a repris la main : rechargement, retour ou
    /// autre appareil muni du lien de gestion) ; son ancienne feuille, s'il en avait une, est
    /// retirée par ce même Commit et n'a plus aucun droit (14 novembre).
    Membres {
        ajoutes: Vec<u8>,
        retires: Vec<u8>,
        createur_revenu: bool,
    },
    /// Notre Commit en attente a perdu (un autre Commit de l'époque est passé avant, ou la
    /// politique le refuse à son écho) : l'appelant rejoue son intention. `ajoutes` et
    /// `retires` : ce qu'a changé le Commit gagnant (vides si la politique a refusé le nôtre
    /// à son écho, sans autre Commit). `createur_revenu` : comme pour `Membres`.
    CommitPerdu {
        ajoutes: Vec<u8>,
        retires: Vec<u8>,
        createur_revenu: bool,
    },
    /// Notre Commit en attente est revenu le premier de son époque et a été fusionné ; pour
    /// un ajout, le Welcome à envoyer maintenant à l'arrivant. `createur_revenu` : comme pour
    /// `Membres` (nous venons d'ajouter la feuille de la clé de rôle).
    CommitAccepte {
        welcome: Option<Vec<u8>>,
        createur_revenu: bool,
    },
    /// KeyPackage d'un arrivant annoncé (valide, suite 0x0001, siège et nonce annoncés, pas
    /// déjà dans le groupe) : à passer à `ajouter` par le membre désigné.
    KeyPackage { octets: Vec<u8> },
    /// Entrée dans le groupe : le Welcome fait pour notre KeyPackage est arrivé. `rejoues` :
    /// chaque trame gardée en attente, dans l'ordre `seq`, avec ce qu'elle a donné une fois
    /// rejouée (celles d'avant le Commit qui nous ajoute rendent `Ignore`).
    Entree {
        rejoues: Vec<(u64, Result<Evenement>)>,
    },
    /// Écho de notre message `rotation` (créateur) : les conditions que les destinataires
    /// vérifient (époque courante, chaque feuille admise, numéro `n` de l'exclusion) tiennent
    /// aussi à son rang ; les membres l'ont acceptée, le créateur peut refonder.
    RotationAcceptee { n: u32 },
    /// Écho de notre message `rotation` : à son rang, une condition ne tient plus (Commit, départ
    /// ou reprise passés entre l'envoi et l'écho) ; les membres l'ont refusée (`rotation_refusee`).
    /// Ne pas refonder : régler ce qui manque (`a_retirer`), puis la renvoyer.
    RotationARenvoyer { n: u32 },
    /// Rien à faire : écho de notre message, Commit perdant d'une époque passée, rejeu (`seq`
    /// déjà vu), Welcome destiné à d'autres, KeyPackage périmé ou non annoncé, proposition
    /// (jamais gardée).
    Ignore,
}

/// Ce que le serveur a annoncé des sièges : la politique en dépend (voir l'en-tête du module).
///
/// **Suivi par arrivée** (13 novembre) : « parti ou exclu » se dit d'une arrivée `(siège,
/// nonce_arrivee)`, celle que porte la credential de la feuille, jamais d'un numéro de siège :
/// une nouvelle annonce sur le même siège n'efface pas la marque de l'ancienne feuille.
#[derive(Clone, Default)]
struct Registre {
    /// Dernière annonce `(siège, nonce_arrivee)` du serveur pour chaque siège.
    annonces: Vec<(u8, [u8; 16])>,
    /// Arrivées que le serveur a dites parties (0x03) ou exclues (0x09) : jamais réadmises,
    /// même annoncées de nouveau.
    parties: Vec<(u8, [u8; 16])>,
    /// Premier KeyPackage valide de chaque arrivée annoncée, envoyé par son propre siège ; après
    /// une refondation, aussi la clé d'identité de chaque membre de l'ancien groupe.
    key_packages: Vec<politique::Arrivee>,
    /// Siège du créateur donné par le serveur avec la liste complète (vérifié au Welcome).
    createur_annonce: Option<u8>,
    /// Une liste complète des sièges occupés a été donnée (`remplacer_annonces`).
    liste_complete: bool,
    /// Numéro `r` de la dernière exclusion ou rotation annoncée par le serveur (0x09).
    exclusion: Option<u32>,
    /// Numéro `n` de la dernière rotation acceptée.
    rotation_vue: Option<u32>,
}

impl Registre {
    fn annoncer(&mut self, siege: u8, nonce_arrivee: [u8; 16]) {
        // Une arrivée partie ou exclue ne revient pas : annoncée de nouveau, elle est ignorée.
        if self.parties.contains(&(siege, nonce_arrivee)) {
            return;
        }
        self.key_packages
            .retain(|k| k.0 != siege || k.1 == nonce_arrivee);
        self.annonces.retain(|a| a.0 != siege);
        self.annonces.push((siege, nonce_arrivee));
    }

    fn remplacer(&mut self, createur_siege: u8, liste: &[(u8, [u8; 16])]) {
        self.annonces.clear();
        for &(siege, nonce) in liste {
            self.annoncer(siege, nonce);
        }
        let annonces = &self.annonces;
        self.key_packages.retain(|k| annonces.contains(&(k.0, k.1)));
        self.createur_annonce = Some(createur_siege);
        self.liste_complete = true;
    }

    /// Départ (0x03) ou exclusion (0x09) du siège : son annonce courante et `feuilles`
    /// (credentials de ses feuilles dans l'arbre) sont marquées parties.
    fn marquer_parti(&mut self, siege: u8, feuilles: &[(u8, [u8; 16])]) {
        let connues: Vec<(u8, [u8; 16])> = self
            .annonces
            .iter()
            .chain(feuilles)
            .filter(|a| a.0 == siege)
            .copied()
            .collect();
        for a in connues {
            if !self.parties.contains(&a) {
                self.parties.push(a);
            }
        }
        self.annonces.retain(|a| a.0 != siege);
        self.key_packages.retain(|k| k.0 != siege);
    }

    /// Numéro `r` d'une exclusion ou d'une rotation annoncée (0x09) : le plus grand reçu.
    fn noter_exclusion(&mut self, r: u32) {
        if self.exclusion.is_none_or(|e| r > e) {
            self.exclusion = Some(r);
        }
    }

    /// La feuille de cette credential est-elle admise ? Jamais si son arrivée est partie ou
    /// exclue ; après une liste complète du serveur, seulement si elle est l'annonce courante
    /// de son siège.
    ///
    /// 14 novembre : une feuille remplacée par une reprise (0x0A) n'est **plus** admise jusqu'au
    /// Commit qui la remplace. La liste complète (0x0D) ne dit que l'annonce courante de chaque
    /// siège : elle ne distingue pas « reprise » de « départ puis nouvelle arrivée ». Un membre
    /// qui a vu le 0x0A en direct et un membre qui n'a reçu que la liste (reconnexion) doivent
    /// juger l'ancienne feuille de la même façon, sinon l'un fusionne un Commit que l'autre
    /// refuse (groupe scindé).
    fn admise(&self, c: &(u8, [u8; 16])) -> bool {
        !self.parties.contains(c) && (!self.liste_complete || self.annonces.contains(c))
    }

    /// Credentials des feuilles de l'arbre à retirer (non admises) : tant qu'il en reste, elles
    /// liraient ce qui est envoyé.
    fn feuilles_a_retirer(&self, groupe: &MlsGroup) -> Vec<(u8, [u8; 16])> {
        groupe
            .members()
            .filter_map(|m| lire_credential(&m.credential).ok())
            .filter(|c| !self.admise(c))
            .collect()
    }

    /// Sièges de ces feuilles, en ordre croissant.
    fn a_retirer(&self, groupe: &MlsGroup) -> Vec<u8> {
        let mut s: Vec<u8> = self
            .feuilles_a_retirer(groupe)
            .iter()
            .map(|c| c.0)
            .collect();
        s.sort_unstable();
        s.dedup();
        s
    }

    /// Conditions d'un message `rotation` de numéro `n`, les mêmes à l'envoi, à la réception et
    /// à l'écho : **chaque** feuille de l'arbre est l'annonce courante de son siège (ni partie,
    /// ni exclue, ni inconnue, ni en cours de remplacement : un membre qui revient après un
    /// rechargement ne lirait pas la rotation ; exigé aussi sans liste complète) ; `n` est le numéro de la dernière exclusion
    /// annoncée par le serveur (0x09) et dépasse celui de la dernière rotation acceptée.
    fn rotation_recevable(&self, groupe: &MlsGroup, n: u32) -> bool {
        groupe.members().all(|m| {
            lire_credential(&m.credential)
                .is_ok_and(|c| self.annonces.contains(&c) && !self.parties.contains(&c))
        }) && self.exclusion == Some(n)
            && self.rotation_vue.is_none_or(|v| n > v)
    }

    /// Politique d'adhésion (`politique::verifier`) d'un Commit sur ce groupe ; `auteur` :
    /// credential de la feuille de l'auteur, `auteur_createur` : c'est celle du créateur.
    fn verifier(
        &self,
        groupe: &MlsGroup,
        ch: &Changements,
        auteur_createur: bool,
        auteur: (u8, [u8; 16]),
    ) -> Result<()> {
        politique::verifier(
            ch,
            auteur_createur,
            auteur,
            &self.annonces,
            &self.feuilles_a_retirer(groupe),
            &self.key_packages,
        )
    }
}

/// Entrée de la file d'un participant en attente d'entrer, dans l'ordre où elle est arrivée.
enum Attente {
    /// Trame ouverte : rang, siège attesté, en-tête et message MLS.
    Trame {
        seq: u64,
        siege: u8,
        en_tete: EnTete,
        mls: Vec<u8>,
    },
    Annonce(u8, [u8; 16]),
    Parti(u8),
    /// Exclusion ou rotation annoncée (0x09) : siège exclu (aucun pour un simple nouveau lien)
    /// et numéro `r`.
    Exclusion(Option<u8>, u32),
    Liste(u8, Vec<(u8, [u8; 16])>),
}

/// Taille maximale de la file d'attente (trames et annonces) avant l'entrée : au-delà,
/// `attente_pleine` (l'arrivant recommence comme nouvel arrivant).
pub const ATTENTE_MAX: usize = 2000;

/// Résultat d'une trame rejouée à l'entrée : son rang `seq` et ce qu'elle a donné.
pub type Rejoue = (u64, Result<Evenement>);

/// Un participant du salon et son état MLS (en mémoire, stockage qui efface).
pub struct Salon {
    fournisseur: Fournisseur,
    identite: Identite,
    tag: [u8; 16],
    groupe: Option<MlsGroup>,
    createur_siege: u8,
    /// Clé d'identité (Ed25519) du créateur, portée par l'identifiant du groupe MLS et donc
    /// authentifiée chez tous : le rôle de créateur tient au siège **et** à cette clé (`None`
    /// avant l'entrée).
    createur_cle: Option<[u8; 32]>,
    /// Après une refondation : clé du créateur de l'ancien groupe ; le Welcome d'un groupe créé
    /// par une autre clé, ou sans la feuille de ce créateur, est refusé.
    createur_attendu: Option<[u8; 32]>,
    registre: Registre,
    /// Registre d'où part la file rejouée à l'entrée : vide, ou après une refondation ce que
    /// l'ancien salon savait (arrivées parties, numéros d'exclusion et de rotation, identités).
    depart: Registre,
    /// Empreinte SHA-256 des octets MLS de notre dernier message `rotation` et son numéro, en
    /// attente de son écho.
    rotation_en_vol: Option<([u8; 32], u32)>,
    /// Octets MLS de notre Commit en attente de son écho, et la trame du Welcome qu'il rendra
    /// s'il gagne.
    commit_en_attente: Option<(Vec<u8>, Option<Vec<u8>>)>,
    dernier_seq: Option<u64>,
    /// Références de nos KeyPackages (pour reconnaître le Welcome qui nous est fait).
    nos_key_packages: Vec<KeyPackageRef>,
    /// En attente d'entrer : tout ce qui est arrivé depuis la création, rejoué à l'entrée.
    attente: Vec<Attente>,
    /// La file a débordé : l'entrée est refusée (`attente_pleine`).
    attente_pleine: bool,
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

/// Suite annoncée par le KeyPackage que portent ces octets MLS (pas encore vérifié) : en TLS,
/// `MLSMessage` = version (2) ‖ wire_format (2) ‖ `KeyPackage` = version (2) ‖ cipher_suite (2)…
/// (RFC 9420 §6, §10). Lue dans les octets reçus, sans réencoder.
fn suite_annoncee(mls: &[u8]) -> Option<[u8; 2]> {
    mls.get(6..8)?.try_into().ok()
}

#[cfg(test)]
thread_local! {
    // Nombre de KeyPackages vérifiés (signature) dans ce fil : borne du coût de `entrer`.
    static VALIDATIONS: core::cell::Cell<usize> = const { core::cell::Cell::new(0) };
}

/// KeyPackage reçu (`kp`, lu dans les octets MLS `mls`) : suite 0x0001 (contrôlée **avant** toute
/// vérification de signature : une autre suite atteindrait P-256/P-384, jamais utilisées ici),
/// valide (signature), durée de vie sans horloge.
fn lire_key_package(
    kp: KeyPackageIn,
    mls: &[u8],
    crypto: &impl OpenMlsCrypto,
) -> Result<KeyPackage> {
    if suite_annoncee(mls) != Some(u16::from(SUITE).to_be_bytes()) {
        return Err(Error::MlsInvalide);
    }
    #[cfg(test)]
    VALIDATIONS.with(|v| v.set(v.get() + 1));
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

/// Une feuille du groupe porte-t-elle cette credential `(siège, nonce_arrivee)` ?
fn contient(groupe: &MlsGroup, c: (u8, [u8; 16])) -> bool {
    groupe
        .members()
        .any(|m| lire_credential(&m.credential).is_ok_and(|x| x == c))
}

/// Ces octets sont-ils un Commit (chiffré) de l'époque `epoque` ? Lu dans l'en-tête du
/// PrivateMessage, sans clé.
fn est_commit_de(mls: &[u8], epoque: u64) -> bool {
    match lire_mls(mls) {
        Ok(MlsMessageBodyIn::PrivateMessage(p)) => {
            let p = ProtocolMessage::from(p);
            p.content_type() == ContentType::Commit && p.epoch().as_u64() == epoque
        }
        _ => false,
    }
}

fn membres_de(ch: &Changements, createur: Createur) -> Evenement {
    Evenement::Membres {
        ajoutes: ch.ajouts.iter().map(|a| a.0).collect(),
        retires: ch.retraits.iter().map(|r| r.0).collect(),
        createur_revenu: createur_ajoute(ch, createur),
    }
}

/// Siège du créateur et clé de rôle portés par l'identifiant du groupe (clé absente avant
/// l'entrée).
type Createur = (u8, Option<[u8; 32]>);

/// Le Commit ajoute-t-il la feuille de la clé de rôle, au siège du créateur ?
fn createur_ajoute(ch: &Changements, (siege, cle): Createur) -> bool {
    cle.is_some_and(|c| {
        let e = sha256(&c);
        ch.ajouts.iter().any(|a| a.0 == siege && a.2 == e)
    })
}

/// 14 novembre : la clé de rôle n'est admise qu'au siège du créateur. Ailleurs (lien de gestion
/// volé utilisé depuis une place d'invité, client modifié), la feuille n'aurait aucun droit
/// (le rôle tient aussi au siège) mais prendrait la clé : MLS refusant deux feuilles de même clé,
/// le vrai créateur ne pourrait plus revenir. `empreinte` : SHA-256 de la clé de la feuille.
fn cle_de_role_hors_siege(siege: u8, empreinte: &[u8; 32], (cs, cle): Createur) -> bool {
    siege != cs && cle.is_some_and(|c| sha256(&c) == *empreinte)
}

/// Un ajout du Commit porte-t-il la clé de rôle hors du siège du créateur ?
fn ajout_de_role_hors_siege(ch: &Changements, createur: Createur) -> bool {
    ch.ajouts
        .iter()
        .any(|a| cle_de_role_hors_siege(a.0, &a.2, createur))
}

/// Feuilles qu'un Commit retire (indices et credentials) et sièges des feuilles qui restent.
type Prevision = (Vec<LeafNodeIndex>, Vec<(u8, [u8; 16])>, Vec<u8>);

/// Ce que retire un Commit de ce membre : les feuilles du siège `siege` (s'il y en a un) et,
/// toujours, les feuilles à retirer (arrivées parties, exclues ou inconnues du serveur :
/// priorité du retrait, `politique::verifier`), sauf la nôtre (MLS ne laisse pas l'auteur se
/// retirer ; la politique refuse alors le Commit).
fn prevoir(groupe: &MlsGroup, registre: &Registre, siege: Option<u8>) -> Result<Prevision> {
    let (mut indices, mut retraits, mut restants) = (Vec::new(), Vec::new(), Vec::new());
    for m in groupe.members() {
        let c = lire_credential(&m.credential)?;
        if m.index != groupe.own_leaf_index() && (siege == Some(c.0) || !registre.admise(&c)) {
            indices.push(m.index);
            retraits.push(c);
        } else {
            restants.push(c.0);
        }
    }
    Ok((indices, retraits, restants))
}

/// Taille de l'identifiant du groupe MLS : `tag_salon` (16) ‖ siège du créateur (1) ‖ clé
/// d'identité Ed25519 du créateur (32).
const TAILLE_ID_GROUPE: usize = 49;

impl Salon {
    /// Nouveau participant. `createur` : il crée le groupe MLS (premier membre, seul à pouvoir
    /// retirer autrui ; l'identifiant du groupe porte son siège et sa clé d'identité) ; sinon il
    /// publie son KeyPackage (`key_package`) et attend son Welcome, qui arrive par
    /// `recevoir_trame` comme toute trame. Seule l'étiquette du salon est lue dans `cles`
    /// (l'appelant les garde pour les trames).
    ///
    /// **Contrat (14 novembre)** : le créateur passe `identite_createur` (clé de rôle tirée de
    /// `S_gestion`), pour créer le groupe comme pour revenir ; une identité tirée au hasard
    /// (`nouvelle_identite`) fonderait un groupe dont le rôle serait perdu au premier
    /// rechargement. Les liaisons (site : `Salon.creer(…, createur, sGestion)` ; apps : même
    /// règle) refusent `createur` sans `S_gestion`.
    pub fn creer(identite: Identite, cles: &ClesSalon, createur: bool) -> Result<Salon> {
        let mut salon = Salon {
            fournisseur: Fournisseur::default(),
            tag: *cles.tag(),
            createur_siege: identite.siege,
            createur_cle: None,
            createur_attendu: None,
            identite,
            groupe: None,
            registre: Registre::default(),
            depart: Registre::default(),
            rotation_en_vol: None,
            commit_en_attente: None,
            dernier_seq: None,
            nos_key_packages: Vec::new(),
            attente: Vec::new(),
            attente_pleine: false,
        };
        if createur {
            let cle: [u8; 32] = salon
                .identite
                .cle_publique()
                .try_into()
                .map_err(|_| Error::MlsInterne)?;
            let mut id = salon.tag.to_vec();
            id.push(salon.identite.siege);
            id.extend_from_slice(&cle);
            salon.createur_cle = Some(cle);
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

    /// Trame du KeyPackage à publier à l'arrivée (en-tête de contrôle). Ses clés privées restent
    /// dans ce salon : c'est lui qui reconnaîtra le Welcome.
    pub fn key_package(&mut self, cles: &ClesSalon) -> Result<[u8; TAILLE_TRAME]> {
        if self.groupe.is_some() {
            return Err(Error::DejaMembre);
        }
        // « Last resort » : OpenMLS n'efface pas la clé d'init au premier Welcome lu ; un faux
        // Welcome refusé ne grille donc pas le KeyPackage. L'entrée l'efface ensuite.
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
        let reference = paquet
            .key_package()
            .hash_ref(self.fournisseur.crypto())
            .map_err(|_| Error::MlsInterne)?;
        let mls = serialiser(&MlsMessageOut::from(paquet.key_package().clone()))?;
        let trame = sceller(cles, EN_TETE_CONTROLE, &mls)?;
        self.nos_key_packages.push(reference);
        Ok(trame)
    }

    /// Le Welcome est-il fait pour l'un de nos KeyPackages ?
    fn welcome_pour_nous(&self, welcome: &Welcome) -> bool {
        welcome
            .secrets()
            .iter()
            .any(|e| self.nos_key_packages.contains(&e.new_member()))
    }

    /// Entre dans le groupe par un Welcome (arbre inclus) fait pour notre KeyPackage, envoyé par
    /// `siege_welcome` (siège attesté par le serveur), puis rejoue la file d'attente. Refus :
    /// autre salon, autre suite, extensions de contexte (expéditeurs externes…), siège attesté
    /// sans feuille dans l'arbre ou égal au nôtre, credential illisible, siège en double dans
    /// l'arbre, créateur, nonce ou clé autres que ceux annoncés **au rang du Commit qui nous
    /// ajoute** (les annonces arrivées entre ce Commit et le Welcome ne s'appliquent qu'après).
    /// Ce Commit est cherché parmi les trames de contrôle de la file envoyées par `siege_welcome`
    /// à l'époque précédant celle du Welcome, dans l'ordre : le premier avec lequel le Welcome
    /// se vérifie est retenu (un Commit refusé par tous ou une trame injectée du même siège ne
    /// suffit pas à fausser le rang). En cas de refus, rien ne change (file et annonces
    /// gardées) : un vrai Welcome peut encore venir.
    ///
    /// Limites connues : un serveur qui ment sur le siège attesté du Welcome (un autre membre de
    /// l'arbre, sans Commit de lui dans la file) force le repli « sans candidat » : annonces
    /// courantes, et toute la file est rendue `Ignore` pour cette entrée (rien n'est lu en plus :
    /// aucun gain de confidentialité, seulement des trames manquées). Le premier candidat qui
    /// vérifie le Welcome peut aussi précéder le vrai Commit (Commit refusé du même siège, avec
    /// les mêmes annonces) : les trames d'entre les deux reviennent alors en `Ignore` ou en
    /// erreur dans `rejoues`. Si l'effacement d'une clé d'init échoue, l'entrée est faite mais l'appel rend
    /// `mls_interne` (les `rejoues` sont perdus).
    fn entrer(&mut self, welcome: Welcome, siege_welcome: u8) -> Result<Vec<Rejoue>> {
        if self.attente_pleine {
            return Err(Error::AttentePleine);
        }
        // Suite contrôlée avant toute vérification de signature (une autre suite atteindrait
        // P-256/P-384, jamais utilisées ici).
        if welcome.ciphersuite() != SUITE {
            return Err(Error::MlsInvalide);
        }
        let prepare =
            StagedWelcome::new_from_welcome(&self.fournisseur, &config_jonction(), welcome, None)
                .map_err(|_| Error::MlsInvalide)?;
        let contexte = prepare.group_context();
        let id = contexte.group_id().as_slice();
        if contexte.ciphersuite() != SUITE
            || id.len() != TAILLE_ID_GROUPE
            || id[..16] != self.tag
            || contexte.extensions().iter().next().is_some()
        {
            return Err(Error::MlsInvalide);
        }
        let createur_siege = id[16];
        let mut createur_cle = [0u8; 32];
        createur_cle.copy_from_slice(&id[17..]);
        let epoque = contexte.epoch().as_u64();
        // L'expéditeur attesté du Welcome est l'auteur du Commit qui nous ajoute : un membre
        // de l'arbre, autre que nous.
        if siege_welcome == self.identite.siege
            || !prepare
                .members()
                .any(|m| lire_credential(&m.credential).is_ok_and(|c| c.0 == siege_welcome))
        {
            return Err(Error::MlsInvalide);
        }
        // Annonces au rang du Commit qui nous ajoute : candidats, les Commits de l'époque
        // précédente envoyés par ce siège, dans l'ordre ; pour chacun, les annonces sont
        // refaites depuis le début de la file. Sans candidat (trames perdues), les annonces
        // courantes servent.
        let file = core::mem::take(&mut self.attente);
        let candidats: Vec<usize> = file
            .iter()
            .enumerate()
            .filter(|(_, a)| match a {
                Attente::Trame {
                    siege,
                    en_tete,
                    mls,
                    ..
                } => {
                    *siege == siege_welcome
                        && *en_tete == EN_TETE_CONTROLE
                        && est_commit_de(mls, epoque.wrapping_sub(1))
                }
                _ => false,
            })
            .map(|(i, _)| i)
            .collect();
        let vivant = core::mem::take(&mut self.registre);
        let mut avant = None;
        if candidats.is_empty() {
            self.registre = vivant.clone();
            if self
                .verifier_welcome(&prepare, createur_siege, &createur_cle)
                .is_ok()
            {
                avant = Some(file.len());
            }
        } else {
            // Un seul registre, avancé de candidat en candidat (mêmes états que s'il était
            // refait depuis le début de la file pour chacun) : chaque entrée de la file est
            // appliquée une fois au plus, donc au plus `ATTENTE_MAX` vérifications de KeyPackage
            // quel que soit le nombre de candidats (une file remplie de copies par un serveur
            // malveillant reste linéaire).
            self.registre = self.depart.clone();
            let mut pos = 0;
            for &i in &candidats {
                for a in &file[pos..i] {
                    self.appliquer_en_attente(a);
                }
                pos = i;
                if self
                    .verifier_welcome(&prepare, createur_siege, &createur_cle)
                    .is_ok()
                {
                    avant = Some(i);
                    break;
                }
            }
        }
        let Some(avant) = avant else {
            self.registre = vivant;
            self.attente = file;
            return Err(Error::MlsInvalide);
        };
        let groupe = match prepare.into_group(&self.fournisseur) {
            Ok(g) => g,
            Err(_) => {
                self.registre = vivant;
                self.attente = file;
                return Err(Error::MlsInvalide);
            }
        };
        self.createur_siege = createur_siege;
        self.createur_cle = Some(createur_cle);
        self.groupe = Some(groupe);
        // Entré : les clés d'init de tous nos KeyPackages (celui du Welcome et les autres
        // publiés) ne servent plus (confidentialité persistante). Chaque effacement est tenté ;
        // un échec est signalé (`mls_interne`) après le rejeu, l'entrée étant déjà faite.
        let mut effacement = Ok(());
        for r in core::mem::take(&mut self.nos_key_packages) {
            if self.fournisseur.storage().delete_key_package(&r).is_err() {
                effacement = Err(Error::MlsInterne);
            }
        }
        // Ce qui précède le Commit qui nous ajoute est d'avant notre entrée : illisible, ignoré.
        let mut rejoues = Vec::new();
        for a in &file[..avant] {
            if let Attente::Trame { seq, .. } = a {
                rejoues.push((*seq, Ok(Evenement::Ignore)));
            }
        }
        for a in file.into_iter().skip(avant) {
            match a {
                Attente::Trame {
                    seq,
                    siege,
                    en_tete,
                    mls,
                } => rejoues.push((seq, self.traiter(en_tete, &mls, siege))),
                autre => self.appliquer_en_attente(&autre),
            }
        }
        effacement.map(|()| rejoues)
    }

    /// Avant l'entrée : applique une annonce de la file, ou retient un KeyPackage qu'elle porte.
    fn appliquer_en_attente(&mut self, a: &Attente) {
        match a {
            Attente::Annonce(s, n) => self.registre.annoncer(*s, *n),
            Attente::Parti(s) => self.noter_parti(*s),
            Attente::Exclusion(s, r) => {
                if let Some(s) = s {
                    self.noter_parti(*s);
                }
                self.registre.noter_exclusion(*r);
            }
            Attente::Liste(c, l) => self.registre.remplacer(*c, l),
            // Comme à la réception : un KeyPackage sous un autre en-tête est refusé, jamais
            // retenu (N1).
            Attente::Trame {
                siege,
                en_tete,
                mls,
                ..
            } if *en_tete == EN_TETE_CONTROLE => {
                if let Ok(MlsMessageBodyIn::KeyPackage(kp)) = lire_mls(mls) {
                    let _ = self.key_package_recu(kp, mls, *siege);
                }
            }
            Attente::Trame { .. } => {}
        }
    }

    /// Le créateur est celui que le serveur a donné ; chaque feuille d'un siège occupé porte le
    /// nonce annoncé (et la clé retenue si son KeyPackage nous est passé). Une feuille d'un siège
    /// absent de la liste est un parti pas encore retiré. Après une refondation : le groupe est
    /// celui du créateur attendu (sa clé dans l'identifiant du groupe) et sa feuille y est.
    fn verifier_welcome(
        &self,
        prepare: &StagedWelcome,
        createur_siege: u8,
        createur_cle: &[u8; 32],
    ) -> Result<()> {
        if self.registre.createur_annonce != Some(createur_siege) {
            return Err(Error::MlsInvalide);
        }
        if let Some(attendu) = &self.createur_attendu
            && (attendu != createur_cle
                || !prepare.members().any(|m| {
                    m.signature_key == attendu[..]
                        && lire_credential(&m.credential).is_ok_and(|c| c.0 == createur_siege)
                }))
        {
            return Err(Error::MlsInvalide);
        }
        let mut sieges = Vec::new();
        for m in prepare.members() {
            let (s, n) = lire_credential(&m.credential)?;
            let annonce = self.registre.annonces.iter().find(|a| a.0 == s);
            let cle = sha256(&m.signature_key);
            let retenu = self
                .registre
                .key_packages
                .iter()
                .find(|k| (k.0, k.1) == (s, n));
            if sieges.contains(&s)
                || annonce.is_some_and(|a| a.1 != n)
                || retenu.is_some_and(|k| k.2 != cle)
                || cle_de_role_hors_siege(s, &cle, (createur_siege, Some(*createur_cle)))
            {
                return Err(Error::MlsInvalide);
            }
            sieges.push(s);
        }
        Ok(())
    }

    /// Range une annonce dans la file d'attente (avant l'entrée) ; vrai si elle y est.
    fn en_file(&mut self, a: Attente) -> bool {
        if self.groupe.is_some() {
            return false;
        }
        if self.attente.len() >= ATTENTE_MAX {
            self.attente_pleine = true;
        } else {
            self.attente.push(a);
        }
        true
    }

    /// Enregistre une arrivée annoncée par le serveur (0x02) ou une reprise de siège (0x0A) :
    /// remplace l'annonce précédente du même siège. Une arrivée dite partie ou exclue le reste
    /// (annoncée de nouveau, elle est ignorée) ; l'ancienne feuille du siège, s'il en a une, est
    /// à retirer (`a_retirer`) jusqu'au Commit qui la retire. À appeler dans
    /// l'ordre `seq`, avant le `recevoir_trame` des trames suivantes, pour que tous les membres
    /// appliquent la même politique.
    pub fn annoncer(&mut self, siege: u8, nonce_arrivee: [u8; 16]) {
        self.en_file(Attente::Annonce(siege, nonce_arrivee));
        self.registre.annoncer(siege, nonce_arrivee);
    }

    /// Liste complète des sièges occupés et de leur `nonce_arrivee`, donnée par le serveur à
    /// l'accueil du WebSocket (et à chaque reconnexion) avant toute trame : remplace toutes les
    /// annonces connues. Une feuille de l'arbre MLS dont l'arrivée `(siège, nonce_arrivee)`
    /// n'est pas dans cette liste est ensuite à retirer (retirable par tout membre) ; une
    /// annonce suivante du même siège ne la réadmet pas.
    pub fn remplacer_annonces(&mut self, createur_siege: u8, liste: &[(u8, [u8; 16])]) {
        self.en_file(Attente::Liste(createur_siege, liste.to_vec()));
        self.registre.remplacer(createur_siege, liste);
    }

    /// Siège annoncé parti (0x03) ou exclu (0x09) par le serveur, dans l'ordre `seq` : tout
    /// membre peut alors en retirer la feuille ; son annonce est oubliée (une nouvelle arrivée
    /// sur ce siège sera annoncée de nouveau).
    ///
    /// La marque porte sur l'**arrivée** `(siège, nonce_arrivee)` : l'annonce courante du siège
    /// et ses feuilles dans l'arbre. Une nouvelle annonce sur le même siège ne l'efface pas.
    pub fn marquer_parti(&mut self, siege: u8) {
        self.en_file(Attente::Parti(siege));
        self.noter_parti(siege);
    }

    /// Exclusion ou rotation de l'invitation annoncée par le serveur (0x09), dans l'ordre
    /// `seq` : `siege` exclu (`None` pour un nouveau lien sans exclu, siège `0xFF` du serveur),
    /// marqué comme par `marquer_parti`, et numéro `r` de la rotation. Un message `rotation`
    /// n'est envoyé et accepté que si son `n` est le dernier `r` reçu ici.
    pub fn marquer_exclu(&mut self, siege: Option<u8>, r: u32) {
        self.en_file(Attente::Exclusion(siege, r));
        if let Some(s) = siege {
            self.noter_parti(s);
        }
        self.registre.noter_exclusion(r);
    }

    fn noter_parti(&mut self, siege: u8) {
        let feuilles: Vec<(u8, [u8; 16])> = self
            .groupe
            .iter()
            .flat_map(|g| g.members())
            .filter_map(|m| lire_credential(&m.credential).ok())
            .collect();
        self.registre.marquer_parti(siege, &feuilles);
    }

    /// Notre feuille est-elle celle du créateur (siège et clé d'identité de l'identifiant du
    /// groupe) ?
    fn suis_createur(&self) -> bool {
        self.est_createur(self.identite.siege, self.identite.cle_publique())
    }

    /// La feuille `(siège, clé d'identité)` est-elle celle du créateur ? Le siège seul ne
    /// suffit pas : une reprise annoncée du siège du créateur arrive avec une autre clé et n'a
    /// pas ses droits (retirer un membre présent, envoyer la rotation). La clé est la clé de
    /// rôle (tirée de `S_gestion`) : seul qui détient `S_gestion` signe pour cette feuille.
    fn est_createur(&self, siege: u8, cle: &[u8]) -> bool {
        siege == self.createur_siege && self.createur_cle.is_some_and(|c| c[..] == *cle)
    }

    fn createur(&self) -> Createur {
        (self.createur_siege, self.createur_cle)
    }

    fn moi(&self) -> (u8, [u8; 16]) {
        (self.identite.siege, self.identite.nonce_arrivee)
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
        let kp = lire_key_package(kp, octets, self.fournisseur.crypto())?;
        let (siege, nonce) = lire_credential(kp.leaf_node().credential())?;
        if emetteur != siege || !self.registre.annonces.contains(&(siege, nonce)) {
            return Ok(Evenement::Ignore);
        }
        let cle = sha256(kp.leaf_node().signature_key().as_slice());
        match self
            .registre
            .key_packages
            .iter()
            .find(|k| (k.0, k.1) == (siege, nonce))
        {
            Some(k) if k.2 != cle => return Ok(Evenement::Ignore),
            Some(_) => {}
            None => self.registre.key_packages.push((siege, nonce, cle)),
        }
        let Some(groupe) = self.groupe.as_ref() else {
            return Ok(Evenement::Ignore);
        };
        if contient(groupe, (siege, nonce)) || cle_de_role_hors_siege(siege, &cle, self.createur())
        {
            return Ok(Evenement::Ignore);
        }
        Ok(Evenement::KeyPackage {
            octets: octets.to_vec(),
        })
    }

    /// Abandonne notre Commit en attente (et son Welcome) sans attendre son écho : à appeler
    /// après une reconnexion si l'écho n'est pas dans les trames rejouées (la trame s'est
    /// perdue). Attention : si l'écho arrive quand même ensuite, ce membre ne le fusionnera
    /// pas alors que les autres l'auront fait. L'envoi redevient possible à l'époque que ce
    /// Commit devait fermer : après l'abandon d'un retrait, rejouer `retirer` **avant** tout
    /// `envoyer` (pour un siège parti ou exclu, le moteur l'impose : `retrait_en_attente`).
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

    /// Prépare un Commit (en attente de son écho) après vérification de la politique ; rend sa
    /// trame (en-tête de contrôle, lié aussi dans les données authentifiées MLS).
    fn commit(
        &mut self,
        cles: &ClesSalon,
        ajout: Option<KeyPackage>,
        retraits: Vec<LeafNodeIndex>,
    ) -> Result<[u8; TAILLE_TRAME]> {
        let (createur, moi, role) = (self.suis_createur(), self.moi(), self.createur());
        let groupe = self.groupe.as_mut().ok_or(Error::NonMembre)?;
        let renouvellement = ajout.is_none() && retraits.is_empty();
        groupe.set_aad(vec![EN_TETE_CONTROLE.drapeaux()]);
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
        // taille et le scellement. Tout échec abandonne le Commit en attente (aucun état à
        // moitié fait).
        let auteur = groupe.own_leaf_index();
        let verdict = (|| {
            let sc = groupe.pending_commit().ok_or(Error::MlsInterne)?;
            let ch = changements(groupe, sc, auteur);
            if ajout_de_role_hors_siege(&ch, role) {
                return Err(Error::CommitRefuse);
            }
            self.registre.verifier(groupe, &ch, createur, moi)?;
            let commit = serialiser(paquet.commit())?;
            let welcome = paquet
                .to_welcome_msg()
                .map(|w| serialiser(&w))
                .transpose()?;
            let trame = sceller(cles, EN_TETE_CONTROLE, &commit)?;
            let welcome = welcome
                .map(|w| sceller(cles, EN_TETE_CONTROLE, &w).map(|t| t.to_vec()))
                .transpose()?;
            Ok((commit, welcome, trame))
        })();
        match verdict {
            Ok((commit, welcome, trame)) => {
                self.commit_en_attente = Some((commit, welcome));
                Ok(trame)
            }
            Err(e) => {
                groupe
                    .clear_pending_commit(self.fournisseur.storage())
                    .map_err(|_| Error::MlsInterne)?;
                Err(e)
            }
        }
    }

    /// Ajoute l'arrivant dont voici le KeyPackage (octets MLS reçus en `Evenement::KeyPackage`) :
    /// rend la trame du Commit seul. Si son siège a déjà une feuille (retour après
    /// rechargement), le même Commit la retire ; si cette arrivée même est déjà membre,
    /// `deja_membre`. Le Welcome est gardé ici et rendu (en trame) par `recevoir_trame` à l'écho
    /// gagnant du Commit (`CommitAccepte { welcome }`) ; si le Commit perd (`CommitPerdu`), il
    /// est jeté : il mènerait l'arrivant sur une branche morte.
    pub fn ajouter(&mut self, cles: &ClesSalon, key_package: &[u8]) -> Result<[u8; TAILLE_TRAME]> {
        self.groupe_libre()?;
        let MlsMessageBodyIn::KeyPackage(kp) = lire_mls(key_package)? else {
            return Err(Error::MlsInvalide);
        };
        let kp = lire_key_package(kp, key_package, self.fournisseur.crypto())?;
        let (siege, nonce) = lire_credential(kp.leaf_node().credential())?;
        let groupe = self.groupe.as_ref().ok_or(Error::NonMembre)?;
        if contient(groupe, (siege, nonce)) {
            return Err(Error::DejaMembre);
        }
        let (indices, retraits, restants) = prevoir(groupe, &self.registre, Some(siege))?;
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
        if ajout_de_role_hors_siege(&prevu, self.createur()) {
            return Err(Error::CommitRefuse);
        }
        self.registre
            .verifier(groupe, &prevu, self.suis_createur(), self.moi())?;
        self.commit(cles, Some(kp), indices)
    }

    /// Retire toutes les feuilles du siège : réservé au créateur (siège et clé d'identité), sauf
    /// arrivée partie ou exclue. Le même Commit retire aussi toute autre feuille à retirer.
    pub fn retirer(&mut self, cles: &ClesSalon, siege: u8) -> Result<[u8; TAILLE_TRAME]> {
        self.groupe_libre()?;
        let groupe = self.groupe.as_ref().ok_or(Error::NonMembre)?;
        if !groupe
            .members()
            .any(|m| lire_credential(&m.credential).is_ok_and(|c| c.0 == siege))
        {
            return Err(Error::SiegeInconnu);
        }
        let (indices, retraits, restants) = prevoir(groupe, &self.registre, Some(siege))?;
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
        self.registre
            .verifier(groupe, &prevu, self.suis_createur(), self.moi())?;
        self.commit(cles, None, indices)
    }

    /// Renouvellement (self-update) : nouvelles clés de feuille et de chemin. À la charge de
    /// l'appelant : toutes les 100 trames envoyées (volatiles comprises) et toutes les heures
    /// (spec v3 §3.1, §3.6.1). S'il reste des feuilles à retirer (`a_retirer`), le Commit les
    /// retire (priorité du retrait) : c'est alors un retrait, plus un simple renouvellement.
    pub fn renouveler(&mut self, cles: &ClesSalon) -> Result<[u8; TAILLE_TRAME]> {
        self.groupe_libre()?;
        let groupe = self.groupe.as_ref().ok_or(Error::NonMembre)?;
        let (indices, ..) = prevoir(groupe, &self.registre, None)?;
        self.commit(cles, None, indices)
    }

    /// Message MLS d'une enveloppe (JSON strict de `encoder`), l'octet des drapeaux de sa trame
    /// en données authentifiées MLS (signées par l'expéditeur).
    ///
    /// Refus avant tout chiffrement (audit du 13 novembre, F1 et F2) : `commit_en_cours` si un
    /// Commit de ce membre attend son écho ; `retrait_en_attente` si un siège parti ou exclu a
    /// encore une feuille dans l'arbre (`non_membre` si c'est le nôtre) ; `rotation_refusee`
    /// pour un message `rotation` qui ne vient pas du créateur (siège et clé d'identité), dont
    /// le `n` n'est pas celui de la dernière exclusion annoncée (`marquer_exclu`), ou tant
    /// qu'une feuille de l'arbre n'est pas l'annonce courante de son siège, ou tant que notre
    /// rotation précédente attend son écho. L'empreinte d'une rotation envoyée est gardée : son
    /// écho rend `RotationAcceptee` ou `RotationARenvoyer`.
    fn chiffrer(&mut self, e: &Enveloppe, en_tete: EnTete) -> Result<Vec<u8>> {
        let groupe = self.pret_a_chiffrer()?;
        let rotation = match e.message {
            Message::Rotation { n, .. } => {
                // Une seule rotation en vol (14 novembre) : deux rotations du même `n` et de
                // clés différentes seraient lues par les membres dans l'ordre (la première
                // acceptée, la seconde refusée), et l'écho de la première, plus reconnu, ne
                // dirait rien au créateur ; il refonderait sous la seconde clé, seul.
                if !self.suis_createur()
                    || self.rotation_en_vol.is_some()
                    || !self.registre.rotation_recevable(groupe, n)
                {
                    return Err(Error::RotationRefusee);
                }
                Some(n)
            }
            _ => None,
        };
        let groupe = self.groupe.as_mut().ok_or(Error::NonMembre)?;
        let json = encoder(e)?;
        groupe.set_aad(vec![en_tete.drapeaux()]);
        let message = groupe
            .create_message(&self.fournisseur, &self.identite.signataire, &json)
            .map_err(|_| Error::MlsInterne)?;
        let octets = serialiser(&message)?;
        if octets.len() > MAX_CHARGE {
            return Err(Error::TropGrand);
        }
        if let Some(n) = rotation {
            self.rotation_en_vol = Some((sha256(&octets), n));
        }
        Ok(octets)
    }

    /// Groupe prêt à chiffrer pour ses membres (message, clé d'appel) : mêmes refus pour tous
    /// les chemins de chiffrement. `non_membre` hors du groupe ou si le serveur dit notre
    /// arrivée partie ; `commit_en_cours` si un Commit de ce membre attend son écho (ce qui
    /// serait chiffré le serait à l'époque que ce Commit ferme) ; `retrait_en_attente` si une
    /// feuille à retirer est encore dans l'arbre (elle le lirait).
    fn pret_a_chiffrer(&self) -> Result<&MlsGroup> {
        let groupe = self.groupe_actif()?;
        if self.commit_en_attente.is_some() || groupe.pending_commit().is_some() {
            return Err(Error::CommitEnCours);
        }
        let a_retirer = self.registre.feuilles_a_retirer(groupe);
        if a_retirer.contains(&self.moi()) {
            return Err(Error::NonMembre);
        }
        if !a_retirer.is_empty() {
            return Err(Error::RetraitEnAttente);
        }
        Ok(groupe)
    }

    /// Trame d'une enveloppe : chiffrée par MLS, puis scellée sous l'en-tête tiré de son contenu
    /// (`en_tete_de` : volatile = `est_volatile`, règle = `e.regle`). Refusée tant qu'un Commit
    /// de ce membre attend son écho (`commit_en_cours`) ou qu'un siège parti ou exclu est encore
    /// dans l'arbre (`retrait_en_attente` : `a_retirer`, `retirer`, puis renvoyer) ; un message
    /// `rotation` n'est envoyé que par le créateur (`rotation_refusee`).
    pub fn envoyer(&mut self, cles: &ClesSalon, e: &Enveloppe) -> Result<[u8; TAILLE_TRAME]> {
        let en_tete = en_tete_de(e);
        let mls = self.chiffrer(e, en_tete)?;
        sceller(cles, en_tete, &mls)
    }

    /// Traite une trame rangée au rang `seq` par le serveur ; `siege_emetteur` est le siège que
    /// le serveur atteste avoir envoyé la trame (enregistrement 0x01). Les rangs déjà vus (rejeu,
    /// rattrapage après reconnexion) sont ignorés ; une erreur consomme aussi le rang. L'en-tête
    /// doit dire ce que dit le contenu (`en_tete_coherent`, et pour un message MLS, l'octet des
    /// drapeaux en données authentifiées), et le siège de la credential MLS doit être le siège
    /// attesté : sinon `message_invalide`, l'état ne change pas (sauf le rang).
    ///
    /// **En attente d'entrer** : toute trame est gardée (au plus `ATTENTE_MAX` entrées avec les
    /// annonces, au-delà `attente_pleine`) et rend `Ignore`, sauf les KeyPackages, lus aussitôt
    /// (retenus) et gardés aussi. Le Welcome fait pour notre KeyPackage nous fait entrer ; la file
    /// est alors rejouée dans l'ordre (annonces comprises) et `Entree { rejoues }` rend ce que
    /// chaque trame aurait rendu, avec son rang. Un Welcome pour un autre est ignoré.
    pub fn recevoir_trame(
        &mut self,
        cles: &ClesSalon,
        trame: &[u8],
        seq: u64,
        siege_emetteur: u8,
    ) -> Result<Evenement> {
        let en_attente = match self.groupe.as_ref() {
            Some(g) if g.is_active() => false,
            Some(_) => return Err(Error::NonMembre),
            None => true,
        };
        if self.dernier_seq.is_some_and(|d| seq <= d) {
            return Ok(Evenement::Ignore);
        }
        self.dernier_seq = Some(seq);
        let (en_tete, mls) = ouvrir(cles, trame)?;
        if !en_attente {
            return self.traiter(en_tete, &mls, siege_emetteur);
        }
        match lire_mls(&mls)? {
            MlsMessageBodyIn::Welcome(w) => {
                if !self.welcome_pour_nous(&w) {
                    return Ok(Evenement::Ignore);
                }
                en_tete_coherent(en_tete, None)?;
                let rejoues = self.entrer(w, siege_emetteur)?;
                Ok(Evenement::Entree { rejoues })
            }
            corps => {
                if self.attente_pleine || self.attente.len() >= ATTENTE_MAX {
                    self.attente_pleine = true;
                    return Err(Error::AttentePleine);
                }
                self.attente.push(Attente::Trame {
                    seq,
                    siege: siege_emetteur,
                    en_tete,
                    mls: mls.to_vec(),
                });
                if let MlsMessageBodyIn::KeyPackage(kp) = corps {
                    en_tete_coherent(en_tete, None)?;
                    self.key_package_recu(kp, &mls, siege_emetteur)?;
                }
                Ok(Evenement::Ignore)
            }
        }
    }

    /// Message MLS d'une trame ouverte, membre du groupe (voir `recevoir_trame`).
    fn traiter(&mut self, en_tete: EnTete, mls: &[u8], siege_emetteur: u8) -> Result<Evenement> {
        if mls.len() > MAX_CHARGE {
            return Err(Error::TropGrand);
        }
        if self.commit_en_attente.as_ref().is_some_and(|c| c.0 == mls) {
            en_tete_coherent(en_tete, None)?;
            if siege_emetteur != self.identite.siege {
                return Err(Error::MessageInvalide);
            }
            return self.confirmer_commit();
        }
        if let Some((empreinte, n)) = self.rotation_en_vol
            && sha256(mls) == empreinte
        {
            return self.echo_rotation(en_tete, mls, siege_emetteur, n);
        }
        let protocole = match lire_mls(mls)? {
            MlsMessageBodyIn::PrivateMessage(p) => {
                if p.aad() != [en_tete.drapeaux()] {
                    return Err(Error::MessageInvalide);
                }
                ProtocolMessage::from(p)
            }
            MlsMessageBodyIn::Welcome(_) => {
                en_tete_coherent(en_tete, None)?;
                return Ok(Evenement::Ignore);
            }
            MlsMessageBodyIn::KeyPackage(kp) => {
                en_tete_coherent(en_tete, None)?;
                return self.key_package_recu(kp, mls, siege_emetteur);
            }
            // Message en clair (dont external commit et proposition externe) et GroupInfo :
            // jamais acceptés.
            _ => return Err(Error::MlsInvalide),
        };
        let role = self.createur();
        let (createur_siege, createur_cle) = role;
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
                en_tete_coherent(en_tete, None)?;
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
        let credential = lire_credential(traite.credential())?;
        let de_siege = credential.0;
        let auteur_createur = de_siege == createur_siege
            && groupe
                .member_at(auteur)
                .is_some_and(|m| createur_cle.is_some_and(|c| c[..] == m.signature_key[..]));
        // Le siège signé dans MLS est celui que le serveur atteste pour la trame.
        if de_siege != siege_emetteur {
            return Err(Error::MessageInvalide);
        }
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
                // Auteur dont le serveur a dit l'arrivée partie ou exclue (feuille pas encore
                // retirée) : il n'écrit plus dans le salon (F2).
                if !self.registre.admise(&credential) {
                    return Err(Error::NonMembre);
                }
                let octets = Zeroizing::new(a.into_bytes());
                let enveloppe = decoder(&octets)?;
                en_tete_coherent(en_tete, Some(&enveloppe))?;
                // Rotation de l'invitation (F1) : du créateur seulement (siège et clé
                // d'identité), chiffrée à l'époque courante (à la précédente, un membre retiré
                // depuis l'aurait lue), chaque feuille de l'arbre admise, `n` de l'exclusion.
                if let Message::Rotation { n, .. } = enveloppe.message {
                    if !auteur_createur
                        || epoque != courante
                        || !self.registre.rotation_recevable(groupe, n)
                    {
                        return Err(Error::RotationRefusee);
                    }
                    self.registre.rotation_vue = Some(n);
                }
                Ok(Evenement::Message {
                    de_siege,
                    epoque,
                    enveloppe,
                })
            }
            ProcessedMessageContent::StagedCommitMessage(sc) => {
                let ch = changements(groupe, &sc, auteur);
                if ajout_de_role_hors_siege(&ch, role) {
                    return Err(Error::CommitRefuse);
                }
                self.registre
                    .verifier(groupe, &ch, auteur_createur, credential)?;
                let perdu = self.commit_en_attente.take().is_some();
                if perdu {
                    groupe
                        .clear_pending_commit(self.fournisseur.storage())
                        .map_err(|_| Error::MlsInterne)?;
                }
                groupe
                    .merge_staged_commit(&self.fournisseur, *sc)
                    .map_err(|_| Error::MlsInterne)?;
                Ok(match (perdu, membres_de(&ch, role)) {
                    (
                        true,
                        Evenement::Membres {
                            ajoutes,
                            retires,
                            createur_revenu,
                        },
                    ) => Evenement::CommitPerdu {
                        ajoutes,
                        retires,
                        createur_revenu,
                    },
                    (_, membres) => membres,
                })
            }
            _ => Ok(Evenement::Ignore),
        }
    }

    /// Écho de notre Commit : la politique est revérifiée (annonces reçues entre-temps), puis
    /// fusion ; sinon il est abandonné comme un Commit perdu.
    fn confirmer_commit(&mut self) -> Result<Evenement> {
        let welcome = self.commit_en_attente.take().and_then(|c| c.1);
        let (createur, moi, role) = (self.suis_createur(), self.moi(), self.createur());
        let groupe = self.groupe.as_mut().ok_or(Error::NonMembre)?;
        let Some(sc) = groupe.pending_commit() else {
            return Err(Error::MlsInterne);
        };
        let ch = changements(groupe, sc, groupe.own_leaf_index());
        if ajout_de_role_hors_siege(&ch, role)
            || self.registre.verifier(groupe, &ch, createur, moi).is_err()
        {
            groupe
                .clear_pending_commit(self.fournisseur.storage())
                .map_err(|_| Error::MlsInterne)?;
            return Ok(Evenement::CommitPerdu {
                ajoutes: vec![],
                retires: vec![],
                createur_revenu: false,
            });
        }
        let createur_revenu = createur_ajoute(&ch, role);
        groupe
            .merge_pending_commit(&self.fournisseur)
            .map_err(|_| Error::MlsInterne)?;
        Ok(Evenement::CommitAccepte {
            welcome,
            createur_revenu,
        })
    }

    /// Écho de notre message `rotation` (octets reconnus par leur empreinte) : mêmes conditions
    /// que chez les destinataires, évaluées au même rang (mêmes annonces, même époque). Le
    /// créateur sait ainsi si les membres l'ont acceptée, même quand son époque n'a pas changé
    /// (départ annoncé entre l'envoi et l'écho).
    fn echo_rotation(
        &mut self,
        en_tete: EnTete,
        mls: &[u8],
        siege_emetteur: u8,
        n: u32,
    ) -> Result<Evenement> {
        let MlsMessageBodyIn::PrivateMessage(p) = lire_mls(mls)? else {
            return Err(Error::MlsInvalide);
        };
        // Comme chez les destinataires : rescellée sous un autre en-tête ou attribuée à un autre
        // siège, elle y est refusée ; ce n'est pas notre écho, il reste attendu.
        if p.aad() != [en_tete.drapeaux()] || siege_emetteur != self.identite.siege {
            return Err(Error::MessageInvalide);
        }
        self.rotation_en_vol = None;
        let epoque = ProtocolMessage::from(p).epoch().as_u64();
        let createur = self.suis_createur();
        let groupe = self.groupe_actif()?;
        if createur
            && epoque == groupe.epoch().as_u64()
            && self.registre.rotation_recevable(groupe, n)
        {
            self.registre.rotation_vue = Some(n);
            Ok(Evenement::RotationAcceptee { n })
        } else {
            Ok(Evenement::RotationARenvoyer { n })
        }
    }

    fn groupe_actif(&self) -> Result<&MlsGroup> {
        match self.groupe.as_ref() {
            Some(g) if g.is_active() => Ok(g),
            _ => Err(Error::NonMembre),
        }
    }

    /// Clé SFrame de l'époque (exporteur MLS, 32 octets) : la même chez tous les membres. Elle
    /// chiffrera les appels (non codés) pour tous les membres de l'arbre : mêmes refus que
    /// `envoyer` (`commit_en_cours`, `retrait_en_attente`, `non_membre`), sinon la clé rendue
    /// serait celle d'une époque qu'un membre parti ou exclu connaît encore. À redemander à
    /// chaque changement d'époque ; la clé d'une époque passée ne doit plus chiffrer.
    pub fn exporter_sframe(&self) -> Result<Zeroizing<[u8; 32]>> {
        let groupe = self.pret_a_chiffrer()?;
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

    /// Code de vérification du siège (spec v3 §9, point 4) : 25 chiffres en 5 groupes de 5,
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

    /// Sièges des feuilles à retirer, en ordre croissant (vide hors du groupe) : feuilles dont
    /// le serveur a dit l'arrivée `(siège, nonce_arrivee)` partie (0x03) ou exclue (0x09), ou
    /// qu'il n'annonce pas (après une liste complète). Tant qu'il en reste, `envoyer` et
    /// `exporter_sframe` sont refusés (`retrait_en_attente`) et tout Commit doit les retirer :
    /// `retirer` de l'un d'eux (ou `ajouter`, `renouveler`) les retire tous. Si notre propre
    /// siège y figure, le serveur nous dit partis : `envoyer` rend `non_membre`.
    pub fn a_retirer(&self) -> Vec<u8> {
        match self.groupe_actif() {
            Ok(g) => self.registre.a_retirer(g),
            Err(_) => Vec::new(),
        }
    }

    /// Refonde le salon sous d'autres clés : jette tout l'état MLS (stockage effacé) et rend un
    /// `Salon` neuf sous `cles`, avec **la même identité** (même siège, même `nonce_arrivee`,
    /// même clé Ed25519, donc même code de vérification), les annonces du serveur déjà reçues
    /// et le dernier rang vu (les rangs passés restent ignorés). Qui était le créateur du groupe
    /// crée le nouveau ; les autres publient un nouveau `key_package` et attendent leur Welcome,
    /// comme à l'arrivée.
    ///
    /// **Identités gardées** (13 novembre) : le nouveau salon retient la clé d'identité de
    /// chaque membre admis de l'ancien groupe. Tant que l'arrivée `(siège, nonce_arrivee)` est
    /// la même, ce siège ne revient qu'avec cette clé : un KeyPackage d'une autre clé est
    /// ignoré, son ajout refusé (`commit_refuse`), un Welcome où il figure refusé. Un membre
    /// qui attend son Welcome n'entre que dans un groupe créé par la clé du créateur de l'ancien
    /// groupe, dont la feuille est dans l'arbre. Une reprise (0x0A, nouveau `nonce_arrivee`)
    /// arrive avec une nouvelle clé, comme hors refondation : l'appelant compare `empreinte`.
    /// Les arrivées parties et les numéros d'exclusion et de rotation sont gardés aussi.
    ///
    /// À appeler à la réception du message `rotation` (avec `cles_depuis_maitre` de la clé
    /// reçue), ou chez le créateur à `RotationAcceptee` : l'identifiant du groupe MLS porte
    /// l'étiquette de l'invitation, une arrivante munie de la nouvelle invitation n'entre que
    /// dans un groupe créé sous elle ; un exclu n'a aucune feuille ni aucun secret du nouveau
    /// groupe (audit du 13 novembre, F3).
    /// En cas d'erreur (`mls_interne`), l'ancien état est perdu : repartir d'un `Salon` neuf.
    pub fn refonder(self, cles: &ClesSalon) -> Result<Salon> {
        let createur = self.groupe.is_some() && self.suis_createur();
        let identites: Vec<politique::Arrivee> = match self.groupe.as_ref() {
            Some(g) => g
                .members()
                .filter_map(|m| {
                    let c = lire_credential(&m.credential).ok()?;
                    (self.registre.admise(&c) && self.registre.annonces.contains(&c))
                        .then(|| (c.0, c.1, sha256(&m.signature_key)))
                })
                .collect(),
            None => self.depart.key_packages.clone(),
        };
        let createur_attendu = match self.groupe {
            Some(_) => self.createur_cle,
            None => self.createur_attendu,
        };
        let Salon {
            identite,
            registre,
            dernier_seq,
            ..
        } = self;
        let mut neuf = Salon::creer(identite, cles, createur)?;
        neuf.dernier_seq = dernier_seq;
        if !createur {
            neuf.createur_attendu = createur_attendu;
        }
        neuf.depart = Registre {
            parties: registre.parties.clone(),
            key_packages: identites,
            exclusion: registre.exclusion,
            rotation_vue: registre.rotation_vue,
            ..Registre::default()
        };
        neuf.registre = neuf.depart.clone();
        // Par les mêmes portes que l'appelant : pour qui attend son Welcome, les annonces
        // entrent aussi dans la file rejouée à l'entrée.
        match registre.createur_annonce {
            Some(c) if registre.liste_complete => neuf.remplacer_annonces(c, &registre.annonces),
            _ => {
                for &(s, n) in &registre.annonces {
                    neuf.annoncer(s, n);
                }
            }
        }
        Ok(neuf)
    }
}

#[cfg(test)]
mod tests {
    //! Commits et messages hostiles fabriqués avec OpenMLS par un membre (contournant `Salon`) :
    //! refusés avant fusion chez les autres, l'état ne change pas (Review Focus 4).
    use super::*;
    use crate::cles::cles_salon;
    use crate::message::Message;
    use crate::trame::{Regle, sceller_avec_nonce};
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

    /// Le serveur range la trame au rang suivant et la remet à tous.
    fn diffuser(m: &mut [Salon], seq: &mut u64, trame: &[u8], de: u8) -> Vec<Result<Evenement>> {
        *seq += 1;
        let s = *seq;
        m.iter_mut()
            .map(|x| x.recevoir_trame(&cles(), trame, s, de))
            .collect()
    }

    /// Sièges 0 (créateur), 1 et 2.
    fn trois() -> (Vec<Salon>, u64) {
        let mut m = vec![
            Salon::creer(
                identite_createur(0, [0; 16], &[0x5A; 32]).unwrap(),
                &cles(),
                true,
            )
            .unwrap(),
        ];
        m[0].remplacer_annonces(0, &[(0, [0; 16])]);
        let mut seq = 0;
        for s in 1..3u8 {
            let mut n =
                Salon::creer(nouvelle_identite(s, [s; 16]).unwrap(), &cles(), false).unwrap();
            let liste: Vec<(u8, [u8; 16])> = (0..=s).map(|i| (i, [i; 16])).collect();
            n.remplacer_annonces(0, &liste);
            for x in m.iter_mut() {
                x.annoncer(s, [s; 16]);
            }
            let kp = n.key_package(&cles()).unwrap();
            m.push(n);
            let ev = diffuser(&mut m, &mut seq, &kp, s);
            let Ok(Evenement::KeyPackage { octets }) = &ev[0] else {
                panic!("{ev:?}")
            };
            let c = m[0].ajouter(&cles(), octets).unwrap();
            let mut welcome = None;
            for (i, ev) in diffuser(&mut m, &mut seq, &c, 0).into_iter().enumerate() {
                match ev {
                    Ok(Evenement::CommitAccepte { welcome: w, .. }) => welcome = w,
                    Ok(Evenement::Membres { .. }) => {}
                    Ok(Evenement::Ignore) if i == s as usize => {}
                    ev => panic!("{ev:?}"),
                }
            }
            let ev = diffuser(&mut m, &mut seq, &welcome.unwrap(), 0);
            assert!(
                matches!(ev[s as usize], Ok(Evenement::Entree { .. })),
                "{ev:?}"
            );
        }
        (m, seq)
    }

    /// Commit brut du membre (OpenMLS directement), en trame, puis abandon chez lui.
    fn commit_brut(
        salon: &mut Salon,
        f: impl FnOnce(
            CommitBuilder<'_, openmls::group::Initial>,
        ) -> CommitBuilder<'_, openmls::group::Initial>,
    ) -> [u8; TAILLE_TRAME] {
        commit_brut_aad(salon, vec![0], f)
    }

    /// Même chose, avec ces données authentifiées MLS.
    fn commit_brut_aad(
        salon: &mut Salon,
        aad: Vec<u8>,
        f: impl FnOnce(
            CommitBuilder<'_, openmls::group::Initial>,
        ) -> CommitBuilder<'_, openmls::group::Initial>,
    ) -> [u8; TAILLE_TRAME] {
        let g = salon.groupe.as_mut().unwrap();
        g.set_aad(aad);
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
        sceller(&cles(), EN_TETE_CONTROLE, &octets).unwrap()
    }

    fn refuse_partout(m: &mut [Salon], seq: &mut u64, commit: &[u8], de: u8, attendu: Error) {
        let e0 = m[0].epoque();
        *seq += 1;
        for (i, x) in m.iter_mut().enumerate() {
            if i != de as usize {
                assert_eq!(
                    x.recevoir_trame(&cles(), commit, *seq, de),
                    Err(attendu),
                    "membre {i}"
                );
                assert_eq!(x.epoque(), e0);
                assert_eq!(x.membres(), vec![0, 1, 2]);
            }
        }
        // Le groupe fonctionne toujours.
        let t = m[2].envoyer(&cles(), &env()).unwrap();
        let ev = diffuser(m, seq, &t, 2);
        for i in [0, 1] {
            assert!(
                matches!(ev[i], Ok(Evenement::Message { de_siege: 2, .. })),
                "{ev:?}"
            );
        }
    }

    /// Message brut du membre (OpenMLS directement, sans les refus de `Salon::envoyer`) : ce
    /// qu'un client modifié peut produire.
    fn message_brut(salon: &mut Salon, e: &Enveloppe) -> [u8; TAILLE_TRAME] {
        let et = en_tete_de(e);
        let g = salon.groupe.as_mut().unwrap();
        g.set_aad(vec![et.drapeaux()]);
        let json = encoder(e).unwrap();
        let msg = g
            .create_message(&salon.fournisseur, &salon.identite.signataire, &json)
            .unwrap();
        sceller(&cles(), et, &serialiser(&msg).unwrap()).unwrap()
    }

    fn rotation() -> Enveloppe {
        Enveloppe {
            message: Message::Rotation {
                n: 1,
                cle: crate::message::Graine::new([9; 32]),
            },
            ..env()
        }
    }

    /// F1 (audit du 13 novembre) : une rotation fabriquée par un membre qui n'est pas le créateur
    /// (client modifié) est refusée par tous ; celle du créateur passe.
    #[test]
    fn rotation_d_un_non_createur_refusee() {
        let (mut m, mut seq) = trois();
        for x in m.iter_mut() {
            x.marquer_exclu(None, 1); // 0x09 sans exclu : nouveau lien, rotation numéro 1
        }
        let t = message_brut(&mut m[1], &rotation());
        seq += 1;
        for i in [0, 2] {
            assert_eq!(
                m[i].recevoir_trame(&cles(), &t, seq, 1),
                Err(Error::RotationRefusee),
                "membre {i}"
            );
        }
        let t = m[0].envoyer(&cles(), &rotation()).unwrap();
        let e0 = m[0].epoque().unwrap();
        let ev = diffuser(&mut m, &mut seq, &t, 0);
        for i in [1, 2] {
            assert_eq!(
                ev[i],
                Ok(Evenement::Message {
                    de_siege: 0,
                    epoque: e0,
                    enveloppe: rotation()
                })
            );
        }
    }

    /// F1 et F2 : une rotation du créateur envoyée alors qu'un siège exclu (0x09) est encore
    /// dans l'arbre (créateur au client modifié, ou qui n'a pas reçu le 0x09) est refusée par
    /// les membres : l'exclu l'aurait lue. Un message ordinaire du créateur reste lu.
    #[test]
    fn rotation_avec_un_exclu_dans_l_arbre_refusee() {
        let (mut m, mut seq) = trois();
        m[1].marquer_exclu(Some(2), 1);
        let t = message_brut(&mut m[0], &rotation());
        seq += 1;
        assert_eq!(
            m[1].recevoir_trame(&cles(), &t, seq, 0),
            Err(Error::RotationRefusee)
        );
        let t = message_brut(&mut m[0], &env());
        seq += 1;
        assert!(matches!(
            m[1].recevoir_trame(&cles(), &t, seq, 0),
            Ok(Evenement::Message { de_siege: 0, .. })
        ));
        // Le siège exclu retiré, la rotation (renvoyée à la nouvelle époque) passe.
        m[0].marquer_exclu(Some(2), 1);
        let c = m[1].retirer(&cles(), 2).unwrap();
        seq += 1;
        assert!(matches!(
            m[0].recevoir_trame(&cles(), &c, seq, 1),
            Ok(Evenement::Membres { .. })
        ));
        assert!(matches!(
            m[1].recevoir_trame(&cles(), &c, seq, 1),
            Ok(Evenement::CommitAccepte { .. })
        ));
        let t = m[0].envoyer(&cles(), &rotation()).unwrap();
        seq += 1;
        assert!(matches!(
            m[1].recevoir_trame(&cles(), &t, seq, 0),
            Ok(Evenement::Message { de_siege: 0, .. })
        ));
    }

    /// F2 : si le serveur dit notre propre siège parti ou exclu, nous n'écrivons plus
    /// (`non_membre`), et nous ne pouvons pas nous retirer nous-mêmes.
    #[test]
    fn notre_siege_dit_parti_n_ecrit_plus() {
        let (mut m, _) = trois();
        m[1].marquer_parti(1);
        assert_eq!(m[1].a_retirer(), vec![1]);
        assert_eq!(m[1].envoyer(&cles(), &env()), Err(Error::NonMembre));
        assert_eq!(m[1].retirer(&cles(), 1), Err(Error::CommitRefuse));
        // Les autres, eux, attendent son retrait.
        m[0].marquer_parti(1);
        assert_eq!(m[0].envoyer(&cles(), &env()), Err(Error::RetraitEnAttente));
    }

    /// F3 : `refonder` garde l'identité, les annonces et le dernier rang ; il jette le groupe,
    /// les KeyPackages retenus et le Commit en attente. Le créateur recrée le groupe (seul),
    /// les autres attendent leur Welcome.
    #[test]
    fn refonder_garde_identite_annonces_et_rang() {
        let (mut m, seq) = trois();
        let autres = cles_salon(&KLien::from_bytes([7; 32]), &KMdp::from_bytes([2; 32]));
        let cle: Vec<Vec<u8>> = m
            .iter()
            .map(|x| x.identite.cle_publique().to_vec())
            .collect();
        m[0].marquer_parti(2);
        let _ = m[0].retirer(&cles(), 2).unwrap(); // Commit en attente : jeté avec le groupe
        let m: Vec<Salon> = m
            .into_iter()
            .map(|x| x.refonder(&autres).unwrap())
            .collect();
        for (i, x) in m.iter().enumerate() {
            assert_eq!(x.identite.cle_publique(), cle[i]);
            assert_eq!(x.identite.siege, i as u8);
            assert_eq!(x.tag, *autres.tag());
            assert_eq!(x.dernier_seq, Some(seq));
            assert!(x.commit_en_attente.is_none());
            // Identités de l'ancien groupe gardées (sièges 0 et 1 ; le siège 2 est parti).
            // (Seul le siège 0 a reçu le départ du siège 2 dans ce test.)
            assert_eq!(x.registre.key_packages.len(), if i == 0 { 2 } else { 3 });
            assert!(
                x.registre
                    .key_packages
                    .iter()
                    .all(|k| k.2 == sha256(&cle[k.0 as usize]))
            );
            assert!(x.rotation_en_vol.is_none());
            assert!(x.nos_key_packages.is_empty());
            assert_eq!(x.registre.createur_annonce, Some(0));
        }
        assert_eq!(m[0].membres(), vec![0]);
        assert_eq!(m[0].registre.parties, vec![(2, [2; 16])]);
        assert_eq!(m[0].registre.annonces, vec![(0, [0; 16]), (1, [1; 16])]);
        assert_eq!(
            m[0].groupe.as_ref().unwrap().group_id().as_slice()[..16],
            *autres.tag()
        );
        for x in &m[1..] {
            assert!(x.groupe.is_none());
            // La liste est aussi dans la file rejouée à l'entrée.
            assert!(matches!(x.attente.first(), Some(Attente::Liste(0, _))));
        }
    }

    /// Relecture du 13 novembre, point 1 : chez le destinataire aussi, la marque suit l'arrivée
    /// (siège, nonce) de la feuille. Après le 0x09 du siège 2 puis une nouvelle annonce sur ce
    /// siège, une rotation fabriquée par le créateur (client modifié) reste refusée, un message
    /// de l'exclu aussi. Pendant une simple reprise (0x0A), l'ancienne feuille est à retirer
    /// (14 novembre : comme pour qui ne reçoit que la liste complète) : rotation et message de
    /// cette feuille refusés.
    #[test]
    fn nouvelle_annonce_ne_leve_rien_chez_le_destinataire() {
        let (mut m, mut seq) = trois();
        m[1].marquer_exclu(Some(2), 1);
        m[1].annoncer(2, [9; 16]);
        assert_eq!(m[1].a_retirer(), vec![2]);
        let t = message_brut(&mut m[0], &rotation());
        seq += 1;
        assert_eq!(
            m[1].recevoir_trame(&cles(), &t, seq, 0),
            Err(Error::RotationRefusee)
        );
        let t = message_brut(&mut m[2], &env());
        seq += 1;
        assert_eq!(
            m[1].recevoir_trame(&cles(), &t, seq, 2),
            Err(Error::NonMembre)
        );
        // Reprise sans départ.
        let (mut m, mut seq) = trois();
        m[1].marquer_exclu(None, 1);
        m[1].annoncer(2, [9; 16]);
        assert_eq!(m[1].a_retirer(), vec![2]);
        let t = message_brut(&mut m[0], &rotation());
        seq += 1;
        assert_eq!(
            m[1].recevoir_trame(&cles(), &t, seq, 0),
            Err(Error::RotationRefusee)
        );
        let t = message_brut(&mut m[2], &env());
        seq += 1;
        assert_eq!(
            m[1].recevoir_trame(&cles(), &t, seq, 2),
            Err(Error::NonMembre)
        );
    }

    /// 14 novembre : le flux (0x0A reçu en direct) et la liste complète (0x0D à la reconnexion,
    /// qui ne porte que l'annonce courante du siège) jugent l'ancienne feuille d'une reprise de
    /// la même façon ; sinon un renouvellement qui ne la retire pas serait fusionné par l'un et
    /// refusé par l'autre (groupe scindé). Défaut du registre « arrivées remplacées » (travail du
    /// 13 novembre, non commité) : son propre test donnait `a_retirer` = `[]` en direct ; après la
    /// liste, l'ancienne feuille n'était pas une arrivée remplacée, donc `[2]`.
    #[test]
    fn reprise_meme_jugement_par_le_flux_et_par_la_liste() {
        let (mut m, mut seq) = trois();
        m[0].annoncer(2, [9; 16]); // en direct
        m[1].remplacer_annonces(0, &[(0, [0; 16]), (1, [1; 16]), (2, [9; 16])]); // reconnexion
        assert_eq!(m[0].a_retirer(), m[1].a_retirer());
        assert_eq!(m[0].a_retirer(), vec![2]);
        // Un renouvellement brut (client modifié) qui garde l'ancienne feuille : refusé des deux.
        let c = commit_brut(&mut m[1], |b| b.force_self_update(true));
        seq += 1;
        let e = m[0].epoque();
        assert_eq!(
            m[0].recevoir_trame(&cles(), &c, seq, 1),
            Err(Error::CommitRefuse)
        );
        assert_eq!(m[0].epoque(), e);
        // Celui du moteur retire l'ancienne feuille : accepté des deux.
        let c = m[1].renouveler(&cles()).unwrap();
        let ev = diffuser(&mut m[..2], &mut seq, &c, 1);
        assert_eq!(
            ev[0],
            Ok(Evenement::Membres {
                ajoutes: vec![],
                retires: vec![2],
                createur_revenu: false,
            })
        );
        assert!(matches!(ev[1], Ok(Evenement::CommitAccepte { .. })));
    }

    /// 14 novembre (point 2) : une seule rotation en vol. Une seconde, envoyée avant l'écho de la
    /// première, est refusée : les membres liraient la première et refuseraient la seconde (même
    /// `n`), alors que le créateur, l'écho de la première n'étant plus reconnu, refonderait sous
    /// la seconde clé. Après l'écho, le créateur sait ce qui a été accepté.
    #[test]
    fn une_seule_rotation_en_vol() {
        let (mut m, mut seq) = trois();
        for x in m.iter_mut() {
            x.marquer_exclu(None, 1);
        }
        let t = m[0].envoyer(&cles(), &rotation()).unwrap();
        let autre = Enveloppe {
            message: Message::Rotation {
                n: 1,
                cle: crate::message::Graine::new([8; 32]),
            },
            ..env()
        };
        assert_eq!(m[0].envoyer(&cles(), &autre), Err(Error::RotationRefusee));
        let ev = diffuser(&mut m, &mut seq, &t, 0);
        assert_eq!(ev[0], Ok(Evenement::RotationAcceptee { n: 1 }));
        assert!(matches!(ev[1], Ok(Evenement::Message { .. })));
    }

    /// Relecture du 13 novembre, point 4 : une reprise annoncée du siège du créateur (autre clé
    /// d'identité) entre dans le groupe ; un Commit qui retire un membre présent et une rotation
    /// fabriqués avec cette feuille (client modifié) sont refusés par tous.
    #[test]
    fn createur_reconnu_par_sa_cle_pas_par_son_siege() {
        let (mut m, mut seq) = trois();
        for x in m.iter_mut() {
            x.marquer_exclu(None, 1);
            x.annoncer(0, [9; 16]);
        }
        let mut f = Salon::creer(nouvelle_identite(0, [9; 16]).unwrap(), &cles(), false).unwrap();
        f.remplacer_annonces(0, &[(0, [9; 16]), (1, [1; 16]), (2, [2; 16])]);
        f.marquer_exclu(None, 1);
        let kp = f.key_package(&cles()).unwrap();
        m.remove(0); // m[0] : siège 1, m[1] : siège 2
        let ev = diffuser(&mut m, &mut seq, &kp, 0);
        let Ok(Evenement::KeyPackage { octets }) = &ev[0] else {
            panic!("{ev:?}")
        };
        let c = m[0].ajouter(&cles(), octets).unwrap();
        f.recevoir_trame(&cles(), &c, seq + 1, 1).unwrap();
        let ev = diffuser(&mut m, &mut seq, &c, 1);
        let Ok(Evenement::CommitAccepte {
            welcome: Some(w), ..
        }) = &ev[0]
        else {
            panic!("{ev:?}")
        };
        seq += 1;
        assert!(matches!(
            f.recevoir_trame(&cles(), w, seq, 1),
            Ok(Evenement::Entree { .. })
        ));
        assert_eq!(f.createur_siege, 0);
        assert!(!f.suis_createur());
        let cible = f
            .groupe
            .as_ref()
            .unwrap()
            .members()
            .find(|x| lire_credential(&x.credential).unwrap().0 == 2)
            .unwrap()
            .index;
        let c = commit_brut(&mut f, |b| b.propose_removals([cible]));
        let e = m[0].epoque();
        seq += 1;
        for x in m.iter_mut() {
            assert_eq!(
                x.recevoir_trame(&cles(), &c, seq, 0),
                Err(Error::CommitRefuse)
            );
            assert_eq!(x.epoque(), e);
        }
        let t = message_brut(&mut f, &rotation());
        seq += 1;
        for x in m.iter_mut() {
            assert_eq!(
                x.recevoir_trame(&cles(), &t, seq, 0),
                Err(Error::RotationRefusee)
            );
        }
        // Un message ordinaire de cette feuille passe : elle est un membre comme un autre.
        let t = message_brut(&mut f, &env());
        seq += 1;
        assert!(matches!(
            m[0].recevoir_trame(&cles(), &t, seq, 0),
            Ok(Evenement::Message { de_siege: 0, .. })
        ));
    }

    /// Relecture du 13 novembre, point 3 : après une refondation, un Welcome dont le groupe
    /// porte bien la clé du créateur attendu mais dont l'arbre n'a pas sa feuille (groupe
    /// fabriqué par un autre membre de l'ancien groupe) est refusé.
    #[test]
    fn refonder_welcome_sans_la_feuille_du_createur_refuse() {
        let (m, seq) = trois();
        let autres = cles_salon(&KLien::from_bytes([7; 32]), &KMdp::from_bytes([2; 32]));
        let mut m: Vec<Salon> = m
            .into_iter()
            .map(|x| x.refonder(&autres).unwrap())
            .collect();
        let cle_createur = m[0].createur_cle.unwrap();
        assert_eq!(m[1].createur_attendu, Some(cle_createur));
        assert_eq!(m[0].createur_attendu, None);
        // Le siège 2 fabrique un groupe au nom du créateur (identifiant copié), sans lui.
        let mut id = autres.tag().to_vec();
        id.push(0);
        id.extend_from_slice(&cle_createur);
        let x = &mut m[2];
        x.groupe = Some(
            MlsGroup::new_with_group_id(
                &x.fournisseur,
                &x.identite.signataire,
                &config_creation(),
                GroupId::from_slice(&id),
                x.identite.credential(),
            )
            .unwrap(),
        );
        x.createur_siege = 0;
        x.createur_cle = Some(cle_createur);
        let kp = m[1].key_package(&autres).unwrap();
        let Ok(Evenement::KeyPackage { octets }) = m[2].recevoir_trame(&autres, &kp, seq + 1, 1)
        else {
            panic!("KeyPackage attendu")
        };
        let c = m[2].ajouter(&autres, &octets).unwrap();
        let Ok(Evenement::CommitAccepte {
            welcome: Some(w), ..
        }) = m[2].recevoir_trame(&autres, &c, seq + 2, 2)
        else {
            panic!("Welcome attendu")
        };
        m[1].recevoir_trame(&autres, &kp, seq + 1, 1).unwrap();
        m[1].recevoir_trame(&autres, &c, seq + 2, 2).unwrap();
        assert_eq!(
            m[1].recevoir_trame(&autres, &w, seq + 3, 2),
            Err(Error::MlsInvalide)
        );
        assert!(m[1].groupe.is_none());
    }

    /// 14 novembre : un Commit fabriqué par un membre (client modifié, hors `Salon::ajouter`) qui
    /// ajoute la clé de rôle à une place d'invité (lien de gestion volé) est refusé par tous avant
    /// fusion ; un Welcome dont l'arbre la porte hors du siège du créateur aussi.
    #[test]
    fn cle_de_role_hors_siege_refusee_dans_un_commit_brut() {
        let (mut m, mut seq) = trois();
        let code = m[2].empreinte(0).unwrap();
        assert_eq!(code, code_verification(&cle_publique_role(&[0x5A; 32])));
        // Le créateur a quitté (0x03) et sa feuille est retirée : sinon MLS refuserait déjà la
        // même clé deux fois dans l'arbre (DuplicateSignatureKey).
        m.remove(0);
        for x in m.iter_mut() {
            x.marquer_parti(0);
        }
        let c = m[0].retirer(&cles(), 0).unwrap();
        let ev = diffuser(&mut m, &mut seq, &c, 1);
        assert!(matches!(ev[1], Ok(Evenement::Membres { .. })), "{ev:?}");
        for x in m.iter_mut() {
            x.annoncer(3, [3; 16]);
        }
        let mut v = Salon::creer(
            identite_createur(3, [3; 16], &[0x5A; 32]).unwrap(),
            &cles(),
            false,
        )
        .unwrap();
        let kp = v.key_package(&cles()).unwrap();
        let ev = diffuser(&mut m, &mut seq, &kp, 3);
        assert!(ev.iter().all(|e| *e == Ok(Evenement::Ignore)), "{ev:?}");
        let (_, octets) = ouvrir(&cles(), &kp).unwrap();
        let MlsMessageBodyIn::KeyPackage(kin) = lire_mls(&octets).unwrap() else {
            panic!()
        };
        let kp = lire_key_package(kin, &octets, m[0].fournisseur.crypto()).unwrap();
        let c = commit_brut(&mut m[0], |b| b.propose_adds([kp]));
        let e = m[1].epoque();
        seq += 1;
        assert_eq!(
            m[1].recevoir_trame(&cles(), &c, seq, 1),
            Err(Error::CommitRefuse)
        );
        assert_eq!((m[1].epoque(), m[1].membres()), (e, vec![1, 2]));
    }

    /// M4 : le siège de la credential (MLS) doit être celui que le serveur atteste pour la trame.
    #[test]
    fn siege_atteste_different_refuse() {
        let (mut m, mut seq) = trois();
        let t = m[2].envoyer(&cles(), &env()).unwrap();
        seq += 1;
        assert_eq!(
            m[0].recevoir_trame(&cles(), &t, seq, 1),
            Err(Error::MessageInvalide)
        );
        let c = m[1].renouveler(&cles()).unwrap();
        let e0 = m[0].epoque();
        seq += 1;
        assert_eq!(
            m[0].recevoir_trame(&cles(), &c, seq, 2),
            Err(Error::MessageInvalide)
        );
        assert_eq!(m[0].epoque(), e0);
        // Notre propre Commit renvoyé au nom d'un autre siège : refusé, il reste en attente.
        assert_eq!(
            m[1].recevoir_trame(&cles(), &c, seq + 1, 2),
            Err(Error::MessageInvalide)
        );
        assert!(matches!(
            m[1].recevoir_trame(&cles(), &c, seq + 2, 1),
            Ok(Evenement::CommitAccepte { welcome: None, .. })
        ));
    }

    /// I2 : un message MLS dont les données authentifiées (signées) ne sont pas l'octet des
    /// drapeaux de sa trame est refusé, même si l'enveloppe et l'en-tête concordent.
    #[test]
    fn donnees_authentifiees_mls_liees_a_l_en_tete() {
        let (mut m, mut seq) = trois();
        let e = Enveloppe {
            regle: Regle::CinqMinutes,
            ..env()
        };
        let et = en_tete_de(&e);
        for aad in [
            vec![],
            vec![0],
            vec![et.drapeaux(), 0],
            vec![et.drapeaux() ^ 1],
        ] {
            let s2 = &mut m[2];
            let g = s2.groupe.as_mut().unwrap();
            g.set_aad(aad.clone());
            let json = encoder(&e).unwrap();
            let msg = g
                .create_message(&s2.fournisseur, &s2.identite.signataire, &json)
                .unwrap();
            let t = sceller(&cles(), et, &serialiser(&msg).unwrap()).unwrap();
            seq += 1;
            assert_eq!(
                m[0].recevoir_trame(&cles(), &t, seq, 2),
                Err(Error::MessageInvalide),
                "{aad:?}"
            );
        }
        // Contrôle : avec l'octet des drapeaux, le même message passe.
        let t = m[2].envoyer(&cles(), &e).unwrap();
        seq += 1;
        assert!(matches!(
            m[0].recevoir_trame(&cles(), &t, seq, 2),
            Ok(Evenement::Message { .. })
        ));
        // Commit dont les données authentifiées ne sont pas 0 : refusé, état inchangé.
        let t = commit_brut_aad(&mut m[1], vec![1], |b| b.force_self_update(true));
        refuse_partout(&mut m, &mut seq, &t, 1, Error::MessageInvalide);
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
        refuse_partout(&mut m, &mut seq, &c, 1, Error::CommitRefuse);
    }

    #[test]
    fn extensions_de_contexte_refusees() {
        let (mut m, mut seq) = trois();
        let c = commit_brut(&mut m[1], |b| {
            b.propose_group_context_extensions(Extensions::empty())
                .unwrap()
        });
        refuse_partout(&mut m, &mut seq, &c, 1, Error::CommitRefuse);
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
        g.set_aad(vec![0]);
        let (prop, _) = g
            .propose_remove_member(&s1.fournisseur, &s1.identite.signataire, cible)
            .unwrap();
        let prop = sceller(&cles(), EN_TETE_CONTROLE, &serialiser(&prop).unwrap()).unwrap();
        seq += 1;
        assert_eq!(
            m[0].recevoir_trame(&cles(), &prop, seq, 1),
            Ok(Evenement::Ignore)
        );
        assert_eq!(
            m[2].recevoir_trame(&cles(), &prop, seq, 1),
            Ok(Evenement::Ignore)
        );
        // … donc le Commit qui la cite par référence ne peut pas passer.
        let c = commit_brut(&mut m[1], |b| b.consume_proposal_store(true));
        let e0 = m[0].epoque();
        seq += 1;
        for i in [0, 2] {
            assert!(
                m[i].recevoir_trame(&cles(), &c, seq, 1).is_err(),
                "membre {i}"
            );
            assert_eq!(m[i].epoque(), e0);
            assert_eq!(m[i].membres(), vec![0, 1, 2]);
        }
    }

    /// IMPORTANT 1 (relecture) : un serveur malveillant remplit la file de copies d'un vrai
    /// KeyPackage et du vrai Commit (siège attesté 0, époque E−1) rangées avant l'annonce qui
    /// rend le Welcome vérifiable : chaque copie du Commit est un candidat refusé. Le registre
    /// avance d'un seul passage : au plus une vérification par KeyPackage de la file (coût
    /// linéaire), et le dernier candidat fait entrer.
    #[test]
    fn candidats_cout_lineaire() {
        let (mut m, mut seq) = trois();
        // Reprise du siège 2 (nonce [9; 16]) ; l'ancienne instance quitte le réseau.
        m.pop();
        let mut x = Salon::creer(nouvelle_identite(2, [9; 16]).unwrap(), &cles(), false).unwrap();
        x.remplacer_annonces(0, &[(0, [0; 16]), (1, [1; 16]), (2, [2; 16])]);
        for s in m.iter_mut() {
            s.annoncer(2, [9; 16]);
        }
        let kp = x.key_package(&cles()).unwrap();
        let ev = diffuser(&mut m, &mut seq, &kp, 2);
        assert!(matches!(ev[1], Ok(Evenement::KeyPackage { .. })), "{ev:?}");
        let Ok(Evenement::KeyPackage { octets }) = &ev[0] else {
            panic!("{ev:?}")
        };
        let c = m[0].ajouter(&cles(), octets).unwrap();
        let ev = diffuser(&mut m, &mut seq, &c, 0);
        let Ok(Evenement::CommitAccepte {
            welcome: Some(w), ..
        }) = &ev[0]
        else {
            panic!("{ev:?}")
        };
        // La file de X : copies (KeyPackage, Commit) avant l'annonce de la reprise.
        const COPIES: usize = 40;
        for _ in 0..COPIES {
            seq += 1;
            assert_eq!(
                x.recevoir_trame(&cles(), &kp, seq, 2),
                Ok(Evenement::Ignore)
            );
            seq += 1;
            assert_eq!(x.recevoir_trame(&cles(), &c, seq, 0), Ok(Evenement::Ignore));
        }
        x.annoncer(2, [9; 16]);
        seq += 1;
        assert_eq!(
            x.recevoir_trame(&cles(), &kp, seq, 2),
            Ok(Evenement::Ignore)
        );
        seq += 1;
        assert_eq!(x.recevoir_trame(&cles(), &c, seq, 0), Ok(Evenement::Ignore));
        let avant = VALIDATIONS.with(|v| v.get());
        seq += 1;
        assert!(matches!(
            x.recevoir_trame(&cles(), w, seq, 0),
            Ok(Evenement::Entree { .. })
        ));
        let faites = VALIDATIONS.with(|v| v.get()) - avant;
        assert!(faites <= COPIES + 1, "{faites} vérifications de KeyPackage");
    }

    /// Clés restantes : l'arrivant a publié deux KeyPackages (republication) ; le Welcome vise
    /// le second. À l'entrée, les clés d'init des **deux** sont effacées du stockage.
    #[test]
    fn cles_init_toutes_effacees() {
        let mut c = Salon::creer(nouvelle_identite(0, [0; 16]).unwrap(), &cles(), true).unwrap();
        c.remplacer_annonces(0, &[(0, [0; 16])]);
        c.annoncer(1, [1; 16]);
        let mut n = Salon::creer(nouvelle_identite(1, [1; 16]).unwrap(), &cles(), false).unwrap();
        n.remplacer_annonces(0, &[(0, [0; 16]), (1, [1; 16])]);
        let _kp1 = n.key_package(&cles()).unwrap();
        let kp2 = n.key_package(&cles()).unwrap();
        let refs = n.nos_key_packages.clone();
        assert_eq!(refs.len(), 2);
        let stocke = |n: &Salon, r: &KeyPackageRef| {
            n.fournisseur
                .storage()
                .key_package::<KeyPackageRef, KeyPackageBundle>(r)
                .unwrap()
                .is_some()
        };
        assert!(refs.iter().all(|r| stocke(&n, r)));
        let Ok(Evenement::KeyPackage { octets }) = c.recevoir_trame(&cles(), &kp2, 1, 1) else {
            panic!("KeyPackage attendu")
        };
        let commit = c.ajouter(&cles(), &octets).unwrap();
        let Ok(Evenement::CommitAccepte {
            welcome: Some(w), ..
        }) = c.recevoir_trame(&cles(), &commit, 2, 0)
        else {
            panic!("Welcome attendu")
        };
        assert!(matches!(
            n.recevoir_trame(&cles(), &w, 3, 0),
            Ok(Evenement::Entree { .. })
        ));
        for r in &refs {
            assert!(
                matches!(
                    n.fournisseur
                        .storage()
                        .key_package::<KeyPackageRef, KeyPackageBundle>(r),
                    Ok(None)
                ),
                "{r:?}"
            );
        }
        assert!(n.nos_key_packages.is_empty());
    }

    /// M3 : un KeyPackage d'une autre suite est refusé avant toute vérification de signature.
    #[test]
    fn key_package_autre_suite_refuse_avant_signature() {
        let f = Fournisseur::default();
        let suite = Ciphersuite::MLS_128_DHKEMP256_AES128GCM_SHA256_P256;
        let sig = SignatureKeyPair::new(suite.signature_algorithm()).unwrap();
        let kp = KeyPackage::builder()
            .build(
                suite,
                &f,
                &sig,
                CredentialWithKey {
                    credential: BasicCredential::new(vec![1; 17]).into(),
                    signature_key: sig.public().into(),
                },
            )
            .unwrap();
        let octets = serialiser(&MlsMessageOut::from(kp.key_package().clone())).unwrap();
        let MlsMessageBodyIn::KeyPackage(kin) = lire_mls(&octets).unwrap() else {
            panic!()
        };
        assert_eq!(
            suite_annoncee(&octets),
            Some(u16::from(suite).to_be_bytes())
        );
        // Nos propres KeyPackages : la suite 0x0001 au même endroit.
        let mut n = Salon::creer(nouvelle_identite(1, [1; 16]).unwrap(), &cles(), false).unwrap();
        let (_, kp) = ouvrir(&cles(), &n.key_package(&cles()).unwrap()).unwrap();
        assert_eq!(suite_annoncee(&kp), Some([0, 1]));
        assert_eq!(
            lire_key_package(kin, &octets, f.crypto()).unwrap_err(),
            Error::MlsInvalide
        );
        let _ = sceller_avec_nonce;
    }
}
