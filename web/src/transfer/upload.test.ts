// Transport des PUT de segment : XMLHttpRequest (navigateur, progression en octets) et fetch.
import { afterEach, describe, expect, it, vi } from "vitest";
import { SERVER_STALL_MS, fetchUploader, xhrUploader } from "./upload";

afterEach(() => vi.unstubAllGlobals());

const URL_ = "https://srv.test/api/shares/ID/segments/1";

// XMLHttpRequest minimal : le test pilote les événements.
class FakeXHR {
  static last: FakeXHR;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  withCredentials = true;
  status = 0;
  responseText = "";
  responseURL = "";
  sent: unknown;
  aborted = false;
  upload: { onprogress: ((e: { loaded: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  constructor() {
    FakeXHR.last = this;
  }
  open(m: string, u: string) {
    this.method = m;
    this.url = u;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(b: unknown) {
    this.sent = b;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  finish(status: number, text: string, responseURL = this.url) {
    this.status = status;
    this.responseText = text;
    this.responseURL = responseURL;
    this.onload?.();
  }
}

describe("xhrUploader", () => {
  it("PUT, en-têtes, sans identifiants ; progression en octets ; statut et JSON rendus", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const seen: number[] = [];
    const body = new Uint8Array(100);
    const p = xhrUploader(URL_, { Authorization: "Bearer t" }, body, (n) => seen.push(n));
    const x = FakeXHR.last;
    expect([x.method, x.url, x.headers, x.withCredentials, x.sent]).toEqual(["PUT", URL_, { Authorization: "Bearer t" }, false, body]);
    x.upload.onprogress!({ loaded: 40 });
    x.upload.onprogress!({ loaded: 100 });
    x.finish(204, "");
    expect(await p).toEqual({ status: 204, json: null });
    expect(seen).toEqual([40, 100]);

    const q = xhrUploader(URL_, {}, body, () => undefined);
    FakeXHR.last.finish(429, '{"error":"limit","retry_after_s":7}');
    expect(await q).toEqual({ status: 429, json: { error: "limit", retry_after_s: 7 } });
  });

  it("erreur réseau → TypeError ; redirection → TypeError (jamais suivie en silence)", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const p = xhrUploader(URL_, {}, new Uint8Array(1), () => undefined);
    FakeXHR.last.onerror!();
    await expect(p).rejects.toBeInstanceOf(TypeError);
    const q = xhrUploader(URL_, {}, new Uint8Array(1), () => undefined);
    FakeXHR.last.finish(204, "", "https://ailleurs.test/x");
    await expect(q).rejects.toBeInstanceOf(TypeError);
  });

  it("signal : xhr.abort() et AbortError ; signal déjà annulé : aucune requête", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const ac = new AbortController();
    const p = xhrUploader(URL_, {}, new Uint8Array(1), () => undefined, ac.signal);
    const x = FakeXHR.last;
    ac.abort();
    expect(x.aborted).toBe(true);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    const before = FakeXHR.last;
    await expect(xhrUploader(URL_, {}, new Uint8Array(1), () => undefined, ac.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeXHR.last).toBe(before);
  });
});

describe("fetchUploader", () => {
  it("PUT par fetch (credentials omit, redirect error, signal) ; octets annoncés à l'acquittement", async () => {
    const inits: RequestInit[] = [];
    const f = vi.fn(async (_: RequestInfo | URL, init?: RequestInit) => {
      inits.push(init!);
      return new Response(null, { status: 204 });
    });
    const seen: number[] = [];
    const ac = new AbortController();
    const body = new Uint8Array(10);
    expect(await fetchUploader(f as unknown as typeof fetch)(URL_, { A: "b" }, body, (n) => seen.push(n), ac.signal)).toEqual({ status: 204, json: null });
    expect(f.mock.calls[0]![0]).toBe(URL_);
    expect(inits[0]).toMatchObject({ method: "PUT", headers: { A: "b" }, body, credentials: "omit", redirect: "error", signal: ac.signal });
    expect(seen).toEqual([10]);
  });
  it("erreur HTTP : JSON rendu, aucun octet annoncé ; coupure : TypeError", async () => {
    const seen: number[] = [];
    const e500 = (async () => new Response('{"error":"internal"}', { status: 500 })) as unknown as typeof fetch;
    expect(await fetchUploader(e500)(URL_, {}, new Uint8Array(3), (n) => seen.push(n))).toEqual({ status: 500, json: { error: "internal" } });
    expect(seen).toEqual([]);
    const cut = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(fetchUploader(cut)(URL_, {}, new Uint8Array(3), () => undefined)).rejects.toBeInstanceOf(TypeError);
  });
});

it("SERVER_STALL_MS : 13 min (le serveur efface à 15 min)", () => {
  expect(SERVER_STALL_MS).toBe(780_000);
});
