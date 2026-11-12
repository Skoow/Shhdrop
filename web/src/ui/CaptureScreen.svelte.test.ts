// @vitest-environment happy-dom
// Caméra (CaptureScreen) : la fermeture voulue (Échap → « cancel ») remet `open` à faux tout de
// suite, sans attendre l'événement « close » (tâche suivante) : un nouveau clic aussitôt après
// rouvre toujours la boîte. Sans enregistrement vidéo (`canVideo` faux), l'erreur de la caméra
// propose aussi une vidéo du système.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/i18n.svelte";
import CaptureScreen from "./CaptureScreen.svelte";

let c: Record<string, unknown> | undefined;
beforeEach(() => {
  setLang("fr");
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  if (c) void unmount(c);
  c = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function setup(getUserMedia: () => Promise<MediaStream>, canVideo: boolean) {
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  const props = $state({ open: false, canVideo, ondone: vi.fn(), onfallback: vi.fn() });
  c = mount(CaptureScreen as never, { target: document.body, props }) as Record<string, unknown>;
  flushSync();
  return props;
}

describe("CaptureScreen", () => {
  it("Échap (cancel) : open repasse à faux tout de suite", () => {
    const props = setup(() => new Promise<MediaStream>(() => undefined), false);
    props.open = true;
    flushSync();
    const dlg = document.querySelector("dialog")!;
    expect(dlg.open).toBe(true);
    dlg.dispatchEvent(new Event("cancel", { cancelable: true }));
    flushSync();
    expect(props.open).toBe(false);
  });

  it("canVideo faux, caméra refusée : « Choisir une photo » et aussi une vidéo du système", async () => {
    const props = setup(() => Promise.reject(new DOMException("non", "NotAllowedError")), false);
    props.open = true;
    flushSync();
    await vi.waitFor(() => expect(document.querySelector("[role=alert]")).not.toBeNull());
    const labels = [...document.querySelectorAll("[role=alert] button")].map((b) => b.textContent?.trim());
    expect(labels).toContain("Choisir une vidéo");
    const video = [...document.querySelectorAll<HTMLButtonElement>("[role=alert] button")].find((b) => b.textContent?.trim() === "Choisir une vidéo")!;
    video.click();
    flushSync();
    expect(props.onfallback).toHaveBeenCalledWith("video");
  });

  it("canVideo vrai : pas de bouton vidéo en plus (la bascule Vidéo existe)", async () => {
    const props = setup(() => Promise.reject(new DOMException("non", "NotAllowedError")), true);
    props.open = true;
    flushSync();
    await vi.waitFor(() => expect(document.querySelector("[role=alert]")).not.toBeNull());
    const labels = [...document.querySelectorAll("[role=alert] button")].map((b) => b.textContent?.trim());
    expect(labels).not.toContain("Choisir une vidéo");
  });
});
