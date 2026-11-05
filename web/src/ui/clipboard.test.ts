import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function load() {
  vi.resetModules();
  return import("./clipboard");
}
afterEach(() => vi.unstubAllGlobals());

describe("copyText", () => {
  it("writeText résout -> « copied »", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { copyText } = await load();
    expect(await copyText("abc")).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("abc");
  });
  it("writeText rejette -> « manual »", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const { copyText } = await load();
    expect(await copyText("abc")).toBe("manual");
  });
  it("writeText lève de façon synchrone -> « manual »", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: () => {
          throw new Error("x");
        },
      },
    });
    const { copyText } = await load();
    expect(await copyText("abc")).toBe("manual");
  });
  it("API absente -> « manual »", async () => {
    vi.stubGlobal("navigator", {});
    const { copyText } = await load();
    expect(await copyText("abc")).toBe("manual");
  });
});

describe("clearClipboard", () => {
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
  });
  it("n'efface rien si cette page n'a rien copié", async () => {
    const { clearClipboard } = await load();
    await clearClipboard();
    expect(writeText).not.toHaveBeenCalled();
  });
  it("efface après une copie réussie, une seule fois, sans jamais lever", async () => {
    const { copyText, clearClipboard } = await load();
    await copyText("secret");
    await clearClipboard();
    expect(writeText).toHaveBeenLastCalledWith("");
    writeText.mockClear();
    await clearClipboard();
    expect(writeText).not.toHaveBeenCalled();
  });
  it("rejet de writeText ignoré", async () => {
    const { copyText, clearClipboard } = await load();
    await copyText("secret");
    writeText.mockRejectedValue(new Error("denied"));
    await expect(clearClipboard()).resolves.toBeUndefined();
  });
});
