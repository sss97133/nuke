# Import Queue Routing Strategy

## Problem

The `import_queue` table receives listings from multiple sources:
- **BHCC** (Beverly Hills Car Club): `beverlyhillscarclub.com`
- **BaT** (Bring a Trailer): `bringatrailer.com`
- **KSL**: `ksl.com`
- **Classic.com**, **PCArmarket**, **Mecum**, **DuPont Registry**: Various auction/dealer sites
- **Other dealers/auction houses**: Various domains

Previously, all items were being sent to `process-import-queue-fast`, which is **designed only for BHCC** and cannot properly handle BaT or other sources.

## Solution: Intelligent Processor Selection

### Architecture

We've created a **shared processor selection function** (`_shared/select-processor.ts`) that intelligently routes items to the best processor based on:
- URL patterns
- `raw_data.source` field
- Source metadata
- Inventory extraction flags

This centralizes routing logic and makes it easy to add new sources without modifying the orchestrator.

### Function Mapping

| Source Type | URL Pattern / Metadata | Processor Function | Notes |
|------------|----------------------|-------------------|-------|
| **BHCC** | `beverlyhillscarclub.com` | `process-import-queue-fast` | Fast HTML parser, BHCC-specific |
| **BaT** | `bringatrailer.com` or `raw_data.source` contains 'bat' | `import-bat-listing` | Comprehensive BaT extraction (images, comments, bids, features) |
| **Classic.com** | `classic.com` | `import-classic-auction` | Dedicated Classic.com importer |
| **PCArmarket** | `pcarmarket.com` | `import-pcarmarket-listing` | Dedicated PCArmarket importer |
| **KSL** | `ksl.com` | `process-import-queue` | Generic processor (until KSL-specific created) |
| **SBX Cars** | `sbxcars.com` | `process-import-queue` | Via process-import-queue |
| **Mecum** | `mecum.com` | `process-import-queue` | Via process-import-queue |
| **DuPont** | `dupontregistry.com` | `process-import-queue` | Full extraction needed |
| **Dealer Inventory** | `raw_data.inventory_extraction === true` | `process-import-queue` | Organization-linked inventory |
| **Unknown/Default** | Everything else | `process-import-queue` | Fallback generic processor |

### Implementation

#### 1. Shared Processor Selection (`_shared/select-processor.ts`)

**Exports:**
- `selectProcessor(item: QueueItem): ProcessorSelection` - Selects best processor for a single item
- `groupByProcessor(items: QueueItem[]): Map<string, QueueItem[]>` - Groups items by processor
- `getProcessorSummary(items: QueueItem[]): Record<string, {count, reason}>` - Gets distribution summary

**Selection Criteria:**
1. **URL patterns**: Primary method (most reliable)
2. **raw_data.source**: Secondary (if URL doesn't match)
3. **Metadata flags**: `inventory_extraction`, `organization_id`, etc.
4. **Default fallback**: Generic `process-import-queue`

#### 2. Pipeline Orchestrator (`pipeline-orchestrator`)

The orchestrator now:
1. Queries `import_queue` to sample pending items (limit 100)
2. Uses `getProcessorSummary()` to log distribution
3. Uses `groupByProcessor()` to group items by selected processor
4. Routes each group:
   - **Batch processors** (`process-import-queue-fast`, `process-import-queue`): Call once with batch_size
   - **Per-item processors** (`import-bat-listing`, `import-classic-auction`, etc.): Process individually (max 3 per cycle)

#### 3. Process Import Queue Fast (`process-import-queue-fast`)

**Updated to:**
- Early-exit if URL is not BHCC (keeps as `pending` status)
- Only processes `beverlyhillscarclub.com` URLs
- Logs skipped URLs for visibility

#### 3. BaT Processing

BaT items in `import_queue` are processed by:
1. Orchestrator detects BaT URLs
2. Calls `import-bat-listing` for each (max 3 per cycle to avoid overwhelming)
3. Marks queue item as `complete` when vehicle is created
4. Vehicle automatically queues to `bat_extraction_queue` for comprehensive data (if needed)

### Flow Diagram

```
import_queue (pending)
    │
    ├─→ BHCC URLs ──────────→ process-import-queue-fast ──→ vehicles (BHCC profiles)
    │
    ├─→ BaT URLs ────────────→ import-bat-listing ────────→ vehicles (BaT profiles)
    │                                                           │
    │                                                           └─→ bat_extraction_queue ──→ comprehensive-bat-extraction
    │
    └─→ Other URLs ───────────→ [SKIPPED - needs process-import-queue fix]
```

## Why This Approach

1. **BHCC**: `process-import-queue-fast` is optimized for BHCC HTML structure and fast execution
2. **BaT**: `import-bat-listing` is the canonical BaT importer with comprehensive extraction
3. **Other**: Need to fix `process-import-queue` BOOT_ERROR before routing other sources

## Adding New Sources

To add a new source, simply update `_shared/select-processor.ts`:

```typescript
// In selectProcessor() function, add new condition:
if (url.includes('newsite.com') || source.includes('newsite')) {
  return {
    functionName: 'process-new-site', // or existing processor
    parameters: { /* processor-specific params */ },
    reason: 'NewSite.com importer',
    priority: 2, // Lower = higher priority
  };
}
```

The orchestrator will automatically use the new routing without modification.

## Future Improvements

- Fix `process-import-queue` BOOT_ERROR to handle KSL, dealer sites, etc.
- Create dedicated processors for other high-volume sources (KSL, generic dealers)
- Add source detection in `import_queue` table (e.g., `source_type` column) for faster routing
- Add processor health checks (skip processors that are failing)
- Add priority-based routing (e.g., live auctions get higher priority processors)

## Testing

After deployment:
1. Check orchestrator logs to see queue distribution
2. Verify BHCC items are processed by `process-import-queue-fast`
3. Verify BaT items create complete vehicle profiles with images, description, mileage, etc.
4. Monitor `bat_extraction_queue` to ensure comprehensive data extraction completes

