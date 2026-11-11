// Éléments et manifeste final : cas de crypto/elements.test.ts portés (tailles, places, pièces
// produites une fois, clé neuve par élément, nonces distincts, intégrité, refus de sealFinal,
// nettoyage, empaquetage, une seule opération par plage), plus les cas propres au moteur Rust :
// clé de manifeste réutilisée, lecture de mauvaise taille, aléa indisponible, entrées hostiles,
// et « ce que seal_final écrit, manifest::parse le relit à l'identique ».
//
// Le lecteur complet (openStream) arrive avec la Task 8 : ici, les pièces et le morceau du
// manifeste sont déchiffrés directement sous les clés attendues (HKDF de la graine, K_contenu).
mod support;

use core::cell::{Cell, RefCell};
use shhdrop_core::elements::{
    DATA_CHUNKS, DATA_SEGMENTS, ELEMENT_AD, ElementSealer, FinalEntry, FinalKind, Piece, SEG_PLAIN,
    chunks_for, footprint_for, is_small, reservation_for, seal_final, segments_for,
    segments_needed,
};
use shhdrop_core::envelope::{ContentKeys, content_keys, new_seed};
use shhdrop_core::format::{
    self, CHUNK, CHUNK_CT, HEADER, MANIFEST_MAX, MAX_ITEMS, MAX_SAFE, SEG_CHUNKS, bucket_for,
};
use shhdrop_core::kdf::hkdf;
use shhdrop_core::manifest::{self, Clean, Entry, Kind, Manifest, Rights};
use shhdrop_core::native::RustCrypto;
use shhdrop_core::platform::{Key, KeyHandle, NONCE_LEN, Platform};
use shhdrop_core::{Error, Result};
use std::rc::Rc;
use support::{block_on, no_random, platform, replay};
use zeroize::Zeroizing;

const MIB: u64 = 1_048_576;
const C: u64 = CHUNK as u64;

/// Octets pseudo-aléatoires déterministes (contenu des fichiers de test).
fn pseudo(n: u64, seed: u32) -> Vec<u8> {
    let mut x = seed.wrapping_mul(2_654_435_761).wrapping_add(1);
    (0..n)
        .map(|_| {
            x = x.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            (x >> 24) as u8
        })
        .collect()
}

fn keys(p: &Rc<RustCrypto>) -> ContentKeys<RustCrypto> {
    block_on(content_keys(p, &new_seed(&**p).unwrap())).unwrap()
}

fn sealer(p: &Rc<RustCrypto>, size: u64, first: u64) -> Result<ElementSealer<RustCrypto>> {
    block_on(ElementSealer::new(p, size, first))
}

/// Chiffre toutes les pièces de `data` placé au morceau `first` ; rend le scelleur et les pièces.
fn upload(
    p: &Rc<RustCrypto>,
    data: &[u8],
    first: u64,
) -> (ElementSealer<RustCrypto>, Vec<Vec<u8>>) {
    let el = sealer(p, data.len() as u64, first).unwrap();
    let pieces = (0..el.pieces().len())
        .map(|j| {
            let (lo, hi) = el.range(j).unwrap();
            block_on(el.piece(j, &data[lo as usize..hi as usize])).unwrap()
        })
        .collect();
    (el, pieces)
}

/// Clair d'un élément relu sous HKDF(k, « shhdrop/v2/element ») à partir de ses pièces.
fn open_element(
    p: &Rc<RustCrypto>,
    k: &[u8; 32],
    pieces: &[Piece],
    bytes: &[Vec<u8>],
    size: u64,
) -> Result<Vec<u8>> {
    let key = block_on(Key::import(p, hkdf::<32>(k, "shhdrop/v2/element")))?;
    let mut out = Vec::new();
    for (pc, ct) in pieces.iter().zip(bytes) {
        let g0 = u64::from(pc.seg) * u64::from(SEG_CHUNKS) + u64::from(pc.from);
        let ct = if g0 == 0 { &ct[HEADER..] } else { &ct[..] };
        let nonces: Vec<_> = (0..u64::from(pc.chunks))
            .map(|c| format::nonce(g0 + c, false))
            .collect();
        out.extend_from_slice(&block_on(
            key.open_batch(ELEMENT_AD, &nonces, ct, CHUNK_CT),
        )?);
    }
    assert!(
        out[size as usize..].iter().all(|&b| b == 0),
        "zéros après la fin"
    );
    out.truncate(size as usize);
    Ok(out)
}

/// Manifeste relu dans le morceau final : déchiffré sous K_contenu (nonce(B − 1, dernier),
/// AD = en-tête), longueur gros-boutiste en fin, puis `manifest::parse` comme le lecteur.
fn open_tail(
    keys: &ContentKeys<RustCrypto>,
    bucket: u32,
    header: &[u8; HEADER],
    tail: &[u8],
) -> Result<(Manifest, Vec<u8>)> {
    let pt = block_on(keys.k_contenu.open_batch(
        header,
        &[format::nonce(u64::from(bucket) - 1, true)],
        tail,
        CHUNK_CT,
    ))?;
    let len = u32::from_be_bytes(pt[CHUNK - 4..].try_into().unwrap()) as usize;
    let raw = pt[CHUNK - 4 - len..CHUNK - 4].to_vec();
    assert!(pt[..CHUNK - 4 - len].iter().all(|&b| b == 0), "zéros avant");
    let data_len = u64::from(bucket) * C - 4 - len as u64;
    Ok((manifest::parse(&raw, data_len)?, raw))
}

fn file(name: &str, size: u64, first: u64, k: [u8; 32]) -> FinalEntry {
    FinalEntry {
        kind: FinalKind::File(None),
        name: name.into(),
        mime: "x/y".into(),
        size,
        first,
        k: Zeroizing::new(k),
    }
}

fn text(name: &str, size: u64, first: u64, k: [u8; 32]) -> FinalEntry {
    FinalEntry {
        kind: FinalKind::Text,
        name: name.into(),
        mime: "text/plain".into(),
        size,
        first,
        k: Zeroizing::new(k),
    }
}

/// Entrée modifiée (FinalEntry efface son nom à sa destruction : pas de `..e`).
fn with(mut e: FinalEntry, f: impl FnOnce(&mut FinalEntry)) -> FinalEntry {
    f(&mut e);
    e
}

fn seal(
    p: &Rc<RustCrypto>,
    entries: &[FinalEntry],
    rights: Option<&str>,
    ttl: Option<u64>,
) -> Result<shhdrop_core::elements::Sealed> {
    block_on(seal_final(entries, &keys(p), rights, ttl))
}

#[test]
fn segments_et_reservations() {
    assert_eq!(SEG_PLAIN, 4 * MIB);
    assert_eq!(DATA_SEGMENTS, 512);
    assert_eq!(DATA_CHUNKS, 32_768);
    let s: Vec<_> = [0, 1, 4 * MIB, 4 * MIB + 1]
        .into_iter()
        .map(|n| segments_for(n).unwrap())
        .collect();
    assert_eq!(s, [0, 1, 1, 2]);
    assert_eq!(reservation_for(0), Ok(1));
    assert_eq!(reservation_for(1), Ok(80));
    assert_eq!(reservation_for(2), Ok(160));
    assert_eq!(reservation_for(512), Ok(32_769));
    assert_eq!(reservation_for(513), Err(Error::TropGros));
    assert_eq!(reservation_for(u64::MAX), Err(Error::TropGros));
}

#[test]
fn aller_retour_ordre_du_manifeste_et_palier_canonique() {
    let p = platform(1);
    let a = pseudo(5 * MIB, 1); // segments 0 et 1
    let removed = pseudo(3 * MIB, 2); // segment 2, retiré ensuite
    let b = pseudo(100_000, 3); // segment 3
    let note = "bonjour é".as_bytes().to_vec(); // morceau 194, juste après b
    let (ea, pa) = upload(&p, &a, 0);
    let _ = upload(&p, &removed, 128);
    let (eb, pb) = upload(&p, &b, 192);
    let (en, pn) = upload(&p, &note, 194);
    let k = keys(&p);
    let entries = [
        with(text("note", note.len() as u64, 194, *en.k()), |e| {
            e.mime = "text/plain".into()
        }),
        with(file("b.bin", b.len() as u64, 192, *eb.k()), |e| {
            e.mime = "application/octet-stream".into()
        }),
        with(file("a.bin", a.len() as u64, 0, *ea.k()), |e| {
            e.mime = "application/octet-stream".into()
        }),
    ];
    let fin = block_on(seal_final(&entries, &k, Some("enregistrer"), None)).unwrap();
    assert_eq!(fin.bucket, bucket_for(194 * C + note.len() as u64).unwrap());
    assert_eq!(fin.header, format::header(&k.engagement));
    assert_eq!(fin.tail.len(), CHUNK_CT);
    let (m, _) = open_tail(&k, fin.bucket, &fin.header, &fin.tail).unwrap();
    assert_eq!(m.rights, Rights::Enregistrer);
    let names: Vec<_> = m.items.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["note", "b.bin", "a.bin"]);
    let offsets: Vec<_> = m.items.iter().map(|e| e.offset).collect();
    assert_eq!(offsets, [194 * C, 3 * SEG_PLAIN, 0]);
    // Le manifeste ne porte pas le texte de la note : il est dans ses morceaux.
    assert_eq!(m.items[0].text, None);
    assert_eq!(m.items[0].kind, Kind::Text);
    let seed = |i: usize| **m.items[i].k.as_ref().unwrap();
    let got = open_element(&p, &seed(0), en.pieces(), &pn, note.len() as u64).unwrap();
    assert_eq!(String::from_utf8(got).unwrap(), "bonjour é");
    assert_eq!(
        open_element(&p, &seed(1), eb.pieces(), &pb, b.len() as u64).unwrap(),
        b
    );
    assert_eq!(
        open_element(&p, &seed(2), ea.pieces(), &pa, a.len() as u64).unwrap(),
        a
    );
}

#[test]
fn note_de_100_000_caracteres() {
    let p = platform(2);
    let long = "é".repeat(99_999) + "€"; // 200 001 octets : bien plus que MANIFEST_MAX
    let raw = long.as_bytes();
    let (el, pieces) = upload(&p, raw, 0);
    let k = keys(&p);
    let fin = block_on(seal_final(
        &[text("n", raw.len() as u64, 0, *el.k())],
        &k,
        None,
        None,
    ))
    .unwrap();
    let (m, _) = open_tail(&k, fin.bucket, &fin.header, &fin.tail).unwrap();
    assert_eq!(m.items[0].size, raw.len() as u64);
    assert_eq!(m.rights, Rights::Enregistrer, "droits par défaut");
    let got = open_element(&p, &el.k(), el.pieces(), &pieces, raw.len() as u64);
    assert_eq!(got.unwrap(), raw);
}

#[test]
fn segment_0_zone_d_en_tete_vide_et_piece_produite_une_fois() {
    let p = platform(3);
    let data = pseudo(10, 4);
    let el = sealer(&p, 10, 0).unwrap();
    assert_eq!(el.range(0), Ok((0, 10)));
    let s = block_on(el.piece(0, &data)).unwrap();
    assert_eq!(s.len(), HEADER + CHUNK_CT, "un morceau, aucun bourrage");
    assert!(s[..HEADER].iter().all(|&b| b == 0));
    assert_eq!(block_on(el.piece(0, &data)), Err(Error::SegmentDejaProduit));
    assert_eq!(block_on(el.piece(1, &data)), Err(Error::SegmentInvalide));
    assert_eq!(el.range(1), Err(Error::SegmentInvalide));
    assert_eq!(
        block_on(el.piece(usize::MAX, &data)),
        Err(Error::SegmentInvalide)
    );
    let el5 = sealer(&p, 10, 320).unwrap();
    assert_eq!(block_on(el5.piece(0, &data)).unwrap().len(), CHUNK_CT);
}

#[test]
fn lecture_de_mauvaise_taille_refusee_et_piece_brulee() {
    let p = platform(4);
    let data = pseudo(70_000, 5);
    let el = sealer(&p, 70_000, 0).unwrap();
    assert_eq!(el.range(0), Ok((0, 70_000)));
    assert_eq!(
        block_on(el.piece(0, &data[..69_999])),
        Err(Error::LectureIncomplete)
    );
    // Comme elements.ts : la pièce est marquée produite avant la lecture ; l'hôte repart d'un
    // nouveau scelleur (clé neuve), jamais d'un second chiffrement sous la même clé.
    assert_eq!(block_on(el.piece(0, &data)), Err(Error::SegmentDejaProduit));
    let el = sealer(&p, 70_000, 0).unwrap();
    let mut long = data.clone();
    long.push(0);
    assert_eq!(block_on(el.piece(0, &long)), Err(Error::LectureIncomplete));
}

#[test]
fn plages_lues_par_l_hote() {
    let p = platform(5);
    // 4 Mio + 3 morceaux + 5 octets, au morceau 64 : une pleine plage puis une de 4 morceaux.
    let size = SEG_PLAIN + 3 * C + 5;
    let el = sealer(&p, size, 64).unwrap();
    assert_eq!(
        el.pieces(),
        [
            Piece {
                seg: 1,
                from: 0,
                chunks: 64
            },
            Piece {
                seg: 2,
                from: 0,
                chunks: 4
            },
        ]
    );
    assert_eq!(el.range(0), Ok((0, SEG_PLAIN)));
    assert_eq!(el.range(1), Ok((SEG_PLAIN, size)));
    // Fichier vide : aucune pièce, graine tirée quand même (comme elements.ts).
    let e0 = sealer(&p, 0, 0).unwrap();
    assert!(e0.pieces().is_empty());
    assert_eq!(e0.range(0), Err(Error::SegmentInvalide));
}

#[test]
fn cle_neuve_par_element() {
    let p = platform(6);
    let data = pseudo(70_000, 5);
    let (e1, s1) = upload(&p, &data, 64);
    let (e2, s2) = upload(&p, &data, 64);
    assert_ne!(*e1.k(), *e2.k());
    assert_ne!(s1[0][..100], s2[0][..100]);
}

/// Fournisseur espion : note chaque nonce et chaque appel de `aes_seal_batch`.
struct Spy {
    inner: RustCrypto,
    nonces: RefCell<Vec<[u8; NONCE_LEN]>>,
    batches: Cell<usize>,
}

impl Platform for Spy {
    type Opened = shhdrop_core::platform::SecretBuf;

    fn random(&self, out: &mut [u8]) -> Result<()> {
        self.inner.random(out)
    }
    async fn aes_import(&self, key: Zeroizing<[u8; 32]>) -> Result<u32> {
        self.inner.aes_import(key).await
    }
    async fn aes_seal_batch(
        &self,
        k: KeyHandle,
        ad: &[u8],
        nonces: &[[u8; NONCE_LEN]],
        plain: &[u8],
        chunk: usize,
    ) -> Result<Vec<u8>> {
        self.nonces.borrow_mut().extend_from_slice(nonces);
        self.batches.set(self.batches.get() + 1);
        self.inner.aes_seal_batch(k, ad, nonces, plain, chunk).await
    }
    async fn aes_open_batch(
        &self,
        k: KeyHandle,
        ad: &[u8],
        nonces: &[[u8; NONCE_LEN]],
        cipher: &[u8],
        chunk_ct: usize,
    ) -> Result<shhdrop_core::platform::SecretBuf> {
        self.inner
            .aes_open_batch(k, ad, nonces, cipher, chunk_ct)
            .await
    }
    fn aes_drop(&self, k: KeyHandle) {
        self.inner.aes_drop(k)
    }
}

fn spy() -> Rc<Spy> {
    Rc::new(Spy {
        inner: Rc::into_inner(platform(7)).unwrap(),
        nonces: RefCell::new(Vec::new()),
        batches: Cell::new(0),
    })
}

#[test]
fn aucun_nonce_repete_et_un_seul_lot_par_plage() {
    let p = spy();
    let data = pseudo(9 * MIB, 6);
    let el = block_on(ElementSealer::new(&p, data.len() as u64, 448)).unwrap();
    assert_eq!(
        el.pieces(),
        [
            Piece {
                seg: 7,
                from: 0,
                chunks: 64
            },
            Piece {
                seg: 8,
                from: 0,
                chunks: 64
            },
            Piece {
                seg: 9,
                from: 0,
                chunks: 16
            },
        ]
    );
    for j in 0..el.pieces().len() {
        let (lo, hi) = el.range(j).unwrap();
        block_on(el.piece(j, &data[lo as usize..hi as usize])).unwrap();
    }
    let ivs = p.nonces.borrow();
    assert_eq!(
        ivs.len(),
        144,
        "9 Mio : 144 morceaux, pas 3 segments pleins"
    );
    let mut sorted = ivs.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted.len(), ivs.len());
    assert_eq!(ivs[0], format::nonce(448, false));
    assert_eq!(ivs[143], format::nonce(448 + 143, false));
    assert_eq!(p.batches.get(), 3, "un seul aes_seal_batch par plage");
}

#[test]
fn integrite_morceau_echange_entre_deux_elements() {
    let p = platform(8);
    let a = pseudo(2 * C, 7);
    let b = pseudo(2 * C, 8);
    let (ea, mut pa) = upload(&p, &a, 0);
    let (eb, pb) = upload(&p, &b, 64);
    // Premier morceau de b recopié à la place du premier morceau de a.
    pa[0][HEADER..HEADER + CHUNK_CT].copy_from_slice(&pb[0][..CHUNK_CT]);
    let got = open_element(&p, &ea.k(), ea.pieces(), &pa, a.len() as u64);
    assert_eq!(got, Err(Error::PaquetCorrompu));
    assert_eq!(
        open_element(&p, &eb.k(), eb.pieces(), &pb, b.len() as u64).unwrap(),
        b
    );
    // Sans la bonne graine : rien ne s'ouvre.
    let got = open_element(&p, &[0; 32], eb.pieces(), &pb, b.len() as u64);
    assert_eq!(got, Err(Error::PaquetCorrompu));
}

#[test]
fn seal_final_refus() {
    let p = platform(9);
    let k = [0; 32];
    let err = |e: &[FinalEntry]| seal(&p, e, None, None).err();
    assert_eq!(err(&[]), Some(Error::Vide));
    assert_eq!(err(&[text("t", 400_001, 0, k)]), Some(Error::TexteTropLong));
    assert_eq!(err(&[text("t", 400_000, 0, k)]), None);
    assert_eq!(
        err(&[file(&"x".repeat(70_000), 1, 0, k)]),
        Some(Error::ManifesteTropGros)
    );
    assert_eq!(err(&[file("f", 10, 32_768, k)]), Some(Error::TropGros));
    assert_eq!(err(&[file("f", 10, 32_767, k)]), None);
    assert_eq!(
        err(&[file("f", 5 * MIB, 0, k), file("g", 10, 64, k)]),
        Some(Error::Chevauchement)
    );
    // Premier refus rencontré, dans l'ordre des entrées (comme elements.ts).
    assert_eq!(
        err(&[
            file("f", 10, 0, k),
            file("g", 10, 0, k),
            file("h", 1, 1 << 40, k)
        ]),
        Some(Error::Chevauchement)
    );
    // Entrées vides : aucune place, jamais de chevauchement.
    assert_eq!(err(&[file("f", 0, 0, k), file("g", 10, 0, k)]), None);
    // Droits : même couplage que Rights::new.
    let e = [file("f", 1, 0, k)];
    assert_eq!(
        seal(&p, &e, Some("coffre"), None).err(),
        Some(Error::DroitsInvalides)
    );
    assert_eq!(
        seal(&p, &e, Some("voir"), Some(6)).err(),
        Some(Error::DroitsInvalides)
    );
    assert_eq!(
        seal(&p, &e, Some("coffre"), Some(5)).err(),
        Some(Error::DroitsInvalides)
    );
    assert_eq!(
        seal(&p, &e, Some("tout"), None).err(),
        Some(Error::DroitsInvalides)
    );
    assert_eq!(
        seal(&p, &e, None, Some(6)).err(),
        Some(Error::DroitsInvalides)
    );
    assert_eq!(seal(&p, &e, Some("coffre"), Some(24)).err(), None);
}

#[test]
fn seal_final_tailles_hostiles_sans_panique() {
    let p = platform(10);
    let k = [0; 32];
    let err = |e: &[FinalEntry]| seal(&p, e, None, None).err();
    assert_eq!(
        err(&[file("f", u64::MAX, 0, k)]),
        Some(Error::TailleNonSure)
    );
    assert_eq!(
        err(&[file("f", MAX_SAFE + 1, 0, k)]),
        Some(Error::TailleNonSure)
    );
    assert_eq!(err(&[file("f", MAX_SAFE, 0, k)]), Some(Error::TropGros));
    assert_eq!(err(&[file("f", 1, u64::MAX, k)]), Some(Error::TropGros));
    assert_eq!(err(&[file("f", 0, u64::MAX, k)]), Some(Error::TropGros));
    assert_eq!(
        err(&[text("t", u64::MAX, 0, k)]),
        Some(Error::TexteTropLong)
    );
    // 2 Gio pile au morceau 0 : le plus grand palier.
    let fin = seal(&p, &[file("f", 2048 * MIB, 0, k)], None, None).unwrap();
    assert_eq!(fin.bucket, 32_769);
}

#[test]
fn seal_final_au_plus_200_elements() {
    // `manifest::parse` refuse plus de MAX_ITEMS éléments : seal_final ne l'écrit pas.
    let p = platform(11);
    let many: Vec<_> = (0..=MAX_ITEMS as u64)
        .map(|i| file("f", 1, i, [1; 32]))
        .collect();
    assert_eq!(
        seal(&p, &many, None, None).err(),
        Some(Error::ManifesteTropGros)
    );
    assert!(seal(&p, &many[..MAX_ITEMS], None, None).is_ok());
}

#[test]
fn cle_de_manifeste_jamais_reutilisee() {
    let p = platform(12);
    let k = keys(&p);
    let e = [file("f", 1, 0, [2; 32])];
    // Un refus de validation n'use pas la clé (comme elements.ts) ...
    let big = [file(&"x".repeat(70_000), 1, 0, [2; 32])];
    assert_eq!(
        block_on(seal_final(&big, &k, None, None)).err(),
        Some(Error::ManifesteTropGros)
    );
    block_on(seal_final(&e, &k, None, None)).unwrap();
    // ... mais une K_contenu ne chiffre qu'un manifeste : une nouvelle finalisation tire une R neuve.
    assert_eq!(
        block_on(seal_final(&e, &k, None, None)).err(),
        Some(Error::CleDejaUtilisee)
    );
    assert_eq!(
        block_on(seal_final(&[file("g", 2, 0, [3; 32])], &k, None, None)).err(),
        Some(Error::CleDejaUtilisee)
    );
}

#[test]
fn nettoyage_relu_dans_le_manifeste() {
    let p = platform(13);
    let entry = |name: &str, first, clean| {
        with(file(name, 10, first, [first as u8; 32]), |e| {
            e.kind = FinalKind::File(clean)
        })
    };
    let k = keys(&p);
    let fin = block_on(seal_final(
        &[
            entry("a.jpg", 0, Some(Clean::Image)),
            entry("b.zip", 1, Some(Clean::TelQuel)),
            entry("c.bin", 2, None),
            text("t", 1, 3, [9; 32]),
        ],
        &k,
        None,
        None,
    ))
    .unwrap();
    let (m, _) = open_tail(&k, fin.bucket, &fin.header, &fin.tail).unwrap();
    let cleans: Vec<_> = m.items.iter().map(|e| e.clean).collect();
    assert_eq!(
        cleans,
        [Some(Clean::Image), Some(Clean::TelQuel), None, None]
    );
    // Le clair du serveur (l'en-tête) ne contient rien du nettoyage.
    let h = String::from_utf8_lossy(&fin.header);
    assert!(!h.contains("image") && !h.contains("tel_quel") && !h.contains("clean"));
}

#[test]
fn empaquetage_petits_elements_et_grand_sur_sa_frontiere() {
    let sp = SEG_PLAIN;
    let ch: Vec<_> = [0, 1, C, C + 1, sp - 1, sp]
        .into_iter()
        .map(|n| chunks_for(n).unwrap())
        .collect();
    assert_eq!(ch, [0, 1, 1, 2, 64, 64]);
    let sm: Vec<_> = [0, 1, sp - 1, sp].into_iter().map(is_small).collect();
    assert_eq!(sm, [false, true, true, false]);
    let fp: Vec<_> = [0, 1, C + 1, 3 * C, 5 * C, 33 * C, sp - 1, sp, sp + 1]
        .into_iter()
        .map(|n| footprint_for(n).unwrap())
        .collect();
    assert_eq!(fp, [0, 1, 2, 3, 5, 33, 64, 64, 65]);
    assert_eq!(segments_needed(&[5 * C; 12]), Ok(1));
    assert_eq!(segments_needed(&[5 * C; 13]), Ok(2));
    assert_eq!(segments_needed(&[1_000_000; 20]), Ok(5));
    assert_eq!(segments_needed(&[sp + 1, 10, 10]), Ok(3));
    let fp: Vec<_> = [sp + 3 * C, sp + 33 * C, 2 * sp, 2 * sp + 5 * C + 1]
        .into_iter()
        .map(|n| footprint_for(n).unwrap())
        .collect();
    assert_eq!(fp, [67, 97, 128, 134]);
    let p = platform(14);
    assert_eq!(sealer(&p, 2 * C, 63).err(), Some(Error::PlaceInvalide));
    assert_eq!(sealer(&p, sp, 1).err(), Some(Error::PlaceInvalide));
    let a = pseudo(100_000, 11); // morceaux 0-1
    let gone = pseudo(150_000, 12); // morceaux 2-4, retiré
    let c = pseudo(10, 13); // morceau 5
    let big = pseudo(sp + 5, 14); // segments 1-2 (1 morceau au segment 2)
    let (ea, pa) = upload(&p, &a, 0);
    let (eg, pg) = upload(&p, &gone, 2);
    assert_eq!(
        eg.pieces(),
        [Piece {
            seg: 0,
            from: 2,
            chunks: 3
        }]
    );
    assert_eq!(pg[0].len(), 3 * CHUNK_CT);
    let (ec, pc) = upload(&p, &c, 5);
    let (eb, pb) = upload(&p, &big, 64);
    let chunks: Vec<_> = eb.pieces().iter().map(|p| p.chunks).collect();
    assert_eq!(chunks, [64, 1]);
    let k = keys(&p);
    let fin = block_on(seal_final(
        &[
            file("c", c.len() as u64, 5, *ec.k()),
            file("big", big.len() as u64, 64, *eb.k()),
            file("a", a.len() as u64, 0, *ea.k()),
        ],
        &k,
        None,
        None,
    ))
    .unwrap();
    assert_eq!(fin.bucket, bucket_for(64 * C + big.len() as u64).unwrap());
    let (m, _) = open_tail(&k, fin.bucket, &fin.header, &fin.tail).unwrap();
    let offsets: Vec<_> = m.items.iter().map(|e| e.offset).collect();
    assert_eq!(offsets, [5 * C, sp, 0]);
    assert_eq!(open_element(&p, &ec.k(), ec.pieces(), &pc, 10).unwrap(), c);
    assert_eq!(
        open_element(&p, &eb.k(), eb.pieces(), &pb, big.len() as u64).unwrap(),
        big
    );
    assert_eq!(
        open_element(&p, &ea.k(), ea.pieces(), &pa, a.len() as u64).unwrap(),
        a
    );
    let err = block_on(seal_final(
        &[
            file("a", a.len() as u64, 0, *ea.k()),
            file("b", 10, 1, *ec.k()),
        ],
        &keys(&p),
        None,
        None,
    ));
    assert_eq!(err.err(), Some(Error::Chevauchement));
}

#[test]
fn places_hostiles_sans_panique() {
    let p = platform(15);
    assert_eq!(sealer(&p, u64::MAX, 0).err(), Some(Error::TailleNonSure));
    assert_eq!(
        sealer(&p, MAX_SAFE + 1, 0).err(),
        Some(Error::TailleNonSure)
    );
    assert_eq!(sealer(&p, MAX_SAFE, 0).err(), Some(Error::TropGros));
    assert_eq!(sealer(&p, 1, u64::MAX).err(), Some(Error::TropGros));
    assert_eq!(sealer(&p, 0, u64::MAX).err(), Some(Error::TropGros));
    assert_eq!(sealer(&p, 1, DATA_CHUNKS).err(), Some(Error::TropGros));
    assert!(
        sealer(&p, 0, DATA_CHUNKS).is_ok(),
        "fichier vide en fin : aucune place"
    );
    assert_eq!(segments_for(u64::MAX), Err(Error::TailleNonSure));
    assert_eq!(chunks_for(MAX_SAFE + 1), Err(Error::TailleNonSure));
    assert_eq!(chunks_for(MAX_SAFE), Ok(MAX_SAFE.div_ceil(C)));
    assert!(!is_small(u64::MAX));
    assert_eq!(segments_needed(&[u64::MAX]), Err(Error::TailleNonSure));
    assert_eq!(
        segments_needed(&[MAX_SAFE; 4]),
        Ok(4 * MAX_SAFE.div_ceil(SEG_PLAIN))
    );
}

#[test]
fn alea_indisponible_rien_n_est_scelle() {
    let p = no_random();
    assert_eq!(
        block_on(ElementSealer::new(&p, 10, 0)).err(),
        Some(Error::AleatoireIndisponible)
    );
    // Place refusée avant tout tirage (le vecteur `element` le vérifie aussi).
    let p = replay(vec![]);
    assert_eq!(
        block_on(ElementSealer::new(&p, 10, DATA_CHUNKS)).err(),
        Some(Error::TropGros)
    );
}

/// Manifeste attendu des entrées (ce que `manifest::parse` doit relire).
fn expected(entries: &[FinalEntry], rights: Rights) -> Manifest {
    Manifest {
        rights,
        items: entries
            .iter()
            .map(|e| Entry {
                kind: match e.kind {
                    FinalKind::Text => Kind::Text,
                    FinalKind::File(_) => Kind::File,
                },
                name: e.name.clone(),
                mime: e.mime.clone(),
                size: e.size,
                offset: if e.size == 0 { 0 } else { e.first * C },
                text: None,
                k: Some(e.k.clone()),
                clean: match e.kind {
                    FinalKind::File(c) => c,
                    FinalKind::Text => None,
                },
            })
            .collect(),
    }
}

/// Entrées, droits demandés, durée, droits attendus à la relecture.
type Case = (Vec<FinalEntry>, Option<&'static str>, Option<u64>, Rights);

#[test]
fn ce_que_seal_final_ecrit_parse_le_relit_a_l_identique() {
    let p = platform(16);
    let odd = "q\"b\\s/\t\n\u{8}\u{c}\r\u{1}\u{1f}\u{7f}\u{2028}\u{2029}é😀x";
    let cases: Vec<Case> = vec![
        (
            vec![text("Note", 10, 0, [1; 32])],
            None,
            None,
            Rights::Enregistrer,
        ),
        (
            vec![
                with(file(odd, 4 * MIB, 64, [2; 32]), |e| {
                    e.kind = FinalKind::File(Some(Clean::Echec))
                }),
                file("", 0, 0, [3; 32]),
                with(text("n", 400_000, 0, [4; 32]), |e| e.mime = String::new()),
            ],
            Some("coffre"),
            Some(12),
            Rights::Coffre(shhdrop_core::manifest::KeepTtl::H12),
        ),
        (
            (0..MAX_ITEMS as u64)
                .map(|i| file(&format!("f{i}"), C, i, [i as u8; 32]))
                .collect(),
            Some("voir"),
            None,
            Rights::Voir,
        ),
        // Fin des données à 2 Gio pile, plus grand palier.
        (
            vec![file("g", 2048 * MIB, 0, [5; 32])],
            None,
            None,
            Rights::Enregistrer,
        ),
    ];
    for (entries, rights, ttl, want_rights) in cases {
        let k = keys(&p);
        let fin = block_on(seal_final(&entries, &k, rights, ttl)).unwrap();
        let (m, raw) = open_tail(&k, fin.bucket, &fin.header, &fin.tail).unwrap();
        assert_eq!(m, expected(&entries, want_rights));
        assert_eq!(*manifest::to_json(&m), raw, "réécrit : mêmes octets");
        assert!(raw.len() <= MANIFEST_MAX);
    }
    // Le plus gros manifeste accepté se relit aussi : nom ajusté à MANIFEST_MAX octets pile.
    let base = manifest::to_json(&expected(&[file("", 1, 0, [6; 32])], Rights::Enregistrer)).len();
    let e = [file(&"a".repeat(MANIFEST_MAX - base), 1, 0, [6; 32])];
    let k = keys(&p);
    let fin = block_on(seal_final(&e, &k, None, None)).unwrap();
    let (m, raw) = open_tail(&k, fin.bucket, &fin.header, &fin.tail).unwrap();
    assert_eq!(raw.len(), MANIFEST_MAX);
    assert_eq!(m, expected(&e, Rights::Enregistrer));
    let e = [file(&"a".repeat(MANIFEST_MAX - base + 1), 1, 0, [6; 32])];
    assert_eq!(
        block_on(seal_final(&e, &keys(&p), None, None)).err(),
        Some(Error::ManifesteTropGros)
    );
}

#[test]
fn debug_sans_secret() {
    let p = platform(17);
    let el = sealer(&p, 10, 0).unwrap();
    let k = *el.k();
    let dbg = format!("{el:?}");
    assert!(!dbg.contains(&format!("{:?}", k[..4].to_vec())), "{dbg}");
    let e = text("secret-nom", 1, 0, [0xab; 32]);
    let dbg = format!("{e:?}");
    assert!(!dbg.contains("secret-nom") && !dbg.contains("171"), "{dbg}");
}

/// Audit M6 : une note que le lecteur refuserait (plus de TEXT_MAX points de code, octets non
/// UTF-8) est refusée au scellement, avant le manifeste ; les notes limites passent.
#[test]
fn note_verifiee_au_scellement() {
    use shhdrop_core::format::{TEXT_BYTES_MAX, TEXT_MAX};
    let p = platform(7);
    let note = |raw: &[u8]| {
        let (el, _) = upload(&p, raw, 0);
        FinalEntry::note(&el, "n".into(), "text/plain".into()).map(|e| (e, el))
    };
    // Acceptées : vide, 100 000 points de code ASCII, 100 000 points de code de 4 octets
    // (400 000 octets), BOM initial.
    for raw in [
        Vec::new(),
        vec![b'a'; TEXT_MAX],
        "😀".repeat(TEXT_MAX).into_bytes(),
        "\u{feff}é".as_bytes().to_vec(),
    ] {
        let (e, el) = note(&raw).unwrap();
        assert_eq!(
            (e.size, e.first, e.kind),
            (raw.len() as u64, 0, FinalKind::Text)
        );
        assert_eq!(*e.k, *el.k());
        let fin = block_on(seal_final(&[e], &keys(&p), None, None)).unwrap();
        assert_eq!(fin.tail.len(), CHUNK_CT);
    }
    // Refusées : un point de code de trop, octets non UTF-8, demi-paire UTF-16 codée en UTF-8.
    assert_eq!(
        note(&vec![b'a'; TEXT_MAX + 1]).err(),
        Some(Error::TexteTropLong)
    );
    assert_eq!(note(b"ab\xffcd").err(), Some(Error::TexteInvalide));
    assert_eq!(note(b"\xed\xa0\x80").err(), Some(Error::TexteInvalide));
    assert_eq!(note(b"\xc3").err(), Some(Error::TexteInvalide));
    // Plus de TEXT_BYTES_MAX octets : refusée sans rien lire.
    let big = sealer(&p, TEXT_BYTES_MAX + 1, 0).unwrap();
    assert_eq!(big.check_note(), Err(Error::TexteTropLong));
    // Pièce pas encore chiffrée, ou lue de mauvaise taille : le moteur n'a pas vu le texte.
    let el = sealer(&p, 3, 0).unwrap();
    assert_eq!(el.check_note(), Err(Error::TexteInvalide));
    assert_eq!(block_on(el.piece(0, b"ab")), Err(Error::LectureIncomplete));
    assert_eq!(el.check_note(), Err(Error::TexteInvalide));
    // Un fichier n'est pas vérifié : octets libres.
    let (el, _) = upload(&p, b"\xff\xfe", 0);
    let f = FinalEntry::file(&el, None, "f".into(), "x/y".into());
    assert_eq!((f.size, f.first, f.kind), (2, 0, FinalKind::File(None)));
    assert!(block_on(seal_final(&[f], &keys(&p), None, None)).is_ok());
}
