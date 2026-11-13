// Vecteurs communs du salon : engine/vectors/salon-v3.json, PRODUIT PAR CE MOTEUR. Chaque cas
// donne ses entrées et ses sorties ; le test les recalcule à partir des seules entrées du
// fichier et compare (les apps et le site rejouent le même fichier).
//
// Régénérer (après un changement voulu, relu) :
//   SHH_GEN_SALON=1 cargo test -p shhdrop-salon --test vecteurs
// Le fichier est déterministe : entrées dérivées de SHA-256 d'étiquettes fixes (README).
// MLS n'est pas dans le fichier (aléa interne d'OpenMLS) : voir engine/vectors/README.md.
use chacha20poly1305::aead::{AeadInPlace, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use serde_json::{Map, Value, json};
use shhdrop_core::encoding::b64u;
use shhdrop_core::format::MAX_SAFE;
use shhdrop_core::kdf::sha256;
use shhdrop_core::{KLien, KMdp};
use shhdrop_salon::{
    ClesSalon, EN_TETE_CONTROLE, EnTete, Enveloppe, Error, Etat, Graine, JSON_MAX, MAX_CHARGE,
    Message, RefPiece, Regle, SortePiece, TAILLE_O, TAILLE_TRAME, cle_acces, cle_unicite,
    cles_salon, code_verification, decoder, en_tete_coherent, en_tete_de, encoder, etat,
    lire_en_tete, nettoyer_texte, ouvrir, sceller, verifier_pseudo,
};

const FILE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../vectors/salon-v3.json");

// ------------------------------------------------------------------------- outils communs

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    assert!(s.len().is_multiple_of(2), "hex de longueur impaire : {s}");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex"))
        .collect()
}

/// Octets déterministes d'une étiquette : bloc i = SHA-256(UTF-8(« shhdrop/vecteurs/salon-v3/ »
/// + étiquette) ‖ i sur 4 octets gros-boutistes), blocs mis bout à bout.
fn stream(label: &str, n: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(n + 32);
    let mut i = 0u32;
    while out.len() < n {
        let mut m = format!("shhdrop/vecteurs/salon-v3/{label}").into_bytes();
        m.extend_from_slice(&i.to_be_bytes());
        out.extend_from_slice(&sha256(&m));
        i += 1;
    }
    out.truncate(n);
    out
}

fn h(label: &str, n: usize) -> String {
    hex(&stream(label, n))
}

/// Octets décrits dans le fichier : `{"hex"}`, `{"utf8"}`, `{"repeat": {unit (hex), n, then
/// (hex, facultatif)}}` (unité répétée n fois, puis `then`) ou `{"xorshift32": {seed, len}}`
/// (README de v2 : x ^= x << 13, x ^= x >> 17, x ^= x << 5 ; chaque état donne 4 octets
/// petit-boutistes ; le dernier groupe est tronqué).
fn bytes(spec: &Value) -> Vec<u8> {
    if let Some(s) = spec["hex"].as_str() {
        return unhex(s);
    }
    if let Some(s) = spec["utf8"].as_str() {
        return s.as_bytes().to_vec();
    }
    if let Some(r) = spec.get("repeat") {
        let mut v = unhex(r["unit"].as_str().unwrap()).repeat(r["n"].as_u64().unwrap() as usize);
        v.extend(unhex(r["then"].as_str().unwrap_or("")));
        return v;
    }
    let x = &spec["xorshift32"];
    let (mut s, len) = (
        x["seed"].as_u64().unwrap() as u32,
        x["len"].as_u64().unwrap() as usize,
    );
    let mut out = Vec::with_capacity(len + 4);
    while out.len() < len {
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        out.extend_from_slice(&s.to_le_bytes());
    }
    out.truncate(len);
    out
}

fn hex_spec(b: &[u8]) -> Value {
    json!({ "hex": hex(b) })
}

fn repeat(unit: &str, n: usize) -> Value {
    json!({ "repeat": { "unit": hex(unit.as_bytes()), "n": n } })
}

fn err(e: Error) -> Value {
    json!({ "error": e.to_string() })
}

fn merge(c: &mut Value, extra: Value) {
    let Value::Object(m) = extra else {
        panic!("objet attendu")
    };
    for (k, v) in m {
        c[k] = v;
    }
}

/// Sortie texte : en hex si elle tient en 256 octets, sinon longueur et empreinte.
fn texte_out(s: &str) -> Value {
    if s.len() <= 256 {
        json!({ "out_hex": hex(s.as_bytes()) })
    } else {
        json!({ "out_len": s.len(), "out_sha256": hex(&sha256(s.as_bytes())) })
    }
}

/// Champs de sortie d'un cas (sans ses entrées), pour comparer au fichier.
fn outputs(c: &Value, keys: &[&str]) -> Value {
    let mut m = Map::new();
    for k in keys {
        if let Some(x) = c.get(*k) {
            m.insert((*k).into(), x.clone());
        }
    }
    Value::Object(m)
}

// ---------------------------------------------------------------------------------- cles

fn k_lien(c: &Value) -> KLien {
    KLien::from_bytes(unhex(c["k_lien"].as_str().unwrap()).try_into().unwrap())
}

fn k_mdp(c: &Value) -> KMdp {
    KMdp::from_bytes(unhex(c["k_mdp"].as_str().unwrap()).try_into().unwrap())
}

fn cles_case(c: &Value) -> Value {
    let a = cle_acces(&k_lien(c));
    let s = cles_salon(&k_lien(c), &k_mdp(c));
    json!({
        "k_acces": hex(&a.k), "v_acces": hex(&a.v),
        "k_preuve": hex(s.k_preuve()), "v_preuve": hex(&s.v_preuve()),
        "k_trame": hex(s.k_trame()), "tag": hex(s.tag()),
    })
}

fn cles() -> Value {
    let cases = [
        ("zeros", "00".repeat(32), "00".repeat(32)),
        (
            "seq",
            hex(&(0u8..32).collect::<Vec<_>>()),
            hex(&(32u8..64).collect::<Vec<_>>()),
        ),
        ("hasard_1", h("cles/lien-1", 32), h("cles/mdp-1", 32)),
        // Même K_lien, autre K_mdp : K_accès identique, tout le reste change.
        (
            "meme_lien_autre_mdp",
            h("cles/lien-1", 32),
            h("cles/mdp-2", 32),
        ),
        ("ff", "ff".repeat(32), "ff".repeat(32)),
    ];
    cases
        .into_iter()
        .map(|(label, l, m)| {
            let mut c = json!({ "label": label, "k_lien": l, "k_mdp": m });
            let x = cles_case(&c);
            merge(&mut c, x);
            c
        })
        .collect()
}

// --------------------------------------------------------------------------------- trames

fn en_tete_json(e: shhdrop_salon::EnTete) -> Value {
    json!({ "volatile": e.volatile, "regle": e.regle as u8 })
}

fn regle_de(n: u64) -> Regle {
    match n {
        0 => Regle::Desactive,
        1 => Regle::UneMinute,
        2 => Regle::CinqMinutes,
        3 => Regle::UneHeure,
        _ => panic!("règle {n}"),
    }
}

fn header_read(t: &[u8]) -> Value {
    match lire_en_tete(t) {
        Ok(e) => en_tete_json(e),
        Err(e) => err(e),
    }
}

fn open_out(c: &Value, t: &[u8]) -> Value {
    match ouvrir(&cles_salon(&k_lien(c), &k_mdp(c)), t) {
        Ok((e, charge)) => {
            let mut v = en_tete_json(e);
            v["charge_hex"] = hex(&charge).into();
            v
        }
        Err(e) => err(e),
    }
}

/// Scellement à nonce donné, écrit ici d'après la spécification (v3 §3.2.1) avec
/// XChaCha20-Poly1305 de RustCrypto, indépendamment du moteur (dont la forme à nonce donné est
/// interne ; son test unitaire `trame::tests::vecteurs_a_nonce_donne` redonne ces trames) :
/// `"SHC3"` ‖ drapeaux ‖ nonce ‖ AEAD(`K_trame`, nonce, `len` ‖ charge ‖ zéros,
/// `"SHC3"` ‖ drapeaux ‖ tag du salon).
fn sceller_ref(
    cles: &ClesSalon,
    et: EnTete,
    charge: &[u8],
    nonce: &[u8; 24],
) -> Result<Vec<u8>, Error> {
    if charge.len() > MAX_CHARGE {
        return Err(Error::TropGrand);
    }
    let d = u8::from(et.volatile) | ((et.regle as u8) << 1);
    let mut o = vec![0u8; TAILLE_O];
    o[..2].copy_from_slice(&(charge.len() as u16).to_be_bytes());
    o[2..2 + charge.len()].copy_from_slice(charge);
    let mut aad = b"SHC3".to_vec();
    aad.push(d);
    aad.extend_from_slice(cles.tag());
    let tag = XChaCha20Poly1305::new(cles.k_trame().into())
        .encrypt_in_place_detached(XNonce::from_slice(nonce), &aad, &mut o)
        .unwrap();
    let mut t = b"SHC3".to_vec();
    t.push(d);
    t.extend_from_slice(nonce);
    t.extend_from_slice(&o);
    t.extend_from_slice(&tag);
    Ok(t)
}

fn en_tete_de_json(v: &Value) -> EnTete {
    EnTete {
        volatile: v["volatile"].as_bool().unwrap(),
        regle: regle_de(v["regle"].as_u64().unwrap()),
    }
}

/// Cas de scellement : `{k_lien, k_mdp, en_tete, charge, nonce}`. Sorties : `seal`
/// (`trame_hex` ou erreur), puis `read_header` et `open` de la trame obtenue. Le moteur
/// (`sceller`, nonce tiré) donne la même erreur, ou une trame qui s'ouvre sur la même charge.
fn trame_case(c: &Value) -> Value {
    let cles = cles_salon(&k_lien(c), &k_mdp(c));
    let et = en_tete_de_json(&c["en_tete"]);
    let nonce: [u8; 24] = unhex(c["nonce"].as_str().unwrap()).try_into().unwrap();
    let charge = bytes(&c["charge"]);
    match sceller_ref(&cles, et, &charge, &nonce) {
        Ok(t) => {
            let moteur = sceller(&cles, et, &charge).unwrap();
            assert_eq!(ouvrir(&cles, &moteur).unwrap(), (et, charge.into()));
            json!({
                "seal": { "trame_hex": hex(&t) },
                "read_header": header_read(&t),
                "open": open_out(c, &t),
            })
        }
        Err(e) => {
            assert_eq!(sceller(&cles, et, &charge), Err(e));
            json!({ "seal": err(e) })
        }
    }
}

/// Cas de cohérence : `{en_tete, contenu}` où `contenu` est `"controle"` (Commit, Welcome,
/// KeyPackage) ou une enveloppe → `{ok: true}` ou erreur (`message_invalide`).
fn coherence_case(c: &Value) -> Value {
    let et = en_tete_de_json(&c["en_tete"]);
    let env = (c["contenu"] != "controle").then(|| env_de(&c["contenu"]));
    // L'en-tête que le moteur met sur ce contenu passe toujours.
    let propre = env.as_ref().map_or(EN_TETE_CONTROLE, en_tete_de);
    assert_eq!(en_tete_coherent(propre, env.as_ref()), Ok(()));
    match en_tete_coherent(et, env.as_ref()) {
        Ok(()) => json!({ "ok": true }),
        Err(e) => err(e),
    }
}

/// Toutes les paires (en-tête, contenu) : seul l'en-tête tiré du contenu passe (et tout bit
/// volatil pour une sorte inconnue).
fn coherence() -> Value {
    let et = |volatile: bool, regle: u8| json!({ "volatile": volatile, "regle": regle });
    let contenus: Vec<(&str, Value)> = vec![
        ("controle", json!("controle")),
        (
            "texte_e0",
            enveloppe("coherence/texte_e0", 0, json!({ "k": "texte", "x": "a" })),
        ),
        (
            "texte_e3",
            enveloppe("coherence/texte_e3", 3, json!({ "k": "texte", "x": "a" })),
        ),
        (
            "ecrit_e1",
            enveloppe("coherence/ecrit_e1", 1, json!({ "k": "ecrit" })),
        ),
        (
            "vu_e2",
            enveloppe(
                "coherence/vu_e2",
                2,
                json!({ "k": "vu", "ids": [h("coherence/vu", 16)] }),
            ),
        ),
        (
            "inconnu_e2",
            enveloppe(
                "coherence/inconnu_e2",
                2,
                json!({ "k": "inconnu", "sorte": "appel" }),
            ),
        ),
    ];
    let mut out = Vec::new();
    for (nom, contenu) in contenus {
        for v in [false, true] {
            for r in 0..4u8 {
                let mut c = json!({ "label": format!("{nom}_volatile_{v}_regle_{r}"),
                    "en_tete": et(v, r), "contenu": contenu });
                let x = coherence_case(&c);
                merge(&mut c, x);
                out.push(c);
            }
        }
    }
    out.into()
}

/// Altération d'une trame scellée : `{op: "xor", at, mask}`, `{op: "truncate", len}`,
/// `{op: "append", hex}` ou `{op: "autre_mdp", k_mdp}` (même trame, ouverte avec d'autres clés).
fn mutate(base: &[u8], m: &Value) -> Vec<u8> {
    let mut t = base.to_vec();
    match m["op"].as_str().unwrap() {
        "xor" => t[m["at"].as_u64().unwrap() as usize] ^= m["mask"].as_u64().unwrap() as u8,
        "truncate" => t.truncate(m["len"].as_u64().unwrap() as usize),
        "append" => t.extend(unhex(m["hex"].as_str().unwrap())),
        "autre_mdp" => {}
        op => panic!("op {op}"),
    }
    t
}

/// Cas de refus : la trame du cas `from` (de `trames.seal`), altérée, doit être refusée.
fn refus_case(c: &Value, base_trame: &[u8]) -> Value {
    let m = &c["mutation"];
    let t = mutate(base_trame, m);
    let mut keys = c.clone();
    if m["op"] == "autre_mdp" {
        keys["k_mdp"] = m["k_mdp"].clone();
    }
    json!({ "read_header": header_read(&t), "open": open_out(&keys, &t) })
}

fn trames() -> Value {
    let (l, m) = (h("trames/lien", 32), h("trames/mdp", 32));
    let nonce = |i: u8| h(&format!("trames/nonce-{i}"), 24);
    let et = |volatile: bool, regle: u8| json!({ "volatile": volatile, "regle": regle });
    let mut seal: Vec<Value> = Vec::new();
    // Un message réel (texte) d'abord, puis les quatre règles, les deux drapeaux, les tailles
    // extrêmes de la charge.
    let texte = encoder(&Enveloppe {
        id: stream("trames/id", 16).try_into().unwrap(),
        heure_ms: 1_700_000_000_000,
        regle: Regle::Desactive,
        message: Message::Texte {
            x: "Allo été 😀".into(),
        },
    })
    .unwrap();
    let sources: Vec<(String, Value, Value)> = vec![
        ("message_texte".into(), et(false, 0), hex_spec(&texte)),
        ("charge_vide".into(), et(false, 0), hex_spec(&[])),
        ("charge_1_octet".into(), et(false, 0), hex_spec(&[0x7b])),
        (
            "charge_4092_octets".into(),
            et(false, 0),
            json!({ "xorshift32": { "seed": 4092, "len": 4092 } }),
        ),
        (
            "charge_max_4093_octets".into(),
            et(false, 0),
            json!({ "xorshift32": { "seed": 4093, "len": MAX_CHARGE } }),
        ),
        (
            "charge_4094_octets_refusee".into(),
            et(false, 0),
            json!({ "xorshift32": { "seed": 4094, "len": MAX_CHARGE + 1 } }),
        ),
        (
            "charge_65535_octets_refusee".into(),
            et(false, 0),
            json!({ "xorshift32": { "seed": 7, "len": 65535 } }),
        ),
        ("charge_zeros".into(), et(false, 0), repeat("\0", 100)),
    ]
    .into_iter()
    .chain((0..4u8).flat_map(|r| {
        [false, true].map(|v| {
            (
                format!("regle_{r}_volatile_{v}"),
                et(v, r),
                hex_spec(format!("m{r}{v}").as_bytes()),
            )
        })
    }))
    .collect();
    for (i, (label, e, charge)) in sources.into_iter().enumerate() {
        let mut c = json!({ "label": label, "k_lien": l, "k_mdp": m, "en_tete": e,
                            "charge": charge, "nonce": nonce(i as u8) });
        let x = trame_case(&c);
        merge(&mut c, x);
        seal.push(c);
    }
    // Un salon ouvert avec d'autres clés ; mêmes entrées, autre nonce : autre trame.
    let mut c = json!({ "label": "autres_cles", "k_lien": h("trames/lien-b", 32),
        "k_mdp": h("trames/mdp-b", 32), "en_tete": et(false, 0),
        "charge": hex_spec(b"x"), "nonce": nonce(0) });
    let x = trame_case(&c);
    merge(&mut c, x);
    seal.push(c);
    // Refus à l'ouverture : altérations de la trame `message_texte`.
    let base_seal = seal[0].clone();
    let base = unhex(base_seal["seal"]["trame_hex"].as_str().unwrap());
    assert_eq!(base.len(), TAILLE_TRAME);
    let end = TAILLE_TRAME;
    let muts: Vec<(&str, Value)> = vec![
        ("marque_alteree", json!({ "op": "xor", "at": 0, "mask": 1 })),
        (
            "drapeaux_bit_reserve",
            json!({ "op": "xor", "at": 4, "mask": 8 }),
        ),
        (
            "drapeaux_volatile_change",
            json!({ "op": "xor", "at": 4, "mask": 1 }),
        ),
        (
            "drapeaux_regle_change",
            json!({ "op": "xor", "at": 4, "mask": 2 }),
        ),
        ("drapeaux_xor_3", json!({ "op": "xor", "at": 4, "mask": 3 })),
        ("drapeaux_xor_4", json!({ "op": "xor", "at": 4, "mask": 4 })),
        ("drapeaux_xor_5", json!({ "op": "xor", "at": 4, "mask": 5 })),
        ("drapeaux_xor_6", json!({ "op": "xor", "at": 4, "mask": 6 })),
        ("drapeaux_xor_7", json!({ "op": "xor", "at": 4, "mask": 7 })),
        ("nonce_altere", json!({ "op": "xor", "at": 5, "mask": 128 })),
        (
            "chiffre_altere_debut",
            json!({ "op": "xor", "at": 29, "mask": 1 }),
        ),
        (
            "chiffre_altere_milieu",
            json!({ "op": "xor", "at": 2000, "mask": 64 }),
        ),
        (
            "etiquette_aead_alteree",
            json!({ "op": "xor", "at": end - 1, "mask": 1 }),
        ),
        (
            "etiquette_aead_debut_alteree",
            json!({ "op": "xor", "at": end - 16, "mask": 255 }),
        ),
        (
            "tronquee_d_un_octet",
            json!({ "op": "truncate", "len": end - 1 }),
        ),
        ("vide", json!({ "op": "truncate", "len": 0 })),
        ("marque_seule", json!({ "op": "truncate", "len": 4 })),
        ("un_octet_de_trop", json!({ "op": "append", "hex": "00" })),
        (
            "autre_mot_de_passe",
            json!({ "op": "autre_mdp", "k_mdp": h("trames/mdp-c", 32) }),
        ),
    ];
    let reject: Vec<Value> = muts
        .into_iter()
        .map(|(label, mutation)| {
            let mut c = json!({ "label": label, "from": "message_texte",
                "k_lien": l, "k_mdp": m, "mutation": mutation });
            let x = refus_case(&c, &base);
            merge(&mut c, x);
            c
        })
        .collect();
    json!({ "seal": seal, "reject": reject, "coherence": coherence() })
}

// ------------------------------------------------------------------------------- messages

fn graine_de(v: &Value) -> Graine {
    Graine::new(unhex(v.as_str().unwrap()).try_into().unwrap())
}

fn id16(v: &Value) -> [u8; 16] {
    unhex(v.as_str().unwrap()).try_into().unwrap()
}

fn ids_de(m: &Value) -> Vec<[u8; 16]> {
    m["ids"].as_array().unwrap().iter().map(id16).collect()
}

fn sorte_de(s: &str) -> SortePiece {
    match s {
        "fichier" => SortePiece::Fichier,
        "image" => SortePiece::Image,
        "video" => SortePiece::Video,
        "vocal" => SortePiece::Vocal,
        s => panic!("sorte {s}"),
    }
}

fn sorte_nom(s: SortePiece) -> &'static str {
    match s {
        SortePiece::Fichier => "fichier",
        SortePiece::Image => "image",
        SortePiece::Video => "video",
        SortePiece::Vocal => "vocal",
    }
}

/// Enveloppe décrite dans le fichier : `{id, t, e, message: {k, …}}` (identifiants et graines
/// en hex ; le format sur le fil, lui, les met en base64url).
fn env_de(v: &Value) -> Enveloppe {
    let m = &v["message"];
    let s = |k: &str| m[k].as_str().unwrap().to_owned();
    let message = match m["k"].as_str().unwrap() {
        "texte" => Message::Texte { x: s("x") },
        "piece" => Message::Piece {
            r: graine_de(&m["r"]),
            piece: id16(&m["piece"]),
            palier: m["palier"].as_u64().unwrap() as u32,
            nom: s("nom"),
            mime: s("mime"),
            taille: m["taille"].as_u64().unwrap(),
            sorte: sorte_de(m["sorte"].as_str().unwrap()),
            duree_ms: m["duree_ms"].as_u64().map(|d| d as u32),
        },
        "reaction" => Message::Reaction {
            cible: id16(&m["cible"]),
            emoji: s("emoji"),
        },
        "reponse" => Message::Reponse {
            cible: id16(&m["cible"]),
            x: s("x"),
        },
        "modif" => Message::Modif {
            cible: id16(&m["cible"]),
            x: s("x"),
        },
        "retrait" => Message::Retrait {
            cible: id16(&m["cible"]),
        },
        "ecrit" => Message::Ecrit,
        "recu" => Message::Recu { ids: ids_de(m) },
        "vu" => Message::Vu { ids: ids_de(m) },
        "regle" => Message::Regle {
            regle: regle_de(m["regle"].as_u64().unwrap()),
        },
        "profil" => Message::Profil {
            pseudo: s("pseudo"),
            couleur: m["couleur"].as_u64().unwrap() as u8,
            avatar: m["avatar"].as_object().map(|_| RefPiece {
                r: graine_de(&m["avatar"]["r"]),
                piece: id16(&m["avatar"]["piece"]),
                palier: m["avatar"]["palier"].as_u64().unwrap() as u32,
            }),
        },
        "depart" => Message::Depart,
        "inconnu" => Message::Inconnu { sorte: s("sorte") },
        k => panic!("sorte {k}"),
    };
    Enveloppe {
        id: id16(&v["id"]),
        heure_ms: v["t"].as_u64().unwrap(),
        regle: regle_de(v["e"].as_u64().unwrap()),
        message,
    }
}

/// Inverse de `env_de` (pour écrire ce que le décodeur a lu).
fn env_vers(e: &Enveloppe) -> Value {
    let ids = |v: &[[u8; 16]]| -> Vec<Value> { v.iter().map(|i| hex(i).into()).collect() };
    let message = match &e.message {
        Message::Texte { x } => json!({ "k": "texte", "x": x }),
        Message::Piece {
            r,
            piece,
            palier,
            nom,
            mime,
            taille,
            sorte,
            duree_ms,
        } => json!({ "k": "piece", "r": hex(r.as_bytes()), "piece": hex(piece),
            "palier": palier, "nom": nom, "mime": mime, "taille": taille,
            "sorte": sorte_nom(*sorte), "duree_ms": duree_ms }),
        Message::Reaction { cible, emoji } => {
            json!({ "k": "reaction", "cible": hex(cible), "emoji": emoji })
        }
        Message::Reponse { cible, x } => json!({ "k": "reponse", "cible": hex(cible), "x": x }),
        Message::Modif { cible, x } => json!({ "k": "modif", "cible": hex(cible), "x": x }),
        Message::Retrait { cible } => json!({ "k": "retrait", "cible": hex(cible) }),
        Message::Ecrit => json!({ "k": "ecrit" }),
        Message::Recu { ids: i } => json!({ "k": "recu", "ids": ids(i) }),
        Message::Vu { ids: i } => json!({ "k": "vu", "ids": ids(i) }),
        Message::Regle { regle } => json!({ "k": "regle", "regle": *regle as u8 }),
        Message::Profil {
            pseudo,
            couleur,
            avatar,
        } => json!({ "k": "profil", "pseudo": pseudo, "couleur": couleur,
            "avatar": avatar.as_ref().map(|a| json!({ "r": hex(a.r.as_bytes()),
                "piece": hex(&a.piece), "palier": a.palier })) }),
        Message::Depart => json!({ "k": "depart" }),
        Message::Inconnu { sorte } => json!({ "k": "inconnu", "sorte": sorte }),
    };
    json!({ "id": hex(&e.id), "t": e.heure_ms, "e": e.regle as u8, "message": message })
}

/// Encodage : `{envelope}` → `encoded_hex` (et `len`), ou erreur ; relu par le décodeur, qui
/// doit rendre la même enveloppe.
fn encode_case(c: &Value) -> Value {
    match encoder(&env_de(&c["envelope"])) {
        Ok(b) => {
            assert_eq!(
                env_vers(&decoder(&b).unwrap()),
                c["envelope"],
                "{} : relecture",
                c["label"]
            );
            json!({ "encoded_hex": hex(&b), "len": b.len() })
        }
        Err(e) => err(e),
    }
}

/// Décodage : `{bytes}` → `envelope`, ou erreur.
fn decode_case(c: &Value) -> Value {
    match decoder(&bytes(&c["bytes"])) {
        Ok(e) => json!({ "envelope": env_vers(&e) }),
        Err(e) => err(e),
    }
}

fn enveloppe(label: &str, e: u8, message: Value) -> Value {
    json!({ "id": h(&format!("messages/{label}/id"), 16), "t": 1_700_000_000_000u64,
            "e": e, "message": message })
}

fn messages() -> Value {
    let cible = || h("messages/cible", 16);
    let r = || h("messages/r", 32);
    let piece = |nom: &str, mime: &str, taille: u64, sorte: &str, d: Value, palier: u32| {
        json!({ "k": "piece", "r": r(), "piece": h("messages/piece", 16), "palier": palier,
                "nom": nom, "mime": mime, "taille": taille, "sorte": sorte, "duree_ms": d })
    };
    let ids = |n: usize| -> Vec<String> {
        (0..n)
            .map(|i| h(&format!("messages/ids/{i}"), 16))
            .collect()
    };
    let profil = |pseudo: &str, couleur: u8, avatar: Value| json!({ "k": "profil", "pseudo": pseudo, "couleur": couleur, "avatar": avatar });
    let avatar =
        |palier: u32| json!({ "r": r(), "piece": h("messages/avatar", 16), "palier": palier });
    let texte = |x: &str| json!({ "k": "texte", "x": x });
    let reaction = |emoji: &str| json!({ "k": "reaction", "cible": cible(), "emoji": emoji });
    // Texte dont l'échappement JSON fait exactement `JSON_MAX` (3 900) octets, puis un de plus :
    // les guillemets se doublent (`\"`), le reste non.
    let overhead = encoder(&env_de(&enveloppe("json_max", 0, texte("a"))))
        .unwrap()
        .len()
        - 1;
    let quotes = 1900usize;
    let pad = JSON_MAX - overhead - 2 * quotes;
    let long = |extra: usize| format!("{}{}", "\"".repeat(quotes), "a".repeat(pad + extra));

    let encode_inputs: Vec<(&str, u8, Value)> = vec![
        ("texte_simple", 0, texte("Allo")),
        (
            "texte_unicode",
            1,
            texte("Allo été 😀 한글 \n deuxième ligne"),
        ),
        ("texte_guillemets_et_barre", 2, texte("dit \"salut\" \\ ok")),
        ("texte_json_3900_octets", 3, texte(&long(0))),
        ("texte_json_3901_octets", 3, texte(&long(1))),
        ("texte_2000_guillemets", 0, texte(&"\"".repeat(2000))),
        ("texte_2000_a", 0, texte(&"a".repeat(2000))),
        ("texte_non_nettoye_tabulation", 0, texte("a\tb")),
        ("texte_non_nettoye_nfd", 0, texte("e\u{301}")),
        ("texte_vide", 0, texte("")),
        ("texte_2001_graphemes", 0, texte(&"a".repeat(2001))),
        (
            "piece_image",
            0,
            piece("photo.png", "image/png", 123_456, "image", Value::Null, 16),
        ),
        (
            "piece_vocal_duree",
            1,
            piece("vocal.webm", "audio/webm", 9_000, "vocal", json!(12_345), 1),
        ),
        (
            "piece_taille_max_sure",
            0,
            piece(
                "a.bin",
                "application/octet-stream",
                MAX_SAFE,
                "fichier",
                Value::Null,
                8000,
            ),
        ),
        (
            "piece_taille_trop_grande",
            0,
            piece("a.bin", "a/b", MAX_SAFE + 1, "fichier", Value::Null, 16),
        ),
        (
            "piece_palier_inconnu",
            0,
            piece("a.bin", "a/b", 1, "fichier", Value::Null, 17),
        ),
        (
            "piece_mime_avec_espace",
            0,
            piece("a.bin", "text/plain; x", 1, "video", Value::Null, 16),
        ),
        (
            "piece_nom_non_nettoye",
            0,
            piece("dossier/a.bin", "a/b", 1, "fichier", Value::Null, 16),
        ),
        ("reaction_pouce", 0, reaction("👍")),
        ("reaction_pouce_peau", 0, reaction("👍🏽")),
        (
            "reaction_drapeau_ecosse",
            0,
            reaction("🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}"),
        ),
        (
            "reaction_famille_zwj",
            0,
            reaction("👨\u{200D}👩\u{200D}👧"),
        ),
        ("reaction_lettre", 0, reaction("a")),
        ("reaction_deux_emojis", 0, reaction("👍👍")),
        ("reaction_non_qualifie", 0, reaction("❤")),
        ("reaction_17_pouces", 0, reaction(&"👍".repeat(17))),
        ("reaction_vide", 0, reaction("")),
        (
            "reponse",
            2,
            json!({ "k": "reponse", "cible": cible(), "x": "d'accord" }),
        ),
        (
            "modif",
            0,
            json!({ "k": "modif", "cible": cible(), "x": "corrigé" }),
        ),
        ("retrait", 0, json!({ "k": "retrait", "cible": cible() })),
        ("ecrit", 0, json!({ "k": "ecrit" })),
        ("recu_1_id", 0, json!({ "k": "recu", "ids": ids(1) })),
        ("vu_50_ids", 0, json!({ "k": "vu", "ids": ids(50) })),
        ("vu_51_ids", 0, json!({ "k": "vu", "ids": ids(51) })),
        (
            "recu_0_id",
            0,
            json!({ "k": "recu", "ids": Vec::<String>::new() }),
        ),
        ("regle_une_heure", 0, json!({ "k": "regle", "regle": 3 })),
        ("profil_sans_avatar", 0, profil("Alice", 0, Value::Null)),
        ("profil_avec_avatar", 0, profil("Zoé_77", 9, avatar(16))),
        ("profil_couleur_10", 0, profil("Alice", 10, Value::Null)),
        ("profil_pseudo_trop_court", 0, profil("A", 0, Value::Null)),
        (
            "profil_pseudo_non_nettoye",
            0,
            profil(" Alice", 0, Value::Null),
        ),
        (
            "profil_avatar_palier_inconnu",
            0,
            profil("Alice", 0, avatar(2)),
        ),
        ("depart", 0, json!({ "k": "depart" })),
    ];
    let mut encode: Vec<Value> = encode_inputs
        .into_iter()
        .map(|(label, e, m)| {
            let mut c = json!({ "label": label, "envelope": enveloppe(label, e, m) });
            let x = encode_case(&c);
            merge(&mut c, x);
            c
        })
        .collect();
    // Heure : borne sûre (2^53 − 1) acceptée, au-delà refusée.
    for (label, t) in [
        ("heure_max_sure", MAX_SAFE),
        ("heure_trop_grande", MAX_SAFE + 1),
    ] {
        let mut env = enveloppe(label, 0, json!({ "k": "ecrit" }));
        env["t"] = t.into();
        let mut c = json!({ "label": label, "envelope": env });
        let x = encode_case(&c);
        merge(&mut c, x);
        encode.push(c);
    }

    // Décodage : octets écrits à la main (JSON exact du format).
    let id = b64u(&stream("messages/decode/id", 16));
    let id2 = b64u(&stream("messages/decode/id2", 16));
    let seed = b64u(&stream("messages/decode/r", 32));
    let head =
        |k: &str| format!("{{\"v\":3,\"id\":\"{id}\",\"t\":1700000000000,\"e\":0,\"k\":\"{k}\"");
    let dec: Vec<(&str, Value)> = vec![
        (
            "texte",
            json!({ "utf8": format!("{},\"x\":\"Allo\"}}", head("texte")) }),
        ),
        (
            "texte_ordre_des_cles_libre",
            json!({ "utf8": format!("{{\"x\":\"Allo\",\"k\":\"texte\",\"e\":2,\"t\":5,\"id\":\"{id}\",\"v\":3}}") }),
        ),
        (
            "texte_avec_espaces_json",
            json!({ "utf8": format!("{{ \"v\" : 3 , \"id\" : \"{id}\" , \"t\" : 1 , \"e\" : 0 , \"k\" : \"texte\" , \"x\" : \"a\" }}") }),
        ),
        (
            "sorte_inconnue",
            json!({ "utf8": format!("{},\"z\":1}}", head("appel_v2")) }),
        ),
        (
            "sorte_inconnue_majuscule",
            json!({ "utf8": format!("{}}}", head("Appel")) }),
        ),
        (
            "sorte_inconnue_33_caracteres",
            json!({ "utf8": format!("{}}}", head(&"a".repeat(33))) }),
        ),
        (
            "sorte_inconnue_32_caracteres",
            json!({ "utf8": format!("{}}}", head(&"a".repeat(32))) }),
        ),
        ("sorte_vide", json!({ "utf8": format!("{}}}", head("")) })),
        (
            "champ_en_trop",
            json!({ "utf8": format!("{},\"x\":\"a\",\"y\":1}}", head("texte")) }),
        ),
        (
            "champ_manquant",
            json!({ "utf8": format!("{}}}", head("texte")) }),
        ),
        (
            "cle_repetee",
            json!({ "utf8": format!("{},\"x\":\"a\",\"x\":\"b\"}}", head("texte")) }),
        ),
        (
            "cle_repetee_dans_avatar",
            json!({ "utf8": format!("{},\"pseudo\":\"Alice\",\"couleur\":1,\"avatar\":{{\"r\":\"{seed}\",\"r\":\"{seed}\",\"piece\":\"{id2}\",\"palier\":16}}}}", head("profil")) }),
        ),
        (
            "version_2",
            json!({ "utf8": format!("{{\"v\":2,\"id\":\"{id}\",\"t\":1,\"e\":0,\"k\":\"ecrit\"}}") }),
        ),
        (
            "regle_4",
            json!({ "utf8": format!("{{\"v\":3,\"id\":\"{id}\",\"t\":1,\"e\":4,\"k\":\"ecrit\"}}") }),
        ),
        (
            "heure_decimale",
            json!({ "utf8": format!("{{\"v\":3,\"id\":\"{id}\",\"t\":1.5,\"e\":0,\"k\":\"ecrit\"}}") }),
        ),
        (
            "heure_negative",
            json!({ "utf8": format!("{{\"v\":3,\"id\":\"{id}\",\"t\":-1,\"e\":0,\"k\":\"ecrit\"}}") }),
        ),
        (
            "heure_2_puissance_53",
            json!({ "utf8": format!("{{\"v\":3,\"id\":\"{id}\",\"t\":9007199254740992,\"e\":0,\"k\":\"ecrit\"}}") }),
        ),
        (
            "id_trop_court",
            json!({ "utf8": "{\"v\":3,\"id\":\"AAAA\",\"t\":1,\"e\":0,\"k\":\"ecrit\"}" }),
        ),
        (
            "texte_avec_tabulation",
            json!({ "utf8": format!("{},\"x\":\"a\\tb\"}}", head("texte")) }),
        ),
        (
            "texte_vide",
            json!({ "utf8": format!("{},\"x\":\"\"}}", head("texte")) }),
        ),
        ("pas_un_objet", json!({ "utf8": "[]" })),
        ("null", json!({ "utf8": "null" })),
        ("vide", json!({ "hex": "" })),
        ("accolade_seule", json!({ "utf8": "{" })),
        (
            "texte_apres_l_objet",
            json!({ "utf8": format!("{},\"x\":\"a\"}} ", head("texte")) }),
        ),
        (
            "texte_apres_l_objet_octet_parasite",
            json!({ "utf8": format!("{},\"x\":\"a\"}}x", head("texte")) }),
        ),
        (
            "utf8_invalide",
            json!({ "hex": hex(format!("{},\"x\":\"", head("texte")).as_bytes()) + "ff2273" + "7d" }),
        ),
        (
            "recu_ids_vide",
            json!({ "utf8": format!("{},\"ids\":[]}}", head("recu")) }),
        ),
        (
            "vu_un_id",
            json!({ "utf8": format!("{},\"ids\":[\"{id2}\"]}}", head("vu")) }),
        ),
        (
            "piece_valide",
            json!({ "utf8": format!("{},\"r\":\"{seed}\",\"piece\":\"{id2}\",\"palier\":16,\"nom\":\"a.png\",\"mime\":\"image/png\",\"taille\":5,\"sorte\":\"image\",\"duree_ms\":null}}", head("piece")) }),
        ),
        (
            "piece_sorte_inconnue",
            json!({ "utf8": format!("{},\"r\":\"{seed}\",\"piece\":\"{id2}\",\"palier\":16,\"nom\":\"a.png\",\"mime\":\"image/png\",\"taille\":5,\"sorte\":\"gif\",\"duree_ms\":null}}", head("piece")) }),
        ),
        (
            "piece_graine_courte",
            json!({ "utf8": format!("{},\"r\":\"{id2}\",\"piece\":\"{id2}\",\"palier\":16,\"nom\":\"a.png\",\"mime\":\"image/png\",\"taille\":5,\"sorte\":\"image\",\"duree_ms\":null}}", head("piece")) }),
        ),
        (
            "profil_avatar_null",
            json!({ "utf8": format!("{},\"pseudo\":\"Alice\",\"couleur\":3,\"avatar\":null}}", head("profil")) }),
        ),
        (
            "profil_pseudo_avec_espace_de_bord",
            json!({ "utf8": format!("{},\"pseudo\":\" Alice\",\"couleur\":3,\"avatar\":null}}", head("profil")) }),
        ),
        (
            "reaction_emoji_invalide",
            json!({ "utf8": format!("{},\"cible\":\"{id2}\",\"emoji\":\"ab\"}}", head("reaction")) }),
        ),
        (
            "charge_4093_espaces",
            json!({ "repeat": { "unit": hex(b" "), "n": MAX_CHARGE } }),
        ),
        (
            "plus_de_4093_octets",
            json!({ "repeat": { "unit": hex(b" "), "n": MAX_CHARGE + 1 } }),
        ),
    ];
    let decode: Vec<Value> = dec
        .into_iter()
        .map(|(label, b)| {
            let mut c = json!({ "label": label, "bytes": b });
            let x = decode_case(&c);
            merge(&mut c, x);
            c
        })
        .collect();
    json!({ "encode": encode, "decode": decode })
}

// --------------------------------------------------------------------------- texte, pseudo

fn texte_case(c: &Value) -> Value {
    let s = String::from_utf8(bytes(&c["in"])).expect("entrée UTF-8");
    match nettoyer_texte(&s) {
        Ok(o) => texte_out(&o),
        Err(e) => err(e),
    }
}

fn tags(s: &str) -> String {
    s.chars()
        .map(|c| char::from_u32(0xE0000 + c as u32).unwrap())
        .collect()
}

fn texte() -> Value {
    let ecosse = format!("🏴{}\u{E007F}", tags("gbsct"));
    let angleterre = format!("🏴{}\u{E007F}", tags("gbeng"));
    let galles = format!("🏴{}\u{E007F}", tags("gbwls"));
    let utf8 = |s: &str| json!({ "hex": hex(s.as_bytes()) });
    let cases: Vec<(&str, Value)> = vec![
        ("simple", utf8("Allo")),
        ("nfc_e_accent_combinant", utf8("e\u{301}")),
        ("nfc_hangul_decompose", utf8("\u{1112}\u{1161}\u{11ab}")),
        ("retrait_u202e", utf8("a\u{202E}b")),
        (
            "retrait_inversions_de_sens",
            utf8("\u{202A}a\u{202B}b\u{202C}c\u{202D}d\u{2066}e\u{2067}f\u{2068}g\u{2069}h"),
        ),
        ("garde_lrm_rlm", utf8("a\u{200E}b\u{200F}")),
        ("garde_zwj_et_zwsp", utf8("a\u{200B}b\u{200D}c")),
        ("garde_saut_de_ligne", utf8("a\nb")),
        ("retrait_tabulation_et_retour_chariot", utf8("a\tb\rc")),
        ("retrait_nul_del_c1", utf8("a\u{0}b\u{7f}c\u{85}d")),
        ("controle_entre_lettre_et_accent", utf8("e\u{0}\u{301}")),
        (
            "etiquette_entre_lettre_et_accent",
            utf8("e\u{E0001}\u{301}"),
        ),
        (
            "etiquettes_cachees_retirees",
            utf8(&format!("salut{}\u{E007F}", tags("hi"))),
        ),
        ("seulement_etiquettes", utf8("\u{E0001}\u{E0041}")),
        ("drapeau_ecosse_garde", utf8(&format!("a{ecosse}b"))),
        ("drapeau_angleterre_garde", utf8(&angleterre)),
        ("drapeau_pays_de_galles_garde", utf8(&galles)),
        (
            "drapeau_invente_etiquettes_retirees",
            utf8(&format!("🏴{}\u{E007F}", tags("hello"))),
        ),
        (
            "drapeau_inconnu_gbxxx",
            utf8(&format!("x🏴{}\u{E007F}y", tags("gbxxx"))),
        ),
        ("drapeau_non_termine", utf8(&format!("🏴{}", tags("gbsct")))),
        (
            "etiquettes_apres_drapeau_valide",
            utf8(&format!("{ecosse}{}", tags("hi"))),
        ),
        (
            "etiquettes_sans_drapeau_noir",
            utf8(&format!("a{}\u{E007F}", tags("gbsct"))),
        ),
        ("famille_zwj", utf8("👨\u{200D}👩\u{200D}👧")),
        ("vide", utf8("")),
        ("seulement_controles", utf8("\t\r\u{0}\u{202E}")),
        ("seulement_espaces", utf8("   ")),
        ("seulement_saut_de_ligne", utf8("\n")),
        ("seulement_espaces_insecables", utf8("\u{A0}\u{3000}")),
        ("seulement_zwsp", utf8("\u{200B}")),
        ("seulement_lrm_rlm", utf8("\u{200E}\u{200F}")),
        ("seulement_zwj_et_vs16", utf8("\u{200D}\u{FE0F}")),
        ("seulement_marque_combinante", utf8("\u{301}")),
        (
            "seulement_marques_combinantes",
            utf8("\u{301}\u{302}\u{20DD}"),
        ),
        ("seulement_braille_vide", utf8("\u{2800}")),
        ("braille_vide_et_espaces", utf8("\u{2800}\u{2800} \n")),
        ("marque_sur_espace", utf8(" \u{301}")),
        ("marque_sur_espace_insecable", utf8("\u{A0}\u{20E3}")),
        (
            "braille_vide_marque_et_zwsp",
            utf8("\u{2800}\u{301}\u{200B}"),
        ),
        ("braille_vide_et_lettre_gardes", utf8("a\u{2800}")),
        ("marque_puis_lettre_gardees", utf8("\u{301}x")),
        ("keycap_garde", utf8("1\u{20E3}")),
        ("seulement_teinte_de_peau", utf8("\u{1F3FB}")),
        (
            "teinte_de_peau_sur_emoji_gardee",
            utf8("\u{1F44B}\u{1F3FB}"),
        ),
        ("seulement_signe_voyelle_devanagari", utf8("\u{093F}")),
        ("espaces_et_lettre_gardes", utf8(" a ")),
        ("zwsp_et_lettre_gardes", utf8("\u{200B}a")),
        ("graphemes_2000_a", repeat("a", 2000)),
        ("graphemes_2001_a", repeat("a", 2001)),
        (
            "graphemes_1166_a_barre_3498_octets",
            json!({ "repeat": { "unit": hex("a\u{334}".as_bytes()), "n": 1166 } }),
        ),
        (
            "graphemes_1167_a_barre_3501_octets",
            json!({ "repeat": { "unit": hex("a\u{334}".as_bytes()), "n": 1167 } }),
        ),
        (
            "nfc_1000_e_accent_combinant_donne_1000_graphemes",
            json!({ "repeat": { "unit": hex("e\u{301}".as_bytes()), "n": 1000 } }),
        ),
        ("octets_3500_e_aigu", repeat("é", 1750)),
        (
            "octets_3501",
            json!({ "repeat": { "unit": hex("é".as_bytes()), "n": 1750, "then": hex(b"a") } }),
        ),
        ("emoji_2000_donne_8000_octets", repeat("😀", 2000)),
        ("emoji_875_donne_3500_octets", repeat("😀", 875)),
        ("emoji_876_donne_3504_octets", repeat("😀", 876)),
        ("drapeaux_regionaux_1000", repeat("🇫🇷", 1000)),
    ];
    cases
        .into_iter()
        .map(|(label, spec)| {
            let mut c = json!({ "label": label, "in": spec });
            let x = texte_case(&c);
            merge(&mut c, x);
            c
        })
        .collect()
}

fn pseudo_case(c: &Value) -> Value {
    let s = String::from_utf8(bytes(&c["in"])).expect("entrée UTF-8");
    match verifier_pseudo(&s) {
        Ok(o) => {
            let mut v = texte_out(&o);
            v["key_hex"] = hex(cle_unicite(&o).as_bytes()).into();
            v
        }
        Err(e) => err(e),
    }
}

fn pseudo() -> Value {
    let utf8 = |s: &str| json!({ "hex": hex(s.as_bytes()) });
    // (étiquette, groupe de même clé d'unicité, entrée)
    let cases: Vec<(&str, &str, Value)> = vec![
        ("simple", "", utf8("Bobby")),
        ("deux_lettres", "", utf8("Al")),
        ("une_lettre_refusee", "", utf8("A")),
        ("vide", "", utf8("")),
        ("24_graphemes", "", repeat("a", 24)),
        ("25_graphemes_refuse", "", repeat("a", 25)),
        (
            "24_graphemes_avec_marques",
            "",
            json!({ "repeat": { "unit": hex("e\u{301}".as_bytes()), "n": 24 } }),
        ),
        ("entree_brute_4097_octets_refusee", "", repeat("a", 4097)),
        (
            "apostrophe_typographique",
            "apostrophe",
            utf8("L\u{2019}ami"),
        ),
        ("apostrophe_droite", "apostrophe", utf8("L'ami")),
        ("retrait_u202e", "", utf8("ab\u{202E}c")),
        ("retrait_zero_width", "", utf8("a\u{200B}b\u{FEFF}c")),
        ("retrait_controle", "", utf8("a\u{0}b")),
        (
            "espaces_regroupees_et_rognees",
            "",
            utf8("  x \u{A0}\u{2003} yz  "),
        ),
        ("espace_seule_refusee", "", utf8("   ")),
        ("marque_sur_espace_refusee", "", utf8("a \u{301}b")),
        ("marque_sur_tiret_refusee", "", utf8("a-\u{301}b")),
        ("marque_sur_lettre", "", utf8("a\u{301}b")),
        (
            "neuf_points_par_grapheme_refuse",
            "",
            utf8(&format!("a{}b", "\u{334}".repeat(8))),
        ),
        (
            "huit_points_par_grapheme",
            "",
            utf8(&format!("a{}b", "\u{334}".repeat(7))),
        ),
        ("chiffres_seuls", "", utf8("12")),
        ("ponctuation_sans_lettre_refusee", "", utf8("-_")),
        ("ponctuation_permise", "", utf8("a-b_c.d'e")),
        ("ponctuation_interdite", "", utf8("a@b")),
        ("emoji_refuse", "", utf8("Al😀")),
        ("chiffre_entoure_refuse", "", utf8("a\u{2460}")),
        ("drapeau_refuse", "", utf8("a🇫🇷")),
        ("cyrillique_seul", "", utf8("Алиса")),
        ("grec_seul", "", utf8("Αλφα")),
        ("latin_et_grec_refuse", "", utf8("Αlice")),
        ("latin_et_cyrillique_refuse", "", utf8("Аlice")),
        ("cyrillique_sosie_d_alice", "alice", utf8("Аӏісе")),
        ("alice_latin", "alice", utf8("Alice")),
        ("alice_espaces_et_majuscules", "alice", utf8("a L i-c_e")),
        ("alice_pleine_chasse", "alice", utf8("Ａｌｉｃｅ")),
        ("lea_avec_accent", "", utf8("Léa")),
        ("lea_sans_accent", "", utf8("Lea")),
        ("zero_et_o", "zero", utf8("l0l")),
        ("o_et_zero", "zero", utf8("lol")),
        ("un_et_l_un_au_milieu", "un", utf8("l1l")),
        ("un_et_l_un_en_tete", "un", utf8("1ll")),
        ("han_et_hiragana", "", utf8("日本ひらがな")),
        ("han_et_katakana", "", utf8("日本カタカナ")),
        ("han_et_hangul", "", utf8("한글漢字")),
        ("han_et_bopomofo", "", utf8("漢ㄅㄆ")),
        ("hangul_et_latin_refuse", "", utf8("한글abc")),
        ("hiragana_et_latin_refuse", "", utf8("ひらabc")),
        ("arabe", "", utf8("مرحبا")),
        ("hebreu_et_latin_refuse", "", utf8("שלוםabc")),
        ("devanagari_avec_voyelle", "", utf8("नमस्ते")),
        (
            "hangul_decompose_normalise",
            "hangul",
            utf8("\u{1112}\u{1161}\u{11ab}\u{1100}\u{1173}\u{11af}"),
        ),
        ("hangul_compose", "hangul", utf8("한글")),
        (
            "tags_caches_retires",
            "alice",
            utf8(&format!("Al{}ice", tags("x"))),
        ),
    ];
    let out: Vec<Value> = cases
        .into_iter()
        .map(|(label, group, spec)| {
            let mut c = json!({ "label": label, "in": spec });
            if !group.is_empty() {
                c["same_key_as"] = group.into();
            }
            let x = pseudo_case(&c);
            merge(&mut c, x);
            c
        })
        .collect();
    // Même groupe ou même sortie, même clé ; sinon clés distinctes.
    for a in &out {
        for b in &out {
            if a["key_hex"].is_string() && b["key_hex"].is_string() && a["label"] != b["label"] {
                let same = (a.get("same_key_as").is_some() && a["same_key_as"] == b["same_key_as"])
                    || a["out_hex"] == b["out_hex"];
                assert_eq!(
                    a["key_hex"] == b["key_hex"],
                    same,
                    "{} / {}",
                    a["label"],
                    b["label"]
                );
            }
        }
    }
    out.into()
}

// ----------------------------------------------------------------------------- effacement

fn etat_case(c: &Value) -> Value {
    let e = etat(
        regle_de(c["regle"].as_u64().unwrap()),
        c["maintenant_ms"].as_u64().unwrap(),
        c["vu_par_moi_ms"].as_u64(),
        c["efface_par_serveur"].as_bool().unwrap(),
    );
    match e {
        Etat::Visible => json!({ "etat": "visible" }),
        Etat::Rebours { fin_ms } => json!({ "etat": "rebours", "fin_ms": fin_ms }),
        Etat::Efface => json!({ "etat": "efface" }),
    }
}

/// Règle du 13 novembre : règle 0 jusqu'à la fin ou au renouvellement ; règles 1 à 3, effacées
/// par le seul `0x0E` du serveur (1 min, 5 min, 1 h après la dernière lecture), avec un compte à
/// rebours local depuis l'instant où cet appareil a vu le message.
fn effacement() -> Value {
    const MAX: u64 = u64::MAX;
    // (étiquette, règle, maintenant, vu par moi, 0x0E reçu)
    #[allow(clippy::type_complexity)]
    let mut named: Vec<(String, u8, u64, Option<u64>, bool)> = vec![
        ("desactive_visible".into(), 0, MAX, Some(1), false),
        ("desactive_0x0e_ignore".into(), 0, MAX, Some(1), true),
        ("desactive_non_vu".into(), 0, 0, None, false),
    ];
    for (nom, regle, d) in [
        ("une_minute", 1u8, 60_000u64),
        ("cinq_minutes", 2, 300_000),
        ("une_heure", 3, 3_600_000),
    ] {
        let vu = 5_000u64;
        let fin = vu + d;
        for (cas, now, v, e) in [
            ("non_vu_visible", 86_400_000, None, false),
            ("non_vu_0x0e_efface", 0, None, true),
            ("vu_rebours", vu, Some(vu), false),
            ("vu_veille_de_l_echeance_locale", fin - 1, Some(vu), false),
            ("echeance_locale_sans_0x0e_visible", fin, Some(vu), false),
            (
                "apres_echeance_locale_sans_0x0e_visible",
                fin + 1,
                Some(vu),
                false,
            ),
            (
                "un_jour_plus_tard_sans_0x0e_visible",
                vu + 86_400_000,
                Some(vu),
                false,
            ),
            ("vu_puis_0x0e_efface", vu + 1, Some(vu), true),
            ("saturation_rebours", MAX - 1, Some(MAX - 10), false),
            ("saturation_echeance", MAX, Some(MAX - 10), false),
        ] {
            named.push((format!("{nom}_{cas}"), regle, now, v, e));
        }
    }
    let mut out: Vec<Value> = named
        .into_iter()
        .map(|(label, regle, now, vu, e)| {
            json!({ "label": label, "regle": regle, "maintenant_ms": now,
                    "vu_par_moi_ms": vu, "efface_par_serveur": e })
        })
        .collect();
    // Grille complète : vu à 2 000 ou non, 0x0E ou non, maintenant à 3 000 puis à 70 000 (après
    // 1 minute, avant 5 minutes) puis à 3 700 000 (après 1 heure).
    for regle in 0..4u8 {
        for vu in [None, Some(2_000u64)] {
            for e in [false, true] {
                for now in [3_000u64, 70_000, 3_700_000] {
                    out.push(json!({
                        "label": format!("grille_r{regle}_vu{}_0x0e{}_t{now}",
                            u8::from(vu.is_some()), u8::from(e)),
                        "regle": regle, "maintenant_ms": now,
                        "vu_par_moi_ms": vu, "efface_par_serveur": e }));
                }
            }
        }
    }
    out.into_iter()
        .map(|mut c| {
            let x = etat_case(&c);
            merge(&mut c, x);
            c
        })
        .collect()
}

// ------------------------------------------------------------------------------ empreinte

fn empreinte_case(c: &Value) -> Value {
    let k: [u8; 32] = unhex(c["public_key"].as_str().unwrap()).try_into().unwrap();
    json!({ "code": code_verification(&k) })
}

fn empreinte() -> Value {
    let mut keys: Vec<(String, String)> = vec![
        ("zeros".into(), "00".repeat(32)),
        ("ff".into(), "ff".repeat(32)),
        ("seq".into(), hex(&(0u8..32).collect::<Vec<_>>())),
        ("hasard_1".into(), h("empreinte/1", 32)),
        ("hasard_2".into(), h("empreinte/2", 32)),
    ];
    // Premières clés dérivées dont un groupe commence par un zéro (bourrage à 5 chiffres) et
    // dont un groupe est plus petit que 1 000.
    let (mut avec_zero, mut i) = (0, 0u32);
    while avec_zero < 2 {
        let k = h(&format!("empreinte/zero/{i}"), 32);
        let code = code_verification(&unhex(&k).try_into().unwrap());
        if code.split(' ').any(|g| g.starts_with('0')) {
            keys.push((format!("groupe_a_zero_{avec_zero}"), k));
            avec_zero += 1;
        }
        i += 1;
    }
    keys.into_iter()
        .map(|(label, k)| {
            let mut c = json!({ "label": label, "public_key": k });
            let x = empreinte_case(&c);
            merge(&mut c, x);
            assert_eq!(c["code"].as_str().unwrap().len(), 23);
            c
        })
        .collect()
}

// ---------------------------------------------------------------------------------- fichier

fn unicode() -> Value {
    json!({
        "unicode_normalization": [
            unicode_normalization::UNICODE_VERSION.0,
            unicode_normalization::UNICODE_VERSION.1,
            unicode_normalization::UNICODE_VERSION.2,
        ],
        "unicode_segmentation": [
            unicode_segmentation::UNICODE_VERSION.0,
            unicode_segmentation::UNICODE_VERSION.1,
            unicode_segmentation::UNICODE_VERSION.2,
        ],
        "unicode_script": [
            unicode_script::UNICODE_VERSION.0,
            unicode_script::UNICODE_VERSION.1,
            unicode_script::UNICODE_VERSION.2,
        ],
        "unicode_security": [
            unicode_security::UNICODE_VERSION.0,
            unicode_security::UNICODE_VERSION.1,
            unicode_security::UNICODE_VERSION.2,
        ],
        "emoji_test": "15.0",
        "hand_tables": "15.1",
        "rust_std_char": [
            char::UNICODE_VERSION.0,
            char::UNICODE_VERSION.1,
            char::UNICODE_VERSION.2,
        ],
    })
}

fn constants() -> Value {
    json!({
        "TAILLE_TRAME": TAILLE_TRAME, "TAILLE_O": TAILLE_O, "MAX_CHARGE": MAX_CHARGE,
        "JSON_MAX": JSON_MAX, "VERSION": 3, "TEXTE_GRAPHEMES": 2000, "TEXTE_OCTETS": 3500,
        "PSEUDO_GRAPHEMES": [2, 24], "MAX_SAFE": MAX_SAFE,
        "unicode": unicode(),
    })
}

fn build() -> Value {
    json!({
        "about": "Vecteurs communs du salon (format v3), produits par le moteur Rust (engine/salon/tests/vecteurs.rs) ; voir engine/vectors/README.md.",
        "constants": constants(),
        "cles": cles(),
        "trames": trames(),
        "messages": messages(),
        "texte": texte(),
        "pseudo": pseudo(),
        "effacement": effacement(),
        "empreinte": empreinte(),
    })
}

fn text(v: &Value) -> String {
    let mut s = serde_json::to_string_pretty(v).unwrap();
    s.push('\n');
    s
}

/// Rejoue chaque cas du fichier à partir de ses seules entrées.
fn replay_file(v: &Value) {
    let lines = |v: &Value| v.as_array().unwrap().clone();
    assert_eq!(
        v["constants"],
        constants(),
        "constantes et versions d'Unicode"
    );
    for c in lines(&v["cles"]) {
        assert_eq!(
            cles_case(&c),
            outputs(
                &c,
                &[
                    "k_acces", "v_acces", "k_preuve", "v_preuve", "k_trame", "tag"
                ]
            ),
            "{}",
            c["label"]
        );
    }
    let t = &v["trames"];
    for c in lines(&t["seal"]) {
        assert_eq!(
            trame_case(&c),
            outputs(&c, &["seal", "read_header", "open"]),
            "{}",
            c["label"]
        );
    }
    for c in lines(&t["reject"]) {
        let from = lines(&t["seal"])
            .into_iter()
            .find(|s| s["label"] == c["from"])
            .unwrap();
        let base = unhex(from["seal"]["trame_hex"].as_str().unwrap());
        assert_eq!(
            refus_case(&c, &base),
            outputs(&c, &["read_header", "open"]),
            "{}",
            c["label"]
        );
    }
    for c in lines(&t["coherence"]) {
        assert_eq!(
            coherence_case(&c),
            outputs(&c, &["ok", "error"]),
            "{}",
            c["label"]
        );
    }
    let m = &v["messages"];
    for c in lines(&m["encode"]) {
        assert_eq!(
            encode_case(&c),
            outputs(&c, &["encoded_hex", "len", "error"]),
            "{}",
            c["label"]
        );
    }
    for c in lines(&m["decode"]) {
        assert_eq!(
            decode_case(&c),
            outputs(&c, &["envelope", "error"]),
            "{}",
            c["label"]
        );
    }
    let sortie_texte = ["out_hex", "out_len", "out_sha256", "error"];
    for c in lines(&v["texte"]) {
        assert_eq!(texte_case(&c), outputs(&c, &sortie_texte), "{}", c["label"]);
    }
    let sortie_pseudo = ["out_hex", "out_len", "out_sha256", "key_hex", "error"];
    for c in lines(&v["pseudo"]) {
        assert_eq!(
            pseudo_case(&c),
            outputs(&c, &sortie_pseudo),
            "{}",
            c["label"]
        );
    }
    for c in lines(&v["effacement"]) {
        assert_eq!(
            etat_case(&c),
            outputs(&c, &["etat", "fin_ms"]),
            "{}",
            c["label"]
        );
    }
    for c in lines(&v["empreinte"]) {
        assert_eq!(empreinte_case(&c), outputs(&c, &["code"]), "{}", c["label"]);
    }
}

#[test]
fn salon_v3() {
    let built = build();
    if std::env::var_os("SHH_GEN_SALON").is_some() {
        std::fs::write(FILE, text(&built)).unwrap();
    }
    let raw = std::fs::read_to_string(FILE).expect("engine/vectors/salon-v3.json");
    let file: Value = serde_json::from_str(&raw).unwrap();
    // Fichier à jour, octet pour octet (JSON à clés triées, 2 espaces, LF final).
    assert_eq!(
        raw,
        text(&built),
        "salon-v3.json n'est plus celui du moteur"
    );
    replay_file(&file);
    // Couverture attendue.
    let by = |section: &Value, label: &str| -> Value {
        section
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["label"] == label)
            .unwrap_or_else(|| panic!("cas {label}"))
            .clone()
    };
    // Effacement (13 novembre) : jamais effacé sans 0x0E pour les règles 1 à 3, même longtemps
    // après le délai local ; règle 0 jamais effacée par cette fonction.
    let ef = &file["effacement"];
    for n in ["une_minute", "cinq_minutes", "une_heure"] {
        for (cas, attendu) in [
            ("echeance_locale_sans_0x0e_visible", "visible"),
            ("un_jour_plus_tard_sans_0x0e_visible", "visible"),
            ("vu_veille_de_l_echeance_locale", "rebours"),
            ("vu_puis_0x0e_efface", "efface"),
        ] {
            assert_eq!(by(ef, &format!("{n}_{cas}"))["etat"], attendu, "{n}_{cas}");
        }
    }
    assert_eq!(by(ef, "desactive_0x0e_ignore")["etat"], "visible");
    assert_eq!(
        by(ef, "une_minute_vu_veille_de_l_echeance_locale")["fin_ms"],
        65_000
    );
    assert_eq!(
        by(ef, "cinq_minutes_vu_veille_de_l_echeance_locale")["fin_ms"],
        305_000
    );
    assert_eq!(
        by(ef, "une_heure_vu_veille_de_l_echeance_locale")["fin_ms"],
        3_605_000
    );
    let m = &file["messages"];
    assert_eq!(by(&m["encode"], "texte_json_3900_octets")["len"], JSON_MAX);
    assert_eq!(
        by(&m["encode"], "texte_json_3901_octets")["error"],
        "trop_grand"
    );
    assert_eq!(
        by(&m["encode"], "texte_2000_guillemets")["error"],
        "trop_grand"
    );
    assert_eq!(
        by(&file["texte"], "graphemes_2001_a")["error"],
        "texte_trop_long"
    );
    assert!(by(&file["texte"], "graphemes_2000_a")["error"].is_null());
    assert_eq!(
        by(&file["texte"], "octets_3501")["error"],
        "texte_trop_long"
    );
    assert_eq!(
        by(&file["pseudo"], "marque_sur_espace_refusee")["error"],
        "pseudo_invalide"
    );
    assert_eq!(
        by(&file["pseudo"], "cyrillique_sosie_d_alice")["key_hex"],
        by(&file["pseudo"], "alice_latin")["key_hex"]
    );
    assert_eq!(
        by(&file["trames"]["seal"], "charge_4094_octets_refusee")["seal"]["error"],
        "trop_grand"
    );
    assert!(
        file["trames"]["reject"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["open"]["error"] == "trame_corrompue")
    );
    // Les huit en-têtes font l'aller-retour ; cohérence : un seul en-tête par contenu connu.
    let seal = &file["trames"]["seal"];
    for r in 0..4 {
        for v in [false, true] {
            let c = by(seal, &format!("regle_{r}_volatile_{v}"));
            assert_eq!(c["read_header"], c["en_tete"]);
            assert_eq!(c["open"]["regle"], r);
        }
    }
    let coh = file["trames"]["coherence"].as_array().unwrap();
    assert_eq!(coh.len(), 48);
    let ok = |prefixe: &str| {
        coh.iter()
            .filter(|c| c["label"].as_str().unwrap().starts_with(prefixe) && c["ok"] == true)
            .count()
    };
    for p in ["controle_", "texte_e0_", "texte_e3_", "ecrit_e1_", "vu_e2_"] {
        assert_eq!(ok(p), 1, "{p}");
    }
    assert_eq!(ok("inconnu_e2_"), 2);
    assert!(
        coh.iter()
            .all(|c| c["ok"] == true || c["error"] == "message_invalide")
    );
    assert_eq!(
        by(
            &file["trames"]["coherence"],
            "controle_volatile_false_regle_0"
        )["ok"],
        true
    );
}
