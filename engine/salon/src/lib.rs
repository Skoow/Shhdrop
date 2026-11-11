//! Moteur du salon Shhdrop : commun au site (WebAssembly) et aux futures apps. Comme
//! `shhdrop-core`, il n'a aucune dépendance au navigateur, à l'horloge, aux fichiers ni au
//! réseau : l'aléa vient de la plateforme (getrandom).
#![forbid(unsafe_code)]

mod cles;
mod emoji;
mod error;
mod groupe;
mod message;
pub mod politique;
mod stockage;
mod texte;
mod trame;

pub use cles::{CleAcces, ClesSalon, cle_acces, cles_salon};
pub use error::{Error, Result};
pub use groupe::{Evenement, Identite, Salon, nouvelle_identite};
pub use message::{
    Enveloppe, Graine, IdMessage, JSON_MAX, Message, RefPiece, SortePiece, decoder, encoder,
    est_volatile,
};
pub use stockage::{Fournisseur, Stockage};
pub use texte::{cle_unicite, nettoyer_nom, nettoyer_texte, verifier_pseudo};
pub use trame::{EnTete, MAX_CHARGE, Regle, TAILLE_O, TAILLE_TRAME, lire_en_tete, ouvrir, sceller};
