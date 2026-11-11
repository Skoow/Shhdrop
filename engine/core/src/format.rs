//! Format du paquet v2, comme `crypto/container.ts` (spec §29.3, §7.3) : en-tête en clair
//! « SHH2 » puis morceaux AES-256-GCM façon STREAM. Clair de B morceaux : données des éléments
//! (à partir de l'octet 0) ‖ zéros ‖ manifeste ‖ longueur du manifeste (4 octets, gros-boutiste)
//! en toute fin. Paliers, tailles de segment, en-tête et nonces ; le manifeste est dans
//! `manifest`.
use crate::error::{Error, Result};
use crate::platform::{NONCE_LEN, TAG_LEN};
use subtle::ConstantTimeEq;

/// Octets de clair d'un morceau.
pub const CHUNK: usize = 65_536;
pub const TAG: usize = TAG_LEN;
/// Octets d'un morceau chiffré (clair + tag).
pub const CHUNK_CT: usize = CHUNK + TAG;
/// En-tête en clair du segment 0.
pub const HEADER: usize = 48;
/// Morceaux par segment.
pub const SEG_CHUNKS: u32 = 64;
/// Paliers gratuits en morceaux (spec §24, §29.3, §41.2) : chacun garde son dernier morceau pour
/// le manifeste ; le plus grand contient exactement 2 Gio de données plus ce morceau.
pub const BUCKETS: [u32; 11] = [1, 16, 80, 160, 400, 800, 1600, 4000, 8000, 16385, 32769];
/// Au-delà, pas d'aperçu sur le site : téléchargement en flux seulement (spec §24).
pub const PREVIEW_MAX: u64 = 200 * 1_048_576;
/// Taille maximale du manifeste : avec sa longueur (4 octets), il tient dans un morceau.
pub const MANIFEST_MAX: usize = 65_532;
const TAIL: u64 = 4 + MANIFEST_MAX as u64;
/// Octets de données au plus : exactement 2 Gio.
pub const CONTENT_MAX: u64 = BUCKETS[BUCKETS.len() - 1] as u64 * CHUNK as u64 - TAIL;
/// Éléments par partage au plus (D41-17).
pub const MAX_ITEMS: usize = 200;
/// Points de code d'une note au plus (D41-36).
pub const TEXT_MAX: usize = 100_000;
/// Octets UTF-8 d'une note au plus.
pub const TEXT_BYTES_MAX: u64 = 4 * TEXT_MAX as u64;
/// `Number.MAX_SAFE_INTEGER` (2^53 − 1) : plus grande taille ou position que l'ancien moteur
/// représentait exactement ; au-delà, refus comme avant.
pub const MAX_SAFE: u64 = (1 << 53) - 1;
const MAGIC: &[u8; 4] = b"SHH2";
const VERSION: u8 = 2;

/// Palier canonique : le plus petit palier de capacité ≥ fin des données + 4 + MANIFEST_MAX.
pub fn bucket_for(data_end: u64) -> Result<u32> {
    if data_end > MAX_SAFE {
        return Err(Error::TailleDonneesInvalide);
    }
    BUCKETS
        .into_iter()
        .find(|&b| data_end + TAIL <= u64::from(b) * CHUNK as u64)
        .ok_or(Error::TropGros)
}

/// Segments d'un palier.
pub const fn segment_count(bucket: u32) -> u32 {
    bucket.div_ceil(SEG_CHUNKS)
}

/// Octets chiffrés du segment `n` (en-tête compris pour le segment 0). Hors palier
/// (`n ≥ segment_count(bucket)`) : 0 morceau ; l'appelant vérifie `n` avant.
pub fn segment_size(bucket: u32, n: u32) -> usize {
    let first = u64::from(n) * u64::from(SEG_CHUNKS);
    let chunks = u64::from(bucket)
        .saturating_sub(first)
        .min(u64::from(SEG_CHUNKS)) as usize;
    (if n == 0 { HEADER } else { 0 }) + chunks * CHUNK_CT
}

/// En-tête : « SHH2 », version 2, 11 octets nuls, engagement.
pub fn header(engagement: &[u8; 32]) -> [u8; HEADER] {
    let mut h = [0; HEADER];
    h[..4].copy_from_slice(MAGIC);
    h[4] = VERSION;
    h[16..].copy_from_slice(engagement);
    h
}

/// Lit l'en-tête en clair du segment 0 et son engagement. Rien n'est authentifié ici :
/// l'enveloppe (qui couvre l'en-tête) et l'engagement le sont ensuite.
pub fn read_header(seg0: &[u8]) -> Result<([u8; HEADER], [u8; 32])> {
    let h: [u8; HEADER] = seg0
        .get(..HEADER)
        .and_then(|s| s.try_into().ok())
        .ok_or(Error::PaquetCorrompu)?;
    let mut engagement = [0; 32];
    engagement.copy_from_slice(&h[16..]);
    let want = header(&engagement);
    if !bool::from(h[..16].ct_eq(&want[..16])) {
        return Err(Error::PaquetCorrompu);
    }
    Ok((h, engagement))
}

/// Nonce du morceau `index` : indice gros-boutiste sur 11 octets ‖ drapeau « dernier morceau ».
pub fn nonce(index: u64, last: bool) -> [u8; NONCE_LEN] {
    let mut iv = [0; NONCE_LEN];
    iv[3..11].copy_from_slice(&index.to_be_bytes());
    iv[11] = u8::from(last);
    iv
}
