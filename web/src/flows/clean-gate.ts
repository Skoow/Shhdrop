// Dernier verrou avant le chiffrement (spec §35.2, Q-MD1) : seuls les contenus que le composeur
// a déclarés prêts (nettoyés, sans métadonnées connues, originaux par réglage, ou « Envoyer tel
// quel » choisi) passent le point d'accroche `prepare` de l'envoi anticipé (transfer/draft.ts).
// Un oubli ailleurs ferait échouer l'envoi de l'élément au lieu de l'envoyer en silence.
const ok = new WeakSet<Blob>();

export function approve(b: Blob): void {
  ok.add(b);
}

/** Pour `DraftOpts.prepare` : rend le contenu tel quel s'il est approuvé, échoue sinon. */
export async function gate(b: Blob): Promise<Blob> {
  if (!ok.has(b)) throw new Error("non_nettoye");
  return b;
}
