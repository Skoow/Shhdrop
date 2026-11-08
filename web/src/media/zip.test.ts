// Lecture et réécriture ZIP (spec §35.2, Task 9b).
import { describe, expect, it } from "vitest";
import { zipBytes } from "../../scripts/gen-fixtures.mjs";
import { DOS_DATE, entryData, isNormalized, readZip, writeZip } from "./zip";

const enc = new TextEncoder();
const blob = (b: Uint8Array) => new Blob([b as Uint8Array<ArrayBuffer>]);

describe("zip.ts", () => {
  it("lit, recopie sans décompresser, remplace sans compression, retire ; dates fixes, sans « extra » ni commentaire", async () => {
    const src = zipBytes([["a.txt", enc.encode("AAAA")], ["b.txt", enc.encode("BBBB"), { store: true }], ["c.txt", enc.encode("CCCC")]], "commentaire");
    const z = await readZip(blob(src));
    expect(z.entries.map((e) => [e.name, e.method])).toEqual([["a.txt", 8], ["b.txt", 0], ["c.txt", 8]]);
    expect(z.commentLength).toBe(11);
    expect(z.entries.some(isNormalized)).toBe(false);
    const out = writeZip(blob(src), z, new Map([["b.txt", enc.encode("bb")], ["c.txt", null]]), "application/zip");
    const z2 = await readZip(out);
    expect(z2.entries.map((e) => e.name)).toEqual(["a.txt", "b.txt"]);
    expect(z2.entries.every(isNormalized)).toBe(true);
    expect(z2.entries.every((e) => e.date === DOS_DATE && e.time === 0)).toBe(true);
    expect(z2.commentLength).toBe(0);
    expect(new TextDecoder().decode(await entryData(out, z2.entries[0]!, 100))).toBe("AAAA");
    expect(new TextDecoder().decode(await entryData(out, z2.entries[1]!, 100))).toBe("bb");
    // Entrée recopiée : mêmes données compressées, même CRC.
    const a1 = z.entries[0]!, a2 = z2.entries[0]!;
    expect(a2.crc).toBe(a1.crc);
    expect(new Uint8Array(await out.slice(a2.dataOffset, a2.dataOffset + a2.csize).arrayBuffer())).toEqual(src.subarray(a1.dataOffset, a1.dataOffset + a1.csize));
  });

  it("refus : nom en double, ZIP64, entrée chiffrée, tronqué, CRC faux, taille au-delà de la borne", async () => {
    await expect(readZip(blob(zipBytes([["a", enc.encode("1")], ["a", enc.encode("2")]])))).rejects.toThrow(/zip_doublon/);
    const ok = zipBytes([["a", enc.encode("1")]]);
    const z64 = ok.slice();
    const cd = ok.length - 22 - (46 + 1 + 9);
    new DataView(z64.buffer).setUint32(cd + 20, 0xffffffff, true);
    await expect(readZip(blob(z64))).rejects.toThrow(/zip64/);
    const crypt = ok.slice();
    crypt[cd + 8] = crypt[cd + 8]! | 1;
    await expect(readZip(blob(crypt))).rejects.toThrow(/zip_chiffre/);
    await expect(readZip(blob(ok.subarray(0, ok.length - 5)))).rejects.toThrow(/malformed/);
    const z = await readZip(blob(ok));
    const bad = ok.slice();
    bad[z.entries[0]!.dataOffset + 5] = 0x32; // octet de données (bloc stocké : en-tête de 5 octets)
    await expect(entryData(blob(bad), z.entries[0]!, 100)).rejects.toThrow(/zip_crc/);
    await expect(entryData(blob(ok), z.entries[0]!, 0)).rejects.toThrow(/zip_trop_gros/);
  });
});
