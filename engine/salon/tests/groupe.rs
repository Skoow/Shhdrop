//! Groupe MLS du salon (Task 6) : 10 membres sauf mention. Le « réseau » des tests joue le
//! serveur : il numérote chaque message MLS (`seq`) et le remet à tous les membres, expéditeur
//! compris (§39.3.1 : la trame est renvoyée à son expéditeur).
use shhdrop_core::{KLien, KMdp};
use shhdrop_salon::politique::{Changements, verifier};
use shhdrop_salon::{
    ClesSalon, Enveloppe, Error, Evenement, MAX_CHARGE, Message, Regle, Salon, cles_salon,
    nouvelle_identite,
};

fn cles() -> ClesSalon {
    cles_salon(&KLien::from_bytes([1; 32]), &KMdp::from_bytes([2; 32]))
}

/// `nonce_arrivee` du siège pour sa `n`-ième arrivée.
fn nonce(siege: u8, n: u8) -> [u8; 16] {
    let mut x = [0xA0 ^ n; 16];
    x[0] = siege;
    x[1] = n;
    x
}

fn env(k: u32) -> Enveloppe {
    Enveloppe {
        id: [k as u8; 16],
        heure_ms: 1_700_000_000_000 + u64::from(k),
        regle: Regle::Desactive,
        message: Message::Texte {
            x: format!("message {k}"),
        },
    }
}

/// Membres indexés par siège (`None` : siège vide) et compteur `seq` du serveur.
struct Reseau {
    m: Vec<Option<Salon>>,
    seq: u64,
}

impl Reseau {
    fn salon(&mut self, s: usize) -> &mut Salon {
        self.m[s].as_mut().unwrap()
    }

    /// Le serveur range `mls` au rang suivant et le remet à tous.
    fn diffuser(&mut self, mls: &[u8]) -> Vec<(usize, Result<Evenement, Error>)> {
        self.seq += 1;
        let seq = self.seq;
        self.m
            .iter_mut()
            .enumerate()
            .filter_map(|(i, s)| s.as_mut().map(|s| (i, s.recevoir(mls, seq))))
            .collect()
    }

    fn annoncer(&mut self, siege: u8, n: [u8; 16]) {
        for s in self.m.iter_mut().flatten() {
            s.annoncer(siege, n);
        }
    }

    /// Arrivée au siège `siege` (arrivée numéro `n`) : annonce du serveur, KeyPackage diffusé
    /// (reconnu par chacun), ajout par `adder`, Welcome rendu à l'écho gagnant du Commit.
    fn arrivee(&mut self, adder: usize, siege: u8, n: u8, retires: Vec<u8>) {
        let mut nouveau = Salon::creer(
            nouvelle_identite(siege, nonce(siege, n)).unwrap(),
            cles(),
            false,
        )
        .unwrap();
        let kp = nouveau.key_package().unwrap();
        self.annoncer(siege, nonce(siege, n));
        nouveau.annoncer(siege, nonce(siege, n));
        for (i, r) in self.diffuser(&kp) {
            assert_eq!(
                r,
                Ok(Evenement::KeyPackage { octets: kp.clone() }),
                "membre {i}"
            );
        }
        let commit = self.salon(adder).ajouter(&kp).unwrap();
        let welcome = self.commit_accepte(adder, &commit, vec![siege], retires);
        nouveau.rejoindre(&welcome.unwrap()).unwrap();
        let s = siege as usize;
        if self.m.len() <= s {
            self.m.resize_with(s + 1, || None);
        }
        self.m[s] = Some(nouveau);
    }

    /// `de` envoie un message et chacun des autres le lit ; l'expéditeur reçoit `Ignore`.
    fn message(&mut self, de: usize, k: u32) {
        let e = env(k);
        let mls = self.salon(de).chiffrer(&e).unwrap();
        assert!(mls.len() <= MAX_CHARGE);
        for (i, r) in self.diffuser(&mls) {
            if i == de {
                assert_eq!(r, Ok(Evenement::Ignore), "écho de l'expéditeur {i}");
            } else {
                assert_eq!(
                    r,
                    Ok(Evenement::Message {
                        de_siege: de as u8,
                        enveloppe: e.clone()
                    }),
                    "membre {i}, message {k}"
                );
            }
        }
    }

    /// Commit déjà créé par `de`, remis à tous : l'auteur reçoit `CommitAccepte` (et le
    /// Welcome d'un ajout, rendu ici), les autres `Membres`.
    fn commit_accepte(
        &mut self,
        de: usize,
        mls: &[u8],
        ajoutes: Vec<u8>,
        retires: Vec<u8>,
    ) -> Option<Vec<u8>> {
        let mut welcome = None;
        for (i, r) in self.diffuser(mls) {
            if i == de {
                match r {
                    Ok(Evenement::CommitAccepte { welcome: w }) => {
                        assert_eq!(w.is_some(), !ajoutes.is_empty());
                        welcome = w;
                    }
                    autre => panic!("auteur {i} : {autre:?}"),
                }
            } else {
                assert_eq!(
                    r,
                    Ok(Evenement::Membres {
                        ajoutes: ajoutes.clone(),
                        retires: retires.clone()
                    }),
                    "membre {i}"
                );
            }
        }
        welcome
    }

    fn epoques(&self) -> Vec<Option<u64>> {
        self.m.iter().flatten().map(|s| s.epoque()).collect()
    }

    fn meme_epoque(&self) -> u64 {
        let e = self.epoques();
        assert!(e.windows(2).all(|w| w[0] == w[1]), "époques {e:?}");
        e[0].unwrap()
    }
}

/// Groupe de `n` membres (sièges 0 à n-1) : le créateur (siège 0) ajoute chacun, un par un.
fn groupe(n: u8) -> Reseau {
    let createur = Salon::creer(nouvelle_identite(0, nonce(0, 0)).unwrap(), cles(), true).unwrap();
    let mut r = Reseau {
        m: vec![Some(createur)],
        seq: 0,
    };
    for s in 1..n {
        r.arrivee(0, s, 0, vec![]);
    }
    r
}

#[test]
fn dix_membres() {
    let mut r = groupe(10);
    assert_eq!(r.meme_epoque(), 9);
    for s in 0..10 {
        assert_eq!(r.salon(s).membres(), (0..10).collect::<Vec<u8>>());
    }
    for k in 0..100u32 {
        r.message((k % 10) as usize, k);
    }
}

#[test]
fn retrait() {
    let mut r = groupe(10);
    let commit = r.salon(0).retirer(9).unwrap();
    r.commit_accepte(0, &commit, vec![], vec![9]);
    let e = r.epoques();
    assert!(e[..9].windows(2).all(|w| w[0] == w[1]));
    // Le retiré ne lit plus le message suivant ni n'écrit.
    let mls = r.salon(1).chiffrer(&env(1)).unwrap();
    r.seq += 1;
    let seq = r.seq;
    let lu = r.salon(9).recevoir(&mls, seq);
    assert!(
        matches!(lu, Err(Error::NonMembre) | Ok(Evenement::Ignore)),
        "{lu:?}"
    );
    assert_eq!(r.salon(9).chiffrer(&env(2)), Err(Error::NonMembre));
    assert_eq!(
        r.salon(9).exporter_sframe().map(|_| ()),
        Err(Error::NonMembre)
    );
    r.m[9] = None;
    for s in 0..9 {
        assert_eq!(r.salon(s).membres(), (0..9).collect::<Vec<u8>>());
    }
    r.message(4, 3);
    // Siège vide : rien à retirer.
    assert_eq!(r.salon(0).retirer(9), Err(Error::SiegeInconnu));
}

#[test]
fn renouvellement() {
    let mut r = groupe(10);
    let e0 = r.meme_epoque();
    let k0 = r.salon(0).exporter_sframe().unwrap();
    let commit = r.salon(3).renouveler().unwrap();
    assert!(commit.len() <= MAX_CHARGE);
    r.commit_accepte(3, &commit, vec![], vec![]);
    assert_eq!(r.meme_epoque(), e0 + 1);
    assert_ne!(*r.salon(0).exporter_sframe().unwrap(), *k0);
    r.message(3, 1);
    r.message(7, 2);
}

/// Review Focus 1 : deux Commits sur la même époque ; le premier dans l'ordre `seq` gagne chez
/// tous, le perdant le sait (`CommitPerdu`) et rejoue ; personne ne reste sur une branche.
#[test]
fn commits_concurrents() {
    let mut r = groupe(10);
    let e0 = r.meme_epoque();
    let a = r.salon(2).renouveler().unwrap();
    let b = r.salon(5).renouveler().unwrap();
    // Tant que son Commit attend, l'auteur n'en fait pas d'autre.
    assert_eq!(r.salon(5).renouveler(), Err(Error::CommitEnCours));
    for (i, ev) in r.diffuser(&a) {
        let attendu = if i == 5 {
            Evenement::CommitPerdu
        } else if i == 2 {
            Evenement::CommitAccepte { welcome: None }
        } else {
            Evenement::Membres {
                ajoutes: vec![],
                retires: vec![],
            }
        };
        assert_eq!(ev, Ok(attendu), "membre {i}");
    }
    for (i, ev) in r.diffuser(&b) {
        assert_eq!(ev, Ok(Evenement::Ignore), "commit perdant chez {i}");
    }
    assert_eq!(r.meme_epoque(), e0 + 1);
    r.message(5, 1);
    // Le perdant rejoue.
    let b2 = r.salon(5).renouveler().unwrap();
    r.commit_accepte(5, &b2, vec![], vec![]);
    assert_eq!(r.meme_epoque(), e0 + 2);
    let k = r.salon(0).exporter_sframe().unwrap();
    for s in 1..10 {
        assert_eq!(*r.salon(s).exporter_sframe().unwrap(), *k);
    }
    r.message(2, 2);
}

/// Un ajout perd contre un renouvellement : l'ajouteur rejoue l'ajout avec le même KeyPackage,
/// l'arrivant n'utilise que le Welcome du Commit gagnant.
#[test]
fn ajout_perdu_puis_rejoue() {
    let mut r = groupe(9);
    let mut nouveau =
        Salon::creer(nouvelle_identite(9, nonce(9, 0)).unwrap(), cles(), false).unwrap();
    let kp = nouveau.key_package().unwrap();
    r.annoncer(9, nonce(9, 0));
    // Le Commit d'ajout ne donne pas de Welcome : il n'existe qu'à l'écho gagnant.
    let ajout = r.salon(0).ajouter(&kp).unwrap();
    let maj = r.salon(4).renouveler().unwrap();
    for (i, ev) in r.diffuser(&maj) {
        // Perdu : le Welcome de l'ajout est jeté avec le Commit.
        let attendu = if i == 0 {
            Evenement::CommitPerdu
        } else if i == 4 {
            Evenement::CommitAccepte { welcome: None }
        } else {
            Evenement::Membres {
                ajoutes: vec![],
                retires: vec![],
            }
        };
        assert_eq!(ev, Ok(attendu), "membre {i}");
    }
    for (_, ev) in r.diffuser(&ajout) {
        assert_eq!(ev, Ok(Evenement::Ignore));
    }
    let ajout2 = r.salon(0).ajouter(&kp).unwrap();
    let welcome = r.commit_accepte(0, &ajout2, vec![9], vec![]).unwrap();
    nouveau.rejoindre(&welcome).unwrap();
    r.m.push(Some(nouveau));
    r.meme_epoque();
    r.message(9, 1);
    r.message(0, 2);
}

/// Review Focus 2 : un message envoyé juste avant un Commit et rangé après reste lisible.
#[test]
fn message_epoque_precedente() {
    let mut r = groupe(10);
    let e = env(7);
    let vieux = r.salon(4).chiffrer(&e).unwrap();
    let commit = r.salon(0).renouveler().unwrap();
    r.commit_accepte(0, &commit, vec![], vec![]);
    for (i, ev) in r.diffuser(&vieux) {
        if i == 4 {
            assert_eq!(ev, Ok(Evenement::Ignore));
        } else {
            assert_eq!(
                ev,
                Ok(Evenement::Message {
                    de_siege: 4,
                    enveloppe: e.clone()
                }),
                "membre {i}"
            );
        }
    }
}

/// Review Focus 2 : deux époques plus tard, refus propre.
#[test]
fn deux_epoques_trop_vieux() {
    let mut r = groupe(10);
    let vieux = r.salon(4).chiffrer(&env(7)).unwrap();
    let c1 = r.salon(0).renouveler().unwrap();
    r.commit_accepte(0, &c1, vec![], vec![]);
    let c2 = r.salon(1).renouveler().unwrap();
    r.commit_accepte(1, &c2, vec![], vec![]);
    for (i, ev) in r.diffuser(&vieux) {
        assert_eq!(ev, Err(Error::EpoquePerdue), "membre {i}");
    }
    r.message(4, 8);
}

/// Review Focus 4 : retrait par un non-créateur, ajout sans siège annoncé → refus, l'état du
/// groupe ne change pas.
#[test]
fn politique_refuse() {
    let mut r = groupe(9);
    let e0 = r.meme_epoque();
    // Retrait par un non-créateur : refusé avant tout Commit.
    assert_eq!(r.salon(3).retirer(5), Err(Error::CommitRefuse));
    // Ajout d'un KeyPackage dont le siège n'est pas annoncé (ou d'un autre nonce).
    let inconnu = Salon::creer(nouvelle_identite(9, nonce(9, 0)).unwrap(), cles(), false).unwrap();
    let kp = inconnu.key_package().unwrap();
    assert_eq!(r.salon(0).ajouter(&kp), Err(Error::CommitRefuse));
    r.annoncer(9, nonce(9, 1));
    assert_eq!(r.salon(0).ajouter(&kp), Err(Error::CommitRefuse));
    // Aucun Commit n'est resté en attente : l'auteur peut encore agir.
    assert_eq!(r.meme_epoque(), e0);
    r.message(3, 1);

    // Côté réception : seul le siège 0 a vu l'annonce (nonce 2) ; les autres refusent le Commit
    // sans fusion et continuent entre eux.
    let kp_nonce = Salon::creer(nouvelle_identite(9, nonce(9, 2)).unwrap(), cles(), false).unwrap();
    let kp2 = kp_nonce.key_package().unwrap();
    r.salon(0).annoncer(9, nonce(9, 2));
    let commit = r.salon(0).ajouter(&kp2).unwrap();
    for (i, ev) in r.diffuser(&commit) {
        if i != 0 {
            assert_eq!(ev, Err(Error::CommitRefuse), "membre {i}");
            assert_eq!(r.m[i].as_ref().unwrap().epoque(), Some(e0), "membre {i}");
        }
    }
    r.m[0] = None;
    for s in 1..9 {
        assert_eq!(r.salon(s).membres(), (0..9).collect::<Vec<u8>>());
    }
    r.message(2, 2);
}

/// La politique seule (le Commit hostile fabriqué par un membre est testé dans `groupe.rs`).
#[test]
fn politique_regles() {
    let annonces = [(4u8, nonce(4, 0)), (5, nonce(5, 1))];
    // Feuilles retirées : leur nonce d'arrivée numéro 0.
    let v =
        |ajouts: &[(u8, [u8; 16])], retraits: &[u8], restants: &[u8], auteur: u8, partis: &[u8]| {
            let ch = Changements {
                ajouts: ajouts.to_vec(),
                retraits: retraits.iter().map(|&s| (s, nonce(s, 0))).collect(),
                restants: restants.to_vec(),
                interdit: false,
            };
            verifier(&ch, 0, auteur, &annonces, partis)
        };
    let refus = Err(Error::CommitRefuse);
    // Renouvellement seul.
    assert_eq!(v(&[], &[], &[0, 1, 2], 1, &[]), Ok(()));
    // Ajout annoncé ; non annoncé ; d'un ancien nonce.
    assert_eq!(v(&[(4, nonce(4, 0))], &[], &[0, 1], 1, &[]), Ok(()));
    assert_eq!(v(&[(6, nonce(6, 0))], &[], &[0, 1], 1, &[]), refus);
    assert_eq!(v(&[(5, nonce(5, 0))], &[], &[0, 1], 1, &[]), refus);
    // Retrait par le créateur ; par un autre : refusé, sauf siège parti ou exclu.
    assert_eq!(v(&[], &[2], &[0, 1], 0, &[]), Ok(()));
    assert_eq!(v(&[], &[2], &[0, 1], 1, &[]), refus);
    assert_eq!(v(&[], &[2], &[0, 1], 1, &[2]), Ok(()));
    assert_eq!(v(&[], &[2, 3], &[0, 1], 1, &[2]), refus);
    // Retrait d'une feuille de son propre siège.
    assert_eq!(v(&[], &[1], &[0, 1], 1, &[]), Ok(()));
    // Retour : l'ancienne feuille du siège 5 retirée par le Commit qui ajoute la nouvelle.
    assert_eq!(v(&[(5, nonce(5, 1))], &[5], &[0, 1], 1, &[]), Ok(()));
    // Même nonce que la feuille retirée : rejeu d'un ancien KeyPackage, refusé.
    let rejeu = [(4u8, nonce(4, 0))];
    assert_eq!(v(&rejeu, &[4], &[0, 1], 1, &[]), refus);
    assert_eq!(v(&rejeu, &[4], &[0, 1], 0, &[]), refus);
    // Nouvelle feuille d'un siège dont l'ancienne reste : refusé (deux feuilles par siège).
    assert_eq!(v(&[(5, nonce(5, 1))], &[], &[0, 1, 5], 1, &[]), refus);
    // Deux ajouts du même siège.
    assert_eq!(
        v(&[(4, nonce(4, 0)), (4, nonce(4, 0))], &[], &[0], 0, &[]),
        refus
    );
    // Proposition interdite.
    let x = Changements {
        interdit: true,
        ..Changements::default()
    };
    assert_eq!(verifier(&x, 0, 0, &annonces, &[]), refus);
}

/// Review Focus 5 : le siège 3 revient avec une nouvelle identité ; un non-créateur retire
/// l'ancienne feuille et ajoute la nouvelle dans le même Commit ; tous continuent.
#[test]
fn retour_nouvelle_feuille() {
    let mut r = groupe(10);
    let avant = r.salon(0).empreinte(3).unwrap();
    let mut ancien = r.m[3].take().unwrap();
    // L'ancienne instance reste joignable (l'onglet rechargé n'a pas encore disparu).
    let mut nouveau =
        Salon::creer(nouvelle_identite(3, nonce(3, 1)).unwrap(), cles(), false).unwrap();
    let kp = nouveau.key_package().unwrap();
    r.annoncer(3, nonce(3, 1));
    ancien.annoncer(3, nonce(3, 1));
    let commit = r.salon(1).ajouter(&kp).unwrap();
    let welcome = r.commit_accepte(1, &commit, vec![3], vec![3]).unwrap();
    r.seq += 1;
    assert_eq!(
        ancien.recevoir(&commit, r.seq),
        Ok(Evenement::Membres {
            ajoutes: vec![3],
            retires: vec![3]
        })
    );
    nouveau.rejoindre(&welcome).unwrap();
    r.m[3] = Some(nouveau);
    r.meme_epoque();
    for s in 0..10 {
        assert_eq!(r.salon(s).membres(), (0..10).collect::<Vec<u8>>());
    }
    r.message(3, 1);
    r.message(0, 2);
    r.message(9, 3);
    // L'ancienne feuille ne lit plus rien.
    let mls = r.salon(2).chiffrer(&env(4)).unwrap();
    r.seq += 1;
    assert!(matches!(
        ancien.recevoir(&mls, r.seq),
        Err(Error::NonMembre) | Ok(Evenement::Ignore)
    ));
    // Nouvelle clé, nouveau code, le même chez tous.
    let apres = r.salon(0).empreinte(3).unwrap();
    assert_ne!(avant, apres);
    for s in 1..10 {
        assert_eq!(r.salon(s).empreinte(3).unwrap(), apres);
    }
    // L'ancien KeyPackage (nonce remplacé) ne peut plus être rajouté.
    let revenant = Salon::creer(nouvelle_identite(3, nonce(3, 0)).unwrap(), cles(), false).unwrap();
    let vieux_kp = revenant.key_package().unwrap();
    assert_eq!(r.salon(1).ajouter(&vieux_kp), Err(Error::CommitRefuse));
    // Le KeyPackage déjà ajouté, rejoué par le serveur : ni signalé, ni rajouté (il
    // chasserait la feuille vivante du siège 3).
    for (i, ev) in r.diffuser(&kp) {
        assert_eq!(ev, Ok(Evenement::Ignore), "membre {i}");
    }
    assert_eq!(r.salon(1).ajouter(&kp), Err(Error::CommitRefuse));
    assert_eq!(r.salon(0).ajouter(&kp), Err(Error::CommitRefuse));
    r.message(3, 5);
}

/// Générateur déterministe des tests (xorshift64*), sans dépendance.
struct Alea(u64);
impl Alea {
    fn suivant(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn octets(&mut self, n: usize) -> Vec<u8> {
        (0..n).map(|_| self.suivant() as u8).collect()
    }
}

/// Review Focus 3 : octets MLS hostiles → erreur typée, jamais de panique ni d'événement.
#[test]
fn octets_aleatoires() {
    let mut r = groupe(10);
    let mut a = Alea(0x5EED_5A10_0000_0001);
    for _ in 0..1000 {
        let n = (a.suivant() % (MAX_CHARGE as u64 + 1)) as usize;
        let x = a.octets(n);
        r.seq += 1;
        let seq = r.seq;
        assert!(r.salon(1).recevoir(&x, seq).is_err(), "{n} octets");
        assert!(r.salon(1).ajouter(&x).is_err());
    }
    // Trop grand : refusé avant lecture.
    r.seq += 1;
    let seq = r.seq;
    assert_eq!(
        r.salon(1).recevoir(&vec![0u8; MAX_CHARGE + 1], seq),
        Err(Error::TropGrand)
    );
    // Messages réels altérés d'un octet.
    let vrai = r.salon(2).chiffrer(&env(1)).unwrap();
    for i in 0..200 {
        let mut x = vrai.clone();
        let p = (a.suivant() as usize) % x.len();
        x[p] ^= 1 << (i % 8);
        r.seq += 1;
        let seq = r.seq;
        assert!(r.salon(1).recevoir(&x, seq).is_err(), "octet {p}");
    }
    // Un Welcome ou un KeyPackage hostile pour qui attend d'entrer.
    let mut attente =
        Salon::creer(nouvelle_identite(9, nonce(9, 5)).unwrap(), cles(), false).unwrap();
    for _ in 0..200 {
        let n = (a.suivant() % (MAX_CHARGE as u64 + 1)) as usize;
        assert!(attente.rejoindre(&a.octets(n)).is_err());
    }
    assert_eq!(attente.rejoindre(&vrai), Err(Error::MlsInvalide));
    // Le groupe n'a pas bougé.
    r.meme_epoque();
    r.message(1, 2);
}

/// Un message rejoué (même `seq` ou plus ancien) est ignoré.
#[test]
fn rejeu_ignore() {
    let mut r = groupe(3);
    let mls = r.salon(0).chiffrer(&env(1)).unwrap();
    r.seq += 1;
    let seq = r.seq;
    assert!(matches!(
        r.salon(1).recevoir(&mls, seq),
        Ok(Evenement::Message { .. })
    ));
    assert_eq!(r.salon(1).recevoir(&mls, seq), Ok(Evenement::Ignore));
    assert_eq!(r.salon(1).recevoir(&mls, seq - 1), Ok(Evenement::Ignore));
}

#[test]
fn exporteur_identique() {
    let mut r = groupe(10);
    let k = r.salon(0).exporter_sframe().unwrap();
    for s in 1..10 {
        assert_eq!(*r.salon(s).exporter_sframe().unwrap(), *k);
    }
    let c = r.salon(6).renouveler().unwrap();
    r.commit_accepte(6, &c, vec![], vec![]);
    let k2 = r.salon(0).exporter_sframe().unwrap();
    assert_ne!(*k2, *k);
    for s in 1..10 {
        assert_eq!(*r.salon(s).exporter_sframe().unwrap(), *k2);
    }
}

#[test]
fn empreinte_stable() {
    // Calcul indépendant pour le siège 0 : SHA-256(étiquette ‖ clé publique Ed25519).
    let id = nouvelle_identite(0, nonce(0, 0)).unwrap();
    let mut entree = b"shhdrop/v2/salon/verif".to_vec();
    entree.extend_from_slice(id.cle_publique());
    assert_eq!(id.cle_publique().len(), 32);
    let h = shhdrop_core::kdf::sha256(&entree);
    let attendu = h[..16]
        .chunks(4)
        .map(|c| format!("{:05}", u32::from_be_bytes(c.try_into().unwrap()) % 100_000))
        .collect::<Vec<_>>()
        .join(" ");
    let createur = Salon::creer(id, cles(), true).unwrap();
    assert_eq!(createur.empreinte(0).unwrap(), attendu);

    let mut r = Reseau {
        m: vec![Some(createur)],
        seq: 0,
    };
    for s in 1..10 {
        r.arrivee(0, s, 0, vec![]);
    }
    let mut codes = Vec::new();
    for siege in 0..10u8 {
        let c = r.salon(0).empreinte(siege).unwrap();
        assert_eq!(c.len(), 23);
        let groupes: Vec<&str> = c.split(' ').collect();
        assert_eq!(groupes.len(), 4);
        assert!(
            groupes
                .iter()
                .all(|g| g.len() == 5 && g.bytes().all(|b| b.is_ascii_digit()))
        );
        for s in 1..10 {
            assert_eq!(
                r.salon(s).empreinte(siege).unwrap(),
                c,
                "siège {siege} chez {s}"
            );
        }
        codes.push(c);
    }
    codes.sort();
    codes.dedup();
    assert_eq!(codes.len(), 10);
    assert_eq!(r.salon(0).empreinte(10), Err(Error::SiegeInconnu));
}

/// Tout message accepté par `encoder` (JSON ≤ 3 900 octets) tient dans une trame (≤ 4 093
/// octets MLS) : on remplit le JSON jusqu'à sa borne (guillemets échappés).
#[test]
fn chiffrer_borne() {
    let mut r = groupe(2);
    let texte = |guillemets: usize| Enveloppe {
        id: [9; 16],
        heure_ms: 1_700_000_000_000,
        regle: Regle::UneHeure,
        message: Message::Texte {
            // 2 000 graphèmes et 3 500 octets au plus ; « € » : 3 octets, « " » : 2 en JSON.
            x: "\u{20AC}".repeat(((3500 - guillemets) / 3).min(2000 - guillemets))
                + &"\"".repeat(guillemets),
        },
    };
    let mut plus_grand = 0;
    for g in 280..=340 {
        let e = texte(g);
        match shhdrop_salon::encoder(&e) {
            Ok(json) => {
                let mls = r.salon(0).chiffrer(&e).unwrap();
                assert!(
                    mls.len() <= MAX_CHARGE,
                    "JSON {} -> MLS {}",
                    json.len(),
                    mls.len()
                );
                r.seq += 1;
                let seq = r.seq;
                assert_eq!(
                    r.salon(1).recevoir(&mls, seq),
                    Ok(Evenement::Message {
                        de_siege: 0,
                        enveloppe: e
                    })
                );
                plus_grand = plus_grand.max(json.len());
            }
            Err(err) => assert_eq!(err, Error::TropGrand),
        }
    }
    assert!(plus_grand >= shhdrop_salon::JSON_MAX - 1, "{plus_grand}");
}

/// États : pas de KeyPackage ni de second `rejoindre` pour un membre ; rien avant d'entrer.
#[test]
fn etats() {
    let mut r = groupe(2);
    assert_eq!(r.salon(0).key_package(), Err(Error::DejaMembre));
    let mut attente =
        Salon::creer(nouvelle_identite(5, nonce(5, 0)).unwrap(), cles(), false).unwrap();
    assert_eq!(attente.chiffrer(&env(1)), Err(Error::NonMembre));
    assert_eq!(attente.renouveler(), Err(Error::NonMembre));
    assert_eq!(attente.recevoir(&[0; 10], 1), Err(Error::NonMembre));
    assert_eq!(attente.epoque(), None);
    assert!(attente.membres().is_empty());
    // Un Welcome d'un autre salon (autre étiquette) est refusé.
    let autre = cles_salon(&KLien::from_bytes([7; 32]), &KMdp::from_bytes([2; 32]));
    let mut ailleurs =
        Salon::creer(nouvelle_identite(0, nonce(0, 9)).unwrap(), autre, true).unwrap();
    let kp = attente.key_package().unwrap();
    ailleurs.annoncer(5, nonce(5, 0));
    let c = ailleurs.ajouter(&kp).unwrap();
    let Ok(Evenement::CommitAccepte { welcome: Some(w) }) = ailleurs.recevoir(&c, 1) else {
        panic!("Welcome attendu à l'écho");
    };
    assert_eq!(attente.rejoindre(&w), Err(Error::MlsInvalide));
}

/// Un KeyPackage reçu n'est signalé que s'il est valide et porte le siège et le nonce
/// annoncés ; sinon `Ignore` (périmé) ou erreur (illisible).
#[test]
fn key_package_recu() {
    let mut r = groupe(3);
    let attente = Salon::creer(nouvelle_identite(7, nonce(7, 0)).unwrap(), cles(), false).unwrap();
    let kp = attente.key_package().unwrap();
    // Pas encore annoncé : ignoré.
    for (i, ev) in r.diffuser(&kp) {
        assert_eq!(ev, Ok(Evenement::Ignore), "membre {i}");
    }
    // Annoncé avec un autre nonce : ignoré.
    r.annoncer(7, nonce(7, 1));
    for (_, ev) in r.diffuser(&kp) {
        assert_eq!(ev, Ok(Evenement::Ignore));
    }
    r.annoncer(7, nonce(7, 0));
    for (i, ev) in r.diffuser(&kp) {
        assert_eq!(
            ev,
            Ok(Evenement::KeyPackage { octets: kp.clone() }),
            "membre {i}"
        );
    }
    // Altéré (signature) : erreur typée.
    let mut abime = kp.clone();
    let n = abime.len();
    abime[n - 5] ^= 1;
    for (_, ev) in r.diffuser(&abime) {
        assert!(ev.is_err(), "{ev:?}");
    }
}

/// Annonces données tard : un membre qui a manqué une arrivée (coupé) reçoit la liste complète
/// à sa reconnexion et accepte le Commit suivant comme les autres.
#[test]
fn annonces_completes_tardives() {
    let mut r = groupe(9);
    let mut coupe = r.m[5].take().unwrap();
    let mut nouveau =
        Salon::creer(nouvelle_identite(9, nonce(9, 0)).unwrap(), cles(), false).unwrap();
    let kp = nouveau.key_package().unwrap();
    r.annoncer(9, nonce(9, 0));
    // Sans elle, il refuserait le Commit (`sans_annonce_refus`).
    let liste: Vec<(u8, [u8; 16])> = (0..10u8).map(|s| (s, nonce(s, 0))).collect();
    coupe.remplacer_annonces(&liste);
    r.m[5] = Some(coupe);
    let commit = r.salon(0).ajouter(&kp).unwrap();
    let welcome = r.commit_accepte(0, &commit, vec![9], vec![]).unwrap();
    nouveau.remplacer_annonces(&liste);
    nouveau.rejoindre(&welcome).unwrap();
    r.m.push(Some(nouveau));
    r.meme_epoque();
    r.message(5, 1);
    r.message(9, 2);
}

/// Le même membre, sans la liste complète, refuse le Commit : c'est ce que la liste corrige.
#[test]
fn sans_annonce_refus() {
    let mut r = groupe(9);
    let mut coupe = r.m[5].take().unwrap();
    let nouveau = Salon::creer(nouvelle_identite(9, nonce(9, 0)).unwrap(), cles(), false).unwrap();
    let kp = nouveau.key_package().unwrap();
    r.annoncer(9, nonce(9, 0));
    let commit = r.salon(0).ajouter(&kp).unwrap();
    r.commit_accepte(0, &commit, vec![9], vec![]);
    r.seq += 1;
    assert_eq!(coupe.recevoir(&commit, r.seq), Err(Error::CommitRefuse));
}

/// Créateur absent : un membre retire un siège parti (0x03) ou exclu (0x09) ; les autres
/// acceptent. Le retrait d'un membre présent reste réservé au créateur.
#[test]
fn retrait_d_un_parti() {
    let mut r = groupe(10);
    let createur = r.m[0].take().unwrap();
    // Siège 4 parti, siège 6 présent.
    for s in r.m.iter_mut().flatten() {
        s.marquer_parti(4);
    }
    assert_eq!(r.salon(2).retirer(6), Err(Error::CommitRefuse));
    let commit = r.salon(2).retirer(4).unwrap();
    r.commit_accepte(2, &commit, vec![], vec![4]);
    r.m[4] = None;
    for s in [1, 2, 3, 5, 9] {
        assert_eq!(r.salon(s).membres(), vec![0, 1, 2, 3, 5, 6, 7, 8, 9]);
    }
    r.message(3, 1);
    // Le créateur, hors ligne pendant le départ, reçoit à son retour la liste complète (siège
    // 4 absent, donc parti) puis le Commit : il l'accepte.
    let mut createur = createur;
    r.seq += 1;
    let liste: Vec<(u8, [u8; 16])> = [0u8, 1, 2, 3, 5, 6, 7, 8, 9]
        .iter()
        .map(|&s| (s, nonce(s, 0)))
        .collect();
    createur.remplacer_annonces(&liste);
    assert!(matches!(
        createur.recevoir(&commit, r.seq),
        Ok(Evenement::Membres { .. })
    ));
    assert_eq!(createur.epoque(), r.salon(1).epoque());
    // Le siège repris (nouvelle annonce) n'est plus « parti » : retrait de nouveau réservé.
    r.m[0] = Some(createur);
    r.arrivee(1, 4, 1, vec![]);
    assert_eq!(r.salon(2).retirer(4), Err(Error::CommitRefuse));
    r.message(4, 2);
}
