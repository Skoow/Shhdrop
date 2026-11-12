# Salon v3 : une vraie messagerie éphémère — conception

Date : 11 novembre 2026 · Statut : **validée le 11 novembre** (le propriétaire a délégué les derniers choix : « prends les meilleures décisions pour le projet » ; essai OpenMLS fait le 11 novembre, §3.6)
Amende la spécification générale `2026-11-03-shhdrop-design.md` §39 (salon, v2.8 et v2.9), D41-1 à D41-26 pour le salon, §37 (compte) et D42-20/D42-21 (moteur Rust commun). Tout ce qui n'est pas changé ici reste valable : lien `#c…`, mot de passe, sièges, WebSocket toujours par notre serveur, relais en mémoire seulement, pièces jointes chiffrées sur disque, budget de 1 Go, exclusion, limites, routes (§39.1, §39.3, §39.4, §39.13).

## 1. Demande et décisions du propriétaire (11 novembre)

Demande : « une conversation type WhatsApp, Signal, Telegram, où l'on peut tout faire comme sur une messagerie moderne » : émojis, vocaux dans la conversation, « en train d'écrire », supprimer un message en direct, effacement automatique des messages, modification d'un message, envoi et téléchargement de fichiers, pseudonyme choisi au départ et modifiable, photo de profil, appels audio et vidéo plus tard, « et tout ce que je ne t'ai pas dit qui peut servir ».

Décisions prises le 11 novembre :

1. **Chiffrement de groupe : MLS** (norme RFC 9420) par la bibliothèque Rust **OpenMLS**, dans le moteur commun (site en WebAssembly, apps en natif). Remplace les « clés d'expéditeur » de §39.2, qui reposaient sur libsodium, retiré du site (D42-21). Essai concluant, avec réserves (poids, vitesse, sûreté : résultat en §3.6).
2. **Photo de profil** : sans compte, avatar par défaut (initiale sur la couleur du participant) ou photo choisie pour ce salon seulement ; avec compte, photo gardée dans le compte, chiffrée.
3. **Effacement des messages** : règle du salon, modifiable par **tout participant**, chaque changement affiché dans la conversation (§5).
4. **« Vu »** : toujours activé pour tous (§6).

## 2. Ce qui change dans §39

| Point | Avant (§39) | Maintenant |
|---|---|---|
| Chiffrement | clés d'expéditeur, libsodium (§39.2) | MLS par OpenMLS dans le moteur Rust (§3) |
| Modifier un message | exclu en V1 (§39.5) | permis, ses propres messages (§4.3) |
| Effacer après lecture | par message, 30 s | remplacé par la règle d'effacement du salon (§5) |
| Accusés de lecture | désactivés par défaut, par personne (§39.3.7) | « Reçu » et « Vu » toujours actifs (§6) |
| Pseudonyme | choisi à l'entrée, fixe | choisi à l'entrée, modifiable (§7.1) |
| Profil | aucun (§37 : « profils exclus ») | avatar par défaut ou photo (§7.2) ; amendement de §37 |
| Appels | aucun WebRTC (§39.3.1) | plus tard, par notre serveur seulement (§8) ; rien codé maintenant |

## 3. Chiffrement : MLS

### 3.1 Principe

- Un salon = un **groupe MLS**. Chaque participant a une identité **éphémère** : une paire Ed25519 tirée à l'entrée (credential MLS « basique » qui ne contient que cette clé publique), gardée en mémoire seulement (ou dans la preuve de membre chiffrée de D41-26). Aucun nom, aucun compte dans MLS : le pseudonyme et l'avatar voyagent dans les messages chiffrés.
- **Arrivée** : le nouveau publie un « KeyPackage » ; un membre en ligne l'ajoute (Commit + Welcome). **Départ, exclusion** : un membre retire le partant (Commit). Chaque Commit change toutes les clés : le partant ne lit plus rien, l'arrivant ne lit rien d'avant (comme §39.1 « Nouveaux venus »).
- **Renouvellement** : chaque membre fait un « self-update » toutes les 100 de ses messages et toutes les heures (même rythme que §39.2.4, invisible pour les gens).
- **Gains sur l'ancien choix** : protocole normalisé et étudié, aucun assemblage propre à Shhdrop ; confidentialité persistante **et** guérison après vol de clés, y compris contre un attaquant actif ; clé d'appel tirée de l'« exporteur » MLS (§8).

### 3.2 Rôle du serveur

- **Service de livraison** (Delivery Service) : il ordonne les trames (numéro `seq`, déjà le cas) ; un seul Commit est accepté par époque (le premier dans l'ordre du serveur ; les autres sont rejetés et refaits par leur auteur).
- **Service d'authentification** : aucun. Il n'y a pas d'identité à certifier : l'entrée se prouve par le lien et le mot de passe (`K_preuve_s`, §39.2.1), et l'identité d'un participant est sa clé éphémère. **Vérification** possible par un code par participant (§9, point 4).
- Le serveur ne voit jamais le contenu MLS : chaque message MLS est placé dans l'enveloppe extérieure de taille fixe de §39.2.3 (`K_trame`, 4 140 octets), dont l'en-tête en clair ne porte que « volatile » et la règle d'effacement (§10). Un message MLS plus grand (Welcome, Commit d'un grand groupe) est découpé en plusieurs trames de même taille. Le serveur ne distingue donc ni le type (message, Commit, Welcome, accusé, « écrit »), ni l'expéditeur, ni la taille.

### 3.2.1 Format de la trame (remplace §39.2.3)

- Trame = `"SHC3"` (4 octets) ‖ `drapeaux` (1 octet : bit 0 volatile, bits 1–2 règle d'effacement 0 désactivé / 1 instantané / 2 10 min / 3 1 h, bits 3–7 à zéro) ‖ `nonce` (24 octets, aléatoire) ‖ XChaCha20-Poly1305(`K_trame`, `nonce`, `O`, données authentifiées = `"SHC3"` ‖ `drapeaux` ‖ `tag_salon`) ; total **4 140 octets** (4 + 1 + 24 + 4 095 + 16).
- `O` = `len` (2 octets, gros-boutiste) ‖ charge (un message MLS, **4 093 octets au plus**) ‖ zéros jusqu'à 4 095 octets ; à l'ouverture, `len` et le bourrage nul sont vérifiés après l'authentification ; tout échec donne `trame_corrompue`.
- Le serveur lit `drapeaux` sans clé (un bit réservé non nul → trame refusée) ; le modifier fait échouer l'authentification chez les membres.
- **En-tête lié au contenu** (constat I2 de la revue finale C-1, 12 novembre) : `K_trame` est connue de quiconque a le lien et le mot de passe (ancien membre compris), qui pourrait resceller la charge MLS d'un autre sous d'autres drapeaux (rendre volatil un Commit, changer la règle d'un message). Donc : le moteur fait lui-même chaque trame (`Salon.envoyer`, `keyPackage`, `ajouter`, `retirer`, `renouveler`, Welcome), avec volatile = « sorte volatile » (`ecrit`, `recu`, `vu`) et règle = celle de l'enveloppe ; Commit, Welcome et KeyPackage : non volatil, désactivé. L'octet `drapeaux` est aussi mis dans les données authentifiées MLS (signées par l'auteur) de chaque message et Commit. À la réception (`recevoirTrame`), tout écart entre l'en-tête, les données authentifiées et le contenu déchiffré est refusé (`message_invalide`) ; une sorte inconnue garde son bit volatil libre (versions futures). Vecteurs : `trames.coherence`.

### 3.3 Clés du salon gardées de §39.2.1

`K_lien`, `K_accès_s`, `S_gestion`, `sel`, `K_mdp` (Argon2id), `K_maître_s`, `K_preuve_s`, `K_trame`, `tag_salon` : inchangés. Ils sont calculés par le moteur Rust (HKDF RustCrypto, Argon2id déjà en place). XChaCha20-Poly1305 de l'enveloppe : crate `chacha20poly1305` (RustCrypto).

### 3.4 Pièces jointes

Inchangé (§39.2.5) : chaque pièce est un paquet SHH2 d'un élément sous une graine aléatoire `R` ; `R` voyage dans un message MLS.

### 3.5 Ce que le moteur expose

Le moteur Rust porte tout le protocole du salon (groupe MLS, enveloppe, découpage, formats des messages, règles d'effacement côté appareil), pour que le site et les apps soient identiques. Vecteurs de test communs `engine/vectors/salon-v3.json` (déterministes : aléa injecté en test seulement).

### 3.6 Résultat de l'essai (11 novembre) : utilisable, avec réserves

- **Bibliothèque** : `openmls` **=0.9.2** (22 octobre), `openmls_rust_crypto`, `openmls_basic_credential`, `openmls_traits` 0.6.0 ; licence MIT ; Phoenix R&D et CE Labs ; audit SRLabs de 2026 (8 constats corrigés ; **rapport à lire avant le code**) ; utilisée par Wire (sur un fork) et XMTP. Compile vers WebAssembly sans réglage particulier (feature `js` sur la cible wasm seulement, jamais en natif). AES-GCM d'OpenMLS = celui de RustCrypto, dans le module du salon : les traits d'OpenMLS sont synchrones et WebCrypto est asynchrone, un fournisseur WebCrypto est impossible (Ruling 1 : choix pris sur délégation du propriétaire (11 novembre) ; CLAUDE.md amendé par le propriétaire le 12 novembre). (11 novembre, C-1)
- **Suite** : MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519 (0x0001). Message MLS dans `O` de la trame de 4 140 o sous `K_trame` (§3.2) ; Commit, Welcome et KeyPackage tiennent dans les 4 093 o utiles pour 10 membres (au plus 2 551 o mesurés) : pas de découpage nécessaire en V1, mais le format le garde possible.
- **Temps mesurés dans Chromium, 10 membres** : chiffrer ou déchiffrer un message ~0,2 ms ; ajout d'un membre ~2 ms ; scénario complet (9 ajouts, 900 réceptions, retrait, renouvellement) ~0,3 s. Natif : apps en opt-level 3 (20 à 40 fois plus lent sinon).
  - **Mesure finale (C-1, 11 novembre, profil opt-level "z")** : 10 membres, 9 arrivées et 100 messages scellés puis ouverts : 410 à 444 ms dans Chromium (limite du test : 2 s), contre 406 ms en opt-level 3. Message MLS dans la trame de 4 140 octets sans découpage. Test croisé natif ↔ wasm (Welcome, Commit d'ajout, renouvellement, messages, réaction, pièce, profil) octet pour octet. (11 novembre, C-1)
- **Poids** : essai : ~359 Ko brotli (sans les règles de texte) ; **mesuré en C-1 (11 novembre) : 422 288 à 422 681 octets en brotli** (1 364 656 octets bruts), profil `wasm-salon` (opt-level "z" : 530 787 octets en opt-level 3), plafond de `check-dist` **430 000 octets** (Ruling 25). Après la revue finale (12 novembre : trames faites et vérifiées par le moteur, file de l'arrivant) : **425 163 à 425 272 octets** en brotli (1 370 234 octets bruts), 10 membres en 437 ms dans Chromium. Cause : OpenMLS (`openmls_rust_crypto` active toujours `experimental` de hpke-rs : ML-KEM, X-Wing, P-256/384, k256, choisis à l'exécution, donc non retirables par la LTO) et les tables Unicode (~96 Ko : graphèmes, écritures, squelettes UTS #39, émojis 15.0). Réduction possible plus tard : un fournisseur limité à la suite 0x0001 (de l'ordre de 100 Ko, code crypto d'adaptation à relire). Module à part, chargé avec contrôle d'empreinte seulement sur les pages du salon ; les pages de partage gardent le moteur actuel (141 559 octets) et ne le chargent jamais. (11 novembre, C-1)
- **Règles retenues** : arbre dans le Welcome, aucun GroupInfo publié, **external commits refusés** ; premier Commit de l'époque dans l'ordre du serveur gagne, les autres sont rejoués ; ajouts faits par le membre en ligne de plus petit siège ; si personne n'est en ligne, l'arrivant attend (« En attente d'un participant en ligne ») ; chaque Commit reçu est vérifié avant fusion (tout membre retire un siège parti ou exclu, seul le créateur retire un membre présent, chaque ajout est lié à un siège par son `nonce_arrivée` signé) ; `max_past_epochs(1)` (un message envoyé juste avant un Commit reste lisible ; perte de confidentialité persistante limitée à une époque).
- **Réserves (à corriger dans C-1)** :
  - **Élevée, mémoire** : le stockage en mémoire fourni par OpenMLS garde des copies des secrets sans les effacer → stockage en mémoire écrit par nous, valeurs effacées à l'écrasement et à la suppression (code d'adaptation, relu).
  - **Élevée, suivi** : environ un avis de sécurité par mois en 2026 (corrigés en 0.9.1 et 0.9.2), WebAssembly non testé dans leur CI → tests du salon dans Chromium en CI, taille des messages entrants bornée, suivi des avis, mises à jour après 7 jours.
  - **Moyenne, chaîne** : 136 crates (doublons RustCrypto, courbes P-256/P-384/k256 inutilisées), trois crates de moins de 7 jours à épingler plus anciennes, `cargo audit` avec exceptions justifiées (crypto-bigint compilé mais jamais exécuté par notre suite).
  - **Moyenne, rechargement** : l'état MLS vit en mémoire ; après un rechargement, le participant revient avec une nouvelle feuille (retrait de l'ancienne, nouvel ajout) et sa place, son pseudonyme et sa couleur par la preuve de membre (D41-26). Il ne relit pas les messages d'avant son retour, sauf les messages « instantané » qui l'attendent (§5) : ils sont alors renvoyés automatiquement par l'appareil de l'expéditeur sous la nouvelle époque (si l'expéditeur n'est pas en ligne, ils attendent son retour ; s'il a quitté le salon, ils sont perdus pour ce participant, avec la notice « Des messages ont pu vous échapper »).
- **Amendements** : §39.2 (clés d'expéditeur) remplacé ; §6 et CLAUDE.md citent RustCrypto : OpenMLS repose sur RustCrypto, aucune crypto maison ; vecteurs communs complétés par les vecteurs officiels d'interopérabilité MLS.

### 3.6.1 Règles du moteur décidées en C-1 (11 novembre) : le serveur (C-2), l'interface (C-3) et les apps les suivent

**Messages** (`engine/salon/src/message.rs`, `texte.rs`, `emoji.rs`)
- `Reponse` n'a **pas** de champ `extrait` (Ruling 7) : la citation est affichée depuis le message local, sinon « message indisponible ». Un extrait recopié survivrait au retrait de l'original.
- JSON encodé : **3 900 octets au plus** (`JSON_MAX`, Ruling 8) ; la trame porte 4 093 octets de MLS (MLS en ajoute environ 146). L'échappement JSON peut doubler un texte (guillemets, barres, sauts de ligne) : au-delà, le moteur rend `trop_grand` et l'interface propose l'envoi en fichier `.txt` (§39.5). Texte : 1 à 2 000 graphèmes et 3 500 octets UTF-8 au plus.
- Réactions : exactement une séquence « fully-qualified » de `emoji-test.txt` d'Unicode émoji 15.0 (**3 655** séquences ; fichier source commité avec son empreinte SHA-256 ; table générée par `build.rs`), 64 octets au plus (Ruling 11). Le sélecteur du site utilise la même liste.
- Clés JSON répétées refusées (`message_invalide`, Ruling 12). Le décodeur accepte une espace après l'objet et une sorte inconnue de 32 caractères au plus (Ruling 24).
- Caractères « étiquette » U+E0000–E007F retirés des textes, sauf dans les drapeaux de sous-division RGI de la liste 15.0 (Angleterre, Écosse, Pays de Galles) ; LRM et RLM gardés (Ruling 13). Un texte sans aucun caractère visible est refusé (`texte_invalide`, Ruling 23) : un caractère visible n'est ni une espace, ni un invisible, ni une marque (caractère qui se lie au précédent dans la segmentation en graphèmes UAX #29 : Extend, SpacingMark, ZWJ, la même définition que pour les pseudonymes ; une teinte de peau seule en est une), ni U+2800 (motif braille vide) ; une marque seule, plusieurs marques, ou une marque posée sur une espace ne suffisent pas (constat T8, 12 novembre ; la table `General_Category=Mark` d'`unicode-normalization` aurait ajouté environ 6 Ko brotli au module, au-delà du plafond de 430 000 octets).
- Pseudonymes : unicité par le **squelette des confusables UTS #39** (`unicode-security`, Ruling 9) : « 0 » et « o », « 1 », « l » et « I », et « m » et « rn » sont confondus (Ruling 24) ; les marques restent (« Léa » et « Lea » diffèrent). L'apostrophe ’ (U+2019) est acceptée et ramenée à `'` (Ruling 10). Une marque doit porter sur une lettre ou un chiffre (Ruling 14). **Une seule écriture**, plus strict que « Highly Restrictive » d'UTS #39 (« Taro太郎 » est refusé). **U+200C et U+200D retirés** : le persan et les conjointes indiennes en souffrent ; accepté, publics visés FR/EN/ES/PT, signalé au propriétaire.
- Les versions Unicode de chaque table (normalisation, écritures, segmentation, UTS #39, émojis) sont enregistrées dans `engine/vectors/salon-v3.json` (clé `unicode`) : les apps utilisent les mêmes versions ou régénèrent les vecteurs.

**MLS** (`engine/salon/src/groupe.rs`)
- Le premier Commit d'une époque, dans l'ordre du serveur, gagne ; les autres sont rejetés et refaits (`commitPerdu`). Seuls les ajouts et retraits **en ligne** sont acceptés.
- Une feuille par siège. Retour après rechargement : le KeyPackage du siège ajoute une nouvelle feuille et **retire l'ancienne dans le même Commit** (Ruling 2) ; `retirer(siège)` retire toutes les feuilles du siège.
- Un ajout n'est accepté que si la clé de signature de la feuille est celle du premier KeyPackage valide envoyé **par ce siège**, le siège étant celui que le serveur atteste pour la trame (Ruling 20).
- Retrait d'un siège parti (`0x03`) ou exclu : tout membre peut le faire ; un membre présent : le créateur seul (Ruling 18).
- Durée de vie des KeyPackage non bornée, `Lifetime::init(0, u64::MAX)` (identités éphémères, Ruling 21) ; KeyPackage « dernier recours » ; clé d'initialisation effacée après l'entrée dans le groupe.
- Le Welcome n'est libéré que si **notre** Commit revient gagnant (`CommitAccepte { welcome }`, Ruling 17).
- Le nouveau venu vérifie le siège du créateur et que les (siège, nonce) de l'arbre **ne contredisent pas** la liste annoncée (une feuille d'un siège absent de la liste est un parti pas encore retiré ; un siège annoncé peut ne pas encore avoir de feuille), avec la clé enregistrée de chaque siège (Ruling 22) ; la liste prise est celle **au rang du Commit qui l'ajoute** (12 novembre, ci-dessous).
- **Arrivée sans perte** (constat I1, 12 novembre) : l'arrivant passe **toutes** les trames à `recevoirTrame` dès la création de son `Salon`. Avant son Welcome, le moteur les garde (et les annonces : `annoncer`, `marquerParti`, `remplacerAnnonces`), 2 000 entrées au plus (au-delà `attente_pleine` : l'arrivant recommence comme nouvel arrivant), sans rien lire que les KeyPackages (retenus). Le Welcome fait pour son KeyPackage le fait entrer (il n'y a plus de `rejoindre` séparé : la poignée est forcément celle du KeyPackage, Ruling 15) ; la file est rejouée dans l'ordre `seq`, annonces comprises, et l'événement `entree` donne pour chaque trame gardée son `seq` et son événement (ou son erreur). Un message ou un renouvellement rangé entre le Commit qui l'ajoute et son Welcome n'est donc plus perdu.
- **Siège attesté** (constat M4, 12 novembre) : le siège de la credential MLS de l'auteur d'un message ou d'un Commit doit être le siège que le serveur atteste pour la trame ; sinon `message_invalide` (avant toute fusion ; un message déjà déchiffré pour le savoir est perdu). `ajouter` refuse une arrivée déjà membre (`deja_membre`).
- **Suites** : un KeyPackage ou un Welcome d'une autre suite que 0x0001 est refusé avant toute vérification de signature (constat M3).
- **Aléa** : le moteur tire les nonces des trames et l'identifiant d'un message que l'appelant ne donne pas (getrandom, `crypto.getRandomValues` dans le navigateur, constat M5) ; la forme de `sceller` à nonce donné est interne au moteur (vecteurs).
- **Renouvellement** : à la charge de l'appelant, toutes les 100 trames envoyées (volatiles comprises : elles avancent le même compteur MLS) et toutes les heures (`renouveler`). OpenMLS saute au plus 1 000 générations d'un même expéditeur : au-delà (trames perdues), ses messages sont refusés (`mls_invalide`) jusqu'au Commit suivant.

**Risques résiduels**
- **Membres fantômes** : un serveur malveillant peut faire ajouter un faux membre, et un membre malveillant peut construire pour un nouveau venu un **faux groupe**, qui peut aussi omettre des membres. Seuls les **codes de vérification** (§9, point 4) les révèlent (Ruling 19) ; aucun service d'authentification.
- **Siège attesté du Welcome** (C-2 Task 1) : un serveur qui ment sur l'expéditeur d'un Welcome force le repli « aucun candidat » : la file d'attente n'est pas rejouée pour cette entrée (messages perdus pour l'arrivant), sans gain de confidentialité ; le premier instantané d'annonces qui valide peut précéder le vrai Commit (risque « faux groupe », Ruling 19).
- **Clés volées** (remplace le risque 21 de la spec principale) : un attaquant qui a volé les clés d'un membre peut lire jusqu'à ce que ce membre soit retiré ou qu'un nouveau Commit renouvelle sa feuille ; ensuite la confidentialité est rétablie (sécurité après compromission de MLS).
- Un Commit qui échoue chez une partie du groupe est inhérent à MLS : ce membre est en retard (`epoque_perdue`).
- Les tampons temporaires d'OpenMLS ne sont **pas** effacés ; notre stockage efface ses valeurs (postcard, à l'écrasement, à la suppression et à la destruction). Le texte des messages (`String`) n'est pas effacé non plus : « secrets » vise les clés.

**Exigences pour C-2 (serveur)**
1. Chaque enregistrement de trame porte le **siège expéditeur attesté** (`0x01`, §39.3.1) : le moteur le reçoit dans `recevoir`.
2. L'accueil WebSocket livre, avant toute trame, la **liste complète (siège, nonce_arrivée)** avec le `seq` auquel elle s'applique (point resté ouvert depuis la Task 6).
3. Un `0x02` ou `0x0A` précède toujours les trames qui s'y rapportent (Ruling 16).
4. Si la file rejouée ne contient plus les KeyPackage des arrivants en attente, le serveur les rejoue ou les arrivants les republient.
5. Un membre en retard (`epoque_perdue`) rentre comme nouvel arrivant.
6. **Heure de réception** (constat I3, 12 novembre) : le serveur remet avec chaque trame l'heure à laquelle il l'a reçue (en mémoire seulement, jamais sur disque) ; c'est d'elle que partent 10 min et 1 h, chez le serveur comme chez les membres, jamais de `heure_ms` (choisie par l'expéditeur, affichage seulement).
7. **Ordre** (constat I5, 12 novembre) : `seq` strictement croissant dans le salon ; à la (re)connexion, tout le rattrapage avant le direct ; les trames volatiles (relayées sans être écrites) prennent un `seq` du même compteur ; le client ignore tout rang inférieur ou égal au dernier vu (le moteur le fait).
8. **Retrait et effacement** (« retirer pour tous », lu en « instantané ») désignent la trame par son `seq` et ne sont acceptés que du siège attesté qui l'a envoyée (retrait) ou de chaque lecteur pour lui-même (lu).

**Exigences pour C-3 (interface)**
1. La colle JavaScript du module (~32 Ko) reste **hors du script principal** des pages de partage (pas d'`import()` dynamique, §28.3) : point d'entrée ou script à part sous SRI, plus un contrôle de `check-dist`.
2. L'image Docker construit le module du salon dès qu'une page l'importe (étape `engine` de `deploy/Dockerfile` ; `salon/pkg/` comparé par `repro-docker`).
3. `encore_dans_conversation` = « n'a pas quitté depuis qu'il l'a vu » (contrat de l'appelant).
4. L'interface utilise `nettoyerTexte`, `verifierPseudo`, `cleUnicite` et `nettoyerNom` du moteur, jamais `safeName` ni `Intl.Segmenter`.
5. L'appelant met à zéro ce que le module lui rend : `K_accès_s` et `K_preuve_s` (envoyés au serveur), graines `r` des enveloppes lues, clé SFrame (Ruling 26).
6. L'arrivant passe toutes les trames (avec `seq` et siège attesté) à `recevoirTrame` de la poignée qui a fait son KeyPackage, dès sa création (Ruling 15) ; il traite l'événement `entree` (trames rejouées, dans l'ordre) comme des événements reçus en direct. `attente_pleine` : il recommence comme nouvel arrivant.
7. Après une panique (`salon_casse`), recharger le module (`loadSalonEngine` efface d'abord la mémoire de l'instance arrêtée) et rejoindre avec une nouvelle identité.
8. **Effacement 10 min / 1 h** (I3) : `envoye_ms` d'`etatEffacement` est l'heure de réception remise par le serveur (exigence C-2 6), jamais `heureMs`.
9. **Changement de clé** (constat I4) : un siège à la fois dans `ajoutes` et `retires` (retour après rechargement, ou clé substituée par le serveur, qui y ressemble) affiche « Le code de vérification de X a changé » et annule la vérification faite pour lui.
10. **Modifier, retirer, réagir** (I5) : `modif` et `retrait` ne valent que de l'auteur du message visé (`deSiege` égal) ; un identifiant de message déjà vu : le premier en ordre `seq` gagne, les doublons sont ignorés ; les accusés (`recu`, `vu`) sont comptés par `deSiege`, une fois par siège.
11. **Pseudonymes** (I5) : chaque client applique l'unicité (`cleUnicite`) à la réception d'un `profil` : si la clé est déjà celle d'un autre siège présent, le premier en ordre `seq` garde le pseudonyme ; l'autre siège est affiché sous un nom neutre (« Participant 3 ») et, si c'est lui-même, son client le renvoie au champ (§39.4, point 4).
12. **Renouvellement** (I5) : `renouveler` toutes les 100 trames envoyées (volatiles comprises) et toutes les heures ; un `commit_en_cours` ou `commitPerdu` se rejoue ensuite.
13. **« Instantané » après rechargement** (I5, §3.6) : l'expéditeur renvoie sous la nouvelle époque, pour le revenant, ses messages « instantané » qu'il n'a pas encore lus ; le serveur libère l'ancienne trame quand tous les sièges présents l'ont lue sous l'une ou l'autre forme (l'ancienne feuille du revenant ne compte plus).

#### 3.6.2 Restes de C-1 à corriger avant C-3 (relecture finale, 12 novembre)

- **N1 (faible)** : `appliquer_en_attente` retient un KeyPackage mis en file sans vérifier son en-tête ; un siège qui envoie un KeyPackage mal étiqueté puis un bon peut faire échouer l'entrée d'un autre arrivant (déni de service). Correction : n'appeler `key_package_recu` que si l'en-tête est celui des trames de contrôle ; test. **Corrigé (C-2 Task 1).**
- **N2 (faible)** : le Commit qui ajoute l'arrivant est repéré par des champs non authentifiés ; une trame injectée ou un Commit refusé par tous peut fausser le rang des annonces utilisé pour vérifier le Welcome. Correction : prendre le premier Commit de l'époque E−1 dont le siège attesté est celui de l'expéditeur du Welcome ; à défaut, réessayer au Commit suivant ; vérifier aussi le siège attesté du Welcome. **Corrigé (C-2 Task 1).**
- **N3 (doc)** : `message.rs` : la doc de `est_volatile` est passée au-dessus de `nouvel_id`. **Corrigé (C-2 Task 1).**
- **KeyPackages restants** : à l'entrée, effacer toutes les clés d'init des KeyPackages produits par ce salon, pas seulement celles nommées par le Welcome. **Corrigé (C-2 Task 1).**

## 4. Messages

### 4.1 Sortes (dans le chiffré, JSON strict de §8)

`texte`, `piece` (fichier, photo, vidéo, vocal), `reaction`, `reponse` (citation), `modif`, `retrait`, `ecrit`, `recu`, `vu`, `regle` (règle d'effacement), `profil` (pseudonyme, couleur, avatar), `depart`. Chaque message a un identifiant aléatoire de 16 octets et l'heure d'envoi de l'expéditeur (affichage seulement).

### 4.2 Texte, émojis, réactions, réponses, retrait

Comme §39.5 : 2 000 graphèmes au plus, sinon proposé en fichier `.txt` ; liens `https?://` cliquables sans aperçu ; aucun Markdown ; émojis de la police du système, sélecteur sans téléchargement ; réactions ; réponse avec extrait ; **retrait pour tous** en direct (le message devient « Message retiré » chez tous, sa trame quitte la file du serveur, sa pièce est effacée du disque ; « Ceux qui l'ont déjà vu ont pu le copier »).

### 4.3 Modifier un message (nouveau)

- Ses propres messages texte seulement, tant qu'ils existent. Le nouveau texte remplace l'ancien chez tous, avec la mention « modifié ». Aucun historique des versions n'est gardé.
- Un message déjà effacé chez quelqu'un (règle d'effacement) ne réapparaît pas pour lui.
- Texte : « Modifié pour tout le monde. Ceux qui ont vu l'ancienne version ont pu la copier. »

### 4.4 Vocaux et fichiers dans la conversation

Comme §39.5 : vocal enregistré dans la conversation (10 min au plus), lu sur place ; fichiers de tout type, nombre illimité dans le budget (1 Go au total, 500 Mo par fichier), nettoyés comme les partages ; images et vocaux de 16 Mo au plus affichés d'office, le reste au clic avec « Enregistrer ». Ajouts : lecture des vocaux à 1×, 1,5×, 2× ; galerie des photos et vidéos du salon ; glisser-déposer et coller une image.

## 5. Effacement des messages (décision du propriétaire)

- **Durée de vie du salon** : choisie à la création (1, 6, 12 ou 24 h), inchangée. À la fin, tout s'efface.
- **Règle d'effacement des messages**, une par salon, 4 choix :
  - **Désactivé** (par défaut) : un message reste jusqu'à la fin du salon.
  - **Instantané** (précisé par le propriétaire le 11 novembre) :
    - pour chaque lecteur, un message qu'il a vu s'efface de son écran **dès qu'il quitte la conversation** (fermer l'app ou l'onglet, changer d'app, changer d'onglet ou d'écran dans l'app) ; s'il reste dans la conversation, il s'efface **1 minute** après qu'il l'a vu, avec un compte à rebours dans le message ;
    - au-dessus du message, le **nombre de personnes qui l'ont lu** (« Lu par 2 / 3 ») ;
    - seuls **l'expéditeur et ceux qui ne l'ont pas encore lu** le voient encore ;
    - un participant absent (coupure, onglet fermé, siège gardé) le **verra à son retour** : il n'est jamais sauté ;
    - quand **le dernier participant** l'a lu, le message **disparaît pour tout le monde, expéditeur compris**, et quitte le serveur (trame et pièce).
    - Un participant qui quitte le salon (« Quitter ») ou en est exclu ne compte plus parmi ceux qui doivent le lire.
    - Un participant coupé pendant l'effacement l'apprend en se reconnectant : le serveur lui renvoie, dès l'accueil, l'avis d'effacement (`0x0E`) de chaque message « instantané » effacé par lecture ou par départ qu'il a pu recevoir avant sa coupure (décision du 12 novembre, plan C-2 « Protocole »).
    - Les messages en attente sont gardés sur le disque du salon (§5.1) jusqu'à la dernière lecture.
  - **10 minutes** et **1 heure** : comptées **depuis l'envoi**, pour tout le monde, expéditeur compris. Un message que personne n'a lu dans ce délai est effacé sans avoir été lu. Compte à rebours visible dans le message.
- **Qui la change** : **tout participant**, à tout moment. Chaque changement s'affiche dans la conversation : « Léa a réglé l'effacement des messages sur 10 minutes ». La règle s'applique aux messages envoyés **après** le changement ; un message garde la règle de son envoi (elle voyage avec lui, chiffrée).
- **« Vu »** au sens de l'effacement : le message a été affiché à l'écran, page visible, au moins 1 seconde (`IntersectionObserver` et `visibilitychange`).
- **Ce que fait « effacé »** : le message quitte l'écran et la mémoire de la page (URL blob révoquées, pièce oubliée) ; sur le serveur, sa trame quitte la file et sa pièce est effacée du disque dès que la règle le permet pour tous.
- **Honnêteté, à afficher** : « L'effacement se fait sur les appareils des participants. Une capture d'écran, une photo de l'écran ou une app modifiée peuvent garder un message. »
- **Choix du propriétaire (11 novembre)** : en « Instantané », un participant absent qui ne revient pas garde le message en attente jusqu'à son retour, son départ, son exclusion ou la fin du salon (24 h au plus) ; l'expéditeur voit « Lu par 2 / 3 » pendant ce temps.

### 5.1 Conversation sur disque, messages sans limite (décisions du propriétaire, 11 novembre)

**Décisions** : (1) la conversation est **écrite sur le disque du serveur**, chiffrée de bout en bout, pour ne pas remplir la mémoire ; ce n'est pas un fichier temporaire de secours mais le stockage normal du salon jusqu'à sa fin. (2) Les **fichiers** (PDF, photos, vidéos, archives…) consomment la capacité du salon (1 Go, §39.1). (3) Les **messages écrits et vocaux** sont **sans limite** et ne consomment pas cette capacité : un salon plein de fichiers permet toujours d'écrire et d'envoyer des vocaux. (4) **Appels audio et vidéo : fonctions payantes** (§8). Remplace « relais en mémoire seulement » (§39.3.2) et le budget des trames (§39.1).

**Stockage**
- Un fichier par salon (`salons/{id interne}`), écrit en ajout : chaque trame de 4 140 octets telle qu'elle est arrivée (chiffrée de bout en bout par MLS, puis sous `K_trame`). Le serveur ne peut lire ni le contenu, ni le type, ni l'expéditeur, comme en mémoire.
- **Seconde couche** : le fichier est chiffré par le serveur (AES-256-GCM, bibliothèque standard de Go) avec une clé aléatoire par salon gardée **en mémoire seulement**. À la fin du salon, la clé est oubliée puis le fichier effacé ; un disque saisi ou copié ne donne rien de plus que des trames illisibles, même sans `K_trame`. **Conséquence assumée** : un redémarrage du serveur rend la conversation illisible (comme avant, où tout était en mémoire) ; les pages ouvertes rentrent et continuent.
- **Retrait et effacement** : une trame retirée (« retirer pour tous ») ou effacée par la règle (§5) est **écrasée** dans le fichier (zéros) et ne sera plus servie.
- **Rattrapage** : un participant qui revient après une coupure reçoit toutes les trames depuis son dernier `seq`, sans limite de 200 trames ni de 15 min (§39.3.2 remplacé). Un nouveau venu ne lit toujours rien d'avant son arrivée (MLS).
- Jamais : pseudonymes, adresses, heures en clair dans la base ; fichier sans date (dates remises à zéro, `O_NOATIME`, comme les partages).

**Pourquoi des bornes restent nécessaires, sans compter les messages (signalements)**
- **Élevé, abus du vocal** : le serveur ne peut pas savoir qu'un vocal est un vocal (tout est chiffré). « Vocal illimité » permettrait à un client modifié de déposer n'importe quel fichier en le disant vocal, et de contourner le 1 Go. **Retenu** : les vocaux ne comptent pas dans le 1 Go mais suivent la **vitesse d'une vraie voix** : chaque personne dispose de 4 Ko par seconde de présence dans le salon (une voix Opus en consomme environ 3), cumulés jusqu'à 1 h de réserve. Une personne qui parle sans arrêt n'est jamais bloquée ; un faux vocal d'un gros fichier l'est.
- **Moyen, abus du texte** : un robot à 60 trames par minute écrit 350 Mo par jour et par siège. **Retenu** : la cadence actuelle (60 par minute, rafale 20) plus un plafond de **1 200 messages par heure et par personne** (un toutes les 3 s en continu, au-delà de toute conversation humaine). Les « en train d'écrire », accusés et présence (§6, §39.3.7) sont relayés **sans être écrits sur le disque**, signalés par un bit de l'enveloppe extérieure ; **fuite assumée** : le serveur distingue ces trames brèves des messages, ce qu'il pouvait déjà déduire de leur rythme (S34).
- **Garde-fou global** : l'ensemble compte dans `SHH_STORAGE_MAX` ; disque presque plein → plus de nouveaux salons (503 `busy`), les salons ouverts continuent.

**Abonnements** (plus tard, §39.11, §38.8) : plus de capacité de fichiers, de durée, de participants ; appels audio et vidéo. Pas de salon payant avant l'avis du juriste.

## 6. Accusés : envoyé, reçu, vu (décision : toujours actifs)

- **Envoyé** (une coche) : le serveur a accepté la trame. **Reçu** (deux coches) : chaque participant l'a déchiffrée. **Vu** (deux coches de couleur) : chaque participant l'a vue (§5). Dans un groupe : « Vu par 2 / 3 », et la liste au toucher.
- Pas de réglage pour les couper (décision du propriétaire). **Signalement (faible, confidentialité)** : chacun sait quand les autres lisent ; c'est dit sur la page d'explication. Les accusés sont des trames chiffrées de taille fixe : le serveur ne sait pas que ce sont des accusés, mais voit leur rythme.

## 7. Identité dans le salon

### 7.1 Pseudonyme

Choisi sur la page d'explication avant d'entrer (§39.4, règles de forme et d'unicité inchangées). **Modifiable** ensuite (nouveau) : même contrôle, ligne « Léa s'appelle maintenant Lou » dans la conversation. La couleur reste.

### 7.2 Avatar

- **Par défaut** : initiale du pseudonyme sur un disque de la couleur du participant, dessinée par l'app (aucune image téléchargée).
- **Photo pour ce salon** (avec ou sans compte) : choisie dans la galerie ou prise sur place ; recadrée en carré, **ré-encodée** à 256 × 256 (toutes les métadonnées disparaissent, vignette comprise : c'est une nouvelle image) ; 64 Ko au plus ; envoyée comme pièce chiffrée (comptée dans le budget) et annoncée par un message `profil`. Oubliée à la fin du salon.
- **Avec un compte** (quand le compte existera, Tasks A1 à A3, §37) : photo gardée dans le coffre chiffré du compte et proposée à l'entrée de chaque salon. Le serveur ne la voit jamais. **Amendement de §37** : un avatar chiffré est permis ; pseudonymes, contacts et annuaires côté serveur restent exclus.
- **Signalement (moyen, abus)** : une photo peut être choquante ou illégale. Chacun peut masquer l'avatar d'un participant pour soi ; le signalement existant (§39.5) s'applique.

## 8. Appels audio et vidéo : plus tard, payants, mais préparés

**Fonctions payantes** (décision du propriétaire, 11 novembre). Rien n'est codé maintenant. Contraintes posées dès aujourd'hui pour ne rien bloquer :

- **Jamais en direct entre participants** : un appel direct révélerait l'adresse IP de chacun aux autres (contraire à §39.3.1). Les appels passeront par un relais de notre serveur (TURN, mode « relais seulement »).
- **Chiffrés de bout en bout** par SFrame (norme RFC 9605), avec une clé tirée de l'exporteur MLS du groupe : le relais ne voit que du chiffré.
- Le format des messages réserve les sortes `appel_*` (invitation, réponse, fin) ; une spécification des appels sera écrite et validée avant tout code (coût en bande passante, cadre légal).

## 9. Ajouts proposés (« ce que je ne t'ai pas dit »)

1. Coches envoyé / reçu / vu (§6).
2. Répondre, réagir, modifier, retirer : appui long (téléphone) ou survol (ordinateur).
3. Mentions `@pseudo`, mises en évidence chez la personne citée.
4. **Code de vérification** par participant (empreinte de sa clé, 4 groupes de 5 chiffres) à comparer de vive voix : prouve que personne ne s'est glissé dans la conversation.
5. Galerie des photos et vidéos du salon ; lecture des vocaux 1× / 1,5× / 2×.
6. Flèche vers le bas (icône seule, nom accessible « Aller aux derniers messages ») avec une pastille du nombre de non-lus ; séparateur « Nouveaux messages ».
7. Brouillon gardé en mémoire de la page quand on change d'écran.
8. Reprise automatique après une coupure (déjà prévue), notice si des messages ont pu manquer.
9. Titre de l'onglet « (3) Shhdrop » sans contenu (déjà prévu).
10. Refusés, par confidentialité : aperçus de liens, notifications push (service tiers), localisation, transfert vers un autre salon.

## 10. Ce que voit le serveur (complète §39.3.8)

Inchangé : trames de taille unique ; contenu, type de message et expéditeur cachés. **Nouveau (décision du 11 novembre, prise pour que l'effacement ne dépende pas de l'appareil de l'expéditeur)** :

- **En-tête en clair de chaque trame** (authentifié, pas chiffré) : volatile ou non (§5.1) et règle d'effacement (désactivé, instantané, 10 min, 1 h). Le serveur efface lui-même du disque une trame « 10 min » ou « 1 h » à l'échéance, sans attendre personne.
- **Lectures en « instantané »** : chaque lecteur envoie au serveur « lu » pour la trame (numéro `seq`) ; quand tous les sièges présents à l'envoi l'ont envoyé, ou sont partis, le serveur efface la trame et prévient les présents. **Fuite assumée (moyen)** : le serveur sait qui a lu quelle trame « instantané », et quand ; il ne sait toujours pas ce qu'elle contient. **Correction du 12 novembre (relecture C-2)** : il connaît en revanche le **siège** qui l'a envoyée (le serveur atteste le siège de chaque trame, §3.6.1), mais jamais le pseudonyme ni l'identité de la personne derrière ce siège. Sans cela, un message resterait sur le disque tant que l'expéditeur est hors ligne.
- Le rythme des trames par siège reste visible (S34).

## 11. Cadre légal

Inchangé (§39.7, Q-SAL8) : le salon reste désactivé en public (`SHH_SALONS=0`) tant qu'un juriste n'a pas validé ; il peut être activé pour un usage personnel.

## 12. Tests

Vecteurs communs du moteur (groupe, Commit, Welcome, découpage, enveloppe) ; tests du serveur (ordre des Commits, file, retrait, effacement par règle, limites) ; parcours Playwright à 3 participants dans 3 contextes de navigateur (texte, émojis, vocal, fichier, modifier, retirer, chaque règle d'effacement avec horloge simulée, « Vu », changement de pseudonyme et d'avatar, exclusion, coupure et reprise) ; test « le serveur ne voit rien » étendu au salon (aucun contenu, pseudonyme, avatar ni clé sur disque ou en clair dans la mémoire du serveur).

## 13. Découpage proposé

1. **C-1** Moteur : MLS (OpenMLS), enveloppe, découpage, formats des messages, vecteurs.
2. **C-2** Serveur : routes et WebSocket du salon (§39.3), ordre des Commits, retrait et effacement côté serveur.
3. **C-3** Écrans : création, entrée, page d'explication, conversation (texte, émojis, réactions, réponses, modifier, retirer, accusés, « écrit »).
4. **C-4** Pièces, vocaux, galerie, avatars.
5. **C-5** Règle d'effacement, code de vérification, exclusion, fin du salon, signalement.

Chaque étape a son plan détaillé, ses tests et sa revue avant la suivante.

## 14. Demandes du propriétaire du 12 novembre

Le propriétaire veut une conversation aussi proche que possible d'une messagerie moderne. Décisions prises par délégation (« prends les meilleures décisions »), avec les signalements.

### 14.1 En ligne, hors ligne, dernière connexion

- **En ligne** : point vert sur l'avatar et « en ligne » sous le pseudonyme, d'après `0x07`.
- **Hors ligne** : « vu aujourd'hui à 14:32 », « vu hier à 22:05 » ou « vu le 11 nov. à 09:10 », à la minute près, heure de l'appareil qui affiche.
- **Source de l'heure** : le serveur, qui connaît déjà les connexions (§10). Il garde **en mémoire seulement** l'heure de la dernière déconnexion de chaque siège, arrondie à la minute, et la joint à `0x07` hors ligne et à l'accueil (`0x0D` étendu). Rien sur le disque, rien après la fin du salon. Changement de protocole : tâche serveur C-2 Task 9b (ci-dessous).
- **Masquer ma dernière connexion** : réglage par personne. Le client l'annonce au serveur par un message de contrôle `0x06` (vide ou 1 octet, en mémoire seulement). Le serveur n'envoie alors plus l'heure de ce siège. Comme sur WhatsApp, l'effet est **réciproque** : qui masque la sienne ne voit plus celle des autres, appliqué par le serveur, pas seulement par l'écran.
- **Signalement (moyen, confidentialité)** : l'heure de dernière connexion apprend aux autres membres quand chacun utilise le salon. Elle est montrée par défaut, comme le veut le propriétaire. Correction proposée : réglage « Masquer » visible dès la page d'explication.
- **Signalement (faible)** : « en ligne » veut dire « WebSocket ouvert ». Un onglet ouvert en arrière-plan compte comme en ligne, comme sur les messageries web.

### 14.2 Coches des messages et des documents

- **Messages** (rappel de §6) : une coche grise = envoyé (accepté par le serveur), deux coches grises = reçu (déchiffré par chaque participant), deux coches de couleur = vu. Dans un groupe : « Vu par 2 / 3 » et la liste détaillée au toucher.
- **Documents et photos, nouveau** : deux accusés de plus, chiffrés comme les autres (sortes `piece_ouverte` et `piece_telechargee`) :
  - **Ouvert** (icône d'œil) : le fichier a été affiché dans la visionneuse de l'application ;
  - **Téléchargé** (flèche vers le bas) : le fichier a été enregistré sur l'appareil.
  Dans la fiche du message (appui long ou survol, « Infos ») : pour chaque participant, envoyé, reçu, vu, ouvert, téléchargé, avec l'heure.
- Toujours actifs, comme « Vu » (décision du propriétaire pour §6). **Signalement (faible, confidentialité)** : l'expéditeur sait si et quand chacun a ouvert ou enregistré son fichier ; c'est dit sur la page d'explication. Le serveur sait déjà qui télécharge une pièce (requête `GET`), pas qui l'ouvre ni qui l'enregistre.

### 14.3 Sélection multiple

- **Envoi** : choisir plusieurs photos, vidéos ou documents d'un coup (galerie, fichiers, glisser-déposer). Chaque fichier devient une pièce et un message ; les photos et vidéos envoyées ensemble s'affichent groupées en **album** (grille de 2 à 4 vignettes, « +N »). La limite de 120 pièces par heure et par personne (C-2 Task 13) s'applique ; au-delà, l'écran dit combien attendre.
- **Réception** : mode sélection (appui long sur un message, ou case à cocher au survol) ; barre d'actions « Télécharger (N) », « Tout sélectionner ». Plusieurs fichiers partent en une seule archive `.zip` faite dans l'appareil (module `zip` existant, sans compression ni métadonnée), ou un par un si l'appareil le permet mieux (application native). Chaque fichier téléchargé envoie son accusé « Téléchargé ».
- Le budget de lecture par pièce (C-2 Task 13) s'applique : télécharger dix fois la même archive finit par être refusé, avec un message clair.

### 14.4 Son de nouveau message et mode silencieux

- **Son** : court, original, de style « tir laser de vaisseau spatial », **synthétisé dans l'appareil** (Web Audio : oscillateur en balayage descendant et petite enveloppe, environ 150 ms, volume modéré). Aucun fichier son, aucune ressource tierce. **Signalement (moyen, légal)** : ne pas reprendre un son connu d'un film ou d'un jeu (droits d'auteur) ; le son est créé pour Shhdrop.
- **Quand** : à la réception d'un message d'un autre participant (jamais pour ses propres messages, accusés, « écrit » ou présences) ; au plus un son toutes les 2 secondes ; pas de son si la conversation est affichée, au premier plan et déjà en bas (on voit le message).
- **Silencieux** : bouton cloche barrée dans l'en-tête de la conversation, « Mettre en silencieux » (toujours, 1 h, 8 h). Le titre de l'onglet compte encore les non-lus.
- **Où le réglage est gardé** : la leçon du nettoyage automatique (un réglage perdu à chaque visite est inutile) s'applique. Le réglage est gardé dans la base locale chiffrée de l'appareil (même principe que `shhdrop-returns` : AES-GCM, clé non extractible), rattachée au salon et **effacée à la fin du salon** ou par « Effacer l'historique ». Aucun réglage n'est envoyé au serveur.
- **Refusé** : notifications push par un service tiers (§9, point 10). Une notification système locale (« Nouveau message », sans contenu ni pseudonyme) pourra être proposée plus tard, après accord explicite du navigateur.

### 14.5 Tâches ajoutées

- **C-2 Task 9b** (serveur) : heure de dernière déconnexion en mémoire, arrondie à la minute ; `0x07` hors ligne et `0x0D` étendus de 8 octets (minutes Unix, 0 = inconnue ou masquée) ; contrôle `0x06` « masquer », réciproque ; tests : heure jamais sur disque, masquage réciproque, fin du salon. Les tailles du protocole (§ « Protocole » du plan C-2) changent : `0x07` passe de 11 à 19 octets, une annonce de `0x0D` de 17 à 25.
- **C-3** : présence, dernière connexion, coches des messages, son, silencieux.
- **C-4** : coches des documents, sélection multiple à l'envoi et à la réception, albums, archive.
