/**
 * APPROVED BAT EXTRACTION WORKFLOW
 * 
 * ⚠️ CRITICAL: Do NOT use deprecated functions for BaT extraction.
 * 
 * ✅ APPROVED WORKFLOW (use this):
 * 1. extract-premium-auction (core data: VIN, specs, images, auction_events)
 * 2. extract-auction-comments (comments, bids)
 * 
 * ❌ DEPRECATED (DO NOT USE):
 * - comprehensive-bat-extraction
 * - import-bat-listing
 * - bat-extract-complete-v1/v2/v3
 * - bat-simple-extract (for full extraction)
 * 
 * Documentation: docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md
 */

export const APPROVED_BAT_EXTRACTORS = {
  CORE_DATA: 'extract-premium-auction',
  COMMENTS: 'extract-auction-comments',
} as const;

export const DEPRECATED_BAT_EXTRACTORS = [
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

