# Six langues sur le site — conception

Date : 11 novembre 2026 · Statut : à valider par le propriétaire
Complète la spécification UI (`2026-11-04-shhdrop-ui-design.md`, §10 « Textes (FR / EN) ») et la spécification générale (§42, D42-20 : apps natives plus tard).

## 1. Décisions du propriétaire (11 novembre)

- **Six langues** : français (fr), anglais (en), espagnol (es), chinois simplifié (zh), hindi (hi), arabe (ar). Les cinq langues les plus parlées au monde, plus le français.
- **Choix de la langue** : si une langue réglée dans le navigateur fait partie des six, le site s'affiche dans la première de ces langues ; sinon, en **anglais**. Pas de fuseau horaire, pas d'autre indice. Aujourd'hui le repli est le français : il devient l'anglais.
- **Changement manuel** : dans le pied de page (partie 1, même jour), liste des six langues, chacune écrite dans sa propre langue (« Français », « English », « Español », « 中文 », « हिन्दी », « العربية »).
- **Aucun stockage** (inchangé, UI §10) : la langue choisie à la main vaut pour la visite en cours ; à la visite suivante, la règle du navigateur s'applique de nouveau. Rien n'est envoyé au serveur.

## 2. Ce qui est traduit, ce qui ne l'est pas

Traduit : tous les textes de l'interface (`web/src/i18n/`, ~750 clés), les pages d'information (`web/src/routes/pages/content.ts` : sécurité, confidentialité, conditions, mentions légales, signaler, offres), les annonces pour lecteurs d'écran, les noms par défaut (« Note 1 », « Mémo vocal 1 »), les formats (durées, tailles, dates, nombres).

Jamais traduit : le nom « Shhdrop », les liens, les mots de passe (alphabet générateur inchangé, D41-15), les codes d'erreur du moteur et du serveur (le site les traduit à l'affichage, comme aujourd'hui), le contenu des partages.

Le serveur n'envoie aucun texte à l'utilisateur : rien à changer côté Go. La démo suit les mêmes règles.

## 3. Format des traductions (compatible avec les apps)

- Un fichier JSON par langue : `web/src/i18n/locales/{fr,en,es,zh,hi,ar}.json`, à plat, clés identiques à aujourd'hui (`"ready.link.title": "Lien"`). Lisible tel quel par Flutter (fichiers ARB = JSON) et par le moteur Rust si besoin : aucune règle de format propre au navigateur (règle CLAUDE.md, apps natives).
- Paramètres inchangés : `{n}`, `{max}`, etc.
- **Pluriels** : clés `base.<catégorie>` avec les catégories de `Intl.PluralRules` / CLDR (`zero`, `one`, `two`, `few`, `many`, `other`). Le français et l'anglais gardent `one`/`other` ; l'arabe a les six ; le chinois n'a que `other`. `t("base", { n })` choisit la catégorie de la langue, `other` en dernier recours.
- **Le français reste la source** : toute clé ajoutée l'est d'abord en français ; un test refuse qu'une autre langue ait une clé manquante, une clé en trop, un paramètre différent ou une catégorie de pluriel absente pour sa langue.
- Les fichiers actuels `fr.ts`, `en.ts` et les textes de `content.ts` sont convertis en JSON sans changer un seul texte français ou anglais (test : égalité avec l'ancien contenu).

## 4. Chargement et poids

Mesure : le français pèse ~19 Ko brotli (interface + pages), l'anglais ~17 Ko. Les quatre nouvelles langues ajouteraient ~80 Ko au site si tout était dans le script principal (+24 % sur 339 Ko).

**Choix retenu** : le script principal ne contient que l'anglais (langue de repli). Chaque autre langue est un fichier à empreinte (`assets/locale-fr-EMPREINTE.js`…), chargé avant le premier affichage quand le navigateur la demande, avec contrôle d'intégrité (même mécanisme vérifié que le moteur : `fetch` avec `integrity`, `check-dist.mjs` contrôle que chaque fichier est cité et haché). Coût : rien pour qui lit l'anglais, un fichier de ~20 Ko pour les autres. La démo (sans requête) embarque les six langues.

Si le fichier d'une langue ne se charge pas (réseau), le site s'affiche en anglais, sans erreur bloquante.

## 5. Écriture de droite à gauche (arabe)

- `<html lang="ar" dir="rtl">` quand l'arabe est affiché ; `dir="ltr"` sinon.
- Le CSS passe aux propriétés logiques (`margin-inline-start` au lieu de `margin-left`, etc.) : 56 emplacements physiques relevés dans `web/src`. Les icônes qui indiquent un sens (flèches, chevrons, « Retour », glissement des écrans sur téléphone) sont retournées ; les autres (logo, cadenas) non.
- Les mots de passe, liens, noms de fichiers et nombres restent écrits de gauche à droite à l'intérieur du texte arabe (isolation `dir="ltr"` / `<bdi>`), pour qu'aucun caractère ne change de place à l'écran.
- **Chiffres** : chiffres occidentaux (0-9) dans toutes les langues (`Intl` avec `numberingSystem: "latn"`), pour que tailles, durées et compteurs se lisent comme les mots de passe et les liens.

## 6. Polices

Mona Sans et JetBrains Mono n'ont pas les caractères chinois, devanagari (hindi) ni arabes. Aucune police externe n'est permise (CLAUDE.md) : pour ces langues, le texte prend la police de l'appareil (pile `system-ui` déclarée par écriture). L'apparence varie un peu d'un appareil à l'autre. Les mots de passe restent en JetBrains Mono (alphabet latin seulement).

## 7. Qualité des traductions

- Je traduis à partir du français, en vérifiant contre l'anglais, avec un ton et des termes constants (glossaire en tête de chaque fichier : « partage », « lien », « mot de passe », « chiffré de bout en bout », « s'autodétruit »…).
- **Risque juridique et de confiance** : les pages sécurité, confidentialité, conditions et mentions légales doivent être relues par une personne de langue maternelle (idéalement juriste pour les conditions) **avant la mise en ligne**. Jusque-là, chaque langue porte un statut « à relire » dans `web/src/i18n/locales/README.md`, et la CI peut l'afficher.
- Les promesses de sécurité ne doivent jamais être renforcées par la traduction (jamais d'équivalent de « 100 % sécurisé »). Un test cherche les formules interdites connues dans chaque langue.

## 8. Tests

- Unitaires : complétude des six fichiers (clés, paramètres, catégories de pluriel) ; règle de choix (matrice : `["es-MX"]` → es, `["de-DE"]` → en, `["de", "fr"]` → fr, `["zh-TW"]` → zh, `[]` → en) ; formats par langue (durées, tailles, chiffres latins) ; égalité FR/EN avec l'ancien contenu.
- Interface (Playwright) : pour chaque langue, accueil, composeur, écran « Lien prêt », ouverture d'un partage et une page d'information : aucun texte vide ni clé brute, aucun débordement horizontal, contrôle d'accessibilité axe sans erreur, captures ordinateur et téléphone. Arabe : `dir="rtl"`, ordre visuel retourné, mot de passe et lien lisibles de gauche à droite.
- Poids : contrôle par `check-dist.mjs` (fichiers de langue cités et hachés) et mesure du script principal.

## 9. Points ouverts signalés

1. **Chinois traditionnel** (Taïwan, Hong Kong) : selon la règle, un navigateur `zh-TW` reçoit le chinois simplifié (la langue existe). Lisible, mais peut être mal perçu ; une variante traditionnelle serait une septième langue.
2. **Hindi** : beaucoup d'internautes indiens règlent leur navigateur en anglais ; ils recevront l'anglais, ce qui est conforme à la règle.
3. **Ordre des travaux** : (1) format JSON, pluriels, chargement et choix de langue, sans nouvelle langue ; (2) droite à gauche et polices ; (3) traductions es, zh, hi, ar ; (4) tests et captures par langue.
