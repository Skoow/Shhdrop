//! Groupe MLS du salon (Task 6) : 10 membres sauf mention. Le « réseau » des tests joue le
//! serveur : il numérote chaque message MLS (`seq`) et le remet à tous les membres, expéditeur
//! compris (§39.3.1 : la trame est renvoyée à son expéditeur).
use shhdrop_core::{KLien, KMdp};
use shhdrop_salon::politique::{Changements, verifier};
use shhdrop_salon::{
    ATTENTE_MAX, ClesSalon, EN_TETE_CONTROLE, EnTete, Enveloppe, Error, Evenement, MAX_CHARGE,
    Message, Regle, Salon, TAILLE_TRAME, cles_salon, lire_en_tete, nouvelle_identite, ouvrir,
    sceller,
};

fn cles() -> ClesSalon {
    cles_salon(&KLien::from_bytes([1; 32]), &KMdp::from_bytes([2; 32]))
}

/// Message MLS porté par une trame (KeyPackage à passer à `ajouter`).
fn mls(t: &[u8]) -> Vec<u8> {
    ouvrir(&cles(), t).unwrap().1.to_vec()
}

/// Trame de contrôle (en-tête non volatil, désactivé) d'octets MLS quelconques.
fn trame(mls: &[u8]) -> [u8; TAILLE_TRAME] {
    sceller(&cles(), EN_TETE_CONTROLE, mls).unwrap()
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

/// Membres indexés par siège (`None` : siège vide), compteur `seq` du serveur et liste des
/// sièges occupés que le serveur donne à l'accueil (`remplacer_annonces`, créateur au siège 0).
struct Reseau {
    m: Vec<Option<Salon>>,
    seq: u64,
    liste: Vec<(u8, [u8; 16])>,
}

impl Reseau {
    fn salon(&mut self, s: usize) -> &mut Salon {
        self.m[s].as_mut().unwrap()
    }

    /// Le serveur range la trame, envoyée par le siège `de`, au rang suivant et la remet à tous.
    fn diffuser(&mut self, de: u8, t: &[u8]) -> Vec<(usize, Result<Evenement, Error>)> {
        self.seq += 1;
        let seq = self.seq;
        self.m
            .iter_mut()
            .enumerate()
            .filter_map(|(i, s)| {
                s.as_mut()
                    .map(|s| (i, s.recevoir_trame(&cles(), t, seq, de)))
            })
            .collect()
    }

    /// Trame du Welcome remise (au rang suivant) à l'arrivant en attente, hors du réseau ; `de` :
    /// siège attesté de son expéditeur (l'auteur du Commit qui ajoute l'arrivant).
    fn entrer(&mut self, x: &mut Salon, w: &[u8], de: u8) -> Result<Evenement, Error> {
        self.seq += 1;
        x.recevoir_trame(&cles(), w, self.seq, de)
    }

    /// Arrivée (0x02) ou reprise (0x0A) annoncée par le serveur.
    fn annoncer(&mut self, siege: u8, n: [u8; 16]) {
        self.liste.retain(|a| a.0 != siege);
        self.liste.push((siege, n));
        for s in self.m.iter_mut().flatten() {
            s.annoncer(siege, n);
        }
    }

    /// Départ (0x03) annoncé par le serveur.
    fn partir(&mut self, siege: u8) {
        self.liste.retain(|a| a.0 != siege);
        for s in self.m.iter_mut().flatten() {
            s.marquer_parti(siege);
        }
    }

    /// Nouvel arrivant (déjà annoncé) : il reçoit la liste complète à l'accueil.
    fn nouveau(&self, siege: u8, n: [u8; 16]) -> Salon {
        let mut x = Salon::creer(nouvelle_identite(siege, n).unwrap(), &cles(), false).unwrap();
        x.remplacer_annonces(0, &self.liste);
        x
    }

    /// Le siège publie son KeyPackage : chacun le reconnaît.
    fn publier(&mut self, siege: u8, kp: &[u8]) {
        for (i, r) in self.diffuser(siege, kp) {
            assert_eq!(
                r,
                Ok(Evenement::KeyPackage { octets: mls(kp) }),
                "membre {i}"
            );
        }
    }

    /// Arrivée au siège `siege` (arrivée numéro `n`) : annonce du serveur, KeyPackage publié
    /// par le siège, ajout par `adder`, Welcome rendu à l'écho gagnant du Commit.
    fn arrivee(&mut self, adder: usize, siege: u8, n: u8, retires: Vec<u8>) {
        self.annoncer(siege, nonce(siege, n));
        let mut nouveau = self.nouveau(siege, nonce(siege, n));
        let kp = nouveau.key_package(&cles()).unwrap();
        self.publier(siege, &kp);
        let commit = self.salon(adder).ajouter(&cles(), &mls(&kp)).unwrap();
        let welcome = self.commit_accepte(adder, &commit, vec![siege], retires);
        self.entrer(&mut nouveau, &welcome.unwrap(), adder as u8)
            .unwrap();
        let s = siege as usize;
        if self.m.len() <= s {
            self.m.resize_with(s + 1, || None);
        }
        self.m[s] = Some(nouveau);
    }

    /// `de` envoie un message et chacun des autres le lit ; l'expéditeur reçoit `Ignore`.
    fn message(&mut self, de: usize, k: u32) {
        let e = env(k);
        let mls = self.salon(de).envoyer(&cles(), &e).unwrap();
        assert_eq!(mls.len(), TAILLE_TRAME);
        assert!(self::mls(&mls).len() <= MAX_CHARGE);
        for (i, r) in self.diffuser(de as u8, &mls) {
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
        for (i, r) in self.diffuser(de as u8, mls) {
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

/// Créateur seul au siège 0.
fn createur_seul(id: shhdrop_salon::Identite) -> Reseau {
    let mut createur = Salon::creer(id, &cles(), true).unwrap();
    let liste = vec![(0, nonce(0, 0))];
    createur.remplacer_annonces(0, &liste);
    Reseau {
        m: vec![Some(createur)],
        seq: 0,
        liste,
    }
}

/// Groupe de `n` membres (sièges 0 à n-1) : le créateur (siège 0) ajoute chacun, un par un.
fn groupe(n: u8) -> Reseau {
    let mut r = createur_seul(nouvelle_identite(0, nonce(0, 0)).unwrap());
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
    let commit = r.salon(0).retirer(&cles(), 9).unwrap();
    r.commit_accepte(0, &commit, vec![], vec![9]);
    let e = r.epoques();
    assert!(e[..9].windows(2).all(|w| w[0] == w[1]));
    // Le retiré ne lit plus le message suivant ni n'écrit.
    let mls = r.salon(1).envoyer(&cles(), &env(1)).unwrap();
    r.seq += 1;
    let seq = r.seq;
    let lu = r.salon(9).recevoir_trame(&cles(), &mls, seq, 1);
    assert!(
        matches!(lu, Err(Error::NonMembre) | Ok(Evenement::Ignore)),
        "{lu:?}"
    );
    assert_eq!(r.salon(9).envoyer(&cles(), &env(2)), Err(Error::NonMembre));
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
    assert_eq!(r.salon(0).retirer(&cles(), 9), Err(Error::SiegeInconnu));
}

#[test]
fn renouvellement() {
    let mut r = groupe(10);
    let e0 = r.meme_epoque();
    let k0 = r.salon(0).exporter_sframe().unwrap();
    let commit = r.salon(3).renouveler(&cles()).unwrap();
    assert_eq!(commit.len(), TAILLE_TRAME);
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
    let a = r.salon(2).renouveler(&cles()).unwrap();
    let b = r.salon(5).renouveler(&cles()).unwrap();
    // Tant que son Commit attend, l'auteur n'en fait pas d'autre.
    assert_eq!(r.salon(5).renouveler(&cles()), Err(Error::CommitEnCours));
    for (i, ev) in r.diffuser(2, &a) {
        let attendu = if i == 5 {
            Evenement::CommitPerdu {
                ajoutes: vec![],
                retires: vec![],
            }
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
    for (i, ev) in r.diffuser(5, &b) {
        assert_eq!(ev, Ok(Evenement::Ignore), "commit perdant chez {i}");
    }
    assert_eq!(r.meme_epoque(), e0 + 1);
    r.message(5, 1);
    // Le perdant rejoue.
    let b2 = r.salon(5).renouveler(&cles()).unwrap();
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
    r.annoncer(9, nonce(9, 0));
    let mut nouveau = r.nouveau(9, nonce(9, 0));
    let kp = nouveau.key_package(&cles()).unwrap();
    r.publier(9, &kp);
    // Le Commit d'ajout ne donne pas de Welcome : il n'existe qu'à l'écho gagnant.
    let ajout = r.salon(0).ajouter(&cles(), &mls(&kp)).unwrap();
    let maj = r.salon(4).renouveler(&cles()).unwrap();
    for (i, ev) in r.diffuser(4, &maj) {
        // Perdu : le Welcome de l'ajout est jeté avec le Commit.
        let attendu = if i == 0 {
            Evenement::CommitPerdu {
                ajoutes: vec![],
                retires: vec![],
            }
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
    for (_, ev) in r.diffuser(0, &ajout) {
        assert_eq!(ev, Ok(Evenement::Ignore));
    }
    let ajout2 = r.salon(0).ajouter(&cles(), &mls(&kp)).unwrap();
    let welcome = r.commit_accepte(0, &ajout2, vec![9], vec![]).unwrap();
    r.entrer(&mut nouveau, &welcome, 0).unwrap();
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
    let vieux = r.salon(4).envoyer(&cles(), &e).unwrap();
    let commit = r.salon(0).renouveler(&cles()).unwrap();
    r.commit_accepte(0, &commit, vec![], vec![]);
    for (i, ev) in r.diffuser(4, &vieux) {
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
    let vieux = r.salon(4).envoyer(&cles(), &env(7)).unwrap();
    let c1 = r.salon(0).renouveler(&cles()).unwrap();
    r.commit_accepte(0, &c1, vec![], vec![]);
    let c2 = r.salon(1).renouveler(&cles()).unwrap();
    r.commit_accepte(1, &c2, vec![], vec![]);
    for (i, ev) in r.diffuser(4, &vieux) {
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
    assert_eq!(r.salon(3).retirer(&cles(), 5), Err(Error::CommitRefuse));
    // Ajout d'un KeyPackage dont le siège n'est pas annoncé (ou d'un autre nonce).
    let mut inconnu =
        Salon::creer(nouvelle_identite(9, nonce(9, 0)).unwrap(), &cles(), false).unwrap();
    let kp = inconnu.key_package(&cles()).unwrap();
    assert_eq!(
        r.salon(0).ajouter(&cles(), &mls(&kp)),
        Err(Error::CommitRefuse)
    );
    r.annoncer(9, nonce(9, 1));
    assert_eq!(
        r.salon(0).ajouter(&cles(), &mls(&kp)),
        Err(Error::CommitRefuse)
    );
    // Aucun Commit n'est resté en attente : l'auteur peut encore agir.
    assert_eq!(r.meme_epoque(), e0);
    r.message(3, 1);

    // Côté réception : seul le siège 0 a vu l'annonce (nonce 2) ; les autres refusent le Commit
    // sans fusion et continuent entre eux.
    let mut kp_nonce =
        Salon::creer(nouvelle_identite(9, nonce(9, 2)).unwrap(), &cles(), false).unwrap();
    let kp2 = kp_nonce.key_package(&cles()).unwrap();
    r.salon(0).annoncer(9, nonce(9, 2));
    r.seq += 1;
    let seq = r.seq;
    assert!(matches!(
        r.salon(0).recevoir_trame(&cles(), &kp2, seq, 9),
        Ok(Evenement::KeyPackage { .. })
    ));
    let commit = r.salon(0).ajouter(&cles(), &mls(&kp2)).unwrap();
    for (i, ev) in r.diffuser(0, &commit) {
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
    // KeyPackages publiés par leur siège : clé (empreinte) [siège; 32].
    let kps: Vec<_> = annonces.iter().map(|&(s, n)| (s, n, [s; 32])).collect();
    let avec_cle = |a: &[(u8, [u8; 16])]| a.iter().map(|&(s, n)| (s, n, [s; 32])).collect();
    // Feuilles retirées : leur nonce d'arrivée numéro 0.
    let ch =
        |ajouts: Vec<(u8, [u8; 16], [u8; 32])>, retraits: &[u8], restants: &[u8]| Changements {
            ajouts,
            retraits: retraits.iter().map(|&s| (s, nonce(s, 0))).collect(),
            restants: restants.to_vec(),
            interdit: false,
        };
    let v =
        |ajouts: &[(u8, [u8; 16])], retraits: &[u8], restants: &[u8], auteur: u8, partis: &[u8]| {
            verifier(
                &ch(avec_cle(ajouts), retraits, restants),
                0,
                auteur,
                &annonces,
                partis,
                &kps,
            )
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
    // Feuille annoncée mais d'une autre clé que le KeyPackage publié par le siège (fabriquée
    // par un membre avec le nonce public), ou sans KeyPackage reçu : refusée, même du créateur.
    let copie = ch(vec![(4, nonce(4, 0), [9; 32])], &[], &[0, 1]);
    assert_eq!(verifier(&copie, 0, 0, &annonces, &[], &kps), refus);
    let sans_kp = ch(vec![(4, nonce(4, 0), [4; 32])], &[], &[0, 1]);
    assert_eq!(verifier(&sans_kp, 0, 0, &annonces, &[], &[]), refus);
    // Proposition interdite.
    let x = Changements {
        interdit: true,
        ..Changements::default()
    };
    assert_eq!(verifier(&x, 0, 0, &annonces, &[], &kps), refus);
}

/// Review Focus 5 : le siège 3 revient avec une nouvelle identité ; un non-créateur retire
/// l'ancienne feuille et ajoute la nouvelle dans le même Commit ; tous continuent.
#[test]
fn retour_nouvelle_feuille() {
    let mut r = groupe(10);
    let avant = r.salon(0).empreinte(3).unwrap();
    let mut ancien = r.m[3].take().unwrap();
    // L'ancienne instance reste joignable (l'onglet rechargé n'a pas encore disparu).
    r.annoncer(3, nonce(3, 1));
    ancien.annoncer(3, nonce(3, 1));
    let mut nouveau = r.nouveau(3, nonce(3, 1));
    let kp = nouveau.key_package(&cles()).unwrap();
    r.publier(3, &kp);
    assert!(matches!(
        ancien.recevoir_trame(&cles(), &kp, r.seq, 3),
        Ok(Evenement::KeyPackage { .. })
    ));
    let commit = r.salon(1).ajouter(&cles(), &mls(&kp)).unwrap();
    let welcome = r.commit_accepte(1, &commit, vec![3], vec![3]).unwrap();
    r.seq += 1;
    assert_eq!(
        ancien.recevoir_trame(&cles(), &commit, r.seq, 1),
        Ok(Evenement::Membres {
            ajoutes: vec![3],
            retires: vec![3]
        })
    );
    r.entrer(&mut nouveau, &welcome, 1).unwrap();
    r.m[3] = Some(nouveau);
    r.meme_epoque();
    for s in 0..10 {
        assert_eq!(r.salon(s).membres(), (0..10).collect::<Vec<u8>>());
    }
    r.message(3, 1);
    r.message(0, 2);
    r.message(9, 3);
    // L'ancienne feuille ne lit plus rien.
    let t = r.salon(2).envoyer(&cles(), &env(4)).unwrap();
    r.seq += 1;
    assert!(matches!(
        ancien.recevoir_trame(&cles(), &t, r.seq, 2),
        Err(Error::NonMembre) | Ok(Evenement::Ignore)
    ));
    // Nouvelle clé, nouveau code, le même chez tous.
    let apres = r.salon(0).empreinte(3).unwrap();
    assert_ne!(avant, apres);
    for s in 1..10 {
        assert_eq!(r.salon(s).empreinte(3).unwrap(), apres);
    }
    // L'ancien KeyPackage (nonce remplacé) ne peut plus être rajouté.
    let mut revenant =
        Salon::creer(nouvelle_identite(3, nonce(3, 0)).unwrap(), &cles(), false).unwrap();
    let vieux_kp = revenant.key_package(&cles()).unwrap();
    assert_eq!(
        r.salon(1).ajouter(&cles(), &mls(&vieux_kp)),
        Err(Error::CommitRefuse)
    );
    // Le KeyPackage déjà ajouté, rejoué par le serveur : ni signalé, ni rajouté (il
    // chasserait la feuille vivante du siège 3) : `deja_membre` avant même la politique.
    for (i, ev) in r.diffuser(3, &kp) {
        assert_eq!(ev, Ok(Evenement::Ignore), "membre {i}");
    }
    assert_eq!(
        r.salon(1).ajouter(&cles(), &mls(&kp)),
        Err(Error::DejaMembre)
    );
    assert_eq!(
        r.salon(0).ajouter(&cles(), &mls(&kp)),
        Err(Error::DejaMembre)
    );
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
        assert!(
            r.salon(1)
                .recevoir_trame(&cles(), &trame(&x), seq, 2)
                .is_err(),
            "{n} octets"
        );
        assert!(r.salon(1).ajouter(&cles(), &x).is_err());
    }
    // Trop grand : ne tient pas dans une trame ; trame quelconque : `trame_corrompue`.
    assert_eq!(
        sceller(&cles(), EN_TETE_CONTROLE, &vec![0u8; MAX_CHARGE + 1]),
        Err(Error::TropGrand)
    );
    r.seq += 1;
    let seq = r.seq;
    assert_eq!(
        r.salon(1)
            .recevoir_trame(&cles(), &a.octets(TAILLE_TRAME), seq, 2),
        Err(Error::TrameCorrompue)
    );
    // Messages réels altérés d'un octet (dans une trame valide).
    let vrai = mls(&r.salon(2).envoyer(&cles(), &env(1)).unwrap());
    for i in 0..200 {
        let mut x = vrai.clone();
        let p = (a.suivant() as usize) % x.len();
        x[p] ^= 1 << (i % 8);
        r.seq += 1;
        let seq = r.seq;
        assert!(
            r.salon(1)
                .recevoir_trame(&cles(), &trame(&x), seq, 2)
                .is_err(),
            "octet {p}"
        );
    }
    // Octets hostiles pour qui attend d'entrer : erreur, ou gardés (`Ignore`) ; jamais d'entrée.
    let mut attente =
        Salon::creer(nouvelle_identite(9, nonce(9, 5)).unwrap(), &cles(), false).unwrap();
    for k in 0..200 {
        let n = (a.suivant() % (MAX_CHARGE as u64 + 1)) as usize;
        let ev = attente.recevoir_trame(&cles(), &trame(&a.octets(n)), k + 1, 3);
        assert!(matches!(ev, Err(_) | Ok(Evenement::Ignore)), "{ev:?}");
    }
    assert_eq!(
        attente.recevoir_trame(&cles(), &trame(&vrai), 201, 2),
        Ok(Evenement::Ignore)
    );
    assert_eq!(attente.epoque(), None);
    // Le groupe n'a pas bougé.
    r.meme_epoque();
    r.message(1, 2);
}

/// Un message rejoué (même `seq` ou plus ancien) est ignoré.
#[test]
fn rejeu_ignore() {
    let mut r = groupe(3);
    let mls = r.salon(0).envoyer(&cles(), &env(1)).unwrap();
    r.seq += 1;
    let seq = r.seq;
    assert!(matches!(
        r.salon(1).recevoir_trame(&cles(), &mls, seq, 0),
        Ok(Evenement::Message { .. })
    ));
    assert_eq!(
        r.salon(1).recevoir_trame(&cles(), &mls, seq, 0),
        Ok(Evenement::Ignore)
    );
    assert_eq!(
        r.salon(1).recevoir_trame(&cles(), &mls, seq - 1, 0),
        Ok(Evenement::Ignore)
    );
}

#[test]
fn exporteur_identique() {
    let mut r = groupe(10);
    let k = r.salon(0).exporter_sframe().unwrap();
    for s in 1..10 {
        assert_eq!(*r.salon(s).exporter_sframe().unwrap(), *k);
    }
    let c = r.salon(6).renouveler(&cles()).unwrap();
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
    let mut r = createur_seul(id);
    assert_eq!(r.salon(0).empreinte(0).unwrap(), attendu);
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
                let mls = r.salon(0).envoyer(&cles(), &e).unwrap();
                assert!(
                    self::mls(&mls).len() <= MAX_CHARGE,
                    "JSON {} -> MLS {}",
                    json.len(),
                    self::mls(&mls).len()
                );
                r.seq += 1;
                let seq = r.seq;
                assert_eq!(
                    r.salon(1).recevoir_trame(&cles(), &mls, seq, 0),
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
    assert_eq!(r.salon(0).key_package(&cles()), Err(Error::DejaMembre));
    let mut attente =
        Salon::creer(nouvelle_identite(5, nonce(5, 0)).unwrap(), &cles(), false).unwrap();
    assert_eq!(attente.envoyer(&cles(), &env(1)), Err(Error::NonMembre));
    assert_eq!(attente.renouveler(&cles()), Err(Error::NonMembre));
    assert_eq!(
        attente.recevoir_trame(&cles(), &[0; 10], 1, 0),
        Err(Error::TrameCorrompue)
    );
    assert_eq!(attente.epoque(), None);
    assert!(attente.membres().is_empty());
    // Un Welcome d'un autre salon (autre étiquette) est refusé.
    let autre = cles_salon(&KLien::from_bytes([7; 32]), &KMdp::from_bytes([2; 32]));
    let mut ailleurs =
        Salon::creer(nouvelle_identite(0, nonce(0, 9)).unwrap(), &autre, true).unwrap();
    let kp = attente.key_package(&cles()).unwrap();
    let liste = [(0, nonce(0, 9)), (5, nonce(5, 0))];
    ailleurs.remplacer_annonces(0, &liste);
    attente.remplacer_annonces(0, &liste);
    assert!(matches!(
        ailleurs.recevoir_trame(&cles(), &kp, 1, 5),
        Ok(Evenement::KeyPackage { .. })
    ));
    let c = ailleurs.ajouter(&cles(), &mls(&kp)).unwrap();
    let Ok(Evenement::CommitAccepte { welcome: Some(w) }) =
        ailleurs.recevoir_trame(&cles(), &c, 2, 0)
    else {
        panic!("Welcome attendu à l'écho");
    };
    assert_eq!(r.entrer(&mut attente, &w, 0), Err(Error::MlsInvalide));
}

/// Un KeyPackage reçu n'est signalé que s'il est valide et porte le siège et le nonce
/// annoncés ; sinon `Ignore` (périmé) ou erreur (illisible).
#[test]
fn key_package_recu() {
    let mut r = groupe(3);
    let mut attente =
        Salon::creer(nouvelle_identite(7, nonce(7, 0)).unwrap(), &cles(), false).unwrap();
    let kp = attente.key_package(&cles()).unwrap();
    // Pas encore annoncé : ignoré.
    for (i, ev) in r.diffuser(7, &kp) {
        assert_eq!(ev, Ok(Evenement::Ignore), "membre {i}");
    }
    // Annoncé avec un autre nonce : ignoré.
    r.annoncer(7, nonce(7, 1));
    for (_, ev) in r.diffuser(7, &kp) {
        assert_eq!(ev, Ok(Evenement::Ignore));
    }
    r.annoncer(7, nonce(7, 0));
    // Envoyé par un autre siège que le sien (siège attesté par le serveur) : ignoré.
    for (_, ev) in r.diffuser(1, &kp) {
        assert_eq!(ev, Ok(Evenement::Ignore));
    }
    for (i, ev) in r.diffuser(7, &kp) {
        assert_eq!(
            ev,
            Ok(Evenement::KeyPackage { octets: mls(&kp) }),
            "membre {i}"
        );
    }
    // Altéré (signature), dans une trame valide : erreur typée.
    let mut abime = mls(&kp);
    let n = abime.len();
    abime[n - 5] ^= 1;
    for (_, ev) in r.diffuser(7, &trame(&abime)) {
        assert_eq!(ev, Err(Error::MlsInvalide));
    }
}

/// Annonces données tard : un membre qui a manqué une arrivée (coupé) reçoit la liste complète
/// à sa reconnexion et accepte le Commit suivant comme les autres.
#[test]
fn annonces_completes_tardives() {
    let mut r = groupe(9);
    let mut coupe = r.m[5].take().unwrap();
    r.annoncer(9, nonce(9, 0));
    let mut nouveau = r.nouveau(9, nonce(9, 0));
    let kp = nouveau.key_package(&cles()).unwrap();
    r.publier(9, &kp);
    let seq_kp = r.seq;
    // Reconnexion : liste complète à l'accueil, puis la file du serveur rejouée (dont le
    // KeyPackage). Sans elles, il refuserait le Commit (`sans_annonce_refus`).
    coupe.remplacer_annonces(0, &r.liste);
    assert!(matches!(
        coupe.recevoir_trame(&cles(), &kp, seq_kp, 9),
        Ok(Evenement::KeyPackage { .. })
    ));
    r.m[5] = Some(coupe);
    let commit = r.salon(0).ajouter(&cles(), &mls(&kp)).unwrap();
    let welcome = r.commit_accepte(0, &commit, vec![9], vec![]).unwrap();
    r.entrer(&mut nouveau, &welcome, 0).unwrap();
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
    r.annoncer(9, nonce(9, 0));
    let mut nouveau = r.nouveau(9, nonce(9, 0));
    let kp = nouveau.key_package(&cles()).unwrap();
    r.publier(9, &kp);
    let commit = r.salon(0).ajouter(&cles(), &mls(&kp)).unwrap();
    r.commit_accepte(0, &commit, vec![9], vec![]);
    r.seq += 1;
    assert_eq!(
        coupe.recevoir_trame(&cles(), &commit, r.seq, 0),
        Err(Error::CommitRefuse)
    );
}

/// Créateur absent : un membre retire un siège parti (0x03) ou exclu (0x09) ; les autres
/// acceptent. Le retrait d'un membre présent reste réservé au créateur.
#[test]
fn retrait_d_un_parti() {
    let mut r = groupe(10);
    let createur = r.m[0].take().unwrap();
    // Siège 4 parti, siège 6 présent.
    r.partir(4);
    assert_eq!(r.salon(2).retirer(&cles(), 6), Err(Error::CommitRefuse));
    let commit = r.salon(2).retirer(&cles(), 4).unwrap();
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
    createur.remplacer_annonces(0, &r.liste);
    assert!(matches!(
        createur.recevoir_trame(&cles(), &commit, r.seq, 2),
        Ok(Evenement::Membres { .. })
    ));
    assert_eq!(createur.epoque(), r.salon(1).epoque());
    // Le siège repris (nouvelle annonce) n'est plus « parti » : retrait de nouveau réservé.
    r.m[0] = Some(createur);
    r.arrivee(1, 4, 1, vec![]);
    assert_eq!(r.salon(2).retirer(&cles(), 4), Err(Error::CommitRefuse));
    r.message(4, 2);
}

/// IMPORTANT 1 : un membre retiré qui ignore le Commit de son retrait et écrit encore à
/// l'époque précédente est refusé par tous (il n'est plus une feuille de l'arbre courant).
#[test]
fn retire_qui_ecrit_encore() {
    let mut r = groupe(10);
    let mut exclu = r.m[9].take().unwrap();
    let commit = r.salon(0).retirer(&cles(), 9).unwrap();
    r.commit_accepte(0, &commit, vec![], vec![9]);
    // Client modifié : il n'a pas traité son retrait, il chiffre à l'époque n-1.
    let mls = exclu.envoyer(&cles(), &env(1)).unwrap();
    for (i, ev) in r.diffuser(9, &mls) {
        assert_eq!(ev, Err(Error::NonMembre), "membre {i}");
    }
    // Un membre resté, à l'époque n-1, est toujours lu (Review Focus 2).
    let vieux = r.salon(4).envoyer(&cles(), &env(2)).unwrap();
    let c = r.salon(0).renouveler(&cles()).unwrap();
    r.commit_accepte(0, &c, vec![], vec![]);
    for (i, ev) in r.diffuser(4, &vieux) {
        if i != 4 {
            assert!(
                matches!(ev, Ok(Evenement::Message { de_siege: 4, .. })),
                "membre {i}"
            );
        }
    }
}

/// IMPORTANT 2 : un membre fabrique un KeyPackage au (siège, nonce) public d'un arrivant et
/// le fait entrer avant lui : refusé par tous, avant comme après la publication légitime.
#[test]
fn kp_usurpe_par_un_membre() {
    let mut r = groupe(9);
    r.annoncer(9, nonce(9, 0));
    let mut legitime = r.nouveau(9, nonce(9, 0));
    // L'attaquant (siège 3) : identité à lui, credential de l'arrivant.
    let faux = r.nouveau(9, nonce(9, 0)).key_package(&cles()).unwrap();
    // Envoyé par le siège 3 : personne ne le retient.
    for (i, ev) in r.diffuser(3, &faux) {
        assert_eq!(ev, Ok(Evenement::Ignore), "membre {i}");
    }
    // Son propre client modifié croit le serveur (siège 9) et fait le Commit le premier.
    r.seq += 1;
    let seq = r.seq;
    assert!(matches!(
        r.salon(3).recevoir_trame(&cles(), &faux, seq, 9),
        Ok(Evenement::KeyPackage { .. })
    ));
    let pirate = r.salon(3).ajouter(&cles(), &mls(&faux)).unwrap();
    for (i, ev) in r.diffuser(3, &pirate) {
        if i != 3 {
            assert_eq!(ev, Err(Error::CommitRefuse), "membre {i}");
        }
    }
    r.m[3] = None;
    // Le vrai KeyPackage, publié par le siège 9 : accepté, ajouté par le créateur.
    let kp = legitime.key_package(&cles()).unwrap();
    r.publier(9, &kp);
    let commit = r.salon(0).ajouter(&cles(), &mls(&kp)).unwrap();
    let welcome = r.commit_accepte(0, &commit, vec![9], vec![]).unwrap();
    r.entrer(&mut legitime, &welcome, 0).unwrap();
    r.m.push(Some(legitime));
    r.meme_epoque();
    r.message(9, 1);
    // Le faux, rejoué ensuite par le siège 9 lui-même : la clé retenue est la première.
    let faux2 = r.nouveau(9, nonce(9, 0)).key_package(&cles()).unwrap();
    for (_, ev) in r.diffuser(9, &faux2) {
        assert_eq!(ev, Ok(Evenement::Ignore));
    }
}

/// IMPORTANT 2 : retour du créateur ; un membre tente de prendre son siège avec le nouveau
/// nonce (public) avant lui : refusé ; le vrai retour passe et garde le droit de retirer.
#[test]
fn retour_du_createur_detourne() {
    let mut r = groupe(10);
    let _ancien = r.m[0].take().unwrap();
    r.annoncer(0, nonce(0, 1));
    let mut createur = r.nouveau(0, nonce(0, 1));
    let faux = r.nouveau(0, nonce(0, 1)).key_package(&cles()).unwrap();
    r.seq += 1;
    let seq = r.seq;
    assert!(matches!(
        r.salon(3).recevoir_trame(&cles(), &faux, seq, 0),
        Ok(Evenement::KeyPackage { .. })
    ));
    let pirate = r.salon(3).ajouter(&cles(), &mls(&faux)).unwrap();
    r.seq += 1;
    let seq = r.seq;
    for s in [1usize, 2, 4, 5, 6, 7, 8, 9] {
        assert_eq!(
            r.salon(s).recevoir_trame(&cles(), &pirate, seq, 3),
            Err(Error::CommitRefuse),
            "membre {s}"
        );
    }
    r.salon(3).abandonner_commit().unwrap();
    // Le client de l'attaquant a retenu sa fausse clé : il sort du test (il divergerait).
    r.m[3] = None;
    // Le vrai retour : KeyPackage publié par le siège 0, ajouté par le siège 1.
    let kp = createur.key_package(&cles()).unwrap();
    r.publier(0, &kp);
    let commit = r.salon(1).ajouter(&cles(), &mls(&kp)).unwrap();
    let welcome = r.commit_accepte(1, &commit, vec![0], vec![0]).unwrap();
    r.entrer(&mut createur, &welcome, 1).unwrap();
    r.m[0] = Some(createur);
    r.meme_epoque();
    let c = r.salon(0).retirer(&cles(), 9).unwrap();
    r.commit_accepte(0, &c, vec![], vec![9]);
}

/// Fabrique un KeyPackage brut (hors `Salon`) d'une durée de vie donnée.
fn kp_brut(siege: u8, n: [u8; 16], vie: openmls::prelude::Lifetime) -> Vec<u8> {
    use openmls::prelude::tls_codec::Serialize as _;
    use openmls::prelude::*;
    use openmls_basic_credential::SignatureKeyPair;
    let suite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
    let f = shhdrop_salon::Fournisseur::default();
    let sig = SignatureKeyPair::new(suite.signature_algorithm()).unwrap();
    let mut id = vec![siege];
    id.extend_from_slice(&n);
    let cwk = CredentialWithKey {
        credential: BasicCredential::new(id).into(),
        signature_key: sig.public().into(),
    };
    let kp = KeyPackage::builder()
        .key_package_lifetime(vie)
        .build(suite, &f, &sig, cwk)
        .unwrap();
    MlsMessageOut::from(kp.key_package().clone())
        .tls_serialize_detached()
        .unwrap()
}

/// IMPORTANT 3 : aucune décision ne dépend de l'horloge. Nos KeyPackages valent (0, u64::MAX) ;
/// tout autre durée de vie est refusée par tous, même valide à l'heure locale.
#[test]
fn duree_de_vie_sans_horloge() {
    use openmls::prelude::tls_codec::Deserialize as _;
    use openmls::prelude::{
        Lifetime, MlsMessageBodyIn, MlsMessageIn, OpenMlsProvider as _, ProtocolVersion,
    };
    let mut r = groupe(3);
    r.annoncer(7, nonce(7, 0));
    let kp = r.nouveau(7, nonce(7, 0)).key_package(&cles()).unwrap();
    let MlsMessageBodyIn::KeyPackage(lu) = MlsMessageIn::tls_deserialize_exact(mls(&kp))
        .unwrap()
        .extract()
    else {
        panic!("KeyPackage attendu");
    };
    let lu = lu
        .validate(
            shhdrop_salon::Fournisseur::default().crypto(),
            ProtocolVersion::Mls10,
        )
        .unwrap();
    assert_eq!(
        (lu.life_time().not_before(), lu.life_time().not_after()),
        (0, u64::MAX)
    );
    // not_before dans le futur (horloge d'un membre en retard) ou durée bornée valide
    // maintenant : refusés de même chez tous, et par `ajouter`.
    for vie in [
        Lifetime::init(u64::MAX - 10, u64::MAX),
        Lifetime::init(0, u64::MAX - 1),
    ] {
        let brut = kp_brut(7, nonce(7, 0), vie);
        for (i, ev) in r.diffuser(7, &trame(&brut)) {
            assert_eq!(ev, Err(Error::MlsInvalide), "membre {i}");
        }
        assert_eq!(r.salon(0).ajouter(&cles(), &brut), Err(Error::MlsInvalide));
    }
}

/// MINOR 5 : l'arrivant refuse un Welcome d'un faux groupe : autre siège de créateur, ou
/// feuille d'un siège occupé avec un autre nonce que celui annoncé ; et rien sans liste.
#[test]
fn faux_groupe_refuse() {
    let mut r = groupe(6);
    r.annoncer(9, nonce(9, 0));
    let mut arrivant = r.nouveau(9, nonce(9, 0));
    let kp = arrivant.key_package(&cles()).unwrap();
    r.publier(9, &kp);
    // Le siège 3 crée son propre groupe (identifiant tag ‖ 3) et y ajoute l'arrivant.
    let mut faux = Salon::creer(nouvelle_identite(3, nonce(3, 0)).unwrap(), &cles(), true).unwrap();
    faux.remplacer_annonces(3, &r.liste);
    assert!(matches!(
        faux.recevoir_trame(&cles(), &kp, 1, 9),
        Ok(Evenement::KeyPackage { .. })
    ));
    let c = faux.ajouter(&cles(), &mls(&kp)).unwrap();
    let Ok(Evenement::CommitAccepte { welcome: Some(w) }) = faux.recevoir_trame(&cles(), &c, 2, 3)
    else {
        panic!("Welcome attendu");
    };
    assert_eq!(r.entrer(&mut arrivant, &w, 3), Err(Error::MlsInvalide));
    // Faux groupe « du créateur » (siège 0, nonce public) avec une feuille du siège 5 d'un
    // autre nonce que celui annoncé.
    let mut faux0 =
        Salon::creer(nouvelle_identite(0, nonce(0, 0)).unwrap(), &cles(), true).unwrap();
    let mut liste = r.liste.clone();
    liste.retain(|a| a.0 != 5);
    liste.push((5, nonce(5, 9)));
    faux0.remplacer_annonces(0, &liste);
    let mut complice =
        Salon::creer(nouvelle_identite(5, nonce(5, 9)).unwrap(), &cles(), false).unwrap();
    let kp5 = complice.key_package(&cles()).unwrap();
    assert!(matches!(
        faux0.recevoir_trame(&cles(), &kp5, 1, 5),
        Ok(Evenement::KeyPackage { .. })
    ));
    let c5 = faux0.ajouter(&cles(), &mls(&kp5)).unwrap();
    assert!(matches!(
        faux0.recevoir_trame(&cles(), &c5, 2, 0),
        Ok(Evenement::CommitAccepte { .. })
    ));
    assert!(matches!(
        faux0.recevoir_trame(&cles(), &kp, 3, 9),
        Ok(Evenement::KeyPackage { .. })
    ));
    let c9 = faux0.ajouter(&cles(), &mls(&kp)).unwrap();
    let Ok(Evenement::CommitAccepte { welcome: Some(w) }) =
        faux0.recevoir_trame(&cles(), &c9, 4, 0)
    else {
        panic!("Welcome attendu");
    };
    assert_eq!(r.entrer(&mut arrivant, &w, 0), Err(Error::MlsInvalide));
    // Le vrai groupe : accepté.
    let commit = r.salon(0).ajouter(&cles(), &mls(&kp)).unwrap();
    let welcome = r.commit_accepte(0, &commit, vec![9], vec![]).unwrap();
    r.entrer(&mut arrivant, &welcome, 0).unwrap();
}

/// Sans la liste complète de l'accueil, l'arrivant ne peut rien vérifier : il refuse ; avec
/// elle, le même Welcome passe.
#[test]
fn rejoindre_sans_liste() {
    let mut r = groupe(3);
    r.annoncer(5, nonce(5, 0));
    let mut x = Salon::creer(nouvelle_identite(5, nonce(5, 0)).unwrap(), &cles(), false).unwrap();
    let kp = x.key_package(&cles()).unwrap();
    r.publier(5, &kp);
    let c = r.salon(0).ajouter(&cles(), &mls(&kp)).unwrap();
    let w = r.commit_accepte(0, &c, vec![5], vec![]).unwrap();
    assert_eq!(r.entrer(&mut x, &w, 0), Err(Error::MlsInvalide));
    x.remplacer_annonces(0, &r.liste);
    r.entrer(&mut x, &w, 0).unwrap();
}

/// MINOR 4 : le perdant apprend ce qu'a changé le Commit gagnant.
#[test]
fn commit_perdu_dit_ce_qui_a_change() {
    let mut r = groupe(10);
    let a = r.salon(0).retirer(&cles(), 9).unwrap();
    let _b = r.salon(5).renouveler(&cles()).unwrap();
    for (i, ev) in r.diffuser(0, &a) {
        if i == 5 {
            assert_eq!(
                ev,
                Ok(Evenement::CommitPerdu {
                    ajoutes: vec![],
                    retires: vec![9]
                })
            );
        }
    }
}

/// MINOR 6 : un Commit jamais revenu (perdu à la reconnexion) s'abandonne ; on peut rejouer.
#[test]
fn abandon_du_commit() {
    let mut r = groupe(4);
    let _perdu = r.salon(2).renouveler(&cles()).unwrap();
    assert_eq!(r.salon(2).renouveler(&cles()), Err(Error::CommitEnCours));
    r.salon(2).abandonner_commit().unwrap();
    let c = r.salon(2).renouveler(&cles()).unwrap();
    r.commit_accepte(2, &c, vec![], vec![]);
    r.meme_epoque();
    r.message(2, 1);
}

/// Deux arrivées rapprochées : le second KeyPackage est publié pendant que le premier arrivant
/// attend encore ; celui-ci le retient en attente et accepte ensuite le second ajout.
#[test]
fn deux_arrivees_rapprochees() {
    let mut r = groupe(5);
    r.annoncer(5, nonce(5, 0));
    let mut a = r.nouveau(5, nonce(5, 0));
    let kp_a = a.key_package(&cles()).unwrap();
    r.publier(5, &kp_a);
    r.annoncer(6, nonce(6, 0));
    a.annoncer(6, nonce(6, 0));
    let mut b = r.nouveau(6, nonce(6, 0));
    let kp_b = b.key_package(&cles()).unwrap();
    r.publier(6, &kp_b);
    // A, en attente, reçoit aussi la trame du KeyPackage de B.
    assert_eq!(
        a.recevoir_trame(&cles(), &kp_b, r.seq, 6),
        Ok(Evenement::Ignore)
    );
    let c_a = r.salon(0).ajouter(&cles(), &mls(&kp_a)).unwrap();
    let w_a = r.commit_accepte(0, &c_a, vec![5], vec![]).unwrap();
    r.entrer(&mut a, &w_a, 0).unwrap();
    r.m.push(Some(a));
    let c_b = r.salon(0).ajouter(&cles(), &mls(&kp_b)).unwrap();
    let w_b = r.commit_accepte(0, &c_b, vec![6], vec![]).unwrap();
    r.entrer(&mut b, &w_b, 0).unwrap();
    r.m.push(Some(b));
    r.meme_epoque();
    r.message(5, 1);
    r.message(6, 2);
}

/// Les huit en-têtes possibles (bit volatil × règle).
fn huit_en_tetes() -> Vec<EnTete> {
    let mut v = Vec::new();
    for volatile in [false, true] {
        for regle in [
            Regle::Desactive,
            Regle::UneMinute,
            Regle::CinqMinutes,
            Regle::UneHeure,
        ] {
            v.push(EnTete { volatile, regle });
        }
    }
    v
}

/// I2 : l'en-tête de chaque trame est tiré de son contenu (`envoyer`), les huit combinaisons
/// font l'aller-retour ; la même charge MLS rescellée sous un autre en-tête (par quiconque
/// connaît `K_trame`) est refusée (`message_invalide`), sans rien consommer.
#[test]
fn en_tete_lie_au_contenu() {
    let mut r = groupe(3);
    let mut k = 0;
    for et in huit_en_tetes() {
        k += 1;
        let e = Enveloppe {
            regle: et.regle,
            message: if et.volatile {
                Message::Ecrit
            } else {
                Message::Texte {
                    x: format!("message {k}"),
                }
            },
            ..env(k)
        };
        let t = r.salon(0).envoyer(&cles(), &e).unwrap();
        assert_eq!(lire_en_tete(&t), Ok(et));
        let charge = mls(&t);
        for autre in huit_en_tetes().into_iter().filter(|x| *x != et) {
            let faux = sceller(&cles(), autre, &charge).unwrap();
            r.seq += 1;
            let seq = r.seq;
            assert_eq!(
                r.salon(2).recevoir_trame(&cles(), &faux, seq, 0),
                Err(Error::MessageInvalide),
                "{et:?} rescellé en {autre:?}"
            );
        }
        for (i, ev) in r.diffuser(0, &t) {
            if i != 0 {
                assert_eq!(
                    ev,
                    Ok(Evenement::Message {
                        de_siege: 0,
                        enveloppe: e.clone()
                    }),
                    "membre {i}, {et:?}"
                );
            }
        }
    }
    // Commit : en-tête de contrôle seulement ; rescellé, refusé sans fusion.
    let e0 = r.meme_epoque();
    let c = r.salon(1).renouveler(&cles()).unwrap();
    assert_eq!(lire_en_tete(&c), Ok(EN_TETE_CONTROLE));
    for autre in huit_en_tetes()
        .into_iter()
        .filter(|x| *x != EN_TETE_CONTROLE)
    {
        let faux = sceller(&cles(), autre, &mls(&c)).unwrap();
        for (i, ev) in r.diffuser(1, &faux) {
            assert_eq!(ev, Err(Error::MessageInvalide), "membre {i}, {autre:?}");
        }
        assert_eq!(r.salon(0).epoque(), Some(e0));
    }
    r.commit_accepte(1, &c, vec![], vec![]);
    assert_eq!(r.meme_epoque(), e0 + 1);
    // KeyPackage et Welcome : de même.
    r.annoncer(3, nonce(3, 0));
    let mut nouveau = r.nouveau(3, nonce(3, 0));
    let kp = nouveau.key_package(&cles()).unwrap();
    assert_eq!(lire_en_tete(&kp), Ok(EN_TETE_CONTROLE));
    let faux_kp = sceller(
        &cles(),
        EnTete {
            volatile: true,
            regle: Regle::Desactive,
        },
        &mls(&kp),
    )
    .unwrap();
    for (i, ev) in r.diffuser(3, &faux_kp) {
        assert_eq!(ev, Err(Error::MessageInvalide), "membre {i}");
    }
    r.publier(3, &kp);
    let commit = r.salon(0).ajouter(&cles(), &mls(&kp)).unwrap();
    let w = r.commit_accepte(0, &commit, vec![3], vec![]).unwrap();
    assert_eq!(lire_en_tete(&w), Ok(EN_TETE_CONTROLE));
    let faux_w = sceller(
        &cles(),
        EnTete {
            volatile: false,
            regle: Regle::UneHeure,
        },
        &mls(&w),
    )
    .unwrap();
    assert_eq!(
        r.entrer(&mut nouveau, &faux_w, 0),
        Err(Error::MessageInvalide)
    );
    assert!(matches!(
        r.entrer(&mut nouveau, &w, 0),
        Ok(Evenement::Entree { .. })
    ));
    r.m.push(Some(nouveau));
    r.meme_epoque();
    r.message(3, 1);
}

/// I1 : l'arrivant est dans le réseau dès sa création. Entre le Commit qui l'ajoute et son
/// Welcome, un membre écrit et un autre renouvelle ses clés : l'arrivant les garde, puis, entré,
/// lit le message et suit le renouvellement (`Entree { rejoues }`, ordre `seq`).
#[test]
fn arrivant_suit_le_groupe_avant_son_welcome() {
    let mut r = groupe(5);
    r.annoncer(5, nonce(5, 0));
    let mut nouveau = r.nouveau(5, nonce(5, 0));
    let kp = nouveau.key_package(&cles()).unwrap();
    r.m.push(Some(nouveau));
    for (i, ev) in r.diffuser(5, &kp) {
        let attendu = if i == 5 {
            Evenement::Ignore
        } else {
            Evenement::KeyPackage { octets: mls(&kp) }
        };
        assert_eq!(ev, Ok(attendu), "membre {i}");
    }
    let seq_kp = r.seq;
    let commit = r.salon(0).ajouter(&cles(), &mls(&kp)).unwrap();
    let mut welcome = None;
    for (i, ev) in r.diffuser(0, &commit) {
        match (i, ev) {
            (0, Ok(Evenement::CommitAccepte { welcome: w })) => welcome = w,
            (5, ev) => assert_eq!(ev, Ok(Evenement::Ignore)),
            (_, ev) => assert!(matches!(ev, Ok(Evenement::Membres { .. })), "{ev:?}"),
        }
    }
    let seq_commit = r.seq;
    // Le message du siège 2 et le renouvellement du siège 3, avant le Welcome.
    let e = env(42);
    let t = r.salon(2).envoyer(&cles(), &e).unwrap();
    for (i, ev) in r.diffuser(2, &t) {
        if i == 5 {
            assert_eq!(ev, Ok(Evenement::Ignore));
        }
    }
    let seq_message = r.seq;
    let c = r.salon(3).renouveler(&cles()).unwrap();
    for (i, ev) in r.diffuser(3, &c) {
        if i == 5 {
            assert_eq!(ev, Ok(Evenement::Ignore));
        }
    }
    let seq_renouvellement = r.seq;
    // Le Welcome arrive : l'arrivant entre et rejoue sa file.
    let ev = r.diffuser(0, &welcome.unwrap());
    let Ok(Evenement::Entree { rejoues }) = &ev[5].1 else {
        panic!("{ev:?}")
    };
    assert_eq!(
        rejoues,
        &vec![
            (seq_kp, Ok(Evenement::Ignore)),
            (seq_commit, Ok(Evenement::Ignore)),
            (
                seq_message,
                Ok(Evenement::Message {
                    de_siege: 2,
                    enveloppe: e
                })
            ),
            (
                seq_renouvellement,
                Ok(Evenement::Membres {
                    ajoutes: vec![],
                    retires: vec![]
                })
            ),
        ]
    );
    assert_eq!(r.meme_epoque(), 6);
    r.message(5, 1);
    r.message(3, 2);
}

/// I1 : une annonce arrivée entre le Commit qui ajoute l'arrivant et son Welcome (ici la reprise
/// du siège 3) ne s'applique qu'après : le Welcome est vérifié avec les annonces au rang du
/// Commit (avec celles d'après, la feuille du siège 3 aurait un autre nonce que l'annonce, et un
/// vrai Welcome serait refusé), puis la file est rejouée dans l'ordre, annonces comprises.
#[test]
fn annonce_entre_commit_et_welcome() {
    let mut r = groupe(5);
    r.annoncer(5, nonce(5, 0));
    let mut nouveau = r.nouveau(5, nonce(5, 0));
    let kp = nouveau.key_package(&cles()).unwrap();
    r.m.push(Some(nouveau));
    r.diffuser(5, &kp);
    let commit = r.salon(0).ajouter(&cles(), &mls(&kp)).unwrap();
    let mut welcome = None;
    for (i, ev) in r.diffuser(0, &commit) {
        if let (0, Ok(Evenement::CommitAccepte { welcome: w })) = (i, ev) {
            welcome = w;
        }
    }
    // Le siège 3 recharge : nouvelle annonce, avant le Welcome.
    let ancien = r.m[3].take().unwrap();
    r.annoncer(3, nonce(3, 1));
    let ev = r.diffuser(0, &welcome.unwrap());
    assert!(
        matches!(ev.last().unwrap(), (5, Ok(Evenement::Entree { .. }))),
        "{ev:?}"
    );
    drop(ancien);
    // Le retour du siège 3, ajouté par le siège 1 (l'arrivant le voit comme les autres).
    let mut revenant = r.nouveau(3, nonce(3, 1));
    let kp3 = revenant.key_package(&cles()).unwrap();
    r.publier(3, &kp3);
    let c = r.salon(1).ajouter(&cles(), &mls(&kp3)).unwrap();
    let w = r.commit_accepte(1, &c, vec![3], vec![3]).unwrap();
    assert!(matches!(
        r.entrer(&mut revenant, &w, 1),
        Ok(Evenement::Entree { .. })
    ));
    r.m[3] = Some(revenant);
    r.meme_epoque();
    r.message(5, 1);
    r.message(3, 2);
}

/// I1 : la file d'attente est bornée (`ATTENTE_MAX` entrées, annonces comprises) : au-delà,
/// `attente_pleine`, et le Welcome ne fait plus entrer (l'arrivant recommence).
#[test]
fn attente_pleine() {
    let mut r = groupe(2);
    r.annoncer(2, nonce(2, 0));
    // Une entrée : la liste complète de l'accueil.
    let mut nouveau = r.nouveau(2, nonce(2, 0));
    let kp = nouveau.key_package(&cles()).unwrap();
    let mut seq = 0;
    for k in 1..ATTENTE_MAX {
        let t = r.salon(1).envoyer(&cles(), &env(k as u32)).unwrap();
        seq += 1;
        assert_eq!(
            nouveau.recevoir_trame(&cles(), &t, seq, 1),
            Ok(Evenement::Ignore),
            "trame {k}"
        );
    }
    let t = r.salon(1).envoyer(&cles(), &env(0)).unwrap();
    seq += 1;
    assert_eq!(
        nouveau.recevoir_trame(&cles(), &t, seq, 1),
        Err(Error::AttentePleine)
    );
    r.publier(2, &kp);
    let commit = r.salon(0).ajouter(&cles(), &mls(&kp)).unwrap();
    let w = r.commit_accepte(0, &commit, vec![2], vec![]).unwrap();
    seq += 1;
    assert_eq!(
        nouveau.recevoir_trame(&cles(), &w, seq, 0),
        Err(Error::AttentePleine)
    );
    assert_eq!(nouveau.epoque(), None);
}

/// N1 : un KeyPackage mis en file sous un autre en-tête que celui des trames de contrôle est
/// refusé (`message_invalide`) et n'est jamais retenu, même au rejeu de la file : le vrai
/// KeyPackage qui le suit reste celui que l'arrivant en attente vérifie dans son Welcome.
#[test]
fn n1_kp_mal_etiquete_ignore() {
    let mut r = groupe(3);
    r.annoncer(3, nonce(3, 0));
    r.annoncer(4, nonce(4, 0));
    let mut x = r.nouveau(4, nonce(4, 0));
    let kp_x = x.key_package(&cles()).unwrap();
    r.m.resize_with(5, || None);
    r.m[4] = Some(x);
    // Le siège 3 envoie d'abord un KeyPackage (clé K1) sous un en-tête volatil.
    let k1 = r.nouveau(3, nonce(3, 0)).key_package(&cles()).unwrap();
    let mal = sceller(
        &cles(),
        EnTete {
            volatile: true,
            regle: Regle::Desactive,
        },
        &mls(&k1),
    )
    .unwrap();
    for (i, ev) in r.diffuser(3, &mal) {
        assert_eq!(ev, Err(Error::MessageInvalide), "membre {i}");
    }
    // Puis son vrai KeyPackage (clé K2) : retenu par les membres, ajouté par le créateur.
    let mut s3 = r.nouveau(3, nonce(3, 0));
    let k2 = s3.key_package(&cles()).unwrap();
    for (i, ev) in r.diffuser(3, &k2) {
        let attendu = if i == 4 {
            Evenement::Ignore
        } else {
            Evenement::KeyPackage { octets: mls(&k2) }
        };
        assert_eq!(ev, Ok(attendu), "membre {i}");
    }
    let c3 = r.salon(0).ajouter(&cles(), &mls(&k2)).unwrap();
    let mut w3 = None;
    for (i, ev) in r.diffuser(0, &c3) {
        match (i, ev) {
            (0, Ok(Evenement::CommitAccepte { welcome })) => w3 = welcome,
            (4, ev) => assert_eq!(ev, Ok(Evenement::Ignore)),
            (_, ev) => assert!(matches!(ev, Ok(Evenement::Membres { .. })), "{ev:?}"),
        }
    }
    assert!(matches!(
        r.entrer(&mut s3, &w3.unwrap(), 0),
        Ok(Evenement::Entree { .. })
    ));
    r.m[3] = Some(s3);
    // L'arrivant X publie, le créateur l'ajoute ; son Welcome le fait entrer.
    for (i, ev) in r.diffuser(4, &kp_x) {
        let attendu = if i == 4 {
            Evenement::Ignore
        } else {
            Evenement::KeyPackage { octets: mls(&kp_x) }
        };
        assert_eq!(ev, Ok(attendu), "membre {i}");
    }
    let cx = r.salon(0).ajouter(&cles(), &mls(&kp_x)).unwrap();
    let mut wx = None;
    for (i, ev) in r.diffuser(0, &cx) {
        match (i, ev) {
            (0, Ok(Evenement::CommitAccepte { welcome })) => wx = welcome,
            (4, ev) => assert_eq!(ev, Ok(Evenement::Ignore)),
            (_, ev) => assert!(matches!(ev, Ok(Evenement::Membres { .. })), "{ev:?}"),
        }
    }
    let ev = r.diffuser(0, &wx.unwrap());
    assert!(
        matches!(ev.last().unwrap(), (4, Ok(Evenement::Entree { .. }))),
        "{ev:?}"
    );
    r.meme_epoque();
    r.message(4, 1);
    r.message(3, 2);
}

/// N2 : à l'époque E−1, un Commit refusé par tous (siège 2, non créateur, qui retire un
/// présent) est rangé avant le vrai Commit du créateur ; entre les deux, le siège 4 fait une
/// reprise (l'arrivant X, `nonce(4, 1)`) et le vrai Commit remplace sa feuille. Le Welcome de X,
/// envoyé par le siège 0, est vérifié avec les annonces au rang du Commit **de ce siège**.
#[test]
fn n2_commit_refuse_avant_le_vrai() {
    commit_refuse_puis_vrai(2);
}

/// N2, second candidat : le Commit refusé est remis à X sous le siège attesté 0 (celui du
/// Welcome) : premier candidat, il ne vérifie pas le Welcome (siège 4 encore à `nonce(4, 0)`) ;
/// le candidat suivant, le vrai Commit, le fait entrer.
#[test]
fn n2_second_candidat_du_meme_siege() {
    commit_refuse_puis_vrai(0);
}

/// Scénario des deux tests N2 ; `atteste_pour_x` : siège sous lequel X reçoit le Commit refusé.
fn commit_refuse_puis_vrai(atteste_pour_x: u8) {
    let mut r = groupe(5);
    // Ancienne instance du siège 4 et le siège 2 (qui va diverger) hors du réseau.
    let _ancien = r.m[4].take().unwrap();
    let mut s2 = r.m[2].take().unwrap();
    // X (futur siège 4) suit le réseau dès sa création ; liste de l'accueil : siège 4 à
    // `nonce(4, 0)`.
    let mut x = Salon::creer(nouvelle_identite(4, nonce(4, 1)).unwrap(), &cles(), false).unwrap();
    x.remplacer_annonces(0, &r.liste);
    let kp_x = x.key_package(&cles()).unwrap();
    r.m[4] = Some(x);
    // Le siège 2 croit le siège 3 parti et le retire : refusé par tous les autres.
    s2.marquer_parti(3);
    let faux = s2.retirer(&cles(), 3).unwrap();
    let mut x = r.m[4].take().unwrap();
    for (i, ev) in r.diffuser(2, &faux) {
        assert_eq!(ev, Err(Error::CommitRefuse), "membre {i}");
    }
    assert_eq!(
        x.recevoir_trame(&cles(), &faux, r.seq, atteste_pour_x),
        Ok(Evenement::Ignore)
    );
    r.m[4] = Some(x);
    // Reprise du siège 4 (`nonce(4, 1)`), puis le vrai Commit du créateur.
    r.annoncer(4, nonce(4, 1));
    for (i, ev) in r.diffuser(4, &kp_x) {
        let attendu = if i == 4 {
            Evenement::Ignore
        } else {
            Evenement::KeyPackage { octets: mls(&kp_x) }
        };
        assert_eq!(ev, Ok(attendu), "membre {i}");
    }
    let c = r.salon(0).ajouter(&cles(), &mls(&kp_x)).unwrap();
    let mut w = None;
    for (i, ev) in r.diffuser(0, &c) {
        match (i, ev) {
            (0, Ok(Evenement::CommitAccepte { welcome })) => w = welcome,
            (4, ev) => assert_eq!(ev, Ok(Evenement::Ignore)),
            (i, ev) => assert_eq!(
                ev,
                Ok(Evenement::Membres {
                    ajoutes: vec![4],
                    retires: vec![4]
                }),
                "membre {i}"
            ),
        }
    }
    let ev = r.diffuser(0, &w.unwrap());
    assert!(
        matches!(ev.last().unwrap(), (4, Ok(Evenement::Entree { .. }))),
        "{ev:?}"
    );
    r.meme_epoque();
    r.message(4, 1);
    r.message(1, 2);
}

/// N2 : le siège attesté du Welcome doit être celui d'une feuille de son arbre, autre que la
/// nôtre ; sinon `mls_invalide` et la file est gardée : le même Welcome, remis ensuite avec le
/// bon siège, fait entrer et rejoue la file.
#[test]
fn n2_welcome_hors_arbre_refuse() {
    let mut r = groupe(3);
    r.annoncer(3, nonce(3, 0));
    let mut x = r.nouveau(3, nonce(3, 0));
    let kp = x.key_package(&cles()).unwrap();
    r.publier(3, &kp);
    assert_eq!(
        x.recevoir_trame(&cles(), &kp, r.seq, 3),
        Ok(Evenement::Ignore)
    );
    let c = r.salon(1).ajouter(&cles(), &mls(&kp)).unwrap();
    let w = r.commit_accepte(1, &c, vec![3], vec![]).unwrap();
    assert_eq!(
        x.recevoir_trame(&cles(), &c, r.seq, 1),
        Ok(Evenement::Ignore)
    );
    // Un message après le Commit, gardé dans la file de X.
    let e = env(9);
    let t = r.salon(2).envoyer(&cles(), &e).unwrap();
    r.diffuser(2, &t);
    let seq_t = r.seq;
    assert_eq!(
        x.recevoir_trame(&cles(), &t, seq_t, 2),
        Ok(Evenement::Ignore)
    );
    // Siège absent de l'arbre, puis notre propre siège : refusés.
    for de in [7, 3] {
        assert_eq!(
            r.entrer(&mut x, &w, de),
            Err(Error::MlsInvalide),
            "siège {de}"
        );
        assert_eq!(x.epoque(), None);
    }
    let Ok(Evenement::Entree { rejoues }) = r.entrer(&mut x, &w, 1) else {
        panic!("entrée attendue");
    };
    assert_eq!(
        rejoues.last(),
        Some(&(
            seq_t,
            Ok(Evenement::Message {
                de_siege: 2,
                enveloppe: e
            })
        ))
    );
    r.m.push(Some(x));
    r.meme_epoque();
    r.message(3, 1);
}
