import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkMigrations,
  containsDestructiveDrop,
  MigrationValidationError,
  parseRequiresDeployed,
  readAndValidateMigrations,
  runDrizzleKitCheck,
} from "../../scripts/check-migrations.ts";

const VALID_SHA = "1111111111111111111111111111111111111111";

let fixtureDir: string;

beforeEach(() => {
  mkdirSync("dist", { recursive: true });
  fixtureDir = mkdtempSync(resolve("dist/check-migrations-test-"));
});

afterEach(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

function writeFixtureMigrations(
  entries: Array<{ idx: number; when: number; tag: string; sql: string; breakpoints?: boolean }>,
): string {
  const migrationsDir = join(fixtureDir, "migrations");
  const metaDir = join(migrationsDir, "meta");
  mkdirSync(metaDir, { recursive: true });
  writeFileSync(
    join(metaDir, "_journal.json"),
    JSON.stringify(
      {
        version: "7",
        dialect: "postgresql",
        entries: entries.map(({ idx, when, tag, breakpoints }) => ({
          idx,
          version: "7",
          when,
          tag,
          breakpoints: breakpoints ?? true,
        })),
      },
      null,
      2,
    ),
  );
  for (const entry of entries) {
    writeFileSync(join(migrationsDir, `${entry.tag}.sql`), entry.sql);
  }
  return migrationsDir;
}

describe("parseRequiresDeployed", () => {
  it("先頭コメントの40桁SHAを抽出する", () => {
    const result = parseRequiresDeployed(
      `\n-- comment\n-- requires-deployed: ${VALID_SHA}\nALTER TABLE "t" DROP COLUMN "old";\n`,
    );
    expect(result).toEqual({ shas: [VALID_SHA], invalidLines: [] });
  });

  it("短縮SHAや先頭以外の記述を不正として検出する", () => {
    const shortSha = parseRequiresDeployed("-- requires-deployed: abcdef1\nDROP TABLE t;\n");
    expect(shortSha.shas).toEqual([]);
    expect(shortSha.invalidLines.length).toBe(1);

    const midFile = parseRequiresDeployed(`SELECT 1;\n-- requires-deployed: ${VALID_SHA}\n`);
    expect(midFile.shas).toEqual([]);
    expect(midFile.invalidLines.length).toBe(1);
  });
});

describe("containsDestructiveDrop", () => {
  it("DROP TABLE / DROP COLUMN を検出し、コメントや文字列リテラル内は無視する", () => {
    expect(containsDestructiveDrop('DROP TABLE "groups"."old";')).toBe(true);
    expect(containsDestructiveDrop('ALTER TABLE "groups"."users" DROP COLUMN IF EXISTS "legacy";')).toBe(true);
    expect(containsDestructiveDrop("-- DROP TABLE fake\nSELECT 'DROP COLUMN fake', $$DROP TABLE x$$;")).toBe(false);
    expect(containsDestructiveDrop("/* outer /* DROP TABLE nested */ still comment */ CREATE TABLE t (id int);")).toBe(false);
  });

  it("COLUMNを省略したALTER TABLE ... DROPを検出し、制約・DEFAULT・NOT NULLの削除は誤検知しない", () => {
    expect(containsDestructiveDrop("ALTER TABLE groups DROP old_col;")).toBe(true);
    expect(containsDestructiveDrop('ALTER TABLE groups DROP IF EXISTS "old_col";')).toBe(true);
    expect(containsDestructiveDrop("ALTER TABLE groups ADD COLUMN next_col text, DROP old_col;")).toBe(true);
    expect(containsDestructiveDrop("ALTER TABLE groups ALTER COLUMN name DROP DEFAULT, DROP legacy;")).toBe(true);
    expect(containsDestructiveDrop("ALTER TABLE groups DROP CONSTRAINT groups_name_key;")).toBe(false);
    expect(containsDestructiveDrop("ALTER TABLE groups ALTER COLUMN name DROP DEFAULT;")).toBe(false);
    expect(containsDestructiveDrop("ALTER TABLE groups ALTER COLUMN name DROP NOT NULL;")).toBe(false);
    expect(containsDestructiveDrop("ALTER TABLE groups ALTER COLUMN id DROP IDENTITY;")).toBe(false);
    expect(containsDestructiveDrop("ALTER TABLE groups ALTER COLUMN gen DROP EXPRESSION;")).toBe(false);
  });
});

describe("readAndValidateMigrations", () => {
  it("空のjournalと時刻が単調増加するjournalを受け入れる", () => {
    const emptyDir = writeFixtureMigrations([]);
    expect(readAndValidateMigrations(emptyDir)).toEqual([]);

    const validDir = writeFixtureMigrations([
      { idx: 0, when: 1700000001000, tag: "0000_init", sql: "CREATE TABLE t (id int PRIMARY KEY);" },
      {
        idx: 1,
        when: 1700000002000,
        tag: "0001_drop_col",
        sql: `-- requires-deployed: ${VALID_SHA}\nALTER TABLE t DROP COLUMN legacy;`,
      },
    ]);
    const migrations = readAndValidateMigrations(validDir);
    expect(migrations.map((m) => m.tag)).toEqual(["0000_init", "0001_drop_col"]);
    expect(migrations[1].requiresDeployed).toEqual([VALID_SHA]);
    expect(migrations[1].hasDestructiveDrop).toBe(true);
  });

  it("journalの時刻が逆転または同一のとき失敗する", () => {
    const reversedDir = writeFixtureMigrations([
      { idx: 0, when: 1700000002000, tag: "0000_a", sql: "SELECT 1;" },
      { idx: 1, when: 1700000001000, tag: "0001_b", sql: "SELECT 2;" },
    ]);
    expect(() => readAndValidateMigrations(reversedDir)).toThrow(MigrationValidationError);

    const equalDir = writeFixtureMigrations([
      { idx: 0, when: 1700000002000, tag: "0000_a", sql: "SELECT 1;" },
      { idx: 1, when: 1700000002000, tag: "0001_b", sql: "SELECT 2;" },
    ]);
    expect(() => readAndValidateMigrations(equalDir)).toThrow(MigrationValidationError);
  });

  it("requires-deployedのないDROP TABLE / DROP COLUMNを拒否する", () => {
    const dir = writeFixtureMigrations([
      { idx: 0, when: 1700000001000, tag: "0000_drop", sql: "ALTER TABLE users DROP COLUMN old_name;" },
    ]);
    expect(() => readAndValidateMigrations(dir)).toThrow(/requires-deployed|検証に失敗/);
  });

  it("journalに未登録のSQLファイルがあると失敗する", () => {
    const dir = writeFixtureMigrations([
      { idx: 0, when: 1700000001000, tag: "0000_init", sql: "SELECT 1;" },
    ]);
    writeFileSync(join(dir, "0001_orphan.sql"), "SELECT 2;");
    expect(() => readAndValidateMigrations(dir)).toThrow(MigrationValidationError);
  });
});

describe("drizzle-kit check", () => {
  it("リポジトリの現在の設定とdb/migrationsで成功する", () => {
    expect(() => checkMigrations()).not.toThrow();
  });

  it("同じprevIdから分岐した2つのスナップショットを失敗として検出する", () => {
    const migrationsDir = writeFixtureMigrations([
      { idx: 0, when: 1700000001000, tag: "0000_base", sql: "CREATE TABLE a (id int);" },
      { idx: 1, when: 1700000002000, tag: "0001_branch_a", sql: "CREATE TABLE b (id int);" },
      { idx: 2, when: 1700000003000, tag: "0002_branch_b", sql: "CREATE TABLE c (id int);" },
    ]);
    const metaDir = join(migrationsDir, "meta");
    const baseSnapshot = (id: string, prevId: string) => JSON.stringify({
      id,
      prevId,
      version: "7",
      dialect: "postgresql",
      tables: {},
      enums: {},
      schemas: {},
      sequences: {},
      roles: {},
      policies: {},
      views: {},
      _meta: { columns: {}, schemas: {}, tables: {} },
    });
    const rootId = "00000000-0000-0000-0000-000000000000";
    const id0 = "11111111-1111-1111-1111-111111111111";
    const id1 = "22222222-2222-2222-2222-222222222222";
    const id2 = "33333333-3333-3333-3333-333333333333";
    writeFileSync(join(metaDir, "0000_snapshot.json"), baseSnapshot(id0, rootId));
    writeFileSync(join(metaDir, "0001_snapshot.json"), baseSnapshot(id1, id0));
    // 0002が0001ではなく0000から分岐している（並行PRの衝突）
    writeFileSync(join(metaDir, "0002_snapshot.json"), baseSnapshot(id2, id0));

    const configPath = join(fixtureDir, "drizzle.config.ts");
    writeFileSync(
      configPath,
      `export default { dialect: "postgresql", schema: "./src/contexts/*/infrastructure/schema.ts", out: ${JSON.stringify(migrationsDir)} };\n`,
    );

    expect(() => runDrizzleKitCheck(configPath)).toThrow(MigrationValidationError);
  });
});
