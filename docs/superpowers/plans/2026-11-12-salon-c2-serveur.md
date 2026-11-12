# Salon v3, étape C-2 : serveur Go du salon — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** le serveur Go du salon (désactivé par défaut) : création, entrée par mot de passe, sièges, WebSocket ordonné avec rattrapage, conversation chiffrée sur disque sous une seconde couche AES-256-GCM dont la clé ne vit qu'en mémoire, effacement par règle et par lectures, limites, pièces jointes, exclusion, fin de vie ; après correction des restes N1, N2, N3 du moteur.

**Architecture :** nouveau paquet `server/internal/salon` sans dépendance HTTP (état en mémoire par salon, fichier de conversation, pièces, effacement, limites), piloté par `server/internal/api` (routes JSON strictes, mise à niveau WebSocket par `github.com/coder/websocket`, adaptée derrière une interface `salon.Lien` pour tester les délais sous `testing/synctest`). Le serveur ne déchiffre rien : il lit seulement l'octet `drapeaux` de chaque trame (copie Go de `lire_en_tete`, testée contre `engine/vectors/salon-v3.json`). Tout ce qui décrit les personnes (sièges, jetons, heures de réception, lectures) reste en mémoire ; la base ne garde que les colonnes de §39.3.5.

**Tech Stack :** Go (go.mod : `go 1.26.0`, toolchain go1.27.4), `modernc.org/sqlite` v1.62.0 (déjà là), `github.com/coder/websocket` **v1.8.15** (15 juin 2026, licence ISC, aucune dépendance transitive), `crypto/aes` + `crypto/cipher` (AES-256-GCM), `testing/synctest` ; Rust 1.99.1 pour les restes du moteur (`engine/salon`) ; vitest 5.1.0 sous Node 22 (WebSocket natif) pour l'e2e avec le vrai module wasm du salon.

**Spec :** `docs/superpowers/specs/2026-11-11-salon-v3-design.md` (§3.2, §3.2.1, §3.6.1 « Exigences pour C-2 » 1 à 8, §3.6.2, §5, §5.1, §10, §11) ; `docs/superpowers/specs/2026-11-03-shhdrop-design.md` §39.1, §39.3 (entier), §39.4, §39.13, D41-24, D41-26. Là où §39 contredit la v3 (mémoire seule, budget des trames, libsodium), la v3 fait foi.

## Points à trancher (décisions prises dans ce plan, à valider par le propriétaire)

Chaque point : gravité, endroit, problème, correction retenue ici.

1. **Élevée — siège du créateur (moteur `remplacer_annonces(createur_siege, …)`, §39.3.3).** Le serveur ne sait pas quel siège est le créateur ; un invité peut entrer avant lui. **Retenu :** le siège **0** est réservé au créateur pour toute la vie du salon : `rejoindre` avec `X-Shh-Manage` juste donne toujours le siège 0 (s'il est occupé, l'ancien jeton est révoqué et la reprise annoncée par `0x0A`) ; les invités prennent le plus petit siège libre de 1 à 9, tant que `sièges invités occupés < max_members − 1`. Le siège 0 n'est jamais donné à quelqu'un d'autre (sinon le nouveau venu hériterait des droits du créateur dans la politique MLS). Les tests du moteur posent déjà le créateur au siège 0.
2. **Élevée — pièce d'un message effacé (v3 §5 « sa pièce est effacée du disque dès que la règle le permet », §10).** Le serveur ne peut pas savoir quelle trame porte quelle pièce. **Retenu :** le message client `0x01` peut porter, après la trame, l'identifiant de la pièce (16 octets) ; la pièce suit alors la vie de sa trame (retrait, 10 min, 1 h, « instantané », fin). Une pièce finalisée et jamais liée est effacée 15 min après sa finalisation. **Fuite à ajouter à §10 :** le serveur sait quelle trame porte une pièce (il le devinait déjà par le rythme).
3. **Élevée — vocaux et paliers (v3 §5.1 « jamais bloquée »).** La réserve se débite en octets chiffrés du palier : un vocal de 22 s à 5 min prend le palier 16 (1 048 880 o, 262 s de réserve à 4 000 o/s). Une personne qui envoie un vocal de 30 s par minute est bloquée au bout d'environ 25 min. **Retenu pour C-2 :** pièce `vocal: true`, paliers `{1, 16, 80}` (10 min tiennent dans 80), hors du budget de 1 Go, débitée de la réserve. **Proposé pour C-4 :** paliers vocaux en puissances de deux `{1, 2, 4, …, 128}` (surcoût ≤ 2×) ; cela demande de changer `palier_valide` du moteur pour la sorte `vocal` et la constante `VocalPaliers` du serveur. **Fuite à ajouter à §10 :** le serveur sait qu'une pièce est un vocal.
4. **Moyenne — durée du siège hors ligne (D41-24 « réservé toute la vie » contre D41-26 « 10 min, proposé », v3 §5 « 24 h au plus »).** **Retenu :** 10 min hors ligne (D41-26, dernier texte sur ce point), puis départ `0x03` : le siège ne compte plus pour l'« instantané ». Un absent revenu dans les 10 min retrouve ses messages en attente.
5. **Moyenne — reprise ou simple reconnexion (accueil de 51 octets, §39.3.1).** Après une coupure, la page garde son état MLS (même `nonce_arrivée`) ; après un rechargement (D41-26) ou `epoque_perdue` (exigence 5), elle tire une nouvelle identité et il faut un nouveau `nonce_arrivée` (`0x0A`). L'accueil ne dit pas lequel des deux. **Retenu :** `depuis = 0xFFFFFFFFFFFFFFFF` signifie « reprise » (nouveau nonce, aucun rattrapage) ; toute autre valeur est une reconnexion (même nonce, rattrapage). Format inchangé (51 octets).
6. **Moyenne — enregistrements nouveaux (exigences 2, 6, 8).** Ajoutés : client `0x05` « lu » (`seq`) ; serveur `0x0D` liste des sièges, `0x0E` trame effacée ; heure de réception (8 octets, ms Unix) dans `0x01`, qui fait donc 4 158 octets. Seuls `0x01`, `0x02`, `0x03`, `0x09` et `0x0A` prennent un numéro du compteur `seq` ; les autres portent le dernier `seq` attribué, sans l'avancer. Détail dans « Protocole ».
7. **Moyenne — rattrapage et métadonnées (exigence 7, §39.3.8).** Avec la conversation sur disque, un nouveau venu qui demande `depuis = 0` recevrait toutes les trames passées (illisibles, mais avec sièges, heures, drapeaux). **Retenu :** `depuis` effectif = max(`depuis`, rang d'émission du jeton).
8. **Moyenne — « instantané » et arrivants pas encore entrés (v3 §5, §10).** Un siège occupé mais pas encore dans le groupe MLS ne pourra jamais lire les trames d'avant le Commit qui l'ajoute : il les bloquerait jusqu'à son départ. **Retenu :** côté serveur, les lecteurs attendus sont les sièges occupés à la réception, moins l'expéditeur ; une reprise retire le siège des trames antérieures (« l'ancienne feuille du revenant ne compte plus », C-3 point 13). **Exigence ajoutée pour C-3 :** le client envoie `0x05` pour toute trame « instantané » que le moteur lui rend `Ignore` (avant son entrée).
9. **Moyenne — exigence 4 (KeyPackages rejoués).** Le serveur ne distingue pas un KeyPackage (§3.2) : il ne peut pas « les rejouer » lui-même. **Retenu :** les trames non volatiles (dont les KeyPackages, en-tête de contrôle) sont gardées sur disque jusqu'à la fin et servies à chaque rattrapage. **Exigence ajoutée pour C-3 :** l'arrivant en attente republie son KeyPackage à chaque `0x07` « en ligne », `0x02` ou `0x0A` reçu (d'où le nettoyage de toutes les clés d'init, Task 1).
10. **Élevée, exploitation — disque et mémoire (v3 §5.1).** Au pire 1 200 messages/h × 10 sièges × 24 h = 288 000 trames ≈ 1,2 Go par salon sur disque (4 168 o par trame), et ≈ 7 Mo d'index en mémoire (24 o par trame) ; 200 salons = 240 Go ; relecture Task 12 : chaque nouvelle arrivée repart avec un seau horaire neuf, et les arrivées sont plafonnées à 5 × `max_members`, soit environ 60 000 trames (≈ 250 Mo) de plus par salon au pire, environ +20 % ; relecture Task 13 : les vocaux, hors du budget de 1 Go (illimités en nombre, voulu par le propriétaire), peuvent ajouter environ 3,5 Go par salon au pire (10 sièges × 4 000 o/s × 24 h) ; le garde-fou global `SHH_STORAGE_MAX` reste la protection du disque, plus que le défaut de `SHH_STORAGE_MAX` (200 Gio). **Retenu :** création refusée (503 `busy`) si l'usage total + 2 Gio dépasse `SHH_STORAGE_MAX` ; trames non volatiles refusées (`0x0C`) si une trame de plus le dépasse ; les partages comptent l'usage du salon. **Proposé :** `SHH_SALONS_MAX=50` pour l'usage personnel (défaut du code : 200, spec §39.3.2).
11. **Moyenne — redémarrage du serveur (v3 §5.1).** La clé de la seconde couche, les jetons et le plancher des pièces disparaissent : la conversation est illisible et un jeton neuf pourrait lire d'anciennes pièces. **Retenu :** au démarrage, effacement de tous les fichiers de conversation et de toutes les pièces (fichier puis ligne, `pieces_bytes = 0`), lignes des salons gardées (le lien et le mot de passe restent valables). **Pour C-3 :** jeton refusé (`4004`) → `rejoindre` et nouveau `Salon` du moteur (le `seq` repart de 1).
12. **Élevée, exploitation (C-3, C-5) — groupe MLS orphelin.** Si tous les membres rechargent (ou après un redémarrage), plus personne ne peut ajouter les autres : le salon ne sert plus. Rien côté serveur ; à spécifier en C-3 : le créateur (siège 0) refonde le groupe quand aucun membre en ligne n'est dans un groupe.
13. **Moyenne — `Origin` et apps natives (§39.3.1, CLAUDE.md).** Les clients WebSocket d'iOS et d'Android n'envoient pas `Origin` d'eux-mêmes. **Retenu :** contrôle strict (absent = refusé, 403) ; les apps envoient `Origin: https://shhdrop.app`. Nouvelle variable `SHH_ORIGIN`, obligatoire avec `SHH_SALONS=1` (elle sert aussi à la CSP `connect-src … wss://hôte`).
14. **Élevée, honnêteté (C-3) — page d'explication (§39.4 point 3).** « les messages ne sont jamais écrits sur le disque du serveur » et « Seule la capacité du salon (1 Go, messages et fichiers) a une limite » sont faux depuis la v3 §5.1 : textes à réécrire en C-3 (« écrits chiffrés sur le disque du serveur, effacés au plus tard à la fin du salon ; un redémarrage les rend illisibles »).
15. **Moyenne, légal — conversation sur disque (§39.7, Q-SAL8).** Stocker la conversation (même chiffrée) fait aussi de Shhdrop un hébergeur des messages, plus seulement des pièces : à soumettre au juriste avec le reste de Q-SAL8.
16. **Moyenne (C-5) — exclusion sous MLS (§39.13.2).** La trame `rotation` (`crypto_box_seal`) appartient aux clés d'expéditeur abandonnées ; le moteur n'a pas de sorte de message pour distribuer `K_maître_s'`. C-2 fait seulement la partie serveur de `exclure` ; C-5 doit spécifier la distribution (message MLS après le Commit qui retire l'exclu).
17. **Moyenne (C-3) — cadence et accusés toujours actifs.** À 10 personnes, un `recu` et un `vu` par message reçu dépassent vite 60 trames par minute. **Exigence pour C-3 :** grouper les accusés (`Recu { ids }`, `Vu { ids }`) en une trame au plus par top de 2,5 s.
18. **Faible — champ d'erreur.** §39.3.9 écrit `tries_left` ; les partages répondent `attempts_left`. **Retenu :** `attempts_left` (un seul code client, apps comprises).
19. **Faible — codes de fermeture.** §39.3.1 ne nomme que 4001 et 4002. **Retenu :** 4001 accueil absent ou invalide, 4002 jeton révoqué (exclusion), 4003 message invalide, 4004 jeton inconnu (place libérée, salon fini, redémarrage ; D41-26 disait 4002), 4005 remplacé, 4006 trop lent, 1000 fin du salon, 1001 arrêt du serveur.
20. **Faible, inutile — `0x04` trou et raison 3 « budget de flux ».** Sans objet avec la conversation sur disque et sans budget des trames : jamais émis, numéros réservés.
21. **Faible — réponse de `rejoindre`.** Ajout de `nonce_arrivee` (le client en a besoin pour `nouvelle_identite` avant le WebSocket) ; `budget_left` = 1 Gio − `pieces_bytes`. `GET /api/salons/gestion` : `present` = nombre de sièges occupés.
22. **Faible — pièces et quotas.** Les pièces passent par `limits.BeginUpload` : quotas journaliers et 2 envois non finalisés à la fois par connexion, partagés avec les partages (le client envoie ses pièces l'une après l'autre). Le budget de 1 Go est rendu quand une pièce est effacée. Volatiles : jamais servis au rattrapage ni à un client lent (rangs sautés, normal).
23. **Faible — outils.** `make test-go` ne lance pas `-race` (la CI le fait) : ajouté. Les dépendances Go (altcha, modernc, coder/websocket) ne figurent pas dans `THIRD_PARTY_LICENSES.md` : section ajoutée.

## Global Constraints

- CLAUDE.md : le serveur ne reçoit ni ne stocke aucun contenu, pseudonyme, nom de fichier, clé ou mot de passe en clair ; aucune adresse IP sur disque ni dans un journal ; aucune crypto maison (AES-256-GCM de la bibliothèque standard, SHA-256, `crypto/rand`) ; tests avant tout « fait » ; commits `git commit --author="Skoow <190851638+Skoow@users.noreply.github.com>"` sur `main`, message terminé par les lignes d'attribution de la session ; tests verts avant chaque push ; jamais « 100 % sécurisé ».
- Désactivé par défaut : `SHH_SALONS=0` → aucune route `/api/salons/*` (404 `not_found`, identique à une route inconnue) ; activation publique seulement après le juriste (Q-SAL8).
- Patrons existants : JSON strict (`readJSON`, clés exactes, sans doublon), secrets en base64url sans bourrage de longueur exacte (`share.DecodeB64`, 43 caractères pour 32 octets, 22 pour 16), réponses d'erreur fixes, `not_found` uniforme (salon inconnu, expiré, détruit, mauvaise `K_accès_s`), aucune sortie hors `SHH_LISTENING` et lignes fixes du janitor, quotas en HMAC du jour, débit minimal des segments (`pacer`, 32 Kio/s par tranches de 5 s), fichiers sans date (`wipeTimes`, `O_NOATIME`).
- Trame : **4 140 octets** ; `"SHC3"` ‖ `drapeaux` (bit 0 volatile, bits 1–2 règle 0 désactivé / 1 instantané / 2 10 min / 3 1 h, bits 3–7 à zéro). Bit réservé non nul ou marque fausse → trame refusée.
- Le serveur ordonne et ne juge pas le contenu : « un Commit par époque » est appliqué par les membres (premier dans l'ordre `seq`).
- Valeurs fixes (copiées des specs) :
  - durée 1, 6, 12 ou 24 h depuis la création, échéance arrondie au quart d'heure supérieur ; `max_members` 2 à 10 ; Argon2id `kdf_ops = 3`, `kdf_mem = 67108864` ; `salt` 16 octets ; `proof_v` 32 octets ;
  - sièges 0 à 9 ; arrivées totales `< 5 × max_members` ; 10 mots de passe faux → destruction ; siège hors ligne libéré après **10 min** ;
  - budget **1 073 741 824** octets de pièces (hors vocaux), palier ≤ **8 000** ; pièce = `48 + B × 65552` octets ; budget de lecture `share.ReadBudget(B)` par membre et par pièce ;
  - WebSocket : accueil **51 octets** dans les **5 s** (sinon 4001) ; `SetReadLimit(4200)` ; compression coupée ; ping serveur toutes les **20 s**, fermeture après **45 s** sans pong ni message ; file d'envoi **256** enregistrements ; retard > **5 s** ou écriture bloquée > **10 s** → raison 6 ; WebSocket ouverts **4** par connexion, **16** par /48, **2 000** au total ;
  - trames montantes : **60 par minute par siège (rafale 20)**, **120 par minute par connexion**, **600 par /48** ; messages non volatils : **1 200 par heure par siège** ; vocaux : **4 000 octets par seconde** de WebSocket ouvert, réserve plafonnée à **14 400 000** octets (1 h) ;
  - créations de salons : **5 par jour par connexion, 15 par /48**, preuve anti-robot (difficulté partagée avec les partages) ; `rejoindre` : **20 par heure par connexion, 60 par /48** ; `SHH_SALONS_MAX` défaut **200** salons vivants ;
  - effacement : 10 min = **600 000 ms**, 1 h = **3 600 000 ms**, comptés depuis l'heure de réception du serveur (jamais `heure_ms`).
- `GOARCH=386 go build ./...` doit passer (`make test-go`) : tailles en `int64`, `seq` en `uint64`.
- Vérifications : `cd server && go test -race ./...` puis `make test-go` à chaque tâche Go ; `make test-engine` à la Task 1 ; `make test-e2e` aux Tasks 16 et 17.

## Review Focus

1. **Reconnexion pendant un envoi soutenu** : un membre revient avec `depuis` pendant que d'autres envoient ; il doit tout recevoir dans l'ordre, sans trou ni doublon entre le rattrapage et le direct (Task 9, `TestRattrapagePuisDirectSansTrou`).
2. **Client qui ne lit plus, dans un salon actif** : mémoire du serveur bornée, autres membres non ralentis, fermeture raison 6 après 5 s de retard (Task 9, `TestClientLentBascule` et `TestClientLentFerme`).
3. **WebSocket qui dure plus longtemps que les délais HTTP** (`ReadTimeout`, `WriteTimeout` de 300 s posés sur la connexion avant la mise à niveau, `idle 1m` de Caddy) : la connexion doit vivre tant que les pings passent (Task 10, `TestWSSurvitAuxDelaisHTTP` ; Task 17, essai derrière Caddy).
4. **Disque plein en cours de salon** : trames refusées par `0x0C` sans écriture partielle, les partages et les autres salons continuent (« continuent » : connexions ouvertes, trames volatiles et lectures servies, aucune fermeture ; le plafond étant global, les autres salons reçoivent aussi `0x0C` pour une trame non volatile), création refusée (Task 12, `TestDisquePlein`).
5. **« Instantané » avec un lecteur qui ne revient pas** : la trame attend, puis la libération du siège après 10 min la fait effacer pour tous (`0x0E`) (Task 11, `TestInstantaneLibereParDepart`).

---

## Protocole (référence commune des tâches)

Entiers gros-boutistes. Messages binaires seulement (un message texte → fermeture 4003).

**Accueil (client, premier message, 51 octets)** : jeton de membre (43 caractères base64url) ‖ `depuis` (8). `depuis = 0xFFFFFFFFFFFFFFFF` : reprise (point 5).

**Client → serveur** (`type` (1) ‖ corps) :

| Type | Corps | Effet |
|---|---|---|
| `0x01` trame | 4 140 octets, ou 4 140 ‖ pièce (16 octets) | rangée, relayée à tous dont l'expéditeur ; pièce liée si elle est liable (ci-dessous) |
| `0x02` retirer | `seq` (8) | trame non volatile du siège attesté : écrasée, pièce liée effacée |
| `0x03` quitter | vide | départ (`0x03` diffusé), jeton oublié, fermeture 1000 |
| `0x04` ping | 8 octets | `0x08` avec les mêmes octets |
| `0x05` lu | `seq` (8) | lecture « instantané » de ce siège pour cette trame |

**Lien d'une trame à une pièce** (audit du 12 novembre, D6) : trame volatile avec une pièce, ou pièce d'un autre auteur (autre siège, ou ancien occupant du même siège) → 4003, sans rang consommé. Pièce disparue (inconnue, effacée, d'un autre salon), pas encore `ready` ou déjà liée → trame rangée et relayée **sans lien**, sans erreur : c'est une course honnête (pièce effacée après `PieceSansLien`, retirée depuis un autre onglet, message modifié qui renvoie l'id d'une pièce déjà liée). Règle du client (C-3) : une pièce introuvable (`404` à la lecture) s'affiche « pièce indisponible ».

Autres messages de contrôle (`0x02`–`0x05`) : 600 par minute et par WebSocket, au-delà fermeture 4003. Taille inexacte, type inconnu → 4003.

**Serveur → client** (`type` (1) ‖ `seq` (8) ‖ données) ; colonne « rang » : prend un nouveau `seq` (oui) ou porte le dernier attribué (non) :

| Type | Données | Rang |
|---|---|---|
| `0x01` trame | siège (1) ‖ reçue à (8, ms Unix) ‖ trame (4 140) — 4 158 octets en tout | oui |
| `0x02` arrivée | siège (1) ‖ `nonce_arrivée` (16) | oui |
| `0x03` départ | siège (1) | oui |
| `0x05` fin | raison (1) : 1 expiré, 2 détruit, 4 remplacé, 5 exclu, 6 trop lent | non |
| `0x07` présence | siège (1) ‖ 1 en ligne / 0 hors ligne | non |
| `0x08` pong | les 8 octets du ping | non |
| `0x09` exclusion | siège (1, `0xFF` sans exclu) ‖ `nonce_arrivée` (16) ‖ `r` (4) | oui |
| `0x0A` reprise | siège (1) ‖ nouveau `nonce_arrivée` (16) | oui |
| `0x0B` limite | secondes à attendre (4) | non |
| `0x0C` plein | — (trame non rangée : disque plein) | non |
| `0x0D` liste | créateur (1, toujours 0) ‖ n (1) ‖ n × (siège (1) ‖ `nonce_arrivée` (16)) ; `seq` = rang où elle s'applique | non |
| `0x0E` effacée | `seq` de la trame effacée (8) | non |

**Séquence d'accueil** : `0x0D` (état au rang `depuis` effectif = max(`depuis`, rang d'émission du jeton), plafonné au dernier rang) → un `0x07` par siège occupé → un `0x0E` par trame « instantané » effacée par lecture ou par départ dont le rang est dans (rang d'émission du jeton, `depuis` effectif] (trames que ce client a pu recevoir avant sa coupure ; jamais pour un retrait, que le client apprend par le message chiffré de l'expéditeur, ni pour 10 min et 1 h, qu'il compte lui-même) → rattrapage (trames non volatiles non effacées et `0x02`/`0x03`/`0x09`/`0x0A` de rang > `depuis`, fusionnés dans l'ordre `seq`) → direct. Reprise : `0x0A` diffusé, puis `0x0D` au rang de ce `0x0A`, `0x07`, direct (aucun rattrapage, aucun `0x0E` : nouvelle identité). Un `0x0E` ne fait jamais fermer une connexion ni sortir du direct : hors du direct, il est renvoyé au retour au direct (Task 11).

**Fichier de conversation** `salons/{id interne}` : un emplacement de **4 168 octets** par trame non volatile, dans l'ordre d'arrivée : `nonce` (12, aléatoire) ‖ AES-256-GCM(clé du salon, `nonce`, trame, données authentifiées = `"shhdrop/salon/disque/v1"` ‖ numéro d'emplacement (8)). Trame effacée : ses 4 168 octets écrasés de zéros. Aucun `seq`, siège, heure ou drapeau en clair sur le disque.

---

### Task 1 : moteur, restes N1, N2, N3 et clés d'init restantes

**Files :**
- Modify : `engine/salon/src/groupe.rs` (`appliquer_en_attente`, `entrer`, `recevoir_trame`, module `tests`), `engine/salon/src/message.rs` (doc de `est_volatile`)
- Test : `engine/salon/tests/groupe.rs`, module `tests` de `engine/salon/src/groupe.rs`

**Interfaces :**
- Produces : aucune API publique changée (`Salon::recevoir_trame(&mut self, cles, trame, seq, siege_emetteur)` inchangée ; `fn entrer(&mut self, welcome: Welcome, siege_welcome: u8)` interne). Vecteurs `salon-v3.json` inchangés.

- [ ] **Step 1 : tests qui échouent**
  - `n1_kp_mal_etiquete_ignore` (tests/groupe.rs) : le siège 3 (annoncé) envoie à un arrivant en attente X d'abord son KeyPackage scellé avec `EnTete { volatile: true, regle: Desactive }` (clé de signature K1, `recevoir_trame` → `Err(MessageInvalide)`), puis un vrai KeyPackage (clé K2) que les membres retiennent ; le créateur ajoute X ; `recevoir_trame` du Welcome chez X → `Ok(Evenement::Entree { .. })` (aujourd'hui `Err(MlsInvalide)` : K1 retenu au rejeu).
  - `n2_commit_refuse_avant_le_vrai` : à l'époque E−1, un Commit refusé par tous (siège 2, non créateur, qui retire un présent) est rangé avant le vrai Commit du créateur qui ajoute X ; entre les deux, le siège 4 fait une reprise (`annoncer(4, n2)`) et le vrai Commit remplace sa feuille ; le Welcome de X (siège attesté 0) → `Entree` (aujourd'hui refusé : annonces prises au rang du mauvais Commit, nonce `n1` attendu pour le siège 4).
  - `n2_welcome_hors_arbre_refuse` : un Welcome valide remis avec un siège attesté absent de son arbre → `Err(MlsInvalide)`, file gardée ; le même Welcome remis ensuite avec le bon siège → `Entree`.
  - `cles_init_toutes_effacees` (module `tests` de groupe.rs) : l'arrivant appelle `key_package` deux fois (republication), le Welcome vise le second ; après l'entrée, `fournisseur.storage().key_package::<KeyPackageRef, KeyPackageBundle>(&r)` vaut `Ok(None)` pour **les deux** références.
  - Adapter l'aide `Reseau::entrer(&mut self, x, w, de: u8)` des tests : le Welcome est remis avec le siège de l'auteur du Commit (aujourd'hui 0 en dur).
- [ ] **Step 2 :** `cd engine && cargo test -p shhdrop-salon --locked` → les quatre tests échouent.
- [ ] **Step 3 : correction**
  - N1 : dans `appliquer_en_attente`, n'appeler `key_package_recu` que si `en_tete == EN_TETE_CONTROLE`.
  - N2 : `recevoir_trame` passe `siege_emetteur` à `entrer`. Candidats : les entrées `Attente::Trame` de la file dont `siege == siege_welcome`, `en_tete == EN_TETE_CONTROLE` et `est_commit_de(mls, E − 1)`, dans l'ordre ; pour chacun, refaire les annonces depuis le début de la file jusqu'à lui et appeler `verifier_welcome` ; le premier qui passe fixe `avant`. Sans candidat : annonces courantes (comportement actuel). Tous refusés : `Err(MlsInvalide)`, registre et file rendus. Avant tout : `siege_welcome` doit être le siège d'une feuille de `prepare.members()` et différent du nôtre, sinon `Err(MlsInvalide)`.
  - Clés restantes : après `into_group`, supprimer du stockage **toutes** les références de `nos_key_packages` (pas seulement celles du Welcome), puis vider la liste.
  - N3 : remettre la doc « Messages qui ne se rangent pas dans l'historique… » au-dessus de `est_volatile`, la doc de l'aléa au-dessus de `nouvel_id`.
- [ ] **Step 4 :** `make test-engine` → PASS (fmt, clippy hôte et wasm32, tests, vecteurs et test croisé natif ↔ wasm inchangés).
- [ ] **Step 5 :** mettre à jour v3 §3.6.2 (N1, N2, N3, clés restantes : « corrigé, C-2 Task 1 ») ; commit `fix(salon): KeyPackage mal étiqueté, Commit du Welcome par siège attesté, clés d'init effacées (N1–N3)`.

### Task 2 : configuration, activation, CSP

**Files :**
- Modify : `server/internal/config/config.go`, `server/internal/api/api.go` (`New`, `newHandler`), `server/internal/api/headers.go`, `server/cmd/shhdrop/main.go`, `Makefile` (`test-go` : `go test -race ./...`)
- Test : `server/internal/config/config_test.go`, `server/internal/api/salon_test.go` (nouveau)

**Interfaces :**
- Produces :
  - `config.Config` : `Salons bool` (`SHH_SALONS`, `0`/`1`, défaut 0), `SalonsMax int` (`SHH_SALONS_MAX`, entier canonique 1 à 10 000, défaut 200), `Origin string` (`SHH_ORIGIN`, obligatoire si `Salons`) ; `Origin` = `https://hôte[:port]` ou `http://` sur une adresse de boucle locale ou `localhost`, sans chemin, requête, fragment ni barre finale.
  - `type api.Salons struct { Origin string }` (valeur zéro : désactivé ; la Task 7 y ajoute `M *salon.Manager`) ; `api.New(svc, sig, lim, capt, static, behindProxy, proxies, sal api.Salons) http.Handler` ; `main.go` passe `Origin` seulement si `cfg.Salons`.
  - `func cspFor(origin string) string` : CSP actuelle, `connect-src 'self' blob: wss://hôte` (ou `ws://hôte` pour une origine `http://`) quand le salon est actif.
- [ ] **Step 1 : tests** — `TestSalonsDefautDesactive` (`Salons == false`, `SalonsMax == 200`) ; `TestOriginObligatoire` (`SHH_SALONS=1` sans `SHH_ORIGIN` → erreur) ; table `TestOriginInvalide` (`https://a.test/`, `https://a.test/x`, `ftp://a.test`, `http://a.test`, `https://a.test?x`, `https://user@a.test` → erreur ; `https://shhdrop.app`, `http://127.0.0.1:8080` → ok) ; `TestSalonsMaxInvalide` (`0`, `-1`, `007`, `x`) ; `TestCSPWebSocket` (avec `Origin = "https://shhdrop.app"`, la CSP contient `connect-src 'self' blob: wss://shhdrop.app;` ; sans salon, CSP inchangée).
- [ ] **Step 2 :** `cd server && go test -race ./internal/config/ ./internal/api/ -run 'Salon|Origin|CSP'` → FAIL.
- [ ] **Step 3 :** implémenter ; `withHeaders` reçoit la CSP calculée une fois.
- [ ] **Step 4 :** `go test -race ./...` puis `make test-go` → PASS.
- [ ] **Step 5 :** commit `feat(salon): SHH_SALONS, SHH_SALONS_MAX, SHH_ORIGIN, CSP wss (désactivé par défaut)`.

### Task 3 : en-tête des trames et enregistrements

**Files :**
- Create : `server/internal/salon/entete.go`, `server/internal/salon/protocole.go`, `server/internal/salon/entete_test.go`, `server/internal/salon/protocole_test.go`, corpus `server/internal/salon/testdata/fuzz/FuzzTrame/*`, `…/FuzzFlux/*`

**Interfaces :**
- Produces :
  - `const TailleTrame = 4140`, `TailleAccueil = 51`, `LimiteLecture = 4200`, `DepuisReprise uint64 = 1<<64 − 1` ;
  - `type Regle uint8` (`Desactive`, `Instantane`, `DixMinutes`, `UneHeure` = 0..3) ; `type EnTete struct{ Volatile bool; Regle Regle }` ; `var ErrEnTete` ; `func LireEnTete(trame []byte) (EnTete, error)` ;
  - `type Accueil struct{ Jeton [32]byte; Depuis uint64; Reprise bool }` ; `func LireAccueil(b []byte) (Accueil, error)` ;
  - `type Demande struct{ Type byte; Trame []byte; Piece *[16]byte; Seq uint64; Ping [8]byte }` ; `func LireDemande(b []byte) (Demande, error)` ; `var ErrProtocole` ;
  - encodeurs (un par ligne de la table « Serveur → client ») : `EnrTrame(seq uint64, siege uint8, recuMs int64, trame []byte) []byte`, `EnrArrivee`, `EnrDepart`, `EnrFin`, `EnrPresence`, `EnrPong`, `EnrExclusion`, `EnrReprise`, `EnrLimite(seq uint64, secondes uint32)`, `EnrPlein`, `EnrListe(seq uint64, createur uint8, liste []Annonce)`, `EnrEfface(seq, cible uint64)` ; `type Annonce struct{ Siege uint8; Nonce [16]byte }` ; constantes `Raison*` et `Code*` (point 19).
- [ ] **Step 1 : tests** — `TestEnTeteVecteurs` : lit `../../../engine/vectors/salon-v3.json` ; pour chaque cas `trames.seal`, `LireEnTete(seal.trame_hex)` = `read_header` ; pour chaque `trames.reject`, applique `mutation` (`xor` à `at` avec `mask`, `truncate` à `len`, octet ajouté) à la trame `from` et compare à `read_header` (`{"error":"en_tete_invalide"}` → `ErrEnTete`) ; échoue si le fichier n'a aucun cas. `TestAccueil` (51 octets valides ; 50, 52, jeton à 44 caractères, caractère `=` ou `+`, `\n` → erreur ; `depuis = 2^64−1` → `Reprise`). `TestDemandes` (chaque type ; `0x01` de 4 141 et 4 157 octets acceptés, 4 140, 4 142, 4 156 refusés ; `0x02`/`0x05` de 9 octets seulement ; `0x03` de 1 octet ; type `0x06` → `ErrProtocole`). `TestEnregistrements` : taille exacte de chacun (`EnrTrame` → 4 158) et champs relus à leur place. `FuzzTrame` et `FuzzFlux` : aucune panique, toute entrée rejetée par une erreur typée, et `LireDemande(EnrX…)` ne réussit jamais par hasard sur un enregistrement serveur.
- [ ] **Step 2 :** `cd server && go test -race ./internal/salon/` → FAIL.
- [ ] **Step 3 :** implémenter (aucune allocation au-delà de la tranche rendue).
- [ ] **Step 4 :** `go test -race ./internal/salon/` PASS ; `go test ./internal/salon -run '^$' -fuzz FuzzTrame -fuzztime 30s` et idem `FuzzFlux` sans échec ; corpus commité.
- [ ] **Step 5 :** commit `feat(salon): en-tête des trames (vecteurs SHC3) et enregistrements du WebSocket`.

### Task 4 : base, tables `salons` et `salon_pieces` (schéma 2)

**Files :**
- Modify : `server/internal/store/store.go`
- Test : `server/internal/store/store_test.go`

**Interfaces :**
- Produces : `store.SchemaVersion = 2` ; tables (dans `shares.db`) :
  - `salons(id TEXT PRIMARY KEY, access_v BLOB NOT NULL, manage_v BLOB NOT NULL, proof_v BLOB NOT NULL, salt BLOB NOT NULL, kdf_ops INTEGER NOT NULL, kdf_mem INTEGER NOT NULL, expires_at INTEGER NOT NULL, max_members INTEGER NOT NULL CHECK(max_members BETWEEN 2 AND 10), members_can_destroy INTEGER NOT NULL CHECK(members_can_destroy IN (0,1)), failed_attempts INTEGER NOT NULL DEFAULT 0, pieces_bytes INTEGER NOT NULL DEFAULT 0, CHECK(length(access_v)=32 AND length(manage_v)=32 AND length(proof_v)=32 AND length(salt)=16)) WITHOUT ROWID` ; index uniques `salons_access_v`, `salons_manage_v` ;
  - `salon_pieces(id TEXT PRIMARY KEY, salon_id TEXT NOT NULL REFERENCES salons(id) ON DELETE CASCADE, bucket INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('uploading','ready')), segments_mask BLOB NOT NULL) WITHOUT ROWID` ; index `salon_pieces_salon` sur `salon_id`.
- [ ] **Step 1 : tests** — `TestSchemaMinimal` mis à jour : `sqlite_master` = exactement `index:salon_pieces_salon`, `index:salons_access_v`, `index:salons_manage_v`, `index:shares_access_v`, `index:shares_manage_v`, `table:salon_pieces`, `table:salons`, `table:shares`, rien d'autre ; `TestSalonsColonnes` : `pragma_table_info('salons')` = les 12 colonnes ci-dessus, aucune autre (§39.3.5 : ni durée, ni sièges, ni nombre de messages) ; `TestSchemaVersion` : 2 après `Open` ; `TestMigreV1VersV2` : une base de version 1 avec un partage s'ouvre, garde le partage, passe à 2 ; `TestRefuseV3` : `user_version = 3` → `ErrNewerSchema` sans rien toucher ; `TestPiecesEffaceesAvecSalon` : supprimer la ligne `salons` supprime ses `salon_pieces` (clés étrangères actives) ; `TestSalonsWithoutRowid`.
- [ ] **Step 2 :** `cd server && go test -race ./internal/store/` → FAIL.
- [ ] **Step 3 :** `CREATE TABLE IF NOT EXISTS` des deux tables et de leurs index après `indexes` ; aucune migration de données (tables neuves).
- [ ] **Step 4 :** `go test -race ./...` puis `make test-go` → PASS.
- [ ] **Step 5 :** commit `feat(salon): tables salons et salon_pieces (schéma 2)`.

### Task 5 : fichier de conversation sous seconde couche AES-256-GCM

**Files :**
- Create : `server/internal/salon/conversation.go`, `server/internal/salon/conversation_test.go`

**Interfaces :**
- Produces :
  - `const TailleEmplacement = 4168` ;
  - `func OuvrirConversation(dossier, id string) (*Conversation, error)` : crée `dossier/id` (`O_RDWR|O_CREATE|O_EXCL`, mode 0600), tire une clé de 32 octets (`crypto/rand`) gardée en mémoire seulement ; `id` validé comme un identifiant de 22 caractères base64url ;
  - `(*Conversation).Ajouter(trame []byte) (emplacement uint32, err error)` ; `Lire(emplacement uint32) ([]byte, error)` (`ErrEfface` pour un emplacement de zéros ou qui ne s'authentifie pas) ; `Effacer(emplacement uint32) error` (zéros) ; `Taille() int64` ; `Detruire() error` (clé mise à zéro, fichier fermé puis supprimé ; idempotent).
  - Dates remises à zéro (`os.Chtimes` à l'epoch) après chaque écriture ; lectures par un descripteur ouvert avec `O_NOATIME` quand le système le permet (comme `blob.openRead`) ; aucun `fsync` (le fichier ne sert plus après un redémarrage).
- [ ] **Step 1 : tests** — `TestAllerRetour` (100 trames, relues à l'identique) ; `TestIllisibleSansCle` : le fichier ne contient aucune fenêtre de 32 octets d'aucune trame écrite (recherche dans les octets bruts) ; `TestAutreCleEchoue` : une seconde `Conversation` sur une copie du fichier ne lit rien (`ErrEfface`) ; `TestEmplacementsEchanges` : échanger deux emplacements dans le fichier → `Lire` échoue (données authentifiées) ; `TestEffacerZeros` : après `Effacer(3)`, les octets `[3×4168, 4×4168)` sont nuls, `Lire(3)` → `ErrEfface`, les autres restent lisibles ; `TestSansDate` : `mtime` et `atime` = epoch après `Ajouter` ; `TestDetruire` : fichier absent, `Lire` → erreur, clé interne nulle ; `TestIDInvalide` (`../x`, 21 caractères) → erreur, aucun fichier.
- [ ] **Step 2 :** `cd server && go test -race ./internal/salon/ -run Conversation` (noms ci-dessus) → FAIL.
- [ ] **Step 3 :** implémenter (`cipher.NewGCM(aes.NewCipher(clé))`, nonce aléatoire de 12 octets par emplacement).
- [ ] **Step 4 :** `go test -race ./internal/salon/` → PASS.
- [ ] **Step 5 :** commit `feat(salon): conversation sur disque sous AES-256-GCM, clé en mémoire`.

### Task 6 : gestionnaire, création, meta, entrée, sièges et jetons

**Files :**
- Create : `server/internal/salon/manager.go`, `server/internal/salon/erreurs.go`, `server/internal/salon/salon.go` (état en mémoire, sans le relais), `server/internal/salon/manager_test.go`

**Interfaces :**
- Consumes : `share.NewID()`, `share.Verifier`, `share.DecodeB64` ; tables de la Task 4 ; `OuvrirConversation` (Task 5).
- Produces :
  - `type Config struct{ DB *sql.DB; Pieces *blob.Store; DossierConversations string; Now func() time.Time; Max int; StorageMax int64; UsedPartages func() (int64, error); Limites *limits.Limiter }` ; `func NewManager(c Config) (*Manager, error)` (champ manquant → erreur) ;
  - erreurs (`erreurs.go`) : `ErrNotFound`, `ErrFull`, `ErrBusy`, `ErrBadRequest`, `ErrConflict`, `ErrExcluded`, `ErrForbidden`, `ErrBudget`, `ErrStale`, `ErrLimit`, `ErrPlein` (disque plein pour une trame) ; `type BadPassword struct{ AttemptsLeft int }` ; `type Attente struct{ Retry time.Duration }` (erreur de limite avec délai) ;
  - `type CreerReq struct{ AccessV, ManageV, ProofV, Salt []byte; TTLHours, MaxMembers, KdfOps, KdfMem int; MembersCanDestroy bool }` ; `func (m *Manager) Creer(r CreerReq) (time.Duration, error)` : valeurs des Global Constraints, `expires_at = ceil15(now + ttl × 3600)`, `access_v` ou `manage_v` déjà pris → `ErrConflict`, `count(salons vivants) ≥ Max` ou usage total + 2 Gio > `StorageMax` → `ErrBusy` ;
  - `type Meta struct{ ExpiresIn time.Duration; Salt []byte; KdfOps, KdfMem int }` ; `func (m *Manager) Meta(kAcces []byte) (Meta, error)` ;
  - `type Entree struct{ Jeton [32]byte; Siege uint8; Seq uint64; Nonce [16]byte; ExpiresIn time.Duration; MaxMembers int; MembersCanDestroy bool; BudgetLeft int64 }` ; `func (m *Manager) Rejoindre(kAcces, kPreuve, sGestion []byte) (Entree, error)` (`sGestion` nil si absent) ;
  - `func (m *Manager) Gestion(sGestion []byte) (expiresIn time.Duration, present int, err error)` ;
  - `type Membre struct{ salon *salon; siege uint8; emis uint64; plancher uint64 }` ; `func (m *Manager) Membre(jeton []byte) (Membre, error)` (`ErrExcluded` pour un jeton révoqué, `ErrNotFound` pour un inconnu) ;
  - `func (m *Manager) UsedBytes() int64` (pièces + conversations) ; `func (m *Manager) Tick()` (une passe ; complétée aux Tasks 11, 13, 15) ;
  - état d'un salon (`salon.go`) : `mu`, `id`, `expires`, `maxMembers`, `sieges [10]*siege`, `seq uint64`, `arrivees int`, jetons (SHA-256 → siège), jetons révoqués, `journal []evenement` (rang et enregistrement de chaque `0x02`/`0x03`/`0x09`/`0x0A`, 4 096 au plus), `conv *Conversation` ; `siege` : `nonce`, `jetonV [32]byte`, `emis uint64`, `plancher uint64`, `horsLigneDepuis time.Time`.
- [ ] **Step 1 : tests** (base temporaire, horloge figée)
  - `TestCreerValide`, table `TestCreerRefuse` (TTL 2, `max_members` 1 et 11, `kdf_ops` 2, `kdf_mem` 32 Mio, sel de 15 octets, `proof_v` = SHA-256 vide → `ErrBadRequest`) ; `TestCreerConflit` (`access_v` repris → `ErrConflict`, salon existant intact) ; `TestCreerMax` (`Max = 2` → 3ᵉ `ErrBusy`) ; `TestEcheanceAuQuart` (création à 10:07:30, 1 h → `expires_at` = 11:15:00).
  - `TestMetaInconnu` : clé inconnue, salon expiré et salon détruit → même `ErrNotFound`.
  - `TestRejoindreCreateurSiege0` (avec `sGestion` juste → siège 0 ; invité → siège 1) ; `TestRejoindreCreateurReprend0` (second `rejoindre` du créateur : siège 0, ancien jeton → `ErrNotFound` par `Membre`, `0x0A` au journal) ; `TestPlaceDuCreateurGardee` (`max_members = 2`, créateur absent : un invité entre, le deuxième → `ErrFull`, le créateur entre encore) ; `TestArriveesPlafond` (`max_members = 2` : 10 entrées et départs, la 11ᵉ → `ErrFull`) ; `TestRejoindreConcurrent` (dernière place, 8 `Rejoindre` simultanés sous `-race` → un seul siège donné) ; `TestManageFaux` (preuve juste, `sGestion` faux → `ErrBadRequest`, aucun siège).
  - `TestMauvaisMotDePasse` : 9 faux → `BadPassword{AttemptsLeft: 9 … 1}` (compté dans `failed_attempts`), le 10ᵉ → `ErrNotFound` et ligne supprimée ; `TestEssaisConcurrents` (20 faux en parallèle : jamais plus de 10 évalués).
  - `TestEntreeAnnoncee` : `Entree.Seq` = rang du `0x02` du journal, `Entree.Nonce` = son nonce ; `TestJetonAleatoire` (deux entrées → jetons différents, la base ne contient ni jeton ni empreinte : recherche dans `shares.db` et son WAL).
  - `TestGestion` (`present` = sièges occupés ; `sGestion` inconnu → `ErrNotFound`).
- [ ] **Step 2 :** `cd server && go test -race ./internal/salon/` → FAIL.
- [ ] **Step 3 :** implémenter ; un verrou par salon (rayé par id, comme `attemptLock`) rend atomiques la vérification de `K_preuve_s` (`subtle.ConstantTimeCompare` de SHA-256), le décompte des essais et l'attribution du siège ; l'état mémoire d'un salon est créé au premier `Rejoindre` (fichier de conversation ouvert alors).
- [ ] **Step 4 :** `go test -race ./...` puis `make test-go` → PASS.
- [ ] **Step 5 :** commit `feat(salon): création, meta, entrée, sièges et jetons de membre`.

### Task 7 : routes JSON de création, meta, entrée, gestion

**Files :**
- Create : `server/internal/api/handlers_salon.go`
- Modify : `server/internal/limits/limits.go`, `server/internal/api/api.go` (`failSalon` ; champ `M *salon.Manager` d'`api.Salons` ; routes `/api/salons/*` enregistrées seulement si `M != nil`)
- Test : `server/internal/api/salon_test.go`, `server/internal/limits/limits_test.go`

**Interfaces :**
- Consumes : Task 6.
- Produces :
  - `func (l *Limiter) AllowSalonCreate(ip netip.Addr) bool` (5 par jour par connexion, 15 par /48, compté à l'appel) ; `func (l *Limiter) AllowJoin(ip netip.Addr) bool` (20 par heure par connexion, 60 par /48, fenêtre horaire fixe UTC) ; `func (l *Limiter) AllowFrame(ip netip.Addr) bool` (120 par minute par connexion, 600 par /48) ; mêmes clés HMAC du jour, effacées à la rotation ;
  - routes : `POST /api/salons` (en-têtes `X-Shh-Access`, `X-Shh-Manage` ; corps `{ttl_hours, max_members, members_can_destroy, salt, kdf_ops, kdf_mem, proof_v, altcha, hp, shown_at}` → 201 `{expires_in_s}`) ; `GET /api/salons/meta` (`X-Shh-Access` → `{expires_in_s, salt, kdf_ops, kdf_mem}`) ; `POST /api/salons/rejoindre` (`X-Shh-Access`, `X-Shh-Manage` facultatif, corps `{proof}` → `{member_token, seat, seq, nonce_arrivee, expires_in_s, max_members, members_can_destroy, budget_left}`) ; `GET /api/salons/gestion` (`X-Shh-Manage` → `{expires_in_s, present}`) ;
  - `func failSalon(w http.ResponseWriter, err error)` : `ErrNotFound` 404 `not_found` ; `BadPassword` 403 `{"error":"bad_password","attempts_left":n}` ; `ErrFull` 409 `full` ; `ErrBudget` 409 `budget` ; `ErrStale` 409 `stale` ; `ErrExcluded` 403 `excluded` ; `ErrForbidden` 403 `forbidden` ; `Attente`/`ErrLimit` 429 `limit` avec `Retry-After` ; `ErrBusy` 503 `busy` ; `ErrBadRequest`, `ErrConflict` 400 `bad_request` ; autre 500 `internal`.
- [ ] **Step 1 : tests** — `TestRoutesSalonAbsentes` (`api.Salons{}` : `POST /api/salons`, `GET /api/salons/ws`, `GET /api/salons/meta` → 404, corps identique octet pour octet à `GET /api/inconnu`) ; `TestCreerSalonHTTP` (défi ALTCHA résolu par l'aide de test existante ; 201 ; la réponse ne contient que `expires_in_s`) ; `TestCreerSalonSansCaptcha` (400) ; `TestCreerSalonQuota` (6ᵉ du jour → 429 `limit`) ; `TestCreerSalonConflit` (même `X-Shh-Access` → 400 `bad_request`, compté au quota) ; `TestJSONStrict` (clé inconnue, clé en double, `ttl_hours` en chaîne, corps > 4 Kio → 400) ; `TestMetaUniforme` (inconnu, expiré, détruit : corps identiques octet pour octet) ; `TestRejoindreHTTP` (champs et types de la réponse ; `member_token` de 43 caractères) ; `TestRejoindreFaux` (403 `attempts_left` 9) ; `TestRejoindreLimite` (21ᵉ de l'heure → 429) ; `TestCompletHTTP` (409 `full`) ; `TestGestionHTTP` ; `TestAllowJoinHeure`, `TestAllowSalonCreateJour`, `TestAllowFrameMinute` (bornes exactes, /48 découpé en /64 compté au /48).
- [ ] **Step 2 :** `cd server && go test -race ./internal/api/ ./internal/limits/` → FAIL.
- [ ] **Step 3 :** implémenter sur le patron de `create` des partages (format → gel → anti-robot → quota → création → `RecordCreate`).
- [ ] **Step 4 :** `go test -race ./...` puis `make test-go` → PASS.
- [ ] **Step 5 :** commit `feat(salon): routes de création, meta, entrée et gestion`.

### Task 8 : relais et stockage des trames, ordre, rattrapage

**Files :**
- Modify : `server/internal/salon/salon.go`
- Create : `server/internal/salon/relais.go`, `server/internal/salon/relais_test.go`

**Interfaces :**
- Consumes : `LireEnTete`, encodeurs (Task 3) ; `Conversation` (Task 5) ; état (Task 6).
- Produces :
  - `type entree struct{ seq uint64; emplacement uint32; recuMs int64; siege uint8; drapeaux uint8; attendus uint16; piece *[16]byte; efface bool }` (index en mémoire, trié par `seq`) ;
  - `func (m *Manager) Recevoir(mb Membre, trame []byte, piece *[16]byte) (uint64, error)` (`piece` non nil → `ErrBadRequest` jusqu'à la Task 13) : en-tête lu (sinon `ErrBadRequest`), sous le verrou du salon : `seq++`, heure de réception `Now().UnixMilli()`, trame non volatile écrite (`Conversation.Ajouter`) et indexée, `attendus` = sièges occupés sauf l'expéditeur si la règle est « instantané » ; `EnrTrame` remis à toutes les connexions en direct, expéditeur compris (Task 9) ; volatile : rien d'écrit ni d'indexé ;
  - `func (m *Manager) Retirer(mb Membre, seq uint64) error` (seule une trame non volatile de ce siège ; sinon ignoré sans erreur ; emplacement écrasé, entrée marquée `efface`) ;
  - `func (m *Manager) Quitter(mb Membre) error` (`0x03` au journal et diffusé, jeton oublié, siège libéré) ;
  - `func (s *salon) etatAu(seq uint64) []Annonce` (sièges et nonces au rang `seq`, refaits depuis le journal) ;
  - `func (s *salon) suite(apres uint64, max int) [][]byte` (enregistrements de rang > `apres` : trames lues sur disque avec leur siège et leur heure, et événements du journal, fusionnés par `seq`).
- [ ] **Step 1 : tests**
  - `TestSeqStrictementCroissant` : 300 trames de 3 sièges en parallèle (volatiles mêlées) → rangs 1…300 sans trou ni doublon, chacun une seule fois.
  - `TestVolatileNonEcrite` : 10 volatiles → fichier de taille 0, index vide, rangs consommés.
  - `TestHeureDeReception` : `EnrTrame` porte `Now()` du serveur, jamais rien de la trame ; elle n'est écrite nulle part sur disque (recherche des 8 octets dans le dossier).
  - `TestRetirerParAuteurSeul` : un autre siège ne retire pas (trame toujours servie) ; l'auteur retire → emplacement nul, `suite` ne la sert plus ; retirer une volatile ou un rang inconnu → sans effet.
  - `TestSuiteFusionnee` : trames et `0x02`/`0x03`/`0x0A` intercalés → `suite(0, …)` dans l'ordre `seq` exact ; les volatiles n'y sont pas.
  - `TestEtatAu` : arrivées, départ, reprise (nouveau nonce) → `etatAu` donne la liste exacte à chaque rang.
  - `TestKeyPackageGardePourLeRattrapage` (exigence 4) : une trame à en-tête de contrôle envoyée par un siège arrivant est servie par `suite` à un membre qui revient 30 min plus tard.
  - `TestEnTeteRefuse` : bit réservé, marque fausse, 4 139 octets → `ErrBadRequest`, rang non consommé.
  - `TestJournalBorne` : la 4 097ᵉ entrée du journal (reprises) → `ErrLimit`.
- [ ] **Step 2 :** `cd server && go test -race ./internal/salon/` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `go test -race ./...` → PASS.
- [ ] **Step 5 :** commit `feat(salon): relais ordonné, trames non volatiles sur disque, rattrapage fusionné`.

### Task 9 : connexion, accueil, rattrapage puis direct, contre-pression, ping

**Files :**
- Create : `server/internal/salon/connexion.go`, `server/internal/salon/connexion_test.go`

**Interfaces :**
- Consumes : Tasks 3, 6, 8 ; `limits.AllowFrame` (Task 7).
- Produces :
  - `type Lien interface{ Lire(ctx context.Context) ([]byte, error); Ecrire(ctx context.Context, b []byte) error; Ping(ctx context.Context) error; Fermer(code int, raison string) error }` ;
  - `func (m *Manager) Servir(ctx context.Context, l Lien, ip netip.Addr) error` : accueil dans les 5 s (sinon 4001) ; jeton (`Membre`) : révoqué → 4002, inconnu → 4004 ; une seule connexion par siège (l'ancienne reçoit `EnrFin(4)` et 4005) ; reprise (`depuis = DepuisReprise`) : nouveau nonce, `0x0A` ; séquence d'accueil du « Protocole » ; une goroutine d'écriture par connexion ;
  - écrivain à deux modes : **rattrapage** (lit `suite(curseur, 64)` sans file) puis, sous le verrou du salon, inscription au **direct** (file bornée à 256) quand le curseur atteint le dernier rang ; file pleine → retour en rattrapage depuis le dernier rang remis ; en rattrapage depuis plus de 5 s alors que des trames arrivent, ou `Ecrire` bloqué plus de 10 s → `EnrFin(6)`, 4006 ;
  - lecture : `Lire` → `LireDemande` ; `0x01` → `AllowFrame(ip)` puis `Recevoir` (limites de siège : Task 12) ; `0x02` → `Retirer` ; `0x03` → `Quitter` ; `0x04` → `EnrPong` dans la file de la connexion ; `0x05` lu puis ignoré (branché à la Task 11) ; erreurs de `Recevoir` : `Attente` → `EnrLimite` (secondes arrondies au-dessus), `ErrPlein` → `EnrPlein`, `ErrBadRequest` → 4003 ; plus de 600 messages de contrôle par minute → 4003 ;
  - ping : `Ping` toutes les 20 s (délai 25 s) ; aucun pong ni message depuis 45 s → fermeture ; présence `0x07` diffusée à l'ouverture et à la fermeture.
  - **exigences reportées des relectures (Tasks 3 et 6)** :
    - `defer recover()` dans chaque goroutine de connexion (lecture et écriture), avec une fermeture en 1011 et aucune sortie : une panique ne doit jamais arrêter le processus (`EnrTrame`/`EnrListe` paniquent hors précondition) ; test avec une panique injectée ;
    - `ErrEnTete` et `ErrProtocole` donnent toutes deux le code 4003 ; test ;
    - `horsLigneDepuis` est remis à zéro à la connexion et posé à la déconnexion : un membre en ligne ne perd jamais son siège après 10 min (aujourd'hui, `Tick` libère le siège 10 min après l'entrée) ; test **bloquant** `TestEnLigneGardeSonSiege` ;
    - plafond des reprises `0x0A` : au plus 20 par heure et par siège (au-delà, 4003), pour qu'un membre qui recharge en boucle ne remplisse pas le journal de 4 096 annonces et ne ferme pas le salon aux autres ; réutiliser `invariantJournal` dans les tests.
    - **relecture Task 8** :
      - lectures du rattrapage hors de `salon.mu`. Sous le verrou, on copie seulement `(seq, emplacement, siège, recuMs)` ; on lit et on déchiffre ensuite hors du verrou (la `Conversation` a son propre RWMutex). `suiteLocked` ne sert plus qu'au dernier lot, au passage au direct.
      - `ErrES`, `ErrInutilisable` et `ErrPleine` ne donnent jamais 4003 : 1011, puis `0x0C` dès la Task 12.
      - une trame illisible au rattrapage, qui peut être un Commit MLS, ferme la connexion en 1011 au lieu d'être sautée sans rien dire.
      - plancher du rattrapage : max(`depuis`, rang d'émission du jeton). Test `TestNouveauVenuDepuisZero` : un membre arrivé au rang N avec `depuis = 0` ne reçoit aucune trame de rang < N.
- [ ] **Step 1 : tests** (faux `Lien` en mémoire, `testing/synctest` pour les délais)
  - `TestAccueilAbsent` (5 s sans message → 4001) ; `TestAccueilInvalide` (50 octets → 4001) ; `TestJetonInconnu` (4004) ; `TestJetonRevoque` (jeton placé par le test dans les révoqués → 4002).
  - `TestSequenceAccueil` : premier enregistrement `0x0D` au rang attendu, puis un `0x07` par siège occupé, puis le rattrapage, avant tout direct.
  - `TestDepuisBorne` (point 7) : un jeton émis au rang 40 qui demande `depuis = 0` ne reçoit rien de rang ≤ 40.
  - `TestRattrapagePuisDirectSansTrou` (Review Focus 1) : 2 000 trames écrites, un membre se reconnecte avec `depuis = 10` pendant que deux autres envoient 500 trames de plus → il reçoit les rangs 11…2 500 (non volatils) dans l'ordre, sans doublon.
  - `TestEchoExpediteur` : l'expéditeur reçoit sa trame avec son rang et son siège.
  - `TestReprise` : `0x0A` diffusé avec un nonce neuf, `0x0D` au rang du `0x0A` contenant ce nonce, aucun rattrapage ; `TestReconnexionGardeLeNonce`.
  - `TestRemplace` : seconde connexion du même siège → la première reçoit `0x05` raison 4 et 4005.
  - `TestClientLentBascule` (Review Focus 2) : un `Lien` dont `Ecrire` est lent → la file ne dépasse jamais 256, la connexion passe en rattrapage et rattrape quand il accélère ; `TestClientLentFerme` : un `Lien` bloqué → 4006 avant 10 s d'écriture bloquée ; dans les deux cas un autre membre reçoit chaque trame en moins de 50 ms (horloge simulée).
  - `TestPingSilence` : `Ping` sans réponse et aucun message pendant 45 s → fermeture ; `TestPingApplicatif` (`0x04` → `0x08` mêmes octets).
  - `TestControleLimite` (601ᵉ message de contrôle de la minute → 4003) ; `TestMessageTexte` (4003) ; `TestTrameFrequenceIP` (121ᵉ trame de la minute depuis la même adresse → `0x0B`, trame non rangée).
  - `TestPresence` (`0x07` 1 à l'ouverture, 0 à la fermeture, chez les autres) ; goroutines arrêtées à la fin de chaque test (`synctest.Wait`, aucune fuite).
- [ ] **Step 2 :** `cd server && go test -race ./internal/salon/` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `go test -race ./...` → PASS.
- [ ] **Step 5 :** commit `feat(salon): connexions, accueil, rattrapage puis direct, contre-pression et ping`.

### Task 10 : WebSocket HTTP (`GET /api/salons/ws`)

**Files :**
- Create : `server/internal/api/handlers_salon_ws.go`, `server/internal/api/salon_ws_test.go`
- Modify : `server/go.mod`, `server/go.sum`, `server/internal/salon/connexion.go` (`FermerTout`)

**Interfaces :**
- Consumes : `salon.Lien`, `(*Manager).Servir` (Task 9).
- Produces : `func (m *Manager) FermerTout()` (toutes les connexions fermées en 1001, branché par la Task 15 sur `srv.RegisterOnShutdown`) ; `func (s *server) salonWS(w http.ResponseWriter, r *http.Request)` : `Origin` présent une seule fois et égal à `SHH_ORIGIN` octet pour octet, sinon 403 `forbidden` avant toute mise à niveau ; place prise dans `limits.NewSlots(2000, 4, 16)` (429/503 sinon) ; échéances de lecture et d'écriture de la connexion effacées (`http.NewResponseController(w).SetReadDeadline(time.Time{})`, idem écriture) ; `websocket.Accept` avec `CompressionMode: websocket.CompressionDisabled` et `OriginPatterns` = hôte de `SHH_ORIGIN` ; `SetReadLimit(salon.LimiteLecture)` ; adaptateur `wsLien` (message texte → `salon.ErrProtocole`) ; `Servir` ; place rendue à la fin.
- [ ] **Step 1 : revue de chaîne** — `supply-chain-risk-auditor` sur `github.com/coder/websocket@v1.8.15` (publiée depuis plus de 7 jours, ISC, aucune dépendance) ; `govulncheck ./...` propre ; noter le résultat dans le message de commit.
- [ ] **Step 2 : tests** (`httptest.NewServer`, client `websocket.Dial` avec l'en-tête `Origin`) — `TestOrigineEtrangere` (`https://evil.test`, absente, en double → 403, aucune mise à niveau) ; `TestSansCompression` (le client propose `permessage-deflate` ; la réponse n'a pas d'en-tête `Sec-WebSocket-Extensions`) ; `TestMessageTropGrand` (4 201 octets → fermeture 1009) ; `TestTrameMauvaiseTaille` (`0x01` de 4 139 octets → 4003) ; `TestDeuxClientsEchangent` (deux membres réels : trame de l'un reçue par l'autre en `0x01` de 4 158 octets) ; `TestWSPlaces` (5ᵉ WebSocket d'une même adresse → 429) ; `TestWSSurvitAuxDelaisHTTP` (Review Focus 3 : serveur `http.Server` avec `ReadTimeout` et `WriteTimeout` de 1 s, connexion utilisée pendant 3 s sans coupure) ; `TestArretFerme1001` (`FermerTout` → le client voit 1001) ; `TestAucuneIPDansLeSalon` (l'état du salon ne garde aucune adresse : les clés de limite sont des HMAC).
- [ ] **Step 3 :** `cd server && go test -race ./internal/api/ -run 'WS|Origine|Compression'` → FAIL.
- [ ] **Step 4 :** `go get github.com/coder/websocket@v1.8.15` ; implémenter.
- [ ] **Step 5 :** `go test -race ./...` puis `make test-go` → PASS.
- [ ] **Step 6 :** commit `feat(salon): WebSocket du salon (coder/websocket v1.8.15), origine, compression coupée`.

### Task 11 : effacement par règle et par lectures

> Relecture Task 9 : une connexion sortie du direct (file pleine, retour en rattrapage) perd un `0x0E` qui n'a pas de rang. Prévois le même renvoi que pour les présences : au retour dans le direct, renvoie les `0x0E` survenus depuis la sortie, et ajoute un test « client lent, trame effacée pendant le rattrapage, `0x0E` reçu quand même ».

**Files :**
- Create : `server/internal/salon/effacement.go`, `server/internal/salon/effacement_test.go`
- Modify : `server/internal/salon/relais.go`, `server/internal/salon/connexion.go` (`0x05` → `Lu`), `server/internal/salon/manager.go` (`Tick`)

**Interfaces :**
- Consumes : index et `Conversation.Effacer` (Tasks 5, 8).
- Produces :
  - `func (m *Manager) Lu(mb Membre, seq uint64) error` : seulement une trame « instantané », non volatile, non effacée, dont ce siège est attendu ; retire le siège de `attendus` ; vide → effacement et `EnrEfface` diffusé aux connexions en direct ; tout autre cas ignoré ;
  - effacement commun `func (s *salon) effacer(i int)` : emplacement écrasé, entrée `efface`, pièce liée effacée (Task 13), flux de cette pièce coupés ;
  - échéances : tas `(échéance, salon, seq)` pour les règles 10 min et 1 h (`recuMs + 600 000` ou `+ 3 600 000`), vidé par `Tick` (appelé chaque seconde par `Run`, Task 15) ; effacement sans `0x0E` (les membres comptent eux-mêmes depuis l'heure de réception) ;
  - départ, exclusion, libération après 10 min hors ligne : le siège est retiré des `attendus` de toutes les trames (effacements en chaîne) ; reprise : retiré des trames de rang inférieur à son `0x0A` (point 8) ; `func (m *Manager) liberer(s *salon, siege uint8)` (10 min hors ligne → `0x03`).
- [ ] **Step 1 : tests** (horloge simulée)
  - `TestInstantaneTousLu` : 3 sièges, A envoie ; B lit → encore servie ; C lit → emplacement nul, `0x0E` reçu par A, B, C, plus servie au rattrapage.
  - `TestLuRefuse` : `Lu` par l'expéditeur, par un siège arrivé après l'envoi, deux fois par le même, sur une règle 10 min ou une volatile → aucun effet.
  - `TestInstantaneSeul` : expéditeur seul → effacée dès sa diffusion.
  - `TestDixMinutes` : effacée à `recu + 600 s` (pas à 599 s), sans lecture ; `TestUneHeure` idem à 3 600 s ; l'`heure_ms` de l'expéditeur n'y est pour rien (trame rangée avec une heure d'émission fausse dans son contenu).
  - `TestInstantaneLibereParDepart` (Review Focus 5) : C hors ligne n'a pas lu ; à 10 min hors ligne, son siège est libéré (`0x03`) et la trame effacée (`0x0E`).
  - `TestInstantaneQuitter` : même effet, immédiat (l'exclusion : Task 14).
  - `TestRepriseNeCompteplus` : B fait une reprise → B n'est plus attendu pour les trames d'avant son `0x0A`, il l'est pour les suivantes.
  - `TestAbsentRevientAvant10Min` : C revient à 9 min, reçoit la trame au rattrapage, la lit → effacée.
- [ ] **Step 2 :** `cd server && go test -race ./internal/salon/` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `go test -race ./...` → PASS.
- [ ] **Step 5 :** commit `feat(salon): effacement 10 min et 1 h par l'heure de réception, « instantané » par lectures`.

### Task 12 : limites des trames et garde-fou du disque

**Files :**
- Create : `server/internal/salon/limites.go`, `server/internal/salon/limites_test.go`
- Modify : `server/internal/salon/relais.go`, `server/internal/share/service.go` (`Config.ExtraUsed`, utilisé par `create` et `grow`), `server/internal/share/service_test.go`

**Interfaces :**
- Produces :
  - `type seau struct{ jetons float64; cap float64; parSeconde float64; dernier time.Time }` ; `func (b *seau) prendre(now time.Time) (ok bool, attente time.Duration)` ;
  - par siège : `cadence` (cap 20, 1 par seconde) pour toute trame ; `horaire` (cap 1 200, 1 200 par heure) pour les non volatiles ; refus → `Attente{Retry}` (traduit en `0x0B` par `Servir`, Task 9), trame non rangée ;
  - disque : `Recevoir` refuse une trame non volatile si `UsedPartages() + UsedBytes() + TailleEmplacement > StorageMax` → `ErrPlein` (`0x0C`) ; `Creer` refuse si l'usage + 2 Gio dépasse (déjà Task 6) ;
  - `share.Config.ExtraUsed func() int64` (nil : 0) ajouté à l'usage des partages à la création et à l'agrandissement.
- [ ] **Step 1 : tests** — `TestRafale20` (20 trames d'un coup acceptées, la 21ᵉ → `Attente` ≈ 1 s) ; `TestSoixanteParMinute` (sur 10 min à 1 trame par seconde : aucune refusée ; à 2 par seconde : 50 % refusées après la rafale) ; `TestMilleDeuxCentsParHeure` (non volatiles à 1 par 3 s acceptées ; la 1 201ᵉ dans l'heure refusée ; les volatiles n'entament pas ce compte) ; `TestLimiteParSiege` (un siège limité n'en gêne pas un autre) ; `TestDisquePlein` (Review Focus 4 : `StorageMax` atteint → `0x0C`, rang non consommé, fichier inchangé, les volatiles passent encore, un autre salon reçoit aussi `0x0C`, `Creer` → `ErrBusy`) ; `TestPartagesVoientLeSalon` (share : `ExtraUsed` = 3 Gio, `StorageMax` = 4 Gio → création d'un palier de 2 Gio refusée `ErrFull`).
- [ ] **Step 2 :** `cd server && go test -race ./internal/salon/ ./internal/share/` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `go test -race ./...` puis `make test-go` → PASS.
- [ ] **Step 5 :** commit `feat(salon): cadence 60/min, 1 200 messages/h, garde-fou SHH_STORAGE_MAX`.

### Task 13 : pièces jointes et vocaux

> Relecture Task 12 : la réserve vocale (4 000 o/s, plafond 14 400 000) n'existe pas encore : constante et test ici. `CreerPiece` doit réserver son palier dans la même section atomique que la vérification de l'usage (total atomique du `Manager`), sinon le plafond de stockage peut être dépassé d'un palier entier.
> Relecture Task 8 : `Retirer` doit faire `delete(s.pieces, e.seq)` dès que cette tâche remplit `salon.pieces`, avec un test.

**Files :**
- Create : `server/internal/salon/pieces.go`, `server/internal/salon/pieces_test.go`, `server/internal/api/handlers_salon_pieces.go`, `server/internal/api/salon_pieces_test.go`
- Modify : `server/internal/share/sizing.go` (exports), `server/internal/token/token.go` (type `SalonPiece byte = 'p'`), `server/internal/api/api.go` (`validSegmentToken` : `PUT /api/salons/pieces/segments/{n}` à jeton `SalonPiece`, `GET` à `X-Shh-Membre` valide → compteur des segments)

**Interfaces :**
- Consumes : `share.SegmentCount`, `share.SegmentSize`, `share.ReadBudget`, `share.Buckets` ; `pacer`, `transfers`, `Streams` (api, share) ; `limits.BeginUpload/FinishUpload/CancelUpload`.
- Produces :
  - `share.TotalSize(bucket int) int64`, `share.SegOffset(bucket, n int) int64`, `share.ValidFill(from, to, segs int) bool` (exports des fonctions existantes) ;
  - `const Budget int64 = 1073741824`, `PalierMax = 8000`, `VocalOctetsParSeconde = 4000`, `VocalReserveMax int64 = 14400000`, `PieceSansLien = 15 * time.Minute`, `PieceSansSegment = 15 * time.Minute` ; `var VocalPaliers = []int{1, 16, 80}` ;
  - `func (m *Manager) CreerPiece(mb Membre, bucket int, vocal bool) (id string, err error)` : non vocal → palier de `share.Buckets` ≤ 8 000, `pieces_bytes + TotalSize ≤ Budget` sinon `ErrBudget` ; vocal → palier de `VocalPaliers`, débité de la réserve du siège (qui gagne 4 000 o par seconde de WebSocket ouvert, plafond 14 400 000), sinon `Attente{(manque ÷ 4000) s}` ; place totale (`StorageMax`) sinon `ErrFull` ; fichier réservé (`blob.Store.Reserve`) et ligne `uploading` ; rang de création gardé en mémoire avec le siège auteur, le jeton auteur et `vocal` ;
  - `PutSegment(id string, n int, body []byte) error`, `FinalizePiece(id string, from, to int) error` (bourrage d'aléa, état `ready`, quotas débités), `OuvrirSegment(mb Membre, id string, n int) (*blob.Section, error)` (plancher : pièce créée avant le plancher du jeton → `ErrNotFound` ; budget de lecture par (jeton, pièce) → `ErrBudget`), `RetirerPiece(mb Membre, id string) error` (auteur seul, sinon `ErrForbidden`) ;
  - lien trame ↔ pièce : `Recevoir(mb, trame, piece)` lie `piece` seulement pour une trame non volatile, une pièce `ready`, du même salon et du même auteur, pas encore liée ; trame volatile ou pièce d'un autre auteur → `ErrBadRequest` (4003) ; pièce disparue, pas prête ou déjà liée → trame rangée sans lien (audit du 12 novembre, D6, « Protocole ») ; la pièce est effacée avec sa trame (Task 11), à la fin du salon, ou `PieceSansLien` après sa finalisation sans lien ; une pièce sans segment depuis `PieceSansSegment` est effacée (fichier puis ligne, budget rendu) ;
  - routes de §39.3.9 : `POST /api/salons/pieces` (`X-Shh-Membre`, `{bucket, vocal}` → `{piece, upload_token}`, jeton d'envoi signé `SalonPiece`, valable jusqu'à min(6 h, fin du salon)), `PUT /api/salons/pieces/segments/{n}` (Bearer), `POST /api/salons/pieces/finalize` (Bearer, `{fill_from, fill_to}`), `GET /api/salons/pieces/segments/{n}` (`X-Shh-Membre`, `X-Shh-Piece`, en flux sous `pacer`, inscrit dans `Streams` sous `"m:" + hex(SHA-256(jeton))` et `"p:" + id`), `POST /api/salons/pieces/retirer` (`X-Shh-Membre`, `X-Shh-Piece`, `{}`) ; envoi et lecture refusés (403 `excluded`) pour un jeton révoqué, même avec un jeton d'envoi encore valable.
- [ ] **Step 1 : tests**
  - salon : `TestBudgetUnGo` (paliers 8 000 ×2 réservés : le troisième → `ErrBudget` ; « 500 Mo » = palier 8 000 = 524 416 048 o accepté, 16 385 refusé `ErrBadRequest`) ; `TestVocalHorsBudget` (salon plein à 1 Go : un vocal palier 1 passe encore) ; `TestReserveVocale` (siège connecté 20 s → 80 000 o : palier 1 (65 600 o) accepté, un second refusé avec `Retry` = 13 s ; après 1 h 30 connecté, réserve = 14 400 000 o, pas plus) ; `TestVocalPalierRefuse` (vocal palier 160 → `ErrBadRequest`) ; `TestBudgetRendu` (pièce retirée → `budget_left` revient) ; `TestPieceLieeSuitSaTrame` (trame 10 min avec pièce → à 600 s, fichier et ligne effacés) ; `TestPieceLieeRetrait` (retrait de la trame `0x02` → pièce effacée, flux en cours coupé) ; `TestPieceNonLiee` (finalisée, jamais liée → effacée à 15 min) ; `TestLienRefuse` (pièce d'un autre siège, non finalisée, déjà liée, avec une volatile → `ErrBadRequest`).
  - api : `TestPieceEnvoiLecture` (création, segments exacts, `finalize` avec bourrage, lecture identique) ; `TestSegmentMauvaiseTaille` (400) ; `TestLectureBudget` (au-delà de `ReadBudget` → 429 `budget`) ; `TestPieceRetirerAuteurSeul` (autre membre → 403 `forbidden`) ; `TestPieceExclu` (jeton révoqué → 403 `excluded` pour `POST /pieces`, `PUT` avec un jeton d'envoi encore valable, `GET`) ; `TestCoupureLectureEnCours` (lecture lente en cours, la pièce est effacée → connexion coupée avant la fin, `Streams.Len() == 0`) ; `TestPieceSansDate` (fichier aux dates nulles) ; `TestQuotasPieces` (octets utiles débités à la finalisation dans `limits`).
- [ ] **Step 2 :** `cd server && go test -race ./internal/salon/ ./internal/api/ -run Piece` → FAIL.
- [ ] **Step 3 :** implémenter ; les pièces vivent dans leur propre `blob.Store` (`SHH_DATA_DIR/salon-pieces`), jamais dans `blobs/` (que `janitor.Reconcile` efface s'il n'y trouve pas de partage).
- [ ] **Step 4 :** `go test -race ./...` puis `make test-go` → PASS.
- [ ] **Step 5 :** commit `feat(salon): pièces jointes, budget de 1 Go, vocaux au rythme d'une voix, lien avec la trame`.

### Task 14 : exclusion et rotation de l'invitation

> Relecture Task 13 : ajouter `TestPieceExclu` côté HTTP (403 `excluded` pour `POST /pieces`, `PUT` avec un jeton d'envoi encore valable, `GET`) et vérifier que l'exclusion coupe les lectures et envois de pièces en cours de ce membre (`Streams.Revoke` sur `"m:" + hex(SHA-256(jeton))`).

**Files :**
- Create : `server/internal/salon/exclusion.go`, `server/internal/salon/exclusion_test.go`
- Modify : `server/internal/api/handlers_salon.go`, `server/internal/api/salon_test.go`

**Interfaces :**
- Produces :
  - `type ExclureReq struct{ ManageV, AccessNewV, ProofV, Salt []byte; KdfOps, KdfMem int; Siege *uint8; Nonce *[16]byte; R uint32 }` ; `func (m *Manager) Exclure(r ExclureReq) error` : `S_gestion` vérifié ; `Siege` et `Nonce` tous deux présents ou tous deux absents (sinon `ErrBadRequest`) ; `Siege == 0` → `ErrBadRequest` (on ne s'exclut pas) ; le siège ne porte pas ce nonce → `ErrStale` ; `R` ≤ dernier `r` → `ErrStale` ; **une transaction** remplace `access_v`, `proof_v`, `salt`, `kdf_*` et remet `failed_attempts` à 0, avec `WHERE … AND failed_attempts<10` et exactement une ligne touchée (sinon `ErrNotFound` : une ligne bloquée à 10 essais ne revit jamais, relecture Task 6) (nouvelle `access_v` déjà prise → `ErrConflict`) ; puis, sous le verrou du salon : jetons du siège révoqués (gardés jusqu'à la fin du salon), WebSocket fermé (`EnrFin(5)`, 4002), flux de pièces de ce jeton coupés (`Streams.Revoke`), siège libéré, retiré des `attendus` (Task 11), `EnrExclusion(seq, siège ou 0xFF, nonce, r)` au journal et diffusé, plancher des pièces = ce rang pour les jetons émis ensuite ;
  - route `POST /api/salons/exclure` (`X-Shh-Manage`, `X-Shh-Access-New` ; corps `{seat?, nonce_arrivee?, r, proof_v, salt, kdf_ops, kdf_mem}` → `{}`).
- [ ] **Step 1 : tests** (§39.13.5, partie serveur) — `TestPlancher` (jeton émis après une exclusion : pièce antérieure → `ErrNotFound` identique à une pièce inconnue, pièce postérieure servie ; jeton plus ancien → les deux) ; `TestInstantaneExclu` (l'exclu n'est plus attendu : trame effacée, `0x0E`) ; `TestExclureSansGestion` (jeton de membre ou rien → 403) ; `TestExclureStale` (nonce d'un siège réattribué → 409 `stale`) ; `TestExclureSoiMeme` (siège 0 → 400) ; `TestExcluRefusePartout` (reconnexion → 4002 ; trame, pièce, retrait refusés) ; `TestAncienAcces` (`meta` et `rejoindre` avec l'ancienne `K_accès_s` → 404 identique à un salon inconnu, octet pour octet) ; `TestAnciennePreuve` (nouvelle `K_accès_s'`, ancienne preuve → 403 `bad_password`, compté) ; `TestRotationAtomique` (panne simulée au milieu de la transaction par un déclencheur SQLite de test → aucune colonne changée) ; `TestExclusionUneFois` (`0x09` émis une fois, à un seul rang, reçu par tous les sièges restants, pas par l'exclu) ; `TestSiegeLibre` (l'exclu ne compte plus dans `max_members`) ; `TestRotationSeule` (sans `seat` : `0x09` siège `0xFF`, personne n'est sorti, ancien lien mort) ; `TestCoupureTelechargementExclu` (lecture de pièce en cours coupée, celle d'un autre membre continue) ; `FuzzExclure` (corps JSON muté : aucune panique, aucune ligne changée hors succès).
- [ ] **Step 2 :** `cd server && go test -race ./internal/salon/ ./internal/api/ -run 'Exclu|Rotation|Ancien'` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `go test -race ./...` puis `make test-go` → PASS.
- [ ] **Step 5 :** commit `feat(salon): exclusion et rotation de l'invitation (partie serveur)`.

### Task 15 : fin de vie, destruction, purge au démarrage, administration

> Relecture Task 12 : câbler `ExtraUsed` des partages seulement si `SHH_SALONS=1` ; `UsedPartages` n'inclut jamais `ExtraUsed` (pas de double compte), test d'intégration ; `checkStorage` au démarrage compte l'usage du salon ; test : un téléchargement de partage reste servi pendant qu'un salon est plein.
> Relecture Task 9 : `0x05` (fin) doit atteindre aussi une connexion qui est en rattrapage, pas seulement celles qui sont dans le direct. Ajoute un test.

**Files :**
- Create : `server/internal/salon/fin.go`, `server/internal/salon/fin_test.go`
- Modify : `server/internal/api/handlers_salon.go` (`POST /api/salons/detruire`), `server/cmd/shhdrop/main.go` (gestionnaire branché si `cfg.Salons`, dossiers `salons/` et `salon-pieces/` en 0700, purge avant l'écoute, `Run`, `ExtraUsed`, `srv.RegisterOnShutdown(m.FermerTout)`), `server/cmd/shhdrop/admin.go` (`destroy -` reconnaît `#c<43>`, `wipe` efface aussi les salons), tests de `cmd/shhdrop`

**Interfaces :**
- Produces :
  - `func (m *Manager) Detruire(sGestion, jeton []byte, signalement bool) error` (`S_gestion`, ou jeton de membre si `members_can_destroy`, sinon `ErrForbidden`) ;
  - fin commune `func (m *Manager) finir(s *salon, raison byte)` : dans cet ordre (ordre de la correction I1 de la Task 6 : mémoire d'abord), `EnrFin(raison)` à chaque connexion puis fermeture 1000, flux de pièces coupés, état mémoire oublié sous le verrou du salon (`fini`, jetons, révoqués, journal, index ; tombe gardée jusqu'à l'échéance + 1 min), `Conversation.Detruire` (clé mise à zéro, fichier supprimé), pièces effacées (fichier puis ligne), ligne `salons` supprimée ; sans effet sur une tombe ; une erreur de suppression est gardée pour une reprise par `Tick` (aucun salon ne reste à moitié détruit sans nouvel essai) ; raisons : expiration 1, destruction (créateur, membre, 10 mots de passe faux, administrateur) 2 ;
  - `func (m *Manager) Run(ctx context.Context)` : `Tick` chaque seconde (échéances des trames, sièges hors ligne, pièces sans lien ou sans segment, salons échus) et, à chaque tick, `SELECT id FROM salons WHERE id IN (salons en mémoire)` : une ligne disparue (administrateur) → `finir(…, 2)`, salons `fini` (tombes) exclus de cette requête ; lignes `failed_attempts >= 10` supprimées à chaque tick ; une ligne supprimée hors processus (`admin destroy`) rend sa place du plafond « 5 salons vivants par /48 » dès que `Run` la voit disparaître (elles gardent `proof_v`, cible hors ligne pour qui lit la base) ;
  - `func (m *Manager) PurgerAuDemarrage() error` : supprime tout `salons/*` et `salon-pieces/*`, toutes les lignes `salon_pieces`, `pieces_bytes = 0`, salons échus et lignes `failed_attempts >= 10` supprimés ; dossiers `salons/` et `salon-pieces/` ramenés à 0700 (`Chmod`, `MkdirAll` ne resserre pas un dossier existant) ; puis `store.Checkpoint` ;
  - admin : `salonAccessKeyOf(link string) ([]byte, bool)` = HKDF-SHA-256(`K_lien`, sel vide, `shhdrop/v2/salon/acces`, 32) pour un lien `#c<43>` ; `destroy -` affiche `1 salon détruit (dossier)` ; `wipe --yes` supprime aussi salons, pièces et conversations.
- [ ] **Step 1 : tests**
  - `TestExpiration` : à `expires_at`, `0x05` raison 1 chez tous, fichier de conversation et pièces absents, ligne absente, `Membre` → `ErrNotFound`, clé de la `Conversation` nulle.
  - `TestDetruireCreateur`, `TestDetruireMembreSiPermis` (sinon 403 `forbidden`), `TestDetruireSignalement` (compteur horaire des signalements +1, aucun identifiant).
  - `TestDixFauxDetruit` : 10ᵉ mot de passe faux → raison 2 chez les connectés, tout effacé.
  - `TestOrdreDeFin` : connexions fermées avant l'effacement des fichiers ; pièces : fichier supprimé avant la ligne (un échec simulé de suppression de fichier laisse la ligne, reprise au tick suivant).
  - `TestPurgeAuDemarrage` (Review : redémarrage) : un salon vivant avec conversation et pièces, nouveau `Manager` sur le même dossier → `PurgerAuDemarrage` efface conversation et pièces, garde la ligne avec `pieces_bytes = 0` ; un `rejoindre` repart avec un siège neuf et des rangs depuis 1.
  - `TestAdminSalon` : vecteurs `cles` de `salon-v3.json` (`k_lien` → `k_acces` et `v_acces`) ; `admin destroy -` d'un lien `#c…` supprime ligne, pièces et conversation ; le serveur en marche ferme ses connexions en raison 2 au tick suivant ; la sortie ne contient pas le lien.
  - `TestWipeSalons` ; `TestSortieMuette` : stdout ne contient que `SHH_LISTENING …`, stderr vide après un salon complet.
- [ ] **Step 2 :** `cd server && go test -race ./internal/salon/ ./internal/api/ ./cmd/shhdrop/` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `go test -race ./...` puis `make test-go` → PASS.
- [ ] **Step 5 :** commit `feat(salon): fin de vie, destruction, purge au démarrage, admin destroy #c`.

### Task 16 : conversation de bout en bout avec le vrai moteur

Le moteur natif du salon n'a pas de client WebSocket (en ajouter un serait une dépendance de plus) : l'échange de bout en bout se fait sous Node avec le **module wasm du même crate** (`web/src/salon/engine.ts`, chargé depuis le disque par `source.ts`) contre le vrai binaire Go ; l'égalité natif ↔ wasm est déjà prouvée par `engine/salon/tests/croise.rs`. Les parcours dans de vrais navigateurs (3 contextes, Playwright, WebKit) restent pour C-3.

**Files :**
- Create : `web/e2e/salon-client.ts` (client de test : création, entrée, WebSocket, moteur), `web/e2e/salon-flow.test.ts`
- Modify : `web/e2e/server.ts` (`startServer({ salons: true })` : port libre choisi d'abord, `SHH_LISTEN` et `SHH_ORIGIN=http://127.0.0.1:<port>`, `SHH_SALONS=1`)

**Interfaces :**
- Consumes : routes et protocole des Tasks 7 à 15 ; `loadSalonEngine()`, `passwordKey` (moteur des partages, Argon2id), `solveAltcha`.
- Produces : `class ClientSalon { static async creer(srv, opts): Promise<{ createur: ClientSalon; lien: Uint8Array; mdp: string }> ; static async rejoindre(srv, lien, mdp): Promise<ClientSalon> ; envoyer(e: EnveloppeEnvoi): Promise<number /* seq */> ; attendre(pred): Promise<Evenement> ; lu(seq: number) ; couper() ; reconnecter() ; fermer() }` : WebSocket de Node avec `headers: { Origin }`, accueil de 51 octets, `0x0D` → `remplacerAnnonces`, `0x02`/`0x0A` → `annoncer`, `0x03`/`0x09` → `marquerParti`, `0x01` → `recevoirTrame(trame, seq, siège)`, événement `KeyPackage` → `ajouter` par le plus petit siège en ligne, `CommitAccepte { welcome }` → envoi du Welcome.
- [ ] **Step 1 : test** `salon-flow.test.ts` (« trois clients, vrai moteur ») : le créateur (siège 0) et deux invités (sièges 1, 2) entrent ; chacun lit les textes des deux autres (`Evenement.Message`, enveloppe identique) ; un `ecrit` (volatil) est reçu en direct et n'apparaît pas au rattrapage ; un message « instantané » est lu (`0x05`) par les deux autres → `0x0E` chez les trois ; un message retiré n'est plus servi ; une coupure de l'invité 2 pendant 20 messages puis `reconnecter` avec son dernier `seq` → il les lit tous dans l'ordre ; une reprise (nouvelle identité) → le créateur l'ajoute de nouveau, il lit les messages suivants ; une pièce de 5 Mio envoyée, liée à sa trame, relue par un autre à l'identique ; un 4ᵉ client avec un mauvais mot de passe → 403 `attempts_left` 9 ; destruction par le créateur → `0x05` raison 2 chez tous.
- [ ] **Step 2 :** `make test-e2e` → PASS (un échec désigne un écart entre le serveur et le moteur : corriger le serveur, jamais le test ; le moteur seulement par une nouvelle tâche du moteur avec ses vecteurs).
- [ ] **Step 3 :** commit `test(salon): conversation à trois clients avec le moteur du salon contre le vrai serveur`.

### Task 17 : « le serveur ne voit rien » étendu au salon, exploitation, documentation

**Files :**
- Create : `web/e2e/salon-sees-nothing.test.ts`
- Modify : `deploy/env.example`, `deploy/compose.yaml` (`SHH_SALONS: "0"`, `SHH_ORIGIN: https://${SHH_DOMAIN}`), `deploy/test-proxy.sh` (WebSocket à travers Caddy), `THIRD_PARTY_LICENSES.md` (dépendances Go du serveur, dont coder/websocket ISC), `docs/superpowers/specs/2026-11-11-salon-v3-design.md` (§3.6.1 exigences C-2 faites ; exigences C-3 ajoutées : points 8, 9, 11, 12, 14, 17 ; §10 : vocal, lien pièce ↔ trame, lectures), `docs/superpowers/specs/2026-11-03-shhdrop-design.md` (§39.3.1 enregistrements et codes, §39.3.8 S31, S37, S43 « fait C-2 »), `README.md` si les variables y sont listées

**Interfaces :**
- Consumes : `ClientSalon` (Task 16), `scanDir`, `scanProcessMemory`, `capturingFetch`, `needle` (`web/e2e/scan.ts`).
- [ ] **Step 1 : test bloquant** `salon-sees-nothing.test.ts` (même structure que `sees-nothing.test.ts`) : trois clients ; repères dans le pseudonyme (message `profil`), un texte, un nom de fichier et le contenu d'une pièce, un vocal, une réaction, le mot de passe, `K_lien`, `K_mdp`, `K_trame`, `K_preuve_s` (envoyée pour entrer, jamais gardée), le jeton de membre, l'`heure_ms` d'un message ; adresse, User-Agent et Referer repères comme le test des partages. Exige : aucun repère (brut, base64url, base64) dans `shares.db`, son WAL, `salons/`, `salon-pieces/`, `blobs/`, stdout, stderr, ni dans une réponse ; aucune fenêtre de 32 octets d'aucune trame envoyée dans `salons/` (seconde couche) ; aucune heure de réception (8 octets de chaque `0x01` reçu) sur disque ; `salons` n'a que les colonnes de §39.3.5 et `sqlite_master` que les noms de la Task 4 ; chaque `0x01` montant fait 4 141 ou 4 157 octets ; aucun en-tête de requête ne porte un pseudonyme ; mémoire du processus : aucun repère de contenu ni de clé ; après destruction puis arrêt : ni ligne, ni pièce, ni fichier de conversation.
- [ ] **Step 2 :** `make test-e2e` → PASS (le test bloque toute mise en ligne).
- [ ] **Step 3 : Caddy** — `deploy/test-proxy.sh` : serveur avec `SHH_SALONS=1`, WebSocket ouvert à travers Caddy, gardé 75 s (au-delà de `idle 1m`) avec pings, toujours ouvert ; `Origin` étranger → 403 à travers Caddy. `make test-proxy` → PASS ; `make lint-deploy` → PASS.
- [ ] **Step 4 : documentation** (en français) : variables `SHH_SALONS`, `SHH_SALONS_MAX`, `SHH_ORIGIN` ; rappel Q-SAL8 (`SHH_SALONS=0` en public) ; `Caddy reload` coupe les WebSocket (reconnexion automatique, documentée) ; textes de spec listés en « Files ».
- [ ] **Step 5 :** `make test` → PASS ; commit `test(salon): le serveur ne voit rien, étendu au salon ; exploitation et docs (C-2)` ; push sur `main` après tests verts.

---

## Auto-relecture (faite)

- **Couverture :** exigences C-2 de v3 §3.6.1 : 1 (siège attesté dans `0x01`) Tasks 3, 8 ; 2 (liste avec son `seq`) Tasks 3, 9 ; 3 (`0x02`/`0x0A` avant les trames liées) Tasks 6, 8, 9 (journal dans l'ordre `seq`) ; 4 (KeyPackages) Task 8 et point 9 ; 5 (`epoque_perdue` → reprise) point 5, Task 9 ; 6 (heure de réception en mémoire) Tasks 8, 11 ; 7 (ordre, rattrapage puis direct) Tasks 8, 9 ; 8 (retrait par l'auteur, lu par le lecteur) Tasks 8, 11. v3 §5.1 : disque et seconde couche (5), volatiles non écrits (8), 1 200/h et cadence (12), réserve vocale (13), `SHH_STORAGE_MAX` (12). §39.3 : routes (7, 10, 13, 14, 15), base (4), limites (7, 9, 10, 12, 13), ce que voit le serveur (17). §39.13 : exclusion, plancher, flux coupés (13, 14). §39.1 fin de vie (15). §3.6.2 : Task 1. Bancs de latence `bench/salon-latency` (§39.3.1) : non couverts ici, pas bloquants pour la mise en ligne seule (spec) ; à faire avec C-3.
- **Types :** `Membre`, `Recevoir(mb, trame, piece)`, `Lu`, `Retirer`, `Quitter`, `Servir(ctx, l, ip)`, `EnrTrame(seq, siege, recuMs, trame)` et les erreurs de `erreurs.go` gardent les mêmes noms d'une tâche à l'autre.
- **Proportion :** aucune fonction n'est écrite en entier ; les octets du protocole et les constantes sont fixés une seule fois (« Protocole », « Global Constraints »).
