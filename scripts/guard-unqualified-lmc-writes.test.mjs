import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('unqualified catalog writers refuse before any network or database request', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lmc-writer-guard-'));
  try {
    const marker = join(dir, 'network-request');
    const preload = join(dir, 'network-guard.cjs');
    writeFileSync(preload, `
      const fs = require('node:fs');
      const net = require('node:net');
      function record() { fs.writeFileSync(process.env.LMC_TEST_MARKER, 'network'); throw Error('network attempted'); }
      globalThis.fetch = record;
      net.Socket.prototype.connect = record;
    `);
    for (const file of [
      'parse-lmc-assemblies.cjs', 'lmc-bulk-scraper.cjs', 'scrape-lmc-real.cjs',
      'index-lmc-catalog-v2.cjs', 'index-lmc-catalog.cjs', 'index-lmc-catalog.js', 'index-lmc-catalog.mjs',
      'index-lmc-complete.cjs', 'index-lmc-complete.mjs', 'index-lmc-from-text.mjs',
      'scrape-lmc-final.cjs', 'scrape-lmc-firecrawl.cjs', 'scrape-lmc-images.cjs', 'scrape-lmc-images.mjs',
      'scrape-lmc-proper.cjs', 'scrape-lmc-working.cjs', 'test-firecrawl-lmc-v2.cjs', 'backfill-catalog-metadata.cjs',
    ]) {
      const script = fileURLToPath(new URL(`./${file}`, import.meta.url));
      const result = spawnSync(process.execPath, ['--require', preload, script], {
        encoding: 'utf8', timeout: 5000,
        env: { ...process.env, VITE_SUPABASE_URL: 'http://127.0.0.1:1',
          SUPABASE_SERVICE_ROLE_KEY: 'test-key', FIRECRAWL_API_KEY: 'test-key', GEMINI_API_KEY: 'test-key', LMC_TEST_MARKER: marker },
      });
      assert.equal(result.status, 1, `${file}: ${result.stderr}`);
      assert.match(result.stderr, /LMC_SOURCE_SCOPE_UNQUALIFIED/, file);
      assert.equal(existsSync(marker), false, `${file} attempted network access`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
