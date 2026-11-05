import { describe, expect, it } from "vitest";
import { inAppBrowser, isSupported, lowMemory } from "./env";

const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const WV = (model: string) =>
  `Mozilla/5.0 (Linux; Android 14; ${model}; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.66 Mobile Safari/537.36`;

// Agents relevés sur de vrais appareils (forme publiée par chaque application).
const IN_APP: [string, string][] = [
  [`${IOS} Instagram 307.0.0.34.111 (iPhone15,3; iOS 17_1; fr_FR; fr; scale=3.00; 1290x2796; 532277534)`, "Instagram"],
  [`${WV("Pixel 8 Build/UD1A.230803.041")} Instagram 307.0.0.34.111 Android (34/14; 420dpi; 1080x2205; Google/google; Pixel 8; shiba; shiba; fr_FR; 532277534)`, "Instagram"],
  [`${IOS} [FBAN/FBIOS;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/17.1;FBSS/3;FBID/phone;FBLC/fr_FR;FBOP/5;FBRV/0]`, "Facebook"],
  [`${WV("SM-S911B Build/TP1A.220624.014")} [FB_IAB/FB4A;FBAV/440.0.0.31.105;]`, "Facebook"],
  [`${IOS} [FBAN/MessengerForiOS;FBAV/437.0.0.36.117;FBBV/577446920;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.0;FBSS/3;FBCR/;FBID/phone;FBLC/fr_FR;FBOP/5]`, "Messenger"],
  [`${WV("SM-G991B Build/TP1A.220624.014")} [FB_IAB/Orca-Android;FBAV/435.0.0.27.109;]`, "Messenger"],
  [`${IOS} [LinkedInApp]/9.29.6`, "LinkedIn"],
  [`${IOS} Snapchat/12.60.0.43 (like Safari/8616.2.9.10.9, panda)`, "Snapchat"],
  [`${IOS} musical_ly_32.5.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/fr Region/FR`, "TikTok"],
  [`${WV("SM-A536B Build/TP1A.220624.014")} trill_320405 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/trill app_version/32.4.5 ByteLocale/fr ByteFullLocale/fr Region/FR BytedanceWebview/d8a21c6`, "TikTok"],
  [`${IOS} Safari Line/13.19.0`, "LINE"],
  [`${WV("Pixel 7 Build/UQ1A.240205.002")} Telegram-Android/10.8.1 (Google Pixel 7; Android 14; SDK 34; HIGH)`, "Telegram"],
  [`${IOS} MicroMessenger/8.0.44(0x18002c2b) NetType/WIFI Language/zh_CN`, "WeChat"],
];

const ORDINARY = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.1; rv:133.0) Gecko/20100101 Firefox/133.0",
  `${IOS.replace("Mobile/15E148", "Version/17.1 Mobile/15E148 Safari/604.1")}`,
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
];

describe("inAppBrowser", () => {
  it.each(IN_APP)("%s → %s", (ua, app) => expect(inAppBrowser(ua, false)).toBe(app));
  it.each(ORDINARY)("navigateur ordinaire : %s → null", (ua) => expect(inAppBrowser(ua, false)).toBeNull());
  it("une PWA installée n'est jamais signalée", () => {
    for (const [ua] of IN_APP) expect(inAppBrowser(ua, true)).toBeNull();
  });
  it("agent vide → null", () => expect(inAppBrowser("", false)).toBeNull());
});

// Environnement complet (le Node de vitest a tout), puis une capacité retirée à la fois.
function full(): Record<string, unknown> {
  return {
    crypto: { subtle: {}, getRandomValues: () => {} },
    WebAssembly: {},
    Blob: { prototype: { stream: () => {} } },
    TextDecoder: function TextDecoder() {},
    AbortController: function AbortController() {},
  };
}
const asGlobal = (g: Record<string, unknown>) => g as unknown as typeof globalThis;

describe("isSupported (UI §9)", () => {
  it("vrai avec toutes les capacités, et sans Worker", () => {
    expect(isSupported(globalThis)).toBe(true);
    const g = full();
    expect("Worker" in g).toBe(false);
    expect(isSupported(asGlobal(g))).toBe(true);
  });

  const without: [string, (g: Record<string, unknown>) => void][] = [
    ["crypto", (g) => delete g.crypto],
    ["crypto.subtle", (g) => ((g.crypto as Record<string, unknown>).subtle = undefined)],
    ["crypto.getRandomValues", (g) => delete (g.crypto as Record<string, unknown>).getRandomValues],
    ["WebAssembly", (g) => delete g.WebAssembly],
    ["Blob", (g) => delete g.Blob],
    ["Blob.prototype.stream", (g) => delete (g.Blob as { prototype: Record<string, unknown> }).prototype.stream],
    ["TextDecoder", (g) => delete g.TextDecoder],
    ["AbortController", (g) => delete g.AbortController],
  ];
  it.each(without)("faux sans %s", (_, drop) => {
    const g = full();
    drop(g);
    expect(isSupported(asGlobal(g))).toBe(false);
  });
});

describe("lowMemory (UI §9.8)", () => {
  const MiB = 1024 * 1024;
  const nav = (o: { deviceMemory?: number; userAgent?: string; maxTouchPoints?: number }) =>
    ({ userAgent: ORDINARY[0], maxTouchPoints: 0, ...o }) as unknown as Navigator;

  it("au plus 200 Mio : jamais", () => {
    expect(lowMemory(nav({ deviceMemory: 1 }), 200 * MiB)).toBe(false);
    expect(lowMemory(nav({ userAgent: IOS }), 200 * MiB)).toBe(false);
  });
  it("au-delà de 200 Mio : deviceMemory < 4", () => {
    expect(lowMemory(nav({ deviceMemory: 2 }), 200 * MiB + 1)).toBe(true);
    expect(lowMemory(nav({ deviceMemory: 4 }), 200 * MiB + 1)).toBe(false);
    expect(lowMemory(nav({}), 300 * MiB)).toBe(false); // inconnu hors iOS
  });
  it("au-delà de 200 Mio : iPhone, iPad (y compris l'agent « Macintosh » d'iPadOS)", () => {
    expect(lowMemory(nav({ userAgent: IOS }), 300 * MiB)).toBe(true);
    expect(lowMemory(nav({ userAgent: IOS.replace("iPhone; CPU iPhone OS", "iPad; CPU OS") }), 300 * MiB)).toBe(true);
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15";
    expect(lowMemory(nav({ userAgent: mac, maxTouchPoints: 5 }), 300 * MiB)).toBe(true);
    expect(lowMemory(nav({ userAgent: mac, maxTouchPoints: 0 }), 300 * MiB)).toBe(false);
  });
});
