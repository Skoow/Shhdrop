// État d'interface partagé entre les écrans et la coque (aucun secret) : composeur rempli ;
// `report` : ouvre la confirmation de signalement du partage affiché (page d'un partage ouvert,
// retours UI7), sinon null et le lien « Signaler » du pied de page mène à la page « Signaler un abus ».
// `add` : gestes du composeur monté (menu « Partager » de la barre du haut, refonte du 12
// novembre) ; null hors de l'accueil et de la page d'envoi. `pending` : geste choisi ailleurs,
// joué par le composeur à son montage sur la page d'envoi.
export type AddGesture = "fichiers" | "texte" | "vocal" | "media";
export const chrome = $state<{ composing: boolean; report: (() => void) | null; add: ((g: AddGesture) => void) | null; pending: AddGesture | null }>({
  composing: false,
  report: null,
  add: null,
  pending: null,
});
