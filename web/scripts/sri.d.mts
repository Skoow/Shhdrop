export function sha384(data: Uint8Array): string;
export function addSri(html: string, read: (rel: string) => Uint8Array | null, base?: string): string;
export function checkSri(page: string, html: string, read: (rel: string) => Uint8Array | null, base?: string): string[];
