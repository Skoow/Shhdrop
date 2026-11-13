//! Formats des messages du salon (spec salon v3 §4.1) : JSON strict, clés exactes, dans la
//! charge utile d'une trame (l'encodeur : `JSON_MAX` = 3 900 octets au plus ; le décodeur lit jusqu'à `MAX_CHARGE` = 4 093).
//!
//! `{"v":3,"id":<b64u 22>,"t":<ms>,"e":<0..3>,"k":"<sorte>", …champs}`. Sorte `rotation`
//! (13 novembre) : `"n":<u32>,"cle":<b64u 43>` (`K_maître_s'`, secrète comme une graine). Pas de champ en trop,
//! manquant ni de mauvais type pour une sorte connue (`message_invalide`) ; une sorte inconnue
//! (appels futurs, autres versions) devient `Message::Inconnu` et ses champs sont ignorés.
//! Les entiers sont des entiers JSON (`1.0` est refusé) d'au plus 2^53 − 1. Les champs optionnels
//! (`duree_ms`, `avatar`) sont toujours présents, `null` si absents. Une clé répétée, à tout niveau,
//! est refusée.
//!
//! Les textes, le pseudonyme et le nom doivent **déjà** être sous leur forme nettoyée
//! (`nettoyer_texte`, `verifier_pseudo`, `nettoyer_nom`) : ni l'encodeur ni le décodeur ne
//! corrigent en silence, ils refusent (`message_invalide`). Ainsi tout moteur qui lit un message
//! obtient exactement ce que l'expéditeur a affiché.
//!
//! La graine `R` d'une pièce vit dans une `Graine` (effacée à la destruction) ; l'encodeur écrit
//! dans un tampon de taille fixe, sans réallocation, effacé à la destruction ; le décodeur
//! efface l'arbre JSON lu avant de le libérer. Les copies faites par `serde_json` pendant la
//! lecture et la mémoire de l'appelant (`octets`) ne sont pas couvertes.
use crate::error::{Error, Result};
use crate::texte::{emoji_valide, nettoyer_nom, nettoyer_texte, verifier_pseudo};
use crate::trame::{MAX_CHARGE, Regle};
use serde_json::{Map, Value};
use shhdrop_core::encoding::{b64u, unb64u};
use shhdrop_core::format::{BUCKETS, MAX_SAFE};
use std::io::Write;
use zeroize::{Zeroize, Zeroizing};

const VERSION: u64 = 3;
const IDS_MAX: usize = 50;
const COULEUR_MAX: u8 = 9;
const PALIER_MAX: u32 = 8000;
const MIME_MAX: usize = 100;
const SORTE_MAX: usize = 32;
/// Borne dure de l'encodeur : le JSON fait 3 900 octets au plus (la charge utile d'une trame est
/// de 4 093 ; MLS ajoute environ 146 octets, mesurés en essai). L'échappement JSON peut doubler un
/// texte (`"`, `\\` et les sauts de ligne), donc un texte de 2 000 guillemets est refusé.
pub const JSON_MAX: usize = 3900;
const _: () = assert!(JSON_MAX < MAX_CHARGE);

pub type IdMessage = [u8; 16];

/// Graine `R` d'une pièce (32 octets) : effacée à la destruction, jamais affichée par `Debug`.
#[derive(Clone)]
pub struct Graine(Zeroizing<[u8; 32]>);

impl Graine {
    pub fn new(octets: [u8; 32]) -> Self {
        Graine(Zeroizing::new(octets))
    }
    /// Graine remplie en place par `f` (aucune copie intermédiaire du secret faite par
    /// l'appelant, contrairement à `new`). Les déplacements de la valeur restent des copies
    /// mémoire que Rust ne permet pas d'effacer.
    pub fn remplir(f: impl FnOnce(&mut [u8; 32])) -> Self {
        let mut g = Graine(Zeroizing::new([0u8; 32]));
        f(&mut g.0);
        g
    }
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl core::fmt::Debug for Graine {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("Graine(..)")
    }
}

impl PartialEq for Graine {
    fn eq(&self, other: &Self) -> bool {
        self.0
            .iter()
            .zip(other.0.iter())
            .fold(0u8, |a, (x, y)| a | (x ^ y))
            == 0
    }
}
impl Eq for Graine {}

/// Référence à une pièce stockée chez le serveur (avatar).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefPiece {
    pub r: Graine,
    pub piece: [u8; 16],
    pub palier: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortePiece {
    Fichier,
    Image,
    Video,
    Vocal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Message {
    Texte {
        x: String,
    },
    Piece {
        r: Graine,
        piece: [u8; 16],
        palier: u32,
        nom: String,
        mime: String,
        taille: u64,
        sorte: SortePiece,
        duree_ms: Option<u32>,
    },
    Reaction {
        cible: IdMessage,
        emoji: String,
    },
    Reponse {
        cible: IdMessage,
        x: String,
    },
    Modif {
        cible: IdMessage,
        x: String,
    },
    Retrait {
        cible: IdMessage,
    },
    Ecrit,
    Recu {
        ids: Vec<IdMessage>,
    },
    Vu {
        ids: Vec<IdMessage>,
    },
    Regle {
        regle: Regle,
    },
    Profil {
        pseudo: String,
        couleur: u8,
        avatar: Option<RefPiece>,
    },
    Depart,
    /// Rotation de l'invitation (spec §39.13.2, salon v3 §15, amendement du 13 novembre) : le
    /// créateur donne aux membres restants `K_maître_s'` (`cle`) et le numéro de rotation `n`
    /// (celui du `0x09` du serveur). Jamais le lien, `K_lien'` ni le mot de passe. Le groupe
    /// (`groupe.rs`) ne l'envoie et ne l'accepte que du créateur, à l'époque courante, sans
    /// siège parti ou exclu dans l'arbre (`rotation_refusee` sinon).
    Rotation {
        n: u32,
        cle: Graine,
    },
    /// Sorte inconnue de ce moteur (appels futurs, autres versions) : ignorée, jamais une erreur.
    Inconnu {
        sorte: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Enveloppe {
    pub id: IdMessage,
    pub heure_ms: u64,
    pub regle: Regle,
    pub message: Message,
}

fn palier_valide(p: u32) -> bool {
    p <= PALIER_MAX && BUCKETS.contains(&p)
}

fn mime_valide(m: &str) -> bool {
    !m.is_empty() && m.len() <= MIME_MAX && m.bytes().all(|b| (0x21..=0x7E).contains(&b))
}

fn propre(s: &str, f: impl Fn(&str) -> Result<String>) -> Result<()> {
    match f(s) {
        Ok(p) if p == s => Ok(()),
        _ => Err(Error::MessageInvalide),
    }
}

fn verifier(e: &Enveloppe) -> Result<()> {
    if e.heure_ms > MAX_SAFE {
        return Err(Error::MessageInvalide);
    }
    let texte = |s: &str| propre(s, nettoyer_texte);
    match &e.message {
        Message::Texte { x } | Message::Modif { x, .. } | Message::Reponse { x, .. } => texte(x),
        Message::Piece {
            palier,
            nom,
            mime,
            taille,
            ..
        } => {
            if !palier_valide(*palier) || !mime_valide(mime) || *taille > MAX_SAFE {
                return Err(Error::MessageInvalide);
            }
            if nettoyer_nom(nom) != *nom {
                return Err(Error::MessageInvalide);
            }
            Ok(())
        }
        Message::Reaction { emoji, .. } => {
            if emoji_valide(emoji) {
                Ok(())
            } else {
                Err(Error::MessageInvalide)
            }
        }
        Message::Recu { ids } | Message::Vu { ids } => {
            if (1..=IDS_MAX).contains(&ids.len()) {
                Ok(())
            } else {
                Err(Error::MessageInvalide)
            }
        }
        Message::Profil {
            pseudo,
            couleur,
            avatar,
        } => {
            if *couleur > COULEUR_MAX || avatar.as_ref().is_some_and(|a| !palier_valide(a.palier)) {
                return Err(Error::MessageInvalide);
            }
            match verifier_pseudo(pseudo) {
                Ok(p) if p == *pseudo => Ok(()),
                _ => Err(Error::MessageInvalide),
            }
        }
        Message::Retrait { .. }
        | Message::Ecrit
        | Message::Regle { .. }
        | Message::Depart
        | Message::Rotation { .. } => Ok(()),
        // Ses champs sont perdus : impossible à ré-émettre.
        Message::Inconnu { .. } => Err(Error::MessageInvalide),
    }
}

impl SortePiece {
    const fn nom(self) -> &'static str {
        match self {
            SortePiece::Fichier => "fichier",
            SortePiece::Image => "image",
            SortePiece::Video => "video",
            SortePiece::Vocal => "vocal",
        }
    }

    fn depuis_nom(s: &str) -> Option<Self> {
        [
            SortePiece::Fichier,
            SortePiece::Image,
            SortePiece::Video,
            SortePiece::Vocal,
        ]
        .into_iter()
        .find(|k| k.nom() == s)
    }
}

/// Tampon de taille fixe (alloué une fois : aucune copie non effacée par réallocation).
struct Plafond(Zeroizing<Vec<u8>>);

impl Write for Plafond {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if self.0.len() + buf.len() > JSON_MAX {
            return Err(std::io::ErrorKind::OutOfMemory.into());
        }
        self.0.extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn chaine(w: &mut Plafond, s: &str) -> std::io::Result<()> {
    serde_json::to_writer(w, s).map_err(std::io::Error::from)
}

fn cle_id(w: &mut Plafond, cle: &str, id: &[u8]) -> std::io::Result<()> {
    write!(w, ",\"{cle}\":\"{}\"", b64u(id))
}

fn cle_texte(w: &mut Plafond, cle: &str, s: &str) -> std::io::Result<()> {
    write!(w, ",\"{cle}\":")?;
    chaine(w, s)
}

fn cle_graine(w: &mut Plafond, cle: &str, r: &Graine) -> std::io::Result<()> {
    let b = Zeroizing::new(b64u(r.as_bytes()));
    write!(w, ",\"{cle}\":\"{}\"", b.as_str())
}

fn ids(w: &mut Plafond, ids: &[IdMessage]) -> std::io::Result<()> {
    w.write_all(b",\"ids\":[")?;
    for (i, id) in ids.iter().enumerate() {
        write!(w, "{}\"{}\"", if i == 0 { "" } else { "," }, b64u(id))?;
    }
    w.write_all(b"]")
}

fn ecrire(w: &mut Plafond, e: &Enveloppe) -> std::io::Result<()> {
    write!(
        w,
        "{{\"v\":{VERSION},\"id\":\"{}\",\"t\":{},\"e\":{}",
        b64u(&e.id),
        e.heure_ms,
        e.regle as u8
    )?;
    let k = |w: &mut Plafond, k: &str| write!(w, ",\"k\":\"{k}\"");
    match &e.message {
        Message::Texte { x } => {
            k(w, "texte")?;
            cle_texte(w, "x", x)?;
        }
        Message::Piece {
            r,
            piece,
            palier,
            nom,
            mime,
            taille,
            sorte,
            duree_ms,
        } => {
            k(w, "piece")?;
            cle_graine(w, "r", r)?;
            cle_id(w, "piece", piece)?;
            write!(w, ",\"palier\":{palier}")?;
            cle_texte(w, "nom", nom)?;
            cle_texte(w, "mime", mime)?;
            write!(
                w,
                ",\"taille\":{taille},\"sorte\":\"{}\",\"duree_ms\":",
                sorte.nom()
            )?;
            match duree_ms {
                Some(d) => write!(w, "{d}")?,
                None => w.write_all(b"null")?,
            }
        }
        Message::Reaction { cible, emoji } => {
            k(w, "reaction")?;
            cle_id(w, "cible", cible)?;
            cle_texte(w, "emoji", emoji)?;
        }
        Message::Reponse { cible, x } => {
            k(w, "reponse")?;
            cle_id(w, "cible", cible)?;
            cle_texte(w, "x", x)?;
        }
        Message::Modif { cible, x } => {
            k(w, "modif")?;
            cle_id(w, "cible", cible)?;
            cle_texte(w, "x", x)?;
        }
        Message::Retrait { cible } => {
            k(w, "retrait")?;
            cle_id(w, "cible", cible)?;
        }
        Message::Ecrit => k(w, "ecrit")?,
        Message::Recu { ids: i } => {
            k(w, "recu")?;
            ids(w, i)?;
        }
        Message::Vu { ids: i } => {
            k(w, "vu")?;
            ids(w, i)?;
        }
        Message::Regle { regle } => {
            k(w, "regle")?;
            write!(w, ",\"regle\":{}", *regle as u8)?;
        }
        Message::Profil {
            pseudo,
            couleur,
            avatar,
        } => {
            k(w, "profil")?;
            cle_texte(w, "pseudo", pseudo)?;
            write!(w, ",\"couleur\":{couleur},\"avatar\":")?;
            match avatar {
                None => w.write_all(b"null")?,
                Some(a) => {
                    w.write_all(b"{")?;
                    let b = Zeroizing::new(b64u(a.r.as_bytes()));
                    write!(
                        w,
                        "\"r\":\"{}\",\"piece\":\"{}\",\"palier\":{}}}",
                        b.as_str(),
                        b64u(&a.piece),
                        a.palier
                    )?;
                }
            }
        }
        Message::Depart => k(w, "depart")?,
        Message::Rotation { n, cle } => {
            k(w, "rotation")?;
            write!(w, ",\"n\":{n}")?;
            cle_graine(w, "cle", cle)?;
        }
        Message::Inconnu { .. } => return Err(std::io::ErrorKind::InvalidInput.into()),
    }
    w.write_all(b"}")
}

/// Charge utile d'une trame. `message_invalide` si un champ sort des règles (y compris un texte
/// non nettoyé ou une sorte `Inconnu`), `trop_grand` si le JSON dépasse `JSON_MAX` (3 900) octets.
pub fn encoder(e: &Enveloppe) -> Result<Zeroizing<Vec<u8>>> {
    verifier(e)?;
    let mut w = Plafond(Zeroizing::new(Vec::with_capacity(JSON_MAX)));
    ecrire(&mut w, e).map_err(|_| Error::TropGrand)?;
    Ok(w.0)
}

fn invalide<T>() -> Result<T> {
    Err(Error::MessageInvalide)
}

/// `Value` lue sans clé répétée (à tout niveau) : une clé répétée est une erreur.
struct Strict(Value);

impl<'de> serde::Deserialize<'de> for Strict {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> core::result::Result<Self, D::Error> {
        use serde::de::{self, MapAccess, SeqAccess, Visitor};
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Strict;
            fn expecting(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
                f.write_str("une valeur JSON")
            }
            fn visit_bool<E>(self, b: bool) -> core::result::Result<Strict, E> {
                Ok(Strict(Value::Bool(b)))
            }
            fn visit_i64<E>(self, n: i64) -> core::result::Result<Strict, E> {
                Ok(Strict(Value::from(n)))
            }
            fn visit_u64<E>(self, n: u64) -> core::result::Result<Strict, E> {
                Ok(Strict(Value::from(n)))
            }
            fn visit_f64<E: de::Error>(self, n: f64) -> core::result::Result<Strict, E> {
                serde_json::Number::from_f64(n)
                    .map(|n| Strict(Value::Number(n)))
                    .ok_or_else(|| E::custom("nombre"))
            }
            fn visit_str<E>(self, s: &str) -> core::result::Result<Strict, E> {
                Ok(Strict(Value::String(s.to_owned())))
            }
            fn visit_string<E>(self, s: String) -> core::result::Result<Strict, E> {
                Ok(Strict(Value::String(s)))
            }
            fn visit_unit<E>(self) -> core::result::Result<Strict, E> {
                Ok(Strict(Value::Null))
            }
            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut a: A,
            ) -> core::result::Result<Strict, A::Error> {
                let mut v = Vec::new();
                while let Some(Strict(x)) = a.next_element()? {
                    v.push(x);
                }
                Ok(Strict(Value::Array(v)))
            }
            fn visit_map<A: MapAccess<'de>>(
                self,
                mut a: A,
            ) -> core::result::Result<Strict, A::Error> {
                let mut m = Map::new();
                while let Some(k) = a.next_key::<String>()? {
                    if m.contains_key(&k) {
                        return Err(de::Error::custom("clé répétée"));
                    }
                    let Strict(x) = a.next_value()?;
                    m.insert(k, x);
                }
                Ok(Strict(Value::Object(m)))
            }
        }
        d.deserialize_any(V)
    }
}

fn effacer(v: &mut Value) {
    match v {
        Value::String(s) => s.zeroize(),
        Value::Array(a) => a.iter_mut().for_each(effacer),
        Value::Object(o) => o.values_mut().for_each(effacer),
        _ => {}
    }
}

fn prendre(o: &mut Map<String, Value>, cle: &str) -> Result<Value> {
    o.remove(cle).map_or_else(invalide, Ok)
}

fn texte(o: &mut Map<String, Value>, cle: &str) -> Result<String> {
    match prendre(o, cle)? {
        Value::String(s) => Ok(s),
        _ => invalide(),
    }
}

fn entier(o: &mut Map<String, Value>, cle: &str) -> Result<u64> {
    prendre(o, cle)?.as_u64().map_or_else(invalide, Ok)
}

fn entier_borne(o: &mut Map<String, Value>, cle: &str) -> Result<u64> {
    let n = entier(o, cle)?;
    if n > MAX_SAFE { invalide() } else { Ok(n) }
}

fn id_depuis(s: &str) -> Result<IdMessage> {
    if s.len() != 22 {
        return invalide();
    }
    unb64u(s)
        .ok()
        .and_then(|v| v.try_into().ok())
        .map_or_else(invalide, Ok)
}

fn id(o: &mut Map<String, Value>, cle: &str) -> Result<IdMessage> {
    id_depuis(&texte(o, cle)?)
}

fn graine(o: &mut Map<String, Value>, cle: &str) -> Result<Graine> {
    let s = Zeroizing::new(texte(o, cle)?);
    if s.len() != 43 {
        return invalide();
    }
    let v = Zeroizing::new(unb64u(&s).map_err(|_| Error::MessageInvalide)?);
    let mut a = [0u8; 32];
    if v.len() != 32 {
        return invalide();
    }
    a.copy_from_slice(&v);
    let g = Graine::new(a);
    a.zeroize();
    Ok(g)
}

fn u32_de(o: &mut Map<String, Value>, cle: &str) -> Result<u32> {
    u32::try_from(entier(o, cle)?).map_or_else(|_| invalide(), Ok)
}

fn sans_reste(o: &Map<String, Value>) -> Result<()> {
    if o.is_empty() { Ok(()) } else { invalide() }
}

fn avatar(o: &mut Map<String, Value>) -> Result<Option<RefPiece>> {
    match prendre(o, "avatar")? {
        Value::Null => Ok(None),
        Value::Object(mut a) => {
            let r = RefPiece {
                r: graine(&mut a, "r")?,
                piece: id(&mut a, "piece")?,
                palier: u32_de(&mut a, "palier")?,
            };
            sans_reste(&a)?;
            Ok(Some(r))
        }
        _ => invalide(),
    }
}

fn liste_ids(o: &mut Map<String, Value>) -> Result<Vec<IdMessage>> {
    let Value::Array(a) = prendre(o, "ids")? else {
        return invalide();
    };
    if !(1..=IDS_MAX).contains(&a.len()) {
        return invalide();
    }
    a.iter()
        .map(|v| v.as_str().map_or_else(invalide, id_depuis))
        .collect()
}

fn regle_depuis(n: u64) -> Result<Regle> {
    Ok(match n {
        0 => Regle::Desactive,
        1 => Regle::UneMinute,
        2 => Regle::CinqMinutes,
        3 => Regle::UneHeure,
        _ => return invalide(),
    })
}

fn message(sorte: &str, o: &mut Map<String, Value>) -> Result<Message> {
    let m = match sorte {
        "texte" => Message::Texte { x: texte(o, "x")? },
        "piece" => Message::Piece {
            r: graine(o, "r")?,
            piece: id(o, "piece")?,
            palier: u32_de(o, "palier")?,
            nom: texte(o, "nom")?,
            mime: texte(o, "mime")?,
            taille: entier_borne(o, "taille")?,
            sorte: SortePiece::depuis_nom(&texte(o, "sorte")?).map_or_else(invalide, Ok)?,
            duree_ms: match prendre(o, "duree_ms")? {
                Value::Null => None,
                v => Some(
                    v.as_u64()
                        .and_then(|n| u32::try_from(n).ok())
                        .map_or_else(invalide, Ok)?,
                ),
            },
        },
        "reaction" => Message::Reaction {
            cible: id(o, "cible")?,
            emoji: texte(o, "emoji")?,
        },
        "reponse" => Message::Reponse {
            cible: id(o, "cible")?,
            x: texte(o, "x")?,
        },
        "modif" => Message::Modif {
            cible: id(o, "cible")?,
            x: texte(o, "x")?,
        },
        "retrait" => Message::Retrait {
            cible: id(o, "cible")?,
        },
        "ecrit" => Message::Ecrit,
        "recu" => Message::Recu { ids: liste_ids(o)? },
        "vu" => Message::Vu { ids: liste_ids(o)? },
        "regle" => Message::Regle {
            regle: regle_depuis(entier(o, "regle")?)?,
        },
        "profil" => Message::Profil {
            pseudo: texte(o, "pseudo")?,
            couleur: u8::try_from(entier(o, "couleur")?).map_or_else(|_| invalide(), Ok)?,
            avatar: avatar(o)?,
        },
        "depart" => Message::Depart,
        "rotation" => Message::Rotation {
            n: u32_de(o, "n")?,
            cle: graine(o, "cle")?,
        },
        autre => {
            let ok = (1..=SORTE_MAX).contains(&autre.len())
                && autre
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
            if !ok {
                return invalide();
            }
            return Ok(Message::Inconnu {
                sorte: autre.to_string(),
            });
        }
    };
    sans_reste(o)?;
    Ok(m)
}

fn lire(o: &mut Map<String, Value>) -> Result<Enveloppe> {
    if entier(o, "v")? != VERSION {
        return invalide();
    }
    let id = id(o, "id")?;
    let heure_ms = entier_borne(o, "t")?;
    let regle = regle_depuis(entier(o, "e")?)?;
    let sorte = texte(o, "k")?;
    let message = message(&sorte, o)?;
    let e = Enveloppe {
        id,
        heure_ms,
        regle,
        message,
    };
    if !matches!(e.message, Message::Inconnu { .. }) {
        verifier(&e)?;
    }
    Ok(e)
}

/// Lit une charge utile de trame. Toute erreur est `message_invalide` (JSON illisible ou non
/// UTF-8, plus de `MAX_CHARGE` octets, champ hors des règles) ; une sorte inconnue n'en est pas une.
pub fn decoder(octets: &[u8]) -> Result<Enveloppe> {
    if octets.len() > MAX_CHARGE {
        return invalide();
    }
    let Ok(Strict(Value::Object(mut o))) = serde_json::from_slice::<Strict>(octets) else {
        return invalide();
    };
    let r = lire(&mut o);
    o.values_mut().for_each(effacer);
    r
}

/// Identifiant aléatoire d'un nouveau message (16 octets, getrandom : aléa du système ;
/// `crypto.getRandomValues` dans le navigateur).
pub fn nouvel_id() -> Result<IdMessage> {
    let mut id = [0u8; 16];
    getrandom::fill(&mut id).map_err(|_| Error::MlsInterne)?;
    Ok(id)
}

/// Messages qui ne se rangent pas dans l'historique : « écrit… », accusés de réception et de lecture.
pub fn est_volatile(m: &Message) -> bool {
    matches!(
        m,
        Message::Ecrit | Message::Recu { .. } | Message::Vu { .. }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graine_remplie_en_place() {
        assert_eq!(Graine::remplir(|g| g.fill(7)), Graine::new([7; 32]));
        assert_eq!(*Graine::remplir(|g| g[31] = 1).as_bytes(), {
            let mut a = [0u8; 32];
            a[31] = 1;
            a
        });
    }

    fn env(message: Message) -> Enveloppe {
        Enveloppe {
            id: [7; 16],
            heure_ms: 1_700_000_000_000,
            regle: Regle::Desactive,
            message,
        }
    }

    fn piece(sorte: SortePiece, duree_ms: Option<u32>) -> Message {
        Message::Piece {
            r: Graine::new([9; 32]),
            piece: [3; 16],
            palier: 80,
            nom: "photo.png".into(),
            mime: "image/png".into(),
            taille: 12_345,
            sorte,
            duree_ms,
        }
    }

    fn tous() -> Vec<Message> {
        vec![
            Message::Texte {
                x: "Bonjour\nmonde 👋".into(),
            },
            piece(SortePiece::Image, None),
            piece(SortePiece::Vocal, Some(61_000)),
            piece(SortePiece::Fichier, None),
            piece(SortePiece::Video, Some(5)),
            Message::Reaction {
                cible: [1; 16],
                emoji: "👍🏽".into(),
            },
            Message::Reponse {
                cible: [2; 16],
                x: "Salut".into(),
            },
            Message::Modif {
                cible: [4; 16],
                x: "corrigé".into(),
            },
            Message::Retrait { cible: [5; 16] },
            Message::Ecrit,
            Message::Recu { ids: vec![[6; 16]] },
            Message::Vu {
                ids: (0..50u8).map(|i| [i; 16]).collect(),
            },
            Message::Regle {
                regle: Regle::CinqMinutes,
            },
            Message::Profil {
                pseudo: "Léa".into(),
                couleur: 9,
                avatar: None,
            },
            Message::Profil {
                pseudo: "Léa".into(),
                couleur: 0,
                avatar: Some(RefPiece {
                    r: Graine::new([8; 32]),
                    piece: [2; 16],
                    palier: 8000,
                }),
            },
            Message::Depart,
        ]
    }

    fn json(e: &Enveloppe) -> serde_json::Value {
        serde_json::from_slice(&encoder(e).unwrap()).unwrap()
    }

    #[test]
    fn aller_retour_par_sorte() {
        for (i, m) in tous().into_iter().enumerate() {
            for regle in [
                Regle::Desactive,
                Regle::UneMinute,
                Regle::CinqMinutes,
                Regle::UneHeure,
            ] {
                let e = Enveloppe {
                    id: [i as u8; 16],
                    heure_ms: 42 + i as u64,
                    regle,
                    message: m.clone(),
                };
                let octets = encoder(&e).unwrap();
                assert!(octets.len() <= crate::MAX_CHARGE);
                assert_eq!(decoder(&octets).unwrap(), e, "{m:?}");
            }
        }
    }

    #[test]
    fn json_exact() {
        let o = encoder(&env(Message::Texte { x: "salut".into() })).unwrap();
        assert_eq!(
            std::str::from_utf8(&o).unwrap(),
            r#"{"v":3,"id":"BwcHBwcHBwcHBwcHBwcHBw","t":1700000000000,"e":0,"k":"texte","x":"salut"}"#
        );
        let o = encoder(&env(Message::Ecrit)).unwrap();
        assert_eq!(
            std::str::from_utf8(&o).unwrap(),
            r#"{"v":3,"id":"BwcHBwcHBwcHBwcHBwcHBw","t":1700000000000,"e":0,"k":"ecrit"}"#
        );
        let v = json(&env(piece(SortePiece::Vocal, Some(7))));
        assert_eq!(v["r"].as_str().unwrap().len(), 43);
        assert_eq!(v["piece"].as_str().unwrap().len(), 22);
        assert_eq!(v["sorte"], "vocal");
        assert_eq!(v["duree_ms"], 7);
        assert!(json(&env(piece(SortePiece::Image, None)))["duree_ms"].is_null());
        assert_eq!(
            json(&env(Message::Regle {
                regle: Regle::UneHeure
            }))["regle"],
            3
        );
    }

    #[test]
    fn sorte_inconnue_toleree() {
        let j = br#"{"v":3,"id":"BwcHBwcHBwcHBwcHBwcHBw","t":5,"e":1,"k":"appel_invite","sdp":{"a":[1,2]},"x":null}"#;
        let e = decoder(j).unwrap();
        assert_eq!(
            e.message,
            Message::Inconnu {
                sorte: "appel_invite".into()
            }
        );
        assert_eq!(e.regle, Regle::UneMinute);
        // l'enveloppe reste vérifiée même pour une sorte inconnue
        for ko in [
            &br#"{"v":3,"id":"BwcHBwcHBwcHBwcHBwcHBw","t":5,"k":"appel_invite"}"#[..],
            br#"{"v":4,"id":"BwcHBwcHBwcHBwcHBwcHBw","t":5,"e":0,"k":"appel_invite"}"#,
            br#"{"v":3,"id":"BwcHBwcHBwcHBwcHBwcHBw","t":5,"e":0,"k":"Appel Invite"}"#,
            br#"{"v":3,"id":"BwcHBwcHBwcHBwcHBwcHBw","t":5,"e":0,"k":""}"#,
            br#"{"v":3,"id":"BwcHBwcHBwcHBwcHBwcHBw","t":5,"e":0,"k":7}"#,
        ] {
            assert_eq!(
                decoder(ko).unwrap_err(),
                Error::MessageInvalide,
                "{}",
                String::from_utf8_lossy(ko)
            );
        }
        // une sorte inconnue ne se ré-encode pas
        assert_eq!(
            encoder(&env(Message::Inconnu {
                sorte: "texte".into()
            }))
            .unwrap_err(),
            Error::MessageInvalide
        );
    }

    const T: &str = r#""v":3,"id":"BwcHBwcHBwcHBwcHBwcHBw","t":5,"e":0"#;

    fn refuse(corps: &str) {
        let j = format!("{{{T},{corps}}}");
        assert_eq!(
            decoder(j.as_bytes()).unwrap_err(),
            Error::MessageInvalide,
            "{j}"
        );
    }

    fn accepte(corps: &str) -> Message {
        let j = format!("{{{T},{corps}}}");
        decoder(j.as_bytes())
            .unwrap_or_else(|e| panic!("{j} : {e}"))
            .message
    }

    #[test]
    fn champ_en_trop_refuse() {
        refuse(r#""k":"texte","x":"a","y":1"#);
        refuse(r#""k":"ecrit","x":"a""#);
        refuse(r#""k":"depart","extra":null"#);
        refuse(r#""k":"retrait","cible":"BwcHBwcHBwcHBwcHBwcHBw","x":"a""#);
    }

    #[test]
    fn champ_manquant_ou_mal_type_refuse() {
        refuse(r#""k":"texte""#);
        refuse(r#""k":"texte","x":5"#);
        refuse(r#""k":"texte","x":null"#);
        refuse(r#""k":"retrait""#);
        refuse(r#""k":"retrait","cible":"court""#);
        refuse(r#""k":"retrait","cible":"BwcHBwcHBwcHBwcHBwcHBw==""#);
        refuse(r#""k":"retrait","cible":"BwcHBwcHBwcHBwcHBwcHBx""#); // bits de bourrage non nuls
        refuse(r#""k":"reaction","cible":"BwcHBwcHBwcHBwcHBwcHBw""#);
        refuse(r#""k":"profil","pseudo":"Léa","couleur":1"#);
        refuse(r#""k":"profil","pseudo":"Léa","couleur":1.0,"avatar":null"#);
        refuse(r#""k":"profil","pseudo":"Léa","couleur":"1","avatar":null"#);
        refuse(r#""k":"regle","regle":4"#);
        refuse(r#""k":"regle","regle":-1"#);
        refuse(r#""k":"regle","regle":"1""#);
        for ko in [
            r#"{"v":3,"id":"BwcHBwcHBwcHBwcHBwcHBw","e":0,"k":"ecrit"}"#,
            r#"{"v":"3","id":"BwcHBwcHBwcHBwcHBwcHBw","t":5,"e":0,"k":"ecrit"}"#,
            r#"{"v":3,"id":"BwcHBwcHBwcHBwcHBwcHBw","t":-1,"e":0,"k":"ecrit"}"#,
            r#"{"v":3,"id":"BwcHBwcHBwcHBwcHBwcHBw","t":1.5,"e":0,"k":"ecrit"}"#,
            r#"{"v":3,"id":"BwcHBwcHBwcHBwcHBwcHBw","t":9007199254740992,"e":0,"k":"ecrit"}"#,
            r#"{"v":3,"id":"BwcHBwcHBwcHBwcHBwcHBw","t":5,"e":4,"k":"ecrit"}"#,
            r#"[]"#,
            r#"null"#,
            r#""texte""#,
            r#"{}"#,
            "",
        ] {
            assert_eq!(
                decoder(ko.as_bytes()).unwrap_err(),
                Error::MessageInvalide,
                "{ko}"
            );
        }
        assert_eq!(accepte(r#""k":"ecrit""#), Message::Ecrit);
    }

    #[test]
    fn cle_repetee_refusee() {
        for ko in [
            r#"{"v":3,"v":3,"id":"BwcHBwcHBwcHBwcHBwcHBw","t":5,"e":0,"k":"ecrit"}"#,
            r#"{"v":3,"id":"BwcHBwcHBwcHBwcHBwcHBw","t":5,"e":0,"k":"texte","x":"a","x":"b"}"#,
            r#"{"v":3,"id":"BwcHBwcHBwcHBwcHBwcHBw","t":5,"e":0,"k":"appel","a":{"b":1,"b":2}}"#,
            r#"{"v":3,"id":"BwcHBwcHBwcHBwcHBwcHBw","t":5,"e":0,"k":"appel","a":[{"b":1,"b":1}]}"#,
        ] {
            assert_eq!(
                decoder(ko.as_bytes()).unwrap_err(),
                Error::MessageInvalide,
                "{ko}"
            );
        }
    }

    #[test]
    fn reaction_longue_acceptee() {
        let emoji = "👩🏽\u{200D}❤\u{FE0F}\u{200D}💋\u{200D}👨🏿".to_string();
        let e = env(Message::Reaction {
            cible: [1; 16],
            emoji,
        });
        assert_eq!(decoder(&encoder(&e).unwrap()).unwrap(), e);
        assert_eq!(
            encoder(&env(Message::Reaction {
                cible: [1; 16],
                emoji: "a".into()
            }))
            .unwrap_err(),
            Error::MessageInvalide
        );
    }

    #[test]
    fn json_non_utf8_refuse() {
        let mut j = format!("{{{T},\"k\":\"texte\",\"x\":\"a").into_bytes();
        j.extend_from_slice(&[0xFF, 0xFE]);
        j.extend_from_slice(b"\"}");
        assert_eq!(decoder(&j).unwrap_err(), Error::MessageInvalide);
        assert_eq!(decoder(&[0xC0, 0x80]).unwrap_err(), Error::MessageInvalide);
    }

    #[test]
    fn taille_maximale_et_imbrication() {
        assert_eq!(
            decoder(&vec![b' '; crate::MAX_CHARGE + 1]).unwrap_err(),
            Error::MessageInvalide
        );
        let profond = format!(
            "{{{T},\"k\":\"x\",\"a\":{}{}}}",
            "[".repeat(1_000),
            "]".repeat(1_000)
        );
        assert_eq!(
            decoder(profond.as_bytes()).unwrap_err(),
            Error::MessageInvalide
        );
    }

    #[test]
    fn textes_deja_nettoyes() {
        refuse(r#""k":"texte","x":"""#);
        refuse(r#""k":"texte","x":"a\u202Eb""#);
        refuse(r#""k":"texte","x":"a\rb""#);
        refuse(r#""k":"texte","x":"e\u0301""#); // pas NFC
        refuse(r#""k":"modif","cible":"BwcHBwcHBwcHBwcHBwcHBw","x":"a\tb""#);
        refuse(r#""k":"reponse","cible":"BwcHBwcHBwcHBwcHBwcHBw","extrait":"a","x":"b""#); // plus d'extrait
        refuse(r#""k":"reponse","cible":"BwcHBwcHBwcHBwcHBwcHBw","x":"b\u0000""#);
        refuse(&format!(r#""k":"texte","x":"{}""#, "a".repeat(2001)));
        refuse(&format!(
            r#""k":"reponse","cible":"BwcHBwcHBwcHBwcHBwcHBw","x":"{}""#,
            "a".repeat(2001)
        ));
        refuse(r#""k":"profil","pseudo":"A","couleur":1,"avatar":null"#);
        refuse(r#""k":"profil","pseudo":" Léa","couleur":1,"avatar":null"#);
        assert_eq!(
            accepte(r#""k":"texte","x":"a\nb""#),
            Message::Texte { x: "a\nb".into() }
        );
        // l'encodeur refuse aussi un texte non nettoyé
        assert_eq!(
            encoder(&env(Message::Texte {
                x: "a\u{202E}".into()
            }))
            .unwrap_err(),
            Error::MessageInvalide
        );
        assert_eq!(
            encoder(&env(Message::Texte { x: String::new() })).unwrap_err(),
            Error::MessageInvalide
        );
        assert_eq!(
            encoder(&env(Message::Profil {
                pseudo: "😀Léa".into(),
                couleur: 1,
                avatar: None
            }))
            .unwrap_err(),
            Error::MessageInvalide
        );
    }

    #[test]
    fn bornes_des_champs() {
        let c = r#""cible":"BwcHBwcHBwcHBwcHBwcHBw""#;
        // ids : 1 à 50
        let id = r#""BwcHBwcHBwcHBwcHBwcHBw""#;
        refuse(r#""k":"recu","ids":[]"#);
        refuse(&format!(r#""k":"vu","ids":[{}]"#, vec![id; 51].join(",")));
        assert!(
            matches!(accepte(&format!(r#""k":"vu","ids":[{}]"#, vec![id; 50].join(","))), Message::Vu { ids } if ids.len() == 50)
        );
        refuse(r#""k":"recu","ids":"x""#);
        refuse(&format!(r#""k":"recu","ids":[{id},5]"#));
        // emoji : un élément de la liste emoji 15.0
        refuse(&format!(r#""k":"reaction",{c},"emoji":"👍👍""#));
        refuse(&format!(r#""k":"reaction",{c},"emoji":"""#));
        refuse(&format!(r#""k":"reaction",{c},"emoji":"\u202E""#));
        assert!(matches!(
            accepte(&format!(r#""k":"reaction",{c},"emoji":"🇫🇷""#)),
            Message::Reaction { .. }
        ));
        assert_eq!(
            encoder(&env(Message::Reaction {
                cible: [0; 16],
                emoji: "ab".into()
            }))
            .unwrap_err(),
            Error::MessageInvalide
        );
        // couleur 0..=9
        refuse(r#""k":"profil","pseudo":"Léa","couleur":10,"avatar":null"#);
        refuse(r#""k":"profil","pseudo":"Léa","couleur":-1,"avatar":null"#);
        assert!(matches!(
            accepte(r#""k":"profil","pseudo":"Léa","couleur":9,"avatar":null"#),
            Message::Profil { couleur: 9, .. }
        ));
        // avatar : objet exact
        let r = "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk";
        assert_eq!(r.len(), 43);
        let p = r#""BwcHBwcHBwcHBwcHBwcHBw""#;
        assert!(matches!(
            accepte(&format!(
                r#""k":"profil","pseudo":"Léa","couleur":1,"avatar":{{"r":"{r}","piece":{p},"palier":160}}"#
            )),
            Message::Profil {
                avatar: Some(_),
                ..
            }
        ));
        refuse(&format!(
            r#""k":"profil","pseudo":"Léa","couleur":1,"avatar":{{"r":"{r}","piece":{p}}}"#
        ));
        refuse(&format!(
            r#""k":"profil","pseudo":"Léa","couleur":1,"avatar":{{"r":"{r}","piece":{p},"palier":160,"z":1}}"#
        ));
        refuse(&format!(
            r#""k":"profil","pseudo":"Léa","couleur":1,"avatar":{{"r":"{r}","piece":{p},"palier":16385}}"#
        ));
    }

    #[test]
    fn pieces_bornes() {
        let r = "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk";
        let p = "BwcHBwcHBwcHBwcHBwcHBw";
        let base = |palier: &str, nom: &str, mime: &str, taille: &str, sorte: &str, duree: &str| {
            format!(
                r#""k":"piece","r":"{r}","piece":"{p}","palier":{palier},"nom":"{nom}","mime":"{mime}","taille":{taille},"sorte":"{sorte}","duree_ms":{duree}"#
            )
        };
        assert!(matches!(
            accepte(&base(
                "8000",
                "a.png",
                "image/png",
                "9007199254740991",
                "image",
                "null"
            )),
            Message::Piece { .. }
        ));
        // paliers de §29.3 jusqu'à 8 000 seulement
        for ok in [1, 16, 80, 160, 400, 800, 1600, 4000, 8000] {
            accepte(&base(&ok.to_string(), "a", "a/b", "1", "fichier", "1"));
        }
        for ko in [
            "0", "2", "79", "8001", "16385", "32769", "-80", "80.5", "\"80\"", "null",
        ] {
            refuse(&base(ko, "a", "a/b", "1", "fichier", "null"));
        }
        refuse(&base(
            "80",
            "a",
            "a/b",
            "9007199254740992",
            "fichier",
            "null",
        ));
        refuse(&base("80", "a", "a/b", "-1", "fichier", "null"));
        refuse(&base("80", "a", "a/b", "1", "audio", "null"));
        refuse(&base("80", "a", "a/b", "1", "fichier", "4294967296"));
        refuse(&base("80", "a", "a/b", "1", "fichier", "-1"));
        refuse(&base("80", "a", "a/b", "1", "fichier", "1.5"));
        refuse(&base("80", "a", "a/b", "1", "fichier", "\"1\""));
        // nom : déjà au format de safeName ; mime : ASCII visible
        refuse(&base("80", "a\\/b", "a/b", "1", "fichier", "null"));
        refuse(&base("80", "..a", "a/b", "1", "fichier", "null"));
        refuse(&base("80", "", "a/b", "1", "fichier", "null"));
        refuse(&base("80", "a\\u202Eb", "a/b", "1", "fichier", "null"));
        refuse(&base("80", "a", "", "1", "fichier", "null"));
        refuse(&base("80", "a", "a b", "1", "fichier", "null"));
        refuse(&base("80", "a", "é/b", "1", "fichier", "null"));
        refuse(&base(
            "80",
            "a",
            &format!("a/{}", "b".repeat(200)),
            "1",
            "fichier",
            "null",
        ));
        // graine et identifiant
        let sans_r = format!(
            r#""k":"piece","piece":"{p}","palier":80,"nom":"a","mime":"a/b","taille":1,"sorte":"fichier","duree_ms":null"#
        );
        refuse(&sans_r);
        refuse(&base("80", "a", "a/b", "1", "fichier", "null").replace(r, "CQkJ"));
        refuse(&base("80", "a", "a/b", "1", "fichier", "null").replace(r, &format!("{r}CQ")));
        // l'encodeur applique les mêmes règles
        let mut m = piece(SortePiece::Image, None);
        if let Message::Piece { palier, .. } = &mut m {
            *palier = 16385;
        }
        assert_eq!(encoder(&env(m)).unwrap_err(), Error::MessageInvalide);
        let mut m = piece(SortePiece::Image, None);
        if let Message::Piece { nom, .. } = &mut m {
            *nom = "a/b".into();
        }
        assert_eq!(encoder(&env(m)).unwrap_err(), Error::MessageInvalide);
    }

    #[test]
    fn envoi_trop_gros() {
        // 3 500 octets de texte ordinaire : tient.
        let e = env(Message::Texte {
            x: "é".repeat(1750),
        });
        let o = encoder(&e).unwrap();
        assert!(o.len() <= JSON_MAX);
        assert_eq!(decoder(&o).unwrap(), e);
        // 2 000 guillemets, saut de ligne ou barre : l'échappement double le JSON, au-delà de 3 900 octets.
        for c in ["\"", "\n", "\\"] {
            // « a » en tête : un texte fait seulement de sauts de ligne est refusé (aucun caractère visible).
            let e = env(Message::Texte {
                x: format!("a{}", c.repeat(1999)),
            });
            assert_eq!(encoder(&e).unwrap_err(), Error::TropGrand, "{c:?}");
        }
        // la borne est exacte
        let entete = encoder(&env(Message::Texte { x: "a".into() }))
            .unwrap()
            .len()
            - 1;
        let n = (JSON_MAX - entete) / 2;
        let e = env(Message::Texte { x: "\"".repeat(n) });
        assert_eq!(encoder(&e).unwrap().len(), entete + 2 * n);
        let e = env(Message::Texte {
            x: "\"".repeat(n + 1),
        });
        assert_eq!(encoder(&e).unwrap_err(), Error::TropGrand);
        assert_eq!(
            encoder(&env(Message::Texte { x: "\u{1}".into() })).unwrap_err(),
            Error::MessageInvalide
        );
    }

    #[test]
    fn debug_cache_la_graine() {
        let g = Graine::new([0xAB; 32]);
        let s = format!("{g:?} {:?}", piece(SortePiece::Image, None));
        assert!(
            !s.contains("171") && !s.contains("ab") && !s.contains("AB"),
            "{s}"
        );
        assert_eq!(g, g.clone());
        assert_ne!(g, Graine::new([0xAC; 32]));
        assert_eq!(g.as_bytes(), &[0xAB; 32]);
    }

    #[test]
    fn volatiles() {
        for m in tous() {
            let attendu = matches!(
                m,
                Message::Ecrit | Message::Recu { .. } | Message::Vu { .. }
            );
            assert_eq!(est_volatile(&m), attendu, "{m:?}");
        }
        assert!(!est_volatile(&Message::Inconnu {
            sorte: "appel_invite".into()
        }));
    }

    #[test]
    fn jamais_de_panique_sur_entrees_hostiles() {
        let mut graine = 0x2545_F491_4F6C_DD1Du64;
        let mut alea = || {
            graine ^= graine << 13;
            graine ^= graine >> 7;
            graine ^= graine << 17;
            graine
        };
        let modele = encoder(&env(piece(SortePiece::Image, None)))
            .unwrap()
            .to_vec();
        for _ in 0..3000 {
            let mut v = modele.clone();
            for _ in 0..(1 + alea() % 4) {
                let i = (alea() as usize) % v.len();
                v[i] = alea() as u8;
            }
            let _ = decoder(&v);
            let n = (alea() % 200) as usize;
            let b: Vec<u8> = (0..n).map(|_| alea() as u8).collect();
            let _ = decoder(&b);
        }
    }
}
