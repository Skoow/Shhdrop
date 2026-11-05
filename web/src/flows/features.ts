// Fonctions en attente d'un autre chantier, derrière un drapeau (rien n'est promis à l'écran).
/**
 * Enregistreur de mémos vocaux (media/recorder.ts, ui/VoiceRecorder.svelte, autre agent).
 * Faux : la feuille « Mémo vocal » dit qu'il arrive bientôt. Vrai : elle héberge
 * <VoiceRecorder onrecorded={(file) => …} /> (branchement prévu dans Compose.svelte).
 */
export const VOICE_RECORDER_READY = false;
