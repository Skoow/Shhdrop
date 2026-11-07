import { afterEach, describe, expect, it, vi } from "vitest";
import { TYPE_SUR, liveUrls, revoke, revokeAll, safeBlobType, trackUrl } from "./blobs";

describe("safeBlobType (UI §9.8)", () => {
  it("image : liste blanche seulement ; HTML ou SVG déclarés image → null", () => {
    expect(safeBlobType("image", "image/png")).toBe("image/png");
    expect(safeBlobType("image", "IMAGE/JPEG; x=1")).toBe("image/jpeg");
    for (const m of ["text/html", "image/svg+xml", "application/xhtml+xml", "", "image/x-icon"]) expect(safeBlobType("image", m), m).toBeNull();
    expect(TYPE_SUR.image).not.toContain("image/svg+xml");
  });
  it("vidéo : video/quicktime gardé ; type inconnu → video/mp4 ; audio inconnu → audio/mp4", () => {
    expect(safeBlobType("video", "video/quicktime")).toBe("video/quicktime");
    expect(safeBlobType("video", "video/webm")).toBe("video/webm");
    expect(safeBlobType("video", "text/html")).toBe("video/mp4");
    expect(safeBlobType("audio", "audio/ogg")).toBe("audio/ogg");
    expect(safeBlobType("audio", "text/html")).toBe("audio/mp4");
  });
  it("none, text, pdf → null", () => {
    for (const k of ["none", "text", "pdf"] as const) expect(safeBlobType(k, "image/png"), k).toBeNull();
  });
});

describe("trackUrl / revoke / revokeAll", () => {
  afterEach(() => vi.restoreAllMocks());
  it("chaque URL créée est révoquée une fois", () => {
    let n = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:x/${n++}`);
    const revoked: string[] = [];
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((u) => void revoked.push(u));
    const a = trackUrl(new Blob(["a"]));
    trackUrl(new Blob(["b"]));
    trackUrl(new Blob(["c"]));
    revoke(a);
    revoke(a); // déjà révoquée : sans effet
    expect(liveUrls()).toBe(2);
    revokeAll();
    expect(liveUrls()).toBe(0);
    expect(revoked).toEqual(["blob:x/0", "blob:x/1", "blob:x/2"]);
    revokeAll();
    expect(revoked).toHaveLength(3);
  });
});
