import { readFileSync } from "node:fs";

const { scripts } = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, unknown>;
};
const missing = ["lint", "type-check", "test"].filter((name) => {
  const command = scripts?.[name];
  return typeof command !== "string" || command.trim() === "";
});

if (missing.length > 0) {
  console.error(`Missing required package.json scripts: ${missing.join(", ")}`);
  process.exitCode = 1;
}
