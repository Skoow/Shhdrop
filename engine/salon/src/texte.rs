//! Règles de texte, de pseudonyme et de nom de fichier du salon. Les apps doivent faire
//! exactement la même chose (vecteurs communs) : l'ordre des étapes fait partie du format.
//!
//! **Texte** (`nettoyer_texte`) : 1. NFC ; 2. retrait des contrôles (C0, DEL, C1, `\t` et `\r`
//! compris, sauf `\n`) et des inversions de sens U+202A–U+202E et U+2066–U+2069 ; 3. NFC de
//! nouveau (un caractère retiré entre une lettre et son accent ne doit pas empêcher la
//! composition ; sans effet sinon) ; 4. comptage : 1 à 2 000 graphèmes (UAX #29, `unicode-segmentation`)
//! et 3 500 octets UTF-8 au plus.
//!
//! **Pseudonyme** (`verifier_pseudo`, spec §39.4 point 4) : 1. NFC ; 2. retrait des contrôles,
//! des inversions de sens et de tout `Default_Ignorable_Code_Point` ; 3. NFC ; 4. toute espace
//! Unicode (`White_Space`) devient U+0020, regroupées et rognées ; 5. 2 à 24 graphèmes, 8 points de
//! code au plus par graphème (contre l'empilement de marques) ; 6. seulement lettres, chiffres,
//! marques, espace et `- _ . '`, au moins une lettre ou un chiffre ; 7. une seule écriture
//! (UAX #24 : intersection des `Script_Extension`, comme le contrôle « une seule écriture » d'UTS #39 ;
//! Han avec hiragana et katakana, avec bopomofo ou avec hangul sont permis comme dans UTS #39) ;
//! 8. pas d'émoji : les blocs de pictogrammes sont refusés par plages de points de code
//! (voir `est_pictogramme`), ce qui couvre aussi chiffres entourés, lettres encerclées et drapeaux.
//! Écarts connus : « lettre » = propriété `Alphabetic` et « chiffre » = propriété `Numeric` de la
//! bibliothèque standard (inclut quelques nombres non décimaux) ; « marque » = caractère qui se
//! lie au précédent dans la segmentation en graphèmes.
//!
//! **Nom** (`nettoyer_nom`) : port de `safeName` (web/src/transfer/safety.ts), même ordre
//! (retrait, puis NFC, puis espaces) ; seul écart : 255 octets UTF-8 au plus en plus des
//! 120 points de code.
use crate::error::{Error, Result};
use unicode_normalization::UnicodeNormalization;
use unicode_script::{Script, ScriptExtension, UnicodeScript};
use unicode_segmentation::UnicodeSegmentation;

pub(crate) const TEXTE_GRAPHEMES: usize = 2000;
pub(crate) const TEXTE_OCTETS: usize = 3500;
pub(crate) const EXTRAIT_GRAPHEMES: usize = 140;
const PSEUDO_MIN: usize = 2;
const PSEUDO_MAX: usize = 24;
const PSEUDO_POINTS_PAR_GRAPHEME: usize = 8;
/// Entrée brute au-delà de laquelle un pseudonyme est refusé sans l'examiner (24 graphèmes).
const PSEUDO_BRUT_MAX: usize = 4096;
const NOM_POINTS: usize = 120;
const NOM_OCTETS: usize = 255;
const NOM_EXT_MAX: usize = 16;
const EMOJI_OCTETS: usize = 32;

fn est_inversion_de_sens(c: char) -> bool {
    matches!(c, '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}')
}

/// Texte d'un message : voir l'en-tête du module.
pub fn nettoyer_texte(s: &str) -> Result<String> {
    nettoyer(s, TEXTE_GRAPHEMES, true)
}

/// Extrait d'une réponse : mêmes règles, 140 graphèmes, vide permis (réponse à une pièce).
pub(crate) fn nettoyer_extrait(s: &str) -> Result<String> {
    nettoyer(s, EXTRAIT_GRAPHEMES, false)
}

fn nettoyer(s: &str, max_graphemes: usize, non_vide: bool) -> Result<String> {
    let nfc: String = s.nfc().collect();
    let sans: String = nfc
        .chars()
        .filter(|&c| (c == '\n' || !c.is_control()) && !est_inversion_de_sens(c))
        .collect();
    let out: String = sans.nfc().collect();
    if out.is_empty() {
        return if non_vide {
            Err(Error::TexteInvalide)
        } else {
            Ok(out)
        };
    }
    if out.len() > TEXTE_OCTETS || out.graphemes(true).count() > max_graphemes {
        return Err(Error::TexteTropLong);
    }
    Ok(out)
}

/// `Default_Ignorable_Code_Point` (UCD 15.1/16) : largeur nulle, remplissages, sélecteurs de
/// variante, étiquettes, contrôles de format.
fn est_ignorable(c: char) -> bool {
    matches!(c,
        '\u{00AD}' | '\u{034F}' | '\u{061C}' | '\u{115F}'..='\u{1160}' | '\u{17B4}'..='\u{17B5}'
        | '\u{180B}'..='\u{180F}' | '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}'
        | '\u{2060}'..='\u{206F}' | '\u{3164}' | '\u{FE00}'..='\u{FE0F}' | '\u{FEFF}' | '\u{FFA0}'
        | '\u{FFF0}'..='\u{FFF8}' | '\u{1BCA0}'..='\u{1BCA3}' | '\u{1D173}'..='\u{1D17A}'
        | '\u{E0000}'..='\u{E0FFF}')
}

/// Blocs de pictogrammes et de caractères entourés, refusés dans un pseudonyme : symboles
/// divers et dingbats, chiffres et lettres entourés, flèches et symboles ajoutés, CJK entouré,
/// tout le plan U+1F000–U+1FFFF (émojis, drapeaux, cartes, lettres encadrées), teintes de
/// peau, marques enveloppantes (keycap U+20E3).
fn est_pictogramme(c: char) -> bool {
    matches!(c,
        '\u{2460}'..='\u{24FF}' | '\u{2600}'..='\u{27BF}' | '\u{2B00}'..='\u{2BFF}'
        | '\u{20DD}'..='\u{20E4}' | '\u{3200}'..='\u{33FF}' | '\u{1F000}'..='\u{1FFFF}'
        | '\u{00A9}' | '\u{00AE}' | '\u{203C}' | '\u{2049}' | '\u{2122}' | '\u{2139}'
        | '\u{2190}'..='\u{21FF}' | '\u{2300}'..='\u{23FF}' | '\u{25A0}'..='\u{25FF}'
        | '\u{2900}'..='\u{297F}' | '\u{3030}' | '\u{303D}')
}

/// Normalisation + retrait des invisibles + espaces regroupées et rognées.
fn pseudo_nettoye(s: &str) -> String {
    let nfc: String = s.nfc().collect();
    let sans: String = nfc
        .chars()
        .filter(|&c| !c.is_control() && !est_ignorable(c))
        .collect();
    let mut out = String::new();
    let mut espace = false;
    for c in sans.nfc() {
        if c.is_whitespace() {
            espace = true;
        } else {
            if espace && !out.is_empty() {
                out.push(' ');
            }
            espace = false;
            out.push(c);
        }
    }
    out
}

/// Vrai si `c` se lie au caractère précédent dans un graphème (marque, signe voyelle).
fn se_lie(c: char) -> bool {
    let mut t = String::with_capacity(5);
    t.push('a');
    t.push(c);
    t.graphemes(true).count() == 1
}

fn ecriture_unique(s: &str) -> bool {
    let mut ext = ScriptExtension::default();
    for c in s.chars() {
        if c.script() == Script::Unknown {
            return false;
        }
        ext.intersect_with(c.script_extension());
    }
    if !ext.is_empty() {
        return true;
    }
    // Japonais, chinois lettré, coréen : Han mêlé à une écriture propre à la langue.
    let groupes: [&[Script]; 3] = [
        &[Script::Han, Script::Hiragana, Script::Katakana],
        &[Script::Han, Script::Bopomofo],
        &[Script::Han, Script::Hangul],
    ];
    groupes.iter().any(|g| {
        s.chars().all(|c| {
            let sc = c.script();
            matches!(sc, Script::Common | Script::Inherited) || g.contains(&sc)
        })
    })
}

/// Renvoie le pseudonyme nettoyé ou `pseudo_invalide`.
pub fn verifier_pseudo(s: &str) -> Result<String> {
    if s.len() > PSEUDO_BRUT_MAX {
        return Err(Error::PseudoInvalide);
    }
    let p = pseudo_nettoye(s);
    let n = p.graphemes(true).count();
    if !(PSEUDO_MIN..=PSEUDO_MAX).contains(&n) {
        return Err(Error::PseudoInvalide);
    }
    let mut a_un_signe = false;
    for g in p.graphemes(true) {
        if g.chars().count() > PSEUDO_POINTS_PAR_GRAPHEME {
            return Err(Error::PseudoInvalide);
        }
        for (i, c) in g.chars().enumerate() {
            if est_pictogramme(c) {
                return Err(Error::PseudoInvalide);
            }
            let ok = if i == 0 {
                match c {
                    ' ' | '-' | '_' | '.' | '\'' => true,
                    _ if c.is_ascii() => c.is_ascii_alphanumeric(),
                    _ => (c.is_alphabetic() || c.is_numeric()) && !se_lie(c),
                }
            } else {
                c.is_alphanumeric() || se_lie(c)
            };
            if !ok {
                return Err(Error::PseudoInvalide);
            }
            a_un_signe |= c.is_alphanumeric();
        }
    }
    if !a_un_signe || !ecriture_unique(&p) {
        return Err(Error::PseudoInvalide);
    }
    Ok(p)
}

/// Clé de comparaison de deux pseudonymes : NFKC, minuscules, sans espaces ni ponctuation
/// (seuls restent lettres, chiffres et marques). À appeler sur un pseudonyme déjà vérifié.
/// Ne replie pas les caractères d'écritures différentes qui se ressemblent (« Alice » entier
/// en cyrillique) : voir le rapport de la tâche 5.
pub fn cle_unicite(pseudo: &str) -> String {
    let bas: String = pseudo.nfkc().collect::<String>().to_lowercase();
    bas.nfkc()
        .filter(|&c| c.is_alphanumeric() || (!c.is_whitespace() && !c.is_ascii() && se_lie(c)))
        .collect()
}

/// `Extended_Pictographic` (emoji-data.txt, Unicode 15.1) : sert seulement à garder U+200D et
/// U+FE0F dans les noms de fichier, comme `\p{Extended_Pictographic}` du site.
fn est_pictographique(c: char) -> bool {
    matches!(c,
        '\u{00A9}' | '\u{00AE}' | '\u{203C}' | '\u{2049}' | '\u{2122}' | '\u{2139}'
        | '\u{2194}'..='\u{2199}' | '\u{21A9}'..='\u{21AA}' | '\u{231A}'..='\u{231B}' | '\u{2328}'
        | '\u{2388}' | '\u{23CF}' | '\u{23E9}'..='\u{23F3}' | '\u{23F8}'..='\u{23FA}' | '\u{24C2}'
        | '\u{25AA}'..='\u{25AB}' | '\u{25B6}' | '\u{25C0}' | '\u{25FB}'..='\u{25FE}'
        | '\u{2600}'..='\u{2605}' | '\u{2607}'..='\u{2612}' | '\u{2614}'..='\u{2685}'
        | '\u{2690}'..='\u{2705}' | '\u{2708}'..='\u{2712}' | '\u{2714}' | '\u{2716}' | '\u{271D}'
        | '\u{2721}' | '\u{2728}' | '\u{2733}'..='\u{2734}' | '\u{2744}' | '\u{2747}' | '\u{274C}'
        | '\u{274E}' | '\u{2753}'..='\u{2755}' | '\u{2757}' | '\u{2763}'..='\u{2767}'
        | '\u{2795}'..='\u{2797}' | '\u{27A1}' | '\u{27B0}' | '\u{27BF}' | '\u{2934}'..='\u{2935}'
        | '\u{2B05}'..='\u{2B07}' | '\u{2B1B}'..='\u{2B1C}' | '\u{2B50}' | '\u{2B55}' | '\u{3030}'
        | '\u{303D}' | '\u{3297}' | '\u{3299}' | '\u{1F000}'..='\u{1F0FF}' | '\u{1F10D}'..='\u{1F10F}'
        | '\u{1F12F}' | '\u{1F16C}'..='\u{1F171}' | '\u{1F17E}'..='\u{1F17F}' | '\u{1F18E}'
        | '\u{1F191}'..='\u{1F19A}' | '\u{1F1AD}'..='\u{1F1E5}' | '\u{1F201}'..='\u{1F20F}'
        | '\u{1F21A}' | '\u{1F22F}' | '\u{1F232}'..='\u{1F23A}' | '\u{1F23C}'..='\u{1F23F}'
        | '\u{1F249}'..='\u{1F3FA}' | '\u{1F400}'..='\u{1F53D}' | '\u{1F546}'..='\u{1F64F}'
        | '\u{1F680}'..='\u{1F6FF}' | '\u{1F774}'..='\u{1F77F}' | '\u{1F7D5}'..='\u{1F7FF}'
        | '\u{1F80C}'..='\u{1F80F}' | '\u{1F848}'..='\u{1F84F}' | '\u{1F85A}'..='\u{1F85F}'
        | '\u{1F888}'..='\u{1F88F}' | '\u{1F8AE}'..='\u{1F8FF}' | '\u{1F90C}'..='\u{1F93A}'
        | '\u{1F93C}'..='\u{1F945}' | '\u{1F947}'..='\u{1FAFF}' | '\u{1FC00}'..='\u{1FFFD}')
}

fn est_teinte(c: char) -> bool {
    matches!(c, '\u{1F3FB}'..='\u{1F3FF}')
}

/// Vrai si un pictogramme (avec sélecteur et teinte facultatifs) finit juste avant `i`.
fn pictogramme_avant(v: &[char], i: usize) -> bool {
    for teinte in [true, false] {
        let mut j = i;
        if teinte {
            if j == 0 || !est_teinte(v[j - 1]) {
                continue;
            }
            j -= 1;
        }
        for sel in [true, false] {
            let mut k = j;
            if sel {
                if k == 0 || v[k - 1] != '\u{FE0F}' {
                    continue;
                }
                k -= 1;
            }
            if k > 0 && est_pictographique(v[k - 1]) {
                return true;
            }
        }
    }
    false
}

/// Début de `s` fait de graphèmes entiers, d'au plus `points` points de code et `octets` octets.
fn prendre_graphemes(s: &str, points: usize, octets: usize) -> String {
    let (mut out, mut p, mut o) = (String::new(), 0, 0);
    for g in s.graphemes(true) {
        let (gp, go) = (g.chars().count(), g.len());
        if p + gp > points || o + go > octets {
            break;
        }
        out.push_str(g);
        p += gp;
        o += go;
    }
    out
}

fn rogner_fin(s: &str) -> &str {
    s.trim_end_matches(|c: char| c.is_whitespace() || c == '.')
}

/// Nom de fichier affichable et téléchargeable : voir l'en-tête du module. Ne renvoie jamais de
/// chaîne vide (« fichier » à défaut) ; idempotent.
pub fn nettoyer_nom(raw: &str) -> String {
    // 1. Retrait avant la normalisation (« e » + largeur nulle + accent se compose en « é »).
    let a: Vec<char> = raw
        .chars()
        .filter(|&c| {
            let garde = c == '\u{200D}' || c == '\u{FE0F}';
            let retire = c.is_control()
                || c == '/'
                || c == '\\'
                || est_inversion_de_sens(c)
                || matches!(c, '\u{200E}' | '\u{200F}' | '\u{061C}')
                || (est_ignorable(c) && !garde);
            !retire
        })
        .collect();
    // 2. U+FE0F seulement après un pictogramme ; 3. U+200D seulement entre deux pictogrammes
    // (chaque passe lit la chaîne de la passe précédente, comme les deux `replace` du site).
    let b: Vec<char> = a
        .iter()
        .enumerate()
        .filter(|&(i, &c)| c != '\u{FE0F}' || (i > 0 && est_pictographique(a[i - 1])))
        .map(|(_, &c)| c)
        .collect();
    let c2: String = b
        .iter()
        .enumerate()
        .filter(|&(i, &c)| {
            c != '\u{200D}'
                || (pictogramme_avant(&b, i)
                    && b.get(i + 1).is_some_and(|&n| est_pictographique(n)))
        })
        .map(|(_, &c)| c)
        .collect();
    let mut esp = String::new();
    let mut dans_espace = false;
    for c in c2.nfc() {
        if c.is_whitespace() {
            if !dans_espace {
                esp.push(' ');
            }
            dans_espace = true;
        } else {
            dans_espace = false;
            esp.push(c);
        }
    }
    let s = esp.trim_start_matches(|c: char| c.is_whitespace() || c == '.');
    let s = rogner_fin(s);
    let s = if s.chars().count() > NOM_POINTS || s.len() > NOM_OCTETS {
        let ext = s.rfind('.').filter(|&d| d > 0).map(|d| &s[d..]);
        match ext {
            Some(e) if e.chars().count() > 1 && e.chars().count() <= NOM_EXT_MAX => {
                let tete = &s[..s.len() - e.len()];
                let t =
                    prendre_graphemes(tete, NOM_POINTS - e.chars().count(), NOM_OCTETS - e.len());
                let t = rogner_fin(&t);
                format!("{}{}", if t.is_empty() { "fichier" } else { t }, e)
            }
            _ => rogner_fin(&prendre_graphemes(s, NOM_POINTS, NOM_OCTETS)).to_string(),
        }
    } else {
        s.to_string()
    };
    if s.is_empty() {
        "fichier".to_string()
    } else {
        s
    }
}

/// Réaction : exactement un graphème, 32 octets au plus, sans contrôle ni inversion de sens
/// ni espace seule. (Pas de liste d'émojis : « exactement un graphème », comme la spécification.)
pub(crate) fn emoji_valide(s: &str) -> bool {
    s.len() <= EMOJI_OCTETS
        && s.graphemes(true).count() == 1
        && s.nfc().eq(s.chars())
        && !s.chars().any(|c| {
            c.is_control()
                || est_inversion_de_sens(c)
                || matches!(c, '\u{200E}' | '\u{200F}' | '\u{061C}')
        })
        && !s.chars().all(|c| c.is_whitespace())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texte_nettoye() {
        assert_eq!(
            nettoyer_texte("Bonjour\u{202E}\r\nmonde").unwrap(),
            "Bonjour\nmonde"
        );
        assert_eq!(nettoyer_texte("e\u{301}").unwrap(), "\u{e9}");
        // contrôles C0, DEL, C1 retirés (tabulation comprise), \n gardé ; U+2066-2069 retirés
        assert_eq!(
            nettoyer_texte("a\t\u{1}\u{7f}\u{85}\u{9f}\u{2066}\u{2069}b\n").unwrap(),
            "ab\n"
        );
        // ordre : NFC, retrait, NFC (un caractère retiré entre base et accent n'empêche pas la composition)
        assert_eq!(nettoyer_texte("e\u{202E}\u{301}").unwrap(), "\u{e9}");
        // les émojis composés restent entiers (ZWJ, sélecteur de variante)
        let famille = "👨\u{200D}👩\u{200D}👧";
        assert_eq!(nettoyer_texte(famille).unwrap(), famille);
        assert_eq!(
            nettoyer_texte("\u{202E}\r\t").unwrap_err(),
            Error::TexteInvalide
        );
        assert_eq!(nettoyer_texte("").unwrap_err(), Error::TexteInvalide);
    }

    #[test]
    fn texte_limites() {
        assert!(nettoyer_texte(&"a".repeat(2000)).is_ok());
        assert_eq!(
            nettoyer_texte(&"a".repeat(2001)).unwrap_err(),
            Error::TexteTropLong
        );
        // 3 500 octets : accepté ; 3 501 : refusé (graphèmes d'un octet puis de deux)
        assert!(nettoyer_texte(&"é".repeat(1750)).is_ok());
        assert_eq!(
            nettoyer_texte(&format!("{}a", "é".repeat(1750))).unwrap_err(),
            Error::TexteTropLong
        );
        // un graphème = plusieurs points de code : compté une fois
        assert!(nettoyer_texte(&"👨\u{200D}👩\u{200D}👧".repeat(100)).is_ok());
        // 140 graphèmes pour un extrait
        assert!(nettoyer_extrait(&"a".repeat(140)).is_ok());
        assert_eq!(
            nettoyer_extrait(&"a".repeat(141)).unwrap_err(),
            Error::TexteTropLong
        );
        assert_eq!(nettoyer_extrait("").unwrap(), "");
    }

    #[test]
    fn pseudo_regles() {
        assert_eq!(verifier_pseudo("Léa").unwrap(), "Léa");
        assert_eq!(verifier_pseudo("Le\u{301}a").unwrap(), "Léa");
        assert_eq!(
            verifier_pseudo("  Léa \u{a0} Dupont\t").unwrap(),
            "Léa Dupont"
        );
        assert_eq!(verifier_pseudo("L\u{200B}éa\u{202E}").unwrap(), "Léa");
        for ok in [
            "Jean-Luc",
            "O'Neil",
            "x_y.z",
            "Лея",
            "Ελένη",
            "田中ひろし",
            "김민수",
            "علي",
            "Zoë42",
            "𝓛éa",
            "हिन्दी",
        ] {
            assert_eq!(verifier_pseudo(ok).unwrap(), ok, "{ok}");
        }
        for ko in [
            "A",
            "",
            " ",
            "Аlice", /* А cyrillique */
            "😀Léa",
            "Léa😀",
            "Léa\u{1F3FD}",
            "L\u{20E3}éa",
            "Ⓜax",
            "..",
            "- -",
            "Léa!",
            "Léa@x",
            "a/b",
            "ab\u{301}\u{301}\u{301}\u{301}\u{301}\u{301}\u{301}\u{301}\u{301}",
            "\u{301}ab",
            "ab\u{e000}",
            "Lea\u{378}",
            "ab#",
            "1\u{FE0F}\u{20E3}x",
        ] {
            assert_eq!(
                verifier_pseudo(ko).unwrap_err(),
                Error::PseudoInvalide,
                "{ko:?}"
            );
        }
        assert!(verifier_pseudo(&"a".repeat(24)).is_ok());
        assert_eq!(
            verifier_pseudo(&"a".repeat(25)).unwrap_err(),
            Error::PseudoInvalide
        );
        assert!(verifier_pseudo("ab").is_ok());
        assert_eq!(
            verifier_pseudo(&"a".repeat(100_000)).unwrap_err(),
            Error::PseudoInvalide
        );
    }

    #[test]
    fn pseudo_cle_unicite() {
        assert_eq!(cle_unicite("léa"), cle_unicite("Léa"));
        assert_eq!(cle_unicite("Léa"), "léa");
        assert_eq!(cle_unicite("Le\u{301}a"), cle_unicite("Léa"));
        assert_eq!(cle_unicite("Jean-Luc O'Neil_x.y"), "jeanluconeilxy");
        assert_eq!(cle_unicite("ＬＥＡ"), "lea");
        assert_ne!(cle_unicite("Léa"), cle_unicite("Lea"));
    }

    #[test]
    fn nom_comme_safename() {
        let n = nettoyer_nom;
        assert_eq!(n("../../facture\u{202E}fdp.exe\u{0}"), "facturefdp.exe");
        assert_eq!(n("a\u{1}\u{1F}\u{7F}\u{80}\u{9F}b.txt"), "ab.txt");
        assert_eq!(n("dossier/sous\\fichier.txt"), "dossiersousfichier.txt");
        assert_eq!(n("...cache"), "cache");
        assert_eq!(n(". . .x"), "x");
        assert_eq!(n("  a \t\n  b  .pdf "), "a b .pdf");
        assert_eq!(n("facture.exe. . "), "facture.exe");
        assert_eq!(n("été.txt"), "été.txt");
        assert_eq!(n("a\u{200B}b\u{200C}\u{200D}\u{2060}c.txt"), "abc.txt");
        assert_eq!(n("fac\u{E0041}\u{E0000}\u{E007F}ture.pdf"), "facture.pdf");
        assert_eq!(n("\u{200B}\u{200C}\u{200D}\u{2060}\u{E0041}"), "fichier");
        assert_eq!(n("e\u{200B}\u{301}.txt"), "\u{e9}.txt");
        assert_eq!(n("fac\u{AD}ture"), "facture");
        let famille = "👨\u{200D}👩\u{200D}👧\u{200D}👦";
        assert_eq!(n(&format!("{famille}.png")), format!("{famille}.png"));
        assert_eq!(n("👩🏽\u{200D}💻.txt"), "👩🏽\u{200D}💻.txt");
        assert_eq!(n("❤\u{FE0F}\u{200D}🔥.txt"), "❤\u{FE0F}\u{200D}🔥.txt");
        assert_eq!(n("a\u{200D}b"), "ab");
        assert_eq!(n("a\u{200D}👩"), "a👩");
        assert_eq!(n("👩\u{200D}b"), "👩b");
        assert_eq!(n("👩\u{200D}\u{200D}👧"), "👩👧");
        assert_eq!(n("x.ex\u{FE0F}e"), "x.exe");
        assert_eq!(n("x.ex\u{FE00}e"), "x.exe");
        assert_eq!(
            n("doc\u{3164}\u{3164}\u{FFA0}\u{115F}\u{1160}.pdf"),
            "doc.pdf"
        );
        assert_eq!(n("❤\u{FE0F}.txt"), "❤\u{FE0F}.txt");
        assert_eq!(n(".exe"), "exe");
        assert_eq!(n(&format!("a{}", "\u{301}".repeat(200))), "fichier");
        for v in ["", "   ", "...", "/", "\u{202E}\u{0}", "./../"] {
            assert_eq!(n(v), "fichier", "{v:?}");
        }
    }

    #[test]
    fn nom_longueurs() {
        let n = nettoyer_nom;
        // 120 points de code, coupé entre deux graphèmes, extension gardée
        assert_eq!(n(&"x".repeat(200)), "x".repeat(120));
        assert_eq!(
            n(&format!("{}.png", "a".repeat(200))),
            format!("{}.png", "a".repeat(116))
        );
        assert_eq!(
            n(&format!("{}🇫🇷{}", "a".repeat(119), "b".repeat(50))),
            "a".repeat(119)
        );
        assert_eq!(
            n(&format!("{}🇫🇷{}.png", "a".repeat(115), "b".repeat(30))),
            format!("{}.png", "a".repeat(115))
        );
        assert!(n(&format!("a.{}", "e".repeat(300))).chars().count() <= 120);
        // 255 octets au plus (écart voulu avec le site, qui ne limite que les points de code)
        let s = n(&format!("{}.png", "日".repeat(200)));
        assert_eq!(s, format!("{}.png", "日".repeat(83))); // (255 - 4) / 3 = 83
        let s = n(&"😀".repeat(130));
        assert_eq!(s, "😀".repeat(63)); // 63 × 4 = 252 octets ; 64 × 4 = 256 > 255
        // idempotence
        for v in [
            "a".repeat(500),
            "é".repeat(300) + ".txt",
            "😀".repeat(300),
            "x/y".to_string(),
        ] {
            let a = n(&v);
            assert_eq!(n(&a), a);
        }
    }

    #[test]
    fn emoji() {
        for ok in ["👍", "👍🏽", "❤\u{FE0F}", "👨\u{200D}👩\u{200D}👧", "🇫🇷", "a"]
        {
            assert!(emoji_valide(ok), "{ok:?}");
        }
        for ko in ["", "👍👍", "ab", " ", "\n", "\u{202E}", "\u{0}"] {
            assert!(!emoji_valide(ko), "{ko:?}");
        }
        // 32 octets au plus
        assert!(!emoji_valide(&format!("一{}", "\u{301}".repeat(15)))); // 3 + 30 octets
        assert!(emoji_valide(&format!("一{}", "\u{301}".repeat(14)))); // 31 octets
    }
}
