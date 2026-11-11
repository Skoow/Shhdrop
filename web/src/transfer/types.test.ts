// Audit M1 : tous les secrets avaient le type Uint8Array, et envoyer K_lien au serveur
// compilait. Les lignes marquées @ts-expect-error DOIVENT être des erreurs de type :
// `npm test` lance `tsc --noEmit`, qui échoue si l'une d'elles compile.
import { describe, expect, it } from "vitest";
import { KDF_MIN, accessKeys, b64u, deriveAccess, newKLien, newSGestion, parseLink, passwordKey, randomBytes, shareLink, type KAcces, type KLien, type KPreuve, type SGestion } from "../engine";
import * as api from "./api";
import { fetchMeta } from "./client";

const ORIGIN = "https://srv.test";

describe("types marqués des secrets", () => {
  it("K_lien, S_gestion ou un tableau brut ne passent pas pour K_accès / K_preuve (tsc)", async () => {
    // Jamais exécuté : seul le typage compte.
    const typeChecks = async (c: api.Ctx, link: string, raw: Uint8Array<ArrayBuffer>) => {
      const p = await parseLink(link);
      if (p.kind !== "s") {
        // @ts-expect-error un lien de gestion n'a pas de K_lien
        void p.kLien;
        // @ts-expect-error S_gestion n'est pas K_accès
        await api.meta(c, p.sGestion);
        return;
      }
      // @ts-expect-error un lien de partage n'a pas de S_gestion
      void p.sGestion;
      // @ts-expect-error K_lien n'est pas K_accès (scénario de l'audit)
      await api.meta(c, p.kLien);
      // @ts-expect-error tableau brut refusé
      await api.meta(c, raw);
      const { kAcces } = await deriveAccess(p.kLien);
      const kMdp = await passwordKey("pw", randomBytes(16), KDF_MIN);
      // @ts-expect-error K_mdp n'est pas K_lien (arguments inversés)
      await accessKeys(kMdp, p.kLien);
      // @ts-expect-error K_mdp n'est pas K_accès
      await api.meta(c, kMdp);
      const { kPreuve } = await accessKeys(p.kLien, kMdp);
      await api.meta(c, kAcces);
      await api.unlock(c, kAcces, kPreuve);
      // @ts-expect-error arguments inversés
      await api.unlock(c, kPreuve, kAcces);
      // @ts-expect-error K_lien n'est pas S_gestion
      await api.status(c, p.kLien);
      // @ts-expect-error K_accès n'est pas S_gestion
      await api.destroy(c, { sGestion: kAcces });
      // @ts-expect-error K_lien n'est pas K_preuve
      await api.destroy(c, { kAcces, kPreuve: p.kLien });
      // @ts-expect-error un tableau brut n'est pas K_lien
      shareLink(ORIGIN, raw);
      // @ts-expect-error S_gestion n'est pas K_lien
      shareLink(ORIGIN, newSGestion());
      // @ts-expect-error K_lien n'est pas K_accès (création)
      await api.create(c, p.kLien, newSGestion(), { bucket: 1, hp: "", shown_at: "", altcha: "" });
      // @ts-expect-error K_accès n'est pas S_gestion (création)
      await api.create(c, kAcces, kAcces, { bucket: 1, hp: "", shown_at: "", altcha: "" });
      await api.create(c, kAcces, newSGestion(), { bucket: 1, hp: "", shown_at: "", altcha: "" });
      const ok: [KLien, KAcces, KPreuve, SGestion] = [p.kLien, kAcces, kPreuve, newSGestion()];
      void ok;
    };
    expect(typeof typeChecks).toBe("function");
  });

  it("à l'exécution, X-Shh-Access vaut b64u(K_accès), jamais b64u(K_lien)", async () => {
    const kLien = newKLien();
    const sent: string[] = [];
    const f = (async (_: RequestInfo | URL, init?: RequestInit) => {
      sent.push(new Headers(init?.headers).get("X-Shh-Access") ?? "");
      return new Response('{"error":"not_found"}', { status: 404 });
    }) as typeof fetch;
    await fetchMeta(await shareLink(ORIGIN, kLien), ORIGIN, { fetch: f }).catch(() => undefined);
    expect(sent).toEqual([b64u((await deriveAccess(kLien)).kAcces)]);
    expect(sent[0]).not.toBe(b64u(kLien));
  });
});
