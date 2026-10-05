// Deterministic comparisons of retained acceptance cases, never agent delivery
// verification or a causal explanation. Input digests are consistency checks,
// not authenticated signatures of the underlying evidence.
import { createHash } from 'node:crypto';

const HASH = value => createHash('sha256').update(canonical(value)).digest('hex');
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const CHECKS = ['vehicle', 'capture', 'episode', 'property', 'sourceRole', 'captureClock', 'sourceHeaderDigest'];
const KNOWN = new Set(['passed', 'failed']);
const canonical = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, normalize(value[k])]));
  return value;
}

export function buildCaseContract(doc) {
  if (!Array.isArray(doc?.requests) || !doc.requests.length || doc.requests.length > 50
    || doc.requests.some(r => !KEY.test(r?.key ?? '') || !KEY.test(r?.field ?? ''))
    || new Set(doc.requests.map(r => r.key)).size !== doc.requests.length) return null;
  const { asOf, requests, ...policy } = doc;
  const body = { version: 'source_case_contract_v1', policySha256: HASH(policy),
    members: requests.map(r => ({ key: r.key, field: r.field, requestSha256: HASH(r) }))
      .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) };
  return { ...body, sha256: HASH(body) };
}

function validContract(value) {
  if (value?.version !== 'source_case_contract_v1' || !DIGEST.test(value.policySha256 ?? '')
    || !DIGEST.test(value.sha256 ?? '') || !Array.isArray(value.members)
    || !value.members.length || value.members.length > 50
    || value.members.some(m => !KEY.test(m?.key ?? '') || !KEY.test(m?.field ?? '') || !DIGEST.test(m?.requestSha256 ?? ''))
    || new Set(value.members.map(m => m.key)).size !== value.members.length) return false;
  const { sha256, ...body } = value;
  return sha256 === HASH(body);
}

function readerCheck(item, name) {
  if (!['exposed', 'folded', 'linked', 'extracted_unresolved', 'conflict_withheld'].includes(item?.stage)
    || item.clocks?.observationState !== 'within_cutoff'
    || item.retention?.originalObservation !== true
    || item.requestedRelations?.checks?.vehicle !== 'passed'
    || item.reader?.foldAfterCutoff !== false || typeof item.reader?.[name] !== 'boolean') return 'unknown';
  return item.reader[name] ? 'passed' : 'failed';
}

export function compareModelSnapshots(before, after) {
  const result = { version: 'model_snapshot_comparison_v1', scope: 'fixed_source_case_acceptance',
    status: 'uncomparable', reasons: [], comparisons: [],
    counts: { improved: 0, regressed: 0, unchanged: 0, uncomparable: 0, coverageGained: 0 },
    causationEstablished: false, engineeringDeliveryVerified: false,
    limits: ['Only identical retained source-case acceptance checks are compared; no fleet or whole-model score.',
      'Changing cutoffs, external writers and source availability can change results; changes are not attributed to an agent.',
      'Job statuses lack bound assay population/policy identities; schema descriptions and agent activity are context only.',
      'Receipt fingerprints establish input consistency, not authenticity, source truth, or independently verified engineering delivery.'] };
  const block = reason => result.reasons.push(reason);
  try {
    if (before?.version !== 'data_model_coverage_v1' || after?.version !== before.version) {
      block('snapshot_contract_missing_or_changed'); return result;
    }
    const a = before.evidence?.caseContract, b = after.evidence?.caseContract;
    if (!validContract(a) || !validContract(b)) { block('case_fingerprint_missing_or_invalid'); return result; }
    if (a.sha256 !== b.sha256) { block('case_membership_or_policy_changed'); return result; }
    result.caseContractSha256 = a.sha256;
    for (const key of ['healthSQLSha256', 'jobHealthSQLSha256', 'reconciliationSQLSha256']) {
      if (!DIGEST.test(before.evidence[key] ?? '') || before.evidence[key] !== after.evidence[key]) block(`monitor_contract_changed:${key}`);
    }
    const hasScope = side => Array.isArray(side.database?.scope?.tables) && side.database.scope.tables.length
      && Array.isArray(side.database.scope.jobs) && side.database.scope.jobs.length;
    if (hasScope(before) && hasScope(after)
      && canonical(before.database.scope) !== canonical(after.database.scope)) block('database_scope_changed');
    const sourceA = before.sourceToReader, sourceB = after.sourceToReader;
    if (sourceA?.schemaVersion !== 'intake_reader_reconciliation_v1' || sourceB?.schemaVersion !== sourceA.schemaVersion) block('source_contract_missing_or_changed');
    for (const key of ['readerBasis', 'executionRole', 'scope']) {
      if (typeof sourceA?.[key] !== 'string' || !sourceA[key] || sourceA[key] !== sourceB?.[key]) block(`reader_policy_changed:${key}`);
    }
    if (result.reasons.length) return result;

    // Missing sections block any improvement verdict, while independently known
    // regressions in a retained case can still be reported below.
    if (!hasScope(before) || !hasScope(after)) block('database_scope_unavailable');
    for (const section of ['metadata', 'jobHealth', 'sourceToReader']) {
      const left = before.evidence.sections?.[section], right = after.evidence.sections?.[section];
      const expected = section === 'sourceToReader' ? 'returned' : 'measured';
      if (left?.status !== expected || right?.status !== expected) block(`section_unavailable:${section}`);
      const sqlKey = { metadata: 'healthSQLSha256', jobHealth: 'jobHealthSQLSha256', sourceToReader: 'reconciliationSQLSha256' }[section];
      if ((left?.status === expected && left.sqlSha256 !== before.evidence[sqlKey])
        || (right?.status === expected && right.sqlSha256 !== after.evidence[sqlKey])) {
        block(`section_contract_inconsistent:${section}`);
        if (section === 'sourceToReader') return result;
      }
      const times = [left?.startedAt, left?.completedAt, right?.startedAt, right?.completedAt].map(Date.parse);
      if (times.some(t => !Number.isFinite(t)) || times[1] < times[0] || times[2] < times[1] || times[3] < times[2]) {
        block(`section_clock_uncomparable:${section}`);
        // Source time ordering is required for either directional verdict.
        if (section === 'sourceToReader') return result;
      }
    }
    const cutoffA = Date.parse(sourceA.asOf), cutoffB = Date.parse(sourceB.asOf);
    result.cutoffs = { before: Number.isFinite(cutoffA) ? new Date(cutoffA).toISOString() : null,
      after: Number.isFinite(cutoffB) ? new Date(cutoffB).toISOString() : null };
    if (!Number.isFinite(cutoffA) || !Number.isFinite(cutoffB) || cutoffB < cutoffA
      || cutoffA !== Date.parse(before.evidence.sections?.sourceToReader?.cutoffAt)
      || cutoffB !== Date.parse(after.evidence.sections?.sourceToReader?.cutoffAt)) {
      block('case_cutoff_uncomparable'); return result;
    }

    function items(source, label, evidence) {
      if (source?.status !== 'measured_request_set' || evidence?.status !== 'returned'
        || !Array.isArray(source.items) || source.items.length > 50) { block(`source_read_unavailable:${label}`); return []; }
      if (source.requestedItems !== a.members.length || source.items.length !== a.members.length) block(`case_population_incomplete:${label}`);
      if (source.items.some(i => !a.members.some(m => m.key === i?.key && m.field === i?.field))) block(`case_population_changed:${label}`);
      return source.items;
    }
    const leftItems = items(sourceA, 'before', before.evidence.sections?.sourceToReader);
    const rightItems = items(sourceB, 'after', after.evidence.sections?.sourceToReader);
    function check(member, name, previous, current) {
      if (previous === 'not_requested' && current === 'not_requested') return;
      const known = KNOWN.has(previous) && KNOWN.has(current);
      const change = !known ? 'uncomparable' : previous === current ? 'unchanged' : current === 'passed' ? 'improved' : 'regressed';
      const coverageGained = !KNOWN.has(previous) && previous !== 'not_requested' && current === 'passed';
      result.counts[change]++;
      if (coverageGained) result.counts.coverageGained++;
      result.comparisons.push({ key: member.key, field: member.field, check: name,
        before: KNOWN.has(previous) || previous === 'not_requested' ? previous : 'unknown',
        after: KNOWN.has(current) || current === 'not_requested' ? current : 'unknown', change, coverageGained });
    }
    for (const member of a.members) {
      const left = leftItems.filter(i => i?.key === member.key && i.field === member.field);
      const right = rightItems.filter(i => i?.key === member.key && i.field === member.field);
      if (left.length !== 1 || right.length !== 1) {
        block(`case_missing_or_duplicated:${member.key}`); check(member, 'case_presence', 'unknown', 'unknown'); continue;
      }
      const x = left[0], y = right[0];
      if (x.requestedRelations?.basis !== 'explicit_requested_relations_only' || y.requestedRelations?.basis !== x.requestedRelations.basis) {
        block(`relation_policy_uncomparable:${member.key}`); check(member, 'relation_policy', 'unknown', 'unknown'); continue;
      }
      for (const name of CHECKS) check(member, `relation.${name}`, x.requestedRelations.checks?.[name], y.requestedRelations.checks?.[name]);
      for (const name of ['specsReference', 'specsValueCurrent']) check(member, `reader.${name}`, readerCheck(x, name), readerCheck(y, name));
    }
    result.reasons = [...new Set(result.reasons)];
    result.status = result.counts.regressed ? 'regressed' : result.reasons.length || result.counts.uncomparable ? 'uncomparable'
      : result.counts.improved ? 'improved' : 'unchanged';
    return result;
  } catch {
    block('snapshot_contract_invalid');
    result.status = result.counts.regressed ? 'regressed' : 'uncomparable';
    return result;
  }
}
