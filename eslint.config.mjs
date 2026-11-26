import tsParser from "@typescript-eslint/parser";
import boundaries from "eslint-plugin-boundaries";

export default [
  { ignores: [".claude/**", ".agents/**", "**/dist/**", "playwright-report/**", "test-results/**"] },
  {
    files: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    languageOptions: { parser: tsParser },
    plugins: { boundaries },
    settings: {
      "import/resolver": { typescript: true },
      "boundaries/elements": [
        {
          type: "context-entry",
          mode: "full",
          pattern: "src/contexts/*/index.ts",
          capture: ["context"],
        },
        {
          type: "domain",
          mode: "full",
          pattern: "src/contexts/*/domain/**",
          capture: ["context"],
        },
        {
          type: "infrastructure",
          mode: "full",
          pattern: "src/contexts/*/infrastructure/**",
          capture: ["context"],
        },
        {
          type: "context-internal",
          mode: "full",
          pattern: "src/contexts/*/**",
          capture: ["context"],
        },
        {
          type: "context-test",
          mode: "full",
          pattern: "tests/contexts/*/**",
          capture: ["context"],
        },
        { type: "other", mode: "full", pattern: "**/*" },
      ],
    },
    rules: {
      "no-debugger": "error",
      "no-unreachable": "error",
      "boundaries/element-types": ["error", {
        default: "allow",
        rules: [
          {
            from: ["*"],
            disallow: ["domain", "infrastructure", "context-internal"],
          },
          {
            from: ["context-entry", "domain", "infrastructure", "context-internal", "context-test"],
            allow: ["domain", "infrastructure", "context-internal"]
              .map((type) => [type, { context: "${from.context}" }]),
          },
          {
            from: ["domain"],
            disallow: ["infrastructure"],
          },
        ],
      }],
      "boundaries/external": ["error", {
        default: "allow",
        rules: [{ from: ["domain"], disallow: ["*"] }],
      }],
    },
  },
];
