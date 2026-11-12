import { describe, expect, it, vi } from "vitest";
import { BadPasswordError, GrantInvalidError, LimitError, NotFoundError, ReopenLimitError, ServerError, type Opened } from "../index";
import type { OpenGrantEntry } from "../session/open-grant";
import { createReceiver, type ReceiverDeps } from "./receive.svelte";

const LINK = "https://x.test/#" + "A".repeat(43);
const PW = "mot-de-passe-repere-91";
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(over: Partial<ReceiverDeps> = {}, link: string | null = LINK) {
  let t = 1_000_000;
  const clock = { advance: (ms: number) => (t += ms) };
  const fetchMeta = vi.fn(async () => ({ expiresInS: 3600, opensLeft: 3 }));
  const opened = { manifest: { v: 2, rights: "enregistrer", items: [] }, grant: GRANT } as unknown as Opened;
  const openShare = vi.fn(async (): Promise<Opened> => opened);
  const scrub = vi.fn();
  const timers: { ms: number; f: () => void; on: boolean }[] = [];
  const every = (ms: number, f: () => void) => {
    const x = { ms, f, on: true };
    timers.push(x);
    return () => void (x.on = false);
  };
  /** Avance l'horloge et déclenche les minuteries échues (une fois par période franchie). */
  const tick = (ms: number) => {
    for (let k = 0; k < ms; k += 60_000) {
      t += 60_000;
      for (const x of [...timers]) if (x.on && (t - 1_000_000) % x.ms === 0) x.f();
    }
  };
  const store = memStore();
  const returns = memReturns();
  const deps: Partial<ReceiverDeps> = {
    fetchMeta,
    openShare,
    scrub,
    now: () => t,
    inAppBrowser: () => null,
    origin: "https://x.test",
    online: () => true,
    grants: store,
    tag: async () => TAG,
    askTabs: async () => null,
    answerTabs: () => () => undefined,
    every,
    returns,
    ...over,
  };
  const r = createReceiver(link === null ? { kind: "incomplete" } : { kind: "s", link }, deps);
  return { r, fetchMeta: deps.fetchMeta!, openShare: deps.openShare!, scrub: deps.scrub!, clock, opened, store, tick, timers, returns: deps.returns as ReturnType<typeof memReturns> };
}

const GRANT = "G".repeat(54);
const GRANT2 = "H".repeat(54);
const TAG = "T".repeat(22);

function memStore(init: OpenGrantEntry | null = null) {
  let v: OpenGrantEntry | null = init;
  return {
    load: vi.fn(() => v),
    save: vi.fn((e: OpenGrantEntry) => void (v = { ...e })),
    clear: vi.fn(() => void (v = null)),
    get value() {
      return v;
    },
  };
}

/** Retours gardés (history/returns.ts), en mémoire. */
function memReturns(init: Record<string, string> = {}) {
  const m = new Map<string, { grant: string; expiresAt: number }>(Object.entries(init).map(([k, g]) => [k, { grant: g, expiresAt: 9e15 }]));
  return {
    m,
    find: vi.fn(async (tag: string) => m.get(tag)?.grant ?? null),
    save: vi.fn(async (e: { tag: string; grant: string; expiresAt: number }) => void m.set(e.tag, { grant: e.grant, expiresAt: e.expiresAt })),
    forget: vi.fn(async (tag: string) => void m.delete(tag)),
  };
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

describe("rechargement et autres onglets (spec §41.4, UI §9.7.1)", () => {
  const KEY = "A".repeat(43);
  const entry = (over: Partial<OpenGrantEntry> = {}): OpenGrantEntry => ({ v: 1, link: KEY, grant: GRANT, last: 1_000_000, ...over });

  it("saveOpenGrant seulement après un openShare réussi ; ni mot de passe ni clé dans l'entrée", async () => {
    const store = memStore();
    let fail = true;
    const { r } = setup({
      grants: store,
      openShare: vi.fn(async () => (fail ? Promise.reject(new BadPasswordError(4)) : ({ grant: GRANT } as unknown as Opened))),
    });
    await flush();
    await r.unlock(PW);
    expect(store.save).not.toHaveBeenCalled();
    fail = false;
    await r.unlock(PW);
    expect(store.save).toHaveBeenCalledTimes(1);
    const v = store.value!;
    expect(Object.keys(v).sort()).toEqual(["grant", "last", "link", "v"]);
    expect(v.link).toBe(KEY);
    expect(v.grant).toBe(GRANT);
    expect(JSON.stringify(v)).not.toContain(PW);
  });

  it("rechargement (sans « # ») avec entrée → reopen, mot de passe ressaisi, unlock avec l'octroi", async () => {
    const store = memStore(entry());
    const { r, fetchMeta, openShare } = setup({ grants: store }, null);
    await flush();
    expect(r.state).toBe("reopen");
    expect(fetchMeta).toHaveBeenCalledWith(LINK, "https://x.test", GRANT);
    await r.unlock(PW);
    expect(openShare).toHaveBeenCalledWith(LINK, PW, "https://x.test", GRANT);
    expect(r.state).toBe("open");
  });

  it("mauvais mot de passe en reopen : reste en reopen, essais affichés", async () => {
    const { r } = setup({ grants: memStore(entry()), openShare: vi.fn(async () => Promise.reject(new BadPasswordError(4))) }, null);
    await flush();
    await r.unlock("faux");
    expect([r.state, r.error, r.attemptsLeft]).toEqual(["reopen", "bad_password", 4]);
  });

  // Audit M2 : Chromium écrit sessionStorage sur le disque et le restaure avec l'onglet
  // fermé (type de navigation « back_forward », constaté par persist.spec.ts). Hors
  // rechargement, l'entrée ne vaut que 2 min après la dernière sortie de page.
  it.each([
    ["back_forward", 3 * 60_000, "incomplete"],
    ["navigate", 3 * 60_000, "incomplete"],
    ["", 2 * 60_000, "incomplete"],
    ["back_forward", 2 * 60_000 - 1, "reopen"],
    ["reload", 10 * 60_000, "reopen"],
  ])("navigation « %s », sortie il y a %i ms → %s", async (nav, ago, want) => {
    const store = memStore(entry({ last: 1_000_000 - ago }));
    const { r } = setup({ grants: store, navType: () => nav }, null);
    await flush();
    expect(r.state).toBe(want);
    if (want === "incomplete") expect(store.value).toBeNull();
  });

  it("pagehide : l'heure de sortie est notée dans l'entrée (last), rien d'autre", async () => {
    let hide: () => void = () => undefined;
    const store = memStore(entry({ last: 0 }));
    const { clock } = setup({ grants: store, navType: () => "reload", onHide: (f) => ((hide = f), () => undefined) }, null);
    await flush();
    clock.advance(5_000);
    hide();
    expect(store.value).toEqual(entry({ last: 1_005_000 }));
    store.clear();
    hide();
    expect(store.value).toBeNull();
  });

  it("un « # » différent du lien gardé efface l'entrée (autre partage)", async () => {
    const store = memStore(entry({ link: "B".repeat(43) }));
    const { r, fetchMeta } = setup({ grants: store });
    await flush();
    expect(store.clear).toHaveBeenCalled();
    expect(r.state).toBe("locked");
    expect(fetchMeta).toHaveBeenCalledWith(LINK, "https://x.test");
  });

  it("grant_invalid et reopen_limit : entrée effacée, retour à locked avec la phrase, puis déverrouillage sans octroi", async () => {
    for (const [err, code] of [[new GrantInvalidError(), "grant_invalid"], [new ReopenLimitError(), "reopen_limit"]] as const) {
      const store = memStore(entry());
      let first = true;
      const openShare = vi.fn(async () => {
        if (first) {
          first = false;
          throw err;
        }
        return { grant: GRANT2 } as unknown as Opened;
      });
      const { r } = setup({ grants: store, openShare }, null);
      await flush();
      await r.unlock(PW);
      expect([r.state, r.error]).toEqual(["locked", code]);
      expect(store.value).toBeNull();
      await r.unlock(PW);
      expect(openShare).toHaveBeenLastCalledWith(LINK, PW, "https://x.test");
      expect(store.value?.grant).toBe(GRANT2);
    }
  });

  it("NotFoundError, échéance et forget (Terminer, destruction, disparition) effacent l'entrée", async () => {
    const a = memStore(entry());
    const ra = setup({ grants: a, fetchMeta: vi.fn(async () => Promise.reject(new NotFoundError())) }, null).r;
    await flush();
    // D42-22 : un octroi était gardé, le serveur ne connaît plus le partage → « retour impossible ».
    expect([ra.state, a.value]).toEqual(["return_lost", null]);
    const b = memStore(entry());
    const rb = setup({ grants: b }, null).r;
    await flush();
    rb.expire();
    expect(b.value).toBeNull();
    const c = memStore();
    const rc = setup({ grants: c }).r;
    await flush();
    await rc.unlock(PW);
    expect(c.value).not.toBeNull();
    rc.forget();
    expect(c.value).toBeNull();
  });

  it("30 min sans activité : entrée de l'onglet effacée (pas le retour gardé) ; l'activité la garde ; aucun renouvellement (D42-22)", async () => {
    const store = memStore();
    const { r, tick, returns } = setup({ grants: store });
    await flush();
    await r.unlock(PW);
    tick(20 * 60_000);
    await flush();
    expect(store.value?.grant).toBe(GRANT);
    r.touch();
    tick(29 * 60_000);
    expect(store.value).not.toBeNull();
    tick(60_000);
    expect(store.value).toBeNull();
    expect(returns.m.get(TAG)?.grant).toBe(GRANT);
  });

  // ---------- D42-22 : revenir depuis le même navigateur jusqu'à l'échéance ----------
  it("après un déverrouillage réussi : l'octroi est gardé (étiquette, octroi, échéance), jamais le lien ni le mot de passe", async () => {
    const { r, returns } = setup();
    await flush();
    await r.unlock(PW);
    expect(returns.save).toHaveBeenCalledTimes(1);
    const e = returns.save.mock.calls[0]![0];
    expect(Object.keys(e).sort()).toEqual(["expiresAt", "grant", "tag"]);
    expect(e).toEqual({ tag: TAG, grant: GRANT, expiresAt: 1_000_000 + 3600_000 });
    expect(JSON.stringify(e)).not.toContain("A".repeat(43));
    expect(JSON.stringify(e)).not.toContain(PW);
  });

  it("lien rouvert depuis le message (onglet neuf) avec un retour gardé : écran « Rouvrir », mot de passe ressaisi, unlock avec l'octroi", async () => {
    const returns = memReturns({ [TAG]: GRANT });
    const { r, fetchMeta, openShare } = setup({ returns });
    await flush();
    expect([r.state, r.reopening]).toEqual(["reopen", true]);
    expect(fetchMeta).toHaveBeenCalledWith(LINK, "https://x.test", GRANT);
    await r.unlock(PW);
    expect(openShare).toHaveBeenCalledWith(LINK, PW, "https://x.test", GRANT);
    expect(r.state).toBe("open");
  });

  it("un autre onglet qui répond passe avant le retour gardé", async () => {
    const returns = memReturns({ [TAG]: GRANT });
    const { r, fetchMeta } = setup({ returns, askTabs: async () => GRANT2 });
    await flush();
    expect(r.otherTab).toBe(true);
    expect(fetchMeta).toHaveBeenCalledWith(LINK, "https://x.test", GRANT2);
    expect(returns.find).not.toHaveBeenCalled();
  });

  it("retour gardé mais partage introuvable (détruit, expiré, serveur redémarré) : « retour impossible », retour oublié", async () => {
    const returns = memReturns({ [TAG]: GRANT });
    const { r } = setup({ returns, fetchMeta: vi.fn(async () => Promise.reject(new NotFoundError())) });
    await flush();
    await flush();
    expect(r.state).toBe("return_lost");
    expect(returns.m.size).toBe(0);
  });

  it("sans retour gardé (autre appareil, navigation privée) et introuvable : lien invalide", async () => {
    const { r } = setup({ fetchMeta: vi.fn(async () => Promise.reject(new NotFoundError())) });
    await flush();
    expect(r.state).toBe("invalid");
  });

  it("grant_invalid ou reopen_limit sur un retour gardé : retour oublié, déverrouillage normal ensuite", async () => {
    for (const err of [new GrantInvalidError(), new ReopenLimitError()]) {
      const returns = memReturns({ [TAG]: GRANT });
      let first = true;
      const openShare = vi.fn(async () => {
        if (first) {
          first = false;
          throw err;
        }
        return { grant: GRANT2 } as unknown as Opened;
      });
      const { r } = setup({ returns, openShare });
      await flush();
      await r.unlock(PW);
      await flush();
      expect(r.state).toBe("locked");
      expect(returns.m.size).toBe(0);
      await r.unlock(PW);
      expect(openShare).toHaveBeenLastCalledWith(LINK, PW, "https://x.test");
      expect(returns.m.get(TAG)?.grant).toBe(GRANT2);
    }
  });

  it("destruction, disparition ou échéance (forget) : retour oublié ; démontage du contenu (dispose) : gardé", async () => {
    const a = setup();
    await flush();
    await a.r.unlock(PW);
    a.r.forget();
    await flush();
    expect(a.returns.m.size).toBe(0);
    const b = setup();
    await flush();
    await b.r.unlock(PW);
    b.r.dispose();
    await flush();
    expect(b.returns.m.get(TAG)?.grant).toBe(GRANT);
  });

  it("entrée de plus de 30 min au chargement : effacée, écran normal", async () => {
    const store = memStore(entry({ last: 1_000_000 - 30 * 60_000 }));
    const { r } = setup({ grants: store }, null);
    await flush();
    expect(r.state).toBe("incomplete");
    expect(store.value).toBeNull();
  });

  it("autre onglet : octroi reçu → même ouverture, phrase « déjà ouvert » ; sans réponse → écran normal", async () => {
    const ask = vi.fn(async () => GRANT2);
    const { r, openShare, fetchMeta } = setup({ askTabs: ask });
    await flush();
    expect(ask).toHaveBeenCalledWith(TAG);
    expect([r.state, r.otherTab]).toEqual(["locked", true]);
    expect(fetchMeta).toHaveBeenCalledWith(LINK, "https://x.test", GRANT2);
    await r.unlock(PW);
    expect(openShare).toHaveBeenCalledWith(LINK, PW, "https://x.test", GRANT2);
    const r2 = setup({ askTabs: vi.fn(async () => null) }).r;
    await flush();
    expect([r2.state, r2.otherTab]).toEqual(["locked", false]);
  });

  it("répond aux autres onglets avec l'octroi en mémoire, pour sa seule étiquette ; plus après forget", async () => {
    let answer: ((tag: string) => string | null) | null = null;
    const { r } = setup({ answerTabs: (g) => ((answer = g), () => void (answer = null)) });
    await flush();
    expect(answer).toBeNull();
    await r.unlock(PW);
    expect(answer!(TAG)).toBe(GRANT);
    expect(answer!("U".repeat(22))).toBeNull();
    r.forget();
    expect(answer).toBeNull();
  });
});


describe("audit M2 : écran quitté pendant le déverrouillage ou la lecture", () => {
  it("forget() pendant unlock : rien n'est gardé (ni octroi, ni contenu, ni minuterie), les clés sont effacées", async () => {
    let release!: (o: Opened) => void;
    const done = vi.fn(async () => undefined);
    const opened = { manifest: { items: [] }, grant: GRANT, done } as unknown as Opened;
    const answer = vi.fn(() => () => undefined);
    const t = setup({ openShare: () => new Promise<Opened>((res) => (release = res)), answerTabs: answer });
    await flush();
    expect(t.r.state).toBe("locked");
    const p = t.r.unlock(PW);
    t.r.forget();
    release(opened);
    await p;
    expect(t.r.opened).toBeUndefined();
    expect(t.r.state).not.toBe("open");
    expect(t.store.save).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
    expect(t.timers.filter((x) => x.on)).toEqual([]);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("forget() pendant fetchMeta : aucun état n'est écrit ensuite", async () => {
    let release!: (m: { expiresInS: number; opensLeft: number }) => void;
    const t = setup({ fetchMeta: () => new Promise((res) => (release = res)) });
    await flush();
    t.r.forget();
    release({ expiresInS: 3600, opensLeft: 2 });
    await flush();
    expect(t.r.state).toBe("meta");
    expect(t.r.opensLeft).toBe(0);
  });
});

describe("audit M2 : dispose (écran démonté)", () => {
  it("contenu affiché : entrée de l'onglet gardée (retour, rechargement), minuteries arrêtées", async () => {
    const t = setup();
    await flush();
    await t.r.unlock(PW);
    expect(t.r.state).toBe("open");
    t.r.dispose();
    expect(t.store.load()).not.toBeNull();
    expect(t.timers.filter((x) => x.on)).toEqual([]);
    expect(t.r.opened).toBeUndefined();
  });
  it("avant le déverrouillage : comme forget (rien n'est gardé)", async () => {
    const t = setup();
    await flush();
    t.r.dispose();
    expect(t.store.load()).toBeNull();
    expect(t.timers.filter((x) => x.on)).toEqual([]);
  });
});
