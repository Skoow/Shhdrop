# Shhdrop — spécification V1

Date : 3 novembre 2026 · Statut : à relire et valider
Domaine visé : **shhdrop.app**

---

## 1. En une phrase

Shhdrop est un **site web installable sur téléphone (PWA)** qui permet d'envoyer du **texte, des photos, des vidéos, des messages vocaux et des documents** à une personne, **sans compte**, par un **lien chiffré de bout en bout** protégé par un mot de passe, qui **s'autodétruit** au bout d'un temps choisi ou après un nombre d'ouvertures choisi. Le serveur ne peut jamais lire ce qui est envoyé.

### Pourquoi

Les messageries chiffrent le transport, mais le contenu reste stocké sur les téléphones et dans les sauvegardes (WhatsApp, iCloud…), et peut être retrouvé. Avec Shhdrop, il ne reste dans la conversation qu'un **lien mort** : une fois expiré ou ouvert, il ne mène plus à rien, et le contenu n'existe plus sur le serveur.

### Pour qui

Ouvert à tout le monde sur Internet, sans inscription. Usage personnel du propriétaire au départ, ouverture publique ensuite. Limites strictes dès le départ (section 3) pour éviter les abus et maîtriser les coûts.

### Ce qui définit la réussite

1. Le contenu est **illisible pour le serveur** à chaque étape, prouvé par un test automatique (section 13).
2. Un lien expiré, détruit ou épuisé **ne donne plus accès à rien**, et les données sont effacées du serveur.
3. Un destinataire peut **lire, écouter, regarder ou télécharger** directement sur le site, sur iPhone, Android et ordinateur.
4. Le service **tourne seul** : nettoyage, mises à jour, alertes.

---

## 2. Périmètre

### Dans la V1

- Création d'un partage : jusqu'à 10 éléments (texte, fichiers, photo prise sur place, vocal enregistré sur place).
- Chiffrement de bout en bout dans le navigateur, mot de passe obligatoire (généré par défaut).
- Lien de partage + lien de gestion privé pour l'expéditeur.
- Ouverture par le destinataire : compte à rebours, déverrouillage, lecteurs intégrés, téléchargement (sauf lecture seule), destruction immédiate, signalement.
- Suppression automatique (temps, nombre d'ouvertures, 5 mots de passe faux, destruction manuelle, signalement).
- Anti-abus : 10 partages par jour et par connexion, calcul anti-robot, plafonds de taille et de stockage.
- PWA installable, français et anglais, mode clair et sombre.
- Serveur autonome : nettoyage, HTTPS automatique, mises à jour vérifiées, alertes, interrupteur d'urgence.
- Pages fixes : accueil, comment ça marche / sécurité, mentions légales, confidentialité, CGU, contact abus.

### Plus tard (hors V1)

- Adresse Tor (.onion).
- App App Store / Play Store (préparée dès la V1, section 15).
- Aperçu des documents Office (Word, Excel) sur le site.
- Autres langues, partage de dossier entier.
- Audit de sécurité externe (avant l'ouverture large au public).

### Jamais

- Comptes utilisateurs, profils, carnet de contacts.
- Publicité, analytics, traceurs, polices ou scripts tiers.
- Tout mécanisme permettant au serveur de lire un contenu.

---

## 3. Règles et limites

| Règle | Valeur V1 |
|---|---|
| Éléments par partage | 10 maximum |
| Taille totale par partage | 100 Mo, chiffrement et bourrage compris (le palier maximal) |
| Durée de vie | au choix : **1 h, 6 h, 12 h, 24 h** (24 h maximum) |
| Ouvertures | au choix : **1 à 10** (une ouverture = un déverrouillage réussi) |
| Fin de vie | **le premier atteint** : durée écoulée, ouvertures épuisées, destruction par l'expéditeur ou le destinataire, 5 mots de passe faux, signalement |
| Mot de passe | **obligatoire** ; généré par défaut (5 mots + nombre), remplaçable ; mots de passe faibles refusés |
| Essais de mot de passe | 5 ratés → partage détruit |
| Création de partages | **10 par jour** par connexion (IPv4 ou bloc IPv6 /64) |
| Anti-robot | calcul invisible dans le navigateur (preuve de travail), plus long pour les connexions qui abusent |
| Stockage total du serveur | plafond configurable (20 Go par défaut) ; au-delà, nouveaux envois refusés, partages en cours conservés |
| Mode lecture seule | option à la création : pas de bouton télécharger (ne protège pas d'une capture d'écran) |

---

## 4. Parcours

### 4.1 Expéditeur

1. **Composer** : ajouter fichiers, photo (appareil), vocal (enregistrement direct) ou texte. Aperçu de chaque élément, ✕ pour retirer, jauge « 34 / 100 Mo · 3 / 10 ». Les métadonnées des photos (position GPS, appareil, date) sont retirées automatiquement ; un avertissement s'affiche pour les vidéos et PDF, dont les métadonnées ne sont pas nettoyées.
2. **Options** : durée (1 h / 6 h / 12 h / 24 h), ouvertures (1 à 10), mot de passe (pré-rempli, régénérable, modifiable, indicateur de force), lecture seule.
3. **Envoi** : calcul anti-robot, chiffrement puis envoi par morceaux, avec barre de progression et reprise automatique si le réseau coupe.
4. **Lien prêt** :
   - lien à envoyer (Copier, Partager, QR code) ;
   - mot de passe (Copier), avec le rappel « envoie-le par un autre moyen que le lien » ;
   - lien de gestion privé (Copier) ;
   - bouton « Vider le presse-papier » ;
   - avertissement « Ces informations ne seront plus jamais affichées ».
5. **Gestion** (lien privé) : état « Ouvert 1 / 3 · Expire dans 4 h 12 », ou « Supprimé » ; bouton « Détruire maintenant ».

### 4.2 Destinataire

1. **Ouverture du lien** : « Quelqu'un vous a envoyé un partage chiffré », compte à rebours, champ mot de passe, « Déverrouiller », essais restants affichés en cas d'erreur. Rien sur le contenu avant le déverrouillage.
2. **Contenu** : liste des éléments, lecteurs intégrés (section 11), Télécharger sauf en lecture seule, bandeau « Disponible encore 5 h 31 · disparaît dès que vous quittez la page », boutons « Détruire maintenant » et « Signaler ».
3. **Lien invalide** : un message unique, quelle que soit la raison : « Ce lien n'existe pas ou n'est plus disponible ».

---

## 5. Architecture

Le serveur est volontairement « bête » : il stocke des données chiffrées qu'il ne peut pas lire et applique les règles. Tout le chiffrement se fait dans le navigateur.

```
Navigateur expéditeur ──(chiffré)──► Serveur Shhdrop ──(chiffré)──► Navigateur destinataire
 chiffre tout localement              stocke + applique les règles      déchiffre localement
 clé dans le # du lien                ne voit jamais la clé             clé lue dans le # du lien
```

| Partie | Choix | Raison |
|---|---|---|
| Serveur | **Go** (un seul binaire) | Sûr, rapide, facile à déployer, déjà maîtrisé (ancien Privixa) |
| Base de données | **SQLite chiffrée (SQLCipher)** | Un fichier, rien à administrer ; ne contient que le minimum (section 8) |
| Fichiers chiffrés | Dossier du serveur, derrière une interface interchangeable | Passage possible à un stockage type S3 sans réécrire le reste |
| Site | **TypeScript + Svelte + Vite**, PWA | Léger et rapide, erreurs détectées avant exécution |
| Crypto navigateur | **WebCrypto** (AES-256-GCM, HKDF-SHA-256, SHA-256) + **libsodium.js** (Argon2id uniquement) | Outils standards et reconnus, aucune crypto maison |
| HTTPS et déploiement | **Docker + Caddy** | Certificats automatiques, fonctionne chez n'importe quel hébergeur |
| Hébergement | À choisir hors UE (Suisse ou Islande de préférence) | Voir section 14 |

### Organisation du dépôt

```
shhdrop/
├── server/                 # Go
│   ├── cmd/shhdrop/        # point d'entrée + commandes d'administration
│   └── internal/
│       ├── api/            # routes HTTP, en-têtes de sécurité
│       ├── share/          # règles d'un partage (création, déverrouillage, fin de vie)
│       ├── store/          # base SQLite chiffrée
│       ├── blob/           # stockage des fichiers chiffrés (interface + disque)
│       ├── limits/         # limite par connexion, quotas
│       ├── pow/            # calcul anti-robot
│       └── janitor/        # nettoyage automatique
├── web/                    # Svelte
│   └── src/
│       ├── crypto/         # clés, chiffrement par morceaux, format du paquet
│       ├── upload/         # envoi par morceaux avec reprise
│       ├── viewers/        # lecteurs audio, vidéo, image, PDF, texte (isolés)
│       ├── media/          # enregistrement vocal, photo, retrait des métadonnées
│       ├── routes/         # écrans
│       └── i18n/           # fr, en
├── deploy/                 # docker-compose, Caddyfile, scripts serveur
└── docs/
```

Chaque morceau a une seule responsabilité et peut être testé seul. La crypto du navigateur (`web/src/crypto`) ne dépend d'aucun écran. Les règles d'un partage (`server/internal/share`) ne dépendent pas du HTTP.

---

## 6. Modèle cryptographique

### 6.1 Clés

| Élément | Création | Où il vit |
|---|---|---|
| `K_lien` | 32 octets aléatoires | après le `#` du lien, jamais envoyé au serveur |
| `sel` | 16 octets aléatoires | stocké par le serveur (public) |
| `K_mdp` | Argon2id(mot de passe, sel) : 64 Mio, 3 passes, 1 fil, 32 octets | calculé dans le navigateur |
| `K_maître` | HKDF-SHA-256(`K_lien` ‖ `K_mdp`, info « shhdrop v1 ») | navigateur uniquement |
| `K_contenu` | HKDF(`K_maître`, « contenu ») | navigateur uniquement |
| `K_preuve` | HKDF(`K_maître`, « preuve ») | envoyée au serveur pour déverrouiller |
| `V_preuve` | SHA-256(`K_preuve`) | stocké par le serveur |
| `S_gestion` | 32 octets aléatoires | après le `#` du lien de gestion |
| `V_gestion` | SHA-256(`S_gestion`) | stocké par le serveur |

Les paramètres Argon2id visent environ 1 s sur un téléphone d'entrée de gamme ; ils sont versionnés avec le partage.

### 6.2 Pourquoi c'est solide

- Pour lire un contenu, il faut **le lien ET le mot de passe**.
- Le serveur ne détient ni `K_lien` ni le mot de passe. Même avec la base et les fichiers volés, `K_lien` (256 bits) rend tout essai impossible.
- Si quelqu'un vole le lien (dans une sauvegarde) **et** la base du serveur, il peut essayer des mots de passe hors ligne contre `V_preuve`. Argon2id rend chaque essai coûteux, et les mots de passe faibles sont refusés à la création.
- En ligne, sans la base, **5 essais** seulement, puis destruction.

### 6.3 Le paquet chiffré

Un partage = **un seul paquet chiffré** :

- **Contenu clair** = en-tête (version, longueur du manifeste) + **manifeste** + données des éléments à la suite + **bourrage**.
- **Manifeste** (JSON, chiffré avec le reste) : pour chaque élément, type, nom de fichier, type MIME, taille, position dans le paquet ; options d'affichage (lecture seule) ; textes courts directement inclus.
- **Bourrage** jusqu'au palier supérieur : 64 Ko, 1 Mo, 5 Mo, 10 Mo, 25 Mo, 50 Mo, 100 Mo. Le serveur ne connaît que le palier.
- **Chiffrement par morceaux de 64 Kio** en AES-256-GCM avec `K_contenu`, selon le principe STREAM :
  - le nonce (12 octets) = numéro du morceau sur 11 octets + 1 octet « dernier morceau » ;
  - un morceau modifié, retiré, déplacé ou ajouté est détecté ;
  - un morceau peut être déchiffré seul, ce qui permet la lecture vidéo pendant le téléchargement.
- Le serveur ne voit ni les noms, ni les types, ni le nombre d'éléments, ni la taille exacte.

### 6.4 Déverrouillage

1. Le navigateur lit l'identifiant (avant le `#`) et `K_lien` (après le `#`).
2. `GET meta` renvoie l'expiration, le sel et les paramètres Argon2id, ou la réponse uniforme « introuvable ».
3. Le navigateur calcule `K_preuve` et l'envoie (`POST unlock`).
4. Le serveur compare `SHA-256(K_preuve)` à `V_preuve` en temps constant.
   - **Faux** : essais +1, réponse avec les essais restants ; au 5ᵉ, destruction.
   - **Juste** : en **une seule opération indivisible**, ouvertures restantes −1, puis le serveur remet un **jeton de téléchargement** valable 10 minutes. Ce jeton est aléatoire, et seul son hash est stocké.
5. Le navigateur télécharge les morceaux avec ce jeton, déchiffre en mémoire et affiche. Quand le téléchargement est complet, il le signale (`done`).
6. Si c'était la dernière ouverture, les fichiers sont effacés dès `done`, au plus tard à l'expiration du jeton.

### 6.5 Destruction et signalement

- **Destinataire** : `POST destroy` avec `K_preuve`.
- **Expéditeur** : `POST destroy` avec `S_gestion`.
- **Signalement** : depuis le contenu déverrouillé (avec `K_preuve`), le partage est désactivé immédiatement. Les tiers sans mot de passe passent par l'adresse de contact abus.
- Effacer les fichiers suffit : la clé n'ayant jamais été sur le serveur, ce qui pourrait rester sur le disque est illisible à jamais.

---

## 7. API du serveur

Toutes les réponses : `Cache-Control: no-store`, JSON, et des messages d'erreur uniformes pour « inexistant / expiré / détruit ».

| Méthode et route | Rôle | Authentification |
|---|---|---|
| `GET /api/pow` | Défi anti-robot (aléa, difficulté, expiration 2 min) | — |
| `POST /api/shares` | Crée un partage (preuve anti-robot, durée, ouvertures, palier, sel, paramètres KDF, `V_preuve`, `V_gestion`) → identifiant, jeton d'envoi, taille des morceaux | preuve anti-robot + limite par connexion |
| `PUT /api/shares/{id}/chunks/{n}` | Envoie un morceau (rejouable : reprise) | jeton d'envoi |
| `POST /api/shares/{id}/finalize` | Vérifie que tous les morceaux sont là, active le partage | jeton d'envoi |
| `GET /api/shares/{id}/meta` | Expiration, sel, paramètres KDF | — |
| `POST /api/shares/{id}/unlock` | Vérifie `K_preuve` → jeton de téléchargement, ou essais restants | `K_preuve` |
| `GET /api/shares/{id}/chunks/{n}` | Télécharge un morceau (accepte les requêtes partielles) | jeton de téléchargement |
| `POST /api/shares/{id}/done` | Téléchargement terminé | jeton de téléchargement |
| `POST /api/shares/{id}/destroy` | Destruction immédiate | `K_preuve` ou `S_gestion` |
| `POST /api/shares/{id}/report` | Désactivation immédiate + compteur de signalements | `K_preuve` |
| `GET /api/shares/{id}/status` | Ouvertures utilisées / maximum, expiration | `S_gestion` |
| `GET /healthz` | Santé (local uniquement) | — |

Les identifiants de partage font 128 bits aléatoires (base64url). Les réponses des routes publiques prennent un temps constant (délai minimal fixe), pour ne rien révéler sur l'existence d'un partage.

---

## 8. Données stockées

### 8.1 Base (SQLite chiffrée)

Table `shares`, une ligne par partage, rien d'autre :

| Colonne | Contenu |
|---|---|
| `id` | identifiant aléatoire |
| `state` | `uploading`, `ready`, `draining`, `destroyed` |
| `expires_at` | arrondi à la minute |
| `opens_left` | ouvertures restantes |
| `failed_attempts` | 0 à 5 |
| `salt`, `kdf_params` | publics |
| `proof_verifier`, `manage_verifier` | hashes SHA-256 |
| `size_bucket` | palier de taille |
| `upload_token_hash`, `upload_expires_at` | pendant l'envoi |
| `download_token_hash`, `download_expires_at` | pendant une ouverture |

**Jamais stockés** : adresse IP, date de création, nom ou type de fichier, taille exacte, navigateur, pays.

Une ligne est supprimée dès que le partage meurt ; il ne reste aucun historique.

### 8.2 Fichiers

- Un fichier par partage : le paquet chiffré, tel que reçu.
- Pendant l'envoi, les morceaux arrivent déjà chiffrés : aucun fichier en clair n'existe jamais sur le serveur, même temporaire.
- Le dossier et la base sont sur un **disque chiffré (LUKS)**. Les sauvegardes sont exclues : rien de ce dossier n'est sauvegardé.

### 8.3 Mémoire uniquement (jamais sur disque)

- Compteurs de la limite de 10 partages par jour : clé = HMAC-SHA-256(secret du jour, IP ou bloc /64), effacés chaque jour avec rotation du secret.
- Défis anti-robot en cours.

### 8.4 Journaux

- Journaux d'accès de Caddy **désactivés**.
- Journaux de l'application : uniquement des événements sans donnée personnelle (démarrage, erreurs internes, compteurs agrégés).

---

## 9. Sécurité du site web

- **En-têtes** sur tout le site :
  - `Content-Security-Policy` stricte : `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `img-src`/`media-src 'self' blob:`, `connect-src 'self'`, `require-trusted-types-for 'script'` ;
  - `Strict-Transport-Security` (préchargement), `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` ;
  - `Permissions-Policy` : caméra et micro seulement sur la page d'envoi, géolocalisation interdite ;
  - `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Resource-Policy: same-origin`.
- **Aucune ressource tierce** : scripts, polices et images servis par Shhdrop.
- **Pages de partage** : pas d'aperçu pour les messageries (titre générique « Shhdrop », pas d'image, `noindex`).
- **Contenu déchiffré** : en mémoire uniquement. Pas de stockage local, pas de cache, pas d'historique. Les URL blob sont révoquées et les buffers effacés à la fermeture.
- **Intégrité du code** :
  - très peu de dépendances, versions verrouillées ;
  - build reproductible, empreinte de chaque version publiée sur GitHub ;
  - la PWA ne met en cache que le code de l'app, versionné, et ne se met à jour que vers une version vérifiée.
- **Navigateur trop ancien** (sans WebCrypto) : refus clair. **Rien n'est jamais envoyé en clair.**

---

## 10. Anti-abus

- **10 partages par jour** par connexion (IPv4, ou bloc /64 en IPv6).
- **Calcul anti-robot** (preuve de travail SHA-256) : environ 1 à 2 s sur téléphone ; la difficulté augmente pour une connexion qui enchaîne les créations.
- **Plafonds** : 100 Mo par partage, 24 h au maximum, stockage total configurable. Si le stockage est presque plein, les nouveaux envois sont refusés et les partages en cours sont conservés.
- **Signalement** : désactivation immédiate (section 6.5).
- **Adresse de contact abus** publiée (mentions légales, `security.txt`).

---

## 11. Lecture sur le site

| Type | Affichage |
|---|---|
| Vocal / audio | Lecteur intégré : lecture, pause, avance, vitesse ×1,5 / ×2 |
| Vidéo | Lecteur intégré, démarrage pendant le téléchargement (déchiffrement morceau par morceau) |
| Photo | Visionneuse plein écran, zoom, défilement entre les photos |
| PDF | Lecteur PDF intégré (pdf.js, scripts du PDF désactivés) : pages, zoom, recherche |
| Texte | Affiché directement |
| Autres documents | Téléchargement seulement |

- **Isolement** : chaque lecteur s'affiche dans une zone isolée (`iframe` sandbox, sans `allow-same-origin`) ; aucun fichier ne peut exécuter de code sur le site.
- **HTML et SVG** ne sont jamais exécutés : affichage en image pour le SVG, téléchargement seulement pour le HTML.
- **Lecture seule** : lecteurs disponibles, sans bouton Télécharger.

### Création de contenu

- **Vocal** : enregistrement par `MediaRecorder` (Opus/WebM, ou AAC/MP4 sur iPhone), sans métadonnées.
- **Photo** : appareil photo du téléphone via le sélecteur de fichiers.
- **Retrait des métadonnées** : JPEG (segments APPn/EXIF), PNG (blocs texte et eXIf), WebP (EXIF/XMP), sans réencodage. Les formats non gérés (vidéo, PDF, autres) déclenchent un avertissement.
- **Partager vers Shhdrop** (Android) : Web Share Target. Sur iPhone : bouton « Ajouter des fichiers ».

---

## 12. Gestion des erreurs

| Situation | Comportement |
|---|---|
| Réseau coupé pendant l'envoi | Pause, reprise automatique au morceau manquant |
| Réseau coupé pendant la lecture | Reprise tant que le jeton de 10 min est valide |
| Mot de passe faux | « Mot de passe incorrect · N essais restants » ; destruction au 5ᵉ |
| Lien expiré pendant la lecture | Ce qui est affiché reste visible jusqu'à la fermeture de la page |
| Limite de 10 par jour | « Limite atteinte, réessayez dans X h » |
| Serveur plein | « Service temporairement saturé, réessayez plus tard » |
| Trop gros / trop d'éléments | Bloqué avant l'envoi, avec la raison |
| Navigateur trop ancien | Refus clair, rien n'est envoyé |
| Mémoire insuffisante (vieux téléphone) | Avertissement, lecture par morceaux quand c'est possible |
| Partage inexistant, expiré ou détruit | Message unique : « Ce lien n'existe pas ou n'est plus disponible » |

Tous les messages existent en français et en anglais.

---

## 13. Tests

### Automatiques (à chaque modification, sur GitHub)

- **Unitaires** : chaque paquet Go et chaque module du site.
- **Crypto** : vecteurs officiels (AES-GCM, HKDF, Argon2id, SHA-256) ; aller-retour chiffrer/déchiffrer sur tous les types et toutes les tailles ; détection d'un morceau modifié, retiré, déplacé ou ajouté.
- **Règles** : expiration, ouvertures, 5 essais, ouvertures simultanées (aucun dépassement possible), destruction par l'expéditeur et par le destinataire, signalement, limite par connexion, stockage plein.
- **« Le serveur ne voit rien »** : un fichier contenant un mot repère est envoyé, puis toute la base, tous les fichiers, tous les journaux et tous les fichiers temporaires sont fouillés. **Le mot ne doit apparaître nulle part. Ce test bloque toute mise en ligne s'il échoue.**
- **Sécurité** : en-têtes et CSP vérifiés, fichiers piégés (PDF avec script, SVG, HTML) qui ne doivent rien exécuter, fuzzing des routes du serveur, analyse des dépendances (CodeQL, govulncheck, Trivy, Dependabot).
- **Parcours complets** (Playwright) : Chrome, Firefox et Safari (WebKit), sur ordinateur et en simulation iPhone et Android, de l'envoi à la lecture puis à la destruction.

### Manuels (avant chaque mise en ligne)

- **Site de test** séparé, où chaque écran peut être essayé.
- **Liste de vérification** sur un vrai iPhone et un vrai Android : envoyer une photo, un vocal, une vidéo et un PDF, les ouvrir sur un autre appareil, se tromper de mot de passe, laisser expirer, détruire, installer la PWA.

---

## 14. Exploitation et mise en ligne

### Hébergement

- Petit serveur loué **hors UE**, en Suisse ou en Islande de préférence. Le choix se fera à la mise en ligne : tout tourne en Docker, donc l'hébergeur peut être changé.
- **Aucun intermédiaire qui déchiffre le trafic** : pas de proxy CDN, TLS terminé sur le serveur par Caddy.

### Serveur autonome

- **Nettoyage chaque minute** : partages expirés, envois abandonnés depuis plus d'1 h, jetons expirés.
- **HTTPS renouvelé automatiquement** (Caddy).
- **Mises à jour de sécurité automatiques** du système ; redémarrage automatique en cas de plantage.
- **Conteneur verrouillé** : utilisateur non administrateur, système de fichiers en lecture seule (sauf le dossier de données), image minimale.
- **Autoprotection** : stockage presque plein → nouveaux envois refusés, partages en cours conservés.
- **Rotation automatique** du secret de la limite par connexion, chaque jour.
- **Alertes sur téléphone** (ntfy) : site en panne, stockage presque plein, pic de créations anormal.
- **Mises à jour du site** : une version publiée et signée sur GitHub est vérifiée puis installée par le serveur ; en cas d'échec du contrôle de santé, retour automatique à la version précédente.
- **Interrupteur d'urgence** : `shhdrop admin freeze` bloque les nouveaux envois, `shhdrop admin wipe` efface tout.

### Étapes

1. Développement et tests en local.
2. Site de test, que le propriétaire valide.
3. Version signée, puis mise en ligne sur shhdrop.app.

---

## 15. Préparation App Store (sans rien réécrire)

La V1 est une PWA. Elle est conçue pour être emballée plus tard avec **Capacitor**, et compilée dans le cloud (Codemagic), sans Mac :

- **Site entièrement statique**, avec des chemins relatifs : l'app iOS embarque l'interface et appelle l'API de `https://shhdrop.app`.
- **Adresse du serveur configurable** dans le site ; le serveur autorise l'origine de l'app (`capacitor://localhost`) en plus de la sienne.
- **Liens universels** : le chemin `/s/…` est réservé ; un fichier `apple-app-site-association` pourra faire ouvrir les liens Shhdrop directement dans l'app.
- **Fonctions du navigateur standards** : caméra, micro, WebCrypto et WebAssembly fonctionnent dans la vue web d'iOS.
- **Exigences Apple déjà couvertes** : signalement, CGU qui interdisent les contenus illicites, contact abus, aucun compte à supprimer.
- **À prévoir au moment de l'App Store** :
  - compte développeur Apple (99 $/an, vérification d'identité, nom de l'éditeur affiché publiquement) ;
  - déclaration de chiffrement à l'export dans App Store Connect ;
  - partage depuis la galerie via une extension Capacitor.

---

## 16. Cadre légal

- **Mentions légales** : particulier non professionnel ; identité communiquée à l'hébergeur (LCEN) ; adresse de contact abus.
- **CGU** : contenus illicites interdits, suppression sur signalement, aucune garantie de conservation.
- **Politique de confidentialité** : ce qui est stocké (section 8) et ce qui ne l'est jamais. Le serveur ne traite aucune donnée personnelle hors l'empreinte d'IP temporaire en mémoire.
- **À vérifier avant l'ouverture au public** : obligation de déclaration de fourniture d'un moyen de cryptologie auprès de l'ANSSI.

---

## 17. Limites assumées (affichées honnêtement)

1. **Ce que le destinataire télécharge ou capture à l'écran lui appartient.** Shhdrop ne peut pas l'effacer de son appareil.
2. **Le code du site est le point sensible** de tout chiffrement dans un navigateur. Il est réduit au minimum, protégé par la CSP, et son empreinte est publiée pour être vérifiable.
3. **Le serveur et l'hébergeur voient l'adresse IP de connexion**, même sans l'enregistrer. Une adresse Tor est prévue après la V1.
4. **On n'écrit jamais « 100 % sécurisé ».** On écrit ce qui est vrai : le contenu est chiffré de bout en bout, et ni le serveur ni son propriétaire ne peuvent le lire.

---

## 18. Décisions encore ouvertes

| Sujet | Quand |
|---|---|
| Hébergeur (Suisse ou Islande) | Avant la mise en ligne |
| Achat du domaine (Njalla recommandé) | Dès maintenant |
| Adresse e-mail de contact abus | Avant la mise en ligne |
| Stockage total (20 Go par défaut) | Avant la mise en ligne, selon le serveur choisi |
