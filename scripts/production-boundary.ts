import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

export function assertProductionInput(path: string): void {
  if (/(^|\/)(tests|__tests__)(\/|$)|\.(spec|test)\.[cm]?[jt]sx?$/u.test(path.replaceAll("\\", "/"))) {
    throw new Error(`Test input is not allowed in a production bundle: ${path}`);
  }
}

async function hasDirectory(path: string): Promise<boolean> {
  const entry = await lstat(path).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!entry) return false;
  if (!entry.isDirectory()) throw new Error(`Expected a production output directory: ${path}`);
  return true;
}

export async function assertVoidProductionFiles(
  project: string,
  testMarkers: readonly string[],
): Promise<void> {
  for (const output of ["dist/ssr", "dist/client"]) {
    const path = join(project, output);
    if (await hasDirectory(path)) await assertProductionFiles(path, testMarkers, { checkSourceMaps: true });
  }

  const workers = join(project, ".cloudflare/output/v1/workers");
  if (!(await hasDirectory(workers))) return;
  for (const entry of await readdir(workers, { withFileTypes: true })) {
    const worker = join(workers, entry.name);
    if (!entry.isDirectory()) throw new Error(`Expected a production output directory: ${worker}`);
    await assertProductionFiles(worker, testMarkers, { checkSourceMaps: true });
  }
}

export async function assertProductionFiles(
  root: string,
  testMarkers: readonly string[],
  { checkSourceMaps = false }: { checkSourceMaps?: boolean } = {},
): Promise<void> {
  async function checkDirectory(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = relative(root, path);
      assertProductionInput(name);
      if (/^(\.env($|\.)|.*\.(pem|key)$)/u.test(entry.name)) {
        throw new Error(`Forbidden file in production output: ${name}`);
      }
      if (entry.isDirectory()) {
        await checkDirectory(path);
      } else if (entry.isFile()) {
        const content = await readFile(path);
        if (testMarkers.some((marker) => content.includes(marker))) {
          throw new Error(`Test-only auth material found in production output: ${name}`);
        }
        if (checkSourceMaps && entry.name.endsWith(".map")) {
          const map: unknown = JSON.parse(content.toString("utf8"));
          if (map !== null && typeof map === "object" && "sources" in map && Array.isArray(map.sources)) {
            for (const source of map.sources) {
              if (typeof source === "string") assertProductionInput(source);
            }
          }
        }
      } else {
        throw new Error(`Expected a regular production output: ${name}`);
      }
    }
  }
  if ((await readdir(root)).length === 0) {
    throw new Error(`Missing production output: ${root}`);
  }
  await checkDirectory(root);
}
