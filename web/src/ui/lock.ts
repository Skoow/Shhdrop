// Cadenas d'état par élément (D41-25) : un visuel rassurant qui reste toujours VRAI.
// Envoi : vert seulement quand le brouillon a reçu la confirmation du serveur pour tous les
// segments de l'élément (phase « pret », transfer/draft.ts). Réception : vert seulement quand la
// lecture entière de l'élément a réussi (chaque morceau authentifié par AES-GCM, sinon la lecture
// échoue) ou, pour un texte, quand le manifeste a été déchiffré et authentifié à l'ouverture.
import type { RowStatus } from "../flows/preupload";
import type { RowState } from "../flows/downloads.svelte";

export type LockTone = "wait" | "ok" | "error";

export function sendLock(st: RowStatus | null) {
  if (!st) return null;
  const tone: LockTone = st.key === "compose.up.pret" ? "ok" : st.key === "compose.up.erreur" ? "error" : "wait";
  return { tone, key: st.key, n: st.percent };
}

export function receiveLock(kind: "file" | "text", state: RowState) {
  if (kind === "text" || state === "done") return { tone: "ok" as LockTone, key: "lock.recv.ok" as const };
  if (state === "failed") return { tone: "error" as LockTone, key: "lock.recv.error" as const };
  return null; // pas encore lu : aucune affirmation

}
