// Brouillon d'envoi dès l'ajout (spec §41.14) contre le faux serveur de la démo (même contrat
// que le serveur Go) : envoi avant le clic, retrait qui efface sur le serveur, manifeste des
// seuls éléments gardés, abandon, et « le serveur ne voit rien ».
import { describe, expect, it } from "vitest";
import { findIn, needle } from "../../e2e/scan";
import { SEG_PLAIN } from "../crypto/elements";
import { utf8 } from "../crypto/encoding";
import { createFakeServer } from "../demo/fake-server";
import { openShare, type CaptchaProof, type Item } from "../index";
import { createDraft } from "./draft";

const ORIGIN = "https://demo.test";
const PW = "Kq7!mP2#xYa";
const solveCaptcha = async (): Promise<CaptchaProof> => ({ kind: "pow", payload: "demo" });

function setup(rate = 40 * 1048576) {
  const fake = createFakeServer({ rateBytesPerS: rate });
  const seen: { method: string; path: string; body: Buffer; headers: string }[] = [];
  const fetch = (async (u: RequestInfo | URL, i?: RequestInit) => {
    const req = new Request(u, i);
    seen.push({
      method: req.method,
      path: new URL(req.url).pathname,
      body: Buffer.from(await req.clone().arrayBuffer()),
      headers: JSON.stringify([...req.headers]),
    });
    return fake.handle(req);
  }) as typeof globalThis.fetch;
  return { fake, seen, net: { fetch, retryDelayMs: 1 } };
}

const file = (n: number, seed: number) => new Blob([new Uint8Array(n).map((_, i) => (i * seed + 7) & 255)]);
const until = async (f: () => boolean, ms = 20_000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("délai dépassé");
    await new Promise((r) => setTimeout(r, 10));
  }
};
const fileItem = (name: string, data: Blob): Item => ({ kind: "file", name, mime: "application/octet-stream", data });

describe("brouillon (spec §41.14)", { timeout: 60_000 }, () => {
  it("l'envoi commence dès l'ajout ; retirer un fichier en cours efface ses segments ; le destinataire ne voit que le gardé", async () => {
    const { fake, seen, net } = setup(8 * 1048576); // 8 Mio/s : l'envoi dure
    const kept = file(5 * 1048576, 3);
    const removed = file(9 * 1048576, 5);
    const d = createDraft(ORIGIN, { ...net, solveCaptcha, auto: true });
    d.sync([
      { id: "a", data: kept },
      { id: "b", data: removed },
    ]);
    // Création et envoi avant tout clic.
    await until(() => seen.some((r) => r.method === "PUT"));
    await until(() => d.status("a")?.phase === "pret" && d.status("b")?.phase === "envoi");
    expect(d.progress().total).toBeGreaterThan(5 * 1048576 + 9 * 1048576);
    d.sync([{ id: "a", data: kept }]); // croix sur b pendant son envoi
    expect(d.status("b")).toBeUndefined();
    expect(d.progress().total).toBe(d.status("a")!.total);
    expect(d.removing).toBe(9 * 1048576); // place rendue seulement après l'effacement confirmé
    await until(() => seen.some((r) => r.path === "/api/shares/erase"));
    const er = JSON.parse(seen.find((r) => r.path === "/api/shares/erase")!.body.toString());
    expect(er).toEqual({ from: 2, to: 5 }); // b placé après a (segments 0 et 1), 3 segments
    await until(() => fake.inspect()[0]!.present.every((n) => n < 2));
    await until(() => d.removing === 0);

    const r = await d.finalize([{ id: "a", item: fileItem("garde.bin", kept) }], { ttlHours: 1, maxOpens: 1, password: PW, solveCaptcha });
    const o = await openShare(r.link, PW, ORIGIN, undefined, net);
    expect(o.manifest.items.map((e) => e.name)).toEqual(["garde.bin"]);
    const got = await o.item(0);
    expect(Buffer.from(got).equals(Buffer.from(await kept.arrayBuffer()))).toBe(true);
    expect(fake.inspect()[0]).toMatchObject({ bucket: 160 });
  });

  it("ordre et éléments du manifeste = ceux du clic ; textes au clic ; le serveur ne voit rien", async () => {
    const { seen, net } = setup();
    const MARK = "MOT-REPERE-brouillon";
    const a = new Uint8Array(300_000).map((_, i) => i & 255);
    a.set(utf8(MARK), 1000);
    const blobA = new Blob([a]), blobB = file(10, 9);
    const d = createDraft(ORIGIN, { ...net, solveCaptcha, auto: true });
    d.sync([
      { id: "a", data: blobA },
      { id: "b", data: blobB },
    ]);
    await until(() => d.status("a")?.phase === "pret" && d.status("b")?.phase === "pret");
    const r = await d.finalize(
      [
        { id: "t", item: { kind: "text", name: "note-repere", mime: "text/plain", data: utf8(`texte ${MARK}`) } },
        { id: "b", item: fileItem("b-repere.bin", blobB) },
        { id: "a", item: fileItem("a-repere.bin", blobA) },
      ],
      { ttlHours: 1, maxOpens: 1, password: PW, solveCaptcha },
    );
    const o = await openShare(r.link, PW, ORIGIN, undefined, net);
    expect(o.manifest.items.map((e) => e.name)).toEqual(["note-repere", "b-repere.bin", "a-repere.bin"]);
    expect(o.manifest.items.map((e) => e.offset)).toEqual([0, SEG_PLAIN, 0]); // a ajouté d'abord : segment 0
    const kLien = r.link.split("#")[1]!;
    const hay = Buffer.concat(seen.filter((x) => !x.path.includes("/unlock") && !x.path.includes("/meta")).map((x) => Buffer.concat([x.body, Buffer.from(x.path + x.headers)])));
    expect(findIn(hay, [needle("contenu", MARK), needle("nom", "a-repere"), needle("mdp", PW), needle("lien", kLien)])).toEqual([]);
  });

  it("texte seul : rien n'est créé avant le clic", async () => {
    const { seen, net } = setup();
    const d = createDraft(ORIGIN, { ...net, solveCaptcha, auto: true });
    d.sync([]);
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toEqual([]);
    const r = await d.finalize([{ id: "t", item: { kind: "text", name: "n", mime: "text/plain", data: utf8("bonjour") } }], {
      ttlHours: 1,
      maxOpens: 1,
      password: PW,
      solveCaptcha,
    });
    const o = await openShare(r.link, PW, ORIGIN, undefined, net);
    expect(o.manifest.items[0]!.text).toBe("bonjour");
  });

  it("abandon : brouillon détruit sur le serveur (keepalive)", async () => {
    const { fake, seen, net } = setup();
    const d = createDraft(ORIGIN, { ...net, solveCaptcha, auto: true });
    d.sync([{ id: "a", data: file(100, 1) }]);
    await until(() => d.status("a")?.phase === "pret");
    expect(fake.shares()).toBe(1);
    d.abandon();
    await until(() => seen.some((r) => r.path === "/api/manage/destroy"));
    await until(() => fake.shares() === 0);
  });

  it("le fichier change de contenu (nettoyage) : l'ancien est effacé, le nouveau renvoyé sous une clé neuve", async () => {
    const { seen, net } = setup();
    const d = createDraft(ORIGIN, { ...net, solveCaptcha, auto: true });
    const v1 = file(100, 1), v2 = file(80, 2);
    d.sync([{ id: "a", data: v1 }]);
    await until(() => d.status("a")?.phase === "pret");
    d.sync([{ id: "a", data: v2 }]);
    await until(() => d.status("a")?.phase === "pret" && seen.some((r) => r.path === "/api/shares/erase"));
    const r = await d.finalize([{ id: "a", item: fileItem("a", v2) }], { ttlHours: 1, maxOpens: 1, password: PW, solveCaptcha });
    const o = await openShare(r.link, PW, ORIGIN, undefined, net);
    expect((await o.item(0)).length).toBe(80);
  });

  it("place au-delà de la réservation : grow avant le segment", async () => {
    const { seen, net } = setup();
    const d = createDraft(ORIGIN, { ...net, solveCaptcha, auto: true });
    const small = file(100, 1), big = file(6 * 1048576, 3);
    d.sync([{ id: "a", data: small }]);
    await until(() => d.status("a")?.phase === "pret");
    d.sync([
      { id: "a", data: small },
      { id: "b", data: big },
    ]);
    await until(() => d.status("b")?.phase === "pret");
    const creates = seen.filter((r) => r.path === "/api/shares").map((r) => JSON.parse(r.body.toString()).bucket);
    const grows = seen.filter((r) => r.path === "/api/shares/grow").map((r) => JSON.parse(r.body.toString()).bucket);
    expect(creates).toEqual([80]);
    expect(grows).toEqual([160, 400]); // au fil de l'envoi : segment 1, puis segment 2
  });

  it("audit M4 : effacement refusé (503 busy) réessayé ; deux retraits rapides tous deux effacés", async () => {
    const { fake, seen, net } = setup();
    let busy = 1;
    const fetch = (async (u: RequestInfo | URL, i?: RequestInit) => {
      if (new URL(String(u instanceof Request ? u.url : u)).pathname === "/api/shares/erase" && busy-- > 0)
        return new Response(JSON.stringify({ error: "busy" }), { status: 503, headers: { "Content-Type": "application/json" } });
      return net.fetch(u, i);
    }) as typeof globalThis.fetch;
    const d = createDraft(ORIGIN, { fetch, retryDelayMs: 1, solveCaptcha, auto: true });
    const a = file(100, 1), b = file(100, 2), c = file(100, 3);
    d.sync([
      { id: "a", data: a },
      { id: "b", data: b },
      { id: "c", data: c },
    ]);
    await until(() => ["a", "b", "c"].every((x) => d.status(x)?.phase === "pret"));
    d.sync([{ id: "a", data: a }]);
    expect(d.removing).toBe(200);
    await until(() => d.removing === 0, 10_000);
    expect(seen.filter((r) => r.path === "/api/shares/erase").length).toBe(2);
    expect(fake.inspect()[0]!.present).toEqual([0]);
  });

  it("tout déjà envoyé au clic : onProgress commence par (0, n) puis (n, n) ; erreur d'un fichier → Réessayer", async () => {
    const { net } = setup();
    let fail = 1;
    const fetch = (async (u: RequestInfo | URL, i?: RequestInit) => {
      if (i?.method === "PUT" && fail-- > 0) return new Response(JSON.stringify({ error: "bad_request" }), { status: 400 });
      return net.fetch(u, i);
    }) as typeof globalThis.fetch;
    const d = createDraft(ORIGIN, { fetch, retryDelayMs: 1, solveCaptcha, auto: true });
    const a = file(100, 1);
    d.sync([{ id: "a", data: a }]);
    await until(() => d.status("a")?.phase === "erreur");
    d.retry("a");
    await until(() => d.status("a")?.phase === "pret");
    const prog: [number, number][] = [];
    await d.finalize([{ id: "a", item: fileItem("a", a) }], { ttlHours: 1, maxOpens: 1, password: PW, solveCaptcha, onProgress: (x, n) => prog.push([x, n]) });
    expect(prog).toEqual([[0, 1], [1, 1]]);
  });
});
