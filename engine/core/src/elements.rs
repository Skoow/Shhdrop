//! Envoi dès l'ajout (spec §41.14, D41-19), comme `crypto/elements.ts`, avec les mêmes octets
//! et les mêmes erreurs :
//!
//! - chaque élément est chiffré sous sa propre clé K_élément = HKDF(k, « shhdrop/v2/element »),
//!   k = 32 octets de l'aléa de la plateforme, données authentifiées « shhdrop/v2/element-ad » ;
//! - un élément d'un segment ou plus part d'une frontière de segment ; les petits sont
//!   empaquetés par morceaux dans des segments partagés (audit H-2), sans déborder du leur ;
//! - le morceau `g` du paquet est chiffré sous nonce(g, faux), comme le paquet v2 (§29.3) ;
//! - au clic, le manifeste (graines des seuls éléments gardés) est chiffré sous K_contenu dans
//!   le dernier morceau du palier final (nonce(B − 1, vrai), AD = en-tête « SHH2 »).
//!
//! Le moteur ne lit aucun fichier : l'hôte lit la plage de chaque pièce (`range`) et la passe
//! à `piece`. Toute taille ou place passe par une arithmétique vérifiée (`u64`) : aucune
//! panique sur une entrée hostile.
use crate::envelope::ContentKeys;
use crate::error::{Error, Result};
use crate::format::{
    BUCKETS, CHUNK, CHUNK_CT, HEADER, MANIFEST_MAX, MAX_ITEMS, MAX_SAFE, SEG_CHUNKS,
    TEXT_BYTES_MAX, bucket_for, header, nonce,
};
use crate::kdf::hkdf;
use crate::manifest::{self, Clean, Entry, Kind, Manifest, Rights};
use crate::platform::{Key, Platform};
use core::cell::Cell;
use core::fmt;
use std::rc::Rc;
use zeroize::{Zeroize, Zeroizing};

/// Données authentifiées des morceaux d'un élément.
pub const ELEMENT_AD: &[u8] = b"shhdrop/v2/element-ad";
const CHUNK64: u64 = CHUNK as u64;
const SEG: u64 = SEG_CHUNKS as u64;
/// Clair d'un segment de transport : 64 morceaux de 64 Kio (4 Mio).
pub const SEG_PLAIN: u64 = SEG * CHUNK64;
/// Segments de données au plus : 2 Gio (le plus grand palier garde un morceau pour le manifeste).
pub const DATA_SEGMENTS: u32 = (BUCKETS[BUCKETS.len() - 1] - 1) / SEG_CHUNKS;
/// Morceaux de données au plus (2 Gio).
pub const DATA_CHUNKS: u64 = DATA_SEGMENTS as u64 * SEG;

/// `Number.isSafeInteger(size) && size >= 0`, sinon `taille_invalide`.
fn safe(size: u64) -> Result<u64> {
    if size > MAX_SAFE {
        return Err(Error::TailleNonSure);
    }
    Ok(size)
}

/// Segments entiers occupés par un fichier de `size` octets (0 pour un fichier vide).
pub fn segments_for(size: u64) -> Result<u64> {
    Ok(safe(size)?.div_ceil(SEG_PLAIN))
}

/// Plus petit palier qui contient `used` segments de données pleins suivis du morceau du
/// manifeste : réservation d'un brouillon.
pub fn reservation_for(used: u64) -> Result<u32> {
    if used > u64::from(DATA_SEGMENTS) {
        return Err(Error::TropGros);
    }
    BUCKETS
        .into_iter()
        .find(|&b| u64::from(b) > used * SEG)
        .ok_or(Error::TropGros)
}

/// Morceaux occupés par un fichier de `size` octets (0 pour un fichier vide).
pub fn chunks_for(size: u64) -> Result<u64> {
    Ok(safe(size)?.div_ceil(CHUNK64))
}

/// Petit élément (audit H-2) : moins d'un segment ; empaqueté avec d'autres dans un segment
/// partagé, sans déborder de son segment.
pub fn is_small(size: u64) -> bool {
    size > 0 && size < SEG_PLAIN
}

/// Emprise d'un élément, en morceaux : ⌈taille / 64 Kio⌉ (D41-38) ; seule la fin de son
/// dernier morceau est faite de zéros chiffrés. Le serveur voit donc, pendant l'envoi, la taille
/// de chaque élément à 64 Kio près (fuite acceptée par le propriétaire).
pub fn footprint_for(size: u64) -> Result<u64> {
    chunks_for(size)
}

/// Segments d'une liste de fichiers, empaquetage compris (estimation de la place). Les sommes
/// saturent (au-delà de 2^64 segments, la borne « trop gros » est dépassée de toute façon).
pub fn segments_needed(sizes: &[u64]) -> Result<u64> {
    let (mut big, mut small) = (0u64, 0u64);
    for &n in sizes {
        if is_small(n) {
            small = small.saturating_add(footprint_for(n)?);
        } else {
            big = big.saturating_add(segments_for(n)?);
        }
    }
    Ok(big.saturating_add(small.div_ceil(SEG)))
}

/// Plage de morceaux d'un même segment, envoyée en une requête.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Piece {
    pub seg: u32,
    pub from: u32,
    pub chunks: u32,
}

/// Élément placé au morceau `first` du paquet, chiffré pièce par pièce sous sa clé. La clé
/// importée est oubliée chez le fournisseur à la destruction du scelleur ; la graine `k` est
/// mise à zéro.
pub struct ElementSealer<P: Platform> {
    k: Zeroizing<[u8; 32]>,
    key: Key<P>,
    size: u64,
    first: u64,
    pieces: Vec<Piece>,
    produced: Vec<Cell<bool>>,
}

impl<P: Platform> ElementSealer<P> {
    /// Prépare un élément de `size` octets placé au morceau `first` (frontière de segment pour
    /// un élément d'un segment ou plus ; dans un seul segment pour un petit). Places vérifiées
    /// avant tout tirage ; graine neuve à chaque appel : un nouvel essai ou une nouvelle place
    /// ne réutilise jamais un nonce sous une clé.
    pub async fn new(p: &Rc<P>, size: u64, first: u64) -> Result<Self> {
        let n = footprint_for(size)?;
        let end = first
            .checked_add(n)
            .filter(|&e| e <= DATA_CHUNKS)
            .ok_or(Error::TropGros)?;
        let placed = if is_small(size) {
            first / SEG == (end - 1) / SEG
        } else {
            first.is_multiple_of(SEG)
        };
        if !placed {
            return Err(Error::PlaceInvalide);
        }
        // Bornes : end ≤ DATA_CHUNKS = 32 768, donc segments et morceaux tiennent en u32.
        let mut pieces = Vec::new();
        let mut a = first;
        while a < end {
            let seg = a / SEG;
            let z = end.min((seg + 1) * SEG);
            pieces.push(Piece {
                seg: seg as u32,
                from: (a - seg * SEG) as u32,
                chunks: (z - a) as u32,
            });
            a = z;
        }
        let mut k = Zeroizing::new([0u8; 32]);
        p.random(&mut *k)?;
        let key = Key::import(p, hkdf::<32>(&*k, "shhdrop/v2/element")).await?;
        Ok(Self {
            k,
            key,
            size,
            first,
            produced: pieces.iter().map(|_| Cell::new(false)).collect(),
            pieces,
        })
    }

    /// Graine de la clé (32 octets) : n'entre que dans le manifeste chiffré, si l'élément est
    /// gardé. Copie mise à zéro à sa destruction.
    pub fn k(&self) -> Zeroizing<[u8; 32]> {
        self.k.clone()
    }

    /// Plages à envoyer, dans l'ordre (une par segment touché).
    pub fn pieces(&self) -> &[Piece] {
        &self.pieces
    }

    /// Octets du fichier `[lo, hi)` que l'hôte lit pour la pièce `j` (vide au-delà de la fin).
    pub fn range(&self, j: usize) -> Result<(u64, u64)> {
        let p = self.pieces.get(j).ok_or(Error::SegmentInvalide)?;
        let g0 = u64::from(p.seg) * SEG + u64::from(p.from);
        let lo = (g0 - self.first) * CHUNK64;
        let hi = self.size.min(lo + u64::from(p.chunks) * CHUNK64).max(lo);
        Ok((lo, hi))
    }

    /// Chiffre la pièce `j`, une seule fois (un nouvel essai d'envoi renvoie les octets gardés
    /// par l'hôte), en un seul lot du fournisseur. `plain` : exactement les octets de
    /// `range(j)` ; le moteur ajoute les zéros jusqu'à la fin du dernier morceau. Pièce qui
    /// commence au morceau 0 du paquet : 48 octets nuls d'abord (en-tête écrit par le serveur à
    /// la finalisation). Comme `elements.ts`, la pièce est marquée produite avant la lecture :
    /// une lecture de mauvaise taille la brûle aussi (l'hôte repart d'un scelleur neuf).
    pub async fn piece(&self, j: usize, plain: &[u8]) -> Result<Vec<u8>> {
        let (lo, hi) = self.range(j)?;
        let (p, done) = (self.pieces[j], &self.produced[j]);
        if done.replace(true) {
            return Err(Error::SegmentDejaProduit);
        }
        if plain.len() as u64 != hi - lo {
            return Err(Error::LectureIncomplete);
        }
        let g0 = u64::from(p.seg) * SEG + u64::from(p.from);
        let chunks = p.chunks as usize;
        let nonces: Vec<_> = (0..u64::from(p.chunks))
            .map(|c| nonce(g0 + c, false))
            .collect();
        // Pièce pleine : chiffrée telle quelle. Sinon, complétée de zéros jusqu'à la fin de son
        // dernier morceau, dans une copie (au plus 4 Mio) mise à zéro à la destruction.
        let padded;
        let full = if plain.len() == chunks * CHUNK {
            plain
        } else {
            padded = {
                let mut b = Zeroizing::new(vec![0u8; chunks * CHUNK]);
                b[..plain.len()].copy_from_slice(plain);
                b
            };
            &padded[..]
        };
        let ct = self
            .key
            .seal_batch(ELEMENT_AD, &nonces, full, CHUNK)
            .await?;
        if g0 != 0 {
            return Ok(ct);
        }
        let mut out = Vec::with_capacity(HEADER + ct.len());
        out.resize(HEADER, 0);
        out.extend_from_slice(&ct);
        Ok(out)
    }
}

impl<P: Platform> fmt::Debug for ElementSealer<P> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ElementSealer")
            .field("size", &self.size)
            .field("first", &self.first)
            .field("pieces", &self.pieces)
            .finish_non_exhaustive()
    }
}

/// Nature d'un élément gardé ; le nettoyage (D41-35) n'existe que pour un fichier.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FinalKind {
    Text,
    File(Option<Clean>),
}

/// Élément gardé, déjà envoyé sous sa clé (spec §41.14). Une note est un élément comme un
/// fichier (D41-36) : le manifeste n'en porte que le titre, la taille, la place et la graine,
/// jamais le texte. Nom et type mis à zéro à la destruction ; `Debug` ne les montre pas.
pub struct FinalEntry {
    pub kind: FinalKind,
    pub name: String,
    pub mime: String,
    pub size: u64,
    /// Premier morceau.
    pub first: u64,
    pub k: Zeroizing<[u8; 32]>,
}

impl Drop for FinalEntry {
    fn drop(&mut self) {
        self.name.zeroize();
        self.mime.zeroize();
    }
}

impl fmt::Debug for FinalEntry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FinalEntry")
            .field("kind", &self.kind)
            .field("size", &self.size)
            .field("first", &self.first)
            .finish_non_exhaustive()
    }
}

/// Résultat de la finalisation : palier final, en-tête en clair, morceau chiffré du manifeste.
#[derive(Debug)]
pub struct Sealed {
    pub bucket: u32,
    pub header: [u8; HEADER],
    pub tail: Vec<u8>,
}

/// Morceaux déjà pris par les éléments gardés (2 Gio = 32 768 bits).
struct Taken([u64; DATA_CHUNKS as usize / 64]);

impl Taken {
    /// Marque `c` ; faux s'il l'était déjà.
    fn take(&mut self, c: u64) -> bool {
        let (w, b) = ((c / 64) as usize, 1u64 << (c % 64));
        let fresh = self.0[w] & b == 0;
        self.0[w] |= b;
        fresh
    }
}

/// Manifeste des éléments gardés, dans l'ordre donné (ordre d'affichage), palier final
/// canonique, en-tête et morceau chiffré du manifeste. `rights` : « enregistrer » par défaut ;
/// `keep_ttl_h` seulement avec « coffre ».
///
/// Tout ce que `manifest::parse` refuserait est refusé ici, avant tout chiffrement :
/// « vide », « droits_invalides », « manifeste_trop_gros » (plus de MAX_ITEMS éléments, ou
/// plus de MANIFEST_MAX octets), puis pour chaque entrée dans l'ordre « texte_trop_long »,
/// « taille_invalide », « trop_gros » et « chevauchement ». Une K_contenu ne chiffre qu'un
/// manifeste (« cle_deja_utilisee ») ; un refus de validation ne l'use pas.
pub async fn seal_final<P: Platform>(
    entries: &[FinalEntry],
    keys: &ContentKeys<P>,
    rights: Option<&str>,
    keep_ttl_h: Option<u64>,
) -> Result<Sealed> {
    if entries.is_empty() {
        return Err(Error::Vide);
    }
    let rights: Rights = Rights::new(rights.unwrap_or("enregistrer"), keep_ttl_h)?;
    // Écart assumé : elements.ts ne bornait pas le nombre d'éléments (l'interface le fait), et
    // un manifeste de plus de MAX_ITEMS éléments serait illisible (`parse`).
    if entries.len() > MAX_ITEMS {
        return Err(Error::ManifesteTropGros);
    }
    let mut taken = Taken([0; DATA_CHUNKS as usize / 64]);
    let mut items = Vec::with_capacity(entries.len());
    let mut data_end = 0u64;
    for e in entries {
        if e.kind == FinalKind::Text && e.size > TEXT_BYTES_MAX {
            return Err(Error::TexteTropLong);
        }
        let n = chunks_for(e.size)?;
        let end = e
            .first
            .checked_add(n)
            .filter(|&z| z <= DATA_CHUNKS)
            .ok_or(Error::TropGros)?;
        for c in e.first..end {
            if !taken.take(c) {
                return Err(Error::Chevauchement);
            }
        }
        // end ≤ 2^15 morceaux : offset + taille ≤ 2^31, aucun débordement.
        let offset = if e.size == 0 { 0 } else { e.first * CHUNK64 };
        let (kind, clean) = match e.kind {
            FinalKind::Text => (Kind::Text, None),
            FinalKind::File(c) => (Kind::File, c),
        };
        items.push(Entry {
            kind,
            name: e.name.clone(),
            mime: e.mime.clone(),
            size: e.size,
            offset,
            text: None,
            k: Some(e.k.clone()),
            clean,
        });
        if e.size > 0 {
            data_end = data_end.max(offset + e.size);
        }
    }
    let json = manifest::to_json(&Manifest { rights, items });
    if json.len() > MANIFEST_MAX {
        return Err(Error::ManifesteTropGros);
    }
    let bucket = bucket_for(data_end)?;
    let mut plain = Zeroizing::new(vec![0u8; CHUNK]);
    plain[CHUNK - 4 - json.len()..CHUNK - 4].copy_from_slice(&json);
    // json.len() ≤ MANIFEST_MAX < 2^32.
    plain[CHUNK - 4..].copy_from_slice(&(json.len() as u32).to_be_bytes());
    keys.use_for_manifest()?;
    let hdr = header(&keys.engagement);
    let tail = keys
        .k_contenu
        .seal_batch(&hdr, &[nonce(u64::from(bucket) - 1, true)], &plain, CHUNK)
        .await?;
    debug_assert_eq!(tail.len(), CHUNK_CT);
    Ok(Sealed {
        bucket,
        header: hdr,
        tail,
    })
}
