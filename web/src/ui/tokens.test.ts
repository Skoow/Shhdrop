import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composite, contrast, contrastFromLuminance, luminance } from "./contrast";

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
  ["--plus", "--surface-2", 5.7, 4.5],
  ["--plus", "--plus-tint", 5.8, 4.5],
  ["--plus", "--bg", 6.57, 4.5],
  ["--plus-line", "--surface-2", 4.58, 3],
  ["--plus-line", "--bg", 5.28, 3],
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

describe("icônes de format en couleur (retours UI6)", () => {
  const FMT = ["pdf", "doc", "sheet", "slides", "archive", "image", "video", "audio", "other"].map((f) => `--fmt-${f}`);
  const hue = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d === 0) return null;
    const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (x * 60 + 360) % 360;
  };
  const gap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  it("libellé --on-fmt ≥ 4,5:1 sur chaque pastille", () => {
    for (const k of FMT) expect(contrast(hex("--on-fmt"), hex(k)), k).toBeGreaterThanOrEqual(4.5);
  });
  it("teintes distinctes entre elles, du vert « vérifié » et du bleu Plus/Pro", () => {
    const hs = FMT.filter((k) => k !== "--fmt-other").map((k) => [k, hue(hex(k))!] as const);
    for (const [k, h] of hs) {
      expect(gap(h, hue(hex("--accent"))!), `${k} / --accent`).toBeGreaterThanOrEqual(12);
      expect(gap(h, hue(hex("--plus"))!), `${k} / --plus`).toBeGreaterThanOrEqual(12);
    }
    for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) expect(gap(hs[i]![1], hs[j]![1]), `${hs[i]![0]} / ${hs[j]![0]}`).toBeGreaterThanOrEqual(12);
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
      // retours UI4 : formules payantes
      "--plus", "--plus-tint", "--plus-line",
      // §20.3 matière et aurore
      "--bg-deep", "--hair", "--hair-2", "--vessel", "--edge-hi", "--seal-light", "--seal-halo",
      "--paper", "--ink", "--aur-mint-o", "--aur-tide-o", "--aur-ink-o",
      // §4.1 familles
      "--font-sans", "--font-mono",
      // §4.2
      "--fs-display", "--lh-display", "--fw-display", "--wd-display", "--ls-display",
      "--fs-h1", "--lh-h1", "--fw-h1", "--wd-h1",
      "--fs-h2", "--lh-h2", "--fw-h2", "--wd-h2",
      "--fs-h3", "--lh-h3", "--fw-h3", "--wd-h3",
      "--fs-body", "--lh-body", "--fw-body", "--wd-body",
      "--fs-small", "--lh-small", "--fw-small", "--wd-small",
      "--fs-micro", "--lh-micro", "--fw-micro", "--wd-micro",
      "--fs-mono", "--lh-mono", "--fw-mono", "--fs-mono-block",
      "--fs-figure", "--lh-figure", "--fw-figure", "--wd-figure", "--ls-figure",
      "--fs-ready", "--wd-ready", "--ls-ready", "--fs-screen", "--wd-screen",
      // §5
      "--sp-1", "--sp-2", "--sp-3", "--sp-4", "--sp-5", "--sp-6", "--sp-7", "--sp-8", "--sp-9",
      "--r-sm", "--r-md", "--r-lg", "--r-xl", "--r-2xl", "--r-pill",
      "--e-1", "--e-2", "--e-3", "--edge", "--e-vessel",
      // §7.2
      "--dur-instant", "--dur-fast", "--dur-base", "--dur-slow", "--dur-moment", "--dur-dissolve",
      "--ease-out", "--ease-in", "--ease-in-out",
      // §20.3 mouvement v2
      "--dur-press", "--dur-stagger", "--dur-view", "--dur-reveal", "--dur-orbit", "--dur-ambient",
      "--dur-ambient-2", "--dur-ambient-3", "--ease-view", "--rise", "--blur-in",
      // accueil v3
      "--fs-section", "--ease-settle",
      // icônes de format (UI6)
      "--fmt-pdf", "--fmt-doc", "--fmt-sheet", "--fmt-slides", "--fmt-archive", "--fmt-image", "--fmt-video", "--fmt-audio", "--fmt-other", "--on-fmt",
    ].sort();
    expect(names).toEqual(expected);
  });

  it("échelle typographique (§4.2)", () => {
    expect(T.get("--fs-display")).toBe("clamp(2.625rem, 1.1rem + 4.6vw, 5.5rem)");
    expect(T.get("--fs-h1")).toBe("1.75rem");
    expect(T.get("--fs-h2")).toBe("1.4375rem");
    expect(T.get("--fs-h3")).toBe("1.1875rem");
    expect(T.get("--fs-body")).toBe("1rem");
    expect(T.get("--fs-small")).toBe("0.875rem");
    expect(T.get("--fs-micro")).toBe("0.75rem");
    expect(T.get("--fs-mono")).toBe("1.0625rem");
    expect(T.get("--fs-mono-block")).toBe("1.25rem");
    expect(T.get("--fs-figure")).toBe("clamp(3.5rem, 2rem + 6vw, 5.5rem)");
    expect(T.get("--fw-display")).toBe("600");
    expect(T.get("--wd-display")).toBe("116%");
    expect(T.get("--ls-display")).toBe("-0.035em");
    expect(T.get("--fw-body")).toBe("430");
    expect(T.get("--lh-display")).toBe("0.98");
    expect(T.get("--fs-ready")).toBe("clamp(2rem, 1.4rem + 2.4vw, 3rem)");
    expect(T.get("--fs-screen")).toBe("clamp(1.75rem, 1.3rem + 1.8vw, 2.5rem)");
  });

  it("espacements, rayons, mouvement (§5, §7.2)", () => {
    const sp = [4, 8, 12, 16, 24, 32, 48, 64, 96];
    sp.forEach((px, i) => expect(T.get(`--sp-${i + 1}`)).toBe(`${px}px`));
    expect(T.get("--r-sm")).toBe("6px");
    expect(T.get("--r-md")).toBe("10px");
    expect(T.get("--r-lg")).toBe("16px");
    expect(T.get("--r-xl")).toBe("24px");
    expect(T.get("--r-2xl")).toBe("32px");
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

describe("direction artistique v2 (UI §20.3)", () => {
  it("valeurs exactes", () => {
    const expected: Record<string, string> = {
      "--bg-deep": "#07080C",
      "--hair": "rgb(233 236 242 / 0.08)",
      "--hair-2": "rgb(233 236 242 / 0.13)",
      "--vessel": "rgb(17 20 27 / 0.62)",
      "--edge-hi": "inset 0 1px 0 rgb(255 255 255 / 0.06)",
      "--seal-light": "#C9FBE8",
      "--seal-halo": "rgb(95 227 181 / 0.28)",
      "--paper": "#EEF1F5",
      "--ink": "#0B0D12",
      "--aur-mint-o": "0.18",
      "--aur-tide-o": "0.34",
      "--aur-ink-o": "0.32",
      "--r-2xl": "32px",
      "--e-vessel": "0 40px 80px -32px rgb(0 0 0 / 0.75), 0 12px 24px -12px rgb(0 0 0 / 0.5)",
      "--dur-press": "90ms",
      "--dur-stagger": "45ms",
      "--dur-view": "420ms",
      "--dur-reveal": "560ms",
      "--dur-orbit": "7.2s",
      "--dur-ambient": "46s",
      "--dur-ambient-2": "58s",
      "--dur-ambient-3": "64s",
      "--ease-view": "cubic-bezier(0.22, 1, 0.36, 1)",
      "--rise": "14px",
      "--blur-in": "6px",
    };
    for (const [k, v] of Object.entries(expected)) expect(T.get(k), k).toBe(v);
  });

  it("accueil v3 : courbe qui se pose sans jamais dépasser 1 (aucun rebond, règle v1)", () => {
    const ease = T.get("--ease-settle")!;
    const values = [...ease.matchAll(/(?:\(|,)\s*([\d.]+)/g)].map((m) => Number(m[1]));
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(1);
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
    for (const v of values) expect(v).toBeLessThanOrEqual(1);
    expect(T.get("--fs-section")).toBe("clamp(2rem, 1.35rem + 2.4vw, 3.25rem)");
    const expected: Record<string, string> = {};
    for (const [k, v] of Object.entries(expected)) expect(T.get(k), k).toBe(v);
  });

  // K5 : l'aurore plafonne à une luminance relative de 0,050 derrière le texte. À ce plafond,
  // --text-2 garde 4,70:1 ; --text-3 tombe à 3,4:1, d'où la règle « --text-3 jamais sur l'aurore ».
  it("plafond K5 : --text-2 ≥ 4,70 et --text-3 < 4,5 sur une luminance de 0,050", () => {
    expect(contrastFromLuminance(luminance(hex("--text-2")), 0.05)).toBeGreaterThanOrEqual(4.7);
    expect(contrastFromLuminance(luminance(hex("--text-3")), 0.05)).toBeLessThan(4.5);
  });

  it("contrastFromLuminance : symétrique et cohérent avec contrast()", () => {
    expect(contrastFromLuminance(1, 0)).toBeCloseTo(21, 5);
    expect(contrastFromLuminance(0.2, 0.6)).toBeCloseTo(contrastFromLuminance(0.6, 0.2), 10);
    expect(contrastFromLuminance(luminance("#E9ECF2"), luminance("#0B0D12"))).toBeCloseTo(
      contrast("#E9ECF2", "#0B0D12"),
      10,
    );
  });

  it("K6 : aucune règle qui utilise --vessel n'a de backdrop-filter (src/**/*.css, *.svelte)", () => {
    const srcDir = dirname(here);
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : /\.(css|svelte)$/.test(e.name) ? [join(d, e.name)] : [],
      );
    let rules = 0;
    for (const f of walk(srcDir)) {
      const text = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      // Corps de règle le plus intérieur : ce qui est entre une « { » et la « } » suivante.
      for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
        if (!/var\(--vessel\)/.test(m[1]!)) continue;
        rules++;
        expect(m[1], f).not.toMatch(/backdrop-filter/);
      }
    }
    expect(rules).toBeGreaterThan(0);
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
  it("index.html : ni style=, ni <style>, ni script en ligne, ni URL http(s)", () => {
    const html = readFileSync(join(webDir, "index.html"), "utf8");
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(/<style[\s>]/i);
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const t of scripts) expect(t).toMatch(/\ssrc\s*=/i);
    expect(html).not.toMatch(/https?:\/\//i);
  });
  it("forced-colors : ::selection en HighlightText sur Highlight", () => {
    const block = /@media \(forced-colors: active\)\s*\{([\s\S]*)\}\s*$/.exec(css);
    expect(block).not.toBeNull();
    expect(block![1]).toMatch(/::selection\s*\{[^}]*color:\s*HighlightText/);
    expect(block![1]).toMatch(/--selection:\s*Highlight;/);
  });
  it("package.json : engines.node couvre zlib.crc32 (>= 22.2)", () => {
    const pkg = JSON.parse(readFileSync(join(webDir, "package.json"), "utf8"));
    expect(pkg.engines?.node).toBe(">=22.2.0");
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
  /** IHDR + pixels décodés (inflate de l'IDAT) : indépendant de la version de zlib. */
  function decode(buf: Buffer) {
    let off = 8;
    let ihdr: Buffer = Buffer.alloc(0);
    const idat: Buffer[] = [];
    while (off < buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.subarray(off + 4, off + 8).toString("latin1");
      const data = buf.subarray(off + 8, off + 8 + len);
      if (type === "IHDR") ihdr = data;
      if (type === "IDAT") idat.push(data);
      off += 12 + len;
    }
    return { ihdr, pixels: inflateSync(Buffer.concat(idat)) };
  }
  it("déterministe : gen-grain.mjs reproduit l'en-tête et les pixels du fichier commité", async () => {
    // @ts-expect-error module .mjs sans déclarations
    const { buildGrain } = await import("../../scripts/gen-grain.mjs");
    const a = decode(buildGrain());
    const b = decode(png);
    expect(a.ihdr.equals(b.ihdr)).toBe(true);
    expect(a.pixels.length).toBe(128 * (1 + 128 * 2));
    expect(a.pixels.equals(b.pixels)).toBe(true);
  });
});

describe("Icon.ts (UI §6, jeu maison UI8)", () => {
  const ICONS = [
    "paperclip", "camera", "mic", "square", "type", "x", "pencil", "grip-vertical", "arrow-up",
    "arrow-down", "lock", "lock-open", "shield-check", "shield-alert", "triangle-alert", "copy",
    "check", "share-2", "qr-code", "refresh-cw", "eye", "eye-off", "clock", "timer", "pause", "play",
    "download", "file", "file-text", "image", "music", "film", "trash-2", "flag", "chevron-left",
    "wifi-off", "clipboard-x", "circle-help", "minus", "plus", "info", "link-2", "key-round",
    "server", "user-x", "hard-drive", "code-xml", "chevron-down", "arrow-right", "shield-x",
    "ellipsis", "sliders-horizontal", "file-archive", "upload", "compass", "server-crash",
    "hourglass", "wrench", "monitor-x", "send",
  ];
  const pascal = (s: string) =>
    s.split("-").map((p) => p[0]!.toUpperCase() + p.slice(1)).join("");
  const src = read("Icon.ts");
  const exports = [...src.matchAll(/export\s*\{\s*default as (\w+)\s*\}\s*from\s*"([^"]+)"/g)];
  it("exporte exactement la liste fermée, un fichier maison par icône", () => {
    expect(exports.map((m) => m[1]).sort()).toEqual(ICONS.map(pascal).sort());
    for (const m of exports) expect(m[2]).toBe(`./icons/${m[1]}.svelte`);
    expect(src.match(/\bexport\b/g)?.length).toBe(ICONS.length);
  });
  it("chaque icône dessine son glyphe, sur la grille 24, sans rien d'extérieur", () => {
    const glyphs = read("icons/glyphs.ts");
    for (const slug of ICONS) {
      const f = read(`icons/${pascal(slug)}.svelte`);
      expect(f).toContain(`<Glyph {...props} name="${slug}" />`);
      expect(glyphs).toContain(`"${slug}": [`);
    }
    const glyph = read("icons/Glyph.svelte");
    expect(glyph).toContain('viewBox="0 0 24 24"');
    expect(glyph).toContain("strokeWidth = 1.75");
    expect(glyph).toContain('stroke-linecap="round"');
    expect(glyph).toContain('stroke-linejoin="round"');
    expect(glyph + glyphs).not.toMatch(/https?:|lucide|@html/i);
  });
  it("aucune dépendance d'icônes tierce", () => {
    const pkg = readFileSync(join(webDir, "package.json"), "utf8");
    expect(pkg).not.toContain("lucide");
  });
});
