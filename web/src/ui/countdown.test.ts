import { describe, expect, it } from "vitest";
import { createCountdown } from "./countdown";

function clock(start = 1000) {
  let ms = start;
  return { now: () => ms, advance: (s: number) => void (ms += s * 1000), set: (v: number) => void (ms = v) };
}

describe("createCountdown", () => {
  it("décompte à partir de la création, arrondi vers le haut", () => {
    const c = clock();
    const cd = createCountdown(100, c.now);
    expect(cd.remaining()).toBe(100);
    c.advance(0.2);
    expect(cd.remaining()).toBe(100); // jamais « 99 » avant qu'une seconde entière soit passée
    c.advance(10);
    expect(cd.remaining()).toBe(90);
  });

  it("jamais négatif, même si l'horloge saute en avant ou en arrière", () => {
    const c = clock();
    const cd = createCountdown(5, c.now);
    c.advance(60);
    expect(cd.remaining()).toBe(0);
    c.set(-5000);
    expect(cd.remaining()).toBe(5); // recul de l'horloge : borné à la durée initiale
    expect(createCountdown(-3, c.now).remaining()).toBe(0);
    expect(createCountdown(Number.NaN, c.now).remaining()).toBe(0);
  });

  it("display : décompte « 4 h 15 min » au-dessus d'une heure, « 12 min 05 s » en dessous (retours UI4)", () => {
    const c = clock();
    const cd = createCountdown(4 * 3600 + 15 * 60, c.now);
    expect(cd.display("fr")).toBe("4\u202fh\u202f15\u202fmin");
    expect(cd.display("en")).toBe("4\u00a0h\u00a015\u00a0min");
    c.advance(15300 - 725);
    expect(cd.display("fr")).toBe("12\u202fmin\u202f05\u202fs"); // sous 1 h : à la seconde
    c.advance(680);
    expect(cd.display("fr")).toBe("45\u202fs");
  });

  it("announceAt : une fois par seuil 3600, 900, 300, 60, 0, dans l'ordre", () => {
    const c = clock();
    const cd = createCountdown(7200, c.now);
    expect(cd.announceAt()).toBeNull();
    c.advance(3600);
    expect(cd.announceAt()).toBe(3600);
    expect(cd.announceAt()).toBeNull();
    c.advance(3600 - 900);
    expect(cd.announceAt()).toBe(900);
    c.advance(600);
    expect(cd.announceAt()).toBe(300);
    c.advance(240);
    expect(cd.announceAt()).toBe(60);
    c.advance(59);
    expect(cd.announceAt()).toBeNull();
    c.advance(1);
    expect(cd.announceAt()).toBe(0);
    expect(cd.announceAt()).toBeNull();
  });

  it("announceAt : pas d'annonce des seuils déjà dépassés au départ, ni de rafale après une longue veille", () => {
    const c = clock();
    const cd = createCountdown(600, c.now); // 3600 et 900 déjà passés
    expect(cd.announceAt()).toBeNull();
    c.advance(400); // 200 s restantes : seuil 300 franchi
    expect(cd.announceAt()).toBe(300);
    c.advance(1000); // onglet endormi : seulement l'expiration
    expect(cd.announceAt()).toBe(0);
    expect(cd.announceAt()).toBeNull();
  });

  it("veille : horloge monotone figée, horloge murale +10 min -> le temps écoulé compte (I2)", () => {
    let mono = 0;
    let wall = 1_700_000_000_000;
    const cd = createCountdown(3600, () => mono, () => wall);
    expect(cd.remaining()).toBe(3600);
    wall += 600_000; // l'appareil a dormi 10 min : seule l'horloge murale a avancé
    expect(cd.remaining()).toBe(3000);
    mono += 30_000; // éveillé 30 s de plus : le plus grand écart gagne, sans double compte
    wall += 30_000;
    expect(cd.remaining()).toBe(2970);
  });

  it("horloge murale en arrière : ignorée ; monotone seule fait foi", () => {
    let mono = 0;
    let wall = 1_000_000;
    const cd = createCountdown(100, () => mono, () => wall);
    wall -= 5_000_000;
    mono += 10_000;
    expect(cd.remaining()).toBe(90);
  });
});
