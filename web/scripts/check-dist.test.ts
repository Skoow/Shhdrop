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

  it("Argon2id hors du script principal (10 novembre) : libsodium absent de index-*.js ; son fichier porte l'empreinte inscrite dans le script", () => {
    const argon = "self.__shhArgon2id=1";
    const main = (extra: string) => `const a="/assets/argon2-AbCd1234.js";${extra}`;
    expect(checkDist(site({ "index.html": PROD_INDEX, "assets/index-a.js": "x.crypto_pwhash(1)" }), false)).toEqual([
      "assets/index-a.js : libsodium (crypto_pwhash) dans le script principal : il doit rester dans assets/argon2-*.js",
    ]);
    expect(checkDist(site({ "index.html": PROD_INDEX, "assets/index-a.js": main("") }), false)).toEqual(["assets/argon2-AbCd1234.js : cité par le script principal, absent du site"]);
    expect(checkDist(site({ "index.html": PROD_INDEX, "assets/index-a.js": main(""), "assets/argon2-AbCd1234.js": argon }), false)).toEqual([
      "assets/argon2-AbCd1234.js : son empreinte SHA-384 n'est pas inscrite dans le script principal (chargement sans contrôle d'intégrité)",
    ]);
    expect(checkDist(site({ "index.html": PROD_INDEX, "assets/index-a.js": main(`const i="${sha384(Buffer.from(argon))}"`), "assets/argon2-AbCd1234.js": argon }), false)).toEqual([]);
  });

  it("moteur WebAssembly (spec moteur §7) : tout .wasm cité par le script principal existe et porte son empreinte, comme le script du Worker", () => {
    // Octets d'un module WebAssembly vide (magie « \0asm », version 1), écrits sans échappement.
    const wasm = String.fromCharCode(0, 97, 115, 109, 1, 0, 0, 0);
    const prod = (main: string, extra: Record<string, string> = {}) => checkDist(site({ "index.html": PROD_INDEX, "assets/index-a.js": main, ...extra }), false);
    const cite = 'const s="/assets/engine-AbCd1234.wasm";';
    expect(prod(cite)).toEqual(["assets/engine-AbCd1234.wasm : cité par le script principal, absent du site"]);
    expect(prod(cite, { "assets/engine-AbCd1234.wasm": wasm })).toEqual([
      "assets/engine-AbCd1234.wasm : son empreinte SHA-384 n'est pas inscrite dans le script principal (chargement sans contrôle d'intégrité)",
    ]);
    expect(prod(cite + `const i="${sha384(Buffer.from(wasm, "latin1"))}";`, { "assets/engine-AbCd1234.wasm": wasm })).toEqual([]);
    // Cité deux fois : un seul signalement.
    expect(prod(cite + cite, { "assets/engine-AbCd1234.wasm": wasm })).toHaveLength(1);
    // N'importe quel .wasm (un fichier émis par Vite sans notre greffon, par exemple).
    expect(prod('const s="/assets/shhdrop_wasm_bg-Zz9.wasm";', { "assets/shhdrop_wasm_bg-Zz9.wasm": wasm })).toEqual([
      "assets/shhdrop_wasm_bg-Zz9.wasm : son empreinte SHA-384 n'est pas inscrite dans le script principal (chargement sans contrôle d'intégrité)",
    ]);
    // Script du Worker d'Argon2id du moteur : même règle.
    const w = "self.onmessage=1";
    expect(prod('const w="/assets/engine-kdf-AbCd1234.js";', { "assets/engine-kdf-AbCd1234.js": w })).toEqual([
      "assets/engine-kdf-AbCd1234.js : son empreinte SHA-384 n'est pas inscrite dans le script principal (chargement sans contrôle d'intégrité)",
    ]);
    expect(prod(`const w="/assets/engine-kdf-AbCd1234.js";const i="${sha384(Buffer.from(w))}";`, { "assets/engine-kdf-AbCd1234.js": w })).toEqual([]);
  });

  it("moteur WebAssembly : aucun octet de .wasm en ligne dans le script principal de production (base64 ou tableau)", () => {
    const msg = "assets/index-a.js : octets WebAssembly en ligne dans le script principal : le moteur doit rester dans assets/engine-*.wasm, lu avec son empreinte";
    const b64 = Buffer.from(String.fromCharCode(0, 97, 115, 109, 1, 0, 0, 0, 1, 2, 3), "latin1").toString("base64");
    expect(b64.startsWith("AGFzbQEAAAA")).toBe(true);
    const prod = (main: string) => checkDist(site({ "index.html": PROD_INDEX, "assets/index-a.js": main }), false);
    expect(prod(`const w="${b64}"`)).toEqual([msg]);
    expect(prod(`const w="data:application/wasm;base64,${b64}"`)).toEqual([msg]);
    expect(prod("const w=new Uint8Array([0,97,115,109,1,0,0,0,1])")).toEqual([msg]);
    expect(prod("const w=new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])")).toEqual([msg]);
    // Un texte ordinaire qui contient « asm » passe.
    expect(prod('const s="wasm-unsafe-eval asm.js"')).toEqual([]);
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

  it("moteur WebAssembly intégré au script (connect-src 'none') : aucun fichier .wasm dans la démo", () => {
    expect(checkDist(site({ ...good(), "assets/engine-AbCd1234.wasm": "x" }), true)).toEqual([
      "assets/engine-AbCd1234.wasm : fichier .wasm dans la démo : sa CSP (connect-src 'none') interdit de le lire, le moteur doit être intégré au script",
    ]);
  });

  it("échoue si une ressource est hors de la base /shhdrop/", () => {
    const h = DEMO_INDEX.replace("/shhdrop/assets/", "/assets/");
    expect(checkDist(site({ ...good(), "index.html": h, "404.html": h }), true)).toEqual([
      "index.html : « /assets/index-a.js » hors de la base /shhdrop/",
    ]);
  });
});
