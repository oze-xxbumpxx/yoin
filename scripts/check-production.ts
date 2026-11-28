import { readFile } from "node:fs/promises";
import { assertProductionFiles, assertVoidProductionFiles } from "./production-boundary.ts";

const markersPath = "tests/support/production-markers.json";
const markers: unknown = JSON.parse(await readFile(markersPath, "utf8"));
if (!Array.isArray(markers) || markers.length === 0
    || !markers.every((marker) => typeof marker === "string" && marker.length > 0)) {
  throw new Error("Expected a non-empty list of test-only auth markers");
}

if (!process.argv.includes("--skip-pwa")) {
  await assertProductionFiles("dist/pwa", markers);
}
await assertVoidProductionFiles(".", markers);
