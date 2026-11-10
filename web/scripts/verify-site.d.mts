import type { ReleaseManifest } from "./release-manifest.mjs";
export type VerifyOpts = {
  /** Durée maximale de chaque requête, en millisecondes (défaut : 15 000). */
  timeoutMs?: number;
};
/** Raison du refus de l'origine, ou null si elle est acceptée. */
export declare function checkOrigin(origin: string): string | null;
/** Raison du refus du manifeste (contenu non sûr), ou null. */
export declare function checkManifest(manifest: unknown): string | null;
/** Problèmes constatés : liste vide si le site sert exactement le manifeste ; arrêt au premier écart. */
export declare function verifySite(origin: string, manifest: ReleaseManifest, opts?: VerifyOpts): Promise<string[]>;
