#!/usr/bin/env node
// Read-only operational receipt. Run with the existing project environment loaded.
// node scripts/audit-comment-growth.mjs <vehicle UUID> <receipt.json>
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const [vehicleId, destination] = process.argv.slice(2);
if (!/^[0-9a-f-]{36}$/i.test(vehicleId ?? '') || !destination) throw new Error('vehicle UUID and receipt path required');
const db = createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const read = async (query) => {
  const result = await query.abortSignal(AbortSignal.timeout(15000));
  if (result.error) throw new Error(result.error.message);
  return result.data;
};
const comments = await read(db.from('auction_comments')
  .select('id,vehicle_id,auction_event_id,posted_at,comment_text,comment_type,is_seller,bid_amount,source_url')
  .eq('vehicle_id', vehicleId).order('posted_at', { ascending: false }).limit(500));
if (!comments.length || comments.length === 500) throw new Error('source population empty or exceeds bounded assay');
const ids = comments.map(c => c.id);
const [queue, progress, observations, reader] = await Promise.all([
  read(db.from('derivation_queue').select('id,evidence_id,status,attempts,max_attempts,observation_ids,queue_budget_reserved_at,cost_cents,credential_source,created_at,completed_at,error_message,next_attempt_at')
    .eq('extractor_slug', 'comment-refinery-atoms-v1').in('evidence_id', ids)),
  read(db.from('comment_claims_progress').select('comment_id,llm_processed,extraction_version,claims_extracted,observation_ids,processed_at,extraction_result')
    .in('comment_id', ids)),
  read(db.from('vehicle_observations').select('id,vehicle_id,source_comment_id,source_identifier,content_text,observed_at,ingested_at,confidence_score,structured_data')
    .eq('vehicle_id', vehicleId).not('source_comment_id', 'is', null).limit(1000)),
  read(db.rpc('popup_vehicle_intel', { p_vehicle_id: vehicleId })),
]);
if (observations.length === 1000) throw new Error('atom population exceeds bounded assay');
const sourceById = new Map(comments.map(c => [c.id, c]));
const observationById = new Map(observations.map(o => [o.id, o]));
const badAtoms = observations.filter(o => {
  const c = sourceById.get(o.source_comment_id);
  return !c || c.vehicle_id !== o.vehicle_id || !c.auction_event_id ||
    !o.content_text || !c.comment_text.includes(o.content_text) ||
    Date.parse(o.observed_at) !== Date.parse(c.posted_at) ||
    !Number.isFinite(o.confidence_score) || o.confidence_score < 0 || o.confidence_score > .6 ||
    o.structured_data?.is_inferred !== true;
});
const complete = progress.filter(p => p.llm_processed && p.extraction_version === 'public_comment_atoms_v1');
const badCompletions = complete.filter(p => !Array.isArray(p.observation_ids) ||
  p.claims_extracted !== p.observation_ids.length ||
  p.observation_ids.some(id => observationById.get(id)?.source_comment_id !== p.comment_id));
const badDone = queue.filter(q => {
  if (q.status !== 'done') return false;
  const p = complete.find(p => p.comment_id === q.evidence_id);
  return !p || !Array.isArray(q.observation_ids) || !Array.isArray(p.observation_ids) ||
    q.observation_ids.length !== p.observation_ids.length ||
    new Set(q.observation_ids).size !== q.observation_ids.length ||
    p.observation_ids.some(id => !q.observation_ids.includes(id)) ||
    q.observation_ids.some(id => observationById.get(id)?.source_comment_id !== q.evidence_id);
});
const readerAtoms = reader?.comment_evidence?.atoms ?? [];
const badReaderAtoms = readerAtoms.filter(a => observationById.get(a.observation_id)?.source_comment_id !== a.source_comment_id);
const countBy = (rows, field) => rows.reduce((counts, row) => {
  const key = String(field(row)); counts[key] = (counts[key] ?? 0) + 1; return counts;
}, {});
const summary = {
  source_comments_and_bids: comments.length,
  nonbid_comments: comments.filter(c => c.bid_amount == null && c.comment_type !== 'bid').length,
  queue: countBy(queue, q => q.status),
  model_receipts: progress.filter(p => p.extraction_result != null).length,
  model_cost_cents: progress.reduce((n, p) => n + (Number(p.extraction_result?.cost_cents) || 0), 0),
  reserved_calls: queue.filter(q => q.queue_budget_reserved_at).length,
  completed_sources: complete.length,
  canonical_atoms: observations.length,
  reader_atoms: reader?.comment_evidence?.atoms_returned ?? null,
  statement_kinds: countBy(observations, o => o.structured_data?.statement_kind),
  epistemic_status: countBy(observations, o => o.structured_data?.epistemic_status),
  action_status: countBy(observations, o => o.structured_data?.action_status),
  broken_atom_links_or_qualification: badAtoms.length,
  false_progress_completions: badCompletions.length,
  false_queue_completions: badDone.length,
  broken_reader_links: badReaderAtoms.length,
  duplicate_atom_identities: observations.length - new Set(observations.map(o => o.source_identifier)).size,
};
const receipt = { checked_at: new Date().toISOString(), vehicle_id: vehicleId, summary,
  queue, progress: progress.map(({ extraction_result: r, ...p }) => ({ ...p,
    model_receipt: r ? { model: r.model, source_hash: r.source_hash, input_tokens: r.input_tokens,
      output_tokens: r.output_tokens, cost_cents: r.cost_cents, recorded_at: r.recorded_at } : null })),
  observations, reader_evidence: reader?.comment_evidence ?? null };
writeFileSync(destination, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ checked_at: receipt.checked_at, ...summary }, null, 2));
if (badAtoms.length || badCompletions.length || badDone.length || badReaderAtoms.length) process.exitCode = 1;
