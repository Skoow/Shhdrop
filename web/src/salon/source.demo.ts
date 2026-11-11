// Démo GitHub Pages : pas de salon (il lui faut le serveur ; sa CSP, connect-src 'none',
// interdit en plus de lire un .wasm). Aucun module du salon n'est émis ni intégré à la démo.
export async function salonWasmBytes(): Promise<ArrayBuffer> {
  throw new Error("salon_indisponible");
}
