import { reviewRetainedInputs } from './reviewWork.ts';
const assert = (ok: unknown, message = 'assertion failed') => { if (!ok) throw new Error(message); };
const id = '10000000-0000-4000-8000-000000000001';
const token = crypto.randomUUID();

Deno.test('review claims one reachable input at a time and pins completion to its lease', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let claims = 0;
  const client = { rpc(name: string, args: Record<string, unknown>) {
    calls.push({ name, args });
    return Promise.resolve({ error: null, data: name.startsWith('claim_') ?
      (++claims === 1 ? [{ id, claimed_revision: 3, lease_token: token }] : []) : { status: 'done' } });
  } };
  const result = await reviewRetainedInputs(client, { worker: 'test', userId: id, limit: 2 });
  assert(result.claimed === 1 && calls.length === 3);
  assert(calls[0].args.p_limit === 1 && calls[0].args.p_user_id === id);
  assert(calls[1].args.p_revision === 3 && calls[1].args.p_lease_token === token);
  assert(!calls.some(c => /ingest|extract|observation/.test(c.name)));
});
Deno.test('zero capacity makes no database call', async () => {
  const result = await reviewRetainedInputs({ rpc() { throw new Error('unreachable'); } }, { limit: 0 });
  assert(result.claimed === 0);
});
Deno.test('failed atomic review is retained for a fenced retry', async () => {
  const calls: string[] = [];
  const result = await reviewRetainedInputs({ rpc(name, args) {
    calls.push(name);
    assert(args.p_worker === 'test');
    return Promise.resolve(name.startsWith('claim_') ? { error: null, data: [{ id, claimed_revision: 1, lease_token: token }] }
      : name.startsWith('finish_') ? { error: { message: 'question write failed' }, data: null }
      : { error: null, data: { status: 'retry' } });
  } }, { worker: 'test', limit: 1 });
  assert(result.results[0].status === 'retry' && calls[2] === 'retry_contributor_intake_reevaluation');
});
Deno.test('lost lease cannot be completed by a replacement worker name', async () => {
  const result = await reviewRetainedInputs({ rpc(name) { return Promise.resolve({ error: null,
    data: name.startsWith('claim_') ? [{ id, claimed_revision: 1, lease_token: token }] : { status: 'lease_lost' } });
  } }, { limit: 1 });
  assert(result.results[0].status === 'lease_lost');
});
Deno.test('malformed claim and database admission errors fail visibly', async () => {
  for (const response of [{ data: {}, error: null }, { data: null, error: { message: 'db unavailable' } }]) {
    let rejected = false;
    try { await reviewRetainedInputs({ rpc: () => Promise.resolve(response) }); } catch { rejected = true; }
    assert(rejected);
  }
});
Deno.test('deadline prevents claiming work the invocation cannot reach', async () => {
  let calls = 0;
  const result = await reviewRetainedInputs({ rpc() { calls++; throw new Error('unreachable'); } }, {
    now: () => calls++ === 0 ? 0 : 16000,
  });
  assert(result.claimed === 0 && calls === 2);
});
