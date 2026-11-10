// Rejoue les sections `encoding`, `password` et `link` de engine/vectors/v2.json (produites par
// l'ancien moteur TypeScript) : chaque cas, sans exception, doit redonner la même sortie ou le
// même message d'erreur.
use serde_json::Value;
use shhdrop_core::encoding::{b64u, unb64u};
use shhdrop_core::link::{
    ParsedLink, check_origin, manage_link, parse_link, share_link, share_link_with_password,
    split_password,
};
use shhdrop_core::password::{generate, is_generated};
use shhdrop_core::{KLien, SGestion};

fn vectors() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../vectors/v2.json");
    let text = std::fs::read_to_string(path).expect("lecture de v2.json");
    serde_json::from_str(&text).expect("JSON de v2.json")
}

fn unhex(s: &str) -> Vec<u8> {
    assert!(s.len().is_multiple_of(2), "hex de longueur impaire : {s}");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex"))
        .collect()
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
        };
        let pw = generate(&mut rng);
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
