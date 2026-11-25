import { deepEqual, equal, match, doesNotMatch } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { parameterNames, registerParameter } from "../bootstrap-ssm.ts";

test("パラメーター名を環境と用途で分ける", () => {
  for (const environment of ["integration", "production"] as const) {
    deepEqual(parameterNames(environment), [
      "runtime/database-url",
      "runtime/invite-hmac-key",
      "runtime/vapid-private-key",
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
    equal(promptedName, name);
    return value;
  }, async (command) => {
    deepEqual(command.input, { Name: name, Value: value, Tier: "Standard", Type: "SecureString", Overwrite: false });
    sent = true;
  }, (message) => messages.push(message));
  equal(result, true);
  equal(sent, true);
  deepEqual(messages, [`${name}: 登録しました。`]);
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
    equal(result, expected);
    match(messages.join("\n"), new RegExp(expectedMessage));
    doesNotMatch(messages.join("\n"), /secret-canary/);
  }
});

test("空の値と入力の中止ではAWSへ送らない", async () => {
  const name = "/yoin/integration/migration/database-url";
  const messages: string[] = [];
  let sent = false;
  const send = async () => { sent = true; };
  const report = (message: string) => messages.push(message);
  equal(await registerParameter(name, async () => "  ", send, report), false);
  equal(await registerParameter(name, async () => { throw new Error("secret-canary"); }, send, report), false);
  equal(sent, false);
  deepEqual(messages, [`${name}: 空の値は登録しません。`, `${name}: 入力を中止しました。`]);
});

test("実行入口はパイプからの値を受け付けない", () => {
  const script = new URL("../bootstrap-ssm.ts", import.meta.url);
  const result = spawnSync(process.execPath, [script.pathname, "integration"], {
    env: { ...process.env, AWS_PROFILE: "fake-profile" },
    input: "secret-canary\n",
    encoding: "utf8",
  });
  equal(result.status, 1);
  match(result.stderr, /Macの端末で実行/);
  doesNotMatch(result.stdout + result.stderr, /secret-canary/);
});
