import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { routeTask, hashWorkOrder, MAX_TASK_BYTES } from './jev-route.mjs';

const bounded = {
  title: 'Review public router', description: 'Read public code and return findings.',
  role: 'Cartographer', requirements: { databaseAccess: false, deliverable: 'review' },
  publicWorkOrder: true,
};
const answers = (choice = 'codex', confidence = 0.9, priv = 0, stakes = 0) => ({
  answers: { tier: { choice, confidence }, private_data: { noul: priv }, high_stakes: { noul: stakes } },
});

function setup(t, body = answers(), env = {}) {
  const keys = ['TYPESAFE_API_KEY', 'JEV_ROUTE_MIN_CONFIDENCE', 'JEV_ROUTE_MAX_TIER'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.TYPESAFE_API_KEY = 'test';
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => body };
  });
  return requests;
}

function held(receipt, reason) {
  assert.equal(receipt.status, 'needs_review');
  assert.equal(receipt.model, null);
  assert.equal(receipt.runner, null);
  assert.equal(receipt.modelArg, null);
  assert.equal(receipt.suggestedModel, 'sonnet');
  assert.match(receipt.reason, reason);
  assert.match(receipt.taskHash, /^[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(Date.parse(receipt.decidedAt)));
}

test('Codex at 0.56 holds universally instead of bypassing the threshold', async t => {
  setup(t, answers('codex', 0.56));
  const receipt = await routeTask(bounded);
  held(receipt, /low confidence/);
  assert.equal(receipt.recommendedModel, 'codex');
  assert.equal(receipt.confidence, 0.56);
});

test('absent or false public-work-order attestation holds before external routing', async t => {
  const requests = setup(t);
  const absent = { ...bounded };
  delete absent.publicWorkOrder;
  for (const work of [absent, { ...bounded, publicWorkOrder: false },
    { ...bounded, publicWorkOrder: 'true' }, { ...bounded, publicWorkOrder: 1 }]) {
    const receipt = await routeTask(work);
    held(receipt, /public work order attestation required before external routing/);
    assert.equal(receipt.taskHash, hashWorkOrder(work));
  }
  assert.equal(requests.length, 0);
});

test('high-confidence bounded public Codex review is ready', async t => {
  setup(t);
  const receipt = await routeTask(bounded);
  assert.equal(receipt.status, 'ready');
  assert.equal(receipt.runner, 'codex');
  assert.equal(receipt.model, 'codex');
  assert.equal(receipt.taskHash, hashWorkOrder(bounded));
  assert.equal(receipt.source, 'jev');
});

test('low confidence holds every Claude choice without upgrading', async t => {
  setup(t);
  for (const choice of ['haiku', 'sonnet', 'opus', 'fable']) {
    globalThis.fetch = async () => ({ ok: true, json: async () => answers(choice, 0.59) });
    const receipt = await routeTask(bounded);
    held(receipt, /low confidence/);
    assert.equal(receipt.recommendedModel, choice);
  }
});

test('private and unknown private data hold Codex instead of substituting Claude', async t => {
  setup(t, answers('codex', 0.9, 0.3));
  held(await routeTask(bounded), /possible private data/);
  const unknown = answers();
  delete unknown.answers.private_data;
  globalThis.fetch = async () => ({ ok: true, json: async () => unknown });
  held(await routeTask(bounded), /possible private data/);
});

test('declared database access independently holds misclassified Codex', async t => {
  setup(t);
  for (const databaseAccess of [true, 'read', 'write', 'unknown']) {
    held(await routeTask({ ...bounded, requirements: { databaseAccess } }), /declared database access/);
  }
});

test('explicit none permits a database-free task', async t => {
  setup(t);
  assert.equal((await routeTask({ ...bounded, requirements: { databaseAccess: 'none' } })).status, 'ready');
});

test('policy checks the hashed snapshot when caller requirements change during fetch', async t => {
  setup(t);
  const requirements = { databaseAccess: true };
  const work = { ...bounded, requirements };
  const originalHash = hashWorkOrder(work);
  globalThis.fetch = async (_url, options) => {
    assert.equal(JSON.parse(options.body).state.task.requirements.databaseAccess, true);
    requirements.databaseAccess = false;
    return { ok: true, json: async () => answers() };
  };
  const receipt = await routeTask(work);
  held(receipt, /declared database access/);
  assert.equal(receipt.taskHash, originalHash);
  assert.notEqual(receipt.taskHash, hashWorkOrder(work));
});

test('invalid choice and missing tier hold', async t => {
  setup(t);
  for (const body of [answers('unknown'), {}, null, { answers: {} }]) {
    globalThis.fetch = async () => ({ ok: true, json: async () => body });
    held(await routeTask(bounded), /tier answer/);
  }
});

test('confidence must be a finite numeric probability for every runner', async t => {
  setup(t);
  for (const choice of ['codex', 'sonnet']) {
    for (const confidence of [undefined, null, NaN, Infinity, -0.1, 1.1, '0.9']) {
      const body = answers(choice);
      body.answers.tier.confidence = confidence;
      globalThis.fetch = async () => ({ ok: true, json: async () => body });
      held(await routeTask(bounded), /invalid confidence/);
    }
  }
});

test('invalid safety probabilities hold', async t => {
  setup(t);
  for (const [priv, stakes] of [[NaN, 0], [0, Infinity], ['0', 0], [0, -1], [2, 0]]) {
    globalThis.fetch = async () => ({ ok: true, json: async () => answers('sonnet', 0.9, priv, stakes) });
    held(await routeTask(bounded), /invalid safety answer/);
  }
});

test('invalid configured threshold holds before fetch', async t => {
  const requests = setup(t);
  for (const threshold of ['', ' ', 'oops', 'NaN', 'Infinity', '-0.1', '1.1']) {
    process.env.JEV_ROUTE_MIN_CONFIDENCE = threshold;
    held(await routeTask(bounded), /invalid JEV_ROUTE_MIN_CONFIDENCE/);
  }
  assert.equal(requests.length, 0);
});

test('confidence equal to a valid threshold is eligible', async t => {
  setup(t, answers('sonnet', 0.6), { JEV_ROUTE_MIN_CONFIDENCE: '0.6' });
  const receipt = await routeTask(bounded);
  assert.equal(receipt.status, 'ready');
  assert.equal(receipt.modelArg, 'sonnet');
});

test('model above ceiling holds without downgrading', async t => {
  setup(t, answers('opus'), { JEV_ROUTE_MAX_TIER: 'sonnet' });
  const receipt = await routeTask(bounded);
  held(receipt, /exceeds ceiling sonnet/);
  assert.equal(receipt.recommendedModel, 'opus');
});

test('invalid tier ceiling holds before fetch', async t => {
  const requests = setup(t, answers(), { JEV_ROUTE_MAX_TIER: 'unknown' });
  held(await routeTask(bounded), /invalid JEV_ROUTE_MAX_TIER/);
  assert.equal(requests.length, 0);
});

test('high-stakes Haiku holds without substituting an unassayed model', async t => {
  setup(t, answers('haiku', 0.9, 0, 0.5));
  held(await routeTask(bounded), /high stakes/);
});

test('full task beyond 4000 characters, persona and completion instructions reach Jev and hash', async t => {
  const requests = setup(t);
  const work = {
    ...bounded, description: 'x'.repeat(5000) + '\nEND OF DESCRIPTION',
    persona: 'Preserve the owner intent; return a measured assay.',
    completionInstructions: 'Return a review receipt without database access.',
  };
  const receipt = await routeTask(work);
  const routed = requests[0].state.task;
  assert.deepEqual(routed, work);
  assert.equal(receipt.taskHash, createHash('sha256').update(JSON.stringify(routed)).digest('hex'));
  assert.equal(receipt.taskHash, hashWorkOrder(work));
  const instructions = requests[0].questions.tier.instructions;
  assert.match(instructions, /suitability and quality/);
  assert.match(instructions, /Only among qualified options/);
  assert.match(instructions, /retries and verification/);
});

test('changes to every routed field alter the hash; fallback does not', async t => {
  setup(t);
  const work = { ...bounded, persona: 'public persona', completionInstructions: 'return result' };
  const original = hashWorkOrder(work);
  const changes = {
    title: 'different title', description: 'different description', role: 'Keys',
    requirements: { databaseAccess: true }, persona: 'changed persona', completionInstructions: 'changed completion',
    publicWorkOrder: false,
  };
  for (const [field, value] of Object.entries(changes)) {
    assert.notEqual(hashWorkOrder({ ...work, [field]: value }), original);
  }
  assert.equal(hashWorkOrder({ ...work, fallback: 'opus' }), original);
  assert.equal((await routeTask(work)).taskHash, original);
});

test('default hash serialization matches the receipt', async t => {
  setup(t);
  assert.equal((await routeTask({ title: 'Task' })).taskHash, hashWorkOrder({ title: 'Task' }));
});

test('oversized complete input holds without truncating or making a request', async t => {
  const requests = setup(t);
  const work = { ...bounded, completionInstructions: '🧪'.repeat(MAX_TASK_BYTES) };
  const receipt = await routeTask(work);
  held(receipt, /complete work order exceeds/);
  assert.equal(receipt.taskHash, hashWorkOrder(work));
  assert.equal(requests.length, 0);
});

test('missing key holds and preserves fallback only as a suggestion', async t => {
  const requests = setup(t, answers(), { TYPESAFE_API_KEY: undefined });
  held(await routeTask(bounded), /TYPESAFE_API_KEY not set/);
  assert.equal(requests.length, 0);
});

test('HTTP, transport and JSON failures hold without launching fallback', async t => {
  setup(t);
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  held(await routeTask(bounded), /HTTP 503/);
  globalThis.fetch = async () => { throw new Error('synthetic timeout'); };
  held(await routeTask(bounded), /synthetic timeout/);
  globalThis.fetch = async () => ({ ok: true, json: async () => { throw new Error('invalid JSON'); } });
  held(await routeTask(bounded), /invalid JSON/);
});

test('unrecognized fallback is never executable or suggested', async t => {
  setup(t, answers('codex', 0.56));
  const receipt = await routeTask({ ...bounded, fallback: 'unknown' });
  assert.equal(receipt.status, 'needs_review');
  assert.equal(receipt.model, null);
  assert.equal(receipt.runner, null);
  assert.equal(receipt.suggestedModel, null);
});
