// Cas de web/src/crypto/envelope.test.ts, portés un par un, et contrat du fournisseur natif
// (lots, poignées, aléa qui échoue). Sans objet en Rust : clé « non extractible » (aucune
// fonction ne rend une clé AES), spy sur crypto.subtle.verify (comparaison par `subtle`, voir
// envelope.rs), mise à zéro de K_maître observée par un spy (types `Zeroizing`, voir
// envelope.rs) ; K_lien, K_mdp et R inchangés : passés par référence partagée.
mod support;

use shhdrop_core::envelope::{
    ENVELOPE_LEN, access_keys, content_keys, content_keys_checked, new_seed, open, seal, share_id,
};
use shhdrop_core::kdf::derive_access;
use shhdrop_core::platform::{KeyHandle, Platform};
use shhdrop_core::{Error, KLien, KMdp, Seed};
use support::{block_on, hex, no_random, platform, unhex};
use zeroize::Zeroizing;

// Vecteurs fixes calculés par un script Node indépendant (node:crypto), repris de
// envelope.test.ts : K_lien = 32 × 0x01, K_mdp = 32 × 0x02, R = 32 × 0x03, nonce de E = 12 × 0x09.
const V_ID: &str = "934a65e8f83c4367f2c9e06e57102838";
const V_K_ACCES: &str = "18554f2b3ad9a1d610c2a99ef25a76805db4e2d92893390db2b5ab3795d7af39";
const V_K_ENV: &str = "0f47dc9237440aa7751d694831720ad23e9919c93cf680a4dbecf3ce96788c5d";
const V_K_PREUVE: &str = "f992bca7aaa9f0b869d9f19b4d51b5b4f0e1f39a5271351cef97849131b51987";
const V_V_PREUVE: &str = "d337b5181afdd7df70e0e884a3658b3bb04422ff695fc154839daa502becef86";
const V_K_CONTENU: &str = "ef08e342beeeb7c47a5df739869634808022487f6ff30d240b54cb218d1e4bff";
const V_ENGAGEMENT: &str = "41c12c1f2f51bdaf632eb1d8d7d4aa0f78cdf11fa08fab30c4863f85afc57393";
const V_HEADER: &str = "5348483202000000000000000000000041c12c1f2f51bdaf632eb1d8d7d4aa0f78cdf11fa08fab30c4863f85afc57393";
const V_E: &str = "090909090909090909090909a82bff94be2636db6e821fb69e6fa475753c587dc8f0a75a579a9cf7a16099ffc45f3984685bb14eb29951549fbe56ec";
const ENV_AD: &[u8] = b"shhdrop/v2/enveloppe-ad";

fn k_lien() -> KLien {
    KLien::from_bytes([1; 32])
}
fn k_mdp() -> KMdp {
    KMdp::from_bytes([2; 32])
}
fn r() -> Seed {
    Seed::from_bytes([3; 32])
}
fn id() -> [u8; 16] {
    unhex(V_ID).try_into().unwrap()
}
fn header() -> [u8; 48] {
    unhex(V_HEADER).try_into().unwrap()
}
fn import(p: &impl Platform, raw: &str) -> KeyHandle {
    let k: [u8; 32] = unhex(raw).try_into().unwrap();
    block_on(p.aes_import(Zeroizing::new(k))).unwrap()
}
fn env_ad(id: &[u8], header: &[u8]) -> Vec<u8> {
    [ENV_AD, id, header].concat()
}

#[test]
fn vecteurs_fixes_ids_et_preuves() {
    let p = platform(1);
    assert_eq!(hex(&share_id(&k_lien())), V_ID);
    assert_eq!(hex(derive_access(&k_lien()).k_acces.as_bytes()), V_K_ACCES);
    let a = block_on(access_keys(&p, &k_lien(), &k_mdp())).unwrap();
    assert_eq!(hex(a.k_preuve.as_bytes()), V_K_PREUVE);
    assert_eq!(hex(&a.v_preuve), V_V_PREUVE);
    let c = block_on(content_keys(&p, &r())).unwrap();
    assert_eq!(hex(&c.engagement), V_ENGAGEMENT);
}

#[test]
fn open_deballe_une_enveloppe_de_node() {
    let p = platform(1);
    let a = block_on(access_keys(&p, &k_lien(), &k_mdp())).unwrap();
    let got = block_on(open(&p, a.k_env, &unhex(V_E), &id(), &header())).unwrap();
    assert_eq!(got.as_bytes(), &[3; 32]);
}

#[test]
fn seal_produit_une_enveloppe_que_k_env_de_node_deballe() {
    let p = platform(1);
    let a = block_on(access_keys(&p, &k_lien(), &k_mdp())).unwrap();
    let e = block_on(seal(&p, a.k_env, &r(), &id(), &header())).unwrap();
    assert_eq!(e.len(), 60);
    // K_env calculée par Node, importée telle quelle : AES-GCM(K_env, nonce, R, AD).
    let node = import(&p, V_K_ENV);
    let nonce: [u8; 12] = e[..12].try_into().unwrap();
    let pt = block_on(p.aes_open_batch(node, &env_ad(&id(), &header()), &[nonce], &e[12..], 48));
    assert_eq!(&pt.unwrap()[..], &[3; 32]);
}

#[test]
fn k_contenu_egale_hkdf_de_r() {
    // Node déchiffre ce que K_contenu chiffre : ici, la clé de Node importée déchiffre.
    let p = platform(1);
    let c = block_on(content_keys(&p, &r())).unwrap();
    let ct = block_on(p.aes_seal_batch(c.k_contenu, b"", &[[0; 12]], b"AAAAA", 5)).unwrap();
    let node = import(&p, V_K_CONTENU);
    let pt = block_on(p.aes_open_batch(node, b"", &[[0; 12]], &ct, 21)).unwrap();
    assert_eq!(&pt[..], b"AAAAA");
}

#[test]
fn aller_retour_et_nonces_differents() {
    let p = platform(7);
    let a = block_on(access_keys(&p, &k_lien(), &k_mdp())).unwrap();
    let e1 = block_on(seal(&p, a.k_env, &r(), &id(), &header())).unwrap();
    let e2 = block_on(seal(&p, a.k_env, &r(), &id(), &header())).unwrap();
    assert_eq!(e1.len(), ENVELOPE_LEN);
    assert_eq!(ENVELOPE_LEN, 60);
    assert_ne!(e1[..12], e2[..12]);
    for e in [&e1, &e2] {
        let got = block_on(open(&p, a.k_env, e, &id(), &header())).unwrap();
        assert_eq!(got.as_bytes(), &[3; 32]);
    }
}

#[test]
fn toute_alteration_donne_paquet_corrompu() {
    let p = platform(7);
    let a = block_on(access_keys(&p, &k_lien(), &k_mdp())).unwrap();
    let e = block_on(seal(&p, a.k_env, &r(), &id(), &header())).unwrap();
    let other = block_on(access_keys(&p, &k_lien(), &KMdp::from_bytes([4; 32]))).unwrap();
    let other_link = block_on(access_keys(&p, &KLien::from_bytes([5; 32]), &k_mdp())).unwrap();
    let mut other_id = id();
    other_id[0] ^= 1;
    let mut other_header = header();
    other_header[47] ^= 1;
    let longer = [&e[..], &[0]].concat();
    let (id, header) = (id(), header());
    // (K_env, E, id, en-tête)
    type Case = (KeyHandle, Vec<u8>, Vec<u8>, Vec<u8>);
    let mut cases: Vec<Case> = vec![
        (a.k_env, e.clone(), other_id.to_vec(), header.to_vec()),
        (a.k_env, e.clone(), id.to_vec(), other_header.to_vec()),
        (other.k_env, e.clone(), id.to_vec(), header.to_vec()),
        (other_link.k_env, e.clone(), id.to_vec(), header.to_vec()),
        (a.k_env, e[..59].to_vec(), id.to_vec(), header.to_vec()),
        (a.k_env, longer, id.to_vec(), header.to_vec()),
        (a.k_env, e.clone(), id[..15].to_vec(), header.to_vec()),
        (a.k_env, e.clone(), id.to_vec(), header[..47].to_vec()),
        (a.k_env, vec![], id.to_vec(), header.to_vec()),
        (
            a.k_env,
            e.clone(),
            [&id[..], &[0]].concat(),
            header.to_vec(),
        ),
        (
            a.k_env,
            e.clone(),
            id.to_vec(),
            [&header[..], &[0]].concat(),
        ),
    ];
    for i in 0..e.len() {
        let mut t = e.clone();
        t[i] ^= 0x80;
        cases.push((a.k_env, t, id.to_vec(), header.to_vec()));
    }
    assert_eq!(cases.len(), 71);
    for (k, ee, ii, hh) in &cases {
        let got = block_on(open(&p, *k, ee, ii, hh));
        assert_eq!(got.unwrap_err(), Error::PaquetCorrompu, "{}", hex(ee));
    }
}

#[test]
fn enveloppe_d_un_autre_partage_refusee() {
    // Le serveur échange E entre deux partages : les données authentifiées (en-tête) l'empêchent.
    let p = platform(9);
    let a = block_on(access_keys(&p, &k_lien(), &k_mdp())).unwrap();
    let r2 = new_seed(&p).unwrap();
    let eng2 = block_on(content_keys(&p, &r2)).unwrap().engagement;
    let h2: [u8; 48] = [&header()[..16], &eng2[..]].concat().try_into().unwrap();
    let e2 = block_on(seal(&p, a.k_env, &r2, &id(), &h2)).unwrap();
    let got = block_on(open(&p, a.k_env, &e2, &id(), &header()));
    assert_eq!(got.unwrap_err(), Error::PaquetCorrompu);
    // Avec son propre en-tête, elle s'ouvre (le refus vient bien des données authentifiées).
    let got = block_on(open(&p, a.k_env, &e2, &id(), &h2)).unwrap();
    assert_eq!(got.as_bytes(), r2.as_bytes());
}

#[test]
fn engagement_faux_refuse_juste_memes_cles() {
    let p = platform(3);
    let good = unhex(V_ENGAGEMENT);
    let c = block_on(content_keys_checked(&p, &r(), &good)).unwrap();
    assert_eq!(hex(&c.engagement), V_ENGAGEMENT);
    // Même K_contenu que content_keys : même chiffré pour le même nonce.
    let plain = [0x41u8; 16];
    let a = block_on(p.aes_seal_batch(c.k_contenu, b"", &[[0; 12]], &plain, 16)).unwrap();
    let c2 = block_on(content_keys(&p, &r())).unwrap();
    let b = block_on(p.aes_seal_batch(c2.k_contenu, b"", &[[0; 12]], &plain, 16)).unwrap();
    assert_eq!(a, b);
    let mut bad = good.clone();
    bad[0] ^= 1;
    let mut bad_last = good.clone();
    bad_last[31] ^= 0x80;
    let other_r = new_seed(&p).unwrap();
    for (seed, eng) in [
        (&r(), &bad[..]),
        (&r(), &bad_last[..]),
        (&other_r, &good[..]),
        (&r(), &good[..31]),
        (&r(), &[&good[..], &[0]].concat()[..]),
        (&r(), &[][..]),
    ] {
        let got = block_on(content_keys_checked(&p, seed, eng));
        assert_eq!(got.err(), Some(Error::PaquetCorrompu), "{}", hex(eng));
    }
}

#[test]
fn tailles_refusees() {
    for n in [31, 33] {
        assert_eq!(
            KLien::from_slice(&vec![1; n]).unwrap_err(),
            Error::TailleInvalide
        );
        assert_eq!(
            KMdp::from_slice(&vec![1; n]).unwrap_err(),
            Error::TailleInvalide
        );
        assert_eq!(
            Seed::from_slice(&vec![1; n]).unwrap_err(),
            Error::GraineInvalide
        );
    }
}

#[test]
fn aleatoire_qui_echoue() {
    // Jamais de graine ou de nonce nuls à la place : l'erreur remonte.
    let p = no_random();
    assert_eq!(new_seed(&p).unwrap_err(), Error::AleatoireIndisponible);
    let a = block_on(access_keys(&p, &k_lien(), &k_mdp())).unwrap();
    let got = block_on(seal(&p, a.k_env, &r(), &id(), &header()));
    assert_eq!(got.unwrap_err(), Error::AleatoireIndisponible);
}

#[test]
fn etiquettes_v2_seulement() {
    let srcs = [
        include_str!("../src/envelope.rs"),
        include_str!("../src/kdf.rs"),
    ];
    let mut labels = vec![];
    for s in srcs {
        for (i, _) in s.match_indices("\"shhdrop/") {
            let rest = &s[i + 1..];
            labels.push(&rest[..rest.find('"').unwrap()]);
        }
    }
    assert!(labels.len() >= 7, "{labels:?}");
    for l in &labels {
        let tail = l
            .strip_prefix("shhdrop/v2/")
            .unwrap_or_else(|| panic!("{l}"));
        let word = tail.strip_suffix("-ad").unwrap_or(tail);
        assert!(
            !word.is_empty() && word.bytes().all(|b| b.is_ascii_lowercase()),
            "{l}"
        );
    }
    // Une étiquette, un usage : l'info HKDF de K_env et le préfixe des données authentifiées
    // de E sont distincts (séparation des domaines).
    assert!(srcs[0].contains("\"shhdrop/v2/enveloppe-ad\""));
    assert!(srcs[0].contains("hkdf::<32>(&*k_maitre, \"shhdrop/v2/enveloppe\")"));
    for s in srcs {
        assert!(!s.contains("shhdrop/v1/"));
    }
}

// --- Contrat du fournisseur natif ---

#[test]
fn lot_concatenation_des_morceaux() {
    let p = platform(1);
    let k = import(&p, V_K_CONTENU);
    let plain: Vec<u8> = (0..300u32).map(|i| i as u8).collect();
    let nonces = [[1u8; 12], [2; 12], [3; 12]];
    let ct = block_on(p.aes_seal_batch(k, b"ad", &nonces, &plain, 100)).unwrap();
    assert_eq!(ct.len(), 3 * 116);
    for (i, n) in nonces.iter().enumerate() {
        let one = block_on(p.aes_seal_batch(k, b"ad", &[*n], &plain[i * 100..][..100], 100));
        assert_eq!(one.unwrap(), ct[i * 116..][..116], "morceau {i}");
    }
    let pt = block_on(p.aes_open_batch(k, b"ad", &nonces, &ct, 116)).unwrap();
    assert_eq!(&pt[..], &plain[..]);
    // Lot vide : rien à chiffrer.
    assert!(
        block_on(p.aes_seal_batch(k, b"ad", &[], &[], 100))
            .unwrap()
            .is_empty()
    );
    assert!(
        block_on(p.aes_open_batch(k, b"ad", &[], &[], 116))
            .unwrap()
            .is_empty()
    );
    // Un seul morceau altéré, un autre nonce ou d'autres AD : tout le lot est refusé.
    let mut t = ct.clone();
    t[2 * 116 + 5] ^= 1;
    let swapped = [nonces[1], nonces[0], nonces[2]];
    for (n, ad, c) in [
        (&nonces, &b"ad"[..], &t),
        (&swapped, &b"ad"[..], &ct),
        (&nonces, &b"ae"[..], &ct),
    ] {
        let got = block_on(p.aes_open_batch(k, ad, n, c, 116));
        assert_eq!(got.unwrap_err(), Error::PaquetCorrompu);
    }
}

#[test]
fn lot_mal_forme() {
    let p = platform(1);
    let k = import(&p, V_K_CONTENU);
    let n2 = [[0u8; 12], [1; 12]];
    for (plain, chunk) in [
        (&[0u8; 199][..], 100),
        (&[0; 201][..], 100),
        (&[0; 0][..], 0),
    ] {
        let got = block_on(p.aes_seal_batch(k, b"", &n2, plain, chunk));
        assert_eq!(got.unwrap_err(), Error::ChiffrementEchec, "{chunk}");
    }
    for (cipher, chunk_ct) in [
        (&[0u8; 231][..], 116),
        (&[0; 233][..], 116),
        (&[0; 30][..], 15),
        (&[0; 0][..], 0),
    ] {
        let got = block_on(p.aes_open_batch(k, b"", &n2, cipher, chunk_ct));
        assert_eq!(got.unwrap_err(), Error::PaquetCorrompu, "{chunk_ct}");
    }
    // Tailles qui débordent : refus, pas de panique.
    let got = block_on(p.aes_seal_batch(k, b"", &n2, &[0; 4], usize::MAX));
    assert_eq!(got.unwrap_err(), Error::ChiffrementEchec);
    let got = block_on(p.aes_open_batch(k, b"", &n2, &[0; 4], usize::MAX));
    assert_eq!(got.unwrap_err(), Error::PaquetCorrompu);
}

#[test]
fn poignees_distinctes_et_drop() {
    let p = platform(1);
    let k1 = import(&p, V_K_CONTENU);
    let k2 = import(&p, V_K_ENV);
    assert_ne!(k1, k2);
    let ct = block_on(p.aes_seal_batch(k1, b"", &[[0; 12]], b"abc", 3)).unwrap();
    // Autre poignée = autre clé.
    let got = block_on(p.aes_open_batch(k2, b"", &[[0; 12]], &ct, 19));
    assert_eq!(got.unwrap_err(), Error::PaquetCorrompu);
    p.aes_drop(k1);
    p.aes_drop(k1); // deux fois : sans effet
    let got = block_on(p.aes_seal_batch(k1, b"", &[[0; 12]], b"abc", 3));
    assert_eq!(got.unwrap_err(), Error::ChiffrementEchec);
    let got = block_on(p.aes_open_batch(k1, b"", &[[0; 12]], &ct, 19));
    assert_eq!(got.unwrap_err(), Error::PaquetCorrompu);
    // Une poignée oubliée n'est jamais redonnée à une autre clé.
    let k3 = import(&p, V_K_CONTENU);
    assert_ne!(k3, k1);
    assert_ne!(k3, k2);
    // Poignée jamais donnée.
    let unknown = KeyHandle::from_raw(9999);
    let got = block_on(p.aes_seal_batch(unknown, b"", &[[0; 12]], b"abc", 3));
    assert_eq!(got.unwrap_err(), Error::ChiffrementEchec);
}

#[test]
fn random_du_fournisseur() {
    let p = platform(1);
    let mut a = [0u8; 32];
    let mut b = [0u8; 32];
    p.random(&mut a).unwrap();
    p.random(&mut b).unwrap();
    assert_ne!(a, b);
    assert_eq!(
        no_random().random(&mut a).unwrap_err(),
        Error::AleatoireIndisponible
    );
}
