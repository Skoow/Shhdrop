import { describe, expect, it } from "vitest";
import { dragDepth, filesFromDrop, fromPasteEvent } from "./intake";

type FakeItem = { kind: string; getAsFile(): File | null; webkitGetAsEntry?: () => { isDirectory: boolean; name: string } | null };
const fileItem = (f: File, dir = false): FakeItem => ({
  kind: "file",
  getAsFile: () => (dir ? null : f),
  webkitGetAsEntry: () => ({ isDirectory: dir, name: f.name }),
});
const dt = (items: FakeItem[], files: File[] = []) => ({ items, files }) as unknown as DataTransfer;

describe("filesFromDrop", () => {
  it("sépare les dossiers (webkitGetAsEntry) des fichiers, dans l'ordre du dépôt", async () => {
    const a = new File(["a"], "a.txt");
    const b = new File(["b"], "b.txt");
    const r = await filesFromDrop(dt([fileItem(a), fileItem(new File([], "Vacances"), true), fileItem(b), { kind: "string", getAsFile: () => null }]));
    expect(r.files).toEqual([a, b]);
    expect(r.folders).toEqual(["Vacances"]);
  });
  it("sans items : dataTransfer.files", async () => {
    const a = new File(["a"], "a.txt");
    expect((await filesFromDrop(dt([], [a]))).files).toEqual([a]);
  });
});

function paste(data: { files?: File[]; text?: string; html?: string }) {
  return {
    clipboardData: {
      files: data.files ?? [],
      getData: (t: string) => (t === "text/plain" ? (data.text ?? "") : t === "text/html" ? (data.html ?? "") : ""),
    },
  } as unknown as ClipboardEvent;
}

describe("fromPasteEvent", () => {
  it("fichiers → files, native: false, même avec le focus dans un champ", () => {
    const f = new File(["x"], "image.png", { type: "image/png" });
    expect(fromPasteEvent(paste({ files: [f] }), true)).toEqual({ files: [f], text: null, native: false });
    expect(fromPasteEvent(paste({ files: [f] }), false).native).toBe(false);
  });
  it("texte avec focus dans un champ → natif", () => {
    expect(fromPasteEvent(paste({ text: "bonjour" }), true)).toEqual({ files: [], text: null, native: true });
  });
  it("texte hors champ → text brut, jamais text/html", () => {
    expect(fromPasteEvent(paste({ text: "bonjour", html: "<b>bonjour</b>" }), false)).toEqual({ files: [], text: "bonjour", native: false });
    expect(fromPasteEvent(paste({ html: "<img src=x onerror=alert(1)>" }), false)).toEqual({ files: [], text: null, native: false });
  });
});

describe("dragDepth", () => {
  it("ne passe à zéro qu'au dernier dragleave", () => {
    const d = dragDepth();
    expect(d.enter()).toBe(true);
    expect(d.enter()).toBe(true);
    expect(d.leave()).toBe(true);
    expect(d.leave()).toBe(false);
    expect(d.leave()).toBe(false);
    d.enter();
    d.reset();
    expect(d.leave()).toBe(false);
  });
});
