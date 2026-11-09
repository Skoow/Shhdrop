import { describe, expect, it } from "vitest";
import { composePreview } from "./itemView";

describe("composePreview", () => {
  it("photo, vidéo, son, vocal et note : aperçu ; PDF, SVG, HTML, programme à risque : aucun", () => {
    const f = (mime: string, extra: { risky?: boolean; size?: number } = {}) => composePreview({ kind: "file", mime, size: extra.size ?? 10, risky: extra.risky });
    expect(f("image/jpeg")).toBe("image");
    expect(f("video/mp4")).toBe("video");
    expect(f("audio/webm;codecs=opus")).toBe("audio");
    expect(composePreview({ kind: "text", mime: "text/plain", size: 3 })).toBe("text");
    expect(f("application/pdf")).toBeNull();
    expect(f("image/svg+xml")).toBeNull();
    expect(f("text/html")).toBeNull();
    expect(f("image/jpeg", { risky: true })).toBeNull();
    expect(f("")).toBeNull();
  });
});
