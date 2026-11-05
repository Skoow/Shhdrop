// Fidélité du faux serveur de la démo (UI §14.3, A44) : le VRAI client (createShare,
// openShare, destroyShare, shareStatus) tourne contre lui, avec les cas d'erreur de la spec §13,
// et ses requêtes subissent le contrôle du test « le serveur ne voit rien ».
import { describe, expect, it } from "vitest";
import { findIn, needle } from "../../e2e/scan";
import { b64u, utf8 } from "../crypto/encoding";
import { segmentSize } from "../crypto/container";
import {
  BadPasswordError,
  NotFoundError,
  collectToBlob,
  createShare,
  destroyShare,
  openShare,
  parseLink,
  shareStatus,
  type CaptchaProof,
} from "../index";
import { createFakeServer, type FakeServerOpts } from "./fake-server";


const ORIGIN = "https://demo.test";
const PW = "cheval-agrafe-pile-correct";
const solveCaptcha = async (): Promise<CaptchaProof> => ({ kind: "pow", payload: "demo" });

type Seen = { method: string; url: string; headers: [string, string][]; body: Buffer };

function setup(opts: FakeServerOpts = {}) {
  const fake = createFakeServer(opts);
  const seen: Seen[] = [];
  const statuses: string[] = [];
  const fetch = (async (u: RequestInfo | URL, i?: RequestInit) => {
    const req = new Request(u, i);
    const copy = req.clone();
    seen.push({
      method: req.method,
      url: req.url,
      headers: [...req.headers],
      body: Buffer.from(await copy.arrayBuffer()),
    });
    const r = await fake.handle(req);
    statuses.push(`${req.method} ${new URL(req.url).pathname.replace(/[A-Za-z0-9_-]{22}/, "ID")} ${r.status}`);
    return r;
  }) as typeof globalThis.fetch;
  return { fake, seen, statuses, net: { fetch, retryDelayMs: 1 } };
}

const text = (s: string) => ({ kind: "text" as const, name: "", mime: "text/plain", data: utf8(s) });

async function share(net: { fetch: typeof fetch }, maxOpens = 2, items = [text("bonjour")]) {
  return createShare(ORIGIN, items, { ttlHours: 1, maxOpens, password: PW, solveCaptcha, ...net });
}

describe.concurrent("faux serveur de démo contre le vrai client", { timeout: 60_000 }, () => {
  it("createShare → openShare → saveItem rend les octets d'origine ; status ; le serveur ne voit rien", async ({ expect }) => {
    const { fake, seen, net } = setup();
    const MARKER = "MOT-REPERE-d3m0";
    const NAME = "nom-repere-d3m0.pdf";
    const file = new Uint8Array(200_000).map((_, i) => (i * 31) & 255);
    file.set(utf8(MARKER), 1000);
    const r = await createShare(
      ORIGIN,
      [text(`texte ${MARKER}`), { kind: "file", name: NAME, mime: "application/pdf", data: file }],
      { ttlHours: 6, maxOpens: 2, password: PW, solveCaptcha, ...net },
    );
    expect(fake.shares()).toBe(1);
    expect(r.expiresInS).toBeGreaterThan(6 * 3600 - 5);
    expect(r.expiresInS).toBeLessThanOrEqual(6 * 3600 + 900);

    const st = await shareStatus(r.manage, ORIGIN, net);
    expect(st).toMatchObject({ opensUsed: 0, maxOpens: 2, state: "ready" });

    const o = await openShare(r.link, PW, ORIGIN, undefined, net);
    expect(o.manifest.items[0]!.text).toBe(`texte ${MARKER}`);
    expect(o.safeName(1)).toBe(NAME);
    const blob = await collectToBlob(o, 1);
    expect(Buffer.from(await blob.arrayBuffer()).equals(Buffer.from(file))).toBe(true);
    await o.done();
    o.wipe();
    expect(await shareStatus(r.manage, ORIGIN, net)).toMatchObject({ opensUsed: 1, maxOpens: 2, state: "ready" });

    // Aucun repère en clair, ni K_lien, dans les URL, en-têtes et corps reçus par le faux serveur.
    const p = parseLink(r.link);
    if (p.kind !== "s") throw new Error("lien de partage attendu");
    const secrets = [needle("kLien", p.kLien), needle("texte", MARKER), needle("nom", NAME), needle("mot de passe", PW)];
    const hits: string[] = [];
    for (const q of seen) {
      for (const l of findIn(Buffer.from(q.url), secrets)) hits.push(`${q.method} ${q.url} URL : ${l}`);
      for (const [k, v] of q.headers) for (const l of findIn(Buffer.from(`${k}: ${v}`), secrets)) hits.push(`${q.url} ${k} : ${l}`);
      for (const l of findIn(q.body, secrets)) hits.push(`${q.method} ${q.url} corps : ${l}`);
    }
    expect(seen.length).toBeGreaterThan(5);
    expect(hits).toEqual([]);
  });

  it("mauvais mot de passe : 4 essais restants… puis NotFoundError, partage détruit", async ({ expect }) => {
    const { fake, net } = setup();
    const r = await share(net);
    const left: number[] = [];
    for (let i = 0; i < 4; i++) {
      const e = await openShare(r.link, "faux-mot-de-passe", ORIGIN, undefined, net).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(BadPasswordError);
      left.push((e as BadPasswordError).attemptsLeft);
    }
    expect(left).toEqual([4, 3, 2, 1]);
    await expect(openShare(r.link, "faux-mot-de-passe", ORIGIN, undefined, net)).rejects.toBeInstanceOf(NotFoundError);
    expect(fake.shares()).toBe(0);
    await expect(openShare(r.link, PW, ORIGIN, undefined, net)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("maxOpens = 1 : draining après l'ouverture, Opened.destroy() efface ; done ensuite toléré", async ({ expect }) => {
    const { fake, net, statuses } = setup();
    const r = await share(net, 1);
    const o = await openShare(r.link, PW, ORIGIN, undefined, net);
    expect(await shareStatus(r.manage, ORIGIN, net)).toMatchObject({ opensUsed: 1, maxOpens: 1, state: "draining" });
    await expect(openShare(r.link, PW, ORIGIN, undefined, net)).rejects.toBeInstanceOf(NotFoundError);
    await o.destroy("report");
    expect(fake.shares()).toBe(0);
    await o.done();
    expect(statuses).toContain("POST /api/shares/ID/destroy 204");
    expect(statuses.at(-1)).toBe("POST /api/shares/ID/done 404");
  });

  it("dernière ouverture lue (done) : le partage « draining » est effacé", async ({ expect }) => {
    const { fake, net } = setup();
    const r = await share(net, 1);
    const o = await openShare(r.link, PW, ORIGIN, undefined, net);
    await o.done();
    expect(fake.shares()).toBe(0);
    await expect(shareStatus(r.manage, ORIGIN, net)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("destroyShare par le lien de gestion, puis par lien + mot de passe", async ({ expect }) => {
    const { fake, net } = setup();
    const a = await share(net);
    await destroyShare(a.manage, ORIGIN, net);
    expect(fake.shares()).toBe(0);
    const b = await share(net);
    await expect(destroyShare(b.link, ORIGIN, { password: "faux-mot-de-passe", ...net })).rejects.toBeInstanceOf(NotFoundError);
    expect(fake.shares()).toBe(1); // un essai compté, pas de destruction
    await destroyShare(b.link, ORIGIN, { password: PW, ...net });
    expect(fake.shares()).toBe(0);
  });

  it("expiration (horloge injectée) → 404 partout", async ({ expect }) => {
    let offset = 0;
    const { fake, net } = setup({ now: () => Date.now() + offset });
    const r = await share(net);
    offset = 75 * 60_000; // 1 h + arrondi au quart d'heure dépassés
    await expect(openShare(r.link, PW, ORIGIN, undefined, net)).rejects.toBeInstanceOf(NotFoundError);
    await expect(shareStatus(r.manage, ORIGIN, net)).rejects.toBeInstanceOf(NotFoundError);
    await expect(destroyShare(r.manage, ORIGIN, net)).rejects.toBeInstanceOf(NotFoundError);
    expect(fake.shares()).toBe(0);
  });

  it("annulation pendant l'envoi : détruit par S_gestion en « uploading »", async ({ expect }) => {
    const { fake, net, statuses } = setup();
    const ac = new AbortController();
    let during = -1;
    const e = await createShare(ORIGIN, [text("x")], {
      ttlHours: 1,
      maxOpens: 1,
      password: PW,
      solveCaptcha,
      ...net,
      signal: ac.signal,
      pause: () => {
        during = fake.shares();
        ac.abort();
      },
    }).catch((x: unknown) => x);
    expect((e as Error).name).toBe("AbortError");
    expect(during).toBe(1);
    expect(statuses).toContain("POST /api/shares/ID/destroy 204");
    expect(fake.shares()).toBe(0);
  });

  it("coupure simulée au milieu de l'envoi : le client réessaie et réussit", async ({ expect }) => {
    const { fake, net, statuses } = setup({ outage: { atFraction: 0.5, ms: 300 } });
    const retries: number[] = [];
    const r = await createShare(ORIGIN, [text("x")], {
      ttlHours: 1,
      maxOpens: 1,
      password: PW,
      solveCaptcha,
      ...net,
      onRetry: (x) => retries.push(x.attempt),
    });
    expect(retries).toEqual([1]);
    expect(statuses.filter((s) => s.startsWith("PUT"))).toEqual(["PUT /api/shares/ID/segments/0 204"]); // le premier essai a échoué sans réponse
    expect(fake.shares()).toBe(1);
    const o = await openShare(r.link, PW, ORIGIN, undefined, net);
    expect(o.manifest.items[0]!.text).toBe("x");
  });
});

describe("faux serveur de démo : requêtes brutes", () => {
  async function created(fake: ReturnType<typeof createFakeServer>, advance: () => void) {
    const cap = (await (await fake.handle(new Request(`${ORIGIN}/api/captcha`))).json()) as Record<string, unknown>;
    expect(cap).toMatchObject({ fallback: null, algorithm: "SHA-256" });
    advance();
    const v = (n: number) => b64u(new Uint8Array(32).fill(n));
    const body = {
      bucket: 16,
      ttl_hours: 1,
      max_opens: 1,
      salt: b64u(new Uint8Array(16).fill(1)),
      kdf: { ops: 3, mem: 67108864 },
      access_v: v(2),
      proof_v: v(3),
      manage_v: v(4),
      altcha: "demo",
      hp: "",
      shown_at: cap.shown_at,
    };
    const r = await fake.handle(new Request(`${ORIGIN}/api/shares`, { method: "POST", body: JSON.stringify(body) }));
    return { r, body };
  }

  it("création : 201 après 3 s ; 400 avant 3 s, jeton rejoué, clé inconnue ou champ invalide", async () => {
    let offset = 0;
    const fake = createFakeServer({ now: () => Date.now() + offset });
    const early = await created(fake, () => {});
    expect(early.r.status).toBe(400);
    const ok = await created(fake, () => (offset += 4000));
    expect(ok.r.status).toBe(201);
    expect(await ok.r.json()).toMatchObject({ segments: 1 });
    const replay = await fake.handle(new Request(`${ORIGIN}/api/shares`, { method: "POST", body: JSON.stringify(ok.body) }));
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: "bad_request" });

    for (const bad of [{ extra: 1 }, { bucket: 17 }, { max_opens: 11 }, { ttl_hours: 2 }, { hp: "x" }, { recaptcha: "t" }]) {
      const cap = (await (await fake.handle(new Request(`${ORIGIN}/api/captcha`))).json()) as Record<string, unknown>;
      offset += 4000;
      const r = await fake.handle(
        new Request(`${ORIGIN}/api/shares`, { method: "POST", body: JSON.stringify({ ...ok.body, shown_at: cap.shown_at, ...bad }) }),
      );
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("segment de mauvaise taille → 400 ; numéro hors palier → 400 ; sans jeton → 400 ; jeton inconnu → 404", async () => {
    let offset = 0;
    const fake = createFakeServer({ now: () => Date.now() + offset });
    const { r } = await created(fake, () => (offset += 4000));
    const { id, upload_token } = (await r.json()) as { id: string; upload_token: string };
    const put = (n: string, len: number, auth: string | null = `Bearer ${upload_token}`) =>
      fake.handle(
        new Request(`${ORIGIN}/api/shares/${id}/segments/${n}`, {
          method: "PUT",
          headers: auth === null ? {} : { Authorization: auth },
          body: new Uint8Array(len),
        }),
      );
    expect((await put("0", segmentSize(16, 0) - 1)).status).toBe(400);
    expect((await put("1", segmentSize(16, 0))).status).toBe(400);
    expect((await put("00", segmentSize(16, 0))).status).toBe(400);
    expect((await put("0", segmentSize(16, 0), null)).status).toBe(400);
    expect((await put("0", segmentSize(16, 0), "Bearer inconnu")).status).toBe(404);
    const fin = await fake.handle(new Request(`${ORIGIN}/api/shares/${id}/finalize`, { method: "POST", headers: { Authorization: `Bearer ${upload_token}` } }));
    expect(fin.status).toBe(409);
    expect((await put("0", segmentSize(16, 0))).status).toBe(204);
  });

  it("routes inconnues et méthodes fausses → 404 not_found", async () => {
    const fake = createFakeServer();
    for (const [m, p] of [
      ["GET", "/api/nope"],
      ["POST", "/api/captcha"],
      ["GET", "/api/shares"],
      ["GET", "/api/shares/x/finalize"],
      ["DELETE", "/api/shares/x/meta"],
      ["GET", "/API/captcha"],
    ] as const) {
      const r = await fake.handle(new Request(ORIGIN + p, { method: m }));
      expect(r.status, `${m} ${p}`).toBe(404);
      expect(await r.json()).toEqual({ error: "not_found" });
    }
  });
});
