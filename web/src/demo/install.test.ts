// @vitest-environment happy-dom
// installDemo : fetch détourné pour /api seulement, titre « Démo · », crochets des écrans.
import { describe, expect, it, vi } from "vitest";
import { getDemo } from "../app/demo-hooks";
import { setLang } from "../i18n/i18n.svelte";

describe("installDemo", async () => {
  const sent: string[] = [];
  const realFetch = vi.fn(async (input: RequestInfo | URL) => {
    sent.push(input instanceof Request ? input.url : String(input));
    return new Response("site");
  });
  window.fetch = realFetch as typeof fetch;
  document.title = "Shhdrop";
  expect(getDemo()).toBeNull();
  const { installDemo } = await import("./install");
  installDemo(window);

  it("/api/* de l'origine → faux serveur ; le reste → réseau", async () => {
    const cap = await (await window.fetch("/api/captcha")).json();
    expect(cap).toMatchObject({ fallback: null });
    expect((await window.fetch(`${location.origin}/API/x`)).status).toBe(404);
    expect(await (await window.fetch("/assets/a.js")).text()).toBe("site");
    expect(await (await window.fetch("https://ailleurs.test/api/captcha")).text()).toBe("site");
    expect(sent).toEqual([`${location.origin}/assets/a.js`, "https://ailleurs.test/api/captcha"]);
  });

  it("titre préfixé, y compris après un changement", async () => {
    expect(document.title).toBe("Démo · Shhdrop");
    document.title = "Ouvrir";
    await new Promise((r) => setTimeout(r, 0));
    expect(document.title).toBe("Démo · Ouvrir");
  });

  it("crochets : preuve factice, phrase de « Lien invalide » et écarts dans la langue courante", async () => {
    const d = getDemo()!;
    expect(await d.solveCaptcha({}, { fallbackOrigin: null, mode: "pow" })).toEqual({ kind: "pow", payload: "demo" });
    setLang("fr");
    expect(d.invalidLinkNote).toBe("(normal en démo : le partage n'existait que dans l'onglet d'origine)");
    expect(d.securityGaps).toContain("frame-ancestors");
    expect(d.securityGaps).toContain("GitHub reçoit votre adresse IP");
    setLang("en");
    expect(d.invalidLinkNote).toBe("(expected in the demo: the share only existed in the original tab)");
    expect(d.securityGaps).toContain("HSTS");
    expect(d.securityGaps).toContain("GitHub receives your IP address");
  });

  it("openAsRecipient : pushState vers /#<43> (spec §32) et popstate ; refuse un autre lien", () => {
    const d = getDemo()!;
    const pops: string[] = [];
    window.addEventListener("popstate", () => pops.push(location.pathname + location.hash));
    const key = "A".repeat(43);
    d.openAsRecipient(`${location.origin}/#${key}`);
    expect(pops).toEqual([`/#${key}`]);
    for (const bad of [`https://ailleurs.test/#${key}`, `${location.origin}/#m${key}`, `${location.origin}/?x=1#${key}`, `${location.origin}/s/abc#${key}`, `${location.origin}/#court`])
      expect(() => d.openAsRecipient(bad), bad).toThrow("lien_invalide");
    expect(pops).toHaveLength(1);
  });

  it("aucun stockage navigateur", () => {
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });
});
