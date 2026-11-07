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
