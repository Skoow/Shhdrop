// CRC-32 (polynôme réfléchi 0xEDB88320, celui de ZIP) : contrôle d'intégrité de l'archive
// .zip, jamais de la cryptographie (spec §41.6). Tables « par tranches de 8 » : environ un
// octet par opération, assez pour plusieurs Gio sans bloquer longtemps entre deux tranches.

const T: Uint32Array[] = (() => {
  const t = Array.from({ length: 8 }, () => new Uint32Array(256));
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[0]![n] = c >>> 0;
  }
  for (let n = 0; n < 256; n++) {
    let c = t[0]![n]!;
    for (let s = 1; s < 8; s++) {
      c = t[0]![c & 0xff]! ^ (c >>> 8);
      t[s]![n] = c >>> 0;
    }
  }
  return t;
})();

/**
 * CRC-32 de `bytes`, en continuant depuis `seed` (le CRC des octets précédents ; 0 au début).
 * crc32("123456789") === 0xCBF43926.
 */
export function crc32(bytes: Uint8Array, seed = 0): number {
  const [t0, t1, t2, t3, t4, t5, t6, t7] = T as [Uint32Array, Uint32Array, Uint32Array, Uint32Array, Uint32Array, Uint32Array, Uint32Array, Uint32Array];
  let c = ~seed >>> 0;
  let i = 0;
  const n = bytes.length;
  for (; i + 8 <= n; i += 8) {
    const a = (c ^ (bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24))) >>> 0;
    c =
      t7[a & 0xff]! ^
      t6[(a >>> 8) & 0xff]! ^
      t5[(a >>> 16) & 0xff]! ^
      t4[a >>> 24]! ^
      t3[bytes[i + 4]!]! ^
      t2[bytes[i + 5]!]! ^
      t1[bytes[i + 6]!]! ^
      t0[bytes[i + 7]!]!;
  }
  for (; i < n; i++) c = t0[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}
