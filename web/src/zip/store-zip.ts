// Écrivain .zip « stocké » (sans compression), en flux (spec §41.6, UI §9.8.6). Aucune
// dépendance et aucun import dynamique : importé statiquement. Chaque entrée : en-tête
// local (indicateurs « descripteur de données » et « noms UTF-8 »), octets tels quels,
// descripteur (CRC-32 et tailles, connus seulement à la fin) ; puis le répertoire central.
// ZIP64 dès qu'une taille ou une position atteint 4 Gio − 1 (paliers payants). Date fixe
// 1980-01-01 00:00, aucun attribut, aucun commentaire : aucune métadonnée de l'expéditeur.
// Mémoire : rien n'est gardé des données, seulement les en-têtes du répertoire central.
import { cleanName } from "../index";
import { crc32 } from "./crc32";

export type ZipSink = { write(chunk: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> };

/** Archive assemblée en Blob (sans sélecteur de fichier) : 512 Mio au plus. */
export const ZIP_BLOB_MAX = 512 * 1048576;
/** Sur iPhone/iPad ou si navigator.deviceMemory < 4 : 200 Mio au plus. */
export const ZIP_BLOB_MAX_SMALL = 200 * 1048576;

const MAX32 = 0xffffffff;
const DOS_DATE = (1 << 5) | 1; // 1980-01-01 (année 0, mois 1, jour 1)
const DOS_TIME = 0; // 00:00:00
const FLAGS = 0x0808; // bit 3 : descripteur de données ; bit 11 : nom en UTF-8

type Done = { name: Uint8Array; offset: number; size: number; crc: number; zip64: boolean };

class Writer {
  private buf: number[] = [];
  u16(v: number) {
    this.buf.push(v & 0xff, (v >>> 8) & 0xff);
    return this;
  }
  u32(v: number) {
    this.buf.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }
  u64(v: number) {
    // Entiers sûrs de JavaScript (< 2^53) : assez pour toute archive possible ici.
    return this.u32(v % 0x100000000).u32(Math.floor(v / 0x100000000));
  }
  bytes(b: Uint8Array) {
    for (const x of b) this.buf.push(x);
    return this;
  }
  get length() {
    return this.buf.length;
  }
  out(): Uint8Array {
    return new Uint8Array(this.buf);
  }
}

export type Zip = {
  /** Ajoute une entrée de `size` octets lus de `source` (CRC-32 calculé au fil de l'eau). */
  add(name: string, size: number, source: AsyncIterable<Uint8Array>): Promise<void>;
  /** Même chose en poussant les tranches soi-même ; end() vérifie la taille annoncée. */
  entry(name: string, size: number): Promise<{ write(chunk: Uint8Array): Promise<void>; end(): Promise<void> }>;
  /** Répertoire central, puis close() du puits. */
  finish(): Promise<void>;
  /** Abandon : abort() du puits (fichier partiel supprimé), jamais close(). */
  abort(): Promise<void>;
};

/**
 * `zip64At` : seuil ZIP64 (4 Gio − 1 ; abaissé seulement par les tests pour relire de petites
 * archives ZIP64 avec les outils du système).
 */
export function createZip(sink: ZipSink, opts: { zip64At?: number } = {}): Zip {
  const zip64At = opts.zip64At ?? MAX32;
  const done: Done[] = [];
  let pos = 0;
  let state: "open" | "busy" | "finished" | "failed" = "open";
  const enc = new TextEncoder();

  async function put(b: Uint8Array) {
    await sink.write(b);
    pos += b.length;
  }
  async function fail(e: unknown): Promise<never> {
    if (state !== "failed") {
      state = "failed";
      await sink.abort().catch(() => undefined);
    }
    throw e;
  }

  async function entry(name: string, size: number) {
    if (state !== "open") throw new Error(state === "busy" ? "zip_entree_en_cours" : "zip_ferme");
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("taille_invalide");
    state = "busy";
    const nm = enc.encode(name);
    const offset = pos;
    const zip64 = size >= zip64At || offset >= zip64At;
    const h = new Writer()
      .u32(0x04034b50)
      .u16(zip64 ? 45 : 20)
      .u16(FLAGS)
      .u16(0) // stocké
      .u16(DOS_TIME)
      .u16(DOS_DATE)
      .u32(0) // CRC : dans le descripteur
      .u32(zip64 ? MAX32 : 0)
      .u32(zip64 ? MAX32 : 0)
      .u16(nm.length)
      .u16(zip64 ? 20 : 0)
      .bytes(nm);
    if (zip64) h.u16(0x0001).u16(16).u64(0).u64(0);
    try {
      await put(h.out());
    } catch (e) {
      return fail(e);
    }
    let crc = 0;
    let got = 0;
    return {
      async write(chunk: Uint8Array) {
        if (state !== "busy") throw new Error("zip_ferme");
        if (got + chunk.length > size) return fail(new Error("taille_incoherente"));
        crc = crc32(chunk, crc);
        got += chunk.length;
        try {
          await put(chunk);
        } catch (e) {
          return fail(e);
        }
      },
      async end() {
        if (state !== "busy") throw new Error("zip_ferme");
        if (got !== size) return fail(new Error("taille_incoherente"));
        const d = new Writer().u32(0x08074b50).u32(crc);
        if (zip64) d.u64(size).u64(size);
        else d.u32(size).u32(size);
        try {
          await put(d.out());
        } catch (e) {
          return fail(e);
        }
        done.push({ name: nm, offset, size, crc, zip64 });
        state = "open";
      },
    };
  }

  return {
    entry,
    async add(name, size, source) {
      const e = await entry(name, size);
      try {
        for await (const chunk of source) await e.write(chunk);
      } catch (err) {
        return fail(err);
      }
      await e.end();
    },
    async finish() {
      if (state !== "open") throw new Error(state === "finished" ? "zip_ferme" : "zip_entree_en_cours");
      const cdStart = pos;
      const cd = new Writer();
      for (const f of done) {
        const big = f.zip64;
        cd.u32(0x02014b50)
          .u16(45) // créé par : version 4.5, hôte MS-DOS (aucun attribut Unix)
          .u16(big ? 45 : 20)
          .u16(FLAGS)
          .u16(0)
          .u16(DOS_TIME)
          .u16(DOS_DATE)
          .u32(f.crc)
          .u32(big ? MAX32 : f.size)
          .u32(big ? MAX32 : f.size)
          .u16(f.name.length)
          .u16(big ? 28 : 0)
          .u16(0) // commentaire
          .u16(0) // disque
          .u16(0) // attributs internes
          .u32(0) // attributs externes
          .u32(big ? MAX32 : f.offset)
          .bytes(f.name);
        if (big) cd.u16(0x0001).u16(24).u64(f.size).u64(f.size).u64(f.offset);
      }
      const cdSize = cd.length;
      const needs64 = done.length >= 0xffff || cdStart >= zip64At || cdSize >= zip64At || done.some((f) => f.zip64);
      if (needs64) {
        const eocd64At = cdStart + cdSize;
        cd.u32(0x06064b50).u64(44).u16(45).u16(45).u32(0).u32(0).u64(done.length).u64(done.length).u64(cdSize).u64(cdStart);
        cd.u32(0x07064b50).u32(0).u64(eocd64At).u32(1);
      }
      cd.u32(0x06054b50)
        .u16(0)
        .u16(0)
        .u16(needs64 ? 0xffff : done.length)
        .u16(needs64 ? 0xffff : done.length)
        .u32(needs64 ? MAX32 : cdSize)
        .u32(needs64 ? MAX32 : cdStart)
        .u16(0);
      try {
        await put(cd.out());
        state = "finished";
        await sink.close();
      } catch (e) {
        return fail(e);
      }
    },
    async abort() {
      if (state === "finished" || state === "failed") return;
      state = "failed";
      await sink.abort().catch(() => undefined);
    },
  };
}

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i;

/**
 * Nom sûr d'une entrée : safeName (cleanName), puis aucun séparateur de dossier ni caractère
 * interdit sous Windows (`/ \ : * ? " < > |`, contrôles), aucun point ni espace en bord,
 * noms réservés de Windows suffixés (« CON_.txt »), doublons (sans casse) suffixés « (2) ».
 * Aucune entrée ne peut donc s'écrire hors du dossier d'extraction. `taken` est complété.
 */
export function zipName(raw: string, taken: Set<string>): string {
  let s = cleanName(raw)
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/gu, "_")
    .replace(/^[\s.]+/u, "")
    .replace(/[\s.]+$/u, "");
  if (s === "") s = "fichier";
  // Windows lit le nom réservé avant le premier point (« con.tar.gz ») : suffixe à cet endroit.
  const first = s.indexOf(".");
  const head = first > 0 ? s.slice(0, first) : s;
  if (WIN_RESERVED.test(head.trim())) s = head + "_" + s.slice(head.length);
  const dot = s.lastIndexOf(".");
  const base = dot > 0 ? s.slice(0, dot) : s;
  const ext = dot > 0 ? s.slice(dot) : "";
  let name = base + ext;
  for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${base} (${k})${ext}`;
  taken.add(name.toLowerCase());
  return name;
}
