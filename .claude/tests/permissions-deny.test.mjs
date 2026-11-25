// .claude/settings.jsonのpermissions.denyが、AGENTS.md「コマンドの範囲」の
// 禁止パスをClaude Codeの読み書き拒否として持っているかを確かめる。
// パスの書き方はClaude Codeの公式（https://code.claude.com/docs/en/permissions）に合わせる。
// ~/はホーム、先頭の/はプロジェクト設定ではリポジトリの根、**は配下すべて。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const settingsPath = join(dirname(fileURLToPath(import.meta.url)), '../settings.json');

const shellFiles = [
  '~/.bashrc',
  '~/.bash_profile',
  '~/.bash_login',
  '~/.profile',
  '~/.zshrc',
  '~/.zprofile',
  '~/.zshenv',
  '~/.zlogin',
];

const required = [
  'Read(~/.ssh/**)',
  'Edit(~/.ssh/**)',
  'Read(~/.aws/**)',
  'Edit(~/.aws/**)',
  'Read(~/.codex/**)',
  'Edit(~/.codex/**)',
  'Read(~/.gitconfig)',
  'Edit(~/.gitconfig)',
  ...shellFiles.flatMap((path) => [`Read(${path})`, `Edit(${path})`]),
  'Read(/.git/config)',
  'Edit(/.git/config)',
  'Read(/.git/hooks/**)',
  'Edit(/.git/hooks/**)',
];

test('コマンドの範囲で変えないパスをpermissions.denyが読み書きとも拒む', () => {
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  const deny = settings.permissions?.deny;
  assert.ok(Array.isArray(deny), 'permissions.deny が配列ではありません');

  for (const rule of required) {
    assert.ok(deny.includes(rule), `deny に無い: ${rule}`);
  }

  // 状態ディレクトリ（~/.local/state）は書いてよい例外。allow は deny を取り消せないので、ここを拒むルールは置かない。
  assert.equal(
    deny.some((rule) => rule.includes('~/.local') || rule.includes('~/**') || rule.includes('~/*')),
    false,
    'ホーム全体や状態ディレクトリを拒むルールがある',
  );
});
