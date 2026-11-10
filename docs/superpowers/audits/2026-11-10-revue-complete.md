# Revue complète du projet — 10 novembre 2026

Demande du propriétaire : dire tout ce qui peut être amélioré, optimisé ou sécurisé, puis corriger ce qui peut l'être sans casser le site. Trois relectures indépendantes (serveur Go, client et chiffrement, performance et tests), puis les corrections, chacune précédée d'un test qui échouait. Décisions consignées dans la spécification, §42.

Rien ici ne permet de dire que l'application est « 100 % sécurisée ».

## Verdict

- **Chiffrement** : aucune faille trouvée dans la chaîne (clés, nonces, authentification du manifeste, vérifications du destinataire). Le contenu, les noms, le mot de passe et la clé ne quittent pas le navigateur en clair.
- **Point faible réel** : le code servi par le site n'est pas encore vérifiable (§28). SRI est livrée pour `index.html`, mais elle ne protège pas d'un serveur compromis.
- **CI** : le job d'interface était rouge depuis plusieurs commits (99 échecs, presque tous sous WebKit), donc la démo n'était plus publiée. Causes trouvées : quatre défauts de la suite de tests, aucun du site (voir plus bas).

## Corrigé

| Sujet | Gravité | Correction | Preuve |
|---|---|---|---|
| Un refus HTTP (403 d'un pare-feu) affichait « supprimé » | Moyenne | Seuls 404 et 410 valent « disparu » | `client.test.ts` |
| Envoi bloqué si le brouillon est perdu pendant le chiffrement | Moyenne | Arrêt après `sealer.piece` | `draft.test.ts` |
| Quota de `grow` sous-débité en concurrence | Moyenne | Débit sous `claimFinalize` | `TestGrowQuotaNeverBelowDisk` |
| Envois en cours oubliés à minuit UTC | Moyenne | Reportés sous la clé de la veille | `TestMidnightCarriesInFlightUploads` |
| Verrou global des envois | Moyenne | Verrous rayés par partage | `TestSlowEraseDoesNotBlockOtherUpload` |
| Média de format non reconnu envoyé sans avertissement | Moyenne | Pastille ambre (D42-2) | `compose.test.ts`, `clean.spec.ts` |
| Cadre PDF avec accès réseau | Faible | CSP propre, `connect-src 'none'` | `TestPdfFrameCSP`, `pdf.spec.ts` |
| Partage « prêt » sans écriture durable | Faible | `fdatasync` avant « ready » | `TestFinalizeSyncsBeforeReady` |
| `admin wipe` laissait finir les lectures en cours | Faible | Coupure par `kill/all` | `TestAdminWipeCutsDetachedReads` |
| EXIF illisible : nettoyage en échec, position gardée | Faible | EXIF retiré | `strip.test.ts` |
| PDF de 126 octets qui gèle l'onglet | Faible | Largeur nulle refusée, entrées bornées | `pdf.test.ts` |
| Noms d'appareil ou de logiciel dans les MP4 | Faible | `hdlr` et `compressorname` à zéro | `mp4.test.ts` |
| Extensions à risque manquantes | Faible | 20 ajouts | `safety.test.ts` |
| Lecture du fichier à l'envoi (64 lectures par segment) | Performance | Une lecture par plage de 4 Mio | `elements.test.ts` ; mesure de la revue : 66 → 277 Mio/s |
| Tout en `no-store` | Performance | Cache d'un an pour les fichiers à empreinte | `TestCacheControlEndToEnd`, `shell.spec.ts` |
| `UsedBytes` relisait le dossier à chaque création | Performance | Compteur en mémoire | `TestUsedBytesIsACounter` |
| SRI annoncée, absente | Conformité §28.3 | Greffon et contrôle | `check-dist.test.ts`, `hygiene.spec.ts` |
| Aucun fichier de déploiement | Bloquant | `deploy/` | `deploy/test-proxy.sh` (60 contrôles) |

## Suite de tests (CI rouge)

1. Les captures d'écran faites hors de l'aide `capture()` déclenchaient, sous WebKit, un refus CSP du style que Playwright injecte : 92 faux échecs.
2. WebKit ne connaît pas la permission `clipboard-write` : 16 erreurs.
3. « Le serveur ne voit rien » : le nom de fichier repère contenait « navigate », présent dans l'en-tête `Sec-Fetch-Mode` de WebKit : faux positif.
4. `persist.spec.ts` : le Chromium sans tête par défaut n'écrit pas `Default/Preferences`.
5. Deux tests Go instables (`TestLeaveHTTP`, une panique 1 fois sur 64 dans `token_test.go`).

Le résultat de la CI après ces corrections est à lire sur GitHub : WebKit n'est pas disponible sur la machine de développement.

## Non fait, et pourquoi

- **Connexions lentes qui occupent les places** : refusé par le propriétaire (D42-9).
- **Trusted Types, COEP** : essayés, pas intégrables tels quels (§42.1).
- **libsodium à la demande, OPFS pour les gros fichiers, Argon2id en Worker** : refontes à part, décrites en §42.1.
- **Code sans appelant** (`web/src/vault/`, liste de mots EFF, `sealStream`, migration v2 de la base) : gardé tant que le coffre (§27) n'est pas tranché.
- **Vérifié seulement par lecture** : iPhone réel, Firefox, Let's Encrypt réel, image Docker identique au bit près.
