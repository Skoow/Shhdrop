// Dictionnaire de référence (UI §10). Les espaces fines insécables (U+202F) avant : ; ! ? sont
// écrites en \u202f ; un test (i18n.test.ts) vérifie qu'aucune ponctuation haute n'en manque.
export const fr = {
  "hero.title": "Un lien, un mot de passe, puis plus rien.",
  "hero.lede":
    "Texte, photos, vidéos, vocaux, documents. Chiffrés sur votre appareil avant l'envoi\u202f: ni le serveur ni son propriétaire ne peuvent les lire.",
  "hero.how": "Comment ça marche",

  "shell.skip": "Aller au contenu",
  "shell.home": "Shhdrop, accueil",
  "shell.lang.label": "English",
  "shell.lang.switch": "English, passer l'interface en anglais",
  "shell.lang.locked": "Le changement de langue est désactivé pendant l'envoi.",
  "shell.nav": "Informations",
  "shell.security": "Sécurité",
  "shell.privacy": "Confidentialité",
  "shell.footer": "Chiffré sur votre appareil avant l'envoi.",
  "demo.banner": "Démo\u202f: rien n'est envoyé, le lien ne marche que dans cet onglet.",

  "notfound.title": "Cette page n'existe pas.",
  "notfound.home": "Retour à l'accueil",

  "common.retry": "Réessayer",
  "common.copy": "Copier",
  "common.copied": "Copié",
  "common.cancel": "Annuler",
  "common.confirm": "Confirmer",
  "common.close": "Fermer",
  "common.undo": "Annuler",
  "stepper.dec": "Diminuer",
  "stepper.inc": "Augmenter",
  "copy.done": "{label} copié",
  "copy.manual": "Copie automatique impossible. Copiez la valeur sélectionnée.",
  "countdown.at": "Il reste {duration}",
  "countdown.expired": "Le partage a expiré",

  "compose.add.files": "Fichiers",
  "compose.add.photo": "Photo",
  "compose.add.voice": "Vocal",
  "compose.add.text": "Texte",
  "compose.add.paste": "Coller",
  "compose.drop": "Déposez pour ajouter",
  "compose.folder":
    "Les dossiers ne peuvent pas être ajoutés. Ajoutez les fichiers eux-mêmes, ou une archive .zip.",
  "compose.cat.text": "Texte",
  "compose.cat.photos": "Photos",
  "compose.cat.videos": "Vidéos",
  "compose.cat.audio": "Audio et vocaux",
  "compose.cat.documents": "Documents",
  "compose.cat.other": "Autres",
  "compose.moved": "{name}\u202f: position {i} sur {n} dans {category}.",
  "compose.removed": "{name} retiré",
  "compose.duplicate": "En double\u202f?",
  "compose.gauge": "{size} / 1\u202fGo · {n} / 10",
  "compose.gauge.empty": "Rien à envoyer pour l'instant · 1\u202fGo et 10\u202féléments au plus",
  "compose.tooBig": "Trop gros\u202f: {size} sur 1\u202fGo. Retirez {excess}.",
  "compose.tooMany.one": "{n}\u202félément n'a pas été ajouté\u202f: 10\u202fau plus.",
  "compose.tooMany.other": "{n}\u202féléments n'ont pas été ajoutés\u202f: 10\u202fau plus.",
  "compose.cleaned": "Nettoyé · lieu, appareil et date de prise de vue retirés",

  "options.ttl.hint": "Comptée à partir de la fin de l'envoi.",
  "options.opens.hint": "Une ouverture = un déverrouillage réussi.",
  "options.submit": "Chiffrer et envoyer",

  "seal.keys": "Préparation des clés",
  "seal.captcha": "Vérification anti-robot · calcul sur votre appareil",
  "seal.upload": "Chiffrement et envoi",
  "seal.padding": "La taille envoyée est arrondie au palier supérieur pour masquer la taille réelle.",
  "seal.offline": "Connexion perdue. Nouvel essai dans {duration}…",
  "seal.paused": "En pause · reprise automatique dans {duration}",
  "seal.cancel.confirm": "Annuler l'envoi\u202f? Ce qui a été envoyé sera effacé du serveur.",

  "verif.title": "Vérification supplémentaire",
  "verif.body":
    "La vérification automatique n'a pas abouti sur cet appareil. Vous pouvez utiliser celle de Google. Google verra votre adresse IP et pourra déposer ses cookies dans son cadre. Votre contenu, votre lien et votre mot de passe restent hors de sa portée\u202f: la vérification tourne dans une page séparée, sans accès à cette page.",
  "verif.continue": "Continuer avec Google",
  "verif.cancel": "Annuler l'envoi",
  "verif.more": "En savoir plus",

  "ready.title": "Lien prêt",
  "ready.created": "Partage créé.",
  "ready.pw.reminder":
    "Envoyez-le par un autre moyen que le lien. Les deux dans la même messagerie, c'est comme ne pas en mettre.",
  "ready.delete.confirm": "Supprimer ce partage pour tout le monde\u202f? Le lien ne mènera plus à rien.",
  "ready.never": "Ces informations ne seront plus jamais affichées.",

  "open.intro":
    "Quelqu'un vous a envoyé un partage chiffré. Shhdrop ne vérifie pas l'identité de l'expéditeur.",
  "open.cost":
    "Déverrouiller utilise une ouverture. Si le téléchargement échoue ensuite, cette ouverture est perdue.",
  "open.badPw.one": "Mot de passe incorrect · {n}\u202fessai restant",
  "open.badPw.other": "Mot de passe incorrect · {n}\u202fessais restants",
  "open.lastTry": "Au prochain échec, le partage sera détruit.",
  "open.destroyedByPw": "Mot de passe incorrect. Le partage a été détruit.",

  "content.banner":
    "Disponible encore {duration} · disparaît quand vous quittez la page · recharger consomme une ouverture",
  "content.finish": "Terminer et effacer",
  "content.undecodable":
    "Ce fichier ne peut pas être lu sur cet appareil. Enregistrez-le pour l'ouvrir avec une autre application.",
  "content.risky":
    "«\u00a0{name}\u00a0» peut exécuter du code sur votre appareil. N'ouvrez ce fichier que si vous faites confiance à l'expéditeur.",

  "report.body":
    "Le partage sera détruit immédiatement pour tout le monde. Shhdrop ne peut pas voir le contenu et ne garde aucune trace de votre signalement. Pour un contenu illégal, vous pouvez aussi le signaler aux autorités (en France\u202f: PHAROS, internet-signalement.gouv.fr).",

  "invalid": "Ce lien n'existe pas ou n'est plus disponible.",
  "incomplete": "Ce lien est incomplet. Rouvrez-le depuis le message d'origine.",
  "incomplete.hint":
    "La partie secrète a peut-être été retirée de la barre d'adresse après une première visite.",
  "unsupported":
    "Ce navigateur ne permet pas de chiffrer en sécurité. Utilisez une version récente de Safari, Chrome, Firefox ou Edge.",

  "manage.status": "Ouvert {u} / {max} · Expire dans {duration}",
  "manage.gone": "Supprimé",

  "err.limit": "Limite d'envois atteinte. Réessayez dans {duration}.",
  "err.full": "Le service est plein pour le moment. Réessayez plus tard.",
  "err.interrupted": "Le transfert a été interrompu (le serveur a peut-être redémarré). Réessayez.",
  "err.network": "Connexion impossible. Vérifiez votre réseau et réessayez.",
} as const;
