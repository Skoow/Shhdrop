// Vignette EXIF gardée (décision du propriétaire) : elle peut montrer la photo d'avant un
// recadrage ou une retouche ; le pied de page et la page Sécurité le disent (test d'intrusion
// du 11 novembre).
import { describe, expect, test } from "vitest";
import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { infoPage } from "./content";

const all = (lang: "fr" | "en") => {
  const p = infoPage("securite", lang);
  return [p.lede, ...p.blocks.flatMap((b) => [...(b.p ?? []), ...(b.list ?? [])])].join("\n");
};
const FR_RE = /vignette[^.]*avant (un )?recadrage ou (une )?retouche/iu;
const EN_RE = /thumbnail[^.]*before (it was )?cropp(ed|ing) or edit(ed|ing)/iu;

describe("vignette d'aperçu gardée : dite honnêtement", () => {
  test("page Sécurité, en français et en anglais", () => {
    expect(all("fr")).toMatch(FR_RE);
    expect(all("en")).toMatch(EN_RE);
  });
  test("« En savoir plus » du nettoyage automatique (pied de page)", () => {
    expect(fr["settings.clean.more.body"]).toMatch(FR_RE);
    expect(en["settings.clean.more.body"]).toMatch(EN_RE);
  });
});
