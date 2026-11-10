// Task 9c : nettoyage en place des WebM et MKV (spec §35.2) sur les fichiers d'essai de
// scripts/gen-media-fixtures.sh, et sur les enregistrements de Chromium (tailles inconnues).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cleanEbml, voidBytes, vint } from "./ebml";
import { patchedBlob } from "./patch";
import { found, indexOf } from "./test-markers";

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const MARKERS = ["ReperTitre", "ReperArtiste", "ReperComment", "ReperLogiciel", "Lavf", "2001-02-03"];

async function clean(bytes: Uint8Array): Promise<Uint8Array> {
  const src = new Blob([bytes as Uint8Array<ArrayBuffer>]);
  return new Uint8Array(await patchedBlob(src, await cleanEbml(src)).arrayBuffer());
}

describe("WebM et MKV : nettoyage en place", () => {
  for (const name of ["meta.webm", "meta.mkv", "chromium.webm", "chromium-audio.webm"]) {
    it(`${name} : aucun repère, même longueur, rien à refaire au 2e passage`, async () => {
      const src = fx(name);
      const out = await clean(src);
      expect(found(out, MARKERS)).toEqual([]);
      expect(found(out, ["Chrome"])).toEqual([]);
      expect(out.length).toBe(src.length);
      expect(await cleanEbml(new Blob([out as Uint8Array<ArrayBuffer>]))).toEqual([]);
    });
  }

  it("meta.webm : repères présents avant ; MuxingApp « shhdrop » ; données des Cluster identiques", async () => {
    const src = fx("meta.webm");
    expect(found(src, MARKERS).length).toBeGreaterThan(2);
    const out = await clean(src);
    expect(indexOf(out, new TextEncoder().encode("shhdrop"))).toBeGreaterThan(0);
    // Premier Cluster (1F 43 B6 75) et tout ce qui suit jusqu'aux Tags : identiques.
    const c = indexOf(src, new Uint8Array([0x1f, 0x43, 0xb6, 0x75]));
    const tags = indexOf(src, new Uint8Array([0x12, 0x54, 0xc3, 0x67]), c);
    expect(c).toBeGreaterThan(0);
    expect([...out.subarray(c, tags > 0 ? tags : undefined)]).toEqual([...src.subarray(c, tags > 0 ? tags : undefined)]);
  });

  it("Void de toute taille : en-tête valide qui couvre exactement la place", () => {
    for (const n of [2, 3, 8, 9, 10, 127, 128, 200, 70_000]) {
      const v = voidBytes(n);
      expect(v.length).toBe(n);
      expect(v[0]).toBe(0xec);
      const sz = vint(v, 1, false);
      expect(sz.unknown).toBe(false);
      expect(1 + sz.len + sz.value).toBe(n);
    }
  });

  it("pièges : tronqué, en-tête faux, élément qui déborde → Malformed", async () => {
    const src = fx("meta.webm");
    for (const n of [3, 30, 200]) await expect(cleanEbml(new Blob([src.subarray(0, n)]))).rejects.toThrow(/malformed/);
    const bad = new Uint8Array(src);
    bad[0] = 0x00;
    await expect(cleanEbml(new Blob([bad]))).rejects.toThrow(/malformed/);
  });
});
