// Chargement vérifié du moteur (spec moteur §7, Task 10) : sources du .wasm et du Worker
// d'Argon2id dans les builds de production (source.verified.ts) et de démo (source.demo.ts).
// Le chemin réel (navigateur, CSP, Trusted Types, empreinte refusée) : ui-e2e/hygiene.spec.ts.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WASM = readFileSync(new URL("./pkg/shhdrop_wasm_bg.wasm", import.meta.url));

vi.mock("virtual:shh-engine", () => ({
  src: "/assets/engine-AbCd1234.wasm",
  integrity: "sha384-moteur",
  workerSrc: "/assets/engine-kdf-EfGh5678.js",
  workerIntegrity: "sha384-worker",
  // Démo : le .wasm en base64 (ici trois octets connus, dont un au-delà de 127).
  wasm: Buffer.from([0, 97, 255]).toString("base64"),
}));

const ORIGIN = "https://shh.test";

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("location", { origin: ORIGIN });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const errorOf = async (f: () => Promise<unknown>) => {
  try {
    await f();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

describe("production (source.verified.ts)", () => {
  it("le .wasm est lu avec son empreinte, sans cookie ni redirection", async () => {
    const f = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", f);
    const { wasmBytes } = await import("./source.verified");
    expect(new Uint8Array(await wasmBytes())).toEqual(new Uint8Array([1, 2, 3]));
    expect(f.mock.calls).toEqual([["/assets/engine-AbCd1234.wasm", { integrity: "sha384-moteur", credentials: "omit", redirect: "error" }]]);
  });

  it("octets refusés par le navigateur (empreinte), coupure, statut d'erreur, corps interrompu : Error(\"reseau\")", async () => {
    const { wasmBytes } = await import("./source.verified");
    for (const f of [
      async () => Promise.reject(new TypeError("Failed to fetch")),
      async () => new Response("", { status: 404 }),
      async () => ({ ok: true, arrayBuffer: () => Promise.reject(new TypeError("coupé")) }),
    ]) {
      vi.stubGlobal("fetch", f);
      expect(await errorOf(wasmBytes)).toBe("reseau");
    }
  });

  it("Worker d'Argon2id : script lu une fois avec son empreinte, lancé depuis un Blob de l'origine par la politique Trusted Types", async () => {
    const f = vi.fn(async () => new Response("self.onmessage=0"));
    vi.stubGlobal("fetch", f);
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => (blobs.push(b as Blob), `${ORIGIN.replace("https", "blob:https")}/b${blobs.length}`));
    const made: { url: string; opts?: WorkerOptions }[] = [];
    vi.stubGlobal(
      "Worker",
      class {
        constructor(url: string, opts?: WorkerOptions) {
          made.push({ url: String(url), opts });
        }
      },
    );
    const { startWorker } = await import("./source.verified");
    await startWorker();
    await startWorker();
    expect(f.mock.calls).toEqual([["/assets/engine-kdf-EfGh5678.js", { integrity: "sha384-worker", credentials: "omit", redirect: "error" }]]);
    expect(made).toEqual([
      { url: "blob:https://shh.test/b1", opts: undefined },
      { url: "blob:https://shh.test/b1", opts: undefined },
    ]);
    expect(blobs.length).toBe(1);
    expect(blobs[0]!.type).toBe("text/javascript");
    expect(await blobs[0]!.text()).toBe("self.onmessage=0");
  });

  it("script du Worker refusé : Error(\"reseau\"), aucun Worker ; l'essai suivant relit le fichier", async () => {
    let fail = true;
    const f = vi.fn(async () => (fail ? Promise.reject(new TypeError("integrity")) : new Response("x")));
    vi.stubGlobal("fetch", f);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:https://shh.test/b");
    let made = 0;
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          made++;
        }
      },
    );
    const { startWorker } = await import("./source.verified");
    expect(await errorOf(startWorker)).toBe("reseau");
    expect(made).toBe(0);
    fail = false;
    await startWorker();
    expect(f).toHaveBeenCalledTimes(2);
    expect(made).toBe(1);
  });
});

describe("démo (source.demo.ts)", () => {
  it("le .wasm vient du script de la démo, sans requête ; pas de Worker (CSP de la démo)", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { wasmBytes, startWorker } = await import("./source.demo");
    expect(new Uint8Array(await wasmBytes())).toEqual(new Uint8Array([0, 97, 255]));
    expect(startWorker).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("loadEngine", () => {
  it("échec de lecture : Error(\"reseau\"), aucun moteur rendu ; l'appel suivant relit le fichier et réussit", async () => {
    let fail = true;
    const read = vi.fn(async () => {
      if (fail) throw new Error("reseau");
      return WASM.buffer.slice(WASM.byteOffset, WASM.byteOffset + WASM.byteLength);
    });
    const start = async () => ({}) as Worker;
    vi.doMock("./source", () => ({ wasmBytes: read, startWorker: start }));
    const { loadEngine } = await import("./load");
    expect(await errorOf(loadEngine)).toBe("reseau");
    fail = false;
    const e = await loadEngine();
    expect(read).toHaveBeenCalledTimes(2);
    expect(e.module).toBeInstanceOf(WebAssembly.Module);
    expect(e.start).toBe(start);
    expect(typeof e.wasm.passwordKey).toBe("function");
    expect(await loadEngine()).toBe(e);
  });
});
