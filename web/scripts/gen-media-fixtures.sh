#!/usr/bin/env bash
# Fichiers d'essai réels que gen-fixtures.mjs ne sait pas construire (spec §35.2), lancé à la
# main ; résultats commités dans src/media/fixtures/ (chacun sous 200 Kio). Repères fictifs.
# Outils : Python 3.13, Pillow 12.3.0 (AVIF par libavif). HEIC : aucun encodeur HEVC libre
# disponible ici ; meta.heic est une structure synthétique de gen-fixtures.mjs.
set -euo pipefail
cd "$(dirname "$0")/../src/media/fixtures"
python3 -I - <<'PY'
from PIL import Image
im = Image.new("RGB", (16, 8))
for x in range(16):
    for y in range(8):
        im.putpixel((x, y), (x * 16 % 256, y * 32 % 256, 128))
ex = Image.Exif()
ex[0x010F] = "ReperMake"
ex[0x0110] = "ReperModel"
ex[0x0132] = "2001:02:03 04:05:06"
ex[0x0112] = 6
ex.get_ifd(0x8825).update({1: "N", 2: (12.0, 34.0, 56.0), 3: "W", 4: (65.0, 43.0, 21.0)})
xmp = b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:tiff="http://ns.adobe.com/tiff/1.0/" tiff:Make="ReperXMP"/></rdf:RDF></x:xmpmeta>'
im.save("meta.avif", exif=ex.tobytes(), xmp=xmp, quality=60)
PY
