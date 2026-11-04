# Shhdrop — spécification V1 (version 2, finale à valider)

Date : 4 novembre 2026 · Domaine visé : **shhdrop.app**
Historique : v1 du 3 novembre, puis revue critique indépendante et passage complet de recherche d'oublis (voir section 0).

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
- **Date de création** réellement indevinable (arrondi, dates de fichier effacées).
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
| Taille par partage | 100 Mio maximum, chiffrement et bourrage compris |
| Durée de vie | au choix 1 h, 6 h, 12 h, 24 h ; comptée **à partir de la fin de l'envoi** ; expiration arrondie au **quart d'heure supérieur** |
| Ouvertures | au choix 1 à 10 ; **une ouverture = un déverrouillage réussi** (recharger la page en consomme une, c'est affiché) |
| Fin de vie | le premier atteint : durée, ouvertures épuisées, destruction (expéditeur, destinataire, administrateur), signalement, 5 mots de passe faux |
| Mot de passe | obligatoire ; généré par défaut : **4 mots** tirés d'une liste de 7 776 mots (≈ 52 bits) ; personnalisé : 12 caractères minimum et absent d'une liste noire des mots de passe courants (contrôle côté navigateur : le serveur ne peut pas le vérifier) |
| Essais de mot de passe | 5 ratés → destruction |
| Création de partages | 10 par jour par connexion (IPv4, ou bloc IPv6 /64) ; 30 par jour par bloc /48 ; 300 Mio par jour par connexion |
| Limite de débit | 60 requêtes par minute par connexion sur les routes publiques |
| Stockage total | plafond configurable (20 Gio par défaut), **réservé à la création** ; au-delà, nouveaux envois refusés |

---

## 5. Parcours

### 5.1 Expéditeur

1. **Composer** : fichiers, photo, vocal, texte ; aperçu, ✕ pour retirer, jauge « 34 / 100 Mo · 3 / 10 ».
   - Métadonnées des photos retirées (section 12) ; avertissement pour vidéos et PDF, non nettoyés.
2. **Options** : durée, nombre d'ouvertures, mot de passe (généré, régénérable, modifiable, indicateur de force).
3. **Envoi** : chiffrement puis envoi par segments, progression, reprise automatique si le réseau coupe. La reprise ne fonctionne **que dans le même onglet** : fermer l'onglet abandonne l'envoi, qui compte quand même dans la limite du jour et est effacé au bout d'1 h.
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
| `K_contenu` | HKDF(`K_maître`, « contenu ») | navigateur |
| `K_preuve` | HKDF(`K_maître`, « preuve ») | envoyé pour déverrouiller et détruire |
| `V_preuve` | SHA-256(`K_preuve`) | serveur |
| `C_engagement` | HMAC-SHA-256(`K_contenu`, « engagement ») | en tête du paquet (en clair) |
| `S_gestion` | 32 octets aléatoires | après le `#` du lien de gestion |
| `V_gestion` | SHA-256(`S_gestion`) | serveur |

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
- **Paliers de taille**, en nombre de morceaux : 1, 16, 80, 160, 400, 800, 1 600 (de 64 Kio à 100 Mio). Le serveur ne connaît que le palier, donc ni les noms, ni les types, ni le nombre d'éléments, ni la taille exacte.
- **Segments de transport** de 64 morceaux (4 Mio + tags) : un envoi ou un téléchargement par segment. La taille exacte de chaque segment se déduit du palier.

### 7.4 Envoi

1. `POST /api/shares` : durée, ouvertures, palier, `sel`, paramètres KDF, `V_accès`, `V_preuve`, `V_gestion`.
   - Le serveur vérifie les limites, **réserve** la place du palier et répond avec un identifiant (128 bits) et un **jeton d'envoi signé** (valable 1 h).
2. `PUT /segments/{n}` : le serveur refuse tout `n` hors palier, toute taille inexacte et tout envoi après finalisation. Il écrit à la position exacte, et renvoyer un segment le remplace (reprise).
3. `POST /finalize` : tous les segments sont présents → état `ready`, et `expires_at` = maintenant + durée, arrondi au quart d'heure supérieur.
4. Un envoi non finalisé au bout d'1 h est effacé et sa place libérée.

### 7.5 Déverrouillage et téléchargement

1. `GET meta` (avec `K_accès`) : secondes restantes avant expiration, `sel`, paramètres KDF. Sans `K_accès` valide : réponse « introuvable », qui ne compte pas comme essai.
2. `POST unlock` (avec `K_accès` et `K_preuve`), traité en une seule requête SQL conditionnelle :
   - **Faux** : `failed_attempts = failed_attempts + 1 WHERE failed_attempts < 5` ; réponse avec les essais restants ; au 5ᵉ, destruction.
   - **Juste** : `opens_left = opens_left - 1, downloads_active = downloads_active + 1 WHERE state='ready' AND opens_left > 0 AND expires_at > now`. Le serveur remet ensuite un **jeton de téléchargement signé**, propre à cette ouverture, valable 1 h et plafonné à `expires_at`.
3. `GET /segments/{n}` (avec le jeton) : refusé dès l'expiration du partage ou sa destruction (coupure nette).
4. `POST done` (avec le jeton) : `downloads_active − 1`.
5. Quand `opens_left = 0` (état `draining`), plus aucun déverrouillage n'est possible. Le partage est effacé dès que `downloads_active = 0`, au plus tard à la fin du dernier jeton (`purge_at`).

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
- **IP de confiance** : le serveur écoute uniquement en local ; il ne croit que l'en-tête posé par Caddy et ignore tout `X-Forwarded-For` venu du client. Un test le vérifie.
- **Délais réseau** : lecture et écriture limitées (protection contre les connexions lentes), corps de requête plafonnés à la taille exacte attendue.

---

## 9. Données stockées

### 9.1 Base

Table `shares`, une ligne par partage vivant :

`id`, `state` (`uploading`, `ready`, `draining`), `expires_at` (au quart d'heure), `upload_deadline`, `opens_left`, `downloads_active`, `purge_at`, `failed_attempts`, `salt`, `kdf_params`, `access_verifier`, `proof_verifier`, `manage_verifier`, `size_bucket`, `segments_received` (masque binaire).

- **Jamais stockés** : adresse IP, date de création, nom, type ou taille exacte de fichier, navigateur, pays, jetons.
- La ligne est supprimée quand le partage meurt. `secure_delete=ON` et vidage du WAL chaque minute : rien ne reste dans le fichier de base.

### 9.2 Fichiers

- Un fichier par partage, à la taille exacte du palier, contenant uniquement du chiffré : aucun fichier en clair n'existe jamais, même temporaire.
- **Dates du fichier remises à zéro** à chaque écriture (`Chtimes`).
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

- Le type affiché suit une **liste blanche** : un fichier déclaré « image » qui n'en est pas une n'est pas affiché.
- **Téléchargement** :
  - type `application/octet-stream` ;
  - **nom de fichier nettoyé** : caractères d'inversion de sens d'écriture retirés (anti-« facture‮fdp.exe »), chemins et caractères de contrôle retirés ;
  - **avertissement** pour les fichiers exécutables ou dangereux (.exe, .apk, .js, .html, .bat, .scr, .dmg…).
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
| Onglet fermé pendant l'envoi | Envoi abandonné, effacé au bout d'1 h, compte dans la limite du jour |
| Réseau coupé pendant le téléchargement | Reprise tant que le jeton (1 h) et le partage sont valides |
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
- Vérifier le **volume de trafic sortant inclus** : un partage de 100 Mio ouvert 10 fois = 1 Gio sortant.
- Aucun intermédiaire qui déchiffre le trafic (pas de CDN-proxy), TLS terminé par Caddy.

### 15.2 Au quotidien (automatique)

- Nettoyage chaque minute : partages expirés, envois abandonnés, `draining` terminés, vidage du WAL.
- HTTPS renouvelé par Caddy ; mises à jour de sécurité du système automatiques ; redémarrage automatique des conteneurs ; heure synchronisée (NTP).
- Conteneur verrouillé : utilisateur non administrateur, système de fichiers en lecture seule sauf les données, image minimale.
- **Alertes simples** : une sonde externe gratuite (site injoignable), et un script horaire qui envoie un e-mail si le disque dépasse 80 % ou si les signalements s'accumulent.

### 15.3 Commandes d'administration

- `shhdrop admin freeze` / `unfreeze` : bloque ou rouvre les nouveaux envois.
- `shhdrop admin destroy <lien ou id>` : traite un signalement.
- `shhdrop admin wipe` : efface tout (urgence).
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
6. On n'écrit jamais « 100 % sécurisé ». On écrit ce qui est vrai : le contenu est chiffré de bout en bout, et ni le serveur ni son propriétaire ne peuvent le lire.

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
| Stockage total (20 Gio par défaut) | Selon le serveur choisi |
