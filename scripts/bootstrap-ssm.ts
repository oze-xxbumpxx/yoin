import { stdin, stderr } from "node:process";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import parameters from "../infra/terraform/bootstrap/parameters.json" with { type: "json" };

type Environment = "integration" | "production";
type Prompt = (name: string) => Promise<string>;
type Send = (command: PutParameterCommand) => Promise<unknown>;
type Report = (message: string) => void;

/** Terraformと同じ一覧から、対象環境のSSM名だけを返します。 */
export function parameterNames(environment: Environment): string[] {
  return Object.entries(parameters).flatMap(([scope, names]) =>
    names.map((name) => `/yoin/${environment}/${scope}/${name}`),
  );
}

/** 既存値は上書きせず、値と例外の本文を出力しません。 */
export async function registerParameter(
  name: string, prompt: Prompt, send: Send, report: Report,
): Promise<boolean> {
  let value: string;
  try {
    value = await prompt(name);
  } catch {
    report(`${name}: 入力を中止しました。`);
    return false;
  }
  if (value.trim() === "") {
    report(`${name}: 空の値は登録しません。`);
    return false;
  }
  try {
    await send(new PutParameterCommand({
      Name: name,
      Value: value,
      Type: "SecureString",
      Tier: "Standard",
      Overwrite: false,
    }));
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ParameterAlreadyExists") {
      report(`${name}: 登録済みのため変更しませんでした。`);
      return true;
    }
    report(`${name}: 登録できませんでした。AWSの権限と接続先を確認してください。`);
    return false;
  }
  report(`${name}: 登録しました。`);
  return true;
}

async function promptHidden(name: string): Promise<string> {
  const mute = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const input = createInterface({ input: stdin, output: mute, terminal: true, historySize: 0 });
  try {
    stderr.write(`${name}の値 (非表示): `);
    return await new Promise<string>((resolve, reject) => {
      input.once("SIGINT", () => input.close());
      input.once("close", () => reject(new Error("Input closed")));
      input.question("", resolve);
    });
  } finally {
    input.close();
    mute.destroy();
    stderr.write("\n");
  }
}

async function main(args: string[]): Promise<number> {
  const environment = args[0] ?? null;
  const selected = args[1] ?? null;
  if ((environment !== "integration" && environment !== "production") || args.length > 2) {
    stderr.write("使い方: node scripts/bootstrap-ssm.ts <integration|production> [scope/name]\n");
    return 1;
  }
  const allNames = parameterNames(environment);
  const names = selected === null
    ? allNames
    : allNames.filter((name) => name === `/yoin/${environment}/${selected}`);
  if (names.length === 0 || !process.env.AWS_PROFILE || !stdin.isTTY || !stderr.isTTY) {
    stderr.write("有効なパラメーター名とAWS_PROFILEを指定し、Macの端末で実行してください。\n");
    return 1;
  }
  const client = new SSMClient({ region: "ap-southeast-1" });
  try {
    for (const name of names) {
      if (!await registerParameter(name, promptHidden, (command) => client.send(command),
        (message) => { stderr.write(`${message}\n`); })) return 1;
    }
    return 0;
  } finally {
    client.destroy();
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch {
    stderr.write("登録を中止しました。\n");
    process.exitCode = 1;
  }
}
