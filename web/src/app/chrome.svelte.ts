// État d'interface partagé entre les écrans et la coque (aucun secret) : composeur rempli ;
// `report` : ouvre la confirmation de signalement du partage affiché (page d'un partage ouvert,
// retours UI7), sinon null et le lien « Signaler » du pied de page mène à la page « Signaler un abus ».
export const chrome = $state<{ composing: boolean; report: (() => void) | null }>({ composing: false, report: null });
