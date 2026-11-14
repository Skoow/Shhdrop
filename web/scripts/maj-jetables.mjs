// Met à jour server/internal/compte/jetables.txt (domaines d'adresses jetables, conception du
// compte §5.3), sur le poste du développeur seulement, avec la mise à jour mensuelle des
// dépendances : le serveur ne télécharge jamais la liste (aucune sortie hors SMTP).
// Usage : node scripts/maj-jetables.mjs [--fichier <copie locale de la liste>]
// Sans --fichier, la liste est téléchargée depuis SOURCE. Le script montre le nombre de
// domaines ajoutés et retirés, refuse toute ligne qui n'est pas un domaine en minuscules, puis
// écrit le fichier (en-tête : source, licence, date, SHA-256). À relire avant le commit, et à
// reporter dans THIRD_PARTY_LICENSES.md (date, nombre, empreinte).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE =
  "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf";
const CIBLE = fileURLToPath(new URL("../../server/internal/compte/jetables.txt", import.meta.url));
const DOMAINE = /^[a-z0-9.-]+$/;

/** Domaines d'un texte : lignes non vides hors commentaires ; toute autre ligne est refusée. */
export function domaines(texte) {
  const out = [];
  for (const [i, l] of texte.split("\n").entries()) {
    if (l === "" || l.startsWith("#")) continue;
    if (!DOMAINE.test(l)) throw new Error(`ligne ${i + 1} refusée : ${JSON.stringify(l)}`);
    out.push(l);
  }
  return out;
}

/** Contenu de jetables.txt pour une source (octets) copiée le jour `date` (AAAA-MM-JJ). */
export function fichier(source, date) {
  const liste = domaines(source.toString("utf8"));
  const sha = createHash("sha256").update(source).digest("hex");
  const n = liste.length.toLocaleString("fr-FR").replace(/\s/g, " ");
  return [
    "# Domaines d'adresses jetables (conception du compte §5.3). Source : projet public",
    "# disposable-email-domains (https://github.com/disposable-email-domains/disposable-email-domains,",
    "# fichier disposable_email_blocklist.conf de la branche main), licence CC0 1.0 (domaine public).",
    `# Copie du ${date}, ${n} domaines, SHA-256 de la source :`,
    `# ${sha}`,
    "# Ne pas modifier à la main : web/scripts/maj-jetables.mjs (poste du développeur) ; ajouts locaux dans",
    "# jetables-ajouts.txt.",
    ...liste,
    "",
  ].join("\n");
}

async function main() {
  const i = process.argv.indexOf("--fichier");
  let source;
  if (i >= 0) {
    source = readFileSync(process.argv[i + 1]);
  } else {
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`téléchargement échoué (${res.status}) : ${SOURCE}`);
    source = Buffer.from(await res.arrayBuffer());
  }
  const nouveau = fichier(source, new Date().toISOString().slice(0, 10));
  const avant = new Set(domaines(readFileSync(CIBLE, "utf8")));
  const apres = new Set(domaines(nouveau));
  const ajoutes = [...apres].filter((d) => !avant.has(d)).length;
  const retires = [...avant].filter((d) => !apres.has(d)).length;
  writeFileSync(CIBLE, nouveau);
  console.log(`${apres.size} domaines : ${ajoutes} ajoutés, ${retires} retirés ; écrit dans ${CIBLE}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
