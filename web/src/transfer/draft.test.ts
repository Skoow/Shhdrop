// Brouillon d'envoi dès l'ajout (spec §41.14) contre le faux serveur de la démo (même contrat
// que le serveur Go) : envoi avant le clic, retrait qui efface sur le serveur, manifeste des
// seuls éléments gardés, abandon, et « le serveur ne voit rien ».
import { describe, expect, it } from "vitest";
import { findIn, needle } from "../../e2e/scan";
import { CHUNK_CT, HEADER, SEG_CHUNKS } from "../crypto/container";
import { SEG_PLAIN } from "../crypto/elements";
import { utf8 } from "../crypto/encoding";
import { createFakeServer } from "../demo/fake-server";
import { openShare, type CaptchaProof, type Item } from "../index";
import { createDraft } from "./draft";

const ORIGIN = "https://demo.test";
const PW = "Kq7!mP2#x?a";
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

  it("ordre et éléments du manifeste = ceux du clic ; note non remise : envoyée au clic ; le serveur ne voit rien", async () => {
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
    // Petits éléments empaquetés (audit H-2) ; emprise = morceaux nécessaires (D41-38) :
    // a (300 000 octets) occupe 5 morceaux, b commence au morceau 5.
    // La note (D41-36), jamais remise au brouillon, part au clic : morceau 6, après b.
    expect(o.manifest.items.map((e) => e.offset)).toEqual([6 * 65536, 5 * 65536, 0]);
    expect(o.manifest.items[0]!.text).toBe(`texte ${MARK}`);
    const smallPuts = seen.filter((x) => x.method === "PUT").map((x) => (x.body.length % CHUNK_CT === 0 ? x.body.length : x.body.length - HEADER) / CHUNK_CT);
    expect(smallPuts).toEqual([5, 1, 1]); // aucun bourrage envoyé (D41-38)
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

  it("note (D41-36) : envoyée dès sa validation (prête avant le clic) ; modifiée : renvoyée, le destinataire lit la nouvelle version", async () => {
    const { seen, net } = setup();
    const d = createDraft(ORIGIN, { ...net, solveCaptcha, auto: true });
    const v1 = new Blob([utf8("première version")]), v2 = new Blob([utf8("seconde version")]);
    d.sync([{ id: "n", data: v1 }]);
    await until(() => d.status("n")?.phase === "pret");
    const puts = seen.filter((x) => x.method === "PUT").length;
    expect(puts).toBe(1);
    d.sync([{ id: "n", data: v2 }]);
    await until(() => d.status("n")?.phase === "pret" && seen.filter((x) => x.method === "PUT").length === 2);
    const r = await d.finalize([{ id: "n", item: { kind: "text", name: "n", mime: "text/plain", data: v2 } }], { ttlHours: 1, maxOpens: 1, password: PW, solveCaptcha });
    expect(seen.filter((x) => x.method === "PUT").length).toBe(2); // rien de plus au clic
    const o = await openShare(r.link, PW, ORIGIN, undefined, net);
    expect(o.manifest.items[0]!.text).toBe("seconde version");
    // L'ancienne version, remplacée, est recouverte d'aléa à finalize (void) : jamais lisible.
    const fin = JSON.parse(seen.find((x) => x.path === "/api/shares/finalize")!.body.toString());
    expect(fin.void).toEqual([[0, 1]]);
  });

  it("le fichier change de contenu (nettoyage) : l'ancien est effacé, le nouveau renvoyé sous une clé neuve", async () => {
    const { seen, net } = setup();
    const d = createDraft(ORIGIN, { ...net, solveCaptcha, auto: true });
    const v1 = file(100, 1), v2 = file(80, 2);
    d.sync([{ id: "a", data: v1 }]);
    await until(() => d.status("a")?.phase === "pret");
    d.sync([{ id: "a", data: v2 }]);
    await until(() => d.status("a")?.phase === "pret");
    const r = await d.finalize([{ id: "a", item: fileItem("a", v2) }], { ttlHours: 1, maxOpens: 1, password: PW, solveCaptcha });
    const o = await openShare(r.link, PW, ORIGIN, undefined, net);
    expect((await o.item(0)).length).toBe(80);
    expect(o.manifest.items[0]!.offset).toBe(65536); // nouvelle place : l'ancienne n'est jamais réutilisée
    // Petit élément remplacé (audit H-2) : aucun effacement immédiat ; ses morceaux sont
    // remplacés par de l'aléa à finalize (void).
    expect(seen.some((x) => x.path === "/api/shares/erase")).toBe(false);
    const fin = JSON.parse(seen.find((x) => x.path === "/api/shares/finalize")!.body.toString());
    expect(fin.void).toEqual([[0, 1]]);
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
    // Grands éléments (un segment chacun) : seuls effacés sur le serveur (audit H-2).
    const a = file(SEG_PLAIN, 1), b = file(SEG_PLAIN, 2), c = file(SEG_PLAIN, 3);
    d.sync([
      { id: "a", data: a },
      { id: "b", data: b },
      { id: "c", data: c },
    ]);
    await until(() => ["a", "b", "c"].every((x) => d.status(x)?.phase === "pret"));
    d.sync([{ id: "a", data: a }]);
    expect(d.removing).toBe(2 * SEG_PLAIN);
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

  // Audit H-2 : 20 petits fichiers de 1 Mo envoyés sans bourrage (≈ 20 Mo, pas 80 Mio) ;
  // un grand n'envoie que ses morceaux ; un petit retiré n'est pas lu par le destinataire.
  it("empaquetage : octets envoyés ≈ somme des tailles ; petit retiré absent pour le destinataire", async () => {
    const { seen, fake, net } = setup();
    const d = createDraft(ORIGIN, { ...net, solveCaptcha, auto: true });
    const smalls = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, data: file(1_000_000, i + 1) }));
    const big = { id: "big", data: file(5 * 1048576, 99) };
    d.sync([...smalls, big]);
    await until(() => [...smalls, big].every((x) => d.status(x.id)?.phase === "pret"));
    const puts = seen.filter((r) => r.method === "PUT");
    const sent = puts.reduce((n, r) => n + r.body.length, 0);
    const sum = 20 * 1_000_000 + 5 * 1048576;
    // Arrondi au morceau de 64 Kio par élément (et 16 octets d'étiquette) : moins de 6 % ici ;
    // avant (un segment au moins par élément) : 20 × 4 Mio + 2 × 4 Mio = 88 Mio.
    expect(sent).toBeLessThan(sum * 1.06);
    expect(sent).toBeGreaterThanOrEqual(sum);
    // Emprise de chaque petit élément (une requête chacun) : ses seuls morceaux, ⌈1 000 000 / 64 Kio⌉ = 16 (D41-38).
    const smallPuts = puts.filter((r) => r.body.length < SEG_CHUNKS * CHUNK_CT);
    expect(smallPuts.length).toBeGreaterThanOrEqual(20);
    for (const r of smallPuts.slice(0, 20)) {
      expect((r.body.length % CHUNK_CT === 0 ? r.body.length : r.body.length - HEADER) / CHUNK_CT).toBe(16);
    }
    expect(puts.filter((r) => r.path.endsWith("/segments/0") || r.path.includes("?")).length).toBeGreaterThan(0);
    d.sync([...smalls.slice(1), big]); // retrait du premier petit
    await new Promise((r) => setTimeout(r, 20));
    expect(d.removing).toBe(0); // place rendue tout de suite
    const r = await d.finalize(
      [...smalls.slice(1), big].map((x) => ({ id: x.id, item: fileItem(`${x.id}.bin`, x.data) })),
      { ttlHours: 1, maxOpens: 1, password: PW, solveCaptcha },
    );
    expect(seen.some((x) => x.path === "/api/shares/erase")).toBe(false);
    const fin = JSON.parse(seen.find((x) => x.path === "/api/shares/finalize")!.body.toString());
    expect(fin.void).toEqual([[0, 16]]);
    const o = await openShare(r.link, PW, ORIGIN, undefined, net);
    expect(o.manifest.items.map((e) => e.name)).toEqual([...smalls.slice(1).map((x) => `${x.id}.bin`), "big.bin"]);
    const got = await o.item(0);
    expect(Buffer.from(got).equals(Buffer.from(await smalls[1]!.data.arrayBuffer()))).toBe(true);
    expect(Buffer.from(await o.item(19)).equals(Buffer.from(await big.data.arrayBuffer()))).toBe(true);
    expect(fake.inspect()[0]!.state).toBe("draining"); // ouverture unique consommée
  });
});

describe("brouillon perdu pendant le chiffrement (revue du 10 novembre)", { timeout: 60_000 }, () => {
  it("keep répond 404 pendant qu'un segment se chiffre : l'élément ne reste pas en « envoi », le clic aboutit", async () => {
    const { fake, net } = setup(400 * 1048576);
    let lose = false;
    const fetch = (async (u: RequestInfo | URL, i?: RequestInit) => {
      const req = new Request(u, i);
      if (lose && new URL(req.url).pathname === "/api/shares/keep") {
        lose = false;
        return new Response('{"error":"not_found"}', { status: 404 });
      }
      return fake.handle(req);
    }) as typeof globalThis.fetch;
    // Chiffrement ralenti : la fenêtre « dans sealer.piece » dure environ une seconde.
    const subtle = crypto.subtle as unknown as { encrypt: (...a: unknown[]) => Promise<ArrayBuffer> };
    const real = subtle.encrypt.bind(crypto.subtle);
    let slow = true;
    subtle.encrypt = async (...a) => {
      if (slow) await new Promise((r) => setTimeout(r, 15));
      return real(...a);
    };
    try {
      const d = createDraft(ORIGIN, { ...net, fetch, solveCaptcha, auto: true, keepMs: 40 });
      const data = file(9 * 1048576, 3);
      d.sync([{ id: "a", data }]);
      await until(() => d.status("a")?.phase === "chiffrement");
      await new Promise((r) => setTimeout(r, 100));
      lose = true;
      await until(() => d.status("a")?.phase === "attente");
      slow = false;
      await new Promise((r) => setTimeout(r, 1500));
      expect(d.status("a")?.phase).toBe("attente");
      const done = d.finalize([{ id: "a", item: fileItem("a.bin", data) }], { password: PW, ttlHours: 24, maxOpens: 1, solveCaptcha });
      const r = await Promise.race([done.then(() => "finalisé"), new Promise((res) => setTimeout(() => res("bloqué"), 15_000))]);
      expect(r).toBe("finalisé");
    } finally {
      subtle.encrypt = real;
    }
  });
});
