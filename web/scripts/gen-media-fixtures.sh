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

# ---------- Vidéo et audio (Task 9c) : ffmpeg 6.1.1, libx264, aac, libopus, libvorbis, flac,
# libmp3lame, libvpx-vp9. Repères fictifs « Reper… » ; date de prise repère 2001-02-03.
F=(ffmpeg -hide_banner -loglevel error -y)
V=(-f lavfi -i testsrc=size=64x48:rate=10:duration=2)
A=(-f lavfi -i sine=frequency=440:duration=2:sample_rate=48000)
P=(-f lavfi -i color=c=red:size=16x16:duration=0.1)
TAGS=(-metadata title=ReperTitre -metadata artist=ReperArtiste -metadata comment=ReperComment -metadata creation_time=2001-02-03T04:05:06Z -metadata encoder=ReperLogiciel)
# MOV de « téléphone » : position, appareil, logiciel, date, piste tmcd ; puis rotation 90° par
# matrice de tkhd (option d'entrée -display_rotation sur une recopie sans réencodage).
"${F[@]}" "${V[@]}" "${A[@]}" -c:v libx264 -preset ultrafast -crf 40 -pix_fmt yuv420p -c:a aac -b:a 24k -timecode 01:02:03:04 \
  -metadata location=+12.5822-065.7225/ -metadata com.apple.quicktime.make=ReperMake -metadata com.apple.quicktime.model=ReperModel \
  -metadata com.apple.quicktime.software=ReperSoftware -metadata com.apple.quicktime.creationdate=2001-02-03T04:05:06+0100 \
  "${TAGS[@]}" -movflags use_metadata_tags phone-r.mov
"${F[@]}" -display_rotation 90 -i phone-r.mov -map 0 -c copy -map_metadata 0 -movflags use_metadata_tags phone.mov && rm phone-r.mov
# MP4 « faststart » (moov en tête) avec udta (©xyz, titre, logiciel).
"${F[@]}" "${V[@]}" "${A[@]}" -c:v libx264 -preset ultrafast -crf 40 -pix_fmt yuv420p -c:a aac -b:a 24k -metadata location=+12.5822-065.7225/ "${TAGS[@]}" -movflags +faststart faststart.mp4
# MP4 fragmenté avec heure murale de prise (prft).
"${F[@]}" "${V[@]}" -c:v libx264 -preset ultrafast -crf 40 -pix_fmt yuv420p "${TAGS[@]}" -write_prft wallclock -movflags frag_keyframe+empty_moov+default_base_moof frag.mp4
# M4A : étiquettes iTunes et pochette.
"${F[@]}" "${A[@]}" "${P[@]}" -map 0 -map 1 -c:a aac -b:a 24k -c:v png -disposition:v attached_pic "${TAGS[@]}" -metadata album=ReperAlbum tags.m4a
# WebM et MKV : Tags, Title, DateUTC, MuxingApp et WritingApp.
"${F[@]}" "${V[@]}" "${A[@]}" -c:v libvpx-vp9 -b:v 30k -deadline realtime -c:a libopus -b:a 24k "${TAGS[@]}" meta.webm
"${F[@]}" "${V[@]}" "${A[@]}" -c:v libx264 -preset ultrafast -crf 40 -pix_fmt yuv420p -c:a flac "${TAGS[@]}" meta.mkv
# MP3 : ID3v2 (avec pochette), ID3v1, trame Xing.
"${F[@]}" "${A[@]}" "${P[@]}" -map 0 -map 1 -c:a libmp3lame -b:a 32k -c:v png -disposition:v attached_pic -id3v2_version 3 -write_id3v1 1 "${TAGS[@]}" -metadata album=ReperAlbum meta.mp3
# Ogg Opus et Vorbis : commentaires et encodeur.
"${F[@]}" "${A[@]}" -c:a libopus -b:a 24k "${TAGS[@]}" meta.opus
"${F[@]}" "${A[@]}" -c:a libvorbis -q:a 0 "${TAGS[@]}" meta.ogg
# FLAC : VORBIS_COMMENT et PICTURE.
"${F[@]}" "${A[@]}" "${P[@]}" -map 0 -map 1 -c:a flac -c:v png -disposition:v attached_pic "${TAGS[@]}" meta.flac
# WAV : LIST/INFO et bext.
"${F[@]}" "${A[@]}" -c:a pcm_s16le -ac 1 -ar 8000 -write_bext 1 "${TAGS[@]}" -metadata originator=ReperOriginator meta.wav
# Ogg Opus dont les commentaires (70 000 octets) tiennent sur plusieurs pages : renumérotation.
"${F[@]}" "${A[@]}" -c:a libopus -b:a 16k -metadata comment="ReperLong$(head -c 70000 /dev/zero | tr '\0' 'x')" long.opus
