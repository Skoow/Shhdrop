import { describe, expect, it } from "vitest";
import { categoryOf, categoryOfReceived } from "./kinds";

describe("categoryOfReceived (UI §9.8) : mêmes groupes qu'à l'envoi", () => {
  it("visionneuse d'abord, puis extension du nom nettoyé", () => {
    expect(categoryOfReceived("text", "text", "Texte 1", "text/plain")).toBe("texte");
    expect(categoryOfReceived("file", "image", "a.jpg", "")).toBe("photos");
    expect(categoryOfReceived("file", "video", "a.mov", "")).toBe("videos");
    expect(categoryOfReceived("file", "audio", "a.ogg", "")).toBe("audio");
    expect(categoryOfReceived("file", "pdf", "a.pdf", "")).toBe("documents");
    // previewKind « none » (SVG, HTML, plus de 200 Mio) : le groupe de l'envoi, par l'extension.
    for (const [n, mime] of [["trap.svg", "image/svg+xml"], ["trap.html", "text/html"], ["big.mp4", "video/mp4"], ["a.zip", "application/zip"], ["x.exe", ""]] as const) {
      expect(categoryOfReceived("file", "none", n, mime), n).toBe(categoryOf("file", n, mime));
    }
  });
});
