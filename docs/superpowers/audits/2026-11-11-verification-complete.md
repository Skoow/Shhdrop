# Vérification complète du projet — 11 novembre 2026

Cinq relecteurs indépendants, en lecture seule, chacun avec ses outils : serveur Go (golang-backend, insecure-defaults, constant-time-analysis, golang-testing), chiffrement (moteur Rust et couche TypeScript : constant-time-analysis, sharp-edges), logique du site (privacy-review, sharp-edges, svelte), interface (impeccable, svelte, webapp-testing, Chromium sur ordinateur et téléphone), chaîne d'approvisionnement et déploiement (supply-chain-risk-auditor, insecure-defaults, privacy-review). Chaque constat est prouvé par un chemin de code ou un test jetable (dossier de travail de la session).

Statuts : **À corriger** (défaut prouvé), **À trancher** (décision du propriétaire), **Avant mise en ligne**, **Apps** (à faire avant les apps natives).

## 1. Importants

| # | Domaine | Constat | Endroit | Statut |
|---|---|---|---|---|
| I1 | Site | « Nettoyer » qui se termine pendant l'envoi : le lien est donné, mais le fichier nettoyé est effacé du serveur ; le destinataire obtient « introuvable ». Test qui le reproduit. | `flows/compose.svelte.ts:527`, `transfer/draft.ts:478-653` | À corriger |
| I2 | Site | Retour du navigateur sur « Lien prêt » (ou pendant l'envoi) : lien et lien de gestion perdus sans prévenir ; partage impossible à supprimer ; envoi abandonné qui ne se termine jamais (minuteur et mot de passe gardés en mémoire). | `App.svelte:117`, `SendFlow.svelte:87`, `Ready.svelte:50`, `router.svelte.ts:142` | À corriger |
| I3 | Serveur | Déni de service : 64 envois très lents (1 octet) depuis 8 adresses IPv4 occupent toutes les places d'envoi pendant 138 s, renouvelables. Test qui le reproduit. | `api/handlers_share.go:171-188`, `api/api.go:48` | À corriger |
| I4 | Interface | Après « Détruire ce partage », la page reste défilée en bas : l'écran « Détruit » n'est pas visible. | `routes/Content.svelte`, `ui/GoneScreen.svelte` | À corriger |
| I5 | Interface | Texte faux : « supprimé quand vous quitterez cette page », alors que le partage se rouvre pendant 30 min. | page Contenu | À corriger |
| I6 | Chaîne | L'image Docker de production contient « dev » au lieu du numéro de version : elle ne peut jamais correspondre au build public vérifiable (§28). | `vite.config.ts:163`, `deploy/Dockerfile:46` | À corriger |
| I7 | Chaîne | Aucune provenance de bout en bout : image construite à la main, non signée, `deploy.sh` installe n'importe quelle empreinte (connu, §42.1). | `deploy/` | Avant mise en ligne |
| I8 | Légal | Mentions légales et conditions non rédigées (« À compléter »). | `routes/pages/content.ts` | Avant mise en ligne (propriétaire) |
| I9 | Interface | Option « Garder une copie chiffrée dans l'app du destinataire » visible seulement si l'expéditeur est sur téléphone, et promesse d'une app qui n'existe pas. | `routes/Compose.svelte:89` | À trancher |

## 2. Moyens

| # | Domaine | Constat | Statut |
|---|---|---|---|
| M1 | Site | « Réessayer » ne relance jamais un fichier en erreur : échec en boucle ; un refus d'envoi pris pour un échec anti-robot. | À corriger |
| M2 | Site | Mot de passe validé puis sortie de l'écran pendant le calcul : une ouverture est comptée, rien n'est montré ; clés et renouvellements gardés jusqu'à 30 min. | À corriger |
| M3 | Site | Téléchargement en file avec « Enregistrer sous » (Chrome) : échoue avec un faux message pour le 2ᵉ fichier. | À corriger |
| M4 | Serveur | Même blocage que I3 côté téléchargements (lectures lentes). | À corriger |
| M5 | Serveur | Quota journalier dépassable à minuit UTC (10 Gio au lieu de 6) ; le test actuel affirme ce comportement (choix validé qui contredit le but). | À trancher |
| M6 | Moteur | Une note de plus de 100 000 caractères (ou d'octets non UTF-8) est envoyée mais ne s'ouvre pas ; contrôle seulement dans l'interface. | À corriger |
| M7 | Moteur | Vecteurs communs sans les cas limites (clé en « m », 200 éléments, notes limites, mots de passe Unicode difficiles). | Apps |
| M8 | Moteur | Contrôles de sécurité seulement en TypeScript (noms de fichiers, notes, place des éléments, garde de clé) ; D42-21. | Apps |
| M9 | Chaîne | Image complète et proxy jamais testés en CI. | À corriger |
| M10 | Chaîne | Dependabot ne suit ni les images Docker, ni Caddy, ni le second verrou npm. | À corriger |
| M11 | Chaîne | `npm audit` de la CI ignore les outils de build. | À corriger |
| M12 | Interface | « Chiffré et envoyé » affiché avant l'envoi réel. | À corriger |
| M13 | Interface | Page de suivi : ni mise à jour visible, ni heure de dernière lecture (§9.6.5). | À corriger |
| M14 | Interface | Limites d'envoi mal expliquées (« Réessayez dans 8 h 27 » sans la règle). | À corriger |
| M15 | Interface | Page « Signaler » : indique un bouton qui n'est pas là. | À corriger |
| M16 | Interface | Durée incohérente sur « Lien prêt » (12 h, 12 h 12 min, heure arrondie). | À corriger |
| M17 | Interface | Huit options payantes « bientôt » dans le composeur (6 arrêts de tabulation), fenêtre de prix sans « bientôt » visible. | À trancher |
| M18 | Interface | Barre d'onglets du téléphone : 2 onglets sur 3 inactifs. | À trancher |
| M19 | Interface | Explication du nettoyage trop longue (pied de page), lue en entier par les lecteurs d'écran. | À corriger |
| M20 | Interface | Encadré orange trop long sur la page du mot de passe ; messages empilés au dernier essai. | À corriger |
| M21 | Interface | Cibles tactiles sous 44 px (pastilles cadenas, « Nettoyer », liens du pied). | À corriger |
| M22 | Interface | Sur « Lien prêt », la touche Tab saute les liens du pied de page. | À corriger |

## 3. Faibles et optimisations (résumé)

- **Site** : surveillance de disparition arrêtée après un aller-retour d'onglet ; gestion : un « Actualiser » en vol fait réapparaître un partage supprimé ; URL de téléchargement non révoquées à la destruction (60 s).
- **Serveur** : un partage plein ne peut pas être envoyé 3 fois par jour (surcoût de chiffrement compté) ; signalement sans effet sur les lectures en grâce ; identifiant interne ou argument possible sur la sortie d'erreur ; empreinte d'accès écrite sur disque après une destruction par l'administrateur ; course entre finalisation et écritures ; JSON `void` trop tolérant ; résultat de checkpoint ignoré. Optimisations : SQLite `synchronous=NORMAL`, verrou global pendant SQL, tampon de 4 Mio par envoi, lecture de dossier sous verrou.
- **Moteur** : mot de passe collé avec un espace final compté comme essai raté (à trancher : change l'entrée du calcul) ; fonctions de géométrie TypeScript sans contrôle d'entrée ; K_lien non effacée si le mot de passe est vide ; mémoire non effacée après une panique ; pièges pour les apps (générateur d'aléa libre, types non `Send`). Optimisations : `Reader::item` inutilisé (jusqu'à 200 Mio), imports de clés en série, exports de test dans le `.wasm`.
- **Chaîne** : `persist-credentials` des checkouts ; cache npm partagé avec la publication ; `workflow_dispatch` contourne « CI verte » pour Pages ; publication Pages interrompable ; retour arrière sans version de schéma ; documentation fausse (scripts « inexistants », « aucune ressource tierce » non contrôlé) ; conteneurs sans plafond mémoire/CPU ; happy-dom à un seul mainteneur ; en-tête `Server` ; `sandbox` pour le cadre PDF.
- **Interface** : écran « 5 essais » serré sur téléphone ; titre du lien incomplet trop long ; vides sur l'accueil ; « Glissez vos fichiers ici » + « Commencer » ; répétitions dans le composeur ; curseur de la note sur « Titre » ; doublons et jargon sur l'écran d'envoi ; en-tête incohérent sur téléphone ; visionneuse de note ; contour du temps restant ; « Lien prêt » sans titre de niveau 1 ; ordre des boutons de confirmation ; contraste à revérifier sur l'accueil téléphone.

## 4. À trancher par le propriétaire

1. **Vignettes des photos** : seule la vignette JFIF est gardée ; la vignette EXIF (la plus courante sur téléphone) est retirée — elle peut montrer l'image avant recadrage. Garder le retrait (confidentialité) ou garder toutes les vignettes ?
2. **PDF** : la consigne « ne rien toucher à l'intérieur » contredit le code et la spécification (§35.2, D41-31) qui retirent les informations du document, le XMP et les miniatures de pages. Garder ce nettoyage ou ne plus toucher aux PDF ?
3. **Coffre chez le destinataire** (I9) : retirer l'option tant que les apps n'existent pas ?
4. **Quota à minuit** (M5) : compter les envois commencés la veille dans la journée où ils se terminent ?
5. **Mot de passe collé avec espaces** : retirer les espaces en bord avant le calcul ?
6. **Options payantes et onglets « bientôt »** (M17, M18) : les réduire ou les masquer ?

## 5. Vérifié sans défaut (extraits)

Aucune adresse IP sur disque ; comparaisons de secrets en temps constant ; 5 essais de mot de passe tenus même en parallèle ; jetons et octrois signés ; aucun `math/rand` ; JSON strict ; CSP stricte, Trusted Types, aucune ressource tierce (vérifié en navigateur) ; aucune panique du moteur sur 5 millions d'entrées hostiles ; `pure.ts` identique au moteur sur 550 000 liens et 200 000 tailles ; nonces et données authentifiées corrects ; secrets effacés ; actions GitHub épinglées par SHA, permissions minimales, aucune injection de workflow ; image `scratch` sans privilège ; Caddy TLS 1.3 hybride sans journaux ; les 6 paquets installés avant le délai de 7 jours n'ont aucun avis connu ; accessibilité automatique sans défaut sur 15 pages sur 16 ; aucun défilement horizontal à 320 px.

## 6. Décisions du propriétaire (11 novembre, réponse au rapport)

1. Photos : la vignette est GARDÉE, y compris la vignette EXIF des téléphones (correction du propriétaire, même jour) ; le reste des métadonnées (position, appareil, dates…) est retiré.
2. PDF : seules les informations visibles dans les propriétés du fichier sont retirées (dictionnaire Info et sa copie XMP) ; rien d'autre n'est modifié à l'intérieur : pages, images intégrées, polices, miniatures de pages (/Thumb) (correction du propriétaire, même jour).
3. Option « copie chiffrée dans l'app du destinataire » : retirée de l'interface pour l'instant.
4. Quota à minuit : corrigé.
5. Blancs ASCII en début et fin du mot de passe : retirés dans le moteur avant le calcul (site et apps identiques).
6. Options payantes : une seule ligne discrète ; barre d'onglets du téléphone masquée tant qu'un seul onglet fonctionne.
