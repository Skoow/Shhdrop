// Seul point d'entrée du moteur pour le banc : la Task 13 ne réécrit que ce fichier (et
// vite.config.ts si le chargement du moteur change). bench.ts ne connaît que l'interface neutre
// ci-dessous ; tout l'assemblage propre au moteur actuel (pièces, segments, en-tête, manifeste)
// vit ici.
import { CHUNK_CT, HEADER, SEG_CHUNKS, openStream, segmentSize } from "../src/crypto/container";
import { elementSealer, sealFinal } from "../src/crypto/elements";
import { contentKeys, newSeed, type ContentKeys } from "../src/crypto/envelope";
import { KDF_CREATE, passwordKey } from "../src/crypto/kdf";

/** Paquet chiffré en mémoire : un seul élément (le Blob donné), prêt à être rouvert. */
export type Packet = { readonly size: number; bucket: number; keys: ContentKeys; segments: Map<number, Uint8Array<ArrayBuffer>> };

/**
 * Chiffre `data` comme un envoi d'un seul fichier. Copies incluses dans le temps mesuré :
 * seulement celles du moteur (lecture du Blob par tranches de 4 Mio) ; les segments pleins sont
 * gardés tels quels, seul le segment du manifeste est alloué ici (au plus 4 Mio), avec
 * sealFinal (un seul morceau).
 */
export async function sealPacket(data: Blob): Promise<Packet> {
  const el = await elementSealer(data, 0);
  const segments = new Map<number, Uint8Array<ArrayBuffer>>();
  for (const [j, p] of el.pieces.entries()) {
    const b = await el.piece(j);
    const pre = p.seg === 0 ? HEADER : 0;
    if (p.from === 0 && p.chunks === SEG_CHUNKS) segments.set(p.seg, b); // segment plein : aucune copie
    else {
      let s = segments.get(p.seg);
      if (!s) segments.set(p.seg, (s = new Uint8Array(pre + SEG_CHUNKS * CHUNK_CT)));
      s.set(b, pre + p.from * CHUNK_CT - (p.seg === 0 && p.from === 0 ? HEADER : 0));
    }
  }
  const keys = await contentKeys(newSeed());
  const fin = await sealFinal([{ kind: "file", name: "bench.bin", mime: "application/octet-stream", size: data.size, first: 0, k: el.k }], keys, {});
  const n = Math.floor((fin.bucket - 1) / SEG_CHUNKS);
  let last = segments.get(n);
  if (!last) segments.set(n, (last = new Uint8Array(segmentSize(fin.bucket, n))));
  last.set(fin.tail, (n === 0 ? HEADER : 0) + ((fin.bucket - 1) % SEG_CHUNKS) * CHUNK_CT);
  segments.get(0)!.set(fin.header, 0);
  return { size: data.size, bucket: fin.bucket, keys, segments };
}

/**
 * Rouvre le paquet et rend le clair de l'élément, en tranches dans l'ordre (non concaténées :
 * la concaténation n'est pas du moteur). Copie inhérente : le lecteur met à zéro ce qu'il reçoit,
 * donc chaque segment lui est donné en copie.
 */
export async function openPacket(p: Packet): Promise<Uint8Array[]> {
  const rd = await openStream(
    async (k) => {
      const s = p.segments.get(k);
      return s ? new Uint8Array(s) : new Uint8Array(segmentSize(p.bucket, k));
    },
    p.bucket,
    p.keys,
  );
  if (rd.manifest.items.length !== 1) throw new Error("manifeste inattendu");
  const parts: Uint8Array[] = [];
  await rd.streamItem(0, (c) => {
    parts.push(c);
  });
  return parts;
}

/** Argon2id avec les paramètres de création d'un partage (exécuté comme sur le site). */
export async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<unknown> {
  return passwordKey(password, salt, KDF_CREATE);
}
