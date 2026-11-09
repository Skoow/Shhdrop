// Nettoyage des PDF (spec §35.2, Task 9b) sur les fichiers d'essai de scripts/gen-fixtures.mjs.
// pdf.js n'est pas en dépendance : la lisibilité se vérifie par la structure (chaque entrée de
// chaque table xref pointe toujours sur « N G obj », même longueur, texte de page intact).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cleanPdf } from "./pdf";
import { stripMetadata, type StripResult } from "./strip";
import { found } from "./test-markers";

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const MARKERS = ["ReperAuteur", "ReperAncien", "ReperCreateur", "ReperLogiciel", "ReperXMP", "ReperXMPPage", "ReperThumb", "ReperModel", "20010203", "FEFF005200650070"];
const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

async function clean(name: string, bytes: Uint8Array = fx(name)): Promise<{ r: StripResult; out: Uint8Array }> {
  const r = await stripMetadata(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }), "", name);
  return { r, out: r.state === "nettoye" ? new Uint8Array(await r.data.arrayBuffer()) : new Uint8Array(0) };
}

/** Tables xref classiques, lues indépendamment de pdf.ts : [numéro, position]. */
function classicEntries(s: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of s.matchAll(/xref\r?\n([\s\S]*?)trailer/gu)) {
    const lines = m[1]!.trim().split(/\r?\n/u);
    for (let i = 0; i < lines.length; ) {
      const [first, count] = lines[i++]!.trim().split(/\s+/u).map(Number) as [number, number];
      for (let k = 0; k < count; k++, i++) {
        const [off, , t] = lines[i]!.trim().split(/\s+/u);
        if (t === "n") out.push([first + k, Number(off)]);
      }
    }
  }
  return out;
}

describe("PDF (spec §35.2)", () => {
  it("meta.pdf : /Info des deux révisions, XMP du catalogue et de la page, miniature → null ; même longueur ; xref toujours juste", async () => {
    const src = fx("meta.pdf");
    const { r, out } = await clean("meta.pdf");
    expect(r.state).toBe("nettoye");
    if (r.state !== "nettoye") return;
    expect(r.family).toBe("pdf");
    expect(found(src, MARKERS)).toEqual(MARKERS);
    expect(found(out, MARKERS)).toEqual([]);
    expect(out.length).toBe(src.length);
    const s = latin1(out);
    const entries = classicEntries(s);
    expect(entries.length).toBe(10);
    for (const [n, off] of entries) expect(s.slice(off, off + `${n} 0 obj`.length), `objet ${n}`).toBe(`${n} 0 obj`);
    for (const n of [6, 7, 8, 9, 10]) expect(s).toMatch(new RegExp(`\\n${n} 0 obj null +endobj\\n`, "u"));
    // Tout le reste octet pour octet : pages, contenu, police, trailers (/ID compris).
    const diff = [...src].flatMap((b, i) => (b === out[i] ? [] : [i]));
    const neutral = entries.filter(([n]) => n >= 6).map(([n, off]) => [off, s.indexOf("endobj", off)] as const);
    expect(diff.every((i) => neutral.some(([a, b]) => i > a && i < b))).toBe(true);
    expect(s).toContain("(Bonjour Shhdrop) Tj");
    expect(s.match(/\/ID \[<0123456789ABCDEF/gu)?.length).toBe(2);
  });

  it("flux xref (prédicteur PNG 12) : /Info et XMP neutralisés ; /Info dans un flux d'objets → echec", async () => {
    const { r, out } = await clean("xref-stream.pdf");
    expect(r.state).toBe("nettoye");
    expect(found(out, MARKERS)).toEqual([]);
    expect(out.length).toBe(fx("xref-stream.pdf").length);
    expect(latin1(out)).toMatch(/\n7 0 obj null +endobj/u);
    expect((await clean("objstm-info.pdf")).r).toEqual({ state: "echec", reason: "malformed:pdf_info_objstm" });
  });

  it("signé ou chiffré → protege ; sans métadonnées → nettoye sans changement ; sans xref, tronqué → echec", async () => {
    expect((await clean("signed.pdf")).r.state).toBe("protege");
    expect((await clean("encrypted.pdf")).r.state).toBe("protege");
    const once = (await clean("meta.pdf")).out;
    const again = await clean("meta.pdf", once);
    expect(again.r.state).toBe("nettoye");
    expect(again.out).toEqual(once);
    expect(await cleanPdf(new Blob([once as Uint8Array<ArrayBuffer>]))).toEqual({ state: "ok", patches: [] });
    const noXref = new TextEncoder().encode("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
    expect((await clean("a.pdf", noXref)).r.state).toBe("echec");
    const src = fx("meta.pdf");
    expect((await clean("t.pdf", src.subarray(0, src.length >> 1))).r.state).toBe("echec");
    // Table xref décalée d'un octet : l'objet n'est pas là où la table l'annonce → echec.
    const shifted = latin1(src).replace(/(\d{10}) 00000 n/u, (_, o: string) => `${String(Number(o) + 1).padStart(10, "0")} 00000 n`);
    const bytes = (t: string) => new Uint8Array([...t].map((c) => c.charCodeAt(0)));
    expect((await clean("s.pdf", bytes(shifted))).r.state).toBe("echec");
    // Révision détachée de la chaîne (/Prev illisible) : son /Info resterait lisible → echec.
    expect((await clean("p.pdf", bytes(latin1(src).replace("/Prev", "/Pxev")))).r).toEqual({ state: "echec", reason: "malformed:pdf_info_orpheline" });
  });

  it("pièges : 400 troncatures et altérations à graine fixe → jamais d'exception, jamais « nettoye » avec un repère d'/Info", async () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (const n of ["meta.pdf", "xref-stream.pdf"]) {
      const src = fx(n);
      for (let k = 0; k < 200; k++) {
        const b = k % 2 ? src.subarray(0, Math.floor(rnd() * src.length)) : src.slice();
        if (!(k % 2)) for (let j = 0; j < 3; j++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
        const { r, out } = await clean(n, b);
        if (r.state === "nettoye") expect(found(out, ["ReperAuteur", "ReperLogiciel"])).toEqual([]);
      }
    }
  });
});
