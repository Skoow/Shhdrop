// Construit le moteur WebAssembly (engine/wasm, crate shhdrop-wasm) et sa colle JavaScript dans
// web/src/engine/pkg/ (ignoré par git, refait à chaque build) :
//   1. cargo build --release --target wasm32-unknown-unknown -p shhdrop-wasm --locked
//      (chaîne d'outils épinglée par engine/rust-toolchain.toml, dépendances par Cargo.lock) ;
//   2. wasm-bindgen --target web (sans les sections « name » et « producers » : 70 Ko de noms
//      de fonctions inutiles au site), version exacte 0.2.130 (celle de la crate wasm-bindgen,
//      installée par `cargo install wasm-bindgen-cli --version 0.2.130 --locked`).
// Usage : node scripts/build-engine.mjs (npm run build:engine).
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WASM_BINDGEN = "0.2.130";
const web = dirname(dirname(fileURLToPath(import.meta.url)));
const engine = join(web, "..", "engine");
const out = join(web, "src", "engine", "pkg");

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: ["ignore", "inherit", "inherit"] });
}

const version = execFileSync("wasm-bindgen", ["--version"], { encoding: "utf8" }).trim();
if (version !== `wasm-bindgen ${WASM_BINDGEN}`) {
  throw new Error(`wasm-bindgen ${WASM_BINDGEN} attendu, trouvé « ${version} » : cargo install wasm-bindgen-cli --version ${WASM_BINDGEN} --locked`);
}
run("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown", "-p", "shhdrop-wasm", "--locked"], engine);
rmSync(out, { recursive: true, force: true });
run(
  "wasm-bindgen",
  ["--target", "web", "--remove-name-section", "--remove-producers-section", "--out-dir", out, "--out-name", "shhdrop_wasm", join(engine, "target", "wasm32-unknown-unknown", "release", "shhdrop_wasm.wasm")],
  engine,
);
