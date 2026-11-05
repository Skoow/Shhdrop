import { svelte } from "@sveltejs/vite-plugin-svelte";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte()],
  // Build « navigateur » de Svelte : mount() des tests de composants (happy-dom). Les modules
  // sans DOM ne sont pas concernés.
  resolve: { conditions: ["browser"] },
  test: {
    environment: "node",
    // ui-e2e/ : tests Playwright (npm run test:ui), pas vitest.
    exclude: [...configDefaults.exclude, "ui-e2e/**"],
  },
});
