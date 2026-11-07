import { mount } from "svelte";
import App from "./App.svelte";

// Démo GitHub Pages (UI §14.3) : en production, la condition vaut false à la compilation et le
// module disparaît du build (garde demoGuard de vite.config.ts, scripts/check-dist.mjs).
if (import.meta.env.MODE === "demo") await (await import("./demo/install")).installDemo(window);

const target = document.getElementById("app");
if (!target) throw new Error("#app introuvable");

export default mount(App, { target });
