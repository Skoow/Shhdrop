import { afterEach, describe, expect, it, vi } from "vitest";
import { LimitError, NotFoundError, type Opened } from "../index";
import { liveUrls, trackUrl } from "../viewers/blobs";
import { destroyFromContent, finish } from "./endoflife";

function fake(destroy: () => Promise<void> = async () => undefined, done: () => Promise<void> = async () => undefined) {
  const log: string[] = [];
  const o = {
    destroy: vi.fn(async (r?: string) => {
      log.push(`destroy(${r ?? ""})`);
      await destroy();
      log.push("destroy résolu");
    }),
    done: vi.fn(async () => {
      log.push("done");
      await done();
    }),
    wipe: vi.fn(() => void log.push("wipe")),
  } as unknown as Opened;
  return { o, log };
}

afterEach(() => vi.restoreAllMocks());

describe("finish", () => {
  it("done() → wipe() → révocation des URL ; un done() en échec efface quand même", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x/a");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    trackUrl(new Blob(["a"]));
    const a = fake();
    await finish(a.o);
    expect(a.log).toEqual(["done", "wipe"]);
    expect(liveUrls()).toBe(0);
    const b = fake(undefined, async () => Promise.reject(new Error("reseau")));
    await expect(finish(b.o)).resolves.toBeUndefined();
    expect(b.log).toEqual(["done", "wipe"]);
  });
});

describe("destroyFromContent", () => {
  it("Détruire : destroy() sans argument ; Signaler : destroy(\"report\") ; wipe et onDestroyed après la réponse", async () => {
    for (const report of [false, true]) {
      let release!: () => void;
      const { o, log } = fake(() => new Promise<void>((r) => (release = r)));
      const onDestroyed = vi.fn(() => void log.push("dissolution"));
      const p = destroyFromContent(o, report, { onDestroyed });
      await new Promise((r) => setTimeout(r, 0));
      expect(onDestroyed).not.toHaveBeenCalled();
      expect(o.wipe).not.toHaveBeenCalled();
      release();
      expect(await p).toBe("destroyed");
      expect(o.destroy).toHaveBeenCalledWith(...(report ? ["report"] : []));
      expect(log).toEqual([`destroy(${report ? "report" : ""})`, "destroy résolu", "wipe", "dissolution"]);
    }
  });
  it("NotFoundError → wipe(), gone", async () => {
    const { o } = fake(async () => Promise.reject(new NotFoundError()));
    const onDestroyed = vi.fn();
    expect(await destroyFromContent(o, false, { onDestroyed })).toBe("gone");
    expect(o.wipe).toHaveBeenCalledTimes(1);
    expect(onDestroyed).toHaveBeenCalledTimes(1);
  });
  it("reseau → network ; 429 → limit (ruling 7) ; wipe et onDestroyed jamais appelés", async () => {
    for (const [e, want] of [[new Error("reseau"), "network"], [new LimitError(5), "limit"]] as const) {
      const { o } = fake(async () => Promise.reject(e));
      const onDestroyed = vi.fn();
      expect(await destroyFromContent(o, true, { onDestroyed })).toBe(want);
      expect(o.wipe).not.toHaveBeenCalled();
      expect(onDestroyed).not.toHaveBeenCalled();
    }
  });
});
