# Compte par e-mail et mot de passe (D42-26) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **À ne pas commencer avant la validation de la conception par le propriétaire** (décisions D1 à D8, §20 de la conception). Les valeurs ci-dessous sont les recommandations ; une décision contraire change les tâches citées.

**Goal :** un compte gratuit (e-mail confirmé, mot de passe, double authentification facultative, pseudo et photo chiffrés) obligatoire pour créer un salon, avec ancienneté, bannissement par le fondateur, récupération et paramètres, sans que le serveur reçoive le mot de passe ni garde l'adresse en clair.

**Architecture :** le moteur Rust fait la normalisation de l'adresse, le sel, Argon2id, les dérivations et le code de secours (vecteurs communs, rejoués en Go). Le serveur Go gagne deux paquets : `internal/compte` (base `comptes.db`, empreintes à clé, codes, sessions, TOTP, ancienneté, bannissement) et `internal/courriel` (seul client sortant : SMTP vers le fournisseur, file en mémoire). Le site gagne `web/src/account/` (seul détenteur du jeton et de `K_compte`) et quatre pages sous `/compte`. Tout est désactivé par défaut (`SHH_COMPTES=0`).

**Tech Stack :** Go (go 1.26.0, toolchain go1.27.4), `modernc.org/sqlite` v1.62.0, `crypto/hkdf`, `crypto/hmac`, `crypto/aes`, `net/smtp`, `crypto/tls`, `github.com/pquerna/otp` (version exacte épinglée à la Task 7) ; Rust 1.99.1, crates déjà présentes (`argon2` 0.6, `hkdf` 0.13, `sha2` 0.11) ; Svelte 5, vitest 5.1.0, WebCrypto.

**Spec :** `docs/superpowers/specs/2026-11-14-compte-email-design.md` (entière) ; spécification principale D42-26, §29.2, §33, §36, §37.2 (format de `B`), §39.4 (règles du pseudo) ; salon v3 §15.2.

## Global Constraints

- CLAUDE.md : le serveur ne reçoit ni ne garde de mot de passe, de clé, de pseudo ni de photo ; aucune adresse e-mail en clair sur disque ni dans un journal ; aucune adresse IP sur disque ; aucune crypto maison ; aucune ressource tierce sur le site ; tests avant tout « fait » ; jamais « 100 % sécurisé ».
- Commits : `git commit --author="Skoow <190851638+Skoow@users.noreply.github.com>"`, sur `main`, message terminé par les lignes d'attribution de la session ; push après `make test` vert ; le contrôleur vérifie la CI après chaque push.
- Désactivé par défaut : `SHH_COMPTES=0` → aucune route `/api/compte/*` (404 identique à une route inconnue), création de salon inchangée. `SHH_COMPTES=1` exige `SHH_SALONS=1`, `SHH_COMPTES_CLE_FILE`, `SHH_SMTP_HOST`, `SHH_SMTP_USER`, `SHH_SMTP_PASSWORD_FILE`, `SHH_MAIL_FROM`.
- Valeurs fixes (conception) :
  - Argon2id 64 Mio (67 108 864 octets), 3 passes, 1 fil, 32 octets ; sel = SHA-256(« shhdrop/v2/compte/sel » ‖ 0x00 ‖ canon)[0..16] ; HKDF-SHA-256 sel vide, étiquettes exactes : `shhdrop/v2/compte/auth`, `shhdrop/v2/compte/enveloppe-mdp`, `shhdrop/v2/compte/secours/acces`, `shhdrop/v2/compte/secours/enveloppe`, `shhdrop/v2/compte/blob`, `shhdrop/v2/compte/appareil` ; serveur : `shhdrop/v2/serveur/compte/email`, `shhdrop/v2/serveur/compte/mdp`, `shhdrop/v2/serveur/compte/totp` ;
  - enveloppe = nonce 12 ‖ chiffré 32 ‖ étiquette 16 = 60 octets, AD = « SHH-CENV1 » ‖ `h` ‖ (« mdp » | « secours ») ; TOTP chiffré = 48 octets, AD = « SHH-TOTP1 » ‖ `h` ; coffre « SHH-ACCT1 » de §37.2, paliers 4, 16, 64, 256 Kio ;
  - code de secours : 53 caractères (52 base32 Crockford + contrôle mod 37, alphabet `0-9A-Z*~$=U`) ;
  - mot de passe 10 à 256 caractères ; pseudo : règles de §39.4 point 4 (2 à 24 graphèmes) ; photo 256 × 256, ≤ 64 Ko ;
  - codes e-mail 6 chiffres, 15 min, 5 essais ; TOTP SHA-1, 6 chiffres, 30 s, ±1 pas, 5 essais par étape, 10 échecs par heure par compte ;
  - limites : inscriptions 3/jour/connexion, 10/jour//48 ; e-mails 3/jour/adresse, 10/jour/connexion, renvoi après 60 s ; connexion 20 échecs/h/connexion, 60//48, preuve ALTCHA après 5 échecs/h/compte ; code de secours 10/h/connexion, 5/h/compte ; coffre 60 écritures/h/compte ; 20 sessions par compte ; file d'e-mails 256 ; `SHH_COMPTES_MAX` 10 000 ;
  - sessions : simple 2 h sans usage et au plus jusqu'à la fin du jour UTC suivant ; « rester connecté » 30 jours sans usage, 90 jours au plus ; « récente » < 5 min ;
  - paliers : neuf (< 7 jours depuis `compte_des`) 1 salon, `max_members` ≤ 4, 24 h ; confirmé 3 salons, ≤ 10, 24 h ;
  - bannissement 3 ans ; comptes effacés après 13 mois sans connexion ;
  - dates de `comptes.db` : jour (multiple de 86 400) ou mois (premier du mois), jamais d'heure.
- Textes : messages exacts de la conception §12 ; clés `account.*` en `fr.ts` et `en.ts`.
- Vérifications à chaque tâche Go : `cd server && go test -race ./...` puis `make test-go` **et** `make test-e2e` ; tâche moteur : `make test-engine` ; tâche site : `make test-web`.

## Review Focus

1. **Variante d'adresse à la connexion** (`Lea.Dupont+x@GMAIL.com` pour un compte créé avec `leadupont@gmail.com`) : connexion réussie, même sel ; récupération par e-mail refusée tant que l'adresse exacte n'est pas tapée (Task 6, `TestConnexionVarianteCanonique` ; Task 7, `TestOubliAdresseExacteSeulement`).
2. **Remise à zéro par e-mail avec double authentification active** : sans code TOTP juste, aucune session et aucun mot de passe changé (Task 7, `TestOubliExigeTOTP`).
3. **Deux onglets qui écrivent le coffre** (salon créé dans un onglet, pseudo changé dans l'autre) : 409, fusion, rien de perdu (Task 12, « deux écritures concurrentes fusionnées »).
4. **Redémarrage du serveur pendant une inscription** : l'étape disparaît, l'écran dit « Code expiré. Demandez-en un nouveau. », aucun compte à moitié créé sur disque (Task 6, `TestInscriptionPerdueAuRedemarrage` ; Task 13).
5. **Bannissement pendant qu'un salon du compte est ouvert** : salons fermés pour tous, WebSocket coupés, nouvelle création refusée `banni`, réinscription de la même adresse refusée (Task 10, `TestBannirFermeLesSalonsOuverts`).

---

### Task 1 : moteur Rust, compte (normalisation, sel, dérivations, code de secours) et vecteurs

**Files :**
- Create : `engine/core/src/compte.rs`, `engine/core/tests/compte.rs`, `engine/vectors/compte.json`, `web/scripts/gen-compte-vectors.mjs` (cas d'enveloppes et de coffre produits par WebCrypto, nonces fixés)
- Modify : `engine/core/src/lib.rs`, `engine/core/src/error.rs`, `engine/wasm/src/lib.rs`, `engine/vectors/README.md`, `web/src/engine/index.ts`, `web/src/engine/argon2.worker.ts`
- Test : `web/src/engine/compte.test.ts`

**Interfaces :**
- Produces (Rust, `shhdrop_core::compte`) : `pub struct Adresse { pub canon: String, pub exacte: String }` ; `pub fn normaliser(email: &str) -> Result<Adresse, Erreur>` (erreurs `adresse_invalide`, `adresse_non_ascii`) ; `pub fn sel(canon: &str) -> [u8; 16]` ; `pub fn deriver(mot_de_passe: &[u8], canon: &str) -> Result<(Zeroizing<[u8;32]>, Zeroizing<[u8;32]>), Erreur>` (= `A_auth`, `KEK_mdp`) ; `pub fn deriver_secours(rk: &[u8;32]) -> ([u8;32], Zeroizing<[u8;32]>)` (= `A_s`, `KEK_s`) ; `pub fn cle_blob(k_compte: &[u8;32]) -> Zeroizing<[u8;32]>` ; `pub fn cle_appareil(k_compte: &[u8;32]) -> Zeroizing<[u8;32]>` ; `pub fn secours_encoder(rk: &[u8;32]) -> String` (53) ; `pub fn secours_lire(saisie: &str) -> Result<[u8;32], Erreur>` (`code_mal_recopie`) ; `pub fn mot_de_passe_valide(mdp: &str, adresse: &Adresse) -> Result<(), Erreur>` (`mdp_court`, `mdp_long`, `mdp_adresse`).
- Produces (wasm, `web/src/engine/index.ts`) : `normaliserAdresse(email): { canon, exacte }`, `deriverCompte(mdp: Uint8Array, canon): Promise<{ aAuth, kek }>` (Argon2id dans le Worker existant), `deriverSecours(rk)`, `cleBlob(k)`, `cleAppareil(k)`, `secoursEncoder(rk)`, `secoursLire(s)`, `motDePasseValide(mdp, canon, exacte)`.
- `engine/vectors/compte.json` : sections `normaliser` (≥ 40 cas : majuscules, blancs de bord, `+` partout, points Gmail, `googlemail.com`, `+` en tête, double `@`, 64/65 caractères locaux, 254/255 au total, accents, tiret en bord d'étiquette, TLD numérique), `sel`, `deriver` (mots de passe NFC difficiles, blancs de bord), `secours` (encodage, saisies avec `I`, `L`, `O`, tirets, espaces, contrôle faux), `enveloppes` et `coffre` (clé, nonce, AD, résultat ; produits par `gen-compte-vectors.mjs`).

- [ ] **Step 1 : tests** — `engine/core/tests/compte.rs` : `vecteurs_normaliser`, `vecteurs_sel`, `vecteurs_deriver`, `vecteurs_secours` lisent `compte.json` et comparent octet pour octet ; `secours_aller_retour` (1 000 clés tirées) ; `controle_detecte_une_faute` (chaque substitution d'un caractère → `code_mal_recopie`) ; `canon_ne_depend_pas_de_la_variante` (`Lea.Dupont+x@GMAIL.com` et `leadupont@gmail.com` → même `canon`, `exacte` différentes). `web/src/engine/compte.test.ts` : mêmes vecteurs rejoués par le module wasm sous Node ; les cas `enveloppes` et `coffre` déchiffrés par WebCrypto.
- [ ] **Step 2 :** `make test-engine` → FAIL (module absent).
- [ ] **Step 3 :** implémenter `compte.rs` (aucune dépendance nouvelle ; NFC et blancs par les fonctions existantes de `kdf.rs`), liaisons wasm, générateur des cas WebCrypto.
- [ ] **Step 4 :** `make test-engine` puis `cd web && npx vitest run src/engine/compte.test.ts` → PASS ; `node scripts/check-dist.mjs` : poids du `.wasm` des partages noté (attendu : < +2 Ko brotli).
- [ ] **Step 5 :** commit `feat(moteur): compte, normalisation de l'adresse, sel, dérivations, code de secours (vecteurs communs)`.

### Task 2 : configuration, clé du serveur, schéma 3 du salon

**Files :**
- Modify : `server/internal/config/config.go`, `server/internal/store/store.go`, `server/cmd/shhdrop/main.go`
- Create : `server/internal/compte/cles.go`
- Test : `server/internal/config/config_test.go`, `server/internal/store/store_test.go`, `server/internal/compte/cles_test.go`

**Interfaces :**
- Produces : `config.Config` : `Comptes bool` (`SHH_COMPTES`), `ComptesCleFile string`, `ComptesMax int` (1 à 1 000 000, défaut 10 000), `SMTP config.SMTP{ Host string; Port int; User string; PasswordFile string; From string }` ; refus : `SHH_COMPTES=1` sans `SHH_SALONS=1`, fichier de clé dans `SHH_DATA_DIR`, de taille ≠ 32, droits plus larges que 0600 ; port SMTP ≠ 465/587 hors boucle locale ; `From` sans `@`.
  - `compte.Cles{ Email, Poivre, TOTP [32]byte }` ; `func compte.LireCles(chemin string) (Cles, error)` (HKDF des étiquettes du Global Constraints ; tampon de la clé lue effacé).
  - `store.SchemaVersion = 3` ; colonne `salons.compte BLOB CHECK(compte IS NULL OR length(compte)=16)`, index `salons_compte` ; migration 2 → 3 par `ALTER TABLE … ADD COLUMN` (lignes existantes : `NULL`).
- [ ] **Step 1 : tests** — `TestComptesDefautDesactive` ; table `TestComptesConfigRefusee` (chaque refus ci-dessus) ; `TestComptesConfigValide` ; `TestLireClesDerivations` (clé fixe → trois sous-clés égales aux valeurs calculées par `hkdf.Key` dans le test, deux à deux différentes) ; `TestLireClesRefuse` (31 et 33 octets, 0644) ; `TestSchemaMinimal` mis à jour (`index:salons_compte` en plus) ; `TestSalonsColonnes` (une colonne de plus, `compte`) ; `TestMigreV2VersV3` (salon gardé, `compte` NULL) ; `TestRefuseV4`.
- [ ] **Step 2 :** `cd server && go test -race ./internal/config/ ./internal/store/ ./internal/compte/` → FAIL.
- [ ] **Step 3 :** implémenter ; `main.go` lit les clés seulement si `cfg.Comptes`.
- [ ] **Step 4 :** `go test -race ./...`, `make test-go`, `make test-e2e` → PASS.
- [ ] **Step 5 :** commit `feat(compte): SHH_COMPTES, clé du serveur, colonne salons.compte (schéma 3)`.

### Task 3 : base `comptes.db`, normalisation Go, empreintes, domaines jetables

**Files :**
- Create : `server/internal/compte/base.go`, `server/internal/compte/adresse.go`, `server/internal/compte/jetables.go`, `server/internal/compte/jetables.txt`, `server/internal/compte/jetables-ajouts.txt`, `web/scripts/maj-jetables.mjs` (poste du développeur seulement)
- Modify : `THIRD_PARTY_LICENSES.md` (liste des domaines, CC0, date de la copie)
- Test : `server/internal/compte/base_test.go`, `server/internal/compte/adresse_test.go`

**Interfaces :**
- Produces : `func compte.OuvrirBase(chemin string) (*sql.DB, error)` (pragmas de `store` : WAL, `secure_delete`, `journal_size_limit(0)`, `temp_store(MEMORY)`, `foreign_keys`) ; tables exactes de la conception §8.2 (`comptes`, `sessions`, `bannis`, toutes `WITHOUT ROWID`, contraintes de longueur) ; `user_version = 1` ;
  - `func Normaliser(email string) (Adresse, error)` (mêmes règles et mêmes erreurs que le moteur) ; `func (c Cles) Empreintes(a Adresse) (canon, envoi [32]byte)` ; `func Jetable(domaine string) bool`.
- [ ] **Step 1 : tests** — `TestNormaliserVecteurs` : rejoue `../../../engine/vectors/compte.json` section `normaliser` (échoue si 0 cas) ; `TestEnveloppesVecteurs` : déchiffre les cas `enveloppes` avec `crypto/aes` (deuxième implémentation indépendante de WebCrypto) ; `TestEmpreintesDistinctes` (`canon` ≠ `envoi` pour la même adresse ; autre clé → autres empreintes) ; `TestJetable` (`mailinator.com`, `x.mailinator.com` → vrai ; `gmail.com`, `notmailinator.com` → faux ; un domaine de `jetables-ajouts.txt` → vrai) ; `TestSchemaComptes` (`sqlite_master` exact ; aucune colonne de type texte qui pourrait recevoir une adresse : toutes les colonnes sont BLOB ou INTEGER) ; `TestComptesWithoutRowid` ; `TestDatesAuJour` (`CHECK(cree_jour % 86400 = 0)` refuse 86 401).
- [ ] **Step 2 :** `go test -race ./internal/compte/` → FAIL.
- [ ] **Step 3 :** implémenter ; la liste est lue une fois au démarrage en un ensemble (map) : ligne `allowedMaps` « constante (liste de domaines), aucun compteur ».
- [ ] **Step 4 :** `go test -race ./...`, `make test-go` → PASS.
- [ ] **Step 5 :** commit `feat(compte): base comptes.db, normalisation et empreintes à clé, domaines jetables`.

### Task 4 : envoi d'e-mails (`internal/courriel`)

**Files :**
- Create : `server/internal/courriel/courriel.go` (file, modèles), `server/internal/courriel/smtp.go` (seule connexion sortante), `server/internal/courriel/modeles.go`, `server/internal/courriel/fauxsmtp_test.go` (serveur SMTP de test en mémoire), `server/internal/courriel/courriel_test.go`
- Modify : `server/internal/stats_test.go` (exemption de `internal/courriel/smtp.go` ; `smtp.Dial`, `smtp.SendMail`, `smtp.NewClient`, `tls.Dial`, `tls.Dialer` interdits ailleurs ; ligne `allowedMaps` si une map est ajoutée), `deploy/Dockerfile` (certificats racine copiés de l'étape `server`, commentaire « aucune connexion sortante » corrigé)

**Interfaces :**
- Produces : `type Message struct{ A string; Modele Modele; Langue string; Code string }` ; `type Modele uint8` (`ModeleCode`, `ModeleDejaInscrit`, `ModeleBanni`, `ModeleAdresseChangee`) ; `type Envoyeur struct{…}` ; `func Nouveau(c config.SMTP, motDePasse []byte) *Envoyeur` ; `func (e *Envoyeur) Mettre(m Message) error` (`ErrPlein` si 256 en file) ; `func (e *Envoyeur) Run(ctx context.Context)` (un envoi à la fois, 20 s, un nouvel essai, message effacé de la file après envoi, **aucune sortie** sur stdout/stderr) ; textes exacts de la conception §12.5 en `fr` et `en` (`text/plain; charset=utf-8`, en-têtes `From`, `To`, `Subject`, `Date`, `Message-ID` aléatoire ; aucun en-tête qui porterait une adresse IP ou un identifiant de compte).
- [ ] **Step 1 : tests** — `TestEnvoiCode` (faux SMTP en TLS sur la boucle locale : un message, corps exact, objet « Votre code Shhgone ») ; `TestTexteClairRefuseHorsBoucle` ; `TestFilePleine` (257ᵉ → `ErrPlein`) ; `TestEchecSilencieux` (faux SMTP qui refuse : aucune sortie, aucune panique, message oublié) ; `TestAucunEnTeteDeTrop` (en-têtes reçus = liste exacte) ; `TestNoOutgoingHTTP` et `TestNoUnlistedCounter` (paquet `internal`) verts.
- [ ] **Step 2 :** `go test -race ./internal/courriel/ ./internal/` → FAIL.
- [ ] **Step 3 :** implémenter avec `net/smtp` sur `crypto/tls` (TLS 1.2 au moins, vérification du certificat, `ServerName` = `SHH_SMTP_HOST`).
- [ ] **Step 4 :** `go test -race ./...`, `make test-go` → PASS ; `docker build` du `Dockerfile` : le fichier de certificats est dans l'image (`make test-repro` vert).
- [ ] **Step 5 :** commit `feat(courriel): envoi SMTP vers le fournisseur, file en mémoire, seul client sortant`.

### Task 5 : limites du compte

**Files :**
- Modify : `server/internal/limits/limits.go`, `server/internal/stats_test.go` (lignes `allowedMaps` justifiées, et §9.5 de la spécification principale)
- Test : `server/internal/limits/limits_test.go`

**Interfaces :**
- Produces : `func (l *Limiter) AllowInscription(ip netip.Addr) bool` (3/jour, 10//48) ; `AllowCourriel(ip netip.Addr, canon [32]byte) bool` (10/jour/connexion, 3/jour/adresse) ; `AllowEchecConnexion(ip) bool` et `NoterEchecConnexion(ip, canon)` ; `PreuveRequise(canon) bool` (> 5 échecs dans l'heure) ; `AllowSecours(ip, canon) bool` ; `AllowTOTP(h [16]byte) bool` ; `AllowEcritureCoffre(h) bool` ; même rotation que les quotas du jour (clés HMAC du jour ; empreintes de compte effacées à la rotation de l'heure ou du jour).
- [ ] **Step 1 : tests** — une fonction de test par limite, bornes exactes du Global Constraints ; `TestLimitesCompteOublieesALaRotation` ; `TestAucuneAdresseGardee` (inspection : aucune clé de map ne contient l'adresse ni le /64 en clair).
- [ ] **Step 2 :** `go test -race ./internal/limits/ ./internal/` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `go test -race ./...`, `make test-go` → PASS.
- [ ] **Step 5 :** commit `feat(compte): limites d'inscription, d'e-mails, de connexion et de récupération`.

### Task 6 : inscription, connexion, sessions

**Files :**
- Create : `server/internal/compte/service.go`, `server/internal/compte/etapes.go` (étapes en mémoire), `server/internal/compte/sessions.go`, `server/internal/api/handlers_compte.go`
- Modify : `server/internal/api/api.go` (`api.Comptes{ S *compte.Service }` ; routes enregistrées seulement si `S != nil`), `server/internal/api/minimize_test.go` (`X-Shh-Session` lu par `handlers_compte.go` seulement à ce stade), `server/cmd/shhdrop/main.go` (ouverture de `comptes.db` dans `SHH_DATA_DIR`, vidage du WAL au démarrage, `Envoyeur.Run`)
- Test : `server/internal/compte/service_test.go`, `server/internal/api/compte_test.go`

**Interfaces :**
- Consumes : Tasks 2 à 5.
- Produces : `type Service struct{…}` ; `func NewService(c Config) (*Service, error)` (`Config{ DB *sql.DB; Cles Cles; Courriel *courriel.Envoyeur; Limites *limits.Limiter; Now func() time.Time; Max int }`) ;
  - `InscriptionDebut(ip, email, langue string) (h [16]byte, etape [32]byte, err error)` ; `Renvoyer(ip, etape)` ; `InscriptionFin(etape, code string, d Donnees, s OptionsSession) (jeton [32]byte, err error)` avec `type Donnees struct{ AAuth [32]byte; EnvMdp, EnvS [60]byte; VS [32]byte; Blob []byte }`, `type OptionsSession struct{ Persistante bool; Etiquette []byte }` ;
  - `Connexion(ip, email string, aAuth [32]byte, s OptionsSession, preuve bool) (Ouverture, error)` où `type Ouverture struct{ Jeton [32]byte; H [16]byte; EnvMdp [60]byte; Blob []byte; Gen uint64; Etape *[32]byte }` ; `ConnexionTOTP(etape [32]byte, code string) (Ouverture, error)` (Task 7 la remplit) ;
  - `Session(jeton []byte) (Courante, error)` (`type Courante struct{ H [16]byte; Recente bool; Sid [16]byte }`) ; `Reauth(c Courante, aAuth [32]byte, totp string) error` ; `Deconnexion(c)`, `Sessions(c) ([]SessionVue, error)`, `FermerSession(c, sid)`, `FermerAutres(c)` ;
  - erreurs : `ErrIdentifiants`, `ErrCodeFaux{Restants int}`, `ErrEtape`, `ErrTOTPRequis`, `ErrPreuveRequise`, `ErrRecent`, `ErrJetable`, `ErrAdresse`, `ErrBanni`, `ErrBusy`, `ErrLimit{Retry}` ; `failCompte(w, err)` dans `handlers_compte.go` (codes HTTP et corps de la conception §8.6).
- [ ] **Step 1 : tests** (`service_test.go`, faux SMTP de la Task 4, horloge figée)
  - `TestInscriptionComplete` (code lu dans le faux SMTP ; ligne `comptes` créée seulement après `InscriptionFin`) ; `TestInscriptionAdressePriseMemeReponse` et `TestInscriptionAdresseBannieMemeReponse` (même forme de réponse, e-mail « déjà inscrit » ou « banni », `InscriptionFin` → `ErrCodeFaux` pour tout code) ; `TestCodeCinqEssais` ; `TestCodeExpire15Min` ; `TestInscriptionPerdueAuRedemarrage` (nouveau `Service` sur la même base → `ErrEtape`, aucune ligne) ; `TestJetableRefuse` ; `TestCourseDeuxInscriptionsMemeAdresse` (deux étapes confirmées : une seule ligne, l'autre `ErrCodeFaux`) ;
  - `TestConnexionVarianteCanonique` ; `TestConnexionInconnueEtFausseIdentiques` (même erreur ; nombre d'appels HMAC égal, compté par un crochet de test) ; `TestPreuveApresCinqEchecs` ; `TestPasDeVerrouillage` (100 échecs d'une autre connexion n'empêchent pas une connexion juste avec preuve) ;
  - `TestSessionSimpleExpire` (2 h d'inactivité ; fin du jour UTC suivant) ; `TestSessionPersistante30Et90Jours` ; `TestSessionRecente5Min` ; `TestJetonJamaisEnClair` (la base ne contient que SHA-256 du jeton) ; `TestVingtSessionsAuPlus` ; `TestFermerAutres` ; `TestDatesDeLaBase` (toutes les dates multiples de 86 400 ou premiers du mois).
  - `compte_test.go` : `TestRoutesCompteAbsentes` (`SHH_COMPTES=0` : corps identique à `GET /api/inconnu`) ; `TestJSONStrictCompte` (clé inconnue, doublon, `a_auth` de 42 caractères, `null` → 400) ; `TestEnTeteSessionSeulementIci` (minimize).
- [ ] **Step 2 :** `go test -race ./internal/compte/ ./internal/api/` → FAIL.
- [ ] **Step 3 :** implémenter ; comparaisons en temps constant (`subtle.ConstantTimeCompare`, `hmac.Equal`) ; `v_mdp` = HMAC(`Poivre`, `h` ‖ `A_auth`) ; écriture de `vu_mois` au plus une fois par mois.
- [ ] **Step 4 :** `go test -race ./...`, `make test-go`, `make test-e2e` → PASS.
- [ ] **Step 5 :** commit `feat(compte): inscription par code e-mail, connexion, sessions sans cookie`.

### Task 7 : double authentification, code de secours, mot de passe oublié

**Files :**
- Create : `server/internal/compte/totp.go`, `server/internal/compte/secours.go`, `server/internal/compte/oubli.go`
- Modify : `server/go.mod`, `server/go.sum`, `THIRD_PARTY_LICENSES.md`, `server/internal/api/handlers_compte.go`
- Test : `server/internal/compte/totp_test.go`, `server/internal/compte/oubli_test.go`

**Interfaces :**
- Produces : `TOTPDebut(c Courante) (etape [32]byte, secretB32 string, err error)` ; `TOTPFin(c, etape, code) error` ; `TOTPRetirer(c) error` ; `SecoursDebut(ip, email string, aS [32]byte) (etape [32]byte, h [16]byte, envS [60]byte, err error)` ; `SecoursFin(etape, d Donnees, retirerTOTP bool, s OptionsSession) (Ouverture, error)` ; `OubliDebut(ip, email, langue string) ([32]byte, error)` ; `OubliVerifier(etape, code, totp string) ([16]byte, error)` ; `OubliFin(etape, d Donnees, s OptionsSession) (Ouverture, error)` ; `SecoursRenouveler(c, vS [32]byte, envS [60]byte) error`.
- [ ] **Step 1 : revue de chaîne d'approvisionnement** de `github.com/pquerna/otp` et de `github.com/boombuler/barcode` (compétence `supply-chain-risk-auditor`) : dernière version stable publiée depuis ≥ 7 jours, licence, mainteneurs, avis de sécurité ; résultat noté dans le message de commit. Refus → arrêter la tâche et le signaler au propriétaire (pas de TOTP maison).
- [ ] **Step 2 : tests** — `TestTOTPVecteursRFC6238` (secrets et instants de l'annexe B de la RFC, SHA-1) ; `TestTOTPTolerance` (pas −1, 0, +1 acceptés ; ±2 refusés) ; `TestTOTPRejeu` ; `TestTOTPSecretChiffre` (colonne `totp` ≠ secret, déchiffrée avec `K_totp` et AD) ; `TestTOTPActivationExigeCode` ; `TestConnexionAvecTOTP` ; `TestSecoursOuvreSansTOTP` ; `TestSecoursRetireTOTPSurDemande` ; `TestSecoursFermeLesAutresSessions` ; `TestOubliAdresseExacteSeulement` (aucun e-mail pour une variante canonique non exacte ; réponse identique) ; `TestOubliExigeTOTP` ; `TestOubliGardeAncienneteEtSalons` (`cree_jour`, `compte_des`, `salons.compte` inchangés ; `blob` remplacé ; `gen` croît) ; `TestRenouvelerSecoursRendAncienInutile`.
- [ ] **Step 3 :** `go test -race ./internal/compte/` → FAIL.
- [ ] **Step 4 :** implémenter ; version exacte dans `go.mod` ; `govulncheck ./...` vert.
- [ ] **Step 5 :** `go test -race ./...`, `make test-go`, `make test-e2e` → PASS ; commit `feat(compte): double authentification TOTP, code de secours, mot de passe oublié`.

### Task 8 : paramètres côté serveur (coffre, mot de passe, adresse, export, suppression)

**Files :**
- Create : `server/internal/compte/parametres.go`, `server/internal/compte/effacement.go` (comptes inactifs, bannis échus)
- Modify : `server/internal/api/handlers_compte.go`, `server/internal/janitor/janitor.go` (passe quotidienne : `compte.Effacer(now)`)
- Test : `server/internal/compte/parametres_test.go`, `server/internal/compte/effacement_test.go`

**Interfaces :**
- Produces : `Etat(c) (EtatCompte, error)` (`EtatCompte{ CreeLe, ConfirmeLe string; Palier string; Limites Limites; SalonsActifs int; TOTP, Banni bool }`, `Limites{ Salons, Places, Heures int }`) ; `LireCoffre(c) ([]byte, uint64, error)` ; `EcrireCoffre(c, ifGen uint64, blob []byte) (uint64, error)` (`ErrConflit{Gen}` ; palier exact exigé) ; `ChangerMdp(c, aAuth, envMdp) error` ; `EmailDebut(c, ip, actuel, nouveau, langue string) ([32]byte, error)` ; `EmailFin(c, etape, code string, aAuth [32]byte, envMdp [60]byte) error` ; `Export(c) (Export, error)` ; `Supprimer(c) (salonsFermes int, err error)` (ferme les salons par le crochet `Config.FermerSalons func(h [16]byte) (int, error)`, nil jusqu'à la Task 9 qui le branche sur `salon.Manager.FermerDuCompte` ; nil → 0 salon) ; `Effacer(now time.Time) (int, error)`.
- [ ] **Step 1 : tests** — `TestCoffrePaliers` (4/16/64/256 Kio acceptés ; 1 octet de plus, 512 Kio → 400) ; `TestCoffreConflit` ; `TestCoffre60ParHeure` ; `TestChangerMdpFermeAutres` ; `TestChangerMdpExigeRecent` ; `TestEmailAncienneAdresseExigee` ; `TestEmailNouvelleJetableRefusee` ; `TestEmailChangeEmpreintes` (connexion par la nouvelle avec le nouvel `A_auth`, l'ancienne → `ErrIdentifiants`) ; `TestEmailAvisAncienne` (faux SMTP : modèle « adresse changée » à l'ancienne) ; `TestEmailNouvelleDejaPrise` (même réponse, aucun code valable) ; `TestExportSansAdresse` (aucune empreinte, aucun champ d'adresse dans l'export) ; `TestSuppressionEfface` (lignes `comptes` et `sessions` effacées, `wal_checkpoint(TRUNCATE)`, octets de `blob` absents du fichier et du WAL après fermeture ; ligne `bannis` gardée) ; `TestInactifs13Mois` ; `TestBannisEchus3Ans`.
- [ ] **Step 2 :** `go test -race ./internal/compte/` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `go test -race ./...`, `make test-go`, `make test-e2e` → PASS.
- [ ] **Step 5 :** commit `feat(compte): coffre, mot de passe, adresse, export, suppression, effacement des inactifs`.

### Task 9 : salon ↔ compte (création, paliers, signalement, fermeture)

**Files :**
- Modify : `server/internal/salon/manager.go` (`CreerReq.Compte *[16]byte` ; `SalonsDuCompte`, `CompteDuSalon`), `server/internal/salon/reglages.go`, `server/internal/salon/fin.go` (`FermerDuCompte`), `server/internal/salon/relais.go` (`QuitterSignaler` rend le compte), `server/internal/api/handlers_salon.go`, `server/internal/api/minimize_test.go` (`X-Shh-Session` lu aussi par `handlers_salon.go`, création seulement), `server/internal/compte/service.go` (`Palier`, `Signale`)
- Test : `server/internal/salon/compte_test.go`, `server/internal/api/salon_compte_test.go`

**Interfaces :**
- Consumes : `compte.Service.Session`, `Etat`.
- Produces : `func (m *Manager) SalonsDuCompte(h [16]byte) (int, error)` (vivants) ; `func (m *Manager) CompteDuSalon(kAcces []byte) (*[16]byte, error)` ; `func (m *Manager) FermerDuCompte(h [16]byte) (int, error)` (raison « fermé par l'administrateur », WebSocket coupés, comme `DetruireAdmin`) ; `func (s *Service) Palier(h [16]byte) (Limites, error)` ; `func (s *Service) Signale(h [16]byte) error` (`compte_des` = aujourd'hui) ; réponse `409 {"error":"palier","salons":n,"places":n,"heures":n}`, `401 compte_requis`, `403 banni`.
- [ ] **Step 1 : tests** — `TestCreationSansSessionRefusee` (`SHH_COMPTES=1` : 401) ; `TestCreationSansComptesInchangee` (`SHH_COMPTES=0` : comportement actuel, aucun en-tête lu) ; `TestPalierNeuf` (2ᵉ salon vivant → 409 ; `max_members` 5 → 409 ; 4 → 201) ; `TestPalierConfirme` (horloge + 7 jours : 3 salons, 10 places ; 4ᵉ → 409) ; `TestReglagesSuiventLePalier` (places 5 sur un compte neuf → 409, sans session) ; `TestSignalementRemetAZero` ; `TestSessionJamaisLueAilleurs` (requêtes `rejoindre`, `ws`, `gestion`, `reglages`, `exclure`, `detruire`, `signaler`, `pieces` portant `X-Shh-Session` : en-tête ignoré, aucune différence de réponse) ; `TestSuppressionFermeSalons` ; `TestColonneCompteEffaceeAvecLeSalon`.
- [ ] **Step 2 :** `go test -race ./internal/salon/ ./internal/api/` → FAIL.
- [ ] **Step 3 :** implémenter ; le compte est lu dans la même transaction que le décompte des salons vivants (pas de course entre deux créations).
- [ ] **Step 4 :** `go test -race ./...`, `make test-go`, `make test-e2e` → PASS.
- [ ] **Step 5 :** commit `feat(salon): création réservée aux comptes, paliers d'ancienneté, signalement`.

### Task 10 : bannissement (tableau de bord et ligne de commande)

**Files :**
- Modify : `server/internal/adminui/adminui.go` (`Config.Bannir`, `Config.Lever`, `Config.RendreAnciennete` ; routes `POST /api/bannir`, `POST /api/lever`, `POST /api/anciennete`), `server/internal/adminui/page/{index.html,admin.js,admin.css}`, `server/cmd/shhdrop/admin.go` (`bannir -`, `lever -`), `server/cmd/shhdrop/admin_serve.go`, `server/internal/compte/bannir.go` (nouveau)
- Test : `server/internal/adminui/adminui_test.go`, `server/cmd/shhdrop/admin_serve_test.go`, `server/internal/compte/bannir_test.go`

**Interfaces :**
- Produces : `func (s *Service) Bannir(h [16]byte, now time.Time) error` (transaction : `banni = 1`, ligne `bannis` 3 ans, sessions effacées) ; `func (s *Service) Lever(email []byte) (bool, error)` (tampon effacé au retour) ; `func (s *Service) RendreAnciennete(h [16]byte) error` ; réponses fixes `{"banni":"compte","salons_fermes":n}`, `{"banni":"aucun"}`, `{"leve":true|false}`, `{"anciennete":"rendue"|"aucun"}`.
- [ ] **Step 1 : tests** — `TestBannirFermeLesSalonsOuverts` (deux salons dont un avec WebSocket ouvert : fermés, `4xxx`/raison reçue, création suivante → 403 `banni`, réinscription de la même adresse → réponse uniforme, e-mail « banni ») ; `TestBanniPeutExporterEtSupprimer` ; `TestBannirSalonSansCompte` (`aucun`) ; `TestLeverParAdresse` ; `TestPageSansAdresse` (la page et les réponses ne contiennent jamais l'adresse tapée, une empreinte ni `h` : recherche des repères dans les corps) ; `TestRefusUniforme` étendu aux nouvelles routes (jeton faux) ; `TestAdminBannirStdin`.
- [ ] **Step 2 :** `go test -race ./internal/adminui/ ./internal/compte/ ./cmd/shhdrop/` → FAIL.
- [ ] **Step 3 :** implémenter ; mêmes protections que `destroy` (tampon fixe, effacé).
- [ ] **Step 4 :** `go test -race ./...`, `make test-go`, `make test-e2e` → PASS.
- [ ] **Step 5 :** commit `feat(admin): bannir le créateur d'un salon signalé, lever un bannissement`.

### Task 11 : module de compte du site (`web/src/account/`)

**Files :**
- Create : `web/src/account/api.ts`, `web/src/account/keys.ts` (enveloppes WebCrypto, AD exactes), `web/src/account/vault.ts` (coffre `B`, JSON `v: 1`), `web/src/account/session.svelte.ts`, `web/src/account/persist.ts` (IndexedDB `shhdrop-compte`), `web/src/account/device.ts` (nom d'appareil local), `web/src/account/*.test.ts`
- Modify : `web/src/source-rules.test.ts` (`X-Shh-Session` seulement dans `web/src/account/` ; aucun `document.cookie` ; `shhdrop-compte` seulement dans `persist.ts`)

**Interfaces :**
- Consumes : Task 1 (`normaliserAdresse`, `deriverCompte`, `deriverSecours`, `cleBlob`, `cleAppareil`, `secoursEncoder`, `secoursLire`).
- Produces : `inscrire(debut: { email, langue, preuve }): Promise<{ h, etape }>` ; `confirmer(etape, code, mdp, profil: Profil, persistante): Promise<{ codeSecours: string }>` ; `seConnecter(email, mdp, persistante): Promise<"ok" | { totp: Etape }>` ; `validerTotp(etape, code)` ; `recuperer…` (trois fonctions de la conception §10.3) ; `account: { etat: "absent" | "verrouille" | "ouvert"; profil?: Profil; salons?: SalonCompte[] }` ; `ajouterSalon(sGestion: Uint8Array, libelle?: string)` ; `type Profil = { pseudo: string; photo: Uint8Array | null }` ; écriture du coffre avec `if_gen`, relecture et fusion sur 409 ; refus d'un `gen` plus petit que le plus grand vu.
- [ ] **Step 1 : tests** — `keys.test.ts` (vecteurs `enveloppes` et `coffre` de `compte.json`) ; `vault.test.ts` (aller-retour ; paliers ; 64 Ko de photo tiennent dans 256 Kio ; « deux écritures concurrentes fusionnées » ; `gen` plus petit refusé) ; `session.test.ts` (déconnexion efface `shhdrop-compte` et les clés ; « Rester connecté » décoché : rien dans IndexedDB) ; `api.test.ts` (aucune requête du module ne vise `/api/shares`, `/api/manage`, ni `/api/salons` hors `POST /api/salons`) ; `source-rules.test.ts` étendu.
- [ ] **Step 2 :** `cd web && npx vitest run src/account` → FAIL.
- [ ] **Step 3 :** implémenter (clés AES-GCM importées non extractibles, tampons mis à zéro au mieux).
- [ ] **Step 4 :** `make test-web` → PASS.
- [ ] **Step 5 :** commit `feat(site): module de compte, clés et coffre chiffrés sur l'appareil`.

### Task 12 : pages Inscription et Connexion

**Files :**
- Create : `web/src/routes/compte/Inscription.svelte`, `web/src/routes/compte/Connexion.svelte`, `web/src/ui/RecoveryCode.svelte` (affichage unique, Copier, Télécharger, confirmation des 4 derniers caractères), `web/src/ui/CodeField.svelte` (6 chiffres, `one-time-code`), `web/src/ui/AvatarPicker.svelte` (recadrage, ré-encodage 256 × 256, ≤ 64 Ko, par `web/src/media/`), tests `*.test.ts` voisins
- Modify : `web/src/app/router.svelte.ts` (`/compte`, `/compte/inscription`, `/compte/connexion`, `/compte/oubli` → routes `compte`, `inscription`, `connexion`, `oubli` ; `suite=salon` seul paramètre lu), `web/src/App.svelte`, `web/src/app/title.ts`, `web/src/app/seo.ts` (`noindex`), `web/src/i18n/fr.ts`, `web/src/i18n/en.ts`

**Interfaces :**
- Consumes : Task 11.
- Produces : clés `account.signup.*`, `account.login.*`, `account.err.*` (textes exacts de la conception §12.1, §12.2).
- [ ] **Step 1 : tests** — `router.test.ts` (quatre chemins ; `/compte/x` → 404 ; aucun secret ni adresse dans `location`) ; `Inscription.test.ts` (chaque message d'erreur exact ; focus sur le premier champ en erreur ; `autocomplete` exacts ; bouton « Renvoyer le code » actif après 60 s ; impossible de quitter l'étape du code de secours sans les 4 caractères) ; `Connexion.test.ts` (étape TOTP ; « Adresse ou mot de passe incorrect. » ; compte suspendu) ; `RecoveryCode.test.ts` ; `i18n.test.ts` (clés présentes en `fr` et `en`) ; `no-analytics.test.ts` vert.
- [ ] **Step 2 :** `cd web && npx vitest run src/routes/compte src/ui/RecoveryCode src/app/router` → FAIL.
- [ ] **Step 3 :** implémenter avec les composants existants (`TextField`, `PassphraseField`, `Button`, `Banner`, `LiveRegion`).
- [ ] **Step 4 :** `make test-web` → PASS ; `make test-ui` : captures des deux pages (clair, sombre, 360 px, 1 280 px) jointes au rapport de tâche.
- [ ] **Step 5 :** commit `feat(site): pages d'inscription et de connexion`.

### Task 13 : page Mot de passe oublié

**Files :**
- Create : `web/src/routes/compte/Oubli.svelte`, `web/src/routes/compte/Oubli.test.ts`
- Modify : `web/src/i18n/fr.ts`, `web/src/i18n/en.ts`

**Interfaces :**
- Consumes : Tasks 11, 12 (`RecoveryCode`, `CodeField`).
- [ ] **Step 1 : tests** — chemin « avec code » (contrôle local « Code mal recopié : vérifiez chaque groupe. » avant toute requête ; case « J'ai aussi perdu mon application ») ; chemin « sans code » (avertissement visible **avant** l'envoi ; champ du code TOTP seulement après `totp_requis` ; pseudo redemandé ; nouveau code de secours) ; « Code expiré. Demandez-en un nouveau. » sur `not_found` ; message « ne peut pas être récupéré » ; textes exacts §12.3.
- [ ] **Step 2 :** `cd web && npx vitest run src/routes/compte/Oubli` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `make test-web` → PASS ; captures `make test-ui`.
- [ ] **Step 5 :** commit `feat(site): récupération du compte, avec ou sans code de secours`.

### Task 14 : page Paramètres

**Files :**
- Create : `web/src/routes/compte/Parametres.svelte`, `web/src/routes/compte/sections/{Profil,Salons,Securite,Appareils,Donnees}.svelte`, `web/src/ui/TotpSetup.svelte` (QR par `web/src/qr/`, secret groupé, premier code), tests voisins
- Modify : `web/src/i18n/fr.ts`, `web/src/i18n/en.ts`

**Interfaces :**
- Consumes : Task 11 ; `GET /api/salons/gestion` par le client de salon existant (jeton de gestion `jetonGestion(sGestion)`, salon v3 §15.2).
- [ ] **Step 1 : tests** — `Parametres.test.ts` : sections dans l'ordre de la conception §12.4 ; palier et date « Dès le 21 novembre » calculés depuis `confirme_le` ; « Détruire » d'un salon avec `InlineConfirm` ; actions sensibles qui redemandent le mot de passe sur `recent` ; double authentification : activation exige un code, lien `otpauth://` sans adresse ni pseudo ; liste des appareils sans IP ni heure ; export : fichier JSON sans adresse, avec pseudo et salons ; suppression : texte avec le nombre de salons ; coffre illisible → bannière d'erreur exacte.
- [ ] **Step 2 :** `cd web && npx vitest run src/routes/compte/Parametres src/ui/TotpSetup` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `make test-web` → PASS ; captures `make test-ui`.
- [ ] **Step 5 :** commit `feat(site): paramètres du compte`.

### Task 15 : textes publics et page Confidentialité

**Files :**
- Modify : `web/src/i18n/fr.ts`, `web/src/i18n/en.ts` (clés de la conception §16 : `home.priv.account.t`, `home.priv.account.p`, `home.fact.account`, `band.2`, `demo.info`, `seo.home`, `seo.confidentialite`, `seo.conditions`, `title.landing`, `foot.tagline`, `settings.about.body`), `web/src/routes/pages/content.ts` (Confidentialité, Conditions, Sécurité), `web/src/routes/pages/content.test.ts`, `web/src/ui/limits-copy.test.ts` si une limite y est citée
- Modify (spec) : `docs/superpowers/specs/2026-11-03-shhdrop-design.md` (§9.5 lignes des nouvelles maps, §36 lignes S64 à S74, §17 renvoi), `docs/superpowers/specs/2026-11-04-shhdrop-ui-design.md` (§10, renvoi aux textes du compte)

- [ ] **Step 1 : tests** — `content.test.ts` : la page Confidentialité contient le bloc « Si vous créez un compte » (empreinte, mot de passe jamais reçu, fournisseur d'envoi nommé, durées 13 mois et 3 ans, recours) ; aucune page ne contient « ni e-mail », « No email » ni « 100 % » ; « Aucun cookie » toujours présent ; `brand.test.ts` vert.
- [ ] **Step 2 :** `cd web && npx vitest run src/routes/pages src/i18n` → FAIL.
- [ ] **Step 3 :** réécrire les textes (formulations de la conception §16 ; anglais au même sens).
- [ ] **Step 4 :** `make test-web` → PASS.
- [ ] **Step 5 :** commit `docs(site): textes publics et confidentialité pour le compte (à relire par le juriste)`.

### Task 16 : « le serveur ne voit rien » étendu au compte, parcours de bout en bout

**Files :**
- Create : `web/e2e/compte-sees-nothing.test.ts`, `web/e2e/compte-flow.test.ts`, `web/e2e/smtp.ts` (faux SMTP en TLS sur la boucle locale, certificat de test, codes lus en mémoire)
- Modify : `web/e2e/server.ts` (option `comptes`: `SHH_COMPTES=1`, fichier de clé temporaire hors du dossier de données, `SHH_SMTP_*` vers le faux SMTP)

- [ ] **Step 1 : test bloquant** `compte-sees-nothing.test.ts` : assertions exactes de la conception §14 (repères : adresse `Repere.Adresse+Zq7@Exemple.test` et ses formes, mot de passe, pseudo, photo, nom d'appareil, `A_auth`, `K_compte`, `RK`, `A_s`, secret TOTP, jeton, codes) ; dossier de données, `comptes.db` et son WAL, `shares.db`, stdout, stderr, réponses ; dates au jour ; `X-Shh-Session` absent de toute requête hors `/api/compte/*` et `POST /api/salons` ; faux SMTP sans pseudo ni mot de passe ; après suppression et arrêt, ni `h`, ni `e_canon`, ni octet de `B`. Mémoire du processus : aucun repère de clé ni de mot de passe (l'adresse y passe forcément : exclue de la fouille mémoire, comme l'adresse IP).
- [ ] **Step 2 :** `compte-flow.test.ts` : inscription → création de salon (`S_gestion` rangé) → connexion sur un « autre appareil » (nouvelle instance, stockage vide) → `S_gestion` retrouvé, rôle de créateur rendu (moteur du salon, `createurRevenu`) → mot de passe oublié avec code (salons gardés dans le coffre) → sans code (coffre vidé, ancienneté gardée) → bannissement par le tableau de bord → salon fermé, création refusée.
- [ ] **Step 3 :** `make test-e2e` → PASS (bloque toute mise en ligne).
- [ ] **Step 4 :** `make test` → PASS.
- [ ] **Step 5 :** commit `test(compte): le serveur ne voit rien, étendu au compte ; parcours complet`.

### Task 17 : déploiement (sortie SMTP seule, secrets, DNS, sauvegarde)

**Files :**
- Modify : `deploy/compose.yaml` (`SHH_COMPTES: "0"` ; secret `shh_comptes_cle` et `shh_smtp_mdp` montés en lecture seule hors de `/data` ; second réseau `sortie` non interne), `deploy/env.example` (variables SMTP, pas de secret), `deploy/deploy.sh` (règles du pare-feu : seule sortie TCP 465 vers les adresses de `SHH_SMTP_HOST`, résolution DNS par la machine ; mise à jour des adresses à chaque déploiement), `deploy/README.md` (création de la clé `head -c 32 /dev/urandom`, droits, **sauvegarde hors ligne de la clé**, SPF, DKIM, DMARC du fournisseur, copie chiffrée quotidienne de `comptes.db` par `sqlite3 … ".backup"` sur la machine puis chiffrement avant transfert ; restauration), `Makefile` (`test-sortie`)
- Create : `deploy/test-sortie.sh`

- [ ] **Step 1 : test** `deploy/test-sortie.sh` : depuis un conteneur sur le réseau `sortie` avec les mêmes règles, TCP 465 vers l'hôte SMTP de test ouvert ; TCP 443 vers un autre hôte, TCP 25, UDP 53 vers un résolveur extérieur : refusés ; le conteneur du serveur n'a toujours aucun port publié ; `make lint-deploy` vert.
- [ ] **Step 2 :** `make test-sortie`, `make test-proxy`, `make lint-deploy` → PASS.
- [ ] **Step 3 :** relecture : `SHH_COMPTES` reste à `"0"` dans `compose.yaml` (activation publique : décision D8, après le juriste) ; démo GitHub Pages sans compte (`npm run build:demo` : aucune route `/compte`).
- [ ] **Step 4 :** `make test` → PASS ; push sur `main`.
- [ ] **Step 5 :** commit `chore(deploy): sortie SMTP seule, secrets du compte, sauvegarde (compte désactivé)`.

---

## Auto-relecture (faite)

- **Couverture de la conception** : §5 (Tasks 1, 3) ; §6 et §7 (1, 11) ; §8.1 (2) ; §8.2 (2, 3) ; §8.3 (5, 6, 7) ; §8.4 (7) ; §8.5 (6) ; §8.6 (6 à 9) ; §8.7 (6, 7) ; §8.8 (5) ; §9 (11) ; §10 (12, 13, 16) ; §11 (9) ; §12 (12 à 14) ; §12.5 (4) ; §13 (10) ; §14 (15, 16) ; §15 (4, 6, 9, 11) ; §16 textes (15) — le volet juridique reste au juriste ; §17 (1, 6) ; §18 démo et DNS (17). Le bouton « Créer un salon » des écrans du salon (C-5) n'est pas ici : il appellera `ajouterSalon` et la page `/compte/connexion?suite=salon`.
- **Types** : `Adresse`, `Cles`, `Donnees`, `OptionsSession`, `Ouverture`, `Courante`, `Limites`, `EtatCompte` gardent les mêmes noms d'une tâche à l'autre ; `h` est toujours `[16]byte`, empreintes et `A_auth` `[32]byte`, enveloppes `[60]byte`.
- **Proportion** : aucune fonction écrite en entier ; valeurs fixées une fois (Global Constraints) ; textes renvoyés à la conception.
