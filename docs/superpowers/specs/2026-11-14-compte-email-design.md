# Compte par e-mail et mot de passe (D42-26) — conception

> **Révision 2 du 14 novembre 2026 (décisions du propriétaire du même jour, 11 points) : §21, à lire en premier.** Elle remplace le code de secours par une récupération par e-mail sans perte du profil, et ajoute pseudo unique, profil, accueil connecté, téléchargements, signalements par catégorie, suppression totale, sauvegarde et le tableau de bord finalisé. Les passages remplacés plus bas sont barrés ou annotés « → §21 ».
>
> **À valider par le propriétaire.** Rien n'est codé. Date : 14 novembre 2026. Remplace, pour le compte, §37 de la spécification principale (passkey sans e-mail) et la partie « compte » de D42-25. Les décisions qui lui reviennent sont en §20 (liste courte, avec recommandation).

Références lues : spécification principale (`2026-11-03-shhdrop-design.md`) D42-20 à D42-26, §9, §29.2, §33, §36, §37 (entière), §38.4, §39 ; `2026-11-11-salon-v3-design.md` §7, §15.2 ; `2026-11-13-salon-places-duree-design.md` ; `2026-11-13-tableau-de-bord-admin-design.md` ; UI `2026-11-04-shhdrop-ui-design.md` (§8, §10, §11, §12.3) ; code : `server/internal/{api,captcha,limits,store,salon,adminui,config}`, `server/internal/stats_test.go`, `server/cmd/shhdrop/main.go`, `deploy/compose.yaml`, `deploy/Dockerfile`, `web/src/{app,i18n,routes,ui,history,engine}`, `engine/`.

---

## 1. Intention

Le propriétaire veut qu'on puisse **bannir** quelqu'un qui crée des salons pour nuire, sans pister personne. Il faut donc un compte qui coûte un peu à recréer (une adresse e-mail confirmée, non jetable, plus l'ancienneté) et que le serveur peut relier aux salons créés. Tout le reste reste sans compte : partager, ouvrir un lien, rejoindre un salon.

Ce qui définit la réussite :
- créer un salon demande un compte gratuit ; rien d'autre n'en demande ;
- le serveur ne garde ni l'adresse en clair, ni le mot de passe (il ne le reçoit même pas), ~~ni le pseudo, ni la photo~~ ; → §21.2, §21.5 (14 novembre) : le pseudo n'est gardé qu'en empreinte à clé ; pseudo, photo et abonnement sont dans un coffre **séquestré**, que le serveur peut rouvrir (c'est ce qui permet la récupération par e-mail sans perte) ;
- un compte banni ne crée plus de salon, ses salons se ferment, et la même adresse ne peut pas en recréer un ;
- ~~mot de passe oublié : on récupère le compte ; avec le code de secours, on garde aussi ses données chiffrées ;~~ → §21.2 (14 novembre, révision 2) : mot de passe oublié : on récupère le compte par e-mail avec son pseudo, sa photo, son abonnement, son ancienneté et ses salons en cours ; seuls les secrets chiffrés par le mot de passe (gestion des salons, liens reçus, salons rejoints, partages créés) sont perdus, sauf s'ils sont encore sur un de ses appareils ;
- le même compte marche sur le site et, plus tard, dans les apps iOS et Android (mêmes routes, mêmes formats, vecteurs communs).

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs** (complétés le 14 novembre, §21 : pseudo unique, profil, accueil connecté, historique des téléchargements, signalements par catégorie, suppression totale, sauvegarde, tableau de bord finalisé) : inscription (e-mail, mot de passe, pseudo, photo facultative), confirmation de l'adresse, connexion, double authentification facultative (TOTP), récupération du mot de passe, paramètres (§12.4), ancienneté et limites de création de salons, bannissement par le fondateur, rôle d'admin du salon retrouvé par le compte.

**Non-objectifs** : compte pour les partages (inchangé : sans compte) ; ~~synchronisation de l'historique des partages (§33)~~ (14 novembre, §21.8 : l'historique de l'appareil se synchronise dans le coffre privé) ; pass payant (§38, plus tard ; ~~le compte n'y touche pas~~ 14 novembre : le pass pourra être rangé dans le coffre de profil séquestré, §21.2, R5) ; connexion par passkey (§37, abandonnée pour l'instant ; pourra s'ajouter comme second moyen) ; numéro de téléphone (exclu par le propriétaire).

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

> **→ §21.2 (14 novembre, révision 2)** : le code de secours est abandonné (décision 1 du propriétaire). Le tableau ci-dessous est gardé pour l'historique ; la ligne « Clé de compte gardée par le serveur » est **en partie retenue** pour le profil seulement (séquestre), avec ses limites dites en §21.2.

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
| ~~`RK`~~ | ~~code de secours : 32 octets aléatoires, montrés une fois en 53 caractères (13 groupes de 4 en base32 Crockford + 1 caractère de contrôle mod 37, alphabet `0-9A-Z*~$=U`, saisie normalisée : majuscules, espaces et tirets retirés, `I`/`L` → `1`, `O` → `0` ; repris de §37.1 et A-G6)~~ | ~~chez l'utilisateur seulement~~ → §21.2 (code de secours retiré, 14 novembre) |
| ~~`A_s`~~ | ~~HKDF(`RK`, info = « shhdrop/v2/compte/secours/acces », 32)~~ | ~~envoyé à la récupération par code~~ → §21.2 (code de secours retiré, 14 novembre) |
| ~~`v_s`~~ | ~~SHA-256(`A_s`)~~ | ~~serveur~~ → §21.2 (code de secours retiré, 14 novembre) |
| ~~`KEK_s`, `Env_s`~~ | ~~HKDF(`RK`, « shhdrop/v2/compte/secours/enveloppe ») ; enveloppe de `K_compte`, AD = « SHH-CENV1 » ‖ `h` ‖ « secours »~~ | ~~mémoire ; `Env_s` sur le serveur~~ → §21.2 (code de secours retiré, 14 novembre) |
| `K_blob` | HKDF(`K_compte`, « shhdrop/v2/compte/blob ») | mémoire |
| `B` | coffre de §37.2 inchangé (« SHH-ACCT1 » ‖ `gen` ‖ nonce ‖ AES-256-GCM, AD = « SHH-ACCT1 » ‖ `h` ‖ `gen`) ; paliers **4, 16, 64, 256 Kio** (plafond 256 Kio : la photo fait 64 Ko au plus) | serveur |
| `K_etiquette` | HKDF(`K_compte`, « shhdrop/v2/compte/appareil ») | mémoire ; chiffre le nom d'appareil d'une session (§9.3) |

- Pourquoi un sel tiré de l'adresse : aucune requête « donne-moi le sel de cette adresse » (qui dirait si l'adresse existe, ou demanderait un faux sel stable) ; le client calcule tout seul. Changer d'adresse change le sel : le client recalcule `A_auth` et `Env_mdp` avec le mot de passe, qu'il demande alors (§12.4).
- Pourquoi HKDF et pas Argon2id pour `RK` : 256 bits aléatoires (même règle que §37.2).
- Mot de passe : **10 caractères au moins** (comme le mot de passe d'un partage, §31), 256 au plus ; refusé s'il est égal à l'adresse ou à sa partie locale. Pas de liste de mots de passe connus téléchargée (aucune ressource tierce) ; un indicateur de longueur seulement.

## 7. Contenu du coffre de compte `B`

> **→ §21.2 et §21.5 (14 novembre, révision 2)** : `B` devient le **coffre privé** `B_prive` (secrets, chiffrés par le mot de passe seulement) ; pseudo, photo, langue et abonnement passent dans un **coffre de profil** `B_profil`, séquestré. Le texte ci-dessous est gardé pour l'historique.

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

> **→ §21.6 (14 novembre, révision 2)** : schéma révisé (colonnes du code de secours retirées ; séquestre, pseudo, deux coffres, attente après récupération, bannis avec identifiant, état et motif). Le tableau ci-dessous est l'ancien schéma.

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
- ~~**Perte du téléphone** : le code de secours ouvre le compte sans code TOTP (§10.3) et propose de retirer la double authentification.~~ → §21.2.4 (14 novembre) : retrait par e-mail après 7 jours d'attente, annulable. Sans téléphone ni code de secours : compte **irrécupérable** (une remise à zéro par e-mail exige le code TOTP, sinon la double authentification ne protégerait pas d'un vol de la boîte mail) ; il s'efface après 13 mois sans connexion, puis l'adresse peut resservir (si elle n'est pas bannie). Dit à l'activation.
- ~~Pas de liste de dix codes de secours propres à la double authentification : le code de secours unique (`RK`) les remplace (une seule chose à ranger).~~ (14 novembre : plus de code de secours ; §21.2.4.)

### 8.5 Sessions

- Jeton de 32 octets (`crypto/rand`), rendu en base64url (43 caractères), envoyé dans l'en-tête **`X-Shh-Session`** ; aucun cookie (la règle de §37.3 tient : pas de CSRF, rien d'envoyé de lui-même, les apps l'utilisent tel quel).
- Le jeton ne part **que** vers `/api/compte/*` et `POST /api/salons` ; jamais vers `/api/shares/*`, `/api/manage/*`, ni les autres routes du salon (le créateur s'y présente par son jeton de gestion, comme aujourd'hui). Test de sources (site) et test de bout en bout.
- Durées : session simple : **2 h sans usage, et au plus jusqu'à la fin du jour UTC suivant** ; « Rester connecté » : **30 jours sans usage, 90 jours au plus**, puis mot de passe redemandé. `expire_jour` est reculé au plus une fois par jour. Inactivité suivie en mémoire (un redémarrage la remet à zéro, sans prolonger le plafond).
- **Session récente** : celle qui vient d'une connexion ou d'un `reauth` (mot de passe, et code TOTP si actif) il y a moins de **5 min**. Exigée pour : mot de passe, adresse, double authentification, nouveau code de secours, suppression du compte.
- Liste des appareils : `sid`, mois d'ajout, nom d'appareil **chiffré par le client** (« Firefox · ordinateur », calculé sur l'appareil, jamais vu en clair par le serveur), « cet appareil », « reste connecté ». Ni adresse IP, ni pays, ni heure, ni empreinte.
- Changement de mot de passe, récupération, bannissement, suppression : **toutes les autres sessions sont fermées** (case « Déconnecter mes autres appareils » cochée et grisée pour la récupération).

### 8.6 Routes

> **→ §21.6.2 (14 novembre, révision 2)** : routes `secours/*` retirées, `blob` remplacé par deux coffres, routes `pseudo`, `salons` et attente de la double authentification ajoutées ; `inscription/fin`, `connexion`, `oubli/*`, `email/*`, `supprimer` modifiées.

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

> **→ §21.3 (14 novembre, révision 2)** : plus aucun e-mail « déjà inscrit », « banni » ni « adresse changée » (décision 2 : rien d'autre qu'un code dans un e-mail). Le même e-mail, avec seulement un code, part dans tous les cas ; l'état de l'adresse n'est dit qu'**à l'écran**, après le code juste. Le premier point ci-dessous est remplacé.

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
5. ~~Écran du **code de secours** (affichage unique, Copier, Télécharger en `.txt`, case « Je l'ai rangé en lieu sûr », saisie des 4 derniers caractères) ; il ne peut pas être sauté (§20 D2). Fermer la page avant : le compte existe, le code est perdu ; les paramètres montrent « Code de secours à refaire » en tête.~~ (retiré le 14 novembre, §21.2)
6. « Compte créé. » → retour à la page d'où l'on venait (création de salon le plus souvent).

### 10.2 Connexion

`/compte/connexion` : adresse et mot de passe → Argon2id → `connexion`. Si `totp_requis` : champ du code → `connexion/totp`. Puis `K_compte` ← `Env_mdp`, coffre ouvert.

### 10.3 Mot de passe oublié

> **→ §21.2.3 (14 novembre, révision 2)** : un seul parcours, par e-mail ; le texte ci-dessous est gardé pour l'historique.

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

> **→ §21.15.6 (14 novembre).** Remplacé.

Question « Avez-vous votre code de secours ? » (deux boutons `secondary` : « Oui, j'ai mon code », « Non »).
- Avec code : Adresse e-mail ; Code de secours (53 caractères, groupés à l'affichage) ; contrôle local : « Code mal recopié : vérifiez chaque groupe. » ; serveur : « Adresse ou code de secours incorrect. » ; puis Nouveau mot de passe, case « J'ai aussi perdu mon application d'authentification », nouveau code de secours.
- Sans code : `Banner warn` du texte de §10.3 ; Adresse e-mail exacte (indice : « L'adresse exacte utilisée pour le compte, avec ses éventuels « + » et points. ») ; « Recevoir un code » → « Si un compte utilise cette adresse, nous venons de lui envoyer un code. » ; Code ; Code de l'application (si demandé : « Ce compte a la double authentification : entrez aussi le code de votre application. ») ; Nouveau mot de passe ; Pseudo ; nouveau code de secours.
- Sans code ni application avec double authentification : « Sans code de secours ni application d'authentification, ce compte ne peut pas être récupéré. Il sera effacé après 13 mois sans connexion ; l'adresse pourra alors resservir. »

### 12.4 Paramètres (`/compte`, connecté ; sinon redirection vers la connexion)

> **→ §21.15.3 et §21.15.4 (14 novembre)** : profil et paramètres complets. Remplacé.

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

> **→ §21.3 (14 novembre)** : un seul modèle, le code seul. Le deuxième point ci-dessous est retiré.

- Objet « Votre code Shhgone » ; corps : « Votre code : 123 456. Il expire dans 15 minutes. Si vous n'avez rien demandé, ignorez ce message : rien n'a été créé. — Shhgone ne vous demandera jamais votre mot de passe. »
- Adresse déjà inscrite, adresse bannie, avis de changement d'adresse : textes de §8.7 et « L'adresse de votre compte Shhgone vient d'être remplacée. Si ce n'est pas vous, utilisez « Mot de passe oublié » avec votre code de secours. »
- Jamais de lien cliquable dans le code (le code se tape : même parcours pour le site et les apps, aucune page piégée imitable par un lien).

---

## 13. Bannissement (fondateur)

> **→ §21.11 et §21.14 (14 novembre, révision 2)** : durée modifiable (suspendre, réactiver, allonger, raccourcir, lever, annuler), identifiant de bannissement sans adresse, bannissement depuis la liste des salons signalés, motif (catégorie). L'entrée par lien et le recours par adresse restent.

- **Entrée** : le fondateur colle, dans le tableau de bord (`server/internal/adminui`) ou dans `shhdrop admin bannir -` (entrée standard), le **lien d'invitation** d'un salon signalé (`#c<43>`, comme pour « Détruire »). Le serveur retrouve le salon par `access_v`, puis son `compte`.
- **Effet**, dans une transaction : `comptes.banni = 1`, `bannis(e_canon, jusqu_jour)`, sessions du compte fermées, puis chaque salon `WHERE compte = h` détruit (raison existante « fermé par l'administrateur »), WebSocket coupés. Réponse : `{"banni":"compte","salons_fermes":2}` ; salon sans compte (créé avant `SHH_COMPTES=1`) : `{"banni":"aucun"}` et le salon peut être détruit à part. **Aucune adresse, aucun pseudo, aucun identifiant affiché.**
- Le compte banni peut encore se connecter pour **exporter et supprimer** ses données (RGPD) ; il ne crée plus de salon.
- **Durée** : 3 ans (`jusqu_jour`), puis la ligne `bannis` est effacée (§20, D3). Un compte supprimé ou effacé pour inactivité ne lève pas le bannissement.
- **Recours** : par l'adresse de contact des mentions légales ; la personne donne son adresse ; le fondateur la tape dans « Lever un bannissement » (tableau de bord ou `shhdrop admin lever -`) : le serveur calcule l'empreinte, retire la ligne `bannis` et `banni = 0` si le compte existe. Réponse : « levé » ou « aucun » ; l'adresse n'est gardée nulle part.
- **Rendre l'ancienneté** (signalement abusif) : même entrée par lien de salon, `compte_des` remis à `cree_jour`.
- **Limite (basse, D42-26 d)** : un banni peut créer une autre adresse ; freins : adresse confirmée non jetable, anti-robot, 3 inscriptions par jour par connexion, palier « neuf ».
- **Partages** : non bannissables (aucun compte) ; inchangé (destruction par lien).

## 14. Ce que voit le serveur (complète §36)

> **→ §21.16 (14 novembre)** : S66, S72 et S73 changent ; S75 à S82 ajoutées.

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

> **→ §21.19 (14 novembre, révision 2)** : D2 est caduque (plus de code de secours) ; D3 tranchée (3 ans, modifiable) ; D5 étendue (suppression totale) ; D6 tranchée (sauvegarde) ; D1, D4, D7, D8 restent ouvertes.

1. **D1 — Fournisseur d'e-mail** : un fournisseur d'envoi dans l'UE par SMTP (Scaleway Transactional Email ou Brevo), suivi désactivé, contrat de sous-traitance. Sans e-mail du tout, le bannissement par adresse ne vaut plus rien. **Recommandé : Scaleway TEM** (France, SMTP standard).
2. **D2 — Code de secours obligatoire à l'inscription** (affiché une fois, à confirmer par ses 4 derniers caractères). **Recommandé : oui** ; sans lui, un mot de passe oublié efface pseudo, photo et gestion des salons.
3. **D3 — Durée du bannissement** : **recommandé : 3 ans**, levable sur recours par le fondateur.
4. **D4 — Un signalement remet l'ancienneté à zéro automatiquement** (un invité malveillant peut en abuser). **Recommandé : oui**, avec « Rendre l'ancienneté » dans le tableau de bord.
5. **D5 — Supprimer son compte ferme ses salons en cours** (sinon des salons sans responsable bannissable). **Recommandé : oui**, dit avant de confirmer.
6. **D6 — Sauvegarde de `comptes.db`** (aujourd'hui rien n'est sauvegardé ; une machine réinitialisée perdrait tous les comptes) : **recommandé : copie chiffrée quotidienne hors de la machine**, clé du serveur gardée à part, hors ligne.
7. **D7 — « Rester connecté »** : **recommandé : proposé, décoché par défaut**, 30 jours sans usage, 90 jours au plus.
8. **D8 — Ouverture au public** : **recommandé : `SHH_COMPTES=1` seulement après l'avis du juriste** sur la conservation des données de création de compte (LCEN, décret 2021-1362), qui pourrait contredire « adresse jamais gardée » et « aucune IP sur disque ».

---

## 21. Révision 2 du 14 novembre 2026 — décisions du propriétaire, solutions et conflits

> **À valider par le propriétaire.** Rien n'est codé. Cette révision **remplace** les passages annotés « → §21 » plus haut ; le reste de la conception (normalisation de l'adresse §5, Argon2id sur l'appareil §3.1 et §6, sessions §8.5, anti-abus §8.8, ancienneté §11, règles d'écran communes §12, apps §17) **reste valable**. Les décisions qui restent au propriétaire sont en §21.19 (cinq au plus).

### 21.0 Les onze décisions et où elles sont traitées

| # | Décision du propriétaire (résumée) | Où |
|---|---|---|
| 1 | Pas de code de secours ; récupération par e-mail ; ne rien perdre (pseudo, photo, abonnement, compte) | §21.2 |
| 2 | Service d'envoi d'e-mails ; **rien d'autre qu'un code** dans un e-mail | §21.3 |
| 3 | Empreintes pour l'adresse et le mot de passe | §21.4 (confirmé, inchangé) |
| 4 | Bannissement 3 ans, désactivable, annulable, allongeable depuis le tableau de bord | §21.11, §21.14 |
| 5 | Signalement sur place (partage ouvert, salon), sans e-mail, par catégorie | §21.10 |
| 6 | Supprimer son compte supprime tout sur la plateforme | §21.12 |
| 7 | Sauvegarde de la base, ailleurs, entièrement chiffrée, déchiffrable par l'exploitant | §21.13 |
| 8 | Tableau de bord d'administration finalisé | §21.14 |
| 9 | Page profil : photo facultative, pseudo obligatoire et unique, changer d'adresse | §21.5, §21.15.3, §21.15.4 |
| 10 | Accueil connecté façon messagerie : liens reçus, salons rejoints, ses partages et salons | §21.7, §21.8, §21.15.1 |
| 11 | Téléchargements : rien sur nos serveurs au-delà de la vie du partage ; espace « à télécharger » ; historique sur l'appareil | §21.9, §21.15.5 |

### 21.1 Conflits et risques signalés (vigilance)

| # | Gravité | Endroit | Problème | Solution retenue |
|---|---|---|---|---|
| R1 | **Élevée, sécurité** | décision 1 | « Récupérer par e-mail sans rien perdre » exige qu'une clé capable de rouvrir les données du compte existe **sans** le mot de passe : un **séquestre** côté serveur. Le serveur, ou qui vole la machine avec sa clé, peut alors lire ces données. Pour le secret de gestion d'un salon, c'est grave : il donne le rôle de créateur dans le groupe chiffré (salon v3 §15.2) ; avec l'invitation, un serveur malveillant aidé d'un membre ou ancien membre prendrait la main sur la conversation. Pour un lien reçu (`K_lien`), le séquestre donnerait la moitié de la clé du partage | **Deux coffres** (§21.2) : le **coffre de profil** (pseudo, photo, langue, abonnement, réglages) est séquestré, et dit comme tel ; le **coffre privé** (secrets de gestion, liens reçus, salons rejoints, partages créés) reste chiffré par le mot de passe **seulement** et se perd à une récupération par e-mail, sauf s'il est encore sur un des appareils de la personne (§21.2.3). Coût : salons et liens durent 24 h au plus (7 jours en Plus) ; les salons créés restent destructibles par le compte (§21.6.2, `salons`) |
| R2 | Élevée, règle du projet | CLAUDE.md « le serveur ne doit jamais recevoir ni stocker … de clé … en clair » | le séquestre du profil y fait exception par définition : le serveur reçoit `s_profil` à l'inscription et le rend à chaque connexion | **exception écrite, à valider par le propriétaire** (§21.19, R-D1), limitée au coffre de profil ; `s_profil` gardé chiffré par une sous-clé du serveur, jamais journalisé ; aucun contenu de partage ni de salon n'y entre jamais (test bloquant §21.17) |
| R3 | Élevée, sécurité | décision 1 et double authentification | sans code de secours, qui perd son téléphone d'authentification n'a plus de recours ; mais un retrait par e-mail seul rendrait la double authentification inutile contre un vol de la boîte mail | retrait par e-mail **après 7 jours d'attente**, annulé par toute connexion réussie avec le code de l'application ; les appareils connectés affichent l'attente (§21.2.4) |
| R4 | Élevée, sécurité | récupération par e-mail | **la boîte mail devient la clé du compte** : qui la lit (piratage, ordinateur partagé, fournisseur) prend le compte, le profil séquestré, l'abonnement, la destruction des salons créés, et pourrait changer l'adresse pour garder le compte | double authentification exigée à la récupération si elle est active (inchangé) ; **7 jours sans changement d'adresse ni suppression du compte après une récupération par e-mail**, pour que le vrai titulaire puisse reprendre la main par le même chemin ; toutes les sessions fermées ; dit sur l'écran Récupération des paramètres |
| R5 | Moyenne, confidentialité | décision 1, abonnement | le pass (§38.4) était rangé dans un coffre illisible pour que « personne ne relie au repos `Q` ↔ compte » ; séquestré, il devient lisible par le serveur, donc le serveur peut relier un compte à un pass, et le vendeur relie le pass à l'acheteur | assumé pour respecter la décision 1 ; écrit dans la page Confidentialité ; les jetons aveugles (§38.4) gardent intacte l'absence de lien pass ↔ partages |
| R6 | Moyenne, confidentialité | décision 9, pseudo unique | un pseudo stable sur toute la plateforme permet aux membres de relier une personne d'un salon à l'autre (même pseudo, même photo) ; le serveur connaît le pseudo (unicité) | pseudo gardé seulement en **empreinte à clé** (`p_empreinte`) ; dans chaque salon, le pseudo du compte est **proposé**, modifiable, avec un réglage « Me demander à chaque salon » (§21.5) ; la photo n'est envoyée dans un salon que si la personne le laisse coché |
| R7 | Moyenne, sécurité (usurpation) | décision 9 | « unique sur la plateforme » ne prouve rien dans un salon : un invité sans compte peut y taper le même pseudo (le serveur ne voit pas les pseudos des salons, chiffrés de bout en bout), et un client modifié peut montrer un autre pseudo que le sien. Attester le pseudo (signature du serveur sur pseudo et clé MLS) relierait le compte aux salons qu'il rejoint | l'unicité vaut **pour les comptes** seulement ; le texte de l'écran d'entrée « un pseudonyme n'est qu'un nom choisi » (§39.4) reste ; aucun badge « vérifié » en V1 ; pseudos réservés (`shhgone`, `admin`, `support`…) refusés pour qu'on ne se fasse pas passer pour l'équipe |
| R8 | Élevée, confidentialité | décision 10, §37.4 | garder au serveur, en clair, la liste des liens reçus et des salons rejoints relierait le compte aux partages et aux salons d'autrui (interdit par §37.4) | listes dans le **coffre privé** (chiffré de bout en bout par le mot de passe) et dans l'historique local de l'appareil ; écritures du coffre différées de 2 à 12 min après un événement de partage ou de salon (§37.11 A-G2 repris) |
| R9 | Moyenne, attente déçue | décision 10 | « les liens qui lui ont été partagés » : le site ne sait pas qu'un lien lui est destiné ; il n'y a ni carnet d'adresses ni envoi « à un pseudo » (le serveur apprendrait qui écrit à qui) | « reçus » = **liens qu'il a ouverts** sur un appareil connecté (ou sur cet appareil, sans compte) ; envoi à un pseudo : non (§21.19, R-D4) |
| R10 | Moyenne, attente déçue | décision 10, « façon WhatsApp » | l'accueil ne peut pas montrer « 3 messages non lus » ni « Léa écrit… » : il faudrait rester connecté à chaque salon (une connexion, une place et un état MLS par salon) ou des notifications par un service tiers (exclu, §39.5) | l'accueil montre ce que l'appareil sait déjà : titre local, temps restant, « Expiré », rôle ; le reste s'affiche en entrant dans le salon ; dit dans l'état vide de l'accueil |
| R11 | Moyenne, exactitude | décision 10, rouvrir un lien reçu | depuis un **autre appareil**, rouvrir un partage consomme une ouverture (§4, D42-22) et redemande son mot de passe | l'accueil le dit sur la ligne (« Rouvrir ici compte une ouverture ») ; le mot de passe d'un partage ou d'un salon n'est **jamais** gardé dans le compte (sinon le mot de passe du compte ouvrirait les contenus) |
| R12 | Moyenne, confidentialité de l'appareil | décision 11 | un historique des téléchargements garde les **noms de fichiers**, que l'historique de §33 refusait de garder | chiffré au repos comme l'historique (clé non extractible) ; réglage pour le couper ; effacement en un geste ; entrées effacées après 30 jours ; jamais envoyé au serveur ni au compte ; protection honnête : celle du verrouillage de l'appareil (§21.9) |
| R13 | Élevée, exactitude (promesse) | décision 6 | le serveur ne sait pas (et ne doit pas savoir) quels partages ni quels messages viennent d'un compte : « supprimer tout » n'est vrai que pour ce qu'il peut retrouver | §21.12 : salons créés (lien compte ↔ salon) ; partages créés (rejeu par l'appareil depuis le coffre privé et l'historique local) ; messages dans les salons d'autrui : effacés à la fin de ces salons, pas avant ; l'écran le dit sans rien promettre de faux |
| R14 | Moyenne, choix validé modifié | décision 5 ; §36 S21, §15.2, UI A13, amendement du 13 novembre (« les signalements restent un booléen ») | le serveur ne gardait aucun motif ; avec des catégories, il apprend la catégorie de chaque signalement | compteurs par catégorie **en mémoire**, depuis le démarrage ; pour un salon vivant, catégories et nombre attachés à la ligne en mémoire jusqu'à la fin du salon (pour que le fondateur agisse) ; rien sur disque sauf le motif d'un bannissement (§21.10, §21.11) |
| R15 | **Élevée, légal** | décision 5 | contenus terroristes et pédocriminels : obligations de l'hébergeur (LCEN art. 6 : retrait prompt et information des autorités ; DSA art. 16 à 18 ; règlement TCO 2021/784 : retrait en une heure sur injonction, conservation 6 mois des contenus retirés, point de contact). Un signalement anonyme par catégorie, sur un contenu que nous ne pouvons pas lire, ne permet ni de vérifier ni de transmettre le contenu ; la destruction immédiate d'un partage empêche toute conservation | **juriste avant ouverture** ; en attendant : feuille de signalement qui renvoie vers PHAROS pour ces deux catégories et invite à nous envoyer le lien par la page `/signaler` ; procédure écrite pour le fondateur (§21.10.4) |
| R16 | Moyenne, légal | décision 4 ; DSA art. 17 ; RGPD art. 10 | une restriction de service doit être motivée auprès de la personne ; mais garder « banni pour pédocriminalité » à côté d'une empreinte d'adresse, c'est garder une donnée relative à une infraction présumée | le bannissement garde une **catégorie** (un octet), montrée à la personne à la connexion ; aucun texte libre ; à valider par le juriste |
| R17 | Moyenne, légal | décision 6 ; LCEN art. 6 et décret 2021-1362 (déjà §16) | une obligation de conserver un an les données de création de compte contredirait « supprimer tout » et « adresse jamais gardée » | inchangé : avis du juriste avant `SHH_COMPTES=1` en public |
| R18 | Moyenne, légal | décision 7 | une sauvegarde garde un compte supprimé jusqu'à sa rotation (droit à l'effacement) | rotation de 30 jours, dite dans la page Confidentialité ; restauration toujours depuis la plus récente (§21.13) |
| R19 | Moyenne, exploitation | décision 7 | sauvegarde et clé du serveur volées ensemble = base et clé (profils séquestrés lisibles, adresses testables une à une) | clé de chiffrement de la sauvegarde et clé du serveur rangées séparément, hors ligne ; la sauvegarde ne contient pas `K_serveur` |
| R20 | Faible, ambiguïté | décision 4 | « désactiver » et « annuler » se recouvrent | retenu : **Suspendre / Réactiver** (le bannissement reste, sans effet), **Lever** (fin maintenant), **Annuler** (erreur : tout est rendu, ancienneté comprise), **Changer l'échéance** (allonger ou raccourcir, 5 ans au plus à partir d'aujourd'hui) (§21.11) |
| R21 | Faible, sécurité | décision 2 | sans e-mail « votre adresse a changé » vers l'ancienne adresse, un voleur de session qui connaît le mot de passe change l'adresse sans bruit | changement d'adresse : session récente (mot de passe), code de l'application si active, code envoyé à la nouvelle adresse ; impossible pendant les 7 jours qui suivent une récupération (R4) |
| R22 | Faible, légal | décision 9 | la photo de profil est un contenu hébergé, lisible par le séquestre : une photo illicite peut être signalée par un membre d'un salon | signalement dans le salon (catégorie) ; aucun examen automatique ; au juriste avec R15 |
| R23 | Faible, inutile retiré | §6, §8.6, §10, §12 | code de secours, ses routes, ses écrans, sa saisie contrôlée, ses vecteurs | retirés (décision 1) |
| R24 | Faible, nom | e-mails, écrans | la conception parle de « Shhgone » (e-mails, `From`) et la spécification principale de « Shhdrop » | à aligner une fois pour toutes par le propriétaire ; les modèles d'e-mail prennent le nom de la configuration (`SHH_MAIL_FROM`) |

### 21.2 Récupération par e-mail sans perte : deux coffres

#### 21.2.1 Le compromis, en clair (pour le propriétaire)

- **Gardé à une récupération par e-mail** : le compte, son adresse, son ancienneté, ses salons en cours (destructibles depuis le compte), son pseudo, sa photo, sa langue, ses réglages, son abonnement.
- **Le prix** : ces données de profil sont lisibles par le serveur, donc par l'exploitant et par qui volerait la machine en marche. Le pseudo, le serveur le connaît de toute façon pour l'unicité ; la photo et l'abonnement, non : c'est nouveau et c'est dit.
- **Perdu à une récupération par e-mail, sauf copie sur un appareil** : les secrets qui ouvrent des contenus ou donnent du pouvoir dans un salon — secrets de gestion des salons créés, liens des partages reçus et des salons rejoints, secrets de gestion des partages créés. Si le serveur pouvait les rouvrir, il pourrait prendre le rôle de créateur d'un salon ou ouvrir un partage reçu. Ils durent 24 h au plus (7 jours en Plus) : le coût est faible.
- **Rien ne se perd** si un des appareils de la personne garde encore sa copie locale (historique de l'appareil, §21.8) : à la prochaine connexion sur cet appareil, elle revient dans le compte.
- **Autre solution étudiée et écartée** : « re-prouver l'admin autrement » (le compte redonne le rôle de créateur après récupération). Le rôle MLS tient à une clé tirée de `S_gestion` ; en donner une nouvelle aux membres demanderait une annonce signée par l'ancienne clé (perdue) ; sans elle, c'est le serveur qui attesterait le nouveau créateur, ce qu'un serveur malveillant pourrait faire aussi. Retenu à la place : **les pouvoirs que le serveur exerce de toute façon** (détruire, régler places et durée) reviennent par le compte, grâce au lien compte ↔ salon ; le rôle dans le groupe chiffré (exclure, changer l'invitation), non.

#### 21.2.2 Clés (remplace les lignes de §6 concernées ; aucune construction nouvelle)

| Élément | Création | Où il vit |
|---|---|---|
| `h`, `sel`, `M`, `A_auth`, `KEK_mdp`, `Env_mdp` | inchangés (§6) | inchangés |
| `K_compte` | inchangé (32 octets aléatoires) ; **ne chiffre plus que le coffre privé** et le nom d'appareil | mémoire ; IndexedDB enveloppée si « Rester connecté » |
| `K_blob` → `K_prive` | HKDF(`K_compte`, « shhdrop/v2/compte/blob ») (étiquette inchangée) | mémoire |
| `B_prive` | format « SHH-ACCT1 » de §37.2 inchangé (AD = « SHH-ACCT1 » ‖ `h` ‖ `gen`), paliers 4, 16, 64, 256 Kio | serveur |
| `s_profil` | 32 octets aléatoires **tirés par l'appareil** à l'inscription, envoyés dans `inscription/fin` | serveur, chiffré : `cle_profil` = nonce (12) ‖ AES-256-GCM(`K_sequestre`, nonce, `s_profil`, AD = « SHH-CSEQ1 » ‖ `h`) = 60 octets ; rendu à l'appareil à chaque connexion et à la récupération ; mémoire de la page |
| `K_profil` | HKDF(`s_profil`, « shhdrop/v2/compte/profil ») → AES-256-GCM | mémoire |
| `B_profil` | « SHH-PROF1 » (9) ‖ `gen` (8) ‖ nonce (12) ‖ AES-256-GCM(`K_profil`, nonce, clair bourré, AD = « SHH-PROF1 » ‖ `h` ‖ `gen`) ; clair = longueur (4) ‖ JSON ‖ zéros ; paliers 4, 16, 64, 256 Kio | serveur |
| `K_sequestre` | HKDF(`K_serveur`, « shhdrop/v2/serveur/compte/sequestre ») | mémoire du serveur |
| `K_pseudo` | HKDF(`K_serveur`, « shhdrop/v2/serveur/compte/pseudo ») | mémoire du serveur |
| `p_canon`, `p_empreinte` | `p_canon` : pseudo normalisé par le moteur (règle d'unicité de §39.4 point 4 : NFKC, minuscules, sans espaces ni ponctuation) ; `p_empreinte` = HMAC-SHA-256(`K_pseudo`, « pseudo » ‖ 0x00 ‖ `p_canon`) | `p_canon` : envoyé, jamais gardé ; `p_empreinte` : serveur, index unique |

- Pourquoi chiffrer le profil sur l'appareil alors que le serveur peut l'ouvrir : une copie de la base ou d'une sauvegarde sans `K_serveur` ne dit rien ; le serveur ne manipule jamais la photo en clair en marche normale ; le séquestre ne sert qu'à rendre `s_profil` à une session ouverte.
- Changer de mot de passe : seul `Env_mdp` change. Changer d'adresse : le sel change, `A_auth` et `Env_mdp` sont recalculés (mot de passe redemandé, §6). Le coffre de profil n'est pas touché.
- Vecteurs communs (`engine/vectors/compte.json`) : sections `coffre_profil`, `p_canon` (≥ 30 cas : casse, espaces, ponctuation, NFKC, écritures mêlées refusées, réservés) ; sections `secours` retirées.

#### 21.2.3 Parcours « Mot de passe oublié » (remplace §10.3)

1. Adresse **exacte** (règle de §5.1 inchangée) → `oubli/debut` (ALTCHA) → toujours « Si un compte utilise cette adresse, nous venons de lui envoyer un code. »
2. Code → `oubli/verifier` ; si la double authentification est active : code de l'application, ou « Je n'ai plus mon application » (§21.2.4).
3. Nouveau mot de passe → l'appareil tire un nouveau `K_compte`, refait `Env_mdp`, crée un coffre privé vide → `oubli/fin` → session, `s_profil`, `B_profil` : pseudo, photo, abonnement sont là.
4. **Retour des secrets locaux** : si cet appareil garde un historique local (§21.8), ses entrées (salons créés, rejoints, liens reçus, partages créés) sont réécrites dans le nouveau coffre privé. Même chose à la première connexion de chaque autre appareil qui en garde une copie (fusion de §37.2, inchangée).
5. Toutes les sessions sont fermées ; `recup_jour` = aujourd'hui : pendant 7 jours, changement d'adresse et suppression du compte répondent 403 `attente` (R4) ; l'écran le dit (« Par sécurité, après une récupération par e-mail, l'adresse ne peut pas être changée ni le compte supprimé avant le {date}. »).

**Signalement (moyenne, droit à l'effacement)** : retarder la suppression de 7 jours reste « dans les meilleurs délais » (RGPD art. 12.3 : un mois) et a une raison de sécurité écrite ; à confirmer par le juriste.

#### 21.2.4 Double authentification perdue (remplace « Perte du téléphone » de §8.4)

- À l'étape 2, « Je n'ai plus mon application » : le code e-mail juste pose `totp_retrait_jour` = aujourd'hui + 7 ; réponse `{ "attente_jusqu": "2026-11-21" }` ; écran : « Par sécurité, la double authentification sera retirée le 21 novembre. Revenez à cette date avec un nouveau code reçu par e-mail. Si ce n'est pas vous, connectez-vous avec votre application : la demande sera annulée. »
- Pendant l'attente : toute connexion réussie **avec** le code de l'application, ou « Annuler la demande » depuis une session (paramètres, bandeau `warn` sur tous les appareils connectés : « Une demande de retrait de la double authentification est en cours. Ce n'est pas vous ? Annuler »), remet `totp_retrait_jour` à `NULL`.
- Après la date : le parcours du §21.2.3 passe sans code d'application ; la double authentification est retirée, puis proposée à nouveau.
- **Limite dite** : qui garde la boîte mail 7 jours sans que le titulaire se connecte prend le compte. Pas de meilleure solution sans second moyen de récupération (refusé : code de secours, téléphone).

### 21.3 E-mails sans fuite (décision 2 ; remplace §8.7 premier point et §12.5)

- **Un seul modèle**, en texte brut, langue de la requête, pour **tous** les envois (inscription, récupération, nouvelle adresse) :
  - objet : « Votre code Shhgone » (EN « Your Shhgone code ») ;
  - corps : « Votre code : 123 456\nIl expire dans 15 minutes.\nSi vous n'avez rien demandé, ignorez ce message. » ;
  - rien d'autre : ni pseudo, ni lien, ni nom de salon ou de partage, ni « votre compte », ni pourquoi le code a été demandé, ni date de création, ni adresse IP ; en-têtes exactement `From`, `To`, `Subject`, `Date`, `Message-ID` (aléatoire), `MIME-Version`, `Content-Type: text/plain; charset=utf-8`, `Content-Transfer-Encoding`.
- **Ne jamais dire si une adresse a un compte, sans e-mail d'information** : `inscription/debut` envoie **toujours** ce même e-mail avec un vrai code. L'état n'est dit qu'**à l'écran, après le code juste** (seul le titulaire de la boîte peut l'avoir) : adresse libre → création ; adresse déjà inscrite → « Cette adresse a déjà un compte. Connectez-vous ou utilisez « Mot de passe oublié ». » (aucune création) ; adresse bannie → « Cette adresse ne peut pas créer de compte jusqu'au {date}. » `oubli/debut` : l'e-mail ne part que si `e_envoi` correspond ; réponse identique.
- **Changement d'adresse** : code à la nouvelle adresse seulement ; aucun avis à l'ancienne (il dirait « vous avez un compte ») ; parade en R21.
- **Aucun e-mail à l'initiative du serveur** (inchangé, §3.2).
- Fournisseur : D1 de §20 (inchangée) ; il voit l'adresse, l'heure et le code ; un employé du fournisseur pourrait utiliser un code pendant 15 min (faible ; la double authentification protège).

### 21.4 Empreintes (décision 3)

Confirmé tel que §5.2 : `e_canon`, `e_envoi` (HMAC à clé), `v_mdp` (HMAC à clé d'une sortie d'Argon2id calculée sur l'appareil : le serveur ne reçoit jamais le mot de passe). Ajouts : `p_empreinte` (§21.2.2) et `cle_profil` (séquestre). Toutes les sous-clés viennent de `K_serveur` ; sa perte perd tous les comptes (§5.2 a, inchangé, sauvegarde hors ligne §21.13).

### 21.5 Pseudo unique et profil (décision 9)

- **Obligatoire** à l'inscription, règles d'affichage de §39.4 point 4 (2 à 24 graphèmes, une seule écriture…). **Unique parmi les comptes** : `p_empreinte` index unique ; `409 pseudo_pris` à `inscription/fin` (l'étape reste valable) et à `POST pseudo`. Vérification pendant la saisie par `POST pseudo/verifier` (étape d'inscription ou session ; 30 par heure) : « Disponible » / « Déjà pris ».
- **Réservés** (comparés sur `p_canon`, liste embarquée côté serveur et site) : `shhgone`, `shhdrop`, `admin`, `administrateur`, `moderateur`, `moderation`, `support`, `aide`, `equipe`, `officiel`, `systeme`, `securite`, `contact`.
- Changement : une fois par 24 h ; l'ancien pseudo est libéré tout de suite (simplicité ; R7 : un pseudo ne prouve rien). Suppression du compte : pseudo libéré.
- **Ce que le serveur garde** : `p_empreinte` seulement ; le pseudo tel qu'affiché est dans `B_profil` (séquestré). Il ne garde **pas** de pseudo en clair, ne l'affiche nulle part (tableau de bord compris), et n'offre **aucune** recherche de compte par pseudo ni page de profil publique (elle lui ferait servir pseudo et photo et permettrait d'énumérer les comptes).
- **Limite honnête (faible)** : le serveur ne voit que `p_canon` ; un client modifié peut afficher autre chose que son pseudo réservé. Sans attestation (R7), l'unicité ne vaut que pour les clients honnêtes.
- **Dans un salon** (R6) : le champ « Pseudonyme pour ce salon » est prérempli avec le pseudo du compte et la case « Montrer ma photo » cochée si une photo existe ; réglage « Me demander à chaque salon » (champ vide et case décochée). L'unicité **dans le salon** reste celle de §39.4 ; si le pseudo du compte y est déjà pris par quelqu'un d'autre, la personne en choisit un autre.

### 21.6 Serveur : schéma et routes révisés

#### 21.6.1 `comptes.db` (remplace §8.2 pour cette base ; mêmes règles de base)

| Table | Colonnes | Pourquoi |
|---|---|---|
| `comptes` | `h` BLOB(16) clé ; `e_canon` BLOB(32) unique ; `e_envoi` BLOB(32) ; `v_mdp` BLOB(32) ; `env_mdp` BLOB(60) ; `cle_profil` BLOB(60) ; `p_empreinte` BLOB(32) unique ; `pseudo_jour` INTEGER ; `blob_profil` BLOB ; `gen_profil` INTEGER ; `blob_prive` BLOB ; `gen_prive` INTEGER ; `totp` BLOB(48) NULL ; `totp_retrait_jour` INTEGER NULL ; `recup_jour` INTEGER NULL ; `cree_jour` ; `compte_des` ; `vu_mois` ; `banni` 0/1 | `v_s`, `env_s`, `blob`, `gen` retirés ; séquestre, pseudo, deux coffres, attentes de R3 et R4 |
| `sessions` | inchangée (§8.2) | — |
| `bannis` | `id` BLOB(8) clé (aléatoire, montré au fondateur) ; `e_canon` BLOB(32) unique ; `debut_jour` ; `jusqu_jour` ; `actif` 0/1 (suspendu = 0) ; `motif` INTEGER (catégorie de §21.10, 1 à 10) ; `salons_fermes` INTEGER | durée modifiable sans adresse (§21.11), motivation (R16) |

Toutes les colonnes restent BLOB ou INTEGER (test `TestSchemaComptes` : aucune colonne texte) ; toutes les dates au jour (ou au mois pour `vu_mois`).

#### 21.6.2 Routes (`/api/compte/`, règles de §8.6 inchangées)

| Route | Changement |
|---|---|
| `secours/debut`, `secours/fin`, `secours/renouveler` | **retirées** |
| `POST inscription/fin` | corps `{ etape, code, a_auth, env_mdp, s_profil, p_canon, blob_profil, blob_prive, persistante, etiquette }` ; erreurs en plus : `pseudo_pris` (409), `deja_inscrit` (409, montré seulement après un code juste, §21.3), `banni` (403, avec `jusqu`) |
| `POST connexion`, `POST connexion/totp` | réponse `{ session, h, env_mdp, s_profil, blob_profil, gen_profil, blob_prive, gen_prive }` ; une connexion avec code d'application annule `totp_retrait_jour` |
| `POST oubli/verifier` | corps `{ etape, code, totp, totp_perdu }` ; `totp_perdu: true` → `{ attente_jusqu }` (§21.2.4) |
| `POST oubli/fin` | corps `{ etape, a_auth, env_mdp, blob_prive, persistante, etiquette }` ; réponse `{ session, h, s_profil, blob_profil, gen_profil, gen_prive }` ; `blob_profil` gardé, `blob_prive` remplacé, `recup_jour` posé |
| `GET`/`PUT coffre/profil`, `GET`/`PUT coffre/prive` | remplacent `blob` (règles `if_gen`, 409, paliers, 60 écritures par heure **pour les deux ensemble**) |
| `POST pseudo/verifier` | `{ p_canon }` → `{ libre }` ; étape d'inscription ou session ; 30 par heure |
| `POST pseudo` | session ; `{ p_canon }` → `{}` ou `pseudo_pris`, `limit` (une fois par 24 h) |
| `POST totp/annuler-retrait` | session → `{}` |
| `GET /api/compte` | ajoute `recup_jusqu` (date ou `null`), `retrait_totp_le` (date ou `null`), `banni_jusqu` et `banni_motif` (ou `null`) |
| `GET salons` | session → `{ salons: [{ ref, expire_vers: "2026-11-14T21:45Z", places, sieges }] }` : salons vivants **créés par ce compte** (colonne `salons.compte`) ; `ref` = 16 octets aléatoires valables 10 min, en mémoire (aucun identifiant du salon ne sort) ; `expire_vers` au quart d'heure (déjà en base) |
| `POST salons/detruire` | session ; `{ ref }` → `{}` (même effet que « Détruire » du créateur) |
| `POST email/fin` | corps `{ etape, code, a_auth, env_mdp, totp }` ; refus `attente` pendant `recup_jusqu` |
| `POST supprimer` | session récente ; refus `attente` pendant `recup_jusqu` ; `{ salons_fermes }` |

Règle de §8.5 inchangée : le jeton de session ne part que vers `/api/compte/*` et `POST /api/salons`. `GET salons` et `salons/detruire` sont sous `/api/compte/` : le jeton ne touche aucune autre route du salon.

### 21.7 Accueil connecté (décision 10) — données

L'accueil connecté est une **liste unique**, triée par activité, de quatre sortes d'entrées, toutes lues **sur l'appareil** (coffre privé ouvert et historique local fusionnés), sans requête au chargement :

| Sorte | Vient de | Ce que garde l'entrée | Jamais |
|---|---|---|---|
| Salon créé | création ; `GET salons` (retour après récupération) | `S_gestion`, lien d'invitation `#c` (pour y retourner), libellé local, `expiresAt`, places | mot de passe du salon |
| Salon rejoint | entrée réussie dans un salon | lien d'invitation `#c`, libellé local, `expiresAt`, date d'entrée | mot de passe du salon, messages, pseudonymes des autres |
| Partage reçu | ouverture réussie d'un lien | lien `#<K_lien>`, `expiresAt`, nombre d'éléments, taille, sorte dominante (icône), date d'ouverture | mot de passe, noms des éléments, contenu |
| Partage créé | « Lien prêt » | entrée de §33.1 inchangée (`S_gestion`…) | `K_lien`, mot de passe, noms |

- **État** calculé localement : temps restant (`Countdown`) ou « Expiré » quand `expiresAt` est passé ; « Détruit » seulement si une relecture l'a constaté. Relecture d'une entrée (partage : `meta` ou `manage/status` ; salon : `meta`) seulement à son ouverture ou sur « Actualiser », au plus une fois par 5 min, étalée (§33.1) : une salve de requêtes au chargement relierait en direct les entrées d'une même connexion.
- Entrées expirées ou détruites gardées 7 jours, atténuées, puis retirées (§33).
- Réglages (§21.15.4) : « Garder les liens que j'ouvre » et « Garder les salons que je rejoins » (activés) ; sur la page d'ouverture d'un partage et l'écran d'entrée d'un salon, une case « Garder dans mon accueil » (cochée selon le réglage) pour un cas isolé.
- **Sans compte**, la même liste existe sur l'appareil seulement (historique local étendu) : l'accueil connecté n'est que sa version synchronisée.
- Dépendances : les entrées « salon » n'apparaissent qu'avec les écrans du salon (C-3, C-5), pas encore faits.

### 21.8 Stockage des listes : appareil d'abord, coffre privé ensuite

- **Un seul stockage local** : l'historique de §33 (`web/src/history/`) devient l'historique de l'appareil, avec un champ `sorte` (`envoi`, `recu`, `salon_cree`, `salon_rejoint`) et `origine` (`local` | `compte`, §37.11 A-G8). Même chiffrement (AES-256-GCM, clé non extractible, IndexedDB) ; même honnêteté (la vraie protection est le verrouillage de l'appareil).
- **Synchronisation** : connecté, l'appareil fusionne ses entrées dans `B_prive` (écriture différée de 2 à 12 min après un événement de partage ou de salon, §37.11 A-G2) et reçoit celles des autres appareils (`origine: "compte"`). Déconnexion : les entrées `compte` reçues d'autres appareils sont retirées de cet appareil, les entrées `local` restent.
- **Exception écrite à UI §12.1 et §33** : l'historique garde désormais des **liens de partage reçus et d'invitation** (`K_lien`). Ils ne suffisent jamais seuls : le mot de passe reste nécessaire (et n'est jamais gardé). À ajouter à la liste de §6 de la spécification principale (contenu déchiffré : exceptions écrites).
- **Pourquoi pas de stockage serveur en clair** : R8.

### 21.9 Téléchargements (décision 11)

- **Serveur** : rien de nouveau ; rien n'est gardé au-delà de la vie du partage ou du salon (§7.6, §39.1) ; seule exception déjà écrite : un téléchargement commencé finit jusqu'à 2 h après une suppression (§41.8, S61).
- **« À télécharger »** : dans un partage ouvert, la galerie (UI §9.8.x) gagne un en-tête de section « À télécharger · 6 éléments · 142 Mo » avec « Tout télécharger » et la mention « Disponible jusqu'au {échéance}, puis effacé du serveur » ; dans un salon, l'écran « Fichiers » (salon v3 §14.6) gagne le filtre « Pas encore téléchargés » et la même mention (fin du salon).
- **Historique des téléchargements** (`/telechargements`), **sur cet appareil seulement**, jamais envoyé au serveur ni au compte : une entrée par enregistrement réussi (`saveItem` terminé, ou fichier du salon enregistré) : nom (`safeName`), taille, sorte (icône), source (« Partage reçu » ou « Salon »), date et heure locales. Jamais le lien, la clé, le mot de passe ni le contenu.
- Module `web/src/downloads/` (seul détenteur de la base IndexedDB `shhdrop-telechargements`), chiffré comme l'historique ; réglage « Garder l'historique des téléchargements » (**activé**, R12) ; entrées effacées après **30 jours** ; « Effacer l'historique » en un geste ; « Retirer » par ligne.
- **Limite dite à l'écran** : le site ne peut pas rouvrir un fichier enregistré (il est dans le dossier Téléchargements de l'appareil, hors de la portée d'une page web). Les apps (D42-20) pourront garder une référence vers le fichier : même format d'entrée.

### 21.10 Signalements par catégorie (décision 5)

#### 21.10.1 Catégories (codes fixes, mêmes dans le site et les apps)

| Code | Catégorie (FR) | Texte d'aide |
|---|---|---|
| 1 | Terrorisme | Apologie, menaces ou propagande terroriste |
| 2 | Abus sexuels sur mineurs | Images ou propos sexuels impliquant un mineur |
| 3 | Contenu sexuel non consenti | Images intimes diffusées sans accord, montages |
| 4 | Violence ou menaces | Menaces, incitation à la violence, contenus choquants |
| 5 | Haine ou discrimination | Contenu haineux visant une origine, une religion, un genre… |
| 6 | Harcèlement | Insultes répétées, intimidation, chantage |
| 7 | Piratage ou logiciel malveillant | Virus, hameçonnage, vol de comptes |
| 8 | Arnaque | Escroquerie, faux paiement, usurpation |
| 9 | Données personnelles exposées | Adresse, documents d'identité, photos privées d'un tiers |
| 10 | Autre | — |

« Harcèlement » et « Données personnelles exposées » sont ajoutés à la liste du propriétaire (cas fréquents dans une messagerie) ; à retirer d'un mot s'il les refuse.

#### 21.10.2 Où et comment

- **Partage ouvert** : « Signaler » (UI §9.10) → choix de la catégorie → « Signaler et détruire » : `destroy` avec `{ "reason": "report", "categorie": 1..10 }` (S14 : `reason` absent ou exactement `"report"` ; `categorie` entier 1 à 10, seulement avec `report`, sinon 400 ; absente, elle vaut 10 « Autre », pour les clients d'avant et les apps pas encore à jour). Le partage est détruit comme aujourd'hui.
- **Salon** : « Quitter et signaler » (§39.5) → catégorie → `POST /api/salons/signaler` avec `{ "categorie": n }` (était `{}`, toujours accepté et compté « Autre ») ; un signalement par jeton de membre, inchangé ; remise à zéro de l'ancienneté du créateur inchangée (§11, D4).
- Aucun texte libre, aucune pièce, aucune adresse e-mail. Pour les codes 1 et 2, l'écran ajoute PHAROS et l'invitation à nous envoyer le lien par `/signaler` (seul moyen pour que le fondateur voie le contenu et puisse le transmettre).

#### 21.10.3 Ce que garde le serveur, ce que voit le fondateur

- **Mémoire seulement, depuis le démarrage** : un compteur par catégorie et par sorte (partage, salon) ; l'alerte de §15.2 reste (vraie dès 5 signalements dans l'heure, toutes catégories).
- **Salon vivant signalé** : sur sa ligne **en mémoire** (pas en base), le nombre de signalements par catégorie ; effacé avec le salon. C'est ce qui permet au fondateur d'agir sans lien d'invitation (§21.14.3).
- **Sur disque** : rien, sauf le **motif** d'un bannissement (§21.11).
- Le fondateur voit : les compteurs par catégorie, la liste des salons signalés en cours (§21.14.3) ; jamais un contenu, un pseudo, un lien, une adresse.

#### 21.10.4 Obligations légales (à faire valider par le juriste, R15)

- LCEN art. 6 : retrait prompt des contenus manifestement illicites signalés ; information prompte des autorités pour certaines infractions signalées (terrorisme, pédocriminalité, haine…) ; dispositif de signalement accessible.
- DSA : art. 16 (mécanisme de notification : explication, adresse précise du contenu ; les catégories sur place ne remplacent pas la page `/signaler`, qui reste), art. 17 (motivation d'une restriction : §21.11), art. 18 (soupçon d'infraction menaçant la vie ou la sécurité : informer les autorités).
- Règlement TCO (UE) 2021/784 : point de contact, retrait en une heure sur injonction, conservation 6 mois du contenu retiré et des données associées. **Conflit** : nous ne lisons pas le contenu et la destruction efface le chiffré ; à trancher avec le juriste (conserver le chiffré seulement sur injonction ? destruction différée pour les codes 1 et 2 ?).
- Pédocriminalité : signalement à PHAROS quand l'équipe en a connaissance ; procédure écrite pour le fondateur (que transmettre quand on n'a qu'une catégorie et pas de contenu).

### 21.11 Bannissement révisé (décision 4 ; complète §13)

- **Durée par défaut : 3 ans** ; choix au moment de bannir : 30 jours, 1 an, 3 ans (défaut).
- **Actions** sur un bannissement (tableau de bord et ligne de commande) :
  - **Suspendre / Réactiver** : `actif` 0 ou 1 ; suspendu, l'adresse peut recréer un compte et le compte créer des salons ; l'échéance ne bouge pas ;
  - **Changer l'échéance** : allonger ou raccourcir, toute date entre demain et aujourd'hui + 5 ans (au-delà : décision du juriste, la durée de conservation doit rester proportionnée) ;
  - **Lever** : fin maintenant (ligne effacée, `banni = 0`) ; l'ancienneté n'est pas rendue ;
  - **Annuler** (erreur de bannissement) : comme Lever, plus `compte_des = cree_jour` (ancienneté rendue).
- **Motif** : la catégorie du signalement à l'origine (ou « Autre »), choisie par le fondateur ; montrée à la personne à la connexion : « Ce compte ne peut plus créer de salon jusqu'au {date}. Motif : {catégorie}. Recours : {adresse de contact}. » (R16).
- **Identifiant** : `id` de 8 octets aléatoires, montré « B-7KQ2-M9XA » ; c'est la seule façon de désigner un bannissement dans la page et dans `shhdrop admin bannis …`. Aucune adresse, empreinte, `h` ni pseudo affiché.
- Effets inchangés (§13) : sessions fermées, salons du compte fermés, création refusée ; connexion permise pour exporter et supprimer.
- **Garde-fou** (jeton d'administration volé) : 20 bannissements par heure au plus ; chaque action renvoie l'état d'avant, pour pouvoir annuler.

### 21.12 Suppression totale (décision 6)

**Ce qui est supprimé, et comment** (dans cet ordre, par l'appareil puis le serveur) :

| Quoi | Comment | Garantie |
|---|---|---|
| Partages créés | l'appareil rejoue `manage/destroy` pour chaque `S_gestion` du coffre privé **et** de l'historique local, un par un, puis attend les réponses | supprimés s'ils sont dans l'une des deux listes ; un partage créé sur un appareil sans historique et pas rangé dans le compte (navigation privée, coffre perdu par une récupération par e-mail) **ne peut pas** être retrouvé : il s'efface à son échéance (24 h, 7 jours en Plus). Le serveur voit en direct ces destructions venir d'une même connexion (faible : à ce moment le compte disparaît) |
| Salons créés | le serveur ferme et efface tous les salons `WHERE compte = h` (conversation, pièces jointes, ligne) | complet, par le lien compte ↔ salon |
| Salons rejoints | l'appareil quitte chaque salon où il garde une preuve de membre (`0x03`) | la place est libérée |
| Messages et fichiers envoyés dans les salons d'autrui | **ne peuvent pas être retrouvés** : le serveur ne sait pas quelles trames viennent de ce compte (chiffrées, identité éphémère) ; « Retirer pour tous » exige d'être dans le salon | effacés à la fin de chacun de ces salons (24 h au plus, renouvellement compris : un renouvellement efface la conversation) ; ceux qui les ont lus ont pu les copier |
| Compte | lignes `comptes` et `sessions`, deux coffres, séquestre, empreinte du pseudo ; `wal_checkpoint(TRUNCATE)` | immédiat |
| Appareil | case « Effacer aussi les données de cet appareil » (cochée) : historique local, historique des téléchargements, preuves de membre, `shhdrop-compte` | cet appareil seulement ; les autres appareils oublient les entrées `compte` à la prochaine tentative de connexion (session refusée) |

**Ce qui reste, dit avant de confirmer** : l'empreinte d'une adresse **bannie** (jusqu'à l'échéance) ; les sauvegardes jusqu'à leur rotation (30 jours, §21.13) ; les journaux du fournisseur d'e-mails (durée contractuelle) ; les compteurs agrégés ; ce que d'autres ont reçu ; les partages que l'appareil ne connaît pas ; les messages dans les salons d'autrui jusqu'à leur fin. **Abonnement** : un pass en cours est perdu avec le compte (« Votre pass Plus, valable jusqu'au {date}, sera perdu. Un remboursement ne se demande qu'au vendeur. »).

Texte de confirmation (`InlineConfirm` sur un écran dédié, mot de passe redemandé) : « Supprimer définitivement votre compte ? Vos {n} salons seront fermés pour tous, vos {m} partages connus seront détruits et votre pseudo libéré. Vos messages dans les salons des autres s'effaceront à la fin de ces salons. Cette action ne peut pas être annulée. »

### 21.13 Sauvegarde (décision 7 ; remplace D6)

- **Contenu** : `comptes.db` seulement (comptes, sessions, bannis). **Jamais** `shares.db`, les fichiers des partages, les salons, les conversations, ni `K_serveur`. Après une restauration, les partages et salons d'avant sont perdus (ils sont éphémères) et le lien compte ↔ salon aussi.
- **Fabrication** : chaque jour, sur la machine, `sqlite3 comptes.db ".backup"` vers un fichier temporaire du volume chiffré, puis chiffrement par **age** (format `age-encryption.org/v1`, X25519, outil `age` en version exacte épinglée, construit depuis ses sources ou paquet signé) vers la **clé publique** de l'exploitant ; le clair temporaire est effacé aussitôt ; seul le chiffré sort. Pas de crypto maison, rien dans le serveur Go (aucune sortie de plus pour lui).
- **Destination** : un stockage objet chez un **autre** fournisseur que l'hébergeur, dans l'UE, avec un compte dédié en écriture seule (le serveur ne peut ni lire ni effacer les anciennes copies : un pirate de la machine ne détruit pas les sauvegardes) ; sortie HTTPS vers ce seul hôte, depuis la machine (pas le conteneur).
- **Clé privée** : chez l'exploitant, hors ligne (papier ou clé USB chiffrée), **séparée** de la copie hors ligne de `K_serveur` (R19). Sans `K_serveur`, une sauvegarde ne sert à rien : les deux copies sont obligatoires.
- **Durée** : 30 copies quotidiennes, puis effacement par la règle de cycle de vie du stockage (pas par le serveur).
- **Restauration** : toujours depuis la plus récente (les suppressions antérieures y sont déjà appliquées) ; `deploy/restaurer.sh` (déchiffre sur le poste de l'exploitant ou sur la machine avec la clé apportée, vérifie `PRAGMA integrity_check`, remplace `comptes.db` serveur arrêté) ; **test de restauration** mensuel et à chaque changement de schéma (`make test-restauration` : sauvegarde, effacement, restauration, connexion d'un compte de test).
- **Effet sur le droit à l'effacement** : un compte supprimé reste dans les copies jusqu'à 30 jours ; c'est dit dans la page Confidentialité ; une restauration depuis une copie plus ancienne que la plus récente est interdite par la procédure.

### 21.14 Tableau de bord d'administration, finalisé (décision 8 ; complète `2026-11-13-tableau-de-bord-admin-design.md`)

Règles de cette conception **inchangées** : écouteur local par tunnel SSH, jeton (empreinte), réponse uniforme, CSP stricte, aucun `wipe`, rien enregistré sur disque, agrégats seulement, **jamais une adresse e-mail, une empreinte, un `h`, un pseudo, une IP, un lien ou un contenu**.

#### 21.14.1 Onglets de la page (une seule page, ancres)

1. **État** (existant : A à D).
2. **Signalements** : compteurs par catégorie depuis le démarrage (tableau 10 lignes × partage / salon), alerte ; liste des **salons signalés en cours** (§21.14.3).
3. **Bannissements** : liste, recherche par adresse, bannir par adresse ou par lien, actions (§21.11).
4. **Comptes** : agrégats (§21.14.2).
5. **Usage** : compteurs existants (amendement du 13 novembre) + compteurs du compte.
6. **Actions** : geler / dégeler, détruire par lien (existant).

#### 21.14.2 Comptes et ancienneté (lus en direct, agrégats)

Nombre de comptes / `SHH_COMPTES_MAX` ; neufs (< 7 jours d'ancienneté) et confirmés ; répartition de l'ancienneté (< 7 j, 7–30 j, 1–6 mois, 6–12 mois, > 12 mois) ; avec double authentification (nombre) ; en attente de retrait de la double authentification ; récupérés par e-mail ces 7 derniers jours ; sessions ouvertes, dont « rester connecté » ; comptes effacés pour inactivité au dernier passage ; bannis actifs, suspendus, échéant dans les 30 jours ; salons vivants créés par un compte ; **depuis le démarrage** : inscriptions confirmées, connexions réussies, échecs, récupérations, suppressions, e-mails envoyés, échecs d'envoi, file d'envoi (longueur, plus haut atteint). Plus tard (§38) : pass actifs (nombre seulement).

**Signalement (faible, déjà dit)** : avec peu de comptes, un agrégat peut désigner une personne ; rien n'est enregistré.

#### 21.14.3 Salons signalés en cours

Une ligne par salon vivant ayant au moins un signalement : `ref` en mémoire (10 min, jamais l'identifiant) ; signalements par catégorie (« 2 × Harcèlement, 1 × Autre ») ; places et sièges ; « s'efface dans moins de 6 h » ou « dans 6 à 24 h » (jamais l'heure de création, fuite Z1) ; **créateur** : « sans compte » ou palier, ancienneté en jours, nombre de ses autres salons vivants, « déjà banni » (jamais son identité). Tri : codes 1 et 2 d'abord, puis nombre. Actions : **Détruire le salon**, **Bannir le créateur** (durée, motif prérempli par la catégorie dominante), **Rendre l'ancienneté**.

#### 21.14.4 Bannissements

Tableau : identifiant `B-…`, début, échéance, état (actif, suspendu), motif, salons fermés ; filtres actifs / suspendus / échéant bientôt ; pages de 50. **Recherche par adresse** (recours) : champ adresse → le serveur calcule `e_canon`, rend la ligne du bannissement ou « aucun », plus « un compte existe : oui/non, palier, ancienneté » ; le champ est vidé après la réponse, l'adresse n'est gardée nulle part (tampon effacé au mieux, comme le lien collé). **Bannir par adresse** (signalement reçu par la page de contact) et **par lien** (existant) ; actions de §21.11 ; chaque action demande confirmation sur place (`InlineConfirm`).

#### 21.14.5 Routes d'administration ajoutées (corps JSON, jamais dans l'URL)

`GET /api/signalements` ; `POST /api/salons/action` `{ ref, action: "detruire"|"bannir"|"anciennete", duree_jours?, motif? }` ; `GET /api/bannis?filtre=&page=` ; `POST /api/bannis/action` `{ id, action: "suspendre"|"reactiver"|"echeance"|"lever"|"annuler", jusqu? }` ; `POST /api/bannis/chercher` `{ email }` ; `POST /api/bannir` `{ email | lien, duree_jours, motif }` ; `GET /api/comptes` (agrégats). Ligne de commande : `shhdrop admin bannir -` (lien ou adresse sur l'entrée standard, `--duree`, `--motif`), `shhdrop admin bannis liste|suspendre|reactiver|echeance|lever|annuler <id>`.

### 21.15 Écrans nouveaux et révisés (style du site : UI §2 à §8, « Nuit chiffrée », composants de `web/src/ui/`)

Règles communes de §12 inchangées (étiquettes, `autocomplete`, `LiveRegion`, focus, 44 px, 320 px sans défilement horizontal, `prefers-reduced-motion`, `forced-colors`, aucune adresse ni pseudo dans le titre de l'onglet ni dans l'URL). Clés i18n `account.*`, `home.inbox.*`, `downloads.*`, `report.*`. **Icônes nouvelles** pour le jeu fermé (UI §6, revue à faire) : `search`, `user`, `messages-square` (déjà prévue pour le salon, §39.6), `chevron-right`.

#### 21.15.1 Accueil connecté (`/`, avec session ; sinon l'accueil actuel)

- **Téléphone (< 768 px)** : en-tête compact collé (verre au défilement) : avatar rond 36 px (photo ou initiale sur `--surface-3`, bouton vers le profil, `aria-label` « Profil ») à gauche, titre « Accueil » (`--fs-h2`), `IconButton` `search` à droite. Sous lui, **puces de filtre** `Segmented` défilables : « Tout », « Salons », « Reçus », « Envoyés » (`role="radiogroup"`). Puis la **liste** (`<ul>`), une ligne de 72 px par entrée :
  - à gauche, **pastille de 48 px** : salon → cercle `--surface-2` avec `messages-square` couleur ciel (#7CC4FF) ; partage reçu → `FormatIcon` de la sorte dominante ; partage envoyé → `FormatIcon` avec la petite flèche `arrow-up` ; autour, l'anneau de temps `TimeRim` (temps restant sur la durée) ;
  - au centre, deux lignes : titre (libellé local, `<bdi>`, une ligne, troncature en fin : « Salon · rejoint le 14 nov. », « Partage reçu · 6 éléments · 142 Mo », « Votre partage · 3 éléments ») ; sous-titre `--text-2` : « S'efface dans 4 h 12 » (`Countdown`) ou « Expiré » (`StateChip`) ou « Détruit » ;
  - à droite : heure ou date de la dernière activité locale (`--fs-micro`, chiffres tabulaires) et, s'il y a lieu, puce « Créé par vous » ou « Rouvrir compte une ouverture » (`--fs-micro`, `--warn`) ;
  - entrée expirée ou détruite : opacité 0,55, action par glissement ou menu « Retirer de la liste » (`swipe.ts` existant, toujours doublé d'un bouton au clavier).
  - **Toucher une ligne** : salon → écran d'entrée du salon (mot de passe ; place rendue par la preuve de membre si elle existe) ; partage reçu → page d'ouverture (mot de passe) ; partage envoyé → `ShareCard` (vue `#m…`).
  - **Bouton flottant** « Nouveau » (`primary`, `plus`, 56 px, au-dessus de la barre d'onglets, zone sûre) → `Sheet` : « Envoyer des fichiers », « Écrire une note », « Créer un salon ».
  - **Barre d'onglets** (connecté) : « Accueil », « Envoyer », « Téléchargements », « Profil » (`TabBar`, `TabIcon` : `messages-square`, `arrow-up`, `download`, `user`).
- **Ordinateur (≥ 960 px)** : deux colonnes : liste à gauche (360 px, en-tête et filtres identiques), détail à droite (`ShareCard` complète, ou fiche du salon : libellé modifiable, temps restant, places, « Entrer dans le salon », « Détruire » si créé par vous ; vide : `EmptyArt` et « Choisissez un élément à gauche »). `TopNav` : « Mes partages » devient « Accueil » quand on est connecté.
- **Recherche** : filtre local sur les libellés (aucune requête), champ `TextField` `type="search"` qui remplace le titre ; Échap ferme.
- **États** : chargement → 6 lignes squelettes `aria-busy` ; vide → `EmptyArt`, « Rien pour l'instant », « Les liens que vous ouvrez, les salons que vous rejoignez et vos envois apparaissent ici. Les messages s'affichent dans le salon, pas ici. » et deux boutons « Envoyer quelque chose », « Créer un salon » ; coffre privé illisible → `Banner error` de §12.4 ; après une récupération par e-mail, `Banner info` : « Votre compte a été récupéré. Les liens et salons enregistrés seulement dans l'ancien coffre ne sont plus disponibles ; ceux de cet appareil sont revenus. »
- **Mouvement** : lignes décalées de 40 ms à l'arrivée (12 au plus), dissolution au retrait (§7.4) ; mouvement réduit : rien. Annonces : changement de filtre (« 4 salons »), retrait d'une ligne.

#### 21.15.2 Écran d'inscription (révise §12.1)

Champs inchangés, plus : vérification du pseudo pendant la saisie (après 400 ms sans frappe : « Disponible » en `--accent`, `check`, ou « Déjà pris » en erreur reliée au champ) ; l'étape « code de secours » est **retirée** ; après le code juste : « Compte créé. » ou les messages d'état de §21.3. Indice sous l'adresse : « C'est votre seul moyen de récupérer le compte : utilisez une adresse que vous gardez. »

#### 21.15.3 Profil (`/compte/profil`)

`AppShell`, colonne de 28 rem.
- **Avatar** 96 px centré (photo ou initiale), boutons « Changer la photo » (`secondary`, ouvre `AvatarPicker` : recadrage carré, aperçu, ré-encodage 256 × 256, ≤ 64 Ko, sans métadonnées) et « Retirer » (`ghost`).
- **Pseudo** : `TextField` avec vérification (« Disponible » / « Déjà pris ») et bouton « Enregistrer » ; indice : « Unique sur Shhgone. Proposé quand vous entrez dans un salon ; vous pouvez en changer pour chaque salon. » ; erreur `limit` : « Vous pourrez changer de pseudo demain. »
- **Carte « Votre compte »** (`--surface-1`, rayon `--r-lg`) : « Membre depuis le 14 novembre 2026 » ; palier (« Récent : 1 salon à la fois, 4 places, 24 h. Dès le 21 novembre : 3 salons, 10 places. » ou « Confirmé : 3 salons à la fois, 10 places. ») ; abonnement (« Gratuit » + lien « Voir les offres », ou « Plus, jusqu'au {date} ») ; si banni : `Banner warn` avec date et motif.
- **Note de confidentialité** (`--text-2`, `info`) : « Votre pseudo, votre photo et votre abonnement sont chiffrés, mais gardés de façon à pouvoir vous être rendus si vous oubliez votre mot de passe : le service peut donc les lire. Vos liens et la gestion de vos salons ne sont lisibles qu'avec votre mot de passe. » + lien « En savoir plus » (page Sécurité).
- Bouton « Paramètres » (`secondary`, `chevron-right`).

#### 21.15.4 Paramètres (`/compte`, remplace §12.4)

Liste de sections (`<section aria-labelledby>`, titres `--fs-h3`), chaque réglage sur une ligne de 56 px (libellé, valeur ou `Switch`, `chevron-right` pour une sous-page) :
1. **Profil** → `/compte/profil`.
2. **Adresse e-mail** → sous-page : adresse actuelle (exacte), nouvelle adresse, mot de passe, code de l'application si active, puis code reçu à la nouvelle adresse ; texte : « C'est votre seul moyen de récupérer le compte. Nous n'écrivons jamais à l'ancienne adresse. » ; pendant `recup_jusqu` : bouton désactivé avec la raison.
3. **Mot de passe** → sous-page : actuel, nouveau (10 caractères au moins), case « Déconnecter mes autres appareils » (cochée).
4. **Double authentification** : `Switch` ; activation (QR `QrCode`, secret groupé par 4 avec Copier, premier code) ; texte : « Si vous perdez ce téléphone, la récupération par e-mail prendra 7 jours. » ; demande de retrait en cours : `Banner warn` et « Annuler la demande ».
5. **Appareils** : liste de §8.5, « Déconnecter », « Déconnecter tous les autres appareils ».
6. **Confidentialité** : `Switch` « Proposer mon pseudo et ma photo dans les salons » (activé ; désactivé = « Me demander à chaque salon ») ; `Switch` « Garder les liens que j'ouvre dans mon accueil » ; `Switch` « Garder les salons que je rejoins » ; `Switch` « Historique des téléchargements sur cet appareil » ; `Switch` « Rester connecté sur cet appareil ».
7. **Abonnement** : état du pass, « Voir les offres » ; note R5.
8. **Langue** : sélecteur existant.
9. **Récupération** (texte seul) : ce qui est gardé et perdu après un mot de passe oublié (§21.2.1) ; « Gardez l'accès à votre boîte mail. »
10. **Vos données** : « Exporter mes données » (JSON fait sur l'appareil : données du serveur, profil, listes ; sans adresse) ; « Effacer les données de cet appareil » (`InlineConfirm`) ; « Sans connexion pendant 13 mois, ce compte est effacé. Nous ne pouvons pas vous prévenir : nous n'avons pas votre adresse. »
11. **Se déconnecter** (`secondary`).
12. **Supprimer le compte** (`danger`) → écran de §21.12 : liste de ce qui sera supprimé et de ce qui reste, case « Effacer aussi les données de cet appareil », mot de passe, `InlineConfirm` ; progression « Destruction de vos partages : 3 / 5 » (`LiveRegion`) ; fin : `DestroyedArt` et « Compte supprimé. »

#### 21.15.5 Historique des téléchargements (`/telechargements`, avec ou sans compte)

`AppShell` ; titre « Téléchargements » ; sous-titre `--text-2` : « Sur cet appareil seulement. Nous ne gardons rien : les fichiers sont dans le dossier Téléchargements de votre appareil. » ; ligne d'outils : `Switch` « Garder l'historique » et « Effacer tout » (`ghost` `danger`, `InlineConfirm` « Effacer tout l'historique de cet appareil ? »). Liste groupée par jour (« Aujourd'hui », « Hier », « 12 novembre »), lignes de 64 px : `FormatIcon` 40 px, nom (`<bdi>`, troncature au milieu, extension visible, `midname.ts`), taille, puce de source (« Partage reçu » / « Salon »), heure ; `IconButton` `x` « Retirer de l'historique ». Pied : « Les entrées de plus de 30 jours sont effacées. » États : vide (`EmptyArt`, « Aucun téléchargement pour l'instant. ») ; désactivé (« L'historique est désactivé » + « L'activer »). Onglet « Téléchargements » de la barre du téléphone, aussi sans compte (la barre a alors trois onglets : Envoyer, Mes partages, Téléchargements).

#### 21.15.6 Mot de passe oublié (`/compte/oubli`, remplace §12.3)

Étape 1 : adresse exacte (indice de §12.3) ; « Recevoir un code ». Étape 2 : code ; si demandé : code de l'application et lien « Je n'ai plus mon application » (→ texte d'attente de §21.2.4). Étape 3 : nouveau mot de passe ; `Banner info` avant de valider : « Votre pseudo, votre photo, votre abonnement et vos salons en cours sont gardés. Les liens et la gestion de salons enregistrés seulement dans votre ancien coffre seront perdus, sauf s'ils sont encore sur un de vos appareils. » ; « Changer le mot de passe ».

#### 21.15.7 Signalement avec catégories (`ReportSheet`, partage et salon)

`Sheet` (`<dialog>`) titre « Signaler ». Étape 1 : « Que se passe-t-il ? » ; liste des 10 catégories en **boutons radio larges** (`role="radiogroup"`, ligne de 56 px : libellé `--fs-body` et texte d'aide `--fs-small` `--text-2`, flèches clavier, sélection par fond `--accent-tint` et coche, jamais la couleur seule) ; bouton « Continuer » (désactivé tant que rien n'est choisi, avec la raison). Étape 2 : rappel de la catégorie (« Harcèlement · Modifier »), texte : partage — « Le partage sera détruit tout de suite pour tout le monde. Nous ne voyons pas le contenu et ne gardons que la catégorie, sans rien qui vous identifie. » ; salon — « Vous quitterez le salon. Nous ne voyons pas les messages ; nous comptons ce signalement pour ce salon, sans rien qui vous identifie. » ; pour les codes 1 et 2, `Banner warn` : « Vous pouvez aussi le signaler aux autorités : PHAROS, internet-signalement.gouv.fr. Pour que nous puissions agir sur le contenu, envoyez-nous le lien par la page Signaler un abus. » (deux liens, `noopener noreferrer`) ; boutons « Signaler et détruire » / « Quitter et signaler » (`danger`) et « Annuler » (`ghost`, focus par défaut). Fin : « Merci. Signalement envoyé. » (`LiveRegion`).

### 21.16 Ce que voit le serveur (complète et corrige §14)

| # | Changement |
|---|---|
| S66 | inchangée |
| S72 | **remplacée** : deux coffres (profil, privé), tailles au palier, écritures en direct |
| S73 | **complétée** : bannis avec identifiant, début, échéance, état, motif (catégorie), salons fermés |
| S75 | **Profil séquestré** : pseudo, photo, langue, réglages, abonnement lisibles par qui a `K_serveur` (serveur en marche, vol de la machine) — exception R2 |
| S76 | **Empreinte du pseudo** : unicité ; `p_canon` en clair dans la requête, jamais gardé |
| S77 | **Signalements par catégorie** : compteurs en mémoire ; catégories par salon vivant, en mémoire jusqu'à sa fin |
| S78 | **Attentes de sécurité** : `recup_jour`, `totp_retrait_jour` (au jour) |
| S79 | **Sauvegardes** : copies chiffrées 30 jours chez un tiers (qui voit taille et heure d'envoi) |
| S80 | **Rejeu de suppression** : en direct, une même connexion détruit N partages juste avant de supprimer le compte |
| S81 | **Liste des salons du compte** (`GET salons`) : déjà déductible de S68 ; `ref` éphémère en mémoire |

### 21.17 Tests bloquants ajoutés (complète §14 et §15)

- `compte-sees-nothing` : pseudo repère (affiché et canonique) absent de `comptes.db`, du WAL, des sorties et des réponses (sauf `blob_profil` chiffré) ; photo repère absente ; `s_profil` jamais en clair sur disque (seul `cle_profil`) ; **e-mails reçus par le faux SMTP égaux octet pour octet au modèle unique** (code seul) dans tous les cas : adresse libre, prise, bannie, récupération, nouvelle adresse ; aucun repère de lien (`K_lien`, `#c`) dans `comptes.db` hors `blob_prive` chiffré ; réponses du tableau de bord sans adresse, `e_canon`, `h`, `p_empreinte` ni pseudo ; fichier de sauvegarde commençant par `age-encryption.org/v1` et sans aucun repère ; `destroy` d'un partage avec catégorie : la base ne garde aucune catégorie.
- `TestSequestreSeulementProfil` : `cle_profil` ouvre `B_profil`, jamais `B_prive` ; aucune route ne rend `K_compte` ni de quoi ouvrir `B_prive`.
- `TestEmailModeleUnique` (Go) : un seul modèle ; tout autre modèle est une erreur de compilation (aucun type `ModeleDejaInscrit`, `ModeleBanni`, `ModeleAdresseChangee`).
- `TestRecuperationGardeProfil`, `TestRecuperationVideCoffrePrive`, `TestAttente7Jours` (adresse et suppression refusées), `TestRetraitTOTPApres7Jours`, `TestRetraitTOTPAnnuleParConnexion`.
- Site : `history` (sortes, fusion, `origine`), `downloads` (chiffré au repos, 30 jours, rien sur le réseau : test de sources, aucun `fetch` dans `web/src/downloads/`), `ReportSheet` (10 catégories, aucune requête avant « Signaler »), accueil (aucune requête au chargement ; relecture ≤ 1 par 5 min par entrée).

### 21.18 Cadre légal ajouté (pour le juriste ; complète §16)

| Sujet | Proposition | Gravité |
|---|---|---|
| Séquestre du profil | base légale contrat ; information claire (page Confidentialité, profil) ; mesure de sécurité art. 32 (clé hors base) | Moyenne |
| Signalements, contenus terroristes et pédocriminels | R15 ; procédure écrite ; TCO (point de contact, une heure, conservation) ; PHAROS | **Élevée** |
| Motif du bannissement | DSA art. 17 contre RGPD art. 10 (R16) | Moyenne |
| Durée de bannissement allongée | proportionnalité ; 5 ans au plus proposés | Moyenne |
| Sauvegardes | durée 30 jours, information, art. 17 (effacement différé dans les copies), sous-traitant de stockage (art. 28), hors de l'UE interdit | Moyenne |
| Attente de 7 jours avant suppression après récupération | art. 12.3 (un mois) ; raison de sécurité écrite | Faible |
| Historique des téléchargements et listes sur l'appareil | stockage local à la demande (ePrivacy, strictement nécessaire au service demandé ; réglage pour le couper) | Faible |

Textes publics à ajouter à ceux de §16 : page Confidentialité, bloc « Si vous créez un compte » complété (séquestre du profil, deux coffres, sauvegardes 30 jours, catégories de signalement, motif de bannissement, attente de 7 jours) ; page Sécurité, « Ce que le compte ne protège pas » complété (la boîte mail est la clé ; le service peut lire le profil ; un pseudo ne prouve pas une identité).

### 21.19 Décisions qui restent au propriétaire (remplace §20 ; recommandation)

1. **R-D1 — Séquestre du profil, exception écrite à CLAUDE.md** : pseudo, photo, langue, réglages et abonnement récupérables par e-mail donc lisibles par le serveur ; gestion des salons, liens reçus, salons rejoints et partages créés chiffrés par le mot de passe seulement, perdus après une récupération par e-mail sauf copie sur un appareil. **Recommandé : oui** (seule façon de tenir la décision 1 sans donner au serveur le pouvoir de lire les conversations).
2. **R-D2 — Double authentification perdue et boîte mail volée** : retrait par e-mail après 7 jours, annulable ; 7 jours sans changement d'adresse ni suppression après une récupération. **Recommandé : oui.**
3. **R-D3 — Signalements par catégorie** (10 catégories de §21.10.1 ; compteurs en mémoire ; liste des salons signalés en cours au tableau de bord ; motif gardé avec le bannissement) : remplace le booléen validé. **Recommandé : oui, après l'avis du juriste** sur TCO, LCEN et DSA (R15, R16).
4. **R-D4 — « Liens partagés avec lui » = liens qu'il a ouverts**, pas d'envoi à un pseudo ; pseudo du compte proposé (modifiable) dans chaque salon. **Recommandé : oui** ; un envoi à un pseudo apprendrait au serveur qui écrit à qui.
5. **R-D5 — Sauvegarde** : chaque jour, `comptes.db` seule, chiffrée par age vers la clé de l'exploitant, stockage UE chez un autre fournisseur en écriture seule, 30 jours, restauration testée chaque mois. **Recommandé : oui.**

Restent ouvertes de §20, inchangées : D1 (fournisseur d'e-mail : Scaleway TEM recommandé), D4 (signalement qui remet l'ancienneté à zéro : oui), D7 (« Rester connecté » décoché : oui), D8 (ouverture au public après le juriste). Tranchées : D3 (3 ans, modifiable, §21.11), D5 (suppression totale, §21.12), D6 (§21.13). Caduque : D2.

## Décisions du propriétaire (14 novembre, après la v2)

Validées telles que recommandées : (1) profil (pseudo, photo, langue, abonnement) lisible par le serveur, exception écrite à CLAUDE.md ; (2) les deux attentes de 7 jours après une récupération ; (3) catégories de signalement, après l'avis du juriste ; (4) pas d'envoi d'un lien « à un pseudo » ; (5) sauvegarde quotidienne chiffrée chez un autre fournisseur, restauration essayée chaque mois.

**Suppression du compte, simplifiée** (décision du propriétaire) : on supprime ce dont la personne est l'auteur ou l'admin : ses salons créés (lien compte ↔ salon déjà connu du serveur) et ses partages créés (liste chiffrée du coffre ou de l'appareil, rejouée à la suppression ; un partage absent de ces listes s'efface de toute façon à son échéance, 24 h ou 7 jours au plus). Rien de plus n'est promis : les messages laissés dans le salon d'autrui suivent la fin de ce salon. Aucun lien compte ↔ partage n'est ajouté côté serveur.
