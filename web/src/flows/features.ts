// Fonctions en attente d'un autre chantier, derrière un drapeau (rien n'est promis à l'écran).
/**
 * Enregistreur de mémos vocaux (media/recorder.ts, ui/VoiceRecorder.svelte, autre agent).
 * Faux : la feuille « Mémo vocal » dit qu'il arrive bientôt. Vrai : elle héberge
 * <VoiceRecorder onrecorded={(file) => …} /> (branchement prévu dans Compose.svelte).
 */
export const VOICE_RECORDER_READY = false;

/**
 * « Conversation » : salon de discussion chiffré et éphémère (V2, pas encore construit).
 * Faux : l'entrée « Créer sur place » porte « Bientôt » et ouvre une feuille d'explication,
 * sans date promise. Vrai : l'entrée ouvrira le salon (à concevoir).
 */
export const CHAT_READY = false;

/**
 * Surveillance de la disparition d'un partage ouvert (spec §41.8, flows/watch.ts) : route
 * GET /api/shares/watch livrée par la Task M2 (étapes 3c et 7b), serveur et faux serveur de
 * la démo. Vrai : Content lance startWatch. Faux : aucune requête de surveillance ;
 * l'interface se ferme quand même au compte à rebours, au refus d'une lecture ou à la
 * destruction faite ici.
 */
export const WATCH_READY = true;
