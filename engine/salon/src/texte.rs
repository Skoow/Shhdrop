//! Règles de texte, de pseudonyme et de nom de fichier du salon. Les apps doivent faire
//! exactement la même chose (vecteurs communs) : l'ordre des étapes fait partie du format.
//!
//! **Texte** (`nettoyer_texte`) : 1. NFC ; 2. retrait des caractères « étiquette » U+E0000–E007F (sauf
//! dans un drapeau de la liste emoji 15.0 : U+1F3F4, étiquettes U+E0020–E007E, U+E007F) et des contrôles (C0, DEL, C1, `\t` et `\r`
//! compris, sauf `\n`) et des inversions de sens U+202A–U+202E et U+2066–U+2069 ; 3. NFC de
//! nouveau (un caractère retiré entre une lettre et son accent ne doit pas empêcher la
//! composition ; sans effet sinon) ; 4. au moins un caractère visible (ni `White_Space`, ni invisible, ni marque, ni U+2800 motif braille vide : une marque seule, ou posée sur une espace, ne compte pas ; « marque » comme pour le pseudonyme ci-dessous) ; 5. comptage : 1 à 2 000 graphèmes (UAX #29, `unicode-segmentation`)
//! et 3 500 octets UTF-8 au plus.
//!
//! **Pseudonyme** (`verifier_pseudo`, spec §39.4 point 4) et sa clé d'unicité (`cle_unicite`) :
//! règle de `shhdrop_core::texte` (`pseudo_valide`, `pseudo_canon`), commune au salon et au
//! compte depuis le 14 novembre (une seule copie) ; ses trois erreurs deviennent ici
//! `pseudo_invalide`. « Marque » = caractère qui se lie au précédent dans la segmentation en
//! graphèmes (UAX #29 : Extend, SpacingMark, ZWJ ; dont les modificateurs de teinte de peau, qui
//! ne comptent donc pas seuls comme caractère visible) : `shhdrop_core::texte::se_lie`.
//!
//! **Nom** (`nettoyer_nom`) : port de `safeName` (web/src/transfer/safety.ts), même ordre
//! (retrait, puis NFC, puis espaces) ; seul écart : 255 octets UTF-8 au plus en plus des
//! 120 points de code.
use crate::error::{Error, Result};
use shhdrop_core::texte::{est_ignorable, pseudo_canon, pseudo_valide, se_lie};
use unicode_normalization::UnicodeNormalization;
use unicode_segmentation::UnicodeSegmentation;

pub(crate) const TEXTE_GRAPHEMES: usize = 2000;
pub(crate) const TEXTE_OCTETS: usize = 3500;
const NOM_POINTS: usize = 120;
const NOM_OCTETS: usize = 255;
const NOM_EXT_MAX: usize = 16;
const EMOJI_OCTETS: usize = 64;

fn est_inversion_de_sens(c: char) -> bool {
    matches!(c, '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}')
}

/// Retire les caractères « étiquette » U+E0000–U+E007F (texte caché invisible), sauf dans une
/// séquence de drapeau d'émoji : U+1F3F4, puis une ou plusieurs étiquettes U+E0020–U+E007E, puis
/// U+E007F **et** que la séquence entière est dans la liste des émojis « fully-qualified »
/// d'Unicode 15.0 (`EMOJIS` : Angleterre, Écosse, Pays de Galles). Sinon les étiquettes sont retirées
/// et le drapeau noir reste : aucun texte ne peut se cacher dans une séquence de drapeau.
fn retirer_etiquettes(s: &str) -> String {
    let v: Vec<char> = s.chars().collect();
    let est_etiquette = |c: char| ('\u{E0020}'..='\u{E007E}').contains(&c);
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < v.len() {
        let c = v[i];
        if c == '\u{1F3F4}' {
            let mut j = i + 1;
            while j < v.len() && est_etiquette(v[j]) {
                j += 1;
            }
            if j > i + 1
                && v.get(j) == Some(&'\u{E007F}')
                && crate::emoji::dans_la_liste(&v[i..=j].iter().collect::<String>())
            {
                out.extend(&v[i..=j]);
                i = j + 1;
                continue;
            }
        }
        if !('\u{E0000}'..='\u{E007F}').contains(&c) {
            out.push(c);
        }
        i += 1;
    }
    out
}

/// Texte d'un message : voir l'en-tête du module.
pub fn nettoyer_texte(s: &str) -> Result<String> {
    let nfc: String = s.nfc().collect();
    let sans: String = nfc
        .chars()
        .filter(|&c| (c == '\n' || !c.is_control()) && !est_inversion_de_sens(c))
        .collect();
    let out: String = retirer_etiquettes(&sans).nfc().collect();
    // Au moins un caractère visible : ni espace (White_Space), ni invisible (est_ignorable), ni
    // marque (`se_lie`), ni U+2800 (motif braille vide).
    if !out
        .chars()
        .any(|c| !c.is_whitespace() && !est_ignorable(c) && c != '\u{2800}' && !se_lie(c))
    {
        return Err(Error::TexteInvalide);
    }
    if out.len() > TEXTE_OCTETS || out.graphemes(true).count() > TEXTE_GRAPHEMES {
        return Err(Error::TexteTropLong);
    }
    Ok(out)
}

/// Renvoie le pseudonyme nettoyé ou `pseudo_invalide` (règle de `shhdrop_core::texte`).
pub fn verifier_pseudo(s: &str) -> Result<String> {
    pseudo_valide(s).map_err(|_| Error::PseudoInvalide)
}

/// Clé de comparaison de deux pseudonymes déjà vérifiés : `shhdrop_core::texte::pseudo_canon`
/// (NFKC, minuscules, squelette UTS #39, sans espaces ni ponctuation). « Alice » en latin et
/// « Аӏісе » entièrement en cyrillique ont la même clé ; « Léa » et « Lea » non.
pub fn cle_unicite(pseudo: &str) -> String {
    pseudo_canon(pseudo)
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

/// Réaction : exactement une séquence « fully-qualified » de la liste des émojis Unicode 15.0
/// (`emoji-test.txt`, spec §39.5), rien d'autre. Le plafond d'octets évite la recherche pour
/// une chaîne démesurée (la plus longue séquence de la liste fait 35 octets).
pub(crate) fn emoji_valide(s: &str) -> bool {
    s.len() <= EMOJI_OCTETS && crate::emoji::dans_la_liste(s)
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
    fn pseudo_apostrophe_typographique() {
        assert_eq!(verifier_pseudo("L\u{2019}éa").unwrap(), "L'éa");
        assert_eq!(verifier_pseudo("O\u{2019}Neil").unwrap(), "O'Neil");
        assert_eq!(cle_unicite("O\u{2019}Neil"), cle_unicite("O'Neil"));
        // les autres apostrophes et guillemets restent refusés
        for ko in [
            "L\u{2018}éa",
            "L\u{2032}éa",
            "L\u{201C}éa",
            "L`éa",
            "L\u{2BC}éa\u{2BC}\u{2BC}!",
        ] {
            assert!(verifier_pseudo(ko).is_err(), "{ko:?}");
        }
    }

    #[test]
    fn pseudo_cle_unicite() {
        assert_eq!(cle_unicite("léa"), cle_unicite("Léa"));
        assert_eq!(cle_unicite("Le\u{301}a"), cle_unicite("Léa"));
        assert_eq!(cle_unicite("Jean-Luc O'Neil_x.y"), "jeanluconeilxy");
        assert_eq!(cle_unicite("ＬＥＡ"), "lea");
        assert_ne!(cle_unicite("Léa"), cle_unicite("Lea"));
        // sosies entre écritures (squelette UTS #39) : A, i et e cyrilliques (U+0410, U+0456, U+0435), c (U+0441)
        let latin = cle_unicite("Alice");
        assert_eq!(cle_unicite("\u{410}lice"), latin);
        assert_eq!(cle_unicite("\u{410}li\u{441}\u{435}"), latin);
        assert_eq!(cle_unicite("\u{410}l\u{456}c\u{435}"), latin);
        assert_ne!(cle_unicite("Alicia"), latin);
        // vrai sosie tout cyrillique (pseudonyme valide) : A U+0410, palochka U+04CF, i U+0456, c U+0441, e U+0435
        let spoof = "\u{410}\u{4CF}\u{456}\u{441}\u{435}";
        assert_eq!(verifier_pseudo(spoof).unwrap(), spoof);
        assert_eq!(cle_unicite(spoof), latin);
        assert!(verifier_pseudo("\u{410}lice").is_err()); // mêlé
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
        for ok in [
            "👍",
            "👍🏽",
            "❤\u{FE0F}",
            "👨\u{200D}👩\u{200D}👧",
            "🇫🇷",
            "😀",
            "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
            // 35 octets : couple avec cœur, teintes de peau différentes
            "👩🏽\u{200D}❤\u{FE0F}\u{200D}💋\u{200D}👨🏿",
            "1\u{FE0F}\u{20E3}",
        ] {
            assert!(emoji_valide(ok), "{ok:?}");
        }
        assert_eq!("👩🏽\u{200D}❤\u{FE0F}\u{200D}💋\u{200D}👨🏿".len(), 35);
        for ko in [
            "",
            "a",
            "ab",
            "👍👍",
            " ",
            "\n",
            "\u{202E}",
            "\u{0}",
            "😀\u{200E}",
            "❤",                    // non qualifié (sans U+FE0F)
            "👍\u{FE0F}",           // sélecteur en trop
            "\u{1F3FD}",            // teinte seule
            "👨\u{200D}",           // ZWJ pendant
            "🏴\u{E0067}\u{E007F}", // drapeau inventé
            "1\u{20E3}",
        ] {
            assert!(!emoji_valide(ko), "{ko:?}");
        }
        // plafond d'octets (64) avant la recherche
        assert!(!emoji_valide(&"👍".repeat(17)));
    }

    #[test]
    fn texte_sans_caractere_visible_refuse() {
        for ko in [
            "   ",
            "\n",
            " \n ",
            "\u{200B}",
            "\u{200E}\u{200F}",
            "\u{200D}",
            " \u{FE0F}",
            "\u{A0}\u{3000}",
            "\u{2060}\u{FEFF}",
            // T8 : marques seules, U+2800 (motif braille vide), marque sur une espace.
            "\u{301}",
            "\u{301}\u{302}\u{20DD}",
            "\u{2800}",
            "\u{2800}\u{2800} \n",
            " \u{301}",
            "\u{A0}\u{20E3}",
            "\u{2800}\u{301}\u{200B}",
            // Marque au sens de la segmentation : teinte de peau, signe voyelle (SpacingMark).
            "\u{1F3FB}",
            "\u{093F}",
        ] {
            assert_eq!(
                nettoyer_texte(ko).unwrap_err(),
                Error::TexteInvalide,
                "{ko:?}"
            );
        }
        assert_eq!(nettoyer_texte(" a ").unwrap(), " a ");
        assert_eq!(nettoyer_texte("\u{200B}a").unwrap(), "\u{200B}a");
        assert!(nettoyer_texte("👨\u{200D}👩").is_ok());
        // Un seul caractère visible suffit, marques et U+2800 autour gardés.
        assert_eq!(nettoyer_texte("a\u{2800}").unwrap(), "a\u{2800}");
        assert_eq!(nettoyer_texte("\u{301}x").unwrap(), "\u{301}x");
        assert_eq!(nettoyer_texte("1\u{20E3}").unwrap(), "1\u{20E3}");
        assert!(nettoyer_texte("\u{1F44B}\u{1F3FB}").is_ok());
        assert!(nettoyer_texte("\u{0915}\u{093F}").is_ok());
    }

    #[test]
    fn texte_etiquettes_cachees() {
        // texte caché dans des caractères « étiquette » : retiré
        let cache = "salut\u{E0068}\u{E0069}\u{E007F}";
        assert_eq!(nettoyer_texte(cache).unwrap(), "salut");
        assert_eq!(
            nettoyer_texte("\u{E0001}\u{E0041}").unwrap_err(),
            Error::TexteInvalide
        );
        // drapeau d'Écosse : séquence complète gardée
        let ecosse = "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";
        assert_eq!(nettoyer_texte(ecosse).unwrap(), ecosse);
        assert_eq!(
            nettoyer_texte(&format!("a{ecosse}b")).unwrap(),
            format!("a{ecosse}b")
        );
        // séquence non terminée, ou sans base : étiquettes retirées
        assert_eq!(nettoyer_texte("🏴\u{E0067}\u{E0062}").unwrap(), "🏴");
        assert_eq!(nettoyer_texte("a\u{E0067}\u{E007F}").unwrap(), "a");
        // étiquettes cachées après un drapeau valide : retirées
        assert_eq!(
            nettoyer_texte(&format!("{ecosse}\u{E0068}")).unwrap(),
            ecosse
        );
        // Angleterre et Pays de Galles : gardés (dans la liste emoji 15.0)
        for sub in ["gbeng", "gbwls"] {
            let d: String = sub
                .chars()
                .map(|c| char::from_u32(0xE0000 + c as u32).unwrap())
                .collect();
            let f = format!("🏴{d}\u{E007F}");
            assert_eq!(nettoyer_texte(&f).unwrap(), f, "{sub}");
        }
        // structure valide mais hors de la liste : étiquettes retirées, le drapeau noir reste
        let tags = |s: &str| -> String {
            s.chars()
                .map(|c| char::from_u32(0xE0000 + c as u32).unwrap())
                .collect()
        };
        assert_eq!(
            nettoyer_texte(&format!("🏴{}\u{E007F}", tags("hello"))).unwrap(),
            "🏴"
        );
        assert_eq!(
            nettoyer_texte(&format!("🏴{}\u{E007F}", tags(&"a".repeat(100)))).unwrap(),
            "🏴"
        );
        assert_eq!(
            nettoyer_texte(&format!("x🏴{}\u{E007F}y", tags("gbxxx"))).unwrap(),
            "x🏴y"
        );
        assert_eq!(
            nettoyer_texte(&format!("🏴{}", tags("gbsct"))).unwrap(),
            "🏴"
        ); // non terminée
        // LRM et RLM restent
        assert_eq!(
            nettoyer_texte("a\u{200E}b\u{200F}").unwrap(),
            "a\u{200E}b\u{200F}"
        );
    }

    #[test]
    fn pseudo_marque_sur_lettre_ou_chiffre() {
        for ko in [
            "a \u{301}b",
            "a-\u{301}b",
            "ab \u{301}",
            "a.\u{301}b",
            "a_\u{301}b",
        ] {
            assert!(verifier_pseudo(ko).is_err(), "{ko:?}");
        }
        assert_eq!(verifier_pseudo("a\u{301}b").unwrap(), "\u{e1}b");
        assert!(verifier_pseudo("Zoe\u{308}").is_ok());
    }
}
