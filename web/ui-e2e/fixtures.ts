// Banc Playwright : un serveur Go neuf par test, sert web/dist.
// Gardes de fin de test : aucune violation CSP, aucune requête hors de l'origine du serveur.
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startServer, type TestServer } from "../e2e/server";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const CAPTURES = fileURLToPath(new URL("./__captures__", import.meta.url));

export type Shh = {
  origin: string;
  server: TestServer;
  /** Violations CSP (événement securitypolicyviolation ou message « Refused to » de la console). */
  cspViolations: string[];
  /** Requêtes du cadre principal vers une origine autre que `origin` (hors blob:). */
  foreignRequests: string[];
};

/**
 * Seule violation CSP injectée par l'outil, jamais par la page : pour une capture, Playwright
 * (WebKit seulement, `shouldToggleStyleSheetToSyncAnimations`) ajoute puis retire un
 * `<style>body {}</style>` en ligne, que style-src refuse. Établi dans la trace CI du run
 * 41982565598 : le message tombe pendant « taking page screenshot », après l'audit axe.
 * Écart toléré, au plus UNE fois par canal (événement, console) et par capture, et seulement
 * pendant capture() sous WebKit ; tout autre message, ou un second, reste une violation.
 */
type HarnessWindow = { capturing: boolean; event: number; console: number };
const harness = new WeakMap<Page, HarnessWindow>();

function swallowHarnessStyle(page: Page, channel: "event" | "console", text: string): boolean {
  const w = harness.get(page);
  if (!w?.capturing || page.context().browser()?.browserType().name() !== "webkit") return false;
  const known =
    channel === "event"
      ? text.startsWith("style-src-elem inline ")
      : text.startsWith("Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive");
  if (!known || w[channel] >= 1) return false;
  w[channel]++;
  return true;
}

export const test = base.extend<{ shh: Shh }>({
  shh: async ({ page }, use) => {
    const server = await startServer({ env: { SHH_STATIC_DIR: DIST } });
    const cspViolations: string[] = [];
    const foreignRequests: string[] = [];
    try {
      harness.set(page, { capturing: false, event: 0, console: 0 });
      await page.exposeFunction("__shhCsp", (d: string) => {
        if (!swallowHarnessStyle(page, "event", d)) cspViolations.push(d);
      });
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (e) => {
          (window as unknown as { __shhCsp(d: string): void }).__shhCsp(
            `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`,
          );
        });
      });
      page.on("console", (m) => {
        if (m.text().includes("Refused to") && !swallowHarnessStyle(page, "console", m.text())) cspViolations.push(m.text());
      });
      page.on("request", (r) => {
        if (r.frame() !== page.mainFrame()) return;
        const u = r.url();
        if (u.startsWith("blob:")) return;
        let origin: string;
        try {
          origin = new URL(u).origin;
        } catch {
          origin = u;
        }
        if (origin !== server.origin) foreignRequests.push(u);
      });
      await use({ origin: server.origin, server, cspViolations, foreignRequests });
      expect(cspViolations).toEqual([]);
      expect(foreignRequests).toEqual([]);
    } finally {
      await server.dispose();
    }
  },
});

export { expect };

/** Capture 1x dans ui-e2e/__captures__/<projet>/<nom>.png (ignoré par git, artefact CI). */
export async function capture(page: Page, nom: string): Promise<string> {
  const project = test.info().project.name;
  const dir = `${CAPTURES}/${project}`;
  mkdirSync(dir, { recursive: true });
  const path = `${dir}/${nom}.png`;
  const w = harness.get(page);
  if (w) Object.assign(w, { capturing: true, event: 0, console: 0 });
  try {
    await page.screenshot({ path });
    await page.evaluate(() => 0); // aller-retour : les messages de la capture sont arrivés
  } finally {
    if (w) w.capturing = false;
  }
  return path;
}

/** Audit axe WCAG 2.1 A et AA ; renvoie les violations (à comparer à []). */
export async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations;
}
