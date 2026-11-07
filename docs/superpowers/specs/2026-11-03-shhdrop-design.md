# Shhdrop — spécification V1 (version 2, finale à valider)

Date : 4 novembre 2026 · Domaine visé : **shhdrop.app**
Historique : v1 du 3 novembre, puis revue critique indépendante et passage complet de recherche d'oublis (voir section 0). v2.4 (4 novembre) : durcissement après l'audit « sharp edges » (section 25). v2.5 (5 novembre) : repli Google reCAPTCHA isolé (section 26). v2.6 (5 novembre) : décisions du propriétaire, coffre chiffré sur téléphone (27), code vérifiable (28), chiffrement anticipé (29), revue post-quantique (30), mot de passe de 8 caractères (31), lien court (32), historique local sans compte (33), droits du destinataire (34, simplifiés en 34.1), puis aucune statistique, nettoyage des métadonnées de tous les fichiers et enregistrement dans l'interface (35), minimisation de ce que voit le serveur (36). v2.7 (5 novembre) : compte facultatif par passkey, sans e-mail (37) et offre payante facultative « patte blanche » (38). v2.8 (7 novembre) : compte facultatif complété pour la création, la connexion et la récupération (37.11), salon de discussion éphémère (39), formules Plus et Pro avec modèle de coûts (38.8), envoi direct pair à pair (40). Les sections 29 à 40 remplacent les passages signalés « → § » ci-dessous.

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
| Proxy d'entreprise / inspection TLS | Voir le chemin du lien, pas le `#` (→ §32 : le chemin est `/`, aucun identifiant dans les adresses de l'API) ; s'il déchiffre TLS, il voit aussi les en-têtes (`K_accès`, `S_gestion`) | Sans la clé d'accès, ni infos ni destruction possibles ; aucune adresse ne permet de relier l'envoi à l'ouverture (§29.8) |
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

- → §39 (v2.8) : salon de discussion éphémère chiffré, désormais spécifié (il était noté V2). → §40 : envoi direct pair à pair, en option.
- Adresse Tor (.onion) · App Store / Play Store (préparée, section 16) · calcul anti-robot (D4) · partage depuis la galerie Android (exigerait un stockage en clair sur le téléphone) · aperçu Word/Excel · lecture vidéo pendant le téléchargement · autres langues · audit externe (obligatoire avant ouverture large).

### Jamais

- Comptes **obligatoires**, profils, contacts (→ §37 : compte **facultatif** par passkey, jamais demandé pour envoyer ni recevoir) · publicité, analytics, traceurs, ressources tierces (seule exception : le repli reCAPTCHA isolé de la section 26) · tout mécanisme permettant au serveur de lire un contenu.
- **Aucune statistique** (décision du propriétaire, §35.1) : ni mesure d'audience, ni télémétrie, ni service de rapport d'erreurs (Sentry et semblables), ni statistiques ou compteurs côté serveur autres que les compteurs d'exploitation listés en §9.5. Rien n'est agrégé par personne, par connexion ou par partage au-delà de ce que les règles de la §4 exigent, et rien de cela n'est écrit sur disque.

---

## 4. Règles et limites

| Règle | Valeur V1 |
|---|---|
| Éléments par partage | 10 maximum |
| Taille par partage | 1 Gio de contenu utile ; v2 (§29.3) : plus grand palier de 16 385 morceaux de 64 Kio (1 Gio de données + le morceau du manifeste), fichier chiffré de 48 + 16 385 × 65 552 = 1 074 069 568 octets (avant v2 : 16 384 morceaux, §24) |
| Durée de vie | au choix 1 h, 6 h, 12 h, 24 h ; comptée **à partir de la fin de l'envoi** ; expiration arrondie au **quart d'heure supérieur** |
| Ouvertures | au choix 1 à 10 ; **une ouverture = un déverrouillage réussi** (recharger la page en consomme une, c'est affiché) |
| Fin de vie | le premier atteint : durée, ouvertures épuisées, destruction (expéditeur, destinataire, administrateur), signalement, 5 mots de passe faux |
| Mot de passe | → §31 (10 caractères générés par défaut, 10 au moins si saisi). Avant v2.6 : obligatoire ; généré par défaut : **4 mots** tirés d'une liste de 7 776 mots (≈ 52 bits) ; personnalisé : 12 caractères minimum et absent d'une liste noire des mots de passe courants (contrôle côté navigateur : le serveur ne peut pas le vérifier) |
| Essais de mot de passe | 5 ratés → destruction |
| Création de partages | 10 par jour par connexion (IPv4, ou bloc IPv6 /64) ; 30 par jour par bloc /48 ; 3 Gio utiles par jour par connexion et 6 Gio par bloc /48 (§24) |
| Limite de débit | 60 requêtes par minute par connexion sur les routes publiques ; les envois et téléchargements de segments porteurs d'un jeton valide ont leur propre limite, 600 par minute par connexion et 6 000 par bloc /48 (§24) ; un segment au jeton invalide compte dans les 60 |
| Transferts de segments | au plus 16 téléchargements simultanés par connexion, 64 par /48 et 256 au total ; envois : 8, 32 et 64 ; au-delà 429 (connexion, /48) ou 503 (serveur), avec `Retry-After` ; une ouverture lit au plus 2 × le fichier chiffré de son palier + 2 segments 0, puis 429 `budget` (§24) |
| Stockage total | plafond configurable (100 Gio par défaut), **réservé à la création** ; au-delà, nouveaux envois refusés |

→ §38.2 : limites de l'offre payante facultative (réserve de stockage séparée, §38.6) ; les limites ci-dessus restent celles du gratuit, pour toujours.

---

## 5. Parcours

### 5.1 Expéditeur

1. **Composer** : fichiers, photo, vocal, texte ; aperçu, ✕ pour retirer, jauge « 34 / 100 Mo · 3 / 10 ».
   - Métadonnées retirées de tous les formats pris en charge (photos, vidéos, audio, PDF, bureautique, §35.2), avec un état honnête par élément ; « Nettoyé » seulement quand le nettoyage a réussi.
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
| Crypto navigateur | **WebCrypto** (AES-256-GCM, HKDF-SHA-256, HMAC, SHA-256) + **libsodium.js** (Argon2id ; → §39.2 : aussi X25519, Ed25519, HMAC-SHA-256 et XChaCha20-Poly1305 pour le salon) | Standards reconnus, aucune crypto maison |
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

- `POST destroy` avec `K_preuve` (destinataire) ou `S_gestion` (expéditeur), ou `shhdrop admin destroy -` (administrateur, pour un signalement reçu par e-mail ; lien lu sur l'entrée standard, → §32).
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
| `PUT /api/shares/segments/{n}` | Envoi d'un segment | jeton d'envoi |
| `POST /api/shares/finalize` | Activation | jeton d'envoi |
| `GET /api/shares/meta` | Secondes restantes, sel, KDF | `K_accès` (en-tête) |
| `POST /api/shares/unlock` | Déverrouillage | `K_accès` + `K_preuve` |
| `GET /api/shares/segments/{n}` | Téléchargement | jeton de téléchargement |
| `POST /api/shares/done` | Fin de téléchargement | jeton de téléchargement |
| `POST /api/shares/destroy` | Destruction / signalement par le destinataire (motif) | `K_accès` + `K_preuve` |
| `GET /api/manage/status` | Ouvertures, secondes restantes | `S_gestion` (en-tête) |
| `POST /api/manage/destroy` | Destruction par l'expéditeur | `S_gestion` (en-tête) |

→ §29.8 (Task K2) : **aucun identifiant dans les chemins** ; le jeton signé désigne le partage, sinon `K_accès` ou `S_gestion`. → §37.8 : routes du compte facultatif sous `/api/compte/` ; §38.4 : jeton Privacy Pass (`Authorization: PrivateToken`) accepté sur `POST /api/shares` pour un partage Plus. → §37.11.1 : routes exactes du compte ; §39.3 : routes du salon sous `/api/salons/` (`meta`, `rejoindre`, `flux`, `trame`, `retirer`, `quitter`, `detruire`, `gestion`, `pieces`, `pieces/segments/{n}`, `pieces/finalize`, `pieces/retirer`).
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

`id` (clé primaire ; → §29.8 : identifiant interne tiré par le serveur, index uniques sur `access_v` et `manage_v` ; table `WITHOUT ROWID` : aucun compteur d'insertion ne trahit l'ordre de création), `state` (`uploading`, `ready`, `draining`), `bucket` (palier), `ttl_hours`, `max_opens`, `opens_left`, `opens_issued`, `done_mask` (un bit par ouverture terminée), `failed_attempts`, `segments_mask` (segments reçus), `salt`, `kdf_ops`, `kdf_mem`, `access_v`, `proof_v`, `manage_v` (SHA-256 de `K_accès`, `K_preuve`, `S_gestion`), `upload_deadline` (effacé à la finalisation), `progress_at` (pendant l'envoi seulement), `expires_at`, `purge_at`.

- Toutes les dates stockées sont **arrondies au quart d'heure supérieur**, sauf `progress_at`. → §36 S5, S11, S12 (Task M2) : `progress_at`, `upload_deadline` et `purge_at` passent en mémoire, `ttl_hours` à `NULL` après `finalize` ; la base ne garde plus qu'une date, `expires_at`.
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
- Secret des jetons, compteur agrégé des signalements (§9.5).
- Liste complète et justifiée de ces compteurs : §9.5. Tout ce que le serveur voit ou pourrait déduire : §36.

### 9.4 Journaux

- Journaux d'accès de Caddy **désactivés**.
- Journaux de l'application : uniquement des événements sans donnée personnelle.
- Règles de §36 : aucune adresse, aucun identifiant de partage, aucun en-tête du client dans un journal ni dans un message d'erreur.

### 9.5 Aucune statistique ; compteurs d'exploitation autorisés (§35.1)

Interdits, côté serveur comme côté navigateur : mesure d'audience, télémétrie, rapports d'erreurs envoyés à un service, `expvar`, `net/http/pprof`, Prometheus, OpenTelemetry, StatsD, « métriques » de Caddy (`metrics`), compteurs de partages créés, d'ouvertures, d'octets servis, de requêtes par route, histogrammes de latence, taux d'erreurs, et toute table ou fichier qui garde un historique d'activité. Un nouveau compteur exige une ligne de ce tableau, avec sa justification, avant d'être codé.

| Compteur (mémoire seulement) | Clé | Durée de vie | Pourquoi il est nécessaire |
|---|---|---|---|
| Créations et octets du jour (`count64`, `count48`, `bytes64`, `bytes48`) | HMAC(secret du jour, /64 ou IPv4, /48) | jusqu'à minuit UTC, secret jeté | quotas de §4 (10 et 30 liens, 3 et 6 Gio) |
| Requêtes et segments de la minute (`req`, `seg`, `seg48`) | idem | 1 min | limites de débit de §4 et §24 |
| Transferts simultanés (`Slots`) | idem, plus un total | durée du transfert | transferts bornés (§24, audit E1) |
| Envois anticipés en cours et octets abandonnés | id de l'envoi → clés HMAC ; clés HMAC → octets | jusqu'à `finalize` ou effacement ; minuit UTC | §29.5 |
| Budget de lecture par ouverture, budget de pré-lecture par partage | (id, n° d'ouverture) ; id | 3 h ; vie du partage | §24 (M1), §29.6 |
| Défis anti-robot consommés ; créations de l'heure par connexion | sel du défi ; HMAC de connexion | 2 min ; 1 h | usage unique ; difficulté qui double (§22 D4) |
| Signalements de l'heure | aucun (un seul entier) | remis à zéro chaque heure | alerte « les signalements s'accumulent » (§15.2) ; exposé seulement comme booléen sur `/healthz` local (§36, Task M2) |
| Place réservée totale | aucune (somme) | calculée depuis la base | plafond global `SHH_STORAGE_MAX` (§4) |
| Comptes créés du jour (§37.5) | HMAC(secret du jour, /64 ou IPv4, /48) | minuit UTC | 3 et 10 comptes par jour |
| Défis WebAuthn, sessions de compte (§37.3) | défi ; SHA-256(jeton) → `H` | 2 min ; 15 min sans usage, 2 h au plus | cérémonies à usage unique, session sans cookie |
| Écritures du coffre de compte, essais de secours (§37.5) | `H` ; HMAC de connexion | 1 h | 60 écritures par heure ; 10 essais par heure |
| Octets Plus du jour (§38.6) | HMAC(secret du jour, /64 ou IPv4, /48) | minuit UTC | 20 et 40 Gio par jour |
| Salons créés du jour, entrées de l'heure (§39.3.6) | HMAC(secret du jour, /64 ou IPv4, /48) | minuit UTC ; 1 h | 5 et 15 salons par jour ; 20 et 60 entrées par heure |
| Trames de la minute, flux ouverts (§39.3.6) | jeton de membre (SHA-256) ; HMAC de connexion | 1 min ; durée du flux | 60 par siège, 120 par connexion, 600 par /48 ; 4, 16 et 2 000 flux |
| Identifiants TURN de l'heure, octets relayés du jour (§40.4) | HMAC(secret du jour, /64 ou IPv4, /48) | 1 h ; minuit UTC | 30 identifiants par heure ; 5 Go relayés par jour (gratuit) |
| État d'un salon vivant (§39.3.2) : file de 200 trames, sièges, budget des trames | id interne du salon | vie du salon | relais et règles du salon ; pas une statistique |

Ne sont **pas** des statistiques : les colonnes d'un partage vivant (`opens_left`, `opens_issued`, `done_mask`, `failed_attempts`), nécessaires à ses règles et effacées avec lui. Hors de notre contrôle, à dire sur la page Confidentialité : les tableaux de bord de trafic de l'hébergeur, les statistiques de trafic de GitHub Pages pour la démo, la sonde externe de §15.2 (elle ne reçoit que la page d'accueil publique).

---

## 10. Sécurité du site web

- **En-têtes** :
  - CSP : `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`.
  - `require-trusted-types-for 'script'` **si** Svelte et libsodium le supportent sans politique « default » (testé au premier jour) ; sinon retiré.
  - `Strict-Transport-Security` (déjà préchargé pour .app), `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.
  - `Permissions-Policy: microphone=(self), camera=(), geolocation=()`. La photo passe par le sélecteur de fichiers, sans accès direct à la caméra. `microphone=(self)` sert au vocal enregistré dans l'interface (§35.3). `/pdf-frame.html` reçoit `microphone=(), camera=(), geolocation=()` (il n'en a jamais besoin). `camera=(self)` seulement si le propriétaire accepte la vidéo enregistrée dans l'interface (Q-REC1, §35.3).
  - `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`. Pas de COEP : inutile, Argon2id tourne sur un seul fil.
- **Aucune ressource tierce** sur les pages de l'application (seule exception, hors de ces pages : le cadre de repli reCAPTCHA, section 26). `robots.txt` et `noindex` sur les pages de partage, sans aperçu pour les messageries.
- **Fichiers du site** : servis depuis `SHH_STATIC_DIR` sans jamais en sortir (liens symboliques compris) ; fichiers et dossiers cachés (`.env`, `.git/…`) → 404 ; aucune liste de dossier (dossier sans `index.html` → 404) ; `GET` et `HEAD` seulement. Application monopage : un chemin inconnu sans extension sert `index.html` avec les mêmes en-têtes ; un fichier absent (`x.js`) → 404. ~~Sous `/s/` et `/m/`, repli particulier avec `X-Robots-Tag: noindex`~~ : retiré en Task K2 (§32, les liens sont à la racine ; un `#` abîmé par une messagerie reste sur `/`, qui charge l'application et le retire). Les segments cachés et la remontée (`..`) restent refusés ; `/api/…` et les autres préfixes ne changent pas.
- **Origine attendue** : le client ne prend jamais l'adresse du serveur dans le lien. Chaque fonction reçoit l'origine du site (`location.origin`) et refuse un lien d'une autre origine ou qui contient des identifiants (`user:pw@`) ; l'origine doit être `https://hôte[:port]` exacte (http seulement pour `localhost`, `127.0.0.1`, `[::1]`). → §39.1 : le préfixe `#c` (salon) s'ajoute. Cela protège aussi hors navigateur (Node, future appli, §16), où la CSP ne s'applique pas.
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

- **Vocal** : enregistré dans l'interface (§35.3) avec `MediaRecorder`, en **AAC/MP4** quand c'est disponible (lisible partout), sinon Opus/WebM. Compatibilité testée sur iPhone, Android et ordinateur.
- **Photo** et **vidéo** : sélecteur de fichiers (`<input capture>`) ; vidéo enregistrée dans la page : question Q-REC1 (§35.3).
- **Retrait des métadonnées**, sans réencodage, pour tous les formats courants (images, PDF, bureautique, vidéo, audio) : **§35.2**, qui remplace l'ancienne liste (JPEG, PNG, WebP seulement ; HEIC et vidéos non nettoyés).

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
- **Aucune statistique** (§35.1) : recherche dans les sources, les dépendances (`package-lock.json`, `go.sum`) et le build (`dist/`, `dist-verif/`, `dist-demo/`) des SDK et adresses connus de mesure d'audience, télémétrie et rapports d'erreurs (liste en §35.1) ; côté serveur, aucune table hors `shares`, toute `map` déclarée hors de la liste blanche de §9.5 fait échouer le test, et chaque compteur de §9.5 est vide après sa rotation (horloge injectée).
- **Métadonnées** (§35.2) : pour chaque format, fichiers d'essai réels générés localement avec des repères (GPS fictif, appareil, auteur, logiciel, dates) ; aucun repère après nettoyage, éléments à garder intacts, fichier toujours lisible ; échec d'analyse jamais annoncé « Nettoyé ».

### Manuels (avant chaque mise en ligne)

- Site de test séparé.
- Liste de vérification sur un vrai iPhone et un vrai Android : photo (orientation correcte), photo et vidéo avec localisation activée puis fichier reçu passé à `exiftool` et `ffprobe` (aucune position, aucun appareil, aucune date de prise), document Word et LibreOffice avec auteur, vocal enregistré sur l'un et lu sur l'autre (pause comprise), vidéo d'iPhone lue sur Android, PDF, mauvais mot de passe, expiration, destruction, installation de la PWA, accessibilité (VoiceOver / TalkBack).

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
- `shhdrop admin destroy -` : traite un signalement ; le lien est lu sur l'**entrée standard**, pour qu'il n'aille ni dans l'historique du shell ni dans `/proc/<pid>/cmdline`. → §32 (Task K2) : le lien ne contient plus que la clé ; la commande en tire `K_accès` (HKDF, §29.2), cherche le partage par `V_accès` et n'écrit rien. `shhdrop admin destroy <argument>` est refusé (erreur d'usage) : tout argument contiendrait la clé. → §39.1 : un lien `#c` détruit le salon (`K_accès_s`, « shhdrop/v2/salon/acces »).
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
- **Compte facultatif et offre payante** : → §37.9 (conservation des données de création de compte) et §38.5 (statut professionnel, factures, TVA, rétractation, CGV, médiateur), à faire valider avant d'activer l'un ou l'autre en public.
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
12. **Taille à 4 Mio près, pour tous les partages** (revue K1, I3) : pendant l'envoi, le serveur en marche apprend la taille du contenu à environ 4 Mio près, **quel que soit le mode d'envoi** : `fill_from` (§29.3) désigne le premier segment de bourrage, et l'envoi anticipé (§29.7) révèle en plus l'ordre et l'heure des segments et le fait qu'une composition est en cours. Cela reste vrai tant que la Task M2 (Q-MIN1 : le navigateur envoie lui-même le bourrage en mode « au clic ») n'est pas livrée. Après la finalisation, la base ne garde plus cette frontière (`segments_mask` remis à « tous reçus ») : au repos, seul le palier reste visible.
13. **Victime ciblée** (§28.8) : un serveur compromis peut servir un code piégé à une seule personne ; la vérification publique ne la protège que si elle vérifie elle-même, avec un outil qui ne vient pas du site.
14. **Coffre** (§27.1) : captures d'écran, téléphone compromis, et confiance de l'expéditeur envers le destinataire restent hors de portée ; « Voir seulement » (§34) n'est qu'une dissuasion.
15. **Métadonnées** (§35.2) : on retire ce que les conteneurs déclarent (EXIF, XMP, propriétés du document, étiquettes, pistes de position) ; ce qui est **dans le contenu lui-même** reste : texte ou visage visibles, date incrustée dans l'image, données d'un flux vidéo (SEI), anciennes révisions d'un PDF, modifications suivies d'un document et leurs auteurs, contenu des archives.
16. **Ordre de lecture** (§36) : le serveur voit quels segments un destinataire télécharge et quand ; la lecture monotone réduit ce qu'il en déduit (quels éléments ont été ouverts), sans le supprimer (le point d'arrêt reste visible).
17. **En-têtes et empreinte TLS** (§36) : le proxy reçoit forcément l'adresse, l'empreinte TLS et les en-têtes du navigateur ; ils ne sont ni journalisés ni transmis au serveur, mais un serveur compromis les voit en direct.
18. **Compte facultatif** (§37) : au repos, rien ne relie un compte à ses partages ; **en direct**, un serveur compromis peut les relier par l'adresse IP et l'heure (écriture du coffre de compte, relectures de l'historique), malgré l'écriture différée. Un appareil neuf ne peut pas détecter qu'on lui ressert un ancien coffre de compte. Le texte « nous ne pouvons pas le lire » vaut tant que le code servi n'est pas piégé (point 2).
19. **Offre payante** (§38) : le vendeur officiel connaît l'identité du payeur et l'empreinte de son pass ; au repos, on voit qu'un partage est Plus, pas qui l'a payé ; l'adresse IP à l'émission et à l'usage des jetons reste visible en direct.
20. **Salon : qui parle avec qui** (§39) : en direct, le serveur voit les adresses des membres d'un même salon et l'heure de leurs envois ; jamais sur disque.
21. **Salon : membres** (§39.2.4) : chacun peut copier ce qu'il voit ; un pseudonyme ne prouve rien ; un attaquant actif qui a volé la clé d'identité d'un membre présent peut lire tant que ce membre reste.
22. **Salon : coupures** (§39.3.2) : la file du serveur est courte (200 trames, 15 min) ; un téléphone mis en veille peut manquer des messages, et l'écran le dit.
23. **Envoi direct** (§40.1) : l'expéditeur doit rester en ligne ; en connexion directe, les pairs voient leurs adresses IP ; par le relais, notre machine voit les deux adresses et le volume, sans rien stocker.

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
| Compte facultatif : Q-A1 à Q-A5 (§37.10) | Avant les Tasks A1 à A3 |
| Offre payante : Q-P1 à Q-P7 (§38.7), statut juridique, juriste et comptable | Après la mise en ligne de la V1, avant les Tasks P1 à P3 |
| Compte : Q-A6, Q-A7 (§37.11.5) | Avant les Tasks A1 à A3 |
| Formules Plus et Pro : Q-P8 à Q-P10 (§38.8.4) | Avec Q-P1 |
| Envoi direct : Q-D1 à Q-D3 (§40.9) | Avant les Tasks D-1 et D-2 |
| Salon : Q-SAL1 à Q-SAL10 (§39.12), avis du juriste (§39.7) | Avant les Tasks C-1 à C-6 (juriste : avant tout usage public) |

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

- Toutes les dépendances (npm, modules Go, actions GitHub, chaîne Go) sont tenues à leur **dernière version stable publiée depuis au moins 7 jours, sauf correctif de sécurité** (décision du propriétaire, 5 novembre : une version piégée est le plus souvent retirée dans les premiers jours ; un correctif de sécurité, lui, s'applique sans attendre, après lecture de l'avis). Dependabot applique le délai (`cooldown: default-days: 7`, avis de sécurité exclus du délai) ; une mise à jour à la main vérifie la date de publication (`npm view <paquet> time`, `go list -m -json <module>@<version>`). Installation uniquement depuis les sources officielles (registre npm, `proxy.golang.org`, actions publiées par leurs éditeurs officiels) ; versions verrouillées (`package-lock.json`, `go.sum`).
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
  - **Code du coffre** sinon : `U` = Argon2id(code NFC, `sel_code`, 64 Mio, 3 passes, 1 fil, 32 octets), mêmes paramètres minimaux que §7.1. Le code suit `checkPassword` (10 caractères au moins et règles de §31, mise à jour du 7 novembre) : un code à 4 ou 6 chiffres est refusé, car il tombe en quelques heures si quelqu'un copie le stockage du navigateur (le compteur d'essais ne protège que dans l'application).
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
| `id` | HKDF(`K_lien`, « shhdrop/v2/id »), 16 octets | navigateur seulement : données authentifiées de `E` (→ Task K2, §29.8 : jamais envoyé ; le serveur tire son propre identifiant interne) |
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
| `E` (enveloppe) | `nonce` (12 octets aléatoires) ‖ AES-256-GCM(`K_env`, `nonce`, `R`, données authentifiées = « shhdrop/v2/enveloppe-ad » ‖ `id` ‖ en-tête de 48 octets), 60 octets ; préfixe des données authentifiées distinct de l'info HKDF de `K_env` (revue K1, m2 : une étiquette, un usage) | serveur ; rendue seulement après un déverrouillage réussi |

À l'ouverture : `unlock` réussi → `E` → `K_env` (lien + mot de passe) → `R` → contrôle de `C_engagement` (`crypto.subtle.verify` HMAC) → `K_contenu` → lecture.

### 29.3 Paquet v2

- En-tête « SHH2 », version 2, `C_engagement` (48 octets). Clair du paquet de `B` morceaux : **données** (éléments dans l'ordre d'ajout, à partir de l'octet 0) ‖ zéros ‖ **manifeste** ‖ longueur du manifeste (4 octets) en toute fin. Le manifeste (JSON v2, §34) donne la position de chaque élément ; l'ordre d'affichage y est indépendant de l'ordre d'ajout, donc renommer ou réordonner ne touche pas les données déjà parties.
- Morceaux, nonces, données authentifiées, segments de transport : inchangés (§7.3, principe STREAM). **Chaque numéro de morceau n'est chiffré qu'une fois par `R`** ; un segment réessayé renvoie les mêmes octets.
- **Palier canonique v2** : le plus petit palier de capacité ≥ fin des données + 4 + `MANIFEST_MAX` (64 Kio). La longueur réelle des noms n'influence donc pas le palier ; `CONTENT_MAX` est inchangé.
- **Réserve du manifeste et paliers (Task K1, demande du coordinateur)** : `MANIFEST_MAX` = 65 532 octets, pour que le manifeste et sa longueur tiennent dans **un morceau** de 64 Kio, le dernier du paquet. Palier canonique = plus petit palier dont la capacité ≥ fin des données + 64 Kio. Conséquences : un partage de texte seul (aucune donnée de fichier) prend le **palier 1** (64 Kio) ; le plus grand palier passe de 16 384 à **16 385 morceaux** (257 segments, le dernier d'un seul morceau), pour contenir **exactement 1 Gio** de données (`CONTENT_MAX` = 1 073 741 824 octets) plus le morceau du manifeste ; fichier chiffré du plus grand palier : 48 + 16 385 × 65 552 = 1 074 069 568 octets. Les quotas d'octets (§4, §24) comptent les données utiles d'un palier, (palier − 1) × 64 Kio : 0 pour le palier 1, 1 Gio pour le plus grand (3 partages de 1 Gio par jour, inchangé). Le manifeste tient dans le dernier morceau, donc le bourrage, s'il existe, se termine juste avant le dernier segment.
- **Bourrage rempli par le serveur** : les segments entièrement compris entre le dernier segment de données et le segment de fin ne sont pas envoyés ; `finalize` les désigne (`fill_from`, `fill_to`) et le serveur les remplit d'octets aléatoires (`crypto/rand`), indiscernables d'un chiffré pour qui lit le disque. Le lecteur ne lit jamais le bourrage (§7.3). Gain : jusqu'à la moitié de l'envoi en moins.

### 29.4 Envoi anticipé

1. **Démarrage** : composition non vide et stable depuis 2 s, page visible, en ligne, `navigator.connection.saveData` faux, preuve anti-robot disponible (pré-calculée, UI §9.4.2). `POST /api/shares` : palier, preuve anti-robot ; `K_accès` et `S_gestion` en en-tête (→ §29.8). Ni durée, ni ouvertures, ni sel, ni `V_preuve` à ce stade.
2. **Pendant la composition** : chaque segment dont les 64 morceaux sont des données complètes est chiffré puis envoyé. Ajouter un élément qui tient dans le palier : il est ajouté à la suite. Renommer, réordonner, modifier un texte (les textes sont dans le manifeste) : rien à refaire.
3. **Redémarrage** (nouveaux `K_lien`, `R`, `sel`, nouveau partage ; l'ancien est détruit par `S_gestion` en `keepalive`) quand : un élément dont un morceau a déjà été chiffré est retiré ou remplacé (sinon le destinataire pourrait déchiffrer un élément retiré, puisqu'il recevra `R`), ou la composition dépasse le palier réservé. Au plus 3 redémarrages par 10 min ; au-delà, l'envoi attend le clic.
4. **Au clic sur « Envoyer »** : `K_mdp` (déjà calculé pour le mot de passe généré ; sinon, Argon2id au plus tard une seconde après la dernière frappe), `K_maître`, `K_env`, `K_preuve`, `E` ; chiffrement et envoi du dernier segment de données et du segment de fin (manifeste) ; `POST finalize` : `sel`, `kdf_ops`, `kdf_mem`, `V_preuve`, `E`, durée, ouvertures, `fill_from`, `fill_to`. Le serveur vérifie que tous les autres segments sont présents, passe en `ready`, fixe `expires_at` (inchangé : à partir de la fin de l'envoi), puis remplit le bourrage.
5. **Abandon** (page quittée, liste vidée, onglet tué) : `R` n'est jamais enveloppée et disparaît avec la page : le chiffré déjà envoyé n'est plus déchiffrable par personne (effacement cryptographique). Le partage est détruit en `keepalive` quand c'est possible, sinon effacé par les règles existantes (aucun segment en 5 à 20 min, 15 min sans segment, échéance de 3 h, §7.4).
6. Le serveur apprend qu'une composition est en cours et voit arriver les segments.

### 29.5 Quotas et anti-abus

- Les quotas de la §4 (10 liens par jour et par connexion, 30 par /48, 3 Gio utiles par jour, 6 Gio par /48) sont **débités à `finalize`** ; la création est refusée s'ils sont déjà atteints.
- Nouveaux plafonds pour les envois anticipés : au plus 2 envois non finalisés à la fois par connexion (6 par /48) ; **octets abandonnés** (envois effacés sans `finalize`) : 6 Gio par jour et par connexion, 12 Gio par /48, débités à l'effacement ; au-delà, l'envoi anticipé est refusé (429) et l'écran revient à l'envoi au clic. La place reste réservée à la création (plafond global, §4).
- **Mise en œuvre (Task K1)** : les quotas journaliers comptent, à la création, les partages finalisés **et** les envois en cours de la connexion (réservation) ; un envoi effacé sans `finalize` libère sa réservation et ses octets passent dans le compteur des octets abandonnés. Le compteur se remet à zéro à minuit UTC avec le secret du jour, envois en cours compris.
- **Note de menace (acceptée)** : pour appliquer « 2 envois non finalisés à la fois » et les octets abandonnés, le serveur garde **en mémoire seulement** la correspondance « id d'un envoi en cours → clés HMAC de la connexion » (jamais sur disque), retirée à `finalize` ou à l'effacement. Quelqu'un qui lit la mémoire du serveur en marche peut relier un envoi en cours à une adresse IPv4 (le secret du jour est aussi en mémoire et l'espace IPv4 se parcourt) ; il voit de toute façon les adresses en direct (§18.3).
- La difficulté de la preuve de travail compte toutes les créations de l'heure (finalisées ou non) : les redémarrages sont bornés (point 3).

### 29.6 Pré-lecture chez le destinataire

- (→ §36 S10 : la pré-lecture démarre à la réponse de `meta`, à calendrier fixe, jamais au rythme des frappes.) Pendant la saisie du mot de passe, le navigateur télécharge les segments chiffrés avec `K_accès` seul : `GET /segments/{n}` avec l'en-tête `K_accès`, accepté **seulement en état `ready`**, avant l'expiration, sans consommer d'ouverture. Ordre : segment de fin (manifeste), puis les premiers segments de données, jusqu'à 64 Mio.
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
| `POST /api/shares` | Corps : `bucket`, preuve anti-robot (ni `id`, ni vérificateur : champ inconnu → 400). En-têtes `X-Shh-Access` (`K_accès`) et `X-Shh-Manage` (`S_gestion`), 43 caractères chacun ; le serveur calcule `access_v` et `manage_v` (SHA-256) et tire l'`id` interne (128 bits, `crypto/rand`). `access_v` ou `manage_v` déjà présent → 400 `bad_request` (même corps qu'une création invalide), **compté au quota** de créations et dans la difficulté anti-robot : seul qui connaît `K_accès` ou `S_gestion` peut le provoquer |
| `PUT /api/shares/segments/{n}`, `POST /api/shares/finalize` | Jeton d'envoi, qui désigne le partage. Corps de `finalize` : `salt`, `kdf_ops`, `kdf_mem`, `proof_v`, `envelope`, `ttl_hours`, `max_opens`, `fill_from`, `fill_to` (longueurs exactes, JSON strict) |
| `GET /api/shares/meta`, `POST /api/shares/unlock`, `POST /api/shares/destroy` | `K_accès` en en-tête : partage trouvé par `access_v` (index unique). Réponse d'`unlock` : jeton de téléchargement **et** `envelope` |
| `GET /api/shares/segments/{n}`, `POST /api/shares/done` | Jeton de téléchargement, qui désigne le partage (pré-lecture par `K_accès`, §29.6 : non livrée, même règle le jour venu) |
| `GET /api/manage/status`, `POST /api/manage/destroy` | `S_gestion` en en-tête, corps vide, recherche par `manage_v` (index unique) ; remplacent `GET /{id}/status` et la destruction par `S_gestion` (§32). Anciennes routes avec `{id}` → 404 |

Table `shares` : `proof_v`, `salt`, `kdf_*`, `ttl_hours`, `max_opens` deviennent `NULL` jusqu'à `finalize` ; colonne `envelope` (60 octets) ; index uniques sur `access_v` et `manage_v` ; `id` = identifiant interne tiré par le serveur (clé primaire, nom du fichier, sujet des jetons), sans lien avec l'`id` du client. À `finalize`, `segments_mask` passe à « tous reçus » (la frontière du bourrage n'est pas gardée, revue K1, I3) ; un seul `finalize` à la fois par `id` (verrou en mémoire), un appel concurrent répond aussitôt 503 `busy` sans rien écrire (revue K1, I1).

**Oracle d'existence fermé (revue K1, I2, option a ; Task K2)** :
- L'`id` du client (HKDF de `K_lien`) ne sert plus qu'aux données authentifiées de `E` ; il n'est **jamais envoyé** (vérifié par « le serveur ne voit rien », qui le fouille comme un secret). Il ne permet donc plus de désigner un partage : aucune adresse de l'API n'en porte, ni d'ailleurs aucun identifiant.
- Toute requête qui désigne un partage prouve un secret : un jeton signé par le serveur (envoi, lecture), `K_accès` (`meta`, `unlock`, `destroy` du destinataire, et **création**) ou `S_gestion` (gestion, et **création**). Le serveur cherche par SHA-256 de ce secret (index uniques), jamais par une valeur fournie telle quelle.
- La création ne peut donc heurter un partage existant que si son auteur connaît `K_accès` ou `S_gestion` du partage (même lien envoyé deux fois) : il le connaît déjà. Qui ne connaît qu'un `id`, ou un vérificateur lu dans une base volée, obtient exactement les mêmes réponses que le partage existe ou non (test `TestCreateCannotProbeExistence`).
- Inchangés : limites de débit et quotas (le doublon reste compté), 5 essais puis destruction (même compteur pour `unlock` et `destroy`), budget de lecture par ouverture (lié à l'`id` interne et au n° d'ouverture du jeton), un seul `finalize` à la fois par partage.
- Recherche par empreinte et temps constant : l'index compare `SHA-256(secret)` aux valeurs stockées ; la durée de la recherche ne dépend que de cette empreinte, que l'attaquant calcule lui-même, et ne révèle rien de `K_accès` d'autrui (préimage). `K_preuve` reste comparée en temps constant (`subtle.ConstantTimeCompare`).
- Coût honnête : `K_accès` et `S_gestion` transitent par le serveur dès la création (au lieu de leurs empreintes). Ce sont des secrets d'accès au serveur, qu'il voit de toute façon à chaque `meta` ou `manage/status` ; ils ne donnent ni le contenu ni `E`, et ne sont jamais écrits (mêmes tests).
- Administration : `shhdrop admin destroy -` lit le lien signalé, en tire `K_accès` (HKDF-SHA-256, sel vide, « shhdrop/v2/acces ») et cherche par `V_accès` (§15.3).

Le test « le serveur ne voit rien » ajoute un repère de mot de passe saisi **après** le début de l'envoi anticipé, et vérifie qu'aucune requête ne porte `R`, `K_contenu`, `K_mdp` ni `K_lien`.

---

## 30. Revue post-quantique (v2.6)

- **Contenu** : aucune cryptographie à clé publique ne le protège. AES-256 garde environ 128 bits de sécurité face à l'algorithme de Grover ; HKDF-SHA-256, HMAC-SHA-256 et Argon2id restent adaptés. `K_lien` et `S_gestion` font 256 bits pour cette raison : ne pas les raccourcir (§32).
- **Transport** : TLS protège `K_accès`, `K_preuve`, `E` et le chiffré, jamais `K_lien` ni le mot de passe. Un enregistrement « stocker maintenant, déchiffrer plus tard » ne donnerait donc pas le contenu, mais des métadonnées et des secrets d'accès. Défense en profondeur : **échange de clés hybride X25519MLKEM768 obligatoire** sur Caddy (proposé par défaut par Go 1.24 et plus, et par Caddy 2.10 et plus ; écrit explicitement dans le Caddyfile, `curves x25519mlkem768 x25519`). Repli X25519 seul toléré pour les navigateurs qui n'ont pas encore l'hybride (question Q-PQ1). **Test du Plan 3** : un client Go limité à `CurvePreferences: [X25519MLKEM768]` se connecte et `ConnectionState().CurveID` vaut `X25519MLKEM768` ; il bloque la mise en ligne.
- **Passkeys du coffre** (§27) : la sortie PRF est un HMAC calculé dans l'authentificateur, donc symétrique ; les signatures ECDSA de la passkey ne protègent rien ici.
- **Signatures de version** (§28.2) : ECDSA, donc à migrer vers une signature post-quantique quand Sigstore la proposera.
- Q-PQ1 : refuser les connexions sans hybride ? Défaut recommandé : non en V1 (Safari et Firefox anciens exclus sinon), à revoir avant l'ouverture au public.

---

## 31. Décision du propriétaire (v2.6) — mot de passe par défaut de 8 caractères, porté à 10

- **Mise à jour (5 novembre, décision du propriétaire, Q-MDP1 réglée)** : le mot de passe généré fait **10 caractères** (même alphabet, mêmes quatre familles) : 594 641 958 752 747 520 possibilités, soit **2^59,0** (environ 4,7 millions d'années-GPU en moyenne avec l'hypothèse ci-dessous). Un mot de passe saisi doit faire **10 caractères au moins** (au lieu de 12) et rester absent de la liste noire : le même seuil pour tous. `isGeneratedPassword` reste un raccourci, plus une exception de longueur. Les passages ci-dessous qui disent 8 et 12 caractères sont remplacés par cette ligne ; le code du coffre (§27.2) suit la même règle de 10 caractères.
- **Mise à jour (7 novembre, audit M1 ; à valider par le propriétaire, car la règle validée change)** : « absent de la liste noire » devient la règle complète de `web/src/crypto/weakpw.ts`, appliquée à tout mot de passe saisi de 10 caractères au moins (et au code du coffre, §27.2) : refus (1) de moins de 5 caractères distincts, ou de plus de la moitié des caractères pris dans des répétitions (`aaa`, `abab`, casse comprise), des suites (`abcd`, `6789`, `2468`, 4 au moins) ou des rangées et colonnes de clavier AZERTY, QWERTY, QWERTZ (`azer`, `1qaz`, 4 au moins) ; (2) d'un mot de passe entier présent dans la liste ; (3) d'un mot de passe dont le « cœur » (séparateurs, chiffres et symboles des bords retirés, accents retirés, `0→o`, `1→i` ou `l`, `@→a`…) est un mot de passe courant (`motdepasse12`, `Soleil2024!`, `p@ssw0rd`). Listes générées par `scripts/gen-lists.mjs`, sources épinglées par SHA-256 : SecLists 10k (MIT), les 20 000 premières lignes de la liste NCSC 100k (redistribuée par SecLists), Richelieu (20 000 mots de passe français, CC BY 4.0). Une raison claire par règle à l'écran. Le mot de passe généré n'est pas concerné (raccourci `isGeneratedPassword`).
- Remplace la phrase de 4 mots de §4 comme défaut. `generatePassword()` tire 8 caractères dans un alphabet de 64 sans caractères ambigus : minuscules sans `l` ni `o` (24), majuscules sans `I` ni `O` (24), chiffres `2` à `9` (8), symboles `! # $ % + = ? @` (8). Tirage uniforme par `crypto.getRandomValues` (64 = 2⁶ : aucun biais), recommencé jusqu'à ce que les quatre familles soient présentes. Bouton **« Générer un autre »**, sans limite ; la personne peut saisir le sien.
- **Nombre exact** : 107 294 591 287 296 mots de passe possibles (4 familles présentes), soit **2^46,6** ; ce n'est pas 50 bits (2⁴⁸ sans la contrainte des familles).
- Le mot de passe généré a un type marqué (`GeneratedPassword`) accepté à 8 caractères ; un mot de passe saisi reste soumis à `checkPassword` (12 caractères, liste noire), un humain choisissant moins bien qu'un tirage.
- **Attaque hors ligne (base et lien volés)** : un essai = un Argon2id de 64 Mio et 3 passes. Hypothèse prudente pour un GPU haut de gamme, bornée par la bande passante mémoire : environ 2 000 essais par seconde. En moyenne (moitié de l'espace) : environ **850 ans-GPU**, soit environ 10 mois avec 1 000 GPU, pour un coût de l'ordre de 4 millions de dollars en location. Avec 10 caractères (2^59) : environ 4,7 millions d'années-GPU. La phrase de 4 mots donnait 2^51,7, environ 34 fois plus que 8 caractères.
- **Signalement (gravité moyenne)** : 8 caractères suffisent contre un attaquant opportuniste ; ils sont faibles contre un adversaire doté de moyens étatiques qui obtiendrait à la fois la base (serveur compromis) et le lien. La durée de vie du partage n'aide pas : le chiffré volé s'attaque à loisir. Recommandation : **10 caractères** par défaut (même alphabet, même saisie). Le propriétaire a demandé 8 : on applique 8, et la question est posée (Q-MDP1).
- Saisie au téléphone : les symboles demandent de changer de clavier ; c'est le prix des 64 symboles.

---

## 32. Décision du propriétaire (v2.6) — lien court

- **Lien de partage** : `https://shhdrop.app/#<K_lien en base64url, 43 caractères>` (64 caractères en tout, contre 90 environ). L'identifiant n'est plus dans le lien : `id` = HKDF(`K_lien`, « shhdrop/v2/id »), à sens unique. Le serveur ne voit même plus de chemin révélateur : la page demandée est `/`.
- **Lien de gestion** : `https://shhdrop.app/#m<S_gestion, 43 caractères>` ; le serveur trouve le partage par `V_gestion` (index unique), donc le lien de gestion n'a pas besoin de l'identifiant (§29.8). Le lien de partage, lui, est trouvé par `V_accès` (index unique, Task K2) : l'`id` n'est plus envoyé du tout.
- **Unicité** : `id` fait 128 bits tirés d'une clé aléatoire de 256 bits ; la probabilité d'une collision parmi n partages vaut environ n² / 2¹²⁹ (négligeable même pour 10¹² partages). → Task K2 : le serveur n'indexe plus par cet `id` mais par `V_accès` et `V_gestion` (256 bits, index uniques) ; un doublon est refusé et le client recommence avec une nouvelle clé. Un lien n'est **jamais réutilisé** pour un nouveau partage : qui garde l'ancien lien y aurait accès. Chaque partage tire une `K_lien` neuve ; un créateur malveillant qui viserait un `id` passé sans connaître sa `K_lien` ne ferait correspondre aucun `V_accès`.
- **Pourquoi pas plus court** : 256 bits restent nécessaires (§30). Un chemin court (`/s#…`) n'apporterait que 2 caractères ; la racine est retenue.
- **Effets** : le routeur reconnaît `/` avec un fragment de 43 caractères base64url (partage) ou `m` + 43 (gestion) ; tout autre fragment est retiré (hygiène inchangée, UI §12.1) ; `X-Robots-Tag: noindex` et le repli `/s/`, `/m/` du serveur deviennent inutiles (le préfixe `/s/` peut rester réservé aux futurs liens universels, §16). Aucun lien ancien n'existe en production : pas de compatibilité. La démo suit le même format sous `/Shhdrop/` (`https://skoow.github.io/Shhdrop/#…`). Le lien ne contient jamais le mot de passe. Le navigateur intégré (UI S4) garde le `#` jusqu'à ce que la personne quitte la page (« Continuer ici », écran des tâches suivantes).

---

## 33. Décision du propriétaire (v2.6) — pas de compte ; historique local de l'expéditeur

- Personne n'a besoin d'un compte pour envoyer ou recevoir. Le serveur ne sait jamais qui a ouvert un lien (aucune adresse IP enregistrée, §9).
- **Historique des envois**, sur l'appareil de l'expéditeur seulement (`/envois`, téléphone et ordinateur) : pour chaque partage, état (actif, en cours d'effacement, détruit, expiré), ouvertures « 1 / 3 », **Détruire** en un geste (avec confirmation sur place). Contenu d'une entrée : `S_gestion`, échéance, maximum d'ouvertures, un libellé local (« 6 éléments · 142 Mo · 5 nov., 21 h »), et les ouvertures observées. **Jamais** `K_lien`, le mot de passe ni les noms des éléments : l'historique ne permet ni de lire le contenu, ni de le renvoyer.
- **Heures des ouvertures** : le serveur ne stocke aucune heure d'ouverture (§9.1). L'historique note l'intervalle pendant lequel le compteur a changé, entre deux relectures de `manage/status` (« ouvert entre 21 h 00 et 21 h 15 ») ; relecture toutes les 60 s seulement quand l'écran est visible ; sans relecture, pas d'heure.
- Exception écrite à UI §12.1 : `S_gestion` est stocké, chiffré (AES-256-GCM, clé non extractible créée par WebCrypto, gardée dans IndexedDB), dans le seul module `web/src/history/`. Honnêtement, cette clé est stockée sur le même appareil : le chiffrement ne protège que des lectures naïves du stockage ; la vraie protection est le verrouillage du téléphone. Verrou optionnel par passkey (même mécanisme que §27) : question Q-H1. Une entrée expirée ou détruite est retirée 7 jours après. « Effacer l'historique » à tout moment. Bascule « Garder dans mon historique » sur « Lien prêt », activée par défaut.
- « Ces informations ne seront plus jamais affichées » (§5.1) reste vrai pour le lien et le mot de passe ; seul le lien de gestion est gardé.
- → §37 (v2.7) remplace ce point : compte facultatif spécifié, avec l'analyse de liaison de §37.4. Texte d'origine : **Plus tard, hors V1** : compte optionnel par passkey pour synchroniser l'historique entre appareils. Coût pour la vie privée : le serveur relierait entre eux les partages d'une même personne (même chiffrés, les envois deviennent associables à un compte), ce qui crée une identité côté serveur et relance la question de conservation des données (LCEN, §17).

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

### 34.1 Décision du propriétaire (5 novembre) — un seul interrupteur

Remplace le choix à trois positions ci-dessus **dans l'interface** ; le format du manifeste (déjà livré en Task K1) ne change pas.

- Un interrupteur **« Autoriser le téléchargement »**, **activé par défaut** → `rights: "enregistrer"`. Désactivé → `"voir"` : le destinataire ne peut que regarder sur le site (même effets et même mention que la ligne `"voir"` du tableau).
- **Sous-option** affichée seulement quand l'interrupteur est activé : « Autoriser aussi une copie chiffrée dans l'app, sur téléphone » → `"coffre"` avec `keep_ttl_h` = durée du partage. Désactivée par défaut (§27 inchangé). Elle concerne l'appareil du **destinataire** : elle est proposée à tout expéditeur, téléphone ou ordinateur. **Ambiguïté signalée** : si « réservée au téléphone » visait l'appareil de l'expéditeur, il suffit de la masquer quand `pointer: coarse` est faux ; défaut retenu : proposée partout.
- Interrupteur bloqué en position activée, avec la liste des éléments en cause, quand un élément ne s'affiche pas dans le navigateur (règle de « Voir seulement » ci-dessus) ; le désactiver retire aussi la sous-option.
- Q-R1 réglée : téléchargement autorisé par défaut. Effet sur le plan : Task 13 et Task R (un `Switch` et une case dépendante au lieu de `RightsPicker` à trois choix). La spécification UI (§10, `RightsPicker`) est à aligner par celui qui la tient.

### Questions ouvertes de §29 à §34 (défaut recommandé)

| # | Question | Défaut recommandé |
|---|---|---|
| Q-K1 | Accepter la fuite de la taille à 4 Mio près vers un serveur qui observe l'envoi anticipé (§29.7) | Oui (décision de vitesse) ; bascule « Envoyer seulement quand je clique » pour qui la refuse, désactivée par défaut. **Erreur signalée (§36 S4)** : `fill_from` révèle la même taille même au clic ; la bascule ne tient sa promesse qu'avec Q-MIN1 |
| Q-K2 | Envoi anticipé sur données mobiles | Non si `saveData` ; oui sinon |
| Q-MDP1 | 8 ou 10 caractères par défaut | 10 recommandé ; 8 appliqué (demande du propriétaire) |
| Q-H1 | Verrou par passkey de l'historique | Non par défaut (destruction en un geste), proposé dans les réglages |
| Q-H2 | Historique activé par défaut | Oui, bascule sur « Lien prêt » |
| Q-R1 | Droit par défaut | Réglée (§34.1) : « Autoriser le téléchargement » activé |

---

## 35. Décision du propriétaire (v2.6, 5 novembre) — aucune statistique, fichiers nettoyés, enregistrement dans l'interface

Demande : « Aucune donnée de statistique ni d'analytics. Des fichiers propres, documents et vidéos compris. L'enregistrement vocal doit être possible depuis notre interface. Réduire au maximum ce que le serveur peut voir » (ce dernier point : §36).

### 35.1 Aucune statistique

- Règle : §3 « Jamais » et §9.5 (liste fermée des compteurs d'exploitation, chacun justifié). Aucune exception pour « juste compter les visites » : un compteur anonyme agrégé reste une statistique, et il n'est demandé par aucune règle de la spécification.
- **Navigateur** : aucun SDK, aucun `sendBeacon`, aucun écouteur `error` / `unhandledrejection` qui envoie quoi que ce soit (les erreurs restent dans la page ; la règle « aucun appel réseau hors de `web/src/index.ts` » le garantit déjà). `PerformanceObserver` n'est permis que dans les tests.
- **Serveur** : aucun point d'accès de métriques ; `/healthz` (boucle locale seulement) rend `ok` et un seul booléen `reports_alert` (§9.5, §36) ; aucune autre sortie.
- **Exploitation** (Plan 3) : Caddy sans `metrics` et API d'administration coupée (`admin off`) ; aucun agent de surveillance de l'hébergeur installé ; l'alerte disque lit `df`, pas l'application.
- **Test « aucune statistique »** (bloquant, §14) :
  - recherche, insensible à la casse, dans `web/src`, `web/scripts`, `web/*.html`, `package-lock.json` (noms de paquets), `dist/`, `dist-verif/`, `dist-demo/` : `google-analytics`, `googletagmanager`, `gtag(`, `analytics.js`, `plausible`, `matomo`, `piwik`, `posthog`, `mixpanel`, `segment.io`, `cdn.segment.com`, `amplitude`, `hotjar`, `clarity.ms`, `@sentry/`, `sentry.io`, `bugsnag`, `rollbar`, `datadog`, `newrelic`, `nr-data.net`, `logrocket`, `fullstory`, `umami`, `usefathom`, `cloudflareinsights`, `web-vitals`, `heapanalytics`, `mc.yandex`, `fbq(`, `doubleclick`, `honeybadger`, `trackjs`, `raygun`, `@opentelemetry`, `elastic-apm`, `sendBeacon` ; un fichier piégé prouve que la recherche détecte ;
  - côté Go : aucun import de `expvar`, `net/http/pprof`, `github.com/prometheus/`, `go.opentelemetry.io/`, `github.com/getsentry/`, `gopkg.in/DataDog/`, `github.com/newrelic/`, `github.com/DataDog/`, `statsd` dans `server/` ni dans `go.sum` ;
  - côté serveur, « rien n'agrège par personne » : (1) toute déclaration `map[` dans `server/internal` hors d'une liste blanche (`limits/`, `captcha/`, et les budgets et envois en cours de `api/`, un par ligne de §9.5) fait échouer le test, qui oblige à justifier tout nouveau compteur ; (2) chaque compteur de §9.5 est vide après sa rotation (horloge injectée : minute, heure, 3 h, minuit UTC) ; (3) `sqlite_master` ne contient que `shares` et ses index (→ §39.3.5 : plus `salons` et `salon_pieces`) ; (4) aucun client HTTP sortant dans `server/` hors de `captcha/recaptcha.go`.

### 35.2 Nettoyage des métadonnées de tous les fichiers

Remplace la liste de §12 « Retrait des métadonnées ». Corrige l'audit de confidentialité P4 (promesse publiée sans code).

**Principes**

- **Dans le navigateur, avant tout chiffrement.** Un élément en cours de nettoyage n'est pas transmis à l'envoi anticipé (`draft.sync`, §29.4) : aucun morceau de l'original n'est chiffré. Le résultat remplace l'original dans le composeur.
- **Sans réencodage**, en TypeScript, **sans nouvelle dépendance** (comparaison plus bas). Ce n'est pas de la cryptographie : la règle « aucune crypto maison » ne s'y applique pas. Les CRC-32 (ZIP, PNG, Ogg) sont des sommes de contrôle de format, pas des protections.
- **Trois techniques seulement** :
  1. **reconstruction** des petits formats lus en entier (images de `STRIP_MAX` = 50 Mio au plus, constante déjà dans `web/src/limits.ts` : JPEG, PNG, WebP, GIF ; au-delà, `echec`) ;
  2. **neutralisation en place, à longueur constante**, pour les gros conteneurs (MP4/MOV/M4A, HEIF/AVIF, Matroska/WebM, PDF) : boîte renommée `free` et remplie de zéros, élément EBML remplacé par `Void`, objet PDF remplacé par `null` suivi d'espaces. Aucun octet ne bouge, donc aucune table de positions (`stco`, `iloc`, `xref`, `Cues`) n'est à recalculer ;
  3. **réassemblage** : MP3 (étiquettes coupées), ZIP (Office, ODF : entrées inchangées recopiées telles quelles, parties remplacées écrites sans compression), Ogg (pages d'en-tête refaites), FLAC, WAV.
- **Aucun fichier entier en mémoire** au-delà de `STRIP_MAX` (§24) ; les gros conteneurs n'ont pas de plafond : la sortie est un `Blob` fait de tranches de l'original (`File.slice`) et de petits correctifs ; l'analyse lit par tranches de 4 Mio et rend la main entre deux tranches (pas de Worker de plus, donc rien hors SRI, §28.3).
- **Analyse à bornes vérifiées** : toute longueur qui sort de son parent ou du fichier, toute boîte inconnue là où une liste blanche s'applique, toute structure chiffrée ou signée → résultat `echec` ou `protege`, jamais d'exception ni de fichier à moitié modifié.
- **Les métadonnées des fichiers enregistrés dans l'interface** (vocal, vidéo si Q-REC1) passent par le même nettoyage : `MediaRecorder` écrit le nom du logiciel et, sur Safari, des dates réelles dans `mvhd`.

**Par format**

| Format | Retiré | Gardé | Échec ou refus |
|---|---|---|---|
| **JPEG** | APP1 EXIF réécrit avec la **seule orientation** (0x0112, boutisme d'origine, sans IFD1 donc sans vignette) ; APP1 XMP et XMP étendu ; APP0 JFXX (vignette) ; APP2 MPF et FPXR ; APP3 à APP13 (IPTC, Photoshop) ; APP15 ; COM ; **tout ce qui suit le premier EOI** : images secondaires MPF, carte de gain HDR, carte de profondeur, vidéo des « photos animées » (Google, Samsung), bloc Samsung SEFT | SOI, APP0 JFIF, APP2 ICC (tous les morceaux, dans l'ordre), APP14 Adobe, DQT, DHT, DRI, SOFn, SOS et données compressées (octet pour octet), EOI | marqueur invalide, longueur hors fichier, aucun SOS ou EOI → `echec`. Perte assumée, à dire : rendu HDR, flou de portrait modifiable, animation |
| **PNG** | `tEXt`, `zTXt`, `iTXt` (XMP compris), `tIME`, `eXIf` (réécrit avec la seule orientation si elle ≠ 1), tout bloc auxiliaire inconnu (`iDOT`, `caNv`…) | IHDR, PLTE, IDAT, IEND, `tRNS`, `cHRM`, `gAMA`, `iCCP`, `sRGB`, `sBIT`, `cICP`, `mDCV`, `cLLI`, `pHYs`, `bKGD`, `hIST`, `sPLT`, APNG (`acTL`, `fcTL`, `fdAT`) | CRC faux, bloc critique inconnu → `echec` |
| **WebP** | `EXIF` (réécrit avec la seule orientation si elle ≠ 1), `XMP `, blocs inconnus ; drapeaux de `VP8X` et taille RIFF corrigés | `VP8`, `VP8L`, `VP8X`, `ALPH`, `ICCP`, `ANIM`, `ANMF` | taille RIFF incohérente → `echec` |
| **GIF** | extensions Commentaire (0xFE) et Application autres que `NETSCAPE2.0`, `ANIMEXTS1.0`, `ICCRGBG1` (XMP `XMP DataXMP` compris) ; tout ce qui suit le terminateur 0x3B | en-tête, palettes, images (sous-blocs LZW recopiés sans décodage), Contrôle graphique (0xF9), Texte (0x01), boucle d'animation, profil ICC | bloc inconnu, sous-bloc hors fichier → `echec` |
| **HEIC / HEIF / AVIF** | **nettoyés en place** (choix, Q-MD2) : données de l'élément `Exif` (repérées par `iloc`, méthodes 0 et 1) remplacées par un EXIF vide valide (18 octets) suivi de zéros ; élément XMP (`mime`, `application/rdf+xml`) remplacé par un paquet XMP vide complété d'espaces ; propriété `udes` (titre, description, mots-clés) renommée `free` ; boîtes de premier niveau hors de `ftyp`, `meta`, `mdat`, `idat`, `free`, `skip`, `moov` neutralisées | images, grilles, vignette (image de la photo elle-même), cartes auxiliaires, orientation (`irot`, `imir` : HEIF n'utilise pas l'orientation EXIF), couleurs (`colr`), boîtes `free` existantes mises à zéro | `iloc` méthode 2, extent hors fichier, `Exif` dans plusieurs éléments partagés → `echec`. Pourquoi nettoyer plutôt que refuser : c'est le format par défaut des iPhone et la position y est presque toujours ; refuser pousserait à envoyer tel quel. Note : Safari iOS convertit souvent le HEIC en JPEG dans un `<input>` ; le cas reste fréquent sur ordinateur |
| **PDF** | dictionnaire `/Info` **de chaque révision** (chaîne des `/Prev`, tables xref classiques et flux xref, prédicteurs PNG lus par `DecompressionStream`) : objet remplacé par `null` à longueur constante ; tout flux `/Type /Metadata` (XMP du catalogue, des pages, des objets, y compris ceux des anciennes révisions) → `null` ; miniatures `/Thumb` (objet flux référencé) → `null` | tout le reste, octet pour octet : pages, polices, images, annotations, formulaires, signets, pièces jointes ; le `/ID` du trailer | `/Encrypt` → `protege` ; signature (`/ByteRange` avec `/Sig`) → `protege` (la modifier casserait la signature) ; `/Info` rangé dans un flux d'objets (`ObjStm`) → `echec` (il faudrait recompresser et réécrire la table xref) ; xref illisible → `echec`. Laissés, à dire : contenu des anciennes révisions, auteurs des annotations (`/T`), données privées d'applications (`/PieceInfo`), pièces jointes |
| **Office OOXML** (`.docx`, `.xlsx`, `.pptx` et variantes à macros) | `docProps/core.xml`, `docProps/app.xml` (société, responsable, modèle, durée d'édition, logiciel), `docProps/custom.xml` remplacés par des versions minimales valides **de même nom** (types de contenu et relations inchangés) ; auteurs des commentaires remplacés par « Auteur » et initiales par « A », dates des commentaires retirées : `word/comments.xml`, `word/people.xml` (identifiants de compte compris), `xl/comments*.xml`, `xl/persons/person.xml`, `ppt/commentAuthors.xml`, `ppt/authors.xml` ; images intégrées (`*/media/*`) nettoyées par les règles d'images ci-dessus ; dates des entrées ZIP fixées au 1ᵉʳ janvier 1980, champs « extra » (dates Unix, UID) et commentaire ZIP retirés | toutes les autres parties, données compressées recopiées sans décompression ; **suivi des modifications laissé intact** (`w:ins`, `w:del`… avec `w:author` et `w:date`), comme demandé, mais **détecté et signalé** | ZIP64, entrée chiffrée, plusieurs disques, nom en double → `echec` ; fichier OLE (`D0 CF 11 E0`, document protégé par mot de passe) ou `_xmlsignatures/` → `protege` ; image intégrée en échec → document en `echec`. Laissés, à dire : `w:rsid*`, `customXml/`, vignette `docProps/thumbnail.*`, chemin du modèle attaché (peut contenir un nom d'utilisateur) |
| **ODF** (`.odt`, `.ods`, `.odp`) | `meta.xml` remplacé par un `office:document-meta` minimal (version d'origine reprise) : auteur initial et dernier, dates, durée et nombre d'éditions, générateur, mots-clés, titre ; auteurs (`dc:creator` → « Auteur ») et dates des annotations dans `content.xml` ; images de `Pictures/` nettoyées ; dates et champs « extra » ZIP comme ci-dessus | `mimetype` en premier et sans compression (exigé par ODF), tout le reste ; modifications suivies (`text:tracked-changes`) laissées et signalées | `manifest:encryption-data` ou `META-INF/documentsignatures.xml` → `protege` ; ZIP invalide → `echec`. Laissés : `settings.xml` (nom d'imprimante), vignette |
| **MP4 / MOV / M4V** (et **M4A**) | neutralisées en place (`free` + zéros) : `udta` et `meta` de `moov` et de chaque `trak` (dont `©xyz`, `©mak`, `©mod`, `©swr`, `©day`, `com.apple.quicktime.location.ISO6709`, `.make`, `.model`, `.software`, `.creationdate`, étiquettes iTunes `ilst`, pochette `covr`) ; boîtes `uuid` (XMP et autres), `prft` (heure murale de capture des MP4 fragmentés) ; toute boîte de premier niveau, de `moov` ou de `trak` hors liste blanche (par exemple `gps ` de caméras embarquées) ; **pistes de métadonnées minutées** (gestionnaire `meta`, codecs `mebx`, `gpmd`, `camm`, `rtmd`) et pistes de **timecode** (`tmcd`, heure du jour de la prise) : `trak` neutralisée **et** ses échantillons mis à zéro dans `mdat` (positions lues dans `stsc`, `stsz`, `stco`/`co64`) ; contenu des `free`/`skip` existantes mis à zéro (anciens `moov` laissés par des éditeurs) ; dates de création et de modification de `mvhd`, `tkhd`, `mdhd` mises à **0** (versions 0 et 1) | flux audio et vidéo octet pour octet, **matrice de `tkhd`** (rotation des vidéos de téléphone), dimensions, `edts`/`elst`, `stsd` complet (`colr`, `pasp`, `clli`, `mdcv`, `sv3d`, `st3d`), `mvex`, `moof`, `sidx` | taille de boîte invalide (0 ailleurs qu'en dernier, 1 avec taille 64 bits incohérente, débordement), `moov` absent, plus de 100 000 correctifs → `echec`. Perte assumée : titre, chapitres de `udta`, pochette |
| **WebM / MKV** | `Tags`, `DateUTC`, `Title`, `SegmentUUID`, `PrevUUID`, `NextUUID` remplacés par `Void` de même taille ; `MuxingApp` et `WritingApp` (obligatoires) réécrits « shhdrop » complété d'octets nuls (chaîne vide si la place manque) | pistes, `Cluster`, `Cues`, chapitres, pièces jointes (polices de sous-titres ; laissées, à dire) | VINT invalide, élément qui déborde de son parent, taille inconnue ailleurs que `Segment` et `Cluster` → `echec` |
| **MP3** (et AAC ADTS) | toutes les étiquettes ID3v2 du début (pied de page compris) et ID3v2.4 de fin (`3DI`), ID3v1 (`TAG`, et `TAG+`), APEv2 (`APETAGEX`), Lyrics3 | trames audio octet pour octet, trame Xing/Info/LAME (lecture à débit variable) | aucune synchronisation de trame dans les 64 Kio qui suivent → `echec` |
| **Ogg Opus / Vorbis** | paquet de commentaires (`OpusTags`, `\x03vorbis`) réécrit : chaîne de l'encodeur vide, aucun commentaire (pochette `METADATA_BLOCK_PICTURE` comprise) ; pages d'en-tête refaites, pages suivantes renumérotées, CRC Ogg recalculés | paquet d'identification, paquet de configuration Vorbis, pages audio (seuls leur numéro et leur CRC changent) | flux multiplexés ou chaînés, autre codec (Theora, FLAC dans Ogg) → `echec` |
| **FLAC** (coût faible) | blocs `VORBIS_COMMENT`, `PICTURE`, `APPLICATION`, `PADDING` ; ID3v2 de tête | `STREAMINFO`, `SEEKTABLE`, `CUESHEET`, trames ; drapeau « dernier bloc » reposé | bloc hors fichier → `echec` |
| **WAV** (coût faible) | blocs `LIST`/`INFO`, `bext` (auteur, date, heure, identifiant UMID), `iXML`, `axml`, `id3 `, `_PMX` (XMP), `cart` et tout bloc hors liste ; taille RIFF corrigée | `fmt `, `fact`, `cue `, `data` (recopié par tranches) | RF64, tailles incohérentes → `echec` |
| **Non pris en charge** | rien | tout | état `non_pris_en_charge` : SVG (peut contenir des chemins de fichiers), TIFF, DNG et photos brutes, `.doc`/`.xls`/`.ppt`, RTF, EPUB, iWork, AVI, archives (`.zip`, `.7z`… : leur contenu n'est pas ouvert) |
| **Sans métadonnées connues** | rien | tout | état `sans` : textes du composeur, `.txt`, `.md`, `.csv`, `.json` |

**États et textes à l'écran** (le seul endroit qui dit « Nettoyé » ; la spécification UI est à aligner par celui qui la tient)

| État | Quand | Texte (FR) | Envoi |
|---|---|---|---|
| `nettoye` | nettoyage réussi **et** vérifié (le résultat est relu par le même analyseur : aucun bloc retiré ne reste) | images : « Nettoyé · lieu, appareil et date retirés » ; vidéo : « Nettoyé · lieu, appareil et dates retirés » ; audio : « Nettoyé · titre, artiste, logiciel et dates retirés » ; PDF : « Nettoyé · auteur, logiciel, dates et miniatures retirés » ; bureautique : « Nettoyé · auteur, société et dates retirés, auteurs des commentaires remplacés » ; vocal : « Enregistré ici, sans informations cachées » | normal |
| note ajoutée | modifications suivies détectées (Office, ODF) ; PDF à plusieurs révisions | « Les modifications suivies gardent le nom de leurs auteurs. » ; « Ce PDF garde ses versions précédentes, qui peuvent contenir d'autres informations. » | normal |
| `echec` | analyse impossible | « Pas pu nettoyer ce fichier. Il partira avec ses informations cachées (lieu, appareil, auteur…). » + **Envoyer tel quel** / **Retirer** | bloqué (`blockReason` `non_nettoye`) jusqu'au choix (Q-MD1) |
| `protege` | signé ou chiffré | « Fichier signé ou protégé : il n'est pas modifié, pour ne pas le casser. Il garde ses informations cachées. » + les deux mêmes boutons | bloqué jusqu'au choix |
| `non_pris_en_charge` | format de la dernière ligne du tableau | « Non nettoyé : ce type de fichier part tel quel. » | normal |
| `sans` | textes, texte brut | rien | normal |

- La phrase générale « Position et appareil retirés des photos » (accueil, FAQ, composeur) n'apparaît que si **tous** les éléments d'images sont `nettoye` ; jamais « aucune trace », jamais « 100 % ».
- **Écarts signalés avec le code livré** (composeur, d46f19e) : un échec de nettoyage **n'ajoute pas** le fichier (`compose.failedClean`), et le texte `home.faq.scan.a` dit que vidéos et documents ne sont pas nettoyés. Les Tasks 9a à 9c remplacent le premier par l'état `echec` et mettent le second à jour format par format, seulement quand le code existe.
- Recommandation Q-MD1 : ni envoi silencieux (la personne croirait le fichier propre, comme ses voisins), ni refus sec (elle n'aurait aucun moyen d'envoyer un fichier légitime) : un geste explicite par fichier.

**Outillage : écrit à la main, sans dépendance**

| Option | Licence | Taille (ordre de grandeur, à revérifier au choix) | Ce qu'elle couvre | Verdict |
|---|---|---|---|---|
| Analyseurs écrits à la main | — | environ 2 500 lignes TypeScript, tests compris en plus | tout le tableau | **retenu** : formats documentés, techniques simples (longueur constante), aucune chaîne d'approvisionnement de plus (§24, §28) |
| `exifr` | MIT | plusieurs dizaines de Kio | lecture seule (EXIF, XMP, IPTC) | non : ne réécrit rien ; utile seulement comme contrôle de test, et nos tests ont leurs propres repères |
| `piexifjs` | MIT | dizaines de Kio | JPEG seulement | non : un seul format, plus maintenu depuis des années |
| `pdf-lib` | MIT | centaines de Kio | réécriture complète de PDF | non : taille, maintenance arrêtée, réécriture totale (risque de casser des PDF) |
| `mp4box.js` | BSD-3-Clause | centaines de Kio | analyse ISOBMFF | non : la neutralisation en place demande une centaine de lignes |
| `fflate` | MIT | une dizaine de Kio | ZIP et Deflate | non : `DecompressionStream('deflate-raw')` existe dans tous les navigateurs visés (Chrome 103, Safari 16.4, Firefox 113) et on écrit sans compression ; repli si absent : bureautique en `echec` |
| `ffmpeg.wasm` | LGPL / GPL | dizaines de Mo | tout, par remultiplexage | non : taille, licence, Workers et mémoire partagée (incompatibles avec « pas de COEP », §10) |

`pdfjs-dist`, déjà présent pour la visionneuse, sert seulement **dans les tests** à vérifier qu'un PDF nettoyé s'ouvre, a le même nombre de pages et le même texte.

**Fichiers d'essai**

- Générés localement, jamais une vraie photo du propriétaire : coordonnées GPS **fictives** repères (par exemple 12° 34′ 56″ N, 65° 43′ 21″ O), « ReperMake », « ReperModel », « ReperAuteur », « ReperSociete », « ReperLogiciel », dates 2001-02-03 04:05:06.
- `web/scripts/gen-fixtures.mjs` (sans dépendance, relancé en CI et comparé aux fichiers commités) construit octet par octet : JPEG (avec MPF, seconde image, vidéo de photo animée en fin), PNG, WebP, GIF, PDF (Info, XMP, miniature, mise à jour incrémentale, variante à flux xref, variante signée et chiffrée), DOCX, XLSX, PPTX, ODT minimaux, MP3, Ogg Opus, FLAC, WAV.
- `web/scripts/gen-media-fixtures.sh` (lancé à la main, versions des outils écrites en tête, résultats commités, chacun sous 200 Kio) : `ffmpeg` pour MP4, MOV (matrice de rotation 90°, piste `tmcd`, piste de métadonnées), M4A, WebM, MKV ; `exiftool` pour les repères GPS et appareil ; `heif-enc` et `avifenc` pour HEIC et AVIF.
- Assertions communes : aucun repère (ASCII, UTF-16 BE et LE, rationnels EXIF de la latitude repère) dans la sortie ; éléments gardés identiques (orientation, ICC, matrice, `colr`, flux compressés) ; sortie relue sans erreur (image décodée par `createImageBitmap`, `<video>` et `<audio>` : même durée à 0,1 s près, mêmes dimensions ; PDF ouvert par pdf.js ; ZIP relu, CRC justes) ; fichier tronqué ou piégé → `echec` sans exception ; jamais `nettoye` sur un échec.

### 35.3 Enregistrement dans l'interface

- **Vocal (V1)** : dans la page, `getUserMedia({ audio })` + `MediaRecorder` ; écran d'explication **avant** la demande du navigateur (« Shhdrop va demander l'accès au micro. L'enregistrement reste sur votre appareil et n'est chiffré qu'ici ») ; forme d'onde en direct (barres DOM, sans `<canvas>`) ; pause et reprise (le temps en pause ne compte pas) ; durée maximale 30 min, avertissement 1 min avant, arrêt automatique ; écoute avant d'ajouter, « Recommencer » ; refus, absence de micro, micro occupé : messages distincts avec la marche à suivre ; pistes arrêtées et `AudioContext` fermé à la fin, à l'annulation et à `pagehide` ; passage en arrière-plan → pause automatique. Sortie nettoyée par §35.2 avant l'ajout.
- **Signalement (faible)** : l'audit de confidentialité (P13) propose d'interdire `AudioContext` et `getContext` dans `web/src` contre l'empreinte du navigateur. La forme d'onde a besoin d'un `AnalyserNode`, donc d'un `AudioContext` branché sur le micro : exception limitée à `web/src/media/recorder.ts` (aucun oscillateur, aucun `OfflineAudioContext`), et barres en DOM pour garder l'interdiction de `getContext`.
- `Permissions-Policy: microphone=(self)` : déjà en place (§10) ; `/pdf-frame.html` passe à `microphone=()`.
- **Vidéo dans la page (optionnelle, Q-REC1)** : `getUserMedia({ video, audio })`, aperçu, choix avant/arrière, durée maximale 5 min à 2,5 Mbit/s (environ 94 Mo), même nettoyage. Elle exige `camera=(self)`.
  - Ce qu'elle apporte : l'enregistrement par webcam **sur ordinateur**, où `capture` est ignoré (le sélecteur de fichiers s'ouvre) ; sur téléphone, `<input capture>` ouvre déjà l'appareil du système, de meilleure qualité.
  - Ce qu'elle coûte : avec `camera=(self)`, tout code servi par l'origine peut demander la caméra ; si la personne a choisi « toujours autoriser », un code piégé (§18.2) pourrait filmer **sans nouvelle demande**. C'est déjà vrai pour le micro, mais la caméra est plus grave. Sans elle, l'origine n'a jamais accès à la caméra.
  - **Recommandation** : non en V1 ; garder `camera=()` et `<input capture>`. Si le propriétaire la veut : Task 12b, l'autorisation n'est demandée qu'après un clic sur « Filmer ici », et les pistes sont coupées dès la fin.

### 35.4 Questions ouvertes (défaut recommandé)

| # | Question | Défaut recommandé |
|---|---|---|
| Q-MD1 | Échec du nettoyage : envoi silencieux, refus, ou choix | Choix explicite par fichier (« Envoyer tel quel » / « Retirer »), envoi bloqué jusque-là |
| Q-MD2 | HEIC/HEIF : nettoyer ou refuser | Nettoyer en place (§35.2) ; `echec` si la structure sort du cas simple |
| Q-MD3 | Modifications suivies (Office, ODF) | Laissées intactes (demande), détectées et signalées à l'écran |
| Q-REC1 | Vidéo enregistrée dans la page (`camera=(self)`) | Non en V1 ; `<input capture>` |
| Q-STAT1 | Compteur de signalements | Garder un seul entier horaire, exposé en booléen sur `/healthz` local ; sinon, le serveur n'a plus aucun signal d'abus |

---

## 36. Ce que voit le serveur : minimisation (v2.6, 5 novembre)

But : que le serveur, et quiconque le lit (hébergeur, pirate, réquisition), apprenne le moins possible. **Fait** = déjà dans la spécification et le code ; **À faire** = Task M2 (Plan 2) ou Plan 3 ; **Impossible** = avec la raison. Rien ici ne permet d'écrire « le serveur ne voit rien » à l'écran (§18.11).

| # | Ce qu'il voit ou peut déduire | Exposition actuelle | Réduction la plus forte, praticable | État |
|---|---|---|---|---|
| S1 | **Adresse IP** | en mémoire à chaque requête ; clés HMAC du jour pour les limites (§9.3) ; jamais sur disque côté application ; Caddy et l'hébergeur la voient | Caddy écrase `X-Shh-Client-IP` et ne journalise rien (journal global et d'accès vers `discard`) ; pilote de journal Docker `none`, journald `Storage=volatile`, swap et vidages mémoire coupés (§22) ; test avec une IP repère (texte et 4 octets) sur disque, stdout, stderr | Fait (application) ; **À faire** Plan 3 (pile) ; masquer l'adresse au serveur : **impossible** sans Tor (prévu plus tard, §3), car les limites par connexion en dépendent |
| S2 | **User-Agent, Referer, Accept-Language, Sec-CH-UA-*, Cookie, Origin** | envoyés par le navigateur ; `Referrer-Policy: no-referrer` ; le serveur Go ne les lit pas (vérifié par lecture) | Caddy les **retire avant de transmettre** au serveur (`header_up -User-Agent -Referer -Accept-Language -Cookie -Sec-CH-UA* -Sec-Fetch-* -DNT -Priority`) ; test de sources : aucun `r.UserAgent()`, `r.Referer()`, lecture d'en-tête (`Header.Get`, `Header.Values`, `Header[`) hors de la liste blanche du code actuel (`Authorization`, `X-Shh-Client-IP`, `X-Shh-Access`, `X-Shh-Manage` ; la longueur passe par `r.ContentLength`) | **À faire** M2 (test Go), Plan 3 (Caddy) |
| S3 | **Empreinte TLS** (JA3/JA4) | visible du seul Caddy, à la poignée de main | ni journalisée ni transmise (Caddy ne la transmet pas par défaut) | **Impossible** à supprimer : toute terminaison TLS la voit ; Plan 3 vérifie l'absence de journal |
| S4 | **Taille exacte** | v1 : palier seulement ; v2 envoi anticipé : à 4 Mio près (§29.7, §18.12) ; **et `fill_from` révèle à 4 Mio près le dernier segment de données même en envoi au clic** (erreur signalée : Q-K1 promettait le contraire) ; au repos, `segments_mask` est remis à « tous reçus » à `finalize` (revue K1, I3, fait) : la base ne garde que le palier | paliers inchangés (écart d'un palier au suivant : ×5 de 1 à 5 Mio, puis ×2 à ×2,5, ce qui reste raisonnable : plus fin fuit plus, plus grossier coûte la bande passante) ; **en mode « Envoyer seulement quand je clique », le navigateur envoie lui-même tout le bourrage** (octets de `crypto.getRandomValues`), sans `fill_from`/`fill_to` : le serveur ne connaît que le palier, au prix d'un envoi jusqu'à deux fois plus long | **À faire** M2 ; envoi anticipé par défaut : fuite à 4 Mio près assumée (Q-K1) |
| S5 | **Nombre et horaire des segments** | à l'envoi : chaque `PUT` en direct, `progress_at` en base à la minute (§9.1) ; à la lecture : chaque `GET` | `progress_at` **en mémoire seulement** (un redémarrage tue de toute façon les envois, §7.7) ; aucune date de segment ailleurs ; cadence constante à l'envoi **non retenue** (Q-MIN3 : elle ne cache que le débit de la connexion, contre l'objectif de 5 s) | **À faire** M2 (`progress_at`) ; cadence : non retenue |
| S6 | **Nombre d'éléments** | dans le manifeste chiffré (§29.3) | — | Fait |
| S7 | **Taille du manifeste** | réserve fixe dans le dernier morceau, longueur chiffrée (§29.3, K1) : les noms ne changent ni le palier ni le nombre de segments | — | Fait |
| S8 | **Types de fichiers** | dans le manifeste chiffré ; aucun type MIME n'est envoyé | — | Fait |
| S9 | **Quels éléments le destinataire ouvre** (non listé dans la demande, trouvé ici) | la lecture en flux télécharge les segments d'un élément quand on l'ouvre : l'ordre des `GET` trahit les frontières des éléments et ceux qui ont été vus | **lecture monotone** : après le segment de fin (manifeste), le navigateur ne demande que des numéros croissants ; ouvrir l'élément 5 télécharge (et jette) les segments qui le précèdent ; seul un nouvel essai réutilise un numéro (le budget de 2 × le paquet, §24, le permet) ; reste visible : jusqu'où la lecture est allée (§18.16) | **À faire** M2 (client) |
| S10 | **Saisie du mot de passe** | la pré-lecture « pendant la saisie » (§29.6) pourrait suivre les frappes | la pré-lecture démarre **dès la réponse de `meta`**, selon un calendrier fixe (segment de fin, puis 0, 1, 2… jusqu'à 64 Mio), jamais déclenchée par une frappe ; l'heure de `unlock` reste visible (elle **est** la fin de la saisie : impossible à cacher sans retarder la personne) | **À faire** M2 |
| S11 | **Heure de création** | non stockée ; déductible de `expires_at − ttl_hours` à 15 min près (audit P9) ; date de naissance du fichier (§18.6) | `ttl_hours` et `max_opens` mis à `NULL` après `finalize` s'ils ne servent plus (`max_opens` sert à « Ouvert 1 / 3 » : gardé) ; texte honnête « à 15 min près » ; date de naissance : impossible (système de fichiers) | **À faire** M2 (`ttl_hours`) ; naissance : **impossible** |
| S12 | **Heure des ouvertures** | aucune heure stockée, mais `purge_at` = ceil15(dernière ouverture + 3 h) **date la dernière ouverture à 15 min près** (signalé) ; `atime` réglé par `O_NOATIME` et `noatime` (audit P5) ; budget de lecture : heure de la première lecture, en mémoire | `purge_at` et `upload_deadline` **en mémoire seulement** ; au démarrage, effacer tout partage `uploading` ou `draining` (aucun jeton ne survit à un redémarrage, §7.7, donc aucun lecteur ni envoi possible) ; la base ne garde alors qu'une date, `expires_at`, arrondie au quart d'heure ; le compte à rebours n'a besoin que de `expires_at` | **À faire** M2 |
| S13 | **Nombre d'ouvertures** | `opens_left`, `opens_issued`, `done_mask` | nécessaire aux règles (§4) ; compteurs sans heure ; effacés avec le partage | Fait (nécessaire) |
| S14 | **Raison de la destruction** | champ `reason` libre de 64 caractères accepté puis ignoré (audit P11) | `reason` absent ou exactement `"report"` ; tout autre valeur → 400 ; jamais de texte libre | **À faire** M2 |
| S15 | **Données anti-robot** | défi lié à la connexion ; sels consommés 2 min ; heures exactes des créations de l'heure par connexion, en mémoire ; reCAPTCHA : Google voit l'adresse, `siteverify` sans `remoteip` (§26) | heures des créations arrondies à la minute ; rien sur disque | **À faire** M2 (arrondi) ; Google : limite de §26 |
| S16 | **État des limites** | §9.5, mémoire, clés HMAC du jour ; correspondance « envoi en cours → connexion » (§29.5) | pas plus court : les quotas du jour exigent des clés du jour | Fait |
| S17 | **Journaux** | application : `ErrorLog` jeté, nettoyeur muet (une ligne fixe), aucune adresse (audit) | test : aucune sortie standard ou d'erreur ne contient d'adresse, d'identifiant, d'en-tête repère ; Caddy, Docker, journald : Plan 3 (S1) | Fait (application) ; **À faire** M2 (test), Plan 3 |
| S18 | **Messages d'erreur** | codes fixes (`not_found`, `bad_request`, `limit`, `busy`, `budget`, `internal`), JSON uniforme (§8) | test : aucune réponse ne recopie un identifiant, un chemin, un en-tête ou un corps reçu | Fait ; **À faire** M2 (test) |
| S19 | **Relectures de la page de gestion** | `manage/status` toutes les 60 s quand l'écran est visible (§33) : relie une connexion à un partage, en direct | relecture seulement écran visible (fait) ; aucune relecture en arrière-plan ni par le service worker ; aucune trace côté serveur | Fait |
| S20 | **Pré-calcul anti-robot et envoi anticipé** | le serveur sait qu'une composition est en cours (§29.4) | mode « Envoyer seulement quand je clique » (S4) ; défaut : Q-K1 | Choix du propriétaire |
| S21 | **Compteur de signalements** | prévu (§7.6), non codé | un entier horaire, booléen `reports_alert` sur `/healthz` local, aucun identifiant (§9.5) | **À faire** M2 |
| S22 | **Existence d'un compte** (§37) | une ligne `accounts` par compte, `H` aléatoire, aucune identité | aucune donnée civile ; passkey seule ; comptes abandonnés effacés après 13 mois | **À faire** A1 |
| S23 | **Date de création du compte, dernière connexion** | `created_month`, `seen_month` | au mois près ; aucune autre date, aucune heure d'écriture du coffre | **À faire** A1 |
| S24 | **Taille du coffre de compte** | `B` | paliers 4, 16, 64, 256 Kio, 1 Mio ; plafond 1 Mio | **À faire** A2 |
| S25 | **Lien compte ↔ partages** | aucun au repos (`S_gestion` seulement dans `B` chiffré, bases séparées, aucun cookie) ; en direct : adresse et heure | écriture de `B` différée de 2 à 30 min ; jeton de session jamais envoyé aux routes des partages ; relectures étalées ; reste en direct : §18.18 | **À faire** A1–A3 ; en direct : **impossible** sans Tor |
| S26 | **Passkeys** | identifiant, clé publique, algorithme, enveloppe ; nombre de passkeys par compte | ni AAGUID, ni attestation, ni compteur de signatures, ni transports | **À faire** A1 |
| S27 | **Connexions** | heure en direct ; `seen_month` | aucun historique de connexions, aucun identifiant d'appareil | **À faire** A1 |
| S28 | **Pass payant ↔ identité** (§38) | chez le vendeur officiel seulement (empreinte `Q`) | aucune référence de commande ni moyen de paiement chez nous ; pass rangé dans `B` : le serveur ignore quel compte le détient | **À faire** P1 |
| S29 | **Pass ↔ partages Plus** | aucun : jetons aveugles (RFC 9474, 9578) ; en direct, adresse et heure | émission par lots à heure aléatoire, longtemps avant usage ; variante sans jetons : liaison en direct (§38.4) | **À faire** P1 |
| S30 | **Partage Plus** | palier, durée ou ouvertures au-delà du gratuit | inévitable (règles appliquées par le serveur) ; ne dit pas qui a payé | Assumé |

→ §39.3.8 : lignes S31 à S43 pour le salon ; §40.7 : S44 à S47 pour l'envoi direct. Dont S34 : « en train d'écrire » toujours actif (décision du propriétaire) — le serveur voit qui écrit et depuis combien de temps, à 2,5 s près (§39.3.7).

**Le test « le serveur ne voit rien » (§14) s'étend** (Task M2, bloquant comme avant) : en plus des repères de contenu, de nom, de mot de passe et de clés, il envoie une **IP repère** (texte et 4 octets), un **User-Agent, un Referer et un Accept-Language repères**, un identifiant repère dans une route inconnue et un `reason` repère ; il exige : aucun de ces repères sur disque (base, WAL, fichiers), dans stdout, stderr ni dans une réponse ; base sans `progress_at`, `upload_deadline`, `purge_at` non nuls après `finalize` et sans `ttl_hours` ; toutes les dates de la base multiples de 900 s ; en mode « au clic », aucune requête `finalize` ne porte `fill_from`. **Compte (Tasks A1 à A3)** : le même test crée un compte, synchronise un coffre de compte qui contient des `S_gestion`, libellés et réglages repères, puis exige : aucun repère dans `accounts.db`, son WAL, stdout, stderr ni une réponse ; aucune valeur commune entre `accounts.db` et `shares.db` (`V_gestion`, `V_accès`, identifiants) ; aucune date de `accounts.db` qui ne soit un premier du mois à minuit UTC ; aucune requête vers `/api/shares/*` ou `/api/manage/*` qui porte `X-Shh-Session` ; après suppression du compte et arrêt, aucun octet de `B` dans le fichier de base. La fouille de la mémoire reste limitée aux repères de contenu et de clés : l'adresse et les en-têtes passent forcément par la mémoire du processus qui reçoit la requête ; derrière Caddy (Plan 3), les en-têtes retirés ne doivent plus y apparaître.

### 36.1 Questions ouvertes (défaut recommandé)

| # | Question | Défaut recommandé |
|---|---|---|
| Q-MIN1 | Mode « au clic » : le navigateur envoie lui-même le bourrage (envoi jusqu'à 2 × plus long) | Oui, seulement dans ce mode |
| Q-MIN2 | Lecture monotone chez le destinataire (S9) | Oui |
| Q-MIN3 | Cadence d'envoi constante | Non |
| Q-K1 (rappel) | Envoi anticipé par défaut | Inchangé (oui) ; l'audit P8 recommande l'inverse : à trancher par le propriétaire |

---

## 37. Décision du propriétaire (v2.7, 5 novembre) — compte facultatif

Le propriétaire a décidé qu'un **compte facultatif** peut exister. Il n'est **jamais** demandé pour envoyer, recevoir, gérer, garder dans le coffre ni signaler. Il ne sert qu'à deux choses : **synchroniser entre appareils** un coffre de données chiffré (historique des envois de §33 et réglages), et **ranger** un pass de l'offre payante (§38) pour qui en a un. Cette section remplace le point « Plus tard, hors V1 » de §33 et amende §3 (« Jamais : comptes ») : les profils, contacts, pseudonymes et annuaires restent exclus. Le registre du contrôleur (ledger, ligne « Spécifié en §35 ») visait cette section : §35 était déjà prise.

Réalisé après la Task H (Tasks A1 à A3 du plan des écrans), désactivé par défaut côté serveur (`SHH_ACCOUNTS=0`), et **désactivé dans la démo GitHub Pages** (identifiant de site WebAuthn `github.io` partagé avec tous les sites Pages, faux serveur en mémoire).

### 37.1 Identité : passkey seule

- **WebAuthn uniquement.** Aucun e-mail, nom, téléphone, pseudonyme ni mot de passe n'est demandé ou stocké côté serveur.
- **Création** (`navigator.credentials.create`) : `rp.id` = hôte de `SHH_ORIGIN` (`shhdrop.app`) ; `user.id` = **identifiant de compte** `H` (16 octets tirés par le serveur, `crypto/rand`) ; `user.name` = `user.displayName` = « Compte Shhdrop » (fixe, pour tous) ; `residentKey: "required"` (connexion sans saisie) ; `userVerification: "required"` ; `attestation: "none"` ; algorithmes `-7` (ES256) puis `-257` (RS256) ; `extensions: { prf: { eval: { first: E } } }` où `E` = SHA-256(« shhdrop/v2/compte/prf/1 ») (entrée fixe et publique : le secret est dans l'authentificateur, la sortie diffère pour chaque passkey ; le `/1` permet une rotation).
- **Connexion** (`navigator.credentials.get`) : `allowCredentials` vide (passkey découvrable), `userVerification: "required"`, même `prf.eval.first = E`. Le serveur retrouve le compte par `userHandle` = `H`, puis par l'identifiant de la passkey.
- **Vérification côté serveur** : bibliothèque **`github.com/go-webauthn/webauthn`** (licence BSD-3-Clause, à revérifier à la Task A1), **version exacte épinglée** dans `go.mod`, dernière stable publiée depuis au moins 7 jours (§24), notée dans `THIRD_PARTY_LICENSES.md`, `govulncheck` vert. Elle ne fait que des vérifications de signatures avec la bibliothèque standard de Go : aucune crypto maison.
- **Ce qui est gardé par passkey** : identifiant de la passkey, clé publique, algorithme, et son enveloppe (§37.2). **Jamais** : AAGUID (modèle de l'authentificateur), transports, attestation, compteur de signatures (il changerait à chaque connexion et daterait l'activité ; les passkeys synchronisées renvoient 0 de toute façon), drapeaux de sauvegarde.
- **Récupération (facultative)** : une **clé de secours** `RK` (32 octets aléatoires, WebCrypto) est montrée **une seule fois** à la création : 52 caractères en base32 Crockford, groupés par 4, avec « Copier » et « Télécharger (.txt) ». La saisie est normalisée (majuscules, espaces et tirets retirés, `I`/`L` → `1`, `O` → `0`). Elle permet de se reconnecter et de déchiffrer sans aucune passkey. Le serveur n'en garde qu'un vérificateur (§37.2). Elle est **obligatoire** quand la passkey n'offre pas PRF (sinon rien ne permettrait de déchiffrer sur un autre appareil) ; proposée et refusable sinon, avec : « Sans clé de secours, perdre vos passkeys fait perdre cet historique. Vos partages, eux, continuent de fonctionner. »

### 37.2 Données à connaissance nulle : clés et coffre de compte

Aucune construction maison : HKDF-SHA-256 et AES-256-GCM de WebCrypto, aléa de `crypto.getRandomValues`. Toutes les clés importées sont **non extractibles**, les tampons intermédiaires mis à zéro au mieux (§18.4).

| Élément | Création | Où il vit |
|---|---|---|
| `K_compte` | 32 octets aléatoires, tirés une fois à la création du compte | jamais sur le serveur en clair ; en mémoire de la page pendant la session |
| `P_i` | sortie PRF de la passkey `i` pour l'entrée `E` (`prf.results.first`, 32 octets) | mémoire, le temps de l'enveloppe |
| `KEK_i` | HKDF(`P_i`, sel = vide, info = « shhdrop/v2/compte/enveloppe ») → AES-256-GCM | mémoire |
| `Env_i` | AES-256-GCM(`KEK_i`, nonce aléatoire de 12 octets, `K_compte`, données authentifiées = « SHH-ENV1 » ‖ `H` ‖ SHA-256(identifiant de la passkey `i`)) | serveur, avec la passkey `i` |
| `KEK_s` | HKDF(`RK`, sel = vide, info = « shhdrop/v2/compte/secours/enveloppe ») | mémoire |
| `Env_s` | AES-256-GCM(`KEK_s`, nonce aléatoire, `K_compte`, données authentifiées = « SHH-ENV1 » ‖ `H` ‖ « secours ») | serveur |
| `A_s` | HKDF(`RK`, info = « shhdrop/v2/compte/secours/acces ») | envoyé au serveur pour la connexion de secours |
| `V_s` | SHA-256(`A_s`) | serveur (index unique : la clé de secours retrouve le compte) |
| `K_blob` | HKDF(`K_compte`, info = « shhdrop/v2/compte/blob ») → AES-256-GCM | mémoire |
| `B` | voir ci-dessous | serveur |

- **Pourquoi pas d'Argon2id ici** : `P_i` et `RK` sont des secrets aléatoires de 256 bits, HKDF suffit (même règle que `K_lien`, §29). Une clé de secours choisie par l'utilisateur est refusée : elle n'est jamais tapée « de tête ».
- **Coffre de compte `B`** = « SHH-ACCT1 » (9 octets) ‖ `gen` (8 octets, entier croissant) ‖ nonce (12 octets) ‖ AES-256-GCM(`K_blob`, nonce, clair bourré, données authentifiées = « SHH-ACCT1 » ‖ `H` ‖ `gen`). Clair = longueur (4 octets) ‖ JSON ‖ zéros jusqu'au palier. **Paliers** de `B` : 4, 16, 64, 256 Kio, 1 Mio (plafond). Nonce aléatoire à chaque écriture (quelques milliers d'écritures au plus par clé : très loin de la limite de 2³² messages).
- **Contenu du JSON** (`v: 1`) : `history` (les entrées de §33 telles quelles : `S_gestion`, échéance, maximum d'ouvertures, libellé local, ouvertures observées ; **jamais** `K_lien`, mot de passe ni noms des éléments), `tombstones` (entrées retirées, gardées 7 jours pour la fusion), `settings` (langue, « Garder dans mon historique » par défaut, mode d'envoi de Q-K1), `pass` (secret du pass de §38, seulement si l'utilisateur l'y range).
- **Le coffre du téléphone (§27) n'est pas synchronisé**, ni son index : les paquets ne quittent jamais le téléphone, un index ailleurs ne servirait à rien et révélerait leur nombre et leurs échéances.
- **Retour en arrière** (un serveur malveillant ressert un ancien `B`) : chaque appareil garde le plus grand `gen` vu pour `H` (module `web/src/account/`, IndexedDB) et refuse un `gen` plus petit. Limite : un appareil neuf ne peut pas le détecter (§18.18).
- **Écritures concurrentes** : `PUT` avec `if_gen` ; si le serveur a déjà un `gen` plus grand → 409, le client relit, fusionne (union des entrées par identifiant local, `tombstones` appliquées, état le plus avancé gardé : `gone` l'emporte), réécrit avec `gen + 1`.
- **Appareil sans PRF** (authentificateur qui ne l'offre pas, vérifié par `getClientCapabilities()` puis par la présence de `prf.results`) : la passkey authentifie seulement ; `K_compte` est obtenue par la clé de secours, saisie une fois, puis gardée sur cet appareil enveloppée par une clé AES-GCM **non extractible** de WebCrypto dans IndexedDB (même protection honnête que §33 : elle ne vaut que le verrouillage de l'appareil). Jamais de repli silencieux : l'écran le dit.
- **PRF à la création** : certains navigateurs ne rendent pas `prf.results` pendant `create` ; le client enchaîne alors un `get` (un geste de plus, annoncé).

### 37.3 Sessions

- (→ §37.11 : routes exactes, « session récente » pour les actions sensibles, écriture différée de 2 à 12 min.) **Jeton de session en mémoire seulement**, pas de cookie : 32 octets aléatoires remis après une cérémonie réussie, envoyé dans l'en-tête `X-Shh-Session` **uniquement** par le module `web/src/account/`, et **jamais** vers `/api/shares/*` ni `/api/manage/*` (test de sources et test e2e). Le serveur ne garde que SHA-256(jeton) → `H` en mémoire ; durée 15 min sans usage, 2 h au plus ; un redémarrage les invalide toutes. Recharger la page redemande la passkey (un geste, qui redonne aussi `P_i`).
- **Pourquoi pas de cookie** : un cookie partirait avec chaque requête vers l'origine, y compris celles des partages, ce qui relierait compte et partages ; il faudrait aussi une protection CSRF. Si un cookie devenait nécessaire (application native, §16), il serait `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict`, sans `Max-Age`, et la règle « jamais vers les partages » resterait testée.
- **Aucun suivi** : ni identifiant d'appareil, ni empreinte, ni historique de connexions, ni « derniers appareils connectés ».
- **Déconnexion** : le serveur oublie la session ; le client oublie `K_compte`, `K_blob`, le clair du coffre et la copie locale de l'historique synchronisé. **Correction de la demande** (signalée) : « la déconnexion détruit le coffre » ne peut viser que la copie locale ; détruire `B` sur le serveur à la déconnexion supprimerait l'historique de tous les appareils. Seule la **suppression du compte** efface `B` sur le serveur.

### 37.4 Ce qui est stocké, et l'absence de lien avec les partages

- **Base séparée** `accounts.db` (même dossier, mêmes règles que §9 : `secure_delete=ON`, `temp_store=MEMORY`, WAL vidé, droits 0600, `WITHOUT ROWID`), jamais jointe à `shares.db` : aucune colonne commune, aucune requête qui touche les deux.
  - `accounts` : `h` (clé), `created_month` (premier jour du mois UTC de création), `seen_month` (mois de la dernière connexion, pour l'effacement des comptes abandonnés), `blob` (`B`), `gen`, `v_s` et `env_s` (facultatifs).
  - `credentials` : `cred_id` (clé), `h`, `public_key`, `alg`, `env`.
- **Jamais stockés** : adresse IP, en-têtes, heure exacte, heure des écritures de `B`, nombre de connexions, lien entre `H` et un partage, un pass ou un paiement.
- **Aucun lien au repos entre compte et partages** : `S_gestion` n'existe que dans `B` chiffré ; les partages ne portent aucune trace du compte ; le pass (§38) est lui aussi dans `B`, donc le serveur ne sait pas quel compte détient quel pass.
- **En direct, un serveur compromis peut relier** (signalé, §18.18) : la même adresse IP qui écrit `B` vient de finaliser un partage, ou relit `manage/status` pour N partages juste après la connexion. Réductions : l'écriture de `B` après un nouvel envoi est **différée** d'un délai aléatoire de 2 à 30 min (→ §37.11 A-G2 : 2 à 12 min) (ou faite au prochain lancement), jamais immédiate ; les relectures de l'historique restent celles de §33 (60 s, écran visible), étalées au hasard sur la minute ; aucune requête de compte ne porte d'identifiant de partage.

### 37.5 Limites anti-abus

- **Création** : preuve de travail (§22, repli §26) ; 3 comptes par jour par connexion et 10 par /48 (compteurs mémoire sur les clés HMAC du jour, §9.5) ; plafond global `SHH_ACCOUNTS_MAX` (10 000 par défaut).
- **Cérémonies** : défis WebAuthn en mémoire, usage unique, 2 min ; 60 requêtes de compte par minute par connexion (limite commune de §4) ; connexion de secours : 10 essais par heure par connexion.
- **Coffre** : `B` ≤ 1 Mio ; 60 écritures par heure par compte (compteur mémoire par `H`, oublié chaque heure) ; 10 passkeys au plus par compte.
- **Comptes abandonnés** : effacés quand `seen_month` a plus de 13 mois ; compte créé dont `B` est resté vide : effacé au bout de 30 jours (au mois près).

### 37.6 Plusieurs appareils, récupération, suppression

- **Passkey synchronisée** (trousseau iCloud, gestionnaire Google) : elle existe déjà sur les autres appareils du même écosystème, avec le même secret PRF ; « Se connecter » suffit.
- **Autre écosystème** : connexion par l'appareil qui a la passkey (QR code WebAuthn « hybride »), puis, session ouverte et `K_compte` en mémoire, « Ajouter cet appareil » crée une passkey locale et téléverse son `Env_i`. Si PRF manque sur l'un des deux, la clé de secours prend le relais.
- **Récupération** : « J'ai ma clé de secours » → `A_s` → session → `K_compte` par `Env_s` → nouvelle passkey et nouvelle enveloppe ; « Changer de clé de secours » remplace `V_s` et `Env_s` (l'ancienne ne sert plus à rien) ; « Retirer une passkey » supprime sa ligne (jamais la dernière s'il n'y a pas de clé de secours).
- **Rotation de `K_compte`** (passkey perdue ou volée) : « Révoquer et rechiffrer » tire une nouvelle `K_compte`, réécrit `B` et toutes les enveloppes, supprime la passkey retirée.
- **Suppression du compte** : confirmation sur place ; case **« Détruire aussi mes partages actifs »** (décochée par défaut : le client appelle `manage/destroy` pour chaque `S_gestion` avant de supprimer) ; le serveur supprime les lignes, vide le WAL **immédiatement** (`wal_checkpoint(TRUNCATE)`) et oublie les sessions ; le client efface sa copie locale. La passkey reste dans le gestionnaire de l'utilisateur : le site le dit, et le signale au navigateur quand l'API existe (`PublicKeyCredential.signalUnknownCredential`).

### 37.7 Parcours et textes

- **Où le compte apparaît** (jamais sur les pages du destinataire, jamais sur le chemin de l'envoi) :
  - menu de l'en-tête : lien discret **« Compte (facultatif) »** ;
  - `/envois` (§33) : ligne « Retrouver cet historique sur vos autres appareils » → **« Créer un compte (facultatif) »** ;
  - « Lien prêt » : sous la bascule « Garder dans mon historique », un lien texte de même niveau, jamais un bouton principal ni une fenêtre ;
  - page Sécurité : paragraphe « Le compte facultatif ».
- **Texte d'ouverture** de `/compte`, au-dessus du bouton « Créer avec une passkey » (→ §37.11.4 : plus « Se connecter » et « J'ai ma clé de secours ») : « **Facultatif. Sans e-mail. Votre historique est chiffré : nous ne pouvons pas le lire.** » Puis : « Il sert à retrouver vos envois sur vos autres appareils. Rien d'autre ne change : sans compte, tout fonctionne. » et un lien « Ce que le compte ne protège pas » vers la page Sécurité.
- **Parcours de création** : (1) texte d'ouverture ; (2) geste de la passkey (annulation → retour sans erreur, rien n'est créé) ; (3) si PRF manque : « Cet appareil ne permet pas de chiffrer avec la passkey. La clé de secours sera demandée sur chaque nouvel appareil. » ; (4) clé de secours (refusable si PRF) : affichage unique, Copier, Télécharger, case « Je l'ai rangée en lieu sûr » ; (5) « Ajouter l'historique de cet appareil au compte » (activé : c'est la raison d'être du compte) ; (6) « Compte créé. Synchronisation chiffrée active. »
- **Écran du compte** : état de synchronisation (« À jour » ou « Pas encore synchronisé »), passkeys (« Passkey 1, ajoutée en novembre 2026 », au mois près), Ajouter cet appareil, Clé de secours, Se déconnecter, Supprimer le compte.
- La phrase des écrans « Sans compte. Ni pour envoyer, ni pour recevoir. » (Task V2) devient « **Aucun compte nécessaire, ni pour envoyer, ni pour recevoir.** »

### 37.8 Routes

→ Remplacé par le tableau exact de §37.11.1. Toutes sous `/api/compte/`, JSON strict (§8), réponses uniformes, aucune donnée de partage. `inscription/debut` (preuve de travail) et `inscription/fin` ; `connexion/debut` et `connexion/fin` ; `secours` (`A_s`) ; `GET blob` et `PUT blob` (`if_gen`) ; `appareils` (ajout, retrait) ; `secours/renouveler` ; `deconnexion` ; `supprimer`. Les en-têtes lus s'ajoutent à la liste blanche de §36 S2 : `X-Shh-Session` seulement.

### 37.9 Signalements (vigilance)

| Gravité | Endroit | Problème | Correction |
|---|---|---|---|
| Élevée | §3 « Jamais : comptes » ; §33 « Plus tard » | contradiction avec la décision | amendés par renvoi à §37 ; profils et contacts restent exclus |
| Élevée | §37.4, liaison en direct | un serveur compromis relie compte et partages par l'adresse et l'heure | écriture différée et aléatoire, aucun cookie, limite §18.18 ; Tor (§3) seul l'éviterait |
| Élevée | §17, LCEN et décret 2021-1362 | un compte peut faire entrer l'exploitant dans les obligations de conservation des données de création de compte (identifiants, et données de paiement en cas de paiement) | avis du juriste (§20) **avant** d'activer `SHH_ACCOUNTS` en public ; la passkey ne livre aucune identité civile |
| Moyenne | texte imposé « nous ne pouvons pas le lire » | vrai seulement si le code servi n'est pas piégé (§18.2, §28.8) | garder la phrase du propriétaire, avec le lien « Ce que le compte ne protège pas » juste dessous (pas de formule absolue sans renvoi) |
| Moyenne | demande « la déconnexion détruit le coffre » | détruirait l'historique de tous les appareils | déconnexion = oubli local ; suppression du compte = effacement serveur (§37.3) |
| Moyenne | `seen_month`, `created_month` | dates stockées, même grossières | au mois près, nécessaires à l'effacement des comptes abandonnés ; listées en §36 |
| Faible | Confidentialité, §17 « pas de cookies » | reste vrai (aucun cookie) | la page Confidentialité décrit le compte, sa base et ses durées |
| Faible | `Permissions-Policy` (§10) | ne doit pas couper `publickey-credentials-create` / `-get` | `publickey-credentials-create=(self), publickey-credentials-get=(self)` explicites ; `()` sur `/pdf-frame.html` |

### 37.10 Questions ouvertes (défaut recommandé)

| # | Question | Défaut recommandé |
|---|---|---|
| Q-A1 | Clé de secours obligatoire | Obligatoire sans PRF ; proposée et refusable avec PRF |
| Q-A2 | Synchronisation gratuite ou payante | **Gratuite** : quelques kilo-octets, et elle protège mieux que de recopier des liens à la main |
| Q-A3 | Session sans cookie (jeton en mémoire, passkey redemandée au rechargement) | Oui |
| Q-A4 | Effacement des comptes inactifs | 13 mois sans connexion |
| Q-A5 | Case « Détruire aussi mes partages actifs » à la suppression | Proposée, décochée |

### 37.11 Compléments v2.8 (7 novembre) — création, connexion, récupération prêtes à coder

Relecture demandée par le propriétaire (« création, connexion, récupération ») : §37.1 à §37.10 décrivent bien les clés et le stockage, mais il manquait de quoi coder les Tasks A1 à A3 sans deviner. Les points ci-dessous complètent ; ceux qui modifient un choix écrit plus haut sont signalés.

| # | Gravité | Endroit | Problème | Correction (intégrée ici) |
|---|---|---|---|---|
| A-G1 | Élevée | §37.7, texte d'ouverture | « l'unique bouton « Créer avec une passkey » » : **aucun chemin de connexion ni de récupération** à l'écran | `/compte` hors session : bouton principal « Créer avec une passkey », puis bouton secondaire « Se connecter » et lien « J'ai ma clé de secours » (§37.11.4) |
| A-G2 | Élevée | §37.3 et §37.4 | Contradiction : session oubliée après **15 min** sans usage, écriture de `B` différée de **2 à 30 min** : la plupart des écritures différées tomberaient après la fin de la session | délai ramené à **2 à 12 min** (choix validé modifié, signalé) ; si la session a expiré à l'échéance, l'écriture attend la prochaine connexion et l'écran dit « Pas encore synchronisé · Se connecter » ; jamais de demande de passkey surgie sans geste |
| A-G3 | Élevée | §37.8 | Routes nommées sans corps ni réponse ; « appareils » sans cérémonie ; rotation de `K_compte` sans route | tableau exact de §37.11.1 |
| A-G4 | Moyenne | §37.1, PRF absente au `create` | `inscription/fin` exige-t-elle une enveloppe que le client n'a pas encore ? | `env` facultatif à `inscription/fin` ; un compte sans aucune enveloppe (ni `env`, ni `env_s`) à la fin de sa première session est effacé (§37.11.2) |
| A-G5 | Moyenne | actions sensibles | un jeton de session lu dans la mémoire d'un onglet resté ouvert suffirait à supprimer le compte ou les passkeys | « session récente » exigée (créée par une cérémonie il y a moins de 5 min) pour `appareils/retirer`, `secours/renouveler`, `rechiffrer`, `supprimer` ; sinon 403 `recent` et l'écran redemande la passkey |
| A-G6 | Moyenne | clé de secours | 52 caractères recopiés à la main sans contrôle : une faute consomme un des 10 essais horaires et passe pour « clé inconnue » | **caractère de contrôle** Crockford (valeur mod 37, alphabet `0-9A-Z*~$=U`) en 53ᵉ position ; vérifié dans le navigateur avant tout appel : « Clé mal recopiée : vérifiez chaque groupe » ; saisie de vérification des 4 derniers caractères à la création |
| A-G7 | Moyenne | §37.7 « Passkey 1, ajoutée en novembre 2026 » | la table `credentials` n'a pas de date | colonne `added_month` (premier du mois UTC), comme `created_month` |
| A-G8 | Moyenne | §37.3 déconnexion | « oublie la copie locale de l'historique synchronisé » : les entrées créées sur cet appareil disparaîtraient aussi | chaque entrée de l'historique (Task H) porte `origine: "local" | "compte"` ; la déconnexion retire seulement les entrées `compte` reçues d'autres appareils et oublie les clés |
| A-G9 | Faible | §37.1 | `E` désigne déjà l'enveloppe des partages (§29.2) | l'entrée PRF s'appelle `E_prf` dans le code et les tests (valeur inchangée) |
| A-G10 | Faible | §37.1, §37.8 | `SHH_ORIGIN` est cité mais n'existe pas dans la configuration du serveur | variable ajoutée en Task A1 : origine exacte `https://hôte[:port]` (http seulement pour la boucle locale, règle de §10) ; obligatoire si `SHH_ACCOUNTS=1` ; `rp.id` = son hôte |
| A-G11 | Faible | §37.1 et §29.8 | « `V_s` comparé en temps constant » et « index unique » se recouvrent | recherche par l'index sur SHA-256(`A_s`), comme `V_accès` (§29.8) : la durée ne dépend que de l'empreinte, que l'attaquant calcule lui-même ; aucun autre test de temps constant à écrire pour `V_s` |
| A-G12 | Faible | §18.18 | créer un compte juste après un envoi (lien depuis « Lien prêt ») relie en direct ce compte à cet envoi, quel que soit le délai d'écriture | dit dans le texte « Ce que le compte ne protège pas » ; la première écriture de `B` suit elle aussi le délai de 2 à 12 min si un `finalize` a eu lieu dans les 12 min |

#### 37.11.1 Routes exactes (remplace la liste de §37.8)

JSON strict (§8), base64url sans remplissage, longueurs exactes ; `H` = 22 caractères, jeton de session et `A_s` = 43, `env` et `env_s` = 80 (60 octets : nonce 12 ‖ `K_compte` chiffrée 32 ‖ étiquette 16), `blob` = taille exacte d'un palier. Erreurs : `not_found` (compte, passkey ou clé de secours inconnus, signature fausse : même corps), `bad_request`, `conflict` (409, avec `gen`), `recent` (403), `limit` (429), `busy` (503, `SHH_ACCOUNTS_MAX`). Les objets WebAuthn suivent les formats JSON de WebAuthn niveau 3 (`PublicKeyCredentialCreationOptionsJSON`, `RegistrationResponseJSON`, `AuthenticationResponseJSON`), lus par go-webauthn.

| Route | Authentification | Corps | Réponse |
|---|---|---|---|
| `POST /api/compte/inscription/debut` | preuve anti-robot (mêmes champs que `POST /api/shares`) | `{ captcha… }` | `{ options }` : `challenge` 32 octets, `user.id` = `H`, `excludeCredentials` vide |
| `POST /api/compte/inscription/fin` | défi (mémoire, 2 min, usage unique) | `{ credential, env?, v_s?, env_s? }` (`v_s` et `env_s` ensemble ou absents) | `{ session }` |
| `POST /api/compte/connexion/debut` | — | `{}` | `{ options }` (`allowCredentials` vide) |
| `POST /api/compte/connexion/fin` | défi | `{ credential }` | `{ session, h, env: string|null, blob: string|null, gen }` ; met `seen_month` à jour |
| `POST /api/compte/secours` | `A_s` (10 essais par heure par connexion) | `{ a_s }` | `{ session, h, env_s, blob: string|null, gen }` |
| `GET /api/compte/blob` | `X-Shh-Session` | — | `{ blob: string|null, gen }` |
| `PUT /api/compte/blob` | session | `{ if_gen, blob }` | `{ gen }` (= `if_gen + 1`) ; 409 `{ gen }` si le serveur a plus grand |
| `GET /api/compte/appareils` | session | — | `{ passkeys: [{ cred_id, added_month: "2026-11" }], secours: boolean }` |
| `POST /api/compte/appareils/debut` | session | `{}` | `{ options }` (`excludeCredentials` = passkeys du compte, 10 au plus) |
| `POST /api/compte/appareils/fin` | session + défi | `{ credential, env? }` | `{}` |
| `POST /api/compte/appareils/enveloppe` | session | `{ cred_id, env }` | `{}` (PRF obtenue par un `get` après le `create`) |
| `POST /api/compte/appareils/retirer` | session **récente** | `{ cred_id }` | `{}` ; refus `bad_request` pour la dernière passkey sans clé de secours |
| `POST /api/compte/secours/renouveler` | session récente | `{ v_s, env_s }` ou `{}` (retrait, permis seulement s'il reste une passkey avec `env`) | `{}` |
| `POST /api/compte/rechiffrer` | session récente | `{ if_gen, blob, envs: [{ cred_id, env }], v_s?, env_s?, retirer?: cred_id }` (toutes les enveloppes restantes, en une transaction) | `{ gen }` |
| `POST /api/compte/deconnexion` | session | `{}` | `{}` |
| `POST /api/compte/supprimer` | session récente | `{}` | `{}` (lignes effacées, `wal_checkpoint(TRUNCATE)`, sessions du compte oubliées) |

#### 37.11.2 Création, pas à pas

1. Le navigateur demande `inscription/debut` (preuve anti-robot, §22) ; le serveur tire `H`, garde en mémoire `défi → H` (2 min).
2. `navigator.credentials.create` (paramètres de §37.1). Annulation (`NotAllowedError`) → retour à l'écran, rien n'est envoyé ; le défi expire seul.
3. Le navigateur tire `K_compte`. Si `prf.results.first` est rendu : `env` = enveloppe de §37.2. Sinon, si `getClientCapabilities()` annonce PRF : un `get` avec `allowCredentials` = cette passkey (un geste de plus, annoncé « Une deuxième confirmation est nécessaire ») ; sinon, clé de secours **obligatoire** (Q-A1).
4. Clé de secours (si choisie ou obligatoire) : `RK` tirée, affichée une fois (13 groupes de 4 caractères + contrôle), « Copier », « Télécharger (.txt) », puis saisie des 4 derniers caractères pour confirmer.
5. `inscription/fin` : le serveur vérifie la cérémonie (origine `SHH_ORIGIN`, `rp.id`, défi, vérification de l'utilisateur, algorithme ES256 ou RS256), crée `accounts` et `credentials` (`added_month`), rend une session.
6. `appareils/enveloppe` si `env` a été obtenue à l'étape 3 par le `get`.
7. Premier `PUT blob` (`if_gen: 0`) avec l'historique local si la case de §37.7 (5) est cochée, sinon un coffre vide au palier de 4 Kio (délai de A-G12).
8. Un compte qui n'a, à la fin de sa première session, **ni `env` ni `env_s`** est effacé par le serveur (rien ne permettrait de le rouvrir).

#### 37.11.3 Connexion et récupération, pas à pas

- **Connexion** : `connexion/debut` → `navigator.credentials.get` (`userVerification: "required"`, `prf.eval.first = E_prf`) → `connexion/fin`. Le serveur trouve la passkey par son identifiant (index unique), vérifie que `userHandle`, s'il est rendu, vaut son `H`, vérifie la signature ; le compteur de signatures n'est ni lu ni stocké (go-webauthn : avertissement de clonage ignoré, compteur passé à 0). Puis le navigateur obtient `K_compte` : par `env` et la sortie PRF ; sinon par la clé enveloppée localement (appareil sans PRF déjà enrôlé, §37.2) ; sinon il demande la clé de secours (« Cet appareil ne permet pas de chiffrer avec la passkey : entrez votre clé de secours une fois »). Il ouvre `B` (refus d'un `gen` plus petit que le plus grand vu sur cet appareil), fusionne avec l'historique local, puis programme l'écriture différée.
- **Récupération** : « J'ai ma clé de secours » → saisie normalisée, caractère de contrôle vérifié localement → `A_s` → `secours` → `K_compte` par `Env_s` → écran « Ajouter une passkey sur cet appareil » (`appareils/debut` et `/fin`, avec `env` si PRF), proposé tout de suite ; refusé : la session vaut 15 min, et l'écran dit qu'il faudra la clé à la prochaine visite.
- **Après une récupération pour passkey volée** : l'écran propose « Révoquer et rechiffrer » (`rechiffrer`, §37.6), qui retire la passkey choisie et change `K_compte`.
- **Session** : 15 min sans usage, 2 h au plus (§37.3, inchangé) ; une écriture différée qui tombe après l'expiration attend la prochaine connexion (A-G2).

#### 37.11.4 Écrans de `/compte` (complète §37.7)

- **Hors session** : texte d'ouverture inchangé, puis « Créer avec une passkey » (`primary`), « Se connecter » (`secondary`), lien « J'ai ma clé de secours », lien « Ce que le compte ne protège pas ».
- **Erreurs** : annulation de la passkey → aucun message ; `not_found` à la connexion → « Aucun compte ne correspond à cette passkey. » ; `not_found` au secours → « Clé de secours inconnue. » ; `limit` → « Trop d'essais. Réessayez dans une heure. » ; `busy` → « Les comptes sont momentanément complets. » ; navigateur sans WebAuthn → « Ce navigateur ne gère pas les passkeys. Rien n'est perdu : tout Shhdrop fonctionne sans compte. »
- **En session** : écran de §37.7 ; « Pas encore synchronisé · Se connecter » quand une écriture attend une session.

#### 37.11.5 Questions ouvertes ajoutées (défaut recommandé)

| # | Question | Défaut recommandé |
|---|---|---|
| Q-A6 | Délai de l'écriture différée | 2 à 12 min (pour tenir dans la session de 15 min) |
| Q-A7 | Caractère de contrôle de la clé de secours | Oui (53 caractères au lieu de 52) |

---

## 38. Décision du propriétaire (v2.7) — offre payante facultative (« patte blanche »)

Modèle choisi par le propriétaire : le service gratuit reste **complet, privé et honnête** ; qui veut plus de capacité ou de confort peut payer. **Après la mise en ligne de la V1** (Tasks P1 à P3), et seulement après le choix du moyen de paiement (Q-P1) et l'avis du juriste et du comptable (§38.5).

### 38.1 Règle d'honnêteté

- L'offre payante n'apporte **aucune sécurité de plus** : même chiffrement, mêmes règles, même code, mêmes garanties que le gratuit. Seulement de la capacité ou du confort.
- **Aucun motif trompeur** : pas de compte à rebours promotionnel, pas de case précochée, pas de « plus que 2 places », pas de renouvellement automatique, pas de prix barré fictif, pas de relance par e-mail (il n'y en a pas), pas de fonction gratuite retirée pour vendre.
- **Le destinataire ne voit jamais l'offre** : aucune mention sur les pages d'ouverture, de contenu ni de coffre. L'expéditeur la voit seulement sur la page `/offre`, et d'une ligne neutre quand il atteint une limite (« Au-delà de 1 Go : offre Plus, facultative »).
- Prix affichés TTC, durée exacte, ce qui se passe à la fin (« le pass s'arrête, rien n'est prélevé »).

### 38.2 Gratuit pour toujours, et ce qui peut être payant

**Gratuit pour toujours** (tout ce qu'il faut pour partager en privé) : chiffrement de bout en bout, mot de passe, tous les types de contenu, nettoyage des métadonnées (§35.2), jusqu'à 10 éléments et 1 Gio par lien, durées 1 h à 24 h, 1 à 10 ouvertures, lien de gestion et destruction, droits du destinataire (§34), historique local (§33), coffre du téléphone (§27), signalement, code vérifiable (§28), compte facultatif et synchronisation (§37, Q-A2).

| Fonction | Gratuit | Plus (suggéré) | Recommandation |
|---|---|---|---|
| Taille par lien | 1 Gio | **5 Gio** (paliers 2 et 5 Gio, + morceau du manifeste, §29.3) | Oui. 10 Gio : non en premier temps (coût disque et abus, §38.6) |
| Durée de vie | 1, 6, 12, 24 h | **2 j, 3 j, 7 j** ; 30 j seulement jusqu'à 1 Gio | Oui ; toujours arrondie au quart d'heure |
| Ouvertures | 1 à 10 | **jusqu'à 50**, avec taille × ouvertures ≤ 100 Gio (5 Gio → 20 ouvertures) | Oui, avec le plafond de sortie |
| Échéance personnalisée | non | date et heure choisies dans la plage permise | Oui (confort, sans coût) |
| « Demander des fichiers » (lien de dépôt) | **version de base gratuite** (dans les limites gratuites) | limites Plus | Oui ; **fonction encore à spécifier** (registre du 5 nov., idée 1), section dédiée à écrire avant P2 |
| Historique synchronisé | gratuit (Q-A2) | — | Ne pas le vendre |
| Coffre plus grand | 2 Gio, 20 entrées (§27.3) | — | **Non** : stockage du téléphone de l'utilisateur, qui ne nous coûte rien ; le vendre serait malhonnête |
| Partages Plus | — | **20 par pass de 30 jours** | Oui (borne le disque, §38.6) |

### 38.3 Paiement respectueux de la vie privée : comparaison

| Option | Pour | Contre | Avis |
|---|---|---|---|
| **Numéro de compte à la Mullvad** (numéro aléatoire, aucun e-mail) | aucun identifiant personnel chez nous ; éprouvé | seul, il ne dit pas comment payer ; le numéro est un secret au porteur | **Retenu comme forme du droit** : le « pass » de §38.4 est ce numéro |
| **Carte via un prestataire** | simple pour tous, remboursements, conformité TVA | le prestataire voit l'identité et la carte | **Retenu en premier**, avec un **vendeur officiel (« Merchant of Record »**, par exemple Paddle ou FastSpring, à comparer) : il vend en son nom, facture, collecte la TVA de chaque pays et garde les preuves de localisation ; nous ne recevons qu'une référence de commande et l'empreinte du pass |
| **Espèces par courrier, bons prépayés** | très anonyme | adresse postale de l'exploitant à publier, saisie et comptabilité de chaque enveloppe, pertes ; bons chez des revendeurs : contrats et commissions | **Non** au lancement ; bons vendus par le vendeur officiel (cartes cadeaux) possibles plus tard |
| **Monero** | paiement privé par conception | retiré de la plupart des plateformes de l'UE : conversion légale en euros difficile ; volatilité ; comptabilité de chaque paiement | **Non** au lancement ; à revoir si une plateforme agréée (MiCA) le convertit |
| **Bitcoin** (BTCPay Server, logiciel libre MIT, auto-hébergé, Lightning) | aucun tiers de paiement ; Lightning discret | registre public (paiements on-chain traçables) ; conversion par une plateforme agréée (KYC de l'exploitant) ; volatilité ; un serveur de plus à tenir | **Plus tard** (deuxième moyen), sur une machine distincte de celle des partages |
| **Jetons d'accès anonymes** (signature aveugle, Privacy Pass) | le serveur vérifie « payé » sans savoir qui, ni relier deux partages Plus | crypto hors WebCrypto/libsodium : **exception à CLAUDE.md à valider** ; un peu plus de code | **Retenu pour l'usage** (quel que soit le moyen de paiement) |

**Recommandation** : vendre par carte, par un vendeur officiel, des **pass prépayés** (30 jours, 1 an), sans abonnement ; le pass est un numéro au porteur à la Mullvad, jamais relié à un compte ; chaque partage Plus est autorisé par un **jeton Privacy Pass** non reliable. Bitcoin/Lightning via BTCPay en second moyen. Pas d'espèces ni de Monero au lancement.

### 38.4 Droit d'usage : pass, puis jetons aveugles

- **Pass** : le navigateur tire `P` (32 octets) **avant** le paiement et n'envoie que `Q` = SHA-256(HKDF(`P`, « shhdrop/v2/pass »)) comme donnée de commande au vendeur officiel. Le webhook signé du vendeur (signature vérifiée, rejouage refusé) crée la ligne `passes(q, valid_until_day, tokens_left)` dans une base `passes.db`, séparée de `shares.db` et `accounts.db`. Remboursement ou rétractation → ligne supprimée. Le serveur ne garde **ni** la référence de commande **ni** le moyen de paiement. `P` est gardé par l'utilisateur (affiché une fois, comme la clé de secours) ou rangé dans le coffre de compte (§37.2 : le serveur ne sait pas quel compte le détient).
- **Ce que le vendeur relie** : identité ↔ `Q`. Ce que personne ne peut relier au repos : `Q` ↔ compte (le pass est dans `B` chiffré), `Q` ↔ partages (jetons aveugles).
- **Jetons** : protocole **Privacy Pass** (architecture RFC 9576, émission RFC 9578), type **2, RSA aveugle publiquement vérifiable** (RSABSSA-SHA384-PSS-Randomized, RFC 9474), présentés dans l'en-tête `Authorization: PrivateToken` (RFC 9577). Bibliothèques vérifiées, aucune crypto maison : serveur **`github.com/cloudflare/circl`** (`blindsign/blindrsa`, BSD-3-Clause), client **`@cloudflare/blindrsa-ts`** (licence à vérifier à P1) ; versions exactes épinglées (§24), revue de chaîne d'approvisionnement avant ajout. **Exception écrite à CLAUDE.md** (« WebCrypto et libsodium uniquement »), à valider par le propriétaire comme celle de §26 (Q-P2).
  - Émission : le client présente `P`, demande des jetons **par lots** (le solde du pass, 5 au plus par requête), à une heure aléatoire, longtemps avant usage ; le serveur décrémente `tokens_left`.
  - Usage : `POST /api/shares` avec un jeton ; le serveur vérifie la signature, refuse un jeton déjà vu (empreinte du jeton dans `spent`, sans date, gardée jusqu'à la fin de l'époque de la clé), applique les limites Plus à **ce** partage, ne garde rien qui relie le partage au jeton.
  - Clés d'émission : une par mois, publiée dans le manifeste de version signé (§28.2) pour que tout le monde reçoive la même (sinon une clé par personne la pisterait) ; jetons valables le mois de leur clé et le suivant ; `spent` purgé ensuite.
  - Post-quantique (§30) : l'anonymat d'une signature aveugle RSA est inconditionnel ; un ordinateur quantique permettrait de **forger** des jetons (fraude), pas de lever l'anonymat.
- **Variante minimale si Q-P2 est refusée** : présenter `P` à la création du partage, sans rien stocker qui les relie. Au repos, même résultat ; en direct, un serveur compromis relie tous les partages Plus d'un même pass. À dire honnêtement.
- **Ce qui reste visible au repos** : qu'un partage est Plus (palier > 1 Gio, durée > 24 h ou ouvertures > 10), pas lequel des payeurs l'a créé.

### 38.5 Cadre légal et fiscal (exploitant en France) — à faire valider

- **Statut** : vendre est une activité professionnelle. Il faut un statut (micro-entreprise ou société) **avant** la première vente. Conséquence directe : les mentions légales d'un professionnel (LCEN art. 6) publient le nom ou la dénomination, l'adresse et le numéro d'immatriculation ; l'anonymat du « particulier non professionnel » de §17 disparaît (une domiciliation d'entreprise évite l'adresse personnelle). **Juriste.**
- **Factures** : en vente aux particuliers, la note est obligatoire pour une prestation de services à partir de 25 € TTC, ou sur demande ; conservation comptable 10 ans (Code de commerce L123-22). Avec un vendeur officiel, c'est **lui** qui vend et facture le client : nous ne facturons que le vendeur (facture entre entreprises, soumise à la facturation électronique de 2026–2027). **C'est ce qui résout le conflit** entre « aucune donnée personnelle » et l'obligation de facturer : l'identité reste chez le vendeur. **Comptable.**
- **TVA** : services électroniques aux particuliers de l'UE : TVA du pays du client au-delà de 10 000 € de ventes vers d'autres États membres par an (guichet OSS), ce qui exige des preuves de localisation du client (adresse, IP, banque) : **en conflit direct** avec « aucune IP enregistrée » si nous vendions nous-mêmes. Franchise en base possible selon le seuil en vigueur ; hors UE, règles de chaque pays. Le vendeur officiel porte tout cela. **Comptable.**
- **Droit de la consommation** : information précontractuelle et **CGV** (Code de la consommation L111-1, L221-5) ; **droit de rétractation de 14 jours** (L221-18) ; pour un pass utilisable tout de suite, la perte du droit exige un accord exprès et un renoncement exprès avant l'usage (L221-28) : case **non cochée** au paiement, sinon remboursement au prorata ; **médiateur de la consommation** obligatoire (L612-1) ; pas d'abonnement, donc pas de « résiliation en trois clics » à prévoir (L215-1-1). **Juriste.**
- **Données personnelles** : le vendeur officiel est responsable de ses propres traitements ; la page Confidentialité le nomme et dit ce qu'il voit. Décret 2021-1362 (§17, §37.9) : vérifier si des données de paiement doivent être conservées par nous ; avec un vendeur officiel, nous n'en avons pas. **Juriste.**
- **Bitcoin** (si retenu) : accepter un paiement n'est pas une activité de prestataire de services sur crypto-actifs ; la conversion passe par une plateforme agréée MiCA ; chaque encaissement est une recette à comptabiliser à sa valeur en euros. **Comptable.**
- **Cryptologie** (§17) : la déclaration ANSSI doit couvrir une fourniture commerciale. **Juriste.**
- **Contenus illicites** : des liens plus gros, plus longs et plus ouverts attirent la diffusion de masse (piratage, pires contenus) ; DSA (point de contact, notification) et capacité de traiter les signalements à dimensionner avant P2.

### 38.6 Coût du serveur et abus des paliers plus grands

- **Disque** : un partage de 5 Gio pendant 7 jours occupe 5 % du plafond par défaut de 100 Gio ; un pass de 20 partages peut, au pire, garder 100 Gio d'un coup. D'où : **réserve Plus séparée** `SHH_STORAGE_PLUS_MAX` (en plus de `SHH_STORAGE_MAX`) ; quand elle est pleine, refus honnête « Capacité Plus momentanément pleine, réessayez plus tard » (503) ; jamais de place prise sur le gratuit.
- **Bande passante** : sortie au pire = taille × ouvertures × 2 (budget de §24) : 5 Gio × 20 = 100 Gio, jusqu'à 200 Gio avec les nouveaux essais. Plafond « taille × ouvertures ≤ 100 Gio » par partage ; à comparer au trafic inclus de l'hébergeur (§20). Prix du pass à fixer **après** le choix de l'hébergeur, sur cette base (ordre de grandeur : quelques euros par mois et par pass).
- **Quotas par connexion** maintenus pour les partages Plus (envois à part : 20 Gio par jour par connexion, 40 Gio par /48) : un pass volé ne permet pas de saturer le disque depuis une seule adresse.
- **Jetons** : un jeton = un partage Plus ; émission bornée par `tokens_left` ; un pass partagé publiquement s'épuise vite, et se révoque (remboursement, abus constaté par le vendeur).

### 38.7 Questions ouvertes (défaut recommandé)

| # | Question | Défaut recommandé |
|---|---|---|
| Q-P1 | Moyen de paiement | Carte via un vendeur officiel, pass prépayés ; BTCPay ensuite ; ni espèces ni Monero au lancement |
| Q-P2 | Exception à la règle crypto pour Privacy Pass (circl, blindrsa-ts) | Oui, après revue de chaîne d'approvisionnement et de l'implémentation ; sinon variante minimale de §38.4 |
| Q-P3 | Limites Plus | 5 Gio ; 2, 3, 7 j (30 j jusqu'à 1 Gio) ; 50 ouvertures sous le plafond de 100 Gio ; 20 partages par pass de 30 jours |
| Q-P4 | Abonnement ou prépayé | Prépayé seulement, aucun renouvellement automatique |
| Q-P5 | Statut juridique de l'exploitant | À décider avec le juriste et le comptable avant P1 (micro-entreprise avec domiciliation ou société) |
| Q-P6 | « Demander des fichiers » | Base gratuite, limites Plus payantes ; section de spec à écrire |
| Q-P7 | Coffre plus grand payant | Non |

### 38.8 Décision du propriétaire (v2.8, 7 novembre) — deux formules, « Plus » et « Pro », et modèle de coûts

Remplace la colonne « Plus (suggéré) » de §38.2 et Q-P3 ; §38.1 (honnêteté), §38.3 et §38.4 (paiement, pass, jetons aveugles), §38.5 (légal) et §38.6 (réserve séparée) restent valables. **Aucune formule n'apporte de sécurité de plus** : seulement de la capacité et du confort. Le gratuit reste complet et privé. Les « abonnements » demandés sont des **pass prépayés** de 30 ou 365 jours, sans renouvellement automatique (Q-P4) : prix « par mois » et « par an ».

#### 38.8.1 Ce que donne chaque formule

| Fonction | Gratuit | **Plus** | **Pro** |
|---|---|---|---|
| Taille par lien | 1 Go | 5 Go | 20 Go (paliers 2, 5, 10 et 20 Gio, + morceau du manifeste) |
| Durée de vie | 1, 6, 12, 24 h | jusqu'à 7 jours | jusqu'à 30 jours |
| Échéance personnalisée (date et heure) | non | oui | oui |
| Ouvertures | 1 à 10 | jusqu'à 50, taille × ouvertures ≤ 50 Go | jusqu'à 100, taille × ouvertures ≤ 100 Go |
| Liens payants par pass de 30 jours | — | 20 | 50 |
| Liens gratuits par jour | 10 (inchangé, §4) | 10 + les liens du pass | 10 + les liens du pass |
| Salon de discussion (§39) | 24 h, 10 personnes, 1 Go | 3 jours, 20 personnes, 5 Go | 7 jours, 50 personnes, 20 Go |
| « Demander des fichiers » (fonction encore à spécifier, §38.2) | base gratuite | limites Plus | limites Pro |
| Relais de l'envoi direct (§40) | 2 Go par transfert, 5 Go par jour | 20 Go par jour | 100 Go par jour |
| Envoi direct sans relais (§40, adresses visibles) | illimité (ne nous coûte rien) | illimité | illimité |
| Bande passante prioritaire | non | non | oui : réserve séparée de places de transfert simultané (§24) ; « prioritaire », jamais « débit garanti » |
| Historique synchronisé (§37) | **gratuit** | gratuit | gratuit |
| Coffre du téléphone (§27) | gratuit, 2 Go | inchangé | inchangé |

- **Historique synchronisé : non vendu**, malgré la liste de fonctions candidates : il ne coûte presque rien et vendre une meilleure protection contre la perte de ses liens irait contre §38.1 (Q-A2 inchangée). Signalé.
- Chaque lien Plus ou Pro consomme un jeton aveugle (§38.4) ; Plus et Pro ont **deux clés d'émission distinctes** : le serveur apprend la formule d'un partage (déjà visible par ses limites, §36 S30), jamais le payeur.
- Plafonds de sortie par partage (taille × ouvertures) : ils bornent la bande passante au pire (Plus : 20 × 50 Go = 1 To par pass ; Pro : 50 × 100 Go = 5 To par pass).

#### 38.8.2 Prix proposés (TTC, euros)

| Formule | 30 jours | 365 jours |
|---|---|---|
| **Plus** | **5 €** | **50 €** (deux mois offerts) |
| **Pro** | **12 €** | **120 €** (deux mois offerts) |

#### 38.8.3 Modèle de coûts (estimations publiques, **à vérifier** au choix de l'hébergeur)

**Prix unitaires** (ordres de grandeur relevés sur les grilles publiques, susceptibles d'avoir changé) :

| Poste | Fourchette | Exemples de classe |
|---|---|---|
| Stockage sur disques d'un serveur dédié (en miroir, donc ×2) | environ 3 à 8 € par To-mois utile | serveurs dédiés de stockage (Hetzner, OVH) |
| Stockage objet | environ 5 à 10 € par To-mois | Backblaze B2, Hetzner Object Storage, OVH Object Storage ; **inadapté en l'état** (Shhdrop écrit à position fixe sur un disque local, §9.2) |
| Volume bloc en nuage | environ 40 à 55 € par To-mois | volumes Hetzner Cloud et semblables ; trop cher pour des Go de partages |
| Trafic sortant | de 0 € (illimité à 1 Gbit/s sur beaucoup de dédiés UE) à environ 1 € par To au-delà du forfait (Hetzner), et de 5 à 20 € par To chez des hébergeurs suisses ou islandais (Infomaniak, FlokiNET, 1984) ; Backblaze : gratuit jusqu'à 3 × le stocké puis environ 10 $ par To | prendre **3 € par To** comme valeur centrale |
| Vendeur officiel (« Merchant of Record ») | environ 5 % du prix hors taxes + 0,50 € par paiement | Paddle, FastSpring (à comparer) |
| TVA | 20 % en France, de 17 à 27 % selon le pays du client | collectée par le vendeur officiel |

**Usage attendu par payeur** (hypothèse, à revoir sur la facture de l'hébergeur, **sans aucune statistique côté Shhdrop**, §35.1) :

| | Plus | Pro |
|---|---|---|
| Stockage moyen tenu | 10 Go-mois (20 liens × 2 Go × 7 jours ÷ 30) | 50 Go-mois |
| Trafic sortant | 0,25 To par mois | 1 To par mois |
| Coût direct (stockage à 8 €/To-mois, sortie à 3 €/To) | 0,08 + 0,75 = **0,83 €** | 0,40 + 3,00 = **3,40 €** |

**Marge par payeur et par mois**

| | Prix TTC | HT (TVA 20 %) | Frais du vendeur | Net | Coût direct | **Marge** |
|---|---|---|---|---|---|---|
| Plus, 30 jours | 5,00 € | 4,17 € | 0,71 € | 3,46 € | 0,83 € | **2,63 €** |
| Plus, 365 jours (par mois) | 50 € | 41,67 € | 2,58 € | 3,26 € | 0,83 € | **2,43 €** |
| Pro, 30 jours | 12,00 € | 10,00 € | 1,00 € | 9,00 € | 3,40 € | **5,60 €** |
| Pro, 365 jours (par mois) | 120 € | 100,00 € | 5,50 € | 7,88 € | 3,40 € | **4,48 €** |

Au pire (sortie à 20 €/To, gros utilisateurs au plafond), Plus ne couvre plus son coût direct : c'est la raison des plafonds de §38.8.1 et d'un hébergeur à sortie forfaitaire.

**Seuil de rentabilité** (coûts fixes mensuels : serveur, domaine, e-mail, comptable, assurance, médiateur de la consommation ; le gratuit est inclus dans la machine) :

| Machine | Coûts fixes estimés | Plus seuls | Pro seuls | Mélange 70 % Plus, 30 % Pro (marge moyenne 3,52 €) |
|---|---|---|---|---|
| **Petite** : un dédié, 2 × 1 To NVMe, 1 Gbit/s (40 à 70 €), plus 50 € de frais administratifs | environ **120 €** | **46** abonnés | **22** | **35** |
| **Moyenne** : dédié de stockage (4 × 16 To en miroir, 150 à 250 €), machine TURN séparée (30 à 60 €), frais administratifs | environ **350 €** | **134** | **63** | **100** |

Ces chiffres n'incluent ni le temps du propriétaire, ni un audit externe (§3), ni les frais de création d'entreprise (§38.5).

#### 38.8.4 Questions ouvertes ajoutées (défaut recommandé)

| # | Question | Défaut recommandé |
|---|---|---|
| Q-P8 | Prix | Plus 5 €/30 j, 50 €/an ; Pro 12 €/30 j, 120 €/an |
| Q-P9 | Historique synchronisé payant | Non (gratuit pour tous) |
| Q-P10 | Paliers de 10 et 20 Gio pour Pro | Oui, avec la réserve Plus séparée (§38.6) agrandie en conséquence |

---

## 39. Décision du propriétaire (v2.8, 7 novembre) — salon de discussion éphémère

Demande : « Pouvoir générer un lien de discussion, avec les mêmes critères de sécurité. On y parle, on s'envoie du texte et directement des documents (PDF, Word, photos, vidéos, archives…). On voit en direct quand quelqu'un écrit. Messages vocaux, émojis, et tout ce qui est utile et important. Confidentialité et sécurité avant tout. Fichiers illimités en nombre, mais 1 Go au plus au total dans la conversation. Nombre de participants fixé par le créateur ou laissé ouvert (10 au plus). Une couleur par personne. Après le lien et le mot de passe, avant le salon, une page explique le concept et impose un pseudonyme pour cette conversation. Le bouton du salon est à part, pour qu'on le voie. »

Cette section amende §3 (« Plus tard » : le salon était noté V2 au registre), §6 (libsodium ne sert plus seulement à Argon2id), §8, §9, §9.5, §18, §35.1 et §36 par renvois. Réalisée après les Tasks A1 à A3 (Tasks C-1 à C-6 du plan des écrans), désactivée par défaut côté serveur (`SHH_SALONS=0`).

### 39.1 Modèle

- **Création** par le navigateur du créateur, sans compte : durée de vie **1, 6, 12 ou 24 h** (mêmes choix que les partages ; Plus : §39.11), comptée **depuis la création** (un salon sert tout de suite, il n'y a pas d'envoi à attendre), expiration arrondie au quart d'heure supérieur ; **nombre de participants** « Ouvert (10 au plus) » par défaut, ou de 2 à 10 ; **mot de passe** : même générateur et mêmes règles que §31 (10 caractères générés, 10 au moins si saisi, liste noire) ; bascule « Les participants peuvent détruire le salon » (désactivée par défaut, Q-SAL4) ; preuve anti-robot (§22, repli §26).
- **Lien** : `https://shhdrop.app/#c<K_lien, 43 caractères base64url>` (65 caractères), à côté de `#<43>` (partage) et `#m<43>` (gestion, §32). Le routeur distingue par la longueur et le préfixe ; même hygiène (§5.3). Le créateur garde aussi `S_gestion` (en mémoire de la page, et dans l'historique local de §33 si « Garder dans mon historique » est activé) pour détruire le salon même sans y être.
- **Budget** : **1 Gio = 1 073 741 824 octets de chiffré par salon**, imposé par le serveur : chaque trame relayée compte 4 140 octets (§39.3), chaque pièce jointe compte la taille du fichier chiffré de son palier (48 + B × 65 552). Aucune limite de nombre de fichiers. **Conséquence à dire** : le plus grand palier (16 385 morceaux, 1 074 069 568 octets) dépasse le budget ; le plus gros fichier possible est donc celui du palier 8 000 (524 416 048 octets de chiffré, **524 222 464 octets utiles, « 500 Mo »**). À l'écran : « 1 Go au total · 500 Mo au plus par fichier ». Variante pour un fichier unique de 1 Go : Q-SAL1.
- **Fin de vie**, le premier atteint : expiration ; « Détruire le salon » par le créateur (`S_gestion`) ou, si la bascule est activée, par tout participant ; 10 mots de passe faux (Q-SAL3) ; administrateur (`shhdrop admin destroy -` reconnaît `#c`, §15.3) ; budget épuisé ne détruit pas : il bloque seulement les envois (« Le salon est plein : 1 Go atteint »). À la fin : flux fermés, file en mémoire effacée, pièces jointes effacées (fichier puis ligne), ligne du salon supprimée, exactement comme un partage (§7.6).
- **Nouveaux venus** : ils ne voient **pas** les messages d'avant leur arrivée (conséquence de §39.2 : les chaînes changent à chaque arrivée). Choix par défaut, Q-SAL2.
- **Arrivée et départ** : une place (« siège ») est prise au mot de passe juste ; elle reste à la personne tant que sa page est ouverte et reconnectée en moins de 10 min ; « Quitter », la fermeture de la page (`pagehide`, `keepalive`) ou 10 min sans flux la libèrent. Recharger la page fait sortir (rien n'est gardé dans le navigateur) : le navigateur prévient avant (`beforeunload`).

### 39.2 Chiffrement (libsodium et WebCrypto seulement)

**Choix : « clés d'expéditeur » avec cliquet symétrique par expéditeur et renouvellement par époques** (la construction des groupes de Signal), entièrement en primitives de libsodium (`libsodium-wrappers-sumo` 0.8.4, déjà présent) et WebCrypto. **Aucune exception à CLAUDE.md** ; amendement de §6 : libsodium sert désormais aussi à X25519, Ed25519, HMAC-SHA-256 et XChaCha20-Poly1305 pour le salon.

**Comparaison**

| Option | Confidentialité persistante (FS) | Guérison après compromission (PCS) | Coût | Verdict |
|---|---|---|---|---|
| **Clés d'expéditeur + époques** (retenue) | oui, par message (cliquet à sens unique, clés effacées après usage) | contre un attaquant **passif**, en une heure au plus (§39.2.4) ; aucune contre un attaquant actif qui a volé la clé d'identité | environ 600 lignes TypeScript, primitives libsodium déjà embarquées, aucune dépendance | **Retenue** : suffisante pour 10 personnes et 24 h, simple à relire |
| **MLS** (RFC 9420), par exemple `ts-mls` (TypeScript, licence MIT, série 1.x, version et licence à revérifier) | oui | oui, y compris l'arbre de clés, renouvellement par « commit » | nouvelle dépendance de plusieurs milliers de lignes, s'appuie sur `@noble/*` (crypto hors WebCrypto et libsodium) : **exception à CLAUDE.md** à faire valider par le propriétaire, comme Privacy Pass (§38.4) ; service de livraison et d'authentification à écrire ; peu d'audits publics de la version JavaScript | Non en V1 ; à revoir si une implémentation auditée existe (OpenMLS en WebAssembly, par exemple) |

**Signalement (gravité moyenne)** : la construction retenue n'invente aucune primitive, mais leur **assemblage** est un protocole propre à Shhdrop. Il doit être relu par un cryptographe extérieur avant l'ouverture au public (même règle que l'audit externe de §3), avec les vecteurs de test de la Task C-1.

#### 39.2.1 Clés du salon

| Élément | Création | Où il vit |
|---|---|---|
| `K_lien` | 32 octets aléatoires | après `#c` ; jamais envoyé |
| `K_accès_s`, `V_accès_s` | HKDF(`K_lien`, « shhdrop/v2/salon/acces »), SHA-256 | en-tête `X-Shh-Access` / serveur (index unique) |
| `S_gestion`, `V_gestion` | 32 octets aléatoires, SHA-256 | navigateur du créateur (et historique §33) / serveur |
| `sel` | 16 octets aléatoires | serveur, rendu par `meta` |
| `K_mdp` | Argon2id(mot de passe NFC, `sel`), 64 Mio, 3 passes (§7.1, mêmes bornes) | navigateur |
| `K_maître_s` | HKDF(`K_lien` ‖ `K_mdp`, « shhdrop/v2/salon/maitre ») | navigateur |
| `K_preuve_s`, `V_preuve_s` | HKDF(`K_maître_s`, « shhdrop/v2/salon/preuve »), SHA-256 | envoyé pour entrer / serveur |
| `K_salon` | HKDF(`K_maître_s`, « shhdrop/v2/salon/cle ») | navigateur |
| `K_trame` | HKDF(`K_salon`, « shhdrop/v2/salon/trame »), 32 octets | navigateur (clé XChaCha20-Poly1305 de l'enveloppe extérieure) |
| `tag_salon` | HKDF(`K_salon`, « shhdrop/v2/salon/id »), 16 octets | navigateur (données authentifiées) ; jamais envoyé |

Toutes les étiquettes commencent par `shhdrop/v2/salon/` : séparation de domaine avec les partages (§29.2), le coffre (§27.2) et le compte (§37.2). HKDF par WebCrypto (`deriveBits`, sel vide, comme `kdf.ts`). `K_trame` sort en octets bruts, car libsodium l'utilise : elle vit dans la mémoire de la page comme les fichiers en clair (limite §18.4).

#### 39.2.2 Clés de chaque participant (éphémères, mémoire de la page seulement)

- **Identité** `IK` : paire Ed25519 (`crypto_sign_keypair`), tirée à l'entrée, valable jusqu'à la sortie. Sa clé publique (32 octets) est l'identifiant du participant dans les trames.
- **Clé de réception** `RK_e` : paire X25519 (`crypto_box_keypair`), **remplacée à chaque époque** du participant ; l'ancienne partie secrète est gardée 10 min (clés d'expéditeur encore en route), puis effacée (`sodium.memzero`).
- **Chaîne d'expéditeur** pour l'époque `e` : `CK_0` = 32 octets aléatoires ; pour le message `i` : `MK_i` = HMAC-SHA-256(`CK_i`, 0x01), `CK_{i+1}` = HMAC-SHA-256(`CK_i`, 0x02) (`crypto_auth_hmacsha256`, construction KDF_CK du Double Ratchet de Signal) ; `CK_i` et `MK_i` effacés dès l'usage.
- **Distribution** : à chaque nouvelle époque, l'expéditeur envoie une ou plusieurs trames de contrôle signées (12 destinataires au plus par trame, environ 290 octets chacun en JSON) qui contiennent, pour chaque autre membre `m`, `crypto_box_seal`(« SHCK1 » ‖ `tag_salon` ‖ `IK_exp` ‖ `IK_m` ‖ `e` (4 octets) ‖ `CK_0`, `RK_m`) ; la scelle anonyme de libsodium tire une clé X25519 éphémère à chaque appel.
- **Annonce** (dans chaque trame de distribution et à l'arrivée) : pseudonyme, indice de couleur, `IK`, `RK_e` courante, `nonce_arrivée` du siège (§39.3.3), signée par `IK`.
- **Messages reçus en désordre ou perdus** : le serveur ordonne tout (numéro `seq`), donc seule une perte crée un trou ; au plus 2 000 clés sautées gardées par chaîne, 15 min au plus, puis effacées. Une distribution manquée → trame « demande de clé » ; l'expéditeur rescelle son état courant (`CK_i` et `i`) pour ce seul membre.

#### 39.2.3 Format des trames (taille unique)

- **Trame** (corps de `POST /api/salons/trame`, toujours **4 140 octets**) = « SHC1 » (4) ‖ `nonce_ext` (24, aléatoire) ‖ XChaCha20-Poly1305-IETF(`K_trame`, `nonce_ext`, `O`, données authentifiées = « SHC1 » ‖ `tag_salon`) ; `O` = **4 096 octets** exactement.
- `O` = `type` (1) ‖ `IK_exp` (32) ‖ `e` (4) ‖ `i` (4) ‖ `long` (2) ‖ `corps` (`long` octets) ‖ zéros. Le serveur ne voit ni le type, ni l'expéditeur, ni la taille réelle.
- `type` 1, **message** : `corps` = `nonce_int` (24) ‖ XChaCha20-Poly1305-IETF(`MK_i`, `nonce_int`, `M`, données authentifiées = « SHCM1 » ‖ `tag_salon` ‖ `IK_exp` ‖ `e` ‖ `i`) ‖ signature Ed25519 (64) de « SHCM1 » ‖ `tag_salon` ‖ `e` ‖ `i` ‖ `nonce_int` ‖ chiffré. Place utile pour `M` : 4 096 − 43 − 24 − 16 − 64 = **3 949 octets**. La signature est vérifiée **avant** de déchiffrer ; une trame dont `IK_exp` n'est pas un membre annoncé est jetée.
- `type` 2, **contrôle** (annonce, distribution, demande de clé, départ) : `corps` = JSON ‖ signature Ed25519 (64) ; protégé par `K_trame` seulement (connu des seuls détenteurs du lien et du mot de passe).
- `M` (JSON strict, clés exactes, comme §8) : `{ "k": "texte" | "piece" | "reaction" | "reponse" | "retrait" | "ecrit" | "lu" | "effacer_lu", "id": 16 octets aléatoires (base64url 22), … }` ; champs par sorte en §39.5. Textes : NFC, contrôles C0/C1 retirés sauf `\n`, caractères d'inversion de sens (U+202A–U+202E, U+2066–U+2069) retirés ; affichage en nœuds texte seulement (`dir="auto"`, jamais `{@html}`).

#### 39.2.4 Époques et renouvellement

- Chaque expéditeur ouvre une **nouvelle époque** (nouvelle `CK_0`, nouvelle `RK_e`, annonce et distribution) : à son arrivée ; à **chaque arrivée ou départ** d'un autre membre (le partant ne lit plus rien de nouveau, l'arrivant ne lit rien d'ancien) ; après **100 messages** dans l'époque ; **60 min** après le début de l'époque.
- **FS** : voler l'état d'un appareil à l'instant t ne donne pas les messages d'avant t (clés effacées, cliquet à sens unique), sauf ceux encore affichés dans la page et les clés sautées (15 min au plus).
- **PCS passive** : un attaquant qui a copié la mémoire d'un participant sans agir ne lit plus rien au plus tard une heure après (chaque expéditeur a changé d'époque, et les nouvelles `CK_0` sont scellées à une `RK_e` qu'il ne connaît pas).
- **Ce que ce choix ne donne pas** (à écrire sur la page Sécurité) :
  - aucune guérison contre un attaquant **actif** qui a volé `IK` : il peut annoncer de fausses clés de réception au nom de la victime tant qu'elle est là ;
  - un **membre** peut tout lire, tout copier, et se faire passer pour personne d'autre (signatures) ; mais rien ne prouve qui est derrière un pseudonyme ;
  - **pas de déni** : les messages sont signés ;
  - `K_trame` est fixe pour la vie du salon : qui obtient des trames (mémoire du serveur) **et** le lien **et** le mot de passe lit les annonces (pseudonymes, clés publiques), le type et l'heure des trames, pas les messages ;
  - le code servi par le serveur reste la limite de §18.2 ;
  - aucune protection contre une capture d'écran.

#### 39.2.5 Pièces jointes

- Chaque fichier, vocal ou photo est un **paquet SHH2 d'un seul élément** (§29.3, `container.ts` inchangé) sous une graine `R` aléatoire propre ; nettoyé avant (§35.2, mêmes états `echec` / `protege` et mêmes choix).
- Le message `piece` porte `R` (32 octets), l'identifiant de la pièce tiré par le serveur, le palier, et pour l'affichage avant téléchargement le nom, le type et la taille ; après téléchargement, le manifeste du paquet (authentifié) fait foi : nom, type ou taille différents → « Fichier corrompu », rien n'est affiché. Noms par `safeName`, aperçu par `previewKind`, avertissement par `isRiskyFile` (§12), comme un partage.
- Le serveur n'a jamais `R` ; il ne peut ni lire ni échanger une pièce (le contrôle de `C_engagement` échoue).

### 39.3 Transport et serveur

#### 39.3.1 Choix : flux `fetch` descendant et `POST` montant

- **Descendant** : `GET /api/salons/flux` avec `X-Shh-Membre` et `X-Shh-Depuis` (dernier `seq` reçu) ; réponse binaire en flux (`ReadableStream` de `fetch`). **Montant** : `POST /api/salons/trame`.
- **Pourquoi pas WebSocket** : Go n'en a pas dans la bibliothèque standard (une dépendance de plus, §24) ; `EventSource` ne peut pas porter d'en-tête (le jeton finirait dans l'URL, interdit §8). Le flux `fetch` passe par HTTP/2 derrière Caddy (`flush_interval -1` sur `/api/salons/flux`, Plan 3), sans bibliothèque.
- **Enregistrements du flux** : `type` (1) ‖ `seq` (8, gros-boutiste) ‖ données. 0x01 trame : `siège` (1) ‖ 4 140 octets ; 0x02 arrivée : `siège` (1) ‖ `nonce_arrivée` (16) ; 0x03 départ : `siège` (1) ; 0x04 trou (`seq` = premier numéro encore en file) ; 0x05 fin : raison (1 = expiré, 2 = détruit, 3 = budget de flux, 4 = remplacé par un autre flux du même siège) ; 0x06 maintien (toutes les 25 s, `seq` = 0) ; 0x07 présence : `siège` (1) ‖ état (1 = en ligne, 0 = coupé), émis quand le flux d'un siège s'ouvre ou se ferme (le serveur le sait de toute façon).
- Chaque écriture repousse l'échéance d'écriture de la requête de 60 s (`http.ResponseController.SetWriteDeadline`) ; un flux dure 2 h au plus, puis le client se reconnecte (`X-Shh-Depuis`). Un seul flux par siège : un nouveau remplace l'ancien.

#### 39.3.2 Relais en mémoire seulement

- Les trames ne sont **jamais écrites sur disque** : ni base, ni fichier, ni journal, ni fichier d'échange (swap coupé, §22). File **bornée par salon** : les 200 dernières trames et 15 min au plus (environ 830 Kio) ; au-delà, la plus ancienne est oubliée. Un membre qui revient demande `X-Shh-Depuis` ; s'il manque des trames déjà oubliées, il reçoit 0x04 et l'écran affiche « Des messages ont pu vous échapper pendant la coupure. »
- Plafond global `SHH_SALONS_MAX` = 200 salons vivants (environ 166 Mio de files au pire). Au-delà, création refusée (503 `busy`).
- Un redémarrage du serveur perd les files et les sièges : les pages ouvertes rentrent seules (elles gardent `K_accès_s` et `K_preuve_s` en mémoire, comme l'ouverture d'un partage, §18.10), ouvrent de nouvelles époques et affichent la notice de trou.
- `POST /api/salons/retirer` (`{ "seq" }`) enlève de la file une trame **envoyée par le même siège** (le serveur sait quel siège a posté chaque trame en file) ; utilisé par « Retirer pour tous ».

#### 39.3.3 Sièges, plafond, jetons

- `POST /api/salons/rejoindre` (`X-Shh-Access`, `{ "proof" }`) : `K_preuve_s` juste → le serveur, en une opération atomique, vérifie `sièges occupés < max_members` et `arrivées totales < 5 × max_members`, attribue le plus petit siège libre (0 à 9), tire un **jeton de membre** (32 octets, gardé en mémoire par SHA-256) et un `nonce_arrivée` (16 octets, diffusé dans l'enregistrement 0x02, signé dans l'annonce : un membre ne peut pas rejouer l'annonce d'un autre). Réponse : `{ member_token, seat, seq, expires_in_s, max_members, members_can_destroy, budget_left }`. Complet → 409 `full` (« Ce salon est complet. ») ; faux → 403 `bad_password` avec essais restants.
- Le plafond est donc imposé par le serveur sur les jetons ; un siège pris sans pseudonyme choisi est libéré après 10 min.

#### 39.3.4 Pièces jointes sur disque

- Comme les segments d'un partage : un fichier par pièce, taille exacte du palier réservée (`fallocate`), écriture à position fixe, segments de 4 Mio, bourrage rempli par le serveur à la finalisation (`fill_from`, `fill_to`, §29.3), dates remises à zéro, `O_NOATIME`, aucune sauvegarde. Elles comptent dans `SHH_STORAGE_MAX` (§4) et dans le budget du salon, réservées à la création de la pièce.
- Table `salon_pieces` (`id`, `salon_id`, `bucket`, `state`, `segments_mask`), effacée avec le salon. L'auteur d'une pièce n'est connu qu'en mémoire (siège), pour le retrait.
- Téléchargement : `GET /api/salons/pieces/segments/{n}` avec `X-Shh-Membre` et `X-Shh-Piece` (aucun identifiant dans le chemin, §29.8) ; budget de lecture : 2 × le fichier chiffré par membre et par pièce (même règle que §24).
- Quotas : les octets utiles des pièces comptent dans les quotas journaliers de §4 (3 Gio par connexion, 6 Gio par /48), débités à la finalisation.

#### 39.3.5 Base

- Table `salons` dans `shares.db` (mêmes règles : `WITHOUT ROWID`, `secure_delete`, WAL vidé) : `id` (interne, 128 bits), `access_v`, `manage_v` (index uniques), `proof_v`, `salt`, `kdf_ops`, `kdf_mem`, `expires_at` (arrondie au quart d'heure), `max_members`, `members_can_destroy`, `failed_attempts`, `pieces_bytes` (somme réservée des pièces). **Jamais** : durée choisie (l'heure de création s'en déduirait), nombre de messages, budget des trames (en mémoire seulement : un redémarrage le remet à zéro, limite acceptée), sièges, pseudonymes, adresses.
- §35.1 (3) devient : `sqlite_master` ne contient que `shares`, `salons`, `salon_pieces` et leurs index.

#### 39.3.6 Limites (compteurs mémoire, ajoutés à §9.5)

| Limite | Valeur |
|---|---|
| Créations de salons | 5 par jour par connexion, 15 par /48 ; preuve anti-robot ; difficulté partagée avec les partages (§22) |
| Entrées (`rejoindre`) | 20 par heure par connexion, 60 par /48 ; mots de passe faux : compteur du salon, 10 → destruction |
| Trames montantes | 60 par minute par siège (rafale 20), 120 par minute par connexion, 600 par /48 ; au-delà 429 et l'écran temporise |
| Flux ouverts | 4 par connexion, 16 par /48, 2 000 au total |
| Pièces | 8 envois de segments simultanés par connexion (§24, inchangé) ; mêmes limites de débit des segments |

Clés : HMAC du jour comme §9.3, jamais d'adresse. L'état d'un salon vivant (file, sièges, empreintes des jetons, budget des trames) n'est pas une statistique au sens de §9.5 : il est nécessaire aux règles et effacé avec le salon.

#### 39.3.7 « En train d'écrire » : toujours actif (décision du propriétaire, 7 novembre)

- **Décision du propriétaire** : l'indicateur est **activé pour tous et ne peut pas être désactivé**. **Signalement (gravité moyenne)** : c'est le contraire de la recommandation précédente (désactivé par défaut) ; appliqué, avec la fuite écrite ci-dessous, sur la page Sécurité et dans la page d'explication (§39.4, point 3).
- **Quantification grossière** : l'état « écrit » ne part qu'aux **tops d'une grille fixe de 2,5 s** (multiples de 2 500 ms depuis l'entrée dans le salon, horloge monotone) : au premier top qui suit une frappe, puis à chaque top tant qu'une frappe a eu lieu depuis le top précédent ; aucune trame d'arrêt (l'indicateur s'éteint chez les autres 6 s après la dernière trame `ecrit` reçue). Un message envoyé part tout de suite (le retarder au top suivant ralentirait la conversation ; Q-SAL9).
- **Même canal, même taille** : une trame `ecrit` est une trame de type 1 ordinaire (4 140 octets, chiffrée par la chaîne de l'expéditeur, signée) : le serveur ne la distingue pas d'un message.
- **Fuite, dite honnêtement** : le serveur voit **quand** chaque siège envoie une trame. Avec l'indicateur toujours actif, une suite de trames espacées de 2,5 s puis une trame isolée révèle qu'une personne écrit, depuis combien de temps (à 2,5 s près) et quand elle a envoyé, donc la longueur approximative de la saisie et le rythme de chaque participant. La quantification retire la cadence de frappe fine (pas de trame par touche), pas le fait d'écrire. Seul un trafic de couverture constant (une trame toutes les 2,5 s pour chaque présent, qu'il écrive ou non) l'effacerait : environ 1,6 Kio/s par présent et 4 140 octets du budget toutes les 2,5 s (près de 600 Mio sur 24 h pour 10 personnes), **non retenu** (Q-SAL9). Texte de la page d'explication : « Les autres voient quand vous écrivez. Le serveur ne lit rien, mais il voit quand vous êtes actif. »
- **Accusés de lecture** : désactivés par défaut, réglage par personne, trame `lu` au plus toutes les 10 s, seulement si les deux côtés l'ont activé.

#### 39.3.8 Ce que voit le serveur (complète le tableau de §36)

| # | Ce qu'il voit ou peut déduire | Exposition | Réduction | État |
|---|---|---|---|---|
| S31 | Existence d'un salon, échéance, plafond, droit de destruction des membres | `salons`, au quart d'heure | durée non stockée | À faire C-2 |
| S32 | Arrivées et départs, nombre de présents | en direct et en mémoire (sièges) | rien sur disque | Assumé (nécessaire au plafond) |
| S33 | **Qui parle avec qui** : les adresses IP des membres d'un même salon | en direct seulement | jamais sur disque ni journal ; Tor plus tard (§3) | **Impossible** sans Tor ; limite §18.20 |
| S34 | Nombre et heure des trames par siège ; **qui est en train d'écrire et depuis combien de temps** (indicateur toujours actif, décision du propriétaire) | en direct, file de 15 min | taille unique, type caché, état « écrit » quantifié sur une grille de 2,5 s ; pas de trafic de couverture (Q-SAL9) | Assumé, dit (§39.3.7) |
| S35 | Taille des messages | aucune : 4 140 octets toujours | — | Fait par conception |
| S36 | Type de trame (texte, réaction, « écrit », clé, annonce) | aucune : chiffré sous `K_trame` | — | Fait par conception |
| S37 | Pièces jointes : nombre, palier, heure d'envoi et de lecture, qui télécharge | base (palier) et en direct | aperçu automatique des images et vocaux ≤ 16 Mio chez tous (une lecture ne distingue plus qui a regardé) ; taille à 4 Mio près pendant l'envoi (§18.12) | À faire C-2, C-5 |
| S38 | Pseudonymes, couleurs, réactions, réponses, réglages | aucune : dans le chiffré | — | Fait par conception |
| S39 | Budget utilisé | pièces : base ; trames : mémoire | — | Assumé |
| S40 | Mots de passe faux | `failed_attempts` | nécessaire (§2) | Assumé |
| S41 | Créateur | `manage_v` ; en direct, la connexion qui crée | aucun lien avec un compte (§37.4) | Assumé |
| S42 | Retrait d'un message | qu'un siège a retiré l'une de ses trames, laquelle (`seq`) | — | Assumé |
| S43 | En-têtes, User-Agent | retirés par Caddy (§36 S2) ; `X-Shh-Membre`, `X-Shh-Depuis`, `X-Shh-Piece` ajoutés à la liste blanche | — | À faire C-2 |

#### 39.3.9 Routes (toutes sous `/api/salons/`, JSON strict de §8 sauf trames et segments)

Longueurs exactes en base64url : secrets et jetons 43 caractères, identifiants de pièce 22. Erreurs : `not_found` (salon inconnu, expiré, détruit, mauvaise `K_accès_s` : même corps), `bad_password` (avec `tries_left`), `full`, `budget` (salon plein), `limit`, `busy`, `bad_request`.

| Route | Authentification | Corps | Réponse |
|---|---|---|---|
| `POST /api/salons` | preuve anti-robot ; `X-Shh-Access`, `X-Shh-Manage` | `{ ttl_hours ∈ {1,6,12,24}, max_members ∈ 2..10, members_can_destroy, salt, kdf_ops, kdf_mem, proof_v, captcha… }` | `{ expires_in_s }` ; `access_v` ou `manage_v` déjà vus → 400 comme §29.8 |
| `GET /api/salons/meta` | `X-Shh-Access` | — | `{ expires_in_s, salt, kdf_ops, kdf_mem }` |
| `POST /api/salons/rejoindre` | `X-Shh-Access` | `{ proof }` | §39.3.3 |
| `GET /api/salons/flux` | `X-Shh-Membre`, `X-Shh-Depuis` | — | flux binaire (§39.3.1), `Content-Type: application/octet-stream` |
| `POST /api/salons/trame` | `X-Shh-Membre` | 4 140 octets exactement | `{ seq }` ; `budget` si le salon est plein |
| `POST /api/salons/retirer` | `X-Shh-Membre` | `{ seq }` | `{}` (trame absente ou d'un autre siège : `{}` aussi) |
| `POST /api/salons/quitter` | `X-Shh-Membre` | `{}` | `{}` (envoyé en `keepalive` à `pagehide`) |
| `POST /api/salons/detruire` | `X-Shh-Manage`, ou `X-Shh-Membre` si `members_can_destroy` | `{ reason?: "report" }` | `{}` |
| `GET /api/salons/gestion` | `X-Shh-Manage` | — | `{ expires_in_s, present }` (historique local, §33) |
| `POST /api/salons/pieces` | `X-Shh-Membre` | `{ bucket }` (paliers de §29.3 jusqu'à 8 000) | `{ piece, upload_token }` ; `budget` si la place manque |
| `PUT /api/salons/pieces/segments/{n}` | jeton d'envoi de pièce | segment exact (§7.4) | `{}` |
| `POST /api/salons/pieces/finalize` | jeton d'envoi de pièce | `{ fill_from, fill_to }` | `{}` |
| `GET /api/salons/pieces/segments/{n}` | `X-Shh-Membre`, `X-Shh-Piece` | — | segment, en flux |
| `POST /api/salons/pieces/retirer` | `X-Shh-Membre`, `X-Shh-Piece` (auteur seulement) | `{}` | `{}` |

### 39.4 Entrée dans le salon

1. **Ouverture du lien** `#c…` : clé lue puis retirée de la barre (§5.3), `meta` (secondes restantes, `sel`, KDF ; rien sur les présents). Écran : « On vous invite dans un salon de discussion chiffré. Il s'efface dans {durée}. » ; mot de passe ; avertissement du navigateur intégré (§5.2) ; conseil facultatif « navigation privée » (registre).
2. **Mot de passe** → `rejoindre` → siège et jeton (complet : écran « Ce salon est complet », sans autre détail).
3. **Page d'explication et pseudonyme** (demande du propriétaire : après le mot de passe, avant le salon). **Signalement** : le brief du coordinateur plaçait l'explication **avant** le mot de passe ; la demande du propriétaire la place **après**. Retenu : une ligne avant (étape 1), la page complète après, avec le pseudonyme. Textes :
   - titre « Un salon qui s'efface » ;
   - « Chiffré sur chaque appareil. Le serveur ne fait que transmettre des messages qu'il ne peut pas lire. »
   - « Rien n'est gardé : les messages ne sont jamais écrits sur le disque du serveur, et tout s'efface au plus tard dans {durée}, ou plus tôt si le salon est détruit. »
   - « Vous ne verrez pas les messages envoyés avant votre arrivée. »
   - « Une capture d'écran, ou une photo de l'écran, reste toujours possible : n'écrivez que ce que vous accepteriez de voir copié. »
   - « Shhdrop ne vérifie l'identité de personne : un pseudonyme n'est qu'un nom choisi. »
   - « Les autres voient quand vous écrivez. Le serveur ne lit rien, mais il voit quand vous êtes actif. »
   - champ **Pseudonyme pour ce salon** (obligatoire), bouton « Entrer dans le salon ».
4. **Pseudonyme** : NFC ; on retire contrôles, caractères d'inversion de sens, caractères ignorables par défaut ; espaces regroupés et rognés ; **2 à 24 graphèmes** (`Intl.Segmenter`) ; seulement lettres, marques, chiffres, espace et `- _ . '` ; **une seule écriture** (latin, cyrillique, grec… plus les caractères communs : « Аlice » en cyrillique mêlé est refusé) ; pas d'émoji. **Unique dans le salon** : comparaison sur NFKC en minuscules sans espaces ni ponctuation ; les pseudonymes des présents (reçus dans leurs annonces) sont vérifiés pendant la saisie (« Déjà pris dans ce salon ») ; en cas de course, la première annonce dans l'ordre du serveur gagne et l'autre personne est renvoyée au champ. **Jamais envoyé en clair** : seulement dans les annonces chiffrées.
5. **Couleur** : palette fixe de 10, attribuée au plus petit indice libre parmi les présents, portée par l'annonce (course : ordre du serveur). Chaque couleur a un contraste ≥ 6,7:1 sur `--surface-3` (#202533), donc ≥ 4,5:1 sur tous les fonds du salon : menthe #5FE3B5, ciel #7CC4FF, lavande #B79CFF, rose #FF8FC7, corail #FF9A7A, ambre #F2C46D, citron #D8E86A, turquoise #4FD8E0, lilas #E0A8F0, sable #D9C3A0. La couleur n'est jamais seule : le pseudonyme est toujours écrit à côté (WCAG 1.4.1).
6. **Salon**. Le créateur passe par les étapes 3 à 6 depuis « Salon prêt » (« Entrer dans le salon »), sans retaper le mot de passe.

### 39.5 Fonctions du salon

- **Texte** : 2 000 graphèmes et 3 500 octets UTF-8 au plus ; au-delà, proposé en pièce jointe `.txt` (« Texte long : envoyer comme fichier ? »). Liens `https?://` cliquables, adresse affichée en entier, `rel="noopener noreferrer"`, `referrerpolicy="no-referrer"` ; **aucun aperçu de lien** (il appellerait le site et révélerait la conversation) ; aucun autre schéma rendu cliquable ; aucun Markdown.
- **Émojis** : rendus par la police du système ; **aucune image d'émoji téléchargée**. Sélecteur : liste générée une fois depuis `emoji-test.txt` d'Unicode (version d'émoji 15.0, licence Unicode v3, fichier source commité avec son empreinte), émojis pleinement qualifiés, 9 catégories Unicode, ton de peau appliqué par modificateur, « récents » en mémoire de la page seulement ; pas de recherche par mot en V1 (Q-SAL6). Réactions : un émoji de cette liste exactement, rien d'autre.
- **Pièces jointes** : tout type, nombre illimité, dans le budget ; sélecteur de fichiers, glisser-déposer et coller (Task 11), photo et vidéo par `<input capture>` ; détection du type, nettoyage, avertissements et visionneuses du composeur et du contenu (Tasks 9a–9c, 10, 21–23). Images et vocaux ≤ 16 Mio téléchargés et affichés d'office ; le reste au clic, avec « Enregistrer ».
- **Vocal** : enregistreur de la Task 12 (explication avant la demande du micro, pause, nettoyage) ; 10 min au plus par message ; envoyé comme pièce `vocal` avec sa durée ; lu par `<audio controls>`.
- **Réponse et citation** : `reponse` porte l'`id` du message cité et un extrait de 140 graphèmes au plus ; si l'original est retiré, les extraits qui le citent sont vidés chez tous.
- **Retirer pour tous** (ses propres messages seulement, signé) : le message devient « Message retiré » chez tous, sa trame quitte la file du serveur, sa pièce jointe est effacée du disque. Texte : « Retiré pour tout le monde. Ceux qui l'ont déjà lu ont pu le copier. »
- **Effacer après lecture** (par message : texte, image, vocal) : chez le destinataire, « Message à lecture unique · Afficher » ; affiché 30 s avec un compte à rebours, puis retiré de la page et de la mémoire (URL blob révoquées) ; chez l'expéditeur, le contenu est remplacé par « Message à lecture unique envoyé » dès l'envoi. Mention : « Une capture reste possible. »
- **Arrivées et départs** (demande du propriétaire) : une ligne système dans le fil, « Léa a rejoint le salon » et « Léa a quitté le salon ». Elle est **construite dans chaque navigateur** à partir de l'annonce chiffrée (§39.2.2) et d'une trame de contrôle « départ » chiffrée et signée (ou, si la page a disparu sans l'envoyer, de l'enregistrement 0x03 du serveur, qui ne porte que le numéro de siège) : le pseudonyme ne passe jamais en clair, seuls les participants le voient. Liste des participants avec leur couleur, la sienne marquée « vous ».
- **En-tête** (demande du propriétaire) : « **3 en ligne · 2 places libres** » (places libres = `max_members` − sièges occupés ; salon ouvert : 10 − sièges occupés) et la validité restante en compte à rebours vivant, « s'efface dans 4 h 12 min » (`Countdown`, à la seconde sous 5 min, annonce discrète pour les lecteurs d'écran) ; jauge « 312 Mo sur 1 Go » dans le panneau des participants. « En ligne » = siège dont le flux est ouvert (enregistrement 0x07) ; un siège gardé pendant une coupure compte dans les places prises, pas dans « en ligne ».
- **Détruire le salon** (créateur, ou tous si permis) : `InlineConfirm` « Détruire pour tout le monde ? » ; tous voient l'écran de fin avec la dissolution (Task 24).
- **Signaler** : feuille qui explique : (1) « Quitter et signaler » compte le signalement (entier horaire de §9.5) et fait sortir ; si la personne peut détruire, « Détruire et signaler » ; (2) pour un contenu illicite : écrire à l'adresse de contact avec le lien du salon ; « Si vous donnez aussi le mot de passe, l'équipe pourra lire ce qui y passe tant que le salon vit. » L'administrateur détruit par `admin destroy -`.
- **Exclus en V1** : modification d'un message ; aperçus de liens ; accusés de lecture par défaut ; notifications (elles exigeraient un service tiers et un service worker) ; historique pour les nouveaux venus (Q-SAL2) ; exclusion d'un participant (Q-SAL5) ; titre du salon.
- **Onglet en arrière-plan** : le titre devient « (3) Shhdrop » (un nombre, aucun contenu) ; aucun son par défaut. Sur téléphone, quitter l'application coupe souvent le flux : au retour, reconnexion et notice de trou si besoin.

### 39.6 Écrans

- **Accueil** : un bloc à part, sous le réceptacle d'envoi, de style distinct (contour et icône `messages-square`, couleur ciel), titre « Discuter en privé », phrase « Un salon chiffré qui s'efface, jusqu'à 10 personnes. », bouton **« Créer un salon de discussion »**. Il remplace l'entrée « Conversation (bientôt) » du composeur (choix validé modifié, signalé : la demande veut le salon hors du parcours d'envoi).
- **Création** (`/salon/nouveau`) : durée (segments 1 h, 6 h, 12 h, 24 h ; 24 h par défaut), participants (« Ouvert (10 au plus) » ou 2 à 10, pas à pas), mot de passe (champ du composeur avec Générer et Copier), bascule « Les participants peuvent détruire le salon », bouton « Créer le salon ». Mobile : feuille d'options comme le composeur.
- **Salon prêt** : écran « Lien prêt » (Task 18) en variante salon : lien (Copier, Partager, QR), mot de passe (Copier) avec le rappel « par un autre moyen », « Vider le presse-papier », « Garder dans mon historique » (garde `S_gestion` pour détruire depuis `/envois`), bouton principal « Entrer dans le salon ». Pas de lien de gestion affiché.
- **Salon** (`/salon`, aucun secret dans l'adresse), style Nuit chiffrée :
  - ordinateur : colonne de messages centrée (720 px au plus), panneau des participants à droite au-delà de 1 100 px, sinon dans une feuille ;
  - téléphone : en-tête compact, liste plein écran, barre de saisie collée au-dessus du clavier (`visualViewport`, `dvh`, zones sûres), boutons de 44 px ;
  - bulles : les siennes à droite sur `--surface-2`, celles des autres à gauche sur `--surface-1` avec le pseudonyme et un filet de 3 px de leur couleur ; heure à la minute ; menu par message (Répondre, Réagir, Retirer, Enregistrer) ;
  - barre de saisie : zone de texte (Entrée envoie sur ordinateur, Maj+Entrée va à la ligne ; sur téléphone, bouton Envoyer), émojis, joindre, vocal, « Lecture unique ».
- **Accessibilité** : liste en `role="log"` (annonce polie des nouveaux messages : « Alice : … » ; regroupées au-delà de 3 en 2 s : « 5 nouveaux messages ») ; tout au clavier (flèches entre messages, `Échap` ferme le sélecteur et les menus, focus rendu au champ) ; mouvement réduit : aucune entrée animée, « Alice écrit… » en texte fixe ; `forced-colors` : filets de couleur remplacés par le pseudonyme souligné ; textes agrandis à 200 % sans débordement.

### 39.7 Cadre légal et abus (à faire valider par un juriste avant l'ouverture au public)

| Gravité | Sujet | Problème | Proposition |
|---|---|---|---|
| Élevée | Statut | Un salon est un **service de communications interpersonnelles non fondé sur la numérotation** (code européen des communications électroniques, transposé dans le CPCE) : statut d'opérateur, éventuelles obligations de déclaration auprès de l'ARCEP, secret des correspondances (CPCE L32-3), réquisitions | **Juriste** avant `SHH_SALONS=1` en public |
| Élevée | Conservation des données de trafic (CPCE L34-1, décret 2021-1362, LCEN art. 6) | Les opérateurs et hébergeurs peuvent devoir conserver des données de connexion : **conflit direct** avec « aucune adresse IP enregistrée » (§17) | **Juriste** ; tant que ce n'est pas tranché, salon réservé à l'usage personnel du propriétaire |
| Élevée | DSA | Les pièces jointes stockées font de Shhdrop un **hébergeur** pour elles : point de contact (art. 11 et 12), notification et action (art. 16), motivation des décisions (art. 17) ; les échanges privés eux-mêmes sont hors des règles des plateformes | point de contact, formulaire de signalement, procédure de destruction écrite (§15.3), délais de traitement |
| Élevée | Contenus pédocriminels | Signalement aux autorités (PHAROS) quand l'équipe en a connaissance ; le projet de règlement européen « CSAM » pourrait imposer une détection incompatible avec le chiffrement de bout en bout | procédure écrite ; suivre le texte ; ne jamais promettre ce que la loi pourrait interdire |
| Moyenne | Cryptologie | La déclaration ANSSI (§17) doit couvrir la messagerie | à compléter |
| Moyenne | Mineurs, harcèlement | Un salon ouvert à quiconque a le lien et le mot de passe | « Signaler », destruction, durée de 24 h au plus, plafond de 10 ; CGU : usage interdit aux fins illicites |
| Faible | CGU et Confidentialité | Nouveaux traitements (sièges en mémoire, pièces jointes) | pages à compléter (Task C-6) |

### 39.8 Tests

- **« Le serveur ne voit rien » étendu aux salons** (bloquant, comme §14) : trois clients ; repères dans le pseudonyme, le texte, un nom de fichier, le contenu d'un fichier, un vocal, un émoji de réaction, le mot de passe, `K_lien`, `K_trame`, `CK_0`, un `IK` secret ; IP, User-Agent et Referer repères (§36). Exige : aucun repère dans `shares.db`, son WAL, `blobs/`, stdout, stderr, ni dans une réponse ; chaque corps de `POST /api/salons/trame` fait exactement 4 140 octets ; aucun en-tête de requête ne porte un pseudonyme ; `salons` ne contient que les colonnes de §39.3.5 ; après destruction et arrêt, ni ligne ni pièce ; fouille de la mémoire du processus : aucun repère de contenu ni de clé.
- **Fuzz** : décodeur des trames, des enregistrements du flux et du JSON `M` en TypeScript (10 000 entrées mutées à graine fixe, aucune exception hors des erreurs typées, rien d'affiché) ; côté Go, `FuzzTrame` et `FuzzFlux` (`go test -fuzz`, corpus commité).
- **Vecteurs** : HKDF des étiquettes du salon, chaîne HMAC, XChaCha20-Poly1305 (vecteur de la note IETF draft-irtf-cfrg-xchacha, annexe A.3.1), Ed25519 (RFC 8032, test 1), recalculés par un script Node indépendant pour HKDF et HMAC (`node:crypto`).
- **Playwright à plusieurs clients** : trois contextes de navigateur (créateur, deux invités) sur un vrai serveur ; parcours de §39.4 ; plafond 2 → troisième « complet » ; textes, émojis, réponse, réaction, retrait, lecture unique, « écrit » visible sans réglage et trames `ecrit` alignées sur la grille de 2,5 s, lignes « a rejoint » et « a quitté », en-tête « en ligne · places libres », fichier de 5 Mio, vocal (faux micro), départ (le partant ne déchiffre plus : contrôle dans la page), coupure réseau de 30 s puis rattrapage, destruction → tous à l'écran de fin ; `axe` ; captures ordinateur et téléphone.

### 39.9 Lentilles « sharp edges » et « insecure defaults »

| # | Gravité | Endroit | Problème | Correction (intégrée) |
|---|---|---|---|---|
| CH1 | Élevée | distribution des clés | sceller à une `RK` non vérifiée laisserait un membre glisser une fausse clé au nom d'un autre | `RK` acceptée seulement dans une annonce signée par l'`IK` du membre, liée au `nonce_arrivée` de son siège |
| CH2 | Élevée | départ | un partant garde `CK_i` et dériverait les messages suivants | nouvelle époque de chaque expéditeur à chaque départ, avant tout nouveau message |
| CH3 | Élevée | trame de message | déchiffrer avant de vérifier la signature exposerait le décodeur à des trames forgées par un membre | signature vérifiée d'abord ; trame d'un `IK` non annoncé jetée |
| CH4 | Moyenne | indicateur « écrit » | toujours actif (décision du propriétaire) : il fuit l'activité au serveur | grille de 2,5 s, même trame que les messages, texte honnête ; trafic de couverture en option (Q-SAL9) |
| CH5 | Moyenne | pseudonymes | homoglyphes, inversion de sens | une seule écriture, nettoyage de §39.4, unicité NFKC |
| CH6 | Moyenne | réactions et textes | `{@html}` ou émoji arbitraire | nœuds texte ; réaction limitée à la liste |
| CH7 | Moyenne | jeton de membre | dans l'URL du flux | en-tête seulement (d'où `fetch` et non `EventSource`) |
| CH8 | Faible | file du serveur | mémoire sans borne | 200 trames, 15 min, `SHH_SALONS_MAX` |

### 39.10 Limites assumées

Ajoutées à §18, points 20 (qui parle avec qui), 21 (membres) et 22 (coupures).

### 39.11 Offres payantes (§38.8)

Salons plus longs, plus grands et plus remplis pour Plus et Pro (§38.8) ; même chiffrement, même code. Recommandation maintenue : **pas de salon payant avant l'avis du juriste** (§39.7), un salon long attirant d'autres usages. Au-delà de 12 destinataires, la distribution des clés s'étale sur plusieurs trames (§39.2.2) ; la file reste de 200 trames.

### 39.12 Questions ouvertes (défaut recommandé)

| # | Question | Défaut recommandé |
|---|---|---|
| Q-SAL1 | Un fichier unique de 1 Go dans un salon (budget porté à 1 074 069 568 + trames) | Non : 1 Go au total, 500 Mo par fichier |
| Q-SAL2 | Historique visible des nouveaux venus | Non (confidentialité persistante, plus simple) |
| Q-SAL3 | Mots de passe faux avant destruction | 10 (jusqu'à 10 personnes peuvent se tromper) ; risque : qui a le lien seul peut détruire le salon en 10 essais |
| Q-SAL4 | Destruction par tout participant | Désactivée par défaut, au choix du créateur |
| Q-SAL5 | Exclure un participant | Non en V1 (détruire le salon et en recréer un) |
| Q-SAL6 | Recherche d'émoji par mot | Non en V1 (données CLDR lourdes, chargement hors SRI à éviter) |
| Q-SAL7 | MLS au lieu des clés d'expéditeur | Non en V1 ; exception à CLAUDE.md nécessaire |
| Q-SAL8 | Salon public tant que le juriste n'a pas répondu | Non : `SHH_SALONS=1` pour l'usage personnel seulement |
| Q-SAL9 | « En train d'écrire » toujours actif (décision) : ajouter un trafic de couverture qui efface la fuite, ou retarder les messages au top de 2,5 s | Non aux deux (coût en budget et en réactivité) ; fuite dite ; à revoir si le propriétaire préfère la confidentialité au coût |
| Q-SAL10 | Pièces jointes en direct dans le salon (§40.6) | Seulement si tous les destinataires sont en ligne et qu'ils sont 4 au plus ; sinon stockées |

---

## 40. Décision du propriétaire (v2.8, 7 novembre) — envoi direct (pair à pair)

Question du propriétaire : « Les fichiers pourraient-ils ne jamais passer par nos serveurs ? Le navigateur ou le téléphone de l'expéditeur sert le fichier directement aux destinataires, comme un torrent, pour plus de confidentialité et un serveur plus petit. » Réponse : oui, en **option**, par WebRTC ; le mode par défaut reste le partage stocké et asynchrone. Réalisé après le salon (Tasks D-1 et D-2), désactivé par défaut (`SHH_DIRECT=0`).

### 40.1 Ce que l'envoi direct change, honnêtement

| Il apporte | Il coûte |
|---|---|
| Le fichier **n'est jamais écrit sur notre disque**, même chiffré : rien à voler, à réquisitionner ni à effacer après coup | **L'expéditeur doit rester en ligne, onglet ouvert**, pendant chaque ouverture ; sinon le destinataire attend |
| Aucune place réservée : un très gros fichier ne remplit pas le serveur | **Les adresses IP** : en connexion directe, chaque pair voit l'adresse de l'autre (candidats ICE) ; seul le **relais TURN forcé** les cache l'un à l'autre (et c'est alors notre relais qui voit les deux, comme le serveur aujourd'hui) |
| En connexion directe, aucun octet ne traverse nos machines | **Traversée des NAT** : sans relais, elle échoue sur une partie des réseaux (NAT symétriques, réseaux d'entreprise, certains réseaux mobiles) |
| Le relais ne stocke rien : il transmet des octets déjà chiffrés deux fois (paquet SHH2, puis DTLS) | **Téléphones** : un onglet mis en arrière-plan est suspendu (iOS en particulier) ; le transfert s'arrête. Verrou d'écran (`navigator.wakeLock`) demandé pendant l'envoi, et texte « Gardez cette page ouverte jusqu'à la fin » |
| | **Relais et bande passante** : avec TURN, tout passe deux fois par notre machine (entrée et sortie) ; on économise le disque, **pas** la bande passante (§40.5) |

### 40.2 Recommandation : mode hybride

- **Par défaut** : partage stocké, asynchrone, inchangé (§29).
- **Option « Envoi direct »** dans les options de l'envoi : conseillée pour les très gros fichiers ou quand rien ne doit être stocké, même chiffré. Mêmes règles : mot de passe, durée (la plage où l'expéditeur promet d'être en ligne, 1 à 24 h), ouvertures, droits, destruction.
- **Salon** : une pièce jointe part en direct si **tous** les destinataires présents sont en ligne et qu'ils sont **4 au plus** (au-delà, l'expéditeur enverrait N fois le fichier depuis son téléphone) ; sinon elle est stockée (§39.3.4). Q-SAL10.
- **Politique ICE** : `iceTransportPolicy: "relay"` **par défaut** (adresses cachées entre pairs). Option « Connexion directe (plus rapide) » : l'expéditeur l'autorise, et chaque destinataire l'accepte à son tour (« L'expéditeur verra votre adresse IP, et vous la sienne ») ; seulement si les deux côtés l'ont acceptée, `iceTransportPolicy: "all"`. Serveurs STUN et TURN : **les nôtres seulement** (aucun serveur STUN de Google ni d'un tiers, §10).

### 40.3 Clés et paquet (aucune construction nouvelle)

- Le fichier est le **même paquet SHH2** (§29.3) sous la même graine `R`, enveloppée par `E` comme un partage stocké ; le destinataire l'obtient par `unlock` (mot de passe, 5 essais, ouvertures comptées par le serveur). Le paquet circule par segments de 4 Mio sur un `RTCDataChannel` (ordonné, fiable), au-dessus de DTLS ; le lecteur du destinataire est celui des partages (`openStream`), dont la source de segments devient le canal.
- **Bourrage** : l'expéditeur envoie aussi les segments de bourrage, tirés par `crypto.getRandomValues` ; le relais ne voit que la taille du palier.
- **Signalisation chiffrée de bout en bout** : offres et réponses SDP et candidats ICE sont chiffrés en AES-256-GCM (WebCrypto) sous `K_sig` = HKDF(`K_maître`, « shhdrop/v2/direct/signal »), données authentifiées « SHD1 » ‖ `id` (§29.2) ‖ numéro d'ouverture ‖ sens ; chaque message bourré à **8 Kio** exactement. Comme `K_maître` exige le lien **et** le mot de passe, le serveur ne peut ni lire les SDP ni **remplacer l'empreinte DTLS** qu'ils portent : il ne peut pas s'interposer dans la connexion (attaque de l'homme du milieu fermée par la signalisation authentifiée).
- Le serveur ne reçoit jamais le paquet : pas de fichier dans `blobs/`, pas de réservation.

### 40.4 Serveur : signalisation et relais

- **Partage direct** : `POST /api/shares` avec `mode: "direct"` (aucune réservation, `bucket` gardé pour l'affichage du palier) ; `finalize` sans segment. Colonne `mode` dans `shares`. **Présence de l'expéditeur** : sa page ouvre `GET /api/direct/flux` avec `X-Shh-Manage` ; tant que ce flux n'est pas ouvert, `unlock` répond `sender_offline` **sans consommer d'ouverture** ni compter d'essai, et l'écran dit « L'expéditeur n'est pas connecté pour l'instant. Le lien reste valable jusqu'au {date} ; réessayez plus tard. »
- **Boîtes aux lettres en mémoire** : `POST /api/direct/signal` (8 220 octets exactement : nonce 12 ‖ 8 192 octets chiffrés ‖ étiquette 16, jeton de téléchargement côté destinataire ou `X-Shh-Manage` côté expéditeur) ; relais en mémoire seulement, 32 messages par ouverture, oubliés à la fin de l'ouverture ou après 10 min ; jamais sur disque.
- **Identifiants TURN** à durée courte : `POST /api/direct/turn` (jeton de téléchargement, `X-Shh-Manage` ou jeton de membre de salon) → `{ urls: ["turn:turn.shhdrop.app:3478?transport=udp", "turns:turn.shhdrop.app:5349?transport=tcp"], username, credential, ttl: 600 }` ; `username` = échéance ‖ 16 octets aléatoires, `credential` = HMAC-SHA-256(secret TURN partagé, `username`) ; le serveur TURN vérifie de son côté (mécanisme « identifiants longue durée » de TURN, RFC 8489 et RFC 8656, porté par la bibliothèque : il protège l'usage du relais, pas le contenu).
- **Serveur TURN** : `github.com/pion/turn/v4` (**licence MIT**), série v4, version exacte épinglée à la Task D-1 (dernière stable publiée depuis au moins 7 jours, §24 ; à vérifier sur pkg.go.dev), dans un binaire séparé `shhdrop-turn`, **de préférence sur une machine séparée** (bande passante UDP, ports 3478 et 5349, plage de relais 49 152–65 535). Il ne journalise rien (journal vers `io.Discard`), ne garde aucune adresse sur disque, refuse les relais vers des adresses privées, de boucle locale ou de lien local (pas de rebond vers notre réseau interne). Le navigateur n'a pas besoin de bibliothèque : WebRTC est natif (`RTCPeerConnection`).
- **Limites** (§9.5, mémoire) : identifiants TURN 30 par heure par connexion ; octets relayés par jour par connexion : 5 Go (gratuit), 2 Go par transfert ; formules payantes : §38.8 ; 3 ouvertures servies à la fois par expéditeur ; une allocation TURN dure 10 min sans trafic au plus.
- `Permissions-Policy` inchangée ; la CSP ne régit pas WebRTC (`connect-src` ne s'y applique pas) : le test « aucune ressource tierce » vérifie que les seuls serveurs ICE configurés sont les nôtres.

### 40.5 Bande passante : relais contre stockage

| Mode | Entrée chez nous | Sortie de chez nous | Disque |
|---|---|---|---|
| Stocké (défaut) | 1 × le palier | 1 × le palier par ouverture (2 × au pire, §24) | le palier, pendant toute la durée |
| Direct par relais TURN | 1 × le palier par ouverture | 1 × le palier par ouverture | **rien** |
| Direct sans relais | rien | rien | **rien** |

Exemple : 1 Gio ouvert 3 fois. Stocké : environ 1 Go entrant, 3 Go sortants, 1 Go de disque pendant 24 h (0,033 To-mois, environ 0,10 à 0,25 €). Relais : 3 Go entrants, 3 Go sortants, aucun disque. Le relais **coûte autant de sortie, plus d'entrée** (souvent gratuite) et économise un disque peu cher : l'envoi direct sert la confidentialité, pas l'économie. Seule la connexion sans relais allège vraiment le serveur, au prix des adresses visibles.

### 40.6 Salon

- Signalisation par trames de contrôle du salon (type 2, sous `K_trame`, signées par `IK`, §39.2.3), sans route de plus ; identifiants TURN par le jeton de membre ; même politique ICE (relais par défaut ; « direct » seulement si tous les participants concernés l'acceptent dans leurs réglages).
- Le message `piece` porte alors `direct: true` et pas d'identifiant de pièce ; si un destinataire n'a pas reçu le fichier au bout de 30 s, l'expéditeur bascule sur l'envoi stocké pour lui (la pièce compte alors dans le budget).

### 40.7 Ce que voit le serveur (complète §36)

| # | Ce qu'il voit ou peut déduire | État |
|---|---|---|
| S44 | Qu'un partage est direct (`mode`), sans fichier ; que l'expéditeur est en ligne (flux ouvert) et quand | Assumé |
| S45 | Signalisation : nombre et heure des messages, 8 Kio chacun, contenu chiffré | Fait par conception |
| S46 | Relais TURN : les **deux adresses**, la durée, le volume relayé (au palier près grâce au bourrage) | Assumé (comme le serveur aujourd'hui) ; jamais sur disque |
| S47 | Connexion directe acceptée : rien du transfert ; les pairs voient leurs adresses | Choix des deux personnes |

### 40.8 Tests

- e2e Chromium à deux contextes, serveur TURN de test (pion, dans le banc) : relais forcé → la paire de candidats choisie est `relay` des deux côtés (`getStats`) ; aucun candidat `host` ni `srflx` dans les SDP avant chiffrement (crochet de test) ; « connexion directe » acceptée d'un seul côté → toujours `relay` ; fichier de 50 Mio reçu identique (SHA-256) ; `blobs/` vide du début à la fin ; expéditeur hors ligne → `sender_offline`, ouvertures inchangées ; onglet de l'expéditeur fermé pendant le transfert → erreur claire chez le destinataire, fichier partiel abandonné (`writable.abort()`, §7.3).
- « Le serveur ne voit rien » : repères de contenu, de nom, de mot de passe et de `K_lien`, plus une empreinte DTLS repère : absents des corps reçus par le serveur, de la mémoire exportée, du disque ; aucun SDP en clair.
- Go : `turn_test.go` (identifiants expirés refusés, relais vers `10.0.0.0/8`, `127.0.0.1`, `169.254.0.0/16`, `fc00::/7` refusé, aucune sortie de journal), `FuzzSignal`.

### 40.9 Questions ouvertes (défaut recommandé)

| # | Question | Défaut recommandé |
|---|---|---|
| Q-D1 | Relais TURN forcé par défaut | Oui ; « connexion directe » sur accord des deux côtés |
| Q-D2 | Machine TURN séparée | Oui dès la machine moyenne (§38.8.3) ; sur la petite, même machine, autre binaire |
| Q-D3 | Envoi direct en V1 publique | Après le salon et l'avis du juriste (statut d'opérateur, §39.7) |
