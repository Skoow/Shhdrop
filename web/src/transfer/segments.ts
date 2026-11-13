// Lecture des segments chiffrés d'une ouverture (destinataire) : lecture d'avance bornée et
// segments gardés de l'ouverture. Rien que du chiffré : le moteur copie chaque segment rendu
// (Uint8Array.to_vec) et l'efface lui-même. Module interne : l'interface publique est src/index.ts.
//
// - A4 : les segments 0 (en-tête) et du manifeste (dernier du palier) sont lus ensemble dès le
//   déverrouillage (`preload`), au lieu de l'un après l'autre.
// - A3 : ces deux segments sont gardés pendant l'ouverture, puis rendus une fois chacun au
//   lecteur (le moteur n'en garde qu'un en cache) ; ceux qui restent sont lâchés à la fin du
//   premier enregistrement (`releaseKept`) ou à l'effacement (`clear`).
// - A2 : pendant la lecture d'un élément (`within`), la demande du segment n lance celle des
//   segments n + 1 à n + READ_AHEAD, sans dépasser le dernier segment de l'élément (aucune
//   lecture inutile : le budget de lecture de l'ouverture n'est pas entamé pour rien). En
//   mémoire : au plus READ_AHEAD segments d'avance (4 Mio chacun), plus les deux gardés.

type Seg = Uint8Array<ArrayBuffer>;

/** Segments lus d'avance au plus (le serveur accepte 4 lectures simultanées par ouverture). */
export const READ_AHEAD = 2;

export type SegmentSource = {
  /** Segment n pour le lecteur du moteur. */
  get(n: number): Promise<Seg>;
  /** Lance tout de suite la lecture de ces segments et les garde (ouverture). */
  preload(ns: readonly number[]): void;
  /** Fin de l'ouverture : chaque segment gardé ne sera plus rendu qu'une fois. */
  endOpen(): void;
  /** Lit l'élément dont les segments vont de `first` à `last` (lecture d'avance), un à la fois. */
  within<T>(first: number, last: number, f: () => Promise<T>): Promise<T>;
  /** Fin d'un enregistrement : les segments gardés qui restent sont lâchés. */
  releaseKept(): void;
  /** Lâche tout (lectures d'avance et segments gardés). */
  clear(): void;
};

/** Efface un segment jamais rendu au moteur, une fois arrivé (une erreur est ignorée). */
const zeroLater = (p: Promise<Seg>) => void p.then((s) => s.fill(0), () => undefined);

export function segmentSource(fetchOne: (n: number) => Promise<Seg>): SegmentSource {
  const kept = new Map<number, { p: Promise<Seg>; given: boolean }>();
  const ahead = new Map<number, Promise<Seg>>();
  let opening = true;
  let limit = -1; // dernier segment de l'élément en cours de lecture ; -1 : pas de lecture d'avance
  let tail: Promise<unknown> = Promise.resolve();

  const start = (n: number) => {
    const p = fetchOne(n);
    p.catch(() => undefined); // une lecture d'avance jamais demandée n'est pas une erreur ; demandée, elle la rend
    return p;
  };
  const dropKept = () => {
    for (const k of kept.values()) if (!k.given) zeroLater(k.p);
    kept.clear();
  };
  const dropAhead = (keep?: (n: number) => boolean) => {
    for (const [n, p] of ahead)
      if (!keep?.(n)) {
        zeroLater(p);
        ahead.delete(n);
      }
  };

  return {
    preload(ns) {
      for (const n of ns) if (!kept.has(n)) kept.set(n, { p: start(n), given: false });
    },
    endOpen() {
      opening = false;
    },
    get(n) {
      const k = kept.get(n);
      if (k !== undefined) {
        if (opening) k.given = true;
        else kept.delete(n);
        return k.p;
      }
      let p = ahead.get(n);
      ahead.delete(n);
      // Lecture hors de la fenêtre d'avance (autre élément, retour en arrière) : avance lâchée.
      dropAhead((m) => m > n && m <= n + READ_AHEAD);
      p ??= fetchOne(n);
      for (let m = n + 1; m <= Math.min(n + READ_AHEAD, limit); m++) if (!ahead.has(m) && !kept.has(m)) ahead.set(m, start(m));
      return p;
    },
    within(first, last, f) {
      const run = async () => {
        limit = last >= first ? last : -1;
        try {
          return await f();
        } finally {
          limit = -1;
          dropAhead();
        }
      };
      const r = tail.then(run, run);
      tail = r.catch(() => undefined);
      return r;
    },
    releaseKept: dropKept,
    clear() {
      dropKept();
      dropAhead();
    },
  };
}
