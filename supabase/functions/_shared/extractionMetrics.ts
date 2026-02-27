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
