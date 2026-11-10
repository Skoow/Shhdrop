// Rejoue les sections `encoding`, `password`, `link`, `hkdf`, `sha256`, `argon2id`, `access`,
// `content` et `envelope` de engine/vectors/v2.json (produites par l'ancien moteur TypeScript) :
// chaque cas, sans exception, doit redonner la même sortie ou le même message d'erreur.
mod support;

use serde_json::Value;
use shhdrop_core::encoding::{b64u, unb64u};
use shhdrop_core::envelope::{
    access_keys, content_keys, content_keys_checked, open, seal, share_id,
};
use shhdrop_core::kdf::{
    KDF_CREATE, KDF_MAX, KDF_MIN, derive_access, hkdf, password_key, password_key_for_create,
    sha256,
};
use shhdrop_core::link::{
    ParsedLink, check_origin, manage_link, parse_link, share_link, share_link_with_password,
    split_password,
};
use shhdrop_core::password::{generate, is_generated};
use shhdrop_core::platform::{KeyHandle, Platform};
use shhdrop_core::{Error, KLien, KMdp, SGestion, Seed};
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
fn same_key(p: &impl Platform, k: KeyHandle, raw: &[u8], what: &str) {
    let raw: [u8; 32] = raw.try_into().expect("32 octets");
    let r = block_on(p.aes_import(Zeroizing::new(raw))).unwrap();
    let probe = |h| block_on(p.aes_seal_batch(h, b"sonde", &[[7; 12]], &seq(16), 16)).unwrap();
    assert_eq!(probe(k), probe(r), "{what}");
    p.aes_drop(r);
}

/// En-tête de 48 octets : « SHH2 », version 2, 11 octets nuls, engagement (format, Task 6).
fn header(engagement: &[u8; 32]) -> Vec<u8> {
    [&b"SHH2\x02"[..], &[0; 11], &engagement[..]].concat()
}

#[test]
fn access_cases() {
    let v = vectors();
    let cases = v["access"].as_array().unwrap();
    let p = platform(1);
    let (mut ok, mut refused) = (0, 0);
    for c in cases {
        if let Value::String(e) = &c["error"] {
            // Le générateur a passé `seq(n)` de la taille donnée dans le nom du cas.
            let got: Result<(), Error> = match c["name"].as_str().unwrap() {
                "deriveAccess : K_lien de 31 octets" => {
                    KLien::from_slice(&seq(31)).map(|k| drop(derive_access(&k)))
                }
                "shareId : K_lien de 33 octets" => KLien::from_slice(&seq(33)).map(drop),
                "accessKeys : K_lien de 31 octets" => KLien::from_slice(&seq(31))
                    .and_then(|l| KMdp::from_slice(&seq(32)).map(|m| (l, m)))
                    .map(drop),
                "accessKeys : K_mdp de 31 octets" => KLien::from_slice(&seq(32))
                    .and_then(|l| KMdp::from_slice(&seq(31)).map(|m| (l, m)))
                    .map(drop),
                other => panic!("refus inconnu dans les vecteurs : {other}"),
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
        same_key(&p, ak.k_env, &hexf(c, "k_env"), "k_env");
        assert_eq!(ak.k_preuve.as_bytes().to_vec(), hexf(c, "k_preuve"), "{c}");
        assert_eq!(ak.v_preuve.to_vec(), hexf(c, "v_preuve"), "{c}");
        p.aes_drop(ak.k_env);
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
            same_key(&p, ck.k_contenu, &hexf(c, "k_contenu"), "k_contenu");
            // probe = AES-GCM(K_contenu, nonce(0, faux) = 12 zéros, en-tête, probe_plain).
            let probe = block_on(p.aes_seal_batch(
                ck.k_contenu,
                &header(&ck.engagement),
                &[[0; 12]],
                &hexf(c, "probe_plain"),
                16,
            ))
            .unwrap();
            assert_eq!(probe, hexf(c, "probe"), "{c}");
            p.aes_drop(ck.k_contenu);
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
                    &p,
                    ak.k_env,
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
                let got = block_on(open(&p, ak.k_env, &e, &id, &hdr));
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
    assert!(refused >= 10, "{refused}");
}
