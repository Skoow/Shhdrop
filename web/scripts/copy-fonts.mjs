// Copie les polices depuis les paquets Fontsource (devDependencies) vers src/assets/fonts/ (Vite les écrit sous /assets/ avec une empreinte),
// en vérifiant l'empreinte SHA-256 de UI §4.1. Les fichiers copiés sont commités ;
// aucune police n'est chargée depuis un CDN.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = dirname(dirname(fileURLToPath(import.meta.url)));

const FONTS = [
  {
    pkg: "@fontsource-variable/mona-sans",
    file: "mona-sans-latin-standard-normal.woff2",
    sha256: "5ea3740633e5ac7af56c13d7e8ec32bcae12e7723e53d34284469a8947ccb2f3",
  },
  {
    pkg: "@fontsource-variable/jetbrains-mono",
    file: "jetbrains-mono-latin-wght-normal.woff2",
    sha256: "18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e",
  },
];

const out = join(webDir, "src", "assets", "fonts");
mkdirSync(out, { recursive: true });
for (const f of FONTS) {
  const src = join(webDir, "node_modules", f.pkg, "files", f.file);
  const got = createHash("sha256").update(readFileSync(src)).digest("hex");
  if (got !== f.sha256) throw new Error(`${f.file} : empreinte ${got} différente de ${f.sha256}`);
  copyFileSync(src, join(out, f.file));
  console.log(`copié ${f.file}`);
}
