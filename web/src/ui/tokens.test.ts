import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composite, contrast } from "./contrast";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = dirname(dirname(here));
const read = (p: string) => readFileSync(join(here, p), "utf8");
const css = read("tokens.css");

/** Jetons de `:root` (premier bloc), nom -> valeur. */
function rootTokens(): Map<string, string> {
  const m = /:root\s*\{([^}]*)\}/.exec(css);
  expect(m).not.toBeNull();
  const out = new Map<string, string>();
  for (const d of m![1]!.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(d[1]!, d[2]!.trim().replace(/\s+/g, " "));
  }
  return out;
}
const T = rootTokens();
const hex = (name: string): string => {
  const v = T.get(name);
  expect(v, name).toMatch(/^#[0-9A-Fa-f]{6}$/);
  return v!;
};

describe("contrast()", () => {
  it("blanc / noir ≈ 21", () =>
    expect(contrast("#FFFFFF", "#000000")).toBeCloseTo(21, 5));
  it("identique = 1", () => expect(contrast("#5FE3B5", "#5FE3B5")).toBeCloseTo(1, 5));
  it("symétrique", () =>
    expect(contrast("#0B0D12", "#E9ECF2")).toBeCloseTo(contrast("#E9ECF2", "#0B0D12"), 10));
});

// UI §3.2 : [premier plan, fond, ratio publié, seuil]
const PAIRS: [string, string, number, number][] = [
  ["--text", "--bg", 16.42, 4.5],
  ["--text", "--surface-2", 14.24, 4.5],
  ["--text", "--surface-3", 12.92, 4.5],
  ["--text-2", "--surface-2", 7.55, 4.5],
  ["--text-2", "--surface-3", 6.85, 4.5],
  ["--text-3", "--surface-2", 5.45, 4.5],
  ["--accent", "--bg", 12.16, 3],
  ["--on-accent", "--accent", 11.8, 4.5],
  ["--on-accent", "--accent-hover", 13.45, 4.5],
  ["--danger", "--surface-2", 7.38, 4.5],
  ["--on-danger", "--danger", 8.58, 4.5],
  ["--danger", "--danger-tint", 7.61, 4.5],
  ["--warn", "--warn-tint", 9.57, 4.5],
  ["--warn", "--surface-2", 10.34, 4.5],
  ["--accent", "--accent-tint", 9.54, 4.5],
  ["--info", "--surface-2", 7.98, 4.5],
  ["--line-strong", "--surface-2", 3.5, 3],
];

describe("jetons de couleur (UI §3.1, §3.2)", () => {
  for (const [fg, bg, published, min] of PAIRS) {
    it(`${fg} / ${bg} ≥ ${min} et conforme à la spécification (${published})`, () => {
      const r = contrast(hex(fg), hex(bg));
      expect(r).toBeGreaterThanOrEqual(min);
      expect(Math.abs(r - published)).toBeLessThan(0.011);
    });
  }

  it("verre sur fond blanc : --text passe, --text-2 reste interdit", () => {
    const m = /rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)/.exec(T.get("--glass") ?? "");
    expect(m).not.toBeNull();
    const [r, g, b, a] = [Number(m![1]), Number(m![2]), Number(m![3]), Number(m![4])];
    const worst = composite([r, g, b], a, [255, 255, 255]);
    expect(contrast(hex("--text"), worst)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex("--text"), worst)).toBeCloseTo(8.26, 1);
    expect(contrast(hex("--text-2"), worst)).toBeLessThan(4.5);
    expect(contrast(hex("--text-2"), worst)).toBeCloseTo(4.38, 1);
  });

  it("valeurs de UI §3.1 reproduites à l'identique", () => {
    const expected: Record<string, string> = {
      "--bg": "#0B0D12", "--surface-1": "#12151C", "--surface-2": "#191D27",
      "--surface-3": "#202533", "--glass": "rgb(18 21 28 / 0.80)", "--line": "#262B36",
      "--line-strong": "#68728A", "--text": "#E9ECF2", "--text-2": "#A6AEBD",
      "--text-3": "#8A93A4", "--text-disabled": "#5A6275", "--accent": "#5FE3B5",
      "--accent-hover": "#86EDC9", "--on-accent": "#05140F", "--accent-tint": "#102A23",
      "--danger": "#FF8A80", "--on-danger": "#1A0605", "--danger-tint": "#2A1414",
      "--warn": "#F2C46D", "--warn-tint": "#2A2312", "--info": "#8DB2FF",
      "--selection": "rgb(95 227 181 / 0.28)", "--scrim": "rgb(5 7 10 / 0.72)",
    };
    for (const [k, v] of Object.entries(expected)) expect(T.get(k), k).toBe(v);
  });
});

describe("autres jetons (UI §4.2, §5, §7.2)", () => {
  it("jeu exact de jetons", () => {
    const names = [...T.keys()].sort();
    const expected = [
      // §3.1
      "--bg", "--surface-1", "--surface-2", "--surface-3", "--glass", "--line", "--line-strong",
      "--text", "--text-2", "--text-3", "--text-disabled", "--accent", "--accent-hover",
      "--on-accent", "--accent-tint", "--danger", "--on-danger", "--danger-tint", "--warn",
      "--warn-tint", "--info", "--selection", "--scrim",
      // §4.1 familles
      "--font-sans", "--font-mono",
      // §4.2
      "--fs-display", "--lh-display", "--fw-display", "--wd-display",
      "--fs-h1", "--lh-h1", "--fw-h1", "--wd-h1",
      "--fs-h2", "--lh-h2", "--fw-h2", "--wd-h2",
      "--fs-h3", "--lh-h3", "--fw-h3", "--wd-h3",
      "--fs-body", "--lh-body", "--fw-body", "--wd-body",
      "--fs-small", "--lh-small", "--fw-small", "--wd-small",
      "--fs-micro", "--lh-micro", "--fw-micro", "--wd-micro",
      "--fs-mono", "--lh-mono", "--fw-mono", "--fs-mono-block",
      "--fs-figure", "--lh-figure", "--fw-figure", "--wd-figure",
      // §5
      "--sp-1", "--sp-2", "--sp-3", "--sp-4", "--sp-5", "--sp-6", "--sp-7", "--sp-8", "--sp-9",
      "--r-sm", "--r-md", "--r-lg", "--r-xl", "--r-pill",
      "--e-1", "--e-2", "--e-3", "--edge",
      // §7.2
      "--dur-instant", "--dur-fast", "--dur-base", "--dur-slow", "--dur-moment", "--dur-dissolve",
      "--ease-out", "--ease-in", "--ease-in-out",
    ].sort();
    expect(names).toEqual(expected);
  });

  it("échelle typographique (§4.2)", () => {
    expect(T.get("--fs-display")).toBe("clamp(2.5rem, 1.6rem + 4vw, 4.25rem)");
    expect(T.get("--fs-h1")).toBe("1.75rem");
    expect(T.get("--fs-h2")).toBe("1.4375rem");
    expect(T.get("--fs-h3")).toBe("1.1875rem");
    expect(T.get("--fs-body")).toBe("1rem");
    expect(T.get("--fs-small")).toBe("0.875rem");
    expect(T.get("--fs-micro")).toBe("0.75rem");
    expect(T.get("--fs-mono")).toBe("1.0625rem");
    expect(T.get("--fs-mono-block")).toBe("1.25rem");
    expect(T.get("--fs-figure")).toBe("2.75rem");
    expect(T.get("--fw-display")).toBe("620");
    expect(T.get("--wd-display")).toBe("118%");
    expect(T.get("--fw-body")).toBe("430");
    expect(T.get("--lh-display")).toBe("1.02");
  });

  it("espacements, rayons, mouvement (§5, §7.2)", () => {
    const sp = [4, 8, 12, 16, 24, 32, 48, 64, 96];
    sp.forEach((px, i) => expect(T.get(`--sp-${i + 1}`)).toBe(`${px}px`));
    expect(T.get("--r-sm")).toBe("6px");
    expect(T.get("--r-md")).toBe("10px");
    expect(T.get("--r-lg")).toBe("16px");
    expect(T.get("--r-xl")).toBe("24px");
    expect(T.get("--r-pill")).toBe("999px");
    expect(T.get("--dur-instant")).toBe("120ms");
    expect(T.get("--dur-fast")).toBe("180ms");
    expect(T.get("--dur-base")).toBe("240ms");
    expect(T.get("--dur-slow")).toBe("400ms");
    expect(T.get("--dur-moment")).toBe("640ms");
    expect(T.get("--dur-dissolve")).toBe("1100ms");
    expect(T.get("--ease-out")).toBe("cubic-bezier(0.16, 1, 0.3, 1)");
    expect(T.get("--ease-in")).toBe("cubic-bezier(0.7, 0, 0.84, 0)");
    expect(T.get("--ease-in-out")).toBe("cubic-bezier(0.65, 0, 0.35, 1)");
    expect(T.get("--e-1")).toBe("0 1px 2px rgb(0 0 0 / 0.40)");
    expect(T.get("--e-2")).toBe(
      "0 8px 24px -8px rgb(0 0 0 / 0.60), 0 2px 6px rgb(0 0 0 / 0.35)",
    );
    expect(T.get("--e-3")).toBe("0 24px 64px -16px rgb(0 0 0 / 0.70)");
    expect(T.get("--edge")).toBe("inset 0 1px 0 rgb(255 255 255 / 0.05)");
  });
});

describe("thème unique sombre et contraste forcé", () => {
  it("color-scheme: dark, aucun prefers-color-scheme (ni dans base.css)", () => {
    expect(css).toMatch(/color-scheme:\s*dark/);
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(read("base.css")).not.toMatch(/prefers-color-scheme/);
    expect(read("fonts.css")).not.toMatch(/prefers-color-scheme/);
  });
  it("bloc forced-colors (UI §3.3)", () => {
    expect(css).toMatch(/@media \(forced-colors: active\)/);
    expect(css).toMatch(/CanvasText/);
    expect(css).toMatch(/Highlight/);
  });
  it("aucune ressource externe ni data:", () => {
    for (const f of ["tokens.css", "base.css", "fonts.css"]) {
      const t = read(f);
      expect(t, f).not.toMatch(/https?:|\/\/[a-z]|data:|@import/i);
    }
  });
});

describe("polices hébergées (UI §4.1)", () => {
  const sha = (p: string) =>
    createHash("sha256").update(readFileSync(join(webDir, "public", "fonts", p))).digest("hex");
  it("Mona Sans : empreinte et taille", () => {
    const f = "mona-sans-latin-standard-normal.woff2";
    expect(sha(f)).toBe("5ea3740633e5ac7af56c13d7e8ec32bcae12e7723e53d34284469a8947ccb2f3");
    expect(readFileSync(join(webDir, "public", "fonts", f)).length).toBe(98124);
  });
  it("JetBrains Mono : empreinte et taille", () => {
    const f = "jetbrains-mono-latin-wght-normal.woff2";
    expect(sha(f)).toBe("18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e");
    expect(readFileSync(join(webDir, "public", "fonts", f)).length).toBe(40404);
  });
  it("fonts.css : seulement des url(/fonts/…), font-display swap", () => {
    const t = read("fonts.css");
    const urls = [...t.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1]);
    expect(urls.length).toBe(2);
    for (const u of urls) expect(u).toMatch(/^\/fonts\/[a-z0-9-]+\.woff2$/);
    expect(t.match(/font-display:\s*swap/g)?.length).toBe(2);
    expect(t).toMatch(/font-weight:\s*200 900/);
    expect(t).toMatch(/font-stretch:\s*75% 125%/);
    expect(t).toMatch(/font-weight:\s*100 800/);
    expect(t).toMatch(/unicode-range/);
  });
  it("index.html : préchargement de Mona Sans seulement", () => {
    const html = readFileSync(join(webDir, "index.html"), "utf8");
    const pre = [...html.matchAll(/<link[^>]*rel="preload"[^>]*>/g)].map((m) => m[0]);
    expect(pre.length).toBe(1);
    expect(pre[0]).toContain("/fonts/mona-sans-latin-standard-normal.woff2");
    expect(pre[0]).toContain("crossorigin");
  });
});

describe("grain (UI §7.4)", () => {
  const png = readFileSync(join(webDir, "public", "assets", "grain.png"));
  it("PNG 128 × 128", () => {
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(128);
    expect(png.readUInt32BE(20)).toBe(128);
  });
  it("déterministe : gen-grain.mjs reproduit le fichier commité", async () => {
    // @ts-expect-error module .mjs sans déclarations
    const { buildGrain } = await import("../../scripts/gen-grain.mjs");
    expect(Buffer.compare(buildGrain(), png)).toBe(0);
  });
});

describe("Icon.ts (UI §6)", () => {
  const ICONS = [
    "paperclip", "camera", "mic", "square", "type", "clipboard-paste", "x", "undo-2", "pencil",
    "grip-vertical", "arrow-up", "arrow-down", "lock", "lock-open", "shield-check",
    "shield-alert", "triangle-alert", "copy", "check", "share-2", "qr-code", "refresh-cw", "eye",
    "eye-off", "clock", "timer", "pause", "play", "download", "file", "file-text", "image",
    "music", "audio-lines", "film", "folder-x", "trash-2", "flag", "external-link",
    "chevron-left", "languages", "wifi-off", "clipboard-x", "circle-help",
  ];
  const pascal = (s: string) =>
    s.split("-").map((p) => p[0]!.toUpperCase() + p.slice(1)).join("");
  const src = read("Icon.ts");
  const exports = [...src.matchAll(/export\s*\{\s*default as (\w+)\s*\}\s*from\s*"([^"]+)"/g)];
  it("exporte exactement la liste fermée, un import par icône", () => {
    expect(exports.map((m) => m[1]).sort()).toEqual(ICONS.map(pascal).sort());
    for (const m of exports) {
      const slug = m[2]!.replace("@lucide/svelte/icons/", "");
      expect(m[2]).toBe(`@lucide/svelte/icons/${slug}`);
      expect(pascal(slug)).toBe(m[1]);
    }
    expect(src.match(/\bexport\b/g)?.length).toBe(ICONS.length);
  });
  it("chaque icône se résout dans le paquet installé", () => {
    for (const m of exports) {
      const slug = m[2]!.replace("@lucide/svelte/icons/", "");
      const f = join(webDir, "node_modules/@lucide/svelte/dist/icons", `${slug}.js`);
      expect(() => readFileSync(f), slug).not.toThrow();
    }
  });
});
