// Manifeste (lecture stricte, droits, écriture) et paliers : cas de crypto/container.test.ts
// portés (« paliers et segments », « parseRights », « openStream : manifeste invalide »,
// « droits invalides refusés à la création »), plus le Review Focus 1 (demi-paire UTF-16 isolée)
// et des entrées hostiles (jamais de panique).
use serde_json::{Value, json};
use shhdrop_core::Error;
use shhdrop_core::format::{
    self, BUCKETS, CHUNK, CHUNK_CT, CONTENT_MAX, HEADER, MANIFEST_MAX, MAX_ITEMS, TEXT_MAX,
    bucket_for, segment_count, segment_size,
};
use shhdrop_core::manifest::{Clean, Entry, KeepTtl, Kind, Manifest, Rights, parse, to_json};
use zeroize::Zeroizing;

const K43: &str = "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk";
/// Fin des données d'un palier 16 (le clair qui précède le manifeste n'est jamais plus court).
const DATA: u64 = 1_000_000;

fn good() -> Value {
    json!({ "v": 2, "rights": "enregistrer", "items": [{ "kind": "file", "name": "a", "mime": "x/y", "size": 3, "offset": 0 }] })
}

fn with_item(f: impl FnOnce(&mut Value)) -> Value {
    let mut m = good();
    f(&mut m["items"][0]);
    m
}

fn bytes(m: &Value) -> Vec<u8> {
    serde_json::to_vec(m).unwrap()
}

fn open(raw: &[u8]) -> Result<Manifest, Error> {
    parse(raw, DATA)
}

fn corrupt(raw: &[u8]) {
    assert_eq!(
        open(raw).err(),
        Some(Error::PaquetCorrompu),
        "{}",
        String::from_utf8_lossy(raw)
    );
}

#[test]
fn paliers_canoniques() {
    assert_eq!(
        BUCKETS,
        [1, 16, 80, 160, 400, 800, 1600, 4000, 8000, 16385, 32769]
    );
    assert_eq!(MANIFEST_MAX, 65_532);
    let room = 4 + MANIFEST_MAX as u64;
    let chunk = CHUNK as u64;
    assert_eq!(room, chunk);
    assert_eq!(bucket_for(0), Ok(1));
    assert_eq!(bucket_for(1), Ok(16));
    assert_eq!(bucket_for(16 * chunk - room), Ok(16));
    assert_eq!(bucket_for(16 * chunk - room + 1), Ok(80));
    for (i, &b) in BUCKETS.iter().enumerate().skip(1) {
        assert_eq!(bucket_for(u64::from(b) * chunk - room), Ok(b));
        if let Some(&next) = BUCKETS.get(i + 1) {
            assert_eq!(bucket_for(u64::from(b) * chunk - room + 1), Ok(next));
        }
    }
    assert_eq!(CONTENT_MAX, 2_147_483_648);
    assert_eq!(bucket_for(CONTENT_MAX), Ok(32769));
    assert_eq!(bucket_for(CONTENT_MAX - 1), Ok(32769));
    assert_eq!(bucket_for(8000 * chunk), Ok(16385));
    assert_eq!(bucket_for(1_073_741_824), Ok(16385));
    assert_eq!(bucket_for(1_073_741_825), Ok(32769));
    assert_eq!(bucket_for(CONTENT_MAX + 1), Err(Error::TropGros));
    assert_eq!(bucket_for(format::MAX_SAFE), Err(Error::TropGros));
    // Au-delà de 2^53 − 1 (Number.isSafeInteger), comme bucketFor : « taille_invalide ».
    assert_eq!(bucket_for(format::MAX_SAFE + 1), Err(Error::TailleNonSure));
    assert_eq!(bucket_for(u64::MAX), Err(Error::TailleNonSure));
    assert_eq!(Error::TropGros.to_string(), "trop_gros");
    assert_eq!(Error::TailleNonSure.to_string(), "taille_invalide");
}

#[test]
fn segments() {
    assert_eq!(segment_count(16), 1);
    assert_eq!(segment_count(80), 2);
    assert_eq!(segment_count(400), 7);
    assert_eq!(segment_count(16385), 257);
    assert_eq!(segment_size(16385, 256), Some(65552));
    assert_eq!(segment_count(32769), 513);
    assert_eq!(segment_size(32769, 512), Some(65552));
    assert_eq!(HEADER as u64 + 32769 * CHUNK_CT as u64, 2_148_073_536);
    assert_eq!(segment_size(1600, 0), Some(48 + 64 * 65552));
    assert_eq!(segment_size(80, 1), Some(16 * 65552));
    for b in BUCKETS {
        let sum: u64 = (0..segment_count(b))
            .map(|n| segment_size(b, n).unwrap() as u64)
            .sum();
        assert_eq!(sum, HEADER as u64 + u64::from(b) * CHUNK_CT as u64);
        // Hors palier : None (jamais de débordement ni de panique).
        assert_eq!(segment_size(b, segment_count(b)), None);
    }
    assert_eq!(segment_size(16, u32::MAX), None);
    assert_eq!(segment_size(0, 0), None);
    assert_eq!(segment_size(u32::MAX, u32::MAX / 64), Some(63 * CHUNK_CT));
    assert_eq!(segment_count(u32::MAX), u32::MAX.div_ceil(64));
}

#[test]
fn en_tete_et_nonce() {
    let eng = [0xab; 32];
    let h = format::header(&eng);
    assert_eq!(&h[..5], b"SHH2\x02");
    assert_eq!(h[5..16], [0; 11]);
    assert_eq!(h[16..], eng);
    let mut seg0 = h.to_vec();
    seg0.extend_from_slice(&[1, 2, 3]);
    assert_eq!(format::read_header(&seg0), Ok((h, eng)));
    for pos in [0, 3, 4, 5, 15] {
        let mut x = h;
        x[pos] ^= 1;
        assert_eq!(format::read_header(&x), Err(Error::PaquetCorrompu), "{pos}");
    }
    // L'engagement n'est pas vérifié ici (l'enveloppe et l'engagement le sont ensuite).
    let mut x = h;
    x[47] ^= 1;
    assert!(format::read_header(&x).is_ok());
    assert_eq!(format::read_header(&[0; 47]), Err(Error::PaquetCorrompu));
    assert_eq!(format::nonce(u64::MAX, true)[3..11], [0xff; 8]);
    assert_eq!(format::nonce(u64::MAX, true)[11], 1);
    assert_eq!(format::nonce(u64::MAX, true)[..3], [0; 3]);
}

#[test]
fn manifeste_valide() {
    let m = open(&bytes(&good())).unwrap();
    assert_eq!(m.rights, Rights::Enregistrer);
    assert_eq!(m.items.len(), 1);
    let e = &m.items[0];
    assert_eq!(
        (e.kind, e.name.as_str(), e.mime.as_str(), e.size, e.offset),
        (Kind::File, "a", "x/y", 3, 0)
    );
    assert!(e.k.is_none() && e.text.is_none() && e.clean.is_none());
}

#[test]
fn manifestes_invalides() {
    let bad: Vec<(&str, Vec<u8>)> = vec![
        ("JSON invalide", b"{x".to_vec()),
        ("vide", b"".to_vec()),
        ("tableau", b"[]".to_vec()),
        ("null", b"null".to_vec()),
        ("chaîne", b"\"coffre\"".to_vec()),
        ("v = 1", bytes(&{ let mut m = good(); m["v"] = json!(1); m })),
        ("v = \"2\"", bytes(&{ let mut m = good(); m["v"] = json!("2"); m })),
        ("v absent", bytes(&json!({ "items": good()["items"] }))),
        ("items absent", bytes(&json!({ "v": 2 }))),
        ("items vide", bytes(&json!({ "v": 2, "items": [] }))),
        ("items objet", bytes(&json!({ "v": 2, "items": {} }))),
        (
            "201 éléments",
            bytes(&json!({ "v": 2, "items": vec![good()["items"][0].clone(); MAX_ITEMS + 1] })),
        ),
        ("élément null", bytes(&json!({ "v": 2, "items": [null] }))),
        ("élément tableau", bytes(&json!({ "v": 2, "items": [[]] }))),
        ("kind inconnu", bytes(&with_item(|e| e["kind"] = json!("exe")))),
        ("kind absent", bytes(&with_item(|e| { e.as_object_mut().unwrap().remove("kind"); }))),
        ("taille négative", bytes(&with_item(|e| e["size"] = json!(-1)))),
        ("taille non entière", bytes(&with_item(|e| e["size"] = json!(1.5)))),
        ("taille en texte", bytes(&with_item(|e| e["size"] = json!("3")))),
        ("taille 2^53", bytes(&with_item(|e| e["size"] = json!(9_007_199_254_740_992u64)))),
        ("offset négatif", bytes(&with_item(|e| e["offset"] = json!(-1)))),
        ("offset absent", bytes(&with_item(|e| { e.as_object_mut().unwrap().remove("offset"); }))),
        ("nom non chaîne", bytes(&with_item(|e| e["name"] = json!(5)))),
        ("nom null", bytes(&with_item(|e| e["name"] = Value::Null))),
        ("type absent", bytes(&with_item(|e| { e.as_object_mut().unwrap().remove("mime"); }))),
        ("fichier avec text", bytes(&with_item(|e| e["text"] = json!("a")))),
        ("fichier avec text null", bytes(&with_item(|e| e["text"] = Value::Null))),
        ("fichier k mal formé", bytes(&with_item(|e| e["k"] = json!("k")))),
        ("fichier k null", bytes(&with_item(|e| e["k"] = Value::Null))),
        ("fichier k hors base64url", bytes(&with_item(|e| e["k"] = json!("+".repeat(43))))),
        // 43 caractères mais bits de bourrage non nuls (« l » = 37) : jamais 32 octets propres.
        ("fichier k non canonique", bytes(&with_item(|e| e["k"] = json!("l".repeat(43))))),
        ("fichier au-delà des données", bytes(&with_item(|e| e["offset"] = json!(DATA - 2)))),
        ("fichier qui commence après les données", bytes(&with_item(|e| { e["offset"] = json!(DATA + 1); e["size"] = json!(0); }))),
        ("texte sans text", bytes(&json!({ "v": 2, "items": [{ "kind": "text", "name": "", "mime": "text/plain", "size": 0, "offset": 0 }] }))),
        ("texte avec taille", bytes(&json!({ "v": 2, "items": [{ "kind": "text", "name": "", "mime": "text/plain", "size": 1, "offset": 0, "text": "a" }] }))),
        ("texte avec offset", bytes(&json!({ "v": 2, "items": [{ "kind": "text", "name": "", "mime": "text/plain", "size": 0, "offset": 1, "text": "a" }] }))),
        ("texte non chaîne", bytes(&json!({ "v": 2, "items": [{ "kind": "text", "name": "", "mime": "text/plain", "size": 0, "offset": 0, "text": 1 }] }))),
        ("note élément avec text", bytes(&json!({ "v": 2, "items": [{ "kind": "text", "name": "", "mime": "text/plain", "size": 1, "offset": 0, "k": K43, "text": "a" }] }))),
        ("note élément k mal formé", bytes(&json!({ "v": 2, "items": [{ "kind": "text", "name": "", "mime": "text/plain", "size": 1, "offset": 0, "k": "k" }] }))),
        ("note élément k null", bytes(&json!({ "v": 2, "items": [{ "kind": "text", "name": "", "mime": "text/plain", "size": 1, "offset": 0, "k": null }] }))),
        ("note élément trop grande", bytes(&json!({ "v": 2, "items": [{ "kind": "text", "name": "", "mime": "text/plain", "size": 400_001, "offset": 0, "k": K43 }] }))),
        ("note élément au-delà des données", bytes(&json!({ "v": 2, "items": [{ "kind": "text", "name": "", "mime": "text/plain", "size": 10, "offset": DATA - 9, "k": K43 }] }))),
        ("UTF-8 invalide", b"{\"v\":2,\"items\":[{\"kind\":\"file\",\"name\":\"\xff\",\"mime\":\"\",\"size\":0,\"offset\":0}]}".to_vec()),
        ("demi-paire en UTF-8 (ED A0 80)", b"{\"v\":2,\"items\":[{\"kind\":\"file\",\"name\":\"\xed\xa0\x80\",\"mime\":\"\",\"size\":0,\"offset\":0}]}".to_vec()),
        ("texte après le JSON", [bytes(&good()), b"x".to_vec()].concat()),
        ("deux BOM", [b"\xef\xbb\xbf\xef\xbb\xbf".to_vec(), bytes(&good())].concat()),
    ];
    for (name, raw) in &bad {
        assert_eq!(open(raw).err(), Some(Error::PaquetCorrompu), "{name}");
    }
}

#[test]
fn bornes() {
    // MANIFEST_MAX octets : lu ; un de plus : refusé avant toute analyse.
    let m = |name: &str| with_item(|e| e["name"] = json!(name));
    let name = "n".repeat(MANIFEST_MAX - bytes(&m("")).len());
    assert_eq!(bytes(&m(&name)).len(), MANIFEST_MAX);
    assert_eq!(open(&bytes(&m(&name))).unwrap().items[0].name, name);
    corrupt(&bytes(&m(&(name + "n"))));
    // 200 éléments : lu.
    let items = vec![good()["items"][0].clone(); MAX_ITEMS];
    assert_eq!(
        open(&bytes(&json!({ "v": 2, "items": items })))
            .unwrap()
            .items
            .len(),
        MAX_ITEMS
    );
    // Entiers sûrs (Number.isSafeInteger) : 2^53 − 1 lu, avec des données assez longues.
    let max = format::MAX_SAFE;
    let e = with_item(|e| {
        e["size"] = json!(max);
    });
    assert_eq!(parse(&bytes(&e), max).unwrap().items[0].size, max);
    let e = with_item(|e| {
        e["offset"] = json!(max);
        e["size"] = json!(0);
    });
    assert_eq!(parse(&bytes(&e), max).unwrap().items[0].offset, max);
    corrupt(&bytes(&with_item(|e| {
        e["offset"] = json!(1);
        e["size"] = json!(DATA);
    })));
    // Fichier qui finit exactement à la fin des données : lu.
    let e = with_item(|e| {
        e["offset"] = json!(DATA - 3);
    });
    assert_eq!(open(&bytes(&e)).unwrap().items[0].offset, DATA - 3);
    // Note élément de 400 000 octets : lue.
    let note = json!({ "v": 2, "items": [{ "kind": "text", "name": "", "mime": "text/plain", "size": 400_000, "offset": 0, "k": K43 }] });
    let m = open(&bytes(&note)).unwrap();
    assert_eq!((m.items[0].kind, m.items[0].size), (Kind::Text, 400_000));
    // « k » × 43 : octets 0x92 0x49 0x24 répétés.
    assert_eq!(m.items[0].k.as_deref().unwrap()[..3], [0x92, 0x49, 0x24]);
}

#[test]
fn nombres_comme_json_parse() {
    // JSON.parse lit 3.0, 3e0 et 30e-1 comme 3, et -0 comme 0 (entier sûr, ≥ 0) ; même lecture.
    for lit in ["3.0", "3e0", "0.3e1", "3E+0"] {
        let raw = format!(
            r#"{{"v":2.0,"items":[{{"kind":"file","name":"a","mime":"","size":{lit},"offset":-0}}]}}"#
        );
        let m = open(raw.as_bytes()).unwrap();
        assert_eq!((m.items[0].size, m.items[0].offset), (3, 0), "{lit}");
    }
    for lit in ["-0.0", "0e5"] {
        let raw = format!(
            r#"{{"v":2,"items":[{{"kind":"file","name":"a","mime":"","size":{lit},"offset":0}}]}}"#
        );
        assert_eq!(open(raw.as_bytes()).unwrap().items[0].size, 0, "{lit}");
    }
    // Arrondi au plus près, comme JSON.parse (serde_json avec float_roundtrip) : ces écritures
    // valent un entier sûr ; « 9007199254740991.5 » vaut 2^53, refusé.
    for (lit, want) in [
        ("9007199254740991.0000000001", format::MAX_SAFE),
        ("9007199254740990.9999999999", format::MAX_SAFE),
        ("9007199254740991.4", format::MAX_SAFE),
        ("2.00000000000000000001", 2),
        ("5.9999999999999999999", 6),
    ] {
        let raw = format!(
            r#"{{"v":2,"items":[{{"kind":"file","name":"a","mime":"","size":{lit},"offset":0}}]}}"#
        );
        assert_eq!(
            parse(raw.as_bytes(), format::MAX_SAFE).unwrap().items[0].size,
            want,
            "{lit}"
        );
    }
    corrupt(br#"{"v":2,"items":[{"kind":"file","name":"a","mime":"","size":9007199254740991.5,"offset":0}]}"#);
    // Trop grands, non entiers ou infinis (JSON.parse : Infinity) : refusés.
    for lit in [
        "1e400",
        "-1e400",
        "9007199254740992",
        "9007199254740993",
        "99999999999999999999",
        "3.5",
        "1e-400",
    ] {
        let raw = format!(
            r#"{{"v":2,"items":[{{"kind":"file","name":"a","mime":"","size":{lit},"offset":0}}]}}"#
        );
        if lit == "1e-400" {
            // 1e-400 vaut 0 en IEEE 754 (JSON.parse aussi) : lu comme 0.
            assert_eq!(open(raw.as_bytes()).unwrap().items[0].size, 0);
        } else {
            corrupt(raw.as_bytes());
        }
    }
    // Durée de coffre écrite 12.0 : JSON.parse donne 12.
    let raw = br#"{"v":2,"rights":"coffre","keep_ttl_h":12.0,"items":[{"kind":"file","name":"a","mime":"","size":0,"offset":0}]}"#;
    assert_eq!(open(raw).unwrap().rights, Rights::Coffre(KeepTtl::H12));
}

#[test]
fn droits_lus() {
    // parseRights : absent, inconnu ou mal typé → « voir » ; « coffre » exige 1, 6, 12 ou 24.
    let cases = [
        (
            json!({ "rights": "coffre", "keep_ttl_h": 12 }),
            Rights::Coffre(KeepTtl::H12),
        ),
        (
            json!({ "rights": "coffre", "keep_ttl_h": 1 }),
            Rights::Coffre(KeepTtl::H1),
        ),
        (
            json!({ "rights": "coffre", "keep_ttl_h": 6 }),
            Rights::Coffre(KeepTtl::H6),
        ),
        (
            json!({ "rights": "coffre", "keep_ttl_h": 24 }),
            Rights::Coffre(KeepTtl::H24),
        ),
        (json!({ "rights": "coffre" }), Rights::Voir),
        (json!({ "rights": "coffre", "keep_ttl_h": 5 }), Rights::Voir),
        (
            json!({ "rights": "coffre", "keep_ttl_h": "12" }),
            Rights::Voir,
        ),
        (
            json!({ "rights": "coffre", "keep_ttl_h": null }),
            Rights::Voir,
        ),
        (
            json!({ "rights": "coffre", "keep_ttl_h": 12.5 }),
            Rights::Voir,
        ),
        (json!({ "rights": "enregistrer" }), Rights::Enregistrer),
        (
            json!({ "rights": "enregistrer", "keep_ttl_h": 12 }),
            Rights::Enregistrer,
        ),
        (json!({ "rights": "voir" }), Rights::Voir),
        (json!({ "rights": "voir", "keep_ttl_h": 12 }), Rights::Voir),
        (json!({ "rights": "admin", "keep_ttl_h": 24 }), Rights::Voir),
        (json!({ "rights": true }), Rights::Voir),
        (json!({ "rights": null }), Rights::Voir),
        (json!({ "rights": "Enregistrer" }), Rights::Voir),
        (json!({}), Rights::Voir),
    ];
    for (r, want) in cases {
        let mut m = good();
        m.as_object_mut().unwrap().remove("rights");
        for (k, v) in r.as_object().unwrap() {
            m[k] = v.clone();
        }
        assert_eq!(open(&bytes(&m)).unwrap().rights, want, "{r}");
    }
}

#[test]
fn droits_a_la_creation() {
    assert_eq!(Rights::new("enregistrer", None), Ok(Rights::Enregistrer));
    assert_eq!(Rights::new("voir", None), Ok(Rights::Voir));
    for h in [1, 6, 12, 24] {
        let r = Rights::new("coffre", Some(h)).unwrap();
        assert_eq!(r.keep_ttl_h(), Some(h as u8));
        assert_eq!(r.name(), "coffre");
    }
    for (r, h) in [
        ("admin", None),
        ("coffre", None),
        ("coffre", Some(5)),
        ("coffre", Some(0)),
        ("coffre", Some(u64::MAX)),
        ("voir", Some(12)),
        ("enregistrer", Some(1)),
        ("Voir", None),
        ("", None),
    ] {
        assert_eq!(Rights::new(r, h), Err(Error::DroitsInvalides), "{r} {h:?}");
    }
    assert_eq!(Error::DroitsInvalides.to_string(), "droits_invalides");
}

#[test]
fn nettoyage() {
    // Valeur connue gardée ; inconnue ou mal typée (version plus récente) ignorée, jamais une erreur.
    for name in [
        "image",
        "video",
        "audio",
        "pdf",
        "bureautique",
        "vocal",
        "echec",
        "protege",
        "tel_quel",
    ] {
        let m = open(&bytes(&with_item(|e| e["clean"] = json!(name)))).unwrap();
        let c = m.items[0].clean.unwrap();
        assert_eq!(c.name(), name);
        assert_eq!(Clean::from_name(name), Some(c));
    }
    for v in [
        json!("inconnu"),
        json!("Image"),
        json!(1),
        Value::Null,
        json!(["image"]),
    ] {
        let m = open(&bytes(&with_item(|e| e["clean"] = v.clone()))).unwrap();
        assert_eq!(m.items[0].clean, None, "{v}");
    }
    // Sur une note : jamais lu (container.ts ne le garde que pour un fichier).
    let note = json!({ "v": 2, "items": [{ "kind": "text", "name": "", "mime": "", "size": 0, "offset": 0, "text": "a", "clean": "image" }] });
    assert_eq!(open(&bytes(&note)).unwrap().items[0].clean, None);
    // Champs inconnus ignorés.
    let m = open(&bytes(&with_item(|e| e["futur"] = json!({ "x": [1, 2] })))).unwrap();
    assert_eq!(m.items[0].name, "a");
}

#[test]
fn ancien_format_texte() {
    // Texte dans le manifeste (ancien format) : lu jusqu'à TEXT_MAX points de code, au-delà refusé.
    let t = |text: String| json!({ "v": 2, "rights": "voir", "items": [{ "kind": "text", "name": "", "mime": "text/plain", "size": 0, "offset": 0, "text": text }] });
    let ok = "é".repeat(10_000);
    let m = open(&bytes(&t(ok.clone()))).unwrap();
    assert_eq!(m.items[0].text.as_deref(), Some(ok.as_str()));
    assert!(m.items[0].k.is_none());
    // Réécrit comme l'ancien moteur (sealStream : `text` après `offset`).
    let want = format!(
        r#"{{"v":2,"rights":"voir","items":[{{"kind":"text","name":"","mime":"text/plain","size":0,"offset":0,"text":"{ok}"}}]}}"#
    );
    assert_eq!(*to_json(&m), want.as_bytes());
    // TEXT_MAX points de code ne tiennent jamais dans MANIFEST_MAX octets : la borne de taille
    // refuse avant celle du texte (les deux sont gardées, comme dans container.ts).
    let edge = "a".repeat(TEXT_MAX);
    let big = bytes(&t(edge));
    assert!(big.len() > MANIFEST_MAX);
    corrupt(&big);
    // Palier 1 : texte seul, aucune donnée de fichier.
    assert_eq!(
        parse(&bytes(&t("a".into())), 0).unwrap().items[0]
            .text
            .as_deref(),
        Some("a")
    );
    assert_eq!(parse(&bytes(&good()), 0).err(), Some(Error::PaquetCorrompu));
}

#[test]
fn cles_en_double_comme_json_parse() {
    // JSON.parse garde la dernière valeur d'une clé répétée : même lecture.
    let raw = br#"{"v":1,"rights":"voir","items":[],"v":2,"rights":"enregistrer","items":[{"kind":"exe","name":"x","kind":"file","name":"b","mime":"","size":0,"offset":0}]}"#;
    let m = open(raw).unwrap();
    assert_eq!(m.rights, Rights::Enregistrer);
    assert_eq!(
        (m.items[0].kind, m.items[0].name.as_str()),
        (Kind::File, "b")
    );
    let raw =
        br#"{"v":2,"v":1,"items":[{"kind":"file","name":"b","mime":"","size":0,"offset":0}]}"#;
    corrupt(raw);
}

#[test]
fn bom_comme_textdecoder() {
    // TextDecoder (ignoreBOM: false) retire un BOM initial avant JSON.parse.
    let raw = [b"\xef\xbb\xbf".to_vec(), bytes(&good())].concat();
    assert_eq!(open(&raw).unwrap().items[0].name, "a");
}

fn name_of(json_name: &str) -> Result<String, Error> {
    let raw = format!(
        r#"{{"v":2,"items":[{{"kind":"file","name":"{json_name}","mime":"","size":0,"offset":0}}]}}"#
    );
    open(raw.as_bytes()).map(|m| m.items[0].name.clone())
}

#[test]
fn demi_paire_isolee() {
    // Review Focus 1 : JSON.stringify écrit une demi-paire isolée « \udXXX » ; un ancien
    // manifeste qui en contient s'ouvre, le caractère remplacé par U+FFFD.
    assert_eq!(name_of(r"a\ud800b").unwrap(), "a\u{fffd}b");
    assert_eq!(name_of(r"a\uD800b").unwrap(), "a\u{fffd}b");
    assert_eq!(name_of(r"\udbff").unwrap(), "\u{fffd}");
    assert_eq!(name_of(r"\udc00x").unwrap(), "\u{fffd}x");
    assert_eq!(name_of(r"\udfff\ud800").unwrap(), "\u{fffd}\u{fffd}");
    // Échappements `\u` + 4 chiffres construits morceau par morceau : jamais écrits en clair
    // dans ce fichier (un éditeur les convertirait en caractères sans le dire).
    let b = "\\";
    let esc = |hex: &str| format!("{b}u{hex}");
    let (hi, lo, hi_up, lo_up) = (esc("d83d"), esc("de00"), esc("D83D"), esc("DE00"));
    let smile = char::from_u32(0x1f600).unwrap().to_string();
    let fffd = char::from_u32(0xfffd).unwrap().to_string();
    assert!(!hi.contains(&smile) && hi.len() == 6 && lo.len() == 6);
    // Paire valide échappée : gardée (U+1F600), chiffres en minuscules ou en majuscules.
    assert_eq!(name_of(&format!("{hi}{lo}")).unwrap(), smile);
    assert_eq!(name_of(&format!("{hi_up}{lo_up}")).unwrap(), smile);
    assert_eq!(name_of(&format!("{hi}{lo_up}")).unwrap(), smile);
    assert_eq!(
        name_of(&format!("a{hi}{lo}b")).unwrap(),
        format!("a{smile}b")
    );
    // Haute suivie d'une paire : la première seule est isolée.
    assert_eq!(
        name_of(&format!("{hi}{hi}{lo}")).unwrap(),
        format!("{fffd}{smile}")
    );
    // Basse suivie d'une paire.
    assert_eq!(
        name_of(&format!("{lo}{hi}{lo}")).unwrap(),
        format!("{fffd}{smile}")
    );
    // Barre oblique inverse échappée puis paire : « \ » puis U+1F600.
    assert_eq!(
        name_of(&format!("{b}{b}{hi}{lo}")).unwrap(),
        format!("{b}{smile}")
    );
    // Haute, barre oblique inverse échappée, basse : U+FFFD, « \ », U+FFFD.
    assert_eq!(
        name_of(&format!("{hi}{b}{b}{lo}")).unwrap(),
        format!("{fffd}{b}{fffd}")
    );
    // Basse puis haute (ordre inversé) : deux isolées.
    assert_eq!(
        name_of(&format!("{lo}{hi}")).unwrap(),
        format!("{fffd}{fffd}")
    );
    // Haute suivie d'un autre échappement (« A » échappé) ou d'un caractère brut.
    assert_eq!(
        name_of(&format!("{hi}{}", esc("0041"))).unwrap(),
        format!("{fffd}A")
    );
    assert_eq!(name_of(&format!("{hi}{b}n")).unwrap(), format!("{fffd}\n"));
    assert_eq!(name_of(&format!("{hi}é")).unwrap(), format!("{fffd}é"));
    // Barre oblique inverse échappée : « \\ud800 » est le texte « \ud800 », pas un échappement.
    assert_eq!(name_of(r"\\ud800").unwrap(), r"\ud800");
    assert_eq!(name_of(r"\\\ud800").unwrap(), "\\\u{fffd}");
    // Échappements mal formés : toujours refusés.
    assert_eq!(name_of(r"\ud80"), Err(Error::PaquetCorrompu));
    assert_eq!(name_of(r"\ud8"), Err(Error::PaquetCorrompu));
    assert_eq!(name_of(r"\u"), Err(Error::PaquetCorrompu));
    assert_eq!(name_of(r"\ud800\u"), Err(Error::PaquetCorrompu));
    // Hors chaîne : JSON invalide, qu'il y ait une demi-paire ou non.
    corrupt(br#"{"v":2,\ud800"items":[]}"#);
    // Le moteur écrit U+FFFD en clair (une String Rust ne peut pas porter de demi-paire).
    let raw = br#"{"v":2,"rights":"voir","items":[{"kind":"file","name":"a\ud800","mime":"","size":0,"offset":0}]}"#;
    let m = open(raw).unwrap();
    assert_eq!(
        *to_json(&m),
        "{\"v\":2,\"rights\":\"voir\",\"items\":[{\"kind\":\"file\",\"name\":\"a\u{fffd}\",\"mime\":\"\",\"size\":0,\"offset\":0}]}".as_bytes()
    );
    // Demi-paire dans un champ inconnu ou dans une clé : lue elle aussi.
    let raw = br#"{"v":2,"\ud800":"\udc00","items":[{"kind":"file","name":"a","mime":"","size":0,"offset":0}]}"#;
    assert_eq!(open(raw).unwrap().items[0].name, "a");
}

#[test]
fn ecriture_json_stringify() {
    // Échappements de JSON.stringify : " \ \b \t \n \f \r, autres commandes \u00xx minuscules ;
    // « / », U+007F, U+2028, U+2029 et tout le reste écrits tels quels (UTF-8).
    let all: String = (0u8..0x20).map(char::from).collect();
    let m = Manifest {
        rights: Rights::Coffre(KeepTtl::H1),
        items: vec![Entry {
            kind: Kind::File,
            name: format!("{all}\"\\/\u{7f}\u{2028}\u{2029}é😀"),
            mime: String::new(),
            size: 7,
            offset: 65536,
            text: None,
            k: Some(Zeroizing::new([0; 32])),
            clean: Some(Clean::TelQuel),
        }],
    };
    let want = concat!(
        r#"{"v":2,"rights":"coffre","keep_ttl_h":1,"items":[{"kind":"file","name":""#,
        r"\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\b\t\n\u000b\f\r\u000e\u000f",
        r"\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001a\u001b\u001c\u001d\u001e\u001f",
        "\\\"\\\\/\u{7f}\u{2028}\u{2029}é😀",
        r#"","mime":"","size":7,"offset":65536,"k":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","clean":"tel_quel"}]}"#
    );
    let got = to_json(&m);
    assert_eq!(std::str::from_utf8(&got).unwrap(), want);
    // Relu : le même manifeste.
    assert_eq!(parse(&got, CONTENT_MAX).unwrap(), m);
    // Ordre des droits : sans keep_ttl_h hors coffre.
    let m = Manifest {
        rights: Rights::Voir,
        items: vec![],
    };
    assert_eq!(*to_json(&m), br#"{"v":2,"rights":"voir","items":[]}"#[..]);
}

#[test]
fn debug_sans_graine() {
    let m = open(&bytes(&with_item(|e| e["k"] = json!(K43)))).unwrap();
    let k = m.items[0].k.as_deref().unwrap();
    assert_eq!(k.len(), 32);
    let dbg = format!("{m:?}");
    assert_eq!(k[..2], [0x92, 0x49]);
    assert!(!dbg.contains(K43) && !dbg.contains("146, 73"), "{dbg}");
    assert!(dbg.contains("k: Some(\"…\")"), "{dbg}");
    assert!(!dbg.contains("name"), "{dbg}");
}

#[test]
fn entrees_hostiles_sans_panique() {
    // Imbrication profonde (dans un champ inconnu) : refus, jamais de débordement de pile.
    for depth in [200usize, 10_000, 32_000] {
        let raw = format!(
            r#"{{"v":2,"x":{}{},"items":[{{"kind":"file","name":"a","mime":"","size":0,"offset":0}}]}}"#,
            "[".repeat(depth),
            "]".repeat(depth)
        );
        let raw = raw.as_bytes();
        if raw.len() <= MANIFEST_MAX {
            corrupt(raw);
        }
    }
    let raw = format!(r#"{{"v":2,"x":{}}}"#, "{\"a\":".repeat(20_000));
    corrupt(raw.as_bytes());
    // Altérations et troncatures à graine fixe d'un manifeste complet : jamais de panique.
    let base = bytes(
        &json!({ "v": 2, "rights": "coffre", "keep_ttl_h": 6, "items": [
        { "kind": "text", "name": "N\u{fffd}", "mime": "text/plain", "size": 10, "offset": 0, "k": K43 },
        { "kind": "file", "name": "f\\\"", "mime": "a/b", "size": 70000, "offset": 65536, "k": K43, "clean": "image" },
        { "kind": "text", "name": "", "mime": "", "size": 0, "offset": 0, "text": "\u{1f600}" }
    ] }),
    );
    let mut x: u32 = 0x1234_5678;
    let mut next = || {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        x
    };
    let alphabet = br#"{}[]",:\u0123456789abcdefABCDEF-+.eE dD8 ""#;
    let b = "\\";
    let (lone, pair) = (format!("{b}ud800"), format!("{b}ud83d{b}ude00"));
    let mut opened = 0;
    for i in 0..4000 {
        let mut raw = base.clone();
        match i % 4 {
            0 => raw.truncate(next() as usize % raw.len()),
            1 => {
                let p = next() as usize % raw.len();
                raw[p] = alphabet[next() as usize % alphabet.len()];
            }
            2 => {
                let p = next() as usize % raw.len();
                raw[p] ^= 1 << (next() % 8);
            }
            _ => {
                // Demi-paire isolée ou paire valide échappées (construites, jamais en clair).
                let p = next() as usize % raw.len();
                let s = if next() % 2 == 0 {
                    lone.as_bytes()
                } else {
                    pair.as_bytes()
                };
                raw.splice(p..p, s.iter().copied());
            }
        }
        if let Ok(m) = parse(&raw, CONTENT_MAX) {
            opened += 1;
            // Ce qui est lu se réécrit et se relit à l'identique.
            assert_eq!(parse(&to_json(&m), CONTENT_MAX).unwrap(), m);
        }
    }
    assert!(opened > 0);
}
