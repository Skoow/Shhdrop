// Robustesse : 100 000 entrées pseudo-aléatoires (xorshift32, graine fixe, donc rejouable) pour
// chaque fonction qui lit des octets ou du texte venus de l'extérieur. Aucune ne doit paniquer
// (`catch_unwind`) ; les erreurs, elles, sont attendues. Durée : quelques secondes en debug
// (mesurée, voir le rapport de la Task 8) : pas besoin de le réserver à la CI en release.
use shhdrop_core::{KLien, KMdp};
use shhdrop_salon::{
    ClesSalon, EnTete, Enveloppe, Message, Regle, TAILLE_TRAME, cles_salon, decoder, encoder,
    lire_en_tete, nettoyer_texte, ouvrir, sceller, verifier_pseudo,
};
use std::panic::{AssertUnwindSafe, catch_unwind};

const N: usize = 100_000;

/// xorshift32 (x ^= x << 13, x ^= x >> 17, x ^= x << 5), état initial non nul.
struct Xs(u32);

impl Xs {
    fn next(&mut self) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        self.next() as usize % n
    }
    fn bytes(&mut self, len: usize) -> Vec<u8> {
        (0..len).map(|_| self.next() as u8).collect()
    }
}

/// Appelle `f` sur chacune des `N` entrées et compte les paniques ; les entrées en cause sont
/// affichées (en hex, tronquées) pour pouvoir les rejouer.
fn sans_panique<T: AsRef<[u8]>>(nom: &str, mut entree: impl FnMut(usize) -> T, f: impl Fn(&T)) {
    let mut paniques = 0;
    for i in 0..N {
        let x = entree(i);
        if catch_unwind(AssertUnwindSafe(|| f(&x))).is_err() {
            paniques += 1;
            if paniques <= 3 {
                let b = x.as_ref();
                let h: String = b.iter().take(64).map(|c| format!("{c:02x}")).collect();
                eprintln!("{nom} : panique à l'entrée {i} ({} octets) : {h}", b.len());
            }
        }
    }
    assert_eq!(paniques, 0, "{nom} : {paniques} paniques sur {N} entrées");
}

fn cles() -> ClesSalon {
    cles_salon(&KLien::from_bytes([7; 32]), &KMdp::from_bytes([9; 32]))
}

/// Une trame valide de départ, puis des variantes : octets tirés au hasard, trame valide dont
/// quelques octets changent, tailles voisines de 4 140.
fn trame(rng: &mut Xs, base: &[u8]) -> Vec<u8> {
    match rng.below(4) {
        0 => {
            let n = rng.below(5000);
            rng.bytes(n)
        }
        1 => {
            let mut t = base.to_vec();
            for _ in 0..=rng.below(3) {
                let at = rng.below(t.len());
                t[at] ^= (rng.next() as u8) | 1;
            }
            t
        }
        2 => {
            let mut t = base.to_vec();
            let n = (TAILLE_TRAME + rng.below(5)).saturating_sub(2);
            t.resize(n, rng.next() as u8);
            t.truncate(n);
            t
        }
        _ => {
            // Marque et drapeaux valides, reste au hasard.
            let mut t = rng.bytes(TAILLE_TRAME);
            t[..4].copy_from_slice(b"SHC3");
            t[4] = (rng.next() % 16) as u8;
            t
        }
    }
}

fn trame_valide(cles: &ClesSalon) -> Vec<u8> {
    let charge = encoder(&Enveloppe {
        id: [1; 16],
        heure_ms: 1,
        regle: Regle::Desactive,
        message: Message::Texte { x: "Allo".into() },
    })
    .unwrap();
    let en_tete = EnTete {
        volatile: false,
        regle: Regle::Desactive,
    };
    sceller(cles, en_tete, &charge).unwrap().to_vec()
}

#[test]
fn ouvrir_et_lire_en_tete_sans_panique() {
    let c = cles();
    let base = trame_valide(&c);
    let mut rng = Xs(0x1234_5678);
    sans_panique(
        "ouvrir",
        |_| trame(&mut rng, &base),
        |t| {
            let _ = ouvrir(&c, t);
        },
    );
    let mut rng = Xs(0x0BAD_CAFE);
    sans_panique(
        "lire_en_tete",
        |_| trame(&mut rng, &base),
        |t| {
            let _ = lire_en_tete(t);
        },
    );
}

/// Charges de message : octets quelconques, JSON presque valide (un octet change, ou la fin est
/// coupée), JSON de structure variée.
fn charge(rng: &mut Xs, modeles: &[Vec<u8>]) -> Vec<u8> {
    match rng.below(5) {
        0 => {
            let n = rng.below(4200);
            rng.bytes(n)
        }
        1 | 2 => {
            let mut m = modeles[rng.below(modeles.len())].clone();
            for _ in 0..=rng.below(2) {
                let at = rng.below(m.len());
                m[at] = rng.next() as u8;
            }
            m
        }
        3 => {
            let mut m = modeles[rng.below(modeles.len())].clone();
            m.truncate(rng.below(m.len() + 1));
            m
        }
        _ => {
            // Fragments de JSON mis bout à bout.
            const MORCEAUX: [&str; 16] = [
                "{",
                "}",
                "[",
                "]",
                "\"",
                ":",
                ",",
                "null",
                "1e999",
                "-0",
                "\\u0000",
                "\\ud800",
                "\"k\":\"texte\"",
                "\"v\":3",
                "\"x\":\"a\"",
                "9007199254740993",
            ];
            let mut s = String::new();
            for _ in 0..=rng.below(40) {
                s.push_str(MORCEAUX[rng.below(MORCEAUX.len())]);
            }
            s.into_bytes()
        }
    }
}

fn modeles() -> Vec<Vec<u8>> {
    let r = [
        Message::Texte {
            x: "Allo été".into(),
        },
        Message::Ecrit,
        Message::Depart,
        Message::Rotation {
            n: 3,
            cle: shhdrop_salon::Graine::new([6; 32]),
        },
    ];
    let mut v: Vec<Vec<u8>> = r
        .into_iter()
        .map(|message| {
            encoder(&Enveloppe {
                id: [5; 16],
                heure_ms: 1_700_000_000_000,
                regle: Regle::UneHeure,
                message,
            })
            .unwrap()
            .to_vec()
        })
        .collect();
    v.push(
        br#"{"v":3,"id":"AAAAAAAAAAAAAAAAAAAAAA","t":1,"e":0,"k":"profil","pseudo":"Alice","couleur":3,"avatar":null}"#
            .to_vec(),
    );
    v.push(
        br#"{"v":3,"id":"AAAAAAAAAAAAAAAAAAAAAA","t":1,"e":0,"k":"vu","ids":["AAAAAAAAAAAAAAAAAAAAAA"]}"#
            .to_vec(),
    );
    v
}

#[test]
fn decoder_sans_panique() {
    let m = modeles();
    let mut rng = Xs(0xDEC0_DE01);
    sans_panique(
        "decoder",
        |_| charge(&mut rng, &m),
        |b| {
            let _ = decoder(b);
        },
    );
}

/// Texte tiré de points de code choisis pour les cas durs (marques, étiquettes, invisibles,
/// émojis, écritures variées) ou de n'importe quel caractère valide.
fn texte(rng: &mut Xs) -> String {
    const POOL: [char; 40] = [
        'a',
        'Z',
        '0',
        ' ',
        '\n',
        '\t',
        '\u{0}',
        '\u{7f}',
        '\u{85}',
        '\'',
        '\u{2019}',
        '-',
        '\u{301}',
        '\u{334}',
        '\u{200B}',
        '\u{200D}',
        '\u{202E}',
        '\u{2066}',
        '\u{FE0F}',
        '\u{E0067}',
        '\u{E007F}',
        '\u{1F3F4}',
        '😀',
        '🇫',
        '\u{1F3FD}',
        'é',
        'Å',
        '\u{212B}',
        'А',
        'α',
        '한',
        '\u{1100}',
        '日',
        'ひ',
        'ㄅ',
        'م',
        'ש',
        'न',
        '\u{94D}',
        '\u{FFFD}',
    ];
    let n = if rng.below(50) == 0 {
        rng.below(5000)
    } else {
        rng.below(40)
    };
    (0..n)
        .map(|_| {
            if rng.below(4) == 0 {
                loop {
                    if let Some(c) = char::from_u32(rng.next() % 0x11_0000) {
                        break c;
                    }
                }
            } else {
                POOL[rng.below(POOL.len())]
            }
        })
        .collect()
}

#[test]
fn nettoyer_texte_sans_panique() {
    let mut rng = Xs(0x7E57_0001);
    sans_panique(
        "nettoyer_texte",
        |_| texte(&mut rng),
        |s| {
            let _ = nettoyer_texte(s);
        },
    );
}

#[test]
fn verifier_pseudo_sans_panique() {
    let mut rng = Xs(0x7E57_0002);
    sans_panique(
        "verifier_pseudo",
        |_| texte(&mut rng),
        |s| {
            let _ = verifier_pseudo(s);
        },
    );
}
