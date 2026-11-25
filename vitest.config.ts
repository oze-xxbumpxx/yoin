import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/tests/**/*.{test,spec}.{js,ts,jsx,tsx,mjs,mts,cjs,cts}"],
    exclude: [
      ...configDefaults.exclude,
      "**/dist/**",
      ".claude/**",
      ".agents/**",
      "tests/e2e/**",
      "tests/integration/**",
    ],
  },
});
