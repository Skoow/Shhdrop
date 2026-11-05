import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // ui-e2e/ : tests Playwright (npm run test:ui), pas vitest.
    exclude: [...configDefaults.exclude, "ui-e2e/**"],
  },
});
