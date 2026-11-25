import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { build } from "esbuild";
import { assertProductionInput } from "./production-boundary.ts";

const functions = ["api", "pre-sign-up", "notification-sender"];
const entryPoints = functions
  .map((name) => ({ in: `src/functions/${name}/index.ts`, out: `${name}/index` }))
  .filter((entry) => existsSync(entry.in));

if (entryPoints.length === 0) {
  throw new Error("No first-slice Lambda entrypoints to build");
}

const result = await build({
  entryPoints,
  outdir: "dist/lambda",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  target: "node24",
  format: "esm",
  bundle: true,
  metafile: true,
  write: false,
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});

for (const path of Object.keys(result.metafile.inputs)) {
  assertProductionInput(path);
}

for (const file of result.outputFiles) {
  await mkdir(dirname(file.path), { recursive: true });
  await writeFile(file.path, file.contents);
}
