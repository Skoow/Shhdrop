// Banc Playwright : un serveur Go neuf par test, sert web/dist (fixture `shh`) ; ou la démo
// web/dist-demo servie comme par GitHub Pages (fixture `demo`).
// Gardes de fin de test : aucune violation CSP, aucune requête hors de l'origine du serveur.
import AxeBuilder from "@axe-core/playwright";
import { errors, test as base, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { get } from "node:http";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startServer, type StartOpts, type TestServer } from "../e2e/server";
import { startPagesServer } from "./pages-server";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const DIST_DEMO = fileURLToPath(new URL("../dist-demo", import.meta.url));
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
  // Un refus par document de la page (cadre PDF compris) : Playwright injecte son style dans
  // chacun (CI du 10 novembre). Au-delà du nombre de documents, c'est un vrai refus.
  if (!known || w[channel] >= page.frames().length) return false;
  w[channel]++;
  return true;
}

/**
 * Sonde de disponibilité côté Node : une vraie requête GET (connexion neuve, `Connection: close`,
 * aucune connexion persistante laissée derrière elle) jusqu'à une réponse HTTP. Le serveur Go
 * lie son port avant d'écrire SHH_LISTENING, donc les connexions n'étaient jamais refusées, mais
 * « le port est ouvert » ne dit pas que la boucle d'acceptation et le gestionnaire répondent.
 * Écarte aussi toute cause serveur d'un blocage du navigateur.
 */
export async function probe(url: string, timeoutMs = 10_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await new Promise<number>((resolve, reject) => {
        const req = get(url, { agent: false, headers: { Connection: "close" }, timeout: 2_000 }, (res) => {
          res.resume();
          res.once("end", () => resolve(res.statusCode ?? 0));
          res.once("error", reject);
        });
        req.once("timeout", () => req.destroy(new Error("sonde : pas de réponse en 2 s")));
        req.once("error", reject);
      });
    } catch (e) {
      if (Date.now() > deadline) throw new Error(`serveur injoignable : ${url} (${(e as Error).message})`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

/**
 * Premier `page.goto` d'un test : relancé (au plus 2 fois) s'il expire sans aucune réponse.
 * Constat (trace CI du run 42026598153, i18n.spec.ts:72, webkit-desktop) : la requête de document
 * part, aucune réponse n'arrive en 60 s, alors que le serveur est vivant (les 40 autres tests du
 * même projet passent). Cause côté WebKit/réseau local non reproductible ici (pas de WebKit sur
 * ce poste). Le plafond de 60 s d'un test entier rendait ce défaut fatal ; un nouvel essai
 * après 15 s le surmonte. Chaque relance est consignée en annotation (jamais silencieuse), avec
 * l'état du serveur à ce moment, pour qu'une cause serveur réapparaisse dans les rapports.
 * Un `timeout` explicite du test est respecté et désactive le mécanisme. Aucune assertion de
 * contenu n'est touchée : seul le transport de la toute première requête est répété.
 */
function retryFirstGoto(page: Page, origin: string): void {
  const goto = page.goto.bind(page) as Page["goto"];
  let first = true;
  page.goto = (async (url: string, options?: Parameters<Page["goto"]>[1]) => {
    if (!first || options?.timeout !== undefined) return goto(url, options);
    first = false;
    for (let attempt = 1; ; attempt++) {
      try {
        return await goto(url, { ...options, timeout: 15_000 });
      } catch (e) {
        if (!(e instanceof errors.TimeoutError) || attempt >= 3) throw e;
        let serveur: string;
        try {
          serveur = `HTTP ${await probe(origin + "/", 3_000)}`;
        } catch (pe) {
          serveur = (pe as Error).message;
        }
        test.info().annotations.push({ type: "premier goto relancé", description: `essai ${attempt} expiré (15 s) ; serveur : ${serveur}` });
      }
    }
  }) as Page["goto"];
}

/** Gardes de fin de test : violations CSP et requêtes du cadre principal hors de `origin`. */
async function guard(page: Page, origin: string): Promise<{ cspViolations: string[]; foreignRequests: string[] }> {
  const cspViolations: string[] = [];
  const foreignRequests: string[] = [];
  harness.set(page, { capturing: false, event: 0, console: 0 });
  // Toute capture de la page (page.screenshot appelé par un spec, pas seulement capture()) :
  // sous WebKit, Playwright injecte une feuille de style que la CSP refuse ; ce refus-là, et
  // lui seul, est ignoré le temps de la capture (CI rouge du 10 novembre : 92 faux échecs).
  const rawShot = page.screenshot.bind(page);
  page.screenshot = ((o?: Parameters<Page["screenshot"]>[0]) => during(page, () => rawShot(o))) as Page["screenshot"];
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
    let o: string;
    try {
      o = new URL(u).origin;
    } catch {
      o = u;
    }
    if (o !== origin) foreignRequests.push(u);
  });
  return { cspViolations, foreignRequests };
}

/** Démo servie comme par GitHub Pages (pages-server.ts) : `url` = origine + « /shhdrop/ ». */
export type Demo = {
  origin: string;
  url: string;
  cspViolations: string[];
  foreignRequests: string[];
  /** Toutes les requêtes du cadre principal (aucune ne doit viser /api : le faux serveur est dans la page). */
  requests: { url: string; headers: Record<string, string>; postData: string | null }[];
};

export const test = base.extend<{ shh: Shh; demo: Demo; shhServer: Pick<StartOpts, "binary" | "env"> }>({
  /** Binaire et variables du serveur de test (par défaut : le binaire livré, SHH_STATIC_DIR seul). */
  shhServer: [{}, { option: true }],
  shh: async ({ page, shhServer }, use) => {
    const server = await startServer({ binary: shhServer.binary, env: { SHH_STATIC_DIR: DIST, ...shhServer.env } });
    try {
      await probe(server.origin + "/");
      retryFirstGoto(page, server.origin);
      const g = await guard(page, server.origin);
      await use({ origin: server.origin, server, ...g });
      expect(g.cspViolations).toEqual([]);
      expect(g.foreignRequests).toEqual([]);
    } finally {
      await server.dispose();
    }
  },
  demo: async ({ page }, use) => {
    const pages = await startPagesServer(DIST_DEMO);
    try {
      await probe(`${pages.origin}/shhdrop/`);
      retryFirstGoto(page, pages.origin);
      const g = await guard(page, pages.origin);
      const requests: Demo["requests"] = [];
      page.on("request", (r) => requests.push({ url: r.url(), headers: r.headers(), postData: r.postData() }));
      await use({ origin: pages.origin, url: `${pages.origin}/shhdrop/`, requests, ...g });
      expect(g.cspViolations).toEqual([]);
      expect(g.foreignRequests).toEqual([]);
      expect(requests.filter((r) => /^\/api(\/|$)/i.test(new URL(r.url).pathname))).toEqual([]);
    } finally {
      await pages.close();
    }
  },
});

export { expect };

/** Exécute une capture en ignorant, sous WebKit, le seul refus CSP du style injecté par Playwright. */
async function during<T>(page: Page, shot: () => Promise<T>): Promise<T> {
  const w = harness.get(page);
  if (!w || w.capturing) return shot();
  Object.assign(w, { capturing: true, event: 0, console: 0 });
  try {
    const r = await shot();
    await page.evaluate(() => 0); // aller-retour : les messages de la capture sont arrivés
    return r;
  } finally {
    w.capturing = false;
  }
}

/** Capture d'un élément (locator.screenshot), sous la même garde que les captures de page. */
export function captureOf(l: Locator, o: Parameters<Locator["screenshot"]>[0]): Promise<Buffer> {
  return during(l.page(), () => l.screenshot(o));
}

/**
 * Presse-papiers autorisé pour les tests. WebKit ne connaît pas « clipboard-write » : la
 * demander lève « Unknown permission », et la liste refusée reste attachée au contexte, si bien
 * que le newPage() suivant lève à son tour (CI du 10 novembre). On ne la demande donc jamais
 * sous WebKit (l'écriture y est permise après un geste, sans permission).
 */
export async function grantClipboard(ctx: BrowserContext, origin?: string): Promise<void> {
  if (ctx.browser()?.browserType().name() === "webkit") return webkitClipboard(ctx);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], origin === undefined ? undefined : { origin });
}

/**
 * WebKit (Playwright) ne lit pas le presse-papiers du système en mode sans tête : la page
 * témoin se fermait (« Target page… has been closed », CI du 10 novembre). On y relève donc ce
 * que le site écrit, au point d'écriture lui-même (navigator.clipboard.writeText), sans rien
 * changer à son comportement ; readClipboard rend la dernière écriture de l'onglet.
 */
const clipWatched = new WeakSet<BrowserContext>();
async function webkitClipboard(ctx: BrowserContext): Promise<void> {
  if (clipWatched.has(ctx)) return;
  clipWatched.add(ctx);
  await ctx.addInitScript(() => {
    const c = navigator.clipboard;
    if (!c) return;
    const write = c.writeText.bind(c);
    c.writeText = async (s: string) => {
      (window as unknown as { __shhClip?: string }).__shhClip = s;
      try {
        await write(s);
      } catch {
        // l'écriture réelle peut être refusée en mode sans tête : seule la valeur compte ici
      }
    };
  });
}

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
  // Contraste mesuré sur l'état final : on attend la fin des entrées (finies, ≤ 900 ms, K1). Une
  // entrée en cours a une opacité < 1 qu'axe compterait comme un défaut de contraste. Les
  // boucles d'ambiance et les animations liées au défilement ne sont pas attendues.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.timeline === document.timeline && a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations;
}

/**
 * Lit le presse-papiers depuis une page témoin : le site refuse `clipboard-read=()` (audit F3),
 * la page testée ne peut donc pas le lire elle-même. Page vierge servie par Playwright sur
 * une origine sûre (localhost) sans Permissions-Policy, puis l'onglet testé reprend la main.
 */
const CLIP_ORIGIN = "http://localhost:9/";
export async function readClipboard(page: Page): Promise<string> {
  const ctx = page.context();
  if (ctx.browser()?.browserType().name() === "webkit") {
    return page.evaluate(() => (window as unknown as { __shhClip?: string }).__shhClip ?? "");
  }
  await grantClipboard(ctx, CLIP_ORIGIN.slice(0, -1));
  const p = await ctx.newPage();
  try {
    await p.route(CLIP_ORIGIN, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>clip</title>" }));
    await p.goto(CLIP_ORIGIN);
    await p.bringToFront();
    return await p.evaluate(() => navigator.clipboard.readText());
  } finally {
    await p.close();
    await page.bringToFront();
  }
}
