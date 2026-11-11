// Construit le moteur WebAssembly (engine/wasm, crate shhdrop-wasm) et sa colle JavaScript dans
// web/src/engine/pkg/ (ignoré par git, refait à chaque build) :
//   1. cargo build --release --target wasm32-unknown-unknown -p shhdrop-wasm --locked
//      (chaîne d'outils épinglée par engine/rust-toolchain.toml, dépendances par Cargo.lock) ;
//   2. wasm-bindgen --target web (sans les sections « name » et « producers » : 70 Ko de noms
//      de fonctions inutiles au site), version exacte 0.2.130 (celle de la crate wasm-bindgen,
//      installée par `cargo install wasm-bindgen-cli --version 0.2.130 --locked`).
// Les chemins de ~/.cargo (sources des crates, cités par les messages de panique) sont réécrits
// en /cargo : le .wasm ne porte ni le dossier personnel de qui le construit, ni rien qui change
// d'une machine à l'autre (build reproductible, web/scripts/repro.sh).
//
// SHH_ENGINE_PREBUILT=1 : pkg/ a déjà été construit par la même commande dans une autre étape
// (image Docker : étape Rust, deploy/Dockerfile) ; le script vérifie seulement sa présence.
//
// Usage : node scripts/build-engine.mjs (npm run build:engine).
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WASM_BINDGEN = "0.2.130";
const web = dirname(dirname(fileURLToPath(import.meta.url)));
const engine = join(web, "..", "engine");
const out = join(web, "src", "engine", "pkg");

const FILES = ["shhdrop_wasm.js", "shhdrop_wasm.d.ts", "shhdrop_wasm_bg.wasm", "shhdrop_wasm_bg.wasm.d.ts"];

function run(cmd, args, cwd, env = process.env) {
  execFileSync(cmd, args, { cwd, env, stdio: ["ignore", "inherit", "inherit"] });
}

if (process.env.SHH_ENGINE_PREBUILT === "1") {
  const missing = FILES.filter((f) => !existsSync(join(out, f)));
  if (missing.length) throw new Error(`SHH_ENGINE_PREBUILT=1 mais pkg/ incomplet : ${missing.join(", ")}`);
  console.log("build-engine : moteur déjà construit (SHH_ENGINE_PREBUILT=1)");
  process.exit(0);
}

const version = execFileSync("wasm-bindgen", ["--version"], { encoding: "utf8" }).trim();
if (version !== `wasm-bindgen ${WASM_BINDGEN}`) {
  throw new Error(`wasm-bindgen ${WASM_BINDGEN} attendu, trouvé « ${version} » : cargo install wasm-bindgen-cli --version ${WASM_BINDGEN} --locked`);
}
const cargoHome = process.env.CARGO_HOME || join(homedir(), ".cargo");
const rustflags = [process.env.RUSTFLAGS, `--remap-path-prefix=${cargoHome}=/cargo`].filter(Boolean).join(" ");
run("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown", "-p", "shhdrop-wasm", "--locked"], engine, { ...process.env, RUSTFLAGS: rustflags });
rmSync(out, { recursive: true, force: true });
run(
  "wasm-bindgen",
  ["--target", "web", "--remove-name-section", "--remove-producers-section", "--out-dir", out, "--out-name", "shhdrop_wasm", join(engine, "target", "wasm32-unknown-unknown", "release", "shhdrop_wasm.wasm")],
  engine,
);
