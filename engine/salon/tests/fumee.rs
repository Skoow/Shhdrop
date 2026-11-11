//! Test de fumée : deux membres échangent un message par les API OpenMLS directes (suite 0x0001,
//! PURE_CIPHERTEXT, arbre dans le Welcome). Le stockage en mémoire d'OpenMLS est provisoire ; la
//! Task 2 le remplace par un stockage qui efface.
use openmls::prelude::tls_codec::{Deserialize as _, Serialize as _};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;

const SUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

struct Membre {
    fournisseur: OpenMlsRustCrypto,
    signataire: SignatureKeyPair,
    identifiants: CredentialWithKey,
}

fn membre(nom: &[u8]) -> Membre {
    let fournisseur = OpenMlsRustCrypto::default();
    let signataire = SignatureKeyPair::new(SUITE.signature_algorithm()).unwrap();
    signataire.store(fournisseur.storage()).unwrap();
    let identifiants = CredentialWithKey {
        credential: BasicCredential::new(nom.to_vec()).into(),
        signature_key: signataire.public().into(),
    };
    Membre {
        fournisseur,
        signataire,
        identifiants,
    }
}

#[test]
fn deux_membres_echangent() {
    let alice = membre(b"alice");
    let bob = membre(b"bob");

    // KeyPackage de Bob, transmis en octets.
    let kp = KeyPackage::builder()
        .build(
            SUITE,
            &bob.fournisseur,
            &bob.signataire,
            bob.identifiants.clone(),
        )
        .unwrap();
    let kp_octets = MlsMessageOut::from(kp.key_package().clone())
        .tls_serialize_detached()
        .unwrap();
    let kp_bob = match MlsMessageIn::tls_deserialize_exact(&kp_octets)
        .unwrap()
        .extract()
    {
        MlsMessageBodyIn::KeyPackage(k) => k
            .validate(alice.fournisseur.crypto(), ProtocolVersion::Mls10)
            .unwrap(),
        _ => panic!("KeyPackage attendu"),
    };

    // Alice crée le groupe et ajoute Bob.
    let config = MlsGroupCreateConfig::builder()
        .ciphersuite(SUITE)
        .use_ratchet_tree_extension(true)
        .wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
        .max_past_epochs(1)
        .build();
    let mut groupe_alice = MlsGroup::new(
        &alice.fournisseur,
        &alice.signataire,
        &config,
        alice.identifiants.clone(),
    )
    .unwrap();
    let (_commit, welcome, _info) = groupe_alice
        .add_members(&alice.fournisseur, &alice.signataire, &[kp_bob])
        .unwrap();
    groupe_alice
        .merge_pending_commit(&alice.fournisseur)
        .unwrap();

    // Bob rejoint par le Welcome.
    let welcome_octets = welcome.tls_serialize_detached().unwrap();
    let welcome = match MlsMessageIn::tls_deserialize_exact(&welcome_octets)
        .unwrap()
        .extract()
    {
        MlsMessageBodyIn::Welcome(w) => w,
        _ => panic!("Welcome attendu"),
    };
    let rejoindre = MlsGroupJoinConfig::builder()
        .use_ratchet_tree_extension(true)
        .wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
        .build();
    let mut groupe_bob =
        StagedWelcome::new_from_welcome(&bob.fournisseur, &rejoindre, welcome, None)
            .unwrap()
            .into_group(&bob.fournisseur)
            .unwrap();
    assert_eq!(groupe_bob.ciphersuite(), SUITE);

    // Alice chiffre, Bob déchiffre.
    let message = groupe_alice
        .create_message(&alice.fournisseur, &alice.signataire, b"bonjour")
        .unwrap();
    let octets = message.tls_serialize_detached().unwrap();
    let protocole = MlsMessageIn::tls_deserialize_exact(&octets)
        .unwrap()
        .try_into_protocol_message()
        .unwrap();
    let traite = groupe_bob
        .process_message(&bob.fournisseur, protocole)
        .unwrap();
    match traite.into_content() {
        ProcessedMessageContent::ApplicationMessage(a) => assert_eq!(a.into_bytes(), b"bonjour"),
        _ => panic!("message applicatif attendu"),
    }
}
