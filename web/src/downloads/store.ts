// Historique des téléchargements (conception compte §21.9, §21.15.5 ; R12). EXCEPTION ÉCRITE à
// « aucun stockage navigateur » (UI §12.1, spec §33, source-rules.test.ts) : sur cet appareil
// seulement, jamais envoyé au serveur ni au compte ; seul ce module tient la base IndexedDB
// `shhdrop-telechargements` (même mécanisme que l'historique des envois, history/store.ts).
// - Chaque entrée est chiffrée AES-256-GCM (WebCrypto), clé créée NON EXTRACTIBLE et gardée
//   dans la base ; nonce aléatoire de 96 bits à chaque écriture ; l'identifiant (tiré au
//   hasard) est la donnée associée. Honnêtement : la clé est sur le même appareil ; ce
//   chiffrement ne protège que d'une lecture naïve du stockage. La vraie protection est le
//   verrouillage de l'appareil.
// - Une entrée ne contient que : le nom nettoyé (safeName), la taille, le format (icône), la
//   source (partage reçu, salon) et l'heure locale de l'enregistrement. JAMAIS le lien, une
//   clé, le mot de passe ni le contenu : tout champ inconnu est ignoré (`clean`). Même format
//   pour les apps (D42-20).
// - Entrées retirées 30 jours après l'enregistrement ; réglage coupé : historique effacé et
//   plus rien n'est écrit.
// Aucune requête réseau ici.
import type { ItemSink } from "../flows/downloads.svelte";
import { idbBackend, type Backend, type Rec } from "../history/store";
import type { Family, Format } from "../ui/formats";

export const DOWNLOADS_DB = "shhdrop-telechargements";
export const DOWNLOADS_KEEP_MS = 30 * 86_400_000;

export type DownloadSource = "partage" | "salon";
export type DownloadEntry = {
  id: string;
  /** Nom nettoyé (safeName) tel qu'enregistré, chiffré au repos. */
  name: string;
  sizeBytes: number;
  /** Format pour l'icône (famille et libellé court). */
  format: Format;
  source: DownloadSource;
  /** Heure locale de l'enregistrement réussi (jamais envoyée). */
  savedAt: number;
};
export type NewDownload = Omit<DownloadEntry, "id">;

/** Base des téléchargements (IndexedDB). */
export const downloadsIdb = (idb: IDBFactory): Backend => idbBackend(idb, DOWNLOADS_DB);

const FAMILIES: Record<Family, true> = {
  pdf: true, doc: true, sheet: true, slides: true, text: true, code: true, archive: true, image: true,
  video: true, audio: true, exec: true, disk: true, font: true, book: true, note: true, file: true,
};
const SOURCES: readonly DownloadSource[] = ["partage", "salon"];
const ID = /^[A-Za-z0-9_-]{22}$/;
const LABEL = /^[A-Z0-9]{0,5}$/;
const NAME_MAX = 1024;
const AAD = "shhdrop/telechargements/v1/";

function clean(x: unknown): DownloadEntry | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  const f = o.format as Record<string, unknown> | null;
  if (typeof o.id !== "string" || !ID.test(o.id)) return null;
  if (typeof o.name !== "string" || o.name.trim() === "" || o.name.length > NAME_MAX) return null;
  if (!Number.isSafeInteger(o.sizeBytes) || (o.sizeBytes as number) < 0) return null;
  if (!Number.isSafeInteger(o.savedAt) || (o.savedAt as number) < 0) return null;
  if (!SOURCES.includes(o.source as DownloadSource)) return null;
  if (typeof f !== "object" || f === null || typeof f.family !== "string" || !Object.hasOwn(FAMILIES, f.family)) return null;
  if (typeof f.label !== "string" || !LABEL.test(f.label)) return null;
  return {
    id: o.id,
    name: o.name,
    sizeBytes: o.sizeBytes as number,
    format: { family: f.family as Family, label: f.label },
    source: o.source as DownloadSource,
    savedAt: o.savedAt as number,
  };
}

export type Downloads = {
  /** Plus récentes d'abord ; les entrées de 30 jours et plus sont retirées. */
  list(): Promise<DownloadEntry[]>;
  /** null : historique coupé (rien n'est écrit). */
  add(e: NewDownload): Promise<DownloadEntry | null>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  enabled(): Promise<boolean>;
  /** Coupé : l'historique existant est effacé. */
  setEnabled(v: boolean): Promise<void>;
};

function randomId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const aad = (id: string) => new TextEncoder().encode(AAD + id);

/** Ouvre l'historique ; `backend` null ou toute erreur de stockage : null. */
export async function openDownloads(deps: { backend: Backend | null; now?: () => number }): Promise<Downloads | null> {
  const now = deps.now ?? Date.now;
  const b = deps.backend;
  if (b === null) return null;
  let key: CryptoKey;
  try {
    const fresh = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    key = await b.key(fresh);
    await b.setFlag("probe", undefined); // stockage en lecture seule ou plein : vu tout de suite
  } catch {
    return null;
  }

  async function open(id: string, r: Rec): Promise<DownloadEntry | null> {
    try {
      if (!ID.test(id) || !(r?.iv instanceof Uint8Array) || !(r.ct instanceof Uint8Array)) return null;
      const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: r.iv, additionalData: aad(id) }, key, r.ct));
      const v = JSON.parse(new TextDecoder().decode(pt)) as Record<string, unknown>;
      pt.fill(0);
      return clean({ ...v, id });
    } catch {
      return null;
    }
  }
  const enabled = async () => (await b.flag("off")) !== true;

  return {
    async list() {
      const t = now();
      const out: DownloadEntry[] = [];
      for (const [id, r] of await b.all()) {
        const e = await open(id, r);
        // Illisible ou enregistré il y a 30 jours ou plus : retiré.
        if (e === null || t - e.savedAt >= DOWNLOADS_KEEP_MS) await b.del(id).catch(() => undefined);
        else out.push(e);
      }
      return out.sort((x, y) => y.savedAt - x.savedAt);
    },
    async add(n) {
      const e = clean({ id: randomId(), name: n.name, sizeBytes: n.sizeBytes, format: n.format, source: n.source, savedAt: n.savedAt });
      if (e === null) throw new Error("entree_invalide");
      if (!(await enabled())) return null;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const { id, ...body } = e;
      const pt = new TextEncoder().encode(JSON.stringify(body));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(id) }, key, pt));
      pt.fill(0);
      await b.put(id, { iv, ct });
      return e;
    },
    remove: (id) => b.del(id),
    clear: () => b.clear(),
    enabled,
    async setEnabled(v) {
      if (!v) await b.clear();
      await b.setFlag("off", v ? undefined : true);
    },
  };
}

/**
 * Puits qui note l'enregistrement une fois `close` réussi (fichier entier écrit et remis au
 * navigateur). Arrêt (`abort`) ou fermeture en échec : rien. Une erreur de l'historique ne fait
 * jamais échouer l'enregistrement.
 */
export function afterSave(sink: ItemSink, onsaved: () => unknown): ItemSink {
  return {
    write: (c) => sink.write(c),
    abort: () => sink.abort(),
    async close() {
      await sink.close();
      try {
        await onsaved();
      } catch {
        // historique indisponible : le fichier est enregistré quand même
      }
    },
  };
}

/** Groupes par jour local, du plus récent au plus ancien : « today », « yesterday », sinon minuit du jour (ms). */
export function byDay<T extends { savedAt: number }>(list: readonly T[], now: number): { day: "today" | "yesterday" | number; items: T[] }[] {
  const midnight = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const today = midnight(now);
  const d = new Date(today);
  const yesterday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime();
  const out: { day: "today" | "yesterday" | number; items: T[] }[] = [];
  for (const e of [...list].sort((a, b) => b.savedAt - a.savedAt)) {
    const m = midnight(e.savedAt);
    const day = m === today ? "today" : m === yesterday ? "yesterday" : m;
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(e);
    else out.push({ day, items: [e] });
  }
  return out;
}
