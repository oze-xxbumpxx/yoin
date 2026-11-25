import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

const packageRelease = resolve("scripts/package-release.sh");
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const functions = ["api", "pre-sign-up", "notification-sender"];
let fixture: string;

beforeEach(() => {
  mkdirSync("dist", { recursive: true });
  fixture = mkdtempSync(resolve("dist/release-test-"));
  const files = ["dist/pwa/index.html", ...functions.map((name) => `dist/lambda/${name}/index.mjs`)];
  for (const file of files) {
    mkdirSync(join(fixture, dirname(file)), { recursive: true });
    writeFileSync(join(fixture, file), file);
  }
});

afterEach(() => rmSync(fixture, { force: true, recursive: true }));

it("packages the original PWA and Lambda builds under the checked-out full SHA", () => {
  execFileSync("bash", [packageRelease, revision], { cwd: fixture });
  const release = join(fixture, "dist/release");
  expect(readFileSync(join(release, "SHA"), "utf8").trim()).toBe(revision);
  expect(readFileSync(join(release, "pwa/index.html"), "utf8")).toBe("dist/pwa/index.html");
  for (const name of functions) {
    expect(execFileSync("unzip", ["-p", join(release, `lambda/${name}.zip`), "index.mjs"], {
      encoding: "utf8",
    })).toBe(`dist/lambda/${name}/index.mjs`);
  }
  writeFileSync(join(release, "pwa/index.html"), "changed");
  expect(spawnSync("sha256sum", ["-c", "SHA256SUMS"], { cwd: release, encoding: "utf8" }).stdout)
    .toContain("pwa/index.html: FAILED");
});

it.each(["wrong", "missing"])("does not package a %s revision or build", (failure) => {
  const wrongRevision = revision.replace(/^./u, revision.startsWith("0") ? "1" : "0");
  if (failure === "missing") {
    rmSync(join(fixture, "dist/lambda/api/index.mjs"));
  }
  expect(spawnSync("bash", [packageRelease, failure === "wrong" ? wrongRevision : revision], {
    cwd: fixture,
  }).status).not.toBe(0);
  expect(() => readFileSync(join(fixture, "dist/release/SHA"))).toThrow();
});
