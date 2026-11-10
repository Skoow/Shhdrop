// Seul point d'entrée du moteur pour le banc : la Task 13 ne change que les chemins ci-dessous.
// (sealFinal : indispensable pour que openStream lise le manifeste d'un paquet complet.)
export { elementSealer, sealFinal } from "../src/crypto/elements";
export { openStream, CHUNK, CHUNK_CT, HEADER, SEG_CHUNKS, segmentCount, segmentSize } from "../src/crypto/container";
export { contentKeys, newSeed } from "../src/crypto/envelope";
export { passwordKey, KDF_CREATE } from "../src/crypto/kdf";
