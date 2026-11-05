import { describe, expect, it } from "vitest";
import { formatDuration } from "../i18n/format";
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

  it("display suit formatDuration dans la langue demandée", () => {
    const c = clock();
    const cd = createCountdown(4 * 3600 + 15 * 60, c.now);
    expect(cd.display("fr")).toBe(formatDuration(15300, "fr"));
    expect(cd.display("en")).toBe(formatDuration(15300, "en"));
    c.advance(15300 - 245);
    expect(cd.display("fr")).toBe("4\u202fmin\u202f05\u202fs"); // sous 5 min : à la seconde
    c.advance(200);
    expect(cd.display("fr")).toBe(formatDuration(45, "fr"));
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
});
