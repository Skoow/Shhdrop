import { describe, expect, it } from "vitest";
import { detectFormat } from "./format";

const b = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const ftyp = (major: string, ...compat: string[]) => b(`\0\0\0${String.fromCharCode(16 + compat.length * 4)}ftyp${major}\0\0\0\0${compat.join("")}`);

describe("detectFormat (octets magiques d'abord)", () => {
  it.each([
    [new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "", "a.png", "jpeg"],
    [b("\x89PNG\r\n\x1a\n"), "image/jpeg", "a.jpg", "png"],
    [b("RIFF\0\0\0\0WEBPVP8 "), "", "a", "webp"],
    [b("RIFF\0\0\0\0WAVEfmt "), "", "a", "wav"],
    [b("GIF89a"), "", "a", "gif"],
    [ftyp("heic", "mif1heic"), "", "a", "heif"],
    [ftyp("avif", "mif1"), "", "a", "heif"],
    [ftyp("isom", "mif1"), "", "a.mp4", "mp4"],
    [ftyp("qt  "), "", "a.mov", "mp4"],
    [ftyp("XXXX", "mif1"), "", "a", "heif"],
    [b("\x1a\x45\xdf\xa3"), "", "a", "webm"],
    [b("%PDF-1.7"), "", "a", "pdf"],
    [b("PK\x03\x04"), "", "a.docx", "ooxml"],
    [b("PK\x03\x04"), "", "a.odt", "odf"],
    [b("PK\x03\x04"), "", "a.zip", "inconnu"],
    [b("ID3\x04"), "", "a", "mp3"],
    [b("<svg/>"), "image/svg+xml", "a.svg", "inconnu"],
    [b("bonjour"), "text/plain", "a", "texte"],
    [b("a,b"), "", "a.csv", "texte"],
    [b("\x7fELF"), "", "a.txt", "texte"],
  ])("%#", (head, mime, name, want) => expect(detectFormat(head, mime, name)).toBe(want));
});
