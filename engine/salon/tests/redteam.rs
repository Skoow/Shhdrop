//! Non-régression de l'audit adverse du 13 novembre (second passage, protocole d'exclusion) :
//! les scénarios de l'audit, joués avec le vrai moteur sans contourner son API, affirment
//! maintenant le comportement corrigé (F1 à F4) ou la limite documentée (F5, H3). Les messages
//! fabriqués hors de `Salon` (client modifié) sont dans les tests unitaires de `groupe.rs`.
//!
//! Sièges : 0 = créateur C, 1 = membre A, 2 = exclu X, 3 = Carole. « Invitation » n :
//! `cles(n)`. X joue un client modifié : il ignore son retrait et garde l'état de l'époque n.
use shhdrop_core::{KLien, KMdp};
use shhdrop_salon::{
    ClesSalon, Enveloppe, Error, Evenement, Graine, Message, Regle, Salon, cle_maitre,
    cles_depuis_maitre, cles_salon, lire_en_tete, nouvelle_identite, ouvrir,
};

fn cles(n: u8) -> ClesSalon {
    cles_salon(&KLien::from_bytes([n; 32]), &KMdp::from_bytes([2; 32]))
}

fn nonce(siege: u8, n: u8) -> [u8; 16] {
    let mut x = [0xA0 ^ n; 16];
    x[0] = siege;
    x[1] = n;
    x
}

/// `K_maître_s` de l'invitation n : ce que le créateur distribue à une rotation.
fn maitre(n: u8) -> Graine {
    Graine::new(*cle_maitre(
        &KLien::from_bytes([n; 32]),
        &KMdp::from_bytes([2; 32]),
    ))
}

fn rotation(k: u8, n: u32, inv: u8) -> Enveloppe {
    Enveloppe {
        id: [k; 16],
        heure_ms: 1_700_000_000_000 + u64::from(k),
        regle: Regle::Desactive,
        message: Message::Rotation {
            n,
            cle: maitre(inv),
        },
    }
}

fn texte(k: u8, x: &str) -> Enveloppe {
    Enveloppe {
        id: [k; 16],
        heure_ms: 1_700_000_000_000 + u64::from(k),
        regle: Regle::Desactive,
        message: Message::Texte { x: x.into() },
    }
}

/// Le « serveur » : numérote et remet une trame aux membres choisis, chacun avec l'invitation
/// (`ClesSalon`) qu'il utilise.
struct Net {
    m: Vec<Option<Salon>>,
    inv: Vec<u8>,
    seq: u64,
    liste: Vec<(u8, [u8; 16])>,
}

impl Net {
    fn s(&mut self, i: usize) -> &mut Salon {
        self.m[i].as_mut().unwrap()
    }

    fn remettre(
        &mut self,
        de: u8,
        t: &[u8],
        a: &[usize],
    ) -> Vec<(usize, Result<Evenement, Error>)> {
        self.seq += 1;
        let seq = self.seq;
        let mut r = Vec::new();
        for &i in a {
            let c = cles(self.inv[i]);
            if let Some(s) = self.m[i].as_mut() {
                r.push((i, s.recevoir_trame(&c, t, seq, de)));
            }
        }
        r
    }

    fn tous(&self) -> Vec<usize> {
        (0..self.m.len()).filter(|&i| self.m[i].is_some()).collect()
    }

    /// Arrivée au siège `siege` sous l'invitation `inv` ; `entree` : ce qu'a rendu le Welcome.
    fn arrivee(&mut self, siege: u8, inv: u8) -> Result<Evenement, Error> {
        let n = nonce(siege, 0);
        self.liste.retain(|a| a.0 != siege);
        self.liste.push((siege, n));
        for s in self.m.iter_mut().flatten() {
            s.annoncer(siege, n);
        }
        let mut x = Salon::creer(nouvelle_identite(siege, n).unwrap(), &cles(inv), false).unwrap();
        x.remplacer_annonces(0, &self.liste);
        let kp = x.key_package(&cles(inv)).unwrap();
        // Les membres sous la même invitation (un exclu resté sous l'ancienne n'ouvre rien).
        let tous: Vec<usize> = self
            .tous()
            .into_iter()
            .filter(|&i| self.inv[i] == inv)
            .collect();
        for (_, r) in self.remettre(siege, &kp, &tous) {
            assert!(matches!(r, Ok(Evenement::KeyPackage { .. })), "{r:?}");
        }
        let kp_mls = ouvrir(&cles(inv), &kp).unwrap().1.to_vec();
        let cinv = cles(self.inv[0]);
        let commit = self.s(0).ajouter(&cinv, &kp_mls).unwrap();
        let mut welcome = None;
        for (i, r) in self.remettre(0, &commit, &tous) {
            match r {
                Ok(Evenement::CommitAccepte { welcome: w }) if i == 0 => welcome = w,
                Ok(Evenement::Membres { .. }) => {}
                autre => panic!("{i} : {autre:?}"),
            }
        }
        self.seq += 1;
        let entree = x.recevoir_trame(&cles(inv), &welcome.unwrap(), self.seq, 0);
        let s = siege as usize;
        if self.m.len() <= s {
            self.m.resize_with(s + 1, || None);
            self.inv.resize(s + 1, inv);
        }
        self.inv[s] = inv;
        self.m[s] = Some(x);
        entree
    }
}

/// C (créateur), A, X sous l'invitation 1.
fn trio() -> Net {
    let mut c = Salon::creer(nouvelle_identite(0, nonce(0, 0)).unwrap(), &cles(1), true).unwrap();
    let liste = vec![(0, nonce(0, 0))];
    c.remplacer_annonces(0, &liste);
    let mut n = Net {
        m: vec![Some(c)],
        inv: vec![1],
        seq: 0,
        liste,
    };
    assert!(matches!(n.arrivee(1, 1), Ok(Evenement::Entree { .. })));
    assert!(matches!(n.arrivee(2, 1), Ok(Evenement::Entree { .. })));
    for i in 0..3 {
        assert_eq!(n.s(i).membres(), vec![0, 1, 2]);
    }
    n
}

const SECRET: &str = "contenu écrit après l'exclusion";

fn lit_le_secret(r: &Result<Evenement, Error>) -> bool {
    matches!(r, Ok(Evenement::Message { enveloppe, .. })
        if matches!(&enveloppe.message, Message::Texte { x } if x == SECRET))
}

/// La clé de rotation de l'invitation `inv`, si l'événement la porte.
fn lit_la_rotation(r: &Result<Evenement, Error>, inv: u8) -> bool {
    matches!(r, Ok(Evenement::Message { enveloppe, .. })
        if matches!(&enveloppe.message, Message::Rotation { cle, .. } if *cle == maitre(inv)))
}

impl Net {
    /// Retrait de X par le créateur, écho compris, sans le remettre à X (qui l'ignore).
    fn retirer_x(&mut self) {
        let commit = self.s(0).retirer(&cles(1), 2).unwrap();
        let r = self.remettre(0, &commit, &[0, 1]);
        assert!(
            matches!(r[0].1, Ok(Evenement::CommitAccepte { .. })),
            "{r:?}"
        );
        assert_eq!(
            r[1].1,
            Ok(Evenement::Membres {
                ajoutes: vec![],
                retires: vec![2]
            })
        );
    }

    fn refonder(&mut self, i: usize, inv: u8) {
        let ancien = self.m[i].take().unwrap();
        self.m[i] = Some(ancien.refonder(&cles(inv)).unwrap());
        self.inv[i] = inv;
    }
}

/// F1, ordre sûr : retrait d'abord (Commit fusionné), puis la rotation à l'époque n+1. A la lit
/// (l'événement dit son époque, la courante) ; X, resté à l'époque n, ne lit rien.
#[test]
fn h1_ordre_sur_cle_apres_le_commit() {
    let mut n = trio();
    let e0 = n.s(0).epoque().unwrap();
    n.retirer_x();
    assert_eq!(n.s(0).epoque(), Some(e0 + 1));
    let t = n.s(0).envoyer(&cles(1), &rotation(7, 1, 3)).unwrap();
    let r = n.remettre(0, &t, &[1, 2]);
    assert!(lit_la_rotation(&r[0].1, 3), "{:?}", r[0].1);
    assert!(
        matches!(r[0].1, Ok(Evenement::Message { de_siege: 0, epoque, .. }) if epoque == e0 + 1)
    );
    assert_eq!(r[1].1, Err(Error::EpoquePerdue));
}

/// F1, ordre sûr, X honnête qui traite son retrait : groupe inactif, `non_membre`.
#[test]
fn h1_ordre_sur_x_honnete() {
    let mut n = trio();
    let commit = n.s(0).retirer(&cles(1), 2).unwrap();
    let r = n.remettre(0, &commit, &[0, 1, 2]);
    assert_eq!(
        r[2].1,
        Ok(Evenement::Membres {
            ajoutes: vec![],
            retires: vec![2]
        })
    );
    let t = n.s(0).envoyer(&cles(1), &rotation(7, 1, 3)).unwrap();
    let r = n.remettre(0, &t, &[1, 2]);
    assert!(lit_la_rotation(&r[0].1, 3));
    assert_eq!(r[1].1, Err(Error::NonMembre));
    assert_eq!(
        n.s(2)
            .envoyer(&cles(1), &texte(8, "encore là"))
            .unwrap_err(),
        Error::NonMembre
    );
}

/// F1 (était cassé) : « retirer puis envoyer la clé » d'un trait, sans attendre l'écho du
/// Commit. Le moteur refuse tout envoi tant que le Commit est en attente : rien n'est chiffré à
/// l'époque n, que X connaît. Après l'écho, l'envoi passe, à l'époque n+1.
#[test]
fn h1_cle_envoyee_commit_en_attente() {
    let mut n = trio();
    let e0 = n.s(0).epoque().unwrap();
    let commit = n.s(0).retirer(&cles(1), 2).unwrap();
    for e in [rotation(7, 1, 3), texte(8, SECRET)] {
        assert_eq!(
            n.s(0).envoyer(&cles(1), &e).unwrap_err(),
            Error::CommitEnCours
        );
    }
    // Un renouvellement ou un ajout en attente bloque de même (une seule règle).
    let renouv = n.s(1).renouveler(&cles(1)).unwrap();
    assert_eq!(
        n.s(1).envoyer(&cles(1), &texte(9, SECRET)).unwrap_err(),
        Error::CommitEnCours
    );
    // Le retrait gagne : le Commit de A est perdu, A peut de nouveau écrire.
    let r = n.remettre(0, &commit, &[0, 1]);
    assert!(matches!(r[0].1, Ok(Evenement::CommitAccepte { .. })));
    assert!(matches!(r[1].1, Ok(Evenement::CommitPerdu { .. })));
    let r = n.remettre(1, &renouv, &[0, 1]);
    assert_eq!(r[0].1, Ok(Evenement::Ignore));
    let t = n.s(0).envoyer(&cles(1), &rotation(7, 1, 3)).unwrap();
    let r = n.remettre(0, &t, &[1, 2]);
    assert!(lit_la_rotation(&r[0].1, 3));
    assert!(matches!(r[0].1, Ok(Evenement::Message { epoque, .. }) if epoque == e0 + 1));
    assert_eq!(r[1].1, Err(Error::EpoquePerdue));
    let t = n.s(1).envoyer(&cles(1), &texte(9, SECRET)).unwrap();
    let r = n.remettre(1, &t, &[0, 2]);
    assert!(lit_le_secret(&r[0].1));
    assert!(!lit_le_secret(&r[1].1));
}

/// F1 (était inapplicable) : A écrit avant d'avoir vu le Commit de retrait, le serveur range
/// son message après. Il reste lisible (une époque de retard, `max_past_epochs(1)`), mais
/// l'événement dit maintenant **l'époque du message** : C voit qu'il date d'avant le retrait.
#[test]
fn h1_course_message_epoque_n_apres_commit() {
    let mut n = trio();
    let e0 = n.s(0).epoque().unwrap();
    let commit = n.s(0).retirer(&cles(1), 2).unwrap();
    let t = n.s(1).envoyer(&cles(1), &texte(8, SECRET)).unwrap();
    let r = n.remettre(0, &commit, &[0]);
    assert!(matches!(r[0].1, Ok(Evenement::CommitAccepte { .. })));
    let r = n.remettre(1, &t, &[0]);
    assert_eq!(n.s(0).epoque(), Some(e0 + 1));
    assert!(lit_le_secret(&r[0].1));
    assert!(
        matches!(r[0].1, Ok(Evenement::Message { de_siege: 1, epoque, .. }) if epoque == e0),
        "{:?}",
        r[0].1
    );
}

/// F1 : une rotation chiffrée à l'époque n et rangée après un Commit (ici un renouvellement de
/// A passé entre l'envoi et le rang) est refusée par tous (`rotation_refusee`) : à l'époque
/// précédente, un membre retiré depuis l'aurait lue. Le créateur le voit (son époque a changé
/// entre l'envoi et l'écho) et la renvoie à l'époque courante.
#[test]
fn rotation_d_une_epoque_passee_refusee() {
    let mut n = trio();
    let e0 = n.s(0).epoque().unwrap();
    let t = n.s(0).envoyer(&cles(1), &rotation(7, 1, 3)).unwrap();
    let renouv = n.s(1).renouveler(&cles(1)).unwrap();
    n.remettre(1, &renouv, &[0, 1, 2]);
    let r = n.remettre(0, &t, &[0, 1, 2]);
    assert_eq!(r[0].1, Ok(Evenement::Ignore)); // écho : le créateur ne relit pas son message
    assert_eq!(n.s(0).epoque(), Some(e0 + 1)); // … mais voit que l'époque a changé
    for x in &r[1..] {
        assert_eq!(x.1, Err(Error::RotationRefusee));
    }
    // Renvoyée à l'époque courante : acceptée.
    let t = n.s(0).envoyer(&cles(1), &rotation(8, 1, 3)).unwrap();
    let r = n.remettre(0, &t, &[1]);
    assert!(lit_la_rotation(&r[0].1, 3));
}

/// F1 : seul le créateur envoie une rotation (le moteur d'un autre membre refuse de la faire).
#[test]
fn rotation_reservee_au_createur() {
    let mut n = trio();
    assert_eq!(
        n.s(1).envoyer(&cles(1), &rotation(7, 1, 3)).unwrap_err(),
        Error::RotationRefusee
    );
}

/// F5 (limite documentée, spec salon v3 §15 C-P1) : après un simple `retirer`, sans rotation, X
/// garde `K_trame` et ouvre l'enveloppe de toute trame suivante (bit volatil, règle, taille de
/// la charge) ; le contenu MLS reste fermé. Après la rotation, il n'ouvre plus rien.
#[test]
fn p1_retirer_laisse_k_trame() {
    let mut n = trio();
    n.retirer_x();
    let mut e = texte(9, "contenu secret");
    e.regle = Regle::UneMinute;
    let t = n.s(1).envoyer(&cles(1), &e).unwrap();
    let (en_tete, charge) = ouvrir(&cles(1), &t).unwrap();
    assert_eq!((en_tete.volatile, en_tete.regle), (false, Regle::UneMinute));
    assert!(!charge.is_empty());
    let r = n.remettre(1, &t, &[2]);
    assert_eq!(r[0].1, Err(Error::EpoquePerdue));
    // Rotation : les trames sont sous la K_trame de l'invitation 3.
    n.refonder(0, 3);
    let t3 = n.s(0).envoyer(&cles(3), &e).unwrap();
    assert_eq!(ouvrir(&cles(1), &t3).unwrap_err(), Error::TrameCorrompue);
    assert!(lire_en_tete(&t3).is_ok()); // l'en-tête en clair reste lisible par tous (serveur compris)
}

/// F3 (contrôle) : sans refondation, le groupe reste lié à l'étiquette de l'invitation
/// d'origine ; le Welcome d'une arrivante munie de la nouvelle invitation est refusé. Le lien
/// entre le groupe MLS et l'invitation est gardé : c'est la rotation qui refonde le groupe.
#[test]
fn rotation_sans_refondation_refuse_l_arrivante() {
    let mut n = trio();
    n.retirer_x();
    n.m[2] = None;
    n.liste.retain(|a| a.0 != 2);
    for i in [0, 1] {
        n.inv[i] = 3;
    }
    assert_eq!(n.arrivee(3, 3), Err(Error::MlsInvalide));
}

/// F3 et F4, de bout en bout : exclusion (`0x09`) → retrait → rotation (`K_maître_s'` seule) →
/// refondation du groupe sous la nouvelle invitation → Carole entre avec la nouvelle
/// invitation ; X ne lit plus rien ; l'ancienne invitation ne marche plus ; les codes de
/// vérification des membres restés ne changent pas.
#[test]
fn exclusion_rotation_nouvelle_arrivante() {
    let mut n = trio();
    let codes: Vec<String> = (0..2).map(|s| n.s(0).empreinte(s).unwrap()).collect();
    // 1. Le serveur exclut X (0x09) : tant que sa feuille est là, personne n'écrit.
    for i in [0, 1] {
        n.s(i).marquer_parti(2);
        assert_eq!(n.s(i).a_retirer(), vec![2]);
        assert_eq!(
            n.s(i).envoyer(&cles(1), &texte(1, SECRET)).unwrap_err(),
            Error::RetraitEnAttente
        );
    }
    // 2. Retrait par le créateur ; rien ne part avant l'écho.
    n.retirer_x();
    assert_eq!(n.s(0).a_retirer(), Vec::<u8>::new());
    // 3. Rotation : le créateur ne distribue que K_maître_s' (invitation 3).
    let t = n.s(0).envoyer(&cles(1), &rotation(2, 1, 3)).unwrap();
    let r = n.remettre(0, &t, &[1, 2]);
    assert_eq!(r[1].1, Err(Error::EpoquePerdue)); // X ne lit pas la nouvelle clé
    let Ok(Evenement::Message { enveloppe, .. }) = &r[0].1 else {
        panic!("{:?}", r[0].1)
    };
    let Message::Rotation { n: numero, cle } = &enveloppe.message else {
        panic!("{enveloppe:?}")
    };
    assert_eq!(*numero, 1);
    // F4 : A tire les clés du salon de K_maître_s' seule, les mêmes que l'invitation 3.
    let cles_a = cles_depuis_maitre(cle.as_bytes());
    assert_eq!(cles_a.tag(), cles(3).tag());
    assert_eq!(cles_a.k_trame(), cles(3).k_trame());
    assert_eq!(cles_a.k_preuve(), cles(3).k_preuve());
    // 4. Refondation sous les nouvelles clés (même identité) ; A publie un KeyPackage.
    let ancienne = n
        .s(1)
        .envoyer(&cles(1), &texte(3, "ancien groupe"))
        .unwrap();
    n.refonder(0, 3);
    let neuf = n.m[1].take().unwrap().refonder(&cles_a).unwrap();
    n.m[1] = Some(neuf);
    n.inv[1] = 3;
    n.liste.retain(|a| a.0 != 2);
    assert_eq!(n.s(0).membres(), vec![0]);
    assert_eq!(n.s(1).membres(), Vec::<u8>::new());
    let kp = n.s(1).key_package(&cles(3)).unwrap();
    let r = n.remettre(1, &kp, &[0, 1, 2]);
    assert_eq!(r[2].1, Err(Error::TrameCorrompue)); // X n'ouvre même plus l'enveloppe
    let Ok(Evenement::KeyPackage { octets }) = &r[0].1 else {
        panic!("{:?}", r[0].1)
    };
    let commit = n.s(0).ajouter(&cles(3), octets).unwrap();
    let r = n.remettre(0, &commit, &[0, 1]);
    let Ok(Evenement::CommitAccepte { welcome: Some(w) }) = &r[0].1 else {
        panic!("{:?}", r[0].1)
    };
    let r = n.remettre(0, w, &[1, 2]);
    assert!(
        matches!(r[0].1, Ok(Evenement::Entree { .. })),
        "{:?}",
        r[0].1
    );
    assert_eq!(r[1].1, Err(Error::TrameCorrompue));
    for i in [0, 1] {
        assert_eq!(n.s(i).membres(), vec![0, 1]);
        // Codes de vérification inchangés : la refondation garde l'identité.
        for s in 0..2u8 {
            assert_eq!(n.s(i).empreinte(s).unwrap(), codes[s as usize]);
        }
    }
    // 5. Carole entre avec la nouvelle invitation.
    let entree = n.arrivee(3, 3);
    assert!(matches!(entree, Ok(Evenement::Entree { .. })), "{entree:?}");
    for i in [0, 1, 3] {
        assert_eq!(n.s(i).membres(), vec![0, 1, 3]);
    }
    // 6. Tout le monde se lit ; X (ancienne invitation, état de l'ancien groupe) ne lit rien.
    for (k, de) in [(10u8, 0usize), (11, 1), (12, 3)] {
        let t = n.s(de).envoyer(&cles(3), &texte(k, SECRET)).unwrap();
        let r = n.remettre(de as u8, &t, &[0, 1, 2, 3]);
        for (i, x) in &r {
            match *i {
                2 => assert_eq!(*x, Err(Error::TrameCorrompue)),
                i if i == de => assert_eq!(*x, Ok(Evenement::Ignore)),
                _ => assert!(lit_le_secret(x), "{i} : {x:?}"),
            }
        }
        // Même en lui donnant la charge MLS nue (complice), son ancien état ne l'ouvre pas.
        let (en_tete, charge) = ouvrir(&cles(3), &t).unwrap();
        let rescellee = shhdrop_salon::sceller(&cles(1), en_tete, &charge).unwrap();
        let r = n.remettre(de as u8, &rescellee, &[2]);
        assert!(r[0].1.is_err(), "{:?}", r[0].1);
    }
    // 7. Une trame de l'ancien groupe n'est lisible ni par Carole ni par les membres refondés.
    let r = n.remettre(1, &ancienne, &[0, 1, 3]);
    for (i, x) in r {
        assert_eq!(x, Err(Error::TrameCorrompue), "{i}");
    }
    // 8. L'ancienne invitation ne marche plus : le KeyPackage d'un arrivant qui l'utilise n'est
    // ouvert par personne, il n'est donc jamais ajouté.
    let nonce_z = nonce(4, 0);
    for i in [0, 1, 3] {
        n.s(i).annoncer(4, nonce_z);
    }
    let mut z = Salon::creer(nouvelle_identite(4, nonce_z).unwrap(), &cles(1), false).unwrap();
    let kp = z.key_package(&cles(1)).unwrap();
    for (i, x) in n.remettre(4, &kp, &[0, 1, 3]) {
        assert_eq!(x, Err(Error::TrameCorrompue), "{i}");
    }
    // … et s'il recevait un Welcome du nouveau groupe, il ne l'ouvrirait pas.
    let t = n.s(0).envoyer(&cles(3), &texte(13, SECRET)).unwrap();
    assert_eq!(
        z.recevoir_trame(&cles(1), &t, 1, 0),
        Err(Error::TrameCorrompue)
    );
}

/// Rejeu par le serveur d'une trame applicative déjà lue, sous un nouveau rang.
#[test]
fn rejeu_message_nouveau_rang() {
    let mut n = trio();
    let t = n.s(1).envoyer(&cles(1), &texte(11, "une fois")).unwrap();
    let r = n.remettre(1, &t, &[0]);
    assert!(matches!(r[0].1, Ok(Evenement::Message { .. })));
    let r = n.remettre(1, &t, &[0]);
    assert_eq!(r[0].1, Err(Error::MlsInvalide));
}

/// Rejeu d'un Commit (retrait) déjà fusionné, sous un nouveau rang : ignoré.
#[test]
fn rejeu_commit_nouveau_rang() {
    let mut n = trio();
    let commit = n.s(0).retirer(&cles(1), 2).unwrap();
    n.remettre(0, &commit, &[0, 1]);
    let e = n.s(1).epoque();
    for (_, x) in n.remettre(0, &commit, &[0, 1]) {
        assert_eq!(x, Ok(Evenement::Ignore));
    }
    assert_eq!(n.s(1).epoque(), e);
}

/// Un exclu (client modifié, état de l'époque n) écrit après le Commit de retrait : refusé.
#[test]
fn exclu_ecrit_apres_retrait() {
    let mut n = trio();
    n.retirer_x();
    let t = n
        .s(2)
        .envoyer(&cles(1), &texte(12, "je suis encore là"))
        .unwrap();
    for (_, x) in n.remettre(2, &t, &[0, 1]) {
        assert_eq!(x, Err(Error::NonMembre));
    }
}

/// F2 (était cassé) : après le `0x09` et avant le Commit qui retire sa feuille, le moteur
/// refuse d'envoyer (`retrait_en_attente`) : rien n'est chiffré pour X après son exclusion.
/// Tout membre peut le retirer ; ensuite l'envoi passe et X ne le lit pas.
#[test]
fn envoi_refuse_exclu_encore_dans_l_arbre() {
    let mut n = trio();
    for i in [0, 1] {
        n.s(i).marquer_parti(2);
    }
    for e in [
        texte(13, SECRET),
        Enveloppe {
            message: Message::Ecrit,
            ..texte(14, "")
        },
        rotation(15, 1, 3),
    ] {
        for i in [0, 1] {
            assert_eq!(
                n.s(i).envoyer(&cles(1), &e).unwrap_err(),
                Error::RetraitEnAttente
            );
        }
    }
    assert_eq!(n.s(1).a_retirer(), vec![2]);
    // A (pas le créateur) retire le siège exclu.
    let c = n.s(1).retirer(&cles(1), 2).unwrap();
    let r = n.remettre(1, &c, &[0, 1]);
    assert!(
        matches!(r[1].1, Ok(Evenement::CommitAccepte { .. })),
        "{r:?}"
    );
    assert_eq!(n.s(1).a_retirer(), Vec::<u8>::new());
    let t = n.s(1).envoyer(&cles(1), &texte(13, SECRET)).unwrap();
    let r = n.remettre(1, &t, &[0, 2]);
    assert!(lit_le_secret(&r[0].1));
    assert_eq!(r[1].1, Err(Error::EpoquePerdue));
}

/// F2 (était cassé) : après le `0x09`, un Commit de X (renouvellement) relayé par un serveur
/// complice est refusé par tous, avant fusion ; un message de X aussi. Le retrait passe ensuite.
#[test]
fn commit_d_un_exclu_marque_parti() {
    let mut n = trio();
    for i in [0, 1] {
        n.s(i).marquer_parti(2);
    }
    let e = n.s(0).epoque();
    let message = n.s(2).envoyer(&cles(1), &texte(16, "encore là")).unwrap();
    for (_, x) in n.remettre(2, &message, &[0, 1]) {
        assert_eq!(x, Err(Error::NonMembre));
    }
    let renouv = n.s(2).renouveler(&cles(1)).unwrap();
    for (_, x) in n.remettre(2, &renouv, &[0, 1]) {
        assert_eq!(x, Err(Error::CommitRefuse));
    }
    assert_eq!(n.s(0).epoque(), e);
    assert_eq!(n.s(1).epoque(), e);
    // Le Commit de X n'a pas pris l'époque : le retrait du créateur gagne.
    n.retirer_x();
    assert_eq!(n.s(0).membres(), vec![0, 1]);
    assert_eq!(n.s(1).membres(), vec![0, 1]);
}

/// H3 (limite documentée, spec salon v3 §15) : **avant** le `0x09`, X est un membre comme un
/// autre ; son renouvellement rangé avant le retrait du créateur fait perdre ce retrait, qui
/// est rejoué. D'où l'ordre imposé à l'appelant : `exclure` (`0x09`) d'abord, retrait ensuite.
/// Une fois le `0x09` reçu, les Commits de X ne prennent plus l'époque (test ci-dessus).
#[test]
fn exclu_retarde_son_retrait_avant_le_0x09() {
    let mut n = trio();
    let retrait = n.s(0).retirer(&cles(1), 2).unwrap();
    let renouv = n.s(2).renouveler(&cles(1)).unwrap();
    let r = n.remettre(2, &renouv, &[0, 1, 2]);
    assert!(matches!(r[0].1, Ok(Evenement::CommitPerdu { .. })));
    for (_, x) in n.remettre(0, &retrait, &[0, 1, 2]) {
        assert_eq!(x, Ok(Evenement::Ignore));
    }
    assert_eq!(n.s(0).membres(), vec![0, 1, 2]);
    // Après le 0x09, X ne gagne plus la course : son Commit est refusé, le retrait rejoué passe.
    for i in [0, 1] {
        n.s(i).marquer_parti(2);
    }
    let renouv = n.s(2).renouveler(&cles(1)).unwrap();
    let retrait = n.s(0).retirer(&cles(1), 2).unwrap();
    for (_, x) in n.remettre(2, &renouv, &[0, 1]) {
        assert_eq!(x, Err(Error::CommitRefuse));
    }
    let r = n.remettre(0, &retrait, &[0, 1]);
    assert!(
        matches!(r[0].1, Ok(Evenement::CommitAccepte { .. })),
        "{r:?}"
    );
    assert_eq!(n.s(1).membres(), vec![0, 1]);
}
