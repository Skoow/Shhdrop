// @vitest-environment happy-dom
// XHR de la démo : le vrai transport des segments (xhrUploader) parle au faux serveur.
import { describe, expect, it } from "vitest";
import { xhrUploader } from "../transfer/upload";
import { fakeXHRClass } from "./fake-xhr";

const isApi = (u: URL) => u.origin === location.origin && u.pathname.startsWith("/api/");

describe("XHR de démo", () => {
  it("PUT /api : réponse du faux serveur, progression croissante jusqu'au total", async () => {
    const seen: { method: string; url: string; auth: string | null; len: number }[] = [];
    const handle = async (req: Request) => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.get("Authorization"), len: (await req.arrayBuffer()).byteLength });
      await new Promise((r) => setTimeout(r, 350));
      return new Response(JSON.stringify({ error: "bad_request" }), { status: 400 });
    };
    globalThis.XMLHttpRequest = fakeXHRClass(XMLHttpRequest, isApi, handle, 1000);
    const bytes: number[] = [];
    const url = `${location.origin}/api/shares/x/segments/0`;
    const r = await xhrUploader(url, { Authorization: "Bearer t" }, new Uint8Array(1000), (n) => bytes.push(n));
    expect(r).toEqual({ status: 400, json: { error: "bad_request" } });
    expect(seen).toEqual([{ method: "PUT", url, auth: "Bearer t", len: 1000 }]);
    expect(bytes.length).toBeGreaterThanOrEqual(3);
    expect(bytes.at(-1)).toBe(1000);
    expect(bytes.slice(0, -1).every((b) => b < 1000)).toBe(true);
    expect([...bytes].sort((a, b) => a - b)).toEqual(bytes);
  });

  it("coupure (handle rejette) → TypeError ; abort → AbortError", async () => {
    let calls = 0;
    const handle = async (req: Request) => {
      calls++;
      if (calls === 1) throw new TypeError("Failed to fetch");
      await new Promise((r, j) => req.signal.addEventListener("abort", () => j(new DOMException("Aborted", "AbortError"))));
      return new Response(null, { status: 204 });
    };
    globalThis.XMLHttpRequest = fakeXHRClass(XMLHttpRequest, isApi, handle, 1e6);
    const url = `${location.origin}/api/shares/x/segments/0`;
    await expect(xhrUploader(url, {}, new Uint8Array(10), () => {})).rejects.toBeInstanceOf(TypeError);
    const ac = new AbortController();
    const p = xhrUploader(url, {}, new Uint8Array(10), () => {}, ac.signal);
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});
