// node --test scripts/guardrails/no-new-photo-reader.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { saysItReadsPhotos, tablesWithPhotoKey, violations } from './no-new-photo-reader.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const text = (p) => readFileSync(join(ROOT, p), 'utf8');

test('a new table keyed by a photo is found, whatever its other columns look like', () => {
  const sql = `
    -- image_id in a comment is not a column: create table ghost (image_id uuid);
    create table if not exists public.part_sightings (
      id uuid primary key default gen_random_uuid(),
      image_id uuid not null references public.vehicle_images(id),
      score numeric(4,2) check (score between 0 and 1),
      note text
    );
    CREATE TABLE "damage_reads" (id bigint, "photo_id" uuid, box int[] default array[0,0]);
    create table plain_things (id uuid, name text);
    create temp table scratch (image_id uuid);
    create table registry_rows (id uuid, image_identifier text, images_seen integer);`;
  assert.deepEqual(tablesWithPhotoKey(sql), [{ table: 'part_sightings', column: 'image_id' }, { table: 'damage_reads', column: 'photo_id' }]);
});

test('a name that says it reads photos is recognised; a name that does not is left alone', () => {
  for (const yes of ['image-part-classifier', 'photo-damage-detector', 'vision-reader', 'analyze-vehicle-images', 'scripts/photo-pipeline/part-state-reader.mjs', 'image-ocr-v2', 'damage-detector', 'dent-classifier']) {
    assert.equal(saysItReadsPhotos(yes), true, yes);
  }
  for (const no of ['image-intake', 'photo-sync-daemon', 'receipt-line-parser', 'extract-gooding', 'scripts/books/return_facts.py', 'frame-rail-measurements', 'rust-analyzer-setup', 'damage-report-email']) {
    assert.equal(saysItReadsPhotos(no), false, no);
  }
});

test('only additions that are not allowed are violations', () => {
  const files = {
    'supabase/migrations/20270101000000_part_sightings.sql': 'create table part_sightings (id uuid, image_id uuid);',
    'supabase/migrations/20270101000100_ok.sql': 'create table approved_store (id uuid, image_id uuid); create function f() returns int language sql as $$ select 1 $$;',
  };
  const added = [...Object.keys(files),
    'supabase/functions/photo-damage-detector/index.ts', 'supabase/functions/photo-damage-detector/prompt.ts',
    'supabase/functions/photo-pipeline-orchestrator/newHelper.ts',   // a new file in an existing function extends it
    'supabase/functions/_shared/imageLabels.ts',
    'scripts/photo-pipeline/part-state-reader.mjs', 'scripts/photo-pipeline/part-state-reader.test.mjs', 'scripts/guardrails/no-new-photo-reader.mjs',
    'scripts/photo-pipeline/reader-heartbeat.mjs',                   // about a reader, reads no photo
    'docs/image-classifier-notes.md'];
  const found = violations(added, {
    read: (f) => files[f],
    existedInBase: (p) => p === 'supabase/functions/photo-pipeline-orchestrator',
    allow: { tables: { approved_store: { reason: 'r', approved: 'a' } } },
  });
  assert.deepEqual(found.map((v) => `${v.kind}:${v.what}`), [
    'table:part_sightings', 'function:photo-damage-detector', 'script:scripts/photo-pipeline/part-state-reader.mjs']);
});

// The owner, 2026-11-10: "This is the only conversation that matters and that we never backtrack from here", and
// "the talk on keys and folds is essential to not lose". An earlier form of the same idea was labelled deprecated by
// a cleanup and forgotten. So the record is held by a test: removing or renaming any of these has to be done on
// purpose, by changing this file in a pull request someone can see.
test('the owner direction on photo reading is still where every agent starts', () => {
  const agents = text('AGENTS.md');
  assert.match(agents, /^## Reading photos$/m, 'AGENTS.md keeps its "Reading photos" section');
  assert.ok(agents.includes('docs/ledger/theory/data-machine.md'), 'and it points at the theory card');
  assert.ok(agents.includes('skills/image-keys/SKILL.md'), 'and at the keys brief');

  const card = text('docs/ledger/theory/data-machine.md');
  for (const part of [
    '## Image analysis is the model asking, owner direction 2026-11-10',
    '**Keys and folds, for photos.**',
    '**The gates.**',
    '**The proof vehicle.**',
    '**Acceptance.**',
    "## The owner's words, 2026-11-10",
  ]) assert.ok(card.includes(part), `the theory card keeps: ${part}`);
  // the direction stays the first section of the card, not an appendix
  assert.ok(card.indexOf('## Image analysis is the model asking') < card.indexOf('## Construction direction'), 'the direction is the first section of the card');

  assert.ok(text('docs/ledger/CAPABILITY_MAP.md').includes('| Photo reading: what a photo shows'), 'the capability map keeps the photo reading row');
  assert.match(text('skills/image-keys/SKILL.md'), /^name: image-keys$/m, 'the keys brief exists');
  assert.ok(text('.github/workflows/pre-deploy-check.yml').includes('scripts/guardrails/no-new-photo-reader.mjs'), 'the gate is still run on pull requests');
});
