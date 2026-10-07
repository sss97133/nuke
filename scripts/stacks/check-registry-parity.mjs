#!/usr/bin/env node
/**
 * check-registry-parity.mjs: do this generator's local verdicts equal the stack registry's own?
 *
 * Reads, read-only through scripts/data/q.sh, the needs of every registered stack (latest version) and the verdicts of
 * public.stack_coverage(); resolves each table, column and abstract need with measure.mjs against a fresh atlas pull;
 * prints agreement per kind and every disagreement. intake, function and stack needs are not modelled locally and are
 * skipped. Run it after the registry's coverage rules change: a disagreement means measure.mjs has drifted.
 *
 *   node scripts/stacks/check-registry-parity.mjs [--run-dir DIR]     exit 0 all agree, 1 a disagreement, 2 registry unreadable
 */
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LOG_ROOT, ensureDir, pg, utcStamp } from './lib/common.mjs';
import { loadAtlas, loadRegistry } from './lib/atlas.mjs';
import { buildIndex, resolveNeed } from './measure.mjs';

const NEEDS_SQL = `select n.stack_id, n.layer, n.kind, n.object, n.denominator
  from public.stack_needs n
  join (select distinct on (stack_id) stack_id, version from public.stacks order by stack_id, version desc) c
    on c.stack_id = n.stack_id and c.version = n.version
  order by n.stack_id, n.layer, n.object`;
const COVERAGE_SQL = 'select stack_id, needs from public.stack_coverage()';
const MODELLED = new Set(['table', 'column', 'abstract']);

/** Compare local verdicts with the registry's. `live` is stack_coverage() rows, `needs` the registry's need rows. */
export function compare(index, needs, live) {
  const theirs = new Map();
  for (const row of live) for (const n of row.needs ?? []) theirs.set(`${row.stack_id}|${n.layer}|${n.object}`, n);
  const byKind = {};
  const disagreements = [];
  for (const need of needs) {
    const slot = (byKind[need.kind] ??= { compared: 0, agree: 0, skipped: 0 });
    if (!MODELLED.has(need.kind)) { slot.skipped++; continue; }
    const registry = theirs.get(`${need.stack_id}|${need.layer}|${need.object}`);
    if (!registry) { slot.skipped++; continue; }
    const mine = resolveNeed(index, { layer: need.layer, kind: need.kind, object: need.object, denominator: need.denominator ?? undefined });
    slot.compared++;
    if (mine.verdict === registry.verdict) slot.agree++;
    else disagreements.push({ stack: need.stack_id, layer: need.layer, kind: need.kind, object: need.object, local: mine.verdict, registry: registry.verdict, local_evidence: mine.evidence, registry_evidence: registry.evidence });
  }
  return { byKind, disagreements };
}

export async function main(argv = process.argv.slice(2)) {
  const at = argv.indexOf('--run-dir');
  const runDir = ensureDir(at >= 0 ? resolve(argv[at + 1]) : join(LOG_ROOT, 'runs', `${utcStamp()}-parity`));
  let needs, live;
  try {
    [needs, live] = [await pg(NEEDS_SQL), await pg(COVERAGE_SQL)];
  } catch (error) {
    console.error(`parity: the registry could not be read (${error.message})`);
    return 2;
  }
  const atlas = await loadAtlas({ runDir });
  const registry = await loadRegistry({ runDir });
  const { byKind, disagreements } = compare(buildIndex(atlas, registry), needs, live);
  console.log(`registry needs: ${needs.length}; atlas pulled ${atlas.pulled_at}`);
  for (const [kind, s] of Object.entries(byKind)) console.log(`  ${kind.padEnd(9)} compared ${String(s.compared).padStart(3)}  agree ${String(s.agree).padStart(3)}  skipped ${String(s.skipped).padStart(3)}`);
  for (const d of disagreements) console.log(`DISAGREE ${d.stack} ${d.layer} ${d.kind} ${d.object}: local ${d.local} (${d.local_evidence}) vs registry ${d.registry} (${JSON.stringify(d.registry_evidence)})`);
  console.log(disagreements.length ? `${disagreements.length} disagreement(s)` : 'all compared needs agree');
  return disagreements.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }, error => { console.error(`parity: ${error.message}`); process.exitCode = 2; });
}
