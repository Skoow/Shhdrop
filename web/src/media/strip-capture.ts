// Métadonnées des vidéos et vocaux pris dans l'interface (MediaRecorder). La piste n'a ni
// position ni modèle d'appareil ; restent le nom du navigateur (WebM : MuxingApp, WritingApp)
// et les dates de création (MP4 : mvhd, tkhd, mdhd). On les efface SANS changer la taille du
// fichier ni aucun décalage : les octets des chaînes sont mis à zéro (chaîne EBML vide, permise
// par la norme), les dates MP4 à 0, et les boîtes udta/meta deviennent « free » (ignorées par
// les lecteurs). Seul l'en-tête est lu et réécrit ; le reste du Blob est repris tel quel.
// Format inconnu ou structure inattendue : le Blob est rendu inchangé (stripped: false).

/** En-tête lu au plus (l'en-tête des enregistrements de Chromium fait environ 1 Ko). */
const HEAD_MAX = 1024 * 1024;

export type Stripped = { blob: Blob; stripped: boolean };

export async function stripCaptureMeta(blob: Blob): Promise<Stripped> {
  const n = Math.min(blob.size, HEAD_MAX);
  const head = new Uint8Array(await blob.slice(0, n).arrayBuffer());
  let ok = false;
  try {
    if (isWebm(head)) ok = patchWebm(head);
    else if (isMp4(head)) ok = patchMp4(head);
  } catch {
    ok = false;
  }
  if (!ok) return { blob, stripped: false };
  return { blob: new Blob([head, blob.slice(n)], { type: blob.type }), stripped: true };
}

// ---------- WebM (EBML) ----------
const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const CLUSTER = 0x1f43b675;
/** MuxingApp, WritingApp, Title, DateUTC : leurs octets sont mis à zéro. */
const WEBM_WIPE: ReadonlySet<number> = new Set([0x4d80, 0x5741, 0x7ba9, 0x4461]);

const isWebm = (b: Uint8Array) => b.length >= 4 && ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0 === EBML;

type Vint = { value: number; len: number; unknown: boolean };
/** Entier EBML de longueur variable ; `raw` garde le marqueur de longueur (identifiants). */
function vint(b: Uint8Array, o: number, raw: boolean): Vint {
  if (o >= b.length) throw new Error("fin");
  const first = b[o]!;
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && !(first & mask)) {
    mask >>= 1;
    len++;
  }
  if (len > 8 || o + len > b.length) throw new Error("vint");
  let value = raw ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[o + i]!;
    if (b[o + i] !== 0xff) allOnes = false;
  }
  return { value, len, unknown: !raw && allOnes };
}

function patchWebm(b: Uint8Array): boolean {
  let o = 0;
  const hid = vint(b, o, true);
  const hsz = vint(b, o + hid.len, false);
  o += hid.len + hsz.len + hsz.value;
  const sid = vint(b, o, true);
  if (sid.value !== SEGMENT) return false;
  const ssz = vint(b, o + sid.len, false);
  o += sid.len + ssz.len;
  const end = ssz.unknown ? b.length : Math.min(b.length, o + ssz.value);
  while (o < end) {
    const id = vint(b, o, true);
    const sz = vint(b, o + id.len, false);
    const data = o + id.len + sz.len;
    if (id.value === CLUSTER || sz.unknown) return false;
    if (id.value === INFO) {
      if (data + sz.value > b.length) return false;
      let p = data;
      while (p < data + sz.value) {
        const cid = vint(b, p, true);
        const csz = vint(b, p + cid.len, false);
        const cdata = p + cid.len + csz.len;
        if (csz.unknown || cdata + csz.value > data + sz.value) return false;
        if (WEBM_WIPE.has(cid.value)) b.fill(0, cdata, cdata + csz.value);
        p = cdata + csz.value;
      }
      return true;
    }
    o = data + sz.value;
  }
  return false;
}

// ---------- MP4 (ISO BMFF) ----------
const isMp4 = (b: Uint8Array) => b.length >= 8 && type(b, 4) === "ftyp";
const type = (b: Uint8Array, o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
const CONTAINERS: ReadonlySet<string> = new Set(["moov", "trak", "mdia"]);
const DATED: ReadonlySet<string> = new Set(["mvhd", "tkhd", "mdhd"]);
const HIDE: ReadonlySet<string> = new Set(["udta", "meta"]);

function patchMp4(b: Uint8Array): boolean {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let dated = 0;
  function walk(start: number, end: number, depth: number): void {
    let o = start;
    while (o + 8 <= end) {
      let size = v.getUint32(o);
      let hdr = 8;
      if (size === 1) {
        if (o + 16 > end) throw new Error("boîte");
        size = Number(v.getBigUint64(o + 8));
        hdr = 16;
      } else if (size === 0) size = end - o;
      if (size < hdr || o + size > end) throw new Error("boîte");
      const t = type(b, o + 4);
      if (DATED.has(t)) {
        const ver = b[o + hdr]!;
        const n = ver === 1 ? 16 : 8; // création et modification
        if (o + hdr + 4 + n > o + size) throw new Error("boîte");
        b.fill(0, o + hdr + 4, o + hdr + 4 + n);
        dated++;
      } else if (HIDE.has(t) && depth > 0) {
        b.set([0x66, 0x72, 0x65, 0x65], o + 4); // « free » : même taille, ignorée
      } else if (CONTAINERS.has(t)) walk(o + hdr, o + size, depth + 1);
      o += size;
    }
  }
  // Boîtes de premier niveau jusqu'à moov (qui doit tenir dans l'en-tête lu).
  let o = 0;
  while (o + 8 <= b.length) {
    let size = v.getUint32(o);
    let hdr = 8;
    if (size === 1) {
      size = Number(v.getBigUint64(o + 8));
      hdr = 16;
    }
    if (size < hdr) return false;
    if (type(b, o + 4) === "moov") {
      if (o + size > b.length) return false;
      walk(o + hdr, o + size, 1);
      return dated > 0;
    }
    o += size;
  }
  return false;
}
