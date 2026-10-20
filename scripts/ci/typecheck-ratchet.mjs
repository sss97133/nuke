#!/usr/bin/env node
/**
 * scripts/ci/typecheck-ratchet.mjs
 *
 * The frontend type check. nuke_frontend/tsconfig.json is a solution file (files: [], project references), so the old
 * `tsc --noEmit` checked nothing; this runs tsc on every referenced project (tsconfig.app.json, tsconfig.node.json) and
 * ratchets the per-file error counts against scripts/ci/typecheck-baseline.json:
 *   - a file whose count rises, or a file that is not in the baseline and has errors, fails (exit 1);
 *   - when counts fall and nothing rose, a local run lowers the baseline in place (commit it); under CI it only reports.
 * Incremental: tsBuildInfo per project in nuke_frontend/.tsbuild/ (gitignored, per checkout).
 *
 *   npm run type-check                 (nuke_frontend; the pre-commit hook and scripts/ci/verify.sh run this)
 *   node scripts/ci/typecheck-ratchet.mjs --write-baseline   re-seed the baseline from current counts
 *   node --test scripts/ci/typecheck-ratchet.test.mjs        (run by scripts/ci/verify.sh)
 * Test seams: TYPECHECK_ROOT (repo root), TYPECHECK_TSC (tsc executable), TYPECHECK_BASELINE (baseline path).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const GLOBAL_DIAGNOSTIC = /^error (TS\d+): (.*)$/;

const posix = (p) => p.split(sep).join('/');

// tsc --pretty false output -> { counts: {file: n}, lines: {file: [line]} }. Paths are made relative to the repo root;
// diagnostics without a file are keyed by the project's tsconfig path.
export function parseTscOutput(text, { frontendDir, root, project }) {
  const counts = {};
  const lines = {};
  for (const line of String(text).split(/\r?\n/)) {
    let key = null;
    const m = DIAGNOSTIC.exec(line);
    if (m) key = posix(relative(root, resolve(frontendDir, m[1])));
    else if (GLOBAL_DIAGNOSTIC.test(line)) key = posix(relative(root, resolve(frontendDir, project)));
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
    (lines[key] ||= []).push(line);
  }
  return { counts, lines };
}

export function totalOf(counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

// Rises (including files new to the baseline) and falls, sorted by path.
export function compareToBaseline(current, baselineFiles) {
  const regressions = [];
  const improvements = [];
  for (const file of Object.keys({ ...baselineFiles, ...current }).sort()) {
    const cur = current[file] || 0;
    const base = baselineFiles[file] || 0;
    if (cur > base) regressions.push({ file, baseline: base, current: cur, added: cur - base, new_file: !(file in baselineFiles) });
    else if (cur < base) improvements.push({ file, baseline: base, current: cur });
  }
  return { regressions, improvements };
}

// The baseline after a clean run: every count lowered to the current one, zero entries dropped, never raised.
export function loweredFiles(baselineFiles, current) {
  const out = {};
  for (const file of Object.keys(baselineFiles).sort()) {
    const n = Math.min(baselineFiles[file], current[file] || 0);
    if (n > 0) out[file] = n;
  }
  return out;
}

export function baselineDocument(files, projects, generated) {
  const sorted = Object.fromEntries(Object.keys(files).sort().map((f) => [f, files[f]]));
  return {
    generated,
    note: 'Ratchet floor for scripts/ci/typecheck-ratchet.mjs (npm run type-check). Per-file tsc error counts over the nuke_frontend projects; a file may not rise and a file not listed may not have errors. Lowered automatically by a clean local run; never raise it by hand.',
    projects,
    total: totalOf(sorted),
    files: sorted,
  };
}

export function projectsOf(frontendDir) {
  const solution = join(frontendDir, 'tsconfig.json');
  try {
    const refs = JSON.parse(readFileSync(solution, 'utf8')).references || [];
    const projects = refs.map((r) => posix(r.path).replace(/^\.\//, '')).filter((p) => p.endsWith('.json'));
    if (projects.length > 0) return projects;
  } catch {
    // fall through to the known projects
  }
  return ['tsconfig.app.json', 'tsconfig.node.json'];
}

function runTsc({ tsc, viaNode, frontendDir, project, env }) {
  const name = project.replace(/\.json$/, '').replace(/[^A-Za-z0-9_.-]/g, '_');
  const buildInfoDir = join(frontendDir, '.tsbuild');
  mkdirSync(buildInfoDir, { recursive: true });
  const args = ['-p', project, '--noEmit', '--pretty', 'false', '--incremental', '--tsBuildInfoFile', join(buildInfoDir, `${name}.tsbuildinfo`)];
  const opts = { cwd: frontendDir, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
  const r = viaNode ? spawnSync(process.execPath, [tsc, ...args], opts) : spawnSync(tsc, args, opts);
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}

export function main(argv = process.argv.slice(2), env = process.env, log = console.log) {
  const root = resolve(env.TYPECHECK_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const frontendDir = join(root, 'nuke_frontend');
  const baselinePath = env.TYPECHECK_BASELINE || join(root, 'scripts', 'ci', 'typecheck-baseline.json');
  const tsc = env.TYPECHECK_TSC || join(frontendDir, 'node_modules', 'typescript', 'bin', 'tsc');
  const viaNode = !env.TYPECHECK_TSC;
  const write = argv.includes('--write-baseline') || env.TYPECHECK_WRITE_BASELINE === '1';
  const projects = projectsOf(frontendDir);

  const counts = {};
  const lines = {};
  for (const project of projects) {
    const r = runTsc({ tsc, viaNode, frontendDir, project, env });
    const parsed = parseTscOutput(`${r.stdout}\n${r.stderr}`, { frontendDir, root, project });
    if (r.error || (r.status !== 0 && totalOf(parsed.counts) === 0)) {
      log(`type-check: tsc did not run cleanly on ${project} (status ${r.status}${r.error ? `, ${r.error.message}` : ''})`);
      log((r.stderr || r.stdout).split('\n').slice(0, 20).join('\n'));
      return 2;
    }
    for (const [f, n] of Object.entries(parsed.counts)) counts[f] = (counts[f] || 0) + n;
    for (const [f, l] of Object.entries(parsed.lines)) (lines[f] ||= []).push(...l);
  }
  const today = new Date().toISOString().slice(0, 10);

  if (write) {
    writeFileSync(baselinePath, `${JSON.stringify(baselineDocument(counts, projects, today), null, 2)}\n`);
    log(`type-check: wrote baseline ${posix(relative(root, baselinePath))}: ${totalOf(counts)} errors in ${Object.keys(counts).length} files`);
    return 0;
  }
  if (!existsSync(baselinePath)) {
    log(`type-check: no baseline at ${posix(relative(root, baselinePath))}; run with --write-baseline`);
    return 2;
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const baseFiles = baseline.files || {};
  const { regressions, improvements } = compareToBaseline(counts, baseFiles);
  log(`type-check: ${totalOf(counts)} errors in ${Object.keys(counts).length} files across ${projects.join(', ')} (baseline ${totalOf(baseFiles)})`);
  if (regressions.length > 0) {
    for (const r of regressions) {
      log(`  ✗ ${r.file}: ${r.current} > baseline ${r.baseline}${r.new_file ? ' (file not in the baseline)' : ''}`);
      for (const l of (lines[r.file] || []).slice(0, 10)) log(`      ${l}`);
    }
    log('type-check FAILED: fix the new type errors (the baseline only ever goes down).');
    return 1;
  }
  if (improvements.length > 0) {
    const fewer = improvements.reduce((a, i) => a + i.baseline - i.current, 0);
    if (env.CI) {
      log(`type-check: ${fewer} fewer errors in ${improvements.length} files than the baseline; lower it with a local run and commit scripts/ci/typecheck-baseline.json`);
    } else {
      writeFileSync(baselinePath, `${JSON.stringify(baselineDocument(loweredFiles(baseFiles, counts), baseline.projects || projects, today), null, 2)}\n`);
      log(`type-check: lowered the baseline by ${fewer} errors in ${improvements.length} files; commit scripts/ci/typecheck-baseline.json`);
    }
  }
  log('type-check PASS (no file gained type errors)');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
