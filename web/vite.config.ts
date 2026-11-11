import { svelte } from "@sveltejs/vite-plugin-svelte";
import { execFileSync } from "node:child_process";
import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build, defineConfig, type Plugin } from "vite";
import { DEMO_BASE, DEMO_META } from "./scripts/demo-meta.mjs";
import { addSri, sha384 } from "./scripts/sri.mjs";

/**
 * Production : le build échoue si un module de src/demo/ entre dans le bundle (A41 : un faux
 * serveur qui remplace fetch serait une porte dérobée). Seconde garde : scripts/check-dist.mjs.
 */
export function demoGuard(): Plugin {
  return {
    name: "shh-demo-guard",
    apply: "build",
    generateBundle(_, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== "chunk") continue;
        const bad = Object.keys(out.modules).filter((id) => id.replace(/\\/g, "/").includes("/src/demo/"));
        if (bad.length > 0) this.error(`code de démo dans le build de production : ${bad.join(", ")}`);
      }
    },
  };
}

/**
 * Intégrité des sous-ressources (spec §28.3) : une empreinte SHA-384 sur chaque script et
 * feuille de style de index.html, calculée sur les fichiers écrits. Le navigateur refuse
 * alors tout script ou style dont les octets ne correspondent pas ; l'empreinte de
 * index.html fixe tout ce qu'il charge. Contrôle : scripts/check-dist.mjs. À placer avant
 * demoMeta (qui copie index.html en 404.html) ; precompress passe après (closeBundle).
 */
export function sri(base: string): Plugin {
  let outDir = "";
  return {
    name: "shh-sri",
    apply: "build",
    configResolved(c) {
      outDir = join(c.root, c.build.outDir);
    },
    writeBundle() {
      const page = join(outDir, "index.html");
      const read = (rel: string) => {
        try {
          return readFileSync(join(outDir, rel));
        } catch {
          return null;
        }
      };
      writeFileSync(page, addSri(readFileSync(page, "utf8"), read, base));
    },
  };
}

/**
 * Colle de wasm-bindgen : sans argument, son initialisation lirait le .wasm voisin
 * (`new URL('shhdrop_wasm_bg.wasm', import.meta.url)`), que Vite émettrait ou intégrerait sans
 * empreinte. Nos appels donnent toujours le module compilé : ce chemin est remplacé par une
 * erreur. Le build échoue si la colle change de forme (contrôle : scripts/check-dist.mjs).
 */
export function engineGlue(): Plugin {
  const DEFAULT = "new URL('shhdrop_wasm_bg.wasm', import.meta.url)";
  return {
    name: "shh-engine-glue",
    enforce: "pre",
    transform(code, id) {
      if (!id.replace(/\\/g, "/").endsWith("/src/engine/pkg/shhdrop_wasm.js")) return null;
      if (code.split(DEFAULT).length !== 2) this.error("shh-engine : colle de wasm-bindgen inattendue (chemin par défaut du .wasm)");
      return { code: code.replace(DEFAULT, '(() => { throw new Error("moteur_sans_source"); })()'), map: null };
    },
  };
}

/**
 * Moteur WebAssembly (spec moteur §7). ./source, importé par un module de src/engine/, est
 * remplacé par source.verified.ts (production) ou source.demo.ts (démo) ; tout autre chemin
 * vers src/engine/source.ts arrête le build (le .wasm y serait lu sans empreinte).
 * Production : le .wasm est écrit sous assets/engine-EMPREINTE.wasm, le script du Worker
 * d'Argon2id (argon2.worker.ts et la colle, construit à part en script classique) sous
 * assets/engine-kdf-EMPREINTE.js ; adresses et empreintes SHA-384 dans le module virtuel
 * virtual:shh-engine, donc dans le script principal, jamais les octets du .wasm.
 * Démo : sa CSP (connect-src 'none') interdit de lire un fichier : le module virtuel contient
 * le .wasm en base64, couvert par l'empreinte de index.html ; aucun fichier émis.
 */
export function engineWasm(base: string, demo: boolean): Plugin {
  const VIRTUAL = "virtual:shh-engine";
  const here = fileURLToPath(new URL(".", import.meta.url));
  const name = (prefix: string, data: Buffer, ext: string) => `assets/${prefix}-${createHash("sha256").update(data).digest("base64url").slice(0, 8)}.${ext}`;
  let code = "";
  return {
    ...engineGlue(),
    name: "shh-engine",
    apply: "build",
    enforce: "pre", // avant la résolution de Vite, pour remplacer ./source
    async buildStart() {
      const wasm = readFileSync(join(here, "src/engine/pkg/shhdrop_wasm_bg.wasm"));
      if (demo) {
        code = `export const wasm = ${JSON.stringify(wasm.toString("base64"))};`;
        return;
      }
      const out = await build({
        configFile: false,
        root: here,
        logLevel: "warn",
        plugins: [engineGlue()],
        build: { write: false, sourcemap: false, lib: { entry: join(here, "src/engine/argon2.worker.ts"), name: "shhEngineKdf", formats: ["iife"], fileName: () => "kdf.js" } },
      });
      const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ("output" in o ? o.output : []));
      const chunk = outputs.find((c) => c.type === "chunk");
      if (!chunk || chunk.type !== "chunk" || outputs.length !== 1) throw new Error("shh-engine : build du Worker inattendu");
      const worker = Buffer.from(chunk.code);
      const wasmName = name("engine", wasm, "wasm");
      const workerName = name("engine-kdf", worker, "js");
      this.emitFile({ type: "asset", fileName: wasmName, source: wasm });
      this.emitFile({ type: "asset", fileName: workerName, source: worker });
      const meta = { src: base + wasmName, integrity: sha384(wasm), workerSrc: base + workerName, workerIntegrity: sha384(worker) };
      code = Object.entries(meta)
        .map(([k, v]) => `export const ${k} = ${JSON.stringify(v)};`)
        .join(" ");
    },
    resolveId(source, importer) {
      if (source === VIRTUAL) return "\0" + VIRTUAL;
      const from = importer?.replace(/\\/g, "/") ?? "";
      if (/^\.\/source(?:\.ts)?$/.test(source) && from.includes("/src/engine/")) return join(here, demo ? "src/engine/source.demo.ts" : "src/engine/source.verified.ts");
      return null;
    },
    load(id) {
      if (id.replace(/\\/g, "/").endsWith("/src/engine/source.ts")) this.error(`shh-engine : src/engine/source.ts (lecture sans empreinte) n'entre jamais dans un build`);
      return id === "\0" + VIRTUAL ? code : null;
    },
  };
}

/** Démo : CSP, referrer et robots en tête de <head> ; index.html copié en 404.html (Pages). */
export function demoMeta(): Plugin {
  let outDir = "";
  return {
    name: "shh-demo-meta",
    apply: "build",
    configResolved(c) {
      outDir = join(c.root, c.build.outDir);
    },
    transformIndexHtml: {
      order: "post",
      handler: () => DEMO_META.map((attrs) => ({ tag: "meta", attrs, injectTo: "head-prepend" as const })),
    },
    // GitHub Pages n'a pas de repli monopage : une adresse profonde reçoit 404.html.
    writeBundle() {
      copyFileSync(join(outDir, "index.html"), join(outDir, "404.html"));
    },
  };
}

/**
 * Version du site affichée dans le pied de page (retours UI5) : hash court du commit, sans
 * secret. SHH_BUILD_ID (CI, image Docker) sinon `git rev-parse --short=7 HEAD` ; 7 à 40 chiffres
 * hexadécimaux, ramenés à 7. Même commit, même valeur : la construction reste reproductible
 * (spec §28).
 * Build (`vite build`, production comme démo) : sans identifiant valide, le build ÉCHOUE (audit du
 * 11 novembre, I6 : une image marquée « dev » ne pourrait jamais correspondre au build public).
 * « dev » seulement pour `vite dev` et les tests (command « serve »).
 */
export function buildId(command: "build" | "serve"): string {
  let id = process.env.SHH_BUILD_ID ?? "";
  if (id === "") {
    try {
      id = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      id = "";
    }
  }
  if (/^[0-9a-f]{7,40}$/.test(id)) return id.slice(0, 7);
  if (command === "serve") return "dev";
  throw new Error(
    `identifiant de build absent ou invalide (« ${id} ») : donner SHH_BUILD_ID=$(git rev-parse --short=7 HEAD), 7 à 40 chiffres hexadécimaux minuscules, ou construire depuis un dépôt git`,
  );
}

/** Types précompressés : texte, et le moteur WebAssembly (spec moteur §7 ; les images et polices le
 * sont déjà) ; mêmes extensions que static.go. */
export const COMPRESSIBLE = /\.(js|css|html|svg|webmanifest|xml|txt|wasm)$/;

/**
 * Vitesse (retours CLEAN2) : à côté de chaque fichier texte (ou .wasm) de plus de 1 Kio, une variante
 * brotli (.br, qualité 11) et gzip (.gz, niveau 9, sans date : reproductible), servies par le
 * serveur Go selon Accept-Encoding. Les octets décompressés sont identiques (SRI inchangée ;
 * contrôle : scripts/check-dist.mjs). Production seulement (GitHub Pages compresse la démo).
 */
export function precompress(): Plugin {
  let outDir = "";
  return {
    name: "shh-precompress",
    apply: "build",
    configResolved(c) {
      outDir = join(c.root, c.build.outDir);
    },
    closeBundle() {
      const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
      for (const f of walk(outDir)) {
        if (!COMPRESSIBLE.test(f)) continue;
        const data = readFileSync(f);
        if (data.length < 1024) continue;
        writeFileSync(f + ".br", brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }));
        writeFileSync(f + ".gz", gzipSync(data, { level: 9 }));
      }
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const demo = mode === "demo";
  return {
    plugins: [svelte(), sri(demo ? DEMO_BASE : "/"), engineWasm(demo ? DEMO_BASE : "/", demo), ...(demo ? [demoMeta()] : [demoGuard(), precompress()])],
    base: demo ? DEMO_BASE : "/",
    define: { __SHH_BUILD__: JSON.stringify(buildId(command)) },
    build: {
      outDir: demo ? "dist-demo" : "dist",
      assetsInlineLimit: 0,
      modulePreload: { polyfill: false },
      sourcemap: false,
    },
  };
});
