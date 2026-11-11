# Salon v3 : une vraie messagerie éphémère — conception

Date : 11 novembre 2026 · Statut : **brouillon à valider par le propriétaire**
Amende la spécification générale `2026-11-03-shhdrop-design.md` §39 (salon, v2.8 et v2.9), D41-1 à D41-26 pour le salon, §37 (compte) et D42-20/D42-21 (moteur Rust commun). Tout ce qui n'est pas changé ici reste valable : lien `#c…`, mot de passe, sièges, WebSocket toujours par notre serveur, relais en mémoire seulement, pièces jointes chiffrées sur disque, budget de 1 Go, exclusion, limites, routes (§39.1, §39.3, §39.4, §39.13).

## 1. Demande et décisions du propriétaire (11 novembre)

Demande : « une conversation type WhatsApp, Signal, Telegram, où l'on peut tout faire comme sur une messagerie moderne » : émojis, vocaux dans la conversation, « en train d'écrire », supprimer un message en direct, effacement automatique des messages, modification d'un message, envoi et téléchargement de fichiers, pseudonyme choisi au départ et modifiable, photo de profil, appels audio et vidéo plus tard, « et tout ce que je ne t'ai pas dit qui peut servir ».

Décisions prises le 11 novembre :

1. **Chiffrement de groupe : MLS** (norme RFC 9420) par la bibliothèque Rust **OpenMLS**, dans le moteur commun (site en WebAssembly, apps en natif). Remplace les « clés d'expéditeur » de §39.2, qui reposaient sur libsodium, retiré du site (D42-21). Sous réserve de l'essai en cours (poids, vitesse, sûreté, §3.6).
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
- Le serveur ne voit jamais le contenu MLS : chaque message MLS est placé dans l'enveloppe extérieure de taille fixe de §39.2.3 (`K_trame`, 4 140 octets). Un message MLS plus grand (Welcome, Commit d'un grand groupe) est découpé en plusieurs trames de même taille. Le serveur ne distingue donc ni le type (message, Commit, Welcome, accusé, « écrit »), ni l'expéditeur, ni la taille.

### 3.3 Clés du salon gardées de §39.2.1

`K_lien`, `K_accès_s`, `S_gestion`, `sel`, `K_mdp` (Argon2id), `K_maître_s`, `K_preuve_s`, `K_trame`, `tag_salon` : inchangés. Ils sont calculés par le moteur Rust (HKDF RustCrypto, Argon2id déjà en place). XChaCha20-Poly1305 de l'enveloppe : crate `chacha20poly1305` (RustCrypto).

### 3.4 Pièces jointes

Inchangé (§39.2.5) : chaque pièce est un paquet SHH2 d'un élément sous une graine aléatoire `R` ; `R` voyage dans un message MLS.

### 3.5 Ce que le moteur expose

Le moteur Rust porte tout le protocole du salon (groupe MLS, enveloppe, découpage, formats des messages, règles d'effacement côté appareil), pour que le site et les apps soient identiques. Vecteurs de test communs `engine/vectors/salon-v3.json` (déterministes : aléa injecté en test seulement).

### 3.6 À confirmer par l'essai (en cours)

Version stable d'OpenMLS publiée depuis 7 jours au moins, licence, audits et avis RustSec ; compilation vers WebAssembly avec le fournisseur RustCrypto ; poids ajouté (chargé seulement à l'ouverture d'un salon, jamais sur les pages de partage) ; temps des opérations pour 10 membres ; tout en mémoire sans stockage persistant ; effacement des secrets. Si l'essai échoue, retour vers le propriétaire avant toute autre solution.

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
  - **Instantané** : pour chaque personne, un message qu'elle a vu s'efface de son écran **dès qu'elle quitte la conversation** (fermer l'app ou l'onglet, changer d'app, changer d'onglet ou d'écran dans l'app) ; si elle reste dans la conversation, il s'efface **1 minute** après qu'elle l'a vu, avec un compte à rebours dans le message. Le message n'est retiré du serveur que lorsque **chaque participant présent à l'envoi l'a vu** (ou est parti). Chez l'expéditeur, le message reste avec « Vu par 2 / 3 » jusqu'à ce que tous l'aient vu, puis suit la même règle.
  - **10 minutes** et **1 heure** : comptées **depuis l'envoi**, pour tout le monde, expéditeur compris. Un message que personne n'a lu dans ce délai est effacé sans avoir été lu. Compte à rebours visible dans le message.
- **Qui la change** : **tout participant**, à tout moment. Chaque changement s'affiche dans la conversation : « Léa a réglé l'effacement des messages sur 10 minutes ». La règle s'applique aux messages envoyés **après** le changement ; un message garde la règle de son envoi (elle voyage avec lui, chiffrée).
- **« Vu »** au sens de l'effacement : le message a été affiché à l'écran, page visible, au moins 1 seconde (`IntersectionObserver` et `visibilitychange`).
- **Ce que fait « effacé »** : le message quitte l'écran et la mémoire de la page (URL blob révoquées, pièce oubliée) ; sur le serveur, sa trame quitte la file et sa pièce est effacée du disque dès que la règle le permet pour tous.
- **Honnêteté, à afficher** : « L'effacement se fait sur les appareils des participants. Une capture d'écran, une photo de l'écran ou une app modifiée peuvent garder un message. »
- **Signalement (moyen)** : en « Instantané », un participant hors ligne qui ne revient jamais bloque l'effacement côté serveur jusqu'à son départ ou la fin du salon (au plus 24 h). Correction proposée : un participant absent depuis plus de 10 min ne bloque plus (son siège reste, mais le message est retiré du serveur ; il ne le recevra pas).

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

## 8. Appels audio et vidéo : plus tard, mais préparés

Rien n'est codé maintenant. Contraintes posées dès aujourd'hui pour ne rien bloquer :

- **Jamais en direct entre participants** : un appel direct révélerait l'adresse IP de chacun aux autres (contraire à §39.3.1). Les appels passeront par un relais de notre serveur (TURN, mode « relais seulement »).
- **Chiffrés de bout en bout** par SFrame (norme RFC 9605), avec une clé tirée de l'exporteur MLS du groupe : le relais ne voit que du chiffré.
- Le format des messages réserve les sortes `appel_*` (invitation, réponse, fin) ; une spécification des appels sera écrite et validée avant tout code (coût en bande passante, cadre légal).

## 9. Ajouts proposés (« ce que je ne t'ai pas dit »)

1. Coches envoyé / reçu / vu (§6).
2. Répondre, réagir, modifier, retirer : appui long (téléphone) ou survol (ordinateur).
3. Mentions `@pseudo`, mises en évidence chez la personne citée.
4. **Code de vérification** par participant (empreinte de sa clé, 4 groupes de 5 chiffres) à comparer de vive voix : prouve que personne ne s'est glissé dans la conversation.
5. Galerie des photos et vidéos du salon ; lecture des vocaux 1× / 1,5× / 2×.
6. Bouton « Aller en bas » avec le nombre de messages non lus ; séparateur « Nouveaux messages ».
7. Brouillon gardé en mémoire de la page quand on change d'écran.
8. Reprise automatique après une coupure (déjà prévue), notice si des messages ont pu manquer.
9. Titre de l'onglet « (3) Shhdrop » sans contenu (déjà prévu).
10. Refusés, par confidentialité : aperçus de liens, notifications push (service tiers), localisation, transfert vers un autre salon.

## 10. Ce que voit le serveur (complète §39.3.8)

Inchangé pour l'essentiel : trames de taille unique, type et expéditeur cachés. Nouveau : rien (accusés, modifications, règles et profils sont des trames ordinaires ; avatars et pièces sont chiffrés). Le rythme des trames par siège reste visible (S34), un peu plus dense à cause des accusés.

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
