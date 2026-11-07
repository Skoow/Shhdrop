# Scan fonctionnel, UX et design de Shhdrop (7 novembre 2026)

Périmètre : `main` au commit `e1de8c6`, démo construite par `npm run build:demo` et servie sous `/Shhdrop/` (serveur statique local), pilotée par Playwright (Chromium 1243, `deviceScaleFactor` 1).
Captures : `/tmp/claude-0/-home-user/b97dc3e7-f107-54ba-8c5b-d4198f88d7ff/scratchpad/scan-ux/` (notées ci-dessous par leur nom de fichier seul).
Documents lus : spec UI (sommaire, §9 en détail), plan (liste des tâches), benchmark (tableau, motifs, signatures, signalements B1 à B6), journal SDD.

Parcours faits : accueil (1440, 390, 1920, défilement complet), ajout de fichiers mixtes (image, PDF, vidéo, audio, archive, exécutable, docx à nom très long, texte), note texte, mot de passe généré et personnel (trop court puis valide), envoi, « Lien prêt », copie (presse-papier lu), QR, lecture à voix haute, suppression, ouverture du lien dans le même onglet, lien de gestion, pages Sécurité, Confidentialité et 404, mouvement réduit, anglais, axe-core (WCAG 2.2 AA + bonnes pratiques) sur accueil, composeur et lien prêt.

Limite honnête : les six skills demandées (impeccable, design-taste-frontend, design-critique, accessibility-review, ux-copy, unslop) n'ont pas été chargées par l'outil Skill dans cette passe. J'ai appliqué leurs critères de mémoire (hiérarchie, cohérence, contraste, cibles, copie, signaux de « généré par IA »). À refaire avec les skills chargées avant la revue finale (Task 28) si on veut leur grille exacte. Le WebKit n'est pas disponible ici : rien n'a été vérifié sur Safari. Aucun fichier du dépôt n'a été modifié, rien n'est commité.

État du produit au moment du scan (d'après plan et journal) : faits = socle, accueil v4, composeur v3.1, envoi, « Lien prêt », K1 et K2 (chiffrement v2, lien court). Pas faits = M2, 9a à 9c (nettoyage réel), 12 (vocal), 14 à 16 (anti-robot réel et repli), 19 (gestion), 20 (ouverture), 21 à 24 (contenu, enregistrer, détruire, signaler), R, H, A, V, 25 (Sécurité, Confidentialité), 26 (PWA), 27, C, 28. Beaucoup de ce qui manque ci-dessous est donc « prévu, pas encore livré » ; la partie 3 le classe par priorité pour une V1 complète.

---

## 1. Bugs et parcours cassés

Gravité : Critique (bloque le parcours ou ment à l'utilisateur), Élevée, Moyenne, Faible.

### B1. Le lien généré ne mène nulle part (Critique)

- Étapes : envoyer un partage en démo, puis soit cliquer « Ouvrir comme destinataire (démo) », soit coller le lien copié dans l'onglet (même onglet, nouvel onglet).
- Constat : page vide avec un seul titre « Shhdrop » (`14-open-demo-btn.png`, `15-open-link-sametab.png`). Le lien de gestion donne la même chose (`16-manage-link.png`). Le `#` est retiré de la barre, donc la clé disparaît sans qu'aucun écran l'ait utilisée : le partage devient inouvrable (en production, une ouverture serait même perdue si l'écran existait sans le bon flux).
- Cause : routes `open` et `manage` absentes de `App.svelte` ; la route reconnue (`/` avec `#` valide) tombe sur un titre provisoire.
- Correction : (1) à court terme, dans la démo seulement, retirer ou désactiver le bouton « Ouvrir comme destinataire » tant que la Task 20 n'est pas livrée, et afficher sur toute adresse avec `#` valide un écran minimal « L'ouverture arrive bientôt » qui ne retire pas le `#` ; (2) livrer Task 20 puis 19 (voir partie 3, G1 et G2).

### B2. « Sécurité » et « Confidentialité » (pied de page) et « Tous les détails de sécurité » (accueil) ouvrent une page vide (Critique, promesse fausse)

- Étapes : cliquer l'un des trois liens depuis l'accueil, le composeur ou « Lien prêt ».
- Constat : page avec le seul titre « Shhdrop » (`17-securite.png`). La commande `innerText` du corps donne « Shhdrop | Sécurité | Confidentialité ». C'est déjà signalé par l'audit de confidentialité du 5 novembre ; toujours présent. Un lien « tous les détails » vers du vide est pire qu'aucun lien : le propriétaire a demandé de la confiance par la preuve.
- Correction : soit livrer Task 25 (avancée par décision du 5 novembre), soit retirer les trois liens tant que les pages n'existent pas. Ne jamais laisser un lien vers un titre vide en ligne.

### B3. « Nettoyer tous les fichiers » ne nettoie rien, et l'écran le suggère (Élevée, honnêteté et confidentialité)

- Étapes : ajouter un PNG, un PDF, une vidéo, puis cliquer le bouton ambre « Nettoyer tous les fichiers ».
- Constat : après le clic, bandeau « Non nettoyés (format pas encore pris en charge ou fichier illisible) : photo-plage.png, vacances.mp4, contrat.pdf » ; les pastilles « Non nettoyé » restent sur tous les fichiers (`03-clean-click.png`). Le bouton est le plus voyant de l'écran (ambre plein, pleine largeur sur téléphone, `20-compose-390.png`) et ne sert à rien. Le texte des lignes dit « Peut contenir le lieu, la date et l'appareil » pour un PNG sans EXIF : l'utilisateur ne peut ni corriger ni comprendre.
- Cause : `flows/clean.ts` est un relais provisoire (Tasks 9a à 9c non faites).
- Correction : tant que 9a n'est pas livrée, masquer le bouton et remplacer les pastilles par une mention unique et calme « Les métadonnées de vos fichiers ne sont pas retirées » (sur l'écran d'options, pas en alerte sur chaque ligne). Quand 9a arrive, le bouton redevient visible, en style secondaire (voir D4).

### B4. Le champ « Votre mot de passe » déborde de la colonne Options et son contour est rogné (Élevée)

- Étapes : « Écrire mon propre mot de passe », taper « court » (1440 × 900).
- Constat : le champ dépasse de la colonne à droite, le contour de focus est coupé à x = 1082, le bouton « générer » est collé au bord et un bout de caractère déborde (`05b-password-short.png`). La colonne devient plus haute que la fenêtre : « Destinataire » est coupé, la colonne scrolle seule, sans indice.
- Correction : `min-width: 0` sur le champ et ses enfants flex, `box-sizing: border-box`, et réserver une marge de 2 px au contour dans le conteneur scrollable (`overflow: clip` avec `overflow-clip-margin`, ou padding de 4 px).

### B5. Le mot de passe affiché sur « Lien prêt » perd une espace (Élevée, exactitude)

- Étapes : envoyer avec le mot de passe personnel « soleil de mars en hiver ».
- Constat : le champ lisible affiche « soleil de marsen hiver » (`08-ready-1440.png`) alors que la valeur copiée est correcte. Le nœud est coupé en deux `span` (« soleil de mars » puis « en hiver ») et l'espace de jonction s'effondre. Quelqu'un qui dicte le mot de passe depuis l'écran se trompe. Même mécanisme sur les liens (`…` au milieu).
- Correction : `white-space: pre` (ou `pre-wrap`) sur les segments, ou un seul nœud texte avec ellipse CSS ; test visuel sur un mot de passe à espaces.

### B6. Le tableau de la liste coupe ses lignes à deux lignes de texte (Moyenne)

- Étapes : en anglais (ou en français avec un nom long), ajouter `setup.exe` dans « Autres » (`31-en-compose.png`).
- Constat : « Program or script: it can act on the recipient's device. » est tronqué (« recipient's device » rogné en bas). En français la ligne passe sur deux lignes sans rognage, mais à peine (`20-compose-1920.png`).
- Correction : hauteur de ligne libre (`min-height`, pas `height`) ; sortir l'avertissement de la cellule Nom pour le placer sur sa propre ligne sous la ligne.

### B7. La liste de 9 éléments est rognée sans indication (Moyenne)

- Étapes : ajouter 9 éléments mixtes (1440 × 900).
- Constat : la liste a un défilement interne (622 px de contenu dans 482 px, mesuré) ; « Archives » et « Autres » sont coupés sous la barre d'ajout, sans ombre de fin ni barre visible (`02-compose-1440.png`). La spec dit « tout tient sans défilement de page » : c'est vrai, mais l'utilisateur ne voit pas que le contenu continue, et peut envoyer un `.exe` marqué « À risque » qu'il n'a jamais vu à l'écran.
- Correction : ombre de dégradé en bas, barre de défilement fine visible, et au moins faire passer en tête de liste les éléments à risque ou le compte de lignes cachées (« 2 de plus ↓ »).

### B8. Bande de défilement (header collant) : bandeau noir qui masque le contenu (Moyenne)

- Étapes : défiler « Lien prêt » ou l'accueil (`13-delete-confirm.png`, `40-home-scroll-1.png`).
- Constat : l'en-tête devient un aplat sombre de 100 px avec un filet, plus opaque que le reste ; sur l'accueil, un coin en biais est visible à gauche juste sous l'en-tête au début de « Comment ça marche » (`40-home-scroll-1.png`, y ≈ 100–130) : c'est le bord d'un `clip-path` du fond de section.
- Correction : arrondir ou fondre le bord du fond de section (mask en dégradé) ; réduire l'en-tête à 56 px une fois défilé.

### B9. Le titre de l'onglet ne suit ni la route ni la langue (Moyenne)

- Constat : `document.title` = « Démo · Shhdrop » sur toutes les routes, y compris en anglais (« Démo » reste en français), sur « Lien prêt », la 404 (`30-en-home.png` texte relevé). Axe : `page-has-heading-one` sur « Lien prêt » (le titre « Lien prêt » n'est pas un `h1`).
- Correction : titre par route et par langue (« Lien prêt · Shhdrop ») ; `h1` sur chaque écran ; bandeau démo traduit.

### B10. Typographie française : espaces insécables absentes dans le bandeau et dans les textes statiques (Faible)

- Constat : « Démo: rien n'est envoyé », « l'envoi: le serveur » sur la page d'accueil (`01-home-1440.png`) : le test i18n compte 70 ` `, mais le texte de `fr.ts` du bandeau et certaines phrases de `home` n'ont pas l'espace fine avant « : ». Les deux-points collés se voient sur l'écran de tête. Ailleurs (« 10 éléments », « 24 h ») l'espace est si fine qu'on lit « 10éléments » (`01-home-1440.png`, ligne de preuves).
- Correction : élargir le test à tous les textes de la démo ; utiliser U+00A0 (visible) avant les unités et U+202F avant « : ; ! ? » ; revoir l'espacement des chiffres tabulaires (la fonte rend l'espace fine presque nulle).

### B11. Doublons acceptés, avec une simple pastille (Faible)

- Étapes : ajouter deux fois `notes.txt` et `capture.png`.
- Constat : les deux copies restent, marquées « En double ? » en ambre (`42-actions-menu.png`). C'est conforme à la spec (pas de refus), mais l'envoi se fait avec deux fois le même fichier si on n'y prend pas garde. À trancher : proposer « Retirer le doublon » dans la pastille.

### B12. Animation infinie en mouvement réduit (Faible)

- Constat : en `prefers-reduced-motion: reduce`, `seal-label-pulse` (opacité 1 à 0,6) tourne sans fin pendant l'envoi (mesuré avec `document.getAnimations()`). Voulu par le code (`Sealing.svelte`, ligne 419), mais WCAG 2.2.2 demande une pause pour tout mouvement de plus de 5 s. À remplacer par un état fixe en mouvement réduit.

### B13. Poids du premier chargement : libsodium chargé à l'accueil (Moyenne, performance)

- Constat : `triangle-exclamation-point-*.js` (678 Ko, 245 Ko gzip) est demandé dès l'accueil, avant tout ajout de fichier (relevé réseau à 390). L'accueil devrait fonctionner sans, et le charger au premier ajout (ou en préchargement inactif). Déjà prévu en Task P ; je le range ici parce que le LCP mobile mesuré le 5 novembre (3,0 s) en dépend.
- Correction : import dynamique au premier ajout ; nom de chunk lisible (`crypto`) ; séparer l'icône du nom actuel (le chunk porte le nom d'une icône par accident de découpage).

### Points vérifiés et sans défaut

Viewport 390, 1440 et 1920 : aucun débordement horizontal (`scrollWidth` = `innerWidth` partout) ; erreurs de console : aucune ; cibles tactiles : toutes ≥ 44 px au clavier et au doigt (les vignettes 64 px) ; focus visible partout (contour 2 px et ombre) ; ordre de tabulation logique ; copie du lien et du mot de passe correcte (presse-papier lu) ; QR généré et masquable ; confirmation de suppression en ligne (texte clair, « Annuler » présent) ; « Tout retirer » avec annulation ; mot de passe trop court : bouton désactivé avec raison lue (`aria-describedby`). Axe : seulement `region` (modéré) et `page-has-heading-one` ; aucun contraste signalé.

---

## 2. Critique de design par écran

Le monde « Nuit chiffrée » est cohérent : fond sombre grainé, aurore discrète, menthe réservée à « scellé, actif, sûr », Mona Sans à largeur variable, filets fins. Aucun dégradé violet, aucun emoji, aucune lueur générique : la grammaire ne ressemble pas à du gabarit généré. Les faiblesses sont dans la densité, la répétition et les endroits où le « décor » passe avant le travail.

### Accueil (`01-home-1440.png`, `01-home-390.png`, `40-home-scroll-*.png`)

Fort : titre à fort contraste, coffre à droite, hiérarchie claire (un bouton blanc, quatre actions secondaires), le coffre promet exactement ce que l'outil fait.

À améliorer :

1. **Le titre se coupe mal** : « Un lien, un / mot de passe, / puis plus rien. » laisse « un » seul en fin de ligne 1. `text-wrap: balance` et une largeur de mesure fixée (le titre tient en trois lignes égales à « Un lien, / un mot de passe, / puis plus rien. »).
2. **Trois sceaux à gauche + neuf cartes plus bas = la même idée trois fois** : « Chiffré de bout en bout », « S'efface tout seul », « Sans compte » sont répétés à la lettre dans « Pourquoi c'est sûr » (`40-home-scroll-3.png`). Garder les trois sceaux, ramener la grille à quatre cartes qui apportent du nouveau (5 essais, aucune IP sur disque, aucun pistage, code ouvert).
3. **Cartes de la grille de hauteur inégale** : « Aucun pistage » fait quatre lignes de plus que ses voisines ; « Un code ouvert » a une interligne différente (`40-home-scroll-3.png`). Raccourcir le texte du pistage (renvoyer l'exception reCAPTCHA vers la page Confidentialité) et aligner l'interligne.
4. **Défilement lourd** : l'accueil mesure 5 900 px à 1440 et 8 100 px à 390 pour quatre sections. Sur téléphone, supprimer « Pourquoi c'est sûr » de l'accueil (la page Sécurité la porte) ou la replier.
5. **Section finale** : la grande capsule déborde presque de la fenêtre, le titre « Quelque chose à transmettre ? » est posé sur du faux chiffré qui lui fait concurrence (`40-home-scroll-5.png`) ; le texte en gris est plus pâle que le bruit autour. Baisser l'opacité du faux chiffré à 0,10 derrière le texte, ou le rejeter sur les bords.
6. **Schéma appareil → serveur → destinataire** (`40-home-scroll-2.png`) : bien dessiné, mais le grand cadre est vide aux trois quarts et le lien d'exemple flotte seul à droite d'un titre. Réduire la hauteur du cadre ou lui donner une légende par étape sous chaque objet.
7. **Le bandeau « Démo »** (ambre plein, 38 px, deux lignes sur 390) prend plus de place que l'en-tête ; une seule ligne courte (« Démo : rien n'est envoyé ») et fermable pour la session.
8. **Bouton de langue** : « English » avec icône est correct, mais affiche le nom de la langue cible en haut à droite avec la même importance que l'action principale. Passer en lien discret (« EN »).

### Composeur (`02-compose-1440.png`, `20-compose-1920.png`, `20-compose-390.png`)

Fort : tout dans l'écran à 1440 et 1920, capacité en tête, phrase d'options lisible (« S'efface dans 12 h ou après 1 ouverture, au premier des deux »), ligne de défaut claire, interrupteur de téléchargement bien expliqué.

À améliorer :

1. **Bouton « Nettoyer tous les fichiers »** : ambre plein, il crie « problème » au-dessus de tout, alors qu'il ne fonctionne pas encore (B3). En style secondaire (contour), et seulement quand une action est disponible.
2. **Boutons morts dans la barre d'ajout** : « Conversation (Bientôt) » et « Mémo vocal » ouvrent une feuille « arrive bientôt » (`41-voice.png`). Une fonction en vitrine dans la barre principale sème le doute. À retirer de la V1 visible (voir partie 4).
3. **Barre d'ajout en bas de liste** : le texte « Déposez des fichiers n'importe où sur la page ou cli… » est tronqué à 1440 et 1920 (« ou cli… ») ; il en reste un fragment illisible. Passer le libellé à « Ajouter des fichiers » avec l'aide de dépôt en infobulle, ou donner la largeur complète à la zone et envoyer les deux autres boutons dans un menu « + ».
4. **Tableau** : l'en-tête « NOM · TYPE · TAILLE » est répété pour chaque catégorie (Documents, Archives, Autres), la colonne « Actions » n'a pas de titre et l'écart Type/Taille est irrégulier (`20-compose-1920.png`). Un seul en-tête pour toute la liste, ou aucun (les catégories suffisent).
5. **Catégories vides en hauteur** : « Photos » et « Vidéos » en vignettes de 64 px avec légende « photo… .png » coupée au milieu : le nom est illisible. Afficher le nom sur deux lignes ou au survol avec un tooltip, et remplacer le point ambre sur la vignette (sans explication, `02-compose-1440.png`) par la pastille de texte « Non nettoyé » ou rien.
6. **Colonne Options** : trois blocs d'importance égale (Durée, Ouvertures, Mot de passe) puis un quatrième (Destinataire) ; sur 1440 × 900 la colonne remplit la hauteur mais celle de droite (phrase de synthèse) reste vide aux deux tiers. Déplacer le résumé au-dessus du bouton, sur la même colonne que le bouton, et rendre sa largeur à la liste.
7. **Ouvertures 1 à 10** : dix boutons dans une grille de 5 × 2 pour un réglage dont 1, 3 et 10 couvrent 95 % des usages. Garder 1, 3, 5, 10 (ou un stepper).
8. **Mot de passe généré** : « #et=4@btZW » dicté au téléphone est pénible (`02-compose-1440.png`). La spec demande 10 caractères mixtes sans ambigus ; proposer en alternative un mode « 4 mots » (piste déjà notée en C2 « code de vérification à 4 mots ») et garder les caractères pour ceux qui copient-collent.
9. **Menu « … » en fenêtre modale centrée** (`42-actions-menu.png`) : un voile sur toute la page pour « Renommer, Monter, Descendre, Retirer » est trop lourd à la souris ; popover ancré sur le bouton à partir de 760 px, feuille en bas sur téléphone.
10. **Mobile (390)** : le premier écran est plein (zone de dépôt de 118 px, trois boutons, bouton ambre) avant la première vignette (`20-compose-390.png`). Réduire la zone de dépôt à 64 px de haut (on ne dépose pas au doigt), rendre le bouton de nettoyage discret, et supprimer « Conversation » : on gagne 150 px pour la liste. La barre d'envoi collée est bien : l'options en une ligne « 12 h · 1 ouverture · téléchargement autorisé » se lit d'un coup.

### Options et mot de passe (`05-password-own.png`, `05b-password-short.png`)

1. Débordement du champ (B4). Après « Écrire mon propre mot de passe », le focus ne passe pas dans le champ de façon visible tant qu'on n'a pas tapé : ajouter l'annonce « Champ mot de passe, 0 sur 10 caractères » et un focus explicite.
2. Étiquettes en double : « Mot de passe » puis « Votre mot de passe » (`05b-password-short.png`). Garder l'une.
3. Le compteur affiche deux fois la même consigne (« 10 caractères au moins (5/10) » et plus bas « Le mot de passe doit faire au moins 10 caractères » sous le bouton). Un seul message, près du champ.
4. La jauge de force est une barre de trois segments rouge/gris/gris sans libellé ; ajouter un mot (« faible », « correct », « solide ») : la couleur ne doit pas porter seule l'information.

### Envoi (`07-sending-900.png`, `21b-sending-390.png`, `34-rm-sending.png`)

Fort : la capsule qui se remplit en pourcentage, les quatre étapes, « Annuler » toujours présent, note honnête sur le gabarit de taille.

À améliorer :

1. La légende « Voici, en image, ce que le serveur reçoit : des données illisibles » est posée sous une capsule qui montre encore les noms en clair à 0 %. Afficher la légende seulement quand le brouillage est visible, ou la reformuler en « À l'envoi, vos noms de fichiers sont brouillés ».
2. La page est une demi-page : tout est en haut, un vide de 300 px au-dessous, le pied de page remonte à y = 600 (`07-sending-900.png`). Centrer verticalement ou aligner sur la grille de « Lien prêt » (colonne de 690 px).
3. L'étape « Vérification anti-robot / Calcul sur votre appareil » est visible en démo alors que rien ne se calcule (Task 14 non faite) ; en production, elle laisse attendre sans expliquer. Texte : « Vérification que vous n'êtes pas un robot (quelques secondes) ».
4. « Annuler » est un lien nu sans contour, mal aligné à gauche des étapes (`07-sending-900.png`, à x = 797 contre 777 pour les étapes) : décalage de 20 px.
5. La note « La taille envoyée est arrondie au palier supérieur pour masquer la taille réelle » emploie « palier » : jargon interne. « Nous ajoutons des données neutres pour ne pas révéler la taille exacte de vos fichiers. »

### « Lien prêt » (`08-ready-1440.png`, `09-ready-full.png`, `11-qr.png`, `22-ready-390-full.png`)

Fort : titre, pastille « Actif · s'efface vers 22 h 45 », deux cartes séparées (lien, mot de passe) avec le rappel « par deux moyens différents » ; QR avec l'avertissement « Le QR contient la clé : ne le montrez qu'au destinataire » ; confirmation de suppression en ligne.

À améliorer :

1. **Page trop longue** : 1 460 px à 1440 (et 1 800 à 390). L'action de sortie « Terminé » est tout en bas, au style secondaire, et la suppression, destructrice, est collée au pouce sur téléphone (`22-ready-390-full.png`) : sur téléphone la zone la plus accessible est donc « Supprimer ce partage ». Inverser : « Terminé » principal, collé en bas ; « Supprimer » en lien discret dans la carte de gestion.
2. **Le mot de passe est en clair en petit** (14 px mono) dans un champ de lecture : sur le même écran que le lien. Un champ masqué par défaut avec œil, ou la grande police (celle de la feuille « caractère par caractère »).
3. **Trois secrets sur un écran** (lien, mot de passe, lien de gestion) avec le même poids visuel. Le lien de gestion peut aller dans une carte repliée « Gérer ce partage (garder pour vous) ».
4. **« Ouvrir comme destinataire (démo) »** (B1) : retirer ou le faire fonctionner.
5. **Le bouton « Vider le presse-papier »** est une action de secours mise au même niveau que « Terminé » ; elle devrait se déclencher automatiquement après la copie du mot de passe (avec délai et annonce) plutôt qu'être une ligne.
6. **QR** : s'ouvre dans la carte et pousse tout le contenu de 280 px ; le mettre dans une feuille. Il est blanc plein dans un monde sombre (obligatoire pour la lecture) : lui donner un cadre qui l'assume (marge blanche arrondie, légende dessous).
7. **Le bandeau « Ces informations ne seront plus jamais affichées »** est un avertissement important noyé dans le pied de la page ; le placer en haut, avant les deux cartes de secrets, car c'est la seule chance de les enregistrer.

### Pages Sécurité, Confidentialité, 404, ouverture, gestion

Sécurité et Confidentialité : vides (B2). Ouverture et gestion : vides (B1). 404 : correcte, brève (« Cette page n'existe pas. / Retour à l'accueil »), mais sans le monde visuel (pas de capsule, pas de logo effacé) : c'est l'occasion de montrer la gomme du logo (décision du propriétaire du 5 novembre).

### Anglais (`30-en-home.png`, `31-en-compose.png`, `32-en-ready.png`)

Traduction complète, aucune chaîne française trouvée dans l'interface ; « Soon », « Not cleaned », « Risky » corrects. Défauts : titre d'onglet en français (B9), ligne tronquée (B6), « Estimated upload: about 1 s » : « upload » est « envoi » dans l'interface française mais côté serveur « envoi » est « send » : cohérent, mais « Send them through two different channels » (EN) contre « par deux moyens différents » (FR) ne dit pas la même chose (« channels » est plus précis).

### Mouvement réduit (`33-rm-home.png`, `35-rm-ready.png`)

Accueil : aucune animation en cours (bien). Envoi : une pulsation sans fin (B12). Les captures sont conformes à l'état de repos.

### Transversal

- **Contraste** : aucun défaut Axe ; le texte secondaire (`--text-3`) sur les cartes reste lisible. À surveiller : les petites étiquettes « À risque » et « Non nettoyé » en 11 px ambre/rouge sur fond teinté.
- **Une seule icône de lock** sert à sept endroits (sceaux, capsule, bouton « Chiffrer et envoyer », médaillon) : la métaphore perd son sens ; réserver le cadenas fermé au « scellé » et utiliser la clé pour « mot de passe ».
- **Rythme vertical** : espacements de 16, 24 et 32 mélangés dans la même carte (Options) ; une échelle de 8 points et deux valeurs par carte.
- **Pied de page** : deux liens de 14 px, sans mention du code ouvert ni de la version ; à 390 la zone est à 1 700 px de profondeur.

---

## 3. Écarts fonctionnels (spec et benchmark), par priorité

Légende : P0 = bloque une V1 publique ; P1 = nécessaire à une V1 complète ; P2 = peut suivre juste après.

| # | Priorité | Écart | Où c'est prévu | Remarque |
|---|---|---|---|---|
| G1 | P0 | **Écran d'ouverture du destinataire** (déverrouillage par mot de passe, avertissement « 1 ouverture comptée », aperçu, visionneuses, enregistrement) | Task 20, 21, 22, 23 | Sans lui le produit n'est pas utilisable ; benchmark motif 9 (geste irréversible annoncé avant) |
| G2 | P0 | **Page de gestion du créateur** (état, ouvertures restantes, suppression par `V_gestion`) | Task 19 | Aujourd'hui le « lien de gestion » est donné mais ne fonctionne pas (B1) ; benchmark motifs 11 et 12 |
| G3 | P0 | **Nettoyage réel des métadonnées** (9a images, 9b documents, 9c audio/vidéo) | Tasks 9a à 9c | Sans lui, la promesse « Même les noms de vos fichiers sont chiffrés » est vraie mais le contenu garde GPS/auteur ; décision d'envoi bloqué jusqu'à « Envoyer tel quel » (Q-MD1) non livrée |
| G4 | P0 | **Anti-robot réel** (preuve de travail, repli Google) | Tasks 14 à 16 | Aujourd'hui simulé en démo ; en production, l'envoi est bloqué sans lui |
| G5 | P0 | **Pages Sécurité et Confidentialité** avec le faux lien d'exemple, « Ce que Shhdrop ne peut pas faire » (benchmark motifs 13 et 14), la mention honnête du repli Google, de l'IP et de la conservation des journaux | Task 25 | Prérequis légal (LCEN, RGPD) avant toute mise en ligne publique |
| G6 | P1 | **Terminer, détruire, signaler** côté destinataire (bouton « Détruire pour tout le monde », « Signaler ») ; état « Détruit » ; reçu de destruction | Task 24 ; signature 4 du benchmark | Le signalement exige un parcours et un point de contact (légal) |
| G7 | P1 | **Droits du destinataire** (téléchargement autorisé ou lecture seule ; flou à la perte de focus) | Task R | L'interrupteur existe côté expéditeur et n'a aucun effet côté destinataire |
| G8 | P1 | **PWA** : manifeste, `theme-color`, icônes déclarées, installable ; service worker d'épinglage | Tasks 26, C4 | `index.html` n'a ni lien `manifest`, ni `description`, ni `theme-color`, ni `canonical` (relevé dans `dist-demo/index.html`) ; les icônes 192 et 512 existent déjà |
| G9 | P1 | **Historique local des envois chiffré** (liste, retrouver un lien de gestion perdu, « Tout détruire ») | Task H | Aujourd'hui, fermer l'onglet sur « Lien prêt » perd définitivement le lien de gestion ; le message « Ces informations ne seront plus jamais affichées » est exact mais dur |
| G10 | P1 | **Envoi anticipé et pré-lecture** (pré-chiffrement dès l'ajout, ≤ 5 s d'attente) | Task K3 | Demande explicite du propriétaire ; l'estimation « environ 1 s » n'est pas mesurée en conditions réelles |
| G11 | P1 | **Vérification de la version** (builds reproductibles, empreintes, page « Vérifier cette version ») | Tasks C1 à C3 | C'est la priorité « zéro confiance » choisie par le propriétaire le 5 novembre ; le pied de page n'affiche encore rien |
| G12 | P1 | **Minimisation serveur, aucune statistique** | Task M2 | Contrôlé par test selon le plan ; à rejouer avant publication |
| G13 | P1 | **Parcours « le serveur ne voit rien » côté navigateur** et parcours complets de bout en bout | Task 27 | Bloque toute mise en ligne selon CLAUDE.md |
| G14 | P1 | **Navigateur non pris en charge / navigateur intégré** (message clair + « Ouvrir dans le navigateur ») | Task 5 (fait), écran présent | Non vérifié dans ce scan (pas d'agent utilisateur intégré simulé) |
| G15 | P2 | **Mémo vocal** (enregistrement dans la page) | Task 12 | Aujourd'hui « arrive bientôt » |
| G16 | P2 | **Coffre mobile facultatif** (passkey) ; **compte facultatif** ; **offre payante** | Tasks V1 à V3, A1 à A3, P1 à P3 | Après la V1 selon le plan |
| G17 | P2 | **Lighthouse 100, SEO, découpage par route** | Task P | Voir B13 |
| G18 | P2 | **Contrôle visuel final et DESIGN.md** | Task 28 | À faire avec les six skills chargées |

Ce qui manque et dont on n'a pas encore parlé (vigilance permanente) :

- **Récupération après erreur côté expéditeur** : si l'envoi est coupé (connexion, onglet fermé), l'écran de reprise et le devenir du partage orphelin côté serveur ne sont pas décrits dans l'interface (la logique de coupure existe, pas l'écran d'après).
- **Accessibilité cognitive du mot de passe** : aucun moyen de dicter ni d'épeler hors de la feuille « caractère par caractère » (bonne idée, mais seulement après l'envoi ; en amont, le mot de passe personnel n'a pas de bouton « afficher »).
- **Texte de partage prêt à copier** : le bouton « Copier » donne le lien seul. Un bouton « Copier le message » (« Voici le lien… Le mot de passe arrive par un autre moyen ») éviterait aux gens de coller le mot de passe dans la même conversation (la leçon que l'écran répète).
- **Partager par le système** (Web Share) : absent de « Lien prêt », alors que benchmark motif 18 le prévoit (« Copier, Partager, QR »). Seulement lien + QR aujourd'hui.
- **Expiration visible côté créateur** : décompte et état en direct (« 1 ouverture sur 1 », « Ouvert 2 fois ») inexistants tant que G2 n'existe pas.
- **Mention légale et contact** (signalement d'abus, responsable de traitement) : à créer avant toute ouverture publique ; point juridique déjà en suspens (LCEN, IP) dans le journal.
- **Limite de taille « 1 Go »** : la ligne de preuves du coffre dit « 1 Go » alors que le plan a noté que « 1 Gio exact > CONTENT_MAX » (texte à trancher). Écran et serveur doivent dire le même nombre.

---

## 4. À retirer ou simplifier, et idées nouvelles

### À retirer ou simplifier

1. **Bouton « Conversation (Bientôt) »** dans la barre d'ajout : fonction V2 (salon éphémère) affichée en V1 ; elle ajoute un état mort et un doute. Retirer de l'interface jusqu'à ce qu'elle existe.
2. **Bouton « Mémo vocal »** tant que Task 12 n'est pas livrée : même raison.
3. **Neuf cartes « Pourquoi c'est sûr »** : ramener à quatre ; le reste va sur la page Sécurité.
4. **Dix boutons « Ouvertures »** : réduire à 1, 3, 5, 10 ou à un stepper.
5. **En-têtes répétés du tableau** par catégorie et colonne « Actions » sans titre.
6. **Bouton « Vider le presse-papier »** : à automatiser (vide après 60 s, annoncé), au lieu d'une action manuelle de plus.
7. **Étapes « Vérification anti-robot » visibles quand elles sont instantanées** : n'afficher l'étape que si elle dure plus de 400 ms.
8. **Double étiquetage du mot de passe** (« Mot de passe » puis « Votre mot de passe », deux messages de longueur minimale).
9. **Lien « English » aussi voyant que l'action principale** : lien discret.
10. **Aurore, grain, faux chiffré et guillochis** sur la même page : trois textures simultanées dans la section finale ; en garder deux.
11. **Section « Comment ça marche » sur téléphone** : trois cartes animées de 600 px chacune ; passer à trois lignes avec icône.
12. **La coupure du lien affiché par « … » au milieu** : utile pour la largeur mais cache la fin du lien (la partie qui compte pour vérifier). Afficher le début et la fin avec un tooltip du lien complet, ou le retour à la ligne forcé sur 2 lignes.

### Idées nouvelles (esprit du projet)

| Idée | Verdict | Raison |
|---|---|---|
| Bouton « Copier le message prêt à envoyer » (texte français avec le lien, sans le mot de passe) | **V1** | Petit, change le comportement le plus risqué (mot de passe collé avec le lien) |
| Partage via le menu du système (`navigator.share`) pour le lien seul | **V1** | Prévu au benchmark (motif 18), disponible sur téléphone |
| Écran « reçu de destruction » après suppression ou expiration (ce qui est effacé, ce qui ne l'est pas) | **V1** | Signature 4 du benchmark ; c'est ce qui rend la fin de vie crédible et c'est peu de code |
| Aperçu de ce que verra le destinataire avant l'envoi (« Voir comme le destinataire ») | **V1** | Évite les envois erronés (mauvais fichier, note vide) |
| Mode dictée du mot de passe (« B majuscule », « 7 chiffre ») déjà livré en feuille | **V1** (déjà fait) | À proposer aussi avant l'envoi pour un mot de passe personnel |
| Mode « 4 mots » pour le mot de passe généré | **V1** | Plus facile à dicter, entropie comparable avec une liste de 2 048 mots (listes locales) |
| Vue du serveur (« Ce que voit le serveur » : taille arrondie, heure de fin, aucune clé) | **V2** | Signature 1 du benchmark ; utile pour la confiance mais dépend de K3 et M2 |
| Temps restant dessiné sur le contour de la capsule | **V2** | Signature 3 ; esthétique, sans urgence |
| Deux capsules qui se séparent (lien et mot de passe) | **V2** | Signature 2 ; mouvement fort, à prototyper après la V1 |
| « Demander des fichiers » (lien de dépôt, sans compte) | **V2** | Décidé par délégation le 5 novembre ; demande des écrans et des règles d'abus distincts |
| Texte à lecture unique avec compte à rebours | **V2** | Notes sensibles ; dépend de l'écran d'ouverture |
| Salon éphémère chiffré (conversation) | **V2** (spec §39 à écrire) | Avis juridique nécessaire avant l'ouverture publique ; ne pas l'afficher avant |
| Code de vérification à 4 mots entre expéditeur et destinataire | **V2** | Utile contre l'interception, complexe à expliquer |
| Flou à la perte de focus en lecture seule | **V2**, dissuasion seulement | À présenter honnêtement : une capture reste possible (déjà écrit) |
| Compte facultatif et offre payante | **V2** (après V1) | Décisions du 5 novembre ; spec §37 et §38 |
| Notifications au créateur (« votre partage a été ouvert ») | **non** | Demanderait un canal (e-mail, push) et un identifiant : contraire à « sans compte, rien de personnel » |
| Statistiques d'envois ou compteur public | **non** | Interdit par la spec §35.1 |
| Dossiers entiers (arborescence) | **non** | Refusés par conception (spec §9.2.2) ; garder le refus avec un message clair |
| Aperçu automatique des liens (cartes Open Graph) pour `/s/…` | **non** | Fuite de métadonnées, indexation ; les messageries ne doivent rien lire du lien |
| Thème clair | **non** | Décision UI §0.2 P1 : un seul thème sombre |
| Lecture à voix haute par synthèse vocale du mot de passe | **non** | Fuite via moteurs vocaux en ligne ; la feuille visuelle suffit |

---

## Synthèse

**Top 5 bugs** : B1 lien et ouverture vides ; B2 Sécurité et Confidentialité vides ; B3 bouton de nettoyage qui ne nettoie pas ; B4 champ du mot de passe qui déborde ; B5 espace perdue dans le mot de passe affiché.

**Top 5 corrections de design** : retirer les boutons « Conversation » et « Mémo vocal » ; passer « Nettoyer » en secondaire ; réduire « Lien prêt » (Terminé principal, suppression discrète, lien de gestion replié, avertissement « jamais affiché » en haut) ; réduire la répétition de l'accueil (trois sceaux + neuf cartes) et équilibrer la grille ; popover à la place de la fenêtre modale pour le menu d'élément, et un seul en-tête de tableau.

**Top 5 écarts fonctionnels** : G1 ouverture du destinataire ; G2 gestion du créateur ; G3 nettoyage réel des métadonnées ; G4 anti-robot réel ; G5 pages Sécurité et Confidentialité (avec G8 PWA et G11 vérification de version juste après).
