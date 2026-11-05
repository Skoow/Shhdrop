// @vitest-environment happy-dom
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import Button from "./Button.svelte";

const label = createRawSnippet(() => ({ render: () => "<span>Go</span>" }));
let current: Record<string, unknown> | undefined;
afterEach(() => {
  if (current) void unmount(current);
  current = undefined;
  document.body.innerHTML = "";
});

function setup(props: Record<string, unknown>) {
  current = mount(Button, { target: document.body, props: { children: label, ...props } });
  flushSync();
  return document.querySelector("button")!;
}

describe("Button", () => {
  it("deux clics synchrones -> un seul appel de onpress", async () => {
    let release!: () => void;
    const onpress = vi.fn(() => new Promise<void>((r) => (release = r)));
    const b = setup({ onpress });
    b.click();
    b.click();
    expect(onpress).toHaveBeenCalledTimes(1);
    flushSync();
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(b.getAttribute("aria-disabled")).toBe("true");
    release();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(b.hasAttribute("aria-busy")).toBe(false);
    b.click();
    expect(onpress).toHaveBeenCalledTimes(2);
  });

  it("onpress synchrone qui lève : le bouton se libère", () => {
    const onpress = vi.fn(() => {
      throw new Error("x");
    });
    const b = setup({ onpress });
    expect(() => b.click()).not.toThrow();
    b.click();
    expect(onpress).toHaveBeenCalledTimes(2);
  });

  it("onpress asynchrone qui rejette : libéré, rejet non propagé", async () => {
    const onpress = vi.fn(() => Promise.reject(new Error("x")));
    const b = setup({ onpress });
    b.click();
    await new Promise((r) => setTimeout(r, 0));
    b.click();
    expect(onpress).toHaveBeenCalledTimes(2);
  });

  it("désactivé : aucun appel", () => {
    const onpress = vi.fn();
    const b = setup({ onpress, disabled: true });
    b.click();
    expect(onpress).not.toHaveBeenCalled();
  });

  it("type=button par défaut (jamais d'envoi de formulaire)", () => {
    expect(setup({}).type).toBe("button");
  });
});
