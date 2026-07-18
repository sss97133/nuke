/**
 * APPROVED BAT EXTRACTION WORKFLOW
 *
 * ⚠️ CRITICAL: Do NOT use deprecated/deleted functions for BaT extraction.
 *
 * ✅ APPROVED WORKFLOW (use this):
 * 1. extract-bat-core — standalone entry point. Call it directly.
 *    (core data: HTML snapshot + clean identity + essentials/images/auction_events)
 * 2. extract-auction-comments — comments + bids. NOT auto-chained by
 *    extract-bat-core — the caller must trigger it itself after step 1 succeeds.
 *
 * Live callers following this exact pattern (direct extract-bat-core call +
 * self-triggered extract-auction-comments): supabase/functions/ingest/index.ts,
 * continuous-queue-processor/index.ts, process-bat-extraction-queue/index.ts,
 * bat-queue-worker/index.ts.
 *
 * ❌ DEPRECATED / DELETED (DO NOT USE):
 * - complete-bat-import  ← deleted from deployment in the March 2026 triage;
 *   its source file is orphaned in git and the deployed function returns a
 *   live HTTP 404 (confirmed 2026-07-07). Two callers still hardcoded a
 *   direct route to it and were broken as a result — fixed 2026-07-07 in
 *   process-import-queue/index.ts and extract-premium-auction/index.ts.
 * - bat-simple-extract
 * - bat-extract
 * - comprehensive-bat-extraction
 * - import-bat-listing
 * - bat-extract-complete-v1/v2/v3
 *
 */

export const APPROVED_BAT_EXTRACTORS = {
  // Standalone entry point — call directly, then trigger COMMENTS yourself
  CORE_DATA: 'extract-bat-core',
  COMMENTS: 'extract-auction-comments',
} as const;

export const DEPRECATED_BAT_EXTRACTORS = [
  'complete-bat-import',
  'bat-simple-extract',
  'bat-extract',
  'comprehensive-bat-extraction',
  'import-bat-listing',
  'bat-extract-complete-v1',
  'bat-extract-complete-v2',
  'bat-extract-complete-v3',
] as const;

export function isApprovedBatExtractor(functionName: string): boolean {
  return Object.values(APPROVED_BAT_EXTRACTORS).includes(functionName as any);
}

export function isDeprecatedBatExtractor(functionName: string): boolean {
  return DEPRECATED_BAT_EXTRACTORS.includes(functionName as any);
}
