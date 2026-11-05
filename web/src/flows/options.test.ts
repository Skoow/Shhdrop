import { describe, expect, it, vi } from "vitest";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { createOptions, estimateUpload, viewOnlyBlockers, type OptionsDeps } from "./options.svelte";
import { CONTENT_MAX, MAX_OPENS, PW_TRIES, generatePassword, PASSWORD_ALPHABET } from "../index";

const check: OptionsDeps["check"] = (pw) =>
  [...pw].length < 12 ? { ok: false, reason: "trop_court" } : pw === "motdepasse12" ? { ok: false, reason: "trop_courant" } : { ok: true };

function make(over: Partial<OptionsDeps> = {}) {
  let n = 0;
  return createOptions({ generate: () => `Gen${++n}abcd`.slice(0, 8), check, ...over });
}

describe("createOptions (UI §9.3)", () => {
  it("défauts : 12 h, 1 ouverture, mot de passe généré, voir et enregistrer", () => {
    const o = make();
    expect(o.ttlHours).toBe(12);
    expect(o.maxOpens).toBe(1);
    expect(o.mode).toBe("generated");
    expect(o.password).toBe("Gen1abcd");
    expect(o.rights).toBe("enregistrer");
    expect(o.check()).toEqual({ ok: true });
    expect(o.blockReason()).toBeNull();
  });

  it("regenerate : un nouveau à chaque appel, sans limite", () => {
    const o = make();
    for (let i = 2; i < 30; i++) {
      o.regenerate();
      expect(o.password).toBe(`Gen${i}abcd`.slice(0, 8));
    }
  });

  it("mot de passe personnel : trop court, trop courant, accepté ; retour au généré", () => {
    const o = make();
    o.setCustom("court");
    expect(o.mode).toBe("custom");
    expect(o.check()).toEqual({ ok: false, reason: "trop_court" });
    expect(o.blockReason()).toBe("mdp_trop_court");
    o.setCustom("motdepasse12");
    expect(o.blockReason()).toBe("mdp_trop_courant");
    o.setCustom("une phrase à moi");
    expect(o.blockReason()).toBeNull();
    expect(o.password).toBe("une phrase à moi");
    o.useGenerated();
    expect(o.mode).toBe("generated");
    expect(o.password).toBe("Gen1abcd"); // le généré est gardé pendant la saisie
  });

  it("vérificateur pas encore chargé → bloque avec sa raison, jamais accepté par défaut", () => {
    const o = make({ check: () => null });
    o.setCustom("une phrase assez longue");
    expect(o.check()).toBeNull();
    expect(o.blockReason()).toBe("mdp_verif");
  });

  it("ouvertures bornées 1 à 10, durée parmi 1, 6, 12, 24", () => {
    const o = make();
    o.maxOpens = 0;
    expect(o.maxOpens).toBe(1);
    o.maxOpens = 11;
    expect(o.maxOpens).toBe(MAX_OPENS);
    o.maxOpens = 3.7;
    expect(o.maxOpens).toBe(3);
    o.ttlHours = 5 as never;
    expect(o.ttlHours).toBe(12);
    o.ttlHours = 24;
    expect(o.ttlHours).toBe(24);
  });

  it("droit « coffre » refusé quand il n'est pas permis ; retour au défaut", () => {
    const o = make({ vaultAllowed: () => false });
    o.rights = "coffre";
    expect(o.rights).toBe("enregistrer");
    const p = make({ vaultAllowed: () => true });
    p.rights = "coffre";
    expect(p.rights).toBe("coffre");
  });

  it("chaque raison de blocage a son texte FR et EN", () => {
    for (const k of ["options.block.mdp_trop_court", "options.block.mdp_trop_courant", "options.block.mdp_verif"]) {
      expect(fr[k as keyof typeof fr], k).toBeTruthy();
      expect(en[k as keyof typeof en], k).toBeTruthy();
    }
  });

  it("phrase des options : pluriel et valeurs lues dans les constantes, chiffres jamais écrits en dur", async () => {
    const { setLang, t } = await import("../i18n/i18n.svelte");
    setLang("fr");
    expect(t("options.summary", { ttl: "12 h", opens: t("options.opens.count", { n: 1 }) })).toBe(
      "S'efface dans 12 h ou après 1 ouverture, au premier des deux.",
    );
    expect(t("options.opens.count", { n: 3 })).toBe("3 ouvertures");
    expect(t("options.tries", { n: PW_TRIES })).toBe(`${PW_TRIES} essais ratés, et le partage est détruit.`);
    setLang("en");
    expect(t("options.opens.count", { n: 1 })).toBe("1 open");
    setLang("fr");
  });
});

describe("mot de passe généré (spec §31)", () => {
  it("8 caractères de l'alphabet, 4 familles, aucun ambigu, répartition uniforme", () => {
    expect(PASSWORD_ALPHABET).toHaveLength(64);
    expect(new Set(PASSWORD_ALPHABET).size).toBe(64);
    const freq = new Map<string, number>();
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      const p = generatePassword();
      expect(p).toHaveLength(8);
      expect(/[a-z]/.test(p) && /[A-Z]/.test(p) && /[2-9]/.test(p) && /[!#$%+=?@]/.test(p)).toBe(true);
      expect(/[0O1lIo]/.test(p)).toBe(false);
      for (const ch of p) freq.set(ch, (freq.get(ch) ?? 0) + 1);
    }
    // Imposer les 4 familles biaise la répartition : par rapport à 1/64, une lettre sort 0,854 fois
    // et un chiffre ou un symbole 1,439 fois (calcul exact par inclusion-exclusion). Chaque
    // caractère est comparé à SA valeur exacte, à ±10 %.
    const uniform = (N * 8) / 64;
    for (const ch of PASSWORD_ALPHABET) {
      const expected = uniform * (/[a-zA-Z]/.test(ch) ? 0.853705 : 1.438884);
      const f = freq.get(ch) ?? 0;
      expect(f, ch).toBeGreaterThan(expected * 0.9);
      expect(f, ch).toBeLessThan(expected * 1.1);
    }
  });

  it("tirage par crypto.getRandomValues", () => {
    const spy = vi.spyOn(crypto, "getRandomValues");
    generatePassword();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("estimation du temps d'envoi", () => {
  it("octets envoyés : contenu + manifeste réservé + étiquettes (le bourrage est rempli par le serveur, spec §29.3)", () => {
    const e = estimateUpload(100 * 1048576);
    expect(e.bytes).toBeGreaterThan(100 * 1048576 + 65536);
    expect(e.bytes).toBeLessThan(100.2 * 1048576);
    expect(e.fastS).toBeLessThan(e.slowS);
    expect(e.fastS).toBeGreaterThan(0);
    expect(estimateUpload(CONTENT_MAX).slowS).toBeGreaterThan(estimateUpload(1).slowS);
  });
});

describe("« Voir seulement » (spec §34)", () => {
  it("refusé pour ce que le navigateur n'affiche pas : archive, bureautique, plus de 200 Mio", () => {
    const items = [
      { kind: "text", base: "Texte 1", ext: "", mime: "text/plain", size: 3 },
      { kind: "file", base: "a", ext: ".jpg", mime: "image/jpeg", size: 3 },
      { kind: "file", base: "b", ext: ".zip", mime: "application/zip", size: 3 },
      { kind: "file", base: "c", ext: ".docx", mime: "", size: 3 },
      { kind: "file", base: "d", ext: ".mp4", mime: "video/mp4", size: 300 * 1048576 },
      { kind: "file", base: "e", ext: ".pdf", mime: "application/pdf", size: 3 },
    ] as const;
    expect(viewOnlyBlockers(items)).toEqual(["b.zip", "c.docx", "d.mp4"]);
  });
});
