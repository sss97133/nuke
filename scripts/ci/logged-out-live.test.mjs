import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const script = fileURLToPath(new URL('./logged-out-live.mjs', import.meta.url));
const source = fs.readFileSync(script, 'utf8');

// Run the unchanged CLI module against browser/HTTP fixtures. No network, credentials, screenshots or delays.
async function probe({ timeout = false, navigationFailure = false, refused = false, text = 'Nuke vehicle evidence', images = 1, photoCount = 1, delayedImages = false } = {}) {
  const written = new Map();
  let exitCode;
  const chromium = { launch: async () => ({
    newContext: async () => ({
      newPage: async () => {
        const handlers = new Map();
        let renderedImages = images;
        return {
          on: (event, handler) => handlers.set(event, handler),
          goto: async () => {
            handlers.get('response')?.({
              url: () => 'https://fixture.supabase.co/rest/v1/vehicle_images_public?select=id',
              request: () => ({ headers: () => ({ apikey: 'anon' }) }),
              status: () => refused ? 403 : 200,
            });
            if (timeout || navigationFailure) {
              const error = new Error('synthetic navigation failure');
              error.name = timeout ? 'TimeoutError' : 'Error';
              throw error;
            }
          },
          waitForTimeout: async () => {},
          waitForFunction: async () => {
            if (delayedImages) renderedImages = 1;
            if (!renderedImages) throw new Error('synthetic photo wait timed out');
          },
          evaluate: async () => ({ text, images: renderedImages }),
          screenshot: async () => {},
        };
      },
      close: async () => {},
    }),
    close: async () => {},
  }) };
  const context = createContext({
    process: {
      env: { LIVE_SITE: 'https://fixture.invalid', LIVE_OUT: '/synthetic', LIVE_VEHICLES: '00000000-0000-0000-0000-000000000001' },
      exit: code => { exitCode = code; },
    },
    console: { log() {} },
    URL,
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => `0-0/${photoCount}` } }),
  });
  const imports = {
    'node:module': { createRequire: () => name => {
      assert.equal(name, 'playwright');
      return { chromium };
    } },
    'node:fs': { default: { mkdirSync() {}, writeFileSync: (name, data) => written.set(name, data) } },
    'node:path': { default: path },
  };
  const module = new SourceTextModule(source, { context, identifier: script });
  await module.link(name => {
    const values = imports[name];
    assert.ok(values, `unexpected import ${name}`);
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return { exitCode, ...JSON.parse(written.get('/synthetic/result.json')) };
}

test('a healthy public page passes', async () => {
  const result = await probe();
  assert.equal(result.exitCode, 0);
  assert.equal(result.failures.length, 0);
  assert.equal(result.warnings.length, 0);
});

test('a rendered page with an idle timeout warns without inventing an API refusal', async () => {
  const result = await probe({ timeout: true });
  assert.equal(result.exitCode, 0);
  assert.equal(result.failures.length, 0);
  assert.ok(result.warnings.some(w => w.what.includes('did not become idle')));
});

test('admitted photos that render after the text response are sampled after the wait', async () => {
  const result = await probe({ images: 0, delayedImages: true });
  assert.equal(result.exitCode, 0);
  assert.equal(result.failures.length, 0);
});

test('permission refusal still fails when navigation also times out', async () => {
  const result = await probe({ timeout: true, refused: true });
  assert.equal(result.exitCode, 1);
  assert.ok(result.failures.some(f => f.what === 'data API refused or rejected requests' && f.detail.some(d => d.startsWith('403 '))));
});

test('a timeout before any visible content still fails', async () => {
  const result = await probe({ timeout: true, text: '', images: 0, photoCount: 0 });
  assert.equal(result.exitCode, 1);
  assert.ok(result.failures.some(f => f.what === 'page navigation failed'));
});

test('other navigation failures remain hard failures', async () => {
  const result = await probe({ navigationFailure: true });
  assert.equal(result.exitCode, 1);
  assert.ok(result.failures.some(f => f.what === 'page navigation failed'));
});

test('a rendered page without admitted photos still fails', async () => {
  const result = await probe({ timeout: true, images: 0, photoCount: 3 });
  assert.equal(result.exitCode, 1);
  assert.ok(result.failures.some(f => f.what.includes('database admits 3 photos')));
});
