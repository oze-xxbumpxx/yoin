import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ESLint } from "eslint";
import { expect, it } from "vitest";

it("enforces context public entrypoints and keeps domain code independent", async () => {
  await mkdir("dist", { recursive: true });
  const fixture = await mkdtemp(resolve("dist/boundaries-test-"));
  const files = {
    "src/functions/api/index.ts": 'import "../../contexts/ticket";\nimport "../../contexts/ticket/domain/rules";',
    "src/contexts/ticket/index.ts": 'import "./domain/rules";',
    "src/contexts/ticket/domain/rules.ts": 'import "../infrastructure/store";\nimport "vite";',
    "src/contexts/ticket/infrastructure/store.ts": 'import "../domain/rules";',
    "src/contexts/group/index.ts": 'import "../ticket";\nimport "../ticket/infrastructure/store";',
    "src/contexts/group/domain/rules.ts": "export {};",
    "tests/contexts/ticket/domain/rules.test.ts": [
      'import "../../../../src/contexts/ticket/domain/rules";',
      'import "../../../../src/contexts/group/domain/rules";',
    ].join("\n"),
  };
  try {
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(join(fixture, dirname(file)), { recursive: true });
      await writeFile(join(fixture, file), contents);
    }
    const eslint = new ESLint({
      cwd: fixture,
      overrideConfigFile: resolve("eslint.config.mjs"),
      overrideConfig: { settings: { "boundaries/root-path": fixture } },
    });
    const results = await eslint.lintFiles(Object.keys(files));
    expect(results.map(({ filePath, messages }) => [
      filePath.slice(fixture.length + 1),
      messages.map(({ ruleId, line }) => [ruleId, line]),
    ])).toEqual([
      ["src/functions/api/index.ts", [["boundaries/element-types", 2]]],
      ["src/contexts/ticket/index.ts", []],
      ["src/contexts/ticket/domain/rules.ts", [["boundaries/element-types", 1], ["boundaries/external", 2]]],
      ["src/contexts/ticket/infrastructure/store.ts", []],
      ["src/contexts/group/index.ts", [["boundaries/element-types", 2]]],
      ["src/contexts/group/domain/rules.ts", []],
      ["tests/contexts/ticket/domain/rules.test.ts", [["boundaries/element-types", 2]]],
    ]);
  } finally {
    await rm(fixture, { force: true, recursive: true });
  }
});
