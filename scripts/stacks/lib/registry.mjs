// The hook to the stack registry (public.stacks, public.stack_needs, public.stack_substrates; migration
// 20261007014500_stack_registry.sql, merged in #721, live 2026-10-07).
//
// The registry has no writer function. Its tables are append-only (vein_append_only) and carry service_role SELECT and nothing
// else, so rows arrive only through a reviewed migration file under SCHEMA_LAW. The generator therefore never writes the
// registry. It keeps proposals in the JSONL and INDEX.md as `proposed`, and when a reviewer chooses one (promote.mjs, or
// `--registry` on a run) it emits the migration-ready INSERT text for that proposal into promote/<name>.sql: no BEGIN or COMMIT,
// so the statements paste into a migration that has its own. Every object is checked against the registry's CHECK constraints,
// and the file cites which registered stacks already need the same table, column or substrate.
//
// Kinds map as follows: table and column stay. A dimension or source phrase becomes an abstract need named after the registry
// substrate it matches; or the column or table it resolved to, when it is just an existing one; or, when it is neither, a new
// stack_substrates row (no table declared) that a migration may declare later.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAYERS } from './grammar.mjs';
import { duplicateOf, nameKey } from './common.mjs';

const ID_FORM = /^S[0-9A-Z]+$/;
const TABLE_FORM = /^[a-z_][a-z0-9_]*$/;
const COLUMN_FORM = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;
const REGISTERED_BY = 'stack-generator (local)';

/** SG plus eight hex capitals of the name's hash: stable for one name, in the registry's S[0-9A-Z]+ form, clear of S01-S60 and SA-SD. */
export function stackIdFor(name) {
  return `SG${createHash('sha1').update(nameKey(name)).digest('hex').slice(0, 8).toUpperCase()}`;
}

/** The lowest unused number in the ledger's S01-style numbering (S61 once S01 to S60 are taken), as a suggestion for whoever promotes a stack. */
export function nextFreeStackId(registry = { stacks: [] }) {
  const taken = new Set((registry.stacks ?? []).map(s => /^S(\d+)$/.exec(s.stack_id)).filter(Boolean).map(m => Number(m[1])));
  let n = 1;
  while (taken.has(n)) n++;
  return `S${String(n).padStart(2, '0')}`;
}

export function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'stack';
}

const lit = text => `'${String(text).replace(/[\u0000-\u001f]/g, ' ').replace(/'/g, "''")}'`;
const arr = list => `ARRAY[${list.map(lit).join(', ')}]::text[]`;

/** One measured verdict -> the registry need it would be (layer, kind, object), or a reason it cannot be expressed. */
export function toRegistryNeed(v) {
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
  return LAYERS.includes(need.layer) && formOk ? need : { ...need, invalid: true };
}

/** Registered stacks that already need the same table, column or substrate as one of these verdicts. */
export function sharedWith(verdicts, registry = { stacks: [], needs: [] }) {
  const byObject = new Map();
  for (const n of registry.needs ?? []) {
    const key = `${n.kind}|${String(n.object).toLowerCase()}`;
    if (!byObject.has(key)) byObject.set(key, new Set());
    byObject.get(key).add(n.stack_id);
  }
  const info = new Map((registry.stacks ?? []).map(s => [s.stack_id, s]));
  const out = [];
  for (const v of verdicts) {
    const need = toRegistryNeed(v);
    if (need.invalid) continue;
    const ids = [...(byObject.get(`${need.kind}|${need.object.toLowerCase()}`) ?? [])].sort();
    if (!ids.length) continue;
    out.push({ layer: need.layer, kind: need.kind, object: need.object,
      stacks: ids.map(id => ({ stack_id: id, name: info.get(id)?.name ?? null, coverage: info.get(id)?.coverage == null ? null : Number(info.get(id).coverage) })) });
  }
  return out;
}

/** One measured record -> the registry rows it would become, plus anything that could not be expressed. */
export function toRegistryRows(record, registry = { substrates: [] }, { stackId } = {}) {
  const known = new Set((registry.substrates ?? []).map(s => s.substrate));
  const id = stackId ?? stackIdFor(record.name);
  const skipped = [];
  const seen = new Set();
  const needs = [];
  const newSubstrates = [];
  for (const v of record.needs) {
    const need = toRegistryNeed(v);
    if (need.invalid) { skipped.push({ ...need, why: 'does not fit the registry constraints' }); continue; }
    const key = `${need.layer}|${need.object}`; // stack_needs is keyed by stack, version, layer and object
    if (seen.has(key)) continue;
    seen.add(key);
    needs.push(need);
    if (need.kind === 'abstract' && !known.has(need.object) && !newSubstrates.includes(need.object)) newSubstrates.push(need.object);
  }
  const p = record.proposal;
  const stack = {
    stack_id: id, version: 1, name: p.name, question: p.question,
    path: LAYERS.map(layer => `${layer}: ${p.layers[layer]}`),
    external_dimensions: p.external_dimensions.length ? p.external_dimensions : null,
    who_cares: p.who_cares, scoring: p.score_rule, status: 'proposed',
    source: `local stack generator run ${record.run} (${record.asker?.via} ${record.asker?.model})`,
    registered_by: REGISTERED_BY,
  };
  return { stack, needs, newSubstrates, skipped };
}

/**
 * The promotion file for one chosen proposal: INSERTs in dependency order (a new substrate, the stack, its needs), as comments
 * and statements, no transaction control. Refuses a name the registry already holds and an id that is taken or malformed.
 * @returns {{refused: string} | {sql: string, stack_id: string, totals: object, shares: object[]}}
 */
export function promotionSql(record, registry = { stacks: [], needs: [], substrates: [] }, { stackId } = {}) {
  if (stackId !== undefined && !ID_FORM.test(stackId)) return { refused: `stack id ${stackId} is not in the registry's S[0-9A-Z]+ form` };
  const same = duplicateOf(record.name, registry.stacks ?? []);
  if (same) return { refused: `the registry already holds "${same.name}" (${same.stack_id}), the same stack by name` };
  const { stack, needs, newSubstrates, skipped } = toRegistryRows(record, registry, { stackId });
  if ((registry.stacks ?? []).some(s => s.stack_id === stack.stack_id)) return { refused: `stack id ${stack.stack_id} is already taken in the registry` };
  const shares = sharedWith(record.needs, registry);
  const c = record.coverage;
  const lines = [
    `-- PROMOTION CANDIDATE, NOT APPLIED. "${stack.name.replace(/\s+/g, ' ')}", proposal ${record.id} of generator run ${record.run}.`,
    `-- Stack id ${stack.stack_id} is the generator's. The ledger's next free number is ${nextFreeStackId(registry)}: pass --stack-id to promote.mjs to use it.`,
    `-- Local coverage ${c.coverage} (${c.present} present, ${c.partial} partial, ${c.missing} missing of ${c.total}), measured ${record.measured_at}; after the migration stack_coverage('${stack.stack_id}') is the registry's own number.`,
    '-- The registry is append-only and written only by migrations (service_role SELECT, no writer function): paste these statements into ONE migration',
    '-- file with its SCHEMA_LAW answers. status is proposed (registered, not reviewed); the reviewer may raise it to measured.',
    ...(shares.length ? ['-- Already needed by registered stacks (coverage from v_stacks at generation time):',
      ...shares.map(sh => `--   ${sh.layer} ${sh.kind} ${sh.object}: ${sh.stacks.map(t => `${t.stack_id}${t.coverage == null ? '' : ` (${t.coverage})`}`).join(', ')}`)]
      : ['-- No registered stack needs any of the same tables, columns or substrates.']),
    ...skipped.map(s => `-- skipped need (${s.why}): ${s.layer} ${s.kind} ${s.object}`),
    ...newSubstrates.map(name => `INSERT INTO public.stack_substrates (substrate, source, registered_by) VALUES (${lit(name)}, ${lit(stack.source)}, ${lit(REGISTERED_BY)}) ON CONFLICT (substrate) DO NOTHING;`),
    'INSERT INTO public.stacks (stack_id, version, name, question, path, external_dimensions, who_cares, scoring, status, source, registered_by)',
    `VALUES (${lit(stack.stack_id)}, 1, ${lit(stack.name)}, ${lit(stack.question)}, ${arr(stack.path)}, ${stack.external_dimensions ? arr(stack.external_dimensions) : 'NULL'}, ${lit(stack.who_cares)}, ${lit(stack.scoring)}, 'proposed', ${lit(stack.source)}, ${lit(stack.registered_by)});`,
    'INSERT INTO public.stack_needs (stack_id, version, layer, kind, object) VALUES',
    needs.map(n => `  (${lit(stack.stack_id)}, 1, ${lit(n.layer)}, ${lit(n.kind)}, ${lit(n.object)})`).join(',\n') + ';',
    '',
  ];
  return { sql: lines.join('\n'), stack_id: stack.stack_id, shares, totals: { needs: needs.length, substrates: newSubstrates.length, skipped: skipped.length } };
}

/** Write one promotion file into `dir` as <slug of the name>.sql; the content follows the registry as read now. */
export function writePromotion(record, registry, { dir, stackId } = {}) {
  const built = promotionSql(record, registry, { stackId });
  if (built.refused) return { name: record.name, refused: built.refused };
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slugify(record.name)}.sql`);
  writeFileSync(file, built.sql);
  return { name: record.name, file, stack_id: built.stack_id, ...built.totals, shares: built.shares.length };
}

/** `--registry`: one promotion file per proposal of the run, in <logRoot>/promote. Never touches a database. */
export async function writeToRegistry(records, { logRoot, registry } = {}) {
  if (!records.length) return { written: 0, note: 'no proposals to hand over' };
  const dir = join(logRoot ?? '.', 'promote');
  const results = records.map(r => writePromotion(r, registry, { dir }));
  const files = results.filter(r => r.file);
  return {
    written: 0, dir, files: files.map(f => f.file), skipped: results.filter(r => r.refused).map(r => ({ name: r.name, why: r.refused })),
    note: `the registry has no writer function (migrations only): wrote ${files.length} migration-ready file(s) to ${dir} for review, nothing applied`,
  };
}
