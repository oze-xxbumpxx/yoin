import { defineConfig } from "drizzle-kit";

// drizzle-kitはデフォルトエクスポートを要求する（coding-standards.mdのフレームワーク例外）
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/contexts/*/infrastructure/schema.ts",
  out: "./db/migrations",
  strict: true,
  verbose: true,
});
