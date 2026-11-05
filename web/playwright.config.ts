import { defineConfig, devices } from "@playwright/test";

// PW_LOCAL_CHROMIUM=1 : poste (chemin local de cette machine, jamais utilisé en CI) de développement où le Chromium préinstallé
// n'est pas celui qu'attend @playwright/test (on ne lance jamais `playwright install` ici).
// En CI : `npx playwright install --with-deps chromium webkit`, sans cette variable.
const launchOptions = process.env.PW_LOCAL_CHROMIUM === "1" ? { executablePath: "/opt/pw-browsers/chromium" } : {};

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
  use: { trace: "retain-on-failure", screenshot: "off", video: "off" },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, launchOptions },
    },
    {
      name: "webkit-desktop",
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"], deviceScaleFactor: 1, launchOptions },
    },
    {
      name: "webkit-mobile",
      use: { ...devices["iPhone 15"], deviceScaleFactor: 1 },
    },
  ],
});
