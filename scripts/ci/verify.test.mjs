// Offline subprocess contracts for the actual gate. Never run a legacy gate
// against global /tmp/ci_*: translate only that namespace into this fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, stat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

const source = await readFile(new URL('./verify.sh', import.meta.url), 'utf8');
const migrationVersions = await readFile(new URL('./migration-versions-unique.sh', import.meta.url), 'utf8');
const realMktemp = execFileSync('which', ['mktemp'], { encoding: 'utf8' }).trim();
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFile(path) {
  for (let i = 0; i < 500; i++) {
    try { await readFile(path); return; } catch { await pause(10); }
  }
  throw new Error(`Fixture rendezvous timed out: ${path}`);
}
async function put(path, value, executable = false) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, executable ? { mode: 0o755 } : {});
}
const helper = `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2), id = process.env.FIXTURE_ID, mode = process.env.FIXTURE_MODE;
const mark = name => fs.writeFileSync(path.join(process.env.FIXTURE_ROOT, name), 'ready');
const print = value => fs.writeSync(1, value + '\\n');
const wait = async name => {
  for (let i = 0; i < 500; i++) {
    if (fs.existsSync(path.join(process.env.FIXTURE_ROOT, name))) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Fixture rendezvous timed out: ' + name);
};
(async () => {
  fs.appendFileSync(path.join(process.env.FIXTURE_ROOT, 'commands-' + id), JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
  if (args[0] === 'secrets') {
    if (mode === 'secrets') {
      print(id + ' UNIQUE SECRET DETECTOR ' + (id === 'A' ? 'FAILURE' : 'PASS'));
      if (id === 'A') { mark('a-secrets-written'); await wait('b-secrets-written'); process.exitCode = 1; }
      else mark('b-secrets-written');
    } else if (process.env.FIXTURE_SECRET === '1') { print(id + ' fixture detector failure'); process.exitCode = 1; }
    return;
  }
  if (args[0] === 'npm') {
    fs.appendFileSync(path.join(process.env.FIXTURE_ROOT, 'npm-' + id), process.cwd() + ':' + args.slice(1).join(' ') + '\\n');
    if (mode === 'hold') { print(id + ' TYPE HELD'); mark('held-types-' + id); await wait('release-types-' + id); return; }
    if (args[2] === 'build') {
      if (mode === 'build') {
        print(id + ' UNIQUE BUILD ' + (id === 'A' ? 'FAILURE' : 'PASS'));
        if (id === 'A') { mark('a-build-written'); await wait('b-build-written'); process.exitCode = 1; }
        else mark('b-build-written');
      } else { print(id + ' BUILD RESULT'); process.exitCode = Number(process.env.FIXTURE_BUILD_FAIL || 0); }
      return;
    }
    if (mode === 'typecheck' && id === 'A') {
      print('A UNIQUE TYPE FAILURE'); mark('a-types-written'); await wait('b-types-written'); process.exitCode = 1;
    } else {
      print(id + ' TYPE PASS'); process.exitCode = Number(process.env.FIXTURE_TYPES_FAIL || 0);
      if (mode === 'typecheck' && id === 'B') mark('b-types-written');
    }
    return;
  }
  if (args[0] === '--test') {
    if (mode === 'contract' && args[1].endsWith('/no-swallowed-write-errors.test.mjs')) {
      print(id + ' UNIQUE CONTRACT ' + (id === 'A' ? 'FAILURE' : 'PASS'));
      if (id === 'A') { mark('a-contract-written'); await wait('b-contract-written'); process.exitCode = 1; }
      else mark('b-contract-written');
      return;
    }
    print(id + ' offline detector contract ' + args.slice(1).map(value => path.basename(value)).join(','));
    if (args.some(value => path.basename(value) === process.env.FIXTURE_FAIL_TEST)) process.exitCode = 1;
    return;
  }
  const name = path.basename(args[0]);
  if (name === 'no-dead-asset-references.mjs') {
    print(process.env.FIXTURE_GHOST_BADJSON === '1' ? '{broken' : JSON.stringify({ errors: Number(process.env.FIXTURE_GHOST ?? (mode === 'ghost' && id === 'A' ? 1 : 0)) }));
    if (mode === 'ghost') {
      if (id === 'A') { mark('a-ghost-written'); await wait('b-ghost-written'); }
      else mark('b-ghost-written');
    }
  } else if (name === 'design-violations.mjs') {
    print(process.env.FIXTURE_DESIGN_BADJSON === '1' ? '{broken' : mode === 'design'
      ? JSON.stringify({ 'no-inline-style': id === 'A' ? 3 : 0 })
      : process.env.FIXTURE_DESIGN_JSON || JSON.stringify({ 'no-inline-style': Number(process.env.FIXTURE_DESIGN || 0) }));
    if (mode === 'design') {
      if (id === 'A') { mark('a-design-written'); await wait('b-design-written'); }
      else mark('b-design-written');
    }
  }
  else if (name === 'no-raw-testimony-insert.mjs' && process.env.FIXTURE_TESTIMONY === '1') print('VIOLATION fixture');
  else if (name === 'no-swallowed-write-errors.mjs' && process.env.FIXTURE_SWALLOWED === '1') print('fixture.ts: dropped: offline fixture');
  else if (name === 'no-schema-baked-labels.mjs') print((process.env.FIXTURE_LABELS || 0) + ' baked-label');
})().catch(error => { console.error(error); process.exitCode = 1; });
`;

async function fixture(run) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'nuke-gate-fixture-')));
  const owned = [];
  try {
    const bin = join(root, 'bin'), shared = join(root, 'legacy-shared');
    await mkdir(shared); await mkdir(join(root, 'temps'));
    await put(join(root, 'commands.cjs'), helper);
    await put(join(bin, 'node'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(root, 'commands.cjs'))} "$@"\n`, true);
    await put(join(bin, 'npm'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(root, 'commands.cjs'))} npm "$@"\n`, true);
    await put(join(bin, 'mktemp'), `#!/bin/sh\nif [ "\${FIXTURE_MKTEMP_FAIL:-0}" = 1 ]; then echo 'fixture allocation failed' >&2; exit 73; fi\np=$(${quote(realMktemp)} "$@") || exit "$?"\nprintf '%s\\n' "$p" >> "$FIXTURE_ROOT/allocated-$FIXTURE_ID"\nprintf '%s\\n' "$p"\n`, true);
    const baseline = { guardrails: {
      'no-dead-asset-references': { errors: 0 }, 'no-raw-fetch': { violations: 0 },
      'no-raw-testimony-insert': { violations: 0 }, 'no-swallowed-write-errors': { violations: 0 },
      'no-committed-secrets': { violations: 0 }, 'no-schema-baked-labels': { violations: 0 },
      'design-system': {},
    } };
    for (const id of ['A', 'B']) {
      const checkout = join(root, `checkout-${id}`);
      // A literal namespace translation, not a replacement gate algorithm.
      // All predicates, ordering, redirects and exit paths remain the source's.
      await put(join(checkout, 'scripts/ci/verify.sh'), source.replaceAll('/tmp/ci_', `${shared}/ci_`));
      await put(join(checkout, 'scripts/ci/baseline.json'), JSON.stringify(baseline));
      await put(join(checkout, 'scripts/ci/migration-versions-unique.sh'), migrationVersions);
      await mkdir(join(checkout, 'nuke_frontend'));
      await put(join(checkout, 'scripts/guardrails/no-raw-fetch.sh'), '#!/bin/sh\nif [ "${FIXTURE_RAWFETCH:-0}" = 1 ]; then echo "fixture.ts:1: offline external fetch"; fi\n');
      await put(join(checkout, 'scripts/guardrails/no-committed-secrets.sh'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(root, 'commands.cjs'))} secrets\n`);
    }
    await run({ root, start(id, mode, extra = {}) {
      const checkout = join(root, `checkout-${id}`);
      const child = spawn('bash', [join(checkout, 'scripts/ci/verify.sh')], {
        cwd: root, detached: true,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: join(root, 'temps'),
          CI_ENFORCE: '1', CI_BUILD: '0', CI_WRITE_BASELINE: '0', FIXTURE_ROOT: root,
          FIXTURE_ID: id, FIXTURE_MODE: mode, ...extra },
      });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      const done = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { process.kill(-child.pid, 'SIGKILL'); reject(new Error('Offline gate timed out')); }, 15000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
      });
      done.catch(() => {});
      owned.push({ child, done });
      return { child, done, checkout };
    } });
  } finally {
    for (const { child } of owned) if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
    }
    await Promise.allSettled(owned.map(({ done }) => done));
    await rm(root, { recursive: true, force: true });
  }
}

async function allocated(root, id) {
  return (await readFile(join(root, `allocated-${id}`), 'utf8')).trim().split('\n').map(path => resolve(root, path));
}
async function cleaned(root, id, expected = 1) {
  const paths = await allocated(root, id);
  assert.equal(paths.length, expected);
  for (const path of paths) await assert.rejects(stat(path), { code: 'ENOENT' });
}
async function distinct(root) {
  const [a] = await allocated(root, 'A'), [b] = await allocated(root, 'B');
  assert.notEqual(a, b);
  assert.equal(dirname(a), join(root, 'temps'));
  assert.equal(dirname(b), join(root, 'temps'));
  await cleaned(root, 'A'); await cleaned(root, 'B');
}

test('concurrent checkout gates keep a ghost regression from becoming another run\'s zero', async () => {
  await fixture(async ({ root, start }) => {
    const a = start('A', 'ghost');
    await waitFile(join(root, 'a-ghost-written'));
    const b = start('B', 'ghost');
    const [failed, clean] = await Promise.all([a.done, b.done]);
    assert.equal(clean.code, 0, clean.stdout + clean.stderr);
    assert.equal(failed.code, 1, `A must fail its own ghost count; observed:\n${failed.stdout}${failed.stderr}`);
    assert.match(failed.stdout, /ghost-refs REGRESSED: 1 > baseline 0/);
    await distinct(root);
  });
});

test('a concurrent successful typecheck cannot replace a failing checkout\'s diagnostic', async () => {
  await fixture(async ({ root, start }) => {
    const a = start('A', 'typecheck');
    await waitFile(join(root, 'a-types-written'));
    const b = start('B', 'typecheck');
    const [failed, clean] = await Promise.all([a.done, b.done]);
    assert.equal(failed.code, 1, failed.stdout + failed.stderr);
    assert.equal(clean.code, 0, clean.stdout + clean.stderr);
    assert.match(failed.stdout, /A UNIQUE TYPE FAILURE/, `A must retain its own diagnostic:\n${failed.stdout}`);
    assert.doesNotMatch(failed.stdout, /B TYPE PASS/);
    await distinct(root);
  });
});

test('interleaved design JSON preserves each checkout\'s own count and floor', async () => {
  await fixture(async ({ root, start }) => {
    const a = start('A', 'design');
    await waitFile(join(root, 'a-design-written'));
    const b = start('B', 'design');
    const [failed, clean] = await Promise.all([a.done, b.done]);
    assert.equal(failed.code, 1, failed.stdout + failed.stderr);
    assert.equal(clean.code, 0, clean.stdout + clean.stderr);
    assert.match(failed.stdout, /design\/no-inline-style REGRESSED: 3 > baseline 0/);
    assert.match(clean.stdout, /design\/no-inline-style 0 \(baseline 0\)/);
    await distinct(root);
  });
});

for (const phase of ['build', 'contract', 'secrets']) {
  test(`interleaved ${phase} failures keep their own diagnostic`, async () => {
    await fixture(async ({ root, start }) => {
      const extra = phase === 'build' ? { CI_BUILD: '1' } : {};
      const a = start('A', phase, extra);
      await waitFile(join(root, `a-${phase}-written`));
      const b = start('B', phase, extra);
      const [failed, clean] = await Promise.all([a.done, b.done]);
      assert.equal(failed.code, 1, failed.stdout + failed.stderr);
      assert.equal(clean.code, 0, clean.stdout + clean.stderr);
      const marker = phase === 'secrets' ? 'SECRET DETECTOR' : phase.toUpperCase();
      assert.ok(failed.stdout.includes(`A UNIQUE ${marker} FAILURE`), failed.stdout);
      assert.ok(!failed.stdout.includes(`B UNIQUE ${marker} PASS`), failed.stdout);
      await distinct(root);
    });
  });
}

test('clear enforce/warn runs preserve checkout selection and all checker arguments without a default build', async () => {
  await fixture(async ({ root, start }) => {
    for (const enforce of ['1', '0']) {
      const run = start('A', 'clean', { CI_ENFORCE: enforce });
      const out = await run.done;
      assert.equal(out.code, 0, out.stdout + out.stderr);
      assert.match(out.stdout, /CI GATE PASS/);
      assert.match(out.stdout, new RegExp(enforce === '1' ? 'ENFORCE mode' : 'warn mode'));
    }
    const checkout = join(root, 'checkout-A');
    const npm = (await readFile(join(root, 'npm-A'), 'utf8')).trim().split('\n');
    assert.deepEqual(npm, Array(2).fill(`${checkout}/nuke_frontend:run type-check`));
    const calls = (await readFile(join(root, 'commands-A'), 'utf8')).trim().split('\n').map(JSON.parse);
    const expected = [
      ['--test', `${checkout}/scripts/guardrails/no-swallowed-write-errors.test.mjs`],
      ['--test', `${checkout}/scripts/check-image-observation-health.test.mjs`],
      ['--test', `${checkout}/scripts/guardrails/no-raw-fetch.test.mjs`],
      ['--test', `${checkout}/scripts/data/declared-source-reader.test.mjs`],
      ['--test', `${checkout}/scripts/ci/invalid-indexes.test.mjs`],
      ['--test', `${checkout}/scripts/ci/owner-writable-views.test.mjs`],
      ['--test', `${checkout}/scripts/discovery/buying-evidence.test.mjs`, `${checkout}/scripts/discovery/buying-evidence-matching.test.mjs`, `${checkout}/scripts/discovery/buying-evidence-plan.test.mjs`],
      [`${checkout}/scripts/guardrails/no-dead-asset-references.mjs`, '--json'],
      [`${checkout}/scripts/guardrails/no-raw-testimony-insert.mjs`],
      [`${checkout}/scripts/guardrails/no-swallowed-write-errors.mjs`, '--all'],
      [`${checkout}/scripts/guardrails/design-violations.mjs`, '--json'],
      ['secrets'], [`${checkout}/scripts/guardrails/no-schema-baked-labels.mjs`, '--all'],
    ];
    assert.deepEqual(calls.filter(call => call.args[0] !== 'npm').map(call => call.args), [...expected, ...expected]);
    await cleaned(root, 'A', 2);
  });
});

test('counts retain strict greater-than floors, separate design rules and advisory labels', async () => {
  await fixture(async ({ root, start }) => {
    const path = join(root, 'checkout-A/scripts/ci/baseline.json');
    const baseline = JSON.parse(await readFile(path, 'utf8'));
    baseline.guardrails['no-dead-asset-references'].errors = 2;
    const rules = ['no-inline-style', 'no-font-props', 'no-hardcoded-colors', 'no-border-radius', 'no-box-shadow', 'no-gradient', 'no-banned-fonts'];
    baseline.guardrails['design-system'] = Object.fromEntries(rules.map((rule, i) => [rule, i]));
    await writeFile(path, JSON.stringify(baseline));
    for (const [ghost, code] of [[1, 0], [2, 0], [3, 1]]) {
      const out = await start('A', 'clean', { FIXTURE_GHOST: String(ghost), FIXTURE_LABELS: '900',
        FIXTURE_DESIGN_JSON: JSON.stringify(baseline.guardrails['design-system']) }).done;
      assert.equal(out.code, code, out.stdout + out.stderr);
      assert.match(out.stdout, /schema-baked-labels 900 \(advisory, non-blocking\)/);
      for (const [i, rule] of rules.entries()) assert.ok(out.stdout.includes(`design/${rule} ${i} (baseline ${i})`), out.stdout);
    }
    const counts = Object.fromEntries(rules.map((rule, i) => [rule, i + 1]));
    const out = await start('A', 'clean', { FIXTURE_DESIGN_JSON: JSON.stringify(counts) }).done;
    assert.equal(out.code, 1, out.stdout + out.stderr);
    for (const [i, rule] of rules.entries()) assert.ok(out.stdout.includes(`design/${rule} REGRESSED: ${i + 1} > baseline ${i}`), out.stdout);
    await cleaned(root, 'A', 4);
  });
});

for (const [setting, pattern, extra] of [
  ['FIXTURE_TYPES_FAIL', /typecheck FAILED/, {}],
  ['FIXTURE_BUILD_FAIL', /build FAILED/, { CI_BUILD: '1' }],
  ['FIXTURE_FAIL_TEST', /raw-fetch regression tests FAILED/, {}],
  ['FIXTURE_SECRET', /SECRET DETECTED/, {}],
  ['FIXTURE_RAWFETCH', /raw-fetch REGRESSED: 1 > baseline 0/, {}],
  ['FIXTURE_TESTIMONY', /testimony-insert REGRESSED: 1 > baseline 0/, {}],
  ['FIXTURE_SWALLOWED', /swallowed-write-errors REGRESSED: 1 > baseline 0/, {}],
]) {
  test(`${setting} preserves enforce failure and warn diagnostics/status with cleanup`, async () => {
    await fixture(async ({ root, start }) => {
      for (const enforce of ['1', '0']) {
        const out = await start('A', 'clean', { ...extra, CI_ENFORCE: enforce,
          [setting]: setting === 'FIXTURE_FAIL_TEST' ? 'no-raw-fetch.test.mjs' : '1' }).done;
        assert.equal(out.code, enforce === '1' ? 1 : 0, out.stdout + out.stderr);
        assert.match(out.stdout, pattern);
        assert.match(out.stdout, enforce === '1' ? /CI GATE FAILED/ : /warn mode — NOT blocking/);
      }
      await cleaned(root, 'A', 2);
    });
  });
}

test('existing malformed count-parser fallbacks remain zero', async () => {
  await fixture(async ({ root, start }) => {
    const out = await start('A', 'clean', { FIXTURE_GHOST_BADJSON: '1', FIXTURE_DESIGN_BADJSON: '1' }).done;
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /ghost-refs 0 \(baseline 0\)/);
    assert.match(out.stdout, /design\/no-inline-style 0 \(baseline 0\)/);
    await cleaned(root, 'A');
  });
});

test('baseline capture keeps its counts/keys/early exit and cleans owned scratch', async () => {
  await fixture(async ({ root, start }) => {
    const out = await start('A', 'clean', { CI_WRITE_BASELINE: '1', FIXTURE_GHOST: '4', FIXTURE_DESIGN: '7',
      FIXTURE_RAWFETCH: '1', FIXTURE_TESTIMONY: '1', FIXTURE_SWALLOWED: '1', FIXTURE_LABELS: '12' }).done;
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /Wrote baseline: ghost=4 raw-fetch=1 testimony=1 labels=12/);
    const baseline = JSON.parse(await readFile(join(root, 'checkout-A/scripts/ci/baseline.json'), 'utf8'));
    assert.match(baseline.generated, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(baseline.guardrails['no-dead-asset-references'].errors, 4);
    assert.equal(baseline.guardrails['no-raw-fetch'].violations, 1);
    assert.equal(baseline.guardrails['no-raw-testimony-insert'].violations, 1);
    assert.equal(baseline.guardrails['no-swallowed-write-errors'].violations, 1);
    assert.equal(baseline.guardrails['no-schema-baked-labels'].violations, 12);
    assert.equal(baseline.guardrails['no-committed-secrets'].violations, 0);
    assert.equal(baseline.guardrails['design-system']['no-inline-style'], 7);
    assert.equal(Object.keys(baseline.guardrails['design-system']).length, 8); // seven rules and existing note
    await assert.rejects(readFile(join(root, 'npm-A')), { code: 'ENOENT' });
    assert.doesNotMatch(await readFile(join(root, 'commands-A'), 'utf8'), /--test/);
    await cleaned(root, 'A');
  });
});

test('temporary parents with spaces/apostrophes preserve nonzero Python-parsed evidence', async () => {
  await fixture(async ({ root, start }) => {
    const parent = join(root, "temp parent's space"); await mkdir(parent);
    const out = await start('A', 'clean', { TMPDIR: parent, FIXTURE_GHOST: '5', FIXTURE_DESIGN: '6' }).done;
    assert.equal(out.code, 1, out.stdout + out.stderr);
    assert.match(out.stdout, /ghost-refs REGRESSED: 5 > baseline 0/);
    assert.match(out.stdout, /design\/no-inline-style REGRESSED: 6 > baseline 0/);
    assert.deepEqual(await readdir(parent), []);
    await cleaned(root, 'A');
  });
});

test('a relative temporary parent remains valid inside the frontend subshell', async () => {
  await fixture(async ({ root, start }) => {
    await mkdir(join(root, 'relative-temps'));
    const out = await start('A', 'clean', { TMPDIR: 'relative-temps', CI_BUILD: '1' }).done;
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /typecheck clean/);
    assert.match(out.stdout, /build clean/);
    await cleaned(root, 'A');
    assert.deepEqual(await readdir(join(root, 'relative-temps')), []);
  });
});

test('failed allocation is explicit/nonzero even in warn mode and never starts grading', async () => {
  await fixture(async ({ root, start }) => {
    const out = await start('A', 'clean', { FIXTURE_MKTEMP_FAIL: '1', CI_ENFORCE: '0' }).done;
    assert.equal(out.code, 1);
    assert.match(out.stderr, /CI gate: cannot create private scratch directory/);
    assert.doesNotMatch(out.stdout, /CI GATE PASS|frontend typecheck/);
    await assert.rejects(readFile(join(root, 'npm-A')), { code: 'ENOENT' });
    assert.deepEqual(await readdir(join(root, 'temps')), []);
  });
});

test('private mode and pass cleanup preserve a sibling sentinel and another active run', async () => {
  await fixture(async ({ root, start }) => {
    const a = start('A', 'hold'); await waitFile(join(root, 'held-types-A'));
    const [path] = await allocated(root, 'A');
    assert.equal((await stat(path)).mode & 0o777, 0o700);
    const sentinel = join(root, 'temps/unrelated'); await writeFile(sentinel, 'keep');
    const clean = await start('B', 'clean').done;
    assert.equal(clean.code, 0, clean.stdout + clean.stderr);
    assert.equal((await stat(path)).mode & 0o777, 0o700);
    assert.equal(await readFile(sentinel, 'utf8'), 'keep');
    await writeFile(join(root, 'release-types-A'), 'ready');
    assert.equal((await a.done).code, 0);
    await cleaned(root, 'A'); await cleaned(root, 'B');
    assert.equal(await readFile(sentinel, 'utf8'), 'keep');
  });
});

for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]]) {
  test(`${signal} cleanup stays nonzero and preserves another active invocation`, async () => {
    await fixture(async ({ root, start }) => {
      const a = start('A', 'hold'); await waitFile(join(root, 'held-types-A'));
      const b = start('B', 'hold'); await waitFile(join(root, 'held-types-B'));
      const [other] = await allocated(root, 'B');
      const sentinel = join(root, 'temps/unrelated'); await writeFile(sentinel, 'keep');
      process.kill(-a.child.pid, signal);
      const interrupted = await a.done;
      assert.equal(interrupted.code, code, interrupted.stdout + interrupted.stderr);
      assert.doesNotMatch(interrupted.stdout, /CI GATE PASS/);
      await cleaned(root, 'A');
      assert.equal((await stat(other)).mode & 0o777, 0o700);
      assert.equal(await readFile(sentinel, 'utf8'), 'keep');
      await writeFile(join(root, 'release-types-B'), 'ready');
      assert.equal((await b.done).code, 0);
      await cleaned(root, 'B');
      assert.equal(await readFile(sentinel, 'utf8'), 'keep');
    });
  });
}
