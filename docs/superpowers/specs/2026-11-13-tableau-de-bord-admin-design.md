# Tableau de bord d'administration — conception

Date : 13 novembre 2026. Demande du propriétaire (« commence le Dashboard aussi »). Ce document est à **valider avant tout code**. Les choix marqués *(proposé)* sont les miens, à confirmer ou corriger.

## Intention et pourquoi

Donner à l'exploitant (le propriétaire) une **vue d'ensemble et des commandes** du serveur en marche, sans passer par SSH + ligne de commande à chaque fois : voir la santé (disque, charge, signalements en attente), geler/dégeler les créations, traiter un lien signalé, basculer le stockage S3, et déclencher l'effacement d'urgence. Aujourd'hui tout cela existe en **ligne de commande** (`shhdrop admin freeze|unfreeze|destroy -|wipe`, `shhcheck health`) ; le tableau de bord les réunit dans une page.

## La contrainte de sécurité qui gouverne tout

Le serveur « ne voit rien » et n'a **pas de compte**. Un tableau de bord est une **surface privilégiée et authentifiée** : c'est la cible la plus intéressante du service, car une prise de contrôle donne `wipe` (tout effacer) et `freeze` (couper le service). Donc :

- Il ne révèle **jamais** de contenu, de nom, de clé, d'identifiant de partage/salon ni d'adresse IP (il n'y a rien de tel à montrer : seulement des agrégats).
- Il n'est **jamais** exposé sur le site public ni sur une URL devinable.
- Son pouvoir d'administration ne traverse **jamais** l'Internet public en clair.
- Il n'écrit aucune adresse IP ni identifiant sur disque (règle du projet).
- Un échec d'authentification ne distingue pas « mauvais jeton » de « route inconnue » (temps constant, réponse fixe), comme les actions du créateur de salon.

## Objectifs

Une **vue de tout le système** (demande du 13 novembre : « déterminons toutes les options qu'on peut afficher pour avoir une visu du système entier »), sous une seule règle : **tout ce qui est agrégé s'affiche ; rien qui touche un identifiant, une adresse IP ou un contenu**. Valeurs **lues en direct** à chaque affichage, **jamais enregistrées** (aucune série dans le temps sur disque). Inventaire complet ci-dessous.

## Inventaire complet de ce qui s'affiche

Légende — **Dispo** : la donnée existe déjà dans le serveur. **Nouveau** : un compteur ou une lecture agrégée à ajouter (en mémoire seulement). **Phase** : 1 = codé maintenant ; 2 = plus tard (dépend d'une autre conception).

### A. Santé et état général
| Information | Source | Dispo / Nouveau | Phase |
|---|---|---|---|
| Serveur en marche, depuis quand (durée de fonctionnement) | heure de démarrage gardée en mémoire | Nouveau | 1 |
| Version de Go et empreinte de compilation (si présente) | `runtime/debug.ReadBuildInfo` | Dispo | 1 |
| Créations gelées ou non | `Service.Frozen()` | Dispo | 1 |
| Salon activé ou non (`SHH_SALONS`) | configuration | Dispo | 1 |
| HTTP/3, origine du salon | configuration | Dispo | 1 |
| Alerte signalements (oui / non) | `reportCounter.alert` (booléen, §15.2) | Dispo | 1 |
| Stockage S3 actif ou non | drapeau du stockage objet | Nouveau | 2 (doc S3) |

### B. Stockage et disque
| Information | Source | Dispo / Nouveau | Phase |
|---|---|---|---|
| Espace disque libre et total | `statfsFree(SHH_DATA_DIR)` | Dispo | 1 |
| Plafond de stockage `SHH_STORAGE_MAX` | configuration | Dispo | 1 |
| Octets des partages | `Service.UsedShares()` | Dispo | 1 |
| Octets des pièces et conversations du salon | `salon.Manager.UsedBytes()` | Dispo | 1 |
| % du plafond utilisé, place restante | calculé | Dispo | 1 |
| Réserve « nouveaux venus » (dernier huitième) | calculé (`StorageLimit`) | Dispo | 1 |

### C. Mémoire et moteur d'exécution
| Information | Source | Dispo / Nouveau | Phase |
|---|---|---|---|
| Mémoire utilisée / limite `GOMEMLIMIT` | `runtime.MemStats`, `debug.SetMemoryLimit(-1)` | Dispo | 1 |
| Nombre de goroutines | `runtime.NumGoroutine` | Dispo | 1 |
| Fils du système (à comparer à `pids_limit`) | `/proc/self/status` (Threads) | Dispo | 1 |
| Ramasse-miettes : nombre de passes, dernière pause | `runtime.MemStats` | Dispo | 1 |
| Trames du salon en mémoire / plafond global | `tramesGlob` / `SHH_SALON_FRAMES_TOTAL` (S1) | Dispo | 1 |

### D. Capacité et charge (places)
| Information | Source | Dispo / Nouveau | Phase |
|---|---|---|---|
| Plafonds : envois, lectures, surveillances, WebSocket, appels disque | `config.Capacity` | Dispo | 1 |
| Surveillances tenues / plafond | `Service.WatchCount()` | Dispo | 1 |
| Octrois et budgets de lecture actifs | `Service.GrantCount()`, `BudgetCount()` | Dispo | 1 |
| Connexions WebSocket du salon ouvertes / plafond | `salon.Manager` (connexions servies) | Dispo | 1 |
| Appels disque en cours / plafond (`SHH_DISK_OPS_MAX`) | `blob.Gate` (usage) | Nouveau (lecture publique) | 1 |
| Envois et lectures de segments en cours | compteurs de places | Nouveau | 2 |

### E. Partages (agrégats, jamais un identifiant)
| Information | Source | Dispo / Nouveau | Phase |
|---|---|---|---|
| Partages vivants, par état (envoi en cours, prêt, en fin de lecture) | `SELECT state, count(*) … GROUP BY state` | Nouveau | 1 |
| Répartition par palier de taille | `GROUP BY bucket` | Nouveau | 2 ⚠️ |

### F. Salons (agrégats, jamais un identifiant)
| Information | Source | Dispo / Nouveau | Phase |
|---|---|---|---|
| Salons vivants / `SHH_SALONS_MAX` | `salon.Manager` | Nouveau (lecture agrégée) | 1 |
| Sièges occupés au total | somme des sièges, sans dire où | Nouveau | 1 |
| Octets des conversations | `octetsConv` | Dispo | 1 |
| Paniques récupérées dans l'entretien | `Manager.PaniquesTick()` | Dispo | 1 |

### G. Sécurité et abus (agrégats)
| Information | Source | Dispo / Nouveau | Phase |
|---|---|---|---|
| Alerte signalements (oui / non) | voir A | Dispo | 1 |
| Refus par limite de débit (nombre, sans adresse) | compteur global | Nouveau | 2 |
| Destructions au 5ᵉ / 10ᵉ mot de passe faux | compteur global | Nouveau | 2 |

### H. Actions (commandes depuis la page)
| Action | Réutilise | Phase |
|---|---|---|
| Geler / dégeler les créations (réversible) | fichier `frozen` (comme `admin freeze`) | 1 |
| Détruire un lien signalé (partage ou salon) | `DestroyAdmin`, destruction de salon | 1 |
| Basculer S3 actif / inactif | doc S3 | 2 |
| **Effacement d'urgence `wipe`** | — | **jamais dans la page** (voir décision) |

### I. Exclu, définitivement (le tableau de bord ne doit pas devenir une fuite)
- Liste ou identifiant de partage, de salon, de pièce.
- Adresses IP, blocs /48, tout compteur **par** adresse (le paquet `limits` n'expose que des décisions par adresse, précisément pour ça).
- Contenu, noms de fichiers, clés, liens, mots de passe, pseudonymes, membres d'un salon.
- Heure de création d'un partage ou d'un salon précis (fuite Z1).
- Historique, courbes, séries temporelles enregistrées sur disque ; journal des accès.

### Points signalés (⚠️), avec le choix par défaut retenu
- **Nombre exact de signalements** : la spec (§15.2, §36 S21) n'expose volontairement qu'un **booléen**, pour qu'un compteur ne révèle pas l'activité. **Retenu : booléen**, choix validé respecté ; à rouvrir seulement si le propriétaire le décide.
- **Répartition par palier de taille** (E) : agrégée, mais elle dessine la distribution des tailles. Mise en phase 2, à valider.
- **Faible trafic** : avec très peu d'utilisateurs, des agrégats (« 1 salon, 2 sièges ») peuvent désigner une activité précise. L'exploitant a de toute façon accès à la base par SSH : le tableau de bord n'ajoute aucune exposition nouvelle, mais il ne doit rien **enregistrer**.

## Décision : pas d'effacement d'urgence (`wipe`) dans la page

Un jeton d'administration volé doit pouvoir faire **le moins de mal possible**. Geler est réversible ; détruire un lien signalé ne touche qu'un partage. Mais `wipe` efface tout, sans retour. **Il reste en ligne de commande seulement** (`shhdrop admin wipe --yes`, par SSH), là où il exige déjà une confirmation explicite. Ainsi, même un tableau de bord compromis ne peut pas tout effacer.

## Non-objectifs

- Aucune statistique par partage, par salon, par personne ou par adresse. Agrégats seulement.
- Aucun historique persistant (pas de journal d'accès sur disque ; au plus un compteur en mémoire).
- Pas de gestion de comptes utilisateurs (il n'y en a pas), pas de multi-admin fin pour l'instant.
- Pas la conception du **stockage S3 lui-même** : c'est un document à part (`2026-11-13-stockage-s3-design.md`) ; ici on n'expose que la **bascule** et l'état.

## Anti-objectifs (ce qui serait un échec même si ça « marche »)

- Le tableau de bord atteignable depuis l'Internet public sans barrière forte.
- Une fuite d'identifiant, d'IP ou de contenu par une page d'administration.
- Une page d'administration qui, compromise, laisse faire `wipe` sans une seconde preuve.
- Un couplage qui, si le tableau de bord tombe ou est bogué, dégrade le service public (cloisonnement : un problème ici ne doit rien casser ailleurs — règle du propriétaire).

## Approches envisagées

1. **Page servie en local seulement (127.0.0.1), atteinte par tunnel SSH — _(recommandé)_.** Le serveur Go sert les routes d'administration sur un **écouteur distinct lié à 127.0.0.1** (port séparé, jamais le port public, jamais derrière Caddy). L'exploitant y accède par `ssh -L` depuis sa machine. Auth : un **jeton admin** long tiré au déploiement (variable d'environnement, jamais sur disque de données), comparé en temps constant ; ou, mieux, rien de plus que l'accès SSH lui-même (qui est déjà la clé du royaume). Surface d'attaque **minimale** : aucune nouvelle porte ouverte sur Internet ; qui peut l'atteindre pouvait déjà tout faire en SSH. Inconvénient : il faut un tunnel SSH (une ligne), pas un simple favori.
2. **URL publique secrète + mTLS.** Accessible depuis Internet sur un chemin non devinable, protégé par **certificat client** (mTLS, vérifié par Caddy ou le serveur). Plus pratique à distance. Mais : une nouvelle porte authentifiée sur Internet, une PKI client à gérer, et une surface plus grande pour une utilité (confort à distance) faible face au risque. **Écarté** sauf besoin explicite.
3. **Rester en ligne de commande, enrichir `shhcheck`.** Pas de page : on ajoute des sous-commandes de lecture et la bascule S3 à `shhdrop admin` / `shhcheck`. Zéro nouvelle surface web. C'est le plus sûr, mais c'est ce qu'on a déjà, sans la « vue d'ensemble » demandée.

**Retenu : approche 1** *(proposé)*. Elle donne la page demandée tout en gardant le pouvoir d'administration **hors de l'Internet public** : c'est le meilleur rapport sécurité / utilité pour un service de ce niveau de confidentialité.

## Ce qui est décidé (sous réserve de validation)

- **Exposition** : écouteur HTTP distinct lié à `127.0.0.1:<port admin>` (défaut proposé : non exposé par `compose.yaml`, port publié seulement vers l'hôte, pas vers Internet). Jamais servi par Caddy. Variable `SHH_ADMIN_LISTEN` (vide = tableau de bord désactivé : par défaut **désactivé**, activé explicitement au déploiement).
- **Authentification** : jeton `SHH_ADMIN_TOKEN` (≥ 32 octets aléatoires), en-tête `Authorization`, comparé en temps constant ; absent ou faux → réponse fixe, aucune distinction de route. Jeton jamais écrit sur disque de données, jamais journalisé.
- **Données** : les lectures réutilisent les compteurs déjà tenus en mémoire (capacité, usage disque, salons/partages vivants, signalements) et `shhcheck health` ; **aucune nouvelle requête** qui lirait des identifiants. Agrégats uniquement.
- **Actions** : réutilisent les fonctions existantes — geler / dégeler (fichier `frozen`, comme `admin freeze`) et destruction d'un lien signalé (lien lu dans le **corps** d'un POST, jamais dans l'URL, comme `admin destroy -` le lit sur l'entrée standard). **`wipe` n'est pas dans la page** (décision ci-dessus).
- **S3** : la page lit et bascule un drapeau d'état du stockage objet ; le comportement de S3 lui-même est défini dans son propre document. La bascule ne fait que poser le drapeau (et le dire à l'exploitant) ; elle ne migre pas les données.
- **En-têtes et CSP** : la page d'administration a sa **propre CSP stricte** (`default-src 'self'`, pas de tiers, Trusted Types), `no-store`, `X-Frame-Options: DENY`. Aucune ressource tierce (règle du projet).
- **Cloisonnement** : l'écouteur d'administration est séparé ; une panique dans un gestionnaire d'administration ne touche pas le serveur public (récupération par gestionnaire, comme ailleurs). Si l'écouteur d'administration ne démarre pas, le serveur public démarre quand même (le tableau de bord est un plus, pas une dépendance).
- **Interface** : une seule page sobre, aux couleurs du site, lisible au téléphone ; une signification par couleur (bleu = agir, ambre = attention/gel, corail = détruire/wipe). Rien d'« joli » au prix de la clarté : c'est un poste de pilotage.
- **Tests** : auth en temps constant et réponse fixe (jeton absent, faux, de mauvaise longueur : même réponse) ; aucune IP ni identifiant dans les réponses (fouille de l'état JSON) ; aucune route `wipe` ; le lien signalé jamais accepté dans l'URL ; l'écouteur d'administration absent du port public et refusé hors boucle locale ; tableau de bord désactivé par défaut (`SHH_ADMIN_LISTEN` vide) ; jeton trop court refusé au démarrage ; un plantage d'un gestionnaire d'administration ne tue pas le serveur public.

## Laissé au constructeur

Noms internes, découpage des fichiers (un paquet `internal/adminui` servi par un écouteur dédié dans `main.go`), forme exacte des composants de la page, format précis des réponses JSON de lecture, et la forme des tests ci-dessus.

## Choix faits par moi (« prends les meilleures décisions », 13 novembre), à corriger si besoin

1. **Exposition** : local (127.0.0.1) + tunnel SSH. URL publique + mTLS écartée (porte de plus sur Internet).
2. **Authentification** : jeton admin long, temps constant. Comme la page n'est joignable que par SSH, c'est une seconde barrière, pas la seule.
3. **`wipe`** : hors de la page, ligne de commande seulement.
4. **Dernier accès admin** : rien n'est gardé (ni sur disque ni affiché) — moins on garde, moins il y a à voler.
5. **Signalements** : booléen (choix validé de la spec), pas de nombre.

## Ordre de réalisation

- **Phase 1 (maintenant)** : écouteur local, jeton, page unique, état JSON (A à G sauf ce qui est marqué phase 2), actions geler / dégeler / détruire un lien signalé, tests.
- **Phase 2** : bascule S3 (après sa conception), compteurs nouveaux (refus de débit, envois et lectures en cours, destructions par mots de passe faux), répartition par palier si validée.

## État de réalisation (13 novembre, phase 1 codée)

Codé et testé : paquet `server/internal/adminui` (page, état JSON, actions), câblage dans `server/cmd/shhdrop/admin_serve.go`, variables `SHH_ADMIN_LISTEN` et `SHH_ADMIN_TOKEN` (`server/internal/config`). Désactivé par défaut ; `deploy/compose.yaml` n'est **pas** modifié (activation décrite dans `deploy/README.md` §4, à décider par le propriétaire).

Écarts par rapport au texte ci-dessus, à valider :

1. **Adresse d'écoute (moyenne, exploitation).** « Lié à 127.0.0.1 » ne marche pas en production : le serveur tourne dans un conteneur, dont la boucle locale n'est pas joignable par un tunnel SSH. Retenu : mêmes règles que `SHH_LISTEN` (boucle locale ; ou, derrière le proxy déclaré, l'adresse du réseau interne), et **chaque requête** n'est servie que si son pair est la boucle locale ou `SHH_TRUSTED_PROXY` (la machine). Une requête relayée par Caddy (`X-Shh-Client-IP`) est refusée.
2. **La page elle-même est servie sans jeton (faible).** Un navigateur ne peut pas envoyer d'en-tête `Authorization` en ouvrant une page. Les trois fichiers de la page (HTML, CSS, JS : aucune donnée, aucun secret) sont donc servis sans jeton, au pair autorisé seulement ; tout `/api/*` exige le jeton et répond de façon uniforme sinon. L'authentification « Basic » du navigateur a été écartée : le navigateur la rejoue tout seul, ce qui permettrait à un autre site de déclencher un gel ou une destruction.
3. **Adresse du pair lue hors de `clientip.go` (faible, §36 S2).** `adminui.peerOK` lit `RemoteAddr` pour le contrôle du point 1 ; le test `api/minimize_test.go` l'autorise à cet endroit précis. Aucun en-tête nouveau n'est lu (`Authorization` et `X-Shh-Client-IP` étaient déjà dans la liste blanche). §36 S2 de la spécification est à amender d'une ligne.
4. **HTTP/3 n'est pas affiché** : c'est un réglage de Caddy, le serveur Go ne le connaît pas.
5. **Le jeton n'est pas gardé en clair par le serveur** : seule son empreinte SHA-256 est en mémoire ; la comparaison se fait sur les empreintes, en temps constant.

Demande du propriétaire du 13 novembre, **non codée, à trancher** : « nombre de comptes ouverts, nombre d'abonnés, nombre total de liens ou de fichiers partagés ». Voir le compte rendu : les comptes (§37) et le paiement (§38) ne sont pas codés ; un total cumulé de partages est interdit en toutes lettres par §9.5 et §35.1 (« compteurs de partages créés, d'ouvertures, d'octets servis ») ; le nombre de fichiers d'un partage est inconnu du serveur (manifeste chiffré).
