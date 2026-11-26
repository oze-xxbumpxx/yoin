import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.{test,spec}.{js,ts,jsx,tsx,mjs,mts,cjs,cts}"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
