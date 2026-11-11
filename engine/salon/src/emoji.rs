//! Liste des réactions permises : les séquences « fully-qualified » de `emoji-test.txt`, emoji
//! version 15.0 (spec §39.5), générées à la compilation par `build.rs` depuis
//! `data/emoji-test-15.0.txt`.
//! Source : https://unicode.org/Public/emoji/15.0/emoji-test.txt
//! SHA-256 : 8445f23ac8388e096be19d0262e14fceff856ff52093f2356dc89485f1a853db (vérifié par un test).
include!(concat!(env!("OUT_DIR"), "/emojis.rs"));

/// Vrai si `s` est exactement une séquence de la liste.
pub(crate) fn dans_la_liste(s: &str) -> bool {
    EMOJIS.binary_search(&s).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    const FICHIER: &str = include_str!("../data/emoji-test-15.0.txt");

    #[test]
    fn fichier_epingle_par_sha256() {
        let h = shhdrop_core::kdf::sha256(FICHIER.as_bytes());
        let hex: String = h.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            hex,
            "8445f23ac8388e096be19d0262e14fceff856ff52093f2356dc89485f1a853db"
        );
        assert!(FICHIER.contains("# Version: 15.0"));
    }

    /// Analyse indépendante de `build.rs` (autre code, autre lecture du fichier).
    #[test]
    fn table_conforme_au_fichier() {
        let mut attendu = BTreeSet::new();
        let mut qualifies = 0;
        for l in FICHIER
            .lines()
            .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
        {
            let (gauche, droite) = l.split_once(" ; ").expect("ligne");
            let (statut, _) = droite.split_once(" #").expect("commentaire");
            if statut.trim() == "fully-qualified" {
                qualifies += 1;
                attendu.insert(
                    gauche
                        .split(' ')
                        .filter(|h| !h.is_empty())
                        .map(|h| char::from_u32(u32::from_str_radix(h, 16).unwrap()).unwrap())
                        .collect::<String>(),
                );
            }
        }
        assert_eq!(qualifies, 3655);
        assert_eq!(attendu.len(), qualifies);
        let table: Vec<&str> = EMOJIS.to_vec();
        assert_eq!(
            table,
            attendu.iter().map(String::as_str).collect::<Vec<_>>()
        );
        assert!(EMOJIS.windows(2).all(|w| w[0] < w[1]));
        // statuts exclus
        for l in FICHIER
            .lines()
            .filter(|l| l.contains("; minimally-qualified") || l.contains("; unqualified"))
            .take(50)
        {
            let code = l.split(" ; ").next().unwrap();
            let s: String = code
                .split(' ')
                .filter(|h| !h.is_empty())
                .map(|h| char::from_u32(u32::from_str_radix(h, 16).unwrap()).unwrap())
                .collect();
            assert!(!dans_la_liste(&s) || attendu.contains(&s), "{code}");
        }
    }
}
