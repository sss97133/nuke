#!/usr/bin/env node
// The PR title gate from .github/workflows/pre-deploy-check.yml, runnable before you open or push a PR.
//
//   node scripts/ci/pr-title-check.mjs "fix(ci): anchor regex literals"   # check a title; exit 1 when the gate would fail
//   node scripts/ci/pr-title-check.mjs                                    # check the current branch's open PR (gh)
//   node scripts/ci/pr-title-check.mjs --warn                             # same, but never fails (verify.sh hint)
//   gh pr edit --title "..."  then  gh run rerun <run> --failed           # the gate reads the live title on rerun
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Keep identical to pre-deploy-check.yml; pr-title-check.test.mjs fails when they drift.
export const TITLE_RE = '^(feat|fix|perf|refactor|data|docs|test|ci|build|chore|revert)(\\([a-z0-9_./-]+\\))?!?: [a-z0-9`][^§]*[^.]$';
export const MAX = 72;

export function checkTitle(title) {
  if (title.startsWith('Revert "')) return { ok: true, length: [...title].length, problems: [] };
  const length = [...title].length;
  const problems = [];
  if (length > MAX) problems.push(`${length} characters; the limit is ${MAX} (cut ${length - MAX})`);
  if (!new RegExp(TITLE_RE).test(title)) {
    const head = title.match(/^([a-z]+)(\(([^)]*)\))?!?: (.?)/);
    if (!head) problems.push("not 'type(scope): summary'");
    else {
      if (!/^(feat|fix|perf|refactor|data|docs|test|ci|build|chore|revert)$/.test(head[1])) problems.push(`unknown type '${head[1]}'`);
      if (head[3] != null && !/^[a-z0-9_./-]+$/.test(head[3])) problems.push(`scope '${head[3]}' must be lowercase [a-z0-9_./-]`);
      if (!/[a-z0-9`]/.test(head[4])) problems.push('summary must start lowercase');
    }
    if (title.endsWith('.')) problems.push('no trailing period');
    if (title.includes('§')) problems.push("no '§' case numbers");
    if (!problems.length) problems.push("not 'type(scope): lowercase summary'");
  }
  return { ok: problems.length === 0, length, problems };
}

function branchPrTitle() {
  try {
    return execFileSync('gh', ['pr', 'view', '--json', 'title', '-q', '.title'],
      { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}

function main() {
  const args = process.argv.slice(2);
  const warn = args.includes('--warn');
  const given = args.filter(a => a !== '--warn').join(' ');
  const title = given || branchPrTitle();
  if (!title) { if (!warn) console.log('pr-title-check: no title given and no open PR for this branch'); return; }
  const r = checkTitle(title);
  if (r.ok) { if (!warn) console.log(`pr-title-check: ok (${r.length}/${MAX}) ${title}`); return; }
  console.log(`pr-title-check: the PR gate will fail this title: ${r.problems.join('; ')}\n  ${title}\n  fix: gh pr edit --title "type(scope): lowercase summary"`);
  if (!warn) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
