// check-dist.mjs (UI §14.3, A41) : production sans trace de démo ; démo avec ses protections.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkDist } from "./check-dist.mjs";
import { addSri, sha384 } from "./sri.mjs";
import { DEMO_CSP } from "./demo-meta.mjs";

const SCRIPT = fileURLToPath(new URL("./check-dist.mjs", import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const esc = (s: string) => s.replace(/'/g, "&#39;");
const PROD_INDEX = `<!doctype html><html><head>\n<meta charset="utf-8" />\n<script type="module" crossorigin src="/assets/index-a.js"></script>\n</head><body></body></html>`;
const DEMO_INDEX = `<!doctype html><html><head>
    <meta http-equiv="Content-Security-Policy" content="${esc(DEMO_CSP)}">
    <meta name="referrer" content="no-referrer">
    <meta name="robots" content="noindex">
    <meta charset="utf-8" />
    <script type="module" crossorigin src="/shhdrop/assets/index-a.js"></script>
</head><body></body></html>`;

/** Site d'essai ; `sri` (défaut) : index.html reçoit les empreintes comme au build (spec §28.3). */
function site(input: Record<string, string>, sri = true): string {
  const d = mkdtempSync(join(tmpdir(), "check-dist-"));
  dirs.push(d);
  const files: Record<string, string> = { ...input };
  if (sri) files["assets/index-a.js"] ??= "console.info(1)"; // le script que chargent PROD_INDEX et DEMO_INDEX
  for (const page of ["index.html", "404.html"]) {
    if (!sri || files[page] === undefined) continue;
    const base = files[page]!.includes('"/shhdrop/') ? "/shhdrop/" : "/";
    try {
      files[page] = addSri(files[page]!, (rel: string) => (files[rel] === undefined ? null : Buffer.from(files[rel]!)), base);
    } catch {
      // ressource absente du site d'essai : la page reste telle quelle (le test porte sur autre chose)
    }
  }
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(d, name, ".."), { recursive: true });
    writeFileSync(join(d, name), text);
  }
  return d;
}

/** Lance le script comme en CI ; rend le code de sortie et stderr. */
function run(args: string[]): { code: number; err: string } {
  try {
    execFileSync(process.execPath, [SCRIPT, ...args], { stdio: "pipe" });
    return { code: 0, err: "" };
  } catch (e) {
    const x = e as { status: number; stderr: Buffer };
    return { code: x.status, err: x.stderr.toString() };
  }
}

describe("check-dist.mjs, production", () => {
  it("passe sans marque", () => {
    const d = site({ "index.html": PROD_INDEX, "assets/index-a.js": "console.info(1)" });
    expect(run([d])).toEqual({ code: 0, err: "" });
  });

  it("échoue si un fichier contient __SHH_DEMO__", () => {
    const d = site({ "index.html": PROD_INDEX, "assets/index-a.js": 'const MARK="__SHH_DEMO__"' });
    const r = run([d]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("assets/index-a.js : trace de démo « __SHH_DEMO__ »");
  });

  it("échoue sur la CSP meta, le texte du bandeau, la base de démo, 404.html", () => {
    expect(checkDist(site({ "index.html": DEMO_INDEX }), false).join("\n")).toMatch(/Content-Security-Policy[\s\S]*shhdrop\/assets\//);
    expect(checkDist(site({ "index.html": PROD_INDEX, "a.js": "Demo: nothing is sent, the link only works in this tab." }), false)).toHaveLength(1);
    expect(checkDist(site({ "index.html": PROD_INDEX, "a.js": "rien n'est envoyé, le lien ne marche que dans cet onglet" }), false)).toHaveLength(1);
    expect(checkDist(site({ "index.html": PROD_INDEX, "404.html": PROD_INDEX }), false)).toEqual(["404.html : propre à la démo"]);
  });

  it("échoue sur un import() dynamique dans un script (spec §28.3, audit F1) ; import.meta reste permis", () => {
    const d = site({
      "index.html": PROD_INDEX,
      "assets/index-a.js": "const u=import.meta.url;a(()=>import(`./QrCode-x.js`));b(()=>import ('./y.js'))",
      "assets/w.css": "a{content:'import('}",
    });
    const r = run([d]);
    expect(r.code).toBe(1);
    expect(r.err.trim().split("\n")).toEqual(["check-dist : assets/index-a.js : import() dynamique (2 fois), interdit en production"]);
    expect(run([site({ "index.html": PROD_INDEX, "assets/index-a.js": "const u=import.meta.url;x.reimport(1)" })])).toEqual({ code: 0, err: "" });
  });

  it("échoue sur une statistique ou un écouteur global d'erreurs (spec §35.1), démo comprise ; « scrollbar » passe", () => {
    const trap = { "assets/index-a.js": 'const s="x GTAG( y";navigator.sendBeacon(u);window.onerror = f', "assets/a.css": "::-webkit-scrollbar{}" };
    expect(checkDist(site({ "index.html": PROD_INDEX, ...trap }), false)).toEqual([
      "assets/index-a.js : statistique « gtag( » (spec §35.1)",
      "assets/index-a.js : statistique « sendbeacon » (spec §35.1)",
      "assets/index-a.js : écouteur global d'erreurs « window.onerror = » (spec §35.1)",
    ]);
    const demo = { "index.html": DEMO_INDEX, "404.html": DEMO_INDEX, "assets/install-a.js": 'const MARK="__SHH_DEMO__";gtag(1)' };
    expect(checkDist(site(demo), true)).toEqual(["assets/install-a.js : statistique « gtag( » (spec §35.1)"]);
  });

  it("SRI (spec §28.3) : échoue si un script ou une feuille de style n'a pas d'empreinte, ou une fausse ; passe avec la bonne", () => {
    const js = "console.info(1)";
    const page = (attrs: string) => `<!doctype html><html><head>\n<script type="module" crossorigin src="/assets/index-a.js"${attrs}></script>\n<link rel="stylesheet" crossorigin href="/assets/a.css">\n</head><body></body></html>`;
    const files = { "assets/index-a.js": js, "assets/a.css": "a{}" };
    const none = run([site({ "index.html": page(""), ...files }, false)]);
    expect(none.code).toBe(1);
    expect(none.err.trim().split("\n")).toEqual([
      "check-dist : index.html : /assets/index-a.js sans attribut integrity (spec §28.3)",
      "check-dist : index.html : /assets/a.css sans attribut integrity (spec §28.3)",
    ]);
    const wrong = run([site({ "index.html": page(` integrity="${sha384(Buffer.from("autre"))}"`), ...files }, false)]);
    expect(wrong.err).toContain("index.html : /assets/index-a.js : empreinte integrity différente du fichier");
    const good = addSri(page(""), (rel: string) => Buffer.from((files as Record<string, string>)[rel]!));
    expect(good).toContain(`src="/assets/index-a.js" integrity="${sha384(Buffer.from(js))}"`);
    expect(run([site({ "index.html": good, ...files }, false)])).toEqual({ code: 0, err: "" });
    // Fichier absent du site, script en ligne : refusés.
    expect(run([site({ "index.html": good }, false)]).err).toContain("index.html : /assets/index-a.js absent du site");
    expect(run([site({ "index.html": `<!doctype html><html><head><script>1</script></head></html>` }, false)]).err).toContain("index.html : script en ligne");
  });

  it("échoue si le build manque", () => {
    expect(run([join(tmpdir(), "absent-check-dist")]).code).toBe(1);
  });
});

describe("check-dist.mjs --demo", () => {
  const good = () => ({ "index.html": DEMO_INDEX, "404.html": DEMO_INDEX, "assets/install-a.js": 'const MARK="__SHH_DEMO__"' });

  it("passe avec la marque, les balises en tête de <head> et 404.html", () => {
    expect(run(["--demo", site(good())])).toEqual({ code: 0, err: "" });
  });

  it("échoue sans la marque", () => {
    const r = run(["--demo", site({ ...good(), "assets/install-a.js": "x" })]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("marque __SHH_DEMO__ absente");
  });

  it("échoue sans la CSP meta, avec une CSP différente ou si elle n'est pas en tête", () => {
    const noCsp = DEMO_INDEX.replace(/<meta http-equiv[^>]*>\s*/, "");
    expect(checkDist(site({ ...good(), "index.html": noCsp, "404.html": noCsp }), true)).toHaveLength(1);
    const weak = DEMO_INDEX.replace("object-src &#39;none&#39;", "object-src *");
    expect(checkDist(site({ ...good(), "index.html": weak, "404.html": weak }), true)).toHaveLength(1);
    const late = DEMO_INDEX.replace('<meta charset="utf-8" />', "").replace("<head>", '<head><meta charset="utf-8" />');
    expect(checkDist(site({ ...good(), "index.html": late, "404.html": late }), true)).toHaveLength(1);
  });

  it("échoue sans referrer ou robots", () => {
    for (const drop of [/<meta name="referrer"[^>]*>/, /<meta name="robots"[^>]*>/]) {
      const h = DEMO_INDEX.replace(drop, "");
      expect(checkDist(site({ ...good(), "index.html": h, "404.html": h }), true)).toHaveLength(1);
    }
  });

  it("échoue sans 404.html, ou s'il diffère de index.html", () => {
    const { "404.html": _, ...no404 } = good();
    expect(checkDist(site(no404), true)).toEqual(["404.html absent (adresses profondes sur Pages)"]);
    expect(checkDist(site({ ...good(), "404.html": "autre" }), true)).toEqual(["404.html différent de index.html"]);
  });

  it("échoue si une ressource est hors de la base /shhdrop/", () => {
    const h = DEMO_INDEX.replace("/shhdrop/assets/", "/assets/");
    expect(checkDist(site({ ...good(), "index.html": h, "404.html": h }), true)).toEqual([
      "index.html : « /assets/index-a.js » hors de la base /shhdrop/",
    ]);
  });
});
