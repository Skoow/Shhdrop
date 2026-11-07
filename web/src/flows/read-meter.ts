// Estimation, côté page, du budget de lecture de l'ouverture (spec §24, M1 ; §41.4) : le
// serveur sert au plus 2 × le fichier chiffré du palier + 2 segments 0 à une ouverture, puis
// répond 429 « budget » (ReadBudgetError) jusqu'à la fin du jeton. La page s'en sert pour ne
// proposer un nouvel essai, un redémarrage ou un aperçu que s'il tient dans ce qui reste.
//
// Majorant volontaire (jamais moins que la réalité) :
// - le lecteur actuel ne garde qu'un segment en cache, la lecture monotone de la Task M2
//   (spec §36 S9) lit en plus les segments sautés : on compte donc, pour un élément plus loin
//   que tout ce qui a été lu, tous les segments depuis le dernier lu ;
// - sans reprise au segment (`resumable` faux, client actuel), un nouvel essai relit
//   l'élément depuis son début ;
// - une lecture interrompue est comptée entière, et le cache est alors supposé vide ;
// - les nouveaux essais internes du transport (un par segment) ne sont pas vus d'ici : le
//   serveur reste seul juge (ReadBudgetError), la page l'affiche alors sans proposer d'essai.
import { CHUNK, SEG_CHUNKS, bucketFor, segmentCount, segmentSize } from "../index";

export type MeterEntry = { kind: "file" | "text"; offset: number; size: number };

export type ReadMeter = {
  /** Octets chiffrés que coûterait la lecture de l'élément i à partir de l'octet `from`. */
  cost(i: number, from?: number): number;
  /** La lecture tient-elle dans ce qui reste du budget ? */
  canRead(i: number, from?: number): boolean;
  /** Lecture commencée : comptée tout de suite, entière (majorant). */
  charge(i: number, from?: number): void;
  /** Lecture interrompue : on ne sait plus quel segment est en cache. */
  interrupted(): void;
  readonly used: number;
  readonly budget: number;
};

export function createReadMeter(items: readonly MeterEntry[], opts: { resumable?: boolean } = {}): ReadMeter {
  const dataEnd = Math.max(0, ...items.map((e) => (e.kind === "file" ? e.offset + e.size : 0)));
  const bucket = bucketFor(dataEnd);
  const segs = segmentCount(bucket);
  const last = segs - 1;
  let fileBytes = 0;
  for (let n = 0; n < segs; n++) fileBytes += segmentSize(bucket, n);
  const budget = 2 * fileBytes + 2 * segmentSize(bucket, 0);
  const segOf = (p: number) => Math.floor(Math.floor(p / CHUNK) / SEG_CHUNKS);

  // À l'ouverture : segment 0 (en-tête), puis le dernier (manifeste), qui reste en cache.
  let used = segmentSize(bucket, 0) + (last > 0 ? segmentSize(bucket, last) : 0);
  let cached = last;
  let highest = -1; // plus haut segment de données lu (la lecture monotone repart de 0)

  function span(i: number, from: number): [number, number] | null {
    const e = items[i];
    if (!e || e.kind !== "file" || e.size === 0) return null;
    const start = e.offset + (opts.resumable ? Math.min(Math.max(0, from), e.size - 1) : 0);
    const a = segOf(start);
    const b = segOf(e.offset + e.size - 1);
    let lo = a > highest ? highest + 1 : a;
    if (lo === cached) lo++;
    return lo > b ? [b + 1, b] : [lo, b];
  }
  function cost(i: number, from = 0): number {
    const s = span(i, from);
    if (!s) return 0;
    let c = 0;
    for (let n = s[0]; n <= s[1]; n++) c += segmentSize(bucket, n);
    return c;
  }
  return {
    cost,
    canRead: (i, from = 0) => used + cost(i, from) <= budget,
    charge(i, from = 0) {
      const s = span(i, from);
      if (!s) return;
      used += cost(i, from);
      highest = Math.max(highest, s[1]);
      cached = s[1];
    },
    interrupted() {
      cached = -1;
    },
    get used() {
      return used;
    },
    get budget() {
      return budget;
    },
  };
}
