// Contract for scripts/ci/typecheck-ratchet.mjs: parsing tsc output, the per-file ratchet, lowering, and the CLI exits.
//   node --test scripts/ci/typecheck-ratchet.test.mjs   (run by scripts/ci/verify.sh)
// End-to-end cases run main() against a fixture checkout whose tsc is a stub printing canned diagnostics per project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baselineDocument, compareToBaseline, loweredFiles, main, parseTscOutput, projectsOf } from './typecheck-ratchet.mjs';

const SCRIPT = fileURLToPath(new URL('./typecheck-ratchet.mjs', import.meta.url));

test('parses file diagnostics relative to the repo root and keys file-less ones by project', () => {
  const out = [
    "src/a.tsx(1,2): error TS2322: Type 'x' is not assignable.",
    '  continuation of the message',
    "src/a.tsx(9,1): error TS2339: Property 'y' does not exist.",
    "vite.config.ts(84,3): error TS2769: No overload matches this call.",
    "error TS5083: Cannot read file 'missing.json'.",
    'src/b.ts(3,3): warning-ish noise that is not an error',
  ].join('\n');
  const { counts, lines } = parseTscOutput(out, { frontendDir: '/r/nuke_frontend', root: '/r', project: 'tsconfig.app.json' });
  assert.deepEqual(counts, { 'nuke_frontend/src/a.tsx': 2, 'nuke_frontend/vite.config.ts': 1, 'nuke_frontend/tsconfig.app.json': 1 });
  assert.equal(lines['nuke_frontend/src/a.tsx'].length, 2);
});

test('a rise or a new file with errors regresses; a fall improves; equal is quiet', () => {
  const { regressions, improvements } = compareToBaseline({ a: 3, b: 1, c: 2, d: 0 }, { a: 2, b: 1, c: 5, d: 1 });
  assert.deepEqual(regressions, [{ file: 'a', baseline: 2, current: 3, added: 1, new_file: false }]);
  assert.deepEqual(improvements, [{ file: 'c', baseline: 5, current: 2 }, { file: 'd', baseline: 1, current: 0 }]);
  assert.deepEqual(compareToBaseline({ n: 1 }, {}).regressions, [{ file: 'n', baseline: 0, current: 1, added: 1, new_file: true }]);
});

test('lowering never raises a count, drops zeros and never adds a file', () => {
  assert.deepEqual(loweredFiles({ a: 2, b: 3, c: 1 }, { a: 5, b: 1, z: 4 }), { a: 2, b: 1 });
  const doc = baselineDocument({ b: 1, a: 2 }, ['tsconfig.app.json'], '2026-10-19');
  assert.equal(doc.total, 3);
  assert.deepEqual(Object.keys(doc.files), ['a', 'b']);
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'nuke-typecheck-'));
  const fe = join(root, 'nuke_frontend');
  mkdirSync(fe, { recursive: true });
  writeFileSync(join(fe, 'tsconfig.json'), JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.node.json' }] }));
  const tsc = join(root, 'fake-tsc');
  // Prints the canned output for the project named after -p, exits 2 when it printed anything (as tsc does), or crashes.
  writeFileSync(tsc, `#!/bin/sh
proj="$2"
if [ "$FAKE_TSC_CRASH" = "$proj" ]; then echo "tsc: internal error" >&2; exit 1; fi
f="$FAKE_TSC_DIR/$proj.out"
if [ -s "$f" ]; then cat "$f"; exit 2; fi
exit 0
`, { mode: 0o755 });
  const outDir = join(root, 'out');
  mkdirSync(outDir);
  const setOutput = (project, text) => writeFileSync(join(outDir, `${project}.out`), text);
  const baseline = join(root, 'baseline.json');
  const env = (extra = {}) => ({ TYPECHECK_ROOT: root, TYPECHECK_TSC: tsc, TYPECHECK_BASELINE: baseline, FAKE_TSC_DIR: outDir, ...extra });
  const run = (extra = {}, argv = []) => { const logs = []; const code = main(argv, env(extra), (l) => logs.push(l)); return { code, out: logs.join('\n') }; };
  return { root, fe, setOutput, baseline, env, run, done: () => rmSync(root, { recursive: true, force: true }) };
}

const E = (file, n = 1) => Array.from({ length: n }, (_, i) => `${file}(${i + 1},1): error TS2322: fixture error ${i}`).join('\n');

test('end to end: seed, pass, regress, new file, lower locally, report only under CI, tsc crash', () => {
  const f = fixture();
  try {
    assert.deepEqual(projectsOf(f.fe), ['tsconfig.app.json', 'tsconfig.node.json']);
    f.setOutput('tsconfig.app.json', `${E('src/a.tsx', 3)}\n${E('src/b.tsx', 2)}`);
    f.setOutput('tsconfig.node.json', E('vite.config.ts', 1));
    let r = f.run({}, ['--write-baseline']);
    assert.equal(r.code, 0);
    const seeded = JSON.parse(readFileSync(f.baseline, 'utf8'));
    assert.equal(seeded.total, 6);
    assert.deepEqual(seeded.files, { 'nuke_frontend/src/a.tsx': 3, 'nuke_frontend/src/b.tsx': 2, 'nuke_frontend/vite.config.ts': 1 });
    assert.ok(existsSync(join(f.fe, '.tsbuild')), 'build info directory is created inside the checkout');

    r = f.run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /type-check PASS/);

    f.setOutput('tsconfig.app.json', `${E('src/a.tsx', 4)}\n${E('src/b.tsx', 2)}`);
    r = f.run();
    assert.equal(r.code, 1);
    assert.match(r.out, /✗ nuke_frontend\/src\/a\.tsx: 4 > baseline 3/);
    assert.match(r.out, /src\/a\.tsx\(4,1\): error TS2322/);

    f.setOutput('tsconfig.app.json', `${E('src/a.tsx', 3)}\n${E('src/b.tsx', 2)}\n${E('src/pages/jobs/New.tsx', 1)}`);
    r = f.run();
    assert.equal(r.code, 1);
    assert.match(r.out, /New\.tsx: 1 > baseline 0 \(file not in the baseline\)/);

    f.setOutput('tsconfig.app.json', E('src/a.tsx', 1));
    f.setOutput('tsconfig.node.json', '');
    const before = readFileSync(f.baseline, 'utf8');
    r = f.run({ CI: 'true' });
    assert.equal(r.code, 0);
    assert.match(r.out, /5 fewer errors in 3 files/);
    assert.equal(readFileSync(f.baseline, 'utf8'), before, 'CI never rewrites the baseline');
    r = f.run({ CI: '' });
    assert.equal(r.code, 0);
    assert.match(r.out, /lowered the baseline by 5 errors in 3 files/);
    assert.deepEqual(JSON.parse(readFileSync(f.baseline, 'utf8')).files, { 'nuke_frontend/src/a.tsx': 1 });

    r = f.run({ FAKE_TSC_CRASH: 'tsconfig.node.json' });
    assert.equal(r.code, 2);
    assert.match(r.out, /tsc did not run cleanly on tsconfig\.node\.json/);
  } finally {
    f.done();
  }
});

test('the CLI exits with the ratchet result', () => {
  const f = fixture();
  try {
    f.setOutput('tsconfig.app.json', E('src/a.tsx', 1));
    writeFileSync(f.baseline, JSON.stringify(baselineDocument({}, ['tsconfig.app.json', 'tsconfig.node.json'], '2026-10-19')));
    const r = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, ...f.env(), CI: 'true' }, encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /type-check FAILED/);
  } finally {
    f.done();
  }
});
