// node --test scripts/photo-pipeline/subscription-reader-batch.test.mjs
// The launchd wrapper's cadence, with stand-ins for everything it starts (dotenvx, node, git, pgrep): which fire is
// full and which is fast, what a fast fire runs, that a minute with nothing to read starts no reader and leaves no
// line and no file behind, and that any fast fire that does not end clean puts the readers back on the full fires.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
const WRAPPER = join(here, 'subscription-reader-batch.sh');

// dotenvx run -q -f <file> -- <command...>: run the command
const FAKE_DOTENVX = `#!/bin/bash
while [ $# -gt 0 ] && [ "$1" != "--" ]; do shift; done
shift
exec "$@"
`;
// node <script> <args...>: note the call (script, args, the first PATH entry), then answer as that script would. The frame
// reader's summary has the real one's leading keys (subscription-frame-classifier.test.mjs holds the real line to them).
//   FAKE_START    what the probe answers: one number, or a comma list answered one per probe (the last one repeats)
//   FAKE_FRAMES   photos the reader claims: a number, or "limit" for as many as --limit asked for (default 0)
//   FAKE_STOPPED  why the first reads stopped (default: they did not)
//   FAKE_RELANDED pages the document reader landed again without reading a new one (default 0)
const FAKE_NODE = `#!/bin/bash
script="$(basename "$1")"; shift
printf '%s|%s|%s\\n' "$script" "$*" "\${PATH%%:*}" >> "$HOME/node-calls.log"
arg() { local want="$1"; shift; while [ $# -gt 0 ]; do if [ "$1" = "$want" ]; then echo "$2"; return; fi; shift; done; }
case "$script" in
  subscription-frame-classifier.mjs)
    if printf '%s' " $* " | grep -q -- ' --probe '; then
      if [ -n "\${FAKE_PROBE_FAIL:-}" ]; then echo ""; echo "TypeError: fetch failed" >&2; echo "    at node:internal/deps/undici/undici:13510:13" >&2; exit 1; fi
      n=$(( $(cat "$HOME/probe-count" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$HOME/probe-count"
      start="$(printf '%s' "\${FAKE_START:-0}" | cut -d, -f"$n")"; [ -n "$start" ] || start="$(printf '%s' "\${FAKE_START:-0}" | awk -F, '{print $NF}')"
      echo "{\\"probe\\":true,\\"queued\\":$start,\\"read_last_hour\\":0,\\"per_hour\\":360,\\"start\\":$start}"; exit 0
    fi
    [ -n "\${FAKE_READER_EXIT:-}" ] && { echo "could not get the checklist: 503" >&2; exit "$FAKE_READER_EXIT"; }
    out="$(arg --out "$@")"; [ -n "$out" ] && echo '{}' > "$out"
    frames="\${FAKE_FRAMES:-0}"; [ "$frames" = limit ] && frames="$(arg --limit "$@")"
    stopped=null; [ -n "\${FAKE_STOPPED:-}" ] && stopped="\\"$FAKE_STOPPED\\""
    echo "{\\"cli\\":\\"lean\\",\\"frames\\":$frames,\\"source\\":\\"stage-queue\\",\\"read\\":$frames,\\"accepted\\":$frames,\\"classifier_rejected\\":0,\\"errors\\":0,\\"error_classes\\":{},\\"receipts\\":$frames,\\"receipt_errors\\":0,\\"stopped\\":$stopped,\\"by_type\\":{},\\"read_seconds\\":1,\\"stages\\":{\\"deep_reading\\":{\\"claimed\\":\${FAKE_DEEP:-0},\\"stopped\\":null}}}" ;;
  subscription-document-reader.mjs)
    out="$(arg --out "$@")"; [ -n "$out" ] && echo '{}' > "$out"
    echo "{\\"frames\\":0,\\"read\\":0,\\"page\\":0,\\"landed\\":0,\\"waiting_no_vehicle\\":0,\\"vehicle_document\\":0,\\"errors\\":0,\\"error_classes\\":{},\\"receipts\\":0,\\"receipt_errors\\":0,\\"stopped\\":null,\\"by_type\\":{},\\"read_seconds\\":0,\\"to_land\\":\${FAKE_RELANDED:-0},\\"relanded\\":\${FAKE_RELANDED:-0},\\"reland_vehicle_document\\":0,\\"reland_errors\\":0}" ;;
  fact-doubt-cycle.mjs) echo '{"cli":"fact-doubt-cycle","raised":0,"answered":0,"errors":0}' ;;
  reader-heartbeat.mjs) echo "heartbeat $READER_NAME HTTP 200" ;;
esac
`;
const FAKE_GIT = `#!/bin/bash
printf '%s\\n' "$*" >> "$HOME/git-calls.log"
`;
// pgrep -lf lists FAKE_PGREP_LIST (pid command lines) when a reader is said to be running
const FAKE_PGREP = `#!/bin/bash
[ -n "\${FAKE_READER_RUNNING:-}" ] || exit 1
[ "$1" = "-lf" ] && [ -n "\${FAKE_PGREP_LIST:-}" ] && printf '%s\\n' "$FAKE_PGREP_LIST"
exit 0
`;
const FAKE_KILL = `#!/bin/bash
printf '%s\\n' "$*" >> "$HOME/kill-calls.log"
`;
const FULL = ['subscription-document-reader.mjs', 'reader-heartbeat.mjs', 'subscription-frame-classifier.mjs', 'reader-heartbeat.mjs',
  'fact-doubt-cycle.mjs', 'reader-heartbeat.mjs', 'reconcile-receipt-work.mjs', 'reader-heartbeat.mjs'];

async function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'reader-batch-'));
  const bin = join(home, 'bin');
  mkdirSync(bin); mkdirSync(join(home, 'nuke')); mkdirSync(join(home, '.worktrees', 'nuke-main'), { recursive: true });
  writeFileSync(join(home, '.worktrees', 'nuke-main', '.git'), 'gitdir: elsewhere\n');
  for (const [name, body] of [['dotenvx', FAKE_DOTENVX], ['node', FAKE_NODE], ['git', FAKE_GIT], ['pgrep', FAKE_PGREP]]) {
    writeFileSync(join(bin, name), body); chmodSync(join(bin, name), 0o755);
  }
  const logs = join(home, 'nuke', 'logs');
  const lines = (name) => (existsSync(join(home, name)) ? readFileSync(join(home, name), 'utf8').trim().split('\n').filter(Boolean) : []);
  // one fire of the wrapper; a full fire is due only when the test says so (the first fire always is)
  const fire = async (env = {}) => {
    for (const f of ['node-calls.log', 'git-calls.log', 'probe-count']) rmSync(join(home, f), { force: true });
    const r = await run('/bin/bash', [WRAPPER, '20', '20'], { env: { HOME: home, PATH: '/usr/bin:/bin', NUKE_READER_BIN: bin, ...env } })
      .then((x) => ({ code: 0, ...x }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
    const all = lines('node-calls.log').map((l) => { const [script, args, pathFirst] = l.split('|'); return { script, args, pathFirst, probe: args.includes('--probe'), start: args === '--start' }; });
    // the reader starts (reader-heartbeat.mjs --start) are kept apart, so the call sequences below read as before
    const calls = all.filter((c) => !c.start);
    const starts = all.filter((c) => c.start).length;
    return { ...r, calls, starts, order: all.map((c) => (c.start ? 'start' : c.probe ? 'probe' : c.script)), scripts: calls.map((c) => (c.probe ? 'probe' : c.script)), git: lines('git-calls.log'),
      receipts: readdirSync(logs).filter((f) => f.endsWith('.json')), stamp: existsSync(join(logs, '.subscription-reader-last-full')), hold: existsSync(join(logs, '.subscription-reader-fast-hold')) };
  };
  const fullFire = (env = {}) => fire({ NUKE_READER_FULL_EVERY: '0', ...env });
  try { await fn({ fire, fullFire, home, bin }); } finally { rmSync(home, { recursive: true, force: true }); }
}

test('the first fire is a full one: checkout refreshed, documents then frames with every stage, a heartbeat each', async () => {
  await withHome(async ({ fire, home }) => {
    const r = await fire();
    assert.equal(r.code, 0);
    assert.equal(r.git.some((g) => g.includes('fetch -q origin main')), true, 'a full fire refreshes the checkout');
    assert.deepEqual(r.scripts, FULL);
    assert.deepEqual(r.order.slice(0, 3), ['start', 'subscription-document-reader.mjs', 'reader-heartbeat.mjs'], 'each reader is started on record first');
    assert.equal(r.starts, 4);
    assert.match(r.calls[0].args, /--deadline-at \d+/, 'the document reader carries its deadline');
    assert.doesNotMatch(r.calls[2].args, /--deadline-at/, 'the frame reader does not end itself, so it carries none');
    assert.match(r.calls[2].args, /--limit 20 --concurrency 2 --status failed,pending --deep-limit 20 --keyed-limit 60 /);
    assert.deepEqual([r.calls[0].pathFirst, r.calls[2].pathFirst], [join(home, '.local', 'bin'), join(home, '.local', 'bin')], 'both readers search ~/.local/bin first for the CLI');
    assert.deepEqual([r.stamp, r.hold], [true, false], 'the full fire is stamped; its clean ending leaves the fast fires on');
    assert.match(r.stdout, /subscription-document-reader exit=0 \{"frames":0/);
    assert.deepEqual(r.receipts, [], 'a fire that read nothing leaves no receipt file');
  });
});

test('between full fires a fire is fast: it asks what may start and, with nothing to read, starts nothing and says nothing', async () => {
  await withHome(async ({ fire }) => {
    await fire();
    const r = await fire();
    assert.equal(r.code, 0);
    assert.deepEqual(r.scripts, ['probe'], 'one probe and nothing else');
    assert.deepEqual([r.git.length, r.stdout, r.receipts.length, r.hold], [0, '', 0, false], 'no fetch, no log line, no file, no hold');
  });
});

test('a fast fire reads the first reads that are due, and again while more are due', async () => {
  await withHome(async ({ fire }) => {
    await fire();
    const r = await fire({ FAKE_START: '3,2,0', FAKE_FRAMES: 'limit' });
    assert.deepEqual(r.scripts, ['probe', 'subscription-frame-classifier.mjs', 'reader-heartbeat.mjs', 'probe', 'subscription-frame-classifier.mjs', 'reader-heartbeat.mjs', 'probe'],
      'probe, read, heartbeat, until the probe says nothing is due; no document reader');
    assert.match(r.calls[1].args, /--limit 3 --concurrency 2 --status failed,pending --deep-limit 0 --keyed-limit 0 /, 'first reads only, as many as are due');
    assert.match(r.calls[4].args, /--limit 2 /);
    assert.equal(r.git.length, 0, 'a fast fire runs the scripts that are there');
    assert.equal(r.stdout.trim().split('\n').length, 2, 'one log line per batch read');
    assert.match(r.stdout, /subscription-frame-classifier exit=0 \{"cli":"lean","frames":3,/);
    assert.deepEqual([r.receipts.length, r.hold], [2, false], 'each batch that read photos keeps its receipt file');
  });
});

test('a fast fire never starts more than the per-fire limit in a batch, nor more batches than its rounds', async () => {
  await withHome(async ({ fire }) => {
    await fire();
    const r = await fire({ FAKE_START: '25', FAKE_FRAMES: 'limit', NUKE_READER_FAST_ROUNDS: '2' });
    assert.deepEqual(r.scripts, ['probe', 'subscription-frame-classifier.mjs', 'reader-heartbeat.mjs', 'probe', 'subscription-frame-classifier.mjs', 'reader-heartbeat.mjs']);
    assert.match(r.calls[1].args, /--limit 20 /);
    assert.equal(r.hold, false, 'running out of rounds is not a fault; the next fire carries on');
  });
});

test('a fast fire that claims nothing, stops, or fails holds the fast fires until a full fire ends clean', async () => {
  for (const [why, env] of [['claimed none of what was due', { FAKE_FRAMES: '0' }], ['subscription spent', { FAKE_FRAMES: 'limit', FAKE_STOPPED: 'reader_usage_limit' }], ['reader failed', { FAKE_READER_EXIT: '1' }]]) {
    await withHome(async ({ fire, fullFire }) => {
      await fire();
      const r = await fire({ FAKE_START: '5,5,5', ...env });
      assert.deepEqual(r.scripts.filter((s) => s === 'probe').length, 1, `${why}: no second batch`);
      assert.equal(r.hold, true, why);
      assert.match(r.stdout, /fast fire did not end clean or claimed none of the 5 due; fast fires wait for a clean full fire/);
      const held = await fire({ FAKE_START: '5' });
      assert.deepEqual([held.calls.length, held.stdout], [0, ''], `${why}: held fast fires start nothing, not even the probe`);
      const stillBad = await fullFire(env.FAKE_FRAMES === '0' ? { FAKE_STOPPED: 'reader_usage_limit' } : env);
      assert.deepEqual([stillBad.scripts.includes('subscription-document-reader.mjs'), stillBad.hold], [true, true], `${why}: a full fire that does not end clean keeps the hold`);
      const clean = await fullFire();
      assert.deepEqual([clean.scripts, clean.hold], [FULL, false], 'a clean full fire lets the fast fires run again');
      const again = await fire({ FAKE_START: '2,0', FAKE_FRAMES: 'limit' });
      assert.deepEqual(again.scripts, ['probe', 'subscription-frame-classifier.mjs', 'reader-heartbeat.mjs', 'probe']);
    });
  }
});

test('a probe that cannot see the ledger says so once, starts nothing and holds the fast fires', async () => {
  await withHome(async ({ fire, fullFire }) => {
    await fire();
    const r = await fire({ FAKE_PROBE_FAIL: '1' });
    assert.deepEqual([r.code, r.scripts, r.hold], [0, ['probe'], true]);
    assert.match(r.stdout, /^\d{8}T\d{6}Z probe failed: TypeError: fetch failed; fast fires wait for a clean full fire\n$/, 'one line, the first line of what the probe said');
    const next = await fire({ FAKE_PROBE_FAIL: '1' });
    assert.deepEqual([next.calls.length, next.stdout], [0, ''], 'no line a minute while the ledger is out of reach');
    const full = await fullFire();
    assert.deepEqual([full.scripts, full.hold], [FULL, false]);
  });
});

test('a full fire whose first reads stopped puts the fast fires on hold', async () => {
  await withHome(async ({ fire }) => {
    const r = await fire({ FAKE_FRAMES: '20', FAKE_STOPPED: 'reader_usage_limit' });
    assert.deepEqual([r.scripts, r.hold], [FULL, true]);
    assert.match(r.stdout, /the frame reader did not end clean; fast fires wait for a clean full fire/, 'the hold is never silent');
    const fast = await fire({ FAKE_START: '5' });
    assert.equal(fast.calls.length, 0, 'with the subscription spent the readers run as often as before fast fires: once a full fire');
  });
});

test('while a reader is running a fast fire is silent, and a full fire that is due stays due', async () => {
  await withHome(async ({ fire }) => {
    const due = await fire({ FAKE_READER_RUNNING: '1' });
    assert.deepEqual([due.code, due.calls.length, due.stamp], [0, 0, false], 'nothing starts and the full fire is not stamped');
    assert.match(due.stdout, /a reader is already running; skipping this fire/);
    await fire();
    const fast = await fire({ FAKE_READER_RUNNING: '1', FAKE_START: '5' });
    assert.deepEqual([fast.code, fast.calls.length, fast.stdout], [0, 0, '']);
  });
});

test('a reader alive a minute past its own --deadline-at is ended; one started without a deadline is left alone', async () => {
  await withHome(async ({ fire, home, bin }) => {
    writeFileSync(join(bin, 'kill'), FAKE_KILL); chmodSync(join(bin, 'kill'), 0o755);
    const env = { FAKE_READER_RUNNING: '1', NUKE_READER_KILL: join(bin, 'kill') };
    const kills = () => (existsSync(join(home, 'kill-calls.log')) ? readFileSync(join(home, 'kill-calls.log'), 'utf8').trim().split('\n') : []);
    const old = await fire({ ...env, FAKE_PGREP_LIST: '41 node /x/subscription-document-reader.mjs --limit 20 --owner o --out f' });
    assert.deepEqual([old.code, kills()], [0, []], 'no deadline on the command line: not ended');
    assert.match(old.stdout, /a reader is already running; skipping this fire/);
    const late = await fire({ ...env, FAKE_PGREP_LIST: '42 node /x/subscription-document-reader.mjs --out f --deadline-at 1000' });
    assert.deepEqual(kills(), ['-TERM 42', '-KILL 42']);
    assert.match(late.stdout, /ended reader process\(es\) 42: alive more than 60 s past their --deadline-at/);
    rmSync(join(home, 'kill-calls.log'));
    const soon = Math.floor(Date.now() / 1000) + 600;
    await fire({ ...env, FAKE_PGREP_LIST: `43 node /x/subscription-document-reader.mjs --deadline-at ${soon}` });
    assert.deepEqual(kills(), [], 'within its deadline: not ended');
  });
});

test('a fire keeps its receipt file whenever its summary counts any work', async () => {
  await withHome(async ({ fire }) => {
    const r = await fire({ FAKE_DEEP: '2' });
    assert.equal(r.receipts.length, 1, 'frames claimed for a deep reading');
    assert.match(r.receipts[0], /^subscription-frame-classifier-/);
  });
  await withHome(async ({ fire }) => {
    const r = await fire({ FAKE_RELANDED: '3' });
    assert.equal(r.receipts.length, 1, 'a document fire that read no new page but landed three again');
    assert.match(r.receipts[0], /^subscription-document-reader-/);
  });
});
