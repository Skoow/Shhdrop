// Vecteurs des cas limites (audit M7) : engine/vectors/v2-limites.json, PRODUIT PAR CE MOTEUR
// (v2.json, figé, vient de l'ancien moteur TypeScript). Chaque cas donne ses entrées et ses
// sorties ; le test les recalcule à partir des seules entrées du fichier et compare (Rust
// natif ici, WebAssembly et TypeScript dans web/src/engine/limites.test.ts).
//
// Régénérer (après un changement voulu, relu) :
//   SHH_GEN_LIMITES=1 cargo test -p shhdrop-core --test limites
// Le fichier est déterministe : aléa tiré d'un flux SHA-256 à étiquette fixe (README).
mod support;

use core::cell::RefCell;
use serde_json::{Map, Value, json};
use shhdrop_core::elements::{ElementSealer, FinalEntry, seal_final};
use shhdrop_core::envelope::{content_keys, content_keys_checked};
use shhdrop_core::format::{self, CHUNK, CHUNK_CT, HEADER, MAX_ITEMS, TEXT_MAX};
use shhdrop_core::kdf::{KDF_MIN, password_key, password_key_for_create, sha256};
use shhdrop_core::link::{
    ParsedLink, manage_link, parse_link, share_link, share_link_with_password, split_password,
};
use shhdrop_core::reader::{Reader, Segments};
use shhdrop_core::{Error, KLien, SGestion, Seed};
use support::{block_on, hex, platform, replay, unhex};

const FILE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../vectors/v2-limites.json");
const ORIGIN: &str = "https://shhdrop.example";
/// Alphabet base64url, dans l'ordre des valeurs.
const B64U: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// --------------------------------------------------------------------------- aléa et clairs

/// Flux d'aléa du fichier : bloc i = SHA-256(UTF-8(« shhdrop/vecteurs/v2-limites/ » +
/// étiquette) ‖ i sur 4 octets gros-boutistes), blocs mis bout à bout.
fn stream(label: &str, n: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(n + 32);
    let mut i = 0u32;
    while out.len() < n {
        let mut m = format!("shhdrop/vecteurs/v2-limites/{label}").into_bytes();
        m.extend_from_slice(&i.to_be_bytes());
        out.extend_from_slice(&sha256(&m));
        i += 1;
    }
    out.truncate(n);
    out
}

/// Clair décrit dans le fichier : `{"hex"}`, `{"utf8"}`, `{"repeat": [texte, n]}` (texte
/// répété n fois, puis `then` s'il y en a) ou `{"xorshift32": {seed, len}}` (README de v2).
fn plain(spec: &Value) -> Vec<u8> {
    if let Some(h) = spec["hex"].as_str() {
        return unhex(h);
    }
    if let Some(s) = spec["utf8"].as_str() {
        return s.as_bytes().to_vec();
    }
    if let Some(r) = spec["repeat"].as_array() {
        let mut s = r[0]
            .as_str()
            .unwrap()
            .repeat(r[1].as_u64().unwrap() as usize);
        s.push_str(spec["then"].as_str().unwrap_or(""));
        return s.into_bytes();
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

fn err(e: Error) -> Value {
    json!({ "error": e.to_string() })
}

// --------------------------------------------------------------------------------- liens

fn parsed(r: Result<ParsedLink, Error>) -> Value {
    match r {
        Ok(ParsedLink::Share { origin, k_lien }) => {
            json!({ "kind": "s", "origin": origin, "key": hex(k_lien.as_bytes()) })
        }
        Ok(ParsedLink::Manage { origin, s_gestion }) => {
            json!({ "kind": "m", "origin": origin, "key": hex(s_gestion.as_bytes()) })
        }
        Err(e) => err(e),
    }
}

/// Lien écrit à partir d'une clé : `{fn: "shareLink" | "manageLink", key, base}` → lien, et
/// sa relecture par `parseLink`.
fn link_case(c: &Value) -> Value {
    let key: [u8; 32] = unhex(c["key"].as_str().unwrap()).try_into().unwrap();
    let base = c["base"].as_str().unwrap();
    let link = match c["fn"].as_str().unwrap() {
        "shareLink" => share_link(ORIGIN, &KLien::from_bytes(key), base),
        _ => manage_link(ORIGIN, &SGestion::from_bytes(key), base),
    }
    .unwrap();
    json!({ "link": link, "parsed": parsed(parse_link(&link, base)) })
}

/// Lien de QR code : `{link, password}` → `shareLinkWithPassword`, puis `splitPassword`.
fn qr_case(c: &Value) -> Value {
    let link = c["link"].as_str().unwrap();
    match share_link_with_password(link, c["password"].as_str().unwrap()) {
        Ok(q) => {
            let (href, pw) = split_password(&q);
            json!({ "link_with_password": q, "split": { "href": href, "password": pw } })
        }
        Err(e) => err(e),
    }
}

fn links() -> Value {
    // Clés dont le base64url commence par « m » (valeur 38 : premier octet 0x98 à 0x9b), par
    // « - » (62 : 0xf8 à 0xfb) ou « _ » (63 : 0xfc à 0xff), ou n'a que « _ » sauf la fin.
    let key = |first: u8, label: &str| {
        let mut k = stream(label, 32);
        k[0] = first;
        hex(&k)
    };
    let mut written = Vec::new();
    for (label, f, k, base) in [
        ("partage_cle_en_m", "shareLink", key(0x98, "m-partage"), "/"),
        (
            "partage_cle_en_m_base_demo",
            "shareLink",
            key(0x9b, "m-demo"),
            "/shhdrop/",
        ),
        (
            "gestion_cle_en_m",
            "manageLink",
            key(0x98, "m-gestion"),
            "/",
        ),
        ("partage_cle_en_tiret", "shareLink", key(0xf8, "tiret"), "/"),
        (
            "partage_cle_en_souligne",
            "shareLink",
            key(0xfc, "souligne"),
            "/",
        ),
        (
            "gestion_cle_en_tiret",
            "manageLink",
            key(0xfb, "g-tiret"),
            "/",
        ),
        ("partage_cle_ff", "shareLink", "ff".repeat(32), "/"),
        ("partage_cle_fb", "shareLink", "fb".repeat(32), "/"),
        ("gestion_cle_ff", "manageLink", "ff".repeat(32), "/"),
        ("partage_cle_00", "shareLink", "00".repeat(32), "/"),
    ] {
        let mut c = json!({ "label": label, "fn": f, "key": k, "base": base });
        let x = link_case(&c);
        merge(&mut c, x);
        written.push(c);
    }
    // Analyse : pour chacun des 64 caractères en dernière position (seuls les 16 dont les deux
    // bits de poids faible sont nuls sont canoniques), et « - » ou « _ » en tête, au milieu
    // juste avant la fin, ou en fin, pour un lien de partage et un lien de gestion.
    let body = "Q".repeat(42);
    let mut urls: Vec<(String, String)> = Vec::new();
    for c in B64U.chars() {
        urls.push((format!("partage_fin_{c}"), format!("{ORIGIN}/#{body}{c}")));
        urls.push((format!("gestion_fin_{c}"), format!("{ORIGIN}/#m{body}{c}")));
        urls.push((
            format!("partage_m_fin_{c}"),
            format!("{ORIGIN}/#m{}{c}", &body[1..]),
        ));
    }
    for (label, frag) in [
        ("partage_tiret_en_tete", format!("-{}A", &body[1..])),
        ("partage_souligne_en_tete", format!("_{}A", &body[1..])),
        ("partage_tiret_avant_la_fin", format!("{}-A", &body[1..])),
        ("partage_souligne_avant_la_fin", format!("{}_w", &body[1..])),
        ("partage_tiret_en_fin", format!("{body}-")),
        ("partage_souligne_en_fin", format!("{body}_")),
        ("gestion_tiret_en_tete", format!("m-{}A", &body[1..])),
        ("gestion_souligne_en_tete", format!("m_{}A", &body[1..])),
        ("gestion_mm", format!("mm{}A", &body[1..])),
        ("gestion_trop_courte", format!("m{}", &body[..41])),
        ("partage_42_caracteres", body.clone()),
        ("partage_44_caracteres", format!("{body}AA")),
    ] {
        urls.push((label.to_owned(), format!("{ORIGIN}/#{frag}")));
    }
    let parse: Vec<Value> = urls
        .into_iter()
        .map(|(label, url)| {
            let mut c = json!({ "label": label, "url": url, "base": "/" });
            let x = json!({ "result": parse_case(&c) });
            merge(&mut c, x);
            c
        })
        .collect();
    // QR « lien.mot de passe » avec une clé de partage en « m » ; blancs en bord gardés par le
    // QR (le moteur les retire au calcul de K_mdp, section argon2id).
    let m_link = written[0]["link"].as_str().unwrap().to_owned();
    let qr: Vec<Value> = [
        ("qr_cle_en_m", m_link.clone(), "aC3!cD5?#Fg"),
        (
            "qr_cle_en_m_blancs_en_bord",
            m_link.clone(),
            " aC3!cD5?#Fg\n",
        ),
        ("qr_cle_en_m_unicode", m_link.clone(), "한글-Å-😀"),
        (
            "qr_lien_de_gestion",
            written[2]["link"].as_str().unwrap().to_owned(),
            "aC3!cD5?#Fg",
        ),
    ]
    .into_iter()
    .map(|(label, link, pw)| {
        let mut c = json!({ "label": label, "link": link, "password": pw });
        let x = qr_case(&c);
        merge(&mut c, x);
        c
    })
    .collect();
    json!({ "origin": ORIGIN, "written": written, "parse": parse, "qr": qr })
}

fn parse_case(c: &Value) -> Value {
    parsed(parse_link(
        c["url"].as_str().unwrap(),
        c["base"].as_str().unwrap(),
    ))
}

// ----------------------------------------------------------------------------- partages

/// Segments du serveur, sans réseau.
struct Files(Vec<Vec<u8>>);

impl Segments for &Files {
    async fn fetch(&self, n: u32) -> Result<Vec<u8>, Error> {
        Ok(self.0.get(n as usize).cloned().unwrap_or_default())
    }
}

/// Partage complet : chaque élément chiffré sous sa graine `k` (scelleur, place `first`), puis
/// le manifeste sous R (`r`) ; sinon l'erreur du scellement. S'il est scellé : palier, en-tête,
/// morceau du manifeste (empreinte et JSON exact), puis ouverture par le lecteur et empreinte
/// de chaque élément lu.
fn share_case(c: &Value) -> Value {
    let items = c["items"].as_array().unwrap();
    let mut pieces = Vec::new();
    let mut sealers = Vec::new();
    let mut plains = Vec::new();
    for it in items {
        let data = plain(&it["plain"]);
        let p = replay(vec![unhex(it["k"].as_str().unwrap())]);
        let el = block_on(ElementSealer::new(
            &p,
            data.len() as u64,
            it["first"].as_u64().unwrap(),
        ))
        .unwrap();
        let mut list = Vec::new();
        for (j, pc) in el.pieces().iter().enumerate() {
            let (lo, hi) = el.range(j).unwrap();
            let ct = block_on(el.piece(j, &data[lo as usize..hi as usize])).unwrap();
            list.push((*pc, ct));
        }
        pieces.push(list);
        sealers.push(el);
        plains.push(data);
    }
    let mut out = Map::new();
    out.insert(
        "pieces".into(),
        pieces
            .iter()
            .map(|l| {
                l.iter()
                    .map(|(pc, ct)| {
                        json!({ "seg": pc.seg, "from": pc.from, "chunks": pc.chunks,
                                "len": ct.len(), "sha256": hex(&sha256(ct)) })
                    })
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>()
            .into(),
    );
    let entries: Result<Vec<FinalEntry>, Error> = items
        .iter()
        .zip(&sealers)
        .map(|(it, el)| {
            let (name, mime) = (it["name"].as_str().unwrap(), it["mime"].as_str().unwrap());
            match it["kind"].as_str().unwrap() {
                "text" => FinalEntry::note(el, name.into(), mime.into()),
                _ => Ok(FinalEntry::file(el, None, name.into(), mime.into())),
            }
        })
        .collect();
    let r = Seed::from_slice(&unhex(c["r"].as_str().unwrap())).unwrap();
    let p = platform(1);
    let keys = block_on(content_keys(&p, &r)).unwrap();
    let fin =
        match entries.and_then(|e| block_on(seal_final(&e, &keys, c["rights"].as_str(), None))) {
            Ok(f) => f,
            Err(e) => {
                out.insert("error".into(), e.to_string().into());
                return out.into();
            }
        };
    let pt = block_on(keys.k_contenu.open_batch(
        &fin.header,
        &[format::nonce(u64::from(fin.bucket) - 1, true)],
        &fin.tail,
        CHUNK_CT,
    ))
    .unwrap();
    let mut buf = vec![0u8; CHUNK];
    assert!(shhdrop_core::platform::Opened::copy_out(&pt, 0, &mut buf));
    let len = u32::from_be_bytes(buf[CHUNK - 4..].try_into().unwrap()) as usize;
    let json_text = String::from_utf8(buf[CHUNK - 4 - len..CHUNK - 4].to_vec()).unwrap();
    // Fichiers du serveur : zéros, pièces, en-tête, morceau du manifeste (README de v2).
    let mut segs: Vec<Vec<u8>> = (0..format::segment_count(fin.bucket))
        .map(|n| vec![0u8; format::segment_size(fin.bucket, n).unwrap()])
        .collect();
    for (pc, ct) in pieces.iter().flatten() {
        let at = match (pc.seg, pc.from) {
            (0, 0) => 0,
            (0, f) => HEADER + f as usize * CHUNK_CT,
            (_, f) => f as usize * CHUNK_CT,
        };
        segs[pc.seg as usize][at..at + ct.len()].copy_from_slice(ct);
    }
    segs[0][..HEADER].copy_from_slice(&fin.header);
    let last = segs.last_mut().unwrap();
    let n = last.len();
    last[n - CHUNK_CT..].copy_from_slice(&fin.tail);
    let checked = block_on(content_keys_checked(&p, &r, &keys.engagement)).unwrap();
    let files = Files(segs);
    let rd = block_on(Reader::open(&p, &files, fin.bucket, &checked)).unwrap();
    let opened: Vec<Value> = (0..items.len())
        .map(|i| {
            let got = RefCell::new(Vec::new());
            block_on(rd.stream_item(i, async |b: &[u8]| {
                got.borrow_mut().extend_from_slice(b);
                Ok(())
            }))
            .unwrap();
            let got = got.into_inner();
            assert_eq!(got, plains[i], "{} : élément {i} relu", c["label"]);
            json!({ "len": got.len(), "sha256": hex(&sha256(&got)) })
        })
        .collect();
    out.insert("bucket".into(), fin.bucket.into());
    out.insert("header".into(), hex(&fin.header).into());
    out.insert("tail_sha256".into(), hex(&sha256(&fin.tail)).into());
    out.insert("manifest_json".into(), json_text.into());
    out.insert("opened".into(), opened.into());
    out.into()
}

/// Cas `share` d'étiquette `label` : graines `k` et R tirées du flux, puis sorties.
fn share(label: &str, mut items: Vec<Value>) -> Value {
    let ks = stream(&format!("{label}/k"), 32 * items.len());
    for (i, it) in items.iter_mut().enumerate() {
        it["k"] = hex(&ks[32 * i..32 * i + 32]).into();
    }
    let mut c = json!({ "label": label, "items": items,
                        "r": hex(&stream(&format!("{label}/r"), 32)), "rights": "enregistrer" });
    let x = share_case(&c);
    merge(&mut c, x);
    c
}

fn shares() -> Value {
    let mut cases = Vec::new();
    let mut checks = Vec::new();
    let mut add = |label: &str, items: Vec<Value>| cases.push(share(label, items));
    let note = |plain: Value| json!({ "kind": "text", "name": "Note", "mime": "text/plain", "first": 0, "plain": plain });
    let file = |name: &str, first: u64, plain: Value| json!({ "kind": "file", "name": name, "mime": "application/octet-stream", "first": first, "plain": plain });
    add(
        "note_100000_points_de_code",
        vec![note(json!({ "repeat": ["a", TEXT_MAX] }))],
    );
    add(
        "note_100001_points_de_code",
        vec![note(json!({ "repeat": ["a", TEXT_MAX + 1] }))],
    );
    add(
        "note_400000_octets",
        vec![note(json!({ "repeat": ["😀", TEXT_MAX] }))],
    );
    add(
        "note_400001_octets",
        vec![note(json!({ "repeat": ["😀", TEXT_MAX], "then": "a" }))],
    );
    add("note_vide", vec![note(json!({ "utf8": "" }))]);
    add(
        "note_bom_initial",
        vec![note(json!({ "utf8": "\u{feff}Allo été" }))],
    );
    add("note_utf8_invalide", vec![note(json!({ "hex": "61ff62" }))]);
    add(
        "note_demi_paire_utf16",
        vec![note(json!({ "hex": "eda080" }))],
    );
    add("note_utf8_tronque", vec![note(json!({ "hex": "41c3" }))]);
    // Données qui finissent pile à la fin du morceau B − 2 (le morceau B − 1 est celui du
    // manifeste) : palier B ; un octet de plus : palier suivant.
    for (b, next) in [(16u64, 80u64), (80, 160)] {
        let len = (b - 1) * CHUNK as u64;
        for (extra, want) in [(0, b), (1, next)] {
            let label = format!("fin_au_morceau_{}_palier_{want}", b - 2 + extra);
            let f = file(
                "f.bin",
                0,
                json!({ "xorshift32": { "seed": b as u32, "len": len + extra } }),
            );
            add(&label, vec![f]);
            checks.push((label, want));
        }
    }
    // Manifeste de MAX_ITEMS éléments (accepté) et d'un de plus (refusé) : un octet par élément,
    // chacun dans son morceau.
    for n in [MAX_ITEMS, MAX_ITEMS + 1] {
        let items = (0..n)
            .map(|i| {
                file(
                    &format!("f{i:03}.bin"),
                    i as u64,
                    json!({ "hex": format!("{:02x}", i % 256) }),
                )
            })
            .collect();
        add(&format!("manifeste_{n}_elements"), items);
    }
    for (label, want) in checks {
        let c = cases.iter().find(|c| c["label"] == label.as_str()).unwrap();
        assert_eq!(c["bucket"], want, "{label}");
    }
    cases.into()
}

// ------------------------------------------------------------------------------ Argon2id

/// K_mdp (ouverture, KDF_MIN) d'un mot de passe ; `nfc_utf8` : octets passés à Argon2id (blancs
/// ASCII de bord retirés, puis NFC). `fn: "passwordKeyForCreate"` : forme générée exigée.
fn argon2_case(c: &Value) -> Value {
    use unicode_normalization::UnicodeNormalization;
    let pw = String::from_utf8(unhex(c["password_utf8"].as_str().unwrap())).unwrap();
    let salt = unhex(c["salt"].as_str().unwrap());
    let r = match c["fn"].as_str().unwrap() {
        "passwordKeyForCreate" => password_key_for_create(&pw, &salt),
        _ => password_key(
            &pw,
            &salt,
            c["ops"].as_u64().unwrap() as u32,
            c["mem"].as_u64().unwrap() as u32,
        ),
    };
    match r {
        Ok(k) => {
            let nfc: String = shhdrop_core::kdf::trim_password(&pw).nfc().collect();
            json!({ "key": hex(k.as_bytes()), "nfc_utf8": hex(nfc.as_bytes()) })
        }
        Err(e) => err(e),
    }
}

fn argon2() -> Value {
    let salt = hex(&(0u8..16).collect::<Vec<_>>());
    // (étiquette, groupe de même clé, mot de passe)
    let cases: [(&str, &str, &str); 19] = [
        ("hangul_compose", "hangul", "한글"),
        (
            "hangul_decompose",
            "hangul",
            "\u{1112}\u{1161}\u{11ab}\u{1100}\u{1173}\u{11af}",
        ),
        ("angstrom_u212b", "angstrom", "\u{212b}ngstr\u{f6}m"),
        ("angstrom_u00c5", "angstrom", "\u{c5}ngstr\u{f6}m"),
        ("angstrom_decompose", "angstrom", "A\u{30a}ngstro\u{308}m"),
        ("marques_ordre_1", "marques", "a\u{301}\u{323}"),
        ("marques_ordre_2", "marques", "a\u{323}\u{301}"),
        ("u0344", "iota", "\u{3b9}\u{344}"),
        ("u0390", "iota", "\u{390}"),
        ("iota_decompose", "iota", "\u{3b9}\u{308}\u{301}"),
        ("emoji", "emoji", "🔐 clé 👨\u{200d}👩\u{200d}👧 😀"),
        ("sans_blanc", "blancs", "aC3!cD5?#Fg"),
        ("blancs_ascii_en_bord", "blancs", " \taC3!cD5?#Fg\r\n"),
        ("blanc_interieur", "", "aC3! cD5?#Fg"),
        ("espace_insecable_en_bord", "", "\u{a0}aC3!cD5?#Fg"),
        ("rien_que_des_blancs", "", " \t\r\n "),
        ("vide", "", ""),
        ("creation_blanc_en_bord", "", " aC3!cD5?#Fg"),
        ("creation_genere", "blancs", "aC3!cD5?#Fg"),
    ];
    let out: Vec<Value> = cases
        .iter()
        .map(|&(label, group, pw)| {
            let f = if label.starts_with("creation") {
                "passwordKeyForCreate"
            } else {
                "passwordKey"
            };
            let mut c = json!({ "label": label, "fn": f, "password": pw,
                "password_utf8": hex(pw.as_bytes()), "salt": salt,
                "ops": KDF_MIN.ops, "mem": KDF_MIN.mem });
            if !group.is_empty() {
                c["same_key_as"] = group.into();
            }
            let x = argon2_case(&c);
            merge(&mut c, x);
            c
        })
        .collect();
    // Mêmes groupes, même clé ; groupes distincts, clés distinctes.
    for a in &out {
        for b in &out {
            if a["key"].is_string() && b["key"].is_string() {
                let same = a.get("same_key_as").is_some() && a["same_key_as"] == b["same_key_as"];
                assert_eq!(
                    a["key"] == b["key"],
                    same || a["label"] == b["label"],
                    "{} / {}",
                    a["label"],
                    b["label"]
                );
            }
        }
    }
    out.into()
}

// ---------------------------------------------------------------------------------- fichier

fn merge(c: &mut Value, extra: Value) {
    let Value::Object(m) = extra else {
        panic!("objet attendu")
    };
    for (k, v) in m {
        c[k] = v;
    }
}

fn build() -> Value {
    json!({
        "about": "Cas limites du format v2, produits par le moteur Rust (engine/core/tests/limites.rs) ; voir engine/vectors/README.md.",
        "constants": { "TEXT_MAX": TEXT_MAX, "MAX_ITEMS": MAX_ITEMS, "CHUNK": CHUNK },
        "links": links(),
        "shares": shares(),
        "argon2id": argon2(),
    })
}

fn text(v: &Value) -> String {
    let mut s = serde_json::to_string_pretty(v).unwrap();
    s.push('\n');
    s
}

/// Rejoue chaque cas du fichier à partir de ses seules entrées.
fn replay_file(v: &Value) {
    let outputs = |c: &Value, keys: &[&str]| {
        let mut m = Map::new();
        for k in keys {
            if let Some(x) = c.get(*k) {
                m.insert((*k).into(), x.clone());
            }
        }
        Value::Object(m)
    };
    let l = &v["links"];
    assert_eq!(l["origin"], ORIGIN);
    for c in l["written"].as_array().unwrap() {
        assert_eq!(
            link_case(c),
            outputs(c, &["link", "parsed"]),
            "{}",
            c["label"]
        );
    }
    for c in l["parse"].as_array().unwrap() {
        assert_eq!(parse_case(c), c["result"], "{}", c["label"]);
    }
    for c in l["qr"].as_array().unwrap() {
        assert_eq!(
            qr_case(c),
            outputs(c, &["link_with_password", "split", "error"]),
            "{}",
            c["label"]
        );
    }
    let keys = [
        "pieces",
        "error",
        "bucket",
        "header",
        "tail_sha256",
        "manifest_json",
        "opened",
    ];
    for c in v["shares"].as_array().unwrap() {
        assert_eq!(share_case(c), outputs(c, &keys), "{}", c["label"]);
    }
    for c in v["argon2id"].as_array().unwrap() {
        assert_eq!(
            argon2_case(c),
            outputs(c, &["key", "nfc_utf8", "error"]),
            "{}",
            c["label"]
        );
    }
}

#[test]
fn v2_limites() {
    let built = build();
    if std::env::var_os("SHH_GEN_LIMITES").is_some() {
        std::fs::write(FILE, text(&built)).unwrap();
    }
    let raw = std::fs::read_to_string(FILE).expect("engine/vectors/v2-limites.json");
    let file: Value = serde_json::from_str(&raw).unwrap();
    // Fichier à jour, octet pour octet (JSON à clés triées, 2 espaces, LF final).
    assert_eq!(
        raw,
        text(&built),
        "v2-limites.json n'est plus celui du moteur"
    );
    replay_file(&file);
    // Couverture attendue (audit M7).
    let l = &file["links"];
    let ok = |c: &Value| c["result"]["kind"].is_string();
    let parse = l["parse"].as_array().unwrap();
    assert_eq!(parse.iter().filter(|c| ok(c)).count(), 16 * 3 + 7);
    let shares = file["shares"].as_array().unwrap();
    let by = |label: &str| shares.iter().find(|c| c["label"] == label).unwrap();
    assert_eq!(
        by("manifeste_200_elements")["opened"]
            .as_array()
            .unwrap()
            .len(),
        200
    );
    assert_eq!(by("manifeste_201_elements")["error"], "manifeste_trop_gros");
    assert_eq!(by("note_100001_points_de_code")["error"], "texte_trop_long");
    assert_eq!(by("note_400001_octets")["error"], "texte_trop_long");
    assert_eq!(by("note_utf8_invalide")["error"], "texte_invalide");
    assert_eq!(by("note_400000_octets")["opened"][0]["len"], 400_000);
    assert!(l["written"][0]["link"].as_str().unwrap().contains("/#m"));
    assert_eq!(l["written"][0]["parsed"]["kind"], "s");
    assert!(l["written"][2]["link"].as_str().unwrap().contains("/#mm"));
    assert_eq!(l["written"][2]["parsed"]["kind"], "m");
}
