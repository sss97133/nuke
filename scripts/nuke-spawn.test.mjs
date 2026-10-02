import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { routeModel, canDispatch, dispatchTask, spawnPane, claimTask, releaseTask } from './nuke-spawn.mjs';
import { hashWorkOrder } from './lib/jev-route.mjs';

const task = () => ({
  id: '12cde831-8981-471b-9631-588bc1251259', agent_type: 'vp-platform',
  title: 'Review routing contract', description: 'Preserve the complete request.',
  structural_role: 'keys',
});
const ready = async workOrder => ({
  status: 'ready', runner: 'claude', model: 'sonnet', modelArg: 'sonnet',
  confidence: 0.9, source: 'jev', taskHash: hashWorkOrder(workOrder),
  decidedAt: '2026-10-02T13:00:00Z', reason: 'validated recommendation',
});
async function prepared() {
  const t = task();
  return Object.assign(t, await routeModel(t, { route: ready, publicWorkOrder: true }));
}
function operations() {
  const calls = [];
  return {
    calls,
    claim: async id => { calls.push(['claim', id]); return true; },
    spawn: async task => { calls.push(['spawn', task.taskPrompt]); return true; },
    release: async id => { calls.push(['release', id]); },
  };
}

test('route sees the exact execution prompt including persona, structural role and DB completion', async () => {
  const t = task();
  let seen;
  const result = await routeModel(t, {
    persona: 'Use the existing canonical entities.',
    publicWorkOrder: true,
    route: async workOrder => { seen = workOrder; return ready(workOrder); },
  });
  assert.equal(seen.description, result.taskPrompt);
  assert.match(seen.description, /Use the existing canonical entities/);
  assert.match(seen.description, /STRUCTURAL ROLE: keys/);
  assert.match(seen.description, /UPDATE agent_tasks/);
  assert.match(seen.description, /AND status='in_progress' AND claimed_by='nuke-spawn-[a-f0-9-]+'/);
  assert.match(seen.description, /Confirm the update affected your claimed task/);
  assert.match(seen.description, /claude-log-done and claude-handoff/);
  assert.equal(seen.requirements.databaseAccess, true);
  assert.equal(result.routing.taskHash, hashWorkOrder(result.workOrder));
  assert.equal(canDispatch(Object.assign(t, result)), true);
});

test('organizational role does not invent a structural role or call Jev', async () => {
  for (const role of [undefined, 'vp-platform', 'unknown']) {
    const t = task();
    delete t.structural_role;
    const result = await routeModel(t, { role, route: () => { throw Error('must not classify without a role'); } });
    assert.equal(result.routing.status, 'needs_review');
    assert.equal(canDispatch(Object.assign(t, result)), false);
  }
});

test('DB descriptions and persona require explicit public attestation before routing or claim', async () => {
  for (const publicWorkOrder of [undefined, false, 'yes']) {
    const t = task();
    Object.assign(t, await routeModel(t, { publicWorkOrder, persona: 'Unreviewed instructions', route: () => { throw Error('must not export unreviewed work orders'); } }));
    const ops = operations();
    assert.equal((await dispatchTask(t, ops)).status, 'held');
    assert.deepEqual(ops.calls, []);
    assert.match(t.routing.reason, /public work order attestation/);
  }
});

test('a held route is neither claimed nor spawned', async () => {
  const t = task();
  Object.assign(t, await routeModel(t, { publicWorkOrder: true, route: async () => ({ status: 'needs_review', runner: null, model: null, modelArg: null, reason: 'low confidence' }) }));
  const ops = operations();
  assert.deepEqual(await dispatchTask(t, ops), { status: 'held', reason: 'low confidence' });
  assert.deepEqual(ops.calls, []);
});

test('caller cannot launch Codex when completion requires database access', async () => {
  const t = task();
  Object.assign(t, await routeModel(t, { publicWorkOrder: true, route: async workOrder => ({ ...await ready(workOrder), runner: 'codex', model: 'codex', modelArg: 'deep' }) }));
  const ops = operations();
  assert.equal((await dispatchTask(t, ops)).status, 'held');
  assert.deepEqual(ops.calls, []);
});

test('prompt, requirement, hash or configuration mutations prevent claim', async () => {
  const mutations = [
    t => { t.taskPrompt += '\nRead another database.'; },
    t => { t.workOrder.requirements.databaseAccess = false; },
    t => { t.routing.taskHash = 'changed'; },
    t => { t.model = 'opus'; },
    t => { t.runner = 'codex'; },
    t => { t.id = '12cde831-8981-471b-9631-588bc1251250'; },
    t => { t.workOrder.publicWorkOrder = false; },
    t => { t.description = 'Changed user request'; },
    t => { t.id = "invalid' id"; },
  ];
  for (const mutate of mutations) {
    const t = await prepared();
    mutate(t);
    const ops = operations();
    assert.equal((await dispatchTask(t, ops)).status, 'held');
    assert.deepEqual(ops.calls, []);
  }
});

test('mutation during asynchronous claim releases the claim without spawning', async () => {
  const t = await prepared();
  const ops = operations();
  ops.claim = async id => { ops.calls.push(['claim', id]); t.taskPrompt += '\nNew obligation'; return true; };
  assert.equal((await dispatchTask(t, ops)).status, 'held');
  assert.deepEqual(ops.calls, [['claim', t.id], ['release', t.id]]);
});

test('task identity mutation releases the original claim without spawning a different task', async () => {
  const t = await prepared();
  const originalId = t.id;
  const ops = operations();
  ops.claim = async id => { ops.calls.push(['claim', id]); t.id = '12cde831-8981-471b-9631-588bc1251250'; return true; };
  assert.equal((await dispatchTask(t, ops)).status, 'held');
  assert.deepEqual(ops.calls, [['claim', originalId], ['release', originalId]]);
});

test('ready route executes the original prompt only after a successful claim', async () => {
  const t = await prepared();
  const ops = operations();
  assert.equal((await dispatchTask(t, ops)).status, 'spawned');
  assert.deepEqual(ops.calls, [['claim', t.id], ['spawn', t.taskPrompt]]);
});

test('lost claim does not execute or release someone else’s task', async () => {
  const t = await prepared();
  const ops = operations();
  ops.claim = async id => { ops.calls.push(['claim', id]); return false; };
  assert.equal((await dispatchTask(t, ops)).status, 'skip');
  assert.deepEqual(ops.calls, [['claim', t.id]]);
});

// A synthetic task store applies all predicates atomically, as the server does.
// Concurrent edits and claim owners remain outside the routed JS task object.
function taskStore(row) {
  const client = { from: () => {
    const filters = [];
    let values;
    const query = {
      update: next => { values = next; return query; },
      eq: (key, value) => { filters.push([key, value, 'eq']); return query; },
      is: (key, value) => { filters.push([key, value, 'is']); return query; },
      select: async () => {
        if (!filters.every(([key, value, operator]) => !(operator === 'eq' && value === null) && (row[key] ?? null) === value)) return { data: [], error: null };
        Object.assign(row, values);
        return { data: [{ id: row.id }], error: null };
      },
    };
    return query;
  } };
  return client;
}

test('persisted task edits after routing prevent claim and launch', async () => {
  for (const [key, value] of [['title', 'New title'], ['description', 'New instructions'], ['agent_type', 'worker'], ['priority', 2]]) {
    const t = await prepared();
    const row = { ...task(), status: 'pending' };
    row[key] = value;
    const client = taskStore(row);
    const result = await dispatchTask(t, {
      claim: (id, snapshot) => claimTask(id, snapshot, { client, owner: 'owner-a' }),
      spawn: () => { throw Error('changed DB task must not execute'); },
      release: () => { throw Error('unclaimed DB task must not release'); },
    });
    assert.equal(result.status, 'skip');
    assert.equal(row.status, 'pending');
    assert.equal(row[key], value);
  }
});

test('unchanged nullable source fields can be claimed and released by their owner', async () => {
  const t = task();
  t.description = null;
  t.agent_type = null;
  t.priority = null;
  Object.assign(t, await routeModel(t, { route: ready, publicWorkOrder: true }));
  const row = { ...t.workOrder.requirements.taskSnapshot, status: 'pending' };
  const client = taskStore(row);
  assert.equal(await claimTask(t.id, t.workOrder.requirements.taskSnapshot, { client, owner: 'owner-a' }), true);
  assert.equal(row.status, 'in_progress');
  assert.equal(row.claimed_by, 'owner-a');
  await releaseTask(t.id, { client, owner: 'owner-a' });
  assert.equal(row.status, 'pending');
  assert.equal(row.claimed_by, null);
});

test('release refuses another launcher’s claim or an already completed task', async () => {
  for (const state of [{ status: 'in_progress', claimed_by: 'owner-b' }, { status: 'completed', claimed_by: 'owner-a' }]) {
    const row = { ...task(), ...state };
    const client = taskStore(row);
    await assert.rejects(releaseTask(row.id, { client, owner: 'owner-a' }), /no longer belongs/);
    assert.equal(row.status, state.status);
    assert.equal(row.claimed_by, state.claimed_by);
  }
});

test('failed launch and dry-run release claims without leaving in_progress', async () => {
  const t = await prepared();
  const failed = operations();
  failed.spawn = async () => { failed.calls.push(['failed']); return false; };
  assert.equal((await dispatchTask(t, failed)).status, 'failed');
  assert.deepEqual(failed.calls, [['claim', t.id], ['failed'], ['release', t.id]]);
  const dry = operations();
  assert.equal((await dispatchTask(t, { ...dry, dryRun: true })).status, 'dry-run');
  assert.deepEqual(dry.calls, [['claim', t.id], ['release', t.id]]);
});

test('a thrown prompt or launch failure releases the original claim', async () => {
  const t = await prepared();
  const ops = operations();
  ops.spawn = async () => { throw Error('prompt write failed'); };
  await assert.rejects(dispatchTask(t, ops), /prompt write failed/);
  assert.deepEqual(ops.calls, [['claim', t.id], ['release', t.id]]);
});

test('launch uses an isolated checkout, exact prompt and pane returned by split-window', async () => {
  const t = await prepared();
  const commands = [];
  const writes = new Map();
  const revision = 'cb36e8aea';
  const execute = (file, args, options) => {
    commands.push({ file, args, options });
    if (file === 'git' && args[0] === 'rev-parse') return Buffer.from(revision);
    if (file === 'tmux' && args[0] === 'split-window') return Buffer.from('%42\n');
    return Buffer.from('');
  };
  assert.equal(spawnPane(t, { execute, write: (path, content) => writes.set(path, content), temporaryDirectory: '/tmp/test-routing' }), true);
  const worktreeCommand = commands.find(c => c.file === 'git' && c.args[0] === 'worktree');
  assert.equal(worktreeCommand.args[3], `agent/task-${t.id}`);
  assert.match(worktreeCommand.args[4], new RegExp(`/\\.worktrees/nuke-task-${t.id}$`));
  assert.equal(worktreeCommand.args[5], revision);
  const pane = commands.find(c => c.args[0] === 'split-window');
  assert.deepEqual(pane.args.slice(0, 4), ['split-window', '-P', '-F', '#{pane_id}']);
  assert.equal(pane.args.at(-1), worktreeCommand.args[4]);
  const send = commands.find(c => c.args[0] === 'send-keys');
  assert.equal(send.args[2], '%42');
  assert.equal(commands.some(c => c.args[0] === 'display-message'), false);
  const promptPath = `/tmp/test-routing/nuke-agent-${t.id}.txt`;
  assert.equal(writes.get(promptPath), t.taskPrompt);
  const launch = Buffer.from(send.args[3].match(/echo '([^']+)'/)[1], 'base64').toString();
  assert.match(launch, /--model 'sonnet'/);
  const receipt = JSON.parse(writes.get(`/tmp/test-routing/nuke-agent-${t.id}.route.json`));
  assert.equal(receipt.worktree, worktreeCommand.args[4]);
  assert.equal(receipt.routing.taskHash, hashWorkOrder(t.workOrder));
});

test('static routing requires explicit override and is labeled without Jev confidence', async () => {
  const t = task();
  const r = await routeModel(t, { staticRoute: true, route: () => { throw Error('static operator override'); } });
  assert.equal(r.routing.source, 'explicit-static');
  assert.equal(r.routing.confidence, null);
  assert.equal(canDispatch(Object.assign(t, r)), true);
});

test('CLI returns a nonzero hold receipt when there is no router key', () => {
  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY;
  delete env.JEV_ROUTE_MAX_TIER;
  delete env.JEV_ROUTE_MIN_CONFIDENCE;
  const run = spawnSync(process.execPath, ['scripts/jev-route.mjs', 'Review public task', '--public-work-order'], { cwd: new URL('..', import.meta.url), env, encoding: 'utf8' });
  assert.equal(run.status, 3, run.stderr);
  const receipt = JSON.parse(run.stdout);
  assert.equal(receipt.status, 'needs_review');
  assert.equal(receipt.runner, null);
});
