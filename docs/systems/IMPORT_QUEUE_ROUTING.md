# Import Queue Routing Strategy

## Problem

The `import_queue` table receives listings from multiple sources:
- **BHCC** (Beverly Hills Car Club): `beverlyhillscarclub.com`
- **BaT** (Bring a Trailer): `bringatrailer.com`
- **KSL**: `ksl.com`
- **Classic.com**, **PCArmarket**, **Mecum**, **DuPont Registry**: Various auction/dealer sites
- **Other dealers/auction houses**: Various domains

Previously, routing drift caused the queue to send items to the wrong processors (especially BHCC-only logic being applied to non-BHCC URLs, and BaT getting routed to deprecated entrypoints).

## Solution: Intelligent Processor Selection

### Architecture

We use a **shared processor selection function** (`supabase/functions/_shared/select-processor.ts`) that routes items to the best processor based on:
- URL patterns
- `raw_data.source` field
- Source metadata
- Inventory extraction flags

This centralizes routing logic and makes it easy to add new sources without modifying the orchestrator.

### Function Mapping

| Source Type | URL Pattern / Metadata | Processor Function | Notes |
|------------|----------------------|-------------------|-------|
| **BHCC** | `beverlyhillscarclub.com` | `process-bhcc-queue` | BHCC-specific processor |
| **BaT** | `bringatrailer.com` or `raw_data.source` contains 'bat' | `process-bat-from-import-queue` | Internal `pipeline-orchestrator` branch that runs the approved two-step workflow |
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
   - **Batch processors** (`process-bhcc-queue`, `process-import-queue`): Called asynchronously with a batch_size
   - **Per-item processors** (`import-classic-auction`, `import-pcarmarket-listing`, etc.): Called per-item
   - **BaT** (`process-bat-from-import-queue`): Special internal branch handled inside `pipeline-orchestrator`

#### 3. BHCC Processing

BHCC items in `import_queue` are routed to `process-bhcc-queue`.

#### 4. BaT Processing (approved workflow)

BaT items in `import_queue` are processed by:
1. Orchestrator detects BaT URLs
2. Runs the mandatory two-step workflow:
   - Step 1: `extract-premium-auction`
   - Step 2: `extract-auction-comments`

Important: `process-bat-from-import-queue` is not a deployable Edge Function. It is an internal routing label that `pipeline-orchestrator` handles directly.

### Flow Diagram

```
import_queue (pending)
    │
    ├─→ BHCC URLs ──────────→ process-bhcc-queue ─────────→ vehicles (BHCC profiles)
    │
    ├─→ BaT URLs ────────────→ pipeline-orchestrator branch:
    │                           extract-premium-auction → extract-auction-comments
    │
    └─→ Other URLs ───────────→ process-import-queue (generic)
```

## Why This Approach

1. **BHCC**: BHCC has a dedicated, BHCC-specific processor
2. **BaT**: BaT uses a strict, approved two-step workflow (core data, then comments/bids)
3. **Other**: Everything else routes through the generic processor until a dedicated one exists

## Adding New Sources

To add a new source, update `supabase/functions/_shared/select-processor.ts`:

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

- Create dedicated processors for other high-volume sources (KSL, generic dealers)
- Add source detection in `import_queue` table (e.g., `source_type` column) for faster routing
- Add processor health checks (skip processors that are failing)
- Add priority-based routing (e.g., live auctions get higher priority processors)

## Testing

After deployment:
1. Check orchestrator logs to see queue distribution
2. Verify BHCC items are processed by `process-bhcc-queue`
3. Verify BaT items run the two-step workflow via `pipeline-orchestrator`
4. Verify generic items are processed by `process-import-queue`

