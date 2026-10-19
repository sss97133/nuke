/**
 * Extraction Metrics Logger
 *
 * Logs per-invocation success/failure, latency, and error types to the
 * extraction_metrics table. Used by continuous-queue-processor and
 * individual extractors.
 *
 * Usage (in an extractor or queue processor):
 *
 *   import { ExtractionMetricsLogger } from "../_shared/extractionMetrics.ts";
 *
 *   const metrics = new ExtractionMetricsLogger(supabase, {
 *     runId: workerId,
 *     extractor: "extract-bat-core",
 *     source: "bat",
 *   });
 *
 *   const timer = metrics.startItem();
 *   try {
 *     // ... do extraction ...
 *     metrics.recordSuccess(timer, { sourceUrl: url, vehicleId: id });
 *   } catch (e) {
 *     metrics.recordFailure(timer, e, { sourceUrl: url });
 *   }
 *
 *   await metrics.flush();  // batch insert to DB (non-blocking in cqp)
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExtractionErrorType =
  | "rate_limited"
  | "blocked"
  | "redirect"
  | "timeout"
  | "invalid_page"
  | "duplicate"
  | "missing_fields"
  | "parse_error"
  | "http_error"
  | "extraction_failed"
  | "unknown";

export interface MetricRecord {
  extractor_name: string;
  source?: string;
  run_id: string;
  source_url?: string;
  vehicle_id?: string;
  success: boolean;
  latency_ms?: number;
  error_type?: ExtractionErrorType;
  error_message?: string;
  http_status?: number;
  created_at: string;
}

export interface ItemTimer {
  startMs: number;
}

export interface ExtractionMetricsConfig {
  /** A unique identifier for this run/invocation (e.g. workerId) */
  runId: string;
  /** The extractor function name, e.g. 'extract-bat-core' */
  extractor: string;
  /** The source name, e.g. 'bat', 'mecum' */
  source?: string;
}

// ─── Error categorization ────────────────────────────────────────────────────

export function categorizeError(err: string | Error | unknown): ExtractionErrorType {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/RATE_LIMITED|429|rate.?limit/i.test(msg)) return "rate_limited";
  if (/BLOCKED|403|cloudflare|bot.?detect/i.test(msg)) return "blocked";
  if (/REDIRECT/i.test(msg)) return "redirect";
  if (/timeout|TIMEOUT|timed.?out/i.test(msg)) return "timeout";
  if (/INVALID_PAGE/i.test(msg)) return "invalid_page";
  if (/duplicate.?key/i.test(msg)) return "duplicate";
  if (/Missing required|required.?field/i.test(msg)) return "missing_fields";
  if (/parse|Parse|JSON|syntax/i.test(msg)) return "parse_error";
  if (/HTTP [45]\d\d/i.test(msg)) return "http_error";
  if (/extraction.?failed|Extraction.?Failed/i.test(msg)) return "extraction_failed";
  return "unknown";
}

// ─── Logger class ────────────────────────────────────────────────────────────

export class ExtractionMetricsLogger {
  private supabase: SupabaseClient;
  private config: ExtractionMetricsConfig;
  private buffer: MetricRecord[] = [];

  constructor(supabase: SupabaseClient, config: ExtractionMetricsConfig) {
    this.supabase = supabase;
    this.config = config;
  }

  /** Start timing an item. Returns a timer handle. */
  startItem(): ItemTimer {
    return { startMs: Date.now() };
  }

  /** Record a successful extraction. */
  recordSuccess(
    timer: ItemTimer,
    opts: { sourceUrl?: string; vehicleId?: string } = {}
  ): void {
    this.buffer.push({
      extractor_name: this.config.extractor,
      source: this.config.source,
      run_id: this.config.runId,
      source_url: opts.sourceUrl,
      vehicle_id: opts.vehicleId,
      success: true,
      latency_ms: Date.now() - timer.startMs,
      created_at: new Date().toISOString(),
    });
  }

  /** Record a failed extraction. */
  recordFailure(
    timer: ItemTimer,
    err: unknown,
    opts: { sourceUrl?: string; httpStatus?: number } = {}
  ): void {
    const errorType = categorizeError(err);
    const errorMessage = err instanceof Error
      ? err.message.slice(0, 500)
      : String(err ?? "").slice(0, 500);

    this.buffer.push({
      extractor_name: this.config.extractor,
      source: this.config.source,
      run_id: this.config.runId,
      source_url: opts.sourceUrl,
      success: false,
      latency_ms: Date.now() - timer.startMs,
      error_type: errorType,
      error_message: errorMessage,
      http_status: opts.httpStatus,
      created_at: new Date().toISOString(),
    });
  }

  /** Number of records buffered but not yet flushed. */
  get bufferedCount(): number {
    return this.buffer.length;
  }

  /** Get a quick summary of buffered records. */
  getSummary(): { total: number; succeeded: number; failed: number; errorTypes: Record<string, number> } {
    const succeeded = this.buffer.filter(r => r.success).length;
    const errorTypes: Record<string, number> = {};
    for (const r of this.buffer) {
      if (r.error_type) {
        errorTypes[r.error_type] = (errorTypes[r.error_type] ?? 0) + 1;
      }
    }
    return { total: this.buffer.length, succeeded, failed: this.buffer.length - succeeded, errorTypes };
  }

  /**
   * Flush buffered records to the database.
   * Errors are logged but not thrown — metrics should never crash an extractor.
   */
  async flush(): Promise<{ inserted: number; error?: string }> {
    if (this.buffer.length === 0) return { inserted: 0 };

    const toInsert = [...this.buffer];
    this.buffer = [];

    try {
      const { error } = await this.supabase
        .from("extraction_metrics")
        .insert(toInsert);

      if (error) {
        console.error("[extractionMetrics] flush error:", error.message);
        return { inserted: 0, error: error.message };
      }

      return { inserted: toInsert.length };
    } catch (e: any) {
      console.error("[extractionMetrics] flush exception:", e?.message ?? e);
      return { inserted: 0, error: e?.message ?? String(e) };
    }
  }
}

// ─── Quick helper ────────────────────────────────────────────────────────────

/**
 * Log a single extraction result without instantiating the full class.
 * Useful for standalone extractor functions.
 */
export async function logExtractionMetric(
  supabase: SupabaseClient,
  opts: {
    extractor: string;
    source?: string;
    runId?: string;
    sourceUrl?: string;
    vehicleId?: string;
    success: boolean;
    latencyMs?: number;
    error?: unknown;
    httpStatus?: number;
  }
): Promise<void> {
  const errorType = !opts.success && opts.error
    ? categorizeError(opts.error)
    : undefined;
  const errorMessage = !opts.success && opts.error
    ? (opts.error instanceof Error ? opts.error.message : String(opts.error)).slice(0, 500)
    : undefined;

  try {
    await supabase.from("extraction_metrics").insert({
      extractor_name: opts.extractor,
      source: opts.source,
      run_id: opts.runId ?? crypto.randomUUID(),
      source_url: opts.sourceUrl,
      vehicle_id: opts.vehicleId,
      success: opts.success,
      latency_ms: opts.latencyMs,
      error_type: errorType,
      error_message: errorMessage,
      http_status: opts.httpStatus,
      created_at: new Date().toISOString(),
    });
  } catch (e: any) {
    // Never crash an extractor because of metrics logging
    console.error("[extractionMetrics] logExtractionMetric failed:", e?.message ?? e);
  }
}

// Durable progress for the existing feed worker, in the existing operational
// run store. These are acknowledged processing counts, never source coverage,
// canonical testimony, a new vehicle count or a monetary budget.
export interface IntakeRunTarget {
  target_id: string;
  source: string;
  state: 'selected' | 'attempting' | 'completed' | 'deferred' | 'failed';
  attempted_at: string | null;
  completed_at: string | null;
  reason: string | null;
  counts: Record<string, number>;
}
const intakeReasons = new Set(['paused', 'invocation_limit', 'source_limit', 'worker_deadline',
  'billing', 'rate_limited', 'blocked', 'timeout', 'worker_failed', 'query_failure', 'controls_zero', 'no_due_targets']);
export const INTAKE_RUN_COUNT_KEYS = ['discovered_items', 'queue_rows_acknowledged', 'ingestion_requests',
  'landed_ledger_acknowledged', 'ledger_write_failures', 'known_or_matched', 'backing_off'] as const;

export async function createIntakeRunReceipt(supabase: SupabaseClient, startedAt: number) {
  const id = crypto.randomUUID();
  const targets: IntakeRunTarget[] = [];
  let selectionComplete: boolean | null = null;
  let limits: { max_feeds: number; max_ingests: number; limit_scope: string } | null = null;
  let progressUnavailable = false;
  const safeReason = (reason?: string | null) => reason && intakeReasons.has(reason) ? reason : null;
  const metadata = () => ({ contract: 'source_intake_run_v1', worker: 'poll-listing-feeds',
    grain: 'selected_feed_target', target_scope_complete: selectionComplete,
    attempt_basis: 'dispatch_intent_before_work_not_proof_of_fetch',
    limits, targets,
    source_totals: [...new Set(targets.map(t => t.source))].map(source => {
      const rows = targets.filter(t => t.source === source);
      return { source, selected_targets: rows.length,
        attempted_targets: rows.filter(t => t.attempted_at !== null).length,
        unattempted_targets: rows.filter(t => t.attempted_at === null).length,
        unfinished_started_targets: rows.filter(t => t.attempted_at !== null && t.completed_at === null).length,
        completed_targets: rows.filter(t => t.completed_at !== null).length,
        deferred_targets: rows.filter(t => t.state === 'deferred').length,
        failed_targets: rows.filter(t => t.state === 'failed').length,
        reasons: [...new Set(rows.map(t => t.reason).filter(Boolean))],
        counts: Object.fromEntries(INTAKE_RUN_COUNT_KEYS.map(key => [key, rows.reduce((n, t) => n + (t.counts[key] ?? 0), 0)])),
        canonical_admissions: null, consumer_usable: null, source_population: null };
    }) });
  const persist = async (status: string, completedAt: string | null = null, reason: string | null = null) => {
    if (progressUnavailable) throw new Error('intake_progress_unacknowledged');
    try {
      const { error, data } = await supabase.from('extraction_runs').update({ status,
        completed_at: completedAt, metadata: { ...metadata(), reason: safeReason(reason) } })
        .eq('id', id).eq('source', 'poll-listing-feeds').select('id');
      if (error || !Array.isArray(data) || data.length !== 1 || data[0].id !== id) throw new Error('intake_progress_unacknowledged');
    } catch {
      progressUnavailable = true; throw new Error('intake_progress_unacknowledged');
    }
  };
  const { error, data } = await supabase.from('extraction_runs').insert({ id,
    source: 'poll-listing-feeds', started_at: new Date(startedAt).toISOString(), status: 'running',
    vehicles_created: null, vehicles_updated: null, metadata: metadata() }).select('id');
  if (error || !Array.isArray(data) || data.length !== 1 || data[0].id !== id) throw new Error('intake_run_unacknowledged');
  return {
    id,
    async select(rows: { id: string; source_slug: string }[], complete: boolean, caps: { max_feeds: number; max_ingests: number }) {
      if (rows.length > 100 || new Set(rows.map(t => t.id)).size !== rows.length
        || rows.some(t => !/^[a-z0-9_-]{1,64}$/.test(t.source_slug))) throw new Error('invalid_intake_target_scope');
      targets.push(...rows.map(t => ({ target_id: t.id, source: t.source_slug, state: 'selected' as const,
        attempted_at: null, completed_at: null, reason: null, counts: {} })));
      selectionComplete = complete;
      limits = { max_feeds: caps.max_feeds, max_ingests: caps.max_ingests, limit_scope: 'this_invocation' };
      await persist('running');
    },
    async begin(targetId: string) {
      const target = targets.find(t => t.target_id === targetId);
      if (!target || target.state !== 'selected') throw new Error('invalid_intake_target_transition');
      target.state = 'attempting'; target.attempted_at = new Date().toISOString();
      await persist('running');
    },
    async record(targetId: string, result: { items_found: number; new_queued?: number; matched_existing?: number;
      backing_off?: number; error: string | null; deferred_reason?: string | null;
      ingest_outcomes?: { ledger?: string; ledger_write_status?: string; ingest_attempted?: boolean }[] }) {
      const target = targets.find(t => t.target_id === targetId);
      if (!target) throw new Error('invalid_intake_target_transition');
      const outcomes = result.ingest_outcomes ?? [];
      target.reason = safeReason(result.deferred_reason) ?? (result.error ? 'worker_failed' : null);
      target.state = result.error ? 'failed' : result.deferred_reason ? 'deferred' : 'completed';
      // A capacity refusal before begin is unattempted, even with a result row.
      target.completed_at = target.attempted_at ? new Date().toISOString() : null;
      target.counts = { discovered_items: result.items_found, queue_rows_acknowledged: result.new_queued ?? 0,
        ingestion_requests: outcomes.filter(o => o.ingest_attempted === true).length,
        landed_ledger_acknowledged: outcomes.filter(o => o.ledger === 'complete' && o.ledger_write_status === 'acknowledged').length,
        ledger_write_failures: outcomes.filter(o => o.ledger_write_status === 'unavailable').length,
        known_or_matched: result.matched_existing ?? 0, backing_off: result.backing_off ?? 0 };
      if (Object.values(target.counts).some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('invalid_intake_counts');
      await persist('running');
    },
    async finish(status: 'completed' | 'failed' | 'throttled', reason?: string | null) {
      for (const target of targets.filter(t => t.state === 'selected')) {
        target.state = 'deferred'; target.reason = safeReason(reason) ?? 'worker_deadline';
      }
      // Running targets on failure retain their last acknowledged stage; an
      // interruption never becomes a completed target or a landed observation.
      await persist(status, new Date().toISOString(), safeReason(reason));
    },
  };
}
