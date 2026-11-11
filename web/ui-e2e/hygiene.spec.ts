// Hygiène du lien (UI §12.1), navigateur intégré (S4), navigateur non pris en charge (UI §9.11),
// dépôt de fichier neutralisé hors du composeur (UI §9.2.2).
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { axe, capture, expect, test } from "./fixtures";
import { freshPage, goSecurity, pwField, sendShare, unlock } from "./open-helpers";
import { startPagesServer } from "./pages-server";

const KEY = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => 255 - i * 3)).toString("base64url");
const KEY2 = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => i * 5)).toString("base64url");

const INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 307.0.0.34.111 (iPhone15,3; iOS 17_1; fr_FR; fr; scale=3.00; 1290x2796; 532277534)";

/** Requêtes vers /api/. */
function apiRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) urls.push(r.url());
  });
  return urls;
}

/** Toutes les requêtes de la page, en-têtes compris : aucune ne doit porter la clé (spec §32). */
function allRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r) => {
    seen.push(`${r.method()} ${r.url()} ${JSON.stringify(r.headers())} ${r.postData() ?? ""}`);
  });
  return seen;
}

test.use({ locale: "fr-FR" });

const hash = (page: Page) => page.evaluate(() => location.hash);
const historyLength = (page: Page) => page.evaluate(() => history.length);

/** État d'une entrée d'historique, ou null pendant un changement de document (rechargement). */
async function entry(page: Page, secrets: string[]) {
  try {
    return await page.evaluate((ss) => {
      const html = document.documentElement.outerHTML;
      return {
        url: location.href,
        hash: location.hash,
        length: history.length,
        leak: ss.some((s) => location.href.includes(s) || html.includes(s) || document.title.includes(s)),
      };
    }, secrets);
  } catch {
    return null; // contexte détruit : la page se recharge (retour depuis le cache « page précédente »)
  }
}

/**
 * Parcourt TOUT l'historique de l'onglet depuis sa dernière entrée (aucune entrée « Avant ») :
 * Retour jusqu'à la première, puis Avant jusqu'à la dernière. À chaque entrée : pas de « # » dans
 * l'adresse, `location.hash` vide, secret absent de l'adresse, du titre et du DOM, et
 * `history.length` inchangé (le parcours ne crée ni ne retire d'entrée : il les voit toutes).
 * `n - 1` Retours depuis la dernière entrée atteignent la première, quelle qu'elle soit
 * (entrée du même document créée par pushState, ou about:blank, autre document).
 * Rend les adresses visitées, de la première à la dernière.
 */
async function walkHistory(page: Page, secrets: string[]): Promise<string[]> {
  const n = await historyLength(page);
  expect(n).toBeGreaterThan(1);
  const settle = async (url?: string): Promise<string> => {
    let at = "";
    await expect
      .poll(async () => {
        const e = await entry(page, secrets);
        if (!e || (url !== undefined && e.url !== url)) return null;
        at = e.url;
        return { hash: e.hash, length: e.length, leak: e.leak, fragment: e.url.includes("#") };
      })
      .toEqual({ hash: "", length: n, leak: false, fragment: false });
    return at;
  };
  const urls = [await settle()];
  // waitUntil « commit » : on n'attend pas un « load » qui ne vient pas pour une entrée du même
  // document ni pour une page rendue par le cache « page précédente » (WebKit) ; settle() attend
  // ensuite l'état réel de l'entrée (et un éventuel rechargement, UI §12.2).
  for (let i = 1; i < n; i++) {
    await page.goBack({ waitUntil: "commit" });
    urls.unshift(await settle());
  }
  for (let i = 1; i < n; i++) {
    await page.goForward({ waitUntil: "commit" });
    await settle(urls[i]);
  }
  return urls;
}

/**
 * Les entrées de l'origine sont exactement `paths`, dans l'ordre ; avant elles, seulement la page
 * vide de départ de l'onglet (about:blank), si le navigateur l'a gardée dans l'historique.
 */
function expectOnlyOwnEntries(urls: string[], origin: string, paths: string[]): void {
  const own = urls.filter((u) => u.startsWith(origin + "/"));
  expect(own).toEqual(paths.map((p) => origin + p));
  expect(urls.slice(0, urls.length - own.length).every((u) => u === "about:blank")).toBe(true);
}

// Spec §32 : lien court à la racine, « /#<clé> » (partage) ou « /#m<clé> » (gestion).
for (const [kind, frag] of [
  ["partage", `#${KEY}`],
  ["gestion", `#m${KEY}`],
] as const) {
  test(`/${frag.slice(0, 2)}… (${kind}) : le # est retiré de l'adresse et de l'historique, jamais envoyé`, async ({ page, shh }) => {
    const api = apiRequests(page);
    const all = allRequests(page);
    await page.goto(`${shh.origin}/${frag}`);
    await expect.poll(() => hash(page)).toBe("");
    expect(page.url()).toBe(`${shh.origin}/`);
    // La lecture de l'état part avant de quitter la page (sinon, sous charge, l'écran est
    // quitté avant elle et le décompte ci-dessous échoue).
    await expect.poll(() => api.length).toBe(1);

    // Retour / Avant : aucune entrée d'historique ne réaffiche le #, et le retrait n'a pas
    // ajouté d'entrée (replaceState) : une seule entrée « / » de l'origine avant « /securite ».
    await goSecurity(page);
    await expect(page).toHaveURL(`${shh.origin}/securite`);
    expectOnlyOwnEntries(await walkHistory(page, [KEY]), shh.origin, ["/", "/securite"]);
    // Rechargement : rien ne revient.
    await page.goBack();
    await expect(page).toHaveURL(`${shh.origin}/`);
    await page.reload();
    expect(page.url()).toBe(`${shh.origin}/`);
    expect(await page.content()).not.toContain(KEY);
    // Ouverture : une seule lecture de l'état (meta, avec K_accès dérivé, jamais la clé) ;
    // gestion : une lecture de l'état (manage/status). Aucune autre requête d'API.
    expect(api.map((u) => new URL(u).pathname)).toEqual([kind === "partage" ? "/api/shares/meta" : "/api/manage/status"]);
    // La partie après « # » n'est jamais envoyée au serveur (adresse, en-têtes, corps).
    // Gestion : S_gestion (la valeur du fragment) part, par conception, dans l'en-tête
    // X-Shh-Manage de manage/status (spec §29.8) ; nulle part ailleurs (adresse, corps, autre en-tête).
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) expect(kind === "gestion" ? r.replace(`"x-shh-manage":"${KEY}"`, "") : r).not.toContain(KEY);
  });
}

test("# collé dans la barre sur la même page (navigation de fragment) : retiré aussi", async ({ page, shh }) => {
  await page.goto(`${shh.origin}/#${KEY}`);
  await expect.poll(() => hash(page)).toBe("");
  await page.evaluate((k) => (location.hash = k), KEY2);
  await expect.poll(() => hash(page)).toBe("");
  await page.evaluate((k) => (location.hash = `m${k}`), KEY2);
  await expect.poll(() => hash(page)).toBe("");
  // Chaque navigation de fragment a créé une entrée, aussitôt remplacée par « / » nu : trois
  // entrées « / », aucune avec un « # », ni au Retour ni à l'Avant.
  expectOnlyOwnEntries(await walkHistory(page, [KEY, KEY2]), shh.origin, ["/", "/", "/"]);
});

test.describe("navigateur intégré (Instagram)", () => {
  test.use({ userAgent: INSTAGRAM });

  test("le # est gardé (pour « Ouvrir dans le navigateur »), aucune requête /api/", async ({ page, shh }) => {
    const api = apiRequests(page);
    await page.goto(`${shh.origin}/#${KEY}`);
    await expect(page.locator("main#contenu")).toBeVisible();
    await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
    expect(await hash(page)).toBe(`#${KEY}`);
    expect(api).toEqual([]);
  });
});

test.describe("navigateur sans crypto.subtle", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Crypto.prototype, "subtle", { get: () => undefined, configurable: true });
    });
  });

  test("« non pris en charge », aucune route ne démarre, aucune requête /api/", async ({ page, shh }) => {
    const api = apiRequests(page);
    await page.goto(`${shh.origin}/#${KEY}`);
    await expect(
      page.getByRole("heading", { name: "Ce navigateur ne permet pas de chiffrer en sécurité.", exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Shhdrop", exact: true })).toHaveCount(0);
    // Le lien reste dans la barre : la personne peut le recopier dans un autre navigateur.
    expect(await hash(page)).toBe(`#${KEY}`);
    expect(api).toEqual([]);
    expect(await axe(page)).toEqual([]);
    await capture(page, "non-pris-en-charge");
  });
});

test("fichier déposé sur /s/x : défaut empêché, l'adresse ne change pas", async ({ page, shh }) => {
  await page.goto(`${shh.origin}/s/x`);
  await expect(page.locator("main#contenu")).toBeVisible();
  const url = page.url();

  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File(["bonjour"], "a.txt", { type: "text/plain" }));
    return d;
  });
  await page.dispatchEvent("main#contenu", "dragover", { dataTransfer: dt });
  await page.dispatchEvent("main#contenu", "drop", { dataTransfer: dt });

  const prevented = await page.evaluate(() => {
    const d = new DataTransfer();
    d.items.add(new File(["bonjour"], "a.txt", { type: "text/plain" }));
    return (["dragover", "drop"] as const).map((type) => {
      const e = new DragEvent(type, { dataTransfer: d, bubbles: true, cancelable: true });
      document.querySelector("main")!.dispatchEvent(e);
      return e.defaultPrevented;
    });
  });
  expect(prevented).toEqual([true, true]);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  expect(page.url()).toBe(url);
});

// Sécurité : lien du pied de page, présent sur toutes les pages (goSecurity).

// I1 : liens abîmés (ponctuation ajoutée par une messagerie, autre chemin, ancien format
// /s/{id}, majuscule) : le routeur les classe en accueil ou en 404, le « # » est retiré quand même.
for (const [what, path, frag] of [
  ["point collé", "/", `#${KEY}.`],
  ["parenthèse collée", "/", `#${KEY})`],
  ["clé tronquée", "/", `#${KEY.slice(1)}`],
  ["préfixe M majuscule", "/", `#M${KEY}`],
  ["ancien format /s/{id}", "/s/AAAAAAAAAAAAAAAAAAAAAA", `#${KEY}`],
  ["/S/ majuscule", "/S/x", `#${KEY}`],
  ["route inconnue", "/inconnu", `#${KEY}`],
  ["page fixe", "/securite", `#${KEY}`],
] as const) {
  test(`${path}#… (${what}) : le # est retiré sur toute route, Retour ne le rend pas`, async ({ page, shh }) => {
    await page.goto(`${shh.origin}${path}${frag}`);
    await expect.poll(() => hash(page)).toBe("");
    expect(page.url()).toBe(`${shh.origin}${path}`);
    await goSecurity(page);
    await expect(page).toHaveURL(`${shh.origin}/securite`);
    await page.goBack();
    await expect(page).toHaveURL(`${shh.origin}${path}`);
    expect(await hash(page)).toBe("");
    await page.goForward();
    await expect(page).toHaveURL(`${shh.origin}/securite`);
    expectOnlyOwnEntries(await walkHistory(page, [KEY]), shh.origin, [path, "/securite"]);
  });
}

// Spec §32 : X-Robots-Tag et le repli particulier de /s/ et /m/ ont disparu.
test("/ : pas de X-Robots-Tag ; /s/<id>. (ancien lien abîmé) → 404 du serveur", async ({ page, shh }) => {
  const res = await page.goto(`${shh.origin}/#${KEY}`);
  expect(res?.status()).toBe(200);
  expect(res?.headers()["x-robots-tag"]).toBeUndefined();
  const old = await page.request.get(`${shh.origin}/s/AAAAAAAAAAAAAAAAAAAAAA.`);
  expect(old.status()).toBe(404);
});

// I2 : paramètre de suivi ajouté par l'application (Facebook, Messenger, Instagram).
test("/?fbclid=x#<clé> : requête et # retirés, adresse = chemin nu", async ({ page, shh }) => {
  const api = apiRequests(page);
  await page.goto(`${shh.origin}/?fbclid=x#${KEY}`);
  await expect.poll(() => page.url()).toBe(`${shh.origin}/`);
  // Seule requête d'API : la lecture de l'état du partage (sans la clé ni la requête de suivi).
  await expect.poll(() => api.map((u) => new URL(u).pathname + new URL(u).search)).toEqual(["/api/shares/meta"]);
});

test.describe("navigateur intégré (Facebook) avec ?fbclid=", () => {
  test.use({ userAgent: INSTAGRAM.replace(/Instagram .*$/, "[FBAN/FBIOS;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/17.1]") });

  test("rien n'est retiré (S4), même avec un fragment invalide ou sur une route 404", async ({ page, shh }) => {
    for (const [path, frag] of [
      ["/?fbclid=x", `#${KEY}`],
      ["/?fbclid=x", `#m${KEY}`],
      ["/", `#${KEY}.`],
      ["/inconnu", `#${KEY}`],
    ] as const) {
      await page.goto(`${shh.origin}${path}${frag}`);
      await expect(page.locator("main#contenu")).toBeVisible();
      await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
      expect(page.url()).toBe(`${shh.origin}${path}${frag}`);
    }
  });
});

// m2 : la hauteur visible réduite de plus de 25 % n'est un clavier qu'avec un pointeur grossier.
test("kbd-open seulement sur écran tactile (pointer: coarse)", async ({ page, shh }) => {
  await page.goto(`${shh.origin}/`);
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  const size = page.viewportSize()!;
  await expect(page.locator("html")).not.toHaveClass(/kbd-open/);
  await page.setViewportSize({ width: size.width, height: Math.floor(size.height * 0.5) });
  if (coarse) await expect(page.locator("html")).toHaveClass(/kbd-open/);
  else {
    await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
    await expect(page.locator("html")).not.toHaveClass(/kbd-open/);
  }
  await page.setViewportSize(size);
  await expect(page.locator("html")).not.toHaveClass(/kbd-open/);
});

// Audit F3 : Permissions-Policy refuse ce qui ne sert pas ; le navigateur n'y signale aucune
// fonction inconnue, et la page ne peut plus lire le presse-papiers ni capturer l'écran.
test("Permissions-Policy : refus explicites reconnus, presse-papiers illisible, capture d'écran refusée", async ({ page, shh, browserName }) => {
  const policyMsgs: string[] = [];
  page.on("console", (m) => {
    if (/permissions.policy/i.test(m.text())) policyMsgs.push(m.text());
  });
  const resp = await page.goto(shh.origin + "/");
  expect(resp?.headers()["permissions-policy"]).toContain("clipboard-read=()");
  await expect(page.locator("main")).toBeVisible();
  if (browserName === "chromium") {
    const allowed = await page.evaluate(() => {
      const fp = (document as unknown as { featurePolicy?: { allowsFeature(f: string): boolean } }).featurePolicy;
      return fp && ["clipboard-read", "display-capture", "usb", "camera", "microphone", "clipboard-write"].map((f) => fp.allowsFeature(f));
    });
    expect(allowed).toEqual([false, false, false, true, true, true]);
  }
  expect(policyMsgs).toEqual([]);
});

test.describe("intégrité des scripts et des styles (spec §28.3)", () => {
  test("index.html porte une empreinte sur son script et sa feuille de style ; l'application se charge", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    await expect(page.locator("#app > *").first()).toBeVisible();
    const tags = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src], link[rel="stylesheet"]')].map((e) => e.integrity),
    );
    expect(tags.length).toBeGreaterThanOrEqual(2);
    for (const i of tags) expect(i).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
  });

  test("un script dont les octets ont changé en route est refusé par le navigateur : rien ne s'exécute", async ({ page, shh }) => {
    // Un seul octet ajouté au script servi (ce que ferait un intermédiaire ou un cache piégé).
    await page.route("**/assets/index-*.js", async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, body: Buffer.concat([await res.body(), Buffer.from("\n;window.__piege=1")]) });
    });
    await page.goto(shh.origin + "/");
    await page.waitForLoadState("load");
    expect(await page.evaluate(() => (window as unknown as { __piege?: number }).__piege)).toBeUndefined();
    await expect(page.locator("#app > *")).toHaveCount(0);
  });
});

test.describe("Argon2id à la demande, hors du fil principal (10 novembre ; moteur WebAssembly depuis la Task 11)", () => {
  // Task 11 : libsodium (assets/argon2-*.js) est supprimé ; Argon2id vient du moteur, dans un Worker
  // dont le script (assets/engine-kdf-*.js) est lu avec son empreinte. Même intention qu'avant.
  test("accueil : Argon2id n'est pas chargé ; à l'envoi : script du Worker vérifié lu une fois, calcul dans un Worker ; l'ouverture donne le même contenu", async ({ page, shh, browser }) => {
    test.setTimeout(120_000);
    const kdf: string[] = [];
    const workers: string[] = [];
    const watch = (p: Page) => {
      p.on("request", (r) => void (/\/assets\/engine-kdf-[^/]+\.js$/.test(r.url()) && kdf.push(r.url())));
      p.on("worker", (w) => workers.push(w.url()));
    };
    watch(page);
    await page.goto(shh.origin + "/");
    await expect(page.locator("main h1").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(kdf).toEqual([]);
    const s = await freshPage(browser);
    watch(s.page);
    const sent = await sendShare(s.page, shh.origin + "/", { text: "Argon2id dans un Worker" });
    await s.ctx.close();
    expect(kdf.length).toBe(1);
    expect(workers.filter((u) => u.startsWith("blob:")).length).toBe(1);
    await page.goto(sent.link);
    await unlock(page, sent.password);
    // unlock() a vu « Contenu » : la clé dérivée est la bonne (sinon, « mot de passe incorrect »).
    expect(workers.filter((u) => u.startsWith("blob:")).length).toBe(2);
  });

  test("repli : sans Worker depuis un Blob, le calcul se fait dans la page avec le moteur vérifié et l'ouverture marche", async ({ page, shh, browser }) => {
    test.setTimeout(120_000);
    const s = await freshPage(browser);
    const sent = await sendShare(s.page, shh.origin + "/", { text: "repli sans Worker" });
    await s.ctx.close();
    await page.addInitScript(() => {
      const Real = window.Worker;
      window.Worker = function (url: string | URL, o?: WorkerOptions) {
        if (String(url).startsWith("blob:")) throw new DOMException("refusé", "SecurityError");
        return new Real(url, o);
      } as unknown as typeof Worker;
    });
    const wasm: string[] = [];
    const workers: string[] = [];
    page.on("request", (r) => void (new URL(r.url()).pathname.endsWith(".wasm") && wasm.push(new URL(r.url()).pathname)));
    page.on("worker", (w) => workers.push(w.url()));
    await page.goto(sent.link);
    await unlock(page, sent.password);
    // unlock() a vu « Contenu » : la clé dérivée est la bonne (sinon, « mot de passe incorrect »).
    // Le moteur vérifié (un seul .wasm, lu avec son empreinte) a fait le calcul : aucun Worker,
    // aucun script ajouté à la page.
    expect(workers.filter((u) => u.startsWith("blob:"))).toEqual([]);
    expect(wasm).toHaveLength(1);
    expect(await page.evaluate(() => [...document.scripts].filter((x) => /argon2-|engine-kdf-/.test(x.src)).length)).toBe(0);
  });
});

test("vrai parcours d'ouverture (Task 11) : .wasm modifié d'un octet en route : aucun déchiffrement, message réseau ; Réessayer sans piège ouvre le partage", async ({ page, shh, browser, browserName }) => {
  test.skip(browserName !== "chromium", "chemin de production vérifié sous Chromium");
  test.setTimeout(120_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: "moteur modifié en route" });
  await s.ctx.close();
  let trapped = 0;
  const trap = async (route: import("@playwright/test").Route) => {
    const res = await route.fetch();
    const body = await res.body();
    body[body.length >> 1] ^= 1; // un seul bit d'un seul octet
    trapped++;
    await route.fulfill({ response: res, body });
  };
  await page.route("**/assets/engine-*.wasm", trap);
  const api: string[] = [];
  page.on("request", (r) => void (new URL(r.url()).pathname.startsWith("/api/") && api.push(new URL(r.url()).pathname)));
  await page.goto(sent.link);
  await expect(page.getByRole("heading", { name: "Vous êtes hors ligne." })).toBeVisible({ timeout: 30_000 });
  // Lu au moins une fois (l'écran peut relire le fichier, chaque lecture est refusée de même).
  expect(trapped).toBeGreaterThanOrEqual(1);
  // Le moteur refusé n'a rien dérivé : aucune requête au serveur (meta demande K_accès), rien d'ouvert.
  expect(api).toEqual([]);
  await expect(pwField(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Contenu", exact: true })).toHaveCount(0);
  await page.unroute("**/assets/engine-*.wasm", trap);
  await page.getByRole("button", { name: "Réessayer" }).click();
  // unlock() a vu « Contenu » : la clé dérivée est la bonne, le partage est ouvert.
  await unlock(page, sent.password);
  // Les refus du navigateur (empreinte) ne comptent pas comme des violations de la CSP du site.
  shh.cspViolations.length = 0;
});

test("Trusted Types (10 novembre) : une chaîne brute donnée à innerHTML ou à new Worker est refusée ; seules deux politiques existent", async ({ page, shh, browserName }) => {
  test.skip(browserName !== "chromium", "Trusted Types : vérifié sous Chromium (les autres moteurs l'appliquent selon leur version)");
  await page.goto(shh.origin + "/");
  await expect(page.locator("main h1").first()).toBeVisible();
  const r = await page.evaluate(() => {
    const tryIt = (f: () => void) => {
      try {
        f();
        return "accepté";
      } catch (e) {
        return (e as Error).name;
      }
    };
    const tt = (window as unknown as { trustedTypes: { createPolicy(n: string, r: object): unknown } }).trustedTypes;
    return {
      html: tryIt(() => void (document.createElement("div").innerHTML = "<img src=x onerror=alert(1)>")),
      worker: tryIt(() => void new Worker("/assets/x.js")),
      policy: tryIt(() => void tt.createPolicy("autre", { createHTML: (s: string) => s })),
    };
  });
  expect(r).toEqual({ html: "TypeError", worker: "TypeError", policy: "TypeError" });
  // Les refus ci-dessus sont voulus : ils ne comptent pas comme des violations du site.
  shh.cspViolations.length = 0;
});

// Moteur WebAssembly (spec moteur §7, Task 10) : chargement vérifié, éprouvé ici isolément (le site
// l'utilise depuis la Task 11, test précédent) : la page d'essai ui-e2e/engine-page/ (construite par global-setup.ts avec
// les greffons du site, jamais livrée) appelle loadEngine() et l'Argon2id du moteur, servie par le
// vrai serveur Go (CSP et Trusted Types de production) ou comme par GitHub Pages (démo).
const ENGINE_PAGE = fileURLToPath(new URL("./engine-page/dist", import.meta.url));
const ENGINE_PAGE_DEMO = fileURLToPath(new URL("./engine-page/dist-demo", import.meta.url));
const KDF = (JSON.parse(readFileSync(fileURLToPath(new URL("../../engine/vectors/v2.json", import.meta.url)), "utf8")).argon2id as { fn: string; salt: string; password: string; key: string }[]).find(
  (v) => v.fn === "passwordKeyForCreate" && v.password === "aC3!cD5?#Fg" && v.salt === "101112131415161718191a1b1c1d1e1f",
)!;

/** Requêtes de .wasm et du script du Worker, Workers créés et Workers arrêtés (événement close). */
function watchEngine(page: Page) {
  const seen = { wasm: [] as string[], script: [] as string[], workers: [] as string[], closed: 0 };
  page.on("request", (r) => {
    const p = new URL(r.url()).pathname;
    if (p.endsWith(".wasm")) seen.wasm.push(p);
    if (/\/assets\/engine-[^/]+\.js$/.test(p)) seen.script.push(p);
  });
  page.on("worker", (w) => {
    seen.workers.push(w.url());
    w.on("close", () => seen.closed++);
  });
  return seen;
}

const kdf = async (page: Page) => {
  await page.locator("#kdf").click();
  await expect(page.locator("#out")).not.toHaveText("…", { timeout: 60_000 });
  return page.locator("#out").textContent();
};

test.describe("moteur WebAssembly : chargement vérifié (spec moteur §7)", () => {
  test("accueil : aucun .wasm, aucun Worker", async ({ page, shh }) => {
    const seen = watchEngine(page);
    await page.goto(shh.origin + "/");
    await expect(page.locator("main h1").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(seen).toEqual({ wasm: [], script: [], workers: [], closed: 0 });
  });

  test.describe("page d'essai, serveur de production", () => {
    test.use({ shhServer: { env: { SHH_STATIC_DIR: ENGINE_PAGE } } });

    test("Argon2id dans un Worker blob: neuf par appel, arrêté après ; le .wasm et le script du Worker lus une fois", async ({ page, shh, browserName }) => {
      test.skip(browserName !== "chromium", "chemin de production vérifié sous Chromium");
      test.setTimeout(120_000);
      const seen = watchEngine(page);
      const wasmRes = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith(".wasm"));
      await page.goto(shh.origin + "/");
      expect(await kdf(page)).toBe(`cle ${KDF.key}`);
      // Le .wasm arrive en brotli (variante .br du build), sous son type et avec un cache d'un an
      // (nom à empreinte) : 141 Ko transférés au lieu de 481 Ko.
      const res = await wasmRes;
      const h = await res.allHeaders();
      expect({ encoding: h["content-encoding"], type: h["content-type"], cache: h["cache-control"] }).toEqual({
        encoding: "br",
        type: "application/wasm",
        cache: "public, max-age=31536000, immutable",
      });
      const sizes = await res.request().sizes();
      const raw = (await res.body()).length;
      console.info(`moteur .wasm : ${sizes.responseBodySize} octets transférés (br), ${raw} octets décodés`);
      expect(sizes.responseBodySize).toBeLessThan(raw / 2);
      expect(await kdf(page)).toBe(`cle ${KDF.key}`);
      expect(seen.wasm).toHaveLength(1);
      expect(seen.wasm[0]).toMatch(/^\/assets\/engine-[A-Za-z0-9_-]{8}\.wasm$/);
      expect(seen.script).toHaveLength(1);
      expect(seen.workers).toHaveLength(2);
      for (const u of seen.workers) expect(u.startsWith(`blob:${shh.origin}/`)).toBe(true);
      // Chaque Worker est arrêté après son calcul : ses 64 Mio sont rendus.
      await expect.poll(() => seen.closed).toBe(2);
    });

    test("un .wasm modifié d'un octet en route : refusé, erreur réseau, aucun moteur ni calcul ; un nouvel essai sans piège marche", async ({ page, shh, browserName }) => {
      test.skip(browserName !== "chromium", "chemin de production vérifié sous Chromium");
      test.setTimeout(120_000);
      const seen = watchEngine(page);
      const trap = async (route: import("@playwright/test").Route) => {
        const res = await route.fetch();
        const body = await res.body();
        body[body.length >> 1] ^= 1; // un seul bit d'un seul octet
        await route.fulfill({ response: res, body });
      };
      await page.route("**/assets/engine-*.wasm", trap);
      await page.goto(shh.origin + "/");
      expect(await kdf(page)).toBe("erreur reseau");
      expect(seen.workers).toEqual([]);
      expect(seen.script).toEqual([]);
      // Aucun moteur partiel gardé : l'essai suivant relit le fichier, cette fois intact.
      await page.unroute("**/assets/engine-*.wasm", trap);
      expect(await kdf(page)).toBe(`cle ${KDF.key}`);
      expect(seen.wasm).toHaveLength(2);
    });

    test("script du Worker modifié en route, ou Worker blob: impossible : il ne s'exécute pas ; calcul dans la page avec le moteur vérifié", async ({ page, shh, browserName }) => {
      test.skip(browserName !== "chromium", "chemin de production vérifié sous Chromium");
      test.setTimeout(120_000);
      const seen = watchEngine(page);
      await page.route("**/assets/engine-*.js", async (route) => {
        const res = await route.fetch();
        await route.fulfill({ response: res, body: Buffer.concat([await res.body(), Buffer.from("\n;self.__piege=1")]) });
      });
      await page.goto(shh.origin + "/");
      expect(await kdf(page)).toBe(`cle ${KDF.key}`);
      expect(seen.script).toHaveLength(1);
      expect(seen.workers).toEqual([]);
      await page.unrouteAll();
      await page.addInitScript(() => {
        const Real = window.Worker;
        window.Worker = function (url: string | URL, o?: WorkerOptions) {
          if (String(url).startsWith("blob:")) throw new DOMException("refusé", "SecurityError");
          return new Real(url, o);
        } as unknown as typeof Worker;
      });
      await page.reload();
      expect(await kdf(page)).toBe(`cle ${KDF.key}`);
      expect(seen.workers).toEqual([]);
    });
  });

  test("démo (GitHub Pages, connect-src 'none') : moteur intégré au script, aucun .wasm lu, Argon2id dans la page", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "vérifié sous Chromium");
    test.setTimeout(120_000);
    const refused: string[] = [];
    page.on("console", (m) => void (m.text().includes("Refused to") && refused.push(m.text())));
    const pages = await startPagesServer(ENGINE_PAGE_DEMO);
    try {
      const seen = watchEngine(page);
      await page.goto(`${pages.origin}/shhdrop/`);
      expect(await kdf(page)).toBe(`cle ${KDF.key}`);
      expect(seen).toEqual({ wasm: [], script: [], workers: [], closed: 0 });
      expect(refused).toEqual([]);
    } finally {
      await pages.close();
    }
  });
});
