//! Non-régression de l'audit adverse du 13 novembre (second passage, protocole d'exclusion) :
//! les scénarios de l'audit, joués avec le vrai moteur sans contourner son API, affirment
//! maintenant le comportement corrigé (F1 à F4) ou la limite documentée (F5, H3). Les messages
//! fabriqués hors de `Salon` (client modifié) sont dans les tests unitaires de `groupe.rs`.
//!
//! Sièges : 0 = créateur C, 1 = membre A, 2 = exclu X, 3 = Carole. « Invitation » n :
//! `cles(n)`. X joue un client modifié : il ignore son retrait et garde l'état de l'époque n.
use shhdrop_core::{KLien, KMdp};
use shhdrop_salon::{
    ClesSalon, Enveloppe, Error, Evenement, Graine, Identite, Message, Regle, Salon, cle_maitre,
    cle_publique_role, cles_depuis_maitre, cles_salon, code_verification, identite_createur,
    lire_en_tete, nouvelle_identite, ouvrir,
};

/// Secret de gestion du salon (lien de gestion `#m…`) : la clé de rôle du créateur en est tirée
/// (14 novembre).
const S_GESTION: [u8; 32] = [0x5A; 32];

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
                Ok(Evenement::CommitAccepte { welcome: w, .. }) if i == 0 => welcome = w,
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

/// C (créateur, clé de rôle tirée de `S_GESTION`), A, X sous l'invitation 1.
fn trio() -> Net {
    let mut c = Salon::creer(
        identite_createur(0, nonce(0, 0), &S_GESTION).unwrap(),
        &cles(1),
        true,
    )
    .unwrap();
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
                retires: vec![2],
                createur_revenu: false,
            })
        );
    }

    /// `0x09` du serveur : X (siège 2) exclu, rotation numéro `r`, reçu par C et A.
    fn exclure_x(&mut self, r: u32) {
        for i in [0, 1] {
            self.s(i).marquer_exclu(Some(2), r);
        }
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
    n.exclure_x(1);
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
    n.exclure_x(1);
    let commit = n.s(0).retirer(&cles(1), 2).unwrap();
    let r = n.remettre(0, &commit, &[0, 1, 2]);
    assert_eq!(
        r[2].1,
        Ok(Evenement::Membres {
            ajoutes: vec![],
            retires: vec![2],
            createur_revenu: false,
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
    n.exclure_x(1);
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
/// entre l'envoi et l'écho ; depuis la relecture du 13 novembre, l'écho le dit :
/// `RotationARenvoyer`) et la renvoie à l'époque courante.
#[test]
fn rotation_d_une_epoque_passee_refusee() {
    let mut n = trio();
    let e0 = n.s(0).epoque().unwrap();
    for i in 0..3 {
        n.s(i).marquer_exclu(None, 1); // 0x09 sans exclu : nouveau lien d'invitation
    }
    let t = n.s(0).envoyer(&cles(1), &rotation(7, 1, 3)).unwrap();
    let renouv = n.s(1).renouveler(&cles(1)).unwrap();
    n.remettre(1, &renouv, &[0, 1, 2]);
    let r = n.remettre(0, &t, &[0, 1, 2]);
    // Écho : le créateur ne relit pas son message, mais le moteur lui dit de la renvoyer.
    assert_eq!(r[0].1, Ok(Evenement::RotationARenvoyer { n: 1 }));
    assert_eq!(n.s(0).epoque(), Some(e0 + 1));
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
        n.s(i).marquer_exclu(Some(2), 1);
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
    let r = n.remettre(0, &t, &[1, 2, 0]);
    assert_eq!(r[1].1, Err(Error::EpoquePerdue)); // X ne lit pas la nouvelle clé
    // Écho chez le créateur : les membres l'ont acceptée, il peut refonder.
    assert_eq!(r[2].1, Ok(Evenement::RotationAcceptee { n: 1 }));
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
    let Ok(Evenement::CommitAccepte {
        welcome: Some(w), ..
    }) = &r[0].1
    else {
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

// ---------------------------------------------------------------------------------------------
// Relecture du commit dcb6fa1 (14 novembre) : sept invariants (hypothèses 1 à 7, confirmées à la
// lecture du code d'origine ; ces tests utilisent l'interface corrigée et n'y ont pas été
// rejoués) ; spec salon v3 §15.1, « Relecture des règles du 13 novembre ».
// Les messages et Commits fabriqués hors de `Salon` sont dans les tests unitaires de `groupe.rs`.
// ---------------------------------------------------------------------------------------------

/// Point 1 : la marque « parti ou exclu » porte sur l'arrivée (siège, nonce) de la feuille. Une
/// nouvelle annonce sur le même siège (fausse arrivée d'un serveur complice, ou vraie arrivée
/// sur un siège libéré), la même arrivée annoncée de nouveau ou une liste complète qui remplace
/// le siège ne lèvent rien tant que l'ancienne feuille est dans l'arbre.
#[test]
fn p1_nouvelle_annonce_ne_leve_pas_l_exclusion() {
    let mut n = trio();
    n.exclure_x(1);
    let liste = vec![(0, nonce(0, 0)), (1, nonce(1, 0)), (2, nonce(2, 1))];
    for etape in 0..3 {
        for i in [0, 1] {
            match etape {
                0 => n.s(i).annoncer(2, nonce(2, 1)), // nouvelle arrivée sur le siège 2
                1 => n.s(i).annoncer(2, nonce(2, 0)), // l'arrivée exclue, annoncée de nouveau
                _ => n.s(i).remplacer_annonces(0, &liste), // liste complète
            }
            assert_eq!(n.s(i).a_retirer(), vec![2], "étape {etape}, membre {i}");
            assert_eq!(
                n.s(i).envoyer(&cles(1), &texte(1, SECRET)).unwrap_err(),
                Error::RetraitEnAttente
            );
        }
        assert_eq!(
            n.s(0).envoyer(&cles(1), &rotation(2, 1, 3)).unwrap_err(),
            Error::RetraitEnAttente
        );
    }
    // X (client modifié) : ni message ni Commit de lui ne passent.
    let e = n.s(0).epoque();
    let t = n.s(2).envoyer(&cles(1), &texte(3, "encore là")).unwrap();
    for (_, x) in n.remettre(2, &t, &[0, 1]) {
        assert_eq!(x, Err(Error::NonMembre));
    }
    let renouv = n.s(2).renouveler(&cles(1)).unwrap();
    for (_, x) in n.remettre(2, &renouv, &[0, 1]) {
        assert_eq!(x, Err(Error::CommitRefuse));
    }
    assert_eq!(n.s(1).epoque(), e);
    // Le retrait fait, tout repart ; X ne lit rien.
    n.retirer_x();
    assert_eq!(n.s(1).a_retirer(), Vec::<u8>::new());
    let t = n.s(1).envoyer(&cles(1), &texte(4, SECRET)).unwrap();
    let r = n.remettre(1, &t, &[0, 2]);
    assert!(lit_le_secret(&r[0].1));
    assert!(!lit_le_secret(&r[1].1));
}

/// Point 1 : un message `rotation` exige que **chaque** feuille soit l'annonce courante de son
/// siège. Pendant une reprise (0x0A : A revient après un rechargement, son ancienne feuille
/// attend d'être remplacée), l'ancienne feuille est à retirer (14 novembre : même jugement que
/// par la liste complète, `reprise_meme_jugement_par_le_flux_et_par_la_liste`) : ni message ni
/// rotation ; le Commit qui ajoute A revenu (ou un retrait) la retire, puis la rotation passe.
#[test]
fn p1_rotation_exige_chaque_feuille_annoncee() {
    let mut n = trio();
    for i in 0..3 {
        n.s(i).marquer_exclu(None, 1);
        n.s(i).annoncer(1, nonce(1, 1));
    }
    assert_eq!(n.s(0).a_retirer(), vec![1]);
    assert_eq!(
        n.s(0).envoyer(&cles(1), &texte(1, SECRET)).unwrap_err(),
        Error::RetraitEnAttente
    );
    assert_eq!(
        n.s(0).envoyer(&cles(1), &rotation(2, 1, 3)).unwrap_err(),
        Error::RetraitEnAttente
    );
    let c = n.s(0).retirer(&cles(1), 1).unwrap();
    n.remettre(0, &c, &[0, 2]);
    let t = n.s(0).envoyer(&cles(1), &rotation(2, 1, 3)).unwrap();
    let r = n.remettre(0, &t, &[0, 2]);
    assert_eq!(r[0].1, Ok(Evenement::RotationAcceptee { n: 1 }));
    assert!(lit_la_rotation(&r[1].1, 3));
}

/// Point 2 : le créateur apprend à l'écho si sa rotation a été acceptée. Un départ (0x03)
/// annoncé entre l'envoi et l'écho la fait refuser chez les membres **sans changer l'époque** :
/// l'écho rend `RotationARenvoyer` (avant : `Ignore`, et le créateur refondait seul). Le siège
/// parti retiré, la rotation renvoyée est acceptée, et l'écho le dit.
#[test]
fn p2_echo_de_la_rotation() {
    let mut n = trio();
    assert!(matches!(n.arrivee(3, 1), Ok(Evenement::Entree { .. })));
    let tous = [0, 1, 2, 3];
    for i in tous {
        n.s(i).marquer_exclu(None, 1);
    }
    let e0 = n.s(0).epoque();
    let t = n.s(0).envoyer(&cles(1), &rotation(1, 1, 3)).unwrap();
    for i in tous {
        n.s(i).marquer_parti(3); // 0x03 rangé entre la rotation envoyée et son rang
    }
    let r = n.remettre(0, &t, &[0, 1, 2]);
    assert_eq!(n.s(0).epoque(), e0);
    assert_eq!(r[0].1, Ok(Evenement::RotationARenvoyer { n: 1 }));
    assert_eq!(r[1].1, Err(Error::RotationRefusee));
    assert_eq!(r[2].1, Err(Error::RotationRefusee));
    // L'écho n'est rendu qu'une fois ; la même trame rejouée n'est plus rien.
    assert_eq!(n.remettre(0, &t, &[0])[0].1, Ok(Evenement::Ignore));
    // Retrait du siège parti, puis renvoi : accepté par tous, et le créateur le sait.
    let c = n.s(0).retirer(&cles(1), 3).unwrap();
    n.remettre(0, &c, &[0, 1, 2]);
    let t = n.s(0).envoyer(&cles(1), &rotation(2, 1, 3)).unwrap();
    let r = n.remettre(0, &t, &[0, 1, 2]);
    assert_eq!(r[0].1, Ok(Evenement::RotationAcceptee { n: 1 }));
    assert!(lit_la_rotation(&r[1].1, 3));
    assert!(lit_la_rotation(&r[2].1, 3));
    // Une trame attribuée à un autre siège n'est pas notre écho (elle serait refusée de tous).
    for i in [0, 1, 2] {
        n.s(i).marquer_exclu(None, 2);
    }
    let t = n.s(0).envoyer(&cles(1), &rotation(3, 2, 4)).unwrap();
    assert_eq!(n.remettre(1, &t, &[0])[0].1, Err(Error::MessageInvalide));
    assert_eq!(
        n.remettre(0, &t, &[0])[0].1,
        Ok(Evenement::RotationAcceptee { n: 2 })
    );
}

/// Point 3 : après une refondation, un siège connu ne revient qu'avec la clé d'identité qu'il
/// avait (même arrivée) : le KeyPackage d'une autre clé est ignoré, son ajout refusé. Un membre
/// refondé n'entre que dans le groupe du créateur qu'il connaissait : le Welcome d'un faux
/// groupe (autre clé au siège du créateur, serveur complice) est refusé ; le vrai passe ensuite.
#[test]
fn p3_refondation_garde_les_identites() {
    let mut n = trio();
    let codes: Vec<String> = (0..3).map(|s| n.s(0).empreinte(s).unwrap()).collect();
    for i in 0..3 {
        n.refonder(i, 3);
    }
    let liste = n.liste.clone();
    // Un autre que A publie au siège 1, même arrivée, autre clé (siège attesté 1).
    let mut faux =
        Salon::creer(nouvelle_identite(1, nonce(1, 0)).unwrap(), &cles(3), false).unwrap();
    faux.remplacer_annonces(0, &liste);
    let kp = faux.key_package(&cles(3)).unwrap();
    assert_eq!(n.remettre(1, &kp, &[0])[0].1, Ok(Evenement::Ignore));
    let kp_mls = ouvrir(&cles(3), &kp).unwrap().1.to_vec();
    assert_eq!(
        n.s(0).ajouter(&cles(3), &kp_mls).unwrap_err(),
        Error::CommitRefuse
    );
    // Faux groupe : un faux créateur (siège 0, autre clé) ajoute le vrai KeyPackage de A.
    let mut fc = Salon::creer(nouvelle_identite(0, nonce(0, 0)).unwrap(), &cles(3), true).unwrap();
    fc.remplacer_annonces(0, &liste);
    let kp = n.s(1).key_package(&cles(3)).unwrap();
    let Ok(Evenement::KeyPackage { octets }) = fc.recevoir_trame(&cles(3), &kp, 1, 1) else {
        panic!("KeyPackage attendu")
    };
    let c = fc.ajouter(&cles(3), &octets).unwrap();
    let Ok(Evenement::CommitAccepte {
        welcome: Some(w), ..
    }) = fc.recevoir_trame(&cles(3), &c, 2, 0)
    else {
        panic!("Welcome attendu")
    };
    n.remettre(1, &kp, &[1]);
    n.remettre(0, &c, &[1]);
    assert_eq!(n.remettre(0, &w, &[1])[0].1, Err(Error::MlsInvalide));
    assert_eq!(n.s(1).membres(), Vec::<u8>::new());
    // Le vrai créateur ajoute les vrais KeyPackages : chacun entre, codes inchangés.
    for i in [1usize, 2] {
        let kp = n.s(i).key_package(&cles(3)).unwrap();
        let r = n.remettre(i as u8, &kp, &[0, 1, 2]);
        let Ok(Evenement::KeyPackage { octets }) = &r[0].1 else {
            panic!("{:?}", r[0].1)
        };
        let c = n.s(0).ajouter(&cles(3), octets).unwrap();
        let r = n.remettre(0, &c, &[0, 1, 2]);
        let Ok(Evenement::CommitAccepte {
            welcome: Some(w), ..
        }) = &r[0].1
        else {
            panic!("{:?}", r[0].1)
        };
        let r = n.remettre(0, w, &[i]);
        assert!(matches!(r[0].1, Ok(Evenement::Entree { .. })), "{r:?}");
    }
    for i in 0..3 {
        assert_eq!(n.s(i).membres(), vec![0, 1, 2]);
        for s in 0..3u8 {
            assert_eq!(n.s(i).empreinte(s).unwrap(), codes[s as usize]);
        }
    }
}

/// Point 4 : le rôle de créateur ne suit pas le numéro de siège. Une reprise annoncée du siège 0
/// (fantôme d'un serveur complice, ou vrai créateur revenu avec une nouvelle clé) entre dans le
/// groupe sans les droits du créateur : son moteur le sait (l'identifiant du groupe porte la clé
/// du créateur d'origine) et refuse de retirer un membre présent ou d'envoyer la rotation.
/// (Le Commit et la rotation fabriqués par un client modifié : tests unitaires de `groupe.rs`.)
/// 14 novembre : la reprise de ce test a une identité tirée au hasard, donc sans `S_gestion`
/// (fantôme, ou créateur revenu sans son lien de gestion) ; avec `S_gestion`, voir `role_*`.
#[test]
fn p4_reprise_du_siege_du_createur_sans_ses_droits() {
    let mut n = trio();
    let nn = nonce(0, 1);
    for i in 0..3 {
        n.s(i).marquer_exclu(None, 1);
        n.s(i).annoncer(0, nn);
    }
    let mut f = Salon::creer(nouvelle_identite(0, nn).unwrap(), &cles(1), false).unwrap();
    f.remplacer_annonces(0, &[(0, nn), (1, nonce(1, 0)), (2, nonce(2, 0))]);
    f.marquer_exclu(None, 1);
    let kp = f.key_package(&cles(1)).unwrap();
    let r = n.remettre(0, &kp, &[1, 2]);
    let Ok(Evenement::KeyPackage { octets }) = &r[0].1 else {
        panic!("{r:?}")
    };
    let c = n.s(1).ajouter(&cles(1), octets).unwrap();
    let seq = n.seq + 1;
    f.recevoir_trame(&cles(1), &c, seq, 1).unwrap();
    let r = n.remettre(1, &c, &[1, 2]);
    let Ok(Evenement::CommitAccepte {
        welcome: Some(w), ..
    }) = &r[0].1
    else {
        panic!("{r:?}")
    };
    n.seq += 1;
    assert!(matches!(
        f.recevoir_trame(&cles(1), w, n.seq, 1),
        Ok(Evenement::Entree { .. })
    ));
    assert_eq!(f.membres(), vec![0, 1, 2]);
    assert_eq!(f.retirer(&cles(1), 2).unwrap_err(), Error::CommitRefuse);
    assert_eq!(
        f.envoyer(&cles(1), &rotation(1, 1, 3)).unwrap_err(),
        Error::RotationRefusee
    );
    // Il reste un membre ordinaire : il écrit, et retire un siège parti comme tout le monde.
    let t = f.envoyer(&cles(1), &texte(2, SECRET)).unwrap();
    assert!(lit_le_secret(&n.remettre(0, &t, &[1])[0].1));
    f.marquer_parti(2);
    assert!(f.retirer(&cles(1), 2).is_ok());
}

/// Point 5 : la clé des appels (`exporter_sframe`) suit les refus d'`envoyer` : pas de clé de
/// l'époque qu'un Commit en attente ferme, ni tant qu'une feuille partie ou exclue la connaît.
#[test]
fn p5_cle_d_appel_memes_refus_que_l_envoi() {
    let mut n = trio();
    assert!(n.s(1).exporter_sframe().is_ok());
    let commit = n.s(0).retirer(&cles(1), 2).unwrap();
    assert_eq!(n.s(0).exporter_sframe().unwrap_err(), Error::CommitEnCours);
    n.s(0).abandonner_commit().unwrap();
    let _ = commit;
    for i in 0..3 {
        n.s(i).marquer_parti(2);
    }
    assert_eq!(
        n.s(0).exporter_sframe().unwrap_err(),
        Error::RetraitEnAttente
    );
    assert_eq!(
        n.s(1).exporter_sframe().unwrap_err(),
        Error::RetraitEnAttente
    );
    assert_eq!(n.s(2).exporter_sframe().unwrap_err(), Error::NonMembre);
    n.retirer_x();
    let k0 = n.s(0).exporter_sframe().unwrap();
    assert_eq!(*k0, *n.s(1).exporter_sframe().unwrap());
}

/// Point 6 : le refus d'envoi ne se laisse pas prolonger sans fin. Un membre encore admis
/// (client modifié : il ignore le 0x03) enchaîne des renouvellements rangés avant le retrait du
/// siège parti. Avant : chacun prenait l'époque, le retrait perdait à chaque tour, tout envoi
/// restait refusé. Maintenant : tant qu'une feuille est à retirer, un Commit qui ne la retire
/// pas est refusé ; le retrait passe au premier tour.
#[test]
fn p6_retrait_prioritaire_pas_de_blocage() {
    let mut n = trio();
    assert!(matches!(n.arrivee(3, 1), Ok(Evenement::Entree { .. })));
    for i in [0, 1] {
        n.s(i).marquer_parti(2); // le siège 3 (hostile) n'applique pas le départ
    }
    let e = n.s(0).epoque().unwrap();
    let renouv = n.s(3).renouveler(&cles(1)).unwrap();
    let retrait = n.s(0).retirer(&cles(1), 2).unwrap();
    for (_, x) in n.remettre(3, &renouv, &[0, 1]) {
        assert_eq!(x, Err(Error::CommitRefuse));
    }
    let r = n.remettre(0, &retrait, &[0, 1]);
    assert!(
        matches!(r[0].1, Ok(Evenement::CommitAccepte { .. })),
        "{r:?}"
    );
    for i in [0, 1] {
        assert_eq!(n.s(i).epoque(), Some(e + 1));
        assert_eq!(n.s(i).a_retirer(), Vec::<u8>::new());
        assert!(n.s(i).envoyer(&cles(1), &texte(1, SECRET)).is_ok());
    }
}

/// Point 6, côté honnête : un renouvellement ou un ajout fait par le moteur pendant qu'une
/// feuille est à retirer la retire dans le même Commit (il n'est donc jamais refusé pour cela) ;
/// un Commit préparé avant le 0x03 et revenu après est abandonné à son écho (`CommitPerdu`).
#[test]
fn p6_tout_commit_retire_les_partis() {
    let mut n = trio();
    let avant = n.s(1).renouveler(&cles(1)).unwrap();
    for i in [0, 1] {
        n.s(i).marquer_parti(2);
    }
    let r = n.remettre(1, &avant, &[0, 1]);
    assert_eq!(r[0].1, Err(Error::CommitRefuse));
    assert_eq!(
        r[1].1,
        Ok(Evenement::CommitPerdu {
            ajoutes: vec![],
            retires: vec![],
            createur_revenu: false,
        })
    );
    let c = n.s(1).renouveler(&cles(1)).unwrap();
    let r = n.remettre(1, &c, &[0, 1]);
    assert_eq!(
        r[0].1,
        Ok(Evenement::Membres {
            ajoutes: vec![],
            retires: vec![2],
            createur_revenu: false,
        })
    );
    assert!(matches!(r[1].1, Ok(Evenement::CommitAccepte { .. })));
    assert_eq!(n.s(0).membres(), vec![0, 1]);
}

/// Point 7 : le numéro `n` de la rotation est celui de l'exclusion annoncée par le serveur
/// (`r` du 0x09, donné par `marquer_exclu`). Sans 0x09, ou avec un autre numéro, le créateur ne
/// l'envoie pas ; un membre qui n'a pas reçu ce 0x09 la refuse ; un numéro déjà servi ne
/// resert pas.
#[test]
fn p7_numero_de_rotation_lie_a_l_exclusion() {
    let mut n = trio();
    let refus = Error::RotationRefusee;
    assert_eq!(
        n.s(0).envoyer(&cles(1), &rotation(1, 1, 3)).unwrap_err(),
        refus
    );
    n.s(0).marquer_exclu(None, 5);
    n.s(1).marquer_exclu(None, 5);
    n.s(2).marquer_exclu(None, 4); // ce membre n'a pas reçu le 0x09 numéro 5
    for faux in [1, 4, 6] {
        assert_eq!(
            n.s(0).envoyer(&cles(1), &rotation(1, faux, 3)).unwrap_err(),
            refus
        );
    }
    let t = n.s(0).envoyer(&cles(1), &rotation(2, 5, 3)).unwrap();
    let r = n.remettre(0, &t, &[0, 1, 2]);
    assert_eq!(r[0].1, Ok(Evenement::RotationAcceptee { n: 5 }));
    assert!(lit_la_rotation(&r[1].1, 3));
    assert_eq!(r[2].1, Err(refus));
    // Le numéro 5 a servi : une seconde rotation du même numéro n'est plus envoyée.
    assert_eq!(
        n.s(0).envoyer(&cles(1), &rotation(3, 5, 4)).unwrap_err(),
        refus
    );
    // Un numéro plus ancien annoncé après coup ne fait pas reculer.
    n.s(0).marquer_exclu(None, 3);
    assert_eq!(
        n.s(0).envoyer(&cles(1), &rotation(4, 3, 4)).unwrap_err(),
        refus
    );
}

// ------------------------------------------------------------------------------------------
// Rôle du créateur lié à S_gestion (14 novembre, décision du propriétaire : « L'admin ne doit
// jamais perdre ses rôles admin même après un rechargement, ou quitter, ou fermer la page » ;
// spec salon v3 §15.2).

type Remis = Vec<(usize, Result<Evenement, Error>)>;

impl Net {
    /// Le créateur revient au siège 0 sous l'arrivée `nn` (0x0A après un rechargement, 0x02
    /// après « Quitter ») avec `identite` ; `temoins` : membres qui reçoivent l'annonce et les
    /// trames. Le siège 1 l'ajoute. Rend ce que le Commit d'ajout a donné aux témoins et le
    /// salon du revenant, entré.
    fn retour_createur(
        &mut self,
        nn: [u8; 16],
        identite: Identite,
        temoins: &[usize],
    ) -> (Remis, Salon) {
        self.liste.retain(|a| a.0 != 0);
        self.liste.push((0, nn));
        for &i in temoins {
            self.s(i).annoncer(0, nn);
        }
        let mut f = Salon::creer(identite, &cles(1), false).unwrap();
        f.remplacer_annonces(0, &self.liste);
        let kp = f.key_package(&cles(1)).unwrap();
        let r = self.remettre(0, &kp, temoins);
        f.recevoir_trame(&cles(1), &kp, self.seq, 0).unwrap();
        let Some((_, Ok(Evenement::KeyPackage { octets }))) = r.iter().find(|x| x.0 == 1) else {
            panic!("{r:?}")
        };
        let c = self.s(1).ajouter(&cles(1), octets).unwrap();
        let r = self.remettre(1, &c, temoins);
        f.recevoir_trame(&cles(1), &c, self.seq, 1).unwrap();
        let Some((
            _,
            Ok(Evenement::CommitAccepte {
                welcome: Some(w), ..
            }),
        )) = r.iter().find(|x| x.0 == 1)
        else {
            panic!("{r:?}")
        };
        let w = w.clone();
        self.remettre(1, &w, temoins);
        let e = f.recevoir_trame(&cles(1), &w, self.seq, 1);
        assert!(matches!(e, Ok(Evenement::Entree { .. })), "{e:?}");
        (r, f)
    }
}

/// Créateur rechargé (page rechargée : état perdu, reprise 0x0A du siège 0) : il revient avec
/// une nouvelle arrivée mais la même clé de rôle. Le Commit qui l'ajoute le dit à tous
/// (`createur_revenu`) ; le rôle est rendu dès ce Commit : il retire un membre présent et envoie
/// la rotation sans attendre de renouvellement. Son code de vérification n'a pas changé.
#[test]
fn role_rendu_au_createur_recharge() {
    let mut n = trio();
    let code = n.s(1).empreinte(0).unwrap();
    assert_eq!(code, code_verification(&cle_publique_role(&S_GESTION)));
    let _perdu = n.m[0].take();
    let nn = nonce(0, 1);
    let (r, f) = n.retour_createur(nn, identite_createur(0, nn, &S_GESTION).unwrap(), &[1, 2]);
    assert_eq!(
        r[0].1,
        Ok(Evenement::CommitAccepte {
            welcome: r[0].1.clone().ok().and_then(|e| match e {
                Evenement::CommitAccepte { welcome, .. } => welcome,
                _ => None,
            }),
            createur_revenu: true,
        })
    );
    assert_eq!(
        r[1].1,
        Ok(Evenement::Membres {
            ajoutes: vec![0],
            retires: vec![0],
            createur_revenu: true,
        })
    );
    n.m[0] = Some(f);
    for i in 0..3 {
        assert_eq!(n.s(i).membres(), vec![0, 1, 2]);
        assert_eq!(n.s(i).empreinte(0).unwrap(), code);
    }
    // Retirer un membre présent : réservé au créateur, accepté de tous.
    let c = n.s(0).retirer(&cles(1), 2).unwrap();
    let r = n.remettre(0, &c, &[0, 1]);
    assert!(
        matches!(
            r[0].1,
            Ok(Evenement::CommitAccepte {
                createur_revenu: false,
                ..
            })
        ),
        "{r:?}"
    );
    assert_eq!(
        r[1].1,
        Ok(Evenement::Membres {
            ajoutes: vec![],
            retires: vec![2],
            createur_revenu: false,
        })
    );
    // Rotation de l'invitation : envoyée et acceptée.
    for i in [0, 1] {
        n.s(i).marquer_exclu(None, 1);
    }
    let t = n.s(0).envoyer(&cles(1), &rotation(1, 1, 3)).unwrap();
    let r = n.remettre(0, &t, &[0, 1]);
    assert_eq!(r[0].1, Ok(Evenement::RotationAcceptee { n: 1 }));
    assert!(lit_la_rotation(&r[1].1, 3));
}

/// Deux appareils du créateur (ou lien de gestion volé) : la preuve la plus récente gagne. La
/// première feuille créatrice (appareil 1, client qui n'applique pas la reprise : le serveur l'a
/// délogé) ne peut plus rien dès la reprise annoncée (0x0A) : ni retirer un membre présent, ni
/// envoyer de rotation ; le Commit qui ajoute la nouvelle feuille retire l'ancienne et porte
/// `createur_revenu` chez tous ; ensuite l'ancienne feuille n'écrit plus du tout.
#[test]
fn role_la_preuve_la_plus_recente_gagne() {
    let mut n = trio();
    let mut ancien = n.m[0].take().unwrap();
    let nn = nonce(0, 1);
    for i in [1, 2] {
        n.s(i).annoncer(0, nn);
    }
    // L'appareil 1 tente de retirer A (présent) et d'envoyer une rotation : refusés de tous.
    let c = ancien.retirer(&cles(1), 1).unwrap();
    for (i, x) in n.remettre(0, &c, &[1, 2]) {
        assert_eq!(x, Err(Error::CommitRefuse), "{i}");
    }
    ancien.abandonner_commit().unwrap();
    ancien.marquer_exclu(None, 1);
    for i in [1, 2] {
        n.s(i).marquer_exclu(None, 1);
    }
    let t = ancien.envoyer(&cles(1), &rotation(1, 1, 3)).unwrap();
    for (i, x) in n.remettre(0, &t, &[1, 2]) {
        assert_eq!(x, Err(Error::NonMembre), "{i}");
    }
    // L'appareil 2 reprend la main.
    let (r, f) = n.retour_createur(nn, identite_createur(0, nn, &S_GESTION).unwrap(), &[1, 2]);
    assert!(
        matches!(
            r[0].1,
            Ok(Evenement::CommitAccepte {
                createur_revenu: true,
                ..
            })
        ),
        "{r:?}"
    );
    assert_eq!(
        r[1].1,
        Ok(Evenement::Membres {
            ajoutes: vec![0],
            retires: vec![0],
            createur_revenu: true,
        })
    );
    n.m[0] = Some(f);
    for i in 0..3 {
        assert_eq!(n.s(i).membres(), vec![0, 1, 2]);
    }
    // L'ancienne feuille, retirée, n'écrit plus (époque passée, plus dans l'arbre).
    let t = ancien.envoyer(&cles(1), &texte(2, SECRET)).unwrap();
    for (i, x) in n.remettre(0, &t, &[1, 2]) {
        assert!(x.is_err(), "{i} : {x:?}");
    }
    // La nouvelle a le rôle : rotation acceptée.
    n.s(0).marquer_exclu(None, 1);
    let t = n.s(0).envoyer(&cles(1), &rotation(3, 1, 3)).unwrap();
    let r = n.remettre(0, &t, &[0, 1, 2]);
    assert_eq!(r[0].1, Ok(Evenement::RotationAcceptee { n: 1 }));
    assert!(lit_la_rotation(&r[1].1, 3));
}

/// Preuve rejouée sur une autre feuille, clé de rôle hors du siège du créateur (lien de gestion
/// volé utilisé depuis une place d'invité) : refusées. Aucun second créateur silencieux.
#[test]
fn role_preuve_rejouee_ou_hors_siege_refusee() {
    let mut n = trio();
    // 1. Le KeyPackage du créateur (clé de rôle) rejoué au nom du siège 2 : ignoré.
    let nn = nonce(0, 1);
    for i in 0..3 {
        n.s(i).annoncer(0, nn);
    }
    let mut f = Salon::creer(
        identite_createur(0, nn, &S_GESTION).unwrap(),
        &cles(1),
        false,
    )
    .unwrap();
    let kp = f.key_package(&cles(1)).unwrap();
    for (i, x) in n.remettre(2, &kp, &[0, 1]) {
        assert_eq!(x, Ok(Evenement::Ignore), "{i}");
    }
    // 2. Le voleur entre comme invité (siège 3) avec la clé de rôle : son KeyPackage n'est
    // signalé par personne et son ajout est refusé.
    let n3 = nonce(3, 0);
    let mut v = Salon::creer(
        identite_createur(3, n3, &S_GESTION).unwrap(),
        &cles(1),
        false,
    )
    .unwrap();
    for i in 0..3 {
        n.s(i).annoncer(3, n3);
    }
    let kp = v.key_package(&cles(1)).unwrap();
    for (i, x) in n.remettre(3, &kp, &[0, 1, 2]) {
        assert_eq!(x, Ok(Evenement::Ignore), "{i}");
    }
    let kp_mls = ouvrir(&cles(1), &kp).unwrap().1.to_vec();
    assert_eq!(
        n.s(1).ajouter(&cles(1), &kp_mls).unwrap_err(),
        Error::CommitRefuse
    );
    // 3. Un membre ordinaire ne prend jamais le rôle : ni retrait d'un présent, ni rotation.
    assert_eq!(
        n.s(1).retirer(&cles(1), 2).unwrap_err(),
        Error::CommitRefuse
    );
    n.s(1).marquer_exclu(None, 1);
    assert_eq!(
        n.s(1).envoyer(&cles(1), &rotation(1, 1, 3)).unwrap_err(),
        Error::RetraitEnAttente // l'ancienne feuille du siège 0 (reprise annoncée) d'abord
    );
}

/// Signature d'une autre clé au siège du créateur (autre `S_gestion`, ou identité tirée au
/// hasard : créateur revenu sans son lien de gestion, fantôme d'un serveur complice) : entrée
/// comme membre ordinaire, sans le rôle et sans `createur_revenu`.
#[test]
fn role_autre_cle_au_siege_du_createur_sans_droits() {
    for identite in [
        identite_createur(0, nonce(0, 1), &[0x77; 32]).unwrap(),
        nouvelle_identite(0, nonce(0, 1)).unwrap(),
    ] {
        let mut n = trio();
        let _perdu = n.m[0].take();
        let (r, f) = n.retour_createur(nonce(0, 1), identite, &[1, 2]);
        assert_eq!(
            r[1].1,
            Ok(Evenement::Membres {
                ajoutes: vec![0],
                retires: vec![0],
                createur_revenu: false,
            })
        );
        n.m[0] = Some(f);
        assert_ne!(
            n.s(1).empreinte(0).unwrap(),
            code_verification(&cle_publique_role(&S_GESTION))
        );
        assert_eq!(
            n.s(0).retirer(&cles(1), 2).unwrap_err(),
            Error::CommitRefuse
        );
        n.s(0).marquer_exclu(None, 1);
        assert_eq!(
            n.s(0).envoyer(&cles(1), &rotation(1, 1, 3)).unwrap_err(),
            Error::RotationRefusee
        );
    }
}

/// « Quitter » puis retour avec `S_gestion` (0x03, retrait de sa feuille par un membre, puis
/// nouvelle arrivée 0x02 au siège 0) : rôle rendu ; exclusion complète (0x09, retrait de l'exclu,
/// rotation, refondation, nouvelle entrée de A) faite par le créateur revenu ; codes inchangés.
#[test]
fn role_apres_quitter_puis_retour_exclusion_et_rotation() {
    let mut n = trio();
    let code = n.s(1).empreinte(0).unwrap();
    let _parti = n.m[0].take();
    for i in [1, 2] {
        n.s(i).marquer_parti(0);
    }
    let c = n.s(1).retirer(&cles(1), 0).unwrap();
    let r = n.remettre(1, &c, &[1, 2]);
    assert!(
        matches!(r[0].1, Ok(Evenement::CommitAccepte { .. })),
        "{r:?}"
    );
    assert_eq!(n.s(2).membres(), vec![1, 2]);
    let nn = nonce(0, 2);
    let (r, f) = n.retour_createur(nn, identite_createur(0, nn, &S_GESTION).unwrap(), &[1, 2]);
    assert_eq!(
        r[1].1,
        Ok(Evenement::Membres {
            ajoutes: vec![0],
            retires: vec![],
            createur_revenu: true,
        })
    );
    n.m[0] = Some(f);
    assert_eq!(n.s(1).empreinte(0).unwrap(), code);
    // Exclusion complète de X par le créateur revenu.
    n.exclure_x(1);
    n.retirer_x();
    let t = n.s(0).envoyer(&cles(1), &rotation(4, 1, 3)).unwrap();
    let r = n.remettre(0, &t, &[1, 0]);
    assert!(lit_la_rotation(&r[0].1, 3));
    assert_eq!(r[1].1, Ok(Evenement::RotationAcceptee { n: 1 }));
    n.refonder(0, 3);
    n.refonder(1, 3);
    let kp = n.s(1).key_package(&cles(3)).unwrap();
    let r = n.remettre(1, &kp, &[0, 1]);
    let Ok(Evenement::KeyPackage { octets }) = &r[0].1 else {
        panic!("{:?}", r[0].1)
    };
    let c = n.s(0).ajouter(&cles(3), octets).unwrap();
    let r = n.remettre(0, &c, &[0, 1]);
    let Ok(Evenement::CommitAccepte {
        welcome: Some(w), ..
    }) = &r[0].1
    else {
        panic!("{:?}", r[0].1)
    };
    let r = n.remettre(0, w, &[1]);
    assert!(matches!(r[0].1, Ok(Evenement::Entree { .. })), "{r:?}");
    for i in [0, 1] {
        assert_eq!(n.s(i).membres(), vec![0, 1]);
        assert_eq!(n.s(i).empreinte(0).unwrap(), code);
    }
}

/// Renouvellement du salon (groupe recréé, nouvelles identités) : le rôle suit la clé de rôle.
/// Deux groupes fondés avec le même `S_gestion` donnent au créateur le même code ; les invités
/// changent de code.
#[test]
fn role_suit_la_cle_au_renouvellement() {
    let mut a = trio();
    let mut b = trio();
    assert_eq!(a.s(1).empreinte(0).unwrap(), b.s(1).empreinte(0).unwrap());
    assert_ne!(a.s(0).empreinte(1).unwrap(), b.s(0).empreinte(1).unwrap());
    // Dans le groupe recréé, le créateur garde ses droits.
    let c = b.s(0).retirer(&cles(1), 2).unwrap();
    let r = b.remettre(0, &c, &[0, 1]);
    assert!(
        matches!(r[0].1, Ok(Evenement::CommitAccepte { .. })),
        "{r:?}"
    );
    let _ = a.s(0);
}
