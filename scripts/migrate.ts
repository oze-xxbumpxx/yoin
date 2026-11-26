import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { GetFunctionCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import {
  DEFAULT_MIGRATIONS_DIR,
  FULL_SHA_PATTERN,
  MigrationValidationError,
  readAndValidateMigrations,
} from "./check-migrations.ts";
import type { MigrationFile } from "./check-migrations.ts";

/** Lambdaの最大実行時間（15分）。旧版の呼び出し完了を待つための下限。 */
export const MAX_LAMBDA_DURATION_MS = 15 * 60 * 1000;
export const DEFAULT_DEPLOYED_SHA_TAG = "deployed_sha";
export const DEFAULT_DEPLOYED_AT_TAG = "deployed_at";
export const DEFAULT_AWS_REGION = "ap-southeast-1";

// yoinのマイグレーション適用を直列化するための固定advisory lockキー
const MIGRATION_ADVISORY_LOCK_KEY = 790910050;
const PG_SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;
const ISO_8601_WITH_TZ_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export interface AppliedMigrationRow {
  hash: string;
  createdAt: number;
}

export interface DeployedLambdaInfo {
  name: string;
  deployedSha: string | null;
  deployedAt: string | null;
}

export type GetDeployedLambdas = () => Promise<readonly DeployedLambdaInfo[]>;
export type IsCommitAncestor = (ancestorSha: string, descendantSha: string) => boolean;

export interface ApplyMigrationsOptions {
  databaseUrl: string;
  migrationsDir?: string;
  getDeployedLambdas?: GetDeployedLambdas | null;
  isCommitAncestor?: IsCommitAncestor;
  now?: () => Date;
}

export interface ApplyMigrationsResult {
  appliedCount: number;
  skippedCount: number;
  appliedTags: string[];
}

/** マイグレーション適用前の安全条件に違反したときのエラー。秘密情報を含めない。 */
export class MigrationApplyError extends Error {
  readonly reasons: readonly string[];

  constructor(reasons: readonly string[]) {
    super(`マイグレーションの適用を中止しました（${reasons.length}件）`);
    this.name = "MigrationApplyError";
    this.reasons = [...reasons];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * DBに記録済みの最新時刻以下でありながら未適用のSQL（drizzle-ormが飛ばすもの）を返す。
 * 空DB（`appliedRows`が空）の場合は空配列を返す。
 */
export function findUnappliedOlderMigrations(
  migrations: readonly MigrationFile[],
  appliedRows: readonly AppliedMigrationRow[],
): MigrationFile[] {
  if (appliedRows.length === 0) {
    return [];
  }

  let lastAppliedCreatedAt = -Infinity;
  const appliedHashes = new Set<string>();
  for (const row of appliedRows) {
    if (row.createdAt > lastAppliedCreatedAt) {
      lastAppliedCreatedAt = row.createdAt;
    }
    appliedHashes.add(row.hash);
  }

  return migrations.filter(
    (migration) => migration.when <= lastAppliedCreatedAt && !appliedHashes.has(migration.hash),
  );
}

/**
 * 未適用のマイグレーション一覧を返す。
 * 事前に `findUnappliedOlderMigrations` が空であることを前提とする。
 */
export function selectPendingMigrations(
  migrations: readonly MigrationFile[],
  appliedRows: readonly AppliedMigrationRow[],
): MigrationFile[] {
  if (appliedRows.length === 0) {
    return [...migrations];
  }
  let lastAppliedCreatedAt = -Infinity;
  for (const row of appliedRows) {
    if (row.createdAt > lastAppliedCreatedAt) {
      lastAppliedCreatedAt = row.createdAt;
    }
  }
  return migrations.filter((migration) => migration.when > lastAppliedCreatedAt);
}

/**
 * `git merge-base --is-ancestor` で `ancestorSha` が `descendantSha` の祖先に含まれるか判定する。
 * 不正なSHA形式やgit実行失敗時は安全側に倒し `false` を返す。
 */
export function gitIsCommitAncestor(
  ancestorSha: string,
  descendantSha: string,
  cwd: string = process.cwd(),
): boolean {
  if (!FULL_SHA_PATTERN.test(ancestorSha) || !FULL_SHA_PATTERN.test(descendantSha)) {
    return false;
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestorSha, descendantSha], {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 未適用マイグレーションの `-- requires-deployed:` 条件を、
 * 各Lambdaの配備コミット（祖先包含）と切替時刻（15分より長い経過）の両方で検証する。
 * @throws {MigrationApplyError} 条件を満たさないLambdaが1つでもある場合
 */
export async function verifyRequiresDeployed(
  pendingMigrations: readonly MigrationFile[],
  deps: {
    getDeployedLambdas: GetDeployedLambdas | null;
    isCommitAncestor: IsCommitAncestor;
    now: () => Date;
  },
): Promise<void> {
  const gated = pendingMigrations.filter((migration) => migration.requiresDeployed.length > 0);
  if (gated.length === 0) {
    return;
  }

  if (deps.getDeployedLambdas === null) {
    throw new MigrationApplyError([
      "削除SQLのrequires-deployedを確認するLambda一覧が指定されていません",
    ]);
  }

  const lambdas = await deps.getDeployedLambdas();
  if (lambdas.length === 0) {
    throw new MigrationApplyError([
      "削除SQLのrequires-deployedを確認する対象Lambdaが0件です",
    ]);
  }

  const nowMs = deps.now().getTime();
  const reasons: string[] = [];

  for (const migration of gated) {
    for (const requiredSha of migration.requiresDeployed) {
      for (const lambda of lambdas) {
        if (lambda.deployedSha === null || !FULL_SHA_PATTERN.test(lambda.deployedSha)) {
          reasons.push(
            `${migration.tag}.sql: Lambda(${lambda.name})の配備コミットタグが未設定または不正です`,
          );
          continue;
        }

        if (!deps.isCommitAncestor(requiredSha, lambda.deployedSha)) {
          reasons.push(
            `${migration.tag}.sql: Lambda(${lambda.name})の配備版(${lambda.deployedSha})がrequires-deployed(${requiredSha})を含んでいません`,
          );
        }

        if (lambda.deployedAt === null || !ISO_8601_WITH_TZ_PATTERN.test(lambda.deployedAt)) {
          reasons.push(
            `${migration.tag}.sql: Lambda(${lambda.name})の切替時刻タグが未設定またはISO 8601形式ではありません`,
          );
          continue;
        }

        const deployedAtMs = Date.parse(lambda.deployedAt);
        if (!Number.isFinite(deployedAtMs)) {
          reasons.push(
            `${migration.tag}.sql: Lambda(${lambda.name})の切替時刻タグを解釈できません`,
          );
          continue;
        }

        const elapsedMs = nowMs - deployedAtMs;
        if (elapsedMs <= MAX_LAMBDA_DURATION_MS) {
          const remainingSec = Math.ceil((MAX_LAMBDA_DURATION_MS - elapsedMs + 1) / 1000);
          reasons.push(
            `${migration.tag}.sql: Lambda(${lambda.name})の切替から最大実行時間15分より長く経過していません（残り約${Math.max(remainingSec, 1)}秒）`,
          );
        }
      }
    }
  }

  if (reasons.length > 0) {
    throw new MigrationApplyError(reasons);
  }
}

/**
 * AWS Lambdaのタグから配備済みコミットSHAと切替時刻を読み取る関数を作る。
 */
export function createAwsLambdaReader(options: {
  functionNames: readonly string[];
  region?: string;
  shaTagKey?: string;
  deployedAtTagKey?: string;
}): GetDeployedLambdas {
  const functionNames = [...options.functionNames];
  const region = options.region ?? DEFAULT_AWS_REGION;
  const shaTagKey = options.shaTagKey ?? DEFAULT_DEPLOYED_SHA_TAG;
  const deployedAtTagKey = options.deployedAtTagKey ?? DEFAULT_DEPLOYED_AT_TAG;

  return async (): Promise<readonly DeployedLambdaInfo[]> => {
    const client = new LambdaClient({ region });
    try {
      const results: DeployedLambdaInfo[] = [];
      for (const name of functionNames) {
        const response = await client.send(new GetFunctionCommand({ FunctionName: name }));
        const tags = response.Tags ?? {};
        results.push({
          name,
          deployedSha: tags[shaTagKey] ?? null,
          deployedAt: tags[deployedAtTagKey] ?? null,
        });
      }
      return results;
    } finally {
      client.destroy();
    }
  };
}

function getPgErrorCode(error: unknown): string | null {
  if (!isRecord(error)) {
    return null;
  }
  if (typeof error.code === "string" && PG_SQLSTATE_PATTERN.test(error.code)) {
    return error.code;
  }
  if (isRecord(error.cause) && typeof error.cause.code === "string" && PG_SQLSTATE_PATTERN.test(error.cause.code)) {
    return error.cause.code;
  }
  return null;
}

/**
 * 例外から秘密情報を含み得る `message` を除外し、安全に出力できる説明だけを返す。
 */
export function formatSafeError(error: unknown): string {
  if (error instanceof MigrationValidationError) {
    return error.issues.map((issue) => `エラー: ${issue}`).join("\n");
  }
  if (error instanceof MigrationApplyError) {
    return error.reasons.map((reason) => `エラー: ${reason}`).join("\n");
  }
  const pgCode = getPgErrorCode(error);
  if (pgCode !== null) {
    return `エラー: DB操作に失敗しました（SQLSTATE: ${pgCode}）`;
  }
  if (error instanceof Error) {
    return `エラー: マイグレーションの実行に失敗しました（種別: ${error.name}）`;
  }
  return "エラー: マイグレーションの実行に失敗しました";
}

async function readAppliedMigrations(client: Client): Promise<AppliedMigrationRow[]> {
  try {
    const result = await client.query<{ hash: string; created_at: string | number }>(
      'SELECT hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at ASC',
    );
    return result.rows.map((row) => ({
      hash: row.hash,
      createdAt: Number(row.created_at),
    }));
  } catch (error: unknown) {
    const code = getPgErrorCode(error);
    // 42P01: undefined_table, 3F000: invalid_schema_name（空DBの初回実行）
    if (code === "42P01" || code === "3F000") {
      return [];
    }
    throw error;
  }
}

/**
 * マイグレーションの事前検査（journal順・未記録の古いSQL・requires-deployed）を通過した場合のみ、
 * drizzle-ormのmigratorで未適用SQLを適用する。同じSQLの再実行は冪等に0件適用で完了する。
 * @throws {MigrationValidationError | MigrationApplyError} 事前検査または条件違反の場合
 */
export async function applyMigrations(options: ApplyMigrationsOptions): Promise<ApplyMigrationsResult> {
  const migrationsDir = resolve(options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR);
  const migrations = readAndValidateMigrations(migrationsDir);
  const isCommitAncestor = options.isCommitAncestor ?? gitIsCommitAncestor;
  const now = options.now ?? (() => new Date());
  const getDeployedLambdas = options.getDeployedLambdas ?? null;

  const client = new Client({ connectionString: options.databaseUrl });
  await client.connect();
  let lockAcquired = false;

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_ADVISORY_LOCK_KEY]);
    lockAcquired = true;

    const appliedRows = await readAppliedMigrations(client);
    const unappliedOlder = findUnappliedOlderMigrations(migrations, appliedRows);
    if (unappliedOlder.length > 0) {
      const tags = unappliedOlder.map((migration) => `${migration.tag}.sql`).join(", ");
      throw new MigrationApplyError([
        `DBに記録済みの最新時刻より古く未適用のSQLがあります（drizzle-kitで作り直してください）: ${tags}`,
      ]);
    }

    const pending = selectPendingMigrations(migrations, appliedRows);
    if (pending.length === 0) {
      return {
        appliedCount: 0,
        skippedCount: migrations.length,
        appliedTags: [],
      };
    }

    await verifyRequiresDeployed(pending, {
      getDeployedLambdas,
      isCommitAncestor,
      now,
    });

    const db = drizzle(client);
    await migrate(db, { migrationsFolder: migrationsDir });

    return {
      appliedCount: pending.length,
      skippedCount: migrations.length - pending.length,
      appliedTags: pending.map((migration) => migration.tag),
    };
  } finally {
    if (lockAcquired) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_ADVISORY_LOCK_KEY]);
      } catch {
        // 切断時にセッション単位のadvisory lockは自動解放される
      }
    }
    await client.end().catch(() => undefined);
  }
}

function parseLambdaNamesEnv(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") {
    return [];
  }
  const unique = new Set<string>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed !== "") {
      unique.add(trimmed);
    }
  }
  return [...unique];
}

async function main(args: string[]): Promise<number> {
  if (args.length > 0) {
    stderr.write("エラー: 引数は受け付けません。接続先と対象Lambdaはデプロイ環境変数で渡してください。\n");
    return 1;
  }

  const databaseUrl = process.env.DATABASE_URL ?? null;
  if (databaseUrl === null || databaseUrl.trim() === "") {
    stderr.write("エラー: 環境変数 DATABASE_URL が未設定です。\n");
    return 1;
  }

  const lambdaNames = parseLambdaNamesEnv(process.env.LAMBDA_FUNCTION_NAMES);
  const getDeployedLambdas = lambdaNames.length > 0
    ? createAwsLambdaReader({
        functionNames: lambdaNames,
        region: process.env.AWS_REGION ?? DEFAULT_AWS_REGION,
        shaTagKey: process.env.LAMBDA_SHA_TAG_KEY ?? DEFAULT_DEPLOYED_SHA_TAG,
        deployedAtTagKey: process.env.LAMBDA_DEPLOYED_AT_TAG_KEY ?? DEFAULT_DEPLOYED_AT_TAG,
      })
    : null;

  try {
    const result = await applyMigrations({
      databaseUrl,
      migrationsDir: process.env.MIGRATIONS_DIR ?? DEFAULT_MIGRATIONS_DIR,
      getDeployedLambdas,
    });
    stdout.write(
      `マイグレーション完了: 適用 ${result.appliedCount}件 / 適用済み ${result.skippedCount}件\n`,
    );
    return 0;
  } catch (error: unknown) {
    stderr.write(`${formatSafeError(error)}\n`);
    return 1;
  }
}

const entryPath = process.argv[1] ?? null;
if (entryPath !== null && realpathSync(entryPath) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
