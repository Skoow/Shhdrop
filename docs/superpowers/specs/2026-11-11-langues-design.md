# Quatre langues sur le site — conception

Date : 11 novembre 2026 · Statut : validée par le propriétaire le 11 novembre (liste des langues revue le même jour)
Complète la spécification UI (`2026-11-04-shhdrop-ui-design.md`, §10 « Textes (FR / EN) ») et la spécification générale (§42, D42-20 : apps natives plus tard).

## 1. Décisions du propriétaire (11 novembre)

- **Quatre langues** : français (fr), anglais (en), espagnol (es), portugais (pt). L'arabe, le hindi, le chinois puis l'allemand, d'abord envisagés, sont retirés : leurs lecteurs ont l'anglais.
- **Choix de la langue** : si une langue réglée dans le navigateur fait partie des quatre, le site s'affiche dans la première de ces langues ; sinon, en **anglais**. Pas de fuseau horaire, pas d'autre indice. Aujourd'hui le repli est le français : il devient l'anglais.
- ~~**Changement manuel** : dans le pied de page, liste des quatre langues, chacune écrite dans sa propre langue (« Français », « English », « Español », « Português »).~~ **Décision du propriétaire du 12 novembre** : plus de liste de langues dans le pied de page ; la langue se choisit automatiquement selon le navigateur (UI §10, §24). Un moyen de forcer la langue (paramètre ou chemin) reste à décider s'il devient utile.
- **Aucun stockage** (inchangé, UI §10) : la langue choisie à la main vaut pour la visite en cours ; à la visite suivante, la règle du navigateur s'applique de nouveau. Rien n'est envoyé au serveur.

## 2. Ce qui est traduit, ce qui ne l'est pas

Traduit : tous les textes de l'interface (`web/src/i18n/`, ~750 clés), les pages d'information (`web/src/routes/pages/content.ts` : sécurité, confidentialité, conditions, mentions légales, signaler), les annonces pour lecteurs d'écran, les noms par défaut (« Note 1 », « Mémo vocal 1 »), les formats (durées, tailles, dates, nombres).

Jamais traduit : le nom « Shhdrop », les liens, les mots de passe (alphabet inchangé, D41-15), les codes d'erreur du moteur et du serveur (le site les traduit à l'affichage, comme aujourd'hui), le contenu des partages.

Le serveur n'envoie aucun texte à l'utilisateur : rien à changer côté Go. La démo suit les mêmes règles.

**Variantes** : espagnol neutre (compréhensible en Espagne et en Amérique latine, « usted » évité au profit de tournures impersonnelles comme dans l'interface française) ; portugais du **Brésil** (le plus de lecteurs), lisible au Portugal.

## 3. Format des traductions (compatible avec les apps)

- Un fichier JSON par langue : `web/src/i18n/locales/{fr,en,es,pt}.json` (interface, à plat, mêmes clés qu'aujourd'hui) et `{fr,en,es,pt}.pages.json` (pages d'information). Lisible tel quel par Flutter (fichiers ARB = JSON) : aucune règle de format propre au navigateur (règle CLAUDE.md, apps natives).
- Paramètres inchangés : `{n}`, `{max}`, etc.
- **Pluriels** : clés `base.<catégorie>` avec les catégories de `Intl.PluralRules` (CLDR). `t("base", { n })` choisit la catégorie de la langue, `other` en dernier recours (le français, l'espagnol et le portugais ont aussi `many`, utilisé pour les grands nombres ronds ; `other` suffit s'il est identique).
- **Le français reste la source** : toute clé ajoutée l'est d'abord en français ; un test refuse qu'une autre langue ait une clé manquante, une clé en trop ou un paramètre différent.
- Les fichiers actuels `fr.ts`, `en.ts` et les textes de `content.ts` sont convertis en JSON sans changer un seul texte français ou anglais (test : égalité avec l'ancien contenu).

## 4. Chargement et poids

Mesure : le français pèse ~19 Ko brotli (interface + pages), l'anglais ~17 Ko. Les deux nouvelles langues ajouteraient ~37 Ko au site si tout était dans le script principal (+11 % sur 339 Ko).

**Choix retenu** : le script principal ne contient que l'anglais (langue de repli). Chaque autre langue est un fichier à empreinte (`assets/locale-fr-EMPREINTE.json`…), chargé avant le premier affichage quand le navigateur la demande, avec contrôle d'intégrité (même mécanisme vérifié que le moteur : `fetch` avec `integrity`, `check-dist.mjs` contrôle que chaque fichier est cité et haché). Coût : rien pour qui lit l'anglais, un fichier de ~20 Ko pour les autres. La démo (sans requête) embarque les quatre langues.

Si le fichier d'une langue ne se charge pas (réseau), le site s'affiche en anglais, sans erreur bloquante.

**État au 13 novembre (rapport de performance, D4 ; avant les quatre langues)** : le mécanisme est en place pour les deux langues actuelles, mais **avec le français dans le script** (langue de repli actuelle, UI §10 : `detectLang` rend `fr` par défaut) et l'anglais dans `assets/locale-en-EMPREINTE.js`. Écart avec le choix ci-dessus (anglais dans le script), à trancher avec le passage aux quatre langues. Le fichier est du JSON servi avec l'extension `.js` : le serveur Go ne met en cache immuable ni ne compresse les `.json` (règle `immutableAsset`, testée) ; passer à `.json` demande de changer `static.go` et ses tests. Si le fichier ne se charge pas, le site s'affiche en français.

## 5. Écriture et polices

Les quatre langues s'écrivent de gauche à droite en alphabet latin. Les polices du site (Mona Sans, JetBrains Mono) couvrent déjà ces caractères (plage U+0000-00FF : ã, õ, ç, ñ, á, ¿, ¡) : aucune police ni écriture à ajouter.

Les textes espagnols et portugais sont souvent plus longs que le français : les boutons et étiquettes doivent passer à la ligne ou se réduire sans déborder (contrôlé par les tests, §7).

## 6. Qualité des traductions

- Traduction à partir du français, vérifiée contre l'anglais, avec un ton et des termes constants (glossaire dans `web/src/i18n/locales/README.md` : « partage », « lien », « mot de passe », « chiffré de bout en bout », « s'autodétruit », « ouverture », « nettoyer »…).
- **Risque juridique et de confiance** : les pages sécurité, confidentialité, conditions et mentions légales doivent être relues par une personne de langue maternelle (idéalement juriste pour les conditions) **avant la mise en ligne**. Jusque-là, chaque langue porte un statut « à relire » dans `web/src/i18n/locales/README.md`.
- Les promesses de sécurité ne doivent jamais être renforcées par la traduction (jamais d'équivalent de « 100 % sécurisé »). Un test cherche les formules interdites connues dans chaque langue.

## 7. Tests

- Unitaires : complétude des quatre fichiers (clés, paramètres, catégories de pluriel) ; règle de choix (matrice : `["es-MX"]` → es, `["pt-PT"]` → pt, `["de-DE"]` → en, `["it-IT"]` → en, `["it", "pt"]` → pt, `[]` → en) ; formats par langue (durées, tailles, dates) ; égalité FR/EN avec l'ancien contenu.
- Interface (Playwright) : pour chaque langue, accueil, composeur, écran « Lien prêt », ouverture d'un partage et une page d'information : aucun texte vide ni clé brute, aucun débordement horizontal, contrôle d'accessibilité axe sans erreur, captures ordinateur et téléphone.
- Poids : contrôle par `check-dist.mjs` (fichiers de langue cités et hachés) et mesure du script principal.
