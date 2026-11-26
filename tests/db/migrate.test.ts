import { describe, expect, it } from "vitest";
import type { MigrationFile } from "../../scripts/check-migrations.ts";
import {
  findUnappliedOlderMigrations,
  formatSafeError,
  MAX_LAMBDA_DURATION_MS,
  MigrationApplyError,
  selectPendingMigrations,
  verifyRequiresDeployed,
} from "../../scripts/migrate.ts";
import type { DeployedLambdaInfo } from "../../scripts/migrate.ts";
import { assertLocalhostDatabaseUrl } from "../../scripts/run-integration-tests.ts";

const SHA_STOP_USING = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_DEPLOYED_NEW = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SHA_DEPLOYED_OLD = "cccccccccccccccccccccccccccccccccccccccc";

function makeMigration(overrides: Partial<MigrationFile> & { idx: number; tag: string; when: number }): MigrationFile {
  return {
    hash: `hash-${overrides.tag}`,
    filePath: `/tmp/${overrides.tag}.sql`,
    sql: "SELECT 1;",
    requiresDeployed: [],
    hasDestructiveDrop: false,
    ...overrides,
  };
}

describe("findUnappliedOlderMigrations / selectPendingMigrations", () => {
  it("DBに記録済みの最新時刻以下で未適用のSQLを検出する", () => {
    const migrations = [
      makeMigration({ idx: 0, tag: "0000_first", when: 1000, hash: "h0" }),
      makeMigration({ idx: 1, tag: "0001_missed_older", when: 1500, hash: "h1" }),
      makeMigration({ idx: 2, tag: "0002_same_ts_unapplied", when: 2000, hash: "h2-new" }),
      makeMigration({ idx: 3, tag: "0003_applied", when: 2000, hash: "h3" }),
      makeMigration({ idx: 4, tag: "0004_pending", when: 3000, hash: "h4" }),
    ];
    const applied = [
      { hash: "h0", createdAt: 1000 },
      { hash: "h3", createdAt: 2000 },
    ];

    const unappliedOlder = findUnappliedOlderMigrations(migrations, applied);
    expect(unappliedOlder.map((m) => m.tag)).toEqual(["0001_missed_older", "0002_same_ts_unapplied"]);

    const pending = selectPendingMigrations(migrations, applied);
    expect(pending.map((m) => m.tag)).toEqual(["0004_pending"]);
  });
});

describe("verifyRequiresDeployed", () => {
  const dropMigration = makeMigration({
    idx: 1,
    tag: "0001_drop_col",
    when: 2000,
    requiresDeployed: [SHA_STOP_USING],
    hasDestructiveDrop: true,
  });

  const baseNow = new Date("2026-11-27T01:00:00Z");
  const over15mAgo = new Date(baseNow.getTime() - MAX_LAMBDA_DURATION_MS - 1_000).toISOString();
  const exact15mAgo = new Date(baseNow.getTime() - MAX_LAMBDA_DURATION_MS).toISOString();
  const under15mAgo = new Date(baseNow.getTime() - MAX_LAMBDA_DURATION_MS + 1_000).toISOString();

  const isAncestor = (ancestor: string, descendant: string): boolean =>
    ancestor === SHA_STOP_USING && (descendant === SHA_STOP_USING || descendant === SHA_DEPLOYED_NEW);

  it("全3つのLambdaが対象コミットを含み、切替から15分より長く経過していれば通過する", async () => {
    const lambdas: DeployedLambdaInfo[] = [
      { name: "yoin-integration-api", deployedSha: SHA_DEPLOYED_NEW, deployedAt: over15mAgo },
      { name: "yoin-integration-pre-sign-up", deployedSha: SHA_STOP_USING, deployedAt: over15mAgo },
      { name: "yoin-integration-notification-sender", deployedSha: SHA_DEPLOYED_NEW, deployedAt: over15mAgo },
    ];
    await expect(
      verifyRequiresDeployed([dropMigration], {
        getDeployedLambdas: async () => lambdas,
        isCommitAncestor: isAncestor,
        now: () => baseNow,
      }),
    ).resolves.toBeUndefined();
  });

  it("いずれかのLambdaが対象コミットを含まなければ拒否する", async () => {
    const lambdas: DeployedLambdaInfo[] = [
      { name: "yoin-integration-api", deployedSha: SHA_DEPLOYED_NEW, deployedAt: over15mAgo },
      { name: "yoin-integration-pre-sign-up", deployedSha: SHA_DEPLOYED_OLD, deployedAt: over15mAgo },
      { name: "yoin-integration-notification-sender", deployedSha: SHA_DEPLOYED_NEW, deployedAt: over15mAgo },
    ];
    await expect(
      verifyRequiresDeployed([dropMigration], {
        getDeployedLambdas: async () => lambdas,
        isCommitAncestor: isAncestor,
        now: () => baseNow,
      }),
    ).rejects.toThrow(MigrationApplyError);
  });

  it("切替からの経過がちょうど15分または15分未満のLambdaがあれば拒否する", async () => {
    for (const deployedAt of [exact15mAgo, under15mAgo]) {
      const lambdas: DeployedLambdaInfo[] = [
        { name: "yoin-integration-api", deployedSha: SHA_DEPLOYED_NEW, deployedAt: over15mAgo },
        { name: "yoin-integration-pre-sign-up", deployedSha: SHA_DEPLOYED_NEW, deployedAt },
        { name: "yoin-integration-notification-sender", deployedSha: SHA_DEPLOYED_NEW, deployedAt: over15mAgo },
      ];
      await expect(
        verifyRequiresDeployed([dropMigration], {
          getDeployedLambdas: async () => lambdas,
          isCommitAncestor: isAncestor,
          now: () => baseNow,
        }),
      ).rejects.toThrow(MigrationApplyError);
    }
  });

  it("Lambda一覧が未指定または空のとき拒否する", async () => {
    await expect(
      verifyRequiresDeployed([dropMigration], {
        getDeployedLambdas: null,
        isCommitAncestor: isAncestor,
        now: () => baseNow,
      }),
    ).rejects.toThrow(MigrationApplyError);

    await expect(
      verifyRequiresDeployed([dropMigration], {
        getDeployedLambdas: async () => [],
        isCommitAncestor: isAncestor,
        now: () => baseNow,
      }),
    ).rejects.toThrow(MigrationApplyError);
  });
});

describe("秘密情報の保護と接続先制限", () => {
  it("formatSafeErrorはDBドライバー例外のmessageに含まれる接続文字列や秘密を出さない", () => {
    const leaked = new Error("password authentication failed for postgres://admin:s3cr3t-token@ep-neon.example.com/yoin");
    const output = formatSafeError(leaked);
    expect(output).not.toContain("s3cr3t-token");
    expect(output).not.toContain("ep-neon.example.com");
    expect(output).not.toContain("postgres://");
  });

  it("assertLocalhostDatabaseUrlはlocalhost以外を拒否する", () => {
    expect(assertLocalhostDatabaseUrl("postgresql://postgres@127.0.0.1:5432/yoin_test")).toContain("127.0.0.1");
    expect(assertLocalhostDatabaseUrl("postgresql://postgres@localhost:5432/yoin_test")).toContain("localhost");
    expect(() => assertLocalhostDatabaseUrl("postgresql://user:pass@ep-cool.ap-southeast-1.aws.neon.tech/yoin")).toThrow();
  });
});
