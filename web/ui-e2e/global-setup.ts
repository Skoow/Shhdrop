// Construit le binaire Go, le site (web/dist), la démo (web/dist-demo), la page d'essai du
// moteur (ui-e2e/engine-page) et celle du salon (ui-e2e/salon-page) une fois avant tous les tests.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const webDir = fileURLToPath(new URL("..", import.meta.url));
const serverDir = fileURLToPath(new URL("../../server", import.meta.url));

export default function globalSetup(): void {
  execFileSync("go", ["build", "-o", "shhdrop", "./cmd/shhdrop"], { cwd: serverDir, stdio: "inherit" });
  // Binaire de test (attente après « je pars » réglable, D41-28) : jamais livré.
  execFileSync("go", ["build", "-tags", "e2etime", "-o", "shhdrop-e2etime", "./cmd/shhdrop"], { cwd: serverDir, stdio: "inherit" });
  execFileSync("npm", ["run", "build"], { cwd: webDir, stdio: "inherit" });
  execFileSync("npm", ["run", "build:demo"], { cwd: webDir, stdio: "inherit" });
  // Page d'essai du moteur (hygiene.spec.ts), jamais livrée : production puis démo. Celle de
  // production doit passer check-dist comme le site : son script principal cite vraiment le
  // .wasm et le script du Worker, avec leurs empreintes (la démo d'essai n'a pas la marque de
  // démo du site : son absence de .wasm est vérifiée par hygiene.spec.ts).
  const config = "ui-e2e/engine-page/vite.config.ts";
  execFileSync("npx", ["vite", "build", "-c", config], { cwd: webDir, stdio: "inherit" });
  execFileSync(process.execPath, ["scripts/check-dist.mjs", "ui-e2e/engine-page/dist"], { cwd: webDir, stdio: "inherit" });
  execFileSync("npx", ["vite", "build", "-c", config, "--mode", "demo"], { cwd: webDir, stdio: "inherit" });
  // Page d'essai du module du salon (salon-moteur.spec.ts), jamais livrée : son script cite
  // assets/salon-EMPREINTE.wasm avec son empreinte ; check-dist en vérifie aussi le poids brotli.
  execFileSync("npx", ["vite", "build", "-c", "ui-e2e/salon-page/vite.config.ts"], { cwd: webDir, stdio: "inherit" });
  execFileSync(process.execPath, ["scripts/check-dist.mjs", "ui-e2e/salon-page/dist"], { cwd: webDir, stdio: "inherit" });
}
