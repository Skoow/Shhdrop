// release-manifest.mjs (spec §28.2) : manifeste de version déterministe et SHA256SUMS.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { manifestOf, serialize, sumsOf } from "./release-manifest.mjs";

const SCRIPT = fileURLToPath(new URL("./release-manifest.mjs", import.meta.url));
const META = { name: "shhdrop-web", version: "1.2.3", commit: "0123abc" };
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

function temp(): string {
  const d = mkdtempSync(join(tmpdir(), "release-manifest-"));
  dirs.push(d);
  return d;
}

/** Écrit les fichiers dans l'ordre donné. */
function tree(files: [string, string | Buffer][]): string {
  const d = temp();
  for (const [name, data] of files) {
    mkdirSync(join(d, name, ".."), { recursive: true });
    writeFileSync(join(d, name), data);
  }
  return d;
}

const run = (args: string[], cwd?: string) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", cwd });
const ARGS = ["--name", "shhdrop-web", "--version", "1.2.3", "--commit", "0123abc"];

describe("manifestOf", () => {
  it("liste chaque fichier : chemin relatif à barres obliques, taille, SHA-256", () => {
    const d = tree([
      ["index.html", "<p>bonjour</p>"],
      ["assets/app-a.js", "console.info(1)"],
      ["vide.txt", ""],
    ]);
    expect(manifestOf(d, META)).toEqual({
      schema: 1,
      name: "shhdrop-web",
      version: "1.2.3",
      commit: "0123abc",
      files: [
        { path: "assets/app-a.js", size: 15, sha256: sha("console.info(1)") },
        { path: "index.html", size: 14, sha256: sha("<p>bonjour</p>") },
        { path: "vide.txt", size: 0, sha256: sha("") },
      ],
    });
  });

  it("liste aussi les variantes précompressées .br et .gz (octets servis)", () => {
    const d = tree([
      ["index.html", "x"],
      ["index.html.br", Buffer.from([1, 2, 3])],
      ["index.html.gz", Buffer.from([4, 5])],
    ]);
    expect(manifestOf(d, META).files.map((f) => [f.path, f.size])).toEqual([
      ["index.html", 1],
      ["index.html.br", 3],
      ["index.html.gz", 2],
    ]);
  });

  it("trie par ordre des octets, pas par ordre de la langue ni des unités UTF-16", () => {
    // Octets : « B » (42) < « a » (61) < « é » (C3 A9) < U+FF5E (EF BD 9E) < U+1F600 (F0 9F 98 80).
    // Langue : a < B ; UTF-16 : U+1F600 (D83D…) < U+FF5E.
    const names = ["a.txt", "\u{1F600}.txt", "B.txt", "～.txt", "é.txt", "a/z.txt", "a-b.txt"];
    const d = tree(names.map((n) => [n, n]));
    expect(manifestOf(d, META).files.map((f) => f.path)).toEqual(["B.txt", "a-b.txt", "a.txt", "a/z.txt", "é.txt", "～.txt", "\u{1F600}.txt"]);
  });

  it("ignore les dossiers vides", () => {
    const d = tree([["index.html", "x"]]);
    mkdirSync(join(d, "vide"));
    expect(manifestOf(d, META).files.map((f) => f.path)).toEqual(["index.html"]);
  });

  it("refuse un lien symbolique (vers un fichier comme vers un dossier)", () => {
    const d = tree([
      ["index.html", "x"],
      ["sous/a.txt", "a"],
    ]);
    symlinkSync(join(d, "index.html"), join(d, "lien.html"));
    expect(() => manifestOf(d, META)).toThrow(/lien\.html : lien symbolique/);
    rmSync(join(d, "lien.html"));
    symlinkSync(join(d, "sous"), join(d, "lien-dossier"));
    expect(() => manifestOf(d, META)).toThrow(/lien-dossier : lien symbolique/);
  });

  it("refuse ce qui n'est pas un fichier ordinaire (tube nommé)", () => {
    const d = tree([["index.html", "x"]]);
    execFileSync("mkfifo", [join(d, "tube")]);
    expect(() => manifestOf(d, META)).toThrow(/tube : ni fichier ordinaire ni dossier/);
  });

  it("refuse un nom que SHA256SUMS ne peut pas porter (saut de ligne, barre oblique inverse)", () => {
    expect(() => manifestOf(tree([["a\nb.txt", "x"]]), META)).toThrow(/nom de fichier refusé/);
    expect(() => manifestOf(tree([["a\\b.txt", "x"]]), META)).toThrow(/nom de fichier refusé/);
  });

  it("refuse un dossier absent ou sans aucun fichier", () => {
    expect(() => manifestOf(join(temp(), "absent"), META)).toThrow(/absent/);
    expect(() => manifestOf(temp(), META)).toThrow(/aucun fichier/);
  });

  it.each([
    [{ ...META, version: "1.2" }, /version/],
    [{ ...META, version: "v1.2.3" }, /version/],
    [{ ...META, version: "1.2.3\n" }, /version/],
    [{ ...META, commit: "0123ab" }, /commit/],
    [{ ...META, commit: "0123ABC" }, /commit/],
    [{ ...META, commit: "0".repeat(41) }, /commit/],
    [{ ...META, name: "Shhdrop" }, /nom/],
    [{ ...META, name: "" }, /nom/],
  ])("refuse des métadonnées hors format : %j", (meta, re) => {
    expect(() => manifestOf(tree([["index.html", "x"]]), meta)).toThrow(re);
  });
});

describe("serialize et sumsOf", () => {
  const M = {
    schema: 1 as const,
    name: "shhdrop-web",
    version: "1.2.3",
    commit: "0123abc",
    files: [{ path: "a.txt", size: 1, sha256: sha("a") }],
  };

  it("JSON à 2 espaces, clés dans l'ordre fixé, LF, saut de ligne final", () => {
    expect(serialize(M)).toBe(
      `{\n  "schema": 1,\n  "name": "shhdrop-web",\n  "version": "1.2.3",\n  "commit": "0123abc",\n  "files": [\n    {\n      "path": "a.txt",\n      "size": 1,\n      "sha256": "${sha("a")}"\n    }\n  ]\n}\n`,
    );
  });

  it("l'ordre des clés ne dépend pas de l'objet reçu", () => {
    const shuffled = { files: [{ sha256: sha("a"), size: 1, path: "a.txt" }], commit: "0123abc", version: "1.2.3", name: "shhdrop-web", schema: 1 as const };
    expect(serialize(shuffled)).toBe(serialize(M));
  });

  it("SHA256SUMS : « <hex>  <chemin> » par ligne", () => {
    expect(sumsOf({ ...M, files: [...M.files, { path: "b/c.txt", size: 1, sha256: sha("c") }] })).toBe(`${sha("a")}  a.txt\n${sha("c")}  b/c.txt\n`);
  });

  it("déterministe : même arbre, sorties identiques à l'octet, quels que soient l'ordre de création et les dates", () => {
    const files: [string, string][] = [
      ["index.html", "<p>x</p>"],
      ["assets/b.js", "b"],
      ["assets/a.js", "a"],
      ["z.txt", "z"],
      ["assets/deep/c.css", "c"],
    ];
    const d1 = tree(files);
    const d2 = tree([...files].reverse());
    utimesSync(join(d2, "index.html"), new Date(0), new Date(86_400_000));
    utimesSync(join(d2, "assets/a.js"), new Date(1e12), new Date(1e12));
    const [m1, m2] = [manifestOf(d1, META), manifestOf(d2, META)];
    expect(serialize(m2)).toBe(serialize(m1));
    expect(sumsOf(m2)).toBe(sumsOf(m1));
    expect(serialize(m1)).not.toContain("\r");
  });

  it("sha256sum -c accepte SHA256SUMS", () => {
    const d = tree([
      ["index.html", "<p>x</p>"],
      ["assets/a b.js", "a"],
      ["é.txt", "é"],
    ]);
    writeFileSync(join(temp(), "SHA256SUMS"), sumsOf(manifestOf(d, META)));
    const sums = join(dirs.at(-1)!, "SHA256SUMS");
    const out = execFileSync("sha256sum", ["-c", "--strict", sums], { cwd: d, encoding: "utf8" });
    expect(out).toBe("assets/a b.js: OK\nindex.html: OK\né.txt: OK\n");
  });
});

describe("ligne de commande", () => {
  it("écrit release.json et SHA256SUMS dans --out, sortie 0", () => {
    const d = tree([
      ["index.html", "<p>x</p>"],
      ["assets/a.js", "a"],
    ]);
    const out = temp();
    const r = run([d, ...ARGS, "--out", out]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const m = manifestOf(d, META);
    expect(readFileSync(join(out, "release.json"), "utf8")).toBe(serialize(m));
    expect(readFileSync(join(out, "SHA256SUMS"), "utf8")).toBe(sumsOf(m));
    expect(r.stdout).toMatch(/2 fichiers/);
  });

  it("sans --out : dossier courant", () => {
    const d = tree([["index.html", "x"]]);
    const cwd = temp();
    expect(run([d, ...ARGS], cwd).status).toBe(0);
    expect(existsSync(join(cwd, "release.json"))).toBe(true);
    expect(existsSync(join(cwd, "SHA256SUMS"))).toBe(true);
  });

  it.each([
    [[], "aucun argument"],
    [ARGS, "dossier manquant"],
    [["d", "--name", "shhdrop-web", "--version", "1.2.3"], "--commit manquant"],
    [["d", ...ARGS, "--out"], "--out sans valeur"],
    [["d", ...ARGS, "--force"], "option inconnue"],
    [["d", "e", ...ARGS], "deux dossiers"],
    [["d", ...ARGS, "--version", "1.2.4"], "option répétée"],
    [["d", "--name", "shhdrop-web", "--version", "1.2", "--commit", "0123abc"], "version hors format"],
    [["d", "--name", "shhdrop-web", "--version", "1.2.3", "--commit", "HEAD"], "commit hors format"],
    [["d", "--name", "Shhdrop Web", "--version", "1.2.3", "--commit", "0123abc"], "nom hors format"],
  ])("erreur d'usage → sortie 2 : %j (%s)", (args) => {
    const r = run(args, temp());
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^release-manifest : .*\nusage : /);
    expect(existsSync(join(dirs.at(-1)!, "release.json"))).toBe(false);
  });

  it("--out dans le dossier du site → sortie 2 (le manifeste se listerait lui-même)", () => {
    const d = tree([["index.html", "x"]]);
    for (const out of [d, join(d, "sous")]) {
      const r = run([d, ...ARGS, "--out", out]);
      expect(r.status).toBe(2);
      expect(existsSync(join(out, "release.json"))).toBe(false);
    }
  });

  it("autre échec (lien symbolique, dossier absent) → sortie 1, une ligne, rien d'écrit", () => {
    const d = tree([["index.html", "x"]]);
    symlinkSync(join(d, "index.html"), join(d, "lien"));
    const out = temp();
    const r = run([d, ...ARGS, "--out", out]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^release-manifest : lien : lien symbolique[^\n]*\n$/);
    expect(existsSync(join(out, "release.json"))).toBe(false);
    expect(run([join(out, "absent"), ...ARGS, "--out", out]).status).toBe(1);
  });
});
