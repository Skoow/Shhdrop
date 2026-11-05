// Construit le binaire Go, le site (web/dist) et la démo (web/dist-demo) une fois avant tous les tests.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const webDir = fileURLToPath(new URL("..", import.meta.url));
const serverDir = fileURLToPath(new URL("../../server", import.meta.url));

export default function globalSetup(): void {
  execFileSync("go", ["build", "-o", "shhdrop", "./cmd/shhdrop"], { cwd: serverDir, stdio: "inherit" });
  execFileSync("npm", ["run", "build"], { cwd: webDir, stdio: "inherit" });
  execFileSync("npm", ["run", "build:demo"], { cwd: webDir, stdio: "inherit" });
}
