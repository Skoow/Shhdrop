# Audit de confidentialité — 5 novembre 2026

Portée : serveur Go (`server/`), client Svelte (`web/`), démo GitHub Pages, textes publics (`fr.ts`, `en.ts`), cadre légal de l'exploitant. Lecture seule : aucun fichier du dépôt n'a été modifié. Non commité.

Références : CLAUDE.md ; spécification v2.6 §2, §9, §15, §17, §18, §26 à §34 ; spécification UI §9.12, §15. Lentilles appliquées : *privacy-review* (CON, LEAK, TRACK, STOR, RIGHTS) et *insecure-defaults* (catégories A à F). Ceci n'est pas un avis juridique : les points légaux sont à faire valider par un juriste (spec §17).

## 1. Méthode et limites

- **Version auditée** : `HEAD` (`d01baf9`), extrait avec `git archive` dans le dossier de travail de l'audit (`/tmp/claude-0/-home-user/b97dc3e7-f107-54ba-8c5b-d4198f88d7ff/scratchpad/audit-priv/`). L'arbre de travail du dépôt était en cours de modification par d'autres agents (`kdf.ts`, `container.ts`, `Faq.svelte`, `WhySafe.svelte`… ; le build de l'arbre de travail échoue : `deriveContent` absent de `kdf.ts`). Les textes d'interface cités sont ceux de l'arbre de travail pour `fr.ts`/`en.ts` (identiques à `HEAD` sur les clés auditées).
- **Preuves exécutées** : build de production et de démo, serveur Go réel (`shhdrop serve`), Chromium Playwright (contexte neuf, locale `fr-FR`, sans cookies), sondes d'API de fingerprinting injectées avant le chargement, test e2e `sees-nothing` (5 tests sur 5 réussis), test spécifique d'audit (IP simulée `203.0.113.77` via `X-Shh-Client-IP`, fouille du disque, de la mémoire et des dates de fichiers). Scripts : `probe.mjs`, `pages.mjs`, `pagesrv.mjs` et `src/web/e2e/priv-audit.test.ts` dans le dossier de travail.
- **Non vérifiable** : le dépôt ne contient aucun `Caddyfile`, `Dockerfile`, `docker-compose`, `deploy.sh` ni unité systemd (Plan 3 non commencé). Tout ce qui dépend de la pile d'exploitation est marqué « à vérifier ». Visibilité publique du dépôt GitHub non vérifiée (l'API GraphQL est bloquée dans cet environnement).
- **L'application est incomplète** : au `HEAD`, l'accueil, la page 404 et le message « navigateur non pris en charge » existent. Les routes `/s/…`, `/m/…`, `/securite`, `/confidentialite` affichent un titre vide ; le composeur répond « arrive bientôt ». Le serveur Go est complet pour le protocole (v1 d'identifiants dans le chemin) mais ne porte ni repli reCAPTCHA, ni lien court (§32), ni envoi anticipé (§29). Les écarts entre la spécification v2.6 et le code sont signalés là où ils touchent à la vie privée.

## 2. Résumé

| Gravité | Nombre |
|---|---|
| Élevée | 4 |
| Moyenne | 4 |
| Faible | 8 |
| Total | 16 |

Affirmations publiques examinées : 32 (tableau en section 5) : 13 VRAI, 16 À NUANCER, 3 FAUX.

Score indicatif de la lentille *privacy-review* (sur ce qui existe) : consentement 10/10 (aucun traceur, aucun stockage, aucun cookie), fuites 8/10, tiers 10/10 en production et en démo, stockage 8/10, droits 3/10 (pages absentes). Confiance : 90 % pour les constats observés dans le navigateur ou sur disque, 70 % pour le reste. `insecure-defaults` : aucun défaut dangereux confirmé dans le code Go (section 4).

**Ce qui est solide (observé)** :

- Aucune requête hors de l'origine en production et en démo : 9 requêtes en production, 12 en démo, toutes vers l'hôte lui-même (polices, images, scripts). Les URL `svelte.dev/e/…` du bundle sont des textes de messages d'erreur, jamais des requêtes.
- Aucun cookie, `localStorage`, `sessionStorage`, IndexedDB, OPFS, Cache API ni service worker après chargement.
- Le titre est constant (« Shhdrop », « Démo · Shhdrop »). Aucune sortie console, sauf une 404 de `/favicon.ico`.
- Le « # » d'un lien est retiré de la barre et de l'historique en production comme en démo (`/s/AAAA#BBBB…` devient `/s/AAAA`, aucune requête ne porte le fragment).
- Le clic vers GitHub part sans en-tête `Referer`.
- Aucune adresse IP (ni `203.0.113.77` ni `127.0.0.1`) dans le dossier de données après création, ouverture, puis arrêt du serveur ; stdout/stderr du serveur : une seule ligne `SHH_LISTENING`.
- Le test « le serveur ne voit rien » passe (5/5) : aucune clé, aucun mot de passe, aucun nom ni texte sur disque, en mémoire, dans les sorties ou dans les URL.

## 3. Constats par gravité

### Élevée

**P1 — Conflit non tranché entre « aucune IP » et la conservation LCEN (légal)**
- Endroit : spec §17 (premier point), CLAUDE.md (« Aucune adresse IP enregistrée »), `WhySafe.svelte` (« Aucune adresse IP sur disque »).
- Problème : la spec reconnaît un « conflit direct » avec l'obligation de conservation des données d'identification pour les hébergeurs (LCEN art. 6, décret 2021-1362, 1 an, dont l'IP de création). Rien dans le dépôt ne consigne un avis de juriste ni une décision. La promesse est déjà publiée en toutes lettres sur l'accueil. Si Shhdrop est qualifié d'hébergeur, l'absence de conservation peut engager la responsabilité de l'exploitant (sanction pénale prévue par la LCEN pour le défaut de conservation : à faire confirmer). À l'inverse, conserver rend la promesse fausse.
- Correction : obtenir un avis écrit avant toute ouverture publique ; consigner la décision dans la spec §17 et la reporter dans la page Confidentialité. Si la conservation est requise : changer la promesse (« aucune IP dans l'application, conservée seulement dans le journal légal chiffré, 1 an ») avant d'ouvrir, pas après. Ne pas ouvrir au public sans cette décision.

**P2 — Pages Confidentialité, Sécurité, mentions légales, CGU et contact absentes (RGPD art. 12 à 14, LCEN art. 6-III, DSA art. 12 et 14)**
- Évidence : Playwright sur `/securite` et `/confidentialite` : seuls l'en-tête et le pied s'affichent (« Aller au contenu / shhdrop / English / Shhdrop / Sécurité / Confidentialité »). `/mentions-legales` et `/cgu` : « Cette page n'existe pas ». Le pied de page et le lien « Tous les détails de sécurité » mènent à ces pages vides. `App.svelte` rend `<h1>Shhdrop</h1>` pour ces routes.
- Problème : l'information de la personne (finalités, base légale, destinataires, durées, droits, transferts, contact) n'existe nulle part ; l'accueil renvoie vers du vide. La spec place mentions légales, CGU et contact au Plan 3 (UI §S16), donc le risque est de les oublier avant l'ouverture.
- Correction : ajouter un contrôle bloquant la mise en ligne (dans `check-dist.mjs` ou un test Playwright) qui échoue si `/securite`, `/confidentialite`, `/mentions-legales`, `/cgu` ont moins de N caractères de contenu. Contenu minimal listé en section 6.

**P3 — Repli Google reCAPTCHA : consentement et transparence insuffisants (RGPD, ePrivacy / art. 82 LIL, transfert hors UE)**
- Endroit : spec §26, UI §9.4.2 et §15, `verif.body`, `home.why.track.p`.
- État : non implémenté côté serveur (`git grep` de `SHH_VERIF`/`RECAPTCHA` : seulement des types client et des tests ; la CSP envoie `frame-src 'self'`), mais déjà décrit publiquement.
- Problèmes :
  1. Le consentement n'est pas « libre » : la seule alternative au clic est « Annuler l'envoi » (le service est refusé).
  2. Le texte omet l'identité du responsable (Google LLC), le transfert aux États-Unis (cadre de protection des données UE-États-Unis à citer), l'analyse du comportement et de l'appareil faite par reCAPTCHA, la durée des cookies, le lien vers la politique de Google et le moyen de retirer son consentement. La position de la CNIL sur reCAPTCHA est prudente (consentement requis, car Google réutilise les données pour ses propres finalités) : à confirmer avec le juriste.
  3. Google impose à l'éditeur d'informer les personnes (conditions d'utilisation de reCAPTCHA).
  4. La page Confidentialité (`#verification`) qui doit porter ces informations n'existe pas (P2).
  5. « Aucun cookie » / « aucun pistage » deviennent faux dans ce cas (UI A14 le notait) ; il faut que l'accueil et la page Confidentialité restent exacts dans tous les cas.
- Correction : (a) texte de la feuille : « Google LLC (États-Unis) » + effets (adresse IP, cookies, analyse du navigateur) + lien vers sa politique + « Vous pouvez refuser : essayez sur un autre appareil ou réessayez plus tard » ; (b) section `#verification` complète ; (c) test Playwright « aucune requête vers `google.com`/`gstatic.com` avant le clic » et « aucune ressource Google dans le cadre principal » (déjà prévu §26) ; (d) à discuter : supprimer le repli (priorité 3 de CLAUDE.md : simplicité) et le remplacer par une preuve de travail sans Worker (thread principal) plus coûteuse, ce qui supprime tout tiers, tout consentement et tout transfert.

**P4 — Promesse « photos nettoyées » non tenue (`home.faq.scan.a`, `compose.cleaned`)**
- Évidence : `git grep -i 'exif\|nettoy'` sur `web/src` ne trouve aucun code de retrait des métadonnées ; `compose.cleaned` n'est utilisée que dans le dictionnaire.
- Problème : l'accueil affirme que « la plupart des photos sont nettoyées avant le chiffrement (lieu, appareil, date de prise de vue) » et que « l'écran vous le dit ». Une personne qui envoie une photo en croyant la position retirée la transmet avec ses coordonnées GPS au destinataire.
- Correction : retirer la phrase jusqu'à l'implémentation (ou la remplacer par « Les photos sont envoyées telles quelles »). À l'implémentation : retrait par réencodage Canvas ou lecture des segments JPEG/PNG/WebP, test avec une photo piégée (GPS, `Make`, `DateTimeOriginal`, `Orientation`), liste explicite des formats non nettoyés (HEIC, vidéos, PDF) affichée avant l'envoi.

### Moyenne

**P5 — La date d'accès du fichier chiffré révèle l'heure de la première lecture (timing)**
- Évidence (serveur réel, test d'audit) : après une ouverture, le fichier du partage montre `mtime = 1970-01-01T00:00:00Z` mais `atime = 2026-11-05T12:30:48.088Z`, soit l'instant de la lecture du segment, au millième de seconde. Le serveur n'écrit que `Chtimes(epoch, epoch)` à l'écriture (`blob/blob.go:49`, `WriteAt`) ; `ReadAt` n'y touche pas, donc le noyau (`relatime`) met `atime` à jour à la première lecture, puis au plus une fois par jour.
- Spec §9.2 annonce « dates d'accès et de modification remises à zéro » : vrai à l'écriture, faux après lecture. Cela s'ajoute à la date de naissance (`birth` = 12:30:47.924) que la spec admet (§18.6) ; en plus, l'heure d'ouverture, que la spec veut ne pas stocker (§9.1, §33), devient lisible par qui accède au volume.
- Correction : (1) exiger le montage `noatime` du volume de données et le vérifier au démarrage (lecture de `/proc/self/mountinfo`, refus de démarrer sinon, comme pour l'espace disque) ; (2) en plus, ouvrir en `O_NOATIME` (Linux) et appeler `wipeTimes` après chaque lecture (au mieux) ; (3) test : créer, ouvrir, vérifier `atime == 0` ; (4) ajouter la limite à la spec §18.6.

**P6 — Adresse IP possible sur disque hors de l'application, non couverte par un test (exploitation)**
- Évidence : le dépôt ne contient aucune configuration de Caddy, de conteneur ni de journalisation (Plan 3). Le test « le serveur ne voit rien » ne cherche aucune adresse IP (constat de lecture de `sees-nothing.test.ts` : aiguilles = texte, nom, mot de passe, clés, identifiants). La fouille mémoire que j'ai exécutée retrouve l'IP simulée dans le tas du serveur (attendu : valeur d'en-tête et clé de HMAC).
- Risques à écarter dans la pile : (a) Caddy journalise par défaut sur stderr les erreurs TLS avec l'IP distante (`TLS handshake error from …`) ; avec Docker, stderr part dans un journal JSON sur disque ; (b) `sshd`, pare-feu (`ufw` journalise les blocages), `conntrack`, journald persistant, sauvegardes de VM ; (c) mémoire d'échange (swap) et vidages mémoire (core dumps) qui écrivent le tas, donc l'IP ; (d) l'hébergeur, hors de portée (déjà dit §18.3) ; (e) `X-Shh-Client-IP` doit être **écrasé** par Caddy (`header_up X-Shh-Client-IP {remote_host}`), sinon un client le fixe ; non vérifiable sans le fichier.
- Correction : Caddyfile avec journaux d'accès et journal par défaut vers `discard` (sorties `output discard` pour le journal global), pilote de journal Docker `none` ou rotation en tmpfs, `ulimit -c 0` / `LimitCORE=0`, swap désactivé ou chiffré (`vm.swappiness=0`, `MemorySwapMax=0`), `Storage=volatile` pour journald. Test de déploiement : envoyer 20 requêtes avec une IP repère, puis fouiller `/var/lib/docker`, `/var/log`, le volume de données ; ajouter à l'e2e une aiguille IP (texte et 4 octets) pour disque + stdout/stderr (je l'ai fait en test d'audit : 0 résultat). Le plan de déploiement doit citer cette liste avant la mise en ligne.

**P7 — Historique des envois activé par défaut (spec §33, Q-H2)**
- Problème : `S_gestion`, l'échéance, le nombre d'ouvertures et un libellé (« 6 éléments · 142 Mo · 5 nov., 21 h ») sont gardés dans IndexedDB, sur téléphone **et ordinateur**, sans action de la personne. Sur un poste partagé ou public, la personne suivante voit ces envois et peut les détruire. La spec admet que le « chiffrement » (clé non extractible dans la même base) ne protège que des lectures naïves : ne pas l'afficher comme une protection. C'est aussi un stockage dans le terminal non strictement nécessaire (art. 82 LIL) tant qu'il n'est pas demandé par la personne. La page Confidentialité annonce « aucun cookie, rien dans le navigateur ».
- Correction : défaut désactivé sur ordinateur (case « Garder ce lien de gestion sur cet appareil » décochée, cochée seulement sur le téléphone installé, où la personne l'a demandé en ajoutant l'application) ; purge automatique à l'échéance (même sans réseau) ; « Effacer l'historique » visible sur « Lien prêt » ; texte de la page Confidentialité qui liste ce stockage (nature, finalité, durée) ; test qui vérifie que, sans action, IndexedDB reste vide sur ordinateur.

**P8 — Envoi anticipé : le « bourrage » ne masque plus la taille et la composition devient visible (spec §29, texte `seal.padding`)**
- Évidence : spec §29.3 (le serveur remplit lui-même les segments entre le dernier segment de données et le segment de fin ; `finalize` donne `fill_from`/`fill_to`), §29.7 et §18.12 (taille connue à 4 Mio près, composition en cours visible). Le texte `seal.padding` dit pourtant « arrondie au palier supérieur pour masquer la taille réelle » (FR et EN).
- Problème : une fois §29 implémenté, ce texte est faux. De plus, le contenu chiffré part **avant** le clic « Envoyer », donc des brouillons abandonnés (texte sensible tapé puis effacé) quittent l'appareil sans que la personne le sache. Q-K1 propose une bascule « Envoyer seulement quand je clique » désactivée par défaut. Les questions Q-K1/Q-K2 ne tranchent pas le consentement à cet envoi anticipé.
- Correction : texte honnête (« L'envoi chiffré commence pendant que vous composez. La taille est connue du serveur à 4 Mio près. ») ; indicateur visible « envoi en cours » dès le premier segment ; bascule présentée à la première utilisation ; FAQ « Que voit le serveur ? » complétée (« qu'une composition est en cours »). Réexaminer le défaut : privilégier la vie privée (envoi au clic) et activer l'anticipation seulement après un choix explicite, ou limiter l'anticipation à la mise en réserve de la place sans contenu.

### Faible

**P9 — Date de création déductible, contrairement à la lettre de §9.1**
- Évidence : ligne SQLite d'un partage (6 h) : `expires_at = 1793904300`, `ttl_hours = 6` ; `expires_at − ttl_hours × 3600` donne `12:45:00` pour un partage créé à `12:30:47`. Le commentaire de `service.go` (`sweepCond`) admet la déduction. Le fichier a de toute façon une date de naissance exacte au système de fichiers.
- Problème : « Jamais stockés : … date de création » (§9.1) est inexact à 15 minutes près. Aucun gain de sécurité à corriger la base (le système de fichiers est plus précis), mais le texte doit être exact.
- Correction : écrire « à 15 minutes près » dans la spec §9.1 et la page Confidentialité, et ne pas promettre l'absence de date de création.

**P10 — Le « # » passe par l'historique et la synchronisation du navigateur avant le retrait**
- Évidence : le retrait fonctionne (observé), mais l'adresse complète est chargée une fois, donc visible de l'historique des visites, de la synchronisation (Chrome, Edge, Safari/iCloud), des extensions, et des applications intégrées où le retrait est volontairement désactivé (`App.svelte`, exception S4). Les messageries voient aussi le lien en clair (hors portée).
- Correction : le dire sur la page Sécurité (« la clé est dans le lien : ne le collez pas dans un service qui indexe ou synchronise vos messages ») ; garder le retrait en navigateur normal ; test e2e existant à compléter avec Safari (WebKit) puisque seul Chromium a été exécuté ici.

**P11 — Traitement des signalements : texte « aucune trace » et obligations DSA**
- État du code : `Reason` est accepté (≤ 64 caractères) puis ignoré ; aucun compteur n'existe. Spec §9.3 prévoit pourtant un « compteur agrégé des signalements » et §15.2 un e-mail horaire quand ils s'accumulent.
- Problèmes : (a) « ne garde aucune trace » sera inexact avec le compteur ; (b) le signalement détruit le partage pour tous, immédiatement, par n'importe quel destinataire (aucune notification possible à l'expéditeur : DSA art. 17 sur la motivation est impossible, à écrire) ; (c) le point de contact et le mécanisme de notification (DSA art. 12 et 16) ne sont pas décrits hors de la spec ; (d) les réquisitions d'autorités ne pourront pas être satisfaites (ni contenu, ni IP) : à déclarer dans la page Confidentialité et dans la procédure ; (e) conservation de la preuve d'un signalement d'infraction grave (signalement obligatoire de certains contenus aux autorités) : à trancher avec le juriste, car la destruction immédiate efface tout élément que le serveur ne peut de toute façon pas lire.
- Correction : texte « Shhdrop ne garde ni le contenu ni l'auteur du signalement ; un compteur sans identifiant est tenu pour détecter les abus » ; procédure écrite de traitement (délai, adresse de contact, journal minimal sans donnée personnelle).

**P12 — Démo GitHub Pages : l'hébergeur voit les visiteurs, les textes ne le disent pas**
- Évidence : démo servie sans en-têtes personnalisés (Pages ne les permet pas) : CSP par balise `meta` (sans `frame-ancestors`, non supportée en `meta`), `referrer` par `meta`, pas de `Cache-Control: no-store`. Observé : aucune requête hors origine, aucun stockage, fragment retiré. Le bandeau dit « rien n'est envoyé », et l'accueil de la démo répète « Aucune adresse IP sur disque », « aucun script venu d'ailleurs ».
- Problèmes : (a) GitHub (Microsoft, États-Unis) sert la page et voit l'adresse IP, l'agent utilisateur et l'heure de chaque visiteur, et en garde des journaux selon sa propre politique ; (b) l'origine `skoow.github.io` est partagée avec les autres sites Pages du propriétaire : tout stockage futur de la démo (IndexedDB, `localStorage`) serait lisible par eux (V7 de §27.7 le sait pour le coffre) ; (c) les promesses de l'accueil décrivent le serveur Shhdrop, pas GitHub.
- Correction : une ligne dans le bandeau de la démo (« Cette démo est hébergée par GitHub, qui voit votre adresse IP. ») ; test « la démo n'écrit rien dans aucun stockage » (déjà vérifié à la main : tout est vide) ; envisager un domaine dédié (`demo.…`) ou un dépôt d'organisation à part pour isoler l'origine ; ne pas mettre l'adresse du dépôt en clair dans la CSP.

**P13 — Surfaces de fingerprinting : uniquement des lectures locales, aucune n'est envoyée**
- Évidence (sondes injectées avant le script, accueil de production) : lecture de `navigator.languages` (choix de langue, non mémorisé), `navigator.userAgent` (détection des navigateurs intégrés, local), `matchMedia` (`prefers-reduced-motion`, `hover/pointer`, `pointer: coarse`, `display-mode: standalone`), `createElement('template')`. Aucun accès à `canvas`, `WebGL`, `AudioContext`, `getBattery`, `connection`, `hardwareConcurrency`, `plugins`, `sendBeacon`. `lowMemory` lit `deviceMemory` et `maxTouchPoints` seulement à l'ajout d'un gros fichier (code lu, non exécuté).
- Résidu : les en-têtes `Accept-Language`, `User-Agent` et `Sec-CH-UA-*` partent avec chaque requête (inévitable) ; le seau de limites regroupe par /64 ou IPv4 (pseudonymisé). Pas de constat bloquant.
- Correction : garder le test `source-rules.test.ts` et y ajouter une interdiction de `getContext`, `AudioContext`, `getBattery`, `sendBeacon`, `hardwareConcurrency`, `navigator.plugins` dans `web/src` (hors démo).

**P14 — Coffre (§27) : métadonnées visibles sans le code**
- Problèmes : la passkey « Coffre Shhdrop » (`rp.id` = hôte du site) apparaît dans le gestionnaire de mots de passe de l'appareil et, si elle est synchronisée, chez Apple ou Google : cela révèle l'usage de Shhdrop à qui voit la liste ; N entrées, tailles de palier et échéances sont lisibles sans déverrouillage (la spec l'admet §27.3) ; `navigator.storage.persist()` demandé à la première entrée.
- Correction : nom de passkey neutre (« Coffre », sans « Shhdrop ») ; dire sur la page Confidentialité ce que la liste des passkeys montre ; préférer le code du coffre quand la personne ne veut pas de synchronisation.

**P15 — Dérive entre la spécification v2.6 et le code (aspects vie privée)**
- Lien : `HEAD` génère et lit `/s/{id}#clé` (identifiant dans le chemin), alors que §32 retient `/#clé` (identifiant dérivé). Tant que le serveur ne journalise rien, l'effet est faible, mais l'identifiant en clair passe dans tout journal tiers (Caddy, hébergeur) et dans `robots.txt` (`Disallow: /s/`, `/m/` révèle la structure).
- Aucun fichier `releases/`, aucun `release.yml`, aucun job `repro` : la vérification du code (§28) n'existe pas encore, alors que `home.limits.site` dit « c'est pour cela que le code est public ».
- Correction : suivre la dérive dans le plan ; ne pas écrire sur le site que le code est « vérifiable » avant §28.

**P16 — Plan d'incident (§15.5) sans notification de violation de données**
- Problème : aucun pas de « notification à la CNIL sous 72 h » ni d'information des personnes en cas de violation (RGPD art. 33 et 34), même si les données sont réduites (IP pseudonymisées en mémoire, métadonnées de partages).
- Correction : ajouter l'étape « évaluer et notifier la CNIL (téléservice de notification) sous 72 h si un risque pour les personnes existe », et un registre interne des violations (art. 33.5).

### Aucun constat (insecure-defaults)

Couverture : `server/cmd/shhdrop/{main,static,admin}.go`, `server/internal/{api,config,limits,captcha,store,blob,janitor,token}`, `.github/workflows`. Balayage A à F :

- A (secrets de repli) : aucun. Les clés des jetons, de l'anti-robot et du seau de limites sont tirées de `crypto/rand` à chaque démarrage et gardées en mémoire.
- B (identifiants par défaut) : aucun compte, aucun mot de passe d'administration (l'administration est une commande locale).
- C (interrupteurs ouverts) : `SHH_BEHIND_PROXY` vaut 0 par défaut mais n'ouvre rien (l'écoute hors boucle locale exige `SHH_BEHIND_PROXY=1` et un proxy déclaré, `config.go`) ; une requête de proxy sans `X-Shh-Client-IP` valide partage les limites du proxy (échec du côté sûr) ou reçoit 500 derrière le proxy.
- D (cryptographie faible) : `crypto/rand`, HMAC-SHA-256, SHA-256, comparaisons à temps constant ; aucun `math/rand`.
- E (accès) : dossiers 0700, base 0600, fichiers 0600 ; aucun CORS ; fichiers cachés refusés par le serveur statique.
- F (débogage) : aucun `pprof`, `expvar` ni trace ; `ErrorLog` de `net/http` jeté ; `recoverPanic` sans journal ; réponses d'erreur uniformes (`not_found`, `bad_request`).

Réfutés : `SHH_BEHIND_PROXY=0` (voir C) ; en-tête HSTS `preload` envoyé sans condition (sans effet en HTTP ; l'inscription à la liste de préchargement est irréversible et à décider au déploiement, pas un défaut de code). Ce n'est pas une preuve d'absence de défaut : la pile d'exploitation n'est pas auditable (P6).

## 4. Surfaces mesurées

### 4.1 Navigateur

| Surface | Résultat (production et démo) | Preuve |
|---|---|---|
| `localStorage` / `sessionStorage` | vides | `page.evaluate` après `networkidle` |
| IndexedDB, OPFS, Cache API, service worker | vides, 0 enregistrement | idem |
| Cookies | aucun, `document.cookie` vide, `ctx.cookies()` = `[]` | idem |
| Historique | l'entrée `/s/…#clé` est remplacée par `/s/…` (`replaceState`), longueur d'historique inchangée | `LINK_URL_AFTER` |
| Référent | `Referrer-Policy: no-referrer` (en-tête en production, `meta` en démo) ; clic vers GitHub : aucun `Referer` | `GITHUB_REQ_HEADERS` |
| Titre | constant | `document.title` |
| Console | une erreur : 404 de `/favicon.ico` (aucune icône déclarée dans `index.html`) ; aucun secret, aucune URL de partage | `CONSOLE` |
| Tiers | aucun (requêtes : même origine uniquement) | `REQUESTS` : 9 en production, 12 en démo |
| Cache HTTP | `Cache-Control: no-store` sur toutes les réponses du serveur ; la démo (Pages) ne peut pas l'imposer | en-têtes |
| Ressources chargées | police Mona Sans et JetBrains Mono locales, 3 images d'aurore, grain | `REQUESTS` |
| CSP production | `default-src 'self'` ; `script-src 'self' 'wasm-unsafe-eval'` ; `connect-src 'self'` ; `frame-ancestors 'none'` | en-têtes |
| Permissions-Policy | `microphone=(self), camera=(), geolocation=()` | en-têtes |
| Mot de passe et gestionnaires | non évaluable : aucun champ n'existe encore (spec §21 exige `autocomplete` adapté) | — |

### 4.2 Serveur

| Surface | Résultat | Preuve |
|---|---|---|
| IP sur disque | aucune (forme texte, 4 octets, `127.0.0.1`) dans base, WAL, SHM, fichiers, avant et après arrêt | `IP_DISK_HITS []`, `IP_DISK_AFTER_STOP []` |
| IP en mémoire | présente dans le tas (valeur d'en-tête) ; compteurs indexés par HMAC à secret quotidien | `IP_MEM ["ip-texte"]`, `limits.go` |
| Journaux de l'application | aucun : `ErrorLog` jeté, `recoverPanic` muet, janitor : une ligne fixe sans donnée | sortie du serveur : `SHH_LISTENING 127.0.0.1:NNNN` seulement |
| Journaux Caddy | non vérifiables (fichier absent) | P6 |
| Colonnes de `shares` | `id`, état, palier, `ttl_hours`, `max_opens`, `opens_left`, `opens_issued`, `done_mask`, `failed_attempts`, masque de segments, sel, paramètres KDF, trois SHA-256, `upload_deadline`, `expires_at`, `purge_at`, `progress_at`. Pas d'IP, de nom, de navigateur, de pays | `store.go`, ligne réelle |
| Dates stockées | arrondies au quart d'heure supérieur ; `progress_at` à la minute, seulement pendant l'envoi (NULL ensuite, vérifié) | ligne réelle |
| Dates du système de fichiers | `mtime` à l'epoch ; `atime` mis à jour à la lecture (P5) ; `birth` et `ctime` exacts (spec §18.6) | `FILE …` |
| Rétention | ligne et fichier supprimés à l'expiration ou à la destruction ; `secure_delete=ON` ; le fichier est délié, non écrasé (contenu chiffré seulement) | `blob.go`, `store.go` |
| Métadonnées temporelles | le WAL et la base ont des `mtime` à la seconde ; la base est rafraîchie chaque minute (`wal_checkpoint`), ce qui noie l'activité réelle | `janitor.go` |

### 4.3 Tiers

| Contexte | Résultat |
|---|---|
| Production (`dist/`) | 0 domaine externe en requête ; 1 lien sortant `https://github.com/Skoow/shhdrop` avec `rel="noopener noreferrer"` ; polices servies localement |
| Démo (`dist-demo/`) | idem, plus `connect-src 'none'` (le faux serveur répond dans la page) ; aucun appel même au chargement |
| reCAPTCHA | non implémenté (aucune requête vers Google possible aujourd'hui) |
| Hébergement de la démo | GitHub Pages (tiers pour la page elle-même : P12) |
| Chaînes de construction | actions GitHub épinglées par empreinte ; `npm ci --ignore-scripts` ; pas de dépendance d'exécution autre que Svelte, libsodium, Lucide |

## 5. Tableau des affirmations publiques

Légende : VRAI = exact tel qu'écrit, avec preuve ; À NUANCER = exact mais incomplet ou conditionné ; FAUX = inexact aujourd'hui ou contredit par le code ou la spec. Les clés `fr.ts`/`en.ts` sont identiques en substance (comparées une à une pour les clés ci-dessous).

| # | Affirmation (clé) | Verdict | Évidence |
|---|---|---|---|
| 1 | « Chiffrés sur votre appareil avant l'envoi : le serveur ne reçoit que des données chiffrées, jamais la clé » (`hero.lede`) | À NUANCER | Contenu, nom, mot de passe, `K_lien` : jamais reçus (test `sees-nothing` 5/5). Le serveur reçoit aussi des valeurs dérivées (`K_accès`, `K_preuve` au déverrouillage, `S_gestion` à la destruction, tailles, sel). Elles ne permettent pas de déchiffrer. Aujourd'hui l'interface ne peut pas encore envoyer (composeur « bientôt ») |
| 2 | « Le serveur ne reçoit jamais la clé » (`home.fact.e2e.p`, `home.why.key.t`) | VRAI | `sees-nothing` : aucune aiguille `kLien` dans les requêtes, le disque, la mémoire, stdout/stderr ; le « # » n'est jamais dans une requête (observé) |
| 3 | « La partie après le « # » reste dans votre navigateur : elle n'est jamais envoyée au serveur » (`home.why.example.note`) | À NUANCER | Vrai pour HTTP (aucune requête ne le porte, observé). Il reste dans l'historique avant retrait, la synchronisation du navigateur, les navigateurs intégrés (P10) |
| 4 | « Ni pour envoyer, ni pour recevoir. Rien de personnel n'est demandé » (`home.fact.account.p`, `home.why.account.p`) | VRAI | Aucun champ, aucun cookie, aucun stockage (observé). À reformuler quand l'historique §33 stockera `S_gestion` localement (P7) |
| 5 | « Au bout de 24 h au plus, ou après 1 à 10 ouvertures » (`home.fact.erase.p`, `home.why.ttl.p`) | VRAI | `Validate` : `max_opens` 1 à 10, durée en liste fermée ; balayage chaque minute |
| 6 | « À l'échéance, tout s'efface » (`home.how.go.p`) | À NUANCER | Ligne et fichier supprimés (test après destruction : aucune trace). Le fichier est délié sans écrasement (chiffré), la date de naissance et le journal de l'hébergeur ne le sont pas ; ce que le destinataire a gardé reste chez lui (le texte de la FAQ le dit) |
| 7 | « Au cinquième essai faux, le partage est effacé pour de bon » (`home.why.tries.p`) | À NUANCER | Logique vraie (test e2e « mauvais mot de passe ×5 »). « Pour de bon » : suppression logique et `secure_delete` de la base ; le chiffré n'est pas écrasé sur le disque |
| 8 | « Aucune adresse IP sur disque » ; « ne l'écrit jamais sur disque » (`home.why.ip.t/.p`) | À NUANCER | Application : VRAI (fouille du disque : 0). Pile non vérifiable : Caddy, Docker, swap, core dumps, SSH (P6). Conflit légal non tranché (P1) |
| 9 | « Elle sert seulement, en mémoire, à limiter les abus » (`home.limits.ip`) | À NUANCER | Vrai dans le code : clés HMAC à secret quotidien, liaison HMAC dans l'anti-robot (sur 1 h), tout en mémoire. Données pseudonymisées au sens du RGPD (spec §9.3), non anonymes ; swap possible (P6) |
| 10 | « Le serveur voit votre adresse le temps de la connexion, comme tout site » (`home.why.ip.p`) | VRAI | Code : l'IP est lue par requête puis seulement hachée |
| 11 | « Ni statistiques ni traceur, aucun script ni police venus d'ailleurs » (`home.why.track.p`) | VRAI | 9 requêtes en production, 12 en démo, toutes même origine ; 0 cookie ; `svelte.dev` n'est que du texte. La démo est hébergée par GitHub (P12) |
| 12 | « Seule exception… un contrôle de Google, que vous choisissez de lancer, dans un cadre isolé » (`home.why.track.p`) | À NUANCER | Décrit une fonction qui n'existe pas encore (ni serveur, ni cadre, ni `SHH_VERIF_ORIGIN`). Texte juridique insuffisant (P3). L'isolation est une exigence de conception non testée |
| 13 | « Google voit alors votre adresse IP, jamais votre contenu » (`home.why.track.p`) ; `verif.body` | À NUANCER | Probable par conception (cadre sandbox sur un autre site), non testé ; Google voit aussi cookies et comportement du navigateur ; texte à compléter (P3) |
| 14 | « Aucun pistage, aucune publicité » (`home.why.track.t`) | VRAI | Aucun tiers, aucun identifiant ; sous réserve de P3 |
| 15 | « Des données chiffrées, leur taille approximative, l'heure des échanges et… votre adresse IP. Jamais le contenu, les noms des fichiers, le mot de passe ni la clé » (`home.faq.server.a`) | À NUANCER | Exact et honnête. À compléter : l'heure de première lecture reste lisible sur le disque (P5), la création à 15 min près (P9), et, avec §29, « qu'une composition est en cours » (P8) |
| 16 | « Personne ne peut le retrouver, pas même nous : la clé n'existe que dans le lien » (`home.faq.lost.a`) | VRAI | `K_lien` absente du serveur ; l'identifiant est lié à la clé |
| 17 | « Un partage détruit ou expiré est effacé du serveur et ne peut plus être ouvert » (`home.faq.back.a`) | VRAI | Test : après `destroy`, `scanDir` ne retrouve ni segment ni identifiant ; 404 uniforme |
| 18 | « Mes fichiers sont-ils analysés ? Non. Le serveur ne reçoit que des données chiffrées » (`home.faq.scan.a`, 1re partie) | VRAI | Le serveur n'a aucune clé |
| 19 | « Sur votre appareil, la plupart des photos sont nettoyées avant le chiffrement (lieu, appareil, date de prise de vue) ; … l'écran vous le dit » (`home.faq.scan.a`, 2e partie ; `compose.cleaned`) | FAUX | Aucun code de nettoyage dans `web/src` (P4) |
| 20 | « Le destinataire peut-il garder une copie ? Oui… Shhdrop efface le partage, pas ce qu'il a enregistré » (`home.faq.copy.a`, `home.limits.capture`) | VRAI | Cohérent avec spec §18.1 |
| 21 | « Tout se passe dans le navigateur, sans compte » (`home.faq.app.a`) | VRAI | Observé ; aucun compte n'existe côté serveur |
| 22 | « Le code est public sur GitHub : chacun peut le relire » (`home.why.code.p`) | À NUANCER | Non vérifié (visibilité du dépôt, API bloquée ici). CLAUDE.md et la spec présupposent un dépôt public. Aucune version signée ni build reproductible (§28) n'existe encore |
| 23 | « Vous protéger si le site lui-même était piégé : c'est pour cela que le code est public » (`home.limits.site`) | À NUANCER | Phrase mise dans « ce que Shhdrop ne peut pas faire », donc honnête sur la limite. Ne pas laisser croire qu'un code public protège d'un serveur piégé servant un code différent à une victime (spec §18.13) |
| 24 | « Le lien est tiré au hasard sur votre appareil et n'est jamais réutilisé » (`home.why.link.p`) | VRAI | `newKLien` = `crypto.getRandomValues(32)` ; identifiant refusé s'il existe (clé primaire) |
| 25 | « Seule la personne qui a le lien et le mot de passe peut l'ouvrir » (`home.why.e2e.p`) | À NUANCER | Vrai pour l'accès au contenu ; toute personne qui obtient les deux l'ouvre ; un site piégé le contourne (§18.2) |
| 26 | « Le serveur… ne garde aucune trace de votre signalement » (`report.body`) | À NUANCER | Vrai au `HEAD` (motif jeté, pas de compteur). Faux avec le compteur de §9.3 (P11). Écran pas encore implémenté |
| 27 | « La taille envoyée est arrondie au palier supérieur pour masquer la taille réelle » (`seal.padding`) | À NUANCER | Vrai avec les paliers de la v1 ; faux avec §29 (bourrage rempli par le serveur, taille connue à 4 Mio près) (P8) |
| 28 | « Disponible encore… disparaît quand vous quittez la page » (`content.banner`) | À NUANCER | Contredit en partie spec §18.7 : le `Blob` peut être placé par le navigateur dans son stockage temporaire sur disque. Écran non implémenté |
| 29 | « Tous les détails de sécurité » (`home.why.more`, lien et pied de page) | FAUX | `/securite` n'affiche rien (P2) |
| 30 | Pied de page « Confidentialité » (`shell.privacy`) ; spec UI §9.12 « Shhdrop ne dépose aucun cookie et ne mesure pas l'audience » | FAUX (page absente) | `/confidentialite` vide (P2). La phrase prévue sera à nuancer avec P3 (cookies Google) et P7 (IndexedDB) |
| 31 | « Démo : rien n'est envoyé, le lien ne marche que dans cet onglet » (bandeau de démo) | À NUANCER | Aucune donnée de l'utilisateur n'est envoyée (`connect-src 'none'`, observé). La visite elle-même est vue par GitHub (P12) |
| 32 | « 10 éléments · 1 Go · 24 h au plus · 5 essais, puis destruction » (`home.proof`) | VRAI | `Validate`, `maxAttempts`, test e2e |

Totaux : VRAI 13, À NUANCER 16, FAUX 3 (32 lignes).

**Affirmations fausses aujourd'hui** : #19 (photos nettoyées), #29 (détails de sécurité), #30 (page Confidentialité). Attention aussi aux phrases « vraies par conception mais non tenues par le code actuel » (#12, #13, #26, #27, #28), à relire à chaque écran livré.

## 6. Lacunes juridiques et RGPD pour l'exploitant

| Sujet | État | À faire avant l'ouverture |
|---|---|---|
| Qualification et conservation (LCEN art. 6, décret 2021-1362) | Non tranché (P1) | Avis écrit d'un juriste ; décision consignée ; textes publics alignés |
| Mentions légales (LCEN art. 6-III) | Absentes | Identité de l'éditeur ou, pour un particulier non professionnel, identité communiquée à l'hébergeur avec mention de son nom et de ses coordonnées ; contact ; directeur de publication |
| Politique de confidentialité (RGPD art. 12 à 14) | Absente (page vide) | Responsable, finalités (sécurité et anti-abus), base légale (intérêt légitime art. 6.1.f, avec un court test de mise en balance), données (IP pseudonymisée en mémoire, métadonnées de partage), destinataires (hébergeur, GitHub pour la démo, Google si repli), durées (secret quotidien, partages ≤ 24 h), transferts (Google, GitHub), droits et leur limite (art. 11 : pas d'identification), contact, droit de réclamation auprès de la CNIL |
| Registre des traitements (art. 30) | Non mentionné | Le traitement d'IP pseudonymisées par un service public n'est pas occasionnel : tenir un registre simple |
| Sous-traitants (art. 28) | Non mentionné | Hébergeur, registraire, GitHub (démo, CI), service d'alerte : contrat ou conditions d'usage acceptées, liste dans la politique |
| Cookies et traceurs (art. 82 LIL / ePrivacy) | Aucun cookie ni stockage aujourd'hui (observé) : pas de bandeau nécessaire | Rester vrai : l'historique §33 (P7), le coffre §27 et reCAPTCHA (P3) sortent de cette situation et demandent consentement ou stricte nécessité documentée |
| Consentement reCAPTCHA | Voir P3 | Texte, refus sans pénalité disproportionnée, retrait, information complète |
| Signalements et notification (DSA art. 12, 14, 16, 17, 18 ; LCEN) | Spec §17 : « à valider » | Point de contact électronique, formulaire ou adresse, procédure, délais, motivation impossible à l'expéditeur (à écrire), position sur les signalements aux autorités, réponse aux réquisitions (P11) |
| CGU | Absentes | Contenus illicites interdits, destruction sur signalement, aucune garantie de conservation, pas de vérification de l'expéditeur, limites de responsabilité |
| Déclaration ANSSI (LCEN art. 30, décret 2007-663) | « À faire » | Déposer avant l'ouverture, garder le récépissé |
| Violation de données (art. 33 et 34) | Absent du plan d'incident (P16) | Procédure et registre |
| Hébergement hors UE | « Suisse ou Islande » (§15.1) | La Suisse bénéficie d'une décision d'adéquation ; l'Islande est dans l'EEE ; le RGPD s'applique de toute façon à l'exploitant en France. Indiquer le pays dans la politique |
| Mineurs, contenus illicites, chiffrement | Hors portée technique | Mentionner dans les CGU ; ne pas promettre de modération du contenu que le serveur ne peut pas lire |
| Droit d'accès / effacement | Impossible par conception (aucun identifiant de personne) | L'écrire, avec ce que la personne peut faire seule : détruire son partage avec le lien de gestion |

## 7. Tests de non-régression à ajouter

1. e2e serveur : aiguille IP (texte et 4 octets) dans disque, stdout, stderr, sans mémoire ; `X-Shh-Client-IP` écrasé par le proxy (test sur le Caddyfile).
2. e2e serveur : après création et ouverture, `atime == mtime == 0` du fichier ; le démarrage refuse un volume sans `noatime` (P5).
3. Playwright : sur chaque route, 0 requête hors origine, 0 cookie, 0 entrée de stockage ; `/securite`, `/confidentialite`, `/mentions-legales`, `/cgu` non vides (P2) ; aucune requête vers `google.com`/`gstatic.com` avant le clic sur « Continuer avec Google » (P3).
4. Vitest : `source-rules.test.ts` interdit `getContext`, `AudioContext`, `getBattery`, `sendBeacon`, `hardwareConcurrency`, `plugins`, `eval`, `new Function` dans `web/src` (hors démo) (P13).
5. Texte : un test qui compare chaque clé « promesse » de `fr.ts`/`en.ts` à une liste des fonctions livrées (échec si `home.faq.scan.a` cite un nettoyage non codé) (P4).
6. Photo piégée : EXIF avec GPS, `Make`, `DateTimeOriginal` : absents dans le paquet chiffré puis déchiffré (P4).
7. Historique §33 : sans action de la personne, IndexedDB est vide sur ordinateur (P7).

## 8. Questions pour le propriétaire

- P1 : accepter de retarder l'ouverture publique tant que l'avis écrit sur la conservation n'est pas obtenu ?
- P3 : conserver le repli Google (et assumer consentement, transfert, texte) ou le supprimer au profit d'une preuve de travail sans Worker (recommandé : plus simple, aucun tiers) ?
- P7 : historique désactivé par défaut sur ordinateur, activé sur le téléphone installé ?
- P8 : envoi anticipé activé par défaut, ou envoi au clic avec choix explicite ?
- P12 : domaine ou compte GitHub dédié pour isoler l'origine de la démo ?
