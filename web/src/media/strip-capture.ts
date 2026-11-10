// Métadonnées des vidéos et vocaux pris dans l'interface (MediaRecorder). La piste n'a ni
// position ni modèle d'appareil ; restent le nom du navigateur (WebM : MuxingApp, WritingApp)
// et les dates de création (MP4 : mvhd, tkhd, mdhd). Ils passent par le même nettoyage en place
// que les fichiers importés (ebml.ts, mp4.ts, spec §35.2) : taille et décalages inchangés,
// chaînes EBML mises à zéro, dates MP4 à 0, boîtes udta/meta en « free » remplies de zéros.
// Le résultat est relu par le même analyseur (plus rien à changer, même taille).
// Format inconnu ou structure inattendue : le Blob est rendu inchangé (stripped: false).
import { cleanEbml } from "./ebml";
import { cleanMp4 } from "./mp4";
import { patchedBlob, type Patch } from "./patch";

export type Stripped = { blob: Blob; stripped: boolean };

const isWebm = (b: Uint8Array) => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
const isMp4 = (b: Uint8Array) => b.length >= 8 && String.fromCharCode(b[4]!, b[5]!, b[6]!, b[7]!) === "ftyp";

export async function stripCaptureMeta(blob: Blob): Promise<Stripped> {
  try {
    const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    const clean: ((f: Blob) => Promise<Patch[]>) | null = isWebm(head) ? cleanEbml : isMp4(head) ? cleanMp4 : null;
    if (!clean) return { blob, stripped: false };
    const data = patchedBlob(blob, await clean(blob), [], blob.type);
    if (data.size !== blob.size || (await clean(data)).length > 0) return { blob, stripped: false };
    return { blob: data, stripped: true };
  } catch {
    return { blob, stripped: false };
  }
}
