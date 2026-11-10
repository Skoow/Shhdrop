//! Secrets de 32 octets, chacun dans son type : le compilateur refuse de passer K_lien là où
//! S_gestion est attendu (comme les types marqués de `crypto/types.ts`). Ni `Clone` ni `Copy` ;
//! mis à zéro à la destruction ; `Debug` n'affiche jamais les octets.
use core::fmt;
use zeroize::Zeroize;

macro_rules! secret32 {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        pub struct $name([u8; 32]);

        impl $name {
            pub const fn from_bytes(bytes: [u8; 32]) -> Self {
                Self(bytes)
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
    KLien
);
secret32!(
    /// Secret de gestion, dans le fragment du lien de gestion.
    SGestion
);
secret32!(
    /// K_accès = HKDF(K_lien, « shhdrop/v2/acces ») : son empreinte V_accès est donnée au serveur.
    KAcces
);
secret32!(
    /// K_mdp = Argon2id(mot de passe NFC, sel) : ne quitte jamais l'appareil.
    KMdp
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
    }
}
