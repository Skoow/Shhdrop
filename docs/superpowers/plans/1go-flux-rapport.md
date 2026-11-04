# Rapport : 1 Gio par lien, chiffrement et déchiffrement en flux (spec §24)

Branche `plan-1b-maj`. Format du paquet inchangé octet pour octet (en-tête 48 octets, nonce
11 + 1, AAD = en-tête, morceaux de 65 536, segments de 64 morceaux) ; seule la liste des
paliers grandit.

## Changements

### Navigateur — `web/src/crypto/container.ts`

- `BUCKETS = [1, 16, 80, 160, 400, 800, 1600, 4000, 8000, 16384]` ; `bucketFor` lève
  `trop_gros` au-delà de 16 384 morceaux (1 Gio utile, manifeste compris).
- `Item.data : Uint8Array | Blob` (un `File` est un `Blob`). Les fichiers sont lus par
  `blob.slice(a, b).arrayBuffer()`, morceau par morceau. Un `Uint8Array` est copié dans un
  `Blob` (immuable) à l'appel : l'appelant ne peut plus modifier le clair entre deux
  `segment(n)` (sinon même nonce pour deux clairs différents).
- `PREVIEW_MAX = 200 Mio`.
- `sealStream(items, keys) → { bucket, segmentCount, segment(n) }` : manifeste et palier
  calculés d'après les tailles ; `segment(n)` chiffre seulement les morceaux du segment n.
  Un nouvel appel pour le même n rend les mêmes octets. `n` hors palier → `segment_invalide`.
  La garde WeakSet joue une fois par appel de `sealStream` (`cle_deja_utilisee`) ; un refus
  de validation ne consomme pas la clé.
- `openStream(fetchSegment, bucket, keys) → { manifest, item(i), streamItem(i, sink), wipe() }` :
  - palier hors liste, taille de segment fausse (`segmentSize(bucket, n)`), en-tête ou
    engagement faux, échec d'authentification → `paquet_corrompu` ; l'en-tête est vérifié
    sur le segment 0 avant tout déchiffrement ; le manifeste peut tenir sur les morceaux 0–1 ;
  - **nouveau contrôle** : le palier annoncé par le serveur doit être celui que `seal`
    aurait choisi pour le contenu décrit par le manifeste authentifié
    (`bucketFor(4 + mlen + fin du dernier fichier) === bucket`), sinon `paquet_corrompu` ;
  - `item(i)` : refuse un fichier > 200 Mio (`trop_gros_pour_apercu`) avant tout
    téléchargement ; sinon ne télécharge que les segments couverts, rend une copie ;
  - `streamItem(i, sink)` : déchiffre morceau par morceau, appelle `sink` dans l'ordre
    avec une copie de la tranche (le `sink` la garde s'il veut) ; le morceau déchiffré est
    mis à zéro après copie ;
  - cache d'un seul segment chiffré ; `wipe()` le met à zéro ; tout échec pendant
    l'ouverture le met à zéro aussi ;
  - drapeau « dernier morceau » vérifié dès que le dernier morceau est déchiffré (nonce).
- `seal()` et `open()` **supprimés** : plus rien ne s'en sert hors des tests. Les tests
  ont leurs propres aides (`seal` = boucle sur `segment(n)`, `open` = `openStream` + lecture
  de tous les éléments).

### Navigateur — `web/src/transfer/client.ts`

- `createShare` : `sealStream`, puis pour chaque n : `segment(n)` → `putSegment` (qui
  rejoue les mêmes octets en cas de nouvel essai) → abandon. Un seul segment chiffré en
  mémoire. `onProgress(segmentsEnvoyés, total)`.
- `openShare` rend `{ manifest, item(i), saveItem(i, sink), done(), wipe() }` sur
  `openStream`. Seul le segment 0 est lu à l'ouverture ; les autres à la demande, avec les
  nouveaux essais de `getSegment`. `onProgress(n + 1, total)` à chaque segment n lu (un
  segment relu est réannoncé ; le bourrage n'est jamais lu, la barre peut donc ne pas
  atteindre `total`).
- Erreurs de `item`/`saveItem` : paquet corrompu et erreurs serveur → `readerError`
  (`NotFoundError`, `LimitError`, `Error("reseau")`) ; erreur du `sink`,
  `element_inexistant`, `trop_gros_pour_apercu` → telles quelles.
- `collectToBlob(open, i, mime)` : tranches dans un tableau, `new Blob(parts, {type})`,
  puis tranches mises à zéro.

### Serveur Go

- `share.Buckets` étendu à l'identique. `segments_mask` : `(256 + 7) / 8 = 32` octets,
  `fullMask(256)` vérifié ; test de bout en bout du palier 16 384 (256 segments, 1 Gio écrit).
- `limits.BytesPer64 = 3 << 30` (créations par jour inchangées).
- `config` : `SHH_STORAGE_MAX` par défaut `107374182400` (100 Gio).
- Délais : `uploadWindow` et `uploadTTL` = 3 h (échéance toujours arrondie au quart d'heure
  supérieur) ; `downloadTTL` = 3 h, plafonné à `expires_at` (code existant) ;
  `purgeWindow` = 3 h → `purge_at = min(ceil15(now + 3 h), expires_at)`.
- Balayage des envois vides : toujours 5 min après la création arrondie. Le seuil n'est
  plus écrit en dur (`3300`) mais dérivé : `emptySweep = uploadWindow − 300` (10 500 s).
- Délais HTTP inchangés (par segment de 4 Mio).

## API (TypeScript)

```ts
export type Item = { kind: "text" | "file"; name: string; mime: string; data: Uint8Array<ArrayBuffer> | Blob };
export const PREVIEW_MAX: number; // 200 Mio
export async function sealStream(items: Item[], keys: ContentKeys):
  Promise<{ bucket: number; segmentCount: number; segment(n: number): Promise<Uint8Array<ArrayBuffer>> }>;
export async function openStream(fetchSegment: (n: number) => Promise<Uint8Array>, bucket: number, keys: ContentKeys):
  Promise<ContainerReader>; // { manifest, item(i), streamItem(i, sink), wipe() }

export type Opened = { manifest; item(i); saveItem(i, sink); done(); wipe() };
export async function collectToBlob(open: Opened, i: number, mime: string): Promise<Blob>;
```

## Preuves TDD

Les tests ont été écrits avant le code ; voici ce qu'ils donnaient avant l'implémentation.

ROUGE, Go (`go test ./...`) :

```
--- FAIL: TestTokenLifetimes      (jeton d'envoi 11:02:03 au lieu de 13:02:03)
--- FAIL: TestCreateQuota         (palier 16384 refusé : bad_request)
--- FAIL: TestFromEnvDefauts      (StorageMaxBytes:21474836480)
--- FAIL: TestBytesPerDay         (BytesPer64 314572800)
--- FAIL: TestSizing              (Buckets [1 16 80 160 400 800 1600])
--- FAIL: TestPurgeAt / TestLargestBucket / TestUploadDeadlineRounded
--- FAIL: TestSweepEmptyUpload / TestSweep / TestSweepRechecksFinalized
```

ROUGE, TypeScript : `container.test.ts` 30 échecs sur 49 (`sealStream`/`openStream`
absents, `bucketFor` à 7 paliers) ; `client.test.ts` 7 échecs sur 29 (`seal is not a
function`, `collectToBlob` absent, erreurs d'élément converties en `NotFoundError`).

Après l'implémentation, d'autres tests Go qui dépendaient de l'ancien délai d'une heure
ont été recalés sur 3 h : `TestPutSegmentRules` (et il vérifie maintenant aussi « encore
accepté à 13:14 »), `TestDestroyExpired`, `TestSweepUnfinishedUpload` (janitor),
`TestRefusalDoesNotCount`, `TestResetAtUTCMidnight`.

VERT : voir la section suivante.

## Tests ajoutés

- **TS, conteneur** : limites de `bucketFor` (1 Gio accepté, 1 Gio + 1 refusé, chaque
  palier) ; tailles de segment des grands paliers ; aller-retour avec des entrées `Blob`
  (texte, 3 Mio + 123, 2,5 Mio) → palier 160, 3 segments ; nombre exact d'appels à
  `fetchSegment` (`[0]`, puis `[0, 1]`, puis `[0, 1, 0]` ; segment 2 jamais lu ; rechargé
  après `wipe`) ; `streamItem` égal à la source, tranches ≤ 64 Kio ; octet modifié, tag
  modifié dans le segment 1, morceaux échangés, segments échangés ou retirés, segment
  de ±1 octet ou d'un morceau en moins → `paquet_corrompu` (par `item` et `streamItem`) ;
  palier annoncé faux (80, 400, 2) ; palier non canonique ; drapeau « dernier morceau »
  absent (lu par `item` et `streamItem`) ; manifeste à cheval sur les morceaux 0 et 1
  (65 535 octets) ; élément de 200 Mio + 1 → `trop_gros_pour_apercu` sans téléchargement
  supplémentaire (seul le segment 0 d'un palier 4000 est fabriqué : 4 Mio) ;
  `segment(n)` deux fois → mêmes octets ; `Uint8Array` modifié après `sealStream` sans
  effet ; texte fourni en `Blob` ; second `sealStream` avec la même clé →
  `cle_deja_utilisee` ; 1 Gio refusé sans lire le `Blob` (faux `Blob` de 1 Gio).
- **TS, client** (serveur simulé, vrai paquet) : `openShare` ne lit que le segment 0 ;
  `saveItem` et `collectToBlob` exacts ; progression ; corruption pendant `saveItem` →
  `NotFoundError` ; erreur du `sink` transmise telle quelle ; coupure persistante →
  `Error("reseau")` ; `createShare` envoie les segments 0, 1, 2 dans l'ordre et à la
  bonne taille.
- **Go** : paliers et calculs de segments pour 16 384 (256 segments, `fullMask(256)`) ;
  palier 16 384 complet (256 PUT, segment 256 refusé, finalisation incomplète puis
  réussie, fichier de 48 + 16 384 × 65 552 octets) ; quota 3 Gio (trois liens de 1 Gio
  passent, le quatrième est refusé, en limiteur et en API) ; stockage par défaut 100 Gio ;
  `upload_deadline` et jeton d'envoi à 3 h ; jeton de téléchargement à 3 h et plafonné à
  `expires_at` ; `purge_at` à 3 h et plafonné ; balayage des envois vides à 10:20 puis
  échéance à 13:15.
- **e2e** (`web/e2e/flows.test.ts`) : fichier de 250 Mio − 64 Kio écrit sur disque et
  ouvert en `Blob` adossé au fichier (`fs.openAsBlob`, comme un `File`), envoyé, aperçu
  refusé (> 200 Mio), enregistré par `saveItem` dans un `sink` qui calcule le SHA-256 ;
  empreinte identique à la source ; croissance de la RSS de Node mesurée toutes les 20 ms,
  < 250 Mo. Les autres parcours ont été adaptés (`await o.item(…)`, progression paresseuse).
- **« Le serveur ne voit rien »** : inchangé, sauf `await o.item(1)`.

## Résultats

`make test` (go vet + go test, vitest src, build + vitest e2e), puis `npx tsc --noEmit` :

```
ok  github.com/skoow/shhdrop/server/...           (10 paquets, tous ok ; go vet sans remarque)
web  src : Test Files 7 passed (7) — Tests 115 passed (115) — 12,8 s
web  e2e : Test Files 4 passed (4) — Tests 23 passed (23)   — 142,8 s
tsc --noEmit : aucune erreur
```

Gros fichier seul (`vitest run e2e/flows.test.ts -t "gros fichier" --silent=false`) :

```
RSS : base 109 Mio, pic 198 Mio, croissance 89 Mio
✓ gros fichier en flux (250 Mio) > SHA-256 identique, croissance de la RSS < 250 Mo  107 s
```

Le fichier fait 250 Mio et la RSS ne grandit que de 89 Mio : il n'est jamais chargé en
entier. Sur les 107 s, l'essentiel est l'attente imposée par la limite de débit
(signalement 1).

## Signalements

1. **Majeur — limite de débit et gros fichiers.** Spec §4 : 60 requêtes par minute et par
   connexion sur toutes les routes `/api/*`, segments compris. Un lien de 1 Gio, c'est
   256 PUT + 256 GET : au moins 4 min 16 à l'envoi et autant à la réception, quel que soit
   le débit, soit environ 32 Mbit/s au plus. Plusieurs personnes derrière une même IPv4
   (NAT d'opérateur, entreprise) se partagent ces 60 requêtes. Le client attend la fenêtre
   suivante (429 → `retry_after_s`), donc ça marche, mais lentement. C'est aussi pourquoi
   le test e2e dure environ 2 min. Correction proposée : ne pas compter les `PUT`/`GET`
   de segments porteurs d'un jeton valide (déjà bornés par le palier et le jeton), ou leur
   donner une limite à part (par exemple 600/min). À décider par le propriétaire ; rien
   n'a été changé.
2. **Moyen — garantie « tout morceau modifié est détecté » (§7.3) affaiblie, sans perte
   réelle.** En flux, les morceaux jamais lus ne sont pas vérifiés : c'est le bourrage, plus
   tout élément non téléchargé. Le contenu livré reste entièrement authentifié. Une
   troncature ou un changement de palier par le serveur est détecté par le nouveau
   contrôle du palier canonique et par la taille de chaque segment. À écrire au §7.3.
3. **Moyen — clair partiel avant détection.** `saveItem` écrit sur le disque au fil de
   l'eau : une corruption au segment k laisse un fichier partiel déjà écrit. L'écran
   (Plan 2) doit supprimer ou abandonner le fichier si `saveItem` échoue
   (`writable.abort()`), et ne pas l'annoncer comme terminé. Le commentaire du code le dit.
4. **Moyen — `File` modifié pendant l'envoi.** Si le fichier change sur le disque pendant
   l'envoi, `segment(n)` le relit tel qu'il est. Les navigateurs refusent en général cette
   lecture (`NotReadableError`), et le client ne régénère jamais un segment (les nouveaux
   essais renvoient les mêmes octets), donc un même nonce ne sert jamais pour deux clairs
   envoyés. Seul risque restant : un appelant qui rappellerait `segment(n)` après une
   modification du fichier. À garder ainsi.
5. **Moyen — `collectToBlob`.** Toutes les tranches restent en mémoire JS jusqu'au
   `new Blob`, puis le `Blob` en fait une copie : jusqu'à environ 2 × la taille de
   l'élément (jusqu'à 2 Gio) avec Firefox ou Safari. C'est la limite prévue au §24, mais
   elle est plus lourde que « stockage temporaire ». Il faudra peut-être un avertissement
   au-delà de quelques centaines de Mio quand `showSaveFilePicker` manque. À ajouter au §18.
6. **Faible — taille du test e2e.** 300 Mio tombent dans le palier 8000 (125 segments,
   500 Mio envoyés) : environ 4 min à cause du point 1. Le test utilise 250 Mio − 64 Kio
   (plus grand contenu du palier 4000, 63 segments, au-dessus du seuil d'aperçu de
   200 Mio).
7. **Faible — spécification à mettre à jour.** §7.3 (paliers jusqu'à 1 600), §7.4
   (« valable 1 h », « − 55 min »), §7.5 (« 1 h ») contredisent le §24. Le seuil des
   envois vides devient `upload_deadline − 2 h 55`, une conséquence que le §24 ne précise
   pas. Il faut aussi y décrire le contrôle du palier canonique et le point 2.
8. **Faible — `done()`.** Il n'est plus appelé de lui-même après la lecture : c'est
   l'écran qui doit l'appeler après le dernier enregistrement. Sinon le partage vit jusqu'à
   `purge_at` (≤ 3 h) ou `expires_at`. Il reste appelé d'office si l'ouverture échoue.
9. **Info — progression du téléchargement.** Elle compte les segments lus. Elle peut ne
   pas atteindre `total` (bourrage jamais lu) et revenir en arrière si un segment est
   relu. L'écran devrait plutôt afficher les octets livrés au `sink`, rapportés à
   `manifest.items[i].size`.
10. **Info — disque.** 100 Gio de stockage par défaut, avec `fallocate` : le serveur doit
    disposer de cette place, plus la marge prévue au §15.

## Fix round 1 (revue de ad9cf7d)

### Changements

1. **Course dans `openStream`** : des appels simultanés à `item()`/`streamItem()` vidaient
   chacun le segment en cache de l'autre, d'où de faux `paquet_corrompu`. Toutes les
   opérations du lecteur passent maintenant par une file d'attente : elles s'exécutent
   l'une après l'autre. De plus, `chunk()` recharge le segment si le cache a changé
   pendant l'attente : un `wipe()` au milieu d'une lecture ne la fait plus échouer.
2. **Saturation du disque** :
   - (a) `limits.BytesPer48 = 6 << 30` (octets utiles par jour et par /48), vérifié dans
     `AllowCreate` avec les 3 Gio par /64 ; un refus ne consomme rien ;
   - (b) nouvelle colonne `progress_at` : minute du dernier segment reçu. Elle vaut `NULL` à
     la création (la minute de création n'est jamais écrite), est mise à jour à chaque `PUT`
     (remplacement compris) et remise à `NULL` à la finalisation. Le balayage efface un envoi
     commencé sans nouveau segment depuis 15 min. Il garde l'échéance de 3 h et la règle
     « aucun segment en 5 min ». Les bases existantes reçoivent la colonne à l'ouverture
     (`ALTER TABLE`, sans effet si elle existe déjà).
3. **Limite de débit des segments** : dans `guard`, un `PUT` (jeton d'envoi) ou `GET`
   (jeton de téléchargement) de `/api/shares/{id}/segments/{n}` dont le jeton est signé,
   non expiré et lié à cet `id` compte dans `AllowSegment` (600/min par k64), pas dans les
   60/min. Un jeton invalide ou absent compte dans les 60/min. Le jeton est vérifié avant
   de compter.
4. **`Sealer.segment`** : la JSDoc interdit de régénérer depuis un `File` un segment déjà
   envoyé. Garde peu coûteuse : si une entrée est un `File`, un second appel pour le même n
   lève `segment_deja_produit`. Avec un `Blob` ou un `Uint8Array` (copié, donc immuable),
   un second appel rend toujours les mêmes octets. `createShare` n'appelle `segment(n)`
   qu'une fois.
5. **`collectToBlob`** : les tranches sont repliées dans le `Blob` tous les 64 Mio
   (`acc = new Blob([acc, ...parts])`, puis mises à zéro) ; 4ᵉ paramètre `foldBytes`
   (64 Mio par défaut, réglable pour les tests). Documenté au §18.
6. **e2e gros fichier** : seuils abaissés : croissance de la RSS < 150 Mo, croissance de
   `process.memoryUsage().arrayBuffers` < 150 Mo.
7. **`wipe()`** : la JSDoc (lecteur et `Opened`) et le §18 disent ce qu'il laisse : le
   manifeste (noms, types, textes) reste en chaînes JS, impossibles à effacer.
8. **Spécification** : §4 (1 Gio, quotas, débit, 100 Gio), §7.3 (paliers, contrôle du
   palier canonique, morceaux non lus non vérifiés, fichier partiel à abandonner ou
   supprimer), §7.4 (3 h, `progress_at`, seuils de balayage, pas de rechiffrement),
   §7.5 (3 h), §9.1 (`progress_at`, seulement pendant l'envoi), §18 (assemblage en `Blob`,
   limites de `wipe`, aperçu), §24 (quota /48, débit des segments, envoi bloqué), §5 et
   §13 (effacement des envois abandonnés, jeton de 3 h), §15 (trafic sortant).

### Tests (écrits avant le code)

ROUGE :

```
Go  : limits [build failed] (BytesPer48, AllowSegment absents) ; api [build failed]
      (limits.SegmentsPerMin) ; --- FAIL: TestSweepStalledUpload (pas de colonne progress_at)
TS  : × File : segment(n) ne se régénère pas
      × opérations simultanées sur un même lecteur : sérialisées, sans fausse corruption
      × collectToBlob replie les tranches dans un Blob tous les foldBytes
      Tests 3 failed | 115 passed (118)
```

Ajouts :

- `TestBytesPer48` : six liens de 1 Gio depuis six /64 d'un même /48 passent, l'octet de
  plus est refusé, un autre /48 passe, remise à zéro le lendemain.
- `TestSegmentRate` : 600 puis refus ; compteur indépendant de `AllowRequest` ; par
  connexion ; remise à zéro à la minute.
- `TestSweepStalledUpload` : `progress_at` vaut `NULL` à la création, puis la minute du
  segment ; mis à jour par un remplacement ; pas balayé après 14 min 30, balayé à 15 min ;
  `NULL` après finalisation ; un partage finalisé n'est jamais balayé comme envoi bloqué.
- `TestMigrationProgressAt` : une base sans la colonne la reçoit ; deux ouvertures sans
  erreur.
- `TestSegmentRateLimit` (API) : 60/min épuisés, puis 100 `GET` de segment à jeton
  valide passent ; jeton d'un autre type, illisible ou vide → 429 (limite générale) ; la
  minute suivante, 600 requêtes de segments (599 `GET` + 1 `PUT` à jeton d'envoi valide)
  puis 429, alors que la limite générale reste intacte.
- `TestSweepEmptyUpload` et `TestSweepUnfinishedUpload` (janitor) adaptés : l'envoi
  commencé progresse toutes les 10 à 14 min et vit jusqu'à l'échéance de 3 h, pas plus.
- TS : `Promise.all([item(0), item(1), streamItem(2), item(2)])` avec un `fetch` lent :
  tout est exact ; `wipe()` pendant une lecture : lecture exacte ; second
  `segment(0)` sur un `File` → `segment_deja_produit` ; `collectToBlob` avec
  `foldBytes` = 1 Mio sur 3 Mio : au moins 4 replis, jamais plus de 1 Mio + 64 Kio de
  tranches en mémoire, contenu exact.
- Le test de course du contrôleur (`scratchpad/t/race.test.ts`), copié le temps d'un
  essai : `[ 'ok', 'ok' ]`.

### Commandes et sorties

`make test && cd web && npx tsc --noEmit`, puis le gros fichier seul :

```
ok  github.com/skoow/shhdrop/server/...      (10 paquets ; go vet sans remarque)
web src : Test Files 7 passed (7) — Tests 118 passed (118) — 12,0 s
web e2e : Test Files 4 passed (4) — Tests 23 passed (23)   — 47,2 s (contre 142,8 s avant :
          les segments n'attendent plus la limite des 60/min)
tsc --noEmit : aucune erreur (TSC_OK)
RSS : base 110 Mio, pic 218 Mio, croissance 109 Mio ; ArrayBuffer : croissance 2 Mio
```

### Points restants

- Marge du seuil RSS : 109 Mio (114 Mo) mesurés pour 150 Mo autorisés. Une variation du
  ramasse-miettes pourrait un jour faire échouer le test de façon intermittente. Le seuil
  sur les `ArrayBuffer` (2 Mio mesurés) est le contrôle le plus fiable.
- `progress_at` donne, pendant l'envoi seulement, la minute du dernier segment reçu :
  c'est la décision du contrôleur, documentée au §9.1.
- Avec 600 segments par minute, un client peut télécharger environ 2,4 Gio par minute pour
  un même partage ouvert. Les jetons bornent la durée (3 h) et le nombre d'ouvertures
  (≤ 10), mais pas le trafic sortant : à surveiller (§15).
