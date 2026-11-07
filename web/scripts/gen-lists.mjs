// Génère src/crypto/wordlist-eff.ts et src/vault/blocklist.ts (listes du code du coffre, spec §27.2).
// Usage : node scripts/gen-lists.mjs (Node 22.18 ou plus : importe weakpw.ts en retirant les types)
// Les sources sont vérifiées par nombre de lignes ET empreinte SHA-256 (épinglée ici).
// Le résultat est commité : le build reste reproductible et hors ligne (spec §24, §28).
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cores, encodeCores, normalizeForList, weakReason } from "../src/vault/weakpw.ts";

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
  // Mots de passe les plus fréquents de Pwned Passwords, publiés par le NCSC (Royaume-Uni) ;
  // seules les 20 000 premières lignes (les plus fréquentes) sont gardées (taille du JS).
  ncsc: {
    url: "https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt",
    sha256: "c2e5696882c603b76bb67a47ee970897e5a76fc4c3f5547abe3d0ca340c576e0",
    lines: 99839, // une ligne vide dans le fichier amont
    keep: 20000,
  },
  // Richelieu : les 20 000 mots de passe français les plus courants (fuites publiques filtrées
  // sur des adresses .fr). Licence CC BY 4.0.
  richelieu: {
    url: "https://raw.githubusercontent.com/tarraschk/richelieu/master/french_passwords_top20000.txt",
    sha256: "094cda0b34492992f68c2aaca7a076f46184365f4c4e614698fec5bffc0dac98",
    lines: 20000,
  },
};
const PW_MIN_CHARS = 10; // = PASSCODE_MIN_CHARS de vault/passcode.ts (vérifié par passcode.test.ts)

async function fetchPinned(src) {
  const res = await fetch(src.url);
  if (!res.ok) throw new Error(`Téléchargement échoué (${res.status}) : ${src.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const digest = createHash("sha256").update(buf).digest("hex");
  if (digest !== src.sha256) throw new Error(`Empreinte SHA-256 inattendue pour ${src.url} : ${digest}`);
  const lines = buf.toString("utf8").split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l !== "");
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

// Toutes les entrées, de toutes les longueurs, donnent des cœurs de dictionnaire (motdepasse,
// soleil, iloveyou…) ; les entrées de 10 caractères ou plus que ni les règles de forme ni
// les cœurs ne refusent déjà restent dans la liste entière.
const entries = [
  ...(await fetchPinned(SOURCES.seclists)),
  ...(await fetchPinned(SOURCES.ncsc)).slice(0, SOURCES.ncsc.keep),
  ...(await fetchPinned(SOURCES.richelieu)),
]
  .map((l) => l.trim().normalize("NFC"))
  .filter((l) => l !== "");
const coreList = [...new Set(entries.flatMap((e) => cores(e)))].sort();
const coreSet = new Set(coreList);
const block = [
  ...new Set(
    entries
      .filter((e) => [...e].length >= PW_MIN_CHARS)
      .filter((e) => weakReason(e, { block: new Set(), cores: coreSet }) === null)
      .map(normalizeForList),
  ),
].sort();

const out = (name, header, body) =>
  writeFileSync(fileURLToPath(new URL(`../src/${name === "blocklist.ts" ? "vault" : "crypto"}/${name}`, import.meta.url)), header + body);
const hdr = (src) =>
  `// FICHIER GÉNÉRÉ par scripts/gen-lists.mjs — ne pas modifier à la main.\n// Source : ${src.url}\n// SHA-256 de la source : ${src.sha256}\n`;

out(
  "wordlist-eff.ts",
  hdr(SOURCES.eff) + "// Licence : CC-BY 3.0 (EFF), voir THIRD_PARTY_LICENSES.md\n",
  `export const WORDS: readonly string[] = ${JSON.stringify(words)};\n`,
);
const srcHdr = [SOURCES.seclists, SOURCES.ncsc, SOURCES.richelieu]
  .map((x) => `// Source : ${x.url}\n// SHA-256 de la source : ${x.sha256}${x.keep ? ` (${x.keep} premières lignes)` : ""}\n`)
  .join("");
out(
  "blocklist.ts",
  "// FICHIER GÉNÉRÉ par scripts/gen-lists.mjs — ne pas modifier à la main.\n" +
    srcHdr +
    "// Licences : MIT (SecLists, dont la liste du NCSC), CC BY 4.0 (Richelieu), voir THIRD_PARTY_LICENSES.md\n",
  `/** Mots de passe entiers (${PW_MIN_CHARS} caractères au moins) que les règles et les cœurs ne refusent pas déjà. */\n` +
    `export const BLOCK: readonly string[] = ${JSON.stringify(block)};\n` +
    `/** Cœurs de dictionnaire, codés par encodeCores (weakpw.ts). */\n` +
    `export const CORES_PACKED = ${JSON.stringify(encodeCores(coreList))};\n`,
);
console.log(`${words.length} mots, ${block.length} entrées entières, ${coreList.length} cœurs`);
