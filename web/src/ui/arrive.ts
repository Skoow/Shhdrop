// Arrivée d'un écran qui remplace le précédent sans changer de route (« Détruit », « Supprimé »,
// « détruit après 5 essais », pages d'état) : la page remonte en haut et le focus va au titre,
// sans quoi l'écran nouveau reste hors de vue sous le défilement d'avant (audit I4, UI §11).
export function arrive(title: HTMLElement | undefined | null): void {
  if (!title) return;
  if (typeof window !== "undefined" && typeof window.scrollTo === "function") window.scrollTo(0, 0);
  title.focus({ preventScroll: true });
}
