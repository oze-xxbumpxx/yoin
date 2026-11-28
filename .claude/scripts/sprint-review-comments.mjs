import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dayInTz, harnessTz } from '../lib/harness-time.mjs';

const reviewers = new Set(['devin-ai-integration[bot]', 'chatgpt-codex-connector[bot]']);

export function fetchReviewComments(since, until, { run = execFileSync, tz = harnessTz() } = {}) {
  const utcDateBeforeStart = new Date(since);
  utcDateBeforeStart.setUTCDate(utcDateBeforeStart.getUTCDate() - 1);
  const pages = JSON.parse(run('gh', [
    'api', '--hostname', 'github.com', '--method', 'GET',
    'repos/oze-xxbumpxx/yoin/pulls/comments', '--paginate', '--slurp',
    '-f', `since=${utcDateBeforeStart.toISOString()}`, '-f', 'sort=updated', '-F', 'per_page=100',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }));
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) throw new Error('invalid GitHub response');

  const comments = [];
  for (const comment of pages.flat()) {
    const author = comment.user?.login;
    if (!reviewers.has(author) || comment.in_reply_to_id != null) continue;
    const day = dayInTz(new Date(comment.created_at), tz);
    if (day < since || day > until) continue;
    const pr = Number(comment.pull_request_url?.match(/\/pulls\/(\d+)$/)?.[1]);
    if (!Number.isSafeInteger(pr) || pr < 1) throw new Error('invalid PR number');
    comments.push({ pr, author, createdAt: comment.created_at, url: comment.html_url, body: comment.body });
  }
  return comments;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dates = process.argv.slice(2);
  const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(value).toJSON()?.slice(0, 10) === value;
  if (dates.length !== 2 || !dates.every(isDay) || dates[0] > dates[1]) {
    console.error('集計の開始日と終了日をYYYY-MM-DDで指定する。');
    process.exitCode = 2;
  } else {
    try {
      console.log(JSON.stringify(fetchReviewComments(...dates)));
    } catch {
      console.error('PRスレッドは未確認。ghの認証とGitHubへの接続を確かめる。');
      process.exitCode = 1;
    }
  }
}
