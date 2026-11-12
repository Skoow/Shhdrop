import { defineConfig, devices } from "@playwright/test";

// PW_LOCAL_CHROMIUM=1 : poste (chemin local de cette machine, jamais utilisé en CI) de développement où le Chromium préinstallé
// n'est pas celui qu'attend @playwright/test (on ne lance jamais `playwright install` ici).
// En CI : `npx playwright install --with-deps chromium webkit`, sans cette variable.
const launchOptions = process.env.PW_LOCAL_CHROMIUM === "1" ? { executablePath: "/opt/pw-browsers/chromium" } : {};

const DEMO = /demo\.spec\.ts$/;

export default defineConfig({
  testDir: "ui-e2e",
  testMatch: /.*\.spec\.ts$/,
  globalSetup: "./ui-e2e/global-setup.ts",
  outputDir: "test-results",
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  forbidOnly: !!process.env.CI,
  // CI : arrêt après 20 échecs, pour que le rapport (avec les erreurs) sorte au lieu d'un job
  // de plusieurs heures quand tout un navigateur échoue (CI du 12 novembre : 94 échecs WebKit).
  maxFailures: process.env.CI ? 20 : 0,
  use: { trace: "retain-on-failure", screenshot: "off", video: "off" },
  // Démo GitHub Pages (UI §14.3) : demo.spec.ts sur ses propres projets seulement (un projet = un appareil).
  projects: [
    {
      name: "chromium-desktop",
      testIgnore: DEMO,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, launchOptions },
    },
    {
      name: "webkit-desktop",
      testIgnore: DEMO,
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
    {
      name: "chromium-mobile",
      testIgnore: DEMO,
      use: { ...devices["Pixel 7"], deviceScaleFactor: 1, launchOptions },
    },
    {
      name: "webkit-mobile",
      testIgnore: DEMO,
      use: { ...devices["iPhone 15"], deviceScaleFactor: 1 },
    },
    {
      name: "demo-chromium-mobile",
      testMatch: DEMO,
      use: { ...devices["Pixel 7"], deviceScaleFactor: 1, launchOptions },
    },
    {
      name: "demo-webkit-desktop",
      testMatch: DEMO,
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
  ],
});
