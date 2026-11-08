export function buildFixtures(): Record<string, Uint8Array>;
export function zipBytes(entries: [string, Uint8Array, { store?: boolean }?][], comment?: string): Uint8Array;
