# Analyse de design du site public (13 novembre 2026)

Analyse en lecture seule : aucun code modifié, aucune dépendance installée. Le site a été regardé dans Chromium (Playwright) sur la variante démo déjà construite (`web/dist-demo`, build du 13 novembre à 9 h 59, servie sous `/shhdrop/` comme GitHub Pages), en 1440 × 900 et 390 × 844, en français. Parcours joué en entier : accueil, page d'envoi, note et fichiers, scellement, « Lien prêt », ouverture, contenu, destruction, « Mes partages », pages Sécurité, Confidentialité, Offres, Signaler, 404. Captures : `/tmp/claude-0/-home-user/63934ad7-45ce-4c0b-b4ff-14d94d41fa8d/scratchpad/design/`.

Demande du propriétaire : un site plus joli, plus moderne, avec une signature propre ; de la vraie animation, « pas juste des boîtes qui bougent » ; des délimitations entre les parties de la page, avec « les petits logos en fond d'écran » ou d'autres matières cloud, web, cyber.

## 1. Verdict

Le site est propre, cohérent et sérieux, mais sa signature est rangée au mauvais endroit. Les trois plus beaux objets du produit sont **l'écran de scellement** (la capsule qui se remplit de texte chiffré, le mot « Scellé »), **le document qui part en pixels** sur l'écran « Détruit » et **le logo en trame de points**. Ils racontent exactement le produit, et personne ne les voit avant d'avoir envoyé un fichier. L'accueil, lui, montre sous le premier écran ce que montre n'importe quel gabarit de site SaaS sombre : un titre centré, trois cartes numérotées, quatre cartes à icône colorée, trois cartes de prix, un accordéon. Ces sections partagent toutes le même fond, sans aucune frontière : on défile dans une seule nappe bleu nuit.

Les « petits logos en fond » existent bien, mais ils sont presque invisibles là où ils devraient servir. Le motif (`web/src/assets/motif.svg` : cadenas, bouclier, œil barré, clé, empreinte, coffre, onde, fichier, points de la trame) est posé à 2,4 % d'opacité sur les marges latérales (`Aurora.svelte`, calque `.sides`) et à 4,5 % dans le pied de page (`AppShell.svelte`, `.foot::after`). On ne le distingue qu'au pied de page. Il ne sépare aucune section.

Côté mouvement, le reproche du propriétaire est juste pour l'accueil : hors de l'infographie du héros, tout ce qui bouge au défilement est la même montée de 28 px avec fondu, appliquée à vingt éléments. Les animations qui racontent le produit existent, mais dans le parcours d'envoi.

### Les cinq changements qui rapportent le plus

1. **Poser de vraies coutures entre les sections de l'accueil**, chacune étant une bande dédiée de 96 à 140 px sans texte : une bande de texte chiffré, une bande de pictogrammes du motif, une ligne de trame qui se défait. C'est la demande la plus explicite et la moins chère. Effort M.
2. **Remplacer les trois cartes de « Comment ça marche » par les vrais objets du produit** : la capsule qui se scelle, le lien et le mot de passe qui partent par deux chemins, le document qui se dissout, pilotés par le défilement. Effort L.
3. **Faire du logo en trame la matière de toute la page** : le titre « puis plus rien. » dont les lettres se défont en points, les fins de section qui se dissolvent, au lieu de la grille de croix générique. Effort M.
4. **Ramener les couleurs à une règle simple** : aujourd'hui trois couleurs de bouton principal (blanc, bleu, menthe) et quatre teintes de tuiles d'icône. Une seule couleur d'action, la menthe réservée au « scellé ». Effort S.
5. **Soigner les écrans calmes** : pages Sécurité, Offres, Confidentialité (colonne étroite collée à gauche, moitié droite de l'écran vide), écrans « Détruit », « Lien prêt » et ouverture (contenu flottant sans ancrage). Effort M.

## 2. Ce qui existe : état des lieux

### 2.1 Les « petits logos en fond »

| Endroit | Fichier | État |
|---|---|---|
| Marges latérales de toutes les pages | `web/src/ui/Aurora.svelte`, `.sides` | Opacité 0,024 (0,014 sur téléphone), masqué sur les 800 px du centre. Pratiquement invisible : il faut le savoir pour le voir. Le commentaire du code dit pourquoi : à 0,028 le plafond de luminance K5 est dépassé. |
| Pied de page | `web/src/ui/AppShell.svelte`, `.foot::after` | Opacité 0,045, fondu vers le haut. C'est le seul endroit où on le voit vraiment, et il est joli. |
| Entre les sections de l'accueil | — | Absent. |
| Pages d'information, écrans de fin | — | Absent (hors marges). |

Le motif est un fichier SVG statique de 1,5 Ko, servi par le site : conforme à la CSP (ni `data:`, ni style en ligne). Il mélange quatorze pictogrammes dessinés à part, avec un trait de 1,4 px, alors que le jeu d'icônes de l'interface est à 1,75 px sur une grille de 24. À faible opacité cela ne se voit pas ; agrandi dans une bande de séparation, l'écart se verrait.

### 2.2 Les autres matières de fond

- **Nuit et aurore** (`Aurora.svelte`) : dégradé bleu nuit, trois nappes floues qui dérivent en 46 à 64 s. Bien fait, discret, peu coûteux (trois images de 128 px en `transform`).
- **La trame de croix** (`.trame`) : croix de 9 px tous les 32 px. La spec (§25) la présente comme « la signature de Shhgone, comme les points du logo ». Or ce sont des croix, pas des points, et une grille de petites croix sur fond sombre est le fond le plus répandu des sites techniques de 2024 à 2026. Ce n'est pas une signature.
- **Grain** : fixe, 3,5 %. Bien.
- **Guilloché et rosaces** (`ui/decor.ts`, `guilloche`, `rosette`) : plus utilisés nulle part depuis la refonte du 12 novembre, seuls les tests les appellent. Code mort.

### 2.3 Les animations

| Animation | Où | Raconte le produit ? |
|---|---|---|
| Infographie en sept étapes avec journal (`SecureDemo.svelte`) | Héros | Oui. C'est le meilleur élément de l'accueil. |
| Capsule qui se remplit de texte chiffré, noms qui se brouillent, « Scellé » (`SealCapsule.svelte`, `seal.css`) | Envoi | Oui. C'est la signature du produit. |
| Document qui part en pixels, logo qui s'efface (`DestroyedArt.svelte`) | « Détruit » | Oui, mais l'illustration fait 100 px dans un écran vide. |
| Lumière qui tourne autour de la carte de dépôt (`Vessel.svelte`, `orbit`) | Accueil, envoi | À moitié : c'est le trait du logo, mais on le lit comme un simple liseré lumineux. |
| Titre mot par mot | Héros | Non : entrée standard. |
| Bande d'engagements qui défile (`PromiseBand.svelte`) | Sous le héros | Non : c'est le bandeau défilant de tous les sites. Les textes sont vrais et utiles, la forme est banale. |
| Révélation au défilement (`base.css`, `rv-in`, 20 éléments) | Sections | Non : boîtes qui montent. |
| Cartes qui se soulèvent de 3 px au survol, aimant des tuiles | Sections | Non. |
| Aurore | Partout | Ambiance, neutre. |

En mouvement réduit, aucune animation ne tourne (mesuré : zéro animation active) et l'infographie devient un storyboard : c'est correct.

## 3. Critique écran par écran

### 3.1 Accueil, premier écran

Bon. Le titre est fort, « puis plus rien. » en menthe porte la promesse, l'infographie à droite est originale et honnête. Trois réserves.

- La hiérarchie des boutons se contredit : « Choisir des fichiers » est blanc, « Partager » de la barre est bleu vif et pulse d'une ombre bleue, et plus bas l'action est menthe. L'œil ne sait pas quelle couleur veut dire « agir ».
- L'infographie laisse un grand vide au milieu (entre les trois appareils et le journal) pendant les premières étapes, et les lignes du journal sont en 12 px gris : sur un écran de 1440 px, elle paraît plus petite que le titre ne le mérite.
- Sur téléphone, l'infographie arrive coupée en bas du premier écran et fait 520 px de haut : deux écrans de défilement avant d'atteindre la carte de dépôt.

### 3.2 Accueil, sous le pli

C'est la partie faible, et celle que vise la demande.

- **Aucune délimitation.** Les sections « Comment ça marche », « Pensé pour la confidentialité », « Offres » et « Vos questions » ont un fond transparent, aucune bordure, aucun changement de matière. Seuls 96 px de vide les séparent. La bande d'engagements est la seule coupure de la page.
- **Rythme monotone.** Quatre fois de suite : titre centré de 48 px, phrase centrée grise, rangée de cartes arrondies de même fond. Aucune section n'a une forme à elle.
- **Gabarit générique.** Trois cartes numérotées « 1, 2, 3 » avec tuile d'icône, puis quatre cartes icône, titre, texte, avec quatre teintes (menthe, bleu, cyan, ambre). C'est précisément ce que la spec refusait dans son monde visuel (§2 : « les cartes identiques icône + titre + texte comme structure de page », « les numéros de section décoratifs »). Voir le signalement C1.
- **Texte pauvre dans les cartes.** « Scellez : vous recevez un lien unique et un mot de passe. » La carte fait 200 px de haut pour une ligne. Le vide n'est pas habité.
- **Trou avant le pied de page.** La section des questions garde 140 px de marge en bas, puis le pied de page ajoute la sienne : environ 230 px de rien à 1440 px.
- **La ligne sur la clé** (« La clé du lien est après le # ») est l'argument le plus fort du produit et elle est traitée comme une note de bas de section, en gris, sous les cartes.

### 3.3 Page d'envoi

Dense et fonctionnelle. Le titre répété en haut, les trois assurances et le bouton « Salon bientôt » chargent la première ligne. Le bloc « Offres » (trois cartes Gratuit, Plus, Pro) placé juste au-dessus de « Chiffrer et envoyer » concurrence l'action principale, et sur téléphone il passe avant « Votre envoi » : l'utilisateur voit des offres « bientôt » avant ses propres fichiers. Ce placement est une décision du 12 novembre (§24) ; voir le signalement C5.

### 3.4 Scellement

Le meilleur écran du site. La capsule, le texte chiffré en filigrane, les noms brouillés, le grand « Scellé » menthe : c'est reconnaissable sans logo. Deux remarques : la liste d'étapes à droite répète trois fois la même information (« Scellé », trois coches vertes, quatre coches grises) ; et l'écran passe en moins d'une seconde quand l'envoi est rapide, si bien que le plus beau moment est le moins vu.

### 3.5 « Lien prêt », ouverture, contenu

Corrects, lisibles, mais plats. « Lien prêt » empile cinq cadres arrondis de même poids. L'écran d'ouverture a une belle capsule menthe en tête, puis un formulaire aligné à gauche dans une colonne centrée : la capsule fait 728 px, le champ 520 px, l'avertissement 520 px, rien ne s'aligne à droite. Le contenu est sobre et c'est bien : là, l'utilisateur travaille.

### 3.6 « Détruit »

L'idée est excellente (le document se défait en pixels, le logo s'efface) et l'exécution est timide : l'illustration fait 100 px, collée à gauche, dans un écran aux trois quarts vide. C'est le moment « puis plus rien », celui que le nom du produit promet : il mérite la largeur de l'écran.

### 3.7 Pages Sécurité, Confidentialité, Offres, Signaler

Une colonne de 430 à 670 px collée à gauche d'un cadre de 1 240 px : la moitié droite de l'écran est vide sur toute la hauteur. Sur la page Sécurité (3 100 px de haut), aucun repère visuel, aucun schéma, aucun sommaire. Le contenu est bon et honnête ; la mise en page fait document brut. La page Offres aligne ses cartes de prix à gauche de la même façon.

### 3.8 Typographie, couleur, profondeur, pictogrammes

- **Typographie** : Mona Sans large et serrée pour les titres, JetBrains Mono pour le technique. C'est un vrai choix, bien tenu. Seul écart : les titres de section à 48 px ont tous le même poids que le titre du héros, en plus petit ; rien ne hiérarchise les sections entre elles.
- **Couleur** : la menthe sur bleu nuit fonctionne. Mais la règle « menthe = scellé, sûr » (§20.10) n'est plus tenue : la menthe sert au bouton « Chiffrer et envoyer », à « Partager », à « Tout télécharger », aux liens, aux pastilles « bientôt ». S'y ajoutent le bleu vif des boutons de la barre, le bleu ciel de Plus, le bleu profond de Pro, l'ambre du Salon, neuf couleurs de format de fichier.
- **Profondeur** : cartes à dégradé léger et filet intérieur, ombres décalées. Propre, mais chaque surface a le même traitement, donc aucune ne ressort.
- **Pictogrammes** : le jeu d'interface est cohérent (trait 1,75, maison). Le motif de fond est un second jeu, plus fin. L'infographie en a un troisième (le personnage à capuche, plein et arrondi). Trois styles de dessin sur une page.

## 4. Trois directions de signature

Les trois gardent le monde « Nuit chiffrée », la menthe, les polices, la CSP et l'absence de bibliothèque. Elles diffèrent par l'idée qui organise la page.

### Direction A — « La trame » : tout se défait en points

**Idée.** Le logo écrit « shh » en plein et « gone » en points. La page fait pareil : ce qui est présent est plein, ce qui disparaît passe en trame de points puis s'éteint.

**Ce que ça change.**
- Le fond de croix devient une trame de points (même calque, même technique CSS).
- Chaque section se termine par une bande où la trame se densifie puis se dissout, comme le bord droit du logo. Les sections ont enfin une fin visible.
- « puis plus rien. » dans le titre se défait en points une fois, à l'arrivée ou au premier défilement.
- L'écran « Détruit » passe en pleine largeur avec la même dissolution.
- Le motif de pictogrammes n'apparaît que dans les bandes de couture, redessiné en points.

**Pour.** La plus cohérente avec le nom, le logo et la décision §25 (« les points du logo déclinés partout »). La moins chère : presque tout est en CSS. **Contre.** Sobre : c'est la direction la moins spectaculaire.

### Direction B — « Le chiffré » : le texte illisible comme matière

**Idée.** Ce que le serveur reçoit, du texte illisible, devient la matière décorative du site. Tout ce qui est lisible est à l'utilisateur, tout ce qui est décor est du chiffré.

**Ce que ça change.**
- Les coutures entre sections sont des bandes de texte chiffré décoratif en JetBrains Mono (celui de la capsule de scellement, `cipherText` de `ui/decor.ts`), qui glissent lentement, avec une ligne de scellement menthe.
- Les titres de section arrivent brouillés et se déchiffrent en 600 ms quand ils entrent à l'écran (`scramble` existe déjà).
- « Comment ça marche » devient une seule grande scène : à gauche le texte en clair, au milieu la ligne de scellement, à droite le chiffré ; le défilement déplace la ligne.
- Le pied de page et les pages d'information reçoivent un filigrane de chiffré dans la moitié vide.

**Pour.** Très reconnaissable, très « cyber » sans cliché (ni cadenas 3D, ni pluie verte), et honnête puisque la capsule de scellement utilise déjà cette matière. **Contre.** Risque de fatigue si le texte bouge partout : il faut le réserver aux coutures et à une scène. Le texte décoratif doit rester tiré du générateur à graine fixe, jamais de données réelles (règle S1 de la spec, à conserver telle quelle).

### Direction C — « Le trajet » : une ligne qui traverse la page

**Idée.** Une ligne fine part de la carte de dépôt et descend toute la page : elle passe par l'appareil, le sceau, le serveur opaque, le destinataire, puis s'efface avant le pied de page. Chaque section est une station.

**Ce que ça change.**
- Un tracé SVG vertical, dessiné au défilement, relie les sections. Aux coutures, il traverse une bande (maillage de nœuds, petits paquets qui voyagent).
- « Comment ça marche » perd ses cartes : trois stations sur la ligne, chacune avec son objet (capsule ouverte, capsule scellée, capsule qui se défait).
- La clé (« # ») suit un second tracé en pointillés qui contourne la station « serveur » : l'argument le plus fort du produit devient visible.
- Le motif de pictogrammes sert de « paysage » autour de la ligne, plus dense aux coutures.

**Pour.** Raconte le produit de haut en bas, donne une raison de défiler. **Contre.** La plus chère. Elle reprend en partie ce que la refonte du 12 novembre a retiré (fil menthe entre les étapes, schéma du trajet, §20.11) : voir le signalement C2. Elle se dégrade moins bien sur téléphone, où la ligne se réduit à un filet au bord gauche.

### Recommandation

Prendre **A comme base** et lui ajouter **les coutures de B**. A donne une règle simple qui tient partout, y compris dans les futures apps (un motif de points se redessine dans Flutter sans rien de propre au navigateur) ; les bandes de chiffré de B donnent la matière « cyber » demandée. Garder C en réserve pour la seule section « Comment ça marche ».

## 5. Séparateurs de section : propositions précises

Principe commun : une couture est un élément à part, `aria-hidden`, de 96 à 140 px de haut, pleine largeur, **sans aucun texte lisible posé dessus**. C'est ce qui permet de la rendre bien plus visible que le motif actuel : le plafond de luminance K5 protège le texte, et une bande sans texte n'a pas à s'y plier (voir le signalement C3). Un composant unique `web/src/ui/Seam.svelte` avec une variante par couture. Toutes les variantes sont retirées en contraste renforcé ou forcé, immobiles en mouvement réduit, et animées seulement à l'écran (même `IntersectionObserver` que les boucles existantes).

| # | Couture | Réalisation | Où | Coût |
|---|---|---|---|---|
| S1 | **Bande de pictogrammes** : le motif existant sur une ou deux rangées, à 12 à 18 % d'opacité, fondu aux deux bords, avec un pictogramme sur douze en menthe | `background: url(motif-bande.svg)` (fichier statique) et `mask-image` en dégradé. Redessiner le motif sur la grille 24 et le trait 1,75 du jeu d'icônes. | Entre le héros et la carte de dépôt ; pied de page | S |
| S2 | **Bande de chiffré** : trois ou quatre lignes de texte illisible en JetBrains Mono, qui glissent en sens opposés, traversées par un filet menthe | Texte produit par `cipherText` (graine fixe) dans des `<span>`, déplacés en `transform` ; 60 à 90 s par boucle | Entre « Comment ça marche » et « Pensé pour la confidentialité » | S |
| S3 | **Dissolution en trame** : le bas de la section passe en points de plus en plus espacés, puis rien | Deux `radial-gradient` répétés et un `mask-image` en dégradé ; aucune image | Fin de chaque section, et surtout avant le pied de page | S |
| S4 | **Ligne de scellement** : un filet menthe horizontal avec, au milieu, l'encoche de la capsule et un petit cadenas ; à gauche des points en désordre, à droite des points alignés | SVG en ligne dans le gabarit Svelte (attributs de présentation, pas d'attribut `style`) ; le filet se trace une fois à l'entrée | Entre la carte de dépôt et « Comment ça marche » | S |
| S5 | **Maillage** : douze à vingt nœuds reliés par des filets, deux ou trois « paquets » qui voyagent d'un nœud à l'autre et s'éteignent en arrivant | SVG en ligne ; paquets animés par `offset-path` ou `transform` en CSS | Entre « Pensé pour la confidentialité » et « Offres » | M |
| S6 | **Lignes de circuit** : filets à angles droits qui partent du bord et aboutissent à des pastilles, tracés au défilement | SVG en ligne, `stroke-dashoffset` piloté par `animation-timeline: view()`, repli statique ailleurs | Variante de S5 | M |
| S7 | **Grain et changement de nuit** : la section suivante a un fond un cran plus clair ou plus sombre, bord supérieur en biais ou en courbe, grain renforcé sur 80 px | `clip-path` ou dégradé ; `grain.png` existe déjà | Sections « Offres » et « Vos questions » | S |
| S8 | **Vague de paquets** : une rangée de petits rectangles (les blocs chiffrés) dont la hauteur ondule lentement | Douze à vingt-quatre `<i>` en `transform: scaleY()`, délais décalés | Avant « Vos questions » | S |

Assemblage conseillé pour l'accueil, du haut vers le bas : S1 sous le héros (les petits logos, enfin visibles), S4 sous la carte de dépôt, S2 après « Comment ça marche », S7 pour donner un fond propre à « Offres », S3 avant le pied de page. Cinq coutures, cinq matières, une seule famille. Ne pas en mettre plus : huit effets différents sur une page feraient démonstration.

## 6. Animations qui racontent le produit

Chaque idée dit ce qu'elle montre, comment elle se fait dans la CSP du site, son coût et son repli.

| # | Idée | Ce qu'elle raconte | Réalisation | Coût CPU et batterie | Mouvement réduit |
|---|---|---|---|---|---|
| M1 | **« puis plus rien. » se défait** : les lettres passent en points puis se rallument, une fois | La disparition, dans le titre même | Deux couches superposées (texte plein, même texte masqué par une trame de points) et un `mask-position` ou une opacité animés ; une seule fois, 900 ms | Négligeable | Texte plein, fixe |
| M2 | **Titres de section qui se déchiffrent** | Le chiffrement | `scramble` de `ui/decor.ts` déjà écrit ; 600 ms, une fois, déclenché par l'observateur existant ; le vrai texte reste dans un `sr-only` (règle K8) | Faible : douze mises à jour de texte | Texte net d'emblée |
| M3 | **La capsule se scelle au défilement** dans « Comment ça marche » : ouverte à l'étape 1, le trait se referme et le contenu se brouille à l'étape 2, la capsule part en points à l'étape 3 | Les trois gestes, avec le vrai objet | Réemployer `SealCapsule` en mode décoratif ; progression pilotée par `animation-timeline: view()`, repli par observateur à trois états | Faible : `transform`, `opacity`, `stroke-dashoffset` sur un petit SVG | Trois images fixes |
| M4 | **Deux chemins** : le lien part par un tracé, le mot de passe par un autre, et la clé contourne le serveur | « Envoyez le lien par un moyen, le mot de passe par un autre », et « la clé ne passe jamais par le serveur » | SVG en ligne, deux `path` tracés en `stroke-dashoffset` | Faible | Tracés complets, fixes |
| M5 | **Le lien qui se consume** : un lien d'exemple en chasse fixe dont les caractères s'éteignent de droite à gauche à mesure qu'un compte d'ouvertures passe de 1 à 0 | L'autodestruction | Un `<span>` par caractère, opacité décalée par `--i` (classe et propriété posées par CSSOM) ; boucle de 8 s, à l'écran seulement | Faible | Lien à moitié éteint, fixe |
| M6 | **Le cadenas qui se scelle** sur le bouton principal : l'anse descend au survol et au focus | Le sceau | Existait dans l'appel final retiré le 12 novembre ; à remettre sur « Chiffrer et envoyer » | Nul | Aucun |
| M7 | **« Détruit » en grand** : l'illustration actuelle à 320 px, centrée, la poussière qui dérive sur la largeur | « puis plus rien » | Agrandir `DestroyedArt` ; rien de nouveau à écrire | Inchangé (borné à 1,6 s) | Fondu de 240 ms, comme aujourd'hui |
| M8 | **Compte à rebours sur le contour de la capsule** : le trait menthe se raccourcit avec le temps restant | L'échéance | Déjà prévu au benchmark (signature 3) et `TimeRim.svelte` existe | Nul : une mise à jour par minute | État fixe |

À ne pas faire : pluie de caractères façon film, globe ou carte du monde avec des arcs, compteur de « fichiers envoyés aujourd'hui » (la spec §25 l'interdit à raison : un faux serait un mensonge, un vrai serait une fuite), cadenas en 3D, particules en fond plein écran, effet de parallaxe à la souris sur toute la page.

## 7. Liste priorisée des changements

| # | Endroit | Problème | Correction | Effort | Gain |
|---|---|---|---|---|---|
| P1 | `web/src/routes/home/Sections.svelte`, nouveau `web/src/ui/Seam.svelte` | Aucune délimitation entre sections | Cinq coutures (§5 : S1, S4, S2, S7, S3) | M | Très fort : répond à la demande, change la page entière |
| P2 | `Sections.svelte`, section `how` | Trois cartes numérotées génériques, une ligne de texte chacune | Scène unique M3 avec la capsule, textes en regard | L | Très fort : la signature du produit monte sur l'accueil |
| P3 | `web/src/ui/Aurora.svelte` (`.trame`), `Home.svelte` (titre) | Grille de croix générique présentée comme signature | Trame de points ; M1 sur « puis plus rien. » | M | Fort |
| P4 | `web/src/ui/tokens.css`, `Button.svelte`, `TopNav.svelte`, `Home.svelte` | Trois couleurs de bouton principal ; menthe partout | Une couleur d'action unique ; menthe réservée au scellé et au vérifié (décision à prendre, voir C4) | S | Fort : la page se lit mieux d'un coup |
| P5 | `web/src/routes/InfoPage.svelte`, `Offres.svelte` | Colonne à gauche, moitié droite vide | Colonne centrée à 68 caractères avec sommaire collant à droite au-dessus de 1 100 px ; un schéma (M4) en tête de la page Sécurité | M | Fort sur la crédibilité |
| P6 | `web/src/ui/GoneScreen.svelte`, `DestroyedArt.svelte`, `StatusPage.svelte` | Illustration de 100 px dans un écran vide | Centrer, agrandir à 280 à 320 px (M7) | S | Fort : c'est la promesse du nom |
| P7 | `Sections.svelte`, section `priv` | Quatre cartes à quatre couleurs ; la phrase sur la clé reléguée en note | Mettre la phrase sur la clé en tête, en grand, avec le lien d'exemple dont la partie après « # » est surlignée (M4 ou M5) ; les quatre points en liste sobre, une seule teinte | M | Fort |
| P8 | `web/src/assets/motif.svg` | Trait 1,4 px, dessins hors du jeu d'icônes | Redessiner sur la grille 24, trait 1,75, à partir des tracés de `ui/icons/glyphs.ts` ; une version « bande » plus dense | S | Moyen, nécessaire à S1 |
| P9 | `web/src/ui/PromiseBand.svelte` | Bandeau défilant banal | Le fondre dans la couture S1, ou l'arrêter : six engagements fixes sur deux lignes se lisent mieux qu'un texte qui file | S | Moyen |
| P10 | `web/src/ui/SecureDemo.svelte` | Vide au centre, journal en 12 px | Remonter le journal, passer ses lignes à 13 ou 14 px, réduire la hauteur sur téléphone (520 px aujourd'hui) | S | Moyen |
| P11 | `web/src/routes/home/Faq.svelte`, `AppShell.svelte` | 230 px vides avant le pied de page | Marge basse de 140 à 64 px, couture S3 à la place | S | Moyen |
| P12 | `web/src/routes/Ready.svelte`, `Open.svelte` | Cadres de même poids, largeurs désaccordées (728, 520, 520 px) | Une seule largeur de colonne ; le lien et le mot de passe dans un seul cadre à deux lignes | S | Moyen |
| P13 | `web/src/routes/Sealing.svelte` | Trois listes de coches qui se répètent | Garder la liste d'étapes, retirer la rangée « Chiffré sur cet appareil, Envoyé, Scellé » | S | Faible |
| P14 | `web/src/ui/decor.ts` | `guilloche` et `rosette` inutilisés | Les retirer avec leurs tests, ou s'en resservir pour S6 | S | Propreté |
| P15 | `Sections.svelte` `.num`, `SecureDemo.svelte` légende | Contraste insuffisant (voir §8) | Éclaircir | S | Accessibilité |

Ordre conseillé : P4 et P6 d'abord (une journée, effet immédiat), puis P8, P1 et P11 (les coutures), puis P3, P7, P2 (la signature), puis P5 et le reste.

## 8. Accessibilité

- **Contraste des numéros d'étape** (`Sections.svelte`, `.num`) : gravité faible. `rgb(150 175 255 / 0.55)` sur le fond de carte donne environ 3,5:1 pour un texte de 13 px, sous le seuil de 4,5:1. L'ordre est porté par la liste `<ol>`, donc rien n'est perdu pour un lecteur d'écran, mais le chiffre est illisible pour un malvoyant. Correction : opacité 0,8, ou retirer le numéro (C1).
- **Légendes en chasse fixe du héros** (« Fig. 01 », lignes passées du journal) : petites (12 px) et grises. À mesurer avec `ui/contrast.ts` et à remonter à 4,5:1.
- **Mouvement** : le site respecte `prefers-reduced-motion` (zéro animation active mesurée), les boucles ont un bouton pause (WCAG 2.2.2). Toute animation ajoutée doit suivre la même règle : boucle de plus de 5 s = pause visible ou arrêt hors survol, et image fixe « parlante » en mouvement réduit. Les coutures animées (S2, S5, S8) comptent dans cette règle : les garder sous 5 s de mouvement par entrée à l'écran, ou les rattacher au bouton pause existant.
- **Texte brouillé puis déchiffré (M2, M5)** : couche animée en `aria-hidden`, texte réel dans un `sr-only`, comme le titre du héros (règle K8 et K9).
- **Focus** : anneau menthe de 2 px présent sur les contrôles vus. Rien à signaler sur les captures ; non testé au clavier dans cette analyse.
- **Contraste forcé et renforcé** : toute couture doit s'ajouter à la liste des éléments retirés (`Aurora.svelte` donne le modèle).
- **Contenu révélé au défilement** : dans les navigateurs qui gèrent `animation-timeline: view()`, les sections sont à opacité nulle tant qu'elles ne sont pas entrées à l'écran. Conséquence observée : une capture pleine page montre un accueil vide sous la carte de dépôt (`accueil-1440-full.png`). Gravité faible : cela touche l'impression, les captures pleine page et certains aperçus. Correction : `@media print { animation: none }`, et partir d'une opacité de 0,4 au lieu de 0.

## 9. Performance

- **Poids actuel** (build de production, compressé Brotli) : JS 172 Ko, CSS 28 Ko, moteur wasm 142 Ko, deux polices 138 Ko. Le CSS brut fait 192 Ko : il contient tous les écrans. Les ajouts proposés pèsent peu (coutures : moins de 3 Ko de CSS et un SVG de 2 Ko ; M1 à M5 : moins de 2 Ko de JS, sans bibliothèque).
- **LCP** : 268 ms en local, élément = le titre `h1`. Le titre ne part pas d'une opacité nulle, c'est bien. M1 ne doit pas changer cela : la couche pleine du titre reste peinte dès la première image, la trame vient par-dessus.
- **Boucles** : à l'arrivée sur l'accueil, sept animations infinies tournent (trois nappes, curseur, bandeau, deux orbites). Toutes en `transform` ou `opacity`. Chaque couture animée en ajoute une : rester sous dix boucles actives à l'écran, et les arrêter hors écran (c'est déjà la règle §20.6).
- **À éviter** : `feTurbulence` animé, `backdrop-filter` sur une bande pleine largeur, `filter: blur()` animé sur un grand élément, canvas plein écran. Un grain ou un bruit se fait avec `grain.png`, déjà là.
- **DOM** : 748 nœuds sur l'accueil. Une bande de chiffré en `<span>` par ligne (pas par caractère) reste négligeable ; M5 en `<span>` par caractère se limite à un lien de 60 caractères.

## 10. Ce que la CSP autorise, et les idées à écarter

CSP réelle, lue dans `server/internal/api/headers.go` : `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob:; … require-trusted-types-for 'script'; trusted-types svelte-trusted-html shhdrop`. La démo applique la même par balise `meta`.

Point à garder en tête : **l'accueil est aussi la page qui reçoit les liens** (un partage s'ouvre sur `/#clé`). Tout le site est une seule application sur une seule origine ; il n'existe pas de page « vitrine » séparée des pages qui détiennent des clés. Donc tout décor doit rester du code maison, statique, sans dépendance, et les composants décoratifs ne doivent être montés que par l'accueil, jamais par les écrans d'ouverture, de contenu ou de « Lien prêt ».

| Technique | Verdict |
|---|---|
| CSS dans les fichiers du site, `@keyframes`, `@property`, `animation-timeline`, `mask-image` en dégradé | Autorisé |
| SVG en ligne dans les gabarits Svelte, avec attributs de présentation (`fill`, `stroke`, `opacity`) | Autorisé |
| Fichier SVG ou PNG du site en `background` ou `mask-image` | Autorisé (`img-src 'self'`) |
| Propriétés posées par CSSOM (`el.style.setProperty`, directive `style:` de Svelte) et Web Animations API | Autorisé : c'est déjà la pratique (`ui/attach.ts`, `Aurora.svelte`) |
| Canvas 2D | Autorisé ; exporter en `blob:`, jamais en `data:` |
| Attribut `style="…"` écrit dans le HTML, balise `<style>` en ligne | **Interdit** (`style-src 'self'`) |
| Image, masque ou bruit en `url(data:…)` | **Interdit** : c'est pourquoi beaucoup de recettes de « grain SVG » trouvées en ligne ne marcheront pas telles quelles |
| `innerHTML` pour fabriquer un SVG | **Bloqué** par Trusted Types : construire par le gabarit ou `createElementNS` |
| Bibliothèque d'animation (GSAP, Motion, Lottie, three.js) | **Écartée** par la spec UI §7.6 et par la règle de simplicité : c'est du code tiers sur la page qui détient la clé du lien. Rien de ce qui est proposé ici n'en a besoin |
| Police d'icônes ou police décorative de plus | Écartée : poids, et la spec fixe deux familles |
| Animation SVG par `<animate>` (SMIL) | Autorisée par la CSP, mais à éviter : elle ignore `prefers-reduced-motion` et la pause hors écran sans code de plus |
| Worklet de peinture CSS (Houdini) | Autorisé seulement depuis un fichier du site, et Chromium seul : à écarter |
| WebGL pour un fond | Permis par la CSP, mais contraire au budget (§20.6) et à la simplicité : à écarter |

## 11. Signalements : contradictions avec des décisions validées

Rien de ce qui suit n'a été corrigé. Chaque point demande une décision du propriétaire.

**C1 — La structure actuelle de l'accueil contredit le monde visuel de la spec.** Gravité : moyenne (cohérence, et c'est la cause du « générique »). Endroit : spec UI §2 (« Ce que le monde refuse ») contre §25 et `routes/home/Sections.svelte`. Problème : §2 refuse « les cartes identiques icône + titre + texte comme structure de page », « les numéros de section décoratifs » et « les étiquettes au-dessus des titres » ; la refonte du 12 novembre a introduit les trois (cartes à tuile d'icône, « 1, 2, 3 », sur-titre du héros). §25 dit remplacer ce qui le contredit, mais ne cite pas §2. Correction : soit amender §2 pour autoriser ces formes, soit appliquer P2 et P7, qui reviennent à §2. Je recommande la seconde.

**C2 — La demande du 13 novembre réintroduit ce que la refonte du 12 novembre a retiré.** Gravité : moyenne (risque d'aller-retour). Endroit : §20.11 (6 novembre : « des sections séparées, chacune avec son fond », `SectionBg.svelte`, fil menthe, schéma du trajet) puis §25 (12 novembre : « plus épurée », ces éléments retirés). Problème : demander aujourd'hui des délimitations revient vers §20.11. Correction proposée : ne pas restaurer les fonds de section pleine hauteur, mais poser des coutures étroites entre des sections qui restent épurées (§5). Cela sert les deux demandes. À faire valider avant de coder, et à écrire comme §26 de la spec.

**C3 — Le plafond de luminance K5 empêche de rendre le motif visible, tel qu'il est posé.** Gravité : moyenne. Endroit : spec §20.2 K5, `Aurora.svelte` `.sides` (opacité 0,024, « 0,028 dépasse »). Problème : le motif est placé derrière le contenu, donc soumis au plafond qui protège le texte ; il ne peut pas être plus visible à cet endroit. Correction : le sortir de derrière le texte et le mettre dans des bandes sans texte. À écrire dans la spec : « K5 s'applique aux fonds sur lesquels du texte peut se trouver ; une couture `aria-hidden` sans texte n'y est pas soumise ». Le test `ui-e2e/home.spec.ts` masque `main` avant de mesurer : des coutures placées dans `main` ne le feront pas échouer, mais il faut un test propre qui vérifie qu'aucun texte ne chevauche une couture.

**C4 — Trois règles de couleur d'action se superposent.** Gravité : moyenne. Endroit : §20.10 (« menthe réservée au signe scellé, sûr ; actions principales en `--paper` sur `--ink` »), §25 (« bleu vif `--sig-blue` pour les boutons pleins »), et le code (`Chiffrer et envoyer`, `Partager` de « Lien prêt », `Tout télécharger` en menthe). Problème : trois couleurs pour la même fonction, visibles sur un même parcours. Correction : choisir. Proposition : blanc pour l'action principale partout, bleu retiré des boutons (il reste la couleur de Pro), menthe pour l'état scellé et le seul bouton « Chiffrer et envoyer », qui est l'acte de sceller.

**C5 — Les offres « bientôt » passent avant l'envoi de l'utilisateur sur téléphone.** Gravité : faible (design). Endroit : §24, `ui/OffersStrip.svelte`, page d'envoi à 390 px. Problème : trois cartes Gratuit, Plus, Pro occupent le haut de l'écran avant « Votre envoi », et deux sur trois ne sont pas disponibles. Correction : sur téléphone, une ligne repliée sous la liste. Décision du propriétaire du 12 novembre : à ne changer qu'avec son accord.

**C6 — Révélations au défilement : la spec se contredit.** Gravité : faible. Endroit : §7.1 point 3 (« jamais d'apparition au défilement ») contre §20.10 (« Révélations au défilement »). Correction : amender §7.1 pour renvoyer à §20.10, et y fixer la limite (une révélation par section, pas par carte).

**C7 — Règles à conserver telles quelles dans tout ce qui est proposé.** Texte chiffré décoratif tiré d'un générateur à graine fixe, jamais de `crypto`, de la clé ni d'un tampon réel (S1) ; aucun nom d'algorithme à l'écran (§20.8), donc pas de « AES-256 » dans une bande décorative ; aucune fausse activité en direct (§25) ; aucune animation avant la réalité (§7.1) : les scènes de l'accueil sont des illustrations et doivent être légendées comme telles, comme le fait déjà la capsule (« Voici, en image… »).

**C8 — Apps natives (CLAUDE.md).** Les coutures, la trame de points et les tracés proposés sont de la géométrie simple (points, lignes, masques en dégradé) : ils se redessinent tels quels dans Flutter. `animation-timeline: view()` et les masques CSS sont propres au navigateur ; dans les apps, la même idée se fera avec les outils natifs. Aucun format, lien ou choix de chiffrement n'est touché.

## 12. Ce qui manque et dont on n'a pas parlé

- **Aucune image de partage** (`og:image`) : décision de la spec (§12.5, « aucune balise `og:*` »). Un lien vers l'accueil collé dans une messagerie n'a donc ni image ni titre soigné. Pour un site qui veut « donner envie », c'est un manque ; pour les liens de partage (`/#clé`), c'est une protection. À trancher : autoriser les balises sur les seules pages publiques sans fragment n'est pas possible (même `index.html`), donc le statu quo est probablement le bon choix. Je le signale pour que ce soit une décision connue.
- **Mentions légales et conditions** encore en squelette (« En cours de rédaction ») : déjà signalé comme bloquant légal avant mise en ligne (§22). Un site « pro » ne peut pas sortir avec ces pages vides.
- **Pas de fichier `DESIGN.md`** qui fixe la signature en une page (prévu en Task 28 de l'audit du 7 novembre). Quatre refontes de l'accueil en neuf jours (§9.1, §20.10, §20.11, §25) : sans ce document, la cinquième effacera encore des choses réussies. À écrire avant de coder la direction choisie.
- **Version anglaise** non regardée ici ; le titre et les coutures de texte devront y être vérifiés.

## 13. Limites de cette analyse

- Site vu sur la variante démo (faux serveur dans la page), pas sur le build de production avec le serveur Go. La démo affiche un bandeau ambre en haut et retire « Hébergé en Europe » du sur-titre ; le reste du rendu est le même code.
- `dist-demo` date de 9 h 59 ; un fichier source non visuel (`src/app/link.ts`) a changé depuis. Je n'ai pas reconstruit.
- Chromium seul. Safari et Firefox non vus (les révélations y passent par le repli à observateur).
- Français seul ; anglais non vu.
- Le scellement dure moins d'une seconde en démo : je l'ai vu fini (« Scellé »), pas en cours de progression. La dissolution a été vue image par image.
- Non vus : page de gestion (`#m…`), enregistreur vocal, capture photo, visionneuses, feuille QR, cadre PDF, salon (non ouvert), contraste forcé, zoom 200 %, navigation au clavier.
- Une fois, l'écran de scellement est apparu avec la capsule coupée sous la barre du haut parce que la page d'envoi avait été défilée avant le clic (`flux-scellement-00-1440.png`). Je n'ai pas réussi à le reproduire dans un second essai : à vérifier (remise en haut de page au changement d'étape dans `SendFlow.svelte`).
- Contrastes estimés par calcul sur les valeurs du code, pas mesurés par l'outil du dépôt. Aucune mesure de fluidité sur téléphone réel.

## 14. Captures les plus parlantes

Toutes dans `/tmp/claude-0/-home-user/63934ad7-45ce-4c0b-b4ff-14d94d41fa8d/scratchpad/design/` (dossier temporaire de la session).

- `accueil-1440-pli.png` : le premier écran, la partie réussie.
- `accueil-1440-seg01.png` et `accueil-1440-seg02.png` : les sections sans délimitation, les cartes génériques.
- `accueil-1440-seg04.png` : le trou avant le pied de page, et le seul endroit où le motif de pictogrammes se voit.
- `scell-desk-300.png` : l'écran de scellement, la vraie signature.
- `flux-dissolution-1-1440.png` : l'écran « Détruit », bonne idée en trop petit.
- `securite-1440-full.png` : la colonne à gauche, la moitié droite vide.
