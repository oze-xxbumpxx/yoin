import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

const verifyScripts = resolve("scripts/require-quality-scripts.ts");
const required = { lint: "eslint .", "type-check": "tsc --noEmit", test: "vitest run" };
let fixture: string;

beforeEach(() => {
  mkdirSync("dist", { recursive: true });
  fixture = mkdtempSync(resolve("dist/quality-scripts-test-"));
});

afterEach(() => rmSync(fixture, { force: true, recursive: true }));

function verify(scripts: Record<string, string>) {
  writeFileSync(join(fixture, "package.json"), JSON.stringify({ scripts }));
  return spawnSync(process.execPath, [verifyScripts], { cwd: fixture, encoding: "utf8" });
}

it("accepts the required scripts without optional product scripts", () => {
  expect(verify(required).status).toBe(0);
});

it.each(Object.keys(required))("fails when the required %s script is missing", (name) => {
  const scripts = Object.fromEntries(Object.entries(required).filter(([key]) => key !== name));
  const result = verify(scripts);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`Missing required package.json scripts: ${name}`);
});
