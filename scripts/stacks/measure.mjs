#!/usr/bin/env node
/**
 * measure.mjs: how close is the live data model to a proposed stack?
 *
 * Each need of a proposal is resolved against the atlas pull (read-only; one pull per run, cached in the run folder).
 * The rules for tables and columns mirror public.stack_coverage() of the stack registry (migration 20261007014500), so a
 * proposal's local number is the number the registry will report once the stack is registered:
 *   table   a base table in v_schema_atlas. present: est_rows > 0 (and, at fold, baseline, residual, feature and prediction,
 *           an owner in pipeline_registry). partial: no rows by the planner estimate, or no owner. missing: no such table
 *           (views and materialized views are not tables to the registry). A singular or plural spelling of a name counts.
 *   column  table.column. fill = 1 - null_frac from pg_stats, over the fill of a named denominator column when there is
 *           one. present: fill >= 0.9, and at the key layer a foreign key on the column. partial: the column exists with
 *           a lower fill, no statistics, or a key with no foreign key. missing: no such column.
 *   dimension or source (a phrase; the registry calls these abstract needs). The registry's own substrates come first: a
 *           phrase that names one is measured as the table declared for it, and is missing while none is declared. Without a
 *           substrate: an exact table is measured as a table; a column of that name filled to 0.9 somewhere is present, a
 *           thinner one partial; words that match a pipeline_registry row, a table purpose or a table or column name are
 *           partial; else missing. These last steps are this generator's own heuristics, not registry rules.
 * Coverage = present / needs, as in the registry. coverage_with_partial = (present + partial) / needs is an upper bound.
 * The generator's needs are only what a stack stands on (log, key, dimension, outcome); its own fold, baseline, residual,
 * feature and prediction are what it builds and are never needs (the registry seeds none either).
 * Deterministic: same atlas, same verdicts. No network, no model. check-registry-parity.mjs compares this file's verdicts
 * with the live stack_coverage() output.
 *
 *   node scripts/stacks/measure.mjs --in proposals.json|proposals.jsonl [--run-dir DIR] [--atlas FILE] [--out FILE] [--registry]
 *   (--registry writes a migration-ready promote/<name>.sql per proposal; nothing is applied)
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LAYERS, validateProposal } from './lib/grammar.mjs';
import { LOG_ROOT, ensureDir, nameKey, singular, tokens, utcStamp } from './lib/common.mjs';
import { atlasMeta, loadAtlas, loadRegistry } from './lib/atlas.mjs';
import { appendRecords, proposalsDir, writeIndex } from './lib/output.mjs';
import { sharedWith, stackIdFor, writeToRegistry } from './lib/registry.mjs';

export const MEASURE_VERSION = 3;
export const FILL_BAR = 0.9; // stack_coverage: a column is present from this fill up
const DERIVED_LAYERS = new Set(['fold', 'baseline', 'residual', 'feature', 'prediction']);
const PARTIAL_SOURCES = ['purpose', 'registry', 'table_name', 'column_name'];
const GENERIC_COLUMNS = new Set(['id', 'uuid', 'created_at', 'updated_at', 'deleted_at', 'metadata', 'data', 'raw_data']);
const KIND_NAMES = { r: 'table', p: 'partitioned table', v: 'view', m: 'materialized view', f: 'foreign table' };

const snake = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const singularIdent = name => {
  const parts = name.split('_');
  parts[parts.length - 1] = singular(parts[parts.length - 1]);
  return parts.join('_');
};
const round4 = x => Math.round(x * 10000) / 10000;
const compact = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

export function proposalId(name) {
  return `stk-${createHash('sha1').update(nameKey(name)).digest('hex').slice(0, 10)}`;
}

/** Substrate names carry structural words ("entity", "dimension") that a phrase may or may not repeat. */
const substrateTokens = text => {
  const t = tokens(String(text).replace(/_/g, ' '), { boilerplate: true });
  for (const w of ['entity', 'dimension', 'series']) if (t.size > 1) t.delete(w);
  return t;
};

/** Everything resolution needs, built once from the cached pull (and the registry's substrates when there are any). */
export function buildIndex(atlas, registry = { substrates: [] }) {
  const objects = new Map();
  const bySingular = new Map();
  const baseRows = new Map(atlas.atlas.map(r => [r.table_name, r]));
  const columnTables = new Map();
  const docs = [];
  const postings = new Map();
  const addDoc = (source, ref, tokenSet) => {
    if (!tokenSet.size) return;
    const i = docs.length;
    docs.push({ source, ref, tokens: tokenSet });
    for (const t of tokenSet) {
      if (!postings.has(t)) postings.set(t, new Set());
      postings.get(t).add(i);
    }
  };
  for (const o of atlas.objects) {
    const cols = o.cols ? o.cols.split(',') : [];
    objects.set(o.name, { kind: o.kind, cols: new Set(cols) });
    if (!bySingular.has(singularIdent(o.name))) bySingular.set(singularIdent(o.name), o.name);
    addDoc('table_name', o.name, tokens(o.name.replace(/_/g, ' '), { boilerplate: true }));
    for (const c of cols) {
      if (!columnTables.has(c)) columnTables.set(c, []);
      columnTables.get(c).push(o.name);
    }
  }
  for (const [c] of columnTables) addDoc('column_name', c, tokens(c.replace(/_/g, ' '), { boilerplate: true }));
  for (const r of atlas.atlas) addDoc('purpose', r.table_name, tokens(`${r.table_name.replace(/_/g, ' ')} ${r.purpose ?? ''}`, { boilerplate: true }));
  for (const r of atlas.registry) {
    addDoc('registry', r.column_name ? `${r.table_name}.${r.column_name}` : r.table_name, tokens(`${r.table_name} ${r.column_name} ${r.description ?? ''}`.replace(/_/g, ' '), { boilerplate: true }));
  }
  const fill = atlas.fill ?? {};
  const fks = new Map(Object.entries(atlas.fks ?? {}).map(([t, cols]) => [t, new Set(cols)]));
  const substrates = (registry.substrates ?? []).map(s => ({ name: s.substrate, declared: s.declared_table ?? null, tokens: substrateTokens(s.substrate) }));
  return { objects, bySingular, baseRows, columnTables, docs, postings, fill, fks, substrates };
}

function needTokens(text) {
  let t = tokens(String(text).replace(/_/g, ' '), { boilerplate: true });
  if (t.size > 1) t.delete('vehicle'); // the universe, not a distinguishing word
  if (t.size === 0) t = tokens(String(text).replace(/_/g, ' '));
  return t;
}

function tokenMatches(index, tokenSet, sources = PARTIAL_SOURCES) {
  const list = [...tokenSet];
  if (!list.length) return [];
  const required = list.length <= 2 ? list.length : Math.ceil((list.length * 2) / 3);
  const counts = new Map();
  for (const t of list) for (const i of index.postings.get(t) ?? []) counts.set(i, (counts.get(i) ?? 0) + 1);
  const hits = [];
  for (const [i, n] of counts) {
    const doc = index.docs[i];
    if (n >= required && sources.includes(doc.source)) hits.push({ doc, score: n / list.length });
  }
  return hits.sort((a, b) => b.score - a.score || a.doc.tokens.size - b.doc.tokens.size || a.doc.ref.localeCompare(b.doc.ref));
}

const describeHits = hits => hits.slice(0, 3).map(h => `${h.doc.source} ${h.doc.ref}`).join('; ');

/** A relation of any kind by exact or singular/plural name, or null. */
function existingRelation(index, name) {
  const key = String(name).toLowerCase();
  if (index.objects.has(key)) return key;
  return index.bySingular.get(singularIdent(key)) ?? null;
}

function tableVerdict(index, name, layer) {
  const row = index.baseRows.get(name);
  if (!row) {
    const rel = index.objects.get(name);
    return rel
      ? { verdict: 'missing', evidence: `public.${name} is a ${KIND_NAMES[rel.kind] ?? 'relation'}, not a base table (stack_coverage reads v_schema_atlas)` }
      : { verdict: 'missing', evidence: 'no such table' };
  }
  const rows = row.est_rows ?? 0;
  if (rows <= 0) return { verdict: 'partial', evidence: `public.${name} has no rows by the planner estimate`, resolved: name };
  if (DERIVED_LAYERS.has(layer) && (row.registry_fields ?? 0) === 0) {
    return { verdict: 'partial', evidence: `public.${name} has ${compact(rows)} rows but no owner declared in pipeline_registry`, resolved: name };
  }
  return { verdict: 'present', evidence: `public.${name}: ${compact(rows)} rows, ${row.activity}`, resolved: name };
}

function columnVerdict(index, table, column, layer, denominator) {
  const rel = existingRelation(index, table);
  if (!rel) return { verdict: 'missing', evidence: `no table ${table}` };
  const cols = index.objects.get(rel).cols;
  const col = [column, singular(column), `${column}s`].find(c => cols.has(c));
  if (!col) {
    const mine = tokens(column.replace(/_/g, ' '));
    const near = [...cols].filter(c => [...tokens(c.replace(/_/g, ' '))].some(t => mine.has(t))).slice(0, 3);
    return { verdict: 'missing', evidence: `table ${rel} exists, column ${column} does not${near.length ? `; nearby: ${near.join(', ')}` : ''}` };
  }
  const stats = index.fill[rel] ?? {};
  let value = stats[col] ?? null;
  let note = '';
  if (denominator) {
    const base = stats[denominator.split('.')[1]];
    value = value == null || base == null || base <= 0 ? null : round4(Math.min(1, value / base));
    note = ` over ${denominator}`;
  }
  const hasFk = index.fks.get(rel)?.has(col) ?? false;
  const where = `public.${rel}.${col}`;
  const resolved = `${rel}.${col}`;
  if (value == null) return { verdict: 'partial', evidence: `${where}: no planner statistics${denominator ? ' for the column or its denominator' : ''}`, resolved };
  if (value < FILL_BAR) return { verdict: 'partial', evidence: `${where}: filled ${value}${note}, below ${FILL_BAR}`, resolved };
  if (layer === 'key' && !hasFk) return { verdict: 'partial', evidence: `${where}: filled ${value}${note} but a key column with no foreign key`, resolved };
  return { verdict: 'present', evidence: `${where}: filled ${value}${note}${layer === 'key' ? ', foreign key' : ''}`, resolved };
}

/**
 * The registry substrate a phrase names, if any: the exact name, or the same words (one more or one fewer is fine once
 * two words are shared; a single shared word is not enough, "price type" is not "the price model").
 */
function matchSubstrate(index, phrase) {
  const exact = index.substrates.find(sub => sub.name.toLowerCase() === String(phrase).trim().toLowerCase());
  if (exact) return exact;
  const mine = substrateTokens(phrase);
  if (!mine.size) return null;
  let best = null;
  for (const sub of index.substrates) {
    const shared = [...mine].filter(t => sub.tokens.has(t)).length;
    if (!shared) continue;
    const union = mine.size + sub.tokens.size - shared;
    const small = Math.min(mine.size, sub.tokens.size);
    const large = Math.max(mine.size, sub.tokens.size);
    const score = shared / union;
    if ((score >= 0.6 || (shared === small && small >= 2 && large - small <= 1)) && (!best || score > best.score)) best = { sub, score };
  }
  return best?.sub ?? null;
}

function abstractVerdict(index, phrase, layer) {
  const sub = matchSubstrate(index, phrase);
  if (sub) {
    if (!sub.declared) return { verdict: 'missing', evidence: `registry substrate "${sub.name}": no table declared for it`, substrate: sub.name };
    const t = tableVerdict(index, sub.declared, layer);
    return { ...t, evidence: `registry substrate "${sub.name}" declared as ${sub.declared}: ${t.evidence}`, substrate: sub.name };
  }
  const ident = snake(phrase);
  const table = ident ? existingRelation(index, ident) : null;
  if (table && index.baseRows.has(table)) return { ...tableVerdict(index, table, layer), };
  const column = [ident, singular(ident), `${ident}s`].find(c => index.columnTables.has(c) && !GENERIC_COLUMNS.has(c));
  if (column) {
    const holders = index.columnTables.get(column);
    const best = holders.map(t => ({ t, f: index.fill[t]?.[column] ?? -1 })).filter(x => index.baseRows.has(x.t)).sort((a, b) => b.f - a.f)[0];
    if (best) {
      const verdict = best.f >= FILL_BAR ? 'present' : 'partial';
      return { verdict, evidence: `column ${column} in ${holders.length} relation(s); fullest in ${best.t}${best.f >= 0 ? ` (filled ${best.f})` : ' (no statistics)'}`, resolved: `${best.t}.${column}` };
    }
  }
  const hits = tokenMatches(index, needTokens(phrase));
  return hits.length
    ? { verdict: 'partial', evidence: `related: ${describeHits(hits)}` }
    : { verdict: 'missing', evidence: 'no substrate, table, column, purpose or registry row matches' };
}

export function resolveNeed(index, need) {
  const { kind, object, layer } = need;
  if (kind === 'table') {
    const found = existingRelation(index, object);
    return found ? tableVerdict(index, found, layer) : { verdict: 'missing', evidence: 'no such table' };
  }
  if (kind === 'column') {
    const [table, column] = object.split('.');
    return columnVerdict(index, table, column, layer, need.denominator);
  }
  return abstractVerdict(index, object, layer);
}

export function measureNeeds(index, needs) {
  const verdicts = needs.map(n => ({ layer: n.layer, kind: n.kind, object: n.object, ...resolveNeed(index, n) }));
  const count = v => verdicts.filter(x => x.verdict === v).length;
  const total = verdicts.length;
  const present = count('present'), partial = count('partial'), missing = count('missing');
  const byLayer = {};
  for (const layer of LAYERS) {
    const mine = verdicts.filter(v => v.layer === layer);
    if (mine.length) byLayer[layer] = { present: mine.filter(v => v.verdict === 'present').length, partial: mine.filter(v => v.verdict === 'partial').length, missing: mine.filter(v => v.verdict === 'missing').length };
  }
  const round = x => Math.round(x * 1000) / 1000;
  return {
    verdicts,
    coverage: { present, partial, missing, total, coverage: total ? round(present / total) : 0, coverage_with_partial: total ? round((present + partial) / total) : 0 },
    by_layer: byLayer,
  };
}

/** One JSONL line: the proposal, its verdicts and coverage, and where it came from. */
export function buildRecord({ proposal, asker, run, proposedAt, measuredAt, atlas, measured, registry = {} }) {
  const { dropped_needs: dropped, ...definition } = proposal;
  const shares = sharedWith(measured.verdicts, registry); // registered stacks that already need the same table, column or substrate
  return {
    schema: 'stack-proposal/1',
    id: proposalId(definition.name),
    registry_stack_id: stackIdFor(definition.name),
    name: definition.name,
    run,
    proposed_at: proposedAt,
    measured_at: measuredAt,
    status: 'proposed',
    asker,
    proposal: definition,
    ...(dropped?.length ? { dropped_needs: dropped } : {}),
    needs: measured.verdicts,
    coverage: measured.coverage,
    by_layer: measured.by_layer,
    shares,
    shares_with: [...new Set(shares.flatMap(sh => sh.stacks.map(t => t.stack_id)))].sort(),
    atlas: atlasMeta(atlas),
    measure_version: MEASURE_VERSION,
  };
}

// ---- CLI ---------------------------------------------------------------------------------------
function readProposals(path) {
  const text = readFileSync(path, 'utf8').trim();
  const rows = text.startsWith('[') ? JSON.parse(text) : text.split('\n').filter(Boolean).map(l => JSON.parse(l));
  return rows.map(r => ({ proposal: r.proposal ?? r, asker: r.asker, proposed_at: r.proposed_at }));
}

function parseArgs(argv) {
  const opts = { registry: false, index: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--registry') opts.registry = true;
    else if (a === '--no-index') opts.index = false;
    else if (['--in', '--run-dir', '--atlas', '--out', '--log-dir'].includes(a)) opts[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help || !opts.in) {
    console.log('usage: node scripts/stacks/measure.mjs --in proposals.json|proposals.jsonl [--run-dir DIR] [--atlas atlas.json] [--out FILE] [--log-dir DIR] [--registry] [--no-index]');
    return opts.help ? 0 : 2;
  }
  const run = utcStamp();
  const logRoot = opts.logDir ? resolve(opts.logDir) : LOG_ROOT;
  const runDir = ensureDir(opts.runDir ? resolve(opts.runDir) : join(logRoot, 'runs', run));
  const atlas = opts.atlas ? JSON.parse(readFileSync(resolve(opts.atlas), 'utf8')) : await loadAtlas({ runDir });
  const registry = await loadRegistry({ runDir });
  const index = buildIndex(atlas, registry);
  const outFile = opts.out ? resolve(opts.out) : join(proposalsDir(logRoot), `${run}.jsonl`);
  const records = [];
  for (const row of readProposals(resolve(opts.in))) {
    const checked = validateProposal(row.proposal);
    if (!checked.ok) { console.error(`skipped (${row.proposal?.name ?? 'unnamed'}): ${checked.errors.slice(0, 3).join('; ')}`); continue; }
    records.push(buildRecord({
      proposal: checked.value, asker: row.asker ?? { via: 'measure.mjs', model: null }, run,
      proposedAt: row.proposed_at ?? new Date().toISOString(), measuredAt: new Date().toISOString(), atlas, measured: measureNeeds(index, checked.value.needs), registry,
    }));
  }
  appendRecords(outFile, records);
  console.log(`measured ${records.length} proposal(s) -> ${outFile}`);
  for (const r of records) console.log(`  ${(100 * r.coverage.coverage).toFixed(0).padStart(3)}%  ${r.coverage.present}/${r.coverage.partial}/${r.coverage.missing}  ${r.name}`);
  if (opts.index && records.length) console.log(`index: ${writeIndex(logRoot).path}`);
  if (opts.registry) console.log(JSON.stringify(await writeToRegistry(records, { logRoot, registry })));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }, error => { console.error(`measure: ${error.message}`); process.exitCode = 1; });
}
