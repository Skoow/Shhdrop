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

describe("clearClipboard (audit F2 : ne vide que s'il contient encore ce que la page a copié)", () => {
  let writeText: ReturnType<typeof vi.fn>;
  let readText: ReturnType<typeof vi.fn>;
  let state: string | Error;
  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    readText = vi.fn().mockResolvedValue("secret");
    state = "granted";
    const query = vi.fn(async () => {
      if (state instanceof Error) throw state;
      return { state };
    });
    vi.stubGlobal("navigator", { clipboard: { writeText, readText }, permissions: { query } });
  });
  it("rien copié par la page -> « nothing », rien lu ni écrit", async () => {
    const { clearClipboard } = await load();
    expect(await clearClipboard()).toBe("nothing");
    expect(readText).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });
  it("contient encore exactement la copie -> vidé, une seule fois", async () => {
    const { copyText, clearClipboard } = await load();
    await copyText("secret");
    writeText.mockClear();
    expect(await clearClipboard()).toBe("cleared");
    expect(writeText).toHaveBeenCalledWith("");
    writeText.mockClear();
    expect(await clearClipboard()).toBe("nothing");
    expect(writeText).not.toHaveBeenCalled();
  });
  it("autre chose copié entre-temps -> « changed », jamais effacé", async () => {
    const { copyText, clearClipboard } = await load();
    await copyText("secret");
    writeText.mockClear();
    readText.mockResolvedValue("liste de courses");
    expect(await clearClipboard()).toBe("changed");
    expect(writeText).not.toHaveBeenCalled();
  });
  it.each([["prompt"], ["denied"], [new TypeError("clipboard-read inconnu")]])(
    "lecture non permise d'avance (%s) -> « unverified », aucune invite, rien effacé",
    async (s) => {
      state = s as string | Error;
      const { copyText, clearClipboard } = await load();
      await copyText("secret");
      writeText.mockClear();
      expect(await clearClipboard()).toBe("unverified");
      expect(readText).not.toHaveBeenCalled();
      expect(writeText).not.toHaveBeenCalled();
    },
  );
  it("readText rejette -> « unverified », rien effacé", async () => {
    const { copyText, clearClipboard } = await load();
    await copyText("secret");
    writeText.mockClear();
    readText.mockRejectedValue(new Error("NotAllowedError"));
    expect(await clearClipboard()).toBe("unverified");
    expect(writeText).not.toHaveBeenCalled();
  });
  it("writeText rejette au vidage -> « unverified », sans lever", async () => {
    const { copyText, clearClipboard } = await load();
    await copyText("secret");
    writeText.mockRejectedValue(new Error("denied"));
    expect(await clearClipboard()).toBe("unverified");
  });
});
