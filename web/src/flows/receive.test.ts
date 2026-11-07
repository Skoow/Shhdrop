import { describe, expect, it, vi } from "vitest";
import { BadPasswordError, LimitError, NotFoundError, ServerError, type Opened } from "../index";
import { createReceiver, type ReceiverDeps } from "./receive.svelte";

const LINK = "https://x.test/#" + "A".repeat(43);
const PW = "mot-de-passe-repere-91";
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(over: Partial<ReceiverDeps> = {}, link: string | null = LINK) {
  let t = 1_000_000;
  const clock = { advance: (ms: number) => (t += ms) };
  const fetchMeta = vi.fn(async () => ({ expiresInS: 3600, opensLeft: 3 }));
  const opened = { manifest: { v: 2, rights: "enregistrer", items: [] } } as unknown as Opened;
  const openShare = vi.fn(async (): Promise<Opened> => opened);
  const scrub = vi.fn();
  const deps = { fetchMeta, openShare, scrub, now: () => t, inAppBrowser: () => null, origin: "https://x.test", online: () => true, ...over };
  const r = createReceiver(link === null ? { kind: "incomplete" } : { kind: "s", link }, deps);
  return { r, fetchMeta: deps.fetchMeta, openShare: deps.openShare, scrub: deps.scrub, clock, opened };
}

/** Toute valeur atteignable depuis l'objet exposé (getters lus), en texte. */
function exposed(r: object): string {
  const seen = new Set<unknown>();
  const out: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 4 || seen.has(v)) return;
    seen.add(v);
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k], depth + 1);
  };
  walk(Object.fromEntries(Object.keys(r).map((k) => [k, (r as Record<string, unknown>)[k]])), 0);
  return out.join("\n");
}

describe("createReceiver (UI §9.7)", () => {
  it("fetchMeta → locked, scrub une fois, juste après la lecture ; le lien n'est jamais exposé", async () => {
    const { r, fetchMeta, scrub } = setup();
    expect(scrub).toHaveBeenCalledTimes(1);
    expect(r.state).toBe("meta");
    await flush();
    expect(r.state).toBe("locked");
    expect(r.expiresInS).toBe(3600);
    expect(r.opensLeft).toBe(3); // ruling 5 : « encore 3 fois »
    expect(fetchMeta).toHaveBeenCalledWith(LINK, "https://x.test");
    expect(exposed(r)).not.toContain("A".repeat(43));
  });

  it("NotFoundError ou lien_invalide à fetchMeta → invalid", async () => {
    for (const e of [new NotFoundError(), new Error("lien_invalide")]) {
      const { r } = setup({ fetchMeta: vi.fn(async () => Promise.reject(e)) });
      await flush();
      expect(r.state).toBe("invalid");
    }
  });

  it("réseau à fetchMeta → error/network, puis Réessayer ; LimitError(120) → error/limit", async () => {
    let fail = true;
    const { r } = setup({ fetchMeta: vi.fn(async () => (fail ? Promise.reject(new Error("reseau")) : { expiresInS: 60, opensLeft: 1 })) });
    await flush();
    expect([r.state, r.error]).toEqual(["error", "network"]);
    fail = false;
    await r.retry();
    expect(r.state).toBe("locked");

    const l = setup({ fetchMeta: vi.fn(async () => Promise.reject(new LimitError(120))) });
    await flush();
    expect([l.r.state, l.r.error, l.r.retryAfterS]).toEqual(["error", "limit", 120]);
  });

  it("5xx à fetchMeta → error/server ; 503 « frozen » → error/maintenance (tâche UP)", async () => {
    const a = setup({ fetchMeta: vi.fn(async () => Promise.reject(new ServerError(false))) });
    await flush();
    expect([a.r.state, a.r.error]).toEqual(["error", "server"]);
    const b = setup({ fetchMeta: vi.fn(async () => Promise.reject(new ServerError(true))) });
    await flush();
    expect([b.r.state, b.r.error]).toEqual(["error", "maintenance"]);
  });

  it("navigateur hors ligne : error/network sans aucune requête ; de retour en ligne, Réessayer relit", async () => {
    let on = false;
    const { r, fetchMeta } = setup({ online: () => on });
    await flush();
    expect([r.state, r.error]).toEqual(["error", "network"]);
    expect(fetchMeta).not.toHaveBeenCalled();
    on = true;
    await r.retry();
    expect(r.state).toBe("locked");
    expect(fetchMeta).toHaveBeenCalledTimes(1);
  });

  it("lien incomplet → incomplete, sans requête", async () => {
    const { r, fetchMeta } = setup({}, null);
    await flush();
    expect(r.state).toBe("incomplete");
    expect(fetchMeta).not.toHaveBeenCalled();
  });

  it("BadPasswordError(3) → locked, attemptsLeft = 3, message ; le champ n'est pas gardé", async () => {
    const { r } = setup({ openShare: vi.fn(async () => Promise.reject(new BadPasswordError(3))) });
    await flush();
    await r.unlock(PW);
    expect([r.state, r.attemptsLeft, r.error]).toEqual(["locked", 3, "bad_password"]);
    expect(exposed(r)).not.toContain(PW);
  });

  it("attemptsLeft était 1, puis NotFoundError → destroyed_by_password ; sinon → invalid", async () => {
    const answers: unknown[] = [new BadPasswordError(1), new NotFoundError()];
    const { r } = setup({ openShare: vi.fn(async () => Promise.reject(answers.shift())) });
    await flush();
    await r.unlock(PW);
    expect(r.attemptsLeft).toBe(1);
    await r.unlock(PW);
    expect(r.state).toBe("destroyed_by_password");

    const o = setup({ openShare: vi.fn(async () => Promise.reject(new NotFoundError())) });
    await flush();
    await o.r.unlock(PW);
    expect(o.r.state).toBe("invalid");
  });

  it("LimitError(120) à l'ouverture → locked, retryAfterS, aucun appel avant l'échéance", async () => {
    const { r, openShare, clock } = setup({ openShare: vi.fn(async () => Promise.reject(new LimitError(120))) });
    await flush();
    await r.unlock(PW);
    expect([r.state, r.error, r.retryAfterS]).toEqual(["locked", "limit", 120]);
    await r.unlock(PW);
    expect(openShare).toHaveBeenCalledTimes(1);
    clock.advance(120_000);
    await r.unlock(PW);
    expect(openShare).toHaveBeenCalledTimes(2);
  });

  it("compte à rebours à zéro en locked → invalid sans appel (expire() ou unlock après l'échéance)", async () => {
    const a = setup();
    await flush();
    a.r.expire();
    expect(a.r.state).toBe("invalid");
    await a.r.unlock(PW);
    expect(a.openShare).not.toHaveBeenCalled();

    const b = setup();
    await flush();
    b.clock.advance(3600_000);
    expect(b.r.remainingS()).toBe(0);
    await b.r.unlock(PW);
    expect(b.r.state).toBe("invalid");
    expect(b.openShare).not.toHaveBeenCalled();
  });

  it("unlock deux fois de suite → un seul openShare", async () => {
    let resolve!: (o: Opened) => void;
    const { r, openShare, opened } = setup({ openShare: vi.fn(() => new Promise<Opened>((res) => (resolve = res))) });
    await flush();
    const p1 = r.unlock(PW);
    const p2 = r.unlock(PW);
    expect(r.state).toBe("unlocking");
    resolve(opened);
    await Promise.all([p1, p2]);
    expect(openShare).toHaveBeenCalledTimes(1);
    expect(r.state).toBe("open");
    expect(r.opened).toBe(opened);
  });

  it("après succès : aucune trace du mot de passe ni du lien dans l'état", async () => {
    const { r } = setup();
    await flush();
    await r.unlock(PW);
    expect(r.state).toBe("open");
    const all = exposed(r);
    expect(all).not.toContain(PW);
    expect(all).not.toContain("A".repeat(43));
  });

  it("unlock(\"\") ou Error(\"mot_de_passe_requis\") → « Entrez le mot de passe. », attemptsLeft inchangé, locked", async () => {
    const answers: unknown[] = [new BadPasswordError(4), new Error("mot_de_passe_requis")];
    const { r, openShare } = setup({ openShare: vi.fn(async () => Promise.reject(answers.shift())) });
    await flush();
    await r.unlock("");
    expect([r.state, r.error, r.attemptsLeft]).toEqual(["locked", "password_required", undefined]);
    expect(openShare).not.toHaveBeenCalled();
    await r.unlock(PW);
    expect(r.attemptsLeft).toBe(4);
    await r.unlock(" ");
    expect([r.state, r.error, r.attemptsLeft]).toEqual(["locked", "password_required", 4]);
  });

  it("réseau à l'ouverture → locked/network (rien n'est affirmé sur l'ouverture consommée)", async () => {
    const { r } = setup({ openShare: vi.fn(async () => Promise.reject(new Error("reseau"))) });
    await flush();
    await r.unlock(PW);
    expect([r.state, r.error]).toEqual(["locked", "network"]);
  });

  it("navigateur intégré → inapp, aucune requête ni scrub ; continueHere() → scrub puis locked", async () => {
    const { r, fetchMeta, scrub } = setup({ inAppBrowser: () => "Instagram" });
    await flush();
    expect([r.state, r.app]).toEqual(["inapp", "Instagram"]);
    expect(scrub).not.toHaveBeenCalled();
    expect(fetchMeta).not.toHaveBeenCalled();
    r.continueHere();
    expect(scrub).toHaveBeenCalledTimes(1);
    await flush();
    expect(r.state).toBe("locked");
    r.continueHere(); // sans effet hors de « inapp »
    expect(scrub).toHaveBeenCalledTimes(1);
  });

  it("lien incomplet dans un navigateur intégré : incomplete, le # reste (aucun scrub)", async () => {
    const { r, scrub } = setup({ inAppBrowser: () => "Facebook" }, null);
    expect(r.state).toBe("incomplete");
    expect(scrub).not.toHaveBeenCalled();
  });

  it("forget() : plus aucune référence au contenu ouvert", async () => {
    const { r } = setup();
    await flush();
    await r.unlock(PW);
    expect(r.opened).toBeDefined();
    r.forget();
    expect(r.opened).toBeUndefined();
  });
});
