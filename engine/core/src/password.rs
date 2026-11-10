//! Mot de passe généré (spec §31, `crypto/password.ts`) : 11 caractères tirés uniformément dans
//! 63 symboles (lettres et chiffres sans ambigus ni sosies, 14 spéciaux courants), avec au moins
//! une minuscule, une majuscule, un chiffre et exactement trois spéciaux ; le mot de passe entier
//! est recommencé tant que la contrainte n'est pas tenue. Tirage par rejet : un octet n'est gardé
//! que sous 252 = 4 × 63 (aucun biais de modulo).
//!
//! L'aléa vient de l'appelant (`rng` remplit le tampon : WebCrypto sur le site, le système dans
//! les apps) : le moteur ne dépend d'aucune source du système. Un aléa qui échoue arrête le
//! tirage (`aleatoire_indisponible`) : jamais de boucle sur un tampon nul ni de mot de passe tiré
//! d'octets non aléatoires. Les octets sont consommés dans le
//! même ordre que l'ancien moteur : tirages complets de 22 octets, nouveau tirage pour chaque
//! nouvel essai.
use crate::error::Result;
use zeroize::Zeroize;

/// Minuscules sans i j l o s z (20), majuscules sans B I O S Z (21), chiffres 2 à 9 (8), 14 spéciaux.
pub const PASSWORD_FAMILIES: [&str; 4] = [
    "abcdefghkmnpqrtuvwxy",
    "ACDEFGHJKLMNPQRTUVWXY",
    "23456789",
    "!?@#$%&*+-=/()",
];
pub const PASSWORD_ALPHABET: &str =
    "abcdefghkmnpqrtuvwxyACDEFGHJKLMNPQRTUVWXY23456789!?@#$%&*+-=/()";
pub const PASSWORD_LEN: usize = 11;
/// Nombre exact de caractères spéciaux (famille 4) d'un mot de passe généré.
pub const PASSWORD_SPECIALS: usize = 3;

/// Vrai si `pw` a la forme d'un mot de passe généré : 11 caractères de l'alphabet, les quatre
/// familles présentes, exactement 3 spéciaux. Seule forme acceptée à la création (D41-15).
pub fn is_generated(pw: &str) -> bool {
    let in_family = |f: usize| move |c: char| PASSWORD_FAMILIES[f].contains(c);
    pw.chars().count() == PASSWORD_LEN
        && pw.chars().all(|c| PASSWORD_ALPHABET.contains(c))
        && (0..PASSWORD_FAMILIES.len()).all(|f| pw.chars().any(in_family(f)))
        && pw.chars().filter(|&c| in_family(3)(c)).count() == PASSWORD_SPECIALS
}

/// Tire un mot de passe généré ; `rng` remplit chaque tampon de 22 octets d'aléa uniforme, ou
/// échoue (erreur rendue telle quelle, tampon et essai en cours effacés).
pub fn generate(rng: &mut impl FnMut(&mut [u8]) -> Result<()>) -> Result<String> {
    let alphabet = PASSWORD_ALPHABET.as_bytes(); // ASCII : un octet par symbole
    let n = alphabet.len(); // 63
    let limit = 256 - 256 % n; // 252
    let mut buf = [0u8; PASSWORD_LEN * 2];
    loop {
        let mut pw = String::with_capacity(PASSWORD_LEN);
        while pw.len() < PASSWORD_LEN {
            if let Err(e) = rng(&mut buf) {
                buf.zeroize();
                pw.zeroize();
                return Err(e);
            }
            for &b in &buf {
                if usize::from(b) < limit && pw.len() < PASSWORD_LEN {
                    pw.push(char::from(alphabet[usize::from(b) % n]));
                }
            }
        }
        buf.zeroize();
        if is_generated(&pw) {
            return Ok(pw);
        }
        pw.zeroize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Error;

    /// splitmix64 : générateur de test déterministe (jamais utilisé hors des tests).
    fn test_rng(seed: u64) -> impl FnMut(&mut [u8]) -> Result<()> {
        let mut s = seed;
        move |buf: &mut [u8]| {
            for b in buf.iter_mut() {
                s = s.wrapping_add(0x9E37_79B9_7F4A_7C15);
                let mut z = s;
                z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
                z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
                *b = (z ^ (z >> 31)) as u8;
            }
            Ok(())
        }
    }

    fn fact(n: u32) -> u128 {
        (1..=n as u128).product()
    }

    /// Nombre de mots de passe valides et espérance d'occurrences d'UN symbole de chaque famille,
    /// par compositions (n_min, n_maj, n_chiffres, 3 spéciaux), chacune ≥ 1.
    fn exact() -> (u128, [f64; 4]) {
        let sizes: Vec<u128> = PASSWORD_FAMILIES.iter().map(|f| f.len() as u128).collect();
        let l = PASSWORD_LEN as u32;
        let mut total = 0u128;
        let mut weighted = [0u128; 4];
        for a in 1..=l - 3 {
            for b in 1..=l - 2 - a {
                for c in 1..=l - 1 - a - b {
                    let d = l - a - b - c;
                    if d != 3 {
                        continue;
                    }
                    let n = [a, b, c, d];
                    let mut w = fact(l);
                    for (i, &k) in n.iter().enumerate() {
                        w = w / fact(k) * sizes[i].pow(k);
                    }
                    total += w;
                    for (i, &k) in n.iter().enumerate() {
                        weighted[i] += w * k as u128;
                    }
                }
            }
        }
        let per = core::array::from_fn(|i| weighted[i] as f64 / total as f64 / sizes[i] as f64);
        (total, per)
    }

    #[test]
    fn alphabet() {
        assert_eq!(PASSWORD_FAMILIES.concat(), PASSWORD_ALPHABET);
        let mut chars: Vec<char> = PASSWORD_ALPHABET.chars().collect();
        assert_eq!(chars.len(), 63);
        chars.sort_unstable();
        chars.dedup();
        assert_eq!(chars.len(), 63, "symboles distincts");
        for c in "SsZzB0Oo1lIij|`'\" :;.,_~^[]{}<>\\".chars() {
            assert!(!PASSWORD_ALPHABET.contains(c), "{c}");
        }
        for c in PASSWORD_FAMILIES[3].chars() {
            assert!("!?@#$%&*+-=/()".contains(c));
        }
    }

    #[test]
    fn entropie() {
        assert_eq!(PASSWORD_SPECIALS, 3);
        let (total, _) = exact();
        assert_eq!(total, 11_062_464_629_113_497_600);
        // Inclusion-exclusion, indépendante des compositions : C(11,3) × 14^3 places et symboles
        // des spéciaux, puis les 8 autres places couvrent les trois autres familles.
        let sizes: Vec<i128> = PASSWORD_FAMILIES[..3]
            .iter()
            .map(|f| f.len() as i128)
            .collect();
        let mut rest = 0i128;
        for m in 0..8u32 {
            let sum: i128 = (0..3).filter(|i| m >> i & 1 == 1).map(|i| sizes[i]).sum();
            let sign = if (3 - m.count_ones()) % 2 == 0 { 1 } else { -1 };
            rest += sign * sum.pow(8);
        }
        let binom = (fact(11) / (fact(3) * fact(8))) as i128;
        assert_eq!((binom * 14i128.pow(3) * rest) as u128, total);
        let bits = (total as f64).log2();
        assert!((bits - 63.26).abs() < 0.005, "{bits}");
        assert!(bits >= 60.0);
    }

    #[test]
    fn dix_mille_tirages() {
        let n = 10_000usize;
        let mut rng = test_rng(1);
        let mut counts = std::collections::HashMap::<char, usize>::new();
        for _ in 0..n {
            let p = generate(&mut rng).unwrap();
            assert_eq!(p.chars().count(), PASSWORD_LEN);
            for c in p.chars() {
                assert!(PASSWORD_ALPHABET.contains(c));
                *counts.entry(c).or_default() += 1;
            }
            for f in PASSWORD_FAMILIES {
                assert!(p.chars().any(|c| f.contains(c)), "{p} : famille {f}");
            }
            let specials = p.chars().filter(|&c| PASSWORD_FAMILIES[3].contains(c));
            assert_eq!(specials.count(), 3, "{p}");
            assert!(is_generated(&p));
        }
        let (_, per) = exact();
        for (i, f) in PASSWORD_FAMILIES.iter().enumerate() {
            let want = per[i] * n as f64;
            for c in f.chars() {
                let got = counts.get(&c).copied().unwrap_or(0) as f64;
                assert!(
                    got >= 0.8 * want && got <= 1.2 * want,
                    "« {c} » : {got} pour {want:.0}"
                );
            }
        }
    }

    #[test]
    fn rejet_et_recommencement() {
        // 1er tirage : 22 × « a » (une famille) → refusé ; 2e : quatre familles mais deux
        // spéciaux → refusé ; 3e : quatre spéciaux → refusé ; 4e : 252 et 255 jetés, puis
        // a A 2 ! (112 → !) ? (63 → a, 83 → A, 104 → 2) a A.
        let pad = |a: &[u8]| {
            let mut v = a.to_vec();
            v.resize(22, 0);
            v
        };
        let mut draws = vec![
            vec![0u8; 22],
            pad(&[0, 20, 41, 49, 50]),
            pad(&[0, 20, 41, 49, 50, 51, 52]),
            pad(&[252, 0, 20, 255, 41, 49, 112, 50, 63, 83, 104, 0, 20]),
        ];
        draws.reverse();
        let mut rng = |buf: &mut [u8]| {
            assert_eq!(buf.len(), 22);
            buf.copy_from_slice(&draws.pop().expect("tirage de trop"));
            Ok(())
        };
        assert_eq!(generate(&mut rng).unwrap(), "aA2!!?aA2aA");
        assert!(draws.is_empty());
    }

    #[test]
    fn rejet_sur_plusieurs_tirages() {
        // Octets tous ≥ 252 : aucun caractère, nouveau tirage pour le même essai.
        let mut draws = vec![vec![255u8; 22], {
            let mut v = vec![0u8, 20, 41, 49, 50, 51];
            v.extend([0, 20, 41, 0, 20]);
            v.resize(22, 0);
            v
        }];
        draws.reverse();
        let mut rng = |buf: &mut [u8]| {
            buf.copy_from_slice(&draws.pop().unwrap());
            Ok(())
        };
        assert_eq!(generate(&mut rng).unwrap(), "aA2!?@aA2aA");
        assert!(draws.is_empty());
    }

    #[test]
    fn aleatoire_qui_echoue() {
        // Un aléa qui échoue (getRandomValues qui lève) arrête le tirage : jamais de boucle sans
        // fin sur un tampon nul, jamais de mot de passe tiré d'octets non aléatoires.
        let mut calls = 0;
        let mut fail = |_: &mut [u8]| {
            calls += 1;
            Err(Error::AleatoireIndisponible)
        };
        assert_eq!(generate(&mut fail), Err(Error::AleatoireIndisponible));
        assert_eq!(calls, 1);
        // Échec au 2e tirage (le 1er, une seule famille, est refusé) : erreur, pas de résultat.
        let mut n = 0;
        let mut late = |buf: &mut [u8]| {
            n += 1;
            if n > 1 {
                return Err(Error::AleatoireIndisponible);
            }
            buf.fill(0);
            Ok(())
        };
        assert_eq!(generate(&mut late), Err(Error::AleatoireIndisponible));
        assert_eq!(n, 2);
    }

    #[test]
    fn accepte_les_mots_de_passe_generes() {
        let mut rng = test_rng(2);
        for _ in 0..40 {
            assert!(is_generated(&generate(&mut rng).unwrap()));
        }
        assert!(is_generated("aC3!cD5?#Fg"));
        assert!(is_generated("a!C?3#D5eFg"));
        assert!(!is_generated("aC3!cD5?#F@")); // quatre spéciaux
    }

    #[test]
    fn refuse_toute_autre_chaine() {
        for pw in [
            "",
            "aC3!cD5?#F",
            "aB3!cD5?#F",
            "aC3!cD5?#Fgh",
            "cheval-agrafe-pile",
            "aC3!cD5?#Fl",
            "aC3!cD5?#FO",
            "aC3!cD5?#F0",
            "aC3!cD5?#F1",
            "aC3!cD5?#Fi",
            "aC3!cD5?#Fj",
            "aC3!cD5?#FS",
            "aC3!cD5?#Fs",
            "aC3!cD5?#FZ",
            "aC3!cD5?#Fz",
            "aC3!cD5?#FB",
            "aC3!cD5?#F:",
            "aC3!cD5?#F;",
            "aC3!cD5?#F|",
            "abcdefghkmn",
            "aC3cD5eF7gh",
            "aC3!cD5?#F ",
            "aC3!cD5?eé2",
            "aC3!cD5?eFg",
            "aC3!cD5eFgh",
            "!?#abcdefgh",
        ] {
            assert!(!is_generated(pw), "{pw}");
        }
    }
}
