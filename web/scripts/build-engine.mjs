// Construit les deux modules WebAssembly et leur colle JavaScript, chacun dans son pkg/ (ignoré
// par git, refait à chaque build) :
//   - le moteur des partages (engine/wasm, crate shhdrop-wasm) dans web/src/engine/pkg/ ;
//   - le moteur du salon (engine/salon-wasm, crate shhdrop-salon-wasm, Task 9 du salon) dans
//     web/src/salon/pkg/ : module à part, que seules les pages du salon chargent.
// Pour chacun :
//   1. cargo build --profile <profil> --target wasm32-unknown-unknown -p <crate> --locked
//      (chaîne d'outils épinglée par engine/rust-toolchain.toml, dépendances par Cargo.lock ;
//      profil release pour les partages, wasm-salon, optimisé pour la taille, pour le salon :
//      engine/Cargo.toml) ;
//      une commande cargo par crate : leurs fonctionnalités ne s'unifient pas entre elles (le
//      .wasm des partages reste celui qu'il était sans le salon) ;
//   2. wasm-bindgen --target web (sans les sections « name » et « producers » : 70 Ko de noms
//      de fonctions inutiles au site), version exacte 0.2.130 (celle de la crate wasm-bindgen,
//      installée par `cargo install wasm-bindgen-cli --version 0.2.130 --locked`).
//      `--experimental-reset-state-function` : __wbg_reset_state() refait une instance neuve du
//      même module après une panique (spec moteur §7 ; web/src/engine/index.ts, web/src/salon/engine.ts).
// Les chemins de ~/.cargo (sources des crates, cités par les messages de panique) sont réécrits
// en /cargo : le .wasm ne porte ni le dossier personnel de qui le construit, ni rien qui change
// d'une machine à l'autre (build reproductible, web/scripts/repro.sh). L'option passe par
// CARGO_ENCODED_RUSTFLAGS (options séparées par 0x1f) : un CARGO_HOME qui contient une espace
// reste une seule option, alors que RUSTFLAGS couperait le chemin en deux.
// Refusés s'ils sont hérités de l'environnement : RUSTFLAGS et CARGO_ENCODED_RUSTFLAGS, qui
// changeraient le .wasm sans laisser de trace ; CARGO_TARGET_DIR et CARGO_BUILD_TARGET_DIR, qui
// feraient passer à wasm-bindgen un ancien .wasm resté dans engine/target.
//
// SHH_ENGINE_PREBUILT=1 : pkg/ a déjà été construit par la même commande dans une autre étape
// (image Docker : étape Rust, deploy/Dockerfile) ; le script vérifie seulement sa présence. Le
// module du salon n'y est pas encore (aucune page du site ne l'importe) : quand une page
// l'importera, le build échouera sans lui (import introuvable) tant que deploy/Dockerfile ne le
// construit pas.
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

/** Crate, nom de sortie, dossier pkg/ et options propres de wasm-bindgen. */
const MODULES = [
  { crate: "shhdrop-wasm", profile: "release", name: "shhdrop_wasm", out, extra: ["--experimental-reset-state-function"] },
  { crate: "shhdrop-salon-wasm", profile: "wasm-salon", name: "shhdrop_salon_wasm", out: join(web, "src", "salon", "pkg"), extra: ["--experimental-reset-state-function"] },
];

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
for (const name of ["RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "CARGO_TARGET_DIR", "CARGO_BUILD_TARGET_DIR"]) {
  if (process.env[name] !== undefined) {
    throw new Error(`${name} est défini (« ${process.env[name]} ») : le build du moteur n'accepte ni option de rustc ni dossier de sortie hérités (build reproductible)`);
  }
}
const cargoHome = process.env.CARGO_HOME || join(homedir(), ".cargo");
for (const m of MODULES) {
  run("cargo", ["build", "--profile", m.profile, "--target", "wasm32-unknown-unknown", "-p", m.crate, "--locked"], engine, {
    ...process.env,
    CARGO_ENCODED_RUSTFLAGS: `--remap-path-prefix=${cargoHome}=/cargo`,
  });
  rmSync(m.out, { recursive: true, force: true });
  run(
    "wasm-bindgen",
    ["--target", "web", "--remove-name-section", "--remove-producers-section", ...m.extra, "--out-dir", m.out, "--out-name", m.name, join(engine, "target", "wasm32-unknown-unknown", m.profile, `${m.name}.wasm`)],
    engine,
  );
}
