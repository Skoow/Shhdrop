import { describe, expect, it } from "vitest";
import { cleanMark, manifestClean, receivedClean } from "./clean-label";

describe("nettoyage dit au destinataire (D41-35)", () => {
  it("expéditeur → manifeste : famille, échec, ou tel quel ; rien pour un texte", () => {
    expect(manifestClean({ kind: "file", clean: "nettoye", cleanFamily: "pdf" })).toBe("pdf");
    expect(manifestClean({ kind: "file", clean: "echec" })).toBe("echec");
    expect(manifestClean({ kind: "file", clean: "protege" })).toBe("protege");
    for (const c of ["original", "intact", "non_pris_en_charge"] as const) expect(manifestClean({ kind: "file", clean: c })).toBe("tel_quel");
    expect(manifestClean({ kind: "text", clean: "sans" })).toBeNull();
  });
  it("manifeste → destinataire : texte et marque ; absent → rien", () => {
    expect(receivedClean(undefined)).toBeNull();
    expect(receivedClean("image")).toEqual({ key: "clean.recv.done.image", mark: "done" });
    expect(receivedClean("bureautique")).toEqual({ key: "clean.recv.done.office", mark: "done" });
    expect(receivedClean("tel_quel")).toEqual({ key: "clean.recv.asis", mark: null });
    expect(receivedClean("protege")).toEqual({ key: "clean.recv.fail.protege", mark: "fail" });
    expect(cleanMark({ clean: "nettoye" })).toBe("done");
    expect(cleanMark({ clean: "original" })).toBeNull();
  });
});
