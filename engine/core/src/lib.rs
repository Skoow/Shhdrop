//! Moteur Shhdrop : chiffrement et format des partages, commun au site (WebAssembly) et aux
//! futures apps. Aucune dépendance au navigateur, à l'horloge, aux fichiers ni au réseau :
//! l'aléa et l'AES-GCM sont fournis par la plateforme.
#![forbid(unsafe_code)]

pub mod elements;
pub mod encoding;
pub mod envelope;
mod error;
pub mod format;
pub mod kdf;
mod keys;
pub mod link;
pub mod manifest;
#[cfg(not(target_arch = "wasm32"))]
pub mod native;
pub mod password;
pub mod platform;
mod whatwg;

pub use error::{Error, Result};
pub use keys::{KAcces, KLien, KMdp, KPreuve, SGestion, Seed};
