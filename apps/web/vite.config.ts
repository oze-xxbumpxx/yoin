import { isAbsolute, relative, sep } from "node:path";
import ts from "typescript";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { assertProductionInput } from "../../scripts/production-boundary.ts";

function findViteEnvReference(node: ts.Node): ts.Node | null {
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const key = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : "";
    const env = node.expression;
    if (key.startsWith("VITE_") && ts.isPropertyAccessExpression(env) && env.name.text === "env"
      && ts.isMetaProperty(env.expression) && env.expression.keywordToken === ts.SyntaxKind.ImportKeyword
      && env.expression.name.text === "meta") {
      return node;
    }
  }
  return ts.forEachChild(node, findViteEnvReference) ?? null;
}

function productionInputs(): Plugin {
  let root = "";
  return {
    name: "production-inputs",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    transform: {
      order: "pre",
      handler(code, id) {
        const path = id.split("?")[0];
        const source = relative(root, path);
        if (!isAbsolute(path) || isAbsolute(source) || source.startsWith(`..${sep}`)
          || source.split(sep).includes("node_modules") || !/\.[cm]?[jt]sx?$/u.test(source)) {
          return;
        }
        const file = ts.createSourceFile(path, code, ts.ScriptTarget.Latest);
        const reference = findViteEnvReference(file);
        if (reference !== null) {
          this.error("Read environment values from /config.json instead of import.meta.env.VITE_*", reference.getStart(file));
        }
      },
    },
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === "chunk") {
          for (const input of Object.keys(output.modules)) {
            assertProductionInput(input);
          }
        }
      }
    },
  };
}

export default defineConfig({
  envDir: false,
  envPrefix: [],
  build: { outDir: "../../dist/pwa", emptyOutDir: true },
  plugins: [productionInputs()],
});
