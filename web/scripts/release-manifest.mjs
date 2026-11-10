#!/usr/bin/env node
// Manifeste de version (spec §28.2) : liste exacte des fichiers d'un site construit, pour que
// n'importe qui puisse comparer ce que sert le serveur à ce que donne le dépôt public.
//   node scripts/release-manifest.mjs <dossier du site> --name shhdrop-web --version <x.y.z> --commit <sha> [--out <dossier>]
// Écrit dans --out (défaut : dossier courant) :
//   release.json  { "schema": 1, "name", "version", "commit", "files": [{ "path", "size", "sha256" }] }
//   SHA256SUMS    « <hex>  <chemin> » par ligne, accepté par `sha256sum -c` lancé dans le dossier du site
// Sortie 0 ; 2 sur une erreur d'usage ; 1 sur tout autre échec (une ligne sur stderr, rien d'écrit).
//
// Ce qui est listé : TOUS les fichiers ordinaires du dossier, sous-dossiers compris, y compris
// les variantes précompressées .br et .gz (le serveur les envoie telles quelles aux navigateurs :
// ce sont des octets servis, verify-site.mjs les contrôle). Les dossiers vides ne sont pas listés
// (rien n'est servi). Un lien symbolique ou tout ce qui n'est ni fichier ordinaire ni dossier
// est une erreur : le manifeste ne décrit que des octets présents dans le dossier.
//
// Déterministe : même arbre, mêmes octets en sortie. Chemins relatifs à barres obliques, triés
// par ordre des octets UTF-8 (ni l'ordre de la langue, ni celui des unités UTF-16 de sort()),
// clés dans un ordre fixe, JSON à 2 espaces, fins de ligne LF, saut de ligne final. Ni date ni
// chemin absolu : l'ordre d'énumération du système de fichiers et les dates ne comptent pas.
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const FORMATS = {
  name: [/^[a-z0-9-]+$/, "nom hors format (minuscules, chiffres et tirets)"],
  version: [/^\d+\.\d+\.\d+$/, "version hors format (x.y.z)"],
  commit: [/^[0-9a-f]{7,40}$/, "commit hors format (7 à 40 chiffres hexadécimaux en minuscules)"],
};

/** Problème des métadonnées (null si elles sont au format). */
function metaProblem(meta) {
  for (const [key, [re, msg]] of Object.entries(FORMATS)) {
    if (typeof meta?.[key] !== "string" || !re.test(meta[key])) return msg;
  }
  return null;
}

// Un nom avec un caractère de contrôle ou une barre oblique inverse changerait le format de
// SHA256SUMS (sha256sum l'échappe) ; un nom qui n'est pas de l'UTF-8 valide ne survivrait pas
// au JSON. Aucun fichier du site n'en a besoin : refusés.
const BAD_NAME = /[\u0000-\u001f\u007f\\�]/;

/** Chemins relatifs (barres obliques) des fichiers ordinaires de dir ; lève sur tout le reste. */
function walk(dir, prefix = "") {
  const out = [];
  for (const name of readdirSync(dir)) {
    const rel = prefix + name;
    if (BAD_NAME.test(name)) throw new Error(`${JSON.stringify(rel)} : nom de fichier refusé (caractère de contrôle, barre oblique inverse ou UTF-8 invalide)`);
    const st = lstatSync(join(dir, name)); // lstat : un lien n'est jamais suivi
    if (st.isSymbolicLink()) throw new Error(`${rel} : lien symbolique refusé`);
    if (st.isDirectory()) out.push(...walk(join(dir, name), rel + "/"));
    else if (st.isFile()) out.push(rel);
    else throw new Error(`${rel} : ni fichier ordinaire ni dossier`);
  }
  return out;
}

/** Manifeste du site construit dans dir. Lève une erreur (message en français) au moindre doute. */
export function manifestOf(dir, meta) {
  const bad = metaProblem(meta);
  if (bad) throw new Error(bad);
  let isDir = false;
  try {
    isDir = statSync(dir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) throw new Error(`${dir} : dossier absent (build manquant ?)`);
  const paths = walk(dir).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  if (paths.length === 0) throw new Error(`${dir} : aucun fichier`);
  const files = paths.map((path) => {
    const data = readFileSync(join(dir, ...path.split("/")));
    // Taille des octets hachés (et non celle de stat) : les deux champs décrivent le même contenu.
    return { path, size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
  });
  return { schema: 1, name: meta.name, version: meta.version, commit: meta.commit, files };
}

/** Texte de release.json : clés dans l'ordre fixé, quel que soit l'objet reçu. */
export function serialize(manifest) {
  const { schema, name, version, commit, files } = manifest;
  const ordered = { schema, name, version, commit, files: files.map(({ path, size, sha256 }) => ({ path, size, sha256 })) };
  return JSON.stringify(ordered, null, 2) + "\n";
}

/** Texte de SHA256SUMS (deux espaces : mode texte de sha256sum). */
export function sumsOf(manifest) {
  return manifest.files.map((f) => `${f.sha256}  ${f.path}\n`).join("");
}

const USAGE = "usage : node scripts/release-manifest.mjs <dossier du site> --name <nom> --version <x.y.z> --commit <sha> [--out <dossier>]";

/** Arguments de la ligne de commande ; lève un message d'usage. */
function parseArgs(args) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) {
      rest.push(a);
      continue;
    }
    const key = a.slice(2);
    if (!["name", "version", "commit", "out"].includes(key)) throw new Error(`option inconnue : ${a}`);
    if (key in opts) throw new Error(`option répétée : ${a}`);
    const value = args[++i];
    if (value === undefined || value.startsWith("--")) throw new Error(`${a} : valeur manquante`);
    opts[key] = value;
  }
  if (rest.length !== 1) throw new Error(rest.length === 0 ? "dossier du site manquant" : "un seul dossier attendu");
  for (const key of ["name", "version", "commit"]) if (!(key in opts)) throw new Error(`--${key} manquant`);
  const bad = metaProblem(opts);
  if (bad) throw new Error(bad);
  const dir = rest[0];
  const out = opts.out ?? ".";
  // Écrit dans le site, le manifeste serait servi, et listé par lui-même au build suivant.
  const rel = relative(resolve(dir), resolve(out));
  if (rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel)))
    throw new Error("--out est dans le dossier du site (le manifeste se listerait lui-même)");
  return { dir, out, meta: { name: opts.name, version: opts.version, commit: opts.commit } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`release-manifest : ${e.message}\n${USAGE}`);
    process.exit(2);
  }
  try {
    const manifest = manifestOf(parsed.dir, parsed.meta);
    const [json, sums] = [serialize(manifest), sumsOf(manifest)]; // tout est calculé avant d'écrire
    mkdirSync(parsed.out, { recursive: true });
    writeFileSync(join(parsed.out, "release.json"), json);
    writeFileSync(join(parsed.out, "SHA256SUMS"), sums);
    console.log(`release-manifest : ${manifest.files.length} fichiers, ${join(parsed.out, "release.json")} et SHA256SUMS écrits`);
  } catch (e) {
    console.error(`release-manifest : ${e.message}`);
    process.exit(1);
  }
}
