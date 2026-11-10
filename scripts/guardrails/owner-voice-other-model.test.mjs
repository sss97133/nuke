// node --test scripts/guardrails/owner-voice-other-model.test.mjs
// Offline: checks what the model under test is allowed to see. No model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CASES, TOOL_DEFS, repoTools, systemPrompt } from './owner-voice-other-model.mjs';

const tools = repoTools('HEAD');

test('the model can find the direction from the root of the repository', () => {
  assert.ok(tools.list_dir({ path: '' }).split('\n').includes('AGENTS.md'));
  assert.match(tools.search({ pattern: '^## Reading photos', path: 'AGENTS.md' }), /AGENTS\.md:\d+:## Reading photos/);
  const first = tools.read_file({ path: 'docs/ledger/theory/data-machine.md', max_lines: 40 });
  assert.match(first, /^docs\/ledger\/theory\/data-machine\.md: lines 1-40 of \d+/);
  assert.match(first, /Image analysis is the model asking/);
});

test('the answer key is never shown to the model under test', () => {
  assert.match(tools.read_file({ path: 'scripts/guardrails/owner-voice-test.md' }), /^no such file/);
  assert.ok(!tools.list_dir({ path: 'scripts/guardrails' }).includes('owner-voice-test'));
  assert.ok(!tools.search({ pattern: 'answer key', path: 'scripts/guardrails' }).includes('owner-voice-test.md'));
});

test('reads are bounded and a missing path is said plainly', () => {
  assert.ok(tools.read_file({ path: 'docs/ledger/theory/data-machine-cases.md', max_lines: 5000 }).split('\n').length <= 301);
  assert.match(tools.read_file({ path: 'no/such/file.md' }), /^no such file/);
  assert.match(tools.list_dir({ path: 'no/such/dir' }), /^no such directory/);
});

test('the two variants differ only by AGENTS.md, and the cases are the owner\'s messages', () => {
  const cold = systemPrompt('cold', 'HEAD'); const loaded = systemPrompt('loaded', 'HEAD');
  assert.ok(!cold.includes('## Reading photos'));
  assert.ok(loaded.startsWith(cold) && loaded.includes('## Reading photos'));
  assert.deepEqual(TOOL_DEFS.map((t) => t.function.name), ['list_dir', 'read_file', 'search']);
  for (const k of ['same-page', 'trap-faster-oldest', 'trap-new-detector', 'trap-progress', 'pickup']) assert.ok(CASES[k], k);
});
