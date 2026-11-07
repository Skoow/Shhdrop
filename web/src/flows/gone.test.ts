// @vitest-environment happy-dom
// Spec §41.8 (E1) : fermeture de l'interface à la disparition du partage ; les
// enregistrements en cours finissent, la fin de lecture les attend.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/i18n.svelte";
import GoneScreen from "../ui/GoneScreen.svelte";
import { createGone } from "./gone.svelte";

function make() {
  const finish = vi.fn(async () => undefined);
  const revokeAll = vi.fn();
  return { g: createGone({ finish, revokeAll }), finish, revokeAll };
}

describe("createGone", () => {
  it("rien en cours : fermeture, révocation et fin de lecture tout de suite ; idempotent (une seule fermeture)", () => {
    const { g, finish, revokeAll } = make();
    expect(g.closeToGone("countdown")).toEqual({ finishing: 0 });
    expect(g.cause).toBe("countdown");
    expect(g.closedNow()).toBe(true);
    expect(g.closeToGone("watch410")).toEqual({ finishing: 0 });
    expect(g.cause).toBe("countdown"); // la première cause gagne
    expect(revokeAll).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("un enregistrement en cours continue ; la fin de lecture attend sa fin ; aucun nouveau n'est accepté", () => {
    const { g, finish, revokeAll } = make();
    const a = g.begin("photo.jpg", 100)!;
    const b = g.begin("autre.bin", 50)!;
    b.end(true); // fini avant la fermeture : n'apparaît pas ensuite
    a.progress(30);
    expect(g.closeToGone("http410")).toEqual({ finishing: 1 });
    expect(revokeAll).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
    expect(g.begin("nouveau.bin", 1)).toBeNull();
    expect(g.finishing.map((x) => [x.name, x.done, x.state])).toEqual([["photo.jpg", 30, "running"]]);
    a.progress(80);
    expect(g.finishing[0]!.done).toBe(80);
    a.end(true);
    expect(g.finishing.map((x) => [x.done, x.state])).toEqual([[100, "done"]]);
    expect(finish).toHaveBeenCalledTimes(1);
    a.end(false); // sans effet après la fin
    expect(g.finishing[0]!.state).toBe("done");
  });

  it("échec (refus du serveur, fin de grâce) : « failed », la fin de lecture suit", () => {
    const { g, finish } = make();
    const a = g.begin("rapport.bin", 10)!;
    g.closeToGone("destroyed-here");
    a.progress(4);
    a.end(false);
    expect(g.finishing.map((x) => [x.done, x.state])).toEqual([[4, "failed"]]);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("hors fermeture, un enregistrement fini disparaît du suivi", () => {
    const { g } = make();
    g.begin("a", 1)!.end(true);
    expect(g.running).toBe(0);
    expect(g.closeToGone("countdown").finishing).toBe(0);
  });
});

describe("GoneScreen", () => {
  let c: Record<string, unknown> | null = null;
  afterEach(() => {
    if (c) void unmount(c);
    c = null;
    document.body.innerHTML = "";
    setLang("fr");
  });
  const show = (props: Record<string, unknown>) => {
    c = mount(GoneScreen as never, { target: document.body, props }) as Record<string, unknown>;
    flushSync();
  };
  const txt = () => document.body.textContent!.replace(/[  ]/g, " ");

  it("fichier en cours : nommé (nom nettoyé), état « autorisé à se terminer », progression ; puis « Terminé »", () => {
    setLang("fr");
    show({ cause: "watch410", finishing: [{ id: 1, name: "photo.jpg", total: 200, done: 50, state: "running" }] });
    expect(document.querySelector("h2")!.textContent).toBe("Ce partage a été supprimé.");
    expect(txt()).toContain("Le fichier en cours (photo.jpg) est autorisé à se terminer ; vous ne pouvez plus rien ouvrir d'autre.");
    expect(txt()).toContain("Fichier en cours autorisé à se terminer");
    expect(document.querySelector("progress")!.getAttribute("value")).toBe("25");
    void unmount(c!);
    show({ cause: "watch410", finishing: [{ id: 1, name: "photo.jpg", total: 200, done: 200, state: "done" }] });
    expect(txt()).toContain("Terminé");
    expect(document.querySelector("progress")).toBeNull();
  });

  it("rien en cours : page de fin ordinaire, sans nom ; titre selon la cause", () => {
    show({ cause: "countdown", finishing: [] });
    expect(document.querySelector("h2")!.textContent).toBe("Ce partage a expiré.");
    expect(txt()).toContain("Son contenu a été effacé de cette page.");
    expect(document.querySelectorAll("[data-transfer]")).toHaveLength(0);
  });

  it("anglais ; plusieurs fichiers", () => {
    setLang("en");
    show({
      cause: "destroyed-here",
      finishing: [
        { id: 1, name: "a.bin", total: 1, done: 0, state: "running" },
        { id: 2, name: "b.bin", total: 1, done: 0, state: "failed" },
      ],
    });
    expect(document.querySelector("h2")!.textContent).toBe("This share has been destroyed.");
    expect(txt()).toContain("The 2 files in progress are allowed to finish");
    expect(txt()).toContain("Download interrupted.");
  });
});
