// node --test scripts/ci/subscription-token.test.mjs
// The shared subscription-token step: whitespace removed, the joined value masked before anything else is printed,
// exported through GITHUB_ENV, and only its shape printed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'subscription-token.sh');
const FAKE = 'sk-ant-oat01-FAKEfakeFAKEfake0123456789';

function run(token, { withEnvFile = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sub-token-'));
  const envFile = join(dir, 'github_env');
  writeFileSync(envFile, '');
  const env = { PATH: process.env.PATH };
  if (token !== undefined) env.CLAUDE_CODE_OAUTH_TOKEN = token;
  if (withEnvFile) env.GITHUB_ENV = envFile;
  const r = spawnSync('bash', [SCRIPT], { env, encoding: 'utf8' });
  const exported = readFileSync(envFile, 'utf8');
  rmSync(dir, { recursive: true, force: true });
  return { ...r, exported };
}

test('a wrapped token is joined, masked first, exported, and only its shape is printed', () => {
  const wrapped = `${FAKE.slice(0, 20)}\n${FAKE.slice(20)} \n`;
  const r = run(wrapped);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines[0], `::add-mask::${FAKE}`, 'the mask is the first line written');
  assert.equal(lines.length, 2);
  assert.equal(lines[1], `token shape | removed: 3 whitespace, length: ${FAKE.length}, subscription prefix: yes`);
  assert.ok(!lines[1].includes(FAKE.slice(0, 12)), 'the shape line holds no part of the value');
  assert.equal(r.exported, `CLAUDE_CODE_OAUTH_TOKEN=${FAKE}\n`);
  assert.equal(r.stderr, '');
});

test('a clean token is passed through unchanged', () => {
  const r = run(FAKE);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /removed: 0 whitespace/);
  assert.equal(r.exported, `CLAUDE_CODE_OAUTH_TOKEN=${FAKE}\n`);
});

test('an empty or whitespace-only secret is refused with the authentication code and nothing is exported', () => {
  for (const t of [undefined, '', ' \n\t']) {
    const r = run(t);
    assert.equal(r.status, 4, JSON.stringify(t));
    assert.equal(r.exported, '');
    assert.match(r.stdout, /^::error::/);
  }
});

test('outside Actions (no GITHUB_ENV) it refuses before masking or printing the value', () => {
  const r = run(FAKE, { withEnvFile: false });
  assert.equal(r.status, 2);
  assert.ok(!r.stdout.includes(FAKE));
});

test('a token without the subscription prefix says so', () => {
  const r = run('not-a-subscription-token');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /subscription prefix: no$/m);
});
