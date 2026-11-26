import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stderr } from "node:process";
import { fileURLToPath } from "node:url";

const POSTGRES_IMAGE = "postgres:17-alpine";
const LOCALHOST_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const FORBIDDEN_QUERY_PARAMS = new Set(["host", "hostaddr", "service", "servicefile"]);
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 250;

interface DisposablePostgres {
  databaseUrl: string;
  stop: () => void;
}

/** 接続先URLがlocalhostのみを指すことを検証する。外部DB（Neon等）への誤接続を防ぐ。 */
export function assertLocalhostDatabaseUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("TEST_DATABASE_URLの形式が不正です");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("TEST_DATABASE_URLはpostgres://またはpostgresql://で指定してください");
  }
  if (!LOCALHOST_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error("TEST_DATABASE_URLはlocalhostのみ許可します");
  }
  for (const key of parsed.searchParams.keys()) {
    if (FORBIDDEN_QUERY_PARAMS.has(key.toLowerCase())) {
      throw new Error("TEST_DATABASE_URLのクエリによる接続先上書きは許可しません");
    }
  }
  return rawUrl;
}

function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

async function allocateFreePort(): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("空きポートの取得に失敗しました")));
        return;
      }
      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

function isDockerAvailable(): boolean {
  const result = spawnSync("docker", ["info"], { stdio: "ignore" });
  return result.status === 0;
}

function findLocalPostgresBinDir(): string | null {
  const candidates = [
    ...(process.env.PATH ?? "").split(":"),
    "/opt/homebrew/opt/postgresql@17/bin",
    "/usr/local/opt/postgresql@17/bin",
    "/usr/lib/postgresql/17/bin",
  ];
  for (const dir of candidates) {
    if (dir === "") {
      continue;
    }
    if (
      existsSync(join(dir, "initdb")) &&
      existsSync(join(dir, "pg_ctl")) &&
      existsSync(join(dir, "pg_isready")) &&
      existsSync(join(dir, "createdb"))
    ) {
      return dir;
    }
  }
  return null;
}

function startDockerPostgres(): DisposablePostgres {
  const containerId = execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "-p",
      "127.0.0.1::5432",
      "-e",
      "POSTGRES_USER=postgres",
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-e",
      "POSTGRES_DB=yoin_test",
      POSTGRES_IMAGE,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();

  const stop = (): void => {
    spawnSync("docker", ["rm", "-f", containerId], { stdio: "ignore" });
  };

  try {
    const portMapping = execFileSync("docker", ["port", containerId, "5432/tcp"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const firstLine = portMapping.split(/\r?\n/)[0] ?? "";
    const portMatch = /:(\d+)$/.exec(firstLine);
    if (portMatch === null) {
      throw new Error("PostgreSQLコンテナのポート番号を取得できませんでした");
    }
    const port = portMatch[1];

    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const ready = spawnSync(
        "docker",
        ["exec", containerId, "pg_isready", "-U", "postgres", "-d", "yoin_test"],
        { stdio: "ignore" },
      );
      if (ready.status === 0) {
        return {
          databaseUrl: `postgresql://postgres:postgres@127.0.0.1:${port}/yoin_test`,
          stop,
        };
      }
      sleepSync(READY_POLL_MS);
    }
    throw new Error("使い捨てPostgreSQLコンテナの起動がタイムアウトしました");
  } catch (error: unknown) {
    stop();
    throw error;
  }
}

async function startLocalPostgres(binDir: string): Promise<DisposablePostgres> {
  const workDir = mkdtempSync(join(tmpdir(), "yoin-pg-test-"));
  const dataDir = join(workDir, "data");
  const logFile = join(workDir, "postgres.log");
  const port = await allocateFreePort();
  const pgEnv = { ...process.env, LC_ALL: "C" };

  const stop = (): void => {
    spawnSync(join(binDir, "pg_ctl"), ["-D", dataDir, "-m", "immediate", "stop"], {
      stdio: "ignore",
      env: pgEnv,
    });
    rmSync(workDir, { recursive: true, force: true });
  };

  try {
    execFileSync(
      join(binDir, "initdb"),
      [
        "-D",
        dataDir,
        "--username=postgres",
        "--auth=trust",
        "--encoding=UTF8",
        "--locale=C",
        "--no-sync",
      ],
      { stdio: "ignore", env: pgEnv },
    );
    execFileSync(
      join(binDir, "pg_ctl"),
      [
        "-D",
        dataDir,
        "-l",
        logFile,
        "-o",
        `-h 127.0.0.1 -p ${port} -k '' -c fsync=off -c synchronous_commit=off`,
        "start",
      ],
      { stdio: "ignore", env: pgEnv },
    );

    const deadline = Date.now() + READY_TIMEOUT_MS;
    let isReady = false;
    while (Date.now() < deadline) {
      const ready = spawnSync(
        join(binDir, "pg_isready"),
        ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres"],
        { stdio: "ignore", env: pgEnv },
      );
      if (ready.status === 0) {
        isReady = true;
        break;
      }
      sleepSync(READY_POLL_MS);
    }
    if (!isReady) {
      throw new Error("使い捨てPostgreSQLの起動がタイムアウトしました");
    }

    execFileSync(
      join(binDir, "createdb"),
      ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "yoin_test"],
      { stdio: "ignore", env: pgEnv },
    );

    return {
      databaseUrl: `postgresql://postgres@127.0.0.1:${port}/yoin_test`,
      stop,
    };
  } catch (error: unknown) {
    stop();
    throw error;
  }
}

async function startDisposablePostgres(): Promise<DisposablePostgres> {
  const existing = process.env.TEST_DATABASE_URL ?? null;
  if (existing !== null && existing.trim() !== "") {
    return {
      databaseUrl: assertLocalhostDatabaseUrl(existing.trim()),
      stop: () => undefined,
    };
  }
  if (isDockerAvailable()) {
    return startDockerPostgres();
  }
  const localBin = findLocalPostgresBinDir();
  if (localBin !== null) {
    return await startLocalPostgres(localBin);
  }
  throw new Error(
    "使い捨てPostgreSQLを起動できませんでした。DockerまたはPostgreSQL 17（initdb/pg_ctl）を用意してください。",
  );
}

async function main(): Promise<number> {
  let pg: DisposablePostgres | null = null;
  try {
    pg = await startDisposablePostgres();
    const vitestBin = resolve("node_modules", ".bin", process.platform === "win32" ? "vitest.cmd" : "vitest");
    const result = spawnSync(vitestBin, ["run", "--config", "vitest.integration.config.ts"], {
      stdio: "inherit",
      env: {
        ...process.env,
        TEST_DATABASE_URL: pg.databaseUrl,
      },
    });
    return result.status ?? 1;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "結合試験の実行に失敗しました";
    stderr.write(`エラー: ${message}\n`);
    return 1;
  } finally {
    if (pg !== null) {
      pg.stop();
    }
  }
}

const entryPath = process.argv[1] ?? null;
if (entryPath !== null && realpathSync(entryPath) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
