# Compte par e-mail et mot de passe (D42-26) — conception

> **À valider par le propriétaire.** Rien n'est codé. Date : 14 novembre 2026. Remplace, pour le compte, §37 de la spécification principale (passkey sans e-mail) et la partie « compte » de D42-25. Les décisions qui lui reviennent sont en §20 (liste courte, avec recommandation).

Références lues : spécification principale (`2026-11-03-shhdrop-design.md`) D42-20 à D42-26, §9, §29.2, §33, §36, §37 (entière), §38.4, §39 ; `2026-11-11-salon-v3-design.md` §7, §15.2 ; `2026-11-13-salon-places-duree-design.md` ; `2026-11-13-tableau-de-bord-admin-design.md` ; UI `2026-11-04-shhdrop-ui-design.md` (§8, §10, §11, §12.3) ; code : `server/internal/{api,captcha,limits,store,salon,adminui,config}`, `server/internal/stats_test.go`, `server/cmd/shhdrop/main.go`, `deploy/compose.yaml`, `deploy/Dockerfile`, `web/src/{app,i18n,routes,ui,history,engine}`, `engine/`.

---

## 1. Intention

Le propriétaire veut qu'on puisse **bannir** quelqu'un qui crée des salons pour nuire, sans pister personne. Il faut donc un compte qui coûte un peu à recréer (une adresse e-mail confirmée, non jetable, plus l'ancienneté) et que le serveur peut relier aux salons créés. Tout le reste reste sans compte : partager, ouvrir un lien, rejoindre un salon.

Ce qui définit la réussite :
- créer un salon demande un compte gratuit ; rien d'autre n'en demande ;
- le serveur ne garde ni l'adresse en clair, ni le mot de passe (il ne le reçoit même pas), ni le pseudo, ni la photo ;
- un compte banni ne crée plus de salon, ses salons se ferment, et la même adresse ne peut pas en recréer un ;
- mot de passe oublié : on récupère le compte ; avec le code de secours, on garde aussi ses données chiffrées ;
- le même compte marche sur le site et, plus tard, dans les apps iOS et Android (mêmes routes, mêmes formats, vecteurs communs).

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs** : inscription (e-mail, mot de passe, pseudo, photo facultative), confirmation de l'adresse, connexion, double authentification facultative (TOTP), récupération du mot de passe, paramètres (§12.4), ancienneté et limites de création de salons, bannissement par le fondateur, rôle d'admin du salon retrouvé par le compte.

**Non-objectifs** : compte pour les partages (inchangé : sans compte) ; synchronisation de l'historique des partages (§33) ; pass payant (§38, plus tard ; le compte n'y touche pas) ; connexion par passkey (§37, abandonnée pour l'instant ; pourra s'ajouter comme second moyen) ; numéro de téléphone (exclu par le propriétaire).

**Anti-objectifs** (échec même si « ça marche ») :
- le serveur reçoit le mot de passe, ou garde une adresse e-mail en clair, même un instant sur disque (file d'attente d'un serveur de courrier, journal) ;
- une page dit si une adresse a un compte (inscription, connexion, récupération) ;
- le jeton de session part vers une route des partages ou une route du salon autre que la création ;
- un cookie, une empreinte d'appareil, une adresse IP ou un « dernier accès à telle heure » sur disque ;
- une adresse e-mail s'affiche dans le tableau de bord d'administration.

## 3. Approches envisagées

### 3.1 Mot de passe

| Approche | Pour | Contre | Retenue |
|---|---|---|---|
| **A. Argon2id sur l'appareil, le serveur ne reçoit qu'une valeur dérivée** (comme Bitwarden) : sel tiré de l'adresse normalisée, `A_auth` envoyé, gardé sous HMAC à clé du serveur | respecte CLAUDE.md (« le serveur ne reçoit jamais de mot de passe en clair ») ; la même dérivation ouvre la clé du compte ; Argon2id existe déjà dans le moteur Rust (vecteurs communs) ; aucun aller-retour pour le sel, donc aucun oracle « cette adresse existe » | sel prévisible pour qui connaît l'adresse (pré-calcul ciblé avant une fuite de la base : coût d'un Argon2id par essai, comme après la fuite) | **Oui** |
| B. Mot de passe envoyé, Argon2id sur le serveur (pratique courante) | simple | **interdit** par CLAUDE.md ; ne permet pas de chiffrer pseudo et photo par le mot de passe | Non |
| C. OPAQUE (RFC 9807, PAKE asymétrique) | le meilleur sur le papier : aucun pré-calcul possible | deux bibliothèques nouvelles (Go, Rust/wasm), peu éprouvées côté Go, module plus lourd, protocole en trois messages ; contraire à « simplicité » | Non (à revoir avec les apps si une bibliothèque Rust auditée sert aux deux) |

**Signalement (élevée, exactitude)** : D42-26 dit « mot de passe sous Argon2id ». Retenu : **Argon2id sur l'appareil** (64 Mio, 3 passes, 1 fil, comme `K_mdp`, §29.2), puis HMAC-SHA-256 à clé secrète sur le serveur. Le serveur n'exécute pas Argon2id : il ne voit qu'une sortie de 256 bits. Une fuite de la base seule (sans la clé du serveur) ne permet aucun essai hors ligne ; base **et** clé : un Argon2id complet par essai.

### 3.2 Envoi des e-mails (point 1 de la demande)

Aujourd'hui le serveur n'a **aucune** sortie : test bloquant `TestNoOutgoingHTTP` (`server/internal/stats_test.go`), conteneur sur un réseau Docker `internal: true` sans route vers Internet (`deploy/compose.yaml`), image `FROM scratch` **sans certificats racine** (`deploy/Dockerfile`, « le serveur n'ouvre aucune connexion sortante »).

| Option | Qui apprend quoi | Fiabilité | Retenue |
|---|---|---|---|
| **A. Fournisseur d'envoi tiers dans l'UE, par SMTP authentifié (port 465, TLS)** : Scaleway Transactional Email ou Brevo (France), suivi des ouvertures et des clics **désactivé** | le fournisseur : adresse du destinataire, heure, texte du message (le code), notre adresse IP d'envoi ; le fournisseur de la boîte du destinataire : qu'il reçoit un message de Shhgone (inévitable, quelle que soit l'option) | bonne (réputation, SPF/DKIM gérés) | **Oui** (recommandée) |
| B. Notre propre serveur SMTP (Postfix sur la machine, ou envoi direct aux MX depuis Go) | personne d'autre que le fournisseur de la boîte | mauvaise : IP de VPS mal réputée, port 25 souvent bloqué par l'hébergeur, PTR/SPF/DKIM/DMARC à tenir ; **Postfix écrit les adresses dans sa file et ses journaux, sur disque** (contraire à §2) ; l'envoi direct sans file n'a pas de nouvel essai | Non |
| C. Aucun e-mail (adresse jamais confirmée, récupération par code de secours seulement) | personne | — | Non : une adresse non confirmée ne coûte rien (n'importe quelle adresse Gmail inventée passe), donc le refus des jetables et le bannissement par adresse ne servent plus à rien. Cela retire la raison d'être du compte (D42-26 point 7). Si le propriétaire refuse tout tiers, un code de secours seul reste possible, mais il faut alors **abandonner le bannissement par adresse** |

Retenu : option A, par SMTP standard (bibliothèque standard de Go, `net/smtp` sur `crypto/tls`) plutôt qu'une API propre au fournisseur : changer de fournisseur ne change que la configuration. Choix du fournisseur : **décision du propriétaire** (§20, D1).

**Ce qu'il faut garder pour envoyer sans stocker l'adresse** : rien de plus qu'une empreinte. Le serveur n'écrit **jamais** à une adresse qu'il aurait gardée : il écrit à l'adresse **tapée dans la requête en cours**, si son empreinte correspond (récupération, changement d'adresse). Conséquence assumée : **aucun e-mail à l'initiative du serveur** (ni « votre compte va être effacé », ni « connexion depuis un nouvel appareil », ni lettre d'information). C'est dit à l'écran (§12).

**Exploitation (élevée)** : le conteneur doit pouvoir joindre le seul hôte SMTP du fournisseur : second réseau Docker non interne, pare-feu de la machine qui ne laisse sortir que TCP 465 vers les adresses de cet hôte (et la résolution DNS), tout le reste refusé ; certificats racine ajoutés à l'image (copiés de l'étape de construction, épinglée). Prouvé par un test de déploiement (plan, Task 17).

### 3.3 Récupération et données chiffrées (point 2)

| Approche | Retenue |
|---|---|
| **Clé de compte aléatoire `K_compte`, enveloppée deux fois** : par la clé tirée du mot de passe et par un **code de secours** affiché une fois. E-mail seul : le compte est récupéré, les données chiffrées sont perdues (dit avant de confirmer) | **Oui** |
| Tout chiffrer par le mot de passe directement | Non : changer de mot de passe obligerait à tout rechiffrer, et l'oubli perdrait tout sans recours |
| Clé de compte gardée par le serveur (récupération par e-mail sans perte) | Non : le serveur pourrait lire pseudo, photo et secrets de gestion des salons (contraire à D42-26 point 5) |

---

## 4. Ce qui change par rapport à §37 et D42-25 (vigilance)

| Gravité | Endroit | Problème | Correction |
|---|---|---|---|
| Élevée | §37.1 « passkey seule », §37.7 « Sans e-mail » | remplacés par D42-26 | §37 garde sa valeur historique ; une ligne datée en tête de §37 renvoie ici. `SHH_ACCOUNTS` de §37 n'a jamais été codé : la variable s'appelle `SHH_COMPTES` |
| Élevée | §37.4 « aucun lien au repos entre compte et partages » ; D42-25 « jetons anonymes pour que le serveur ne sache pas qui a créé quoi » | D42-26 accepte que le serveur relie un compte à ses **salons** (nécessaire au bannissement) | lien limité aux salons, effacé avec le salon (§8.2) ; **aucun** lien avec les partages : la règle de §37.4 reste entière pour eux (testée, §15) ; l'idée Privacy Pass de D42-25 est abandonnée pour la création de salon |
| Moyenne | §37.3 « session sans cookie, jeton en mémoire seulement, recharger redemande la passkey » | avec un mot de passe, redemander à chaque rechargement est pénible ; avec Argon2id, chaque connexion coûte 1 à 3 s sur téléphone | règle « sans cookie » **gardée** (elle tient : en-tête `X-Shh-Session`, utilisable tel quel par les apps) ; jeton en mémoire par défaut, case « Rester connecté sur cet appareil » (§9) |
| Moyenne | §37.2 coffre `B` (historique, réglages, pass) | le contenu change | même format d'enveloppe et de coffre (« SHH-ACCT1 »), nouveau contenu : pseudo, photo, secrets de gestion des salons, langue (§7) ; historique des partages et pass : **non** (non-objectifs) |
| Moyenne | §37.5 effacement des comptes après 13 mois | sans adresse gardée, on ne peut pas prévenir | gardé (13 mois sans connexion) ; dit dans les paramètres et la page Confidentialité |
| Faible | salon v3 §7.2 « avec un compte, photo gardée dans le coffre du compte » | cohérent | rien à changer |

---

## 5. Identifiants, normalisation, domaines jetables

### 5.1 Normalisation de l'adresse

Faite **à l'identique** par le moteur Rust (site et apps, pour le sel) et par le serveur Go (pour l'empreinte), prouvée par les vecteurs communs `engine/vectors/compte.json` rejoués en Rust natif, en WebAssembly et en Go.

1. Retirer les blancs ASCII de bord. Refuser (`adresse_invalide`) : caractère hors ASCII imprimable, plus de 254 caractères, pas exactement un `@`, partie locale vide ou de plus de 64 caractères, domaine qui n'est pas une suite d'au moins deux étiquettes de 1 à 63 caractères `[a-z0-9-]` (sans tiret en bord) avec une dernière étiquette alphabétique d'au moins 2 lettres.
2. Tout en minuscules.
3. **Adresse d'envoi** `exacte` = le résultat de 2.
4. **Adresse canonique** `canon` : partie locale coupée au premier `+` (vide après coupe → refus) ; domaine `googlemail.com` → `gmail.com` ; pour `gmail.com`, points de la partie locale retirés.

**Limite assumée (faible)** : les adresses internationalisées (accents, autres écritures) sont refusées : « Utilisez une adresse sans accent ni caractère spécial. » Le faire bien demande IDNA et SMTPUTF8 des deux côtés.

**Signalement (moyenne, sécurité)** : couper au `+` pour **tous** les domaines (demande du propriétaire) rend `lea+x@exemple.fr` et `lea@exemple.fr` identiques. Si le serveur envoyait la récupération à n'importe quelle variante tapée, un attaquant qui possède la boîte `lea+x@` chez un fournisseur qui l'autorise comme vraie boîte recevrait le code de `lea@`. **Correction retenue** : deux empreintes. `e_canon` (unicité, connexion, bannissement) et `e_envoi` (adresse exacte confirmée) ; un e-mail de récupération ne part qu'à une adresse dont l'empreinte **exacte** est celle du compte. L'écran le dit : « Entrez l'adresse exacte utilisée pour le compte. »

### 5.2 Empreintes (serveur)

Une seule clé maîtresse du serveur `K_serveur` (32 octets, fichier hors du dossier de données, §10.3) ; sous-clés HKDF-SHA-256 (`crypto/hkdf` de Go, sel vide) :

| Sous-clé | Étiquette | Usage |
|---|---|---|
| `K_email` | `shhdrop/v2/serveur/compte/email` | `e_canon` = HMAC-SHA-256(`K_email`, « canon » ‖ 0x00 ‖ `canon`) ; `e_envoi` = HMAC-SHA-256(`K_email`, « envoi » ‖ 0x00 ‖ `exacte`) |
| `K_poivre` | `shhdrop/v2/serveur/compte/mdp` | `v_mdp` = HMAC-SHA-256(`K_poivre`, `h` ‖ `A_auth`) |
| `K_totp` | `shhdrop/v2/serveur/compte/totp` | chiffre le secret TOTP (§8.3) |

Pourquoi une clé et pas SHA-256 : une adresse se devine (annuaire, fuite d'une autre base) ; sans clé, lire la base dirait qui a un compte. Avec la clé hors de la base, une copie volée de `comptes.db` ne dit rien.

**Signalements (élevée, exploitation)** : (a) perdre `K_serveur` **perd tous les comptes** (plus aucune adresse ne retrouve son compte, plus aucun mot de passe ne se vérifie) : sauvegarde hors ligne obligatoire, comme le jeton d'administration ; (b) aucune rotation possible sans les adresses en clair (une rotation demanderait que chacun se reconnecte : non prévu) ; (c) qui vole la machine en marche a la clé et la base : il peut alors tester des adresses une par une.

### 5.3 Domaines jetables

- Liste embarquée dans le binaire (`go:embed`), tirée du projet public `disposable-email-domains` (licence CC0, à revérifier), avec la date de la copie dans un commentaire et dans `THIRD_PARTY_LICENSES.md`.
- Un domaine est refusé s'il figure dans la liste **ou** s'il est un sous-domaine d'un domaine de la liste. Vérifié sur le domaine canonique, à l'inscription et au changement d'adresse.
- **Mise à jour** : manuelle, avec la mise à jour mensuelle des dépendances (`docs/superpowers/plans/maj-dependances-*.md`), par un script qui télécharge la liste sur le poste du développeur, montre le nombre de lignes ajoutées et retirées, et l'écrit dans le dépôt ; jamais de téléchargement par le serveur (aucune sortie hors SMTP). Plus une liste locale `jetables-ajouts.txt` pour les domaines vus par le fondateur.
- Pas de vérification DNS (MX) : elle demanderait une sortie DNS du serveur et ne prouve rien.
- Erreur affichée tout de suite (elle ne révèle rien sur une personne) : « Les adresses jetables ne sont pas acceptées. »

---

## 6. Modèle cryptographique du compte (appareil)

Aucune construction maison : Argon2id et HKDF-SHA-256 du moteur Rust (RustCrypto), AES-256-GCM de WebCrypto sur le site (RustCrypto `aes-gcm` dans les apps), aléa de `crypto.getRandomValues`. Mêmes résultats prouvés par `engine/vectors/compte.json` (nonces fixés dans les vecteurs).

| Élément | Création | Où il vit |
|---|---|---|
| `h` | 16 octets tirés par le serveur à `inscription/debut` | serveur (clé de la ligne), appareil |
| `sel` | SHA-256(« shhdrop/v2/compte/sel » ‖ 0x00 ‖ `canon`)[0..16] | calculé, jamais stocké |
| `M` | Argon2id(mot de passe NFC, `sel`, 64 Mio, 3 passes, 1 fil, 32 octets) ; blancs ASCII de bord retirés avant NFC (règle de D42-21) | mémoire, le temps du calcul |
| `A_auth` | HKDF(`M`, info = « shhdrop/v2/compte/auth », 32) | envoyé au serveur (connexion, changements) |
| `KEK_mdp` | HKDF(`M`, info = « shhdrop/v2/compte/enveloppe-mdp », 32) → AES-256-GCM | mémoire |
| `K_compte` | 32 octets aléatoires, tirés à l'inscription (et à une récupération par e-mail seul) | mémoire de la page ; IndexedDB enveloppée si « Rester connecté » (§9) |
| `Env_mdp` | nonce (12) ‖ AES-256-GCM(`KEK_mdp`, nonce, `K_compte`, AD = « SHH-CENV1 » ‖ `h` ‖ « mdp ») = 60 octets | serveur |
| `RK` | code de secours : 32 octets aléatoires, montrés une fois en 53 caractères (13 groupes de 4 en base32 Crockford + 1 caractère de contrôle mod 37, alphabet `0-9A-Z*~$=U`, saisie normalisée : majuscules, espaces et tirets retirés, `I`/`L` → `1`, `O` → `0` ; repris de §37.1 et A-G6) | chez l'utilisateur seulement |
| `A_s` | HKDF(`RK`, info = « shhdrop/v2/compte/secours/acces », 32) | envoyé à la récupération par code |
| `v_s` | SHA-256(`A_s`) | serveur |
| `KEK_s`, `Env_s` | HKDF(`RK`, « shhdrop/v2/compte/secours/enveloppe ») ; enveloppe de `K_compte`, AD = « SHH-CENV1 » ‖ `h` ‖ « secours » | mémoire ; `Env_s` sur le serveur |
| `K_blob` | HKDF(`K_compte`, « shhdrop/v2/compte/blob ») | mémoire |
| `B` | coffre de §37.2 inchangé (« SHH-ACCT1 » ‖ `gen` ‖ nonce ‖ AES-256-GCM, AD = « SHH-ACCT1 » ‖ `h` ‖ `gen`) ; paliers **4, 16, 64, 256 Kio** (plafond 256 Kio : la photo fait 64 Ko au plus) | serveur |
| `K_etiquette` | HKDF(`K_compte`, « shhdrop/v2/compte/appareil ») | mémoire ; chiffre le nom d'appareil d'une session (§9.3) |

- Pourquoi un sel tiré de l'adresse : aucune requête « donne-moi le sel de cette adresse » (qui dirait si l'adresse existe, ou demanderait un faux sel stable) ; le client calcule tout seul. Changer d'adresse change le sel : le client recalcule `A_auth` et `Env_mdp` avec le mot de passe, qu'il demande alors (§12.4).
- Pourquoi HKDF et pas Argon2id pour `RK` : 256 bits aléatoires (même règle que §37.2).
- Mot de passe : **10 caractères au moins** (comme le mot de passe d'un partage, §31), 256 au plus ; refusé s'il est égal à l'adresse ou à sa partie locale. Pas de liste de mots de passe connus téléchargée (aucune ressource tierce) ; un indicateur de longueur seulement.

## 7. Contenu du coffre de compte `B`

JSON strict (`v: 1`), chiffré, jamais vu par le serveur :
- `pseudo` : **obligatoire**, mêmes règles que le pseudonyme du salon (§39.4 point 4 : NFC, 2 à 24 graphèmes, une seule écriture…). Le serveur ne peut pas vérifier qu'il est rempli : c'est le client qui l'exige (limite honnête, faible) ;
- `photo` : facultative, ré-encodée sur l'appareil en 256 × 256, 64 Ko au plus, sans métadonnées (salon v3 §7.2) ;
- `salons` : `[{ s_gestion, ajoute: "2026-11-14", libelle }]` (libellé local facultatif) ; **ni** le lien d'invitation, **ni** le mot de passe du salon (le propriétaire a demandé le secret de gestion seulement ; garder l'invitation ferait du mot de passe du compte une clé de lecture des conversations) ; une entrée est retirée quand `gestion` répond `not_found` ;
- `reglages` : `{ langue }`.

Écritures concurrentes et retour en arrière : règles de §37.2 inchangées (`if_gen`, 409, fusion ; plus grand `gen` vu gardé sur l'appareil).

À l'entrée d'un salon, le pseudo et la photo du compte sont **proposés** (préremplis, modifiables pour ce salon), puis envoyés aux membres par le canal chiffré du salon comme aujourd'hui (message `profil`). Le serveur ne les voit jamais.

---

## 8. Serveur

### 8.1 Activation et configuration

- `SHH_COMPTES=0|1` (défaut **0**). À 0 : aucune route `/api/compte/*` (même 404 qu'une route inconnue) et la création de salon reste sans compte (comportement actuel). À 1 : `POST /api/salons` exige une session.
- `SHH_COMPTES_CLE_FILE` : chemin d'un fichier de 32 octets exactement, droits 0400 ou 0600, **hors** de `SHH_DATA_DIR` (refus au démarrage sinon) ; obligatoire avec `SHH_COMPTES=1`.
- `SHH_COMPTES_MAX` (défaut 10 000) : comptes au plus (503 `busy` au-delà).
- `SHH_SMTP_HOST`, `SHH_SMTP_PORT` (défaut 465, TLS implicite ; `587` STARTTLS accepté ; texte clair refusé sauf hôte de boucle locale, pour les tests), `SHH_SMTP_USER`, `SHH_SMTP_PASSWORD_FILE` (fichier, jamais la valeur en variable), `SHH_MAIL_FROM` (`Shhgone <ne-pas-repondre@shhgone.com>`) : obligatoires avec `SHH_COMPTES=1`.

### 8.2 Ce que garde le disque

Base séparée `comptes.db` (mêmes règles que `shares.db` : `secure_delete=ON`, `temp_store=MEMORY`, `journal_size_limit=0`, WAL vidé après chaque effacement, 0600, `WITHOUT ROWID`). Contrairement à `shares.db`, **elle doit survivre aux redémarrages et être sauvegardée** (§20, D6).

| Table | Colonnes | Pourquoi |
|---|---|---|
| `comptes` | `h` BLOB(16) clé ; `e_canon` BLOB(32) unique ; `e_envoi` BLOB(32) ; `v_mdp` BLOB(32) ; `env_mdp` BLOB(60) ; `v_s` BLOB(32) ; `env_s` BLOB(60) ; `blob` BLOB (palier exact) ; `gen` INTEGER ; `totp` BLOB(48) NULL ; `cree_jour` INTEGER ; `compte_des` INTEGER ; `vu_mois` INTEGER ; `banni` INTEGER 0/1 | connexion, unicité, enveloppes, coffre, double authentification, ancienneté, effacement des inactifs, bannissement |
| `sessions` | `t_v` BLOB(32) clé (SHA-256 du jeton) ; `sid` BLOB(16) unique (identifiant montré dans la liste) ; `h` ; `etiquette` BLOB NULL (nom d'appareil chiffré par `K_etiquette`, 64 octets fixes) ; `cree_mois` INTEGER ; `expire_jour` INTEGER ; `persistante` 0/1 | liste des appareils, déconnexion d'un appareil ou de tous |
| `bannis` | `e_canon` BLOB(32) clé ; `jusqu_jour` INTEGER | une adresse bannie ne recrée pas de compte, même après suppression |

Dates : `cree_jour`, `compte_des` (jour depuis lequel court l'ancienneté, §11), `expire_jour`, `jusqu_jour` = **minuit UTC du jour** ; `vu_mois`, `cree_mois` = **premier du mois, minuit UTC**. Aucune heure. `vu_mois` est mis à jour au plus une fois par mois.

Dans `shares.db`, table `salons` : **colonne `compte` BLOB(16) NULL** (schéma 3) et index `salons_compte`. C'est le lien compte ↔ salons de D42-26 (signalement a) : il disparaît avec la ligne du salon (fin, destruction, échéance). Aucune colonne commune avec `shares` ; aucun lien vers les partages.

**Jamais sur disque** : adresse e-mail (claire ou normalisée), mot de passe, `A_auth`, `M`, `K_compte`, `RK`, `A_s`, codes envoyés par e-mail, codes TOTP, secret TOTP en clair, jeton de session en clair, pseudo, photo, adresse IP, en-têtes, heure d'une connexion.

### 8.3 En mémoire seulement

| État | Clé | Durée |
|---|---|---|
| Inscriptions en attente : `e_canon`, `e_envoi`, code (SHA-256), essais restants | SHA-256 de l'étape (jeton de 32 octets) | 15 min, perdu au redémarrage |
| Codes de récupération et de changement d'adresse | idem | 15 min |
| Étape « double authentification » d'une connexion | idem | 5 min |
| Échecs de connexion par compte, envois d'e-mail par adresse | `e_canon` | l'heure, le jour |
| Dernier pas TOTP accepté (rejeu) | `h` | 90 s ; perdu au redémarrage (limite : un code peut resservir dans les 90 s qui suivent un redémarrage) |
| Dernier usage d'une session (inactivité) et « session récente » | `t_v` | 2 h ; 5 min |

Chaque table (map) s'ajoute à la liste justifiée de `server/internal/stats_test.go` (`allowedMaps`) et à §9.5.

### 8.4 Double authentification (TOTP)

- RFC 6238 : SHA-1, 6 chiffres, 30 s, tolérance ±1 pas ; bibliothèque **`github.com/pquerna/otp`** (Apache-2.0), version exacte épinglée, publiée depuis au moins 7 jours (§24), notée dans `THIRD_PARTY_LICENSES.md`, `govulncheck` vert. **Signalement (faible, chaîne d'approvisionnement)** : elle tire `github.com/boombuler/barcode` (image QR) que nous n'utilisons pas (le QR est dessiné par le site, `web/src/qr/`) ; revue de chaîne d'approvisionnement à la Task 7 ; si elle est refusée, aucune autre voie sans dépendance n'est retenue (pas de TOTP maison).
- Secret : 20 octets tirés par le serveur (`crypto/rand`) à `totp/debut`, rendu une fois au client en base32 ; gardé chiffré : `totp` = nonce (12) ‖ AES-256-GCM(`K_totp`, nonce, secret, AD = « SHH-TOTP1 » ‖ `h`) ; jamais rendu ensuite.
- Lien d'ajout : `otpauth://totp/Shhgone?secret=…&issuer=Shhgone&algorithm=SHA1&digits=6&period=30`, construit par le client et montré en QR et en texte. **Aucune adresse ni pseudo dans le libellé** (l'application d'authentification se synchronise souvent dans un nuage).
- Activation : il faut un premier code juste. Désactivation : session récente.
- Rejeu : un pas déjà accepté pour ce compte est refusé.
- **Perte du téléphone** : le code de secours ouvre le compte sans code TOTP (§10.3) et propose de retirer la double authentification. Sans téléphone ni code de secours : compte **irrécupérable** (une remise à zéro par e-mail exige le code TOTP, sinon la double authentification ne protégerait pas d'un vol de la boîte mail) ; il s'efface après 13 mois sans connexion, puis l'adresse peut resservir (si elle n'est pas bannie). Dit à l'activation.
- Pas de liste de dix codes de secours propres à la double authentification : le code de secours unique (`RK`) les remplace (une seule chose à ranger).

### 8.5 Sessions

- Jeton de 32 octets (`crypto/rand`), rendu en base64url (43 caractères), envoyé dans l'en-tête **`X-Shh-Session`** ; aucun cookie (la règle de §37.3 tient : pas de CSRF, rien d'envoyé de lui-même, les apps l'utilisent tel quel).
- Le jeton ne part **que** vers `/api/compte/*` et `POST /api/salons` ; jamais vers `/api/shares/*`, `/api/manage/*`, ni les autres routes du salon (le créateur s'y présente par son jeton de gestion, comme aujourd'hui). Test de sources (site) et test de bout en bout.
- Durées : session simple : **2 h sans usage, et au plus jusqu'à la fin du jour UTC suivant** ; « Rester connecté » : **30 jours sans usage, 90 jours au plus**, puis mot de passe redemandé. `expire_jour` est reculé au plus une fois par jour. Inactivité suivie en mémoire (un redémarrage la remet à zéro, sans prolonger le plafond).
- **Session récente** : celle qui vient d'une connexion ou d'un `reauth` (mot de passe, et code TOTP si actif) il y a moins de **5 min**. Exigée pour : mot de passe, adresse, double authentification, nouveau code de secours, suppression du compte.
- Liste des appareils : `sid`, mois d'ajout, nom d'appareil **chiffré par le client** (« Firefox · ordinateur », calculé sur l'appareil, jamais vu en clair par le serveur), « cet appareil », « reste connecté ». Ni adresse IP, ni pays, ni heure, ni empreinte.
- Changement de mot de passe, récupération, bannissement, suppression : **toutes les autres sessions sont fermées** (case « Déconnecter mes autres appareils » cochée et grisée pour la récupération).

### 8.6 Routes

Toutes sous `/api/compte/` ; JSON strict (§8 : clés exactes, sans doublon, corps ≤ 4 Kio sauf `blob`) ; secrets en base64url sans bourrage de longueur exacte (`h` 22, jeton, étape, `a_auth`, `a_s`, `v_s` 43, enveloppes 80) ; jamais rien dans l'URL. Erreurs fixes : `bad_request` (400), `identifiants` (403, même corps pour adresse inconnue, mot de passe faux, compte inexistant), `preuve_requise` (403), `code_faux` (403, avec `attempts_left`), `totp_requis` (403), `recent` (403), `not_found` (404, étape inconnue ou échue), `conflict` (409, avec `gen`), `jetable` (400), `adresse_invalide` (400), `mdp_faible` (400), `limit` (429, `Retry-After`), `busy` (503), `banni` (403). Les objets n'ont aucun champ facultatif ambigu (absent ≠ `null` : `null` refusé sauf mention).

| Route | Authentification | Corps | Réponse |
|---|---|---|---|
| `POST inscription/debut` | anti-robot ALTCHA (mêmes champs que `POST /api/shares`) | `{ email, langue, altcha, hp, shown_at }` | `{ h, etape }` — **toujours la même forme**, que l'adresse soit libre, prise ou bannie (§8.7) |
| `POST inscription/renvoyer` | étape | `{ etape }` | `{}` (au plus 1 par minute, 3 par jour et par adresse) |
| `POST inscription/fin` | étape + code | `{ etape, code, a_auth, env_mdp, v_s, env_s, blob, persistante, etiquette }` | 201 `{ session }` |
| `POST connexion` | — (preuve ALTCHA après 5 échecs dans l'heure sur ce compte : réponse 403 `preuve_requise`, puis même corps avec `altcha, hp, shown_at`) | `{ email, a_auth, persistante, etiquette }` | `{ session, h, env_mdp, blob, gen }` ou `{ totp_requis: true, etape }` |
| `POST connexion/totp` | étape | `{ etape, code }` | `{ session, h, env_mdp, blob, gen }` |
| `POST secours/debut` | — | `{ email, a_s }` | `{ etape, h, env_s }` |
| `POST secours/fin` | étape | `{ etape, a_auth, env_mdp, v_s, env_s, retirer_totp, persistante, etiquette }` | `{ session, blob, gen }` |
| `POST oubli/debut` | ALTCHA | `{ email, langue, altcha, hp, shown_at }` | `{ etape }` (toujours) |
| `POST oubli/verifier` | étape + code | `{ etape, code, totp }` (`totp` : chaîne vide si inactif) | `{ h }` |
| `POST oubli/fin` | étape vérifiée | `{ etape, a_auth, env_mdp, v_s, env_s, blob, persistante, etiquette }` | `{ session }` (`gen` continue ; ancien coffre écrasé) |
| `POST reauth` | session | `{ a_auth, totp }` | `{}` (session récente) |
| `GET /api/compte` | session | — | `{ h, cree_le: "2026-11-14", palier: "neuf"|"confirme", confirme_le: "2026-11-21"|null, limites: { salons, places, heures }, salons_actifs, totp, banni }` |
| `GET blob` / `PUT blob` | session | `{ if_gen, blob }` | comme §37.11.1 |
| `POST mdp` | session récente | `{ a_auth, env_mdp }` | `{}` (autres sessions fermées) |
| `POST email/debut` | session récente | `{ email_actuel, email_nouveau, langue }` | `{ etape }` (`email_actuel` doit avoir l'empreinte d'envoi du compte, sinon `identifiants`) |
| `POST email/fin` | session récente + étape | `{ etape, code, a_auth, env_mdp }` | `{}` |
| `POST totp/debut` | session récente | `{}` | `{ etape, secret }` |
| `POST totp/fin` | session récente + étape | `{ etape, code }` | `{}` |
| `POST totp/retirer` | session récente | `{}` | `{}` |
| `POST secours/renouveler` | session récente | `{ v_s, env_s }` | `{}` |
| `GET sessions` | session | — | `{ sessions: [{ sid, ajoutee: "2026-11", etiquette, courante, persistante }] }` |
| `POST sessions/fermer` | session | `{ sid }` ou `{ autres: true }` | `{}` |
| `POST deconnexion` | session | `{}` | `{}` |
| `GET export` | session | — | données du serveur (§12.4) |
| `POST supprimer` | session récente | `{}` | `{ salons_fermes }` |

Salon (`server/internal/api/handlers_salon.go`), avec `SHH_COMPTES=1` :
- `POST /api/salons` : `X-Shh-Session` exigé (sinon 401 `compte_requis`) ; compte banni : 403 `banni` ; au-delà du palier : 409 `{"error":"palier","salons":1,"places":4,"heures":24}` ; sinon création comme aujourd'hui, colonne `compte` remplie. Anti-robot et quotas par connexion inchangés.
- `POST /api/salons/reglages` (places, renouvellement) : limites du palier du compte du salon (lu par la ligne, sans session).
- `POST /api/salons/signaler` : au premier signalement d'un salon, `compte_des` du créateur = aujourd'hui (§11).

### 8.7 Ne jamais dire si une adresse a un compte

- `inscription/debut` rend toujours `{ h, etape }` et met toujours un e-mail en file. Adresse libre : code. Adresse déjà inscrite : « Quelqu'un (peut-être vous) a voulu créer un compte avec cette adresse. Vous en avez déjà un : connectez-vous, ou utilisez « Mot de passe oublié ». » Adresse bannie : « Cette adresse ne peut pas créer de compte Shhgone. » Dans les deux derniers cas, aucun code n'est valable : `inscription/fin` répond `code_faux`. L'écran dit toujours « Si cette adresse peut être utilisée, nous venons de vous envoyer un code. »
- `oubli/debut` rend toujours `{ etape }` ; l'e-mail ne part que si `e_envoi` correspond à un compte.
- `connexion` : adresse inconnue et mot de passe faux donnent le même `identifiants`, après le même calcul (HMAC sur une valeur factice).
- Les e-mails partent d'une **file en mémoire** (256 au plus, un envoi à la fois, 20 s de délai, un nouvel essai) : la durée de la réponse ne dépend pas de l'envoi. File pleine : 503 `busy`.

### 8.8 Anti-abus

| Quoi | Limite |
|---|---|
| Anti-robot | ALTCHA (`server/internal/captcha`, difficulté partagée) sur `inscription/debut` et `oubli/debut` ; repli reCAPTCHA (§26) quand il existera |
| Inscriptions | 3 par jour par connexion, 10 par /48 (§37.5) ; `SHH_COMPTES_MAX` |
| E-mails | 3 par jour et par adresse (`e_canon`), 10 par jour par connexion ; renvoi après 60 s |
| Codes e-mail | 6 chiffres, 15 min, **5 essais** par code (puis l'étape meurt) |
| Connexion | 20 échecs par heure par connexion, 60 par /48 ; par compte : au-delà de 5 échecs dans l'heure, la connexion à ce compte exige une preuve ALTCHA (jamais de verrouillage du compte, qui permettrait de bloquer quelqu'un) |
| TOTP | 5 essais par étape ; 10 échecs par heure par compte, puis 429 pour ce compte pendant l'heure |
| Code de secours | 10 essais par heure par connexion, 5 par compte |
| Coffre | `B` ≤ 256 Kio ; 60 écritures par heure par compte |
| Sessions | 20 par compte au plus (la plus ancienne non courante est fermée) |

Tous ces compteurs passent par `server/internal/limits` (clés HMAC du jour pour les connexions, aucune adresse gardée) et par la liste `allowedMaps`.

---

## 9. Sur l'appareil (site)

- Module `web/src/account/` seul détenteur du jeton et de `K_compte` (règle de §37.3) : `api.ts`, `keys.ts`, `vault.ts`, `session.svelte.ts`, `persist.ts`.
- Par défaut : jeton et `K_compte` **en mémoire** ; un rechargement redemande le mot de passe.
- **« Rester connecté sur cet appareil »** (case **décochée** par défaut, §20 D7) : jeton et `K_compte` enveloppés par une clé AES-GCM **non extractible** de WebCrypto, dans IndexedDB `shhdrop-compte`. Même protection honnête que l'historique (§33) : elle ne vaut que le verrouillage de l'appareil. Texte sous la case : « À éviter sur un appareil partagé. »
- Déconnexion : le serveur oublie la session ; l'appareil efface `shhdrop-compte`, `K_compte`, `K_blob` et le clair du coffre. Les entrées de l'historique local (`web/src/history/`) ne sont pas touchées.
- Argon2id dans un Worker (`web/src/engine/argon2.ts`, comme aujourd'hui) ; l'écran montre « Vérification… » pendant le calcul.

## 10. Parcours

### 10.1 Inscription

1. Page `/compte/inscription` (§12.1). Le client normalise l'adresse (moteur) et refuse tout de suite une adresse invalide.
2. `inscription/debut` (preuve ALTCHA calculée pendant la saisie, comme pour un partage). Réponse : `h`, `etape`. L'écran passe à « Entrez le code reçu ». Aucune clé n'existe encore à ce moment : le repli reCAPTCHA (§26, « jamais sur une page qui détient des clés ») reste possible ici, à condition que `K_compte` ne soit tirée qu'après (étape 3) ; sur `oubli/debut`, idem.
3. Pendant que la personne lit son e-mail : Argon2id, `A_auth`, `KEK_mdp` ; tirage de `K_compte` et `RK` ; `Env_mdp`, `Env_s`, `v_s` ; coffre `B` (pseudo, photo).
4. Code tapé → `inscription/fin`. Le serveur vérifie le code, crée `comptes` (le compte n'existe sur disque **qu'après** confirmation) et une session.
5. Écran du **code de secours** (affichage unique, Copier, Télécharger en `.txt`, case « Je l'ai rangé en lieu sûr », saisie des 4 derniers caractères) ; il ne peut pas être sauté (§20 D2). Fermer la page avant : le compte existe, le code est perdu ; les paramètres montrent « Code de secours à refaire » en tête.
6. « Compte créé. » → retour à la page d'où l'on venait (création de salon le plus souvent).

### 10.2 Connexion

`/compte/connexion` : adresse et mot de passe → Argon2id → `connexion`. Si `totp_requis` : champ du code → `connexion/totp`. Puis `K_compte` ← `Env_mdp`, coffre ouvert.

### 10.3 Mot de passe oublié

`/compte/oubli` commence par une question : « Avez-vous votre code de secours ? »
- **Oui** : adresse + code de secours (contrôlé sur l'appareil) → `secours/debut` → `K_compte` ← `Env_s` → nouveau mot de passe → **nouveau** code de secours (l'ancien a servi) → `secours/fin`. Case « J'ai aussi perdu mon application d'authentification » (retire la double authentification). **Rien n'est perdu.**
- **Non** : avertissement avant tout envoi : « Sans code de secours, votre pseudo, votre photo et la gestion de vos salons enregistrée dans le compte seront effacés : ils sont chiffrés avec votre mot de passe actuel. Votre compte, son ancienneté et vos salons en cours sont gardés. » → adresse exacte → `oubli/debut` → code (et code TOTP si actif) → `oubli/verifier` → nouveau mot de passe, nouveau `K_compte`, nouveau code de secours, coffre vide (pseudo redemandé) → `oubli/fin`. Les salons en cours restent ouverts ; leur gestion revient par l'historique local de l'appareil qui les a créés, ou par le lien de gestion s'il a été gardé.

### 10.4 Créer un salon

Bouton « Créer un salon » sans session → `/compte/connexion?suite=salon` (paramètre de chemin interne seulement, aucune donnée). Avec session : création comme aujourd'hui avec `X-Shh-Session` ; puis `S_gestion` ajouté au coffre (`PUT blob`). Refus `palier` : « Votre compte est récent : 1 salon à la fois, 4 places, 24 h. Dès le 21 novembre : 3 salons à la fois et 10 places. »

---

## 11. Ancienneté et limites

| Palier | Condition | Salons vivants à la fois | Places (`max_members`, créateur compris) | Durée |
|---|---|---|---|---|
| **Neuf** | moins de 7 jours depuis `compte_des` | 1 | 4 | 1 à 24 h |
| **Confirmé** | 7 jours ou plus depuis `compte_des` | 3 | 10 | 1 à 24 h |

- `compte_des` = jour de création ; **remis au jour d'un signalement** d'un salon du compte (« Quitter et signaler », premier signalement de ce salon). « 7 jours sans signalement » = 7 jours pleins depuis le dernier signalement.
- **Signalement (faible, ambiguïté)** : « 4 places » est lu comme `max_members = 4`, créateur compris (le serveur compte ainsi, 2 à 10). Si le propriétaire voulait 4 invités, c'est `max_members = 5`.
- **Signalement (moyenne, abus)** : un invité malveillant peut remettre l'ancienneté du créateur à zéro en signalant à chaque salon. C'est borné (il doit être invité ; un signalement par salon) ; le fondateur peut aussi rendre l'ancienneté depuis le tableau de bord (§13). Choix à confirmer (§20, D4).
- Le renouvellement d'un salon compte déjà comme une création (quota de connexion) ; il garde les limites du palier.
- Le payant (§38) ajoutera de la capacité plus tard ; rien ici ne le suppose.

## 12. Écrans

Style du site (UI §2 à §8) : `AppShell`, colonne centrée de 28 rem au plus, `TextField`, `PassphraseField` (afficher ou masquer), `Button` (`primary`, `secondary`, `ghost`), `Banner` (`info`, `warn`, `error`), `InlineConfirm`, `CopyField`, `Switch`, `Sheet`, `QrCode`, `LiveRegion`. Textes en français ci-dessous ; anglais dans `en.ts` avec les mêmes clés (`account.*`). Aucune adresse ni pseudo dans le titre de l'onglet ni dans l'adresse de la page. `robots: noindex` sur toutes les pages `/compte/*`.

Règles communes (accessibilité, §19 et UI §11) : chaque champ a une étiquette visible ; `autocomplete` exact (`email`, `new-password`, `current-password`, `one-time-code` avec `inputmode="numeric"`) ; le collage n'est jamais bloqué ; erreur reliée au champ (`aria-describedby`, `aria-invalid`) et focus sur le premier champ en erreur ; message global dans une `LiveRegion` ; aucun délai qui efface un message ; bouton désactivé seulement pendant l'envoi, avec texte « Vérification… » ; tout se fait au clavier ; contrastes des jetons existants.

### 12.1 Inscription (`/compte/inscription`)

Titre « Créer un compte ». Sous-titre : « Un compte gratuit sert seulement à créer des salons. Partager et rejoindre restent sans compte. »
Champs : Adresse e-mail ; Mot de passe (indice : « 10 caractères au moins ») ; Pseudo (indice : « Vu par les membres de vos salons. Nous ne le voyons pas. ») ; Photo de profil (facultative : « Ajouter une photo », recadrage carré, aperçu, « Retirer ») ; case obligatoire « J'ai au moins 15 ans et j'accepte les conditions d'utilisation » (lien) ; bouton « Recevoir un code ». Lien « J'ai déjà un compte ».
Étape 2 : « Nous venons d'envoyer un code à 6 chiffres à l'adresse indiquée, si elle peut être utilisée. » ; champ Code ; « Créer le compte » ; « Renvoyer le code » (actif après 60 s, compte à rebours lu par la région vivante une seule fois) ; « Modifier l'adresse ».
Étape 3 : code de secours (§10.1, 5) : « Votre code de secours. Il remplace votre mot de passe et votre application d'authentification si vous les perdez. Nous ne pouvons pas le retrouver pour vous. Il ne sera plus affiché. »

Erreurs exactes :
- adresse : « Adresse e-mail invalide. » ; « Utilisez une adresse sans accent ni caractère spécial. » ; « Les adresses jetables ne sont pas acceptées. »
- mot de passe : « Au moins 10 caractères. » ; « Le mot de passe ne doit pas être votre adresse. »
- pseudo : messages de §39.4 (« 2 à 24 caractères », « Une seule écriture à la fois »…).
- case : « Cochez cette case pour continuer. »
- code : « Code incorrect. Il reste {n} essais. » ; « Code expiré. Demandez-en un nouveau. »
- `limit` : « Trop de tentatives. Réessayez dans {durée}. » ; `busy` : « Les inscriptions sont momentanément fermées. Réessayez plus tard. »
- réseau : « Connexion perdue. Vérifiez votre réseau et réessayez. »

### 12.2 Connexion (`/compte/connexion`)

Titre « Se connecter ». Champs : Adresse e-mail, Mot de passe ; case « Rester connecté sur cet appareil » (indice : « À éviter sur un appareil partagé. ») ; « Se connecter ». Liens : « Mot de passe oublié ? », « Créer un compte ».
Étape TOTP : « Code de votre application d'authentification » (6 chiffres) ; « Valider » ; lien « Je n'ai plus mon application » → parcours du code de secours.
Erreurs : « Adresse ou mot de passe incorrect. » ; « Code incorrect. » ; « Ce code a déjà servi. Attendez le suivant. » ; `limit` comme ci-dessus ; « Ce compte est suspendu : il ne peut plus créer de salon. Vous pouvez toujours exporter ou supprimer vos données. » (connexion permise, §13).

### 12.3 Mot de passe oublié (`/compte/oubli`)

Question « Avez-vous votre code de secours ? » (deux boutons `secondary` : « Oui, j'ai mon code », « Non »).
- Avec code : Adresse e-mail ; Code de secours (53 caractères, groupés à l'affichage) ; contrôle local : « Code mal recopié : vérifiez chaque groupe. » ; serveur : « Adresse ou code de secours incorrect. » ; puis Nouveau mot de passe, case « J'ai aussi perdu mon application d'authentification », nouveau code de secours.
- Sans code : `Banner warn` du texte de §10.3 ; Adresse e-mail exacte (indice : « L'adresse exacte utilisée pour le compte, avec ses éventuels « + » et points. ») ; « Recevoir un code » → « Si un compte utilise cette adresse, nous venons de lui envoyer un code. » ; Code ; Code de l'application (si demandé : « Ce compte a la double authentification : entrez aussi le code de votre application. ») ; Nouveau mot de passe ; Pseudo ; nouveau code de secours.
- Sans code ni application avec double authentification : « Sans code de secours ni application d'authentification, ce compte ne peut pas être récupéré. Il sera effacé après 13 mois sans connexion ; l'adresse pourra alors resservir. »

### 12.4 Paramètres (`/compte`, connecté ; sinon redirection vers la connexion)

Sections, dans cet ordre :
1. **Profil** : photo (changer, retirer), pseudo (modifier) ; « Votre pseudo et votre photo sont chiffrés sur cet appareil. Ils ne sont envoyés qu'aux membres de vos salons. »
2. **Salons** : palier et limites (« Compte créé le 14 novembre 2026. Récent : 1 salon à la fois, 4 places, 24 h. Dès le 21 novembre : 3 salons, 10 places. » ou « Confirmé : 3 salons à la fois, 10 places, 24 h. ») ; salons en cours (`salons_actifs`, puis la liste du coffre : libellé, temps restant par `GET /api/salons/gestion`, « Détruire » avec `InlineConfirm`) ; « La gestion d'un salon créé sur un autre appareil revient ici automatiquement. »
3. **Sécurité** : Mot de passe (« Changer ») ; Adresse e-mail (« Changer » : adresse actuelle, nouvelle adresse, code reçu à la nouvelle, mot de passe ; un avis part à l'ancienne adresse) ; Double authentification (`Switch` ; activation : QR, secret en texte groupé par 4 avec Copier, champ du premier code ; texte « Si vous perdez ce téléphone, seul votre code de secours vous rendra l'accès. ») ; Code de secours (« Créer un nouveau code » : l'ancien ne sert plus).
4. **Appareils** : liste (§8.5), « Déconnecter » par ligne, « Déconnecter tous les autres appareils ».
5. **Langue** : sélecteur existant ; gardée aussi dans le coffre.
6. **Vos données** : « Exporter mes données » (fichier JSON fait sur l'appareil : données du serveur de `GET export` — jours de création et d'ancienneté, double authentification oui/non, appareils au mois, nombre de salons, mois de dernière connexion — plus pseudo, photo et liste des salons déchiffrés ; la note dit : « Votre adresse n'y figure pas : nous ne la gardons pas en clair. ») ; « Sans connexion pendant 13 mois, ce compte est effacé. Nous ne pouvons pas vous prévenir : nous n'avons pas votre adresse. »
7. **Se déconnecter**.
8. **Supprimer le compte** (`Button` danger) : `InlineConfirm` « Supprimer définitivement votre compte ? Vos {n} salons en cours seront fermés pour tous leurs membres. Cette action ne peut pas être annulée. » (mot de passe redemandé si la session n'est pas récente). Après : « Compte supprimé. » Une adresse bannie reste bannie.

Le pseudo, la photo et la liste des salons ne s'affichent qu'une fois le coffre ouvert ; avant : squelette `aria-busy`. Coffre illisible (mauvaise clé, `gen` plus petit que le dernier vu) : `Banner error` « Vos données chiffrées ne s'ouvrent pas sur cet appareil. Reconnectez-vous. »

### 12.5 E-mails (texte brut, langue choisie à l'envoi, aucun lien de suivi, aucune image)

- Objet « Votre code Shhgone » ; corps : « Votre code : 123 456. Il expire dans 15 minutes. Si vous n'avez rien demandé, ignorez ce message : rien n'a été créé. — Shhgone ne vous demandera jamais votre mot de passe. »
- Adresse déjà inscrite, adresse bannie, avis de changement d'adresse : textes de §8.7 et « L'adresse de votre compte Shhgone vient d'être remplacée. Si ce n'est pas vous, utilisez « Mot de passe oublié » avec votre code de secours. »
- Jamais de lien cliquable dans le code (le code se tape : même parcours pour le site et les apps, aucune page piégée imitable par un lien).

---

## 13. Bannissement (fondateur)

- **Entrée** : le fondateur colle, dans le tableau de bord (`server/internal/adminui`) ou dans `shhdrop admin bannir -` (entrée standard), le **lien d'invitation** d'un salon signalé (`#c<43>`, comme pour « Détruire »). Le serveur retrouve le salon par `access_v`, puis son `compte`.
- **Effet**, dans une transaction : `comptes.banni = 1`, `bannis(e_canon, jusqu_jour)`, sessions du compte fermées, puis chaque salon `WHERE compte = h` détruit (raison existante « fermé par l'administrateur »), WebSocket coupés. Réponse : `{"banni":"compte","salons_fermes":2}` ; salon sans compte (créé avant `SHH_COMPTES=1`) : `{"banni":"aucun"}` et le salon peut être détruit à part. **Aucune adresse, aucun pseudo, aucun identifiant affiché.**
- Le compte banni peut encore se connecter pour **exporter et supprimer** ses données (RGPD) ; il ne crée plus de salon.
- **Durée** : 3 ans (`jusqu_jour`), puis la ligne `bannis` est effacée (§20, D3). Un compte supprimé ou effacé pour inactivité ne lève pas le bannissement.
- **Recours** : par l'adresse de contact des mentions légales ; la personne donne son adresse ; le fondateur la tape dans « Lever un bannissement » (tableau de bord ou `shhdrop admin lever -`) : le serveur calcule l'empreinte, retire la ligne `bannis` et `banni = 0` si le compte existe. Réponse : « levé » ou « aucun » ; l'adresse n'est gardée nulle part.
- **Rendre l'ancienneté** (signalement abusif) : même entrée par lien de salon, `compte_des` remis à `cree_jour`.
- **Limite (basse, D42-26 d)** : un banni peut créer une autre adresse ; freins : adresse confirmée non jetable, anti-robot, 3 inscriptions par jour par connexion, palier « neuf ».
- **Partages** : non bannissables (aucun compte) ; inchangé (destruction par lien).

## 14. Ce que voit le serveur (complète §36)

| # | Ce qu'il voit ou peut déduire | Exposition | Réduction | État |
|---|---|---|---|---|
| S64 | **Adresse e-mail en clair** | dans la requête (inscription, connexion, récupération, changement), puis en mémoire jusqu'à l'envoi | jamais écrite ; empreintes `e_canon`, `e_envoi` à clé ; file d'envoi en mémoire ; texte clair oublié après envoi (effacement de la mémoire au mieux : chaînes Go) | À faire |
| S65 | **Fournisseur d'envoi** | adresse, heure, code, IP du serveur | fournisseur dans l'UE, suivi désactivé, contrat de sous-traitance ; aucun e-mail à l'initiative du serveur | À faire (D1) |
| S66 | **Mot de passe** | jamais reçu ; `A_auth` reçu à chaque connexion | `v_mdp` = HMAC à clé ; Argon2id sur l'appareil | À faire |
| S67 | **Existence d'un compte et ses dates** | `cree_jour`, `compte_des` au jour ; `vu_mois` au mois | jours et mois seulement, aucune heure | À faire |
| S68 | **Compte ↔ salons créés** | colonne `salons.compte`, le temps de vie du salon ; en direct : l'adresse IP qui crée | nécessaire au bannissement (D42-26 a) ; effacé avec le salon ; jamais vers les partages | Assumé |
| S69 | **Nombre de salons d'un compte, palier, signalements** | déductibles de `compte_des` et des lignes `salons` | — | Assumé |
| S70 | **Double authentification** | activée ou non ; secret chiffré par `K_totp` ; codes en direct | secret jamais rendu ; dernier pas en mémoire | À faire |
| S71 | **Sessions** | nombre par compte, mois d'ajout, « reste connecté », usage en direct | aucun nom d'appareil en clair, aucune IP, aucune heure | À faire |
| S72 | **Coffre de compte** | taille au palier, nombre d'écritures en direct | paliers 4 à 256 Kio | À faire |
| S73 | **Liste des bannis** | empreintes `e_canon`, échéance au jour | effacée après 3 ans | À faire |
| S74 | **Lien en direct compte ↔ partages** | même adresse IP qui se connecte puis crée un partage | le jeton de session ne part jamais vers les partages ; reste visible en direct (§18.18), impossible sans Tor | Assumé |

**Le test « le serveur ne voit rien » s'étend** (bloquant, `web/e2e/compte-sees-nothing.test.ts`) : inscription avec une adresse repère (avec majuscules, points et `+`), mot de passe, pseudo, photo et nom d'appareil repères, double authentification activée, salon créé et `S_gestion` rangé, connexion, récupération par code, changement d'adresse, suppression. Il exige : aucun repère (adresse brute, minuscule, canonique, en base64 et base64url ; mot de passe ; `A_auth` ; `K_compte` ; `RK` ; `A_s` ; secret TOTP ; jeton de session ; pseudo ; photo ; nom d'appareil ; codes reçus) dans `comptes.db`, son WAL, `shares.db`, le dossier de données, stdout, stderr, ni une réponse (sauf le secret TOTP dans la seule réponse de `totp/debut`) ; toutes les dates de `comptes.db` multiples de 86 400 ; aucune requête vers `/api/shares/*`, `/api/manage/*` ni `/api/salons/*` (sauf `POST /api/salons`) qui porte `X-Shh-Session` ; le faux serveur SMTP du test n'a reçu ni pseudo ni mot de passe ; après suppression puis arrêt : ni `h`, ni `e_canon`, ni octet de `B` dans les fichiers.

## 15. Tests bloquants à étendre

- `server/internal/stats_test.go` : `TestNoOutgoingHTTP` garde son interdiction partout sauf `internal/courriel/smtp.go` (seul fichier qui ouvre une connexion, vers `SHH_SMTP_HOST` seulement) ; ajouter `smtp.Dial`, `smtp.SendMail`, `tls.Dial`, `tls.Dialer` à la liste des appels interdits ailleurs ; nouvelles lignes de `allowedMaps`.
- `server/internal/api/minimize_test.go` : `X-Shh-Session` ajouté à la liste blanche des en-têtes lus, seulement par `handlers_compte.go` et `handlers_salon.go` (création).
- `web/src/source-rules.test.ts` : `X-Shh-Session` n'apparaît que dans `web/src/account/` ; aucun `document.cookie`.
- `server/internal/store` : schéma de `comptes.db` exact (tables, colonnes, index), rien d'autre ; `salons` a exactement une colonne de plus.
- `web/src/no-analytics.test.ts` : inchangé, doit rester vert (aucune ressource tierce sur les pages du compte).

## 16. Cadre légal (pour le juriste)

| Sujet | Proposition | Gravité |
|---|---|---|
| **LCEN art. 6 et décret 2021-1362** | Un hébergeur doit conserver, quand il les collecte, les données de création de compte (identifiant, pseudonymes, adresse e-mail…) et, selon les cas, les données de connexion (IP) pendant 1 an. Collecter une adresse, même pour l'empreinte, peut faire entrer Shhgone dans cette obligation, **en contradiction directe** avec « adresse jamais gardée » et « aucune IP sur disque ». **Avis du juriste avant `SHH_COMPTES=1` en public.** | Élevée |
| Base légale | Compte : exécution du contrat (RGPD art. 6.1.b). Bannissement, liste des bannis, limites anti-abus : intérêt légitime (art. 6.1.f), avec mise en balance écrite | Moyenne |
| Durées | Compte : jusqu'à suppression, ou 13 mois sans connexion ; sessions : 90 jours au plus ; bannis : 3 ans ; codes : 15 min, en mémoire ; e-mails chez le fournisseur : durée de ses journaux (à obtenir par contrat, la plus courte possible) | Moyenne |
| Une empreinte est-elle une donnée personnelle ? | **Oui** (pseudonymisation, RGPD considérant 26 : nous détenons la clé). Le registre et la politique doivent la traiter comme telle ; ne jamais écrire « nous n'avons aucune donnée personnelle » | Moyenne |
| Registre (art. 30) | Traitements : compte ; envoi d'e-mails (sous-traitant) ; bannissement ; sessions | Moyenne |
| Sous-traitant (art. 28) | Contrat de sous-traitance avec le fournisseur d'envoi ; hébergement des données dans l'UE ; liste de ses sous-traitants | Moyenne |
| Droits | Accès et portabilité : export (§12.4) ; effacement : suppression immédiate (lignes effacées, WAL vidé) ; rectification : pseudo, photo, adresse ; opposition au bannissement : recours (§13). L'adresse n'étant pas gardée, une demande d'accès « par adresse » se traite en la tapant dans l'outil de recours (même calcul) | Moyenne |
| Mineurs | France : 15 ans pour le consentement (loi Informatique et libertés art. 45) ; la base est le contrat, mais un salon expose à des inconnus : case « J'ai au moins 15 ans » proposée ; DSA art. 28 (protection des mineurs) à examiner | Moyenne |
| AIPD | Pas obligatoire a priori (pas de traitement à grande échelle de données sensibles), recommandée à cause du bannissement (décision sur une personne) | Faible |
| ePrivacy | Aucun cookie ; « Rester connecté » range un jeton à la demande expresse de l'utilisateur (exemption « strictement nécessaire ») | Faible |

**Textes du site à reformuler** (la promesse « ni e-mail » devient fausse pour qui crée un salon) :

| Fichier : clé | Aujourd'hui | Proposé (FR ; EN à l'identique) |
|---|---|---|
| `fr.ts` / `en.ts` : `home.priv.account.p` | « Ni e-mail, ni téléphone. Votre adresse IP n'est jamais écrite sur disque. » | « Aucun compte pour partager ou rejoindre. Pour créer un salon, une adresse e-mail que nous ne gardons pas en clair. Votre adresse IP n'est jamais écrite sur disque. » |
| `home.priv.account.t`, `home.fact.account`, `band.2` | « Sans compte » | « Partage sans compte » |
| `demo.info` | « … · aucun compte » | « … · sans compte pour partager » |
| `seo.home`, `title.landing`, `foot.tagline`, `seo.conditions` | « sans compte » | « sans compte pour partager » (titre : « Partage chiffré de bout en bout, sans compte ») — le titre et le slogan peuvent rester s'ils ne parlent que du partage : à relire une à une |
| `seo.confidentialite` | « aucun compte » | « aucun compte pour partager, adresse e-mail jamais gardée en clair, … » |
| `settings.about.body` | « Sans compte, sans traceur… » | « Sans compte pour partager, sans traceur… » |
| `content.ts` : Confidentialité, `lede` et bloc « Ce que nous gardons » (FR l. 115, 121 ; EN l. 286, 292) | « Sans compte… » ; « Rien de cela ne contient votre nom, votre adresse e-mail… » | lede : « Sans compte pour envoyer, recevoir ou rejoindre un salon. » ; nouveau bloc « Si vous créez un compte (pour créer des salons) » : empreinte de l'adresse, mot de passe jamais reçu, pseudo et photo chiffrés, dates au jour, lien compte ↔ salons, liste des bannis, fournisseur d'envoi nommé, durées, droits, recours |
| `content.ts` : Conditions | — | âge minimal, bannissement et recours, effacement après 13 mois |
| `content.ts` : Sécurité | — | « Ce que le compte ne protège pas » : qui a votre mot de passe a votre pseudo, votre photo et la gestion de vos salons ; e-mail reçu par votre fournisseur ; lien compte ↔ salons |
| Maquettes en cours (habillage) | « Sans compte » | à reprendre de la même façon |

« Aucun cookie » reste vrai et reste écrit.

## 17. Apps natives (D42-20)

- Mêmes routes JSON, en-tête `X-Shh-Session`, aucun cookie, aucun CORS, aucune redirection ; aucun lien à cliquer dans les e-mails (codes à taper) : rien ne dépend du navigateur.
- Normalisation, sel, Argon2id, HKDF, enveloppes, code de secours, coffre `B` : dans le moteur Rust, rejoués par `engine/vectors/compte.json` ; l'app range jeton et `K_compte` dans le trousseau du système (Keychain, Keystore) au lieu d'IndexedDB.
- Seul point propre au site : la clé non extractible de WebCrypto pour « Rester connecté » (équivalent natif : trousseau). Photo : ré-encodage par l'app avec les mêmes bornes (256 × 256, 64 Ko).

## 18. Signalements supplémentaires (vigilance)

| Gravité | Endroit | Problème | Correction |
|---|---|---|---|
| Élevée | ordre des chantiers | les écrans du salon (C-3, C-5) ne sont pas faits : « Créer un salon » n'a pas encore de bouton | le compte se code d'abord côté serveur et pages du compte ; le branchement « Créer un salon » se fait avec C-5 ; `SHH_COMPTES=1` n'a de sens qu'avec `SHH_SALONS=1` (refus au démarrage sinon) |
| Élevée | double authentification | une remise à zéro par e-mail sans code TOTP la rendrait inutile | `oubli/verifier` exige le code TOTP (§8.4) |
| Moyenne | « Rester connecté » | un script injecté lirait le jeton | CSP stricte et Trusted Types existants ; décochée par défaut |
| Moyenne | inscription | bombardement d'e-mails vers une victime | ALTCHA, 3 e-mails par adresse et par jour |
| Moyenne | réputation | des e-mails Shhgone dans une boîte trahissent l'usage du service (D42-26 b) | objet neutre « Votre code Shhgone » ; inévitable ; dit dans la politique |
| Moyenne | DNS | sans SPF, DKIM, DMARC, les codes finissent en indésirables | enregistrements du fournisseur ajoutés au domaine (plan, Task 17) |
| Faible | démo GitHub Pages | aucun serveur | compte désactivé dans la démo (comme §37) |
| Faible | `pquerna/otp` | dépendance de plus | revue de chaîne d'approvisionnement ; épinglée |
| Inutile, retiré | §37 : passkey, PRF, rechiffrement, appareils WebAuthn | trop complexe pour le besoin actuel | non repris ; la passkey pourra venir plus tard comme second moyen de connexion |

## 19. Laissé au constructeur

Découpage interne des paquets ; forme exacte des tests au-delà des noms et assertions du plan ; ordre des sections du coffre JSON ; libellés anglais (relus par le propriétaire avec le reste de `en.ts`).

## 20. Décisions du propriétaire (recommandation)

1. **D1 — Fournisseur d'e-mail** : un fournisseur d'envoi dans l'UE par SMTP (Scaleway Transactional Email ou Brevo), suivi désactivé, contrat de sous-traitance. Sans e-mail du tout, le bannissement par adresse ne vaut plus rien. **Recommandé : Scaleway TEM** (France, SMTP standard).
2. **D2 — Code de secours obligatoire à l'inscription** (affiché une fois, à confirmer par ses 4 derniers caractères). **Recommandé : oui** ; sans lui, un mot de passe oublié efface pseudo, photo et gestion des salons.
3. **D3 — Durée du bannissement** : **recommandé : 3 ans**, levable sur recours par le fondateur.
4. **D4 — Un signalement remet l'ancienneté à zéro automatiquement** (un invité malveillant peut en abuser). **Recommandé : oui**, avec « Rendre l'ancienneté » dans le tableau de bord.
5. **D5 — Supprimer son compte ferme ses salons en cours** (sinon des salons sans responsable bannissable). **Recommandé : oui**, dit avant de confirmer.
6. **D6 — Sauvegarde de `comptes.db`** (aujourd'hui rien n'est sauvegardé ; une machine réinitialisée perdrait tous les comptes) : **recommandé : copie chiffrée quotidienne hors de la machine**, clé du serveur gardée à part, hors ligne.
7. **D7 — « Rester connecté »** : **recommandé : proposé, décoché par défaut**, 30 jours sans usage, 90 jours au plus.
8. **D8 — Ouverture au public** : **recommandé : `SHH_COMPTES=1` seulement après l'avis du juriste** sur la conservation des données de création de compte (LCEN, décret 2021-1362), qui pourrait contredire « adresse jamais gardée » et « aucune IP sur disque ».
