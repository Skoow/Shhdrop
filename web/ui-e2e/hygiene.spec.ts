// Hygiène du lien (UI §12.1), navigateur intégré (S4), navigateur non pris en charge (UI §9.11),
// dépôt de fichier neutralisé hors du composeur (UI §9.2.2).
import type { Page } from "@playwright/test";
import { axe, capture, expect, test } from "./fixtures";
import { freshPage, goSecurity, sendShare, unlock } from "./open-helpers";

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

// Sécurité : lien du pied de page ; téléphone avec onglets (pied masqué) : onglet Réglages ;
// écrans sans onglets (destinataire, gestion) : Réglages de l'en-tête. Même feuille Réglages.

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

test.describe("Argon2id à la demande, hors du fil principal (10 novembre)", () => {
  test("accueil : libsodium n'est pas chargé ; à l'envoi : fichier vérifié lu une fois, calcul dans un Worker ; l'ouverture donne le même contenu", async ({ page, shh, browser }) => {
    test.setTimeout(120_000);
    const argon: string[] = [];
    const workers: string[] = [];
    const watch = (p: Page) => {
      p.on("request", (r) => void (/\/assets\/argon2-[^/]+\.js$/.test(r.url()) && argon.push(r.url())));
      p.on("worker", (w) => workers.push(w.url()));
    };
    watch(page);
    await page.goto(shh.origin + "/");
    await expect(page.locator("main h1").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(argon).toEqual([]);
    const s = await freshPage(browser);
    watch(s.page);
    const sent = await sendShare(s.page, shh.origin + "/", { text: "Argon2id dans un Worker" });
    await s.ctx.close();
    expect(argon.length).toBe(1);
    expect(workers.filter((u) => u.startsWith("blob:")).length).toBe(1);
    await page.goto(sent.link);
    await unlock(page, sent.password);
    // unlock() a vu « Contenu » : la clé dérivée est la bonne (sinon, « mot de passe incorrect »).
    expect(workers.filter((u) => u.startsWith("blob:")).length).toBe(2);
  });

  test("repli : sans Worker depuis un Blob, le même fichier vérifié est chargé dans la page et l'ouverture marche", async ({ page, shh, browser }) => {
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
    await page.goto(sent.link);
    await unlock(page, sent.password);
    // unlock() a vu « Contenu » : la clé dérivée est la bonne (sinon, « mot de passe incorrect »).
    expect(await page.evaluate(() => [...document.scripts].filter((x) => /argon2-/.test(x.src)).map((x) => x.integrity.slice(0, 7)))).toEqual(["sha384-"]);
  });
});
