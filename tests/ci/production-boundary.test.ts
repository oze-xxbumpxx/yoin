import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build, resolveConfig } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertProductionFiles, assertVoidProductionFiles } from "../../scripts/production-boundary.ts";

const configFile = resolve("apps/web/vite.config.ts");
let fixture: string;

beforeEach(async () => {
  await mkdir("dist", { recursive: true });
  fixture = await mkdtemp(resolve("dist/production-test-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(fixture, { force: true, recursive: true });
});

async function writeViteEntry(source: string) {
  await writeFile(join(fixture, "index.html"), '<script type="module" src="/entry.ts"></script>');
  await writeFile(join(fixture, "entry.ts"), source);
}

function buildFixture() {
  return build({ root: fixture, configFile, logLevel: "silent", build: { outDir: "out" } });
}

it("does not load environment values in Vite dev or E2E configuration", async () => {
  vi.stubEnv("VITE_FROM_PROCESS", "process-only-value");
  await writeFile(join(fixture, ".env.development"), "VITE_FROM_FILE=file-only-value\n");
  const config = await resolveConfig({ root: fixture, configFile, logLevel: "silent" }, "serve");

  expect(config.env).not.toHaveProperty("VITE_FROM_PROCESS");
  expect(config.env).not.toHaveProperty("VITE_FROM_FILE");
});

describe("production build guards", () => {
  it("builds without values from Vite environment variables or .env files", async () => {
    vi.stubEnv("VITE_FROM_PROCESS", "process-only-value");
    await writeFile(join(fixture, ".env.production"), "VITE_FROM_FILE=file-only-value\n");
    const config = await resolveConfig({ root: fixture, configFile, logLevel: "silent" }, "build", "production");
    expect(config.env).not.toHaveProperty("VITE_FROM_PROCESS");
    expect(config.env).not.toHaveProperty("VITE_FROM_FILE");
    await writeViteEntry(`document.body.textContent = JSON.stringify([
      import.meta.env.MODE, import.meta.env.DEV, import.meta.env.PROD,
      import.meta.env.BASE_URL, import.meta.env.SSR,
    ]);`);
    await buildFixture();

    const output = join(fixture, "out");
    await expect(readFile(join(output, "index.html"), "utf8")).resolves.toContain("assets/");
    await expect(assertProductionFiles(output, ["process-only-value", "file-only-value"])).resolves.toBeUndefined();
  });

  it.each([
    ["custom property", "document.title = import.meta.env.VITE_API_URL;"],
    ["bracket access", 'document.title = import.meta.env["VITE_API_URL"];'],
    ["bracket access to a built-in", 'document.title = import.meta.env["MODE"];'],
    ["bracket access to env", 'document.title = import.meta["env"].MODE;'],
    ["destructuring", "const { VITE_API_URL } = import.meta.env; document.title = VITE_API_URL;"],
    ["aliasing env", "const env = import.meta.env; document.title = env.MODE;"],
  ])("rejects %s before Vite substitutes import.meta.env", async (_name, source) => {
    await writeViteEntry(source);

    await expect(buildFixture()).rejects.toThrow("Only direct Vite built-ins may use import.meta.env");
  });

  it("rejects forbidden environment reads in inline HTML modules", async () => {
    await writeFile(join(fixture, "index.html"),
      '<script type="module">document.title = import.meta.env.VITE_API_URL;</script>');

    await expect(buildFixture()).rejects.toThrow("Only direct Vite built-ins may use import.meta.env");
  });

  it("rejects a Vite bundle that imports an E2E auth entrypoint", async () => {
    await mkdir(join(fixture, "tests/support"), { recursive: true });
    await writeFile(join(fixture, "tests/support/auth-entry.ts"), 'export const issuer = "test";');
    await writeViteEntry('import { issuer } from "./tests/support/auth-entry.ts"; document.title = issuer;');

    await expect(buildFixture()).rejects.toThrow("Test input is not allowed in a production bundle");
  });

  it.each([
    ["adapter.cjs", "const issuer = 'https://test-issuer.invalid';", "Test-only auth material"],
    ["adapter.cjs", "const key = 'test-jwt-key-marker';", "Test-only auth material"],
    ["signing.key", "fixture", "Forbidden file"],
  ])("rejects forbidden output in %s", async (file, contents, message) => {
    await writeFile(join(fixture, file), contents);
    await expect(assertProductionFiles(
      fixture,
      ["https://test-issuer.invalid", "test-jwt-key-marker"],
    )).rejects.toThrow(message);
  });
});

describe("optional Void production outputs", () => {
  const marker = "test-auth-fixture";
  const outputs = [
    ".cloudflare/output/v1/workers/default/bundle",
    ".cloudflare/output/v1/workers/another/assets",
    "dist/ssr",
    "dist/client",
  ];

  it("allows a checkout without Void outputs", async () => {
    await mkdir(join(fixture, "dist/pwa"), { recursive: true });
    await expect(assertVoidProductionFiles(fixture, [marker])).resolves.toBeUndefined();
    await mkdir(join(fixture, ".cloudflare/output/v1/workers"), { recursive: true });
    await expect(assertVoidProductionFiles(fixture, [marker])).resolves.toBeUndefined();
  });

  it("allows clean output from multiple Workers, SSR, and the client", async () => {
    for (const output of outputs) {
      await mkdir(join(fixture, output), { recursive: true });
      await writeFile(join(fixture, output, "index.js"), "export const name = 'production';");
    }
    await expect(assertVoidProductionFiles(fixture, [marker])).resolves.toBeUndefined();
  });

  it.each(outputs)("rejects test-only values in %s even when the other outputs are absent", async (output) => {
    await mkdir(join(fixture, output), { recursive: true });
    await writeFile(join(fixture, output, "index.js"), marker);

    await expect(assertVoidProductionFiles(fixture, [marker])).rejects.toThrow("Test-only auth material");
  });

  it("rejects a bundled test input identified by its source map", async () => {
    const output = join(fixture, "dist/ssr");
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "index.js.map"), JSON.stringify({ sources: ["../../tests/support/auth.ts"] }));
    await expect(assertVoidProductionFiles(fixture, [marker])).rejects.toThrow("Test input is not allowed");
  });

  it("rejects a present but empty output", async () => {
    await mkdir(join(fixture, "dist/client"), { recursive: true });
    await expect(assertVoidProductionFiles(fixture, [marker])).rejects.toThrow("Missing production output");
  });
});
