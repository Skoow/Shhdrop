//! Compte v2 sur l'appareil (conception `2026-11-14-compte-email-design.md` §5.1, §6, §21.2.2,
//! §21.5) : normalisation de l'adresse, sel, `A_auth` et `KEK_mdp`, clés des deux coffres et du
//! nom d'appareil, pseudo, règle du mot de passe. Aucune construction nouvelle : Argon2id et
//! HKDF-SHA-256 de `kdf`, SHA-256. Les enveloppes et les coffres (AES-256-GCM) sont faits par
//! le site avec WebCrypto, et par les apps avec RustCrypto ; leur format est prouvé par
//! `engine/vectors/compte.json` (sections `enveloppes`, `coffre_prive`, `coffre_profil`).
use crate::error::{Error, Result};
use crate::kdf::{KDF_CREATE, hkdf, password_key, sha256, trim_password};
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

pub use crate::texte::{PSEUDO_MAX, PSEUDO_MIN, pseudo_canon, pseudo_valide};

/// Clé de 32 octets, effacée à la destruction.
pub type Cle = Zeroizing<[u8; 32]>;

/// Mot de passe du compte, en points de code après rognage et NFC : au moins, au plus.
pub const MDP_MIN: usize = 10;
pub const MDP_MAX: usize = 256;
const ADRESSE_MAX: usize = 254;
const LOCAL_MAX: usize = 64;
const ETIQUETTE_MAX: usize = 63;

/// Pseudos réservés, comparés sur leur forme canonique (`pseudo_canon`) : liste de la conception
/// §21.5, plus les formes accentuées des mots français (« Modérateur » n'a pas la forme
/// canonique de « moderateur » : les marques restent).
pub const PSEUDOS_RESERVES: [&str; 18] = [
    "shhgone",
    "shhdrop",
    "admin",
    "administrateur",
    "moderateur",
    "moderation",
    "support",
    "aide",
    "equipe",
    "officiel",
    "systeme",
    "securite",
    "contact",
    "modérateur",
    "modération",
    "équipe",
    "système",
    "sécurité",
];

/// Adresse normalisée : `canon` (sel, unicité, connexion, bannissement) et `exacte` (envoi).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Adresse {
    pub canon: String,
    pub exacte: String,
}

/// Partie locale : « dot-atom » de la RFC 5322 (lettres, chiffres, ``!#$%&'*+/=?^_`{|}~-``,
/// points ni en bord ni doublés), 1 à 64 caractères.
fn local_valide(l: &str) -> bool {
    let atext = |b: u8| b.is_ascii_alphanumeric() || b"!#$%&'*+/=?^_`{|}~-".contains(&b);
    (1..=LOCAL_MAX).contains(&l.len())
        && l.split('.').all(|a| !a.is_empty() && a.bytes().all(atext))
}

/// Domaine : au moins deux étiquettes de 1 à 63 caractères `[a-z0-9-]` sans tiret en bord, la
/// dernière faite d'au moins deux lettres.
fn domaine_valide(d: &str) -> bool {
    let etiquettes: Vec<&str> = d.split('.').collect();
    let ok = |e: &&str| {
        (1..=ETIQUETTE_MAX).contains(&e.len())
            && e.bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            && !e.starts_with('-')
            && !e.ends_with('-')
    };
    etiquettes.len() >= 2
        && etiquettes.iter().all(ok)
        && etiquettes
            .last()
            .is_some_and(|t| t.len() >= 2 && t.bytes().all(|b| b.is_ascii_lowercase()))
}

/// Conception §5.1 : blancs ASCII de bord retirés (espace, tabulation, retour chariot, saut de
/// ligne, comme le mot de passe, D42-21) ; tout caractère non ASCII → `adresse_non_ascii` ;
/// plus de 254 caractères, caractère hors de U+0021–U+007E, pas exactement un `@`, partie locale
/// ou domaine refusés → `adresse_invalide`. Puis minuscules (`exacte`) ; `canon` : partie locale
/// coupée au premier `+` (vide → refus), `googlemail.com` → `gmail.com`, points retirés pour
/// `gmail.com`.
pub fn normaliser(email: &str) -> Result<Adresse> {
    let t = email.trim_matches([' ', '\t', '\r', '\n']);
    if !t.is_ascii() {
        return Err(Error::AdresseNonAscii);
    }
    if t.len() > ADRESSE_MAX || t.bytes().any(|b| !(0x21..=0x7e).contains(&b)) {
        return Err(Error::AdresseInvalide);
    }
    let exacte = t.to_ascii_lowercase();
    let Some((local, domaine)) = exacte.split_once('@') else {
        return Err(Error::AdresseInvalide);
    };
    if domaine.contains('@') || !local_valide(local) || !domaine_valide(domaine) {
        return Err(Error::AdresseInvalide);
    }
    let base = local.split('+').next().unwrap_or_default();
    let domaine = if domaine == "googlemail.com" {
        "gmail.com"
    } else {
        domaine
    };
    let base = if domaine == "gmail.com" {
        base.replace('.', "")
    } else {
        base.to_string()
    };
    if base.is_empty() {
        return Err(Error::AdresseInvalide);
    }
    let canon = format!("{base}@{domaine}");
    Ok(Adresse { canon, exacte })
}

/// `sel` = SHA-256(« shhdrop/v2/compte/sel » ‖ 0x00 ‖ `canon`)[0..16].
pub fn sel(canon: &str) -> [u8; 16] {
    let mut m = Vec::with_capacity(22 + canon.len());
    m.extend_from_slice(b"shhdrop/v2/compte/sel\0");
    m.extend_from_slice(canon.as_bytes());
    let h = sha256(&m);
    let mut out = [0u8; 16];
    out.copy_from_slice(&h[..16]);
    out
}

/// (`A_auth`, `KEK_mdp`) : `M` = Argon2id(mot de passe rogné puis NFC, `sel(canon)`, 64 Mio,
/// 3 passes, 1 fil, 32 octets), puis HKDF-SHA-256 à sel vide sous « shhdrop/v2/compte/auth »
/// et « shhdrop/v2/compte/enveloppe-mdp ». `M` est effacé ; refus : `mot_de_passe_vide`.
/// Aucune règle de force ici (`mot_de_passe_valide`, à l'inscription et au changement).
pub fn deriver(mdp: &str, canon: &str) -> Result<(Cle, Cle)> {
    let m = password_key(mdp, &sel(canon), KDF_CREATE.ops, KDF_CREATE.mem)?;
    Ok((
        hkdf::<32>(m.as_bytes(), "shhdrop/v2/compte/auth"),
        hkdf::<32>(m.as_bytes(), "shhdrop/v2/compte/enveloppe-mdp"),
    ))
}

/// `K_prive` = HKDF(`K_compte`, « shhdrop/v2/compte/blob ») : clé du coffre privé « SHH-ACCT1 ».
pub fn cle_prive(k_compte: &[u8; 32]) -> Cle {
    hkdf::<32>(k_compte, "shhdrop/v2/compte/blob")
}

/// `K_profil` = HKDF(`s_profil`, « shhdrop/v2/compte/profil ») : clé du coffre de profil
/// « SHH-PROF1 » (séquestré : le serveur garde `s_profil` chiffré, décision R-D1).
pub fn cle_profil(s_profil: &[u8; 32]) -> Cle {
    hkdf::<32>(s_profil, "shhdrop/v2/compte/profil")
}

/// `K_etiquette` = HKDF(`K_compte`, « shhdrop/v2/compte/appareil ») : nom d'appareil d'une session.
pub fn cle_appareil(k_compte: &[u8; 32]) -> Cle {
    hkdf::<32>(k_compte, "shhdrop/v2/compte/appareil")
}

/// Vrai si la forme canonique `canon` est celle d'un pseudo réservé.
pub fn pseudo_reserve(canon: &str) -> bool {
    PSEUDOS_RESERVES.iter().any(|w| pseudo_canon(w) == canon)
}

/// Mot de passe d'un nouveau compte (conception §6) : rogné puis NFC comme pour `deriver`, 10 à
/// 256 points de code (`mdp_court`, `mdp_long`), et, en minuscules, différent de l'adresse
/// exacte, de l'adresse canonique et de leurs parties locales (`mdp_adresse`).
pub fn mot_de_passe_valide(mdp: &str, adresse: &Adresse) -> Result<()> {
    let t = trim_password(mdp);
    let mut nfc = Zeroizing::new(String::with_capacity(t.len().saturating_mul(3)));
    nfc.extend(t.nfc());
    let n = nfc.chars().count();
    if n < MDP_MIN {
        return Err(Error::MdpCourt);
    }
    if n > MDP_MAX {
        return Err(Error::MdpLong);
    }
    let bas = Zeroizing::new(nfc.to_lowercase());
    let local = |a: &str| a.split_once('@').map(|(l, _)| l.to_string());
    let interdits = [
        Some(adresse.exacte.clone()),
        local(&adresse.exacte),
        Some(adresse.canon.clone()),
        local(&adresse.canon),
    ];
    if interdits.iter().flatten().any(|x| *x == *bas) {
        return Err(Error::MdpAdresse);
    }
    Ok(())
}
