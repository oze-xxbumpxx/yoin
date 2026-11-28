import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

export function assertProductionInput(path: string): void {
  if (/(^|\/)(tests|__tests__)(\/|$)|\.(spec|test)\.[cm]?[jt]sx?$/u.test(path.replaceAll("\\", "/"))) {
    throw new Error(`Test input is not allowed in a production bundle: ${path}`);
  }
}

export async function assertProductionFiles(
  root: string,
  testMarkers: readonly string[],
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
