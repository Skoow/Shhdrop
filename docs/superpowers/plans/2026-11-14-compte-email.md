# Compte par e-mail et mot de passe (D42-26) — plan d'implémentation, version 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Version 2 du 14 novembre 2026** (décisions du propriétaire du même jour, conception §21). Elle **remplace** la version 1 (code de secours, e-mails « déjà inscrit » et « adresse changée », un seul coffre) ; la version 1 reste lisible dans l'historique git (commit `e620ae6`). **À ne pas commencer avant la validation de la conception** (décisions R-D1 à R-D5 de §21.19, et D1, D4, D7, D8 de §20). Les valeurs ci-dessous sont les recommandations ; une décision contraire change les lots cités.

**Goal :** un compte gratuit (e-mail confirmé, mot de passe, double authentification facultative, pseudo unique, photo) obligatoire pour créer un salon ; récupération par e-mail sans perte du profil ; accueil connecté, profil, paramètres, historique des téléchargements, signalements par catégorie, suppression totale, sauvegarde chiffrée et tableau de bord finalisé ; sans que le serveur reçoive le mot de passe, garde l'adresse en clair, ni puisse ouvrir les secrets du coffre privé.

**Architecture :** moteur Rust : normalisation de l'adresse et du pseudo, sel, Argon2id, dérivations, formats des deux coffres (vecteurs communs, rejoués en wasm et en Go). Serveur Go : `internal/compte` (base `comptes.db`, empreintes, séquestre du profil, codes, sessions, TOTP, ancienneté, bannissement), `internal/courriel` (seul client sortant, un seul modèle d'e-mail), extensions de `internal/salon`, `internal/api`, `internal/adminui`. Site : `web/src/account/` (seul détenteur du jeton, de `K_compte` et de `s_profil`), `web/src/history/` étendu (quatre sortes d'entrées), `web/src/downloads/` (nouveau), pages sous `/compte`, accueil connecté, `/telechargements`. Déploiement : sortie SMTP seule, sauvegarde `age` depuis la machine. Tout est désactivé par défaut (`SHH_COMPTES=0` ; constante de construction `__COMPTES__` à `false` pour le site).

**Tech Stack :** Go (go 1.26.0, toolchain go1.27.4), `modernc.org/sqlite` v1.62.0, `crypto/hkdf`, `crypto/hmac`, `crypto/aes`, `net/smtp`, `crypto/tls`, `github.com/pquerna/otp` (version exacte épinglée au lot 5) ; Rust 1.99.1, crates présentes (`argon2` 0.6, `hkdf` 0.13, `sha2` 0.11 ; NFKC par la crate déjà utilisée par `kdf.rs`, sinon revue de chaîne d'approvisionnement avant d'en ajouter une) ; Svelte 5, vitest 5.1.0, WebCrypto ; `age` (outil, version exacte, sur la machine seulement).

**Spec :** `docs/superpowers/specs/2026-11-14-compte-email-design.md` (entière, §21 en premier) ; spécification principale D42-26, §29.2, §33, §36, §37.2 (format « SHH-ACCT1 »), §39.4, §39.5 ; salon v3 §14.6, §15.2 ; tableau de bord `2026-11-13-tableau-de-bord-admin-design.md` ; UI `2026-11-04-shhdrop-ui-design.md` §6, §8, §9.6, §9.8.x, §9.10, §11.

## Global Constraints

- CLAUDE.md : le serveur ne reçoit ni ne garde de mot de passe, de contenu, de nom de fichier ; aucune adresse e-mail en clair sur disque ni dans un journal ; aucune adresse IP sur disque ; aucune crypto maison ; aucune ressource tierce sur le site ; tests avant tout « fait » ; jamais « 100 % sécurisé ». **Exception écrite, seulement si R-D1 est validée** : `s_profil` (clé du coffre de profil) est reçu et gardé chiffré par le serveur ; aucune autre clé.
- Commits : `git commit --author="Skoow <190851638+Skoow@users.noreply.github.com>"`, sur `main`, message terminé par les lignes d'attribution de la session ; push après `make test` vert ; le contrôleur vérifie la CI après chaque push.
- **Chaque lot est livrable seul** : il laisse `main` vert, ne change rien pour le public tant que `SHH_COMPTES=0` et `__COMPTES__ = false`, et se pousse sans attendre le suivant.
- Désactivé par défaut : `SHH_COMPTES=0` → aucune route `/api/compte/*` (404 identique à une route inconnue), création de salon inchangée, signalement sans catégorie accepté et compté « Autre » (code 10), pour le site actuel et les clients d'avant. `SHH_COMPTES=1` exige `SHH_SALONS=1`, `SHH_COMPTES_CLE_FILE`, `SHH_SMTP_HOST`, `SHH_SMTP_USER`, `SHH_SMTP_PASSWORD_FILE`, `SHH_MAIL_FROM`.
- Valeurs fixes (conception §6, §8, §21) :
  - Argon2id 64 Mio, 3 passes, 1 fil, 32 octets ; sel = SHA-256(« shhdrop/v2/compte/sel » ‖ 0x00 ‖ canon)[0..16] ; HKDF-SHA-256 sel vide, étiquettes : `shhdrop/v2/compte/auth`, `shhdrop/v2/compte/enveloppe-mdp`, `shhdrop/v2/compte/blob` (coffre privé), `shhdrop/v2/compte/profil`, `shhdrop/v2/compte/appareil` ; serveur : `shhdrop/v2/serveur/compte/email`, `…/mdp`, `…/totp`, `…/sequestre`, `…/pseudo` ;
  - enveloppe du mot de passe 60 octets, AD = « SHH-CENV1 » ‖ `h` ‖ « mdp » ; séquestre `cle_profil` 60 octets, AD = « SHH-CSEQ1 » ‖ `h` ; TOTP chiffré 48 octets, AD = « SHH-TOTP1 » ‖ `h` ; coffre privé « SHH-ACCT1 », coffre de profil « SHH-PROF1 » (même forme), paliers 4, 16, 64, 256 Kio ;
  - `p_empreinte` = HMAC-SHA-256(`K_pseudo`, « pseudo » ‖ 0x00 ‖ `p_canon`) ; pseudos réservés : liste de la conception §21.5 ; changement de pseudo une fois par 24 h ; `pseudo/verifier` 30 par heure ;
  - mot de passe 10 à 256 caractères ; pseudo 2 à 24 graphèmes (§39.4 point 4) ; photo 256 × 256, ≤ 64 Ko ;
  - codes e-mail 6 chiffres, 15 min, 5 essais ; TOTP SHA-1, 6 chiffres, 30 s, ±1 pas, 5 essais par étape, 10 échecs par heure par compte ; **attentes : retrait de la double authentification 7 jours ; après une récupération par e-mail, 7 jours sans changement d'adresse ni suppression** ;
  - limites (inchangées, version 1) : inscriptions 3/jour/connexion, 10/jour//48 ; e-mails 3/jour/adresse, 10/jour/connexion, renvoi après 60 s ; connexion 20 échecs/h/connexion, 60//48, preuve ALTCHA après 5 échecs/h/compte ; coffres 60 écritures/h/compte (les deux ensemble) ; 20 sessions par compte ; file d'e-mails 256 ; `SHH_COMPTES_MAX` 10 000 ;
  - sessions : simple 2 h sans usage et au plus jusqu'à la fin du jour UTC suivant ; « rester connecté » 30 jours sans usage, 90 jours au plus ; « récente » < 5 min ;
  - paliers : neuf (< 7 jours depuis `compte_des`) 1 salon, `max_members` ≤ 4, 24 h ; confirmé 3 salons, ≤ 10, 24 h ;
  - bannissement : 30 jours, 1 an ou 3 ans (défaut) ; échéance modifiable jusqu'à aujourd'hui + 5 ans ; 20 bannissements par heure au plus ; comptes effacés après 13 mois sans connexion ;
  - catégories de signalement : codes 1 à 10 de la conception §21.10.1 ;
  - historique local : entrées terminées retirées 7 jours après ; historique des téléchargements : 30 jours ; écriture du coffre privé différée de 2 à 12 min après un événement de partage ou de salon ;
  - sauvegarde : quotidienne, 30 copies, `age` X25519 ;
  - dates de `comptes.db` : jour (multiple de 86 400) ou mois (premier du mois), jamais d'heure.
- E-mail : **un seul modèle** (conception §21.3), octet pour octet.
- Textes : messages exacts de la conception §12 et §21.15 ; clés `account.*`, `home.inbox.*`, `downloads.*`, `report.*` en `fr.ts` et `en.ts`.
- Vérifications à chaque lot Go : `cd server && go test -race ./...` puis `make test-go` **et** `make test-e2e` ; lot moteur : `make test-engine` ; lot site : `make test-web` (+ `make test-ui` et captures pour un écran) ; lot déploiement : `make lint-deploy` et le test du lot.

## Review Focus

1. **Le séquestre n'ouvre que le profil** : aucune route, aucun chemin du code ne rend de quoi ouvrir `B_prive` sans le mot de passe (lot 4, `TestSequestreSeulementProfil` ; lot 16).
2. **E-mails sans fuite** : pour une adresse libre, prise, bannie, une récupération et un changement d'adresse, le faux SMTP reçoit exactement le même modèle, seul le code change (lot 3, `TestEmailModeleUnique` ; lot 4, `TestInscriptionEtatSeulementApresCode` ; lot 16).
3. **Boîte mail volée** : après une récupération par e-mail, adresse et suppression refusées 7 jours ; double authentification active : récupération impossible sans code d'application, sauf après l'attente de 7 jours qu'une connexion annule (lot 5).
4. **Suppression totale** : salons créés fermés pour tous, partages connus détruits, aucun octet des coffres ni du séquestre dans les fichiers après arrêt ; l'écran ne promet rien pour les messages dans les salons d'autrui (lots 5, 13, 16).
5. **Tableau de bord** : jamais une adresse, une empreinte, un `h`, un pseudo ; un salon signalé se désigne par une `ref` éphémère (lot 7, `TestPageSansIdentite`).
6. **Variante d'adresse** (`Lea.Dupont+x@GMAIL.com`) : connexion réussie ; récupération seulement à l'adresse exacte (lots 4, 5).

---

## Lot 1 — Moteur Rust : compte v2 et vecteurs

*Livrable seul : fonctions du moteur et vecteurs, utilisées par personne encore. Dépend de : rien.*

**Files :**
- Create : `engine/core/src/compte.rs`, `engine/core/tests/compte.rs`, `engine/vectors/compte.json`, `web/scripts/gen-compte-vectors.mjs` (cas d'enveloppes et de coffres produits par WebCrypto, nonces fixés), `web/src/engine/compte.test.ts`
- Modify : `engine/core/src/lib.rs`, `engine/core/src/error.rs`, `engine/wasm/src/lib.rs`, `engine/vectors/README.md`, `web/src/engine/index.ts`, `web/src/engine/argon2.worker.ts`

**Interfaces :**
- Rust (`shhdrop_core::compte`) : `Adresse { canon, exacte }` ; `normaliser(email) -> Result<Adresse, Erreur>` (`adresse_invalide`, `adresse_non_ascii`) ; `sel(canon) -> [u8;16]` ; `deriver(mdp, canon) -> (A_auth, KEK_mdp)` (zéroïsés) ; `cle_prive(k_compte)`, `cle_profil(s_profil)`, `cle_appareil(k_compte)` ; `pseudo_valide(s) -> Result<String, Erreur>` (affichage normalisé, erreurs de §39.4) ; `pseudo_canon(s) -> String` ; `pseudo_reserve(canon) -> bool` ; `mot_de_passe_valide(mdp, &Adresse)`.
- wasm (`web/src/engine/index.ts`) : `normaliserAdresse`, `deriverCompte` (Worker existant), `clePrive`, `cleProfil`, `cleAppareil`, `pseudoValide`, `pseudoCanon`, `pseudoReserve`, `motDePasseValide`.
- `compte.json` : sections `normaliser` (≥ 40 cas, liste de la version 1), `sel`, `deriver`, `pseudo` (≥ 30 cas : casse, espaces, ponctuation, NFKC, écritures mêlées, émoji, 1 et 25 graphèmes, réservés), `enveloppes` (mot de passe), `coffre_prive`, `coffre_profil` (clé, nonce, AD, résultat).

- [ ] **Step 1 : tests** — `engine/core/tests/compte.rs` : `vecteurs_normaliser`, `vecteurs_sel`, `vecteurs_deriver`, `vecteurs_pseudo` (octet pour octet) ; `canon_ne_depend_pas_de_la_variante` ; `pseudo_canon_identique_pour_variantes` (« Léa », « LÉA », « lé a ») ; `cles_de_coffre_distinctes` (`cle_prive(k)` ≠ `cle_profil(k)` pour la même entrée). `compte.test.ts` : mêmes vecteurs en wasm sous Node ; `enveloppes`, `coffre_prive`, `coffre_profil` déchiffrés par WebCrypto.
- [ ] **Step 2 :** `make test-engine` → FAIL.
- [ ] **Step 3 :** implémenter (aucune dépendance nouvelle sans revue).
- [ ] **Step 4 :** `make test-engine` ; `cd web && npx vitest run src/engine/compte.test.ts` → PASS ; `node scripts/check-dist.mjs` : poids du `.wasm` des partages noté.
- [ ] **Step 5 :** commit `feat(moteur): compte v2, adresse, pseudo, dérivations, coffres (vecteurs communs)`.

## Lot 2 — Serveur : configuration, clés, `comptes.db`, schéma 3 du salon, domaines jetables

*Livrable seul : rien n'est servi (`SHH_COMPTES=0`). Dépend de : lot 1 (vecteurs).*

**Files :**
- Modify : `server/internal/config/config.go`, `server/internal/store/store.go`, `server/cmd/shhdrop/main.go`, `THIRD_PARTY_LICENSES.md`
- Create : `server/internal/compte/{cles.go,base.go,adresse.go,pseudo.go,jetables.go,jetables.txt,jetables-ajouts.txt,reserves.txt}`, `web/scripts/maj-jetables.mjs`
- Test : `server/internal/config/config_test.go`, `server/internal/store/store_test.go`, `server/internal/compte/{cles,base,adresse,pseudo}_test.go`

**Interfaces :**
- `config.Config` : `Comptes`, `ComptesCleFile`, `ComptesMax`, `SMTP{Host,Port,User,PasswordFile,From}` (refus de la version 1, Task 2).
- `compte.Cles{ Email, Poivre, TOTP, Sequestre, Pseudo [32]byte }` ; `LireCles(chemin)`.
- `OuvrirBase(chemin)` : tables exactes de la conception §21.6.1 (`comptes`, `sessions`, `bannis`), toutes `WITHOUT ROWID`, `user_version = 1`.
- `Normaliser(email) (Adresse, error)` ; `(Cles) Empreintes(a) (canon, envoi [32]byte)` ; `(Cles) EmpreintePseudo(pCanon []byte) ([32]byte, error)` (refus : vide, > 96 octets, UTF-8 invalide, réservé) ; `Jetable(domaine) bool`.
- `store.SchemaVersion = 3` : colonne `salons.compte` BLOB(16) NULL, index `salons_compte`, migration 2 → 3.

- [ ] **Step 1 : tests** — ceux de la version 1 (Tasks 2 et 3 : `TestComptesDefautDesactive`, `TestComptesConfigRefusee`, `TestLireClesDerivations` étendu à cinq sous-clés deux à deux différentes, `TestMigreV2VersV3`, `TestNormaliserVecteurs`, `TestEnveloppesVecteurs`, `TestJetable`, `TestDatesAuJour`) ; `TestSchemaComptes` (schéma exact de §21.6.1 ; aucune colonne texte ; aucune colonne `v_s`, `env_s`) ; `TestPseudoReserve` (liste) ; `TestPseudoVecteurs` (les `p_canon` de `compte.json` acceptés ; empreintes stables).
- [ ] **Step 2 :** `go test -race ./internal/config/ ./internal/store/ ./internal/compte/` → FAIL.
- [ ] **Step 3 :** implémenter ; listes lues une fois au démarrage (ligne `allowedMaps` « constante, aucun compteur »).
- [ ] **Step 4 :** `go test -race ./...`, `make test-go`, `make test-e2e` → PASS.
- [ ] **Step 5 :** commit `feat(compte): configuration, clés du serveur, comptes.db, schéma 3 du salon, domaines jetables`.

## Lot 3 — Serveur : envoi d'e-mails (modèle unique) et limites

*Livrable seul : paquet non branché. Dépend de : lot 2.*

**Files :**
- Create : `server/internal/courriel/{courriel.go,smtp.go,modele.go,fauxsmtp_test.go,courriel_test.go}`
- Modify : `server/internal/limits/limits.go`, `server/internal/stats_test.go` (exemption de `internal/courriel/smtp.go` ; `smtp.*` et `tls.Dial*` interdits ailleurs ; lignes `allowedMaps`), `deploy/Dockerfile` (certificats racine)
- Test : `server/internal/limits/limits_test.go`

**Interfaces :**
- `type Message struct{ A string; Langue string; Code string }` (**aucun champ de modèle** : un seul modèle) ; `Nouveau(c config.SMTP, mdp []byte) *Envoyeur` ; `Mettre(m) error` (`ErrPlein`) ; `Run(ctx)` (un envoi à la fois, 20 s, un nouvel essai, aucune sortie).
- Limites : `AllowInscription`, `AllowCourriel`, `AllowEchecConnexion`/`NoterEchecConnexion`, `PreuveRequise`, `AllowTOTP`, `AllowEcritureCoffre`, `AllowPseudoVerifier(h|etape)`, `AllowBannir()` (20/h, global).

- [ ] **Step 1 : tests** — `TestEnvoiCode` (corps et objet exacts de §21.3, en `fr` et `en`) ; `TestEmailModeleUnique` (le corps ne dépend que du code et de la langue ; recherche dans les sources : aucun autre texte d'e-mail) ; `TestAucunEnTeteDeTrop` (liste exacte de §21.3) ; `TestTexteClairRefuseHorsBoucle` ; `TestFilePleine` ; `TestEchecSilencieux` ; limites : une fonction par limite, bornes exactes, `TestLimitesCompteOublieesALaRotation`, `TestAucuneAdresseGardee`.
- [ ] **Step 2 :** `go test -race ./internal/courriel/ ./internal/limits/ ./internal/` → FAIL.
- [ ] **Step 3 :** implémenter (`net/smtp` sur `crypto/tls`, TLS 1.2 au moins, `ServerName`).
- [ ] **Step 4 :** `go test -race ./...`, `make test-go`, `make test-repro` → PASS.
- [ ] **Step 5 :** commit `feat(courriel): envoi SMTP d'un code seul, file en mémoire ; limites du compte`.

## Lot 4 — Serveur : inscription, connexion, sessions, pseudo, deux coffres

*Livrable seul : routes servies seulement avec `SHH_COMPTES=1` (tests). Dépend de : lots 2, 3.*

**Files :**
- Create : `server/internal/compte/{service.go,etapes.go,sessions.go,coffres.go,sequestre.go}`, `server/internal/api/handlers_compte.go`
- Modify : `server/internal/api/api.go`, `server/internal/api/minimize_test.go` (`X-Shh-Session` lu par `handlers_compte.go` seulement), `server/cmd/shhdrop/main.go`
- Test : `server/internal/compte/{service,coffres,sequestre}_test.go`, `server/internal/api/compte_test.go`

**Interfaces :**
- `NewService(Config{ DB, Cles, Courriel, Limites, Now, Max })`.
- `InscriptionDebut(ip, email, langue) (h, etape, err)` (envoie **toujours** un code, conception §21.3) ; `Renvoyer` ; `InscriptionFin(etape, code, d Donnees, s OptionsSession) (jeton, err)` avec `Donnees{ AAuth [32]byte; EnvMdp [60]byte; SProfil [32]byte; PCanon []byte; BlobProfil, BlobPrive []byte }` ; erreurs `ErrCodeFaux`, `ErrDejaInscrit`, `ErrBanni{Jusqu}`, `ErrPseudoPris`.
- `Connexion(...) (Ouverture, error)`, `Ouverture{ Jeton; H; EnvMdp; SProfil [32]byte; BlobProfil []byte; GenProfil uint64; BlobPrive []byte; GenPrive uint64; Etape *[32]byte }` ; `ConnexionTOTP` (rempli au lot 5).
- `Session`, `Reauth`, `Deconnexion`, `Sessions`, `FermerSession`, `FermerAutres` (version 1).
- `LireCoffre(c, Profil|Prive)`, `EcrireCoffre(c, sorte, ifGen, blob)` ; `PseudoVerifier(etape|c, pCanon) (libre bool, err)` ; `ChangerPseudo(c, pCanon)`.
- Séquestre : `cle_profil` scellé à `InscriptionFin`, ouvert seulement dans `Connexion`, `ConnexionTOTP`, `OubliFin` ; `s_profil` jamais journalisé, tampon effacé au mieux.

- [ ] **Step 1 : tests** — de la version 1 (Task 6) : `TestInscriptionComplete`, `TestCodeCinqEssais`, `TestCodeExpire15Min`, `TestInscriptionPerdueAuRedemarrage`, `TestJetableRefuse`, `TestCourseDeuxInscriptionsMemeAdresse`, `TestConnexionVarianteCanonique`, `TestConnexionInconnueEtFausseIdentiques`, `TestPreuveApresCinqEchecs`, `TestPasDeVerrouillage`, sessions (`TestSessionSimpleExpire`, `TestSessionPersistante30Et90Jours`, `TestSessionRecente5Min`, `TestJetonJamaisEnClair`, `TestVingtSessionsAuPlus`, `TestFermerAutres`, `TestDatesDeLaBase`) ; **nouveaux** : `TestInscriptionEtatSeulementApresCode` (adresse prise ou bannie : même réponse à `inscription/debut`, même e-mail ; `inscription/fin` avec le code juste → `deja_inscrit` ou `banni`, aucune ligne créée ; code faux → `code_faux` dans les trois cas) ; `TestPseudoUnique` (deux comptes, même `p_canon` → `pseudo_pris`) ; `TestPseudoReserveRefuse` ; `TestPseudoUneFoisPar24h` ; `TestPseudoJamaisEnClair` (la base ne contient que `p_empreinte`) ; `TestSequestreSeulementProfil` (`cle_profil` ouvre `B_profil` ; aucune réponse ne contient `K_compte` ni rien qui ouvre `B_prive`) ; `TestSequestreChiffre` (colonne ≠ `s_profil`, ouverte avec `K_sequestre` et AD) ; `TestDeuxCoffresIndependants` (`if_gen` séparés ; 60 écritures par heure pour les deux) ; `compte_test.go` : `TestRoutesCompteAbsentes`, `TestJSONStrictCompte`, `TestEnTeteSessionSeulementIci`.
- [ ] **Step 2 :** `go test -race ./internal/compte/ ./internal/api/` → FAIL.
- [ ] **Step 3 :** implémenter (comparaisons en temps constant ; `vu_mois` une fois par mois).
- [ ] **Step 4 :** `go test -race ./...`, `make test-go`, `make test-e2e` → PASS.
- [ ] **Step 5 :** commit `feat(compte): inscription par code e-mail, connexion, sessions, pseudo unique, coffres et séquestre du profil`.

## Lot 5 — Serveur : récupération par e-mail, double authentification, paramètres, suppression

*Livrable seul. Dépend de : lot 4.*

**Files :**
- Create : `server/internal/compte/{totp.go,oubli.go,parametres.go,effacement.go}`
- Modify : `server/go.mod`, `server/go.sum`, `THIRD_PARTY_LICENSES.md`, `server/internal/api/handlers_compte.go`, `server/internal/janitor/janitor.go` (passe quotidienne `compte.Effacer(now)`)
- Test : `server/internal/compte/{totp,oubli,parametres,effacement}_test.go`

**Interfaces :**
- `TOTPDebut`, `TOTPFin`, `TOTPRetirer`, `TOTPAnnulerRetrait(c)` ;
- `OubliDebut(ip, email, langue)` ; `OubliVerifier(etape, code, totp string, totpPerdu bool) (h [16]byte, attenteJusqu string, err)` ; `OubliFin(etape, d DonneesOubli, s) (Ouverture, error)` (`DonneesOubli{ AAuth; EnvMdp; BlobPrive }` : `blob_profil` et `cle_profil` gardés, `blob_prive` remplacé, `gen` des deux continue, `recup_jour` posé, sessions fermées) ;
- `Etat(c)` (champs de §21.6.2 : `recup_jusqu`, `retrait_totp_le`, `banni_jusqu`, `banni_motif`) ; `ChangerMdp` ; `EmailDebut(c, ip, actuel, nouveau, langue)` ; `EmailFin(c, etape, code, aAuth, envMdp, totp)` ; `Export(c)` ; `Supprimer(c) (salonsFermes int, err)` (crochet `FermerSalons`, branché au lot 6) ; `Effacer(now)` (inactifs 13 mois ; bannis échus) ; erreur `ErrAttente{Jusqu}` (403 `attente`).

- [ ] **Step 1 : revue de chaîne d'approvisionnement** de `github.com/pquerna/otp` et `github.com/boombuler/barcode` (compétence `supply-chain-risk-auditor`), comme la version 1 (Task 7, Step 1).
- [ ] **Step 2 : tests** — TOTP de la version 1 (`TestTOTPVecteursRFC6238`, `TestTOTPTolerance`, `TestTOTPRejeu`, `TestTOTPSecretChiffre`, `TestTOTPActivationExigeCode`, `TestConnexionAvecTOTP`) ; **récupération** : `TestOubliAdresseExacteSeulement` ; `TestOubliExigeTOTP` ; `TestRecuperationGardeProfil` (`blob_profil`, `cle_profil`, `p_empreinte`, `cree_jour`, `compte_des`, `salons.compte` inchangés) ; `TestRecuperationVideCoffrePrive` (`blob_prive` remplacé ; l'ancien n'est plus lisible) ; `TestRecuperationFermeLesSessions` ; `TestAttente7Jours` (`email/fin` et `supprimer` → `attente` jusqu'au jour + 7 ; passent au jour + 7) ; `TestRetraitTOTPApres7Jours` ; `TestRetraitTOTPAnnuleParConnexion` ; `TestRetraitTOTPAnnuleParSession` ; **paramètres** : `TestChangerMdpFermeAutres`, `TestChangerMdpExigeRecent`, `TestEmailAncienneAdresseExigee`, `TestEmailNouvelleJetableRefusee`, `TestEmailChangeEmpreintes`, `TestEmailAucunAvisAncienne` (faux SMTP : un seul e-mail, vers la nouvelle), `TestEmailNouvelleDejaPrise`, `TestExportSansAdresse` ; **suppression** : `TestSuppressionEfface` (lignes, coffres, séquestre, empreinte du pseudo ; `wal_checkpoint(TRUNCATE)` ; octets absents du fichier et du WAL après fermeture ; ligne `bannis` gardée ; pseudo libre aussitôt) ; `TestInactifs13Mois` ; `TestBannisEchus`.
- [ ] **Step 3 :** `go test -race ./internal/compte/` → FAIL.
- [ ] **Step 4 :** implémenter ; version exacte dans `go.mod` ; `govulncheck ./...` vert.
- [ ] **Step 5 :** `go test -race ./...`, `make test-go`, `make test-e2e` → PASS ; commit `feat(compte): récupération par e-mail sans perte du profil, double authentification avec attente, paramètres, suppression`.

## Lot 6 — Serveur : salon ↔ compte, salons du compte, signalements par catégorie

*Livrable seul : avec `SHH_COMPTES=0`, seule la catégorie de signalement change (facultative, absente = « Autre »). Dépend de : lot 5.*

**Files :**
- Modify : `server/internal/salon/{manager.go,reglages.go,fin.go,relais.go}`, `server/internal/api/{handlers_salon.go,handlers_manage.go}` (ou le fichier qui sert `destroy`), `server/internal/api/minimize_test.go`, `server/internal/compte/service.go`, `server/internal/usage/usage.go` (compteurs par catégorie)
- Create : `server/internal/compte/salons.go` (`ref` éphémères)
- Test : `server/internal/salon/compte_test.go`, `server/internal/api/{salon_compte_test.go,signaler_test.go}`

**Interfaces :**
- de la version 1 (Task 9) : `CreerReq.Compte`, `SalonsDuCompte`, `CompteDuSalon`, `FermerDuCompte`, `Palier`, `Signale`, réponses `409 palier`, `401 compte_requis`, `403 banni`.
- `SalonsVivantsDuCompte(h) ([]SalonVue, error)` (`expire_vers` au quart d'heure, `places`, `sieges`) ; `compte.Service.SalonsListe(c) ([]SalonRef, error)` (`ref` 16 octets, 10 min, en mémoire) ; `DetruireParRef(c, ref)`.
- Signalement : `POST /api/salons/signaler` `{ "categorie": n }` (1 à 10 ; `{}` compté comme 10, « Autre ») ; `destroy` d'un partage : `{ "reason": "report", "categorie": n }` (catégorie absente : 10) ; `salon.Manager.Signalements(salon)` en mémoire (par catégorie), effacé avec le salon ; `usage` : compteur par catégorie et par sorte.

- [ ] **Step 1 : tests** — de la version 1 (Task 9) : `TestCreationSansSessionRefusee`, `TestCreationSansComptesInchangee`, `TestPalierNeuf`, `TestPalierConfirme`, `TestReglagesSuiventLePalier`, `TestSignalementRemetAZero`, `TestSessionJamaisLueAilleurs`, `TestSuppressionFermeSalons`, `TestColonneCompteEffaceeAvecLeSalon` ; **nouveaux** : `TestSalonsDuCompteSansIdentifiant` (réponse : `ref` aléatoire, aucune valeur de la ligne `salons` ni de `access_v`/`manage_v`) ; `TestRefExpire10Min` ; `TestRefDUnAutreCompteRefusee` ; `TestCategorieBornes` (0, 11, texte, `null` → 400 ; absente → comptée 10 ; `categorie` sans `reason: "report"` → 400) ; `TestCategorieJamaisSurDisque` (`shares.db` après signalement : aucune colonne, aucune valeur) ; `TestSignalementsDuSalonOubliesALaFin` ; `TestCompteursParCategorie` (`usage` : un entier par catégorie et par sorte).
- [ ] **Step 2 :** `go test -race ./internal/salon/ ./internal/api/ ./internal/usage/` → FAIL.
- [ ] **Step 3 :** implémenter (compte lu dans la même transaction que le décompte des salons vivants).
- [ ] **Step 4 :** `go test -race ./...`, `make test-go`, `make test-e2e` → PASS.
- [ ] **Step 5 :** commit `feat(salon): création réservée aux comptes, paliers, salons du compte, signalements par catégorie`.

## Lot 7 — Serveur : bannissement révisé et tableau de bord finalisé

*Livrable seul : le tableau de bord reste désactivé par défaut (`SHH_ADMIN_LISTEN` vide). Dépend de : lot 6.*

**Files :**
- Create : `server/internal/compte/bannir.go`, `server/internal/compte/agregats.go`
- Modify : `server/internal/adminui/adminui.go` (routes de la conception §21.14.5), `server/internal/adminui/page/{index.html,admin.js,admin.css}` (onglets de §21.14.1), `server/cmd/shhdrop/{admin.go,admin_serve.go}` (`bannir -`, `bannis …`), `docs/superpowers/specs/2026-11-13-tableau-de-bord-admin-design.md` (ligne de renvoi datée vers §21.14)
- Test : `server/internal/compte/{bannir,agregats}_test.go`, `server/internal/adminui/adminui_test.go`, `server/cmd/shhdrop/admin_serve_test.go`

**Interfaces :**
- `Bannir(cible Cible, dureeJours int, motif uint8, now) (Ban, error)` où `Cible` = lien de salon, adresse (octets, tampon effacé) ou `ref` de salon signalé ; `ActionBan(id [8]byte, action, jusqu *Jour) (avant, apres BanVue, err)` (`suspendre`, `reactiver`, `echeance`, `lever`, `annuler`) ; `ChercherBan(email []byte) (*BanVue, CompteVue, error)` ; `ListeBans(filtre, page)` ; `Agregats(now) AgregatsComptes` (liste de §21.14.2) ; `SalonsSignales() []SalonSignaleVue` (§21.14.3).
- `BanVue{ ID string ("B-XXXX-XXXX"); Debut, Jusqu string; Actif bool; Motif uint8; SalonsFermes int }` ; `CompteVue{ Existe bool; Palier string; AncienneteJours int; Banni bool }` — **aucun** champ d'adresse, d'empreinte, de `h`, de pseudo.

- [ ] **Step 1 : tests** — `TestBannirFermeLesSalonsOuverts` (version 1) ; `TestBannirDepuisRefSignale` ; `TestBannirParAdresse` ; `TestDurees` (30, 365, 1 095 jours ; autre → 400) ; `TestSuspendreReactiver` (suspendu : réinscription et création permises ; échéance inchangée) ; `TestEcheanceBornes` (hier, aujourd'hui + 5 ans + 1 jour → 400) ; `TestLever` ; `TestAnnulerRendAnciennete` ; `TestVingtBannissementsParHeure` ; `TestMotifMontreALaConnexion` (`GET /api/compte` : `banni_jusqu`, `banni_motif`) ; `TestAgregatsQueDesEntiers` ; `TestSalonsSignalesSansHeureDeCreation` (seulement « < 6 h » ou « 6 à 24 h ») ; `TestPageSansIdentite` (toutes les réponses et la page : aucune adresse tapée, `e_canon`, `h`, `p_empreinte`, pseudo, IP, lien) ; `TestRefusUniforme` étendu ; `TestAdminBannirStdin` (lien et adresse).
- [ ] **Step 2 :** `go test -race ./internal/adminui/ ./internal/compte/ ./cmd/shhdrop/` → FAIL.
- [ ] **Step 3 :** implémenter ; captures de la page (clair, sombre, 390 px) jointes au rapport.
- [ ] **Step 4 :** `go test -race ./...`, `make test-go`, `make test-e2e` → PASS.
- [ ] **Step 5 :** commit `feat(admin): bannissements modifiables, signalements par catégorie, comptes et statistiques`.

## Lot 8 — Déploiement : sortie SMTP seule, secrets, sauvegarde chiffrée et restauration

*Livrable seul : `SHH_COMPTES` reste `"0"` dans `compose.yaml`. Dépend de : lot 3 (SMTP) ; la sauvegarde ne dépend que du schéma (lot 2).*

**Files :**
- Modify : `deploy/compose.yaml` (secrets `shh_comptes_cle`, `shh_smtp_mdp` hors de `/data` ; réseau `sortie`), `deploy/env.example`, `deploy/deploy.sh` (pare-feu : TCP 465 vers `SHH_SMTP_HOST` seulement), `deploy/README.md` (clé du serveur : création, droits, **copie hors ligne séparée** ; SPF, DKIM, DMARC ; sauvegarde et restauration), `Makefile` (`test-sortie`, `test-restauration`)
- Create : `deploy/test-sortie.sh`, `deploy/sauvegarder.sh` (minuteur systemd quotidien : `sqlite3 … ".backup"` vers le volume chiffré, `age -r <clé publique>`, envoi au stockage objet en écriture seule, clair effacé), `deploy/restaurer.sh`, `deploy/test-restauration.sh`, `deploy/systemd/shhdrop-sauvegarde.{service,timer}`

- [ ] **Step 1 : tests** — `test-sortie.sh` (version 1, Task 17) ; `test-restauration.sh` : base de test avec un compte, sauvegarde, vérification que le fichier commence par `age-encryption.org/v1` et ne contient ni `h` ni repère, effacement, restauration avec la clé privée de test, `PRAGMA integrity_check` = `ok`, connexion du compte de test réussie ; `sauvegarder.sh` refuse de tourner si la clé publique manque ou si le clair temporaire est hors du volume chiffré.
- [ ] **Step 2 :** `make test-sortie`, `make test-restauration`, `make test-proxy`, `make lint-deploy` → FAIL puis PASS.
- [ ] **Step 3 :** relecture : `SHH_COMPTES: "0"` ; `age` en version exacte ; stockage objet : compte en écriture seule, règle de cycle de vie 30 jours (décrite dans `deploy/README.md`, faite par l'exploitant) ; démo GitHub Pages sans compte.
- [ ] **Step 4 :** `make test` → PASS ; push.
- [ ] **Step 5 :** commit `chore(deploy): sortie SMTP seule, secrets du compte, sauvegarde chiffrée et restauration testée`.

## Lot 9 — Site : module de compte (`web/src/account/`) et drapeau de construction

*Livrable seul : aucun écran ne l'utilise ; `__COMPTES__ = false`. Dépend de : lots 1, 4, 5 (formats).*

**Files :**
- Create : `web/src/account/{api.ts,keys.ts,vaults.ts,session.svelte.ts,persist.ts,device.ts}` et tests voisins
- Modify : `web/vite.config.ts` (`define: { __COMPTES__: … }`, `false` par défaut et dans la démo), `web/src/env.d.ts`, `web/src/source-rules.test.ts` (`X-Shh-Session`, `s_profil` et `shhdrop-compte` seulement dans `web/src/account/` ; aucun `document.cookie`)

**Interfaces :**
- `inscrire`, `confirmer(etape, code, mdp, profil: Profil, persistante)` (tire `K_compte` et `s_profil`, construit les deux coffres, calcule `p_canon`), `seConnecter`, `validerTotp`, `oubli.{debut, verifier, fin}`, `pseudoLibre(p)`, `changerPseudo(p)`, `account: { etat: "absent" | "verrouille" | "ouvert"; profil?: Profil; prive?: CoffrePrive }`, `ecrireProfil(patch)`, `ecrirePrive(patch, { differe: boolean })` (délai aléatoire 2 à 12 min si `differe`), fusion sur 409, refus d'un `gen` plus petit ; `type Profil = { pseudo: string; photo: Uint8Array | null; langue: string; reglages: Reglages; pass: string | null }`.

- [ ] **Step 1 : tests** — `keys.test.ts` (vecteurs `enveloppes`, `coffre_prive`, `coffre_profil`) ; `vaults.test.ts` (aller-retour, paliers, photo de 64 Ko dans 256 Kio, deux écritures concurrentes fusionnées pour chaque coffre, `gen` plus petit refusé, rien de `prive` dans `profil`) ; `session.test.ts` (déconnexion efface `shhdrop-compte`, `K_compte`, `s_profil`) ; `api.test.ts` (aucune requête vers `/api/shares`, `/api/manage`, ni `/api/salons` hors `POST /api/salons`) ; `source-rules.test.ts` étendu ; build de la démo : aucune chaîne `/api/compte` dans `dist/`.
- [ ] **Step 2 :** `cd web && npx vitest run src/account` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `make test-web` → PASS.
- [ ] **Step 5 :** commit `feat(site): module de compte, deux coffres chiffrés sur l'appareil`.

## Lot 10 — Site : inscription, connexion, mot de passe oublié

*Livrable seul : pages présentes seulement si `__COMPTES__`. Dépend de : lot 9.*

**Files :**
- Create : `web/src/routes/compte/{Inscription,Connexion,Oubli}.svelte`, `web/src/ui/{CodeField,AvatarPicker,PseudoField}.svelte`, tests voisins
- Modify : `web/src/app/router.svelte.ts` (`/compte`, `/compte/inscription`, `/compte/connexion`, `/compte/oubli`, `/compte/profil` ; `suite=salon` seul paramètre), `web/src/App.svelte`, `web/src/app/title.ts`, `web/src/app/seo.ts` (`noindex`), `web/src/i18n/{fr,en}.ts`

- [ ] **Step 1 : tests** — `router.test.ts` (chemins ; `/compte/x` → 404 ; rien dans `location`) ; `Inscription.test.ts` (erreurs exactes de §12.1 ; vérification du pseudo après 400 ms ; « Déjà pris » ; **aucune étape de code de secours** ; messages d'état de §21.3 après le code juste) ; `Connexion.test.ts` (étape TOTP ; « Adresse ou mot de passe incorrect. » ; compte suspendu avec date et motif) ; `Oubli.test.ts` (adresse exacte ; « Je n'ai plus mon application » → texte d'attente exact de §21.2.4 ; bandeau de §21.15.6 avant validation ; `attente` affichée) ; `i18n.test.ts` ; `no-analytics.test.ts` vert.
- [ ] **Step 2 :** `cd web && npx vitest run src/routes/compte src/ui/CodeField src/ui/PseudoField src/app/router` → FAIL.
- [ ] **Step 3 :** implémenter avec `TextField`, `PassphraseField`, `Button`, `Banner`, `LiveRegion`.
- [ ] **Step 4 :** `make test-web` → PASS ; `make test-ui` : captures (clair, sombre, 360 px, 1 280 px).
- [ ] **Step 5 :** commit `feat(site): inscription, connexion et récupération par e-mail`.

## Lot 11 — Site : historique de l'appareil étendu et synchronisation

*Livrable seul : sans compte, l'historique gagne les partages reçus (visibles au lot 12). Dépend de : lot 9 (pour la synchronisation seulement).*

**Files :**
- Modify : `web/src/history/store.ts` (champ `sorte` : `envoi` | `recu` | `salon_cree` | `salon_rejoint` ; champ `origine` ; migration des entrées existantes en `envoi`/`local` ; champs de §21.7 ; `clean` refuse tout mot de passe, nom d'élément ou contenu), `web/src/history/live.svelte.ts`, `web/src/flows/` (ouverture réussie → entrée `recu` si le réglage le permet ; case « Garder dans mon accueil »), `web/src/account/vaults.ts` (fusion historique ↔ `B_prive`, retour des entrées `local` après une récupération)
- Test : `web/src/history/{store,live}.test.ts`, `web/src/account/sync.test.ts`

- [ ] **Step 1 : tests** — migration (anciennes entrées intactes) ; `clean` (champ `password`, `names`, `items` ignorés ; `K_lien` accepté seulement pour `recu`, `salon_*`) ; ouverture d'un partage → entrée `recu` (sans mot de passe) ; case décochée → rien ; synchronisation : écriture différée de 2 à 12 min (horloge simulée), fusion, entrées `compte` retirées à la déconnexion, `local` gardées ; après `oubli/fin` : entrées `local` réécrites dans le nouveau coffre privé.
- [ ] **Step 2 :** `cd web && npx vitest run src/history src/account/sync` → FAIL.
- [ ] **Step 3 :** implémenter ; la page Confidentialité n'est pas encore changée (lot 16).
- [ ] **Step 4 :** `make test-web` → PASS.
- [ ] **Step 5 :** commit `feat(site): historique de l'appareil à quatre sortes, synchronisé dans le coffre privé`.

## Lot 12 — Site : accueil connecté

*Livrable seul : l'accueil connecté n'apparaît qu'avec une session (`__COMPTES__`) ; sans compte, ce lot ajoute à `/envois` le filtre « Reçus » (même `InboxRow`), visible de tous. Dépend de : lots 11 et, pour l'accueil connecté, 10. Les entrées « salon » s'affichent avec les écrans du salon (C-3, C-5).*

**Files :**
- Create : `web/src/routes/home/Inbox.svelte`, `web/src/ui/{InboxRow,InboxDetail,NewSheet,Avatar}.svelte`, tests voisins
- Modify : `web/src/routes/Home.svelte` (accueil connecté si session ouverte), `web/src/routes/History.svelte` (filtre « Reçus » sans compte), `web/src/app/tabbar.ts` (onglets connectés de §21.15.1), `web/src/ui/TabIcon.svelte`, `web/src/ui/TopNav.svelte`, `web/src/ui/Icon.ts` (icônes de §21.15, revue du jeu fermé), `web/src/i18n/{fr,en}.ts`

- [ ] **Step 1 : tests** — `Inbox.test.ts` : **aucune requête au chargement** (faux `fetch`) ; filtres « Tout / Salons / Reçus / Envoyés » ; tri ; « Expiré » quand `expiresAt` est passé ; « Rouvrir compte une ouverture » sur une entrée `recu` d'un autre appareil ; retrait au glissement et au clavier ; relecture d'une entrée ≤ 1 par 5 min ; état vide exact ; bandeau après récupération ; `tabbar.test.ts` (quatre onglets connectés) ; `History.test.ts` (filtre « Reçus », aucune requête au chargement) ; 320 px sans défilement horizontal.
- [ ] **Step 2 :** `cd web && npx vitest run src/routes/home src/ui/InboxRow src/app/tabbar` → FAIL.
- [ ] **Step 3 :** implémenter (§21.15.1).
- [ ] **Step 4 :** `make test-web` → PASS ; `make test-ui` : captures téléphone et ordinateur, clair et sombre.
- [ ] **Step 5 :** commit `feat(site): accueil connecté, liens reçus, salons et envois au même endroit`.

## Lot 13 — Site : profil, paramètres, export, suppression totale

*Livrable seul. Dépend de : lots 10, 11, 6 (`GET salons`).*

**Files :**
- Create : `web/src/routes/compte/{Profil,Parametres,Supprimer}.svelte`, `web/src/routes/compte/sections/{Email,MotDePasse,DoubleAuth,Appareils,Confidentialite,Abonnement,Recuperation,Donnees}.svelte`, `web/src/ui/TotpSetup.svelte`, `web/src/account/suppression.ts`, tests voisins
- Modify : `web/src/i18n/{fr,en}.ts`

**Interfaces :**
- `supprimerTout({ effacerAppareil }): AsyncIterable<Progres>` : (1) `manage/destroy` de chaque `S_gestion` du coffre privé et de l'historique (un par un, sans `X-Shh-Session`) ; (2) départ de chaque salon où une preuve de membre existe ; (3) `POST supprimer` ; (4) effacement local si demandé.

- [ ] **Step 1 : tests** — `Profil.test.ts` (photo : changer, retirer, ≤ 64 Ko ; pseudo : « Disponible », « Déjà pris », `limit` → texte exact ; carte « Votre compte » : date, palier, « Dès le 21 novembre » ; note de confidentialité exacte) ; `Parametres.test.ts` (sections dans l'ordre de §21.15.4 ; boutons désactivés avec la raison pendant `recup_jusqu` ; demande de retrait de la double authentification : bandeau et « Annuler la demande » ; réglages de confidentialité écrits dans le coffre de profil) ; `suppression.test.ts` (ordre exact ; une destruction échouée n'empêche pas les autres et est dite ; aucune requête de destruction ne porte `X-Shh-Session` ; textes de ce qui reste ; pass perdu annoncé) ; export : JSON sans adresse, avec profil et listes.
- [ ] **Step 2 :** `cd web && npx vitest run src/routes/compte src/account/suppression src/ui/TotpSetup` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `make test-web` → PASS ; captures `make test-ui`.
- [ ] **Step 5 :** commit `feat(site): profil, paramètres complets, export et suppression totale`.

## Lot 14 — Site : signalement avec catégories (partage ouvert ; salon avec C-5)

*Livrable seul : utile sans compte. Dépend de : lot 6 (le serveur accepte la catégorie). Le côté salon se branche avec l'écran du salon (C-5) ; ce lot fournit le composant et son test.*

**Files :**
- Modify : `web/src/ui/ReportSheet.svelte` (deux étapes, dix catégories, textes de §21.15.7), `web/src/transfer/api.ts` (`destroy("report", categorie)`), `web/src/routes/Content.svelte`, `web/src/i18n/{fr,en}.ts` ; spécification UI §9.10 et A13 : ligne de renvoi datée vers la conception §21.10
- Test : `web/src/ui/ReportSheet.test.ts`, `web/src/transfer/api.test.ts`

- [ ] **Step 1 : tests** — dix catégories dans l'ordre, au clavier (flèches), « Continuer » désactivé sans choix ; aucune requête avant « Signaler et détruire » ; corps exact `{"reason":"report","categorie":n}` ; bandeau PHAROS pour 1 et 2 seulement ; focus par défaut sur « Annuler ».
- [ ] **Step 2 :** `cd web && npx vitest run src/ui/ReportSheet src/transfer/api` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `make test-web`, `make test-e2e` → PASS ; captures.
- [ ] **Step 5 :** commit `feat(site): signalement par catégorie`.

## Lot 15 — Site : « À télécharger » et historique des téléchargements

*Livrable seul : sans compte, indépendant des lots 2 à 14 (peut être avancé). Dépend de : rien.*

**Files :**
- Create : `web/src/downloads/{store.ts,store.test.ts}` (base `shhdrop-telechargements`, AES-256-GCM, clé non extractible ; 30 jours), `web/src/routes/Downloads.svelte`, `web/src/routes/Downloads.test.ts`
- Modify : `web/src/routes/Content.svelte` (en-tête « À télécharger », mention d'échéance ; entrée d'historique après chaque `saveItem` réussi), `web/src/app/router.svelte.ts` (`/telechargements`), `web/src/app/tabbar.ts` (onglet Téléchargements), `web/src/source-rules.test.ts` (`shhdrop-telechargements` seulement dans `web/src/downloads/` ; aucun `fetch` dans ce module), `web/src/i18n/{fr,en}.ts`

- [ ] **Step 1 : tests** — entrée créée seulement après un enregistrement réussi (annulé ou échoué : rien) ; champs exacts (nom, taille, sorte, source, date ; jamais lien, clé, mot de passe) ; stockage chiffré (`fake-idb` : aucun nom en clair dans `raw()`) ; 30 jours ; réglage coupé → rien d'écrit ; « Effacer tout » ; page : groupes par jour, états vide et désactivé, textes exacts de §21.15.5 ; 320 px.
- [ ] **Step 2 :** `cd web && npx vitest run src/downloads src/routes/Downloads` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `make test-web` → PASS ; captures.
- [ ] **Step 5 :** commit `feat(site): à télécharger et historique des téléchargements sur l'appareil`.

## Lot 16 — Textes publics, « le serveur ne voit rien » étendu, parcours complet

*Livrable seul : bloque toute activation publique. Dépend de : lots 1 à 15.*

**Files :**
- Create : `web/e2e/compte-sees-nothing.test.ts`, `web/e2e/compte-flow.test.ts`, `web/e2e/smtp.ts`
- Modify : `web/e2e/server.ts` (option `comptes`), `web/src/i18n/{fr,en}.ts` et `web/src/routes/pages/content.ts` (textes de la conception §16 et §21.18), `web/src/routes/pages/content.test.ts` ; spécification principale (§6, §33, §36 S14, S21, S64 à S82, §37.4, §38.4, §39.4, §39.5, D42-26 point 5 : amendements datés listés en fin de spécification)

- [ ] **Step 1 : test bloquant** `compte-sees-nothing.test.ts` : assertions de la conception §14 **et** §21.17 (pseudo et photo repères, `s_profil`, e-mails égaux au modèle dans les cinq cas, liens repères seulement dans `blob_prive` chiffré, réponses du tableau de bord, fichier de sauvegarde `age`, catégorie jamais sur disque) ; après suppression et arrêt : ni `h`, ni `e_canon`, ni `p_empreinte`, ni octet des coffres.
- [ ] **Step 2 :** `compte-flow.test.ts` : inscription → création de salon → ouverture d'un partage reçu (entrée `recu`) → connexion sur un autre appareil (listes retrouvées) → mot de passe oublié (profil gardé, coffre privé vidé, entrées de l'appareil revenues) → tentative de changement d'adresse refusée (`attente`) → horloge + 7 jours → suppression totale (salon fermé pour un autre membre, partage créé détruit) → réinscription de la même adresse permise ; bannissement depuis la liste des salons signalés → création refusée, motif affiché.
- [ ] **Step 3 :** `content.test.ts` : Confidentialité (séquestre du profil, deux coffres, sauvegardes 30 jours, catégories, motif, attente de 7 jours, fournisseur nommé) ; aucune page avec « ni e-mail », « No email », « 100 % » ; « Aucun cookie » présent.
- [ ] **Step 4 :** `make test-e2e`, `make test` → PASS.
- [ ] **Step 5 :** commit `test(compte): le serveur ne voit rien, étendu ; parcours complet ; textes publics (à relire par le juriste)`.

---

## Ordre et dépendances (résumé)

| Lot | Dépend de | Peut être poussé sans changer le site public |
|---|---|---|
| 1 Moteur | — | oui |
| 2 Socle serveur | 1 | oui |
| 3 Courriel, limites | 2 | oui |
| 4 Inscription, connexion, pseudo, coffres | 2, 3 | oui (`SHH_COMPTES=0`) |
| 5 Récupération, double authentification, paramètres, suppression | 4 | oui |
| 6 Salon ↔ compte, signalements par catégorie | 5 | oui (catégorie facultative) |
| 7 Bannissement, tableau de bord | 6 | oui (tableau de bord désactivé par défaut) |
| 8 Déploiement, sauvegarde | 2, 3 | oui (`SHH_COMPTES: "0"`) |
| 9 Module de compte du site | 1, 4, 5 | oui (`__COMPTES__ = false`) |
| 10 Pages d'accès | 9 | oui |
| 11 Historique étendu | 9 (synchro) | oui (entrées « reçus » invisibles jusqu'au lot 12) |
| 12 Accueil connecté | 11 (10 pour la partie connectée) | **change le site public** (filtre « Reçus » de `/envois`) |
| 13 Profil, paramètres, suppression | 10, 11, 6 | oui |
| 14 Signalement par catégorie | 6 | **change le site public** (nouvelle feuille) : à pousser quand le serveur du lot 6 est en ligne |
| 15 Téléchargements | — | **change le site public** (nouvel onglet) : peut être avancé |
| 16 Textes, e2e | 1 à 15 | change les textes publics : à pousser juste avant l'activation |

Activation publique (`SHH_COMPTES=1`, `__COMPTES__ = true`) : **décision D8**, après le juriste (R15 à R18) et le test bloquant du lot 16.

## Auto-relecture (faite)

- **Couverture de la conception** : §5 (lots 1, 2) ; §6 et §21.2.2 (1, 4, 9) ; §8.1 (2) ; §21.6.1 (2) ; §8.3, §8.8 (3, 4, 5) ; §8.4 et §21.2.4 (5) ; §8.5 (4) ; §21.6.2 (4 à 6) ; §21.3 (3, 4) ; §21.5 (1, 2, 4, 10, 13) ; §11 (6) ; §21.7, §21.8 (11, 12) ; §21.9 (15) ; §21.10 (6, 14) ; §21.11 (7) ; §21.12 (5, 13) ; §21.13 (8) ; §21.14 (7) ; §21.15 (10, 12 à 15) ; §21.16, §21.17 (16) ; §16, §21.18 textes (16 ; le volet juridique reste au juriste) ; §17 (1, 4, formats communs). Le bouton « Créer un salon » et les entrées « salon » de l'accueil dépendent des écrans du salon (C-3, C-5), hors de ce plan.
- **Retiré de la version 1** : code de secours (moteur, routes, écrans, vecteurs), modèles d'e-mail « déjà inscrit », « banni », « adresse changée », coffre unique `blob`.
- **Types** : `Adresse`, `Cles`, `Donnees`, `DonneesOubli`, `OptionsSession`, `Ouverture`, `Courante`, `Limites`, `EtatCompte`, `BanVue`, `CompteVue` gardent les mêmes noms d'un lot à l'autre ; `h` `[16]byte`, empreintes, `A_auth` et `s_profil` `[32]byte`, enveloppes et séquestre `[60]byte`, identifiant de bannissement `[8]byte`.
