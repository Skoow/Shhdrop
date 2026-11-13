# Salon : ajouter des places et renouveler le salon sans recréer de lien

Date : 13 novembre 2026. Demande du propriétaire.

## Révision du 13 novembre (décisions du propriétaire), qui remplace la partie « Durée » ci-dessous

- **Prolonger = renouveler** : le créateur relance le salon pour une nouvelle durée (1, 6, 12 ou 24 h sans compte ; plus avec une offre payante), **et toute la conversation est effacée** : messages, vocaux, fichiers, tout ce qui a été partagé. Seuls restent le lien, le mot de passe et **les membres présents à leur place** : « pour plus de facilité, que les contacts restent dans la même conversation ».
- Possible tant que le salon existe (jamais après la fin : tout est alors détruit, promesse « puis plus rien »).
- **Côté serveur** : en une opération, sous le verrou du salon : fichier de conversation détruit puis recréé vide (clé neuve, zéros), pièces effacées (fichier puis ligne), `pieces_bytes = 0`, index, tas d'échéances, `pieces`, attentes « instantané » et `effaces` vidés ; `seq` continue de croître (aucun rang réutilisé) ; nouvelle échéance = maintenant + durée, arrondie au quart d'heure supérieur ; diffusion à tous d'un enregistrement sans rang `0x10` « renouvelé » (rang de départ, secondes restantes, places) : chaque appareil efface son historique local et repart de ce rang. Le moteur MLS du créateur fait un Commit (nouvelle époque, C-3/C-5) pour que rien d'avant ne soit déchiffrable par un nouvel arrivant.
- **Anti-abus** : un renouvellement compte comme une **création de salon** (quota de 5 par jour et par connexion, 15 par /48, preuve anti-robot). Il n'y a donc plus besoin de plafond « 24 h depuis la création » en mémoire : l'approche 1 ci-dessous est abandonnée.
- **Rattrapage** : une connexion qui revient avec un `depuis` antérieur au renouvellement reçoit le `0x10` puis seulement ce qui suit ; rien d'avant n'est jamais servi.
- **Places** : inchangé (ci-dessous).
- **Messages et vocaux** : jamais dans l'espace des fichiers (1 Go par salon sans compte) ; anti-flood déjà en place côté serveur (60 trames/min par membre avec rafale de 20, 1 200 messages/h par membre, 480 trames/min par adresse, vocaux au rythme d'une voix, 120 fichiers/h par membre, garde-fou du disque) ; l'écran (C-3) dira « Doucement, réessayez dans N s » au lieu d'échouer.

## Intention

Le créateur d'un salon déjà ouvert doit pouvoir **changer le nombre de places** et **prolonger la durée de vie** du salon sans recréer de lien : les invités gardent le même lien et le même mot de passe, personne ne recommence. Toujours dans la limite de l'offre : sans compte aujourd'hui, avec compte plus tard.

## Objectifs

- Places : le créateur choisit une nouvelle valeur entre le nombre de personnes **présentes** (sièges occupés) et la limite de l'offre (10 sans compte, plafond technique actuel : sièges 0 à 9).
- Durée : le créateur prolonge le salon par paliers (+1 h, +6 h, +12 h), sans dépasser **24 h depuis la création** sans compte (la limite actuelle de la durée choisie).
- Tous les membres connectés voient la nouvelle échéance et le nouveau nombre de places tout de suite.

## Non-objectifs

- Plus de 10 places (offres Plus et Pro) : il faut revoir la numérotation des sièges dans le serveur et le moteur. Chantier à part, avec les offres payantes.
- Raccourcir la durée : la destruction existe déjà.
- Les écrans (boutons + et −, « Prolonger ») : avec les écrans du salon (C-5). Ici, le serveur, le protocole et les tests.

## Anti-objectifs

- Aucune nouvelle information durable sur le disque : ni heure de création, ni historique des changements.
- Aucune prolongation sans fin : le plafond de l'offre doit tenir.
- Jamais retirer la place de quelqu'un qui est dans le salon.

## Approches

1. **Plafond de durée gardé en mémoire (retenu).** À la création, le serveur garde en mémoire seulement l'échéance maximale permise (création + 24 h, au quart d'heure supérieur). Rien sur le disque. Après un redémarrage, ce plafond est inconnu : la prolongation est refusée (`409 stale`), limite acceptée (un redémarrage efface de toute façon les conversations).
2. Plafond écrit en base : survivrait au redémarrage, mais révèle l'heure de création au quart d'heure à qui lit le disque, ce que la spec exclut (« jamais : durée choisie, l'heure de création s'en déduirait »). Écarté.
3. Plafond glissant (maintenant + 24 h) : permettrait de prolonger sans fin, contraire à la limite de l'offre. Écarté.

Pour prévenir les membres : un **enregistrement serveur sans rang `0x10` « réglages »** (nouvelle échéance en secondes restantes, nombre de places) diffusé à tous, plutôt qu'un message chiffré du créateur seul, que le serveur ne peut pas vérifier et qu'un créateur modifié pourrait falsifier. Le créateur envoie en plus le message chiffré « Lou a ajouté 2 places » ou « Lou a prolongé le salon de 6 h » pour l'historique de la conversation (C-5).

## Décisions

- Route `POST /api/salons/reglages` (`X-Shh-Manage`), corps `{ "max_members"?: N, "prolonger_h"?: 1|6|12 }`, au moins un des deux ; réponse `{ max_members, expires_in_s }`.
- Places : `N` entier, `sièges occupés ≤ N ≤ 10` (`SalonPlacesMax`, réglable plus tard par offre) ; sinon `409 occupied` (trop bas) ou `400 bad_request` (hors bornes). Le plafond des arrivées suit (5 × `N`) ; les arrivées déjà comptées restent.
- Durée : nouvelle échéance = ancienne + palier, arrondie au quart d'heure supérieur, ≤ plafond en mémoire ; sinon `409 limit` avec `max_extra_s` (ce qui reste possible). Jetons d'envoi de pièces : inchangés (déjà bornés à min(6 h, fin du salon) à leur émission).
- Une seule transaction SQL (`UPDATE … WHERE id=? AND failed_attempts<10 AND expires_at>?`) ; état mémoire mis à jour sous `salon.mu` ; `0x10` diffusé (direct et rattrapage, jamais de fermeture).
- Mêmes protections que les autres actions du créateur : `S_gestion` en temps constant, mêmes limites que `gestion`, réponses fixes, aucune adresse IP.
- `meta` et `rejoindre` rendent déjà `max_members` et `expires_in_s` : rien à changer.
- Ce que voit le serveur (v3 §10) : qu'un réglage a changé et quand (en direct seulement). Rien de nouveau sur le disque (la colonne `expires_at` et `max_members` changent de valeur).

## Laissé au constructeur

Noms internes, découpage des fichiers, forme exacte des tests (dont : prolongation au plafond, refus au-delà, refus après redémarrage, places sous l'occupation, `0x10` reçu par une connexion en rattrapage, rien de nouveau sur disque).
