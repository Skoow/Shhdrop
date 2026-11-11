//! Ouverture en flux d'un paquet v2, comme `openStream` de `crypto/container.ts` (spec §3) :
//!
//! 1. palier annoncé par le serveur dans `BUCKETS`, segment 0 de la bonne taille, en-tête
//!    « SHH2 » et engagement égaux à ceux des clés (temps constant), avant tout déchiffrement ;
//! 2. dernier morceau (nonce(B − 1, dernier), AD = en-tête) sous K_contenu : longueur du
//!    manifeste (≤ MANIFEST_MAX) et manifeste, lu par `manifest::parse` ;
//! 3. palier canonique recalculé sur le manifeste authentifié (`bucket_for` de la fin des
//!    données) : un serveur ne peut pas annoncer un autre palier, et aucune donnée n'entre dans
//!    le dernier morceau, réservé au manifeste ;
//! 4. clé de chaque élément, HKDF(k, « shhdrop/v2/element »), tenue par le fournisseur ; une
//!    entrée sans `k` (ancien format, supprimé : spec §3) est refusée ;
//! 5. notes déchiffrées dès l'ouverture (UTF-8 strict, BOM gardé, ≤ TEXT_MAX caractères).
//!
//! Tout défaut d'authenticité ou de structure donne `paquet_corrompu` ; une erreur de
//! `Segments::fetch` (réseau) est rendue telle quelle, comme `openStream`. Les morceaux jamais
//! lus (bourrage, rempli d'aléa par le serveur) ne sont pas vérifiés : ils ne contiennent rien.
//!
//! Un seul segment chiffré en cache. Les opérations (`item`, `stream_item`) passent une à une,
//! dans l'ordre d'appel (file d'attente propre, sans dépendance) : appelées en même temps,
//! elles s'exécutent l'une après l'autre. Aucun emprunt de `RefCell` n'est tenu pendant une
//! attente : `wipe` peut être appelé à tout moment, y compris depuis le puits.
use crate::elements::ELEMENT_AD;
use crate::envelope::ContentKeys;
use crate::error::{Error, Result};
use crate::format::{
    BUCKETS, CHUNK, CHUNK_CT, HEADER, MANIFEST_MAX, PREVIEW_MAX, SEG_CHUNKS, TEXT_MAX, bucket_for,
    header, nonce, segment_size,
};
use crate::kdf::hkdf;
use crate::manifest::{self, Kind, Manifest};
use crate::platform::{Key, Opened, Platform, SecretBuf};
use core::cell::{Cell, RefCell};
use core::fmt;
use core::future::Future;
use core::pin::Pin;
use core::task::{Context, Poll, Waker};
use std::collections::VecDeque;
use std::rc::Rc;
use subtle::ConstantTimeEq;
use zeroize::{Zeroize, Zeroizing};

/// Source des segments chiffrés (côté site : requête au serveur ; apps : leur transport).
/// `fetch(n)` rend le segment `n` tel que reçu ; une erreur (réseau) est rendue telle quelle à
/// l'appelant du lecteur. Pas de `Send` : WebAssembly a un seul fil.
pub trait Segments {
    fn fetch(&self, n: u32) -> impl Future<Output = Result<Vec<u8>>>;
}

const SEG: u64 = SEG_CHUNKS as u64;
const C: u64 = CHUNK as u64;

type Cached = Rc<SecretBuf>;

/// Lecteur d'un paquet ouvert. Les clés des éléments sont oubliées chez le fournisseur, et le
/// segment en cache mis à zéro, à sa destruction.
pub struct Reader<P: Platform, S: Segments> {
    src: Source<S>,
    manifest: Manifest,
    /// Clé de chaque entrée du manifeste, même ordre.
    keys: Vec<Key<P>>,
    queue: Queue,
}

/// Segments, palier et cache d'un seul segment.
struct Source<S> {
    src: S,
    bucket: u32,
    /// Segment en cache. Une lecture en cours garde son `Rc` jusqu'à la fin de son lot :
    /// `wipe` le retire du cache, il est mis à zéro dès que ce lot est fini.
    cache: RefCell<Option<(u32, Cached)>>,
}

impl<S: Segments> Source<S> {
    fn wipe(&self) {
        // Le `SecretBuf` met le segment à zéro quand le dernier `Rc` disparaît.
        self.cache.borrow_mut().take();
    }

    async fn seg(&self, n: u32) -> Result<Cached> {
        if let Some((m, d)) = &*self.cache.borrow()
            && *m == n
        {
            return Ok(Rc::clone(d));
        }
        self.wipe();
        // Hors palier (n ≥ segment_count) : None, jamais une taille qu'un segment vide égalerait.
        let want = segment_size(self.bucket, n).ok_or(Error::PaquetCorrompu)?;
        let data = SecretBuf::new(self.src.fetch(n).await?);
        if data.len() != want {
            return Err(Error::PaquetCorrompu);
        }
        let d = Rc::new(data);
        *self.cache.borrow_mut() = Some((n, Rc::clone(&d)));
        Ok(d)
    }

    /// Déchiffre les morceaux `[g, g + count)`, tous dans un même segment, en un lot.
    async fn chunks<P: Platform>(
        &self,
        g: u64,
        count: u64,
        key: &Key<P>,
        ad: &[u8],
    ) -> Result<P::Opened> {
        let last = u64::from(self.bucket) - 1;
        let n = g / SEG;
        if count == 0 || g + count - 1 > last || (g + count - 1) / SEG != n {
            return Err(Error::PaquetCorrompu);
        }
        // n < segment_count ≤ 513 et au plus 64 morceaux : tout tient en u32 et usize.
        let s = self.seg(n as u32).await?;
        let start = if n == 0 { HEADER } else { 0 } + (g % SEG) as usize * CHUNK_CT;
        let end = start + count as usize * CHUNK_CT;
        let ct = s.get(start..end).ok_or(Error::PaquetCorrompu)?;
        let nonces: Vec<_> = (g..g + count).map(|i| nonce(i, i == last)).collect();
        key.open_batch(ad, &nonces, ct, CHUNK_CT).await
    }

    /// Passe à `out`, dans l'ordre, les tranches du clair `[a, a + len)`, une par morceau :
    /// `(lot, début dans le lot, longueur)`, jamais à cheval sur deux morceaux ; déchiffrement
    /// par lots d'un segment au plus.
    async fn range<P: Platform>(
        &self,
        a: u64,
        len: u64,
        key: &Key<P>,
        ad: &[u8],
        out: &mut impl AsyncFnMut(&P::Opened, usize, usize) -> Result<()>,
    ) -> Result<()> {
        let end = a.checked_add(len).ok_or(Error::PaquetCorrompu)?;
        let mut pos = a;
        while pos < end {
            let g = pos / C;
            let hi = ((end - 1) / C + 1).min((g / SEG + 1) * SEG);
            let pt = self.chunks(g, hi - g, key, ad).await?;
            // pt : (hi − g) morceaux ; pos et end y tombent (bornes vérifiées par `chunks`).
            let base = g * C;
            while pos < end && pos < hi * C {
                let lo = (pos - base) as usize;
                let take = (C - pos % C).min(end - pos) as usize;
                out(&pt, lo, take).await?;
                pos += take as u64;
            }
        }
        Ok(())
    }
}

/// Attend tous les futurs ensemble (aucune dépendance à un exécuteur) et rend leurs résultats
/// dans l'ordre. Chaque futur est sondé jusqu'à sa fin, jamais après ; tous vont à leur terme
/// (un échec n'en abandonne aucun en cours).
async fn join_all<F: Future>(fs: impl IntoIterator<Item = F>) -> Vec<F::Output> {
    let mut fs: Vec<Pin<Box<F>>> = fs.into_iter().map(Box::pin).collect();
    let mut out: Vec<Option<F::Output>> = fs.iter().map(|_| None).collect();
    core::future::poll_fn(|cx| {
        let mut pending = false;
        for (f, o) in fs.iter_mut().zip(out.iter_mut()) {
            if o.is_none() {
                match f.as_mut().poll(cx) {
                    Poll::Ready(v) => *o = Some(v),
                    Poll::Pending => pending = true,
                }
            }
        }
        if pending {
            Poll::Pending
        } else {
            Poll::Ready(())
        }
    })
    .await;
    out.into_iter().flatten().collect()
}

/// Tranche du clair livrée par [`Reader::stream_parts`] : texte d'une note, ou `len` octets
/// du lot `batch` à partir de `at` (dans un seul morceau).
pub enum Part<'a, O> {
    Text(&'a [u8]),
    Plain { batch: &'a O, at: usize, len: usize },
}

/// Ajoute la tranche `[at, at + n)` de `b` à `out` (capacité réservée d'avance par l'appelant).
fn append<O: Opened>(out: &mut Vec<u8>, b: &O, at: usize, n: usize) -> Result<()> {
    let start = out.len();
    out.resize(start + n, 0);
    if b.copy_out(at, &mut out[start..]) {
        Ok(())
    } else {
        Err(Error::PaquetCorrompu)
    }
}

impl<P: Platform, S: Segments> Reader<P, S> {
    /// Ouvre le paquet. `bucket` vient du serveur et n'est cru qu'après vérification ; `keys`
    /// viennent de `content_keys_checked` (engagement déjà vérifié contre R) et ne servent qu'à
    /// l'ouverture (le manifeste) : le lecteur ne garde que les clés des éléments.
    pub async fn open(p: &Rc<P>, src: S, bucket: u32, keys: &ContentKeys<P>) -> Result<Self> {
        if !BUCKETS.contains(&bucket) {
            return Err(Error::PaquetCorrompu);
        }
        let src = Source {
            src,
            bucket,
            cache: RefCell::new(None),
        };
        // En cas d'erreur, `src` est détruit : segment en cache mis à zéro, clés oubliées.
        let hdr = header(&keys.engagement);

        // 1. En-tête et engagement, avant tout déchiffrement.
        let s0 = src.seg(0).await?;
        if !bool::from(s0[..HEADER].ct_eq(&hdr)) {
            return Err(Error::PaquetCorrompu);
        }
        drop(s0);

        // 2. Longueur du manifeste (4 derniers octets du dernier morceau), puis le manifeste :
        //    MANIFEST_MAX + 4 = CHUNK, il est donc tout entier dans ce morceau.
        let last = u64::from(bucket) - 1;
        let lot = src.chunks(last, 1, &keys.k_contenu, &hdr).await?;
        let mut pt = SecretBuf::new(vec![0u8; CHUNK]);
        if !lot.copy_out(0, &mut pt) {
            return Err(Error::PaquetCorrompu);
        }
        drop(lot);
        let mut len = [0u8; 4];
        len.copy_from_slice(&pt[CHUNK - 4..]);
        let mlen = u32::from_be_bytes(len) as usize;
        if mlen > MANIFEST_MAX {
            return Err(Error::PaquetCorrompu);
        }
        let m_start = u64::from(bucket) * C - 4 - mlen as u64;
        let mut manifest = manifest::parse(&pt[CHUNK - 4 - mlen..CHUNK - 4], m_start)?;
        drop(pt);

        // 3. Palier canonique : celui que la finalisation aurait choisi pour ce manifeste.
        //    parse borne offset + size par m_start : aucun débordement.
        let data_end = manifest
            .items
            .iter()
            .map(|e| e.offset + e.size)
            .max()
            .unwrap_or(0);
        if bucket_for(data_end).ok() != Some(bucket) {
            return Err(Error::PaquetCorrompu);
        }

        // 4. Clés des éléments ; ancien format (sans `k`) refusé avant tout import. Les imports
        //    (jusqu'à MAX_ITEMS, asynchrones chez le fournisseur) sont lancés ensemble ; en cas
        //    d'échec, les clés déjà importées sont oubliées à leur destruction.
        let mut seeds = Vec::with_capacity(manifest.items.len());
        for e in &manifest.items {
            seeds.push(e.k.as_ref().ok_or(Error::PaquetCorrompu)?);
        }
        let el_keys = join_all(
            seeds
                .into_iter()
                .map(|k| Key::import(p, hkdf::<32>(&**k, "shhdrop/v2/element"))),
        )
        .await
        .into_iter()
        .collect::<Result<Vec<_>>>()?;

        // 5. Notes : texte déchiffré et authentifié dès l'ouverture.
        for (e, key) in manifest.items.iter_mut().zip(&el_keys) {
            if e.kind != Kind::Text {
                continue;
            }
            // size ≤ TEXT_BYTES_MAX (parse) : 400 000 octets au plus.
            let mut raw = Zeroizing::new(Vec::with_capacity(e.size as usize));
            src.range(
                e.offset,
                e.size,
                key,
                ELEMENT_AD,
                &mut async |b: &P::Opened, at: usize, n: usize| append(&mut raw, b, at, n),
            )
            .await?;
            // UTF-8 strict ; un BOM initial est gardé (TextDecoder, ignoreBOM : true).
            let text = match String::from_utf8(core::mem::take(&mut *raw)) {
                Ok(t) => t,
                Err(err) => {
                    err.into_bytes().zeroize();
                    return Err(Error::PaquetCorrompu);
                }
            };
            if text.chars().count() > TEXT_MAX {
                let mut text = text;
                text.zeroize();
                return Err(Error::PaquetCorrompu);
            }
            e.text = Some(text);
        }

        Ok(Self {
            src,
            manifest,
            keys: el_keys,
            queue: Queue::default(),
        })
    }

    /// Manifeste authentifié ; les notes y portent leur texte.
    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    fn entry(&self, i: usize) -> Result<(&manifest::Entry, &Key<P>)> {
        match (self.manifest.items.get(i), self.keys.get(i)) {
            (Some(e), Some(k)) => Ok((e, k)),
            _ => Err(Error::ElementInexistant),
        }
    }

    /// Copie de l'élément `i`, pour l'aperçu ; refusée au-delà de PREVIEW_MAX
    /// (`trop_gros_pour_apercu`, sans rien télécharger). Copie que l'appelant garde.
    pub async fn item(&self, i: usize) -> Result<Vec<u8>> {
        let _turn = self.queue.turn().await;
        let (e, key) = self.entry(i)?;
        if e.kind == Kind::Text {
            return Ok(e.text.as_deref().unwrap_or_default().as_bytes().to_vec());
        }
        if e.size > PREVIEW_MAX {
            return Err(Error::TropGrosPourApercu);
        }
        // Capacité exacte : aucune réallocation ne laisse de copie non effacée ; mis à zéro en
        // cas d'erreur. Mémoire refusée (WebAssembly : 4 Gio au plus) : une erreur, pas un
        // arrêt du processus ; `stream_item` lit l'élément sans tout garder.
        let mut res = Zeroizing::new(Vec::new());
        usize::try_from(e.size)
            .ok()
            .and_then(|n| res.try_reserve_exact(n).ok())
            .ok_or(Error::TropGrosPourApercu)?;
        self.src
            .range(
                e.offset,
                e.size,
                key,
                ELEMENT_AD,
                &mut async |b: &P::Opened, at: usize, n: usize| append(&mut res, b, at, n),
            )
            .await?;
        Ok(core::mem::take(&mut *res))
    }

    /// Déchiffre l'élément `i` morceau par morceau et passe chaque tranche (≤ 64 Kio, prêtée :
    /// le puits copie ce qu'il garde, le moteur efface la sienne) à `sink`, dans l'ordre. En cas
    /// d'erreur (paquet_corrompu, ou erreur du réseau ou du puits, rendue telle quelle), ce qui
    /// a déjà été livré doit être jeté par
    /// l'appelant. Une note vide ne livre rien. Le puits ne doit pas attendre une autre
    /// opération du même lecteur (elle attendrait la fin de celle-ci : blocage, comme avant).
    pub async fn stream_item(
        &self,
        i: usize,
        mut sink: impl AsyncFnMut(&[u8]) -> Result<()>,
    ) -> Result<()> {
        let mut buf = SecretBuf::new(vec![0u8; CHUNK]);
        self.stream_parts(i, async |p: Part<'_, P::Opened>| match p {
            Part::Text(t) => sink(t).await,
            Part::Plain { batch, at, len } => {
                if !batch.copy_out(at, &mut buf[..len]) {
                    return Err(Error::PaquetCorrompu);
                }
                sink(&buf[..len]).await
            }
        })
        .await
    }

    /// Comme [`Self::stream_item`], mais chaque tranche est passée telle que la plateforme la
    /// tient (`Part::Plain`), sans copie : le site la livre à JavaScript sans passer par la
    /// mémoire WebAssembly. Une note passe son texte (`Part::Text`).
    pub async fn stream_parts(
        &self,
        i: usize,
        mut sink: impl AsyncFnMut(Part<'_, P::Opened>) -> Result<()>,
    ) -> Result<()> {
        let _turn = self.queue.turn().await;
        let (e, key) = self.entry(i)?;
        if e.kind == Kind::Text {
            let t = e.text.as_deref().unwrap_or_default();
            if !t.is_empty() {
                sink(Part::Text(t.as_bytes())).await?;
            }
            return Ok(());
        }
        self.src
            .range(
                e.offset,
                e.size,
                key,
                ELEMENT_AD,
                &mut async |batch: &P::Opened, at: usize, len: usize| {
                    sink(Part::Plain { batch, at, len }).await
                },
            )
            .await
    }

    /// Retire du cache le segment chiffré (mis à zéro dès qu'aucun lot en cours ne le lit). Une
    /// lecture en cours n'échoue pas : elle recharge le segment suivant. Limite : le manifeste
    /// (noms, types, textes) reste en mémoire jusqu'à la destruction du lecteur.
    pub fn wipe(&self) {
        self.src.wipe();
    }
}

impl<P: Platform, S: Segments> fmt::Debug for Reader<P, S> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Reader")
            .field("bucket", &self.src.bucket)
            .field("items", &self.manifest.items.len())
            .finish_non_exhaustive()
    }
}

// ---------------------------------------------------------------------------------------------
// File d'attente des opérations (un seul fil) : premier arrivé, premier servi. Le tour passe
// directement au suivant à la fin d'une opération ; un futur abandonné en file en sort, un
// futur abandonné après avoir reçu son tour le passe au suivant.

#[derive(Default)]
struct Queue {
    busy: Cell<bool>,
    waiting: RefCell<VecDeque<Rc<Slot>>>,
}

#[derive(Default)]
struct Slot {
    granted: Cell<bool>,
    waker: RefCell<Option<Waker>>,
}

impl Queue {
    fn turn(&self) -> Wait<'_> {
        Wait {
            q: self,
            slot: None,
            done: false,
        }
    }

    /// Fin d'un tour : au suivant en file, sinon la file est libre.
    fn release(&self) {
        let next = self.waiting.borrow_mut().pop_front();
        match next {
            Some(s) => {
                s.granted.set(true);
                let w = s.waker.borrow_mut().take();
                if let Some(w) = w {
                    w.wake();
                }
            }
            None => self.busy.set(false),
        }
    }
}

struct Wait<'a> {
    q: &'a Queue,
    slot: Option<Rc<Slot>>,
    done: bool,
}

struct Turn<'a>(&'a Queue);

impl Drop for Turn<'_> {
    fn drop(&mut self) {
        self.0.release();
    }
}

impl<'a> Future for Wait<'a> {
    type Output = Turn<'a>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Turn<'a>> {
        let this = &mut *self;
        let q = this.q;
        let ready = match &this.slot {
            None if !q.busy.get() => {
                q.busy.set(true);
                true
            }
            None => {
                let s = Rc::new(Slot::default());
                *s.waker.borrow_mut() = Some(cx.waker().clone());
                q.waiting.borrow_mut().push_back(Rc::clone(&s));
                this.slot = Some(s);
                false
            }
            Some(s) if s.granted.get() => true,
            Some(s) => {
                *s.waker.borrow_mut() = Some(cx.waker().clone());
                false
            }
        };
        if ready {
            this.done = true;
            Poll::Ready(Turn(q))
        } else {
            Poll::Pending
        }
    }
}

impl Drop for Wait<'_> {
    fn drop(&mut self) {
        if self.done {
            return;
        }
        if let Some(s) = &self.slot {
            if s.granted.get() {
                self.q.release();
            } else {
                self.q.waiting.borrow_mut().retain(|x| !Rc::ptr_eq(x, s));
            }
        }
    }
}
