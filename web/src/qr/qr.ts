// QR du lien de partage (UI §9.5, §20.2 S7) : matrice uqr (correction M), dessinée en un seul
// chemin SVG (M h v z) avec une zone de silence de 4 modules. Le QR contient la clé du lien :
// il n'est montré qu'à la demande, et jamais avec le mot de passe.
import { encode } from "uqr";

export const QUIET = 4;

export function qrMatrix(text: string): boolean[][] {
  return encode(text, { ecc: "M", border: 0 }).data;
}

/** `size` : côté en modules, zone de silence comprise ; `d` : un carré par module sombre. */
export function qrPath(text: string): { size: number; d: string } {
  const m = qrMatrix(text);
  let d = "";
  for (let y = 0; y < m.length; y++)
    for (let x = 0; x < m[y]!.length; x++) if (m[y]![x]) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
  return { size: m.length + 2 * QUIET, d };
}
