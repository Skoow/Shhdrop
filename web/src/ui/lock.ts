// Cadenas d'état par élément (D41-25, placement UI5) : un visuel rassurant qui reste toujours
// VRAI, en pastille sur le coin bas-droit de l'icône de format de CHAQUE ligne.
// Envoi : gris tant que rien n'est confirmé ; vert fermé avec coche seulement quand le brouillon
// a reçu la confirmation du serveur pour tous les segments de l'élément (phase « pret »,
// transfer/draft.ts) ; un texte reste gris (« Chiffré à l'envoi » : il part dans le manifeste).
// Réception : gris fermé tant que l'élément n'est pas lu ; vert OUVERT seulement quand la lecture
// entière a réussi (chaque morceau authentifié par AES-GCM, sinon la lecture échoue) ou, pour un
// texte, quand le manifeste a été déchiffré et authentifié à l'ouverture ; rouge en échec.
import type { RowStatus } from "../flows/preupload";
import type { RowState } from "../flows/downloads.svelte";

/** wait : fermé gris ; ok : fermé vert avec coche (envoi) ; open : ouvert vert (reçu) ; error : rouge. */
export type LockTone = "wait" | "ok" | "open" | "error";

export function sendLock(st: RowStatus | null, kind: "file" | "text" = "file") {
  if (kind === "text") return { tone: "wait" as LockTone, key: "lock.send.text" as const, n: 0 };
  if (!st) return { tone: "wait" as LockTone, key: "compose.up.attente" as const, n: 0 };
  const tone: LockTone = st.key === "compose.up.pret" ? "ok" : st.key === "compose.up.erreur" ? "error" : "wait";
  return { tone, key: st.key, n: st.percent };
}

export function receiveLock(kind: "file" | "text", state: RowState) {
  if (kind === "text" || state === "done") return { tone: "open" as LockTone, key: "lock.recv.ok" as const };
  if (state === "failed") return { tone: "error" as LockTone, key: "lock.recv.error" as const };
  return { tone: "wait" as LockTone, key: "lock.recv.wait" as const }; // pas encore lu : toujours chiffré
}
