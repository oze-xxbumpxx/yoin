import { defineConfig } from "vite";
import { assertProductionInput } from "../../scripts/production-boundary.ts";

export default defineConfig(({ command }) => ({
  envDir: command === "build" ? false : ".",
  envPrefix: command === "build" ? [] : "VITE_",
  build: { outDir: "../../dist/pwa", emptyOutDir: true },
  plugins: [{
    name: "production-inputs",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === "chunk") {
          for (const input of Object.keys(output.modules)) {
            assertProductionInput(input);
          }
        }
      }
    },
  }],
}));
