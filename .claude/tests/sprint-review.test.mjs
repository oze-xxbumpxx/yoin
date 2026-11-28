import { readFileSync, realpathSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const skill = '.claude/skills/sprint-review/SKILL.md';
const policy = new URL('docs/agents/improvement.md', root).href;

test('日曜レトロはClaude CodeとDevinで同じ手順を使い、委譲記録とPRの指摘を読む', () => {
  assert.equal(
    realpathSync(new URL('.agents/skills/sprint-review/SKILL.md', root)),
    realpathSync(new URL(skill, root)),
  );
  assert.match(read(skill), /delegations\/\*\.yml/);
  assert.match(read(skill), /devin-ai-integration\[bot\]/);
  assert.match(read(skill), /chatgpt-codex-connector\[bot\]/);
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
