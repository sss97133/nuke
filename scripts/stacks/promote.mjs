#!/usr/bin/env node
/**
 * promote.mjs: the migration-ready INSERT text for one chosen proposal.
 *
 * The stack registry is append-only and written only by migration files (no writer function, service_role SELECT only), so the
 * generator never writes it. A reviewer picks a row of INDEX.md and this writes ~/nuke-logs/stacks/promote/<name>.sql: the
 * INSERTs for stack_substrates (new abstract layers), stacks and stack_needs, no BEGIN or COMMIT, with a header that cites
 * which registered stacks already need the same tables, columns or substrates (live v_stacks coverage). Nothing is applied.
 *
 *   node scripts/stacks/promote.mjs <rank | proposal id | registry id | name> [--stack-id S61] [--log-dir DIR]
 *   exit: 0 written, 1 not found or refused, 2 usage
 */
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LOG_ROOT } from './lib/common.mjs';
import { loadRegistry } from './lib/atlas.mjs';
import { rankRecords, readAllRecords } from './lib/output.mjs';
import { nextFreeStackId, writePromotion } from './lib/registry.mjs';
import { nameKey } from './lib/common.mjs';

/** A record by its rank in INDEX.md (1 is the top), proposal id (stk-...), registry id (SG...), or exact name. */
export function choose(records, selector) {
  const ranked = rankRecords(records);
  const want = String(selector).trim();
  if (/^#?\d+$/.test(want)) return ranked[Number(want.replace('#', '')) - 1] ?? null;
  return ranked.find(r => r.id === want || r.registry_stack_id === want.toUpperCase() || nameKey(r.name) === nameKey(want)) ?? null;
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  let selector = null, logDir = null, stackId;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--stack-id') stackId = argv[++i];
    else if (argv[i] === '--log-dir') logDir = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') { selector = null; break; }
    else if (selector === null && !argv[i].startsWith('--')) selector = argv[i];
    else { console.error(`promote: unknown argument ${argv[i]}`); return 2; }
  }
  if (!selector) {
    console.log('usage: node scripts/stacks/promote.mjs <rank | proposal id | registry id | name> [--stack-id S61] [--log-dir DIR]');
    return 2;
  }
  const logRoot = logDir ? resolve(logDir) : LOG_ROOT;
  const record = choose(readAllRecords(logRoot), selector);
  if (!record) { console.error(`promote: no proposal matches "${selector}" in ${join(logRoot, 'proposals')}`); return 1; }
  const registry = await (deps.loadRegistry ?? loadRegistry)({}); // read fresh, uncached: the registry may have moved since the run
  if (!registry.available) { console.error(`promote: the registry could not be read (${registry.error ?? 'unavailable'}); not guessing at substrates or names`); return 1; }
  const out = writePromotion(record, registry, { dir: join(logRoot, 'promote'), stackId });
  if (out.refused) { console.error(`promote: refused: ${out.refused}`); return 1; }
  console.log(`wrote ${out.file}`);
  console.log(`  ${record.name}: stack ${out.stack_id}, ${out.needs} need(s), ${out.substrates} new substrate(s), shares needs with ${record.shares_with?.length ?? 0} registered stack(s)`);
  console.log(`  ledger's next free number: ${nextFreeStackId(registry)} (re-run with --stack-id to use it); nothing was applied`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }, error => { console.error(`promote: ${error.message}`); process.exitCode = 1; });
}
