//! Clé de contenu aléatoire et son enveloppe (spec §29.2 du site), comme
//! `web/src/crypto/envelope.ts`, avec les mêmes octets et les mêmes erreurs :
//!
//! - R (graine) : 32 octets aléatoires, jamais envoyée en clair ;
//! - K_contenu = HKDF(R, « shhdrop/v2/contenu »), importée dans le fournisseur ;
//! - C_engagement = HMAC-SHA-256(R, « shhdrop/v2/engagement »), dans l'en-tête en clair ;
//! - id = HKDF(K_lien, « shhdrop/v2/id »), 16 octets ;
//! - K_maître = HKDF(K_lien ‖ K_mdp, « shhdrop/v2/maitre ») ;
//! - K_env = HKDF(K_maître, « shhdrop/v2/enveloppe »), importée dans le fournisseur ;
//! - K_preuve = HKDF(K_maître, « shhdrop/v2/preuve »), V_preuve = SHA-256(K_preuve) ;
//! - E = nonce (12 octets aléatoires) ‖ AES-256-GCM(K_env, nonce, R, données authentifiées =
//!   « shhdrop/v2/enveloppe-ad » ‖ id ‖ en-tête de 48 octets).
//!
//! L'info HKDF de K_env et le préfixe des données authentifiées sont deux étiquettes distinctes
//! (séparation des domaines). Les octets des clés AES passent une seule fois par `aes_import`,
//! puis sont mis à zéro ; les intermédiaires (K_lien ‖ K_mdp, K_maître) sont des `Zeroizing`.
//! K_contenu et K_env sont rendues comme [`Key`] : oubliées chez le fournisseur à leur
//! destruction, sur tous les chemins.
use crate::error::{Error, Result};
use crate::kdf::{hkdf, sha256};
use crate::keys::{KLien, KMdp, KPreuve, Seed};
use crate::platform::{Key, NONCE_LEN, Opened, Platform, TAG_LEN};
use core::cell::Cell;
use hmac::{KeyInit, Mac};
use std::rc::Rc;
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

pub const SEED_LEN: usize = 32;
pub const ID_LEN: usize = 16;
/// Taille de l'en-tête en clair du segment 0 (même valeur que `format::HEADER`, Task 6).
const HEADER_LEN: usize = 48;
/// Taille de E : nonce (12) ‖ R chiffrée (32) ‖ tag GCM (16).
pub const ENVELOPE_LEN: usize = NONCE_LEN + SEED_LEN + TAG_LEN;
const ENV_AD: &[u8] = b"shhdrop/v2/enveloppe-ad";

/// Clés de contenu d'un paquet : K_contenu (tenue par le fournisseur) et engagement (32 octets).
/// Construites seulement par [`content_keys`] et [`content_keys_checked`] (champ privé).
pub struct ContentKeys<P: Platform> {
    pub k_contenu: Key<P>,
    pub engagement: [u8; 32],
    /// Vrai dès que K_contenu a chiffré un manifeste (`elements::seal_final`) : une K_contenu
    /// n'en chiffre qu'un, sous un nonce fixe (nonce(B − 1, dernier)).
    manifest_sealed: Cell<bool>,
}

impl<P: Platform> ContentKeys<P> {
    /// Réserve K_contenu pour l'unique manifeste ; `cle_deja_utilisee` la seconde fois.
    pub(crate) fn use_for_manifest(&self) -> Result<()> {
        if self.manifest_sealed.replace(true) {
            return Err(Error::CleDejaUtilisee);
        }
        Ok(())
    }
}

/// Clés tirées du lien et du mot de passe : K_env (tenue par le fournisseur), K_preuve, V_preuve.
pub struct AccessKeys<P: Platform> {
    pub k_env: Key<P>,
    pub k_preuve: KPreuve,
    pub v_preuve: [u8; 32],
}

// Debug écrit à la main : sans exiger `P: Debug`, et sans aucun octet secret (K_preuve masquée).
impl<P: Platform> core::fmt::Debug for ContentKeys<P> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("ContentKeys")
            .field("k_contenu", &self.k_contenu)
            .field("engagement", &self.engagement)
            .finish()
    }
}

impl<P: Platform> core::fmt::Debug for AccessKeys<P> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("AccessKeys")
            .field("k_env", &self.k_env)
            .field("k_preuve", &self.k_preuve)
            .field("v_preuve", &self.v_preuve)
            .finish()
    }
}

/// Nouvelle graine R : 32 octets de l'aléa de la plateforme.
pub fn new_seed(p: &impl Platform) -> Result<Seed> {
    let mut r = Zeroizing::new([0u8; SEED_LEN]);
    p.random(&mut *r)?;
    Ok(Seed::from_bytes(*r))
}

/// C_engagement = HMAC-SHA-256(R, « shhdrop/v2/engagement »). L'état HMAC est effacé à sa
/// destruction (fonction `zeroize` de `hmac`).
fn engagement(r: &Seed) -> Result<[u8; 32]> {
    // HMAC accepte une clé de toute longueur : l'erreur est impossible, rendue sans panique.
    let mut mac = <hmac::Hmac<sha2::Sha256> as KeyInit>::new_from_slice(r.as_bytes())
        .map_err(|_| Error::ChiffrementEchec)?;
    mac.update(b"shhdrop/v2/engagement");
    Ok(mac.finalize().into_bytes().into())
}

/// K_contenu et C_engagement tirés de R.
pub async fn content_keys<P: Platform>(p: &Rc<P>, r: &Seed) -> Result<ContentKeys<P>> {
    let engagement = engagement(r)?;
    let raw = hkdf::<32>(r.as_bytes(), "shhdrop/v2/contenu");
    let k_contenu = Key::import(p, raw).await?;
    Ok(ContentKeys {
        k_contenu,
        engagement,
        manifest_sealed: Cell::new(false),
    })
}

/// Clés de contenu à l'ouverture : vérifie d'abord que `engagement` (lu dans l'en-tête en
/// clair) est bien HMAC(R, « shhdrop/v2/engagement »), en temps constant (`subtle`) ; sinon
/// `paquet_corrompu`.
pub async fn content_keys_checked<P: Platform>(
    p: &Rc<P>,
    r: &Seed,
    engagement_read: &[u8],
) -> Result<ContentKeys<P>> {
    // `ct_eq` sur des tranches de longueurs différentes rend faux (la longueur est publique).
    if !bool::from(engagement(r)?.as_slice().ct_eq(engagement_read)) {
        return Err(Error::PaquetCorrompu);
    }
    content_keys(p, r).await
}

/// id du partage = HKDF(K_lien, « shhdrop/v2/id »), 16 octets (spec §29.2, §32).
pub fn share_id(k_lien: &KLien) -> [u8; ID_LEN] {
    *hkdf::<ID_LEN>(k_lien.as_bytes(), "shhdrop/v2/id")
}

/// K_env (importée), K_preuve et V_preuve tirés de K_lien et K_mdp. K_maître et K_lien ‖ K_mdp
/// sont mis à zéro avant de rendre la main.
pub async fn access_keys<P: Platform>(
    p: &Rc<P>,
    k_lien: &KLien,
    k_mdp: &KMdp,
) -> Result<AccessKeys<P>> {
    let mut ikm = Zeroizing::new([0u8; 64]);
    ikm[..32].copy_from_slice(k_lien.as_bytes());
    ikm[32..].copy_from_slice(k_mdp.as_bytes());
    let k_maitre = hkdf::<32>(&*ikm, "shhdrop/v2/maitre");
    let k_env_raw = hkdf::<32>(&*k_maitre, "shhdrop/v2/enveloppe");
    let k_preuve = KPreuve::from_bytes(*hkdf::<32>(&*k_maitre, "shhdrop/v2/preuve"));
    let k_env = Key::import(p, k_env_raw).await?;
    Ok(AccessKeys {
        k_env,
        v_preuve: sha256(k_preuve.as_bytes()),
        k_preuve,
    })
}

/// Données authentifiées de E : « shhdrop/v2/enveloppe-ad » ‖ id ‖ en-tête.
fn aad(id: &[u8], header: &[u8]) -> Vec<u8> {
    [ENV_AD, id, header].concat()
}

/// Enveloppe R sous K_env : E = nonce aléatoire (12 octets) ‖ AES-256-GCM(R), 60 octets. Un
/// nonce neuf à chaque appel (une K_env n'enveloppe qu'une R, mais deux appels ne réutilisent
/// jamais un nonce), tiré de l'aléa du fournisseur qui tient K_env. Aléa indisponible :
/// `aleatoire_indisponible`, rien n'est chiffré.
pub async fn seal<P: Platform>(
    k_env: &Key<P>,
    r: &Seed,
    id: &[u8; ID_LEN],
    header: &[u8; HEADER_LEN],
) -> Result<Vec<u8>> {
    let mut nonce = [0u8; NONCE_LEN];
    k_env.platform().random(&mut nonce)?;
    let ct = k_env
        .seal_batch(&aad(id, header), &[nonce], r.as_bytes(), SEED_LEN)
        .await?;
    Ok([&nonce[..], &ct].concat())
}

/// Déballe R. Toute erreur (taille, autre id, autre en-tête, E modifiée, autre K_env donc autre
/// lien ou autre mot de passe) donne la même erreur `paquet_corrompu`.
pub async fn open<P: Platform>(k_env: &Key<P>, e: &[u8], id: &[u8], header: &[u8]) -> Result<Seed> {
    if e.len() != ENVELOPE_LEN || id.len() != ID_LEN || header.len() != HEADER_LEN {
        return Err(Error::PaquetCorrompu);
    }
    let (nonce, ct) = e.split_at(NONCE_LEN);
    let nonce: [u8; NONCE_LEN] = nonce.try_into().map_err(|_| Error::PaquetCorrompu)?;
    let pt = k_env
        .open_batch(&aad(id, header), &[nonce], ct, SEED_LEN + TAG_LEN)
        .await?;
    if pt.len() != SEED_LEN {
        return Err(Error::PaquetCorrompu);
    }
    let mut r = Zeroizing::new([0u8; SEED_LEN]);
    if !pt.copy_out(0, &mut *r) {
        return Err(Error::PaquetCorrompu);
    }
    Ok(Seed::from_bytes(*r))
}
