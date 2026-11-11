// Rejoue les sections `encoding`, `password`, `link`, `hkdf`, `sha256`, `argon2id`, `access`,
// `content`, `envelope`, `constants`, `header`, `nonce`, `manifest` (texte JSON exact),
// `sizing` (toutes ses fonctions), `element`, `manifest` (sealFinal) et `share` (pièces, en-tête,
// morceau du manifeste, segments assemblés) de engine/vectors/v2.json (produites par l'ancien moteur TypeScript) :
// chaque cas, sans exception, doit redonner la même sortie ou le même message d'erreur.
mod support;

use serde_json::Value;
use shhdrop_core::encoding::{b64u, unb64u};
use shhdrop_core::envelope::{
    access_keys, content_keys, content_keys_checked, open, seal, share_id,
};
use shhdrop_core::format;
use shhdrop_core::kdf::{
    KDF_CREATE, KDF_MAX, KDF_MIN, derive_access, hkdf, password_key, password_key_for_create,
    sha256,
};
use shhdrop_core::link::{
    ParsedLink, check_origin, manage_link, parse_link, share_link, share_link_with_password,
    split_password,
};
use shhdrop_core::manifest::{self, Clean, Entry, Kind, Manifest, Rights};
use shhdrop_core::native::RustCrypto;
use shhdrop_core::password::{generate, is_generated};
use shhdrop_core::platform::{Key, Platform};
use shhdrop_core::{Error, KLien, KMdp, SGestion, Seed};
use std::rc::Rc;
use support::{block_on, platform, replay, unhex};
use zeroize::Zeroizing;

fn vectors() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../vectors/v2.json");
    let text = std::fs::read_to_string(path).expect("lecture de v2.json");
    serde_json::from_str(&text).expect("JSON de v2.json")
}

fn key32(s: &str) -> [u8; 32] {
    unhex(s).try_into().expect("32 octets")
}

fn arg(case: &Value, i: usize) -> &str {
    case["args"][i].as_str().expect("argument texte")
}

/// Compare un résultat au cas : `result` attendu, ou `error` (message exact).
fn check<T: PartialEq + std::fmt::Debug>(
    case: &Value,
    got: Result<T, shhdrop_core::Error>,
    want: impl Fn(&Value) -> T,
) {
    match (&case["error"], got) {
        (Value::String(e), Err(g)) => assert_eq!(g.to_string(), *e, "{case}"),
        (Value::String(e), Ok(g)) => panic!("{case} : attendu l'erreur {e}, obtenu {g:?}"),
        (_, Ok(g)) => assert_eq!(g, want(&case["result"]), "{case}"),
        (_, Err(g)) => panic!("{case} : erreur inattendue {g}"),
    }
}

#[test]
fn encoding() {
    let v = vectors();
    let b = v["encoding"]["b64u"].as_array().unwrap();
    assert!(!b.is_empty());
    for c in b {
        let bytes = unhex(c["bytes"].as_str().unwrap());
        assert_eq!(b64u(&bytes), c["b64u"].as_str().unwrap(), "{c}");
    }
    let u = v["encoding"]["unb64u"].as_array().unwrap();
    assert!(!u.is_empty());
    for c in u {
        let got = unb64u(c["input"].as_str().unwrap());
        check(c, got, |_| unhex(c["bytes"].as_str().unwrap()));
    }
}

#[test]
fn password_generate() {
    let v = vectors();
    let cases = v["password"]["generate"].as_array().unwrap();
    assert!(!cases.is_empty());
    for c in cases {
        let mut draws: Vec<Vec<u8>> = c["random"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| unhex(d.as_str().unwrap()))
            .collect();
        draws.reverse();
        let mut rng = |buf: &mut [u8]| {
            let d = draws.pop().expect("plus de tirages que dans le vecteur");
            assert_eq!(buf.len(), d.len(), "taille du tirage");
            buf.copy_from_slice(&d);
            Ok(())
        };
        let pw = generate(&mut rng).unwrap();
        assert_eq!(pw, c["password"].as_str().unwrap(), "{c}");
        assert!(draws.is_empty(), "tirages non consommés : {c}");
    }
}

#[test]
fn password_is_generated() {
    let v = vectors();
    let cases = v["password"]["is_generated"].as_array().unwrap();
    assert!(!cases.is_empty());
    for c in cases {
        let pw = c["password"].as_str().unwrap();
        assert_eq!(is_generated(pw), c["ok"].as_bool().unwrap(), "{c}");
    }
}

#[derive(Debug, PartialEq)]
struct Parsed {
    kind: &'static str,
    origin: String,
    key: Vec<u8>,
}

fn parsed(p: ParsedLink) -> Parsed {
    match p {
        ParsedLink::Share { origin, k_lien } => Parsed {
            kind: "s",
            origin,
            key: k_lien.as_bytes().to_vec(),
        },
        ParsedLink::Manage { origin, s_gestion } => Parsed {
            kind: "m",
            origin,
            key: s_gestion.as_bytes().to_vec(),
        },
    }
}

/// Seul cas `link` dont le résultat Rust diffère du vecteur (hôte IDN, voir README).
const IDN_LINK: &str = "https://été.example/#MDEyMzQ1Njc4OTo7PD0-P0BBQkNERUZHSElKS0xNTk8";

#[test]
fn link() {
    let v = vectors();
    let cases = v["link"].as_array().unwrap();
    let mut seen = std::collections::BTreeMap::<&str, usize>::new();
    let mut idn_seen = 0;
    for c in cases {
        let f = c["fn"].as_str().unwrap();
        *seen.entry(f).or_default() += 1;
        match f {
            "shareLink" => {
                let k = KLien::from_bytes(key32(arg(c, 1)));
                check(c, share_link(arg(c, 0), &k, arg(c, 2)), |r| {
                    r.as_str().unwrap().to_owned()
                });
            }
            "manageLink" => {
                let s = SGestion::from_bytes(key32(arg(c, 1)));
                check(c, manage_link(arg(c, 0), &s, arg(c, 2)), |r| {
                    r.as_str().unwrap().to_owned()
                });
            }
            "checkOrigin" => {
                check(c, check_origin(arg(c, 0)), |r| {
                    r.as_str().unwrap().to_owned()
                });
            }
            "parseLink" if arg(c, 0) == IDN_LINK => {
                // Écart propre à JavaScript (engine/vectors/README.md) : `new URL` convertit
                // l'hôte non ASCII en Punycode (UTS 46) ; le moteur Rust refuse tout hôte non
                // ASCII. Le vecteur doit bien porter le résultat JS connu.
                assert_eq!(c["result"]["origin"], "https://xn--t-9fab.example", "{c}");
                assert_eq!(arg(c, 1), "/");
                let got = parse_link(arg(c, 0), arg(c, 1)).map(parsed);
                assert_eq!(got.unwrap_err().to_string(), "lien_invalide", "{c}");
                idn_seen += 1;
            }
            "parseLink" => {
                check(c, parse_link(arg(c, 0), arg(c, 1)).map(parsed), |r| {
                    Parsed {
                        kind: if r["kind"] == "s" { "s" } else { "m" },
                        origin: r["origin"].as_str().unwrap().to_owned(),
                        key: unhex(r["key"].as_str().unwrap()),
                    }
                });
            }
            "shareLinkWithPassword" => {
                let got = share_link_with_password(arg(c, 0), arg(c, 1));
                if c["error"] == "Invalid URL" {
                    // Écart propre à JavaScript (engine/vectors/README.md) : `new URL` y lève
                    // « Invalid URL » sur une adresse illisible ; le moteur Rust rend
                    // `lien_invalide`, comme pour tout autre lien refusé.
                    assert_eq!(got.unwrap_err().to_string(), "lien_invalide", "{c}");
                } else {
                    check(c, got, |r| r.as_str().unwrap().to_owned());
                }
            }
            "splitPassword" => {
                let (href, pw) = split_password(arg(c, 0));
                let r = &c["result"];
                assert_eq!(href, r["href"].as_str().unwrap(), "{c}");
                assert_eq!(pw.as_deref(), r["password"].as_str(), "{c}");
            }
            other => panic!("fonction inconnue dans les vecteurs : {other}"),
        }
    }
    assert_eq!(idn_seen, 1, "écart IDN documenté : un seul cas attendu");
    // Chaque fonction de link.ts a ses cas : aucune section vidée par erreur.
    for f in [
        "shareLink",
        "manageLink",
        "checkOrigin",
        "parseLink",
        "shareLinkWithPassword",
        "splitPassword",
    ] {
        assert!(seen.get(f).copied().unwrap_or(0) > 0, "aucun cas pour {f}");
    }
}

#[test]
fn hkdf_cases() {
    let v = vectors();
    let cases = v["hkdf"].as_array().unwrap();
    assert!(!cases.is_empty());
    for c in cases {
        let ikm = unhex(c["ikm"].as_str().unwrap());
        let info = c["info"].as_str().unwrap();
        // Longueur fixée à la compilation : une branche par longueur des vecteurs.
        let okm = match c["len"].as_u64().unwrap() {
            16 => hkdf::<16>(&ikm, info).to_vec(),
            32 => hkdf::<32>(&ikm, info).to_vec(),
            42 => hkdf::<42>(&ikm, info).to_vec(),
            n => panic!("longueur HKDF absente du test : {n}"),
        };
        assert_eq!(okm, unhex(c["okm"].as_str().unwrap()), "{c}");
    }
}

#[test]
fn sha256_cases() {
    let v = vectors();
    let cases = v["sha256"].as_array().unwrap();
    assert!(!cases.is_empty());
    for c in cases {
        let d = sha256(&unhex(c["input"].as_str().unwrap()));
        assert_eq!(d.to_vec(), unhex(c["digest"].as_str().unwrap()), "{c}");
    }
}

#[test]
fn kdf_constants() {
    let v = vectors();
    for (name, p) in [
        ("KDF_MIN", KDF_MIN),
        ("KDF_MAX", KDF_MAX),
        ("KDF_CREATE", KDF_CREATE),
    ] {
        let c = &v["constants"][name];
        assert_eq!(c["ops"].as_u64(), Some(u64::from(p.ops)), "{name}");
        assert_eq!(c["mem"].as_u64(), Some(u64::from(p.mem)), "{name}");
    }
}

#[test]
fn argon2id_cases() {
    let v = vectors();
    let cases = v["argon2id"].as_array().unwrap();
    let mut computed = 0;
    let mut not_applicable = 0;
    for c in cases {
        let pw = c["password"].as_str().unwrap();
        // L'entrée est bien le texte du vecteur (avant NFC).
        assert_eq!(
            pw.as_bytes(),
            unhex(c["password_utf8"].as_str().unwrap()),
            "{c}"
        );
        let salt = unhex(c["salt"].as_str().unwrap());
        let (Some(ops), Some(mem)) = (
            c["ops"].as_u64().and_then(|x| u32::try_from(x).ok()),
            c["mem"].as_u64().and_then(|x| u32::try_from(x).ok()),
        ) else {
            // Sans objet en Rust (engine/vectors/README.md) : paramètre non entier ou négatif,
            // impossible à écrire en `u32`. JavaScript le refusait comme « invalides ».
            assert_eq!(c["error"], "paramètres KDF invalides", "{c}");
            not_applicable += 1;
            continue;
        };
        let got = match c["fn"].as_str().unwrap() {
            "passwordKey" => password_key(pw, &salt, ops, mem),
            "passwordKeyForCreate" => {
                // `passwordKeyForCreate` impose KDF_CREATE : le vecteur doit le refléter.
                assert_eq!((ops, mem), (KDF_CREATE.ops, KDF_CREATE.mem), "{c}");
                password_key_for_create(pw, &salt)
            }
            other => panic!("fonction inconnue dans les vecteurs : {other}"),
        };
        if c["error"].is_null() {
            computed += 1;
        }
        check(c, got.map(|k| k.as_bytes().to_vec()), |_| {
            unhex(c["key"].as_str().unwrap())
        });
    }
    assert_eq!(computed, 3, "clés calculées attendues");
    assert_eq!(
        not_applicable, 1,
        "un seul cas sans objet attendu (ops: 2.5)"
    );
}

fn hexf(c: &Value, f: &str) -> Vec<u8> {
    unhex(
        c[f].as_str()
            .unwrap_or_else(|| panic!("champ {f} absent : {c}")),
    )
}

/// `n` octets 0, 1, 2, … (entrée `seq` du générateur).
fn seq(n: usize) -> Vec<u8> {
    (0..n).map(|i| i as u8).collect()
}

/// Vérifie qu'une poignée tient la clé brute `raw` du vecteur : la même sonde AES-GCM sous la
/// poignée et sous `raw` importée donne le même chiffré (la clé ne sort jamais du fournisseur).
fn same_key(p: &Rc<RustCrypto>, k: &Key<RustCrypto>, raw: &[u8], what: &str) {
    let raw: [u8; 32] = raw.try_into().expect("32 octets");
    let r = block_on(Key::import(p, Zeroizing::new(raw))).unwrap();
    let probe =
        |h: &Key<RustCrypto>| block_on(h.seal_batch(b"sonde", &[[7; 12]], &seq(16), 16)).unwrap();
    assert_eq!(probe(k), probe(&r), "{what}");
}

/// En-tête de 48 octets : « SHH2 », version 2, 11 octets nuls, engagement.
fn header(engagement: &[u8; 32]) -> Vec<u8> {
    format::header(engagement).to_vec()
}

#[test]
fn access_cases() {
    let v = vectors();
    let cases = v["access"].as_array().unwrap();
    let p = platform(1);
    let (mut ok, mut refused) = (0, 0);
    for c in cases {
        if let Value::String(e) = &c["error"] {
            // Entrées de taille libre lues dans le vecteur ; K_lien est vérifiée avant K_mdp,
            // comme dans `accessKeys`.
            let k_lien = || KLien::from_slice(&hexf(c, "k_lien"));
            let got: Result<(), Error> = match c["fn"].as_str().unwrap() {
                "deriveAccess" => k_lien().map(|k| drop(derive_access(&k))),
                "shareId" => k_lien().map(|k| {
                    share_id(&k);
                }),
                "accessKeys" => k_lien()
                    .and_then(|l| KMdp::from_slice(&hexf(c, "k_mdp")).map(|m| (l, m)))
                    .and_then(|(l, m)| block_on(access_keys(&p, &l, &m)).map(drop)),
                other => panic!("fonction inconnue dans les vecteurs : {other}"),
            };
            assert_eq!(got.unwrap_err().to_string(), *e, "{c}");
            refused += 1;
            continue;
        }
        let k_lien = KLien::from_slice(&hexf(c, "k_lien")).unwrap();
        let k_mdp = KMdp::from_slice(&hexf(c, "k_mdp")).unwrap();
        let a = derive_access(&k_lien);
        assert_eq!(a.k_acces.as_bytes().to_vec(), hexf(c, "k_acces"), "{c}");
        assert_eq!(a.v_acces.to_vec(), hexf(c, "v_acces"), "{c}");
        assert_eq!(share_id(&k_lien).to_vec(), hexf(c, "id"), "{c}");
        // K_maître et K_env ne sortent pas du moteur : le vecteur est vérifié par sa chaîne HKDF
        // (K_maître → K_env, K_preuve), puis K_env contre la poignée rendue par access_keys.
        let ikm = [&k_lien.as_bytes()[..], &k_mdp.as_bytes()[..]].concat();
        let k_maitre = hkdf::<32>(&ikm, "shhdrop/v2/maitre");
        assert_eq!(k_maitre.to_vec(), hexf(c, "k_maitre"), "{c}");
        let k_env = hkdf::<32>(&*k_maitre, "shhdrop/v2/enveloppe");
        assert_eq!(k_env.to_vec(), hexf(c, "k_env"), "{c}");
        let ak = block_on(access_keys(&p, &k_lien, &k_mdp)).unwrap();
        same_key(&p, &ak.k_env, &hexf(c, "k_env"), "k_env");
        assert_eq!(ak.k_preuve.as_bytes().to_vec(), hexf(c, "k_preuve"), "{c}");
        assert_eq!(ak.v_preuve.to_vec(), hexf(c, "v_preuve"), "{c}");
        ok += 1;
    }
    assert_eq!((ok, refused), (2, 4));
}

#[test]
fn content_cases() {
    let v = vectors();
    let cases = v["content"].as_array().unwrap();
    let p = platform(1);
    let (mut ok, mut refused) = (0, 0);
    for c in cases {
        let r = Seed::from_slice(&hexf(c, "r"));
        if let Value::String(e) = &c["error"] {
            let got = match c["fn"].as_str().unwrap() {
                "contentKeys" => r.and_then(|r| block_on(content_keys(&p, &r))),
                "contentKeysChecked" => {
                    r.and_then(|r| block_on(content_keys_checked(&p, &r, &hexf(c, "engagement"))))
                }
                other => panic!("fonction inconnue dans les vecteurs : {other}"),
            };
            assert_eq!(got.err().map(|g| g.to_string()), Some(e.clone()), "{c}");
            refused += 1;
            continue;
        }
        let r = r.unwrap();
        let engagement = hexf(c, "engagement");
        for checked in [false, true] {
            let ck = if checked {
                block_on(content_keys_checked(&p, &r, &engagement)).unwrap()
            } else {
                block_on(content_keys(&p, &r)).unwrap()
            };
            assert_eq!(ck.engagement.to_vec(), engagement, "{c}");
            same_key(&p, &ck.k_contenu, &hexf(c, "k_contenu"), "k_contenu");
            // probe = AES-GCM(K_contenu, nonce(0, faux), en-tête, probe_plain).
            let probe = block_on(ck.k_contenu.seal_batch(
                &header(&ck.engagement),
                &[format::nonce(0, false)],
                &hexf(c, "probe_plain"),
                16,
            ))
            .unwrap();
            assert_eq!(probe, hexf(c, "probe"), "{c}");
        }
        assert_eq!(
            hkdf::<32>(r.as_bytes(), "shhdrop/v2/contenu").to_vec(),
            hexf(c, "k_contenu")
        );
        ok += 1;
    }
    assert_eq!((ok, refused), (2, 4));
}

#[test]
fn envelope_cases() {
    let v = vectors();
    let cases = v["envelope"].as_array().unwrap();
    let (mut sealed, mut opened, mut refused) = (0, 0, 0);
    for c in cases {
        let k_lien = KLien::from_slice(&hexf(c, "k_lien")).unwrap();
        let k_mdp = KMdp::from_slice(&hexf(c, "k_mdp")).unwrap();
        let (e, id, hdr) = (hexf(c, "e"), hexf(c, "id"), hexf(c, "header"));
        match c["fn"].as_str().unwrap() {
            "seal" => {
                let draws = c["random"].as_array().unwrap();
                let p = replay(draws.iter().map(|d| unhex(d.as_str().unwrap())).collect());
                let ak = block_on(access_keys(&p, &k_lien, &k_mdp)).unwrap();
                let r = Seed::from_slice(&hexf(c, "r")).unwrap();
                // L'en-tête du vecteur est bien celui de R (engagement compris).
                let eng = block_on(content_keys(&p, &r)).unwrap().engagement;
                assert_eq!(header(&eng), hdr, "{c}");
                assert_eq!(share_id(&k_lien).to_vec(), id, "{c}");
                let got = block_on(seal(
                    &ak.k_env,
                    &r,
                    &id.clone().try_into().unwrap(),
                    &hdr.clone().try_into().unwrap(),
                ))
                .unwrap();
                assert_eq!(got, e, "{c}");
                // Tous les tirages du vecteur consommés : au-delà, replay échoue.
                assert!(p.random(&mut []).is_err(), "tirage non consommé : {c}");
                sealed += 1;
            }
            "open" => {
                let p = platform(1);
                let ak = block_on(access_keys(&p, &k_lien, &k_mdp)).unwrap();
                let got = block_on(open(&ak.k_env, &e, &id, &hdr));
                check(c, got.map(|s| s.as_bytes().to_vec()), |_| hexf(c, "r"));
                if c["error"].is_null() {
                    opened += 1;
                } else {
                    assert_eq!(c["error"], "paquet_corrompu", "{c}");
                    refused += 1;
                }
            }
            other => panic!("fonction inconnue dans les vecteurs : {other}"),
        }
    }
    assert_eq!((sealed, opened), (1, 1));
    assert_eq!(refused, 10);
}

#[test]
fn format_constants() {
    let v = vectors();
    let c = &v["constants"];
    let n = |name: &str| c[name].as_u64().unwrap_or_else(|| panic!("{name}"));
    assert_eq!(n("CHUNK"), format::CHUNK as u64);
    assert_eq!(n("TAG"), format::TAG as u64);
    assert_eq!(n("CHUNK_CT"), format::CHUNK_CT as u64);
    assert_eq!(n("HEADER"), format::HEADER as u64);
    assert_eq!(n("SEG_CHUNKS"), u64::from(format::SEG_CHUNKS));
    assert_eq!(n("MANIFEST_MAX"), format::MANIFEST_MAX as u64);
    assert_eq!(n("CONTENT_MAX"), format::CONTENT_MAX);
    assert_eq!(n("MAX_ITEMS"), format::MAX_ITEMS as u64);
    assert_eq!(n("TEXT_MAX"), format::TEXT_MAX as u64);
    assert_eq!(n("TEXT_BYTES_MAX"), format::TEXT_BYTES_MAX);
    assert_eq!(n("PREVIEW_MAX"), format::PREVIEW_MAX);
    let buckets: Vec<u64> = c["BUCKETS"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b.as_u64().unwrap())
        .collect();
    assert_eq!(buckets, format::BUCKETS.map(u64::from).to_vec());
}

#[test]
fn header_cases() {
    let v = vectors();
    let cases = v["header"].as_array().unwrap();
    let (mut built, mut read, mut refused, mut not_applicable) = (0, 0, 0, 0);
    for c in cases {
        match c["fn"].as_str().unwrap() {
            "header" => {
                let eng = hexf(c, "engagement");
                // Engagement de 31 ou 33 octets : impossible en Rust ([u8; 32] par type).
                let Ok(eng) = <[u8; 32]>::try_from(eng.as_slice()) else {
                    assert_eq!(c["error"], "engagement invalide", "{c}");
                    not_applicable += 1;
                    continue;
                };
                assert_eq!(format::header(&eng).to_vec(), hexf(c, "header"), "{c}");
                built += 1;
            }
            "readHeader" => {
                let got = format::read_header(&hexf(c, "seg0"));
                check(c, got.map(|(h, e)| (h.to_vec(), e.to_vec())), |_| {
                    (hexf(c, "header"), hexf(c, "engagement"))
                });
                if c["error"].is_null() {
                    read += 1;
                } else {
                    refused += 1;
                }
            }
            other => panic!("fonction inconnue dans les vecteurs : {other}"),
        }
    }
    assert_eq!((built, read, refused, not_applicable), (3, 2, 7, 2));
}

#[test]
fn nonce_cases() {
    let v = vectors();
    let cases = v["nonce"].as_array().unwrap();
    assert_eq!(cases.len(), 28);
    for c in cases {
        let got = format::nonce(c["index"].as_u64().unwrap(), c["last"].as_bool().unwrap());
        assert_eq!(got.to_vec(), hexf(c, "nonce"), "{c}");
    }
}

#[test]
fn sizing_cases() {
    let v = vectors();
    let s = &v["sizing"];
    // bucketFor : entrée négative ou non entière impossible en u64 (sans objet, README « Écarts »).
    let (mut replayed, mut not_applicable) = (0, 0);
    for c in s["bucketFor"].as_array().unwrap() {
        let Some(input) = c["input"].as_u64() else {
            assert_eq!(c["error"], "taille_invalide", "{c}");
            not_applicable += 1;
            continue;
        };
        check(c, format::bucket_for(input), |r| r.as_u64().unwrap() as u32);
        replayed += 1;
    }
    assert_eq!((replayed, not_applicable), (40, 2));
    let counts = s["segmentCount"].as_array().unwrap();
    assert_eq!(counts.len(), format::BUCKETS.len());
    for c in counts {
        let b = c["input"].as_u64().unwrap() as u32;
        assert_eq!(
            u64::from(format::segment_count(b)),
            c["result"].as_u64().unwrap(),
            "{c}"
        );
    }
    let sizes = s["segmentSize"].as_array().unwrap();
    assert!(sizes.len() >= 30);
    for c in sizes {
        let (b, n) = (
            c["bucket"].as_u64().unwrap() as u32,
            c["n"].as_u64().unwrap() as u32,
        );
        assert_eq!(
            format::segment_size(b, n).map(|x| x as u64),
            Some(c["result"].as_u64().unwrap()),
            "{c}"
        );
    }
}

/// Manifeste attendu d'un cas de `manifest` (entrées de `sealFinal`) : offset = premier morceau
/// × CHUNK (0 pour un élément vide), `clean` des fichiers seulement.
fn manifest_of(c: &Value) -> Manifest {
    let rights = Rights::new(
        c["rights"].as_str().unwrap_or("enregistrer"),
        c["keep_ttl_h"].as_u64(),
    )
    .unwrap();
    let items = c["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            let size = e["size"].as_u64().unwrap();
            let first = e["first"].as_u64().unwrap();
            Entry {
                kind: match e["kind"].as_str().unwrap() {
                    "text" => Kind::Text,
                    _ => Kind::File,
                },
                name: e["name"].as_str().unwrap().to_owned(),
                mime: e["mime"].as_str().unwrap().to_owned(),
                size,
                offset: if size == 0 {
                    0
                } else {
                    first * format::CHUNK as u64
                },
                text: None,
                k: Some(Zeroizing::new(key32(e["k"].as_str().unwrap()))),
                clean: e["clean"].as_str().map(|s| Clean::from_name(s).unwrap()),
            }
        })
        .collect();
    Manifest { rights, items }
}

#[test]
fn manifest_json_cases() {
    let v = vectors();
    let mut cases: Vec<&Value> = v["manifest"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["error"].is_null())
        .collect();
    assert_eq!(cases.len(), 9);
    cases.push(&v["share"]);
    for c in cases {
        let want = c["manifest_json"].as_str().unwrap().as_bytes();
        // Écrit par le moteur Rust : octet pour octet le JSON.stringify de l'ancien moteur.
        if c.get("entries").is_some() {
            assert_eq!(*manifest::to_json(&manifest_of(c)), want, "{}", c["name"]);
        }
        // Relu puis réécrit : mêmes octets.
        let m = manifest::parse(want, format::CONTENT_MAX).unwrap();
        if c.get("entries").is_some() {
            assert_eq!(m, manifest_of(c), "{}", c["name"]);
        }
        assert_eq!(*manifest::to_json(&m), want, "{}", c["name"]);
    }
}

/// Entrée entière d'un cas, ou `None` pour une entrée propre à JavaScript (négative, non
/// entière) : sans objet en `u64` (README, « Écarts propres à JavaScript »).
fn input_u64(c: &Value) -> Option<u64> {
    c["input"].as_u64()
}

#[test]
fn sizing_element_cases() {
    use shhdrop_core::elements::{
        chunks_for, footprint_for, is_small, reservation_for, segments_for, segments_needed,
    };
    let v = vectors();
    let s = &v["sizing"];
    let (mut replayed, mut not_applicable) = (0, 0);
    for (name, f) in [
        (
            "segmentsFor",
            segments_for as fn(u64) -> shhdrop_core::Result<u64>,
        ),
        ("chunksFor", chunks_for),
        ("footprintFor", footprint_for),
    ] {
        for c in s[name].as_array().unwrap() {
            let Some(n) = input_u64(c) else {
                assert_eq!(c["error"], "taille_invalide", "{c}");
                not_applicable += 1;
                continue;
            };
            check(c, f(n), |r| r.as_u64().unwrap());
            replayed += 1;
        }
    }
    for c in s["isSmall"].as_array().unwrap() {
        let Some(n) = input_u64(c) else {
            not_applicable += 1; // -1 et 0.5 : impossibles en u64
            continue;
        };
        assert_eq!(is_small(n), c["result"].as_bool().unwrap(), "{c}");
        replayed += 1;
    }
    for c in s["reservationFor"].as_array().unwrap() {
        let Some(n) = input_u64(c) else {
            assert_eq!(c["error"], "trop_gros", "{c}");
            not_applicable += 1;
            continue;
        };
        check(c, reservation_for(n), |r| r.as_u64().unwrap() as u32);
        replayed += 1;
    }
    for c in s["segmentsNeeded"].as_array().unwrap() {
        let sizes: Vec<u64> = c["input"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_u64().unwrap())
            .collect();
        check(c, segments_needed(&sizes), |r| r.as_u64().unwrap());
        replayed += 1;
    }
    assert_eq!(
        (replayed, not_applicable),
        (12 * 3 + 12 + 514 + 11, 2 * 3 + 2 + 2)
    );
}

#[test]
fn element_cases() {
    use shhdrop_core::elements::{ElementSealer, Piece};
    let v = vectors();
    let cases = v["element"].as_array().unwrap();
    let (mut ok, mut refused, mut not_applicable) = (0, 0, 0);
    for c in cases {
        let (Some(size), Some(first)) = (c["size"].as_u64(), c["first"].as_u64()) else {
            // `first` −1 ou 1.5 : impossible en u64.
            assert_eq!(c["error"], "trop_gros", "{c}");
            not_applicable += 1;
            continue;
        };
        // Aléa rejoué : un refus ne tire rien (au-delà des tirages, l'aléa échoue).
        let draws = c["random"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| unhex(d.as_str().unwrap()))
            .collect();
        let p = replay(draws);
        match (block_on(ElementSealer::new(&p, size, first)), &c["error"]) {
            (Err(e), Value::String(want)) => {
                assert_eq!(e.to_string(), *want, "{c}");
                refused += 1;
            }
            (Ok(el), Value::Null) => {
                assert_eq!(el.k().to_vec(), hexf(c, "k"), "{c}");
                let want: Vec<Piece> = c["pieces"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| Piece {
                        seg: p["seg"].as_u64().unwrap() as u32,
                        from: p["from"].as_u64().unwrap() as u32,
                        chunks: p["chunks"].as_u64().unwrap() as u32,
                    })
                    .collect();
                assert_eq!(el.pieces(), want, "{c}");
                ok += 1;
            }
            (got, _) => panic!("{c} : obtenu {:?}", got.map(|e| e.pieces().to_vec())),
        }
    }
    assert_eq!(ok + refused + not_applicable, cases.len());
    assert!(ok >= 10 && refused >= 5, "{ok} {refused}");
    assert_eq!(not_applicable, 2);
}

/// Entrées de `sealFinal` d'un cas (`manifest`, ou `share.items`).
fn final_entries(entries: &Value) -> Vec<shhdrop_core::elements::FinalEntry> {
    use shhdrop_core::elements::{FinalEntry, FinalKind};
    entries
        .as_array()
        .unwrap()
        .iter()
        .map(|e| FinalEntry {
            kind: match e["kind"].as_str().unwrap() {
                "text" => FinalKind::Text,
                _ => FinalKind::File(e["clean"].as_str().map(|s| Clean::from_name(s).unwrap())),
            },
            name: e["name"].as_str().unwrap().to_owned(),
            mime: e["mime"].as_str().unwrap().to_owned(),
            size: e["size"].as_u64().unwrap(),
            first: e["first"].as_u64().unwrap(),
            k: Zeroizing::new(key32(e["k"].as_str().unwrap())),
        })
        .collect()
}

#[test]
fn seal_final_cases() {
    use shhdrop_core::elements::seal_final;
    let v = vectors();
    let cases = v["manifest"].as_array().unwrap();
    assert_eq!(cases.len(), 16);
    let p = platform(1);
    let mut refused = 0;
    for c in cases {
        let r = Seed::from_slice(&hexf(c, "r")).unwrap();
        let keys = block_on(content_keys(&p, &r)).unwrap();
        let got = block_on(seal_final(
            &final_entries(&c["entries"]),
            &keys,
            c["rights"].as_str(),
            c["keep_ttl_h"].as_u64(),
        ));
        match (&c["error"], got) {
            (Value::String(e), Err(g)) => {
                assert_eq!(g.to_string(), *e, "{}", c["name"]);
                refused += 1;
            }
            (Value::Null, Ok(fin)) => {
                assert_eq!(
                    u64::from(fin.bucket),
                    c["bucket"].as_u64().unwrap(),
                    "{}",
                    c["name"]
                );
                assert_eq!(fin.header.to_vec(), hexf(c, "header"), "{}", c["name"]);
                assert_eq!(
                    sha256(&fin.tail).to_vec(),
                    hexf(c, "tail_sha256"),
                    "{}",
                    c["name"]
                );
            }
            (_, got) => panic!("{} : obtenu {:?}", c["name"], got.map(|f| f.bucket)),
        }
    }
    assert_eq!(refused, 7);
}

/// Clair d'un élément de `share` : texte UTF-8, ou flux xorshift32 (README, « Gros clairs »).
fn share_plain(item: &Value) -> Vec<u8> {
    let plain = &item["plain"];
    if let Some(t) = plain["utf8"].as_str() {
        return t.as_bytes().to_vec();
    }
    let x = &plain["xorshift32"];
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

#[test]
fn share_segments_cases() {
    use shhdrop_core::elements::{ElementSealer, seal_final};
    let v = vectors();
    let sh = &v["share"];
    let mut segs: Vec<Vec<u8>> = sh["segments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| vec![0; s["size"].as_u64().unwrap() as usize])
        .collect();
    let bucket = sh["bucket"].as_u64().unwrap() as u32;
    assert_eq!(segs.len() as u32, format::segment_count(bucket));
    for item in sh["items"].as_array().unwrap() {
        let plain = share_plain(item);
        assert_eq!(sha256(&plain).to_vec(), hexf(item, "plain_sha256"));
        let p = replay(vec![hexf(item, "k")]);
        let el = block_on(ElementSealer::new(
            &p,
            item["size"].as_u64().unwrap(),
            item["first"].as_u64().unwrap(),
        ))
        .unwrap();
        let want = item["pieces"].as_array().unwrap();
        assert_eq!(el.pieces().len(), want.len());
        for (j, w) in want.iter().enumerate() {
            let pc = el.pieces()[j];
            assert_eq!(u64::from(pc.seg), w["seg"].as_u64().unwrap());
            assert_eq!(u64::from(pc.from), w["from"].as_u64().unwrap());
            assert_eq!(u64::from(pc.chunks), w["chunks"].as_u64().unwrap());
            let (lo, hi) = el.range(j).unwrap();
            let got = block_on(el.piece(j, &plain[lo as usize..hi as usize])).unwrap();
            assert_eq!(got.len() as u64, w["len"].as_u64().unwrap());
            assert_eq!(
                sha256(&got).to_vec(),
                hexf(w, "sha256"),
                "{} pièce {j}",
                item["name"]
            );
            if let Some(b) = w["b64u"].as_str() {
                // Segment 0 : la pièce entière, octet pour octet.
                assert_eq!(got, unb64u(b).unwrap(), "{} pièce {j}", item["name"]);
            } else {
                assert_eq!(got[..64].to_vec(), hexf(w, "first64"));
                assert_eq!(got[got.len() - 64..].to_vec(), hexf(w, "last64"));
            }
            // Assemblage du fichier du serveur (README, `share`).
            let at = match (pc.seg, pc.from) {
                (0, 0) => 0,
                (0, f) => format::HEADER + f as usize * format::CHUNK_CT,
                (_, f) => f as usize * format::CHUNK_CT,
            };
            segs[pc.seg as usize][at..at + got.len()].copy_from_slice(&got);
        }
    }
    // Manifeste final : en-tête et morceau du manifeste octet pour octet.
    let r = Seed::from_slice(&hexf(sh, "r")).unwrap();
    let p = platform(1);
    let keys = block_on(content_keys(&p, &r)).unwrap();
    let fin = block_on(seal_final(
        &final_entries(&sh["items"]),
        &keys,
        sh["rights"].as_str(),
        None,
    ))
    .unwrap();
    assert_eq!(fin.bucket, bucket);
    assert_eq!(fin.header.to_vec(), hexf(sh, "header"));
    assert_eq!(fin.tail, unb64u(sh["tail"].as_str().unwrap()).unwrap());
    assert_eq!(sha256(&fin.tail).to_vec(), hexf(sh, "tail_sha256"));
    segs[0][..format::HEADER].copy_from_slice(&fin.header);
    let last = segs.last_mut().unwrap();
    let n = last.len();
    last[n - format::CHUNK_CT..].copy_from_slice(&fin.tail);
    for (s, w) in segs.iter().zip(sh["segments"].as_array().unwrap()) {
        assert_eq!(
            sha256(s).to_vec(),
            hexf(w, "sha256_zero_filled"),
            "segment {}",
            w["n"]
        );
    }
}
