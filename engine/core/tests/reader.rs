// Ouverture en flux (`reader::Reader`) : cas de `openStream` portés depuis
// crypto/container.test.ts et crypto/elements.test.ts (aller-retour, lecture à la demande,
// flux, altérations, palier annoncé faux, manifestes hostiles mais bien chiffrés, drapeau
// « dernier » déplacé, aperçu au-delà de PREVIEW_MAX, notes), plus les cas propres au moteur
// Rust : entrées sans `k` (ancien format, supprimé), erreurs du réseau rendues telles quelles,
// opérations simultanées sérialisées (réveils vérifiés), futur abandonné, `wipe` pendant une
// lecture, et 400 altérations à graine fixe (jamais de panique, toujours `paquet_corrompu`).
//
// Le vecteur `share` de l'ancien moteur est rouvert dans tests/vectors.rs.
mod support;

use core::cell::{Cell, RefCell};
use core::future::Future;
use core::pin::Pin;
use core::task::{Context, Poll, Waker};
use shhdrop_core::elements::{ELEMENT_AD, ElementSealer, FinalEntry, FinalKind, seal_final};
use shhdrop_core::encoding::b64u;
use shhdrop_core::envelope::{ContentKeys, content_keys, new_seed};
use shhdrop_core::format::{
    BUCKETS, CHUNK, CHUNK_CT, HEADER, MANIFEST_MAX, PREVIEW_MAX, SEG_CHUNKS, header, nonce,
    segment_count, segment_size,
};
use shhdrop_core::kdf::hkdf;
use shhdrop_core::manifest::{Kind, Rights};
use shhdrop_core::native::RustCrypto;
use shhdrop_core::platform::Key;
use shhdrop_core::reader::{Reader, Segments};
use shhdrop_core::{Error, Result};
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::task::Wake;
use support::{block_on, platform, splitmix};

const C: u64 = CHUNK as u64;
const SEG: u64 = SEG_CHUNKS as u64;
const SP: u64 = SEG * C;

type R = RustCrypto;

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

fn keys(p: &Rc<R>) -> ContentKeys<R> {
    block_on(content_keys(p, &new_seed(&**p).unwrap())).unwrap()
}

// ---------------------------------------------------------------------------------------------
// Serveur de test : rend les segments, note chaque appel ; « lent » : attend un tour (le futur
// rend Pending une fois et se réveille lui-même), pour que des opérations s'entrelacent.

struct Server {
    segs: Vec<Vec<u8>>,
    slow: bool,
    /// Prochain appel en échec (erreur du réseau, rendue telle quelle par le lecteur).
    fail: Cell<Option<Error>>,
    calls: RefCell<Vec<u32>>,
    /// Événements (« fetch n » et ceux des puits des tests), dans l'ordre.
    events: RefCell<Vec<String>>,
}

impl Server {
    fn new(segs: Vec<Vec<u8>>) -> Self {
        Self {
            segs,
            slow: false,
            fail: Cell::new(None),
            calls: RefCell::new(Vec::new()),
            events: RefCell::new(Vec::new()),
        }
    }

    fn slow(segs: Vec<Vec<u8>>) -> Self {
        Self {
            slow: true,
            ..Self::new(segs)
        }
    }

    fn calls(&self) -> Vec<u32> {
        self.calls.borrow().clone()
    }
}

/// Futur qui rend Pending une fois (après s'être réveillé), puis Ready.
struct YieldOnce(bool);

impl Future for YieldOnce {
    type Output = ();
    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        if self.0 {
            return Poll::Ready(());
        }
        self.0 = true;
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}

impl Segments for &Server {
    async fn fetch(&self, n: u32) -> Result<Vec<u8>> {
        self.calls.borrow_mut().push(n);
        self.events.borrow_mut().push(format!("fetch {n}"));
        if self.slow {
            YieldOnce(false).await;
        }
        if let Some(e) = self.fail.take() {
            return Err(e);
        }
        // Segment absent : vide (taille fausse).
        Ok(self.segs.get(n as usize).cloned().unwrap_or_default())
    }
}

// ---------------------------------------------------------------------------------------------
// Exécuteur des tests concurrents : chaque futur a son drapeau de réveil et n'est repris que
// réveillé. Un futur en attente que personne ne réveille est un blocage (échec du test).

struct Flag(AtomicBool);

impl Wake for Flag {
    fn wake(self: Arc<Self>) {
        self.0.store(true, Ordering::SeqCst);
    }
    fn wake_by_ref(self: &Arc<Self>) {
        self.0.store(true, Ordering::SeqCst);
    }
}

type Task<'a, T> = Pin<Box<dyn Future<Output = T> + 'a>>;

fn run_all<'a, T>(futs: Vec<Task<'a, T>>) -> Vec<T> {
    let mut tasks: Vec<_> = futs
        .into_iter()
        .map(|f| {
            let flag = Arc::new(Flag(AtomicBool::new(true)));
            (Some(f), Waker::from(Arc::clone(&flag)), flag)
        })
        .collect();
    let mut out: Vec<Option<T>> = tasks.iter().map(|_| None).collect();
    loop {
        let mut polled = false;
        for ((slot, waker, flag), o) in tasks.iter_mut().zip(out.iter_mut()) {
            let Some(f) = slot else { continue };
            if !flag.0.swap(false, Ordering::SeqCst) {
                continue;
            }
            polled = true;
            if let Poll::Ready(v) = f.as_mut().poll(&mut Context::from_waker(waker)) {
                *o = Some(v);
                *slot = None;
            }
        }
        if out.iter().all(Option::is_some) {
            return out.into_iter().map(Option::unwrap).collect();
        }
        assert!(polled, "blocage : futur en attente jamais réveillé");
    }
}

/// Exécute un seul futur (attentes réveillées comprises).
fn run<T>(f: impl Future<Output = T>) -> T {
    run_all(vec![Box::pin(f) as Task<'_, T>]).pop().unwrap()
}

fn poll_once<F: Future>(f: Pin<&mut F>) -> Poll<F::Output> {
    f.poll(&mut Context::from_waker(Waker::noop()))
}

// ---------------------------------------------------------------------------------------------
// Paquets de test.

/// Fichier du serveur pour une liste d'éléments, chiffrés comme à l'envoi (ElementSealer,
/// seal_final) : segments zéro-remplis, pièces posées, en-tête et morceau du manifeste.
struct Built {
    bucket: u32,
    segs: Vec<Vec<u8>>,
    keys: ContentKeys<R>,
}

fn place(g: u64) -> (usize, usize) {
    let n = (g / SEG) as usize;
    let off = if n == 0 { HEADER } else { 0 } + (g % SEG) as usize * CHUNK_CT;
    (n, off)
}

fn build(p: &Rc<R>, items: &[(FinalKind, &str, &[u8], u64)]) -> Built {
    let keys = keys(p);
    let mut entries = Vec::new();
    let mut placed = Vec::new();
    for &(kind, name, data, first) in items {
        let el = block_on(ElementSealer::new(p, data.len() as u64, first)).unwrap();
        for j in 0..el.pieces().len() {
            let (lo, hi) = el.range(j).unwrap();
            let ct = block_on(el.piece(j, &data[lo as usize..hi as usize])).unwrap();
            placed.push((el.pieces()[j], ct));
        }
        entries.push(FinalEntry {
            kind,
            name: name.into(),
            mime: if kind == FinalKind::Text {
                "text/plain;charset=utf-8".into()
            } else {
                "x/y".into()
            },
            size: data.len() as u64,
            first,
            k: el.k(),
        });
    }
    let fin = block_on(seal_final(&entries, &keys, None, None)).unwrap();
    let b = fin.bucket;
    let mut segs: Vec<Vec<u8>> = (0..segment_count(b))
        .map(|n| vec![0; segment_size(b, n).unwrap()])
        .collect();
    for (pc, ct) in placed {
        let g = u64::from(pc.seg) * SEG + u64::from(pc.from);
        let (n, off) = if g == 0 { (0, 0) } else { place(g) };
        segs[n][off..off + ct.len()].copy_from_slice(&ct);
    }
    segs[0][..HEADER].copy_from_slice(&fin.header);
    let last = segs.last_mut().unwrap();
    let len = last.len();
    last[len - CHUNK_CT..].copy_from_slice(&fin.tail);
    Built {
        bucket: b,
        segs,
        keys,
    }
}

/// Élément forgé : clair posé à partir du morceau `first`, sous HKDF(k, « shhdrop/v2/element »).
struct El<'a> {
    data: &'a [u8],
    first: u64,
    k: [u8; 32],
}

/// Paquet forgé (comme `forge` de container.test.ts) : `last_plain` (65 536 octets) est le clair
/// du dernier morceau, chiffré sous K_contenu ; `last` : morceaux qui portent le drapeau
/// « dernier » ; `only` : segments fabriqués (les autres restent vides).
fn forge(
    p: &Rc<R>,
    keys: &ContentKeys<R>,
    els: &[El],
    last_plain: &[u8],
    bucket: u32,
    last: &[u64],
    only: Option<&[u32]>,
) -> Vec<Vec<u8>> {
    let present = |n: u32| only.is_none_or(|o| o.contains(&n));
    let mut segs: Vec<Vec<u8>> = (0..segment_count(bucket))
        .map(|n| {
            if present(n) {
                vec![0; segment_size(bucket, n).unwrap()]
            } else {
                Vec::new()
            }
        })
        .collect();
    let mut put = |g: u64, ct: &[u8]| {
        let (n, off) = place(g);
        if present(n as u32) {
            segs[n][off..off + CHUNK_CT].copy_from_slice(ct);
        }
    };
    for e in els {
        let key = block_on(Key::import(p, hkdf::<32>(&e.k, "shhdrop/v2/element"))).unwrap();
        let count = e.data.len().div_ceil(CHUNK);
        let mut plain = vec![0u8; count * CHUNK];
        plain[..e.data.len()].copy_from_slice(e.data);
        let nonces: Vec<_> = (0..count as u64)
            .map(|c| nonce(e.first + c, last.contains(&(e.first + c))))
            .collect();
        let ct = block_on(key.seal_batch(ELEMENT_AD, &nonces, &plain, CHUNK)).unwrap();
        for (c, chunk) in ct.chunks(CHUNK_CT).enumerate() {
            put(e.first + c as u64, chunk);
        }
    }
    let hdr = header(&keys.engagement);
    let g = u64::from(bucket) - 1;
    let ct = block_on(keys.k_contenu.seal_batch(
        &hdr,
        &[nonce(g, last.contains(&g))],
        last_plain,
        CHUNK,
    ))
    .unwrap();
    put(g, &ct);
    if present(0) {
        segs[0][..HEADER].copy_from_slice(&hdr);
    }
    segs
}

/// Clair du dernier morceau : zéros, manifeste, longueur (4 octets gros-boutistes).
fn tail(json: &str) -> Vec<u8> {
    let j = json.as_bytes();
    let mut t = vec![0u8; CHUNK];
    t[CHUNK - 4 - j.len()..CHUNK - 4].copy_from_slice(j);
    t[CHUNK - 4..].copy_from_slice(&(j.len() as u32).to_be_bytes());
    t
}

fn len_only(n: u32) -> Vec<u8> {
    let mut t = vec![0u8; CHUNK];
    t[CHUNK - 4..].copy_from_slice(&n.to_be_bytes());
    t
}

fn manifest(items: &[String]) -> String {
    format!(
        r#"{{"v":2,"rights":"enregistrer","items":[{}]}}"#,
        items.join(",")
    )
}

fn fi(name: &str, size: u64, offset: u64, k: &[u8; 32]) -> String {
    format!(
        r#"{{"kind":"file","name":"{name}","mime":"x/y","size":{size},"offset":{offset},"k":"{}"}}"#,
        b64u(k)
    )
}

fn note(size: u64, offset: u64, k: &[u8; 32]) -> String {
    format!(
        r#"{{"kind":"text","name":"","mime":"text/plain","size":{size},"offset":{offset},"k":"{}"}}"#,
        b64u(k)
    )
}

fn open<'s>(
    p: &Rc<R>,
    srv: &'s Server,
    bucket: u32,
    keys: &ContentKeys<R>,
) -> Result<Reader<R, &'s Server>> {
    run(Reader::open(p, srv, bucket, keys))
}

/// Ouvre et lit chaque élément (item, puis stream_item) ; rend les clairs.
fn open_all(
    p: &Rc<R>,
    segs: Vec<Vec<u8>>,
    bucket: u32,
    keys: &ContentKeys<R>,
) -> Result<Vec<Vec<u8>>> {
    let srv = Server::new(segs);
    let r = open(p, &srv, bucket, keys)?;
    let mut out = Vec::new();
    for i in 0..r.manifest().items.len() {
        let a = run(r.item(i))?;
        let b = streamed(&r, i)?;
        assert_eq!(a, b);
        out.push(a);
    }
    Ok(out)
}

fn streamed<S: Segments>(r: &Reader<R, S>, i: usize) -> Result<Vec<u8>> {
    let out = RefCell::new(Vec::new());
    run(r.stream_item(i, async |part: Vec<u8>| {
        assert!(!part.is_empty() && part.len() <= CHUNK);
        out.borrow_mut().extend_from_slice(&part);
        Ok(())
    }))?;
    Ok(out.into_inner())
}

fn corrupt(p: &Rc<R>, segs: Vec<Vec<u8>>, bucket: u32, keys: &ContentKeys<R>) {
    assert_eq!(
        open_all(p, segs, bucket, keys).err(),
        Some(Error::PaquetCorrompu)
    );
}

// ---------------------------------------------------------------------------------------------
// Paquet commun : note, petit fichier (segment 0), fichier sur les segments 1 et 2 ; palier 160.

const TEXTE: &str = "Bonjour MOT-REPERE-123 é😀";

struct Share {
    p: Rc<R>,
    a: Vec<u8>,
    b: Vec<u8>,
    built: Built,
}

fn share() -> Share {
    let p = platform(1);
    let a = pseudo(300_000, 1); // morceaux 1 à 5
    let b = pseudo(SP + 70_000, 2); // morceaux 64 à 129 (segments 1 et 2)
    let built = build(
        &p,
        &[
            (FinalKind::Text, "", TEXTE.as_bytes(), 0),
            (FinalKind::File(None), "photo.png", &a, 1),
            (FinalKind::File(None), "secret-nom.pdf", &b, 64),
        ],
    );
    assert_eq!(built.bucket, 160);
    assert_eq!(built.segs.len(), 3);
    Share { p, a, b, built }
}

#[test]
fn aller_retour_manifeste_et_copies() {
    let s = share();
    let srv = Server::new(s.built.segs.clone());
    let r = open(&s.p, &srv, 160, &s.built.keys).unwrap();
    let m = r.manifest();
    assert_eq!(m.rights, Rights::Enregistrer);
    let got: Vec<_> = m
        .items
        .iter()
        .map(|e| (e.kind, e.name.as_str(), e.size, e.offset, e.text.as_deref()))
        .collect();
    assert_eq!(
        got,
        [
            (Kind::Text, "", TEXTE.len() as u64, 0, Some(TEXTE)),
            (Kind::File, "photo.png", s.a.len() as u64, C, None),
            (Kind::File, "secret-nom.pdf", s.b.len() as u64, SP, None),
        ]
    );
    assert!(m.items.iter().all(|e| e.k.is_some()));
    assert_eq!(run(r.item(0)).unwrap(), TEXTE.as_bytes());
    let mut x = run(r.item(1)).unwrap();
    assert_eq!(x, s.a);
    x.fill(0); // copie : le lecteur n'en dépend pas
    assert_eq!(run(r.item(1)).unwrap(), s.a);
    assert_eq!(run(r.item(2)).unwrap(), s.b);
    assert_eq!(run(r.item(3)).err(), Some(Error::ElementInexistant));
    assert_eq!(
        run(r.item(usize::MAX)).err(),
        Some(Error::ElementInexistant)
    );
    assert_eq!(
        run(r.stream_item(3, async |_: Vec<u8>| Ok(()))).err(),
        Some(Error::ElementInexistant)
    );
    assert_eq!(Error::ElementInexistant.to_string(), "element_inexistant");
    assert_eq!(
        Error::TropGrosPourApercu.to_string(),
        "trop_gros_pour_apercu"
    );
}

#[test]
fn aucun_nom_ni_texte_en_clair_dans_le_paquet() {
    let s = share();
    let all = s.built.segs.concat();
    for w in ["secret-nom.pdf", "MOT-REPERE-123", "photo.png"] {
        assert!(!all.windows(w.len()).any(|x| x == w.as_bytes()), "{w}");
    }
}

#[test]
fn lecture_a_la_demande_et_wipe() {
    let s = share();
    let srv = Server::new(s.built.segs.clone());
    let r = open(&s.p, &srv, 160, &s.built.keys).unwrap();
    // En-tête (0), manifeste (2), note (0).
    assert_eq!(srv.calls(), [0, 2, 0]);
    assert_eq!(run(r.item(1)).unwrap(), s.a); // segment 0 en cache
    assert_eq!(srv.calls(), [0, 2, 0]);
    assert_eq!(run(r.item(2)).unwrap(), s.b); // segments 1 et 2
    assert_eq!(srv.calls(), [0, 2, 0, 1, 2]);
    assert_eq!(run(r.item(0)).unwrap(), TEXTE.as_bytes()); // note : lue à l'ouverture
    assert_eq!(srv.calls(), [0, 2, 0, 1, 2]);
    r.wipe();
    assert_eq!(run(r.item(1)).unwrap(), s.a); // après wipe : rechargé
    assert_eq!(srv.calls(), [0, 2, 0, 1, 2, 0]);
    r.wipe();
    r.wipe(); // deux fois : sans effet
    assert_eq!(run(r.item(1)).unwrap(), s.a);
    assert_eq!(srv.calls(), [0, 2, 0, 1, 2, 0, 0]);
}

#[test]
fn stream_item_morceaux_dans_l_ordre() {
    let s = share();
    let srv = Server::new(s.built.segs.clone());
    let r = open(&s.p, &srv, 160, &s.built.keys).unwrap();
    let parts = RefCell::new(Vec::new());
    run(r.stream_item(2, async |part: Vec<u8>| {
        parts.borrow_mut().push(part);
        Ok(())
    }))
    .unwrap();
    let parts = parts.into_inner();
    assert_eq!(parts.len() as u64, (s.b.len() as u64).div_ceil(C));
    assert!(parts[..parts.len() - 1].iter().all(|x| x.len() == CHUNK));
    assert_eq!(parts.concat(), s.b);
    assert_eq!(streamed(&r, 1).unwrap(), s.a);
    assert_eq!(streamed(&r, 0).unwrap(), TEXTE.as_bytes());
    // Erreur du puits : rendue telle quelle, rien de plus n'est livré.
    let n = Cell::new(0);
    let err = run(r.stream_item(2, async |_: Vec<u8>| {
        n.set(n.get() + 1);
        if n.get() == 3 {
            return Err(Error::LectureIncomplete);
        }
        Ok(())
    }));
    assert_eq!(err, Err(Error::LectureIncomplete));
    assert_eq!(n.get(), 3);
}

#[test]
fn octets_modifies() {
    let s = share();
    let (p, k) = (&s.p, &s.built.keys);
    let alter = |f: &dyn Fn(&mut Vec<Vec<u8>>)| {
        let mut segs = s.built.segs.clone();
        f(&mut segs);
        segs
    };
    // Morceau 3 (petit fichier), tag du morceau 70 (segment 1), manifeste (dernier morceau).
    corrupt(p, alter(&|s| s[0][HEADER + 3 * CHUNK_CT + 10] ^= 1), 160, k);
    corrupt(p, alter(&|s| s[1][7 * CHUNK_CT - 1] ^= 0x80), 160, k);
    corrupt(p, alter(&|s| s[2][32 * CHUNK_CT - 100] ^= 1), 160, k);
    // Note (morceau 0).
    corrupt(p, alter(&|s| s[0][HEADER + 5] ^= 1), 160, k);
    // En-tête : magie, version, réservé, engagement.
    for pos in [0, 4, 10, 20, 47] {
        corrupt(p, alter(&|s| s[0][pos] ^= 1), 160, k);
    }
    // Aussi détecté par stream_item (l'ouverture réussit, le segment 1 n'est pas encore lu).
    let srv = Server::new(alter(&|s| s[1][10] ^= 1));
    let r = open(p, &srv, 160, k).unwrap();
    assert_eq!(streamed(&r, 2).err(), Some(Error::PaquetCorrompu));
    assert_eq!(run(r.item(2)).err(), Some(Error::PaquetCorrompu));
    assert_eq!(run(r.item(1)).unwrap(), s.a); // le reste se lit toujours
}

#[test]
fn morceaux_et_segments_echanges_tronques_ou_allonges() {
    let s = share();
    let (p, k) = (&s.p, &s.built.keys);
    let sg = &s.built.segs;
    let swap = |a: usize, b: usize| {
        let mut x = sg.clone();
        let ca = x[0][HEADER + a * CHUNK_CT..HEADER + (a + 1) * CHUNK_CT].to_vec();
        let cb = x[0][HEADER + b * CHUNK_CT..HEADER + (b + 1) * CHUNK_CT].to_vec();
        x[0][HEADER + a * CHUNK_CT..HEADER + (a + 1) * CHUNK_CT].copy_from_slice(&cb);
        x[0][HEADER + b * CHUNK_CT..HEADER + (b + 1) * CHUNK_CT].copy_from_slice(&ca);
        x
    };
    corrupt(p, swap(1, 2), 160, k); // même élément
    corrupt(p, swap(0, 1), 160, k); // note ↔ fichier : autre clé
    let cut = |n: usize, len: usize| {
        let mut x = sg.clone();
        x[n].truncate(len);
        x
    };
    corrupt(p, cut(2, sg[2].len() - 1), 160, k);
    corrupt(p, cut(2, sg[2].len() - CHUNK_CT), 160, k);
    corrupt(p, cut(0, sg[0].len() - 1), 160, k);
    corrupt(p, cut(0, 0), 160, k);
    let mut long = sg.clone();
    long[2].push(0);
    corrupt(p, long, 160, k);
    corrupt(p, vec![sg[0].clone(), sg[1].clone()], 160, k);
    corrupt(p, vec![sg[0].clone(), sg[2].clone(), sg[1].clone()], 160, k);
    corrupt(p, vec![sg[1].clone(), sg[0].clone(), sg[2].clone()], 160, k);
    corrupt(p, vec![], 160, k);
}

#[test]
fn palier_annonce_faux() {
    let s = share();
    for b in [80, 400, 16, 1, 2, 0, 159, 161, u32::MAX] {
        corrupt(&s.p, s.built.segs.clone(), b, &s.built.keys);
    }
}

#[test]
fn paquet_d_un_autre_partage() {
    let s = share();
    let other = keys(&s.p);
    corrupt(&s.p, s.built.segs.clone(), 160, &other);
}

#[test]
fn erreur_du_reseau_rendue_telle_quelle() {
    let s = share();
    let srv = Server::new(s.built.segs.clone());
    srv.fail.set(Some(Error::LectureIncomplete));
    assert_eq!(
        open(&s.p, &srv, 160, &s.built.keys).err(),
        Some(Error::LectureIncomplete)
    );
    let r = open(&s.p, &srv, 160, &s.built.keys).unwrap();
    srv.fail.set(Some(Error::AleatoireIndisponible));
    assert_eq!(run(r.item(2)).err(), Some(Error::AleatoireIndisponible));
    assert_eq!(run(r.item(2)).unwrap(), s.b); // l'opération suivante recharge
}

// ---------------------------------------------------------------------------------------------
// Manifestes hostiles, bien chiffrés (forge).

struct Forge {
    p: Rc<R>,
    keys: ContentKeys<R>,
    k: [u8; 32],
}

const D3: [u8; 3] = [7, 8, 9];

fn forger() -> Forge {
    let p = platform(2);
    let keys = keys(&p);
    Forge {
        p,
        keys,
        k: [0x42; 32],
    }
}

impl Forge {
    fn segs(&self, data: &[u8], last_plain: &[u8], bucket: u32) -> Vec<Vec<u8>> {
        let els = [El {
            data,
            first: 0,
            k: self.k,
        }];
        let last = [u64::from(bucket) - 1];
        forge(&self.p, &self.keys, &els, last_plain, bucket, &last, None)
    }

    fn open(&self, segs: Vec<Vec<u8>>, bucket: u32) -> Result<Vec<Vec<u8>>> {
        open_all(&self.p, segs, bucket, &self.keys)
    }

    fn good(&self) -> String {
        manifest(&[fi("a", 3, 0, &self.k)])
    }
}

#[test]
fn le_forgeur_produit_un_paquet_valide() {
    let f = forger();
    let got = f.open(f.segs(&D3, &tail(&f.good()), 16), 16).unwrap();
    assert_eq!(got, [D3.to_vec()]);
}

#[test]
fn manifestes_invalides() {
    let f = forger();
    let k = &f.k;
    let item = fi("a", 3, 0, k);
    let data_len = 16 * C - 4; // − longueur du manifeste, ajoutée plus bas
    let too_many = vec![item.clone(); 201];
    let cases: Vec<(&str, Vec<u8>)> =
        vec![
        ("longueur > 65532", len_only(65_533)),
        ("longueur hors du clair", len_only(16 * CHUNK as u32)),
        ("longueur maximale", len_only(u32::MAX)),
        ("JSON invalide", tail("{x")),
        ("v = 1", tail(&f.good().replace(r#""v":2"#, r#""v":1"#))),
        (
            "v absent",
            tail(&format!(r#"{{"items":[{item}]}}"#)),
        ),
        ("items absent", tail(r#"{"v":2}"#)),
        ("items vide", tail(r#"{"v":2,"items":[]}"#)),
        ("201 éléments", tail(&manifest(&too_many))),
        (
            "kind inconnu",
            tail(&manifest(&[item.replace(r#""file""#, r#""exe""#)])),
        ),
        (
            "fichier dans la zone du manifeste (hors des données)",
            tail(&manifest(&[fi("a", 3, 16 * C - 100, k)])),
        ),
        ("taille négative", tail(&manifest(&[fi("a", 3, 0, k).replace(":3,", ":-1,")]))),
        ("taille non entière", tail(&manifest(&[fi("a", 3, 0, k).replace(":3,", ":1.5,")]))),
        (
            "nom non chaîne",
            tail(&manifest(&[item.replace(r#""name":"a""#, r#""name":5"#)])),
        ),
        (
            "fichier sans k (ancien format, supprimé)",
            tail(&manifest(&[
                r#"{"kind":"file","name":"a","mime":"x/y","size":3,"offset":0}"#.into(),
            ])),
        ),
        (
            "note dans le manifeste (ancien format, supprimé)",
            tail(&manifest(&[
                r#"{"kind":"text","name":"","mime":"text/plain","size":0,"offset":0,"text":"a"}"#
                    .into(),
            ])),
        ),
        (
            "texte sans text ni k",
            tail(&manifest(&[
                r#"{"kind":"text","name":"","mime":"text/plain","size":0,"offset":0}"#.into(),
            ])),
        ),
        (
            "fichier avec text",
            tail(&manifest(&[item.replace(r#""k":"#, r#""text":"a","k":"#)])),
        ),
        (
            "note élément avec text",
            tail(&manifest(&[note(1, 0, k).replace(r#""k":"#, r#""text":"a","k":"#)])),
        ),
        (
            "note élément k mal formé",
            tail(&manifest(&[note(1, 0, k).replace(&b64u(k), "k")])),
        ),
        (
            "k de 42 caractères",
            tail(&manifest(&[item.replace(&b64u(k), &b64u(k)[..42])])),
        ),
        (
            "note élément trop grande",
            tail(&manifest(&[note(400_001, 0, k)])),
        ),
    ];
    for (what, end) in cases {
        assert_eq!(
            f.open(f.segs(&D3, &end, 16), 16).err(),
            Some(Error::PaquetCorrompu),
            "{what}"
        );
    }
    // Fichier qui finit pile au début du manifeste : lisible par parse, mais palier non
    // canonique (les données entrent dans le dernier morceau, réservé au manifeste).
    let mut off = 0;
    for _ in 0..5 {
        off = data_len - manifest(&[fi("a", 3, off, k)]).len() as u64 - 3;
    }
    let m = manifest(&[fi("a", 3, off, k)]);
    assert_eq!(
        off + 3,
        data_len - m.len() as u64,
        "fin des données = début du manifeste"
    );
    assert_eq!(
        f.open(f.segs(&D3, &tail(&m), 16), 16).err(),
        Some(Error::PaquetCorrompu)
    );
}

#[test]
fn droits_du_manifeste_inconnus_ouvert_en_voir() {
    let f = forger();
    let m = f
        .good()
        .replace("enregistrer\"", "admin\",\"keep_ttl_h\":24");
    let srv = Server::new(f.segs(&D3, &tail(&m), 16));
    let r = open(&f.p, &srv, 16, &f.keys).unwrap();
    assert_eq!(r.manifest().rights, Rights::Voir);
    assert_eq!(run(r.item(0)).unwrap(), D3);
}

#[test]
fn manifeste_de_65_532_octets() {
    let f = forger();
    let with = |name: &str| manifest(&[fi(name, 3, 0, &f.k)]);
    let name = "n".repeat(MANIFEST_MAX - with("").len());
    assert_eq!(with(&name).len(), MANIFEST_MAX);
    let srv = Server::new(f.segs(&D3, &tail(&with(&name)), 16));
    let r = open(&f.p, &srv, 16, &f.keys).unwrap();
    assert_eq!(r.manifest().items[0].name, name);
    assert_eq!(run(r.item(0)).unwrap(), D3);
    // Un octet de plus ne tient plus : longueur 65 533 annoncée.
    let mut t = len_only(65_533);
    let big = with(&format!("{name}n"));
    t[..CHUNK - 4].copy_from_slice(&big.as_bytes()[1..]);
    assert_eq!(
        f.open(f.segs(&D3, &t, 16), 16).err(),
        Some(Error::PaquetCorrompu)
    );
}

#[test]
fn palier_non_canonique_ou_hors_liste() {
    let f = forger();
    let t = tail(&f.good());
    for b in [80, 160] {
        assert_eq!(
            f.open(f.segs(&D3, &t, b), b).err(),
            Some(Error::PaquetCorrompu),
            "{b}"
        );
    }
    // Palier 1 : aucune donnée (le seul morceau est celui du manifeste).
    assert_eq!(
        f.open(f.segs(&[], &t, 1), 1).err(),
        Some(Error::PaquetCorrompu)
    );
    // Palier hors liste : refusé avant toute lecture.
    let srv = Server::new(f.segs(&D3, &t, 16));
    for b in [2, 17, 0] {
        assert_eq!(
            open(&f.p, &srv, b, &f.keys).err(),
            Some(Error::PaquetCorrompu)
        );
    }
    assert!(srv.calls().is_empty());
}

#[test]
fn palier_1_note_vide_seulement() {
    let f = forger();
    let m = manifest(&[note(0, 0, &f.k)]);
    let srv = Server::new(f.segs(&[], &tail(&m), 1));
    let r = open(&f.p, &srv, 1, &f.keys).unwrap();
    assert_eq!(r.manifest().items[0].text.as_deref(), Some(""));
    assert_eq!(run(r.item(0)).unwrap(), b"");
    let calls = Cell::new(0);
    run(r.stream_item(0, async |_: Vec<u8>| {
        calls.set(calls.get() + 1);
        Ok(())
    }))
    .unwrap();
    assert_eq!(calls.get(), 0, "note vide : rien de livré");
}

#[test]
fn drapeau_dernier_morceau_absent_ou_deplace() {
    let f = forger();
    let t = tail(&f.good());
    let els = [El {
        data: &D3,
        first: 0,
        k: f.k,
    }];
    // Absent du dernier morceau.
    let segs = forge(&f.p, &f.keys, &els, &t, 16, &[99], None);
    assert_eq!(f.open(segs, 16).err(), Some(Error::PaquetCorrompu));
    // Posé sur un morceau de données (troncature simulée), dernier morceau correct :
    // l'ouverture réussit, la lecture échoue.
    let big = pseudo(14 * C, 7);
    let m = manifest(&[fi("a", 14 * C, 0, &f.k)]);
    let els = [El {
        data: &big,
        first: 0,
        k: f.k,
    }];
    let segs = forge(&f.p, &f.keys, &els, &tail(&m), 16, &[15, 3], None);
    let srv = Server::new(segs);
    let r = open(&f.p, &srv, 16, &f.keys).unwrap();
    assert_eq!(run(r.item(0)).err(), Some(Error::PaquetCorrompu));
    assert_eq!(streamed(&r, 0).err(), Some(Error::PaquetCorrompu));
    // Seulement là : rien ne s'ouvre.
    let segs = forge(&f.p, &f.keys, &els, &tail(&m), 16, &[3], None);
    assert_eq!(f.open(segs, 16).err(), Some(Error::PaquetCorrompu));
    // Témoin : drapeau à sa place.
    let segs = forge(&f.p, &f.keys, &els, &tail(&m), 16, &[15], None);
    assert_eq!(f.open(segs, 16).unwrap(), [big]);
}

#[test]
fn element_de_plus_de_200_mio_apercu_refuse() {
    let f = forger();
    assert_eq!(PREVIEW_MAX, 200 * 1_048_576);
    let m = manifest(&[fi("gros.bin", PREVIEW_MAX + 1, 0, &f.k)]);
    // Palier 4000 (63 segments) : seuls le segment 0 et le dernier sont fabriqués.
    let data = pseudo(SP, 9);
    let els = [El {
        data: &data,
        first: 0,
        k: f.k,
    }];
    let segs = forge(
        &f.p,
        &f.keys,
        &els,
        &tail(&m),
        4000,
        &[3999],
        Some(&[0, 62]),
    );
    let srv = Server::new(segs);
    let r = open(&f.p, &srv, 4000, &f.keys).unwrap();
    assert_eq!(r.manifest().items[0].size, PREVIEW_MAX + 1);
    assert_eq!(run(r.item(0)).err(), Some(Error::TropGrosPourApercu));
    assert_eq!(srv.calls(), [0, 62]);
    // stream_item n'a pas cette limite : il livre le segment 0 puis bute sur le segment 1.
    let got = RefCell::new(Vec::new());
    let err = run(r.stream_item(0, async |c: Vec<u8>| {
        got.borrow_mut().extend_from_slice(&c);
        Ok(())
    }));
    assert_eq!(err, Err(Error::PaquetCorrompu));
    assert_eq!(got.into_inner(), data);
    assert_eq!(srv.calls(), [0, 62, 0, 1]);
}

// ---------------------------------------------------------------------------------------------
// Notes (D41-36).

#[test]
fn notes_elements() {
    let f = forger();
    let k = f.k;
    let one = |bytes: &[u8]| {
        let m = manifest(&[note(bytes.len() as u64, 0, &k)]);
        let els = [El {
            data: bytes,
            first: 0,
            k,
        }];
        let last = 15;
        let segs = forge(&f.p, &f.keys, &els, &tail(&m), 16, &[last], None);
        let srv = Server::new(segs);
        open(&f.p, &srv, 16, &f.keys).map(|r| r.manifest().items[0].text.clone().unwrap())
    };
    // 100 000 caractères (200 000 octets) : relue.
    let long = "é".repeat(100_000);
    assert_eq!(one(long.as_bytes()).unwrap(), long);
    // 100 001 caractères : refusée.
    assert_eq!(
        one("a".repeat(100_001).as_bytes()).err(),
        Some(Error::PaquetCorrompu)
    );
    // UTF-8 invalide : refusée.
    assert_eq!(one(&[b'a', 0xff, 0xfe]).err(), Some(Error::PaquetCorrompu));
    assert_eq!(one(&[0xc3]).err(), Some(Error::PaquetCorrompu));
    // BOM initial gardé (TextDecoder ignoreBOM : true).
    let bom = format!("{}a", char::from_u32(0xFEFF).unwrap());
    assert_eq!(one(bom.as_bytes()).unwrap(), bom);
}

#[test]
fn nettoyage_relu() {
    let p = platform(3);
    let d = pseudo(10, 1);
    let b = build(
        &p,
        &[
            (
                FinalKind::File(Some(shhdrop_core::manifest::Clean::Image)),
                "a",
                &d,
                0,
            ),
            (FinalKind::File(None), "b", &d, 1),
        ],
    );
    let srv = Server::new(b.segs.clone());
    let r = open(&p, &srv, b.bucket, &b.keys).unwrap();
    let cl: Vec<_> = r.manifest().items.iter().map(|e| e.clean).collect();
    assert_eq!(cl, [Some(shhdrop_core::manifest::Clean::Image), None]);
}

// ---------------------------------------------------------------------------------------------
// Opérations simultanées (Review Focus 5).

#[test]
fn operations_simultanees_serialisees() {
    let s = share();
    let srv = Server::slow(s.built.segs.clone());
    let r = open(&s.p, &srv, 160, &s.built.keys).unwrap();
    srv.calls.borrow_mut().clear();
    srv.events.borrow_mut().clear();
    let stream = RefCell::new(Vec::new());
    let ops: Vec<Task<'_, Result<Vec<u8>>>> = vec![
        Box::pin(r.item(0)),
        Box::pin(r.item(1)),
        Box::pin(async {
            r.stream_item(2, async |c: Vec<u8>| {
                srv.events.borrow_mut().push("sink".into());
                stream.borrow_mut().extend_from_slice(&c);
                Ok(())
            })
            .await
            .map(|()| Vec::new())
        }),
        Box::pin(r.item(2)),
    ];
    let res = run_all(ops);
    assert_eq!(res[0].as_deref(), Ok(TEXTE.as_bytes()));
    assert_eq!(res[1].as_ref().unwrap(), &s.a);
    assert_eq!(stream.into_inner(), s.b);
    assert_eq!(res[3].as_ref().unwrap(), &s.b);
    // Une opération à la fois : le segment 0 est en cache (note lue à l'ouverture) ; le flux lit
    // 1 puis 2, l'aperçu qui suit relit 1 puis 2. Entrelacées, elles liraient 1, 1, 2, 2.
    assert_eq!(srv.calls(), [1, 2, 1, 2]);
    let ev = srv.events.borrow();
    let last_sink = ev.iter().rposition(|e| e == "sink").unwrap();
    let third_fetch = ev
        .iter()
        .enumerate()
        .filter(|(_, e)| e.starts_with("fetch"))
        .nth(2)
        .unwrap()
        .0;
    assert!(last_sink < third_fetch, "{ev:?}");
}

#[test]
fn wipe_pendant_une_lecture() {
    let s = share();
    let srv = Server::slow(s.built.segs.clone());
    let r = open(&s.p, &srv, 160, &s.built.keys).unwrap();
    let mut f = Box::pin(r.item(2));
    assert!(poll_once(f.as_mut()).is_pending()); // en attente du segment 1
    r.wipe();
    assert_eq!(run(f).unwrap(), s.b);
    // wipe depuis le puits, à chaque morceau : aucune panique, lecture complète.
    let out = RefCell::new(Vec::new());
    run(r.stream_item(2, async |c: Vec<u8>| {
        r.wipe();
        out.borrow_mut().extend_from_slice(&c);
        Ok(())
    }))
    .unwrap();
    assert_eq!(out.into_inner(), s.b);
    srv.calls.borrow_mut().clear();
    assert_eq!(run(r.item(1)).unwrap(), s.a);
    assert_eq!(srv.calls(), [0]); // cache vidé : rechargé
}

#[test]
fn erreur_ou_abandon_liberent_la_file() {
    let s = share();
    let srv = Server::slow(s.built.segs.clone());
    let r = open(&s.p, &srv, 160, &s.built.keys).unwrap();
    // Une opération en échec libère la file.
    srv.fail.set(Some(Error::LectureIncomplete));
    let res = run_all::<Result<Vec<u8>>>(vec![Box::pin(r.item(2)), Box::pin(r.item(1))]);
    assert_eq!(res[0], Err(Error::LectureIncomplete));
    assert_eq!(res[1].as_ref().unwrap(), &s.a);
    // Opération en cours abandonnée : la suivante (en file) passe.
    let mut a = Box::pin(r.item(2));
    assert!(poll_once(a.as_mut()).is_pending());
    let mut b = Box::pin(r.item(1));
    assert!(poll_once(b.as_mut()).is_pending()); // en file
    drop(a);
    assert_eq!(run(b).unwrap(), s.a);
    // Opération en file abandonnée : la file continue.
    let mut a = Box::pin(r.item(2));
    assert!(poll_once(a.as_mut()).is_pending());
    let mut b = Box::pin(r.item(1));
    assert!(poll_once(b.as_mut()).is_pending());
    drop(b);
    assert_eq!(run(a).unwrap(), s.b);
    assert_eq!(run(r.item(1)).unwrap(), s.a);
    // Abandonnée après avoir reçu son tour, sans avoir été reprise : la suivante passe.
    let mut a = Box::pin(r.item(2));
    assert!(poll_once(a.as_mut()).is_pending());
    let mut b = Box::pin(r.item(1));
    assert!(poll_once(b.as_mut()).is_pending());
    let mut c = Box::pin(r.item(0));
    assert!(poll_once(c.as_mut()).is_pending());
    assert_eq!(run(a).unwrap(), s.b); // b reçoit son tour
    drop(b);
    assert_eq!(run(c).unwrap(), TEXTE.as_bytes());
}

// ---------------------------------------------------------------------------------------------
// 400 altérations à graine fixe : jamais de panique, toujours `paquet_corrompu`.

#[test]
fn quatre_cents_alterations_sans_panique() {
    let p = platform(4);
    let note_txt = "Allo été";
    let a = pseudo(100_000, 3); // morceaux 1-2
    let c = pseudo(10 * C - 5, 4); // morceaux 64-73
    let b = build(
        &p,
        &[
            (FinalKind::Text, "n", note_txt.as_bytes(), 0),
            (FinalKind::File(None), "a", &a, 1),
            (FinalKind::File(None), "c", &c, 64),
        ],
    );
    assert_eq!(b.bucket, 80);
    let good = b.segs.clone();
    assert_eq!(
        open_all(&p, good.clone(), 80, &b.keys).unwrap(),
        [note_txt.as_bytes().to_vec(), a.clone(), c.clone()]
    );
    // Morceaux lus : note, petit fichier, grand fichier, manifeste.
    let used: Vec<u64> = [0, 1, 2].into_iter().chain(64..74).chain([79]).collect();
    // Variantes au drapeau « dernier » déplacé : rechiffrées par le forgeur avec la graine et
    // la clé de chaque élément (manifeste identique), drapeau sur un autre morceau lu.
    let m = {
        let srv = Server::new(good.clone());
        let r = open(&p, &srv, 80, &b.keys).unwrap();
        let mut m = r.manifest().clone();
        m.items[0].text = None; // texte de la note : relu, jamais écrit dans le manifeste
        m
    };
    let json = shhdrop_core::manifest::to_json(&m);
    let last_plain = tail(core::str::from_utf8(&json).unwrap());
    let items = [note_txt.as_bytes(), &a, &c];
    let firsts = [0, 1, 64];
    let els: Vec<El> = m
        .items
        .iter()
        .zip(items)
        .zip(firsts)
        .map(|((e, data), first)| El {
            data,
            first,
            k: **e.k.as_ref().unwrap(),
        })
        .collect();
    let mut moved = Vec::new();
    for &g in &used {
        if g != 79 {
            moved.push(forge(&p, &b.keys, &els, &last_plain, 80, &[g], None));
            moved.push(forge(&p, &b.keys, &els, &last_plain, 80, &[g, 79], None));
        }
    }
    // Témoin : le forgeur redonne le paquet d'origine avec le drapeau à sa place.
    assert_eq!(forge(&p, &b.keys, &els, &last_plain, 80, &[79], None), good);

    let mut rng = splitmix(0x5348_4832);
    let mut next = move |n: u64| {
        let mut x = [0u8; 8];
        rng(&mut x).unwrap();
        u64::from_le_bytes(x) % n
    };
    let mut kinds = [0u32; 6];
    for case in 0..400 {
        let mut segs = good.clone();
        let mut bucket = 80u32;
        for _ in 0..=next(3) {
            let kind = next(6) as usize;
            kinds[kind] += 1;
            match kind {
                0 => {
                    let n = next(segs.len() as u64) as usize;
                    let len = segs[n].len() as u64;
                    segs[n].truncate(next(len.max(1)) as usize);
                }
                1 => {
                    let n = next(segs.len() as u64) as usize;
                    let extra = 1 + next(CHUNK_CT as u64) as usize;
                    segs[n].extend(std::iter::repeat_n(0xA5, extra));
                }
                2 => {
                    // Octet modifié dans l'en-tête ou dans un morceau lu.
                    let (n, pos) = if next(4) == 0 {
                        (0, next(HEADER as u64) as usize)
                    } else {
                        let (n, off) = place(used[next(used.len() as u64) as usize]);
                        (n, off + next(CHUNK_CT as u64) as usize)
                    };
                    if let Some(x) = segs[n].get_mut(pos) {
                        *x ^= 1 << next(8);
                    }
                }
                3 => {
                    if next(2) == 0 {
                        segs.swap(0, 1);
                    } else {
                        let (n1, o1) = place(used[next(used.len() as u64) as usize]);
                        let (n2, o2) = place(used[next(used.len() as u64) as usize]);
                        if segs[n1].len() >= o1 + CHUNK_CT && segs[n2].len() >= o2 + CHUNK_CT {
                            let x = segs[n1][o1..o1 + CHUNK_CT].to_vec();
                            let y = segs[n2][o2..o2 + CHUNK_CT].to_vec();
                            segs[n1][o1..o1 + CHUNK_CT].copy_from_slice(&y);
                            segs[n2][o2..o2 + CHUNK_CT].copy_from_slice(&x);
                        }
                    }
                }
                4 => {
                    bucket = if next(2) == 0 {
                        BUCKETS[next(BUCKETS.len() as u64) as usize]
                    } else {
                        next(u64::from(u32::MAX) + 1) as u32
                    };
                }
                _ => segs = moved[next(moved.len() as u64) as usize].clone(),
            }
        }
        if segs == good && bucket == 80 {
            continue; // altérations qui s'annulent : rien à vérifier
        }
        assert_eq!(
            open_all(&p, segs, bucket, &b.keys).err(),
            Some(Error::PaquetCorrompu),
            "cas {case}"
        );
    }
    assert!(kinds.iter().all(|&n| n > 30), "{kinds:?}");
}

#[test]
fn ancien_format_refuse() {
    // Spec §3 : la lecture des entrées sans `k` est supprimée, même pour un paquet bien formé
    // de l'ancien moteur (palier canonique, données sous K_contenu, AD = en-tête).
    let f = forger();
    let old_note = manifest(&[
        r#"{"kind":"text","name":"","mime":"text/plain","size":0,"offset":0,"text":"a"}"#.into(),
    ]);
    let srv = Server::new(f.segs(&[], &tail(&old_note), 1));
    assert_eq!(
        open(&f.p, &srv, 1, &f.keys).err(),
        Some(Error::PaquetCorrompu)
    );
    let old_file =
        manifest(&[r#"{"kind":"file","name":"a","mime":"x/y","size":3,"offset":0}"#.into()]);
    let mut segs = f.segs(&[], &tail(&old_file), 16);
    let mut plain = vec![0u8; CHUNK];
    plain[..3].copy_from_slice(&D3);
    let hdr = header(&f.keys.engagement);
    let ct = block_on(
        f.keys
            .k_contenu
            .seal_batch(&hdr, &[nonce(0, false)], &plain, CHUNK),
    )
    .unwrap();
    segs[0][HEADER..HEADER + CHUNK_CT].copy_from_slice(&ct);
    assert_eq!(f.open(segs, 16).err(), Some(Error::PaquetCorrompu));
    // Témoin : la même note avec `k` s'ouvre.
    let srv = Server::new(f.segs(&[], &tail(&manifest(&[note(0, 0, &f.k)])), 1));
    assert!(open(&f.p, &srv, 1, &f.keys).is_ok());
}
