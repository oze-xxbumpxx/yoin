import { isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import ts from "typescript";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { assertProductionInput } from "../../scripts/production-boundary.ts";

const viteBuiltIns = new Set(["MODE", "DEV", "PROD", "BASE_URL", "SSR"]);

function findForbiddenEnvReference(node: ts.Node): ts.Node | null {
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const key = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : "";
    const meta = node.expression;
    if (key === "env" && ts.isMetaProperty(meta) && meta.keywordToken === ts.SyntaxKind.ImportKeyword
      && meta.name.text === "meta") {
      const access = node.parent;
      const isBuiltIn = ts.isPropertyAccessExpression(node) && !node.questionDotToken
        && ts.isPropertyAccessExpression(access) && access.expression === node && !access.questionDotToken
        && viteBuiltIns.has(access.name.text);
      if (!isBuiltIn) {
        return node;
      }
    }
  }
  return ts.forEachChild(node, findForbiddenEnvReference) ?? null;
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
        const htmlModule = source.endsWith(".html") && /\?html-proxy&index=\d+\.js$/u.test(id);
        if (!isAbsolute(path) || isAbsolute(source) || source.startsWith(`..${sep}`)
          || source.split(sep).includes("node_modules") || (!htmlModule && !/\.[cm]?[jt]sx?$/u.test(source))) {
          return;
        }
        const file = ts.createSourceFile(htmlModule ? id : path, code, ts.ScriptTarget.Latest, true);
        const reference = findForbiddenEnvReference(file);
        if (reference !== null) {
          this.error("Only direct Vite built-ins may use import.meta.env", reference.getStart(file));
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
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "../../dist/pwa", emptyOutDir: true },
  plugins: [tailwindcss(), productionInputs()],
});
