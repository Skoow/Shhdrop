# Shhdrop — spécification V1 (version 2, finale à valider)

Date : 4 novembre 2026 · Domaine visé : **shhdrop.app**
Historique : v1 du 3 novembre, puis revue critique indépendante et passage complet de recherche d'oublis (voir section 0). v2.4 (4 novembre) : durcissement après l'audit « sharp edges » (section 25).

---

## 0. Ce qui a changé depuis la v1, et décisions par défaut

### Décisions prises par défaut (modifiables d'un mot)

| # | Décision | Choix par défaut | Raison |
|---|---|---|---|
| D1 | Mode « lecture seule » | **Retiré** | Contournable (appui long, outils du navigateur) ; donnait une fausse impression de sécurité |
| D2 | Chiffrement de la base (SQLCipher) et du disque (LUKS) | **Retirés** (option A) | Leur clé serait sur le même serveur pour qu'il redémarre seul ; la base ne contient que des données inexploitables sans le lien. Option B possible : disque chiffré déverrouillé à la main après chaque redémarrage |
| D3 | Mise à jour automatique du site depuis GitHub | **Remplacée** par un script `deploy.sh` lancé à la main (image épinglée par empreinte) + mises à jour de sécurité automatiques du système | Moins de complexité, et le serveur ne va pas chercher du code tout seul |
| D4 | Calcul anti-robot (preuve de travail) | **Reporté** | Peu efficace contre un attaquant équipé ; les limites par connexion et les quotas suffisent pour la V1 |

### Principales corrections de la v1

- Jeton de téléchargement **par ouverture** (deux destinataires simultanés ne se bloquent plus).
- Envoi **borné** : place réservée à la création, tout dépassement refusé.
- **Clé d'accès** tirée du lien : l'identifiant seul ne permet plus de détruire un partage.
- Compteurs **atomiques** imposés en base.
- **Date de création** non stockée : dates enregistrées arrondies au quart d'heure, dates du fichier remises à zéro ; le système de fichiers garde toutefois des dates de naissance et de changement que l'application ne peut pas effacer (section 18).
- **Effacement sécurisé** dans SQLite.
- **Pas de service worker** (pas de mode hors ligne) : une promesse de la v1 était techniquement fausse.
- Vidéo lue **après** téléchargement complet ; lecteurs natifs du navigateur.
- Orientation des photos conservée lors du retrait des métadonnées.
- Ajouts : modèle de menaces, accessibilité, sécurité des comptes du propriétaire, plan d'incident, noms de fichiers piégés, réputation du domaine, bande passante, cadre légal précisé.

---

## 1. En une phrase

Shhdrop est un **site web installable sur téléphone (PWA)** qui permet d'envoyer du **texte, des photos, des vidéos, des messages vocaux et des documents** à une personne, **sans compte**, par un **lien chiffré de bout en bout** protégé par un mot de passe, qui **s'autodétruit** au bout d'un temps choisi ou après un nombre d'ouvertures choisi. Le serveur ne peut jamais lire ce qui est envoyé.

### Pourquoi

Les messageries chiffrent le transport, mais le contenu reste sur les téléphones et dans les sauvegardes (WhatsApp, iCloud…). Avec Shhdrop, il ne reste dans la conversation qu'un **lien mort** : une fois expiré, ouvert ou détruit, il ne mène plus à rien et le contenu n'existe plus sur le serveur.

### Pour qui

Ouvert à tous, sans inscription. Usage personnel au départ, ouverture publique ensuite (après les vérifications légales de la section 17).

### Ce qui définit la réussite

1. Le contenu, les noms de fichiers, le mot de passe et la clé du lien sont **invisibles pour le serveur**, prouvé par des tests automatiques (section 14).
2. Un lien expiré, détruit ou épuisé **ne donne plus accès à rien**, et les données sont effacées.
3. Le destinataire peut **lire, écouter, regarder ou télécharger** sur le site, sur iPhone, Android et ordinateur.
4. Le service **tourne seul** au quotidien (nettoyage, HTTPS, mises à jour système, alertes).

---

## 2. Modèle de menaces

| Adversaire | Ce qu'il peut faire | Ce que Shhdrop garantit |
|---|---|---|
| Observateur réseau (Wi-Fi public, FAI) | Voir le trafic | HTTPS obligatoire ; contenu déjà chiffré |
| Proxy d'entreprise / inspection TLS | Voir le chemin du lien (identifiant), pas le `#` | Sans la clé d'accès, ni infos ni destruction possibles |
| Hébergeur, administrateur du serveur, pirate du serveur | Lire disque, base, mémoire | Contenu, noms, mot de passe et clé jamais présents ; seules des empreintes inexploitables sans le lien |
| Voleur de sauvegarde (WhatsApp, iCloud) qui récupère le lien | Ouvrir le lien | Mot de passe obligatoire, envoyé par un autre canal ; lien mort après usage |
| Voleur du lien **et** de la base | Essayer des mots de passe hors ligne | Argon2id (coûteux) + mots de passe forts par défaut |
| Inconnu qui tape des mots de passe | Deviner en ligne | 5 essais puis destruction ; nécessite déjà la clé d'accès |
| Destinataire malveillant | Copier ce qu'il reçoit | **Non protégé** (limite assumée, section 18) |
| Abuseur (spam, malware, contenus illicites) | Utiliser le service | Limites, quotas, durée maximale de 24 h, signalement, destruction par l'admin |
| Attaquant du code du site (serveur piraté, dépôt GitHub compromis) | Servir un site piégé qui vole les clés | Comptes du propriétaire protégés (section 15.4), CSP stricte, dépendances minimales et verrouillées. **Limite résiduelle assumée** (section 18) |
| Saturation (déni de service) | Remplir le disque, épuiser la bande passante | Place réservée et bornée, quotas par connexion, limite de débit, plafond global |

---

## 3. Périmètre

### Dans la V1

- Partage jusqu'à 10 éléments : texte, fichiers, photo prise sur place, vocal enregistré sur place.
- Chiffrement de bout en bout dans le navigateur, mot de passe obligatoire (généré par défaut).
- Lien de partage + lien de gestion privé pour l'expéditeur.
- Destinataire : compte à rebours, déverrouillage, lecture sur le site (image, audio, vidéo, texte, PDF), téléchargement, destruction, signalement.
- Fin de vie automatique (temps, ouvertures, 5 mots de passe faux, destruction, signalement).
- Limites par connexion et quotas de stockage.
- PWA installable (sans mode hors ligne), français et anglais, clair et sombre, accessible.
- Serveur autonome au quotidien, commandes d'administration, alertes simples.
- Pages : accueil, comment ça marche / sécurité, mentions légales, confidentialité, CGU, contact et signalement, `security.txt`.

### Plus tard

- Adresse Tor (.onion) · App Store / Play Store (préparée, section 16) · calcul anti-robot (D4) · partage depuis la galerie Android (exigerait un stockage en clair sur le téléphone) · aperçu Word/Excel · lecture vidéo pendant le téléchargement · autres langues · audit externe (obligatoire avant ouverture large).

### Jamais

- Comptes, profils, contacts · publicité, analytics, traceurs, ressources tierces · tout mécanisme permettant au serveur de lire un contenu.

---

## 4. Règles et limites

| Règle | Valeur V1 |
|---|---|
| Éléments par partage | 10 maximum |
| Taille par partage | 1 Gio de contenu utile (16 384 morceaux de 64 Kio) ; le fichier chiffré fait 48 + 16 384 × 65 552 = 1 074 004 016 octets (§24) |
| Durée de vie | au choix 1 h, 6 h, 12 h, 24 h ; comptée **à partir de la fin de l'envoi** ; expiration arrondie au **quart d'heure supérieur** |
| Ouvertures | au choix 1 à 10 ; **une ouverture = un déverrouillage réussi** (recharger la page en consomme une, c'est affiché) |
| Fin de vie | le premier atteint : durée, ouvertures épuisées, destruction (expéditeur, destinataire, administrateur), signalement, 5 mots de passe faux |
| Mot de passe | obligatoire ; généré par défaut : **4 mots** tirés d'une liste de 7 776 mots (≈ 52 bits) ; personnalisé : 12 caractères minimum et absent d'une liste noire des mots de passe courants (contrôle côté navigateur : le serveur ne peut pas le vérifier) |
| Essais de mot de passe | 5 ratés → destruction |
| Création de partages | 10 par jour par connexion (IPv4, ou bloc IPv6 /64) ; 30 par jour par bloc /48 ; 3 Gio utiles par jour par connexion et 6 Gio par bloc /48 (§24) |
| Limite de débit | 60 requêtes par minute par connexion sur les routes publiques ; les envois et téléchargements de segments porteurs d'un jeton valide ont leur propre limite, 600 par minute par connexion (§24) ; un segment au jeton invalide compte dans les 60 |
| Stockage total | plafond configurable (100 Gio par défaut), **réservé à la création** ; au-delà, nouveaux envois refusés |

---

## 5. Parcours

### 5.1 Expéditeur

1. **Composer** : fichiers, photo, vocal, texte ; aperçu, ✕ pour retirer, jauge « 34 / 100 Mo · 3 / 10 ».
   - Métadonnées des photos retirées (section 12) ; avertissement pour vidéos et PDF, non nettoyés.
2. **Options** : durée, nombre d'ouvertures, mot de passe (généré, régénérable, modifiable, indicateur de force).
3. **Envoi** : chiffrement puis envoi par segments, progression, reprise automatique si le réseau coupe. La reprise ne fonctionne **que dans le même onglet** : fermer l'onglet abandonne l'envoi, qui compte quand même dans la limite du jour et est effacé au bout de 15 min sans nouveau segment (5 à 20 min s'il n'en a reçu aucun ; 3 h au plus).
4. **Lien prêt**, affiché seulement quand l'envoi est entièrement terminé :
   - lien (Copier, Partager, QR code) ;
   - mot de passe (Copier), avec le rappel : « Envoie-le par un **autre moyen** que le lien. Les deux dans la même messagerie, c'est comme ne pas en mettre » ;
   - lien de gestion (Copier) ;
   - « Vider le presse-papier », avec la mention honnête « ne vide pas l'historique du clavier ni le presse-papier partagé entre appareils » ;
   - « Ces informations ne seront plus jamais affichées ».
5. **Gestion** (lien privé) : « Ouvert 1 / 3 · Expire dans 4 h 15 », bouton « Détruire maintenant ». Quand le partage n'existe plus, la page affiche « Supprimé », sans pouvoir en donner la raison.

### 5.2 Destinataire

1. **Ouverture** : « Quelqu'un vous a envoyé un partage chiffré. Shhdrop ne vérifie pas l'identité de l'expéditeur. »
   - Compte à rebours, champ mot de passe, « Déverrouiller », essais restants affichés en cas d'erreur.
   - Avertissement si la page est ouverte dans le navigateur intégré d'une app (Instagram, Facebook…), qui peut espionner la page : « Ouvrez ce lien dans votre navigateur ».
2. **Contenu** : liste des éléments, lecture sur le site (section 12), téléchargement, bandeau « Disponible encore 5 h 31 · disparaît quand vous quittez la page · recharger consomme une ouverture », boutons « Détruire maintenant » et « Signaler ».
3. **Lien invalide** : message unique, quelle que soit la raison : « Ce lien n'existe pas ou n'est plus disponible ».

### 5.3 Hygiène du lien

Dès que le navigateur a lu la partie secrète (après le `#`), il la **retire de la barre d'adresse** (`history.replaceState`), chez l'expéditeur comme chez le destinataire, pour qu'elle ne reste pas dans l'historique synchronisé.

---

## 6. Architecture

```
Navigateur expéditeur ──(chiffré)──► Caddy ──► Serveur Shhdrop (Go) ──(chiffré)──► Navigateur destinataire
 chiffre localement                 HTTPS      stocke + applique les règles         déchiffre localement
 clés dans le # du lien                         ne voit jamais les clés              clés lues dans le #
```

| Partie | Choix | Raison |
|---|---|---|
| Serveur | **Go**, un binaire statique, sans CGO | Sûr, rapide, build simple |
| Base | **SQLite** via `modernc.org/sqlite` (Go pur), `secure_delete=ON`, WAL vidé chaque minute | Un fichier, rien à administrer |
| Fichiers | Un fichier par partage, taille réservée, écriture à position fixe ; derrière une interface interchangeable | Bornage strict ; passage possible à un stockage externe |
| Site | **TypeScript + Svelte + Vite**, PWA sans service worker | Léger ; aucune persistance de code piégé |
| Crypto navigateur | **WebCrypto** (AES-256-GCM, HKDF-SHA-256, HMAC, SHA-256) + **libsodium.js** (Argon2id seulement) | Standards reconnus, aucune crypto maison |
| PDF | **pdf.js** dans une zone isolée | Lecture des PDF sur le site sans exécuter leur code |
| HTTPS / déploiement | **Docker + Caddy** | Certificats automatiques, portable |
| Hébergement | Hors UE (Suisse ou Islande de préférence), à choisir à la mise en ligne | Voir sections 15 et 17 |

### Organisation du dépôt

```
shhdrop/
├── server/
│   ├── cmd/shhdrop/        # serveur + commandes admin (freeze, wipe, destroy)
│   └── internal/
│       ├── api/            # routes, en-têtes de sécurité, IP de confiance, limite de débit
│       ├── share/          # règles d'un partage (création, envoi, déverrouillage, fin de vie)
│       ├── token/          # jetons signés (envoi, téléchargement)
│       ├── store/          # SQLite
│       ├── blob/           # fichiers chiffrés (réservation, écriture bornée, effacement)
│       ├── limits/         # quotas et limites par connexion
│       └── janitor/        # nettoyage, réconciliation au démarrage
├── web/src/
│   ├── crypto/             # clés, paquet chiffré, phrase de passe
│   ├── transfer/           # envoi et téléchargement par segments, reprise
│   ├── viewers/            # affichage image/audio/vidéo/texte, PDF isolé
│   ├── media/              # vocal, photo, retrait des métadonnées, noms de fichiers sûrs
│   ├── routes/             # écrans
│   └── i18n/               # fr, en
├── deploy/                 # docker-compose, Caddyfile, deploy.sh, scripts d'alerte
└── docs/
```

Chaque module a une responsabilité unique et des tests propres. `web/src/crypto` ne dépend d'aucun écran ; `server/internal/share` ne dépend pas du HTTP.

---

## 7. Modèle cryptographique

### 7.1 Clés

| Élément | Création | Où il vit |
|---|---|---|
| `K_lien` | 32 octets aléatoires | après le `#` du lien de partage ; jamais envoyé |
| `K_accès` | HKDF(`K_lien`, « shhdrop/v1/acces ») | envoyé au serveur pour lire `meta` et déverrouiller |
| `V_accès` | SHA-256(`K_accès`) | serveur |
| `sel` | 16 octets aléatoires | serveur (renvoyé par `meta`) |
| `K_mdp` | Argon2id(mot de passe, `sel`) : 64 Mio, 3 passes, 1 fil, 32 octets | navigateur |
| `K_maître` | HKDF(`K_lien` ‖ `K_mdp`, « shhdrop/v1/maitre ») | navigateur |
| `K_contenu` | HKDF(`K_maître`, « shhdrop/v1/contenu ») | navigateur |
| `K_preuve` | HKDF(`K_maître`, « shhdrop/v1/preuve ») | envoyé pour déverrouiller et détruire |
| `V_preuve` | SHA-256(`K_preuve`) | serveur |
| `C_engagement` | HMAC-SHA-256(`K_contenu`, « shhdrop/v1/engagement ») | en tête du paquet (en clair) |
| `S_gestion` | 32 octets aléatoires | après le `#` du lien de gestion |
| `V_gestion` | SHA-256(`S_gestion`) | serveur |

- Toutes les étiquettes HKDF et HMAC sont préfixées `shhdrop/v1/` (`acces`, `maitre`, `contenu`, `preuve`, `engagement`) : un changement de version change toutes les clés.
- Le navigateur **refuse** des paramètres Argon2id inférieurs au minimum ci-dessus, même si le serveur les propose.
- Les paramètres visent environ 1 s sur un téléphone d'entrée de gamme ; ils sont versionnés.

### 7.2 Pourquoi c'est solide

- Lire un contenu exige **le lien ET le mot de passe**.
- Sans `K_lien` (256 bits), la base et les fichiers volés ne servent à rien.
- Avec le lien **et** la base, seuls des essais hors ligne contre `V_preuve` restent possibles, ralentis par Argon2id ; d'où les mots de passe forts par défaut.
- En ligne : il faut déjà `K_accès`, puis 5 essais seulement.
- `C_engagement` empêche un serveur malveillant de faire déchiffrer un paquet fabriqué pour plusieurs clés.

### 7.3 Le paquet chiffré

- **En-tête en clair** (48 octets) : « SHH1 », version, `C_engagement`.
- **Contenu chiffré** = longueur du manifeste (4 octets) + **manifeste** + données des éléments + **bourrage de zéros**.
- **Manifeste** (JSON, 64 Kio maximum) : pour chaque élément, type, nom de fichier, type MIME, taille, position ; textes jusqu'à 10 000 caractères inclus directement.
- **Morceaux crypto** de 64 Kio, AES-256-GCM avec `K_contenu`, principe STREAM :
  - nonce de 12 octets = numéro du morceau (11 octets) + drapeau « dernier morceau » (1 octet) ;
  - données authentifiées = en-tête ;
  - tout morceau modifié, retiré, déplacé ou ajouté est détecté.
- **Paliers de taille**, en nombre de morceaux : 1, 16, 80, 160, 400, 800, 1 600, 4 000, 8 000, 16 384 (de 64 Kio à 1 Gio, §24). Le serveur ne connaît que le palier, donc ni les noms, ni les types, ni le nombre d'éléments, ni la taille exacte.
- **Palier canonique** : à l'ouverture, le navigateur vérifie que le palier annoncé par le serveur est exactement celui que le chiffrement aurait choisi pour le contenu décrit par le manifeste (authentifié) ; sinon, paquet corrompu. Avec la taille exacte de chaque segment et le drapeau « dernier morceau », un serveur ne peut ni tronquer le paquet ni changer son palier.
- **Lecture en flux** : le navigateur ne déchiffre que les morceaux dont il a besoin. Les morceaux jamais lus ne sont pas vérifiés : le bourrage, et les éléments qu'on n'ouvre pas. Tout ce qui est montré ou enregistré est authentifié.
- **Enregistrement interrompu** : `saveItem` écrit au fil du déchiffrement ; si une erreur survient (paquet corrompu, réseau), l'écran doit **abandonner ou supprimer** le fichier partiel (`writable.abort()`) et ne jamais l'annoncer comme terminé.
- **Segments de transport** de 64 morceaux (4 Mio + tags) : un envoi ou un téléchargement par segment. La taille exacte de chaque segment se déduit du palier.

### 7.4 Envoi

1. `POST /api/shares` : durée, ouvertures, palier, `sel`, paramètres KDF, `V_accès`, `V_preuve`, `V_gestion`.
   - Le serveur vérifie les limites, **réserve** la place du palier et répond avec un identifiant (128 bits) et un **jeton d'envoi signé** (valable 3 h). `upload_deadline` = maintenant + 3 h, arrondi au quart d'heure supérieur.
2. `PUT /segments/{n}` : le serveur refuse tout `n` hors palier, toute taille inexacte et tout envoi après finalisation. Il écrit à la position exacte, et renvoyer un segment le remplace (reprise). Chaque segment reçu met à jour `progress_at` (minute du dernier segment, §9.1). Le navigateur chiffre chaque segment juste avant de l'envoyer et renvoie les mêmes octets en cas de nouvel essai : un segment n'est jamais rechiffré à partir du fichier.
3. `POST /finalize` : tous les segments sont présents → état `ready`, et `expires_at` = maintenant + durée, arrondi au quart d'heure supérieur.
4. Un envoi non finalisé à `upload_deadline` (3 h au plus) est effacé et sa place libérée. Un envoi qui n'a reçu **aucun segment** est effacé dès `upload_deadline` − 2 h 55 (5 à 20 min après la création selon l'arrondi) : une réservation vide ne bloque pas l'espace. La date de création n'est pas stockée : ce seuil se calcule à partir de l'échéance arrondie. Un envoi **bloqué** (aucun nouveau segment depuis 15 min, d'après `progress_at`) est effacé lui aussi.

### 7.5 Déverrouillage et téléchargement

1. `GET meta` (avec `K_accès`) : secondes restantes avant expiration, `sel`, paramètres KDF. Sans `K_accès` valide : réponse « introuvable », qui ne compte pas comme essai.
2. `POST unlock` (avec `K_accès` et `K_preuve`), traité en une seule requête SQL conditionnelle :
   - **Faux** : `failed_attempts = failed_attempts + 1 WHERE failed_attempts < 5` ; réponse avec les essais restants ; au 5ᵉ, destruction.
   - **Juste** : `opens_left = opens_left - 1, opens_issued = opens_issued + 1 WHERE state='ready' AND opens_left > 0 AND expires_at > now AND failed_attempts < 5`, et passage en `draining` avec `purge_at` = min(maintenant + 3 h arrondi au quart d'heure supérieur, `expires_at`) quand `opens_left` atteint 0. Le n° d'ouverture rendu (`opens_issued`) entre dans un **jeton de téléchargement signé**, propre à cette ouverture, valable 3 h et plafonné à `expires_at`.
3. `GET /segments/{n}` (avec le jeton) : refusé dès l'expiration du partage ou sa destruction (coupure nette), et pour une ouverture déjà terminée.
4. `POST done` (avec le jeton) : pose le bit de cette ouverture dans `done_mask` (idempotent : un `done` rejoué ne change rien) ; le jeton de cette ouverture ne lit plus aucun segment.
5. Quand `opens_left = 0` (état `draining`), plus aucun déverrouillage n'est possible. Le partage est effacé dès que toutes les ouvertures émises sont terminées (nombre de bits de `done_mask` = `opens_issued`), au plus tard à `purge_at`.

### 7.6 Destruction et signalement

- `POST destroy` avec `K_preuve` (destinataire) ou `S_gestion` (expéditeur), ou `shhdrop admin destroy <lien>` (administrateur, pour un signalement reçu par e-mail).
- « Signaler » = destruction, avec le motif compté **en mémoire** (compteur agrégé, pour les alertes).
- La destruction invalide immédiatement tous les jetons. On efface d'abord le fichier, puis la ligne en base.

### 7.7 Jetons

- Jeton = HMAC-SHA-256(secret serveur, type ‖ id ‖ n° d'ouverture ‖ expiration).
- Le serveur ne stocke pas les jetons, mais revérifie l'état du partage à chaque usage.
- Le secret est généré au démarrage et gardé en mémoire : un redémarrage invalide les envois et téléchargements en cours (le navigateur l'indique).

---

## 8. API du serveur

Toutes les réponses : JSON, `Cache-Control: no-store`, erreurs uniformes pour « inexistant / expiré / détruit / mauvaise clé d'accès ».

| Route | Rôle | Authentification |
|---|---|---|
| `POST /api/shares` | Création + réservation | limites par connexion |
| `PUT /api/shares/{id}/segments/{n}` | Envoi d'un segment | jeton d'envoi |
| `POST /api/shares/{id}/finalize` | Activation | jeton d'envoi |
| `GET /api/shares/{id}/meta` | Secondes restantes, sel, KDF | `K_accès` (en-tête) |
| `POST /api/shares/{id}/unlock` | Déverrouillage | `K_accès` + `K_preuve` |
| `GET /api/shares/{id}/segments/{n}` | Téléchargement | jeton de téléchargement |
| `POST /api/shares/{id}/done` | Fin de téléchargement | jeton de téléchargement |
| `POST /api/shares/{id}/destroy` | Destruction / signalement (motif) | `K_preuve` ou `S_gestion` |
| `GET /api/shares/{id}/status` | Ouvertures, secondes restantes | `S_gestion` |
| `GET /healthz` | Santé (local uniquement) | — |

- Les secrets passent dans des **en-têtes ou le corps**, jamais dans l'URL.
- **IP de confiance** : le serveur écoute uniquement en local ; il ne croit que l'en-tête posé par Caddy (`X-Shh-Client-IP`) et ignore tout `X-Forwarded-For` venu du client. L'en-tête n'est cru que d'un pair de confiance : boucle locale, ou réseau listé dans `SHH_TRUSTED_PROXY`. Un test le vérifie.
- **JSON strict** : un corps qui contient une clé en double ou une clé de casse différente (`PROOF`, `pRoOf`) est refusé (400) avant le décodage. Les secrets et identifiants base64url doivent avoir leur longueur exacte en caractères (22 ou 43), sans `\r` ni `\n`.

**Configuration (variables d'environnement, vérifiées au démarrage ; toute erreur arrête le serveur) :**

| Variable | Règle |
|---|---|
| `SHH_DATA_DIR` | obligatoire, **chemin absolu**, sans `?`, `#` ni `%`. Un dossier existant doit être vide (premier démarrage) ou contenir `shares.db` **et** `blobs/` ; sinon refus, sans toucher aux droits ni aux fichiers |
| `SHH_LISTEN` | `hôte:port` numérique, par défaut `127.0.0.1:8080`. Hors boucle locale (`127.0.0.0/8`, `::1`, `localhost`), refusé sauf si `SHH_BEHIND_PROXY=1` **et** `SHH_TRUSTED_PROXY` sont donnés (cas Docker du Plan 3) |
| `SHH_BEHIND_PROXY` | `0` ou `1`. À `1` : toute requête `/api/` sans `X-Shh-Client-IP` valide, ou venue d'un pair qui n'est pas un proxy de confiance, reçoit 500 ; les fichiers creux sont refusés (voir `SHH_STORAGE_MAX`) |
| `SHH_TRUSTED_PROXY` | liste de CIDR canoniques séparés par des virgules (ex. `172.18.0.0/16`), jamais `/0` ; exige `SHH_BEHIND_PROXY=1`. La boucle locale reste toujours de confiance |
| `SHH_STORAGE_MAX` | entier décimal > 0 (chiffres seuls), 100 Gio par défaut. Au démarrage : `SHH_STORAGE_MAX` ≤ espace libre (`statfs`) + place déjà réservée − 1 Gio, sinon refus. Avec `SHH_BEHIND_PROXY=1`, une sonde vérifie que `fallocate` fonctionne ; sans allocation réelle, les créations sont refusées (507) |
| `SHH_STATIC_DIR` | chemin absolu ; le dossier et son `index.html` doivent exister. Vide : page d'attente |
- **Délais réseau** : lecture et écriture limitées (protection contre les connexions lentes), corps de requête plafonnés à la taille exacte attendue.

---

## 9. Données stockées

### 9.1 Base

Table `shares`, une ligne par partage vivant :

`id` (clé primaire, table `WITHOUT ROWID` : aucun compteur d'insertion ne trahit l'ordre de création), `state` (`uploading`, `ready`, `draining`), `bucket` (palier), `ttl_hours`, `max_opens`, `opens_left`, `opens_issued`, `done_mask` (un bit par ouverture terminée), `failed_attempts`, `segments_mask` (segments reçus), `salt`, `kdf_ops`, `kdf_mem`, `access_v`, `proof_v`, `manage_v` (SHA-256 de `K_accès`, `K_preuve`, `S_gestion`), `upload_deadline` (effacé à la finalisation), `progress_at` (pendant l'envoi seulement), `expires_at`, `purge_at`.

- Toutes les dates stockées sont **arrondies au quart d'heure supérieur**, sauf `progress_at`.
- `progress_at` : minute du dernier segment reçu, pour effacer un envoi bloqué (§7.4). Il n'existe **que pendant l'envoi** : `NULL` à la création (la minute de création n'est donc jamais écrite), mis à jour à chaque segment, remis à `NULL` à la finalisation comme `upload_deadline`. Pendant l'envoi, il donne à la minute près l'heure du dernier segment reçu.

- **Jamais stockés** : adresse IP, date de création, nom, type ou taille exacte de fichier, navigateur, pays, jetons.
- La ligne est supprimée quand le partage meurt. `secure_delete=ON`, `temp_store=MEMORY` et vidage du WAL chaque minute : rien ne reste dans le fichier de base (vérifié par le test « le serveur ne voit rien » après destruction et arrêt).

### 9.2 Fichiers

- Un fichier par partage, à la taille exacte du palier, contenant uniquement du chiffré : aucun fichier en clair n'existe jamais, même temporaire.
- Place réellement réservée sur le disque à la création (`fallocate` sous Linux, sinon fichier creux).
- **Dates d'accès et de modification du fichier remises à zéro** à chaque écriture (`Chtimes`). Le système de fichiers garde en revanche la date de naissance et la date de changement (ctime) du fichier, que l'application ne peut pas effacer : elles ne sont lisibles que par qui accède au volume déverrouillé, serveur en marche (section 18).
- Droits resserrés à chaque démarrage : dossiers en 0700, base et fichiers annexes en 0600.
- **Aucune sauvegarde** de ce dossier.
- Au démarrage, une **réconciliation** efface les fichiers sans ligne et les lignes sans fichier.

### 9.3 En mémoire uniquement

- Compteurs des limites : clé = HMAC(secret du jour, IP, /64 ou /48), effacés chaque jour. Ce sont des **données pseudonymisées** au sens du RGPD, pas anonymes.
- Secret des jetons, compteur agrégé des signalements.

### 9.4 Journaux

- Journaux d'accès de Caddy **désactivés**.
- Journaux de l'application : uniquement des événements sans donnée personnelle.

---

## 10. Sécurité du site web

- **En-têtes** :
  - CSP : `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`.
  - `require-trusted-types-for 'script'` **si** Svelte et libsodium le supportent sans politique « default » (testé au premier jour) ; sinon retiré.
  - `Strict-Transport-Security` (déjà préchargé pour .app), `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.
  - `Permissions-Policy: microphone=(self), camera=(), geolocation=()`. La photo passe par le sélecteur de fichiers, sans accès direct à la caméra.
  - `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`. Pas de COEP : inutile, Argon2id tourne sur un seul fil.
- **Aucune ressource tierce.** `robots.txt` et `noindex` sur les pages de partage, sans aperçu pour les messageries.
- **Fichiers du site** : servis depuis `SHH_STATIC_DIR` sans jamais en sortir (liens symboliques compris) ; fichiers et dossiers cachés (`.env`, `.git/…`) → 404 ; aucune liste de dossier (dossier sans `index.html` → 404) ; `GET` et `HEAD` seulement. Application monopage : un chemin inconnu sans extension (`/s/<id>`, `/m/<id>`) sert `index.html` avec les mêmes en-têtes ; un fichier absent (`x.js`) → 404.
- **Origine attendue** : le client ne prend jamais l'adresse du serveur dans le lien. Chaque fonction reçoit l'origine du site (`location.origin`) et refuse un lien d'une autre origine ou qui contient des identifiants (`user:pw@`) ; l'origine doit être `https://hôte[:port]` exacte (http seulement pour `localhost`, `127.0.0.1`, `[::1]`). Cela protège aussi hors navigateur (Node, future appli, §16), où la CSP ne s'applique pas.
- **Secrets typés** : K_lien, K_accès, K_preuve et S_gestion ont des types TypeScript distincts ; envoyer K_lien au serveur ne compile pas. La couche HTTP n'est pas exportée par l'interface publique (`web/src/index.ts`).
- **Pas de service worker** : aucun code ne reste installé dans le navigateur entre deux visites.
- **Contenu déchiffré** : en mémoire, jamais dans le stockage du navigateur. Effacement **au mieux** (mise à zéro des tableaux, révocation des URL blob) : le navigateur ne garantit pas davantage.
- **Dépendances** minimales, versions verrouillées (`package-lock.json`, `go.sum`), installation reproductible (`npm ci`).
- **Navigateur sans WebCrypto** : refus clair. Rien n'est jamais envoyé en clair.

---

## 11. Anti-abus

- Limites et quotas de la section 4, appliqués par connexion, par /64 et par /48.
- Place réservée à la création, plafond global.
- Signalement depuis le contenu ; signalements par e-mail traités avec `admin destroy`.
- **Réputation du domaine** : si des liens Shhdrop servent à diffuser des malwares, Google Safe Browsing peut bloquer **tout** le domaine. D'où la réaction rapide aux signalements et le suivi des alertes. Plus tard, un domaine séparé pour les liens pourra être envisagé.
- Calcul anti-robot : reporté (D4).

---

## 12. Lecture et création de contenu

### Lecture

| Type | Affichage |
|---|---|
| Image (JPEG, PNG, WebP, GIF, AVIF) | `<img>` depuis une URL blob, plein écran, zoom natif |
| SVG | `<img>` uniquement (aucun script ne s'exécute) |
| Audio | `<audio controls>` natif |
| Vidéo (MP4, MOV, WebM) | `<video controls>` natif, **après** téléchargement complet |
| Texte | Affiché comme **texte brut** (jamais interprété comme HTML) |
| PDF | pdf.js dans une `iframe` sandbox **sans** `allow-same-origin`, données transmises par `postMessage`, scripts du PDF désactivés. **Prototype au début du projet** ; si c'est impossible à faire fonctionner de façon fiable, repli sur le téléchargement |
| HEIC | Affiché là où le navigateur le sait (Safari) ; sinon téléchargement |
| Autres | Téléchargement seulement |

- Le type affiché suit une **liste blanche** : un fichier déclaré « image » qui n'en est pas une n'est pas affiché. Dans le code, `Opened.previewKind(i)` rend `image` (JPEG, PNG, WebP, GIF, AVIF, HEIC, SVG — dans `<img>` seulement), `audio` (MPEG, MP4, AAC, Ogg, WebM, WAV), `video` (MP4, WebM, QuickTime), `pdf`, `text` (éléments texte) ou `none` (tout le reste, HTML compris, et tout élément de plus de 200 Mio). L'écran traite un échec de décodage comme `none`.
- Le nom et le type MIME du manifeste sont **bruts** (écrits par l'expéditeur) : jamais affichés ni utilisés tels quels. On utilise `Opened.safeName(i)` et `Opened.isRiskyFile(i)`.
- **Téléchargement** :
  - type `application/octet-stream`, toujours (`collectToBlob` ne prend plus de type) ;
  - **nom de fichier nettoyé** (`safeName`) : NFC ; caractères d'inversion de sens d'écriture retirés (U+202A–U+202E, U+2066–U+2069, U+200E, U+200F, U+061C ; anti-« facture‮fdp.exe ») ; contrôles C0/C1, `/` et `\` retirés ; espaces regroupés ; points initiaux retirés (fichier caché), points et espaces finaux aussi (Windows les retire) ; 120 points de code au plus, extension gardée ; « fichier » si rien ne reste ;
  - **avertissement** pour les fichiers exécutables ou dangereux (`isRiskyFile` : .exe, .msi, .bat, .cmd, .com, .scr, .ps1, .vbs, .js, .jar, .apk, .app, .dmg, .pkg, .sh, .html, .htm, .hta, .lnk, .iso).
- **Destruction et signalement après lecture** : `Opened.destroy("report")` réutilise K_accès et K_preuve gardés depuis l'ouverture, sans relire `meta` : possible même après la dernière ouverture (état `draining`). `wipe()` les met à zéro. La fin du téléchargement (`done`) part en `keepalive` pour survivre à la fermeture de la page.
- **Mémoire** : déchiffrement élément par élément, chiffré libéré au fur et à mesure ; avertissement sur les appareils qui manquent de mémoire.

### Création

- **Vocal** : `MediaRecorder`, en **AAC/MP4** quand c'est disponible (lisible partout), sinon Opus/WebM. Compatibilité testée sur iPhone, Android et ordinateur.
- **Photo** : sélecteur de fichiers (`<input capture>`).
- **Retrait des métadonnées**, sans réencodage :
  - JPEG : EXIF réécrit avec **seulement l'orientation**, profil de couleurs (ICC) conservé ;
  - PNG : blocs texte et EXIF retirés ;
  - WebP : EXIF et XMP retirés ;
  - HEIC et vidéos : non nettoyés, avec avertissement.

---

## 13. Gestion des erreurs

| Situation | Comportement |
|---|---|
| Réseau coupé pendant l'envoi | Reprise automatique au segment manquant (même onglet) |
| Onglet fermé pendant l'envoi | Envoi abandonné, effacé au bout de 15 min sans nouveau segment (3 h au plus), compte dans la limite du jour |
| Réseau coupé pendant le téléchargement | Reprise tant que le jeton (3 h) et le partage sont valides |
| Serveur redémarré pendant un transfert | Message « Le transfert a été interrompu, réessayez » |
| Mot de passe faux | « Mot de passe incorrect · N essais restants » ; destruction au 5ᵉ |
| Partage expiré pendant la lecture | Ce qui est déjà affiché reste visible jusqu'à la fermeture ; téléchargement coupé net |
| Limites atteintes | « Limite atteinte, réessayez dans X h » |
| Serveur plein | « Service temporairement saturé, réessayez plus tard » |
| Trop gros / trop d'éléments | Bloqué avant l'envoi, avec la raison |
| Navigateur trop ancien ou navigateur intégré | Refus clair / avertissement |
| Partage inexistant, expiré, détruit | Message unique |

Messages en français et en anglais.

---

## 14. Tests

### Automatiques (à chaque modification)

- **Unitaires** Go et TypeScript.
- **Crypto** : vecteurs officiels (AES-GCM, HKDF, HMAC, Argon2id) ; aller-retour sur tous les types et paliers ; morceau modifié, retiré, déplacé ou ajouté détecté ; mauvais engagement refusé ; paramètres KDF trop faibles refusés ; tirage de la phrase de passe sans biais.
- **Règles et concurrence** : expiration et arrondi ; ouvertures ; 5 essais **en parallèle** (jamais plus de 5) ; déverrouillages simultanés (jamais plus que N) ; deux destinataires qui téléchargent en même temps ; état `draining` ; destruction ; limites par connexion, /64 et /48 ; réservation et serveur plein ; segments hors palier ou de mauvaise taille refusés ; usurpation de `X-Forwarded-For` sans effet.
- **« Le serveur ne voit rien »** : un fichier contenant un mot repère, un nom de fichier repère, un mot de passe repère et une `K_lien` repère sont utilisés. Ensuite, la base (y compris les pages libres et le WAL), les fichiers, les journaux, les requêtes HTTP capturées et la mémoire exportée du processus sont fouillés. **Aucun repère ne doit apparaître. Ce test bloque toute mise en ligne.**
- **Après destruction** : les octets du partage ont disparu du fichier de base et du disque.
- **Sécurité web** : en-têtes et CSP vérifiés ; fichiers piégés (PDF avec script, SVG avec script, HTML) sans exécution ; noms de fichiers piégés nettoyés.
- **Parcours complets** (Playwright) : Chromium et WebKit, ordinateur et simulation iPhone / Android.
- **Analyse des dépendances** : `govulncheck`, `npm audit`, Dependabot.

### Manuels (avant chaque mise en ligne)

- Site de test séparé.
- Liste de vérification sur un vrai iPhone et un vrai Android : photo (orientation correcte), vocal enregistré sur l'un et lu sur l'autre, vidéo d'iPhone lue sur Android, PDF, mauvais mot de passe, expiration, destruction, installation de la PWA, accessibilité (VoiceOver / TalkBack).

---

## 15. Exploitation

### 15.1 Hébergement

- Serveur loué hors UE (Suisse ou Islande), choisi à la mise en ligne.
- Vérifier le **volume de trafic sortant inclus** : un partage de 1 Gio ouvert 10 fois = 10 Gio sortants.
- Aucun intermédiaire qui déchiffre le trafic (pas de CDN-proxy), TLS terminé par Caddy.

### 15.2 Au quotidien (automatique)

- Nettoyage chaque minute : partages expirés, envois abandonnés, `draining` terminés, vidage du WAL.
- HTTPS renouvelé par Caddy ; mises à jour de sécurité du système automatiques ; redémarrage automatique des conteneurs ; heure synchronisée (NTP).
- Conteneur verrouillé : utilisateur non administrateur, système de fichiers en lecture seule sauf les données, image minimale.
- **Alertes simples** : une sonde externe gratuite (site injoignable), et un script horaire qui envoie un e-mail si le disque dépasse 80 % ou si les signalements s'accumulent.

### 15.3 Commandes d'administration

- Les commandes **ne créent jamais rien** (sauf le fichier de gel) : `SHH_DATA_DIR` doit être un chemin absolu qui contient `shares.db`, ouverte en `mode=rw` (sans création). Sinon : message, code de sortie 1, rien de fait. Chaque réussite affiche le chemin absolu et le nombre de partages touchés. Codes : 0 réussite, 1 échec, 2 erreur d'usage.
- `shhdrop admin freeze` / `unfreeze` : bloque ou rouvre les nouveaux envois.
- `shhdrop admin destroy -` : traite un signalement ; le lien (ou l'identifiant) est lu sur l'**entrée standard**, pour qu'il n'aille ni dans l'historique du shell ni dans `/proc/<pid>/cmdline`. `shhdrop admin destroy <id>` reste possible : **retirer la partie après `#`** (la clé). Un argument qui contient `#` affiche un avertissement : la clé est exposée.
- `shhdrop admin wipe --yes` : gèle d'abord les créations (le gel reste en place, à lever avec `unfreeze`), puis efface tout (urgence).
- `deploy.sh` : installe une version précise (image épinglée par empreinte), contrôle la santé, et revient en arrière si le contrôle échoue (D3).

### 15.4 Sécurité des comptes du propriétaire

Un compte piraté permettrait de servir un site piégé : c'est la menace la plus réaliste.

- **GitHub** : double authentification (clé de sécurité de préférence), branche `main` protégée, aucun secret dans le dépôt (il est public), alertes de secrets activées.
- **Registraire du domaine** : double authentification, verrou de transfert, **DNSSEC**, enregistrement **CAA** (seul Let's Encrypt peut émettre un certificat).
- **Serveur** : connexion SSH par clé uniquement, pare-feu (22, 80, 443 seulement), mots de passe désactivés.
- **E-mail de contact** : adresse dédiée, avec double authentification.

### 15.5 Plan d'incident

En cas de doute sur la sécurité du serveur ou du code :

1. `admin freeze`, puis `admin wipe` si nécessaire.
2. Changer les accès (SSH, GitHub, registraire).
3. Réinstaller le serveur depuis zéro.
4. Publier un avis sur le site.

---

## 16. Préparation App Store (sans rien réécrire)

- Site statique, chemins relatifs, adresse de l'API configurable dans le code : l'app iOS pourra embarquer l'interface (Capacitor, compilée dans le cloud avec Codemagic, sans Mac).
- Chemin `/s/…` réservé aux liens de partage (futurs liens universels).
- Au moment de l'App Store :
  - autoriser l'origine `capacitor://localhost` sur l'API ;
  - publier le fichier `apple-app-site-association` ;
  - compte Apple Developer (99 $/an, identité publique de l'éditeur) ;
  - déclaration de chiffrement.

---

## 17. Cadre légal

Héberger hors UE **ne soustrait pas un exploitant résidant en France** au droit français ni au RGPD.

- **À faire valider par un juriste avant toute ouverture au public :**
  - **Conservation des données d'identification** (LCEN art. 6, décret 2021-1362) : les hébergeurs doivent conserver certaines données (dont l'IP de création d'un contenu) pendant 1 an. C'est en **conflit direct** avec « aucune IP enregistrée ». Il faut déterminer si Shhdrop est concerné et comment s'y conformer ;
  - **DSA** : point de contact et procédure de notification (art. 16).
- **ANSSI** : déclaration de fourniture d'un moyen de cryptologie assurant la confidentialité (LCEN art. 30, décret 2007-663). Démarche simple, à faire avant l'ouverture au public.
- **Mentions légales** : particulier non professionnel, identité communiquée à l'hébergeur, contact.
- **CGU** : contenus illicites interdits, destruction sur signalement, aucune garantie de conservation, pas de vérification de l'expéditeur.
- **Confidentialité** : liste exacte de ce qui est traité (section 9), pas de cookies (donc pas de bandeau).
- **Domaine** : registraire classique avec WHOIS masqué et double authentification. Avec Njalla, c'est Njalla qui est propriétaire légal du domaine (risque de perte de contrôle) ; à choisir en connaissance de cause.

---

## 18. Limites assumées (affichées honnêtement sur le site)

1. Ce que le destinataire **télécharge ou capture** lui appartient.
2. Le **code du site** est le point sensible de tout chiffrement dans un navigateur : si le serveur ou le compte GitHub est compromis, le site servi pourrait être piégé. Réduit au minimum (section 15.4), pas éliminé.
3. Le serveur et l'hébergeur **voient l'adresse IP** de connexion, même sans l'enregistrer.
4. La mémoire du navigateur est effacée **au mieux**, pas de façon garantie.
5. Shhdrop **ne vérifie pas l'expéditeur** : un lien peut venir de n'importe qui.
6. Le serveur ne stocke **aucune date de création** et arrondit ses dates au quart d'heure, mais le système de fichiers garde la date de naissance et de changement de chaque fichier chiffré : quelqu'un qui accède au volume déverrouillé du serveur en marche peut en déduire l'heure de création d'un partage vivant.
7. **Enregistrement sans `showSaveFilePicker`** (Firefox, Safari, téléphones) : l'élément est assemblé en `Blob`. Les tranches déchiffrées sont repliées dans le `Blob` tous les 64 Mio, puis mises à zéro ; le navigateur garde ce `Blob` en mémoire ou le place dans son stockage temporaire, sur le disque, hors du contrôle du site.
8. **Effacement de la mémoire** : `wipe()` met à zéro le segment chiffré en cache, mais le manifeste (noms, types, textes) reste en mémoire sous forme de chaînes JavaScript, impossibles à effacer ; elles disparaissent quand la page les oublie.
9. **Aperçu** limité aux éléments de 200 Mio ; au-delà, téléchargement seulement.
10. **Clés gardées après l'ouverture** : pour permettre le signalement après la dernière ouverture, K_accès et K_preuve restent en mémoire de la page jusqu'à `wipe()` (ou jusqu'à ce que la page les oublie). Ils ne permettent pas de déchiffrer, seulement de détruire le partage.
11. On n'écrit jamais « 100 % sécurisé ». On écrit ce qui est vrai : le contenu est chiffré de bout en bout, et ni le serveur ni son propriétaire ne peuvent le lire.

---

## 19. Accessibilité

- Contraste conforme WCAG 2.1 AA, en clair et en sombre.
- Tout est utilisable **au clavier**, avec focus visible.
- Libellés lisibles par VoiceOver et TalkBack ; compte à rebours annoncé sans spam (mise à jour discrète).
- Zones tactiles de 44 px minimum ; textes agrandissables sans casser la page.

---

## 20. Décisions encore ouvertes

| Sujet | Quand |
|---|---|
| D1 à D4 (section 0) | Maintenant (défauts appliqués) |
| Hébergeur (Suisse ou Islande) et son trafic inclus | Avant la mise en ligne |
| Registraire du domaine (classique ou Njalla) | Dès maintenant |
| Adresse e-mail de contact | Avant la mise en ligne |
| Avis d'un juriste (LCEN, DSA) et déclaration ANSSI | Avant l'ouverture au public |
| Stockage total (100 Gio par défaut) | Selon le serveur choisi |

---

## 21. Ajouts v2.1 (oublis trouvés en préparant le plan)

| Gravité | Sujet | Problème | Décision |
|---|---|---|---|
| Critique | **Accents dans le mot de passe** | « é » peut être encodé de deux façons selon le clavier (iPhone, Android, ordinateur) : le même mot de passe donnerait une autre clé, et le destinataire ne pourrait jamais ouvrir | Mot de passe **normalisé en Unicode NFC** avant Argon2id, des deux côtés |
| Important | **Liste de mots** | Des mots accentués sont pénibles à dicter et à taper | Liste **EFF large wordlist** (7 776 mots anglais simples, sans accents, licence CC-BY) en V1 ; mots séparés par des tirets, en minuscules |
| Important | **Cache « page précédente »** (bfcache) | Après avoir quitté la page, le bouton « Retour » peut réafficher le contenu déchiffré gardé en mémoire par le navigateur | `Cache-Control: no-store` sur les pages, et effacement du contenu à l'événement `pagehide` ; à la réouverture depuis ce cache, la page se recharge |
| Important | **Gestionnaires de mots de passe** | Le navigateur proposerait d'enregistrer le mot de passe du partage, qui resterait alors stocké | Champs `autocomplete="off"` / `"one-time-code"`, pas de balise `<form>` de connexion classique |
| Important | **Traduction automatique** | La traduction de Chrome ou Safari envoie le texte affiché à Google ou Apple, donc le contenu déchiffré | `translate="no"` sur tout le site et `<meta name="google" content="notranslate">` |
| Mineur | **Apprentissage du clavier** | Gboard ou SwiftKey peuvent mémoriser le texte saisi dans un message | `autocorrect="off"`, `spellcheck="false"`, `autocapitalize="off"` sur les zones de saisie sensibles ; limite signalée (l'app ne peut pas l'empêcher complètement) |
| Important | **Conditions de l'hébergeur** | Beaucoup d'hébergeurs interdisent les services de partage de fichiers anonymes dans leurs conditions d'utilisation, ce qui expose à une coupure sans préavis | Vérifier les conditions d'utilisation **avant** de louer le serveur |
| Mineur | **Extensions du navigateur** | Une extension malveillante ou trop curieuse peut lire la page | Limite assumée, ajoutée à la section 18 |
| Mineur | **Page de gestion** | Afficher « Ouvert 1 / 3 » demande de connaître le maximum | Colonne `max_opens` ajoutée à la table |
| Mineur | **Fin de téléchargement rejouée** | Un même `done` envoyé deux fois fausserait le compteur | Un indicateur par ouverture (`done_mask`, 10 bits) rend `done` idempotent |
| Mineur | **Partage vide** | Un envoi sans aucun élément | Bloqué dans le navigateur |

---

## 22. Décisions du propriétaire (v2.2) — remplacent D2 et D4 de la section 0

### D2 — Base et disque chiffrés (remplace « retirés »)

- Tout le dossier de données (`/data` : base SQLite, fichiers chiffrés, fichiers temporaires) est sur un **volume LUKS2 (AES-256-XTS, Argon2id)**. La base est donc chiffrée au repos avec le reste.
- La **phrase de déverrouillage n'est jamais stockée sur le serveur**. Après un redémarrage de la machine, le propriétaire déverrouille le volume en SSH (`deploy/unlock.sh`) ; tant que ce n'est pas fait, le site reste hors service. Les redémarrages du conteneur, eux, sont automatiques et n'ont pas besoin de déverrouillage.
- Les mises à jour de sécurité automatiques **ne redémarrent pas la machine d'elles-mêmes** ; une alerte prévient quand un redémarrage est nécessaire.
- **Swap désactivé** (sinon des pages mémoire pourraient être écrites en clair sur un disque non chiffré) ; vidages mémoire du noyau (core dumps) désactivés.
- La base reste en `modernc.org/sqlite` (pas de SQLCipher) : la protection au repos vient du volume chiffré. Le niveau de protection est le même, sans CGO.

### D4 — Anti-robot fort et respectueux de la vie privée (remplace « reporté »)

- **ALTCHA** (open source, MIT), **hébergé par Shhdrop** : widget servi depuis notre domaine, bibliothèque serveur Go (`altcha-lib-go`). Aucun service tiers, aucun cookie, aucun traceur (exclus : reCAPTCHA, hCaptcha, Turnstile).
- **Preuve de travail adaptative** : environ 1 s pour une première création ; la difficulté **double à chaque création** de la même connexion dans l'heure (plafond : environ 30 s).
- **Défis signés (HMAC), à usage unique** (consommés en mémoire), valables **2 minutes**, liés à la connexion.
- **Pièges** : un champ caché qui ne doit pas être rempli, et un délai minimum de 3 s entre l'affichage de la page et la création.
- S'ajoute aux limites de la section 4 (10 par jour, 30 par /48, 300 Mio par jour).
- Limite assumée : aucun captcha n'arrête tous les robots ; l'objectif est de rendre la création en série lente et coûteuse.

---

## 23. Écarts validés pendant l'implémentation du Plan 1

| Sujet | Spécification d'origine | Implémentation retenue |
|---|---|---|
| Paramètres KDF côté navigateur | minimum seul | minimum **et** plafond : `ops` ≤ 10, `mem` ≤ 256 Mio, entiers obligatoires (un serveur malveillant ne peut pas bloquer le navigateur) |
| Version de Go | — | Go 1.26 |
| Quota de 300 Mio par jour | taille envoyée | octets **utiles** du palier : `bucket × 65 536` |
| Délai de 3 s (piège anti-robot) | heure d'affichage | jeton `shown_at` signé et **lié au sel du défi** ALTCHA : utilisable une seule fois |
| ALTCHA | `altcha-lib-go` | version ≥ 1.0.0 (correctif GO-2025-4239) ; sel au format strict terminé par le délimiteur « & » |
| Jeton de téléchargement | par ouverture | par ouverture, **mort après `done`** de cette ouverture (`done_mask`) |
| Destruction par le destinataire | `K_preuve` | un `K_preuve` faux (avec `K_accès` juste) **compte comme essai** de mot de passe, avec le même compteur que `unlock` |
| Adresse du client | en-tête posé par Caddy | `SHH_BEHIND_PROXY=1` : **échec fermé**, toute requête sans `X-Shh-Client-IP` venue de la boucle locale est refusée |
| `/healthz` | local uniquement | boucle locale seulement, et refusé s'il porte `X-Shh-Client-IP` (donc s'il passe par Caddy) |
| Erreurs côté destinataire et gestion | — | coupure persistante → `reseau` ; 429 → `LimitError` ; mauvais mot de passe → `BadPasswordError` ; tout le reste → `NotFoundError` (aucun message choisi par le serveur) |
| Envois vides | effacés au bout d'1 h | sans aucun segment : effacés 5 à 20 min après la création (section 7.4) |
| Dates stockées | `expires_at` arrondi | `upload_deadline`, `expires_at` et `purge_at` arrondis au quart d'heure supérieur (`purge_at` ≤ `expires_at`) ; table `WITHOUT ROWID` |
| Liens | — | `https:` obligatoire ; `http:` accepté seulement pour `localhost`, `127.0.0.1`, `[::1]` |

---

## 24. Décisions du propriétaire (v2.3) — limite à 1 Go par lien, dépendances à jour

### Taille

- **1 Gio maximum par lien**, tous éléments confondus (contenu utile). Paliers en morceaux de 64 Kio : `[1, 16, 80, 160, 400, 800, 1600, 4000, 8000, 16384]` (de 64 Kio à 1 Gio). Le fichier chiffré du plus grand palier fait 48 + 16 384 × 65 552 octets.
- **Envoi** : lecture des fichiers par morceaux (`File.slice`), jamais tout le fichier en mémoire.
- **Réception** :
  - aperçu sur le site (image, audio, vidéo, PDF) seulement pour les éléments de **200 Mio maximum** ; au-delà, téléchargement seulement ;
  - téléchargement **en flux** : déchiffrement segment par segment, écriture directe sur le disque via l'API d'accès aux fichiers (`showSaveFilePicker`) quand elle existe (Chrome, Edge sur ordinateur) ; sinon, assemblage en `Blob` (le navigateur peut alors placer des morceaux déchiffrés dans son stockage temporaire : limite assumée, ajoutée à la §18).
- **Délais** : jeton d'envoi et `upload_deadline` **3 h** ; jeton de téléchargement `min(3 h, expires_at)` ; `purge_at` = `min(ceil15(now + 3 h), expires_at)`.
- **Quotas** : 10 liens par jour par connexion (inchangé), 30 par /48 (inchangé), **3 Gio par jour** par connexion et **6 Gio par jour par /48** (anti-saturation du disque) ; stockage total par défaut **100 Gio** (`SHH_STORAGE_MAX`).
- **Limite de débit des segments** : un `PUT`/`GET` de segment dont le jeton est valide est exclu des 60 requêtes par minute et compte dans une limite à part de 600 par minute et par connexion ; un jeton invalide compte dans les 60.
- **Envoi bloqué** : aucun nouveau segment depuis 15 min → effacé (`progress_at`, §9.1), en plus de l'échéance de 3 h et de la règle « aucun segment en 5 min ».

### Anti-robot

- ALTCHA est maintenu, après réexamen demandé par le propriétaire. reCAPTCHA exécuterait du code tiers sur la page qui détient la clé du lien (§10, §2), traçage et bandeau de cookies en plus ; ALTCHA est plus rapide pour l'utilisateur (aucune image) et ne charge rien de l'extérieur.

### Dépendances

- Toutes les dépendances (npm, modules Go, actions GitHub, chaîne Go) sont tenues à leur **dernière version stable**, installées uniquement depuis les sources officielles (registre npm, `proxy.golang.org`, actions publiées par leurs éditeurs officiels) ; versions verrouillées (`package-lock.json`, `go.sum`).
- Vérification à chaque modification : `govulncheck`, `npm audit` ; Dependabot activé (npm, gomod, github-actions).

---

## 25. Durcissement après audit (v2.4, 4 novembre 2026)

Audit « sharp edges » du 4 novembre (`docs/superpowers/audits/2026-11-04-sharp-edges.md`) : 4 moyens, 11 faibles, aucun critique. Tous corrigés ; détail, tests et preuves dans `docs/superpowers/audits/2026-11-04-correctifs.md`.

| Point | Correction |
|---|---|
| M1 secrets confondus | types marqués `KLien`, `KAcces`, `KPreuve`, `SGestion` ; `ParsedLink` en union discriminée ; couche HTTP hors de l'interface publique `web/src/index.ts` ; `tsc` lancé par `npm test` |
| M2 admin sur un mauvais dossier | rien n'est créé ; `shares.db` exigée, ouverte en `mode=rw` ; chemin et nombre affichés ; code non nul (§15.3) |
| M3 écoute publique sans proxy | `SHH_LISTEN` hors boucle locale refusé sauf `SHH_BEHIND_PROXY=1` + `SHH_TRUSTED_PROXY` (§8) |
| M4 nom et type bruts | `safeName`, `previewKind`, `isRiskyFile` ; `collectToBlob` toujours en `application/octet-stream` (§12) |
| F1 origine prise dans le lien | origine attendue en paramètre, liens d'une autre origine ou avec identifiants refusés ; origine validée (§10) |
| F2 JSON insensible à la casse, doublons | clés exactes, sans doublon, vérifiées avant le décodage (§8) |
| F3 `\r` `\n` ignorés en base64 | longueur exacte en caractères et alphabet vérifiés (secrets, identifiants, jetons) |
| F4 `match(nil)` | secret de 32 octets exigé ; vérificateur égal à SHA-256("") refusé |
| F5 `SHH_DATA_DIR` | absolu ; dossier non vide d'un autre programme refusé (§8) |
| F6 `SHH_STORAGE_MAX` sans plafond | `statfs` au démarrage, 1 Gio de marge ; fichiers creux refusés derrière le proxy (§8) |
| F7 site statique | `index.html` exigé ; fichiers cachés et listes de dossiers refusés ; repli monopage (§10) |
| F8 32 bits | comparaison sûre ; `GOARCH=386 go build ./...` dans `make test-go` |
| F9 phrases courtes, mot de passe vide | 4 mots au moins ; `deriveContentForCreate` impose `checkPassword` et `KDF_CREATE` ; mot de passe vide refusé à l'ouverture |
| F10 valeurs zéro de `share.Service` | `share.NewService` valide `FrozenFile` et `StorageMax` ; un `Service` sans `FrozenFile` est gelé (échec fermé) |
| F11 lien dans argv | `admin destroy -` (entrée standard), avertissement si l'argument contient `#` (§15.3) |
| S1 signalement après la dernière ouverture | `Opened.destroy(reason?)` sans `meta` ; `done` en `keepalive` (§12, §18) |

API du client pour le Plan 2 : `createShare(origin, items, opts)`, `openShare(link, password, expectedOrigin, onProgress?, net?)`, `fetchMeta(link, expectedOrigin, net?)`, `destroyShare(link, expectedOrigin, opts?)`, `shareStatus(manage, expectedOrigin, net?)`, `collectToBlob(opened, i, foldBytes?)`.

