/**
 * SELECT PROCESSOR
 * 
 * Intelligently selects the best processor function for an import_queue item
 * based on URL patterns, source metadata, and other factors.
 * 
 * This centralizes routing logic and makes it easy to add new sources.
 * 
 * ⚠️ FOR BaT: Always uses the approved two-step workflow:
 * 1. extract-bat-core (core data, free mode, evidence-first)
 * 2. extract-auction-comments (comments/bids)
 * 
 * See: docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md
 */

import { APPROVED_BAT_EXTRACTORS } from './approved-extractors.ts';

export interface ProcessorSelection {
  functionName: string;
  parameters: Record<string, any>;
  reason: string;
  priority: number; // Lower = higher priority
}

export interface QueueItem {
  id?: string;
  listing_url: string;
  raw_data?: Record<string, any>;
  source_id?: string;
  listing_title?: string;
  listing_year?: number;
  listing_make?: string;
  listing_model?: string;
}

/**
 * Selects the best processor for an import_queue item
 */
export function selectProcessor(item: QueueItem): ProcessorSelection {
  const url = (item.listing_url || '').toLowerCase();
  const rawData = item.raw_data || {};
  const source = (rawData.source || '').toLowerCase();

  // ============================================================================
  // BHCC (Beverly Hills Car Club) - BHCC-specific processor
  // ============================================================================
  if (url.includes('beverlyhillscarclub.com')) {
    return {
      functionName: 'process-bhcc-queue',
      parameters: {
        batch_size: 10,
        external_images_only: true,
        max_external_images: 18,
        source_id: item.source_id || undefined,
      },
      reason: 'BHCC-specific processor (optimized for beverlyhillscarclub.com)',
      priority: 1,
    };
  }

  // ============================================================================
  // BaT (Bring a Trailer) - APPROVED TWO-STEP WORKFLOW (MANDATORY)
  // 
  // ⚠️ CRITICAL: Do NOT route to deprecated functions like:
  // - comprehensive-bat-extraction
  // - import-bat-listing  
  // - bat-extract-complete-v*
  //
  // ✅ APPROVED WORKFLOW:
  // Step 1: extract-bat-core (core data + images + auction_events + listing_page_snapshots)
  // Step 2: extract-auction-comments (comments + bids)
  //
  // Documentation: docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md
  // ============================================================================
  if (url.includes('bringatrailer.com') || source.includes('bat') || source.includes('bring')) {
    return {
      functionName: 'process-bat-from-import-queue', // Special orchestrator handler
      parameters: {
        listing_url: item.listing_url,
        queue_id: item.id,
        // Orchestrator will call:
        // 1. extract-bat-core (APPROVED_BAT_EXTRACTORS.CORE_DATA)
        // 2. extract-auction-comments (APPROVED_BAT_EXTRACTORS.COMMENTS)
      },
      reason: `BaT approved workflow: ${APPROVED_BAT_EXTRACTORS.CORE_DATA} + ${APPROVED_BAT_EXTRACTORS.COMMENTS}`,
      priority: 2,
      documentation: 'docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md',
    };
  }

  // ============================================================================
  // KSL - KSL-specific processor (if exists)
  // ============================================================================
  if (url.includes('ksl.com') || source.includes('ksl')) {
    return {
      functionName: 'process-import-queue', // TODO: Create process-ksl-queue when process-import-queue is fixed
      parameters: {
        batch_size: 5,
        fast_mode: true,
        skip_image_upload: false,
      },
      reason: 'KSL listings (fallback to process-import-queue until KSL-specific processor exists)',
      priority: 3,
    };
  }

  // ============================================================================
  // Cars & Bids - Auction platform
  // Uses process-import-queue for base extraction, comments extracted via
  // extract-cars-and-bids-comments after vehicle profile is created
  // ============================================================================
  if (url.includes('carsandbids.com') || source.includes('cars_and_bids') || source.includes('carsandbids')) {
    return {
      functionName: 'process-import-queue',
      parameters: {
        batch_size: 5,
        fast_mode: false, // C&B needs full extraction for auction data
      },
      reason: 'Cars & Bids auction (via process-import-queue)',
      priority: 2,
    };
  }

  // ============================================================================
  // Classic.com - Auction house
  // ============================================================================
  if (url.includes('classic.com') || source.includes('classic')) {
    return {
      functionName: 'import-classic-auction',
      parameters: {
        url: item.listing_url,
      },
      reason: 'Classic.com auction house importer',
      priority: 2,
    };
  }

  // ============================================================================
  // PCArmarket
  // ============================================================================
  if (url.includes('pcarmarket.com') || source.includes('pcarmarket')) {
    return {
      functionName: 'import-pcarmarket-listing',
      parameters: {
        url: item.listing_url,
      },
      reason: 'PCArmarket importer',
      priority: 2,
    };
  }

  // ============================================================================
  // SBX Cars
  // ============================================================================
  if (url.includes('sbxcars.com') || source.includes('sbx')) {
    return {
      functionName: 'process-import-queue', // SBX scraper already populates import_queue
      parameters: {
        batch_size: 10,
        fast_mode: true,
        source_id: item.source_id || undefined,
      },
      reason: 'SBX Cars (processed via process-import-queue)',
      priority: 4,
    };
  }

  // ============================================================================
  // DuPont Registry
  // ============================================================================
  if (url.includes('dupontregistry.com') || source.includes('dupont')) {
    return {
      functionName: 'process-import-queue',
      parameters: {
        batch_size: 5,
        fast_mode: false, // DuPont needs full extraction
      },
      reason: 'DuPont Registry (full extraction needed)',
      priority: 3,
    };
  }

  // ============================================================================
  // Mecum Auctions
  // ============================================================================
  if (url.includes('mecum.com') || source.includes('mecum')) {
    return {
      functionName: 'process-import-queue', // Mecum has dedicated scraper but uses import_queue
      parameters: {
        batch_size: 5,
        fast_mode: false,
      },
      reason: 'Mecum Auctions (via process-import-queue)',
      priority: 3,
    };
  }

  // ============================================================================
  // Dealer inventory (generic)
  // ============================================================================
  if (rawData.inventory_extraction === true || rawData.organization_id) {
    return {
      functionName: 'process-import-queue',
      parameters: {
        batch_size: 10,
        fast_mode: true,
        source_id: item.source_id || undefined,
      },
      reason: 'Dealer inventory extraction (organization-linked)',
      priority: 4,
    };
  }

  // ============================================================================
  // Default / Unknown - Try generic processor
  // ============================================================================
  return {
    functionName: 'process-import-queue',
    parameters: {
      batch_size: 5,
      fast_mode: true,
      skip_image_upload: false,
    },
    reason: `Unknown source (${url.substring(0, 50)}...), using generic processor`,
    priority: 10, // Lowest priority
  };
}

/**
 * Groups queue items by their selected processor
 */
export function groupByProcessor(items: QueueItem[]): Map<string, QueueItem[]> {
  const groups = new Map<string, QueueItem[]>();

  for (const item of items) {
    const selection = selectProcessor(item);
    const key = selection.functionName;
    
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(item);
  }

  return groups;
}

/**
 * Gets a summary of processor distribution
 */
export function getProcessorSummary(items: QueueItem[]): Record<string, { count: number; reason: string }> {
  const summary: Record<string, { count: number; reason: string }> = {};
  
  for (const item of items) {
    const selection = selectProcessor(item);
    const key = selection.functionName;
    
    if (!summary[key]) {
      summary[key] = { count: 0, reason: selection.reason };
    }
    summary[key].count++;
  }
  
  return summary;
}

