// Plusieurs onglets du même navigateur (spec §41.4, UI §9.7.1) : le stockage d’onglet n’est pas
// partagé entre onglets. Un nouvel onglet ouvert avec le lien demande sur un BroadcastChannel
// (même origine seulement) si un autre onglet détient EN MÉMOIRE un octroi valable pour ce
// partage, désigné par une étiquette (SHA-256(K_accès) tronqué à 16 octets) : jamais K_lien,
// jamais le mot de passe. L'onglet qui répond n'écrit rien ; celui qui reçoit l'octroi
// ressaisit le mot de passe, et n'écrit son propre octroi qu'après le déverrouillage.

export const TABS_CHANNEL = "shhdrop-og";
export const ASK_MS = 400;

const TAG = /^[A-Za-z0-9_-]{22}$/;
const NONCE = /^[A-Za-z0-9_-]{22}$/;
const GRANT = /^[A-Za-z0-9_-]{54}$/;

type Chan = Pick<BroadcastChannel, "postMessage" | "close"> & {
  onmessage: ((ev: MessageEvent) => void) | null;
};
export type ChannelFactory = (name: string) => Chan | null;

const defaultChannel: ChannelFactory = (name) => {
  try {
    return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(name);
  } catch {
    return null;
  }
};

function nonce(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Octroi détenu par un autre onglet pour `tag`, ou null après `ms` sans réponse. */
export function askOtherTabs(tag: string, ms = ASK_MS, open: ChannelFactory = defaultChannel): Promise<string | null> {
  if (!TAG.test(tag)) return Promise.resolve(null);
  const ch = open(TABS_CHANNEL);
  if (ch === null) return Promise.resolve(null);
  const r = nonce();
  return new Promise((resolve) => {
    const finish = (g: string | null) => {
      clearTimeout(timer);
      ch.onmessage = null;
      ch.close();
      resolve(g);
    };
    const timer = setTimeout(() => finish(null), ms);
    ch.onmessage = (ev) => {
      const m = ev.data as Record<string, unknown> | null;
      if (m && m.t === "have" && m.r === r && typeof m.grant === "string" && GRANT.test(m.grant)) finish(m.grant);
    };
    ch.postMessage({ t: "want", r, tag });
  });
}

/** Répond aux demandes des autres onglets avec getGrant(tag) (octroi en mémoire, ou null). */
export function answerOtherTabs(getGrant: (tag: string) => string | null, open: ChannelFactory = defaultChannel): () => void {
  const ch = open(TABS_CHANNEL);
  if (ch === null) return () => undefined;
  ch.onmessage = (ev) => {
    const m = ev.data as Record<string, unknown> | null;
    if (!m || m.t !== "want" || typeof m.r !== "string" || !NONCE.test(m.r) || typeof m.tag !== "string" || !TAG.test(m.tag)) return;
    const g = getGrant(m.tag);
    if (g !== null && GRANT.test(g)) ch.postMessage({ t: "have", r: m.r, grant: g });
  };
  return () => {
    ch.onmessage = null;
    ch.close();
  };
}
