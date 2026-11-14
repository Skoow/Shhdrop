//! Test croisé natif ↔ WebAssembly (Task 9) : ce moteur, compilé en natif, échange avec le même
//! moteur compilé en WebAssembly et chargé par Chromium (web/ui-e2e/salon-moteur.spec.ts). MLS
//! tire son aléa en interne : les Welcome, Commits et messages ne peuvent pas être écrits à
//! l'avance, ils sont produits ici en cours de test, échangés par fichiers JSON (hex) dans le
//! dossier `SHH_CROISE_DIR` donné par le test Playwright, qui joue le serveur (numéros `seq`).
//!
//! Salon 1 : A (natif, créateur, siège 0) ajoute B (wasm, siège 1). Salon 2 : C (wasm, créateur,
//! siège 0) ajoute D (natif, siège 1). Tout voyage en trames de 4 140 octets faites par `Salon`
//! (en-tête tiré du contenu) et lues par `recevoir_trame` ; chaque arrivant reçoit toutes les
//! trames depuis sa création (son KeyPackage, le Commit qui l'ajoute, gardés, puis son Welcome) ;
//! chaque enveloppe reçue est réencodée et comparée octet pour octet à celle de l'expéditeur ;
//! clés SFrame et codes de vérification comparés des deux côtés.
//!
//! Échange : `wasm-1.json` (clés, nonces d'arrivée, KeyPackage de B) → `natif-1.json` →
//! `wasm-2.json` → `natif-2.json`. Sans `SHH_CROISE_DIR`, le test ne fait rien (`cargo test`).
use serde_json::{Value, json};
use shhdrop_core::{KLien, KMdp};
use shhdrop_salon::{
    ClesSalon, Enveloppe, Evenement, Graine, Message, RefPiece, Regle, Salon, cles_salon, encoder,
    nouvelle_identite,
};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex"))
        .collect()
}

fn champ(v: &Value, k: &str) -> Vec<u8> {
    unhex(v[k].as_str().unwrap_or_else(|| panic!("champ {k} absent")))
}

fn fixe<const N: usize>(v: &Value, k: &str) -> [u8; N] {
    champ(v, k).try_into().expect("longueur")
}

/// Attend le fichier écrit par le test Playwright (écrit à côté puis renommé : jamais lu à moitié).
fn attendre(dir: &Path, nom: &str) -> Value {
    let p = dir.join(nom);
    let debut = Instant::now();
    while !p.exists() {
        assert!(
            debut.elapsed() < Duration::from_secs(120),
            "{nom} jamais écrit"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    serde_json::from_slice(&std::fs::read(&p).unwrap()).unwrap()
}

fn ecrire(dir: &Path, nom: &str, v: &Value) {
    let tmp = dir.join(format!("{nom}.tmp"));
    std::fs::write(&tmp, serde_json::to_vec(v).unwrap()).unwrap();
    std::fs::rename(tmp, dir.join(nom)).unwrap();
}

fn cles(v: &Value, n: u8) -> ClesSalon {
    cles_salon(
        &KLien::from_bytes(fixe(v, &format!("k_lien_{n}"))),
        &KMdp::from_bytes(fixe(v, &format!("k_mdp_{n}"))),
    )
}

/// Message attendu de `de` : l'enveloppe reçue, réencodée, est l'octet près celle envoyée.
fn message(ev: Evenement, de: u8, attendu: &Value, k: &str) {
    match ev {
        Evenement::Message {
            de_siege,
            enveloppe,
            ..
        } => {
            assert_eq!(de_siege, de, "{k}");
            assert_eq!(
                hex(&encoder(&enveloppe).unwrap()),
                attendu[k].as_str().unwrap(),
                "{k}"
            );
        }
        autre => panic!("{k} : {autre:?}"),
    }
}

fn empreintes(s: &Salon) -> Value {
    json!([s.empreinte(0).unwrap(), s.empreinte(1).unwrap()])
}

/// Entrée attendue : les trames d'avant le Welcome (KeyPackage, Commit d'ajout) rejouées en `Ignore`.
fn entree(ev: Result<Evenement, shhdrop_salon::Error>, k: &str) {
    assert_eq!(
        ev,
        Ok(Evenement::Entree {
            rejoues: vec![(1, Ok(Evenement::Ignore)), (2, Ok(Evenement::Ignore))]
        }),
        "{k}"
    );
}

#[test]
fn croise_natif() {
    let Some(dir) = std::env::var_os("SHH_CROISE_DIR").map(PathBuf::from) else {
        eprintln!(
            "croise_natif : SHH_CROISE_DIR absent, rien à faire (lancé par salon-moteur.spec.ts)"
        );
        return;
    };
    let w1 = attendre(&dir, "wasm-1.json");
    let (k1, k2) = (cles(&w1, 1), cles(&w1, 2));
    let (na, nb, nc, nd) = (
        fixe::<16>(&w1, "n_a"),
        fixe::<16>(&w1, "n_b"),
        fixe::<16>(&w1, "n_c"),
        fixe::<16>(&w1, "n_d"),
    );

    // Salon 1 : A crée, voit le KeyPackage de B (seq 1), l'ajoute (seq 2), envoie le Welcome
    // (seq 3) et écrit (seq 4).
    let mut a = Salon::creer(nouvelle_identite(0, na).unwrap(), &k1, true).unwrap();
    a.remplacer_annonces(0, &[(0, na)]);
    a.annoncer(1, nb);
    let t_kp_b = champ(&w1, "t_kp_b");
    let Ok(Evenement::KeyPackage { octets: kp_b }) = a.recevoir_trame(&k1, &t_kp_b, 1, 1) else {
        panic!("KeyPackage de B")
    };
    let commit = a.ajouter(&k1, &kp_b).unwrap();
    let Ok(Evenement::CommitAccepte {
        welcome: Some(welcome),
        ..
    }) = a.recevoir_trame(&k1, &commit, 2, 0)
    else {
        panic!("écho du Commit de A")
    };
    assert_eq!(a.recevoir_trame(&k1, &welcome, 3, 0), Ok(Evenement::Ignore));
    let env1 = Enveloppe {
        id: [1; 16],
        heure_ms: 1_700_000_000_001,
        regle: Regle::CinqMinutes,
        message: Message::Texte {
            x: "Bonjour du natif, é 😀\nligne 2".into(),
        },
    };
    let m1 = a.envoyer(&k1, &env1).unwrap();
    assert_eq!(a.recevoir_trame(&k1, &m1, 4, 0), Ok(Evenement::Ignore));

    // Salon 2 : D attend d'entrer, publie son KeyPackage (seq 1) et le reçoit en écho.
    let mut d = Salon::creer(nouvelle_identite(1, nd).unwrap(), &k2, false).unwrap();
    d.remplacer_annonces(0, &[(0, nc), (1, nd)]);
    let t_kp_d = d.key_package(&k2).unwrap();
    assert_eq!(d.recevoir_trame(&k2, &t_kp_d, 1, 1), Ok(Evenement::Ignore));

    ecrire(
        &dir,
        "natif-1.json",
        &json!({
            "t_commit_1": hex(&commit),
            "t_welcome_1": hex(&welcome),
            "t_m1": hex(&m1),
            "env1": hex(&encoder(&env1).unwrap()),
            "sframe_1": hex(&*a.exporter_sframe().unwrap()),
            "empreintes_1": empreintes(&a),
            "t_kp_d": hex(&t_kp_d),
        }),
    );

    // Salon 1 : B (wasm) a écrit deux messages autour d'un renouvellement (seq 5, 6, 7).
    let w2 = attendre(&dir, "wasm-2.json");
    message(
        a.recevoir_trame(&k1, &champ(&w2, "t_m2"), 5, 1).unwrap(),
        1,
        &w2,
        "env2",
    );
    assert_eq!(
        a.recevoir_trame(&k1, &champ(&w2, "t_c"), 6, 1),
        Ok(Evenement::Membres {
            ajoutes: vec![],
            retires: vec![],
            createur_revenu: false,
        })
    );
    assert_eq!(a.epoque(), Some(2));
    message(
        a.recevoir_trame(&k1, &champ(&w2, "t_m3"), 7, 1).unwrap(),
        1,
        &w2,
        "env3",
    );
    assert_eq!(
        hex(&*a.exporter_sframe().unwrap()),
        w2["sframe_b"].as_str().unwrap()
    );

    // Salon 2 : D reçoit le Commit de C (seq 2, gardé), puis son Welcome (seq 3) : il entre,
    // lit le message de C (seq 4) et répond (seq 5).
    assert_eq!(
        d.recevoir_trame(&k2, &champ(&w2, "t_commit_2"), 2, 0),
        Ok(Evenement::Ignore)
    );
    entree(
        d.recevoir_trame(&k2, &champ(&w2, "t_welcome_2"), 3, 0),
        "entrée de D",
    );
    assert_eq!(d.membres(), vec![0, 1]);
    assert_eq!(d.epoque(), Some(1));
    assert_eq!(
        hex(&*d.exporter_sframe().unwrap()),
        w2["sframe_c"].as_str().unwrap()
    );
    assert_eq!(empreintes(&d), w2["empreintes_2"]);
    message(
        d.recevoir_trame(&k2, &champ(&w2, "t_m4"), 4, 0).unwrap(),
        0,
        &w2,
        "env4",
    );
    let env5 = Enveloppe {
        id: [5; 16],
        heure_ms: 1_700_000_000_005,
        regle: Regle::Desactive,
        message: Message::Profil {
            pseudo: "Dédé".into(),
            couleur: 3,
            avatar: Some(RefPiece {
                r: Graine::new([0x55; 32]),
                piece: [0x66; 16],
                palier: 16,
            }),
        },
    };
    let m5 = d.envoyer(&k2, &env5).unwrap();
    assert_eq!(d.recevoir_trame(&k2, &m5, 5, 1), Ok(Evenement::Ignore));
    ecrire(
        &dir,
        "natif-2.json",
        &json!({
            "t_m5": hex(&m5),
            "env5": hex(&encoder(&env5).unwrap()),
        }),
    );
}
