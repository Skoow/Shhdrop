import { afterEach, describe, expect, it, vi } from "vitest";

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

it("n'expose plus clearClipboard (clipboard-read refusé, rien à vérifier)", async () => {
  expect(Object.keys(await load())).toEqual(["copyText"]);
});
