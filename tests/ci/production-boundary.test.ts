import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build, resolveConfig } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertProductionFiles } from "../../scripts/production-boundary.ts";

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

    await expect(buildFixture()).rejects.toThrow("Read environment values from /config.json");
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
    ["config.json", "{}", "Forbidden file"],
  ])("rejects forbidden output in %s", async (file, contents, message) => {
    await writeFile(join(fixture, file), contents);
    await expect(assertProductionFiles(
      fixture,
      ["https://test-issuer.invalid", "test-jwt-key-marker"],
      ["config.json"],
    )).rejects.toThrow(message);
  });
});
