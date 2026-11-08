// Réécriture bornée de XML (spec §35.2, Task 9b).
import { describe, expect, it } from "vitest";
import { decodeXml, qn, rewriteXml, rootTag } from "./xmlattr";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

describe("xmlattr", () => {
  it("attributs remplacés ou retirés par espace de noms, quel que soit le préfixe ; le reste recopié tel quel", () => {
    const src = `<?xml version="1.0"?>\n<!-- c --><x:comments xmlns:x="${W}"><x:comment x:id="0" x:author="Bob" x:date="2001"  x:initials='B'><x:p>a &amp; b</x:p></x:comment><other x:author="Bob"/></x:comments>`;
    const out = rewriteXml(src, [
      { el: qn(W, "comment"), attr: qn(W, "author"), set: "Auteur" },
      { el: qn(W, "comment"), attr: qn(W, "date"), remove: true },
    ]);
    expect(out).toBe(`<?xml version="1.0"?>\n<!-- c --><x:comments xmlns:x="${W}"><x:comment x:id="0" x:author="Auteur" x:initials='B'><x:p>a &amp; b</x:p></x:comment><other x:author="Bob"/></x:comments>`);
    expect(rewriteXml(out, [])).toBe(out);
  });

  it("texte remplacé dans un ancêtre seulement ; élément retiré ; condition sur les attributs", () => {
    const src = `<r xmlns:dc="d" xmlns:o="o"><o:annotation><dc:creator>Bob <b/>x</dc:creator><dc:date>2001</dc:date></o:annotation><dc:creator>Garde</dc:creator><e k="1"/><e k="2"></e></r>`;
    const out = rewriteXml(src, [
      { el: qn("d", "creator"), within: qn("o", "annotation"), text: "Auteur" },
      { el: qn("d", "date"), drop: true },
      { el: qn("", "e"), when: (a) => a.get("k") === "2", drop: true },
    ]);
    expect(out).toBe(`<r xmlns:dc="d" xmlns:o="o"><o:annotation><dc:creator>Auteur</dc:creator></o:annotation><dc:creator>Garde</dc:creator><e k="1"/></r>`);
  });

  it("mal formé → Malformed : déséquilibre, deux racines, DOCTYPE, attribut en double, préfixe inconnu, guillemet ouvert", () => {
    for (const bad of ["<a><b></a>", "<a/><b/>", '<!DOCTYPE a [<!ENTITY x "y">]><a/>', '<a k="1" k="2"/>', "<p:a/>", '<a k="1/>', "<a>", "texte<a/>"]) {
      expect(() => rewriteXml(bad, []), bad).toThrow(/malformed/);
    }
  });

  it("rootTag, decodeXml (UTF-8 strict, UTF-16 refusé)", () => {
    expect(rootTag('<?xml version="1.0"?><o:d xmlns:o="u" o:version="1.3"><x/></o:d>')).toEqual({ name: "o:d", attrs: [{ name: "xmlns:o", value: "u" }, { name: "o:version", value: "1.3" }] });
    expect(() => decodeXml(new Uint8Array([0xff, 0xfe, 0x3c, 0]))).toThrow(/malformed/);
    expect(() => decodeXml(new Uint8Array([0x3c, 0xc3]))).toThrow(/malformed/);
    expect(() => decodeXml(new TextEncoder().encode('<?xml version="1.0" encoding="ISO-8859-1"?><a/>'))).toThrow(/malformed/);
  });
});
