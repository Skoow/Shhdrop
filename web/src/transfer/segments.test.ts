// Lecture des segments d'une ouverture : lecture d'avance bornée (A2), segments gardés (A3, A4).
import { describe, expect, it } from "vitest";
import { READ_AHEAD, segmentSource } from "./segments";

type Seg = Uint8Array<ArrayBuffer>;

/** Serveur simulé : chaque lecture attend que le test la libère ; en vol compté. */
function fake() {
  const calls: number[] = [];
  const pending = new Map<number, (s: Seg) => void>();
  let inFlight = 0;
  let maxInFlight = 0;
  const made: Seg[] = [];
  const fetchOne = (n: number) =>
    new Promise<Seg>((res) => {
      calls.push(n);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      pending.set(n, (s) => {
        inFlight--;
        res(s);
      });
    });
  const release = (n: number) => {
    const s = new Uint8Array(4).fill(n + 1);
    made.push(s);
    pending.get(n)!(s);
    pending.delete(n);
  };
  const releaseAll = () => [...pending.keys()].forEach(release);
  return { calls, fetchOne, release, releaseAll, made, get maxInFlight() { return maxInFlight; }, get inFlight() { return inFlight; } };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("segmentSource", () => {
  it("A4 : segments 0 et du manifeste lus ensemble ; A3 : relus par le lecteur sans nouvelle requête", async () => {
    const s = fake();
    const src = segmentSource(s.fetchOne);
    src.preload([0, 2]);
    expect(s.calls).toEqual([0, 2]); // les deux en vol en même temps
    expect(s.maxInFlight).toBe(2);
    s.releaseAll();
    // Ouverture : le moteur demande 0, puis 2, puis 0 encore (note) : aucune requête de plus.
    await src.get(0);
    await src.get(2);
    await src.get(0);
    src.endOpen();
    // Après l'ouverture : chaque segment gardé est rendu une fois encore, puis relu au serveur.
    const a = await src.within(0, 0, () => src.get(0));
    expect(a[0]).toBe(1);
    expect(s.calls).toEqual([0, 2]);
    const again = src.within(0, 0, () => src.get(0));
    await tick();
    expect(s.calls).toEqual([0, 2, 0]);
    s.releaseAll();
    await again;
  });

  it("releaseKept : segments gardés lâchés après un enregistrement, effacés s'ils n'ont pas été rendus", async () => {
    const s = fake();
    const src = segmentSource(s.fetchOne);
    src.preload([0, 1]);
    s.releaseAll();
    await src.get(0);
    src.endOpen();
    src.releaseKept();
    await tick();
    const seg1 = s.made[1]!;
    expect([...seg1]).toEqual([0, 0, 0, 0]); // jamais rendu : effacé
    expect(s.made[0]![0]).toBe(1); // rendu au moteur : laissé (le moteur a sa copie)
    const p = src.within(0, 1, () => src.get(1));
    await tick();
    expect(s.calls).toEqual([0, 1, 1]);
    s.releaseAll();
    await p;
  });

  it("A2 : lecture d'avance de READ_AHEAD segments, bornée au dernier segment de l'élément", async () => {
    expect(READ_AHEAD).toBe(2);
    const s = fake();
    const src = segmentSource(s.fetchOne);
    src.endOpen();
    const got: number[] = [];
    const read = src.within(3, 7, async () => {
      for (let n = 3; n <= 7; n++) {
        const p = src.get(n);
        await tick();
        // Au plus le segment demandé et READ_AHEAD d'avance : mémoire bornée.
        expect(s.inFlight).toBeLessThanOrEqual(1 + READ_AHEAD);
        s.releaseAll();
        got.push((await p)[0]! - 1);
      }
    });
    await read;
    expect(got).toEqual([3, 4, 5, 6, 7]);
    // Chaque segment lu une seule fois ; jamais au-delà de 7 (fin de l'élément).
    expect([...s.calls].sort((x, y) => x - y)).toEqual([3, 4, 5, 6, 7]);
    expect(s.calls.slice(0, 3)).toEqual([3, 4, 5]); // 4 et 5 demandés avec 3
    expect(s.maxInFlight).toBe(3);
  });

  it("hors d'un élément (ouverture) : aucune lecture d'avance", async () => {
    const s = fake();
    const src = segmentSource(s.fetchOne);
    const p = src.get(1);
    await tick();
    expect(s.calls).toEqual([1]);
    s.releaseAll();
    await p;
  });

  it("lecture d'avance non demandée (fin d'élément en erreur) : lâchée et effacée ; son erreur ne remonte pas", async () => {
    let fail = false;
    const made: Seg[] = [];
    const calls: number[] = [];
    const src = segmentSource(async (n) => {
      calls.push(n);
      if (fail && n === 2) throw new TypeError("reseau");
      const s = new Uint8Array(4).fill(9);
      made.push(s);
      return s;
    });
    src.endOpen();
    fail = true;
    const boom = new Error("sink");
    await expect(
      src.within(0, 5, async () => {
        await src.get(0); // lance 1 et 2 ; 2 échouera, jamais demandé
        throw boom;
      }),
    ).rejects.toBe(boom);
    await tick();
    expect(calls).toEqual([0, 1, 2]);
    expect([...made[1]!]).toEqual([0, 0, 0, 0]); // segment 1 lu d'avance puis lâché : effacé
    // Demandée, une lecture d'avance en échec rend son erreur.
    await expect(
      src.within(1, 2, async () => {
        await src.get(1);
        return src.get(2);
      }),
    ).rejects.toThrow("reseau");
  });

  it("lectures d'éléments sérialisées : la fenêtre d'avance de l'une ne déborde pas sur l'autre", async () => {
    const s = fake();
    const src = segmentSource(s.fetchOne);
    src.endOpen();
    const order: string[] = [];
    const one = src.within(0, 0, async () => {
      order.push("a<");
      const p = src.get(0);
      await tick();
      s.releaseAll();
      await p;
      order.push("a>");
    });
    const two = src.within(5, 9, async () => {
      order.push("b<");
      const p = src.get(5);
      await tick();
      s.releaseAll();
      await p;
      order.push("b>");
    });
    await Promise.all([one, two]);
    expect(order).toEqual(["a<", "a>", "b<", "b>"]);
    expect(s.calls.slice(0, 1)).toEqual([0]); // rien lu d'avance pour le premier (un seul segment)
  });

  it("clear : tout lâché, segments non rendus effacés", async () => {
    const s = fake();
    const src = segmentSource(s.fetchOne);
    src.preload([0, 3]);
    s.releaseAll();
    await tick();
    src.clear();
    await tick();
    for (const m of s.made) expect([...m]).toEqual([0, 0, 0, 0]);
  });
});
