//! Liaison WebAssembly du moteur du salon (`shhdrop-salon`) pour le site : module à part du
//! moteur des partages (`shhdrop-wasm`), chargé seulement par le salon (web/src/salon/engine.ts).
//! Fonctions et classes exportées par `wasm-bindgen`, sans fournisseur JavaScript : tout le calcul
//! (HKDF, XChaCha20-Poly1305, MLS) est fait par les bibliothèques Rust du moteur ; l'aléa vient de
//! `crypto.getRandomValues` (getrandom, `wasm_js`).
//!
//! Règles aux frontières (comme `shhdrop-wasm`) :
//! - Erreurs : une `Error` JavaScript dont le message est celui du moteur (`trame_corrompue`,
//!   `message_invalide`…). Un argument hors de son domaine (siège hors de 0 à 255, règle hors de
//!   0 à 3, octets de mauvaise longueur, nombre qui n'est pas un entier sûr) donne
//!   `argument_invalide` : il n'est jamais tronqué ni arrondi (`wasm-bindgen` ferait de 300 un
//!   siège 44). Dans une enveloppe, tout champ invalide donne `message_invalide`, comme un JSON
//!   invalide.
//! - Secrets venus de JavaScript (`K_lien`, `K_mdp`) : copiés dans un tampon `Zeroizing`. Aucun
//!   secret n'est rendu à JavaScript, sauf ce que le serveur doit recevoir (`K_accès_s`,
//!   `K_preuve_s`, comme pour un partage), la clé SFrame de l'époque (`exporterSframe`, pour les
//!   appels) et les graines `R` des pièces dans les enveloppes lues : l'appelant met ces tableaux
//!   à zéro (`fill(0)`) dès qu'il n'en a plus besoin. `K_trame`, `K_salon` et l'état MLS restent
//!   dans le module, derrière des poignées (`ClesSalon`, `Salon`) à libérer par `free()`, qui
//!   les efface.
//! - Le nonce d'une trame est tiré ici (24 octets, `crypto.getRandomValues`) : `sceller` n'en
//!   accepte pas de l'appelant (la forme à nonce donné du moteur sert aux vecteurs seulement).
#![forbid(unsafe_code)]

use js_sys::{Array, Object, Reflect, Uint8Array};
use shhdrop_core::format::MAX_SAFE;
use shhdrop_core::{KLien, KMdp};
use shhdrop_salon::{
    self as salon, EnTete, Enveloppe, Etat, Evenement, Graine, IdMessage, Message, RefPiece, Regle,
    SortePiece,
};
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;
use zeroize::Zeroizing;

type R<T> = core::result::Result<T, JsValue>;

#[wasm_bindgen(typescript_custom_section)]
const TS_TYPES: &str = r#"
/** Règle d'effacement : 0 désactivé, 1 instantané, 2 dix minutes, 3 une heure. */
export type Regle = 0 | 1 | 2 | 3;
/** En-tête d'une trame, lisible sans clé (le serveur le lit), authentifié. */
export type EnTete = { volatile: boolean; regle: Regle };
export type SortePiece = "fichier" | "image" | "video" | "vocal";
/** Message du salon (spec salon v3 §4.1). Identifiants : 16 octets ; graine `r` : 32 octets. */
export type Message =
  | { k: "texte"; x: string }
  | { k: "piece"; r: Uint8Array; piece: Uint8Array; palier: number; nom: string; mime: string; taille: number; sorte: SortePiece; dureeMs: number | null }
  | { k: "reaction"; cible: Uint8Array; emoji: string }
  | { k: "reponse"; cible: Uint8Array; x: string }
  | { k: "modif"; cible: Uint8Array; x: string }
  | { k: "retrait"; cible: Uint8Array }
  | { k: "ecrit" }
  | { k: "recu"; ids: Uint8Array[] }
  | { k: "vu"; ids: Uint8Array[] }
  | { k: "regle"; regle: Regle }
  | { k: "profil"; pseudo: string; couleur: number; avatar: { r: Uint8Array; piece: Uint8Array; palier: number } | null }
  | { k: "depart" }
  /** Sorte inconnue de ce moteur (lue, ignorée ; jamais encodée). */
  | { k: "inconnu"; sorte: string };
export type Enveloppe = { id: Uint8Array; heureMs: number; regle: Regle; message: Message };
/** Résultat de Salon.recevoir (engine/salon/src/groupe.rs, `Evenement`). */
export type Evenement =
  | { type: "message"; deSiege: number; enveloppe: Enveloppe }
  | { type: "membres"; ajoutes: number[]; retires: number[] }
  | { type: "commitPerdu"; ajoutes: number[]; retires: number[] }
  | { type: "commitAccepte"; welcome: Uint8Array | null }
  | { type: "keyPackage"; octets: Uint8Array }
  | { type: "ignore" };
export type Annonce = { siege: number; nonce: Uint8Array };
/** Brut : instants en bigint (web/src/salon/engine.ts rend des nombres). */
export type EtatEffacementBrut = { etat: "visible" } | { etat: "rebours"; finMs: bigint } | { etat: "efface" };
"#;

// ---------------------------------------------------------------------------------------------
// Conversions aux frontières
// ---------------------------------------------------------------------------------------------

const ARGUMENT_INVALIDE: &str = "argument_invalide";

fn js_err(e: salon::Error) -> JsValue {
    JsError::new(&e.to_string()).into()
}

fn arg() -> JsValue {
    JsError::new(ARGUMENT_INVALIDE).into()
}

/// Entier de 0 à `max` (`Number.isSafeInteger`), sinon `None`.
fn entier(v: &JsValue, max: u64) -> Option<u64> {
    let x = v.as_f64()?;
    (x.is_finite() && x >= 0.0 && x.fract() == 0.0 && x <= max.min(MAX_SAFE) as f64)
        .then_some(x as u64)
}

fn siege(x: f64) -> R<u8> {
    entier(&JsValue::from_f64(x), 255)
        .map(|n| n as u8)
        .ok_or_else(arg)
}

fn regle_de(v: &JsValue) -> Option<Regle> {
    Some(match entier(v, 3)? {
        0 => Regle::Desactive,
        1 => Regle::Instantane,
        2 => Regle::DixMinutes,
        _ => Regle::UneHeure,
    })
}

fn get(o: &JsValue, k: &str) -> JsValue {
    if !o.is_object() {
        return JsValue::UNDEFINED;
    }
    Reflect::get(o, &JsValue::from_str(k)).unwrap_or(JsValue::UNDEFINED)
}

fn set(o: &Object, k: &str, v: impl Into<JsValue>) {
    // Reflect.set sur un objet ordinaire neuf ne peut pas échouer.
    let _ = Reflect::set(o, &JsValue::from_str(k), &v.into());
}

fn octets(b: &[u8]) -> Uint8Array {
    Uint8Array::from(b)
}

/// Octets publics de longueur exacte (`Uint8Array`), sinon `None`.
fn fixe<const N: usize>(v: &JsValue) -> Option<[u8; N]> {
    let a = v.dyn_ref::<Uint8Array>()?;
    if a.length() as usize != N {
        return None;
    }
    let mut out = [0u8; N];
    a.copy_to(&mut out);
    Some(out)
}

/// Secret de 32 octets venu de JavaScript, recopié dans un tampon effacé après usage.
fn secret32(a: &Uint8Array) -> R<Zeroizing<Vec<u8>>> {
    if a.length() != 32 {
        return Err(arg());
    }
    Ok(Zeroizing::new(a.to_vec()))
}

fn sieges(s: &[u8]) -> Array {
    s.iter().map(|&x| JsValue::from(x)).collect()
}

// ---------------------------------------------------------------------------------------------
// Enveloppes : objet JavaScript ↔ `Enveloppe`
// ---------------------------------------------------------------------------------------------

/// Nombre d'identifiants lus au plus dans `ids` (le moteur en admet 50 ; au-delà, refus sans
/// tout parcourir).
const IDS_LUS: u32 = 64;

fn texte(m: &JsValue, k: &str) -> Option<String> {
    get(m, k).as_string()
}

fn graine(v: &JsValue) -> Option<Graine> {
    let mut g = Zeroizing::new([0u8; 32]);
    let a = v.dyn_ref::<Uint8Array>()?;
    if a.length() != 32 {
        return None;
    }
    a.copy_to(&mut g[..]);
    Some(Graine::new(*g))
}

fn ids(v: &JsValue) -> Option<Vec<IdMessage>> {
    if !Array::is_array(v) {
        return None;
    }
    let a: &Array = v.unchecked_ref();
    if a.length() > IDS_LUS {
        return None;
    }
    a.iter().map(|x| fixe::<16>(&x)).collect()
}

fn lire_message(m: &JsValue) -> Option<Message> {
    let id = |k: &str| fixe::<16>(&get(m, k));
    let k = get(m, "k").as_string()?;
    Some(match k.as_str() {
        "texte" => Message::Texte { x: texte(m, "x")? },
        "piece" => {
            let duree = get(m, "dureeMs");
            Message::Piece {
                r: graine(&get(m, "r"))?,
                piece: id("piece")?,
                palier: entier(&get(m, "palier"), u32::MAX.into())? as u32,
                nom: texte(m, "nom")?,
                mime: texte(m, "mime")?,
                // Au-delà de 2^53 − 1 : u64::MAX, que le moteur refuse (message_invalide).
                taille: entier(&get(m, "taille"), MAX_SAFE).unwrap_or(u64::MAX),
                sorte: match texte(m, "sorte")?.as_str() {
                    "fichier" => SortePiece::Fichier,
                    "image" => SortePiece::Image,
                    "video" => SortePiece::Video,
                    "vocal" => SortePiece::Vocal,
                    _ => return None,
                },
                duree_ms: if duree.is_null() {
                    None
                } else {
                    Some(entier(&duree, u32::MAX.into())? as u32)
                },
            }
        }
        "reaction" => Message::Reaction {
            cible: id("cible")?,
            emoji: texte(m, "emoji")?,
        },
        "reponse" => Message::Reponse {
            cible: id("cible")?,
            x: texte(m, "x")?,
        },
        "modif" => Message::Modif {
            cible: id("cible")?,
            x: texte(m, "x")?,
        },
        "retrait" => Message::Retrait {
            cible: id("cible")?,
        },
        "ecrit" => Message::Ecrit,
        "recu" => Message::Recu {
            ids: ids(&get(m, "ids"))?,
        },
        "vu" => Message::Vu {
            ids: ids(&get(m, "ids"))?,
        },
        "regle" => Message::Regle {
            regle: regle_de(&get(m, "regle"))?,
        },
        "profil" => {
            let a = get(m, "avatar");
            Message::Profil {
                pseudo: texte(m, "pseudo")?,
                couleur: entier(&get(m, "couleur"), 255)? as u8,
                avatar: if a.is_null() {
                    None
                } else {
                    Some(RefPiece {
                        r: graine(&get(&a, "r"))?,
                        piece: fixe::<16>(&get(&a, "piece"))?,
                        palier: entier(&get(&a, "palier"), u32::MAX.into())? as u32,
                    })
                },
            }
        }
        "depart" => Message::Depart,
        "inconnu" => Message::Inconnu {
            sorte: texte(m, "sorte")?,
        },
        _ => return None,
    })
}

/// Enveloppe venue de JavaScript ; tout champ absent ou mal typé : `message_invalide`.
fn lire_enveloppe(v: &JsValue) -> R<Enveloppe> {
    let e = (|| {
        Some(Enveloppe {
            id: fixe::<16>(&get(v, "id"))?,
            // Au-delà de 2^53 − 1 : u64::MAX, que le moteur refuse (message_invalide).
            heure_ms: entier(&get(v, "heureMs"), MAX_SAFE).unwrap_or(u64::MAX),
            regle: regle_de(&get(v, "regle"))?,
            message: lire_message(&get(v, "message"))?,
        })
    })();
    e.ok_or_else(|| js_err(salon::Error::MessageInvalide))
}

fn id_js(id: &[u8]) -> JsValue {
    octets(id).into()
}

fn message_js(m: &Message) -> Object {
    let o = Object::new();
    let k = |o: &Object, k: &str| set(o, "k", k);
    match m {
        Message::Texte { x } => {
            k(&o, "texte");
            set(&o, "x", x.as_str());
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
            k(&o, "piece");
            set(&o, "r", octets(r.as_bytes()));
            set(&o, "piece", id_js(piece));
            set(&o, "palier", *palier);
            set(&o, "nom", nom.as_str());
            set(&o, "mime", mime.as_str());
            set(&o, "taille", *taille as f64);
            set(
                &o,
                "sorte",
                match sorte {
                    SortePiece::Fichier => "fichier",
                    SortePiece::Image => "image",
                    SortePiece::Video => "video",
                    SortePiece::Vocal => "vocal",
                },
            );
            set(&o, "dureeMs", duree_ms.map_or(JsValue::NULL, JsValue::from));
        }
        Message::Reaction { cible, emoji } => {
            k(&o, "reaction");
            set(&o, "cible", id_js(cible));
            set(&o, "emoji", emoji.as_str());
        }
        Message::Reponse { cible, x } => {
            k(&o, "reponse");
            set(&o, "cible", id_js(cible));
            set(&o, "x", x.as_str());
        }
        Message::Modif { cible, x } => {
            k(&o, "modif");
            set(&o, "cible", id_js(cible));
            set(&o, "x", x.as_str());
        }
        Message::Retrait { cible } => {
            k(&o, "retrait");
            set(&o, "cible", id_js(cible));
        }
        Message::Ecrit => k(&o, "ecrit"),
        Message::Recu { ids } | Message::Vu { ids } => {
            k(
                &o,
                if matches!(m, Message::Recu { .. }) {
                    "recu"
                } else {
                    "vu"
                },
            );
            set(&o, "ids", ids.iter().map(|i| id_js(i)).collect::<Array>());
        }
        Message::Regle { regle } => {
            k(&o, "regle");
            set(&o, "regle", *regle as u8);
        }
        Message::Profil {
            pseudo,
            couleur,
            avatar,
        } => {
            k(&o, "profil");
            set(&o, "pseudo", pseudo.as_str());
            set(&o, "couleur", *couleur);
            let a = match avatar {
                None => JsValue::NULL,
                Some(a) => {
                    let x = Object::new();
                    set(&x, "r", octets(a.r.as_bytes()));
                    set(&x, "piece", id_js(&a.piece));
                    set(&x, "palier", a.palier);
                    x.into()
                }
            };
            set(&o, "avatar", a);
        }
        Message::Depart => k(&o, "depart"),
        Message::Inconnu { sorte } => {
            k(&o, "inconnu");
            set(&o, "sorte", sorte.as_str());
        }
    }
    o
}

fn enveloppe_js(e: &Enveloppe) -> Object {
    let o = Object::new();
    set(&o, "id", id_js(&e.id));
    set(&o, "heureMs", e.heure_ms as f64);
    set(&o, "regle", e.regle as u8);
    set(&o, "message", message_js(&e.message));
    o
}

fn en_tete_js(e: EnTete) -> Object {
    let o = Object::new();
    set(&o, "volatile", e.volatile);
    set(&o, "regle", e.regle as u8);
    o
}

// ---------------------------------------------------------------------------------------------
// Fonctions pures : constantes, clés, trames, messages, texte, effacement
// ---------------------------------------------------------------------------------------------

/// Tailles du format (mêmes noms que `engine/vectors/salon-v3.json`).
#[wasm_bindgen(
    unchecked_return_type = "{ TAILLE_TRAME: number; TAILLE_O: number; MAX_CHARGE: number; JSON_MAX: number }"
)]
pub fn constantes() -> Object {
    let o = Object::new();
    set(&o, "TAILLE_TRAME", salon::TAILLE_TRAME as u32);
    set(&o, "TAILLE_O", salon::TAILLE_O as u32);
    set(&o, "MAX_CHARGE", salon::MAX_CHARGE as u32);
    set(&o, "JSON_MAX", salon::JSON_MAX as u32);
    o
}

/// `K_accès_s` (montrée au serveur, en-tête `X-Shh-Access`) et `V_accès_s` = SHA-256 : copies
/// que l'appelant efface.
#[wasm_bindgen(
    js_name = cleAcces,
    unchecked_return_type = "{ k: Uint8Array; v: Uint8Array }"
)]
pub fn cle_acces(k_lien: &Uint8Array) -> R<Object> {
    let l = KLien::from_slice(&secret32(k_lien)?).map_err(|_| arg())?;
    let a = salon::cle_acces(&l);
    let o = Object::new();
    set(&o, "k", octets(&a.k));
    set(&o, "v", octets(&a.v));
    Ok(o)
}

/// Clés d'un salon (`K_trame`, étiquette, `K_preuve_s`) derrière une poignée ; `free()` les efface.
#[wasm_bindgen(js_name = ClesSalon)]
pub struct JsClesSalon(salon::ClesSalon);

#[wasm_bindgen(js_class = ClesSalon)]
impl JsClesSalon {
    /// `K_preuve_s` (32 octets), montrée au serveur pour détruire le salon ; copie à effacer.
    #[wasm_bindgen(js_name = kPreuve)]
    pub fn k_preuve(&self) -> Uint8Array {
        octets(self.0.k_preuve())
    }

    /// `V_preuve_s` = SHA-256(`K_preuve_s`), donnée au serveur à la création.
    #[wasm_bindgen(js_name = vPreuve)]
    pub fn v_preuve(&self) -> Uint8Array {
        octets(&self.0.v_preuve())
    }

    /// Identifiant public du salon (16 octets).
    pub fn tag(&self) -> Uint8Array {
        octets(self.0.tag())
    }
}

/// Clés du salon tirées de `K_lien` et `K_mdp` (32 octets chacune).
#[wasm_bindgen(js_name = clesSalon)]
pub fn cles_salon(k_lien: &Uint8Array, k_mdp: &Uint8Array) -> R<JsClesSalon> {
    let l = KLien::from_slice(&secret32(k_lien)?).map_err(|_| arg())?;
    let m = KMdp::from_slice(&secret32(k_mdp)?).map_err(|_| arg())?;
    Ok(JsClesSalon(salon::cles_salon(&l, &m)))
}

fn lire_en_tete_js(v: &JsValue) -> R<EnTete> {
    let volatile = get(v, "volatile").as_bool().ok_or_else(arg)?;
    let regle = regle_de(&get(v, "regle")).ok_or_else(arg)?;
    Ok(EnTete { volatile, regle })
}

/// Trame de 4 140 octets ; le nonce (24 octets) est tiré ici par `crypto.getRandomValues`.
#[wasm_bindgen]
pub fn sceller(
    cles: &JsClesSalon,
    #[wasm_bindgen(unchecked_param_type = "EnTete")] en_tete: &JsValue,
    charge: &Uint8Array,
) -> R<Uint8Array> {
    let en_tete = lire_en_tete_js(en_tete)?;
    let charge = Zeroizing::new(charge.to_vec());
    let mut nonce = [0u8; 24];
    getrandom::fill(&mut nonce).map_err(|_| js_err(salon::Error::MlsInterne))?;
    let t = salon::sceller(&cles.0, en_tete, &charge, &nonce).map_err(js_err)?;
    Ok(octets(&t))
}

/// Ouvre une trame : `{ volatile, regle, charge }` ; tout échec est `trame_corrompue`.
#[wasm_bindgen(unchecked_return_type = "EnTete & { charge: Uint8Array }")]
pub fn ouvrir(cles: &JsClesSalon, trame: &[u8]) -> R<Object> {
    let (e, charge) = salon::ouvrir(&cles.0, trame).map_err(js_err)?;
    let o = en_tete_js(e);
    set(&o, "charge", octets(&charge));
    Ok(o)
}

/// En-tête lu sans clé (ce que lit le serveur).
#[wasm_bindgen(js_name = lireEnTete, unchecked_return_type = "EnTete")]
pub fn lire_en_tete(trame: &[u8]) -> R<Object> {
    salon::lire_en_tete(trame).map(en_tete_js).map_err(js_err)
}

/// Charge utile JSON d'une enveloppe (textes déjà nettoyés, sinon `message_invalide`).
#[wasm_bindgen]
pub fn encoder(#[wasm_bindgen(unchecked_param_type = "Enveloppe")] e: &JsValue) -> R<Uint8Array> {
    let e = lire_enveloppe(e)?;
    salon::encoder(&e).map(|b| octets(&b)).map_err(js_err)
}

/// Lit une charge utile (sorte inconnue : `{ k: "inconnu", sorte }`, sans erreur).
#[wasm_bindgen(unchecked_return_type = "Enveloppe")]
pub fn decoder(octets_json: &[u8]) -> R<Object> {
    salon::decoder(octets_json)
        .map(|e| enveloppe_js(&e))
        .map_err(js_err)
}

/// Message qui ne se range pas dans l'historique (bit volatil de l'en-tête de sa trame).
#[wasm_bindgen(js_name = estVolatile)]
pub fn est_volatile(#[wasm_bindgen(unchecked_param_type = "Message")] m: &JsValue) -> R<bool> {
    let m = lire_message(m).ok_or_else(|| js_err(salon::Error::MessageInvalide))?;
    Ok(salon::est_volatile(&m))
}

#[wasm_bindgen(js_name = nettoyerTexte)]
pub fn nettoyer_texte(s: &str) -> R<String> {
    salon::nettoyer_texte(s).map_err(js_err)
}

/// Nom de fichier d'une pièce, sous la forme qu'exige l'encodeur.
#[wasm_bindgen(js_name = nettoyerNom)]
pub fn nettoyer_nom(s: &str) -> String {
    salon::nettoyer_nom(s)
}

#[wasm_bindgen(js_name = verifierPseudo)]
pub fn verifier_pseudo(s: &str) -> R<String> {
    salon::verifier_pseudo(s).map_err(js_err)
}

/// Clé d'unicité d'un pseudonyme déjà vérifié (sosies confondus).
#[wasm_bindgen(js_name = cleUnicite)]
pub fn cle_unicite(s: &str) -> String {
    salon::cle_unicite(s)
}

/// Code de vérification d'une clé publique Ed25519 (32 octets).
#[wasm_bindgen(js_name = codeVerification)]
pub fn code_verification(cle: &[u8]) -> R<String> {
    let c: &[u8; 32] = cle.try_into().map_err(|_| arg())?;
    Ok(salon::code_verification(c))
}

/// État d'un message à l'écran (`engine/salon/src/effacement.rs`) ; instants en millisecondes,
/// en `bigint` (la couche TypeScript les vérifie : web/src/salon/engine.ts).
#[allow(clippy::too_many_arguments)]
#[wasm_bindgen(js_name = etatEffacement, unchecked_return_type = "EtatEffacementBrut")]
pub fn etat_effacement(
    regle: f64,
    envoye_ms: u64,
    maintenant_ms: u64,
    moi_expediteur: bool,
    vu_par_moi_ms: Option<u64>,
    encore_dans_conversation: bool,
    lu_par_tous: bool,
) -> R<Object> {
    let regle = regle_de(&JsValue::from_f64(regle)).ok_or_else(arg)?;
    let o = Object::new();
    match salon::etat(
        regle,
        envoye_ms,
        maintenant_ms,
        moi_expediteur,
        vu_par_moi_ms,
        encore_dans_conversation,
        lu_par_tous,
    ) {
        Etat::Visible => set(&o, "etat", "visible"),
        Etat::Rebours { fin_ms } => {
            set(&o, "etat", "rebours");
            set(&o, "finMs", JsValue::from(fin_ms));
        }
        Etat::Efface => set(&o, "etat", "efface"),
    }
    Ok(o)
}

// ---------------------------------------------------------------------------------------------
// Groupe MLS
// ---------------------------------------------------------------------------------------------

fn nonce_arrivee(a: &JsValue) -> R<[u8; 16]> {
    fixe::<16>(a).ok_or_else(arg)
}

fn evenement_js(ev: Evenement) -> Object {
    let o = Object::new();
    match ev {
        Evenement::Message {
            de_siege,
            enveloppe,
        } => {
            set(&o, "type", "message");
            set(&o, "deSiege", de_siege);
            set(&o, "enveloppe", enveloppe_js(&enveloppe));
        }
        Evenement::Membres { ajoutes, retires } => {
            set(&o, "type", "membres");
            set(&o, "ajoutes", sieges(&ajoutes));
            set(&o, "retires", sieges(&retires));
        }
        Evenement::CommitPerdu { ajoutes, retires } => {
            set(&o, "type", "commitPerdu");
            set(&o, "ajoutes", sieges(&ajoutes));
            set(&o, "retires", sieges(&retires));
        }
        Evenement::CommitAccepte { welcome } => {
            set(&o, "type", "commitAccepte");
            set(
                &o,
                "welcome",
                welcome.map_or(JsValue::NULL, |w| octets(&w).into()),
            );
        }
        Evenement::KeyPackage { octets: kp } => {
            set(&o, "type", "keyPackage");
            set(&o, "octets", octets(&kp));
        }
        Evenement::Ignore => set(&o, "type", "ignore"),
    }
    o
}

/// Un participant du salon et son état MLS (engine/salon/src/groupe.rs : contrat de l'appelant
/// sur les annonces du serveur et l'ordre `seq`). `free()` efface l'état et la clé privée.
#[wasm_bindgen(js_name = Salon)]
pub struct JsSalon(salon::Salon);

#[wasm_bindgen(js_class = Salon)]
impl JsSalon {
    /// Nouveau participant au siège donné par le serveur, avec une identité éphémère neuve.
    /// `createur` : il crée le groupe ; sinon il attend un Welcome (`keyPackage`, `rejoindre`).
    pub fn creer(
        siege: f64,
        #[wasm_bindgen(unchecked_param_type = "Uint8Array")] nonce_arrivee: &JsValue,
        cles: &JsClesSalon,
        createur: bool,
    ) -> R<JsSalon> {
        let siege = self::siege(siege)?;
        let nonce = self::nonce_arrivee(nonce_arrivee)?;
        let identite = salon::nouvelle_identite(siege, nonce).map_err(js_err)?;
        salon::Salon::creer(identite, &cles.0, createur)
            .map(JsSalon)
            .map_err(js_err)
    }

    /// KeyPackage à publier à l'arrivée.
    #[wasm_bindgen(js_name = keyPackage)]
    pub fn key_package(&self) -> R<Uint8Array> {
        self.0.key_package().map(|b| octets(&b)).map_err(js_err)
    }

    pub fn rejoindre(&mut self, welcome: &[u8]) -> R<()> {
        self.0.rejoindre(welcome).map_err(js_err)
    }

    /// Commit d'ajout (le Welcome vient à l'écho gagnant, `commitAccepte`).
    pub fn ajouter(&mut self, key_package: &[u8]) -> R<Uint8Array> {
        self.0
            .ajouter(key_package)
            .map(|b| octets(&b))
            .map_err(js_err)
    }

    pub fn retirer(&mut self, siege: f64) -> R<Uint8Array> {
        let s = self::siege(siege)?;
        self.0.retirer(s).map(|b| octets(&b)).map_err(js_err)
    }

    pub fn renouveler(&mut self) -> R<Uint8Array> {
        self.0.renouveler().map(|b| octets(&b)).map_err(js_err)
    }

    /// Message MLS d'une enveloppe, à sceller dans une trame.
    pub fn chiffrer(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "Enveloppe")] e: &JsValue,
    ) -> R<Uint8Array> {
        let e = lire_enveloppe(e)?;
        self.0.chiffrer(&e).map(|b| octets(&b)).map_err(js_err)
    }

    /// Message MLS rangé au rang `seq` (entier sûr), envoyé par `siegeEmetteur` (attesté par le serveur).
    #[wasm_bindgen(unchecked_return_type = "Evenement")]
    pub fn recevoir(&mut self, mls: &[u8], seq: f64, siege_emetteur: f64) -> R<Object> {
        let seq = entier(&JsValue::from_f64(seq), MAX_SAFE).ok_or_else(arg)?;
        let de = self::siege(siege_emetteur)?;
        self.0
            .recevoir(mls, seq, de)
            .map(evenement_js)
            .map_err(js_err)
    }

    /// Arrivée (0x02) ou reprise (0x0A) annoncée par le serveur.
    pub fn annoncer(
        &mut self,
        siege: f64,
        #[wasm_bindgen(unchecked_param_type = "Uint8Array")] nonce_arrivee: &JsValue,
    ) -> R<()> {
        let s = self::siege(siege)?;
        let n = self::nonce_arrivee(nonce_arrivee)?;
        self.0.annoncer(s, n);
        Ok(())
    }

    /// Liste complète des sièges occupés, donnée à l'accueil du WebSocket.
    #[wasm_bindgen(js_name = remplacerAnnonces)]
    pub fn remplacer_annonces(
        &mut self,
        createur_siege: f64,
        #[wasm_bindgen(unchecked_param_type = "Annonce[]")] liste: &JsValue,
    ) -> R<()> {
        let c = self::siege(createur_siege)?;
        if !Array::is_array(liste) {
            return Err(arg());
        }
        let a: &Array = liste.unchecked_ref();
        if a.length() > 256 {
            return Err(arg());
        }
        let l = a
            .iter()
            .map(|x| {
                let s = get(&x, "siege").as_f64().ok_or_else(arg)?;
                Ok((self::siege(s)?, self::nonce_arrivee(&get(&x, "nonce"))?))
            })
            .collect::<R<Vec<_>>>()?;
        self.0.remplacer_annonces(c, &l);
        Ok(())
    }

    /// Siège annoncé parti (0x03) ou exclu (0x09).
    #[wasm_bindgen(js_name = marquerParti)]
    pub fn marquer_parti(&mut self, siege: f64) -> R<()> {
        let s = self::siege(siege)?;
        self.0.marquer_parti(s);
        Ok(())
    }

    #[wasm_bindgen(js_name = abandonnerCommit)]
    pub fn abandonner_commit(&mut self) -> R<()> {
        self.0.abandonner_commit().map_err(js_err)
    }

    /// Clé SFrame de l'époque (32 octets) : SECRET, copie que l'appelant met à zéro après usage.
    #[wasm_bindgen(js_name = exporterSframe)]
    pub fn exporter_sframe(&self) -> R<Uint8Array> {
        self.0
            .exporter_sframe()
            .map(|k| octets(&k[..]))
            .map_err(js_err)
    }

    /// Code de vérification du siège (4 groupes de 5 chiffres).
    pub fn empreinte(&self, siege: f64) -> R<String> {
        let s = self::siege(siege)?;
        self.0.empreinte(s).map_err(js_err)
    }

    /// Sièges des membres, en ordre croissant (vide hors du groupe).
    #[wasm_bindgen(unchecked_return_type = "number[]")]
    pub fn membres(&self) -> Array {
        sieges(&self.0.membres())
    }

    /// Époque MLS (`undefined` hors du groupe).
    pub fn epoque(&self) -> Option<f64> {
        self.0.epoque().map(|e| e as f64)
    }
}
