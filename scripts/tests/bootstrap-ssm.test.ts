import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { parameterNames, registerParameter } from "../bootstrap-ssm.ts";

test("パラメーター名を環境と用途で分ける", () => {
  for (const environment of ["integration", "production"] as const) {
    expect(parameterNames(environment)).toEqual([
      "runtime/database-url",
      "runtime/invite-hmac-key",
      "runtime/vapid-private-key",
      "pre-sign-up/database-url",
      "migration/database-url",
      "seed/owner-email",
      "seed/owner-display-name",
    ].map((path) => `/yoin/${environment}/${path}`));
  }
});

test("値をSecureStringとして送り、上書きも表示もしない", async () => {
  const value = "fake value for test ";
  const name = "/yoin/integration/seed/owner-display-name";
  const messages: string[] = [];
  let sent = false;
  const result = await registerParameter(name, async (promptedName) => {
    expect(promptedName).toBe(name);
    return value;
  }, async (command) => {
    expect(command.input).toEqual({ Name: name, Value: value, Tier: "Standard", Type: "SecureString", Overwrite: false });
    sent = true;
  }, (message) => messages.push(message));
  expect(result).toBe(true);
  expect(sent).toBe(true);
  expect(messages).toEqual([`${name}: 登録しました。`]);
});

test("重複とAWSエラーで応答本文や値を表示しない", async () => {
  const name = "/yoin/production/runtime/invite-hmac-key";
  const value = "secret-canary";
  for (const [errorName, expected, expectedMessage] of [
    ["ParameterAlreadyExists", true, "登録済み"],
    ["AccessDeniedException", false, "登録できませんでした"],
  ] as const) {
    const messages: string[] = [];
    const result = await registerParameter(name, async () => value, async () => {
      throw Object.assign(new Error(value), { name: errorName });
    }, (message) => messages.push(message));
    expect(result).toBe(expected);
    expect(messages.join("\n")).toContain(expectedMessage);
    expect(messages.join("\n")).not.toMatch(/secret-canary/);
  }
});

test("空の値と入力の中止ではAWSへ送らない", async () => {
  const name = "/yoin/integration/migration/database-url";
  const messages: string[] = [];
  let sent = false;
  const send = async () => { sent = true; };
  const report = (message: string) => messages.push(message);
  expect(await registerParameter(name, async () => "  ", send, report)).toBe(false);
  expect(await registerParameter(name, async () => { throw new Error("secret-canary"); }, send, report)).toBe(false);
  expect(sent).toBe(false);
  expect(messages).toEqual([`${name}: 空の値は登録しません。`, `${name}: 入力を中止しました。`]);
});

test("実行入口はパイプからの値を受け付けない", () => {
  const script = fileURLToPath(new URL("../bootstrap-ssm.ts", import.meta.url));
  const result = spawnSync(process.execPath, [script, "integration"], {
    env: { ...process.env, AWS_PROFILE: "fake-profile" },
    input: "secret-canary\n",
    encoding: "utf8",
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/Macの端末で実行/);
  expect(result.stdout + result.stderr).not.toMatch(/secret-canary/);
});
