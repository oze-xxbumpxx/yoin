import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fetchReviewComments } from '../scripts/sprint-review-comments.mjs';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const skill = '.claude/skills/sprint-review/SKILL.md';
const policy = new URL('docs/agents/improvement.md', root).href;

test('日曜レトロはClaude CodeとDevinで同じ手順を使う', () => {
  assert.equal(
    realpathSync(new URL('.agents/skills/sprint-review/SKILL.md', root)),
    realpathSync(new URL(skill, root)),
  );
});

test('PRコメントを全ページ読み、投稿日時を日本時間に直して集計期間の指摘だけを残す', () => {
  const devin = 'devin-ai-integration[bot]';
  const codex = 'chatgpt-codex-connector[bot]';
  const comment = (id, pr, login, createdAt, extra) => ({
    user: { login },
    pull_request_url: `https://api.github.com/repos/oze-xxbumpxx/yoin/pulls/${pr}`,
    html_url: `https://github.com/oze-xxbumpxx/yoin/pull/${pr}#discussion_r${id}`,
    created_at: createdAt,
    updated_at: '2026-07-06T00:00:00Z',
    body: `finding ${id}`,
    ...extra,
  });
  const start = '2026-06-28T15:00:00Z';
  const end = '2026-07-05T14:59:59Z';
  const run = (file, args) => {
    assert.equal(file, 'gh');
    assert.deepEqual(args, [
      'api', '--hostname', 'github.com', '--method', 'GET',
      'repos/oze-xxbumpxx/yoin/pulls/comments', '--paginate', '--slurp',
      '-f', 'since=2026-06-28T00:00:00.000Z', '-f', 'sort=updated', '-F', 'per_page=100',
    ]);
    return JSON.stringify([
      [
        comment(10, 72, devin, '2026-06-28T14:59:59Z'),
        comment(11, 72, devin, start),
        comment(12, 72, codex, start, { in_reply_to_id: 11 }),
      ],
      [
        comment(13, 75, codex, end),
        comment(14, 75, devin, '2026-07-05T15:00:00Z'),
        comment(15, 75, 'someone-else', end),
      ],
    ]);
  };
  assert.deepEqual(fetchReviewComments('2026-06-29', '2026-07-05', { run, tz: 'Asia/Tokyo' }), [
    { pr: 72, author: devin, createdAt: start, url: 'https://github.com/oze-xxbumpxx/yoin/pull/72#discussion_r11', body: 'finding 11' },
    { pr: 75, author: codex, createdAt: end, url: 'https://github.com/oze-xxbumpxx/yoin/pull/75#discussion_r13', body: 'finding 13' },
  ]);
});

test('PRスレッドを読めない場合は0件と区別する', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sprint-review-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const gh = join(dir, 'gh');
  const script = fileURLToPath(new URL('.claude/scripts/sprint-review-comments.mjs', root));
  const run = () => spawnSync(process.execPath, [script, '2026-06-29', '2026-07-05'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: dir },
  });

  writeFileSync(gh, '#!/bin/sh\nprintf "[[]]\\n"\n', { mode: 0o700 });
  const empty = run();
  assert.equal(empty.status, 0);
  assert.deepEqual(JSON.parse(empty.stdout), []);
  assert.equal(empty.stderr, '');

  writeFileSync(gh, '#!/bin/sh\nprintf "[[]]\\n"\nprintf "auth error\\n" >&2\nexit 4\n');
  const unavailable = run();
  assert.equal(unavailable.status, 1);
  assert.equal(unavailable.stdout, '');
  assert.match(unavailable.stderr, /PRスレッドは未確認/);
  assert.doesNotMatch(unavailable.stderr, /auth error/);
});

test('REVIEW.mdと振り返りの手順は同じ3回の決まりを参照する', () => {
  assert.match(read('docs/agents/improvement.md'), /同じ型の事象が3回/);
  for (const path of [
    skill,
    'REVIEW.md',
    '.claude/skills/reflect-task/SKILL.md',
    'docs/claude-code/improvements/improvement-backlog.md',
    'docs/claude-code/memory-policy.md',
  ]) {
    const link = read(path).match(/\[改善候補にする回数\]\(([^)]+)\)/);
    assert.ok(link, path);
    assert.equal(new URL(link[1], new URL(path, root)).href, policy, path);
  }
});
