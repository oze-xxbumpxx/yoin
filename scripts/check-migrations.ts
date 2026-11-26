import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_MIGRATIONS_DIR = "db/migrations";
export const DEFAULT_DRIZZLE_CONFIG = "db/drizzle.config.ts";
export const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;

const REQUIRES_DEPLOYED_PREFIX = /^--\s*requires-deployed\b/i;
const REQUIRES_DEPLOYED_EXACT = /^--\s*requires-deployed:\s*([0-9a-f]{40})\s*$/;
const DESTRUCTIVE_DROP_PATTERN = /\bDROP\s+(?:TABLE|COLUMN)\b/i;

export interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

export interface MigrationFile {
  idx: number;
  tag: string;
  when: number;
  hash: string;
  filePath: string;
  sql: string;
  requiresDeployed: string[];
  hasDestructiveDrop: boolean;
}

export interface RequiresDeployedParseResult {
  shas: string[];
  invalidLines: string[];
}

export interface CheckMigrationsOptions {
  migrationsDir?: string;
  configPath?: string;
  cwd?: string;
  skipDrizzleKitCheck?: boolean;
}

/** マイグレーション定義の検証違反をまとめて表すエラー。秘密情報を含めない。 */
export class MigrationValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`マイグレーションの検証に失敗しました（${issues.length}件）`);
    this.name = "MigrationValidationError";
    this.issues = [...issues];
  }
}

/**
 * SQLの先頭コメント領域から `-- requires-deployed: <40桁のSHA>` を抽出する。
 * 先頭コメント以外への記述や40桁小文字hex以外の指定は `invalidLines` に記録する。
 */
export function parseRequiresDeployed(sql: string): RequiresDeployedParseResult {
  const lines = sql.split(/\r?\n/);
  const shas: string[] = [];
  const invalidLines: string[] = [];
  let inHeader = true;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (inHeader) {
      if (trimmed === "") {
        continue;
      }
      if (trimmed.startsWith("--")) {
        if (REQUIRES_DEPLOYED_PREFIX.test(trimmed)) {
          const match = REQUIRES_DEPLOYED_EXACT.exec(trimmed);
          if (match === null) {
            invalidLines.push(`${i + 1}行目: requires-deployedは40桁の小文字SHAで指定してください`);
          } else {
            shas.push(match[1]);
          }
        }
        continue;
      }
      inHeader = false;
    }

    if (REQUIRES_DEPLOYED_PREFIX.test(trimmed)) {
      invalidLines.push(`${i + 1}行目: -- requires-deployed: はSQLの先頭コメントに書いてください`);
    }
  }

  return { shas, invalidLines };
}

/**
 * PostgreSQLのコメント（`--`、`/* ... *\/`の入れ子含む）と文字列リテラル
 * （`'...'`、`$$...$$` / `$tag$...$tag$`）を空白に置き換える。
 */
export function stripSqlCommentsAndLiterals(sql: string): string {
  const out: string[] = [];
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = i + 1 < sql.length ? sql[i + 1] : "";

    if (ch === "-" && next === "-") {
      i += 2;
      while (i < sql.length && sql[i] !== "\n") {
        i += 1;
      }
      out.push(" ");
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      let depth = 1;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth += 1;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      out.push(" ");
      continue;
    }

    if (ch === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
        } else if (sql[i] === "'") {
          i += 1;
          break;
        } else {
          i += 1;
        }
      }
      out.push(" ");
      continue;
    }

    if (ch === "$") {
      const tagMatch = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tagMatch !== null) {
        const delimiter = tagMatch[0];
        i += delimiter.length;
        const endIdx = sql.indexOf(delimiter, i);
        if (endIdx === -1) {
          i = sql.length;
        } else {
          i = endIdx + delimiter.length;
        }
        out.push(" ");
        continue;
      }
    }

    out.push(ch);
    i += 1;
  }

  return out.join("");
}

/** SQL本体に `DROP TABLE` または `DROP COLUMN` が含まれるかを判定する。 */
export function containsDestructiveDrop(sql: string): boolean {
  return DESTRUCTIVE_DROP_PATTERN.test(stripSqlCommentsAndLiterals(sql));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeTag(tag: string): boolean {
  return tag.length > 0 && basename(tag) === tag && !tag.includes("..") && !tag.includes("/") && !tag.includes("\\");
}

/**
 * `meta/_journal.json` とSQLファイルを読み込み、並び順・時刻の単調増加・
 * ファイル対応・削除SQLの `requires-deployed` を検証して返す。
 * @throws {MigrationValidationError} 検証違反が1件以上ある場合
 */
export function readAndValidateMigrations(migrationsDir: string): MigrationFile[] {
  const dir = resolve(migrationsDir);
  const journalPath = join(dir, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    throw new MigrationValidationError([`journalファイルが見つかりません: ${journalPath}`]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(journalPath, "utf8")) as unknown;
  } catch {
    throw new MigrationValidationError([`journalファイルのJSONが壊れています: ${journalPath}`]);
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.entries)) {
    throw new MigrationValidationError([`journalファイルのentries配列がありません: ${journalPath}`]);
  }

  const issues: string[] = [];
  const migrations: MigrationFile[] = [];
  const seenTags = new Set<string>();
  let previousWhen: number | null = null;
  let previousTag: string | null = null;

  for (let index = 0; index < parsed.entries.length; index += 1) {
    const raw: unknown = parsed.entries[index];
    if (!isRecord(raw)) {
      issues.push(`entries[${index}] がオブジェクトではありません`);
      continue;
    }

    const idx = raw.idx;
    const when = raw.when;
    const tag = raw.tag;
    const breakpoints = raw.breakpoints;

    if (typeof idx !== "number" || !Number.isInteger(idx) || idx !== index) {
      issues.push(`entries[${index}] のidxが連番ではありません（期待: ${index}）`);
    }

    if (typeof when !== "number" || !Number.isSafeInteger(when) || when <= 0) {
      issues.push(`entries[${index}] のwhenが正の整数ではありません`);
    } else {
      if (previousWhen !== null && when <= previousWhen) {
        issues.push(
          `journalの時刻順違反: entries[${index}] (${typeof tag === "string" ? tag : "unknown"}, when=${when}) が前のエントリ (${previousTag ?? "unknown"}, when=${previousWhen}) 以下です`,
        );
      }
      previousWhen = when;
    }

    if (typeof breakpoints !== "boolean") {
      issues.push(`entries[${index}] のbreakpointsが真偽値ではありません`);
    }

    if (typeof tag !== "string" || !isSafeTag(tag)) {
      issues.push(`entries[${index}] のtagが不正です`);
      continue;
    }
    previousTag = tag;

    if (seenTags.has(tag)) {
      issues.push(`tagが重複しています: ${tag}`);
      continue;
    }
    seenTags.add(tag);

    const filePath = join(dir, `${tag}.sql`);
    if (!existsSync(filePath)) {
      issues.push(`journalに載っているSQLファイルがありません: ${tag}.sql`);
      continue;
    }

    const sql = readFileSync(filePath, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    const requiresResult = parseRequiresDeployed(sql);
    const hasDestructiveDrop = containsDestructiveDrop(sql);

    for (const invalidLine of requiresResult.invalidLines) {
      issues.push(`${tag}.sql: ${invalidLine}`);
    }
    if (hasDestructiveDrop && requiresResult.shas.length === 0) {
      issues.push(
        `${tag}.sql: 列や表を削除するSQLには先頭に \`-- requires-deployed: <40桁のSHA>\` を書いてください`,
      );
    }

    if (typeof idx === "number" && typeof when === "number") {
      migrations.push({
        idx,
        tag,
        when,
        hash,
        filePath,
        sql,
        requiresDeployed: requiresResult.shas,
        hasDestructiveDrop,
      });
    }
  }

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".sql")) {
      continue;
    }
    const tag = entry.name.slice(0, -".sql".length);
    if (!seenTags.has(tag)) {
      issues.push(`journalに載っていないSQLファイルがあります: ${entry.name}`);
    }
  }

  if (issues.length > 0) {
    throw new MigrationValidationError(issues);
  }

  return migrations;
}

/**
 * ローカルの `drizzle-kit check` を実行し、スナップショット分岐や整合性を検証する。
 * @throws {MigrationValidationError} drizzle-kit check が失敗した場合
 */
export function runDrizzleKitCheck(configPath: string, cwd: string = process.cwd()): void {
  const binName = process.platform === "win32" ? "drizzle-kit.cmd" : "drizzle-kit";
  const binPath = resolve(cwd, "node_modules", ".bin", binName);
  if (!existsSync(binPath)) {
    throw new MigrationValidationError([`drizzle-kitが見つかりません: ${binPath}`]);
  }

  try {
    execFileSync(binPath, ["check", `--config=${configPath}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error: unknown) {
    const status = isRecord(error) && typeof error.status === "number" ? error.status : null;
    const output = isRecord(error) && typeof error.stdout === "string" && error.stdout.trim() !== ""
      ? error.stdout.trim()
      : isRecord(error) && typeof error.stderr === "string" && error.stderr.trim() !== ""
        ? error.stderr.trim()
        : "drizzle-kit check が失敗しました";
    throw new MigrationValidationError([
      `drizzle-kit check が失敗しました（終了コード: ${status ?? "unknown"}）: ${output}`,
    ]);
  }
}

/**
 * マイグレーションの整合性（journal時刻順・削除SQLの宣言・drizzle-kit check）をすべて検証する。
 * @throws {MigrationValidationError} いずれかの検証に失敗した場合
 */
export function checkMigrations(options: CheckMigrationsOptions = {}): MigrationFile[] {
  const cwd = options.cwd ?? process.cwd();
  const migrationsDir = resolve(cwd, options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR);
  const configPath = options.configPath ?? DEFAULT_DRIZZLE_CONFIG;

  const migrations = readAndValidateMigrations(migrationsDir);
  if (options.skipDrizzleKitCheck !== true) {
    runDrizzleKitCheck(configPath, cwd);
  }
  return migrations;
}

function main(args: string[]): number {
  if (args.length > 0) {
    stderr.write("使い方: node scripts/check-migrations.ts\n");
    return 1;
  }
  try {
    const migrations = checkMigrations();
    stdout.write(`マイグレーション検査OK（${migrations.length}件）\n`);
    return 0;
  } catch (error: unknown) {
    if (error instanceof MigrationValidationError) {
      for (const issue of error.issues) {
        stderr.write(`エラー: ${issue}\n`);
      }
      return 1;
    }
    stderr.write("マイグレーション検査で想定外のエラーが起きました。\n");
    return 1;
  }
}

const entryPath = process.argv[1] ?? null;
if (entryPath !== null && realpathSync(entryPath) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
