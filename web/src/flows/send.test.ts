import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LimitError, NotFoundError, SERVER_STALL_MS, type CaptchaCtx, type CaptchaProof, type CreateOpts, type Item } from "../index";
import { markElementFailure } from "../transfer/draft";
import { PAUSE_MAX_MS, STALL_MS, UPLOAD_WINDOW_MS, createSender, type SendDeps, type Step } from "./send.svelte";

type Res = { link: string; manage: string; expiresInS: number };
type Call = { opts: CreateOpts; resolve(r: Res): void; reject(e: unknown): void; items: Item[] };

const LINK = "https://x.test/#" + "A".repeat(43);
const MANAGE = "https://x.test/#m" + "B".repeat(43);
const RES: Res = { link: LINK, manage: MANAGE, expiresInS: 43200 };
const ITEMS: Item[] = [{ kind: "text", name: "t.txt", mime: "text/plain", data: new Uint8Array(4) }];
const OPTS = { origin: "https://x.test", base: "/", ttlHours: 12 as const, maxOpens: 1, password: "pw-generated" };
const flush = () => vi.advanceTimersByTimeAsync(0);

function setup(extra: Partial<SendDeps> = {}) {
  const calls: Call[] = [];
  const createShare = vi.fn((_o: string, items: Item[], opts: CreateOpts) =>
    new Promise<Res>((resolve, reject) => calls.push({ opts, resolve, reject, items })),
  );
  const solveCaptcha = vi.fn(async (_c: unknown, _x: CaptchaCtx): Promise<CaptchaProof> => ({ kind: "pow", payload: "p" }));
  const wake = { acquire: vi.fn(), release: vi.fn() };
  const unload = vi.fn();
  const steps: Step[] = [];
  const s = createSender({
    createShare,
    solveCaptcha,
    now: () => Date.now(),
    wakeLock: wake,
    onBeforeUnload: unload,
    onStep: (x) => steps.push(x),
    ...extra,
  });
  const last = () => calls[calls.length - 1]!;
  return { s, calls, last, createShare, solveCaptcha, wake, unload, steps };
}

/** Création faite côté serveur : captcha résolu puis onProgress(0, n). */
async function toUpload(t: ReturnType<typeof setup>, segments = 3, bytes = 300) {
  const o = t.last().opts;
  await o.solveCaptcha({ c: 1 }, { fallbackOrigin: null, mode: "pow" });
  o.onProgress!(0, segments);
  o.onBytes!(0, bytes);
  return o;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000_000);
});
afterEach(() => vi.useRealTimers());

describe("createSender : phases (UI §9.4.1)", () => {
  it("keys → captcha → upload → finalize → sealed (résolution seulement) ; mot de passe seulement dans result", async () => {
    const t = setup();
    expect(t.s.phase).toBe("idle");
    void t.s.start(ITEMS, OPTS);
    expect(t.s.phase).toBe("keys");
    expect(t.createShare).toHaveBeenCalledTimes(1);
    const o = t.last().opts;
    expect(o.base).toBe("/");
    expect(o.ttlHours).toBe(12);
    const proof = o.solveCaptcha({ c: 1 }, { fallbackOrigin: null, mode: "pow" });
    expect(t.s.phase).toBe("captcha");
    expect(t.solveCaptcha).toHaveBeenCalledWith({ c: 1 }, { fallbackOrigin: null, mode: "pow" });
    await proof;
    expect(t.s.phase).toBe("captcha");
    o.onProgress!(0, 3);
    expect(t.s.phase).toBe("upload");
    expect(t.s.createdOnServer).toBe(true);
    expect(t.s.segments).toEqual({ done: 0, total: 3 });
    o.onBytes!(100, 300);
    o.onProgress!(1, 3);
    expect(t.s.sent).toBe(100);
    expect(t.s.total).toBe(300);
    o.onBytes!(300, 300);
    expect(t.s.phase).toBe("finalize");
    o.onProgress!(3, 3);
    expect(t.s.phase).toBe("finalize");
    expect(t.s.result).toBeUndefined();
    t.last().resolve(RES);
    await flush();
    expect(t.s.phase).toBe("sealed");
    expect(t.s.result).toEqual({ ...RES, password: "pw-generated" });
    expect(JSON.stringify({ ...t.s, result: undefined })).not.toContain("pw-generated");
  });

  it("texte seul (spec §41.14) : onProgress(0, 0) → créé sur le serveur, puis finalisation directe", async () => {
    const t = setup();
    void t.s.start(ITEMS, OPTS);
    await t.last().opts.solveCaptcha({ c: 1 }, { fallbackOrigin: null, mode: "pow" });
    t.last().opts.onProgress!(0, 0);
    expect(t.s.createdOnServer).toBe(true);
    expect(t.s.phase).toBe("finalize");
  });

  it("start deux fois → un seul createShare (refus hors idle)", async () => {
    const t = setup();
    void t.s.start(ITEMS, OPTS);
    void t.s.start(ITEMS, OPTS);
    await flush();
    expect(t.createShare).toHaveBeenCalledTimes(1);
  });

  it("étapes : chiffré (tous les octets partis), puis envoyé et scellé à la résolution seulement (audit M12) ; une par étape, dans l'ordre", async () => {
    const t = setup();
    void t.s.start(ITEMS, OPTS);
    const o = await toUpload(t, 2, 200);
    o.onBytes!(100, 200);
    o.onProgress!(1, 2);
    expect(t.s.steps).toEqual([]);
    o.onBytes!(200, 200);
    o.onBytes!(200, 200);
    expect(t.s.steps).toEqual(["chiffre"]);
    o.onProgress!(2, 2);
    expect(t.s.steps).toEqual(["chiffre"]); // tout est sur le serveur, mais aucun lien n'existe encore
    t.last().resolve(RES);
    await flush();
    expect(t.s.steps).toEqual(["chiffre", "envoye", "scelle"]);
    expect(t.steps).toEqual(["chiffre", "envoye", "scelle"]);
  });
});

describe("createSender : coupure (UI §9.4.3)", () => {
  it("onRetry → offline avec inMs ; retour à upload au progrès suivant ; aucune coche en plus", async () => {
    const t = setup();
    void t.s.start(ITEMS, OPTS);
    const o = await toUpload(t);
    o.onBytes!(50, 300);
    o.onRetry!({ attempt: 1, inMs: 8000, offline: false });
    expect(t.s.phase).toBe("offline");
    expect(t.s.netRetry).toMatchObject({ inMs: 8000, offline: false });
    expect(t.s.steps).toEqual([]);
    o.onBytes!(120, 300);
    expect(t.s.phase).toBe("upload");
    expect(t.s.netRetry).toBeUndefined();
  });

  it("10 s sans octet pendant upload → offline", async () => {
    const t = setup();
    void t.s.start(ITEMS, OPTS);
    const o = await toUpload(t);
    o.onBytes!(10, 300);
    await vi.advanceTimersByTimeAsync(STALL_MS - 1000);
    expect(t.s.phase).toBe("upload");
    await vi.advanceTimersByTimeAsync(1500);
    expect(t.s.phase).toBe("offline");
    o.onBytes!(20, 300);
    expect(t.s.phase).toBe("upload");
  });

  it("Error(\"reseau\") (budget épuisé) → erreur reseau ; verrou relâché", async () => {
    const t = setup();
    void t.s.start(ITEMS, OPTS);
    await toUpload(t);
    t.last().reject(new Error("reseau"));
    await flush();
    expect(t.s.phase).toBe("error");
    expect(t.s.error).toBe("reseau");
    expect(t.wake.release).toHaveBeenCalled();
    expect(t.unload).toHaveBeenLastCalledWith(false);
  });
});

describe("createSender : pause (UI §9.4.4)", () => {
  it("pause → paused à la fin du segment ; reprise manuelle", async () => {
    const t = setup();
    void t.s.start(ITEMS, OPTS);
    const o = await toUpload(t);
    expect(t.s.canPause).toBe(true);
    t.s.pause();
    expect(t.s.phase).toBe("upload");
    expect(t.s.pausing).toBe(true);
    let resumed = false;
    void Promise.resolve(o.pause!()).then(() => (resumed = true));
    expect(t.s.phase).toBe("paused");
    expect(t.wake.release).toHaveBeenCalledTimes(1);
    await flush();
    expect(resumed).toBe(false);
    t.s.resume();
    await flush();
    expect(resumed).toBe(true);
    expect(t.s.phase).toBe("upload");
    expect(t.wake.acquire).toHaveBeenCalledTimes(2);
    expect(await o.pause!()).toBeUndefined(); // sans pause demandée : rien à attendre
  });

  it("reprise automatique à min(10 min, échéance) : segment acquitté il y a 5 min → reprise après 8 min de pause", async () => {
    const t = setup();
    void t.s.start(ITEMS, OPTS);
    const o = await toUpload(t);
    o.onBytes!(100, 300);
    o.onProgress!(1, 3);
    for (let m = 1; m <= 5; m++) {
      await vi.advanceTimersByTimeAsync(60_000); // octets qui avancent, aucun segment acquitté
      o.onBytes!(100 + m, 300);
    }
    t.s.pause();
    let resumed = false;
    void Promise.resolve(o.pause!()).then(() => (resumed = true));
    expect(t.s.phase).toBe("paused");
    expect(t.s.pauseLeftMs).toBe(SERVER_STALL_MS - 5 * 60_000);
    await vi.advanceTimersByTimeAsync(8 * 60_000 - 1000);
    expect(resumed).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(resumed).toBe(true);
    expect(t.s.phase).toBe("upload");
  });

  it("reprise automatique au plus tard après PAUSE_MAX_MS", async () => {
    const t = setup();
    void t.s.start(ITEMS, OPTS);
    const o = await toUpload(t);
    o.onProgress!(1, 3);
    t.s.pause();
    void o.pause!();
    expect(t.s.pauseLeftMs).toBe(PAUSE_MAX_MS);
    await vi.advanceTimersByTimeAsync(PAUSE_MAX_MS + 500);
    expect(t.s.phase).toBe("upload");
  });

  it("pause refusée à moins de 15 min de la fin de la fenêtre de 6 h", async () => {
    const t = setup();
    void t.s.start(ITEMS, OPTS);
    const o = await toUpload(t);
    // L'envoi avance (octets et acquittements) jusqu'à 5 h 46 après la création.
    for (let m = 1; m <= 346; m++) {
      await vi.advanceTimersByTimeAsync(60_000);
      o.onBytes!(m, 300);
      o.onProgress!(1, 3);
    }
    expect(t.s.canPause).toBe(false);
    t.s.pause();
    expect(t.s.pausing).toBe(false);
  });
});

describe("createSender : annulation (UI §9.4.5)", () => {
  it("cancel → abort, cancelled, createdOnServer exact, préfetcher arrêté, aucune coche, verrou relâché", async () => {
    const stop = vi.fn();
    const t = setup({ prefetcher: { take: () => undefined, stop } });
    void t.s.start(ITEMS, OPTS);
    expect(t.s.createdOnServer).toBe(false);
    t.s.cancel();
    expect(t.last().opts.signal!.aborted).toBe(true);
    expect(t.s.phase).toBe("cancelled");
    expect(t.s.createdOnServer).toBe(false);
    expect(stop).toHaveBeenCalled();
    t.last().reject(new DOMException("Aborted", "AbortError"));
    await flush();
    expect(t.s.phase).toBe("cancelled");

    const u = setup();
    void u.s.start(ITEMS, OPTS);
    const o = await toUpload(u);
    o.onBytes!(300, 300); // chiffré
    u.s.cancel(); // ignoré en finalize
    expect(u.s.phase).toBe("finalize");
    expect(o.signal!.aborted).toBe(false);

    const v = setup();
    void v.s.start(ITEMS, OPTS);
    const p = await toUpload(v);
    p.onBytes!(100, 300);
    v.s.cancel();
    expect(v.s.createdOnServer).toBe(true);
    expect(v.s.steps).toEqual([]);
    expect(v.wake.release).toHaveBeenCalled();
    expect(v.unload).toHaveBeenLastCalledWith(false);
  });

  it("cancel pendant la pause : la pause est relâchée, phase cancelled", async () => {
    const t = setup();
    void t.s.start(ITEMS, OPTS);
    const o = await toUpload(t);
    t.s.pause();
    void o.pause!();
    t.s.cancel();
    expect(t.s.phase).toBe("cancelled");
    expect(o.signal!.aborted).toBe(true);
  });
});

describe("createSender : erreurs (UI §9.4.6)", () => {
  const cases: [unknown, string][] = [
    [new Error("full"), "plein"],
    [new Error("frozen"), "gele"],
    [new NotFoundError(), "interrompu"],
    [new Error("boom"), "inattendu"],
  ];
  for (const [e, want] of cases)
    it(`${(e as Error).name}(${(e as Error).message}) → ${want}`, async () => {
      const t = setup();
      void t.s.start(ITEMS, OPTS);
      await toUpload(t);
      t.last().reject(e);
      await flush();
      expect(t.s.error).toBe(want);
    });

  it("NotReadableError → fichier_modifie avec l'élément fautif", async () => {
    const bad = new Blob(["x"]);
    vi.spyOn(bad, "slice").mockImplementation(() => ({ arrayBuffer: () => Promise.reject(new DOMException("x", "NotReadableError")) }) as unknown as Blob);
    const items: Item[] = [ITEMS[0]!, { kind: "file", name: "a.jpg", mime: "image/jpeg", data: new Blob(["ok"]) }, { kind: "file", name: "b.jpg", mime: "image/jpeg", data: bad }];
    const t = setup();
    void t.s.start(items, OPTS);
    await toUpload(t);
    t.last().reject(new DOMException("gone", "NotReadableError"));
    await vi.advanceTimersByTimeAsync(10);
    expect(t.s.error).toBe("fichier_modifie");
    expect(t.s.failedItem).toBe(2);
  });

  it("LimitError(120) → limite, retryAfterS", async () => {
    const t = setup();
    void t.s.start(ITEMS, OPTS);
    t.last().reject(new LimitError(120));
    await flush();
    expect(t.s.error).toBe("limite");
    expect(t.s.retryAfterS).toBe(120);
  });

  it("bad_request, repli désactivé : 2 essais (le second sans pré-calcul) puis captcha", async () => {
    const take = vi.fn(() => ({ cap: { challenge: 1, fallbackOrigin: null, expiresAt: 0 }, proof: Promise.resolve({ kind: "pow", payload: "pre" } as CaptchaProof) }));
    const t = setup({ prefetcher: { take, stop: vi.fn() } });
    void t.s.start(ITEMS, OPTS);
    expect(t.calls[0]!.opts.prepared).toBeDefined();
    t.calls[0]!.reject(new Error("bad_request"));
    await flush();
    expect(t.createShare).toHaveBeenCalledTimes(2);
    expect(t.calls[1]!.opts.prepared).toBeUndefined();
    await t.calls[1]!.opts.solveCaptcha({}, { fallbackOrigin: null, mode: "pow" });
    expect(t.solveCaptcha).toHaveBeenLastCalledWith({}, { fallbackOrigin: null, mode: "pow" });
    t.calls[1]!.reject(new Error("bad_request"));
    await flush();
    expect(t.createShare).toHaveBeenCalledTimes(2);
    expect(t.s.error).toBe("captcha");
    expect(take).toHaveBeenCalledTimes(1);
  });

  it("audit M1 : bad_request d'un élément (PUT refusé) : pas d'essai anti-robot, erreur dite, ligne désignée", async () => {
    const t = setup();
    void t.s.start(ITEMS, OPTS);
    t.calls[0]!.reject(markElementFailure(0, new Error("bad_request")));
    await flush();
    expect(t.createShare).toHaveBeenCalledTimes(1);
    expect(t.s.error).toBe("element");
    expect(t.s.failedItem).toBe(0);
    // Réessayer : un nouvel appel complet (le brouillon relance l'élément, transfer/draft.ts).
    void t.s.retry();
    expect(t.createShare).toHaveBeenCalledTimes(2);
  });

  it("audit M1 : erreur réseau d'un élément : « reseau », ligne désignée ; fichier illisible : « fichier_modifie »", async () => {
    const t = setup();
    void t.s.start(ITEMS, OPTS);
    t.calls[0]!.reject(markElementFailure(0, new Error("reseau")));
    await flush();
    expect(t.s.error).toBe("reseau");
    expect(t.s.failedItem).toBe(0);
    void t.s.retry();
    t.calls[1]!.reject(markElementFailure(0, new DOMException("x", "NotReadableError")));
    await flush();
    expect(t.s.error).toBe("fichier_modifie");
  });

  it("bad_request, repli actif : 3 essais, le dernier en mode fallback", async () => {
    const t = setup();
    void t.s.start(ITEMS, OPTS);
    await t.calls[0]!.opts.solveCaptcha({}, { fallbackOrigin: "https://verif.test", mode: "pow" });
    t.calls[0]!.reject(new Error("bad_request"));
    await flush();
    await t.calls[1]!.opts.solveCaptcha({}, { fallbackOrigin: "https://verif.test", mode: "pow" });
    t.calls[1]!.reject(new Error("bad_request"));
    await flush();
    expect(t.createShare).toHaveBeenCalledTimes(3);
    const p = t.calls[2]!.opts.solveCaptcha({}, { fallbackOrigin: "https://verif.test", mode: "pow" });
    expect(t.s.phase).toBe("fallback");
    await p;
    expect(t.solveCaptcha).toHaveBeenLastCalledWith({}, { fallbackOrigin: "https://verif.test", mode: "fallback" });
    t.calls[2]!.reject(new Error("bad_request"));
    await flush();
    expect(t.createShare).toHaveBeenCalledTimes(3);
    expect(t.s.error).toBe("captcha");
  });

  it("échec du calcul sur l'appareil (Worker absent) sans repli : captcha local après 2 essais", async () => {
    const t = setup({ solveCaptcha: vi.fn(async () => Promise.reject(new Error("pow_indisponible"))) });
    void t.s.start(ITEMS, OPTS);
    const p0 = t.calls[0]!.opts.solveCaptcha({}, { fallbackOrigin: null, mode: "pow" });
    await expect(p0).rejects.toThrow();
    t.calls[0]!.reject(new Error("pow_indisponible"));
    await flush();
    const p1 = t.calls[1]!.opts.solveCaptcha({}, { fallbackOrigin: null, mode: "pow" });
    await expect(p1).rejects.toThrow();
    t.calls[1]!.reject(new Error("pow_indisponible"));
    await flush();
    expect(t.s.error).toBe("captcha");
    expect(t.s.captchaLocal).toBe(true);
  });

  it("bad_request sur une preuve pré-calculée : nouvel essai en preuve de travail, pas le repli", async () => {
    const take = vi.fn(() => ({ cap: { challenge: 1, fallbackOrigin: "https://verif.test", expiresAt: 0 }, proof: Promise.resolve({ kind: "pow", payload: "pre" } as CaptchaProof) }));
    const t = setup({ prefetcher: { take, stop: vi.fn() } });
    void t.s.start(ITEMS, OPTS);
    t.calls[0]!.reject(new Error("bad_request"));
    await flush();
    await t.calls[1]!.opts.solveCaptcha({}, { fallbackOrigin: "https://verif.test", mode: "pow" });
    expect(t.solveCaptcha).toHaveBeenLastCalledWith({}, { fallbackOrigin: "https://verif.test", mode: "pow" });
  });

  it("retry() rappelle createShare en entier (nouveau take())", async () => {
    const take = vi.fn(() => undefined);
    const t = setup({ prefetcher: { take, stop: vi.fn() } });
    void t.s.start(ITEMS, OPTS);
    t.last().reject(new Error("full"));
    await flush();
    expect(t.s.error).toBe("plein");
    void t.s.retry();
    expect(t.s.phase).toBe("keys");
    expect(t.createShare).toHaveBeenCalledTimes(2);
    expect(take).toHaveBeenCalledTimes(2);
    expect(t.s.error).toBeUndefined();
    expect(t.s.createdOnServer).toBe(false);
  });
});

describe("createSender : verrou d'écran, sortie de page, trop lent", () => {
  it("verrou demandé en keys, relâché à la fin ; beforeunload de keys à la résolution", async () => {
    const t = setup();
    void t.s.start(ITEMS, OPTS);
    expect(t.wake.acquire).toHaveBeenCalledTimes(1);
    expect(t.unload).toHaveBeenLastCalledWith(true);
    const o = await toUpload(t);
    o.onBytes!(300, 300);
    o.onProgress!(3, 3);
    t.last().resolve(RES);
    await flush();
    expect(t.wake.release).toHaveBeenCalled();
    expect(t.unload).toHaveBeenLastCalledWith(false);
  });

  it("tooSlow quand le temps restant estimé dépasse la fenêtre restante de 6 h", async () => {
    const t = setup();
    void t.s.start(ITEMS, OPTS);
    const total = 2_000_000_000;
    const o = await toUpload(t, 500, total);
    for (let k = 1; k <= 6; k++) {
      await vi.advanceTimersByTimeAsync(1000);
      o.onBytes!(k * 10_000, total); // 10 Ko/s : 55 h restantes
    }
    expect(t.s.tooSlow).toBe(true);
    const u = setup();
    void u.s.start(ITEMS, OPTS);
    const p = await toUpload(u, 3, 300_000);
    for (let k = 1; k <= 6; k++) {
      await vi.advanceTimersByTimeAsync(1000);
      p.onBytes!(k * 10_000, 300_000);
    }
    expect(u.s.tooSlow).toBe(false);
    expect(UPLOAD_WINDOW_MS).toBe(6 * 3600_000);
  });
});
