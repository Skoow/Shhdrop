//! Clés du salon (spec §39.2.1) : tout dérive de `K_lien` et de `K_mdp` par HKDF-SHA-256
//! (`shhdrop_core::kdf`), avec des étiquettes distinctes. Aucune crypto ici, seulement
//! l'enchaînement des dérivations.
use shhdrop_core::kdf::{hkdf, sha256};
use shhdrop_core::{KLien, KMdp};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

const ACCES: &str = "shhdrop/v2/salon/acces";
const MAITRE: &str = "shhdrop/v2/salon/maitre";
const PREUVE: &str = "shhdrop/v2/salon/preuve";
const CLE: &str = "shhdrop/v2/salon/cle";
const TRAME: &str = "shhdrop/v2/salon/trame";
const ID: &str = "shhdrop/v2/salon/id";

/// `K_accès_s` et son empreinte `V_accès_s` = SHA-256(K), donnée au serveur.
/// `k` est effacée à la destruction.
#[derive(ZeroizeOnDrop)]
pub struct CleAcces {
    pub k: [u8; 32],
    #[zeroize(skip)]
    pub v: [u8; 32],
}

/// `K_accès_s` = HKDF(`K_lien`, « shhdrop/v2/salon/acces »).
pub fn cle_acces(k_lien: &KLien) -> CleAcces {
    let k = hkdf::<32>(k_lien.as_bytes(), ACCES);
    CleAcces {
        k: *k,
        v: sha256(&*k),
    }
}

/// Clés dérivées de `K_maître_s` : preuve de destruction, clé des trames et étiquette (tag)
/// du salon. Effacées à la destruction ; `K_maître_s` et `K_salon` ne sont pas conservées.
#[derive(ZeroizeOnDrop)]
pub struct ClesSalon {
    k_preuve: [u8; 32],
    k_trame: [u8; 32],
    tag: [u8; 16],
}

impl ClesSalon {
    pub fn k_preuve(&self) -> &[u8; 32] {
        &self.k_preuve
    }

    /// `V_preuve_s` = SHA-256(`K_preuve_s`), donnée au serveur à la création.
    pub fn v_preuve(&self) -> [u8; 32] {
        sha256(&self.k_preuve)
    }

    pub fn k_trame(&self) -> &[u8; 32] {
        &self.k_trame
    }

    /// Identifiant public du salon (16 octets), authentifié dans chaque trame.
    pub fn tag(&self) -> &[u8; 16] {
        &self.tag
    }
}

#[cfg(test)]
impl ClesSalon {
    /// Tests seulement : même `K_trame` mais autre étiquette de salon.
    pub(crate) fn tag_pour_test(&mut self, tag: [u8; 16]) {
        self.tag = tag;
    }
}

impl core::fmt::Debug for ClesSalon {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("ClesSalon(…)")
    }
}

/// `K_maître_s` = HKDF(`K_lien` ‖ `K_mdp`, « shhdrop/v2/salon/maitre ») : la seule clé que le
/// créateur distribue aux membres restants à une rotation de l'invitation (message `rotation`,
/// §39.13.2), et celle que garde la preuve de membre (D41-26). Jamais `K_lien`, `K_mdp` ni le
/// mot de passe : ils donnent `K_accès_s`, donc le droit d'entrer. SECRET, effacé à la
/// destruction.
pub fn cle_maitre(k_lien: &KLien, k_mdp: &KMdp) -> Zeroizing<[u8; 32]> {
    let mut ikm = Zeroizing::new([0u8; 64]);
    ikm[..32].copy_from_slice(k_lien.as_bytes());
    ikm[32..].copy_from_slice(k_mdp.as_bytes());
    let maitre = hkdf::<32>(&*ikm, MAITRE);
    ikm.zeroize();
    maitre
}

/// Clés du salon tirées de `K_lien` et `K_mdp` : `cles_depuis_maitre(cle_maitre(…))`.
pub fn cles_salon(k_lien: &KLien, k_mdp: &KMdp) -> ClesSalon {
    cles_depuis_maitre(&cle_maitre(k_lien, k_mdp))
}

/// Clés du salon tirées de `K_maître_s` seule (membre qui reçoit `K_maître_s'` à une rotation,
/// ou qui revient par sa preuve de membre) : `preuve` et `cle` (`K_salon`) depuis `K_maître_s`,
/// `trame` et `id` depuis `K_salon`. Mêmes clés que `cles_salon` pour la même invitation.
pub fn cles_depuis_maitre(maitre: &[u8; 32]) -> ClesSalon {
    let k_preuve = hkdf::<32>(maitre, PREUVE);
    let k_salon = hkdf::<32>(maitre, CLE);
    let k_trame = hkdf::<32>(&*k_salon, TRAME);
    let tag = hkdf::<16>(&*k_salon, ID);
    ClesSalon {
        k_preuve: *k_preuve,
        k_trame: *k_trame,
        tag: *tag,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entrees(a: u8, b: u8) -> (KLien, KMdp) {
        (KLien::from_bytes([a; 32]), KMdp::from_bytes([b; 32]))
    }

    #[test]
    fn etiquettes_distinctes() {
        let (l, m) = entrees(1, 2);
        let c = cles_salon(&l, &m);
        let a = cle_acces(&l);
        let sorties: [&[u8]; 5] = [&a.k, c.k_preuve(), c.k_trame(), c.tag(), &c.v_preuve()];
        for i in 0..sorties.len() {
            for j in i + 1..sorties.len() {
                assert_ne!(sorties[i], sorties[j], "{i} et {j}");
            }
        }
        // Le tag et la clé de trame viennent tous deux de K_salon : pas de préfixe commun.
        assert_ne!(&c.k_trame()[..16], &c.tag()[..]);
    }

    #[test]
    fn deterministe() {
        let (l, m) = entrees(1, 2);
        let (a, b) = (cles_salon(&l, &m), cles_salon(&l, &m));
        assert_eq!(a.k_preuve(), b.k_preuve());
        assert_eq!(a.k_trame(), b.k_trame());
        assert_eq!(a.tag(), b.tag());
        assert_eq!(cle_acces(&l).k, cle_acces(&l).k);
    }

    #[test]
    fn autre_mdp_autres_cles() {
        let (l, m) = entrees(1, 2);
        let (_, m2) = entrees(1, 3);
        let (l2, _) = entrees(9, 2);
        let a = cles_salon(&l, &m);
        for b in [cles_salon(&l, &m2), cles_salon(&l2, &m)] {
            assert_ne!(a.k_preuve(), b.k_preuve());
            assert_ne!(a.k_trame(), b.k_trame());
            assert_ne!(a.tag(), b.tag());
        }
        // K_accès ne dépend que de K_lien.
        assert_ne!(cle_acces(&l).k, cle_acces(&l2).k);
    }

    /// F4 (audit du 13 novembre) : `K_maître_s` suffit à refaire les clés du salon.
    #[test]
    fn depuis_la_cle_maitre() {
        let (l, m) = entrees(1, 2);
        let maitre = cle_maitre(&l, &m);
        let mut ikm = [0u8; 64];
        ikm[..32].copy_from_slice(l.as_bytes());
        ikm[32..].copy_from_slice(m.as_bytes());
        assert_eq!(*maitre, *hkdf::<32>(&ikm, "shhdrop/v2/salon/maitre"));
        let (a, b) = (cles_salon(&l, &m), cles_depuis_maitre(&maitre));
        assert_eq!(a.k_preuve(), b.k_preuve());
        assert_eq!(a.k_trame(), b.k_trame());
        assert_eq!(a.tag(), b.tag());
        // La clé maîtresse n'est aucune des clés dérivées, ni K_accès.
        for k in [a.k_preuve(), a.k_trame(), &cle_acces(&l).k] {
            assert_ne!(&*maitre, k);
        }
    }

    #[test]
    fn v_preuve_est_sha256() {
        let (l, m) = entrees(1, 2);
        let c = cles_salon(&l, &m);
        assert_eq!(c.v_preuve(), shhdrop_core::kdf::sha256(c.k_preuve()));
        let a = cle_acces(&l);
        assert_eq!(a.v, shhdrop_core::kdf::sha256(&a.k));
    }

    #[test]
    fn chaine_de_derivation() {
        // Recalcul indépendant de la chaîne avec les étiquettes écrites en toutes lettres.
        let (l, m) = entrees(1, 2);
        let mut ikm = [0u8; 64];
        ikm[..32].copy_from_slice(l.as_bytes());
        ikm[32..].copy_from_slice(m.as_bytes());
        let maitre = hkdf::<32>(&ikm, "shhdrop/v2/salon/maitre");
        let salon = hkdf::<32>(&*maitre, "shhdrop/v2/salon/cle");
        let c = cles_salon(&l, &m);
        assert_eq!(
            c.k_preuve(),
            &*hkdf::<32>(&*maitre, "shhdrop/v2/salon/preuve")
        );
        assert_eq!(c.k_trame(), &*hkdf::<32>(&*salon, "shhdrop/v2/salon/trame"));
        assert_eq!(c.tag(), &*hkdf::<16>(&*salon, "shhdrop/v2/salon/id"));
        assert_eq!(
            cle_acces(&l).k,
            *hkdf::<32>(l.as_bytes(), "shhdrop/v2/salon/acces")
        );
    }
}
