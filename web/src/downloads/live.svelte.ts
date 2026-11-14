// État partagé de l'historique des téléchargements pour les écrans (contenu reçu, page
// /telechargements). Ouvre le stockage une fois : IndexedDB en production, mémoire dans la
// démo (origine partagée de GitHub Pages : rien n'y est écrit) ; indisponible → `status:
// "unavailable"`. Une simple visite de la page n'écrit rien tant que rien n'a été enregistré.
// Aucune requête réseau.
import { getDemo } from "../app/demo-hooks";
import { memoryBackend, type Backend } from "../history/store";
import { downloadsIdb, openDownloads, type DownloadEntry, type Downloads, type NewDownload } from "./store";

export const downloads = $state({
  status: "idle" as "idle" | "loading" | "ready" | "unavailable",
  entries: [] as DownloadEntry[],
  /** « Garder l'historique » (activé par défaut, R12). */
  enabled: true,
});

function backend(): Backend | null {
  if (getDemo()) return memoryBackend();
  try {
    const idb = globalThis.indexedDB;
    return idb ? downloadsIdb(idb) : null;
  } catch {
    return null; // accès refusé (navigation privée de certains navigateurs, cadres)
  }
}

let chosen: Backend | null | undefined;
const theBackend = () => (chosen === undefined ? (chosen = backend()) : chosen);
let opening: Promise<Downloads | null> | undefined;
/** Ouvre en créant au besoin (clé, base) : seulement pour écrire. */
function store(): Promise<Downloads | null> {
  return (opening ??= openDownloads({ backend: theBackend() }).catch(() => null));
}

async function reload(d: Downloads): Promise<void> {
  downloads.entries = await d.list();
}

/** Lecture locale, sans rien créer si aucune base n'existe encore. */
export async function loadDownloads(): Promise<void> {
  if (downloads.status === "idle") downloads.status = "loading";
  const b = theBackend();
  if (!b) return void (downloads.status = "unavailable");
  try {
    if (!opening && !(await b.exists())) {
      downloads.entries = [];
      downloads.enabled = true;
      downloads.status = "ready";
      return;
    }
    const d = await store();
    if (!d) return void (downloads.status = "unavailable");
    const [list, enabled] = await Promise.all([d.list(), d.enabled()]);
    downloads.entries = list;
    downloads.enabled = enabled;
    downloads.status = "ready";
  } catch {
    downloads.status = "unavailable";
  }
}

/** Après un enregistrement réussi (afterSave) : rien si l'historique est coupé ou indisponible. */
export async function recordDownload(e: NewDownload): Promise<void> {
  const d = await store();
  if (!d) return;
  try {
    if ((await d.add(e)) && downloads.status === "ready") await reload(d);
  } catch {
    // historique illisible : le fichier est enregistré quand même
  }
}

export async function removeDownload(id: string): Promise<void> {
  const d = await store();
  if (!d) return;
  await d.remove(id).catch(() => undefined);
  await reload(d).catch(() => undefined);
}

export async function clearDownloads(): Promise<void> {
  const d = await store();
  if (!d) return;
  await d.clear().catch(() => undefined);
  await reload(d).catch(() => undefined);
}

export async function setDownloadsEnabled(v: boolean): Promise<void> {
  const d = await store();
  if (!d) return;
  await d.setEnabled(v).catch(() => undefined);
  downloads.enabled = await d.enabled().catch(() => v);
  await reload(d).catch(() => undefined);
}
