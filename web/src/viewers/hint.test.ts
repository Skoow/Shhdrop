import { describe, expect, it } from "vitest";
import { extLabel, otherBrowser } from "./hint";

describe("autre navigateur à essayer", () => {
  it("HEIC et MOV → Safari ; WebM, Ogg, MKV, FLAC → Chrome ou Firefox ; le reste → rien", () => {
    expect(["IMG_1.HEIC", "a.heif", "v.mov"].map(otherBrowser)).toEqual(["safari", "safari", "safari"]);
    expect(["a.webm", "a.ogg", "a.opus", "a.mkv", "a.flac"].map(otherBrowser)).toEqual(["chrome", "chrome", "chrome", "chrome", "chrome"]);
    expect(["a.jpg", "a.mp4", "sans", ".heic"].map(otherBrowser)).toEqual([null, null, null, null]);
    expect(extLabel("IMG_1.heic")).toBe("HEIC");
  });
});
