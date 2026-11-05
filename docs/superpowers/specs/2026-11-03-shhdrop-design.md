# Shhdrop — spécification V1 (version 2, finale à valider)

Date : 4 novembre 2026 · Domaine visé : **shhdrop.app**
Historique : v1 du 3 novembre, puis revue critique indépendante et passage complet de recherche d'oublis (voir section 0). v2.4 (4 novembre) : durcissement après l'audit « sharp edges » (section 25). v2.5 (5 novembre) : repli Google reCAPTCHA isolé (section 26). v2.6 (5 novembre) : décisions du propriétaire, coffre chiffré sur téléphone (27), code vérifiable (28), chiffrement anticipé (29), revue post-quantique (30), mot de passe de 8 caractères (31), lien court (32), historique local sans compte (33), droits du destinataire (34). Les sections 29 à 34 remplacent les passages signalés « → § » ci-dessous.

---

## 0. Ce qui a changé depuis la v1, et décisions par défaut

### Décisions prises par défaut (modifiables d'un mot)

| # | Décision | Choix par défaut | Raison |
|---|---|---|---|
| D1 | Mode « lecture seule » | **Retiré** (→ §34 : réintroduit par le propriétaire sous le nom « Voir seulement », avec un texte honnête) | Contournable (appui long, outils du navigateur) ; donnait une fausse impression de sécurité |
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
| Attaquant du code du site (serveur piraté, dépôt GitHub compromis) | Servir un site piégé qui vole les clés | Comptes du propriétaire protégés (section 15.4), CSP stricte, dépendances minimales et verrouillées, builds reproductibles et versions signées vérifiables (section 28). **Limite résiduelle assumée** (section 18) |
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

- Comptes, profils, contacts · publicité, analytics, traceurs, ressources tierces (seule exception : le repli reCAPTCHA isolé de la section 26) · tout mécanisme permettant au serveur de lire un contenu.

---

## 4. Règles et limites

| Règle | Valeur V1 |
|---|---|
| Éléments par partage | 10 maximum |
| Taille par partage | 1 Gio de contenu utile (16 384 morceaux de 64 Kio) ; le fichier chiffré fait 48 + 16 384 × 65 552 = 1 074 004 016 octets (§24) |
| Durée de vie | au choix 1 h, 6 h, 12 h, 24 h ; comptée **à partir de la fin de l'envoi** ; expiration arrondie au **quart d'heure supérieur** |
| Ouvertures | au choix 1 à 10 ; **une ouverture = un déverrouillage réussi** (recharger la page en consomme une, c'est affiché) |
| Fin de vie | le premier atteint : durée, ouvertures épuisées, destruction (expéditeur, destinataire, administrateur), signalement, 5 mots de passe faux |
| Mot de passe | → §31 (8 caractères générés par défaut). Avant v2.6 : obligatoire ; généré par défaut : **4 mots** tirés d'une liste de 7 776 mots (≈ 52 bits) ; personnalisé : 12 caractères minimum et absent d'une liste noire des mots de passe courants (contrôle côté navigateur : le serveur ne peut pas le vérifier) |
| Essais de mot de passe | 5 ratés → destruction |
| Création de partages | 10 par jour par connexion (IPv4, ou bloc IPv6 /64) ; 30 par jour par bloc /48 ; 3 Gio utiles par jour par connexion et 6 Gio par bloc /48 (§24) |
| Limite de débit | 60 requêtes par minute par connexion sur les routes publiques ; les envois et téléchargements de segments porteurs d'un jeton valide ont leur propre limite, 600 par minute par connexion et 6 000 par bloc /48 (§24) ; un segment au jeton invalide compte dans les 60 |
| Transferts de segments | au plus 16 téléchargements simultanés par connexion, 64 par /48 et 256 au total ; envois : 8, 32 et 64 ; au-delà 429 (connexion, /48) ou 503 (serveur), avec `Retry-After` ; une ouverture lit au plus 2 × le fichier chiffré de son palier + 2 segments 0, puis 429 `budget` (§24) |
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

> **v2.6** : §7.1 à §7.5 décrivent le format v1. Pour tout nouveau partage, le chiffrement anticipé de la §29 les remplace (clé de contenu aléatoire `R` enveloppée par le lien et le mot de passe, paquet « SHH2 », identifiant dérivé du lien). §7.6 et §7.7 restent valables.

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
| `GET /api/shares/{id}/status` | Ouvertures, secondes restantes (→ §29.8 : `GET /api/manage/status`) | `S_gestion` |
| `GET /healthz` | Santé (local uniquement) | — |

- Les secrets passent dans des **en-têtes ou le corps**, jamais dans l'URL.
- **IP de confiance** : le serveur écoute uniquement en local ; il ne croit que l'en-tête posé par Caddy (`X-Shh-Client-IP`) et ignore tout `X-Forwarded-For` venu du client. L'en-tête n'est cru que d'un pair de confiance : boucle locale, ou réseau listé dans `SHH_TRUSTED_PROXY`. Un test le vérifie.
- **JSON strict** : un corps qui contient une clé en double ou une clé de casse différente (`PROOF`, `pRoOf`) est refusé (400) avant le décodage. Les secrets et identifiants base64url doivent avoir leur longueur exacte en caractères (22 ou 43), sans `\r` ni `\n`.

**Configuration (variables d'environnement, vérifiées au démarrage ; toute erreur arrête le serveur) :**

| Variable | Règle |
|---|---|
| `SHH_DATA_DIR` | obligatoire, **chemin absolu**, sans `?`, `#` ni `%`. Un dossier existant doit être vide (premier démarrage ; le dossier `lost+found` d'un volume ext4 dédié est ignoré) ou contenir `shares.db` **et** `blobs/` ; sinon refus, sans toucher aux droits ni aux fichiers |
| `SHH_LISTEN` | `hôte:port` numérique, par défaut `127.0.0.1:8080`. Hors boucle locale (`127.0.0.0/8`, `::1`, `localhost`), refusé sauf si `SHH_BEHIND_PROXY=1` **et** `SHH_TRUSTED_PROXY` sont donnés (cas Docker du Plan 3) |
| `SHH_BEHIND_PROXY` | `0` ou `1`. À `1` : toute requête `/api/` sans `X-Shh-Client-IP` valide, ou venue d'un pair qui n'est pas un proxy de confiance, reçoit 500 ; les fichiers creux sont refusés (voir `SHH_STORAGE_MAX`) |
| `SHH_TRUSTED_PROXY` | liste de CIDR canoniques séparés par des virgules (ex. `172.18.0.0/16`). Acceptés : un sous-réseau (jamais `/0`) d'un réseau local (RFC 1918, `127.0.0.0/8`, `169.254.0.0/16`, `fc00::/7`, `::1`, `fe80::/10`), ou un réseau public d'au moins `/24` en IPv4 et `/48` en IPv6 ; refusés : `/0`, les réseaux publics plus larges, les préfixes NAT64 (`64:ff9b::/96`, `64:ff9b:1::/48`) et la notation IPv4-dans-IPv6 (`::ffff:a.b.c.d/…`) ; exige `SHH_BEHIND_PROXY=1`. La boucle locale reste toujours de confiance |
| `SHH_STORAGE_MAX` | entier décimal > 0 (chiffres seuls), 100 Gio par défaut. Au démarrage : `SHH_STORAGE_MAX` ≤ espace libre (`statfs`) + place déjà réservée − 1 Gio, sinon refus. Avec `SHH_BEHIND_PROXY=1`, une sonde vérifie que `fallocate` fonctionne ; sans allocation réelle, les créations sont refusées (507) |
| `SHH_STATIC_DIR` | chemin absolu ; le dossier et son `index.html` doivent exister. Vide : page d'attente |
- **Délais réseau** : lecture et écriture limitées (protection contre les connexions lentes), corps de requête plafonnés à la taille exacte attendue. Chaque transfert de segment a sa propre échéance, 10 s + taille ÷ 32 Kio/s (138 s pour un segment de 4 Mio) : un client plus lent est coupé et rend sa place (§24).
- **Segments servis en flux** depuis le fichier (aucun tampon de la taille du segment), avec `Content-Length` ; une copie incomplète coupe la connexion. Seul un partage `ready` ou `draining` est lu : aucun segment en cours d'écriture n'est servi.

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
- **Aucune ressource tierce** sur les pages de l'application (seule exception, hors de ces pages : le cadre de repli reCAPTCHA, section 26). `robots.txt` et `noindex` sur les pages de partage, sans aperçu pour les messageries.
- **Fichiers du site** : servis depuis `SHH_STATIC_DIR` sans jamais en sortir (liens symboliques compris) ; fichiers et dossiers cachés (`.env`, `.git/…`) → 404 ; aucune liste de dossier (dossier sans `index.html` → 404) ; `GET` et `HEAD` seulement. Application monopage : un chemin inconnu sans extension sert `index.html` avec les mêmes en-têtes ; un fichier absent (`x.js`) → 404. Sous `/s/` et `/m/` (préfixe sensible à la casse), **tout** chemin qui n'est pas un fichier existant sert `index.html` (avec `X-Robots-Tag: noindex`), même si son dernier segment contient un point : un lien abîmé par une messagerie (`/s/<id>.#…`) charge ainsi l'application, qui retire le `#` de la barre et de l'historique (UI §12.1). Les segments cachés et la remontée (`..`) restent refusés ; `/api/…` et les autres préfixes ne changent pas.
- **Origine attendue** : le client ne prend jamais l'adresse du serveur dans le lien. Chaque fonction reçoit l'origine du site (`location.origin`) et refuse un lien d'une autre origine ou qui contient des identifiants (`user:pw@`) ; l'origine doit être `https://hôte[:port]` exacte (http seulement pour `localhost`, `127.0.0.1`, `[::1]`). Cela protège aussi hors navigateur (Node, future appli, §16), où la CSP ne s'applique pas.
- **Secrets typés** : K_lien, K_accès, K_preuve et S_gestion ont des types TypeScript distincts ; envoyer K_lien au serveur ne compile pas. La couche HTTP n'est pas exportée par l'interface publique (`web/src/index.ts`).
- **Pas de service worker** : aucun code ne reste installé dans le navigateur entre deux visites. → §28.5 : cette justification ne tient pas face à un serveur compromis (il peut enregistrer le sien) ; §28.6 propose un service worker minimal d'épinglage, en attente de décision (Q-C1).
- **Contenu déchiffré** : en mémoire, jamais dans le stockage du navigateur (exceptions écrites : coffre chiffré, §27 ; historique local des liens de gestion, §33 ; jamais de clair). Effacement **au mieux** (mise à zéro des tableaux, révocation des URL blob) : le navigateur ne garantit pas davantage.
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
  - **nom de fichier nettoyé** (`safeName`) : NFC ; caractères d'inversion de sens d'écriture retirés (U+202A–U+202E, U+2066–U+2069, U+200E, U+200F, U+061C ; anti-« facture‮fdp.exe ») ; contrôles C0/C1, `/` et `\` retirés ; tous les caractères ignorables par défaut retirés (`Default_Ignorable_Code_Point` : largeur nulle, U+00AD, U+034F, remplissages hangul, sélecteurs de variante, étiquettes…) ; U+200D (ZWJ) gardé seulement entre deux emoji et U+FE0F seulement après un emoji ; espaces regroupés ; points initiaux retirés (fichier caché), points et espaces finaux aussi (Windows les retire) ; 120 points de code au plus, coupés entre deux graphèmes (`Intl.Segmenter`), extension gardée (« fichier » devant l'extension si la coupe ne laisse rien avant elle, jamais un nom qui commence par un point) ; « fichier » si rien ne reste ;
  - **avertissement** pour les fichiers exécutables ou dangereux (`isRiskyFile` : .exe, .msi, .bat, .cmd, .com, .scr, .ps1, .vbs, .js, .jar, .apk, .app, .dmg, .pkg, .sh, .html, .htm, .hta, .lnk, .iso, .msix, .appx, .reg, .wsf, .cpl, .pif, .url, .command, .desktop).
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
- **Disque : au moins `SHH_STORAGE_MAX` + 1 Gio libres** (100 Gio par défaut, donc 101 Gio) pour que le serveur démarre : sinon refus au démarrage (voir `SHH_STORAGE_MAX`, §8). La place déjà réservée par les partages existants compte comme libre. Réduire `SHH_STORAGE_MAX` ou agrandir le disque avant la mise en ligne. L'espace est lu avec `Frsize` (unité de `Bavail`) quand il est non nul, sinon `Bsize`.
- **Volume de données monté en `noatime`** (à appliquer au Plan 3) : sinon la date d'accès d'un fichier révèle l'heure de la première lecture (audit de confidentialité P5). Le serveur ouvre déjà les fichiers en lecture avec `O_NOATIME` sous Linux (repli silencieux si refusé) ; le montage couvre les autres lectures (sauvegarde, outils). Il ne remet pas les dates à zéro après une lecture : `chtimes` mettrait le `ctime`, que nul ne peut fixer, à l'heure de la lecture.

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
11. On n'écrit jamais « 100 % sécurisé ». On écrit ce qui est vrai : le contenu est chiffré de bout en bout ; le serveur ne reçoit que des données chiffrées, jamais la clé. On ne promet pas que le serveur « ne voit rien » : il voit l'adresse IP, les tailles et les heures (§2), et un site piégé reste une limite assumée (§18).
12. **Envoi anticipé** (§29.7) : un serveur qui observe l'ordre et l'heure des segments connaît la taille du contenu à 4 Mio près, et sait qu'une composition est en cours.
13. **Victime ciblée** (§28.8) : un serveur compromis peut servir un code piégé à une seule personne ; la vérification publique ne la protège que si elle vérifie elle-même, avec un outil qui ne vient pas du site.
14. **Coffre** (§27.1) : captures d'écran, téléphone compromis, et confiance de l'expéditeur envers le destinataire restent hors de portée ; « Voir seulement » (§34) n'est qu'une dissuasion.

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

- **ALTCHA** (open source, MIT), **hébergé par Shhdrop** : widget servi depuis notre domaine, bibliothèque serveur Go (`altcha-lib-go`). Aucun service tiers, aucun cookie, aucun traceur (exclus : hCaptcha, Turnstile ; reCAPTCHA seulement en repli isolé, section 26).
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
- **Limite de débit des segments** : un `PUT`/`GET` de segment dont le jeton est valide est exclu des 60 requêtes par minute et compte dans une limite à part de 600 par minute et par connexion, et de 6 000 par minute et par /48 (audit du 5 novembre, M1) ; un jeton invalide compte dans les 60.
- **Transferts simultanés** (audit du 5 novembre, E1) : téléchargements de segments au plus 16 par connexion, 64 par /48, 256 au total ; envois (corps gardé en mémoire, ≤ 4 Mio) 8, 32 et 64. Refus immédiat, sans file d'attente : 429 `limit` (connexion ou /48) ou 503 `busy` (serveur), `Retry-After: 5`. Compteurs en mémoire, sur les clés HMAC du jour, jamais d'adresse.
- **Budget de lecture par ouverture** (audit du 5 novembre, M1) : un jeton de téléchargement lit au plus 2 × la taille du fichier chiffré de son palier + 2 segments 0 (une lecture complète, un nouvel essai de chaque segment, deux relectures de l'en-tête) ; au-delà, 429 `budget` (`Retry-After: 60`) jusqu'à l'expiration du jeton. Compté en mémoire par (identifiant, n° d'ouverture), sans adresse, oublié 3 h après la première lecture.
- **Envoi bloqué** : aucun nouveau segment depuis 15 min → effacé (`progress_at`, §9.1), en plus de l'échéance de 3 h et de la règle « aucun segment en 5 min ».

### Anti-robot

- ALTCHA est maintenu, après réexamen demandé par le propriétaire (complété en v2.5 par un repli reCAPTCHA isolé, section 26). reCAPTCHA chargé dans la page exécuterait du code tiers sur la page qui détient la clé du lien (§10, §2), traçage et bandeau de cookies en plus ; ALTCHA est plus rapide pour l'utilisateur (aucune image) et ne charge rien de l'extérieur.

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

---

## 26. Décision du propriétaire (v2.5, 5 novembre 2026) — repli Google reCAPTCHA isolé

Le propriétaire a demandé un repli Google reCAPTCHA quand la preuve de travail maison n'aboutit pas, et a validé l'exception écrite ici. Elle remplace l'exclusion de reCAPTCHA de D4 (section 22) et de la section 24, **pour le repli seulement**.

- **Principal inchangé** : la preuve de travail maison (compatible `altcha-lib-go`), invisible, sans service tiers. Elle reste la seule vérification tant qu'elle aboutit.
- **Repli seulement si la preuve échoue** (Worker absent ou en erreur, délai dépassé, refus du serveur). Détails côté interface : spécification UI §9.4.2 et §15.
- **Rien n'est chargé depuis Google avant un clic explicite** sur « Continuer avec Google », après un texte qui dit que Google verra l'adresse IP.
- **Jamais sur une page qui détient des clés** : reCAPTCHA v2 tourne dans un cadre `sandbox` servi par une **origine de vérification distincte** (`SHH_VERIF_ORIGIN`). Cette origine doit être un **site différent** de celui de l'application : un autre domaine enregistrable, ou un sous-domaine d'un suffixe public (liste Public Suffix, par exemple `*.github.io`, `*.pages.dev`). Un sous-domaine de `shhdrop.app` n'est pas accepté (même site : processus et cookies partagés possibles). Le démarrage du serveur échoue si la règle n'est pas respectée.
- La page de l'application n'ajoute que `frame-src {SHH_VERIF_ORIGIN}` ; `script-src`, `connect-src` et `img-src` restent limités à `'self'`. Le cadre ne renvoie qu'un jeton par `postMessage` (origine vérifiée des deux côtés).
- **Serveur** : `siteverify` avec `SHH_RECAPTCHA_SECRET`, **sans** `remoteip` ; jeton lié au défi émis, usage unique, mêmes limites que la preuve de travail (section 4, D4). Repli désactivé si le secret est vide.
- **Confidentialité** : la page Confidentialité dit que, dans ce cas seulement, Google voit l'adresse IP et peut déposer ses cookies dans son cadre ; le contenu, le lien et le mot de passe restent hors de sa portée.
- **Tests** : le test « aucune ressource tierce » reste bloquant pour le cadre principal ; un faux `siteverify` sert aux tests ; aucune requête vers Google sans le clic.


---

## 27. Décision du propriétaire (v2.6, 5 novembre 2026) — coffre chiffré sur téléphone

Le destinataire peut garder un partage reçu dans un **coffre chiffré local**, sur téléphone seulement (PWA installée, future application), **et seulement si l'expéditeur l'a permis** (droit « Voir, enregistrer et garder dans le coffre », §34). Le droit est désactivé par défaut. C'est une exception écrite à §10 (« contenu déchiffré : jamais dans le stockage du navigateur ») et à UI §12.1 : le coffre ne stocke que du chiffré, confiné au module `web/src/vault/`.

### 27.1 Ce que le coffre garantit, et ce qu'il ne garantit pas

| Il garantit | Il ne garantit pas |
|---|---|
| Le serveur n'apprend rien : le droit est dans le manifeste chiffré, la copie se fait pendant une ouverture ordinaire | **Captures d'écran**, photo de l'écran, enregistrement de l'écran (iOS et Android ne les bloquent pas pour une PWA) |
| Rien de lisible sur le disque : paquet chiffré, clé jamais écrite en clair | **Un téléphone compromis** (logiciel espion, accès administrateur) lit ce qui s'affiche et peut capter le déverrouillage |
| Effacement à l'échéance dès que l'application tourne, sans réseau seulement avec le service worker de §28.6 (§27.5) | **L'expéditeur fait confiance au destinataire** : un destinataire qui veut garder le contenu le gardera (capture, autre appareil) |
| Effacement après N déverrouillages ratés, et à la main à tout moment | **Un code du site piégé** (§2, §18.2) peut demander le déverrouillage et lire le coffre : le coffre est aussi sûr que le code servi (d'où §28) |
| | **Effacement physique** de la mémoire flash : on efface les clés (effacement cryptographique), le système décide quand les blocs sont réécrits |
| | Effacement **pendant que l'application est fermée** : une PWA n'exécute rien quand elle est fermée ; l'effacement se fait au prochain lancement, et le déchiffrement est refusé après l'échéance |
| | La **suppression par l'expéditeur** n'atteint pas une copie déjà gardée (aucun canal sans réseau, et une vérification en ligne trahirait la copie au serveur) |

### 27.2 Clés (WebCrypto et libsodium seulement)

- **Secret de déverrouillage `U`** (32 octets), au choix fixé à la création du coffre, jamais rétrogradé ensuite :
  - **Passkey avec l'extension WebAuthn PRF** (choix par défaut quand elle existe : Safari iOS 18 et plus avec le trousseau iCloud, Chrome Android avec le gestionnaire de Google). Création : `rp.id` = hôte du site, `user.id` = 16 octets aléatoires, `user.name` « Coffre Shhdrop », `residentKey: "required"`, `userVerification: "required"`, `extensions.prf.eval.first = sel_prf` (32 octets aléatoires gardés dans le coffre). `U` = `prf.results.first`. La passkey ne sert que de source de clé : aucune signature n'est vérifiée, aucun serveur n'intervient.
  - **Code du coffre** sinon : `U` = Argon2id(code NFC, `sel_code`, 64 Mio, 3 passes, 1 fil, 32 octets), mêmes paramètres minimaux que §7.1. Le code suit `checkPassword` (12 caractères au moins, absent de la liste noire) : un code à 4 ou 6 chiffres est refusé, car il tombe en quelques heures si quelqu'un copie le stockage du navigateur (le compteur d'essais ne protège que dans l'application).
- `U` est importé aussitôt en clé HKDF **non extractible**, puis le tampon est mis à zéro. Clé par entrée : `K_coffre_i` = HKDF(`U`, sel = `sel_i` (32 octets aléatoires par entrée), info « shhdrop/v2/coffre/contenu ») en AES-256-GCM non extractible ; `C_coffre_i` = HKDF(`U`, `sel_i`, « shhdrop/v2/coffre/engagement »). Témoin de déverrouillage : `T` = AES-GCM(HKDF(`U`, « shhdrop/v2/coffre/temoin »), « shhdrop-coffre-ok »).
- Le contenu gardé est **rescellé** dans un paquet Shhdrop ordinaire (§29.3, même code `container.ts`, mêmes paliers) sous `K_coffre_i` : aucun format ni construction de plus. La clé du partage (`R`, §29) n'est jamais conservée.
- Limite honnête : `U` passe dans la mémoire de la page pendant le déverrouillage (la sortie PRF et celle d'Argon2id sont des tableaux JavaScript). « Non extractible » réduit cette fenêtre, sans protéger contre un script qui tourne sur l'origine à ce moment.
- Une passkey synchronisée (trousseau iCloud, gestionnaire Google) existe aussi sur les autres appareils du compte. Le paquet, lui, n'est que sur ce téléphone : il faut les deux.

### 27.3 Stockage

- **OPFS** (`navigator.storage.getDirectory()`) : un fichier `coffre/<entree>.shh` par entrée (le paquet rescellé). **IndexedDB** (base `shh-coffre`) : `mode` (`prf` ou `code`), `sel_prf` ou `sel_code`, `credentialId`, `T`, `essais_rates`, `derniere_heure_vue`, et par entrée `{ id aléatoire, sel_i, echeance, taille du palier }`. Aucun nom, type ni texte en clair : ils sont dans le manifeste chiffré.
- **Échéance en double** : en clair dans IndexedDB (pour effacer sans déverrouiller), et authentifiée dans un petit enregistrement chiffré sous `K_coffre_i` (pour refuser un déchiffrement après l'échéance même si quelqu'un a modifié la valeur en clair).
- `navigator.storage.persist()` demandé à la première entrée. Plafonds : 1 Gio par entrée, 2 Gio et 20 entrées au total, et jamais plus que `storage.estimate()` moins 200 Mio.
- Ce qu'un tiers qui accède au téléphone déverrouillé peut voir sans le code : qu'il existe N entrées, leurs tailles de palier et leurs échéances.

### 27.4 Échéance, essais, effacement

- **Échéance** = min(heure de l'ouverture + `expiresInS` lu par `meta`, heure de l'ouverture + `keep_ttl_h` du manifeste). Le serveur ne peut que **raccourcir** la durée, jamais l'allonger au-delà de ce que l'expéditeur a choisi. C'est l'échéance **en temps** du partage : épuiser les ouvertures ne l'avance pas (avec 1 ouverture, le partage meurt sur le serveur à la fin du téléchargement, la copie reste jusqu'à l'échéance).
- **Horloge** : `maintenant` = max(`Date.now()`, `derniere_heure_vue`), enregistré à chaque lancement. Reculer l'horloge du téléphone ne prolonge pas une entrée déjà vue après son échéance.
- **Effacement automatique** : au lancement, à chaque retour au premier plan, et par minuterie quand l'application est ouverte. Il efface les entrées échues **sans déverrouillage** (fichier OPFS, puis ligne IndexedDB). Une entrée échue n'est jamais déchiffrée (contrôle de l'échéance authentifiée avant tout déchiffrement).
- **Essais ratés** : `N` = 5. Le compteur est **incrémenté avant** l'essai et remis à zéro après un succès (tuer l'application pendant un essai ne rend pas l'essai gratuit). Seul un secret faux compte (témoin `T` qui ne se déchiffre pas) ; une annulation de la passkey (`NotAllowedError`) ne compte pas. Au 5ᵉ échec, tout le coffre est effacé (fichiers, base, `sel_prf`).
- **Effacement manuel** : « Effacer » par entrée, « Vider le coffre » (confirmation sur place). Détruire ou signaler un partage depuis le coffre (en ligne) efface aussi sa copie.
- **Verrouillage** : à la sortie de l'écran du coffre, à `visibilitychange → hidden` et après 2 min sans geste, les clés et les aperçus sont oubliés (URL blob révoquées, tampons mis à zéro). Le contenu est masqué dès `hidden`, sans garantie que la vignette du sélecteur d'applications ne soit pas déjà prise.

### 27.5 Réseau et hors-ligne : dépendance à §28.6

Sans service worker et avec `Cache-Control: no-store` partout (§10), une PWA installée **ne démarre pas sans réseau** : ni lecture, ni effacement hors ligne. L'exigence « effacé à l'échéance sans réseau » n'est tenue que si le service worker minimal de §28.6 est accepté (Q-C1). Sans lui, le coffre fonctionne en ligne seulement et l'effacement a lieu au premier lancement en ligne après l'échéance (le déchiffrement reste refusé). Ce point est signalé au propriétaire.

### 27.6 Parcours

- **Expéditeur** (Options) : droit « Ce que le destinataire peut faire » (§34) ; le troisième choix s'intitule **« Autoriser le destinataire à garder une copie chiffrée sur son téléphone »**, avec, quand il est choisi : « Elle reste jusqu'à l'expiration ({durée}). Supprimer le partage ne l'efface pas : seul le destinataire, ou l'échéance, l'efface. Une capture d'écran reste toujours possible. » Sur « Lien prêt » : « Pour garder une copie, le destinataire doit ouvrir le lien dans l'app Shhdrop installée. »
- **Destinataire, navigateur d'un téléphone** (pas l'app) : avant le déverrouillage, une note fixe, la même pour tous les partages (elle ne dit rien du droit, qu'on ne connaît qu'après) : « Si vous avez l'app Shhdrop, ouvrez-y ce lien avant de déverrouiller : c'est là seulement qu'un partage peut être gardé, quand l'expéditeur l'a permis. » Sur iOS, Safari et l'app installée ne partagent pas leur stockage, et l'app ne capte pas les liens : l'app propose **« Ouvrir un lien reçu »** (champ où l'on colle le lien).
- **Destinataire, dans l'app**, si le manifeste porte `rights: "coffre"` : sur l'écran de contenu, bouton **« Garder dans le coffre »** (`secondary`, icône `lock`). Premier usage : création du coffre (passkey, ou code si PRF manque, avec la raison), puis téléchargement complet et rescellement, progression en octets ; « Gardé jusqu'au {date, heure} ». Échec (place, quota, annulation) : rien n'est gardé, aucun fichier partiel (le fichier OPFS est supprimé).
- **Écran du coffre** (`/coffre`, dans l'app seulement) : verrouillé, « {n} partages gardés · le prochain s'efface dans {durée} » et **Déverrouiller** (passkey ou code). Déverrouillé : une ligne par entrée, « Reçu le {date} · s'efface dans 4 h 12 » (compte à rebours : `Countdown`, mêmes seuils d'annonce, à la seconde sous 5 min), **Ouvrir** (écran de contenu en mode local : pas de « Terminer », pas de réseau ; « Enregistrer » selon le droit), **Effacer**. Pied : **Vider le coffre**. À l'échéance d'une entrée ouverte : dissolution, puis « Ce partage a expiré : sa copie a été effacée de ce téléphone. »
- Démo GitHub Pages : coffre **désactivé** (faux serveur en mémoire, et origine `skoow.github.io` partagée entre tous les dépôts Pages du propriétaire : IndexedDB et OPFS y seraient lisibles par ses autres pages).

### 27.7 Lentilles « sharp edges » et « insecure defaults »

| # | Gravité | Endroit | Problème | Correction (intégrée) |
|---|---|---|---|---|
| V1 | Élevée | Droit absent ou mal formé | Un défaut permissif ferait garder des copies sans accord | Absent, inconnu ou mal typé → `"voir"` (le plus restrictif, §34) ; seul `rights === "coffre"` avec `keep_ttl_h ∈ {1, 6, 12, 24}` ouvre le coffre |
| V2 | Élevée | Code du coffre | Un code court tombe hors ligne après copie du stockage, quel que soit le compteur | `checkPassword` imposé (12 caractères) ; passkey proposée d'abord |
| V3 | Élevée | PRF absente au déverrouillage | Repli silencieux vers un mode plus faible | Mode fixé à la création ; PRF absente plus tard → erreur « Ce coffre a été créé avec une passkey » ; jamais de repli |
| V4 | Moyenne | Compteur d'essais | Incrémenté après l'essai : tuer l'app donne des essais gratuits ; une annulation compterait | Incrémenté avant ; seule une erreur du témoin compte |
| V5 | Moyenne | Échéance en clair | Modifiable sur l'appareil pour prolonger | Échéance authentifiée vérifiée avant tout déchiffrement ; horloge monotone par `derniere_heure_vue` |
| V6 | Moyenne | Échéance fournie par le serveur | Un serveur malveillant l'allongerait | `min(expiresInS, keep_ttl_h)` |
| V7 | Moyenne | Démo | Origine partagée `skoow.github.io` | Coffre désactivé en démo, test |
| V8 | Faible | Taille | Remplir le téléphone | Plafonds de §27.3, vérification avant le téléchargement |

### 27.8 Questions ouvertes (défaut recommandé)

| # | Question | Défaut recommandé |
|---|---|---|
| Q-V1 | `N` essais avant effacement | 5, comme le partage |
| Q-V2 | Verrouillage | à la sortie de l'écran, en arrière-plan, et après 2 min sans geste |
| Q-V3 | Indice dans le lien (« gardable ») pour prévenir avant le déverrouillage | Non : note fixe pour tous (aucun changement de format, rien n'est révélé à qui voit le lien) |
| Q-V4 | Plafonds | 1 Gio par entrée, 2 Gio et 20 entrées au total |
| Q-V5 | Coffre sur ordinateur (PWA installée) | Non (décision du propriétaire : téléphone seulement) ; la détection (`display-mode: standalone` et `pointer: coarse`) est un garde d'interface, pas une frontière de sécurité |
| Q-V6 | Hors-ligne | Dépend de Q-C1 (§28.6) ; sans service worker, coffre en ligne seulement |

---

## 28. Décision du propriétaire (v2.6) — code vérifiable (zéro confiance, priorité)

Risque visé : un serveur compromis sert un JavaScript modifié qui vole les clés (§2, §18.2). Le chiffrement de bout en bout ne vaut que ce que vaut le code qui le fait. But : que n'importe qui puisse prouver que les fichiers servis sont exactement ceux construits depuis le dépôt public, et que le propriétaire soit prévenu d'un écart. **Aucune de ces mesures n'empêche un serveur compromis de servir un code piégé à une victime choisie** sans que personne ne le voie (§28.8).

### 28.1 Builds reproductibles

- Node épinglé à la version exacte (`.node-version`, lu par `actions/setup-node`), `npm ci` sur le verrou commité, `SOURCE_DATE_EPOCH` = date du commit, `TZ=UTC`, `LANG=C.UTF-8`, `umask 022`. Aucun horodatage, chemin absolu ni valeur aléatoire dans `dist/` (`sourcemap: false` déjà). Les fichiers générés (polices, grain, aurore, icônes) sont commités, pas régénérés au build.
- La configuration de déploiement n'est jamais injectée dans les fichiers servis : la clé de site reCAPTCHA (publique) et l'origine de l'application sont écrites dans `web/verif/config.prod.js`, commité (UI §15.2 disait « écrite au déploiement » : signalé, corrigé ici, sinon `dist-verif/` n'est pas reproductible).
- Job CI `repro` : deux builds dans deux dossiers absolus différents, sur deux runners distincts, puis comparaison de `SHA256SUMS`. Toute différence fait échouer le job, qui est **obligatoire** pour une publication (jamais `continue-on-error`).

### 28.2 Manifeste de version signé

- `web/scripts/release-manifest.mjs` (sans dépendance, `node:crypto`) écrit `release.json` : `{ "schema": 1, "name": "shhdrop-web", "version", "commit", "files": [{ "path", "size", "sha256" }] }`, fichiers triés par chemin (ordre des octets), JSON à clés ordonnées, fin de ligne LF ; et `SHA256SUMS` (format `sha256sum -c`). Trois manifestes : `dist/`, `dist-verif/`, `dist-demo/`.
- Le manifeste est **commité** dans `releases/web/<version>.json` avant l'étiquette (`make release-manifest`, build local) : la CI reconstruit et exige l'égalité, ce qui prouve aussi « build local = build CI ».
- Workflow `release.yml` sur une étiquette `web-v<x.y.z>` : reconstruction, comparaison, puis signature **sans clé** par `cosign sign-blob --bundle release.json.sigstore.json` (jeton OIDC de GitHub Actions, certificat Fulcio, inscription dans le journal public Rekor). Publication dans la Release GitHub : `release.json`, son bundle, `SHA256SUMS` et l'archive `dist.tar.gz` déterministe (`tar --sort=name --mtime=@$SOURCE_DATE_EPOCH --owner=0 --group=0 --numeric-owner`, `gzip -n`). Permissions : `id-token: write` et `contents: write` dans ce seul job ; actions épinglées par empreinte.
- Vérification : `cosign verify-blob release.json --bundle release.json.sigstore.json --certificate-oidc-issuer https://token.actions.githubusercontent.com --certificate-identity-regexp '^https://github\.com/Skoow/Shhdrop/\.github/workflows/release\.yml@refs/tags/web-v[0-9]+\.[0-9]+\.[0-9]+$'`. Jamais d'expression ouverte (`.*`), jamais `--insecure-ignore-tlog`.
- Étiquettes `web-v*` protégées (règle de dépôt : création réservée au propriétaire). Ce que la signature prouve : « construit par ce workflow, depuis ce commit public ». Ce qu'elle ne prouve pas : que ce code est sain. Un compte GitHub volé peut signer une version piégée : elle sera publique et visible dans Rekor (détectable, pas empêché).
- Limite post-quantique : les signatures Sigstore sont en ECDSA P-256, forgeables par un futur ordinateur quantique ; migration quand Sigstore proposera ML-DSA (§30).

### 28.3 SRI sur chaque script et style

- Greffon Vite `sri` (une quarantaine de lignes, `node:crypto` SHA-384) : `integrity="sha384-…"` sur chaque `<script type="module">`, `<link rel="stylesheet">` et `<link rel="modulepreload">` de `index.html`, `pdf-frame.html` et `verif/index.html`. `check-dist.mjs` échoue si une balise de script ou de style n'a pas d'`integrity`.
- SRI ne couvre ni `import()` dynamique, ni `new Worker(url)`. Une carte d'import avec `integrity` exigerait un script en ligne, donc un hachage dans la CSP de chaque réponse : refusé. Règle : **aucun `import()` dynamique dans le build de production** (le QR est importé statiquement ; contrôle par `check-dist.mjs`) ; le Worker anti-robot n'est couvert que par le manifeste (vérificateur, §28.4, et service worker, §28.6).
- Honnêtement : contre un serveur compromis, SRI seul ne protège rien (il modifie aussi `index.html`). Il réduit la vérification à un fichier : avec SRI, l'empreinte de `index.html` fixe tous les scripts et styles qu'il charge.

### 28.4 Vérificateur

- **Ligne de commande** : `web/scripts/verify-site.mjs <origine> <release.json>` (sans dépendance) télécharge chaque fichier listé depuis l'origine, avec `Cache-Control: no-cache`, compare SHA-256 et taille, vérifie que `/index.html`, `/`, `/s/x` et `/x` (repli monopage) rendent les mêmes octets que `index.html`. Code de sortie non nul au premier écart ou à la première erreur réseau (jamais « vert » sur une erreur). Mode d'emploi : `cosign verify-blob …` (§28.2), puis `node verify-site.mjs https://shhdrop.app release.json`.
- **Page « Vérifier cette version »** (`/verifier`, mode Read, liée depuis Sécurité et le pied de page) : numéro de version et commit, lien vers la Release GitHub et vers le mode d'emploi. Elle dit : « Cette page ne peut pas prouver sa propre intégrité : un serveur piégé pourrait la modifier aussi. Vérifiez avec un outil qui ne vient pas de ce site. » Elle n'affiche aucune empreinte calculée par elle-même (ce serait une preuve qui se certifie seule).
- **Plus tard** : l'application native embarque l'interface (§16), signée par les magasins : le code ne vient plus du serveur à chaque visite, c'est la défense la plus forte. Une extension de navigateur de vérification (à la manière de Code Verify) est possible mais coûteuse à maintenir (Q-C2). Proposition de norme à suivre : intégrité, cohérence et transparence des applications web (WAICT), en cours de discussion.

### 28.5 Ce qu'une PWA peut vérifier sans service worker

Rien de fiable. Sans service worker, chaque lancement recharge le code depuis le serveur ; un code piégé désactiverait tout contrôle qu'il porte lui-même, et la page ne peut pas joindre GitHub (`connect-src 'self'`, aucune ressource tierce). Erreur dans la spécification, signalée : la §10 justifie l'absence de service worker par « aucun code piégé ne reste installé ». C'est faux face à un serveur compromis : il peut enregistrer **son propre** service worker, que notre choix n'empêche pas. Correctif proposé pour le plan d'incident (§15.5) : servir un `sw.js` qui se désinscrit lui-même et `Clear-Site-Data: "cache"` (sans `"storage"`, qui viderait les coffres).

### 28.6 Service worker minimal d'épinglage : discussion et recommandation

- **Ce qu'il apporte** : (1) l'application démarre sans réseau, ce qu'exige le coffre hors ligne (§27.5) ; (2) les fichiers sont servis depuis un cache vérifié : chaque fichier de la version installée est téléchargé une fois, haché (WebCrypto) et comparé à son manifeste, embarqué dans `sw.js` ; un fichier modifié sur le serveur, sans changement de `sw.js`, est refusé et signalé ; (3) un changement de version devient un événement visible (« Nouvelle version {x} : vérifier »).
- **Ce qu'il n'apporte pas** : un serveur compromis remplace `sw.js` lui-même. Le navigateur revérifie `sw.js` en contournant le service worker (au plus toutes les 24 h, et à chaque navigation) ; le nouveau, s'il appelle `skipWaiting()`, prend la main. L'ancien code peut seulement prévenir les pages ouvertes (`controllerchange`) : il verrouille le coffre et affiche « Le code de Shhdrop vient de changer ». Ce n'est donc **pas** une garantie de sécurité.
- **Ce qu'il coûte** : contredit §1, §10 et UI §14.1 (« pas de service worker ») ; une surface de code de plus, qui persiste ; un cache à purger correctement.
- **Recommandation** : l'adopter **seulement si le coffre est gardé**, et seulement dans cette forme : moins de 150 lignes, aucune dépendance (ni Workbox), relu ligne à ligne ; cache des seuls fichiers du manifeste ; `/api/` jamais intercepté ni mis en cache (réseau direct) ; installation qui échoue (rien n'est mis en cache) au premier écart d'empreinte ; aucun `skipWaiting()` ni `clients.claim()` (la nouvelle version s'applique au prochain lancement, annoncée) ; navigations servies par le `index.html` en cache. Pas de service worker en démo. **Q-C1 au propriétaire** ; sans accord, la règle « pas de service worker » reste en vigueur et le coffre reste en ligne seulement.

### 28.7 Impact sur le Plan 3 (déploiement)

- `deploy.sh` télécharge l'archive, `release.json` et son bundle depuis la Release, exécute `cosign verify-blob` (identité exacte de §28.2) et `sha256sum -c`, décompresse dans `SHH_STATIC_DIR` (volume en lecture seule), puis lance `verify-site.mjs` contre `https://shhdrop.app` à travers Caddy, et revient en arrière au premier écart. Aucune option pour sauter la vérification.
- Caddy ne modifie aucun corps de réponse (ni `templates`, ni réécriture) ; la compression ne change pas les octets décompressés.
- Surveillance externe : workflow GitHub planifié (toutes les heures) qui lance `verify-site.mjs` contre la production et l'origine de vérification et ouvre une alerte au premier écart. Limite : il ne voit que ce que le serveur lui sert ; un serveur qui ne piège que certaines victimes (adresse IP, navigateur) passe inaperçu.
- Image du serveur : build Go `-trimpath -buildvcs=false`, `CGO_ENABLED=0`, image épinglée par empreinte (D3) et attestée par cosign. Le serveur n'est pas de confiance pour le contenu (chiffrement de bout en bout) : cette attestation sert l'exploitation, pas la confidentialité.

### 28.8 Lentilles et limites

| # | Gravité | Endroit | Problème | Correction (intégrée) |
|---|---|---|---|---|
| C1 | Élevée | `cosign verify-blob` | Une identité en expression ouverte accepte la signature de n'importe quel workflow GitHub | Expression ancrée, workflow et étiquette exacts |
| C2 | Élevée | `deploy.sh` | Une option « sauter la vérification » finirait utilisée en urgence | Aucune option ; échec = retour arrière |
| C3 | Élevée | Service worker | Installer en cache un fichier non vérifié | Installation qui échoue au premier écart |
| C4 | Moyenne | Job `repro` | Non bloquant, il ne prouve rien | Obligatoire pour la Release |
| C5 | Moyenne | Vérificateur | Vert sur une erreur réseau, ou fichiers en plus non vus | Code non nul ; limite écrite : le repli monopage empêche d'énumérer des fichiers en plus, on vérifie que tout chemin inconnu rend `index.html` |
| C6 | Moyenne | SRI | `import()` et `Worker` hors SRI | Pas d'`import()` en production ; Worker couvert par le manifeste |
| C7 | Faible | Page `/verifier` | Une page qui certifie sa propre empreinte | Aucune empreinte affichée, texte honnête |

Limite résiduelle assumée (à ajouter à §18) : une victime ciblée par un serveur compromis reçoit un code piégé ; la vérification publique ne la protège que si elle vérifie elle-même, avant d'utiliser le site, avec un outil qui ne vient pas du site.

### 28.9 Questions ouvertes

| # | Question | Défaut recommandé |
|---|---|---|
| Q-C1 | Service worker minimal d'épinglage (§28.6) | Oui, seulement avec le coffre, dans la forme de §28.6 ; sinon non |
| Q-C2 | Extension de navigateur de vérification | Non en V1 ; application native d'abord (§16) |
| Q-C3 | Démo signée elle aussi | Oui (même workflow, coût nul) |

---

## 29. Décision du propriétaire (v2.6) — chiffrement anticipé (« au plus 5 s d'attente »)

Remplace §7.1 à §7.5 pour tout nouveau partage. Les étiquettes passent en `shhdrop/v2/` : toutes les clés changent (§7.1). Aucune construction maison : HKDF-SHA-256, HMAC-SHA-256, SHA-256, AES-256-GCM (WebCrypto) et Argon2id (libsodium).

### 29.1 Ce qui attend vraiment, en chiffres

- **Chiffrer n'est pas le goulot** : AES-256-GCM dans WebCrypto passe par l'accélération matérielle, de l'ordre de 1 à 3 Go/s sur ordinateur et de 0,3 à 1 Go/s sur téléphone récent ; la v1 chiffre déjà chaque bloc pendant l'envoi du précédent.
- **Argon2id** (64 Mio, 3 passes) : de 0,3 à 1,5 s selon l'appareil. Dans la v1, il bloque au clic.
- **Le réseau est de la physique** : 1 Go à 100 Mbit/s en montée prend environ 80 s (1 Gio environ 86 s) ; à 20 Mbit/s (4G courante), environ 7 min ; à 500 Mbit/s (fibre), environ 17 s. Aucun choix de chiffrement ne réduit ce temps.
- **Ce que la v2 change** : l'envoi chiffré commence **pendant la composition**, avant tout mot de passe ; Argon2id du mot de passe généré se calcule pendant la composition. Au clic sur « Envoyer », il ne reste que : enveloppe de la clé (quelques millisecondes), envoi de ce qui n'est pas encore parti (au plus 2 segments de 4 Mio, plus ce que le réseau n'a pas encore absorbé), `finalize`. Cible : **≤ 5 s après le clic quand l'envoi anticipé a rattrapé la composition**, soit environ 1,5 s à 50 Mbit/s et 3,5 s à 20 Mbit/s ; au-dessous d'environ 15 Mbit/s, ou si l'on clique avant que l'envoi ait rattrapé, l'attente est celle du réseau, affichée honnêtement (§9.4 UI).
- **À l'attention du propriétaire** : « tout chiffrer sur notre serveur, sans calcul sur l'appareil » est impossible en chiffrement de bout en bout : le serveur verrait le contenu en clair. On garde le chiffrement dans le navigateur et on le rend invisible.

### 29.2 Clés

| Élément | Création | Où il vit |
|---|---|---|
| `K_lien` | 32 octets aléatoires, tirés au début de l'envoi anticipé | après le `#` du lien (§32) ; jamais envoyé |
| `id` | HKDF(`K_lien`, « shhdrop/v2/id »), 16 octets | serveur (clé primaire) ; calculé par le client (§32) |
| `K_accès`, `V_accès` | HKDF(`K_lien`, « shhdrop/v2/acces »), SHA-256(`K_accès`) | envoyé / serveur |
| `R` (graine de contenu) | 32 octets aléatoires, tirés au début de l'envoi anticipé | navigateur ; mis à zéro après l'enveloppe, ou à l'abandon |
| `K_contenu` | HKDF(`R`, « shhdrop/v2/contenu »), AES-256-GCM, non extractible | navigateur |
| `C_engagement` | HMAC-SHA-256(`R`, « shhdrop/v2/engagement ») | en-tête en clair « SHH2 » |
| `S_gestion`, `V_gestion` | 32 octets aléatoires, SHA-256 | lien de gestion (§32) / serveur |
| `sel` | 16 octets aléatoires, tirés au début de l'envoi anticipé | serveur (renvoyé par `meta`) |
| `K_mdp` | Argon2id(mot de passe NFC, `sel`) : 64 Mio, 3 passes, 1 fil, 32 octets | navigateur |
| `K_maître` | HKDF(`K_lien` ‖ `K_mdp`, « shhdrop/v2/maitre ») | navigateur |
| `K_env` | HKDF(`K_maître`, « shhdrop/v2/enveloppe »), AES-256-GCM | navigateur |
| `K_preuve`, `V_preuve` | HKDF(`K_maître`, « shhdrop/v2/preuve »), SHA-256(`K_preuve`) | envoyé pour déverrouiller / serveur |
| `E` (enveloppe) | `nonce` (12 octets aléatoires) ‖ AES-256-GCM(`K_env`, `nonce`, `R`, données authentifiées = « shhdrop/v2/enveloppe » ‖ `id` ‖ en-tête de 48 octets), 60 octets | serveur ; rendue seulement après un déverrouillage réussi |

À l'ouverture : `unlock` réussi → `E` → `K_env` (lien + mot de passe) → `R` → contrôle de `C_engagement` (`crypto.subtle.verify` HMAC) → `K_contenu` → lecture.

### 29.3 Paquet v2

- En-tête « SHH2 », version 2, `C_engagement` (48 octets). Clair du paquet de `B` morceaux : **données** (éléments dans l'ordre d'ajout, à partir de l'octet 0) ‖ zéros ‖ **manifeste** ‖ longueur du manifeste (4 octets) en toute fin. Le manifeste (JSON v2, §34) donne la position de chaque élément ; l'ordre d'affichage y est indépendant de l'ordre d'ajout, donc renommer ou réordonner ne touche pas les données déjà parties.
- Morceaux, nonces, données authentifiées, segments de transport : inchangés (§7.3, principe STREAM). **Chaque numéro de morceau n'est chiffré qu'une fois par `R`** ; un segment réessayé renvoie les mêmes octets.
- **Palier canonique v2** : le plus petit palier de capacité ≥ fin des données + 4 + `MANIFEST_MAX` (64 Kio). La longueur réelle des noms n'influence donc pas le palier ; `CONTENT_MAX` est inchangé.
- **Bourrage rempli par le serveur** : les segments entièrement compris entre le dernier segment de données et le segment de fin ne sont pas envoyés ; `finalize` les désigne (`fill_from`, `fill_to`) et le serveur les remplit d'octets aléatoires (`crypto/rand`), indiscernables d'un chiffré pour qui lit le disque. Le lecteur ne lit jamais le bourrage (§7.3). Gain : jusqu'à la moitié de l'envoi en moins.

### 29.4 Envoi anticipé

1. **Démarrage** : composition non vide et stable depuis 2 s, page visible, en ligne, `navigator.connection.saveData` faux, preuve anti-robot disponible (pré-calculée, UI §9.4.2). `POST /api/shares` : `id`, palier, `V_accès`, `V_gestion`, preuve anti-robot. Ni durée, ni ouvertures, ni sel, ni `V_preuve` à ce stade.
2. **Pendant la composition** : chaque segment dont les 64 morceaux sont des données complètes est chiffré puis envoyé. Ajouter un élément qui tient dans le palier : il est ajouté à la suite. Renommer, réordonner, modifier un texte (les textes sont dans le manifeste) : rien à refaire.
3. **Redémarrage** (nouveaux `K_lien`, `R`, `sel`, nouveau partage ; l'ancien est détruit par `S_gestion` en `keepalive`) quand : un élément dont un morceau a déjà été chiffré est retiré ou remplacé (sinon le destinataire pourrait déchiffrer un élément retiré, puisqu'il recevra `R`), ou la composition dépasse le palier réservé. Au plus 3 redémarrages par 10 min ; au-delà, l'envoi attend le clic.
4. **Au clic sur « Envoyer »** : `K_mdp` (déjà calculé pour le mot de passe généré ; sinon, Argon2id au plus tard une seconde après la dernière frappe), `K_maître`, `K_env`, `K_preuve`, `E` ; chiffrement et envoi du dernier segment de données et du segment de fin (manifeste) ; `POST finalize` : `sel`, `kdf_ops`, `kdf_mem`, `V_preuve`, `E`, durée, ouvertures, `fill_from`, `fill_to`. Le serveur vérifie que tous les autres segments sont présents, passe en `ready`, fixe `expires_at` (inchangé : à partir de la fin de l'envoi), puis remplit le bourrage.
5. **Abandon** (page quittée, liste vidée, onglet tué) : `R` n'est jamais enveloppée et disparaît avec la page : le chiffré déjà envoyé n'est plus déchiffrable par personne (effacement cryptographique). Le partage est détruit en `keepalive` quand c'est possible, sinon effacé par les règles existantes (aucun segment en 5 à 20 min, 15 min sans segment, échéance de 3 h, §7.4).
6. Le serveur apprend qu'une composition est en cours et voit arriver les segments.

### 29.5 Quotas et anti-abus

- Les quotas de la §4 (10 liens par jour et par connexion, 30 par /48, 3 Gio utiles par jour, 6 Gio par /48) sont **débités à `finalize`** ; la création est refusée s'ils sont déjà atteints.
- Nouveaux plafonds pour les envois anticipés : au plus 2 envois non finalisés à la fois par connexion (6 par /48) ; **octets abandonnés** (envois effacés sans `finalize`) : 6 Gio par jour et par connexion, 12 Gio par /48, débités à l'effacement ; au-delà, l'envoi anticipé est refusé (429) et l'écran revient à l'envoi au clic. La place reste réservée à la création (plafond global, §4).
- La difficulté de la preuve de travail compte toutes les créations de l'heure (finalisées ou non) : les redémarrages sont bornés (point 3).

### 29.6 Pré-lecture chez le destinataire

- Pendant la saisie du mot de passe, le navigateur télécharge les segments chiffrés avec `K_accès` seul : `GET /segments/{n}` avec l'en-tête `K_accès`, accepté **seulement en état `ready`**, avant l'expiration, sans consommer d'ouverture. Ordre : segment de fin (manifeste), puis les premiers segments de données, jusqu'à 64 Mio.
- Sûr parce que `R` est aléatoire : sans `E`, rendue seulement après un `K_preuve` juste, le chiffré ne permet **aucun** essai hors ligne de mot de passe (en v1, `K_contenu` dérivait du mot de passe : la même pré-lecture aurait permis de deviner hors ligne à partir de `C_engagement`).
- Bande passante : budget de pré-lecture par partage, en mémoire, de 2 × la taille du palier sur toute sa vie ; au-delà, 429. Les segments pré-lus comptent dans la limite de 600 par minute.

### 29.7 Analyse des menaces de la v2

| Adversaire | v2 |
|---|---|
| Voleur de la base et des fichiers, sans le lien | Rien : `K_lien` 256 bits |
| Voleur de la base **et** du lien | Un Argon2id par mot de passe essayé, contre `V_preuve` ou `E` : même coût qu'en v1 (§31 pour le mot de passe par défaut) |
| Détenteur du lien seul (sauvegarde de messagerie) | Pré-lecture du chiffré, inutile sans `E` ; en ligne, 5 essais puis destruction (inchangé) |
| Serveur malveillant | N'a ni `K_lien`, ni `K_mdp`, ni `R` ; ne peut fabriquer ni `E` (il lui faudrait `K_env`) ni un paquet pour plusieurs clés (`C_engagement`) ; échanger `E` ou le chiffré d'un autre partage échoue (`id` et en-tête authentifiés) |
| Serveur qui observe les envois | **Nouveau** : l'ordre et l'heure des segments donnent la taille du contenu à 4 Mio près, et le fait qu'une composition est en cours ; en v1, il ne connaissait que le palier. Limite assumée, à ajouter à §18 |
| Abandon | Chiffré indéchiffrable (`R` oubliée) puis effacé |
| `R` en mémoire | Elle vit dans la page pendant la composition, comme les fichiers en clair eux-mêmes : aucune exposition nouvelle |

### 29.8 API (remplace les lignes concernées de §8)

| Route | Changement |
|---|---|
| `POST /api/shares` | Corps : `id`, `bucket`, `access_v`, `manage_v`, preuve anti-robot. Le serveur refuse un `id` existant (clé primaire) : le client recommence avec un nouveau `K_lien` |
| `POST /api/shares/{id}/finalize` | Corps : `salt`, `kdf_ops`, `kdf_mem`, `proof_v`, `envelope`, `ttl_hours`, `max_opens`, `fill_from`, `fill_to` (longueurs exactes, JSON strict) |
| `POST /api/shares/{id}/unlock` | Réponse : jeton de téléchargement **et** `envelope` |
| `GET /api/shares/{id}/segments/{n}` | Jeton de téléchargement, **ou** `K_accès` (pré-lecture, §29.6) |
| `GET /api/manage/status`, `POST /api/manage/destroy` | Nouvelles : `S_gestion` en en-tête, recherche par `manage_v` (index unique) ; remplacent `GET /{id}/status` et la destruction par `S_gestion` (§32) |

Table `shares` : `proof_v`, `salt`, `kdf_*`, `ttl_hours`, `max_opens` deviennent `NULL` jusqu'à `finalize` ; colonne `envelope` (60 octets) ; index unique sur `manage_v`. Le test « le serveur ne voit rien » ajoute un repère de mot de passe saisi **après** le début de l'envoi anticipé, et vérifie qu'aucune requête ne porte `R`, `K_contenu`, `K_mdp` ni `K_lien`.

---

## 30. Revue post-quantique (v2.6)

- **Contenu** : aucune cryptographie à clé publique ne le protège. AES-256 garde environ 128 bits de sécurité face à l'algorithme de Grover ; HKDF-SHA-256, HMAC-SHA-256 et Argon2id restent adaptés. `K_lien` et `S_gestion` font 256 bits pour cette raison : ne pas les raccourcir (§32).
- **Transport** : TLS protège `K_accès`, `K_preuve`, `E` et le chiffré, jamais `K_lien` ni le mot de passe. Un enregistrement « stocker maintenant, déchiffrer plus tard » ne donnerait donc pas le contenu, mais des métadonnées et des secrets d'accès. Défense en profondeur : **échange de clés hybride X25519MLKEM768 obligatoire** sur Caddy (proposé par défaut par Go 1.24 et plus, et par Caddy 2.10 et plus ; écrit explicitement dans le Caddyfile, `curves x25519mlkem768 x25519`). Repli X25519 seul toléré pour les navigateurs qui n'ont pas encore l'hybride (question Q-PQ1). **Test du Plan 3** : un client Go limité à `CurvePreferences: [X25519MLKEM768]` se connecte et `ConnectionState().CurveID` vaut `X25519MLKEM768` ; il bloque la mise en ligne.
- **Passkeys du coffre** (§27) : la sortie PRF est un HMAC calculé dans l'authentificateur, donc symétrique ; les signatures ECDSA de la passkey ne protègent rien ici.
- **Signatures de version** (§28.2) : ECDSA, donc à migrer vers une signature post-quantique quand Sigstore la proposera.
- Q-PQ1 : refuser les connexions sans hybride ? Défaut recommandé : non en V1 (Safari et Firefox anciens exclus sinon), à revoir avant l'ouverture au public.

---

## 31. Décision du propriétaire (v2.6) — mot de passe par défaut de 8 caractères

- Remplace la phrase de 4 mots de §4 comme défaut. `generatePassword()` tire 8 caractères dans un alphabet de 64 sans caractères ambigus : minuscules sans `l` ni `o` (24), majuscules sans `I` ni `O` (24), chiffres `2` à `9` (8), symboles `! # $ % + = ? @` (8). Tirage uniforme par `crypto.getRandomValues` (64 = 2⁶ : aucun biais), recommencé jusqu'à ce que les quatre familles soient présentes. Bouton **« Générer un autre »**, sans limite ; la personne peut saisir le sien.
- **Nombre exact** : 107 294 591 287 296 mots de passe possibles (4 familles présentes), soit **2^46,6** ; ce n'est pas 50 bits (2⁴⁸ sans la contrainte des familles).
- Le mot de passe généré a un type marqué (`GeneratedPassword`) accepté à 8 caractères ; un mot de passe saisi reste soumis à `checkPassword` (12 caractères, liste noire), un humain choisissant moins bien qu'un tirage.
- **Attaque hors ligne (base et lien volés)** : un essai = un Argon2id de 64 Mio et 3 passes. Hypothèse prudente pour un GPU haut de gamme, bornée par la bande passante mémoire : environ 2 000 essais par seconde. En moyenne (moitié de l'espace) : environ **850 ans-GPU**, soit environ 10 mois avec 1 000 GPU, pour un coût de l'ordre de 4 millions de dollars en location. Avec 10 caractères (2^59) : environ 4,7 millions d'années-GPU. La phrase de 4 mots donnait 2^51,7, environ 34 fois plus que 8 caractères.
- **Signalement (gravité moyenne)** : 8 caractères suffisent contre un attaquant opportuniste ; ils sont faibles contre un adversaire doté de moyens étatiques qui obtiendrait à la fois la base (serveur compromis) et le lien. La durée de vie du partage n'aide pas : le chiffré volé s'attaque à loisir. Recommandation : **10 caractères** par défaut (même alphabet, même saisie). Le propriétaire a demandé 8 : on applique 8, et la question est posée (Q-MDP1).
- Saisie au téléphone : les symboles demandent de changer de clavier ; c'est le prix des 64 symboles.

---

## 32. Décision du propriétaire (v2.6) — lien court

- **Lien de partage** : `https://shhdrop.app/#<K_lien en base64url, 43 caractères>` (64 caractères en tout, contre 90 environ). L'identifiant n'est plus dans le lien : `id` = HKDF(`K_lien`, « shhdrop/v2/id »), à sens unique. Le serveur ne voit même plus de chemin révélateur : la page demandée est `/`.
- **Lien de gestion** : `https://shhdrop.app/#m<S_gestion, 43 caractères>` ; le serveur trouve le partage par `V_gestion` (index unique), donc le lien de gestion n'a pas besoin de l'identifiant (§29.8).
- **Unicité** : `id` fait 128 bits tirés d'une clé aléatoire de 256 bits ; la probabilité d'une collision parmi n partages vaut environ n² / 2¹²⁹ (négligeable même pour 10¹² partages), et la clé primaire refuse de toute façon un doublon (le client recommence avec une nouvelle clé). Un lien n'est **jamais réutilisé** pour un nouveau partage : qui garde l'ancien lien y aurait accès. Chaque partage tire une `K_lien` neuve ; un créateur malveillant qui viserait un `id` passé sans connaître sa `K_lien` ne ferait correspondre aucun `V_accès`.
- **Pourquoi pas plus court** : 256 bits restent nécessaires (§30). Un chemin court (`/s#…`) n'apporterait que 2 caractères ; la racine est retenue.
- **Effets** : le routeur reconnaît `/` avec un fragment de 43 caractères base64url (partage) ou `m` + 43 (gestion) ; tout autre fragment est retiré (hygiène inchangée, UI §12.1) ; `X-Robots-Tag: noindex` et le repli `/s/`, `/m/` du serveur deviennent inutiles (le préfixe `/s/` peut rester réservé aux futurs liens universels, §16). Aucun lien ancien n'existe en production : pas de compatibilité. La démo suit le même format sous `/Shhdrop/`.

---

## 33. Décision du propriétaire (v2.6) — pas de compte ; historique local de l'expéditeur

- Personne n'a besoin d'un compte pour envoyer ou recevoir. Le serveur ne sait jamais qui a ouvert un lien (aucune adresse IP enregistrée, §9).
- **Historique des envois**, sur l'appareil de l'expéditeur seulement (`/envois`, téléphone et ordinateur) : pour chaque partage, état (actif, en cours d'effacement, détruit, expiré), ouvertures « 1 / 3 », **Détruire** en un geste (avec confirmation sur place). Contenu d'une entrée : `S_gestion`, échéance, maximum d'ouvertures, un libellé local (« 6 éléments · 142 Mo · 5 nov., 21 h »), et les ouvertures observées. **Jamais** `K_lien`, le mot de passe ni les noms des éléments : l'historique ne permet ni de lire le contenu, ni de le renvoyer.
- **Heures des ouvertures** : le serveur ne stocke aucune heure d'ouverture (§9.1). L'historique note l'intervalle pendant lequel le compteur a changé, entre deux relectures de `manage/status` (« ouvert entre 21 h 00 et 21 h 15 ») ; relecture toutes les 60 s seulement quand l'écran est visible ; sans relecture, pas d'heure.
- Exception écrite à UI §12.1 : `S_gestion` est stocké, chiffré (AES-256-GCM, clé non extractible créée par WebCrypto, gardée dans IndexedDB), dans le seul module `web/src/history/`. Honnêtement, cette clé est stockée sur le même appareil : le chiffrement ne protège que des lectures naïves du stockage ; la vraie protection est le verrouillage du téléphone. Verrou optionnel par passkey (même mécanisme que §27) : question Q-H1. Une entrée expirée ou détruite est retirée 7 jours après. « Effacer l'historique » à tout moment. Bascule « Garder dans mon historique » sur « Lien prêt », activée par défaut.
- « Ces informations ne seront plus jamais affichées » (§5.1) reste vrai pour le lien et le mot de passe ; seul le lien de gestion est gardé.
- **Plus tard, hors V1** : compte optionnel par passkey pour synchroniser l'historique entre appareils. Coût pour la vie privée : le serveur relierait entre eux les partages d'une même personne (même chiffrés, les envois deviennent associables à un compte), ce qui crée une identité côté serveur et relance la question de conservation des données (LCEN, §17).

---

## 34. Décision du propriétaire (v2.6) — droits du destinataire

| Droit (`rights` du manifeste v2) | Effet chez le destinataire |
|---|---|
| `"voir"` — « Voir seulement » | Aucun bouton Enregistrer ni Copier ; `controlsList="nodownload"`, `disablePictureInPicture`, menu contextuel des médias neutralisé, `-webkit-touch-callout: none`. Mention : « L'expéditeur a choisi « voir seulement ». Cela n'empêche pas une capture d'écran. » |
| `"enregistrer"` — « Voir et enregistrer » (**par défaut**) | Comportement actuel (UI §9.8, §9.9) |
| `"coffre"` — « Voir, enregistrer et garder dans le coffre » | En plus : « Garder dans le coffre », téléphone seulement (§27) ; porte `keep_ttl_h` |

- Le droit est dans le **manifeste chiffré et authentifié** : le serveur ne le voit pas et ne peut pas l'élargir. Absent, inconnu ou mal typé → `"voir"` (le plus restrictif).
- **Contradiction signalée** avec D1 (§0, « mode lecture seule retiré : fausse impression de sécurité ») : le propriétaire le réintroduit. Appliqué avec un texte honnête des deux côtés ; à l'expéditeur : « Ce n'est qu'une dissuasion : le destinataire peut toujours faire une capture ou filmer l'écran, et un navigateur modifié peut enregistrer quand même. »
- « Voir seulement » est refusé (choix désactivé, avec la liste des éléments en cause) si un élément ne peut pas s'afficher dans le navigateur (archives, bureautique, plus de 200 Mio) : il serait inaccessible au destinataire.
- Manifeste v2 : `{ "v": 2, "rights": "enregistrer", "keep_ttl_h"?: 12, "items": [...] }`.

### Questions ouvertes de §29 à §34 (défaut recommandé)

| # | Question | Défaut recommandé |
|---|---|---|
| Q-K1 | Accepter la fuite de la taille à 4 Mio près vers un serveur qui observe l'envoi anticipé (§29.7) | Oui (décision de vitesse) ; bascule « Envoyer seulement quand je clique » pour qui la refuse, désactivée par défaut |
| Q-K2 | Envoi anticipé sur données mobiles | Non si `saveData` ; oui sinon |
| Q-MDP1 | 8 ou 10 caractères par défaut | 10 recommandé ; 8 appliqué (demande du propriétaire) |
| Q-H1 | Verrou par passkey de l'historique | Non par défaut (destruction en un geste), proposé dans les réglages |
| Q-H2 | Historique activé par défaut | Oui, bascule sur « Lien prêt » |
| Q-R1 | Droit par défaut | « Voir et enregistrer » |
