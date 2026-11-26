import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MigrationValidationError } from "../../scripts/check-migrations.ts";
import {
  applyMigrations,
  MAX_LAMBDA_DURATION_MS,
  MigrationApplyError,
} from "../../scripts/migrate.ts";
import type { DeployedLambdaInfo } from "../../scripts/migrate.ts";
import { assertLocalhostDatabaseUrl } from "../../scripts/run-integration-tests.ts";

const SHA_STOP_USING = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_DEPLOYED_NEW = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SHA_DEPLOYED_OLD = "cccccccccccccccccccccccccccccccccccccccc";

interface FixtureEntry {
  idx: number;
  when: number;
  tag: string;
  sql: string;
}

const BASE_MIGRATION_SQL = `
CREATE SCHEMA IF NOT EXISTS "groups";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "notification";
--> statement-breakpoint
CREATE SEQUENCE "notification"."schedule_generation_seq" START WITH 1 INCREMENT BY 1;
--> statement-breakpoint
CREATE TABLE "groups"."groups" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL CHECK (char_length("name") > 0),
  "status" text NOT NULL CHECK ("status" IN ('active', 'disbanding')),
  "legacy_note" text
);
--> statement-breakpoint
CREATE TABLE "groups"."members" (
  "group_id" text NOT NULL,
  "user_id" text NOT NULL,
  "role" text NOT NULL CHECK ("role" IN ('owner', 'member')),
  "active" boolean NOT NULL DEFAULT true,
  PRIMARY KEY ("group_id", "user_id"),
  CONSTRAINT "members_group_fk" FOREIGN KEY ("group_id") REFERENCES "groups"."groups" ("id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX "members_one_active_owner_idx"
  ON "groups"."members" ("group_id")
  WHERE "role" = 'owner' AND "active" = true;
--> statement-breakpoint
CREATE INDEX "members_user_idx" ON "groups"."members" ("user_id");
`;

const DROP_COLUMN_SQL = `-- requires-deployed: ${SHA_STOP_USING}
ALTER TABLE "groups"."groups" DROP COLUMN "legacy_note";
`;

function getBaseAdminUrl(): string {
  const raw = process.env.TEST_DATABASE_URL ?? null;
  if (raw === null || raw.trim() === "") {
    throw new Error("TEST_DATABASE_URL が未設定です。pnpm test:integration から実行してください。");
  }
  return assertLocalhostDatabaseUrl(raw.trim());
}

function buildDbUrl(baseUrl: string, dbName: string): string {
  const parsed = new URL(baseUrl);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

function writeMigrationsDir(root: string, entries: readonly FixtureEntry[]): string {
  const dir = join(root, "migrations");
  const metaDir = join(dir, "meta");
  mkdirSync(metaDir, { recursive: true });
  writeFileSync(
    join(metaDir, "_journal.json"),
    JSON.stringify(
      {
        version: "7",
        dialect: "postgresql",
        entries: entries.map(({ idx, when, tag }) => ({
          idx,
          version: "7",
          when,
          tag,
          breakpoints: true,
        })),
      },
      null,
      2,
    ),
  );
  for (const entry of entries) {
    writeFileSync(join(dir, `${entry.tag}.sql`), entry.sql);
  }
  return dir;
}

describe("I03: 使い捨てPostgreSQLでのマイグレーション適用と整合", () => {
  let workDir: string;
  let dbName: string;
  let dbUrl: string;
  let adminUrl: string;

  beforeEach(async () => {
    adminUrl = getBaseAdminUrl();
    mkdirSync("dist", { recursive: true });
    workDir = mkdtempSync(resolve("dist/i03-test-"));
    dbName = `yoin_i03_${randomBytes(6).toString("hex")}`;
    dbUrl = buildDbUrl(adminUrl, dbName);

    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${dbName}"`);
    } finally {
      await admin.end();
    }
  });

  afterEach(async () => {
    rmSync(workDir, { recursive: true, force: true });
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });

  it("空のDBへ制約・部分一意索引・シーケンスを適用し、同じSQLの再実行は冪等に0件適用となる", async () => {
    const migrationsDir = writeMigrationsDir(workDir, [
      { idx: 0, when: 1700000001000, tag: "0000_base", sql: BASE_MIGRATION_SQL },
    ]);

    const first = await applyMigrations({ databaseUrl: dbUrl, migrationsDir });
    expect(first).toEqual({ appliedCount: 1, skippedCount: 0, appliedTags: ["0000_base"] });

    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      // シーケンスが動作すること
      const seq1 = await client.query<{ nextval: string }>(
        `SELECT nextval('"notification"."schedule_generation_seq"')`,
      );
      expect(seq1.rows[0].nextval).toBe("1");

      // 制約と部分一意索引が機能すること
      await client.query(
        `INSERT INTO "groups"."groups" ("id", "name", "status") VALUES ('g1', 'live-friends', 'active')`,
      );
      await client.query(
        `INSERT INTO "groups"."members" ("group_id", "user_id", "role", "active") VALUES ('g1', 'u1', 'owner', true)`,
      );
      // 同一グループに有効なownerを2人入れようとすると部分一意索引で拒否される
      await expect(
        client.query(
          `INSERT INTO "groups"."members" ("group_id", "user_id", "role", "active") VALUES ('g1', 'u2', 'owner', true)`,
        ),
      ).rejects.toThrow();
      // 存在しないgroup_idは外部キー制約で拒否される
      await expect(
        client.query(
          `INSERT INTO "groups"."members" ("group_id", "user_id", "role", "active") VALUES ('missing', 'u3', 'member', true)`,
        ),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }

    // 同じSQLの再実行は二度適用されず0件で完了する
    const second = await applyMigrations({ databaseUrl: dbUrl, migrationsDir });
    expect(second).toEqual({ appliedCount: 0, skippedCount: 1, appliedTags: [] });
  });

  it("journalの時刻順違反があるときは適用を拒否し、DBを変更しない", async () => {
    const migrationsDir = writeMigrationsDir(workDir, [
      { idx: 0, when: 1700000002000, tag: "0000_first", sql: BASE_MIGRATION_SQL },
      { idx: 1, when: 1700000001000, tag: "0001_out_of_order", sql: "CREATE TABLE public.should_not_exist (id int);" },
    ]);

    await expect(applyMigrations({ databaseUrl: dbUrl, migrationsDir })).rejects.toThrow(
      MigrationValidationError,
    );

    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      const result = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'groups') AS exists`,
      );
      expect(result.rows[0].exists).toBe(false);
    } finally {
      await client.end();
    }
  });

  it("DBに記録済みの最新時刻より古い未記録SQLがあると適用を拒否する", async () => {
    const initialDir = writeMigrationsDir(workDir, [
      { idx: 0, when: 1700000001000, tag: "0000_base", sql: BASE_MIGRATION_SQL },
      { idx: 1, when: 1700000003000, tag: "0001_newer", sql: "CREATE TABLE public.t_newer (id int PRIMARY KEY);" },
    ]);
    const applied = await applyMigrations({ databaseUrl: dbUrl, migrationsDir: initialDir });
    expect(applied.appliedCount).toBe(2);

    // 並行PRから時刻1700000002000のSQLが後から紛れ込んだ状態を再現
    const driftedDir = writeMigrationsDir(workDir, [
      { idx: 0, when: 1700000001000, tag: "0000_base", sql: BASE_MIGRATION_SQL },
      { idx: 1, when: 1700000002000, tag: "0001_missed_older", sql: "CREATE TABLE public.t_missed (id int PRIMARY KEY);" },
      { idx: 2, when: 1700000003000, tag: "0001_newer", sql: "CREATE TABLE public.t_newer (id int PRIMARY KEY);" },
    ]);

    await expect(applyMigrations({ databaseUrl: dbUrl, migrationsDir: driftedDir })).rejects.toThrow(
      MigrationApplyError,
    );

    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      const result = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 't_missed') AS exists`,
      );
      expect(result.rows[0].exists).toBe(false);
    } finally {
      await client.end();
    }
  });

  it("削除SQLのrequires-deployed条件が未成立なら拒否し、全Lambdaが条件を満たせば適用する", async () => {
    const baseDir = writeMigrationsDir(workDir, [
      { idx: 0, when: 1700000001000, tag: "0000_base", sql: BASE_MIGRATION_SQL },
    ]);
    await applyMigrations({ databaseUrl: dbUrl, migrationsDir: baseDir });

    const withDropDir = writeMigrationsDir(workDir, [
      { idx: 0, when: 1700000001000, tag: "0000_base", sql: BASE_MIGRATION_SQL },
      { idx: 1, when: 1700000002000, tag: "0001_drop_legacy_note", sql: DROP_COLUMN_SQL },
    ]);

    const now = new Date("2026-11-27T02:00:00Z");
    const over15mAgo = new Date(now.getTime() - MAX_LAMBDA_DURATION_MS - 1_000).toISOString();
    const exact15mAgo = new Date(now.getTime() - MAX_LAMBDA_DURATION_MS).toISOString();
    const isAncestor = (ancestor: string, descendant: string): boolean =>
      ancestor === SHA_STOP_USING && (descendant === SHA_STOP_USING || descendant === SHA_DEPLOYED_NEW);

    // 1. 1つのLambdaが旧版（対象コミットを含まない）-> 拒否
    const missingCommitLambdas: DeployedLambdaInfo[] = [
      { name: "yoin-integration-api", deployedSha: SHA_DEPLOYED_NEW, deployedAt: over15mAgo },
      { name: "yoin-integration-pre-sign-up", deployedSha: SHA_DEPLOYED_OLD, deployedAt: over15mAgo },
      { name: "yoin-integration-notification-sender", deployedSha: SHA_DEPLOYED_NEW, deployedAt: over15mAgo },
    ];
    await expect(
      applyMigrations({
        databaseUrl: dbUrl,
        migrationsDir: withDropDir,
        getDeployedLambdas: async () => missingCommitLambdas,
        isCommitAncestor: isAncestor,
        now: () => now,
      }),
    ).rejects.toThrow(MigrationApplyError);

    // 2. 全Lambdaが新版だが、1つが15分ちょうど（15分より長く経過していない）-> 拒否
    const tooRecentLambdas: DeployedLambdaInfo[] = [
      { name: "yoin-integration-api", deployedSha: SHA_DEPLOYED_NEW, deployedAt: over15mAgo },
      { name: "yoin-integration-pre-sign-up", deployedSha: SHA_DEPLOYED_NEW, deployedAt: exact15mAgo },
      { name: "yoin-integration-notification-sender", deployedSha: SHA_DEPLOYED_NEW, deployedAt: over15mAgo },
    ];
    await expect(
      applyMigrations({
        databaseUrl: dbUrl,
        migrationsDir: withDropDir,
        getDeployedLambdas: async () => tooRecentLambdas,
        isCommitAncestor: isAncestor,
        now: () => now,
      }),
    ).rejects.toThrow(MigrationApplyError);

    // 列はまだ残っていること
    const checkBefore = new Client({ connectionString: dbUrl });
    await checkBefore.connect();
    try {
      const col = await checkBefore.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'groups' AND table_name = 'groups' AND column_name = 'legacy_note') AS exists`,
      );
      expect(col.rows[0].exists).toBe(true);
    } finally {
      await checkBefore.end();
    }

    // 3. 全Lambdaが対象コミットを含み、切替から15分より長く経過 -> 適用成功
    const readyLambdas: DeployedLambdaInfo[] = [
      { name: "yoin-integration-api", deployedSha: SHA_DEPLOYED_NEW, deployedAt: over15mAgo },
      { name: "yoin-integration-pre-sign-up", deployedSha: SHA_STOP_USING, deployedAt: over15mAgo },
      { name: "yoin-integration-notification-sender", deployedSha: SHA_DEPLOYED_NEW, deployedAt: over15mAgo },
    ];
    const result = await applyMigrations({
      databaseUrl: dbUrl,
      migrationsDir: withDropDir,
      getDeployedLambdas: async () => readyLambdas,
      isCommitAncestor: isAncestor,
      now: () => now,
    });
    expect(result).toEqual({
      appliedCount: 1,
      skippedCount: 1,
      appliedTags: ["0001_drop_legacy_note"],
    });

    // 列が削除されたこと
    const checkAfter = new Client({ connectionString: dbUrl });
    await checkAfter.connect();
    try {
      const col = await checkAfter.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'groups' AND table_name = 'groups' AND column_name = 'legacy_note') AS exists`,
      );
      expect(col.rows[0].exists).toBe(false);
    } finally {
      await checkAfter.end();
    }
  });
});
