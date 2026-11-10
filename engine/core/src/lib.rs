//! Moteur Shhdrop : chiffrement et format des partages, commun au site (WebAssembly) et aux
//! futures apps. Aucune dépendance au navigateur, à l'horloge, aux fichiers ni au réseau :
//! l'aléa et l'AES-GCM sont fournis par la plateforme.
#![forbid(unsafe_code)]

pub mod encoding;
mod error;
mod keys;
pub mod link;
pub mod password;
mod whatwg;

pub use error::{Error, Result};
pub use keys::{KLien, SGestion};
