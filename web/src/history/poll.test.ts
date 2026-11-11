// Relectures de manage/status pour l'historique (spec §33, §33.1) : seulement à la demande
// (affichage, « Actualiser »), jamais si l'écran est caché, au plus une fois toutes les 5 min
// par partage, après une gigue de 0,5 à 4 s ; intervalle d'ouverture observé ; NotFoundError →
// détruit (ou expiré après l'échéance) ; hors ligne → rien d'inventé.
import { describe, expect, it, vi } from "vitest";
import { LimitError, NotFoundError } from "../index";
import { JITTER_MAX_MS, JITTER_MIN_MS, REFRESH_MIN_MS, pollHistory, type PollDeps } from "./poll";
import { memoryBackend, openHistory, type History } from "./store";

const MANAGE = "https://shhdrop.example/#m" + "A".repeat(43);
const H21 = new Date(2026, 10, 5, 21, 0).getTime();
const MIN = 60_000;

async function setup(over: Partial<PollDeps> = {}) {
  const clock = { t: H21 };
  const h = (await openHistory({ backend: memoryBackend(), now: () => clock.t }))!;
  const e = await h.add({ manage: MANAGE, createdAt: H21, sizeBytes: 10, itemsCount: 1, expiresAt: H21 + 12 * 3600_000, maxOpens: 1 });
  const sleeps: number[] = [];
  const status = vi.fn(async (_m: string) => ({ opensUsed: 0, maxOpens: 1, expiresInS: 3600, state: "ready" }));
  const deps: PollDeps = {
    manageStatus: status,
    now: () => clock.t,
    visible: () => true,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.5,
    ...over,
  };
  return { clock, h, e, status, sleeps, p: pollHistory(h, deps), deps };
}

describe("pollHistory", () => {
  it("rien au chargement : aucune relecture tant qu'on ne demande rien", async () => {
    const { status } = await setup();
    expect(status).not.toHaveBeenCalled();
  });

  it("compteur 0 → 1 entre deux relectures à 21:00 et 21:06 → ouvert entre 21:00 et 21:06", async () => {
    const { clock, p, e, status, h } = await setup();
    clock.t = H21 + 6 * MIN;
    status.mockResolvedValueOnce({ opensUsed: 1, maxOpens: 1, expiresInS: 3000, state: "draining" });
    const r = await p.refreshOne(e.id);
    expect(r.kind).toBe("updated");
    const got = (await h.get(e.id))!;
    expect(got.opens).toEqual([{ count: 1, between: [H21, H21 + 6 * MIN] }]);
    expect(got).toMatchObject({ opensUsed: 1, state: "draining", lastSeenAt: H21 + 6 * MIN, expiresAt: H21 + 6 * MIN + 3000_000 });
    expect(status).toHaveBeenCalledWith(MANAGE);
  });

  it("au plus une fois toutes les 5 min par partage (création comprise), gigue de 0,5 à 4 s avant chaque requête", async () => {
    const { clock, p, e, status, sleeps } = await setup({ random: () => 0 });
    clock.t = H21 + 4 * MIN;
    expect(await p.refreshOne(e.id)).toMatchObject({ kind: "skipped", reason: "fresh", nextAt: H21 + REFRESH_MIN_MS });
    expect(status).not.toHaveBeenCalled();
    clock.t = H21 + REFRESH_MIN_MS;
    expect((await p.refreshOne(e.id)).kind).toBe("updated");
    expect(sleeps).toEqual([JITTER_MIN_MS]);
    clock.t += REFRESH_MIN_MS - 1;
    expect((await p.refreshOne(e.id)).kind).toBe("skipped");
    expect(status).toHaveBeenCalledTimes(1);
    expect(JITTER_MIN_MS).toBe(500);
    expect(JITTER_MAX_MS).toBe(4000);
  });

  it("gigue tirée entre 0,5 et 4 s", async () => {
    const { clock, p, e, sleeps } = await setup({ random: () => 0.999999 });
    clock.t += REFRESH_MIN_MS;
    await p.refreshOne(e.id);
    expect(sleeps[0]).toBeGreaterThanOrEqual(3999);
    expect(sleeps[0]).toBeLessThanOrEqual(4000);
  });

  it("aucune relecture si l'écran n'est pas visible (avant ou après la gigue)", async () => {
    let vis = false;
    const { clock, p, e, status } = await setup({ visible: () => vis });
    clock.t += REFRESH_MIN_MS;
    expect(await p.refreshOne(e.id)).toMatchObject({ kind: "skipped", reason: "hidden" });
    vis = true;
    const s2 = await setup({
      visible: () => vis,
      sleep: async () => {
        vis = false;
      },
    });
    s2.clock.t += REFRESH_MIN_MS;
    expect(await s2.p.refreshOne(s2.e.id)).toMatchObject({ kind: "skipped", reason: "hidden" });
    expect(status).not.toHaveBeenCalled();
    expect(s2.status).not.toHaveBeenCalled();
  });

  it("deux demandes en même temps : une seule requête", async () => {
    const { clock, p, e, status } = await setup();
    clock.t += REFRESH_MIN_MS;
    const [a, b] = await Promise.all([p.refreshOne(e.id), p.refreshOne(e.id)]);
    expect(a).toEqual(b);
    expect(status).toHaveBeenCalledTimes(1);
  });

  it("NotFoundError → détruit (constaté), avant l'échéance ; → expiré après", async () => {
    const s = await setup({ manageStatus: async () => Promise.reject(new NotFoundError()) });
    s.clock.t += REFRESH_MIN_MS;
    await s.p.refreshOne(s.e.id);
    expect(await s.h.get(s.e.id)).toMatchObject({ state: "gone", endedAt: s.clock.t, destroyedHere: false });
    // Échéance atteinte pendant la gigue : le serveur ne connaît plus le partage → expiré.
    const box = { clock: { t: 0 } };
    const x = await setup({ manageStatus: async () => Promise.reject(new NotFoundError()), sleep: async () => void (box.clock.t += 4000) });
    box.clock = x.clock;
    await x.h.update(x.e.id, { expiresAt: H21 + 6 * MIN + 1000 });
    x.clock.t = H21 + 6 * MIN;
    await x.p.refreshOne(x.e.id);
    expect(await x.h.get(x.e.id)).toMatchObject({ state: "expired", endedAt: H21 + 6 * MIN + 1000 });
  });

  it("échéance passée ou partage terminé : aucune requête", async () => {
    const { clock, p, e, status, h } = await setup();
    clock.t = e.expiresAt + REFRESH_MIN_MS;
    expect(await p.refreshOne(e.id)).toMatchObject({ kind: "skipped", reason: "ended" });
    await h.update(e.id, { state: "gone", endedAt: clock.t });
    expect(await p.refreshOne(e.id)).toMatchObject({ kind: "skipped", reason: "ended" });
    expect(status).not.toHaveBeenCalled();
  });

  it("hors ligne : erreur « reseau », entrée inchangée (aucun chiffre inventé), nouvel essai permis", async () => {
    const status = vi.fn(async () => Promise.reject(new Error("reseau")));
    const { clock, p, e, h } = await setup({ manageStatus: status });
    clock.t += REFRESH_MIN_MS;
    expect(await p.refreshOne(e.id)).toEqual({ kind: "error", error: "reseau" });
    expect(await h.get(e.id)).toEqual(e);
    expect((await p.refreshOne(e.id)).kind).toBe("error");
    expect(status).toHaveBeenCalledTimes(2);
  });

  it("trop de demandes (429) : pause du délai donné, comptée comme une relecture", async () => {
    const status = vi.fn(async () => Promise.reject(new LimitError(600)));
    const { clock, p, e } = await setup({ manageStatus: status });
    clock.t += REFRESH_MIN_MS;
    expect(await p.refreshOne(e.id)).toEqual({ kind: "error", error: "limite", retryAfterS: 600 });
    clock.t += REFRESH_MIN_MS;
    expect((await p.refreshOne(e.id)).kind).toBe("skipped");
    expect(status).toHaveBeenCalledTimes(1);
  });

  it("start : relit les partages actifs périmés, l'un après l'autre", async () => {
    const { clock, p, status, h } = await setup();
    await h.add({ manage: "https://shhdrop.example/#m" + "B".repeat(43), createdAt: H21, sizeBytes: 1, itemsCount: 1, expiresAt: H21 + 3600_000, maxOpens: 1 });
    clock.t += REFRESH_MIN_MS;
    await p.start();
    expect(status).toHaveBeenCalledTimes(2);
  });

  it("stop pendant la gigue (page quittée) : aucune requête ; « Actualiser » ensuite reste possible", async () => {
    let p!: ReturnType<typeof pollHistory>;
    const s = await setup({ sleep: async () => p.stop() });
    p = s.p;
    await s.h.add({ manage: "https://shhdrop.example/#m" + "B".repeat(43), createdAt: H21, sizeBytes: 1, itemsCount: 1, expiresAt: H21 + 3600_000, maxOpens: 1 });
    s.clock.t += REFRESH_MIN_MS;
    await p.start();
    expect(s.status).not.toHaveBeenCalled();
    const q = pollHistory(s.h, s.deps);
    expect((await q.refreshOne(s.e.id)).kind).toBe("updated");
  });

  it("destroy : manageDestroy puis « détruit ici » ; NotFoundError compte comme détruit ; réseau → erreur, rien changé", async () => {
    const destroy = vi.fn(async (_m: string) => undefined);
    const { p, e, h, clock } = await setup({ manageDestroy: destroy });
    expect(await p.destroy(e.id)).toMatchObject({ kind: "destroyed" });
    expect(destroy).toHaveBeenCalledWith(MANAGE);
    expect(await h.get(e.id)).toMatchObject({ state: "gone", destroyedHere: true, endedAt: clock.t });
    const x = await setup({ manageDestroy: async () => Promise.reject(new NotFoundError()) });
    expect((await x.p.destroy(x.e.id)).kind).toBe("destroyed");
    const y = await setup({ manageDestroy: async () => Promise.reject(new Error("reseau")) });
    expect(await y.p.destroy(y.e.id)).toEqual({ kind: "error", error: "reseau" });
    expect((await y.h.get(y.e.id))!.state).toBe("ready");
  });
});

void (undefined as unknown as History);
