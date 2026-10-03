import { appendFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The former batch-analyze-all-images consumer has no verified deployment or
// persistence contract. This scheduled entrypoint therefore only reads a bounded
// pending-state sample. It must not redirect work to a paid or paused pipeline.
export const BUDGET = Object.freeze({
  candidate_rows: 50,
  candidate_queries: 1,
  query_ms: 10_000,
  run_ms: 15_000,
  processing_images: 0,
  batches: 0,
  retries: 0,
  hosted_calls: 0,
  hosted_spend_usd: 0,
});

function receipt() {
  return {
    schema_version: 1,
    status: 'failed',
    reason: 'preflight_not_completed',
    started_at: new Date().toISOString(),
    elapsed_ms: 0,
    budget: { ...BUDGET },
    scope: "vehicle_images.ai_processing_status = 'pending'; bounded state sample only",
    candidate_query_status: 'not_attempted',
    candidate_queries: 0,
    pending_sample_rows: null,
    sample_at_limit: null,
    remaining_unknown: true,
    // A pending state is neither an appraiser backlog nor processing eligibility.
    eligibility: 'not_evaluated',
    consumer: 'batch-analyze-all-images',
    consumer_status: 'unverified',
    persistence_status: 'not_attempted',
    processing_images: 0,
    batches: 0,
    retries: 0,
    hosted_calls: 0,
    confirmed_new_observations: 0,
    confirmed_new_witnesses: 0,
    confirmed_reader_visible_claims: 0,
  };
}

export function exitCode(result) {
  // No processing-success path exists until a reviewed consumer, bounded claims,
  // durable persistence verification and reader assay are wired into this owner.
  return result.status === 'blocked' ? 2 : 1;
}

export async function runImagePreflight(supabase, { queryMs = BUDGET.query_ms } = {}) {
  const result = receipt();
  const started = performance.now();
  if (!Number.isInteger(queryMs) || queryMs < 1 || queryMs > BUDGET.query_ms) {
    result.reason = 'invalid_time_budget';
    return result;
  }
  result.budget.query_ms = queryMs;
  const controller = new AbortController();
  let timer;
  try {
    result.candidate_queries = 1;
    result.candidate_query_status = 'started';
    const deadline = new Promise((resolveDeadline) => {
      timer = setTimeout(() => {
        controller.abort();
        resolveDeadline({ deadline: true });
      }, Math.min(queryMs, BUDGET.run_ms));
    });
    // Matches idx_vehicle_images_pending_processing(status, created_at).
    // No global exact count, JSON predicate, offsets, payload/image fetch or DML.
    const response = await Promise.race([
      supabase.from('vehicle_images')
        .select('id')
        .eq('ai_processing_status', 'pending')
        .order('created_at', { ascending: true })
        .limit(BUDGET.candidate_rows)
        .abortSignal(controller.signal),
      deadline,
    ]);

    if (response?.deadline || controller.signal.aborted) {
      result.reason = 'candidate_query_timeout';
      result.candidate_query_status = 'timeout';
    } else if (response?.error || response?.status >= 400) {
      result.reason = 'candidate_query_error';
      result.candidate_query_status = 'error';
    } else if (!Array.isArray(response?.data) || response.data.length > BUDGET.candidate_rows
      || response.data.some((row) => typeof row?.id !== 'string' || !row.id)
      || new Set(response.data.map((row) => row.id)).size !== response.data.length) {
      result.reason = 'candidate_response_invalid';
      result.candidate_query_status = 'invalid';
    } else {
      result.candidate_query_status = 'sampled';
      result.pending_sample_rows = response.data.length;
      result.sample_at_limit = response.data.length === BUDGET.candidate_rows;
      result.status = 'blocked';
      result.reason = 'consumer_contract_unverified';
      // An empty pending sample cannot establish all-image analysis completion,
      // source coverage, persistence, or the existence of the legacy consumer.
    }
  } catch {
    result.reason = controller.signal.aborted ? 'candidate_query_timeout' : 'candidate_query_rejected';
    result.candidate_query_status = controller.signal.aborted ? 'timeout' : 'error';
  } finally {
    clearTimeout(timer);
    controller.abort();
    result.elapsed_ms = Math.round(performance.now() - started);
  }
  return result;
}

export function stepSummary(result) {
  return [
    '## Image processing preflight',
    '',
    `- Outcome: ${result.status} (${result.reason}).`,
    `- Pending-state sample: ${result.pending_sample_rows ?? 'unknown'} / ${result.budget.candidate_rows} row cap; at cap: ${result.sample_at_limit ?? 'unknown'}.`,
    '- Scope: pending state only; appraiser backlog, eligibility and corpus completion remain unknown.',
    `- Consumer: ${result.consumer_status}; persistence: ${result.persistence_status}.`,
    `- Processing images / batches / retries / hosted calls: ${result.processing_images} / ${result.batches} / ${result.retries} / ${result.hosted_calls}.`,
    '- No processing consumer is called. Restore operation only through a reviewed deployed consumer with durable output and reader verification.',
    '',
  ].join('\n');
}

async function main() {
  let result = receipt();
  try {
    const { default: dotenv } = await import('dotenv');
    dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '../.env.local'), quiet: true });
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      result.reason = 'missing_database_configuration';
    } else {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      result = await runImagePreflight(supabase);
    }
  } catch {
    // Never print SDK exceptions: they can include URLs, payloads or credentials.
    result.reason = 'preflight_initialization_failed';
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, stepSummary(result));
    } catch {
      result.status = 'failed';
      result.reporting_error = 'summary_write_failed';
    }
  }
  console.log(JSON.stringify(result));
  process.exitCode = exitCode(result);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
