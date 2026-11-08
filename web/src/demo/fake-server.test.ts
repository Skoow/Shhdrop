// Fidélité du faux serveur de la démo (UI §14.3, A44) : le VRAI client (createShare,
// openShare, destroyShare, shareStatus) tourne contre lui, avec les cas d'erreur de la spec §13,
// et ses requêtes subissent le contrôle du test « le serveur ne voit rien ».
import { describe, expect, it } from "vitest";
import { findIn, needle } from "../../e2e/scan";
import { b64u, utf8 } from "../crypto/encoding";
import { segmentSize } from "../crypto/container";
import {
  BadPasswordError,
  GrantInvalidError,
  NotFoundError,
  ReopenLimitError,
  collectToBlob,
  createShare,
  destroyShare,
  fetchMeta,
  openShare,
  parseLink,
  shareStatus,
  type CaptchaProof,
} from "../index";
import { createFakeServer, type FakeServerOpts } from "./fake-server";


const ORIGIN = "https://demo.test";
const PW = "Kq7!mP2#xYa"; // forme d'un mot de passe généré (D41-15)
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
    statuses.push(`${req.method} ${new URL(req.url).pathname} ${r.status}`);
    return r;
  }) as typeof globalThis.fetch;
  return { fake, seen, statuses, net: { fetch, retryDelayMs: 1 } };
}

const text = (s: string) => ({ kind: "text" as const, name: "", mime: "text/plain", data: utf8(s) });
/** 5 Mio : plusieurs segments (palier 160). */
const bigFile = () => ({ kind: "file" as const, name: "a.bin", mime: "application/octet-stream", data: new Uint8Array(5 * 1048576).map((_, i) => i & 255) });

async function share(net: { fetch: typeof fetch }, maxOpens = 2, items: Parameters<typeof createShare>[1] = [text("bonjour")]) {
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
    expect(statuses).toContain("POST /api/shares/destroy 204");
    expect(statuses.at(-1)).toBe("POST /api/shares/done 410"); // jeton valide, partage disparu (spec §41.8)
  });

  it("spec §41.4 : l'octroi rouvre la même ouverture (même en draining), 10 fois au plus ; faux → GrantInvalidError", async ({ expect }) => {
    let offset = 0;
    const { fake, net } = setup({ now: () => Date.now() + offset });
    const r = await share(net, 1);
    const o = await openShare(r.link, PW, ORIGIN, undefined, net);
    expect(o.grant).toMatch(/^[A-Za-z0-9_-]{54}$/);
    let g = o.grant;
    expect((await fetchMeta(r.link, ORIGIN, net, g)).opensLeft).toBe(0); // draining, rouvrable
    for (let i = 0; i < 10; i++) {
      const again = await openShare(r.link, PW, ORIGIN, { grant: g }, net);
      g = again.grant;
    }
    expect(await shareStatus(r.manage, ORIGIN, net)).toMatchObject({ opensUsed: 1, state: "draining" });
    await expect(openShare(r.link, PW, ORIGIN, { grant: g }, net)).rejects.toBeInstanceOf(ReopenLimitError);
    const bad = await openShare(r.link, "faux", ORIGIN, { grant: "A".repeat(54) }, net).catch((x: unknown) => x);
    expect(bad).toBeInstanceOf(NotFoundError); // draining sans octroi valable : introuvable
    // Octroi expiré sans renouvellement (30 min) : l'ouverture finit, le draining est effacé.
    offset += 31 * 60_000;
    expect(fake.shares()).toBe(0);
  });

  it("spec §41.4 : partage prêt, octroi falsifié → GrantInvalidError sans essai ; done → l'octroi ne rouvre plus", async ({ expect }) => {
    const { net } = setup();
    const r = await share(net, 3);
    const o = await openShare(r.link, PW, ORIGIN, undefined, net);
    await expect(openShare(r.link, "faux", ORIGIN, { grant: "A".repeat(54) }, net)).rejects.toBeInstanceOf(GrantInvalidError);
    const again = await openShare(r.link, PW, ORIGIN, { grant: o.grant }, net);
    expect(await shareStatus(r.manage, ORIGIN, net)).toMatchObject({ opensUsed: 1 });
    expect(await again.regrant()).toMatch(/^[A-Za-z0-9_-]{54}$/);
    await again.done();
    await expect(openShare(r.link, PW, ORIGIN, { grant: again.grant }, net)).rejects.toBeInstanceOf(GrantInvalidError);
    const bad = await openShare(r.link, "faux", ORIGIN, undefined, net).catch((x: unknown) => x);
    expect((bad as BadPasswordError).attemptsLeft).toBe(4); // l'octroi falsifié n'a compté aucun essai
  });

  it("dernière ouverture lue (done) : le partage « draining » est effacé", async ({ expect }) => {
    const { fake, net } = setup();
    const r = await share(net, 1);
    const o = await openShare(r.link, PW, ORIGIN, undefined, net);
    await o.done();
    expect(fake.shares()).toBe(0);
    await expect(shareStatus(r.manage, ORIGIN, net)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("fetchMeta : ouvertures restantes, une de moins après chaque ouverture (ruling 5)", async ({ expect }) => {
    const { net } = setup();
    const r = await share(net, 3);
    expect((await fetchMeta(r.link, ORIGIN, net)).opensLeft).toBe(3);
    const o = await openShare(r.link, PW, ORIGIN, undefined, net);
    await o.done();
    expect((await fetchMeta(r.link, ORIGIN, net)).opensLeft).toBe(2);
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

  it("spec §41.8 : suppression pendant une lecture → l'ouverture active finit, l'autre reçoit 410 ; watch → 410", async ({ expect }) => {
    let offset = 0;
    const { fake, net } = setup({ watchHoldMs: 50, rateBytesPerS: 1e9, now: () => Date.now() + offset });
    const big = bigFile();
    const r = await share(net, 2, [big]);
    const b = await openShare(r.link, PW, ORIGIN, undefined, net);
    offset = 130_000; // b : plus aucun segment depuis 130 s, inactive
    const a = await openShare(r.link, PW, ORIGIN, undefined, net); // vient de lire : active
    expect(await a.watch()).toBe("alive"); // 204 après la tenue (50 ms ici)
    const pending = a.watch(); // tenue en cours
    await destroyShare(r.manage, ORIGIN, net);
    expect(await pending).toBe("gone");
    expect(fake.shares()).toBe(0);
    expect(Buffer.from(await a.item(0)).equals(Buffer.from(big.data))).toBe(true); // grâce : segments servis
    expect(await b.watch()).toBe("gone");
    await expect(b.item(0)).rejects.toThrow(); // pas commencée : 410
    await a.done();
  });

  it("destruction faite ici : la surveillance en cours rend « stop », pas « gone » (l'écran de fin vient de destroy)", async ({ expect }) => {
    const { net } = setup({ watchHoldMs: 10_000 });
    const r = await share(net, 2);
    const o = await openShare(r.link, PW, ORIGIN, undefined, net);
    const pending = o.watch();
    await o.destroy();
    expect(await pending).toBe("stop");
    expect(await o.watch()).toBe("stop");
  });

  it("fin faite ici (done, dernière ouverture) : la surveillance en cours rend « stop », pas « gone »", async ({ expect }) => {
    const { fake, net } = setup({ watchHoldMs: 10_000 });
    const r = await share(net, 1);
    const o = await openShare(r.link, PW, ORIGIN, undefined, net);
    const pending = o.watch();
    await o.done();
    expect(fake.shares()).toBe(0);
    expect(await pending).toBe("stop");
  });

  it("spec §36 S14, §41.8 : motif fermé ; signalement → plus aucune lecture (410)", async ({ expect }) => {
    const { net, statuses } = setup({ rateBytesPerS: 1e9 });
    const r = await share(net, 2, [bigFile()]);
    const a = await openShare(r.link, PW, ORIGIN, undefined, net);
    await a.destroy("report");
    await expect(a.item(0)).rejects.toThrow();
    expect(statuses, statuses.join("\n")).toContain("GET /api/shares/segments/0 410");
    const fake2 = createFakeServer();
    for (const reason of ["ReperRaison", "", "REPORT", null]) {
      const res = await fake2.handle(
        new Request(`${ORIGIN}/api/shares/destroy`, {
          method: "POST",
          headers: { "X-Shh-Access": b64u(new Uint8Array(32)) },
          body: JSON.stringify({ proof: b64u(new Uint8Array(32)), reason }),
        }),
      );
      expect([res.status, await res.text()]).toEqual([400, '{"error":"bad_request"}']);
    }
  });

  it("spec §41.8 : échéance pendant une lecture → active continue, pause de 120 s → 410", async ({ expect }) => {
    let offset = 0;
    const { net, statuses } = setup({ now: () => Date.now() + offset, rateBytesPerS: 1e9 });
    const big = bigFile();
    const r = await share(net, 3, [big]);
    const a = await openShare(r.link, PW, ORIGIN, undefined, net);
    const b = await openShare(r.link, PW, ORIGIN, undefined, net);
    // 30 s avant l'échéance, octrois renouvelés au moins toutes les 25 min (comme la page,
    // spec §41.4) : sinon l'ouverture finirait 30 min après le déverrouillage.
    const target = ((await fetchMeta(r.link, ORIGIN, net)).expiresInS - 30) * 1000;
    while (offset < target) {
      offset = Math.min(target, offset + 25 * 60_000);
      await a.regrant();
      await b.regrant();
    }
    expect(Buffer.from(await a.item(0)).equals(Buffer.from(big.data))).toBe(true);
    offset += 100_000; // échu, segment servi il y a 100 s : active
    expect(Buffer.from(await a.item(0)).equals(Buffer.from(big.data))).toBe(true);
    await expect(b.item(0)).rejects.toThrow(); // inactive à l'échéance : 410
    offset += 130_000; // 130 s sans segment : droit perdu
    await expect(a.item(0)).rejects.toThrow();
    expect(statuses.filter((x) => x.endsWith(" 410")).length).toBeGreaterThanOrEqual(2);
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
    expect(statuses).toContain("POST /api/manage/destroy 204");
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
    expect(statuses.filter((s) => s.startsWith("PUT"))).toEqual(["PUT /api/shares/segments/0 204"]); // le premier essai a échoué sans réponse
    expect(fake.shares()).toBe(1);
    const o = await openShare(r.link, PW, ORIGIN, undefined, net);
    expect(o.manifest.items[0]!.text).toBe("x");
  });
});

// K_accès = 32 × 0x02, S_gestion = 32 × 0x04 (en-têtes de création, spec §29.8).
const HDR = { "X-Shh-Access": b64u(new Uint8Array(32).fill(2)), "X-Shh-Manage": b64u(new Uint8Array(32).fill(4)) };

describe("faux serveur de démo : requêtes brutes", () => {
  async function created(fake: ReturnType<typeof createFakeServer>, advance: () => void, bucket = 16) {
    const cap = (await (await fake.handle(new Request(`${ORIGIN}/api/captcha`))).json()) as Record<string, unknown>;
    expect(cap).toMatchObject({ fallback: null, algorithm: "SHA-256" });
    advance();
    const body = { bucket, altcha: "demo", hp: "", shown_at: cap.shown_at };
    const r = await fake.handle(new Request(`${ORIGIN}/api/shares`, { method: "POST", headers: HDR, body: JSON.stringify(body) }));
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
    const replay = await fake.handle(new Request(`${ORIGIN}/api/shares`, { method: "POST", headers: HDR, body: JSON.stringify(ok.body) }));
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: "bad_request" });
    const post = async (headers: Record<string, string>, extra: object = {}) => {
      const cap = (await (await fake.handle(new Request(`${ORIGIN}/api/captcha`))).json()) as Record<string, unknown>;
      offset += 4000;
      return fake.handle(new Request(`${ORIGIN}/api/shares`, { method: "POST", headers, body: JSON.stringify({ ...ok.body, shown_at: cap.shown_at, ...extra }) }));
    };
    // Même K_accès ou même S_gestion qu'un partage existant : même réponse qu'une création invalide.
    const other = (n: number) => b64u(new Uint8Array(32).fill(n));
    for (const h of [HDR, { ...HDR, "X-Shh-Manage": other(9) }, { ...HDR, "X-Shh-Access": other(9) }]) {
      const dup = await post(h);
      expect([dup.status, await dup.json()]).toEqual([400, { error: "bad_request" }]);
    }
    // Autres secrets : création acceptée (l'existence d'un autre partage ne change rien).
    expect((await post({ "X-Shh-Access": other(7), "X-Shh-Manage": other(8) })).status).toBe(201);

    // v1/K1 (durée, ouvertures, sel, V_preuve, id ou vérificateurs à la création) refusé ; en-têtes absents ou faux refusés.
    const fresh = { "X-Shh-Access": other(10), "X-Shh-Manage": other(11) };
    for (const bad of [{ extra: 1 }, { bucket: 17 }, { max_opens: 1 }, { ttl_hours: 1 }, { proof_v: "x" }, { salt: "x" }, { hp: "x" }, { recaptcha: "t" }, { id: other(1).slice(0, 22) }, { access_v: other(1) }, { manage_v: other(1) }]) {
      expect((await post(fresh, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    for (const h of [{}, { "X-Shh-Access": other(10) }, { "X-Shh-Manage": other(11) }, { ...fresh, "X-Shh-Access": "abc" }]) {
      expect((await post(h as Record<string, string>)).status, JSON.stringify(h)).toBe(400);
    }
    expect((await post(fresh)).status).toBe(201);
  });

  it("segment de mauvaise taille → 400 ; numéro hors palier → 400 ; sans jeton → 400 ; jeton inconnu → 404", async () => {
    let offset = 0;
    const fake = createFakeServer({ now: () => Date.now() + offset });
    const { r, body } = await created(fake, () => (offset += 4000));
    void body;
    const { upload_token } = (await r.json()) as { upload_token: string };
    const put = (n: string, len: number, auth: string | null = `Bearer ${upload_token}`) =>
      fake.handle(
        new Request(`${ORIGIN}/api/shares/segments/${n}`, {
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
    const fin = await fake.handle(
      new Request(`${ORIGIN}/api/shares/finalize`, { method: "POST", headers: { Authorization: `Bearer ${upload_token}` }, body: JSON.stringify(FIN) }),
    );
    expect(fin.status).toBe(409);
    expect((await put("0", segmentSize(16, 0))).status).toBe(204);
  });

  const FIN = {
    salt: b64u(new Uint8Array(16).fill(1)),
    kdf_ops: 3,
    kdf_mem: 67108864,
    proof_v: "ZIqlxXn7MPOK90TZfW7IQMepEnekmaDXgPPnMU7KCQs", // SHA-256(32 × 0x03)
    envelope: b64u(new Uint8Array(60).fill(6)),
    ttl_hours: 1,
    max_opens: 1,
    fill_from: 0,
    fill_to: 0,
  };

  it("finalize v2 : champs exacts ; bourrage [fill_from, fill_to) rempli d'aléa ; unlock rend l'enveloppe", async () => {
    let offset = 0;
    const fake = createFakeServer({ now: () => Date.now() + offset });
    const { r, body } = await created(fake, () => (offset += 4000), 400); // 7 segments
    const { upload_token } = (await r.json()) as { upload_token: string };
    const auth = { Authorization: `Bearer ${upload_token}` };
    void body;
    const call = (path: string, init: RequestInit) => fake.handle(new Request(`${ORIGIN}/api/shares${path}`, init));
    for (const n of [0, 1, 2, 6]) {
      expect((await call(`/segments/${n}`, { method: "PUT", headers: auth, body: new Uint8Array(segmentSize(400, n)) })).status).toBe(204);
    }
    const fin = (b: object) => call("/finalize", { method: "POST", headers: auth, body: JSON.stringify(b) });
    for (const bad of [
      { fill_to: 7 }, // touche le dernier segment
      { fill_from: 0, fill_to: 3 }, // touche le segment 0 (en-tête)
      { fill_from: 4, fill_to: 3 },
      { envelope: b64u(new Uint8Array(59)) },
      { salt: b64u(new Uint8Array(15)) },
      { kdf_ops: 2 },
      { max_opens: 11 },
      { ttl_hours: 2 },
      { extra: 1 },
      { fill_from: undefined },
    ]) {
      expect((await fin({ ...FIN, fill_from: 3, fill_to: 6, ...bad })).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await fin({ ...FIN, fill_from: 4, fill_to: 6 })).status).toBe(409); // segment 3 manquant hors bourrage
    // Ni fill_from ni fill_to (spec §36 S4) : tous les segments exigés.
    const { fill_from: _f, fill_to: _t, ...noFill } = FIN;
    expect((await fin({ ...noFill, fill_from: undefined, fill_to: undefined })).status).toBe(409);
    expect((await fin({ ...FIN, fill_from: 3, fill_to: 6 })).status).toBe(200);
    // Rejeu de finalize : plus en envoi → 404.
    expect((await fin({ ...FIN, fill_from: 3, fill_to: 6 })).status).toBe(404);
    // unlock rend l'enveloppe telle que reçue ; le bourrage lu n'a aucune suite de 4 096 zéros.
    const k = (n: number) => b64u(new Uint8Array(32).fill(n));
    const u = await call("/unlock", { method: "POST", headers: { "X-Shh-Access": k(2) }, body: JSON.stringify({ proof: k(3) }) });
    const uj = (await u.json()) as { download_token: string; envelope: string; segments: number };
    expect([u.status, uj.envelope, uj.segments]).toEqual([200, FIN.envelope, 7]);
    for (const n of [3, 4, 5]) {
      const seg = new Uint8Array(await (await call(`/segments/${n}`, { headers: { Authorization: `Bearer ${uj.download_token}` } })).arrayBuffer());
      expect(seg.length).toBe(segmentSize(400, n));
      let run = 0, worst = 0;
      for (const x of seg) worst = Math.max(worst, (run = x === 0 ? run + 1 : 0));
      expect(worst, `segment ${n}`).toBeLessThan(4096);
    }
  });

  it("routes inconnues et méthodes fausses → 404 not_found", async () => {
    const fake = createFakeServer();
    for (const [m, p] of [
      ["GET", "/api/nope"],
      ["POST", "/api/captcha"],
      ["GET", "/api/shares"],
      ["GET", "/api/shares/finalize"],
      ["DELETE", "/api/shares/meta"],
      // Anciennes routes avec id : n'existent plus (spec §32).
      ["GET", "/api/shares/x/meta"],
      ["GET", "/api/shares/AAAAAAAAAAAAAAAAAAAAAA/status"],
      ["POST", "/api/shares/AAAAAAAAAAAAAAAAAAAAAA/destroy"],
      ["POST", "/api/manage/status"],
      ["GET", "/api/manage/destroy"],
      ["GET", "/API/captcha"],
    ] as const) {
      const r = await fake.handle(new Request(ORIGIN + p, { method: m }));
      expect(r.status, `${m} ${p}`).toBe(404);
      expect(await r.json()).toEqual({ error: "not_found" });
    }
  });
});

describe("persistance de la démo (rechargement de l'onglet)", { timeout: 60_000 }, () => {
  it("instantané + segments : un nouveau faux serveur ouvre le partage, octets intacts ; instantané clonable", async () => {
    let last: ReturnType<ReturnType<typeof createFakeServer>["snapshot"]> | undefined;
    const segs = new Map<string, Uint8Array>();
    const a = setup({
      rateBytesPerS: 1e9,
      onChange: (s) => (last = structuredClone(s)),
      onSegment: (id, n, d) => segs.set(`${id}:${n}`, d.slice()),
    });
    const big = bigFile();
    const r = await share(a.net, 2, [big]);
    expect(last).toBeDefined();
    expect(segs.size).toBeGreaterThan(1);

    const b = setup({ rateBytesPerS: 1e9, restore: { snap: last!, segment: (id, n) => segs.get(`${id}:${n}`) } });
    expect(b.fake.snapshot()).toEqual(last);
    expect(b.fake.shares()).toBe(1);
    const o = await openShare(r.link, PW, ORIGIN, undefined, b.net);
    const blob = await collectToBlob(o, 0);
    expect(Buffer.from(await blob.arrayBuffer()).equals(Buffer.from(big.data))).toBe(true);
    await o.done();
    o.wipe();
    expect(await shareStatus(r.manage, ORIGIN, b.net)).toMatchObject({ opensUsed: 1, maxOpens: 2 });
  });

  it("sans restore ni rappels : comportement inchangé (aucun état gardé)", async () => {
    const { fake, net } = setup();
    await share(net);
    expect(fake.snapshot().shares).toHaveLength(1);
    expect(createFakeServer().snapshot().shares).toHaveLength(0);
  });
});
