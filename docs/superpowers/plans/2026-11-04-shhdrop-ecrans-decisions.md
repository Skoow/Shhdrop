# Plan 2 (écrans) : décisions et mesures

Fichier de décisions du plan `2026-11-04-shhdrop-ecrans.md`. Chaque entrée donne la date, la tâche, la décision ou la mesure, et sa preuve.

## Task DA : direction artistique v2 (5 novembre)

- **Mémoire des calques d'aurore (K11)** : 1,63 Mo (budget 32 Mo). Mesure : Chromium, Pixel 7 émulé (412 × 915), données du panneau Layers de DevTools lues par CDP (`LayerTree`), estimation largeur × hauteur × 4. Calques : 3 nappes de 128 × 128 (images posées à 128 px, agrandies par `transform: scale()`) et le grain fixe (412 × 915) ; l'éclat n'a pas de calque au repos. Test : `web/ui-e2e/aurora.spec.ts` (« K11 »). Réserve : c'est l'estimation du panneau Layers (taille du calque), pas la mémoire GPU réelle des tuiles ; une trace sur un vrai Pixel 6a reste à faire (UI §20.6).
- **Plafond de luminance K5 dans chaque état K4** (contenu caché, trois phases de la dérive, maximum de tous les pixels) :

  | État | 390 px | 1440 px |
  |---|---|---|
  | Repos | 0,031 | 0,039 |
  | Scellement | 0,033 | 0,038 |
  | Éclat à son pic (1 000 ms) | 0,033 | 0,043 |
  | Détruit | 0,016 | 0,020 |

  Valeurs abaissées pour tenir 0,050 (K4 : « une valeur qui échoue est abaissée, pas la règle ») : alpha maximal des nappes générées 0,62 à 0,64 (le prototype montait à 1,0 et dépassait 0,058 au repos selon la phase de la dérive) ; scellement 0,22 au lieu de 0,26 ; pic de l'éclat 0,12 au lieu de 0,55. Jetons `--aur-*-o` de UI §20.3 inchangés.
