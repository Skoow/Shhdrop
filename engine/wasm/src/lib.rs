//! Liaison WebAssembly du moteur pour le site. Pour l'instant, seul Argon2id est exposé, pour
//! mesurer sa vitesse dans le navigateur (Task 4) ; les tâches suivantes y ajoutent le reste.
#![forbid(unsafe_code)]

use wasm_bindgen::prelude::*;

/// Argon2id(mot de passe en UTF-8 déjà normalisé NFC, sel de 16 octets) → 32 octets.
/// Paramètres bornés par le moteur (KDF_MIN = KDF_MAX) ; refus = message exact du moteur.
#[wasm_bindgen]
pub fn argon2id(pw: &[u8], salt: &[u8], ops: u32, mem: u32) -> Result<Vec<u8>, JsError> {
    shhdrop_core::kdf::argon2id(pw, salt, ops, mem)
        .map(|k| k.to_vec())
        .map_err(|e| JsError::new(e.message()))
}
