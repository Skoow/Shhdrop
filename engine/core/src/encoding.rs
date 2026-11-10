//! base64url sans bourrage, comme `crypto/encoding.ts` : l'encodage canonique seul est accepté
//! (ni `=`, ni `+` `/`, ni longueur ≡ 1 mod 4, ni bits de bourrage non nuls).
use crate::error::{Error, Result};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;

pub fn b64u(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn unb64u(s: &str) -> Result<Vec<u8>> {
    // URL_SAFE_NO_PAD refuse le bourrage `=` et les bits de bourrage non nuls (décodage strict).
    URL_SAFE_NO_PAD.decode(s).map_err(|_| Error::Base64Invalide)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aller_retour_toutes_longueurs() {
        for n in 0..70usize {
            let b: Vec<u8> = (0..n).map(|i| (i * 37 + 250) as u8).collect();
            let s = b64u(&b);
            assert_eq!(s.len(), (n * 4).div_ceil(3));
            assert!(
                s.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
            );
            assert_eq!(unb64u(&s).unwrap(), b);
        }
    }

    #[test]
    fn refus() {
        for s in [
            "A", "AAAAA", "AB", "AAB", "A=", "AA==", "A+", "A/", "A A", "é", "AA\n",
        ] {
            assert_eq!(unb64u(s), Err(Error::Base64Invalide), "{s:?}");
        }
    }
}
