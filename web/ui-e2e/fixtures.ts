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

export const test = base.extend<{ shh: Shh }>({
  shh: async ({ page }, use) => {
    const server = await startServer({ env: { SHH_STATIC_DIR: DIST } });
    const cspViolations: string[] = [];
    const foreignRequests: string[] = [];
    try {
      await page.exposeFunction("__shhCsp", (d: string) => {
        cspViolations.push(d);
      });
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (e) => {
          (window as unknown as { __shhCsp(d: string): void }).__shhCsp(
            `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`,
          );
        });
      });
      page.on("console", (m) => {
        if (m.text().includes("Refused to")) cspViolations.push(m.text());
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
  await page.screenshot({ path });
  return path;
}

/** Audit axe WCAG 2.1 A et AA ; renvoie les violations (à comparer à []). */
export async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations;
}
