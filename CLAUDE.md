# Shhdrop — règles du projet

Partage chiffré de bout en bout, sans compte, avec liens qui s'autodétruisent.
Spécification de référence : `docs/superpowers/specs/2026-11-03-shhdrop-design.md`.

## Priorités (dans cet ordre)

1. Sécurité et confidentialité.
2. Exactitude (aucune erreur de logique).
3. Simplicité : ne rien coder qui ne serve pas la spécification.

## Vigilance permanente

À chaque étape (spécification, plan, code, revue, mise en ligne), signaler de soi-même, sans attendre qu'on le demande :

- ce qui **manque** et dont on n'a pas encore parlé ;
- toute **erreur**, contradiction ou ambiguïté, y compris dans la spécification ou dans un choix déjà validé ;
- ce qui est **inutile** ou trop complexe pour ce que ça apporte ;
- tout **risque** de sécurité, de confidentialité, légal ou d'exploitation.

Chaque signalement donne la gravité, l'endroit, le problème et une correction concrète. On ne corrige pas en silence un choix validé : on le signale et on propose.

## Règles techniques

- Aucune crypto maison : WebCrypto et libsodium uniquement, avec les paramètres de la spécification.
- Le serveur ne doit jamais recevoir ni stocker de contenu, de nom de fichier, de clé ou de mot de passe en clair. Le test « le serveur ne voit rien » bloque toute mise en ligne.
- Aucune ressource tierce sur le site : pas de CDN, de police externe, d'analytics ni de traceur. Seule exception, validée par le propriétaire : le repli Google reCAPTCHA, chargé après un clic et seulement dans un cadre isolé sur un autre site, jamais sur une page qui détient des clés (spécification §26).
- Aucune adresse IP enregistrée sur disque.
- Toute modification passe par des tests. On n'annonce rien comme « fait » sans preuve (tests passés, captures).
- Ne jamais écrire « 100 % sécurisé ».

## Git

- Commits : auteur = adresse anonyme GitHub du propriétaire (`git commit --author="Skoow <190851638+Skoow@users.noreply.github.com>"`), committer = identité signée de l'environnement (configuration globale, ne pas la remplacer), pour que GitHub affiche « Verified ». Jamais l'e-mail personnel du propriétaire.
- Travail poussé régulièrement sur GitHub : la machine de développement peut être réinitialisée à tout moment.
- Tout le travail se fait directement sur la branche `main` (décision du propriétaire) : pas de branche de travail, tests au vert avant chaque push.

## Langue

Échanges et documentation en français ; code et messages de commit techniques en français ou en anglais, au choix, mais de façon cohérente dans un même fichier.
