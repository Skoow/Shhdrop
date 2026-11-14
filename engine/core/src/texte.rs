//! Règle du pseudo (spec §39.4 point 4), commune au compte (conception compte v2 §21.5) et au
//! salon (`shhdrop-salon`, qui l'appelle) : une seule copie, pour qu'un pseudo de compte soit
//! toujours accepté dans un salon. Déplacée telle quelle de `engine/salon/src/texte.rs` le
//! 14 novembre ; seule différence : trois erreurs au lieu d'une (`pseudo_longueur`,
//! `pseudo_caracteres`, `pseudo_ecritures`), que le salon ramène à `pseudo_invalide`. Les
//! vecteurs `pseudo` de `salon-v3.json` et de `compte.json` le prouvent.
//!
//! **Affichage** (`pseudo_valide`) : 1. NFC ; 2. retrait des contrôles, des inversions de sens et
//! de tout `Default_Ignorable_Code_Point` (l'apostrophe typographique U+2019 devient `'`) ; 3. NFC ;
//! 4. toute espace Unicode (`White_Space`) devient U+0020, regroupées et rognées ; 5. 2 à 24
//! graphèmes (UAX #29), 8 points de code au plus par graphème (contre l'empilement de marques) ;
//! 6. seulement lettres, chiffres, marques, espace et `- _ . '`, au moins une lettre ou un chiffre,
//! une marque seulement sur une lettre ou un chiffre ; 7. une seule écriture (UAX #24 : intersection
//! des `Script_Extension` de tous les caractères, **plus strict** que le niveau « Highly
//! Restrictive » d'UTS #39 ; seuls Han avec hiragana et katakana, avec bopomofo ou avec hangul sont
//! permis) ; 8. pas d'émoji : blocs de pictogrammes refusés par plages (`est_pictogramme`).
//! Écarts connus : « lettre » = propriété `Alphabetic` et « chiffre » = propriété `Numeric` de la
//! bibliothèque standard ; « marque » = caractère qui se lie au précédent dans la segmentation en
//! graphèmes (UAX #29 : Extend, SpacingMark, ZWJ).
//!
//! **Forme canonique** (`pseudo_canon`, clé d'unicité) : NFKC, minuscules, squelette UTS #39
//! (sosies : « А » cyrillique = « A », « 0 » = « o », « 1 » = « l », « m » = « rn »), minuscules,
//! NFKC, puis seuls restent lettres, chiffres et marques non ASCII.
use crate::error::{Error, Result};
use unicode_normalization::UnicodeNormalization;
use unicode_script::{Script, ScriptExtension, UnicodeScript};
use unicode_security::confusable_detection::skeleton;
use unicode_segmentation::UnicodeSegmentation;

/// Graphèmes d'un pseudo, au moins et au plus.
pub const PSEUDO_MIN: usize = 2;
pub const PSEUDO_MAX: usize = 24;
const PSEUDO_POINTS_PAR_GRAPHEME: usize = 8;
/// Entrée brute au-delà de laquelle un pseudo est refusé sans l'examiner (24 graphèmes).
const PSEUDO_BRUT_MAX: usize = 4096;

/// `Default_Ignorable_Code_Point` (UCD 15.1/16) : largeur nulle, remplissages, sélecteurs de
/// variante, étiquettes, contrôles de format. Partagée avec le salon (texte, noms de fichier).
pub fn est_ignorable(c: char) -> bool {
    matches!(c,
        '\u{00AD}' | '\u{034F}' | '\u{061C}' | '\u{115F}'..='\u{1160}' | '\u{17B4}'..='\u{17B5}'
        | '\u{180B}'..='\u{180F}' | '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}'
        | '\u{2060}'..='\u{206F}' | '\u{3164}' | '\u{FE00}'..='\u{FE0F}' | '\u{FEFF}' | '\u{FFA0}'
        | '\u{FFF0}'..='\u{FFF8}' | '\u{1BCA0}'..='\u{1BCA3}' | '\u{1D173}'..='\u{1D17A}'
        | '\u{E0000}'..='\u{E0FFF}')
}

/// Vrai si `c` se lie au caractère précédent dans un graphème (marque, signe voyelle). Partagée
/// avec le salon.
pub fn se_lie(c: char) -> bool {
    let mut t = String::with_capacity(5);
    t.push('a');
    t.push(c);
    t.graphemes(true).count() == 1
}

/// Blocs de pictogrammes et de caractères entourés, refusés dans un pseudo : symboles divers et
/// dingbats, chiffres et lettres entourés, flèches et symboles ajoutés, CJK entouré, tout le plan
/// U+1F000–U+1FFFF (émojis, drapeaux, cartes, lettres encadrées), teintes de peau, marques
/// enveloppantes (keycap U+20E3).
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
        .map(|c| if c == '\u{2019}' { '\'' } else { c })
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

/// Pseudo nettoyé (affichage), ou `pseudo_longueur` (hors de 2 à 24 graphèmes),
/// `pseudo_caracteres` (caractère refusé, émoji, marque mal placée, aucune lettre ni chiffre) ou
/// `pseudo_ecritures` (plusieurs écritures). Ne dit pas s'il est réservé (`compte::pseudo_reserve`).
pub fn pseudo_valide(s: &str) -> Result<String> {
    if s.len() > PSEUDO_BRUT_MAX {
        return Err(Error::PseudoLongueur);
    }
    let p = pseudo_nettoye(s);
    let n = p.graphemes(true).count();
    if !(PSEUDO_MIN..=PSEUDO_MAX).contains(&n) {
        return Err(Error::PseudoLongueur);
    }
    let mut a_un_signe = false;
    for g in p.graphemes(true) {
        if g.chars().count() > PSEUDO_POINTS_PAR_GRAPHEME {
            return Err(Error::PseudoCaracteres);
        }
        // Une marque doit porter une lettre ou un chiffre (pas une espace, un tiret, un point…).
        if g.chars().count() > 1
            && g.chars()
                .next()
                .is_some_and(|c| !(c.is_alphabetic() || c.is_numeric()))
        {
            return Err(Error::PseudoCaracteres);
        }
        for (i, c) in g.chars().enumerate() {
            if est_pictogramme(c) {
                return Err(Error::PseudoCaracteres);
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
                return Err(Error::PseudoCaracteres);
            }
            a_un_signe |= c.is_alphanumeric();
        }
    }
    if !a_un_signe {
        return Err(Error::PseudoCaracteres);
    }
    if !ecriture_unique(&p) {
        return Err(Error::PseudoEcritures);
    }
    Ok(p)
}

/// Forme canonique (clé d'unicité, `p_canon` du compte) d'un pseudo déjà rendu par
/// [`pseudo_valide`] : voir l'en-tête du module. « Léa », « LÉA » et « lé a » ont la même ;
/// « Léa » et « Lea » non (les marques restent).
pub fn pseudo_canon(pseudo: &str) -> String {
    let bas: String = pseudo.nfkc().collect::<String>().to_lowercase();
    // Squelette UTS #39, puis minuscules de nouveau (le squelette peut redonner des majuscules).
    let sq: String = skeleton(&bas).collect::<String>().to_lowercase();
    sq.nfkc()
        .filter(|&c| c.is_alphanumeric() || (!c.is_whitespace() && !c.is_ascii() && se_lie(c)))
        .collect()
}
