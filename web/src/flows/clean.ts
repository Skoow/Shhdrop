// Nettoyage des métadonnées : point d'entrée du composeur vers la bibliothèque de la Task 9a
// (`web/src/media/strip/*`, cleanFile(file) → { file, cleaned, removed }).
// PROVISOIRE : tant qu'elle n'est pas livrée, ce relais ne nettoie rien et le dit
// (cleaned: false) ; le bouton « Nettoyer tous les fichiers » affiche alors honnêtement les
// fichiers non nettoyés. À l'arrivée de 9a : importer son cleanFile ici et passer CLEANER_READY
// à true (nettoyage automatique à l'ajout).
import type { CleanFile } from "./compose.svelte";

export const CLEANER_READY = false;

export const cleanFile: CleanFile = async (file) => ({ file, cleaned: false, removed: [] });
