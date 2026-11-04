// Génère src/crypto/wordlist-eff.ts et src/crypto/blocklist.ts.
// Usage : node scripts/gen-lists.mjs
// Les sources sont vérifiées par nombre de lignes ET empreinte SHA-256 (épinglée ici).
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCES = {
  eff: {
    url: "https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt",
    sha256: "addd35536511597a02fa0a9ff1e5284677b8883b83e986e43f15a3db996b903e",
    lines: 7776,
  },
  seclists: {
    url: "https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/10k-most-common.txt",
    sha256: "68782d6a4a19a4768d5f15dd66bd534e7a33055cc755411e33f16d18c50fdcce",
    // Le fichier amont contient 10 001 lignes (et non 10 000) : valeur vérifiée à l'épinglage.
    lines: 10001,
  },
};

async function fetchPinned(src) {
  const res = await fetch(src.url);
  if (!res.ok) throw new Error(`Téléchargement échoué (${res.status}) : ${src.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const digest = createHash("sha256").update(buf).digest("hex");
  if (digest !== src.sha256) throw new Error(`Empreinte SHA-256 inattendue pour ${src.url} : ${digest}`);
  const lines = buf.toString("utf8").split("\n").filter((l) => l !== "");
  if (lines.length !== src.lines) throw new Error(`Nombre de lignes inattendu pour ${src.url} : ${lines.length}`);
  return lines;
}

const effLines = await fetchPinned(SOURCES.eff);
const words = effLines.map((l) => {
  const m = /^[1-6]{5}\t([a-z-]+)$/.exec(l);
  if (!m) throw new Error(`Ligne EFF invalide : ${JSON.stringify(l)}`);
  return m[1];
});
if (new Set(words).size !== 7776) throw new Error("Mots EFF en double");

const block = [...new Set((await fetchPinned(SOURCES.seclists)).map((l) => l.trim().normalize("NFC").toLowerCase()))]
  .filter((l) => l !== "")
  .sort();

const out = (name, header, body) =>
  writeFileSync(fileURLToPath(new URL(`../src/crypto/${name}`, import.meta.url)), header + body);
const hdr = (src) =>
  `// FICHIER GÉNÉRÉ par scripts/gen-lists.mjs — ne pas modifier à la main.\n// Source : ${src.url}\n// SHA-256 de la source : ${src.sha256}\n`;

out(
  "wordlist-eff.ts",
  hdr(SOURCES.eff) + "// Licence : CC-BY 3.0 (EFF), voir THIRD_PARTY_LICENSES.md\n",
  `export const WORDS: readonly string[] = ${JSON.stringify(words)};\n`,
);
out(
  "blocklist.ts",
  hdr(SOURCES.seclists) + "// Licence : MIT (SecLists), voir THIRD_PARTY_LICENSES.md\n",
  `export const BLOCKLIST: ReadonlySet<string> = new Set(${JSON.stringify(block)});\n`,
);
console.log(`${words.length} mots, ${block.length} entrées de liste noire`);
