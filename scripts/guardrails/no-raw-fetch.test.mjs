import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

function assay(source, { flagged = false, line = 1, shared = false, extraSource } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nuke-fetch-guard-'));
  try {
    const guard = join(root, 'scripts/guardrails/no-raw-fetch.sh');
    const folder = join(root, 'supabase/functions', shared ? '_shared' : 'fixture');
    mkdirSync(join(root, 'scripts/guardrails'), { recursive: true });
    mkdirSync(folder, { recursive: true });
    copyFileSync(new URL('./no-raw-fetch.sh', import.meta.url), guard);
    writeFileSync(join(folder, 'index.ts'), source);
    if (extraSource) writeFileSync(join(folder, 'other.ts'), extraSource);
    const result = spawnSync('bash', [guard], { encoding: 'utf8' });
    assert.equal(result.status, flagged ? 1 : 0, result.stdout + result.stderr);
    if (flagged) {
      assert.match(result.stdout, /1 raw fetch\(\) call/);
      assert.ok(result.stdout.includes(`supabase/functions/fixture/index.ts:${line}:`), result.stdout);
    } else assert.match(result.stdout, /no-raw-fetch: clean/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const root of ['supabaseUrl', 'SUPABASE_URL', 'Deno.env.get("SUPABASE_URL")', "Deno.env.get('SUPABASE_URL')"]) {
  for (const path of ['rest/v1/rpc/get_seller_stats', 'functions/v1/extract-bat-core', 'storage/v1/object/public/images/x', 'auth/v1/user']) {
    test(`internal continuation ${root}/${path}`, () => {
      assay('const r = await fetch(\n  `${' + root + '}/' + path + '`,\n  { method: "POST" }\n);\n');
    });
  }
}

test('external listing continuation stays visible at fetch line', () => {
  assay('\nconst r = await fetch(\n  "https://bringatrailer.com/listing/example",\n  { headers: { origin: SUPABASE_URL } }\n);', { flagged: true, line: 2 });
});
test('Firecrawl continuation stays visible', () => {
  assay('await fetch(\n  "https://api.firecrawl.dev/v1/scrape",\n  { method: "POST" }\n);', { flagged: true });
});
test('variable acquisition feed stays visible', () => {
  assay('await fetch(API, { method: "POST" });', { flagged: true });
});
test('unknown continuation stays visible despite later internal options', () => {
  assay('await fetch(\n  url,\n  { headers: { origin: `${supabaseUrl}/rest/v1/` } }\n);', { flagged: true });
});
test('external host with an internal-looking path stays visible', () => {
  assay('await fetch(\n  `https://example.com/functions/v1/scrape`,\n);', { flagged: true });
});
test('nested Supabase template on external host stays visible', () => {
  assay('await fetch(\n  `https://example.com/${supabaseUrl}/rest/v1/`,\n);', { flagged: true });
});
test('unrecognized Supabase path stays visible', () => {
  assay('await fetch(\n  `${supabaseUrl}/listing/example`,\n);', { flagged: true });
});
test('EOF does not hide an unfinished fetch', () => {
  assay('await fetch(\n', { flagged: true });
});
test('an internal target in another file cannot hide an unfinished fetch', () => {
  assay('await fetch(\n', { flagged: true, extraSource: '`${supabaseUrl}/rest/v1/rpc/x`,\n' });
});
test('a transformed internal-looking template stays visible', () => {
  assay('await fetch(\n  `${supabaseUrl}/rest/v1/rpc/x`.replace(supabaseUrl, externalHost),\n);', { flagged: true });
});
test('a concatenated target stays visible', () => {
  assay('await fetch(\n  `${supabaseUrl}/rest/v1/rpc/x` + target,\n);', { flagged: true });
});
test('an earlier external fetch on the same line cannot be hidden by an internal continuation', () => {
  assay('await fetch(externalUrl); await fetch(\n  `${supabaseUrl}/rest/v1/rpc/x`,\n);', { flagged: true });
});
test('same-line service API exemption retained', () => {
  assay('await fetch("https://api.openai.com/v1/chat/completions", { method: "POST" });');
});
test('comment and archiveFetch exclusion retained', () => {
  assay('// fetch(url)\nconst r = await archiveFetch(url, { platform: "bat" });');
});
test('shared internal fetch implementation excluded', () => {
  assay('await fetch(url);', { shared: true });
});
