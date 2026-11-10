//! Secrets de 32 octets, chacun dans son type : le compilateur refuse de passer K_lien là où
//! S_gestion est attendu (comme les types marqués de `crypto/types.ts`). Ni `Clone` ni `Copy` ;
//! mis à zéro à la destruction ; `Debug` n'affiche jamais les octets.
use crate::error::{Error, Result};
use core::fmt;
use zeroize::Zeroize;

macro_rules! secret32 {
    ($(#[$doc:meta])* $name:ident, $size_error:expr) => {
        $(#[$doc])*
        pub struct $name([u8; 32]);

        impl $name {
            pub const fn from_bytes(bytes: [u8; 32]) -> Self {
                Self(bytes)
            }

            /// Octets de taille libre (venus de l'hôte) : refus si ce ne sont pas 32 octets.
            pub fn from_slice(bytes: &[u8]) -> Result<Self> {
                <[u8; 32]>::try_from(bytes)
                    .map(Self)
                    .map_err(|_| $size_error)
            }

            pub const fn as_bytes(&self) -> &[u8; 32] {
                &self.0
            }
        }

        impl Drop for $name {
            fn drop(&mut self) {
                self.0.zeroize();
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(concat!(stringify!($name), "(…)"))
            }
        }
    };
}

secret32!(
    /// Clé du lien, dans le fragment (#) du lien de partage : ne quitte jamais l'appareil.
    KLien,
    Error::TailleInvalide
);
secret32!(
    /// Secret de gestion, dans le fragment du lien de gestion.
    SGestion,
    Error::TailleInvalide
);
secret32!(
    /// K_accès = HKDF(K_lien, « shhdrop/v2/acces ») : son empreinte V_accès est donnée au serveur.
    KAcces,
    Error::TailleInvalide
);
secret32!(
    /// K_mdp = Argon2id(mot de passe NFC, sel) : ne quitte jamais l'appareil.
    KMdp,
    Error::TailleInvalide
);
secret32!(
    /// K_preuve = HKDF(K_maître, « shhdrop/v2/preuve ») : montrée au serveur pour détruire,
    /// qui ne garde que V_preuve = SHA-256(K_preuve).
    KPreuve,
    Error::TailleInvalide
);
secret32!(
    /// Graine de contenu R (32 octets aléatoires) : jamais envoyée en clair, seulement dans
    /// l'enveloppe E. Tirée par `envelope::new_seed`, déballée par `envelope::open`.
    Seed,
    Error::GraineInvalide
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_sans_les_octets() {
        assert_eq!(format!("{:?}", KLien::from_bytes([7; 32])), "KLien(…)");
        assert_eq!(
            format!("{:?}", SGestion::from_bytes([7; 32])),
            "SGestion(…)"
        );
        assert_eq!(format!("{:?}", KAcces::from_bytes([7; 32])), "KAcces(…)");
        assert_eq!(format!("{:?}", KMdp::from_bytes([7; 32])), "KMdp(…)");
        assert_eq!(format!("{:?}", KPreuve::from_bytes([7; 32])), "KPreuve(…)");
        assert_eq!(format!("{:?}", Seed::from_bytes([7; 32])), "Seed(…)");
    }

    #[test]
    fn from_slice_exige_32_octets() {
        assert_eq!(KLien::from_slice(&[1; 32]).unwrap().as_bytes(), &[1; 32]);
        assert_eq!(Seed::from_slice(&[3; 32]).unwrap().as_bytes(), &[3; 32]);
        for n in [0, 31, 33] {
            let b = vec![1; n];
            assert_eq!(KLien::from_slice(&b).unwrap_err(), Error::TailleInvalide);
            assert_eq!(KMdp::from_slice(&b).unwrap_err(), Error::TailleInvalide);
            assert_eq!(Seed::from_slice(&b).unwrap_err(), Error::GraineInvalide);
        }
    }
}
