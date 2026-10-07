// The hook to the stack registry (public.stacks, public.stack_needs, public.stack_substrates; migration
// 20261007014500_stack_registry.sql, merged in #721, live 2026-10-07).
//
// The registry has no runtime writer. Its writer is `supabase/migrations`: rows are inserted by a reviewed migration,
// append-only, under SCHEMA_LAW. So `--registry` does the part a script can do honestly and stops there: it writes
// registry-<run>.sql in the run folder, the exact INSERTs for the proposals of the run (status 'proposed', "registered, not
// reviewed"), with every object checked against the registry's own CHECK constraints. A reviewing agent then puts the
// accepted statements into one migration. Nothing is applied, no database is touched.
//
// Kinds map as follows: table and column stay. A dimension or source phrase becomes an abstract need named after the registry
// substrate it matches; or the column or table it resolved to, when it is just an existing one; or, when it is neither, a new
// stack_substrates row (no table declared) that a migration may declare later.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAYERS } from './grammar.mjs';
import { nameKey } from './common.mjs';

const ID_FORM = /^S[0-9A-Z]+$/;
const TABLE_FORM = /^[a-z_][a-z0-9_]*$/;
const COLUMN_FORM = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;
const REGISTERED_BY = 'stack-generator (local)';

/** SG plus eight hex capitals of the name's hash: stable for one name, in the registry's S[0-9A-Z]+ form, clear of S01-S60 and SA-SD. */
export function stackIdFor(name) {
  return `SG${createHash('sha1').update(nameKey(name)).digest('hex').slice(0, 8).toUpperCase()}`;
}

const lit = text => `'${String(text).replace(/[\u0000-\u001f]/g, ' ').replace(/'/g, "''")}'`;
const arr = list => `ARRAY[${list.map(lit).join(', ')}]::text[]`;

/** One measured record -> the registry rows it would become, plus anything that could not be expressed. */
export function toRegistryRows(record, substrateNames = new Set()) {
  const stackId = stackIdFor(record.name);
  const skipped = [];
  const seen = new Set();
  const needs = [];
  const newSubstrates = [];
  for (const v of record.needs) {
    let need;
    if (v.kind === 'table') need = { layer: v.layer, kind: 'table', object: v.resolved ?? v.object };
    else if (v.kind === 'column') need = { layer: v.layer, kind: 'column', object: v.resolved ?? v.object };
    else if (v.substrate) need = { layer: v.layer, kind: 'abstract', object: v.substrate }; // names a registry substrate
    else if (COLUMN_FORM.test(v.resolved ?? '')) need = { layer: v.layer, kind: 'column', object: v.resolved }; // a phrase that is an existing column
    else if (TABLE_FORM.test(v.resolved ?? '')) need = { layer: v.layer, kind: 'table', object: v.resolved };   // a phrase that is an existing table
    else need = { layer: v.layer, kind: 'abstract', object: String(v.object).trim() }; // a new abstract layer, no table declared
    const formOk = need.kind === 'table' ? TABLE_FORM.test(need.object)
      : need.kind === 'column' ? COLUMN_FORM.test(need.object)
      : need.object !== '' && need.object === need.object.trim();
    if (!LAYERS.includes(need.layer) || !formOk) { skipped.push({ ...need, why: 'does not fit the registry constraints' }); continue; }
    const key = `${need.layer}|${need.object}`; // stack_needs is keyed by stack, version, layer and object
    if (seen.has(key)) continue;
    seen.add(key);
    needs.push(need);
    if (need.kind === 'abstract' && !substrateNames.has(need.object) && !newSubstrates.includes(need.object)) newSubstrates.push(need.object);
  }
  const p = record.proposal;
  const stack = {
    stack_id: stackId, version: 1, name: p.name, question: p.question,
    path: LAYERS.map(layer => `${layer}: ${p.layers[layer]}`),
    external_dimensions: p.external_dimensions.length ? p.external_dimensions : null,
    who_cares: p.who_cares, scoring: p.score_rule, status: 'proposed',
    source: `local stack generator run ${record.run} (${record.asker?.via} ${record.asker?.model})`,
    registered_by: REGISTERED_BY,
  };
  return { stack, needs, newSubstrates, skipped };
}

/** The review file: INSERTs in dependency order (substrates, stack, needs), one block per proposal, in one transaction. */
export function registrySql(records, registry = { substrates: [] }) {
  const known = new Set((registry.substrates ?? []).map(s => s.substrate));
  const blocks = [];
  const totals = { stacks: 0, needs: 0, substrates: 0, skipped: 0 };
  for (const record of records) {
    const { stack, needs, newSubstrates, skipped } = toRegistryRows(record, known);
    for (const name of newSubstrates) known.add(name); // one INSERT per new substrate across the file
    totals.stacks++; totals.needs += needs.length; totals.substrates += newSubstrates.length; totals.skipped += skipped.length;
    const c = record.coverage;
    blocks.push([
      `-- ${stack.stack_id} "${stack.name.replace(/\n/g, ' ')}": local coverage ${c.coverage} (${c.present} present, ${c.partial} partial, ${c.missing} missing of ${c.total}); proposal ${record.id}`,
      ...skipped.map(s => `-- skipped need (${s.why}): ${s.layer} ${s.kind} ${s.object}`),
      ...newSubstrates.map(name => `INSERT INTO public.stack_substrates (substrate, source, registered_by) VALUES (${lit(name)}, ${lit(stack.source)}, ${lit(REGISTERED_BY)}) ON CONFLICT (substrate) DO NOTHING;`),
      `INSERT INTO public.stacks (stack_id, version, name, question, path, external_dimensions, who_cares, scoring, status, source, registered_by)`,
      `VALUES (${lit(stack.stack_id)}, 1, ${lit(stack.name)}, ${lit(stack.question)}, ${arr(stack.path)}, ${stack.external_dimensions ? arr(stack.external_dimensions) : 'NULL'}, ${lit(stack.who_cares)}, ${lit(stack.scoring)}, 'proposed', ${lit(stack.source)}, ${lit(stack.registered_by)});`,
      `INSERT INTO public.stack_needs (stack_id, version, layer, kind, object) VALUES`,
      needs.map(n => `  (${lit(stack.stack_id)}, 1, ${lit(n.layer)}, ${lit(n.kind)}, ${lit(n.object)})`).join(',\n') + ';',
    ].join('\n'));
  }
  const header = [
    '-- Proposed stacks from the local generator. NOT APPLIED.',
    '-- The registry\'s writer is supabase/migrations (migration 20261007014500_stack_registry.sql, status vocabulary: proposed = registered, not reviewed).',
    '-- Review each stack; put the accepted statements in ONE migration file with its SCHEMA_LAW answers (one migration per commit).',
    '-- Coverage shown is the local measure, which mirrors stack_coverage() for tables and columns (scripts/stacks/check-registry-parity.mjs).',
    `-- ${totals.stacks} stack(s), ${totals.needs} need(s), ${totals.substrates} new substrate(s), ${totals.skipped} need(s) skipped.`,
    '',
    'BEGIN;',
    '',
  ].join('\n');
  return { sql: `${header}${blocks.join('\n\n')}\n\nCOMMIT;\n`, totals };
}

/** `--registry`: write the review SQL next to the run's other files. Never touches a database. */
export async function writeToRegistry(records, { runDir, registry } = {}) {
  if (!records.length) return { written: 0, note: 'no proposals to hand over' };
  const { sql, totals } = registrySql(records, registry);
  const file = join(runDir ?? '.', `registry-${records[0].run}.sql`);
  writeFileSync(file, sql);
  return {
    written: 0, sql_file: file, ...totals,
    note: `the registry has no runtime writer (its writer is supabase/migrations): wrote ${file} for review, nothing applied`,
  };
}
