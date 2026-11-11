// Fournisseur WebCrypto du moteur WebAssembly (spec moteur §5) : l'aléa et l'AES-256-GCM du site.
//
// - Clés importées non extractibles ; la table poignée → CryptoKey vit ici, jamais dans le
//   moteur. Une clé n'entre dans la table qu'au retour de importKey : un import abandonné ne
//   laisse rien à oublier. Les poignées ne sont jamais réutilisées.
// - Les octets reçus du moteur sont des copies JavaScript à nous (le moteur efface lui-même la
//   clé brute, l'aléa et le clair après usage) ; les morceaux d'un lot sont chiffrés ou
//   déchiffrés en parallèle (Promise.all), comme l'ancien moteur.
// - Un lot refusé (un seul tag faux) ne rend rien : les clairs déjà obtenus sont effacés.
import type { Provider } from "./pkg/shhdrop_wasm.js";

const NONCE = 12;

/** Fournisseur, plus le nombre de clés tenues (tests : toute clé est oubliée). */
export type WebCryptoProvider = Provider & { held(): number };

// Les tableaux du moteur sont des Uint8Array sur ArrayBuffer (jamais partagé) : BufferSource.
type Bytes = Uint8Array<ArrayBuffer>;

export function createProvider(): WebCryptoProvider {
  const table = new Map<number, CryptoKey>();
  let next = 0;
  const key = (h: number): CryptoKey => {
    const k = table.get(h);
    if (!k) throw new Error("cle_inconnue");
    return k;
  };
  const gcm = (nonces: Uint8Array, i: number, ad: Uint8Array) =>
    ({ name: "AES-GCM", iv: (nonces as Bytes).subarray(i * NONCE, (i + 1) * NONCE), additionalData: ad as Bytes, tagLength: 128 }) as const;

  return {
    random(n: number): Uint8Array {
      const b = new Uint8Array(n);
      crypto.getRandomValues(b);
      return b;
    },

    async aesImport(raw: Uint8Array): Promise<number> {
      const k = await crypto.subtle.importKey("raw", raw as Bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
      const h = next++;
      table.set(h, k);
      return h;
    },

    async aesSealBatch(h: number, ad: Uint8Array, nonces: Uint8Array, plain: Uint8Array, chunk: number): Promise<ArrayBuffer[]> {
      const k = key(h);
      const p = plain as Bytes;
      return Promise.all(Array.from({ length: nonces.length / NONCE }, (_, i) => crypto.subtle.encrypt(gcm(nonces, i, ad), k, p.subarray(i * chunk, (i + 1) * chunk))));
    },

    async aesOpenBatch(h: number, ad: Uint8Array, nonces: Uint8Array, cipher: Uint8Array, chunkCt: number): Promise<ArrayBuffer[]> {
      const k = key(h);
      const c = cipher as Bytes;
      const res = await Promise.allSettled(
        Array.from({ length: nonces.length / NONCE }, (_, i) => crypto.subtle.decrypt(gcm(nonces, i, ad), k, c.subarray(i * chunkCt, (i + 1) * chunkCt))),
      );
      const out: ArrayBuffer[] = [];
      for (const r of res) if (r.status === "fulfilled") out.push(r.value);
      if (out.length !== res.length) {
        for (const b of out) new Uint8Array(b).fill(0);
        throw new Error("paquet_corrompu");
      }
      return out;
    },

    aesDrop(h: number): void {
      table.delete(h);
    },

    held: () => table.size,
  };
}
