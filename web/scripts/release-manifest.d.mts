export type ReleaseMeta = { name: string; version: string; commit: string };
export type ReleaseFile = { path: string; size: number; sha256: string };
export type ReleaseManifest = { schema: 1; name: string; version: string; commit: string; files: ReleaseFile[] };
export declare function manifestOf(dir: string, meta: ReleaseMeta): ReleaseManifest;
export declare function serialize(manifest: ReleaseManifest): string;
export declare function sumsOf(manifest: ReleaseManifest): string;
