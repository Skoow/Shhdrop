// Task 9c (spec §35.2) : vidéos et sons importés nettoyés sans réencodage. Chaque sortie se lit
// dans <video> ou <audio> (loadedmetadata) avec la même durée (0,1 s près) et les mêmes
// dimensions que l'original ; un format que le navigateur ne lit pas du tout est sauté (WebKit :
// WebM, Ogg, MKV). Dépôt d'un MOV de téléphone dans le composeur : « Nettoyé » sur la ligne.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripMetadata } from "../src/media/strip";
import { expect, test } from "./fixtures";
import { cleanAll, enterComposer, openFilePicker } from "./send-helpers";

test.use({ locale: "fr-FR" });

const PATH = (n: string) => fileURLToPath(new URL(`../src/media/fixtures/${n}`, import.meta.url));
const FX = (n: string) => readFileSync(PATH(n));
/** Position de la dernière page Ogg (granule : nombre d'échantillons) lue dans les octets ; null hors Ogg. */
function oggEnd(b: Buffer): string | null {
  if (b.toString("latin1", 0, 4) !== "OggS") return null;
  const at = b.lastIndexOf("OggS");
  return at < 0 ? null : b.readBigInt64LE(at + 6).toString();
}

const AV: [string, string, "video" | "audio"][] = [
  ["phone.mov", "video/quicktime", "video"],
  ["faststart.mp4", "video/mp4", "video"],
  ["frag.mp4", "video/mp4", "video"],
  ["tags.m4a", "audio/mp4", "audio"],
  ["meta.webm", "video/webm", "video"],
  ["meta.mkv", "video/x-matroska", "video"],
  ["meta.mp3", "audio/mpeg", "audio"],
  ["meta.opus", "audio/ogg", "audio"],
  ["meta.ogg", "audio/ogg", "audio"],
  ["long.opus", "audio/ogg", "audio"],
  ["meta.flac", "audio/flac", "audio"],
  ["meta.wav", "audio/wav", "audio"],
];

test("vidéos et sons nettoyés : lisibles, même durée, mêmes dimensions", async ({ page, shh }) => {
  test.setTimeout(90_000);
  await page.goto(shh.origin + "/");
  const probe = (b: Buffer, type: string, tag: string) =>
    page.evaluate(
      async ([data, type, tag]) => {
        const bytes = Uint8Array.from(atob(data!), (c) => c.charCodeAt(0));
        const el = document.createElement(tag as "video");
        el.preload = "metadata";
        el.muted = true;
        const url = URL.createObjectURL(new Blob([bytes], { type }));
        try {
          return await new Promise<null | [number, number, number]>((ok) => {
            const good = () => Number.isFinite(el.duration) && el.duration > 0;
            const done = () => ok([good() ? Math.round(el.duration * 10) / 10 : 0, el.videoWidth ?? 0, el.videoHeight ?? 0]);
            el.onloadedmetadata = () => {
              if (good()) return done();
              // WebKit donne 0, NaN ou Infinity pour de l'Ogg au chargement des métadonnées : on
              // attend la durée (durationchange), après avoir poussé la lecture à la fin du flux.
              el.ondurationchange = () => good() && done();
              el.currentTime = 1e7;
              setTimeout(done, 4000); // toujours inconnue : 0, la comparaison de durée est alors sautée
            };
            el.onerror = () => ok(null);
            setTimeout(() => ok(null), 8000);
            el.src = url;
          });
        } finally {
          URL.revokeObjectURL(url);
        }
      },
      [b.toString("base64"), type, tag],
    );
  let checked = 0;
  for (const [name, mime, kind] of AV) {
    const r = await stripMetadata(new Blob([FX(name)]), mime, name);
    expect(r.state, name).toBe("nettoye");
    const out = Buffer.from(await (r as { data: Blob }).data.arrayBuffer());
    const before = await probe(FX(name), mime, kind);
    if (before === null) continue; // format non lu par ce navigateur, avant comme après
    checked++;
    const after = await probe(out, mime, kind);
    expect(after, name).not.toBeNull();
    // Durée exacte de l'Ogg lue dans les octets (même résultat dans tous les navigateurs).
    expect(oggEnd(out), `${name} : granule finale`).toBe(oggEnd(FX(name)));
    // Durée du navigateur : comparée quand il la donne des deux côtés (WebKit ne la donne pas
    // toujours pour l'Ogg ; l'Ogg est alors couvert par la granule ci-dessus).
    if (before[0] > 0 && after![0] > 0) {
      expect(Math.abs(after![0] - before[0]), `${name} : durée avant ${before[0]} s, après ${after![0]} s`).toBeLessThanOrEqual(0.1);
    } else {
      expect(oggEnd(out), `${name} : durée inconnue du navigateur, hors Ogg`).not.toBeNull();
    }
    expect(after!.slice(1), name).toEqual(before.slice(1));
  }
  expect(checked).toBeGreaterThanOrEqual(6);
});

test("MOV de téléphone déposé dans le composeur : « Nettoyé » (position, appareil, dates)", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  await enterComposer(page);
  await (await openFilePicker(page)).setFiles([PATH("phone.mov")]);
  await cleanAll(page);
  const row = page.locator("[data-row]").filter({ hasText: "phone" });
  await expect(row.locator('[data-clean="nettoye"]')).toBeVisible({ timeout: 20_000 });
  await expect(row.locator('[data-clean="nettoye"] button')).toHaveAccessibleName(/^Nettoyé\s: position, appareil et dates retirés$/);
});
