// Compte v2 (conception 2026-11-14-compte-email-design.md §5.1, §6, §21.2.2, §21.5) :
// normalisation de l'adresse, sel, Argon2id et dérivations, clés des deux coffres et de
// l'appareil, pseudo, mot de passe. Vecteurs communs : engine/vectors/compte.json.
//
// Le fichier a deux auteurs :
//   - ce test écrit les sections du moteur (`constants`, `normaliser`, `sel`, `deriver`, `cles`,
//     `pseudo`, `mot_de_passe`) : SHH_GEN_COMPTE=1 cargo test -p shhdrop-core --test compte ;
//   - web/scripts/gen-compte-vectors.mjs écrit, avec WebCrypto et des nonces fixés, les sections
//     `enveloppes`, `coffre_prive` et `coffre_profil` (ce que le site chiffre lui-même).
// Sans la variable, le test échoue si les sections du moteur ne sont plus exactement celles qu'il
// produit, rejoue chaque cas à partir de ses seules entrées, et refait les sections de WebCrypto
// avec l'AES-256-GCM natif (RustCrypto, celui des apps) : même chiffré, même clair.
//
// Les sorties attendues des tables ci-dessous sont écrites à la main (relues), pas recopiées du
// moteur : la génération échoue si le moteur s'en écarte.
mod support;

use serde_json::{Map, Value, json};
use shhdrop_core::compte::{
    Adresse, PSEUDOS_RESERVES, cle_appareil, cle_prive, cle_profil, deriver, mot_de_passe_valide,
    normaliser, pseudo_canon, pseudo_reserve, pseudo_valide, sel,
};
use shhdrop_core::kdf::{KDF_CREATE, argon2id, hkdf, sha256};
use shhdrop_core::platform::Key;
use support::{block_on, hex, platform, unhex};
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

const FILE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../vectors/compte.json");
/// Sections écrites par web/scripts/gen-compte-vectors.mjs (WebCrypto).
const SECTIONS_WEBCRYPTO: [&str; 3] = ["coffre_prive", "coffre_profil", "enveloppes"];

/// 32 octets déterministes : SHA-256(UTF-8(« shhdrop/vecteurs/compte/ » + étiquette)).
fn derive(label: &str) -> [u8; 32] {
    sha256(format!("shhdrop/vecteurs/compte/{label}").as_bytes())
}

fn key32(s: &str) -> [u8; 32] {
    unhex(s).try_into().expect("32 octets")
}

fn s(v: &Value) -> &str {
    v.as_str().unwrap_or_else(|| panic!("texte attendu : {v}"))
}

fn utf8_hex(v: &Value) -> String {
    String::from_utf8(unhex(s(v))).expect("UTF-8")
}

// ------------------------------------------------------------------------- normaliser

/// (étiquette, entrée, attendu : Ok((canon, exacte)) ou Err(code)).
type CasAdresse = (
    &'static str,
    String,
    Result<(&'static str, String), &'static str>,
);

fn cas_normaliser() -> Vec<CasAdresse> {
    let l64 = "a".repeat(64);
    let l65 = "a".repeat(65);
    let e63 = "e".repeat(63);
    let e64 = "e".repeat(64);
    // 254 caractères : 64 + 1 + 189 (63 + 1 + 63 + 1 + 58 + 1 + 2).
    let dom189 = format!("{e63}.{e63}.{}.fr", "e".repeat(58));
    let t254 = format!("{l64}@{dom189}");
    let t255 = format!("{l64}@e{dom189}");
    assert_eq!((t254.len(), t255.len()), (254, 255));
    let ok = |c: &'static str, e: &str| Ok((c, e.to_string()));
    let id = |a: &'static str| Ok((a, a.to_string()));
    let inv = || Err("adresse_invalide");
    let na = || Err("adresse_non_ascii");
    vec![
        ("simple", "lea@exemple.fr".into(), id("lea@exemple.fr")),
        ("majuscules", "Lea@Exemple.FR".into(), id("lea@exemple.fr")),
        (
            "blancs_de_bord",
            " \t lea@exemple.fr\r\n ".into(),
            id("lea@exemple.fr"),
        ),
        ("saut_de_page_en_bord", "\u{c}lea@exemple.fr".into(), inv()),
        (
            "plus",
            "lea+x@exemple.fr".into(),
            ok("lea@exemple.fr", "lea+x@exemple.fr"),
        ),
        (
            "plus_deux_fois",
            "lea+x+y@exemple.fr".into(),
            ok("lea@exemple.fr", "lea+x+y@exemple.fr"),
        ),
        (
            "plus_final",
            "lea+@exemple.fr".into(),
            ok("lea@exemple.fr", "lea+@exemple.fr"),
        ),
        ("plus_en_tete", "+x@exemple.fr".into(), inv()),
        ("plus_seul", "+@exemple.fr".into(), inv()),
        (
            "points_hors_gmail_gardes",
            "Lea.Dupont@exemple.fr".into(),
            id("lea.dupont@exemple.fr"),
        ),
        (
            "variante_gmail",
            "Lea.Dupont+x@GMAIL.com".into(),
            ok("leadupont@gmail.com", "lea.dupont+x@gmail.com"),
        ),
        (
            "points_gmail",
            "l.e.a@gmail.com".into(),
            ok("lea@gmail.com", "l.e.a@gmail.com"),
        ),
        (
            "googlemail",
            "lea.dupont@googlemail.com".into(),
            ok("leadupont@gmail.com", "lea.dupont@googlemail.com"),
        ),
        (
            "googlemail_majuscules_plus",
            "L.E.A+Shh@GoogleMail.COM".into(),
            ok("lea@gmail.com", "l.e.a+shh@googlemail.com"),
        ),
        ("plus_en_tete_gmail", "+x@gmail.com".into(), inv()),
        (
            "sous_domaine_gmail",
            "l.ea@mail.gmail.com".into(),
            id("l.ea@mail.gmail.com"),
        ),
        (
            "gmail_ailleurs",
            "l.ea@gmail.com.fr".into(),
            id("l.ea@gmail.com.fr"),
        ),
        ("double_arobase", "lea@@exemple.fr".into(), inv()),
        ("deux_arobases", "lea@exemple@fr".into(), inv()),
        ("sans_arobase", "leaexemple.fr".into(), inv()),
        ("local_vide", "@exemple.fr".into(), inv()),
        ("domaine_vide", "lea@".into(), inv()),
        ("vide", "".into(), inv()),
        ("blancs_seuls", " \t\r\n".into(), inv()),
        (
            "local_64",
            format!("{l64}@exemple.fr"),
            Ok(("", format!("{l64}@exemple.fr"))),
        ),
        ("local_65", format!("{l65}@exemple.fr"), inv()),
        ("total_254", t254.clone(), Ok(("", t254))),
        ("total_255", t255, inv()),
        (
            "etiquette_63",
            format!("lea@{e63}.fr"),
            Ok(("", format!("lea@{e63}.fr"))),
        ),
        ("etiquette_64", format!("lea@{e64}.fr"), inv()),
        ("accent_local", "léa@exemple.fr".into(), na()),
        ("accent_domaine", "lea@exémple.fr".into(), na()),
        (
            "espace_insecable_en_bord",
            "lea@exemple.fr\u{a0}".into(),
            na(),
        ),
        ("accent_et_espace", "lé a@exemple.fr".into(), na()),
        (
            "punycode",
            "lea@xn--exmple-cva.fr".into(),
            id("lea@xn--exmple-cva.fr"),
        ),
        (
            "tiret_interieur",
            "lea@ex-emple.fr".into(),
            id("lea@ex-emple.fr"),
        ),
        ("tiret_en_tete_etiquette", "lea@-exemple.fr".into(), inv()),
        ("tiret_en_fin_etiquette", "lea@exemple-.fr".into(), inv()),
        ("tiret_tld", "lea@exemple.f-r".into(), inv()),
        ("tld_numerique", "lea@exemple.123".into(), inv()),
        ("tld_une_lettre", "lea@exemple.f".into(), inv()),
        ("tld_alphanumerique", "lea@exemple.f1".into(), inv()),
        ("chiffres_domaine", "lea@123.fr".into(), id("lea@123.fr")),
        ("une_seule_etiquette", "lea@exemple".into(), inv()),
        ("etiquette_vide", "lea@exemple..fr".into(), inv()),
        ("point_en_tete_domaine", "lea@.exemple.fr".into(), inv()),
        ("point_final_domaine", "lea@exemple.fr.".into(), inv()),
        ("souligne_domaine", "lea@ex_emple.fr".into(), inv()),
        ("espace_interieure", "lea dupont@exemple.fr".into(), inv()),
        ("saut_de_ligne_interieur", "lea\n@exemple.fr".into(), inv()),
        ("nul", "lea\u{0}@exemple.fr".into(), inv()),
        ("del", "lea\u{7f}@exemple.fr".into(), inv()),
        ("point_en_tete_local", ".lea@exemple.fr".into(), inv()),
        ("point_final_local", "lea.@exemple.fr".into(), inv()),
        ("deux_points_local", "le..a@exemple.fr".into(), inv()),
        ("guillemets", "\"lea\"@exemple.fr".into(), inv()),
        ("virgule", "a,b@exemple.fr".into(), inv()),
        ("chevrons", "lea<x>@exemple.fr".into(), inv()),
        ("point_virgule", "lea;x@exemple.fr".into(), inv()),
        ("parentheses", "lea(x)@exemple.fr".into(), inv()),
        ("crochets_domaine", "lea@[127.0.0.1]".into(), inv()),
        (
            "apostrophe",
            "O'Neil@exemple.fr".into(),
            id("o'neil@exemple.fr"),
        ),
        (
            "tous_les_atext",
            "a!#$%&'*/=?^_`{|}~-z@exemple.fr".into(),
            id("a!#$%&'*/=?^_`{|}~-z@exemple.fr"),
        ),
        ("points_gmail_seuls", "...@gmail.com".into(), inv()),
    ]
}

/// Attendu d'un cas : canon vide = identique à `exacte`.
fn attendu_adresse(c: &CasAdresse) -> Result<Adresse, &'static str> {
    c.2.clone().map(|(canon, exacte)| Adresse {
        canon: if canon.is_empty() {
            exacte.clone()
        } else {
            canon.into()
        },
        exacte,
    })
}

fn normaliser_json(r: Result<Adresse, shhdrop_core::Error>) -> Value {
    match r {
        Ok(a) => json!({ "canon": a.canon, "exacte": a.exacte }),
        Err(e) => json!({ "error": e.to_string() }),
    }
}

fn section_normaliser() -> Value {
    let mut out = Vec::new();
    for c in cas_normaliser() {
        let got = normaliser(&c.1);
        let want = attendu_adresse(&c);
        match (&got, &want) {
            (Ok(g), Ok(w)) => assert_eq!(g, w, "{}", c.0),
            (Err(g), Err(w)) => assert_eq!(g.to_string(), *w, "{}", c.0),
            _ => panic!("{} : obtenu {got:?}, attendu {want:?}", c.0),
        }
        let mut v = normaliser_json(got);
        v["label"] = c.0.into();
        v["entree_hex"] = hex(c.1.as_bytes()).into();
        out.push(v);
    }
    Value::Array(out)
}

// ------------------------------------------------------------------------- sel

const CANONS: [&str; 4] = [
    "lea@exemple.fr",
    "leadupont@gmail.com",
    "o'neil@exemple.fr",
    "a@b.cd",
];

fn section_sel() -> Value {
    CANONS
        .iter()
        .map(|c| json!({ "canon": c, "sel": hex(&sel(c)) }))
        .collect()
}

// ------------------------------------------------------------------------- deriver

/// (étiquette, mot de passe, canon, même clé que l'étiquette…).
fn cas_deriver() -> Vec<(
    &'static str,
    &'static str,
    &'static str,
    Option<&'static str>,
)> {
    vec![
        ("simple", "correct horse battery", "lea@exemple.fr", None),
        (
            "autre_adresse",
            "correct horse battery",
            "leadupont@gmail.com",
            None,
        ),
        (
            "blancs_de_bord",
            " \t correct horse battery\r\n",
            "lea@exemple.fr",
            Some("simple"),
        ),
        ("nfc_compose", "Mot de passe d'été", "lea@exemple.fr", None),
        (
            "nfc_decompose",
            "Mot de passe d'e\u{301}te\u{301}",
            "lea@exemple.fr",
            Some("nfc_compose"),
        ),
        (
            "espace_insecable_en_bord_gardee",
            "\u{a0}correct horse battery",
            "lea@exemple.fr",
            None,
        ),
        ("emoji", "🔐 clé 🗝️ secrète", "lea@exemple.fr", None),
        ("vide", "", "lea@exemple.fr", None),
        ("blancs_seuls", " \t\r\n", "lea@exemple.fr", None),
    ]
}

fn deriver_json(mdp: &str, canon: &str) -> Value {
    match deriver(mdp, canon) {
        Ok((a, k)) => json!({ "a_auth": hex(&*a), "kek_mdp": hex(&*k) }),
        Err(e) => json!({ "error": e.to_string() }),
    }
}

fn section_deriver() -> Value {
    let mut out: Vec<Value> = Vec::new();
    for (label, mdp, canon, same) in cas_deriver() {
        let mut v = deriver_json(mdp, canon);
        if let Some(o) = same {
            let other = out
                .iter()
                .find(|x| x["label"] == o)
                .expect("cas de référence");
            assert_eq!(v["a_auth"], other["a_auth"], "{label}");
            assert_eq!(v["kek_mdp"], other["kek_mdp"], "{label}");
            v["same_key_as"] = o.into();
        } else if v.get("a_auth").is_some() {
            assert!(
                out.iter().all(|x| x["a_auth"] != v["a_auth"]),
                "{label} : même clé qu'un autre cas"
            );
        }
        v["label"] = label.into();
        v["mdp_hex"] = hex(mdp.as_bytes()).into();
        v["canon"] = canon.into();
        out.push(v);
    }
    assert_eq!(out[7]["error"], "mot_de_passe_vide");
    assert_eq!(out[8]["error"], "mot_de_passe_vide");
    Value::Array(out)
}

// ------------------------------------------------------------------------- cles

fn section_cles() -> Value {
    ["a", "b"]
        .iter()
        .map(|l| {
            let k = derive(&format!("k_compte/{l}"));
            let s = derive(&format!("s_profil/{l}"));
            json!({
                "label": l,
                "k_compte": hex(&k),
                "s_profil": hex(&s),
                "k_prive": hex(&*cle_prive(&k)),
                "k_appareil": hex(&*cle_appareil(&k)),
                "k_profil": hex(&*cle_profil(&s)),
            })
        })
        .collect()
}

// ------------------------------------------------------------------------- pseudo

/// Attendu d'un cas de pseudo.
enum P {
    /// Affichage, `p_canon`, réservé.
    Ok(&'static str, &'static str, bool),
    /// Même affichage que l'entrée, non réservé.
    Id(&'static str),
    /// Accepté (aucune autre vérification ici).
    Valide,
    /// Accepté et réservé.
    Reserve,
    Err(&'static str),
}

fn cas_pseudo() -> Vec<(&'static str, String, P)> {
    let long = "a\u{301}\u{302}\u{303}\u{304}\u{305}\u{306}\u{307}";
    let mut v: Vec<(&'static str, String, P)> = vec![
        ("simple", "Léa".into(), P::Ok("Léa", "léa", false)),
        ("majuscules", "LÉA".into(), P::Ok("LÉA", "léa", false)),
        ("decompose", "Le\u{301}a".into(), P::Ok("Léa", "léa", false)),
        (
            "espace_interieure",
            "lé a".into(),
            P::Ok("lé a", "léa", false),
        ),
        (
            "espaces_regroupees",
            "  Léa \u{a0}\u{3000} Dupont\t".into(),
            P::Ok("Léa Dupont", "léadupont", false),
        ),
        (
            "ponctuation",
            "Jean-Luc O'Neil_x.y".into(),
            P::Ok("Jean-Luc O'Neil_x.y", "jeanluconeilxy", false),
        ),
        (
            "apostrophe_typographique",
            "O\u{2019}Neil".into(),
            P::Ok("O'Neil", "oneil", false),
        ),
        (
            "sans_accent_distinct",
            "Lea".into(),
            P::Ok("Lea", "lea", false),
        ),
        (
            "nfkc_pleine_chasse",
            "ＬＥＡ".into(),
            P::Ok("ＬＥＡ", "lea", false),
        ),
        (
            "nfkc_mathematique",
            "𝓛éa".into(),
            P::Ok("𝓛éa", "léa", false),
        ),
        ("sosie_m_rn", "Emma".into(), P::Ok("Emma", "ernrna", false)),
        (
            "sosie_chiffres",
            "B0b1".into(),
            P::Ok("B0b1", "bobl", false),
        ),
        ("cyrillique_seul", "Лея".into(), P::Ok("Лея", "лeᴙ", false)),
        (
            "sosie_cyrillique_seul",
            "\u{410}\u{4CF}\u{456}\u{441}\u{435}".into(),
            P::Ok("\u{410}\u{4CF}\u{456}\u{441}\u{435}", "alice", false),
        ),
        (
            "grec",
            "Ελένη".into(),
            P::Ok("Ελένη", "ꞓλꞓ\u{301}vn\u{329}", false),
        ),
        ("han_et_kana", "田中ひろし".into(), P::Id("田中ひろし")),
        ("hangul", "김민수".into(), P::Id("김민수")),
        ("arabe", "علي".into(), P::Id("علي")),
        ("devanagari", "हिन्दी".into(), P::Id("हिन्दी")),
        ("chiffres_seuls", "42".into(), P::Id("42")),
        (
            "invisibles_retires",
            "L\u{200B}éa\u{202E}".into(),
            P::Ok("Léa", "léa", false),
        ),
        ("deux_graphemes", "ab".into(), P::Id("ab")),
        (
            "vingt_quatre_graphemes",
            "a".repeat(24),
            P::Ok(
                "aaaaaaaaaaaaaaaaaaaaaaaa",
                "aaaaaaaaaaaaaaaaaaaaaaaa",
                false,
            ),
        ),
        // Le plus long p_canon possible en octets pour un graphème de base latine : 24 graphèmes de
        // 8 points de code (lettre + 7 marques), 360 octets UTF-8 (conception : borne côté serveur).
        ("p_canon_long", long.repeat(24), P::Valide),
        ("un_grapheme", "A".into(), P::Err("pseudo_longueur")),
        ("vide", "".into(), P::Err("pseudo_longueur")),
        ("blancs_seuls", "   ".into(), P::Err("pseudo_longueur")),
        (
            "vingt_cinq_graphemes",
            "a".repeat(25),
            P::Err("pseudo_longueur"),
        ),
        (
            "entree_au_dela_de_4096_octets",
            "a".repeat(4097),
            P::Err("pseudo_longueur"),
        ),
        (
            "ecritures_melees",
            "\u{410}lice".into(),
            P::Err("pseudo_ecritures"),
        ),
        (
            "latin_et_han",
            "Taro太郎".into(),
            P::Err("pseudo_ecritures"),
        ),
        ("emoji", "Léa😀".into(), P::Err("pseudo_caracteres")),
        (
            "teinte_seule",
            "Léa\u{1F3FD}".into(),
            P::Err("pseudo_caracteres"),
        ),
        (
            "lettre_encerclee",
            "Ⓜax".into(),
            P::Err("pseudo_caracteres"),
        ),
        (
            "ponctuation_seule",
            "..".into(),
            P::Err("pseudo_caracteres"),
        ),
        (
            "point_d_exclamation",
            "Léa!".into(),
            P::Err("pseudo_caracteres"),
        ),
        ("arobase", "Léa@x".into(), P::Err("pseudo_caracteres")),
        (
            "marque_sur_espace",
            "a \u{301}b".into(),
            P::Err("pseudo_caracteres"),
        ),
        (
            "neuf_points_par_grapheme",
            format!("ab{}", "\u{301}".repeat(8)),
            P::Err("pseudo_caracteres"),
        ),
        // Réservés (conception §21.5), écrits comme on les tape.
        (
            "reserve_admin",
            "Admin".into(),
            P::Ok("Admin", "adrnin", true),
        ),
        (
            "reserve_admin_majuscules",
            "ADMIN".into(),
            P::Ok("ADMIN", "adrnin", true),
        ),
        (
            "reserve_admin_sosie_rn",
            "adrnin".into(),
            P::Ok("adrnin", "adrnin", true),
        ),
        (
            "reserve_shhgone",
            "ShhGone".into(),
            P::Ok("ShhGone", "shhgone", true),
        ),
        (
            "reserve_espace_et_tiret",
            "Shh-Drop".into(),
            P::Ok("Shh-Drop", "shhdrop", true),
        ),
        (
            "reserve_moderateur_accent",
            "Modérateur".into(),
            P::Ok("Modérateur", "rnodérateur", true),
        ),
        (
            "reserve_equipe_accent",
            "Équipe".into(),
            P::Ok("Équipe", "équipe", true),
        ),
        (
            "reserve_securite_accent",
            "Sécurité".into(),
            P::Ok("Sécurité", "sécurité", true),
        ),
        (
            "reserve_systeme_accent",
            "Système".into(),
            P::Ok("Système", "systèrne", true),
        ),
        (
            "non_reserve_suffixe",
            "Admin2".into(),
            P::Ok("Admin2", "adrnin2", false),
        ),
    ];
    // Chaque mot de la liste, tel quel.
    for (i, w) in PSEUDOS_RESERVES.iter().enumerate() {
        let label: &'static str = Box::leak(format!("liste_{i:02}").into_boxed_str());
        v.push((label, (*w).to_string(), P::Reserve));
    }
    v
}

fn pseudo_json(entree: &str) -> Value {
    match pseudo_valide(entree) {
        Ok(a) => {
            let c = pseudo_canon(&a);
            json!({
                "affiche_hex": hex(a.as_bytes()),
                "p_canon_hex": hex(c.as_bytes()),
                "reserve": pseudo_reserve(&c),
            })
        }
        Err(e) => json!({ "error": e.to_string() }),
    }
}

fn section_pseudo() -> Value {
    let mut out = Vec::new();
    for (label, entree, want) in cas_pseudo() {
        let mut v = pseudo_json(&entree);
        let affiche = v.get("affiche_hex").map(utf8_hex);
        let canon = v.get("p_canon_hex").map(utf8_hex);
        match want {
            P::Ok(a, c, r) => {
                assert_eq!(affiche.as_deref(), Some(a), "{label}");
                assert_eq!(canon.as_deref(), Some(c), "{label}");
                assert_eq!(v["reserve"], r, "{label}");
            }
            P::Id(a) => {
                assert_eq!(affiche.as_deref(), Some(a), "{label}");
                assert_eq!(v["reserve"], false, "{label}");
            }
            P::Valide => assert!(canon.is_some(), "{label}"),
            P::Reserve => assert_eq!(v["reserve"], true, "{label}"),
            P::Err(e) => assert_eq!(v["error"], e, "{label}"),
        }
        v["label"] = label.into();
        v["entree_hex"] = hex(entree.as_bytes()).into();
        out.push(v);
    }
    Value::Array(out)
}

// ------------------------------------------------------------------------- mot de passe

fn cas_mdp() -> Vec<(&'static str, String, &'static str, Option<&'static str>)> {
    let e = "Lea.Dupont+x@GMAIL.com";
    let e2 = "lea.dupont.x@gmail.com";
    vec![
        ("dix", "abcdefghij".into(), e, None),
        ("neuf", "abcdefghi".into(), e, Some("mdp_court")),
        ("vide", "".into(), e, Some("mdp_court")),
        (
            "neuf_et_blancs_de_bord",
            "  abcdefghi\t".into(),
            e,
            Some("mdp_court"),
        ),
        ("dix_accents_decomposes", "e\u{301}".repeat(10), e, None),
        (
            "neuf_accents_decomposes",
            "e\u{301}".repeat(9),
            e,
            Some("mdp_court"),
        ),
        ("deux_cent_cinquante_six", "a".repeat(256), e, None),
        (
            "deux_cent_cinquante_sept",
            "a".repeat(257),
            e,
            Some("mdp_long"),
        ),
        ("emoji_points_de_code", "😀".repeat(10), e, None),
        (
            "adresse_exacte",
            "lea.dupont+x@gmail.com".into(),
            e,
            Some("mdp_adresse"),
        ),
        (
            "adresse_majuscules",
            "LEA.DUPONT+X@GMAIL.COM".into(),
            e,
            Some("mdp_adresse"),
        ),
        (
            "adresse_blancs_de_bord",
            " lea.dupont+x@gmail.com\n".into(),
            e,
            Some("mdp_adresse"),
        ),
        (
            "partie_locale_exacte",
            "Lea.Dupont+x".into(),
            e,
            Some("mdp_adresse"),
        ),
        (
            "adresse_canonique",
            "leadupont@gmail.com".into(),
            e,
            Some("mdp_adresse"),
        ),
        (
            "partie_locale_canonique",
            "leadupontx".into(),
            e2,
            Some("mdp_adresse"),
        ),
        (
            "adresse_dans_le_mot_de_passe",
            "lea.dupont+x@gmail.com!".into(),
            e,
            None,
        ),
    ]
}

fn mdp_json(mdp: &str, email: &str) -> Value {
    let a = normaliser(email).expect("adresse du cas");
    match mot_de_passe_valide(mdp, &a) {
        Ok(()) => json!({ "ok": true }),
        Err(e) => json!({ "error": e.to_string() }),
    }
}

fn section_mdp() -> Value {
    cas_mdp()
        .into_iter()
        .map(|(label, mdp, email, want)| {
            let mut v = mdp_json(&mdp, email);
            match want {
                None => assert_eq!(v["ok"], true, "{label}"),
                Some(e) => assert_eq!(v["error"], e, "{label}"),
            }
            v["label"] = label.into();
            v["mdp_hex"] = hex(mdp.as_bytes()).into();
            v["email"] = email.into();
            v
        })
        .collect()
}

// ------------------------------------------------------------------------- fichier

fn constants() -> Value {
    json!({
        "argon2id": { "fils": 1, "mem": KDF_CREATE.mem, "ops": KDF_CREATE.ops, "sortie": 32 },
        "etiquettes": {
            "a_auth": "shhdrop/v2/compte/auth",
            "kek_mdp": "shhdrop/v2/compte/enveloppe-mdp",
            "k_prive": "shhdrop/v2/compte/blob",
            "k_profil": "shhdrop/v2/compte/profil",
            "k_appareil": "shhdrop/v2/compte/appareil",
            "sel": "shhdrop/v2/compte/sel",
        },
        "mdp": { "min": 10, "max": 256 },
        "pseudo": { "min": 2, "max": 24 },
        "paliers": [4096, 16384, 65536, 262144],
        "reserves": PSEUDOS_RESERVES
            .iter()
            .map(|w| json!({ "mot": w, "p_canon_hex": hex(pseudo_canon(w).as_bytes()) }))
            .collect::<Vec<_>>(),
        "unicode": {
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
            "char": [char::UNICODE_VERSION.0, char::UNICODE_VERSION.1, char::UNICODE_VERSION.2],
        },
    })
}

/// Sections du moteur.
fn build() -> Map<String, Value> {
    let mut m = Map::new();
    m.insert(
        "about".into(),
        "Compte v2, produit par le moteur Rust (engine/core/tests/compte.rs) et, pour les enveloppes et les coffres, par WebCrypto (web/scripts/gen-compte-vectors.mjs) ; voir engine/vectors/README.md.".into(),
    );
    m.insert("constants".into(), constants());
    m.insert("normaliser".into(), section_normaliser());
    m.insert("sel".into(), section_sel());
    m.insert("deriver".into(), section_deriver());
    m.insert("cles".into(), section_cles());
    m.insert("pseudo".into(), section_pseudo());
    m.insert("mot_de_passe".into(), section_mdp());
    m
}

fn text(v: &Value) -> String {
    let mut s = serde_json::to_string_pretty(v).unwrap();
    s.push('\n');
    s
}

fn lire() -> (String, Value) {
    let raw = std::fs::read_to_string(FILE).expect("engine/vectors/compte.json");
    let v = serde_json::from_str(&raw).expect("JSON de compte.json");
    (raw, v)
}

#[test]
fn fichier_a_jour() {
    let built = build();
    if std::env::var_os("SHH_GEN_COMPTE").is_some() {
        // Les sections de WebCrypto (gen-compte-vectors.mjs) sont gardées telles quelles.
        let mut all = built.clone();
        if let Ok(raw) = std::fs::read_to_string(FILE) {
            let old: Value = serde_json::from_str(&raw).unwrap();
            for k in SECTIONS_WEBCRYPTO {
                if let Some(x) = old.get(k) {
                    all.insert(k.into(), x.clone());
                }
            }
        }
        std::fs::write(FILE, text(&Value::Object(all))).unwrap();
    }
    let (raw, file) = lire();
    // Forme canonique (clés triées, 2 espaces, LF final), quel que soit l'auteur de la section.
    assert_eq!(
        raw,
        text(&file),
        "compte.json n'est pas sous forme canonique"
    );
    let obj = file.as_object().unwrap();
    for (k, v) in &built {
        assert_eq!(
            obj.get(k),
            Some(v),
            "section {k} : n'est plus celle du moteur"
        );
    }
    let mut attendues: Vec<&str> = built.keys().map(String::as_str).collect();
    attendues.extend(SECTIONS_WEBCRYPTO);
    attendues.sort_unstable();
    let presentes: Vec<&str> = obj.keys().map(String::as_str).collect();
    assert_eq!(presentes, attendues, "sections du fichier");
}

// ------------------------------------------------------------------------- rejeu, entrées seules

#[test]
fn vecteurs_normaliser() {
    let (_, v) = lire();
    let cases = v["normaliser"].as_array().unwrap();
    assert!(cases.len() >= 40);
    for c in cases {
        let got = normaliser_json(normaliser(&utf8_hex(&c["entree_hex"])));
        for k in ["canon", "exacte", "error"] {
            assert_eq!(got.get(k), c.get(k), "{} : {k}", c["label"]);
        }
    }
}

#[test]
fn vecteurs_sel() {
    let (_, v) = lire();
    let cases = v["sel"].as_array().unwrap();
    assert!(!cases.is_empty());
    for c in cases {
        let canon = s(&c["canon"]);
        assert_eq!(hex(&sel(canon)), s(&c["sel"]), "{canon}");
        // Formule écrite à part : SHA-256(« shhdrop/v2/compte/sel » ‖ 0x00 ‖ canon)[0..16].
        let mut m = b"shhdrop/v2/compte/sel\0".to_vec();
        m.extend_from_slice(canon.as_bytes());
        assert_eq!(hex(&sha256(&m)[..16]), s(&c["sel"]), "{canon}");
    }
}

#[test]
fn vecteurs_deriver() {
    let (_, v) = lire();
    let cases = v["deriver"].as_array().unwrap();
    assert!(cases.len() >= 5);
    for c in cases {
        let mdp = utf8_hex(&c["mdp_hex"]);
        let canon = s(&c["canon"]);
        let got = deriver_json(&mdp, canon);
        for k in ["a_auth", "kek_mdp", "error"] {
            assert_eq!(got.get(k), c.get(k), "{} : {k}", c["label"]);
        }
        // Composition écrite à part : Argon2id(mot de passe rogné puis NFC, sel, 64 Mio, 3, 1),
        // puis HKDF-SHA-256 à sel vide sous chaque étiquette.
        if let Some(a) = c.get("a_auth") {
            let nfc: String = mdp.trim_matches([' ', '\t', '\r', '\n']).nfc().collect();
            let m = argon2id(nfc.as_bytes(), &sel(canon), 3, 64 << 20).unwrap();
            assert_eq!(hex(&*hkdf::<32>(&*m, "shhdrop/v2/compte/auth")), s(a));
            assert_eq!(
                hex(&*hkdf::<32>(&*m, "shhdrop/v2/compte/enveloppe-mdp")),
                s(&c["kek_mdp"])
            );
        }
    }
}

#[test]
fn vecteurs_cles() {
    let (_, v) = lire();
    for c in v["cles"].as_array().unwrap() {
        let k = key32(s(&c["k_compte"]));
        let p = key32(s(&c["s_profil"]));
        assert_eq!(hex(&*cle_prive(&k)), s(&c["k_prive"]));
        assert_eq!(hex(&*cle_appareil(&k)), s(&c["k_appareil"]));
        assert_eq!(hex(&*cle_profil(&p)), s(&c["k_profil"]));
        assert_eq!(
            hex(&*hkdf::<32>(&k, "shhdrop/v2/compte/blob")),
            s(&c["k_prive"])
        );
        assert_eq!(
            hex(&*hkdf::<32>(&k, "shhdrop/v2/compte/appareil")),
            s(&c["k_appareil"])
        );
        assert_eq!(
            hex(&*hkdf::<32>(&p, "shhdrop/v2/compte/profil")),
            s(&c["k_profil"])
        );
    }
}

#[test]
fn vecteurs_pseudo() {
    let (_, v) = lire();
    let cases = v["pseudo"].as_array().unwrap();
    assert!(cases.len() >= 30);
    for c in cases {
        let got = pseudo_json(&utf8_hex(&c["entree_hex"]));
        for k in ["affiche_hex", "p_canon_hex", "reserve", "error"] {
            assert_eq!(got.get(k), c.get(k), "{} : {k}", c["label"]);
        }
    }
    // p_canon le plus long d'un pseudo à base latine : 336 octets (24 graphèmes de 14 octets),
    // bien au-delà des 96 octets que le plan prévoyait comme borne du serveur (lot 2).
    let long = cases.iter().find(|c| c["label"] == "p_canon_long").unwrap();
    assert_eq!(s(&long["p_canon_hex"]).len() / 2, 336);
    // Chaque mot réservé de la liste, et sa forme canonique, sont refusés.
    for r in v["constants"]["reserves"].as_array().unwrap() {
        let canon = utf8_hex(&r["p_canon_hex"]);
        assert_eq!(pseudo_canon(s(&r["mot"])), canon);
        assert!(pseudo_reserve(&canon), "{canon}");
    }
}

#[test]
fn vecteurs_mot_de_passe() {
    let (_, v) = lire();
    let cases = v["mot_de_passe"].as_array().unwrap();
    assert!(cases.len() >= 10);
    for c in cases {
        let got = mdp_json(&utf8_hex(&c["mdp_hex"]), s(&c["email"]));
        for k in ["ok", "error"] {
            assert_eq!(got.get(k), c.get(k), "{} : {k}", c["label"]);
        }
    }
}

/// AES-256-GCM natif (RustCrypto, fournisseur des apps) à nonce donné : nonce ‖ chiffré ‖ tag.
fn aes_natif(cle: &[u8; 32], nonce: &[u8], ad: &[u8], clair: &[u8]) -> Vec<u8> {
    let p = platform(1);
    let k = block_on(Key::import(&p, Zeroizing::new(*cle))).unwrap();
    let n: [u8; 12] = nonce.try_into().expect("nonce de 12 octets");
    let ct = block_on(k.seal_batch(ad, &[n], clair, clair.len())).unwrap();
    [nonce, &ct[..]].concat()
}

#[test]
fn vecteurs_webcrypto_refaits_en_natif() {
    let (_, v) = lire();
    let cles = v["cles"].as_array().unwrap();
    let deriv = v["deriver"].as_array().unwrap();
    // Enveloppe du mot de passe : nonce (12) ‖ AES-256-GCM(KEK_mdp, nonce, K_compte,
    // AD = « SHH-CENV1 » ‖ h ‖ « mdp ») = 60 octets.
    let env = v["enveloppes"].as_array().unwrap();
    assert!(!env.is_empty());
    for c in env {
        let kek = key32(s(&c["kek_mdp"]));
        assert!(
            deriv.iter().any(|d| d["kek_mdp"] == c["kek_mdp"]),
            "KEK de deriver"
        );
        let h = unhex(s(&c["h"]));
        assert_eq!(h.len(), 16);
        let ad = [b"SHH-CENV1".as_slice(), &h, b"mdp"].concat();
        assert_eq!(hex(&ad), s(&c["ad"]));
        let k_compte = unhex(s(&c["k_compte"]));
        let out = aes_natif(&kek, &unhex(s(&c["nonce"])), &ad, &k_compte);
        assert_eq!(out.len(), 60);
        assert_eq!(hex(&out), s(&c["env_mdp"]), "{}", c["label"]);
    }
    // Coffres : magie (9) ‖ gen (8, gros-boutiste) ‖ nonce (12) ‖ AES-256-GCM(clé, nonce, clair,
    // AD = magie ‖ h ‖ gen) ; clair = longueur du JSON (4, gros-boutiste) ‖ JSON ‖ zéros, de la
    // taille exacte du palier.
    for (section, magie, champ, cle) in [
        (
            "coffre_prive",
            b"SHH-ACCT1",
            "k_compte",
            cle_prive as fn(&[u8; 32]) -> _,
        ),
        ("coffre_profil", b"SHH-PROF1", "s_profil", cle_profil),
    ] {
        let cases = v[section].as_array().unwrap();
        assert!(cases.len() >= 2, "{section}");
        for c in cases {
            let src = key32(s(&c[champ]));
            assert!(
                cles.iter().any(|k| k[champ] == c[champ]),
                "{section} : clé de `cles`"
            );
            let k = cle(&src);
            assert_eq!(hex(&*k), s(&c["cle"]), "{section}");
            let h = unhex(s(&c["h"]));
            let g = c["gen"].as_u64().unwrap().to_be_bytes();
            let ad = [magie.as_slice(), &h, &g].concat();
            assert_eq!(hex(&ad), s(&c["ad"]), "{section}");
            let json = utf8_hex(&c["json_hex"]);
            let palier = c["palier"].as_u64().unwrap() as usize;
            assert!([4096, 16384, 65536, 262144].contains(&palier));
            let mut clair = (json.len() as u32).to_be_bytes().to_vec();
            clair.extend_from_slice(json.as_bytes());
            assert!(
                clair.len() <= palier,
                "{section} : JSON trop long pour le palier"
            );
            clair.resize(palier, 0);
            let blob = [
                magie.as_slice(),
                &g,
                &aes_natif(&k, &unhex(s(&c["nonce"])), &ad, &clair),
            ]
            .concat();
            assert_eq!(blob.len(), 9 + 8 + 12 + palier + 16);
            assert_eq!(c["blob_len"].as_u64(), Some(blob.len() as u64));
            assert_eq!(hex(&sha256(&blob)), s(&c["blob_sha256"]), "{}", c["label"]);
            if let Some(b) = c.get("blob") {
                assert_eq!(hex(&blob), s(b), "{}", c["label"]);
            }
        }
    }
}

// ------------------------------------------------------------------------- propriétés

#[test]
fn canon_ne_depend_pas_de_la_variante() {
    let a = normaliser("Lea.Dupont+x@GMAIL.com").unwrap();
    let b = normaliser("leadupont@gmail.com").unwrap();
    let c = normaliser("  l.e.a.d.u.p.o.n.t+autre@googlemail.com ").unwrap();
    assert_eq!(a.canon, "leadupont@gmail.com");
    assert_eq!((&a.canon, &a.canon), (&b.canon, &c.canon));
    assert_ne!(a.exacte, b.exacte);
    assert_ne!(a.exacte, c.exacte);
    assert_eq!(sel(&a.canon), sel(&c.canon));
}

#[test]
fn pseudo_canon_identique_pour_variantes() {
    let c = pseudo_canon("Léa");
    for v in ["LÉA", "lé a", "Le\u{301}a", "L-é.a", "ＬÉＡ"] {
        assert_eq!(pseudo_canon(v), c, "{v}");
        assert_eq!(pseudo_canon(&pseudo_valide(v).unwrap()), c, "{v}");
    }
    assert_ne!(pseudo_canon("Lea"), c);
}

#[test]
fn cles_de_coffre_distinctes() {
    let k = derive("k_compte/a");
    let (p, f, d) = (cle_prive(&k), cle_profil(&k), cle_appareil(&k));
    assert_ne!(*p, *f);
    assert_ne!(*p, *d);
    assert_ne!(*f, *d);
    assert_ne!(*p, k);
    let (a, kek) = deriver("correct horse battery", "lea@exemple.fr").unwrap();
    assert_ne!(*a, *kek);
}

#[test]
fn reserves_de_la_conception() {
    // Conception §21.5, plus les formes accentuées qu'un francophone tape (signalé au propriétaire).
    let liste = [
        "shhgone",
        "shhdrop",
        "admin",
        "administrateur",
        "moderateur",
        "moderation",
        "support",
        "aide",
        "equipe",
        "officiel",
        "systeme",
        "securite",
        "contact",
    ];
    for w in liste {
        assert!(PSEUDOS_RESERVES.contains(&w), "{w}");
        assert!(pseudo_reserve(&pseudo_canon(w)), "{w}");
    }
    for w in ["modérateur", "modération", "équipe", "système", "sécurité"] {
        assert!(PSEUDOS_RESERVES.contains(&w), "{w}");
    }
    assert!(!pseudo_reserve(&pseudo_canon("Léa")));
    assert!(!pseudo_reserve(""));
}

#[test]
fn deriver_refuse_un_mot_de_passe_vide_sans_calcul() {
    assert_eq!(
        deriver("", "lea@exemple.fr").unwrap_err().to_string(),
        "mot_de_passe_vide"
    );
}
