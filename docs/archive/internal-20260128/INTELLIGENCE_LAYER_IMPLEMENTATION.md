# Intelligence Layer Implementation

**Created:** 2026-01-28
**Status:** Deployed, Schema Pending

---

## What Was Built

### 1. Core Intelligence Module

**File:** `supabase/functions/_shared/intelligence-layer.ts`

Domain-agnostic evaluation that returns APPROVE/DOUBT/REJECT for each field:

```typescript
evaluateExtraction(data, context) → {
  overall_decision: 'APPROVE' | 'DOUBT' | 'REJECT',
  field_decisions: [...],
  doubts_requiring_research: [...],
  reject_reasons: [...]
}
```

**Validators implemented:**
- VIN (modern 17-char + pre-1981 variable length)
- VIN checksum (MOD 11 algorithm)
- Year (1885 to current+1)
- Price (anomaly detection for very low/high)
- Mileage (anomaly detection for very low/high given age)
- Cross-field: VIN year vs claimed year consistency

### 2. Edge Functions

| Function | Purpose | Status |
|----------|---------|--------|
| `intelligence-evaluate` | Evaluates extraction, returns decision | Deployed |
| `intelligence-research` | Processes doubt queue, resolves with evidence | Deployed |
| `process-import-queue` | Updated with `use_intelligence` flag | Deployed |

### 3. Database Schema

**File:** `supabase/migrations/20260128150825_intelligence_layer_schema.sql`

Tables:
- `intelligence_decisions` - Logs every evaluation
- `doubt_queue` - Items needing research
- `intelligence_patterns` - Learned patterns from resolved doubts

Functions:
- `claim_doubts_for_research()` - Claims with row locking
- `resolve_doubt()` - Resolves and optionally creates patterns
- `record_pattern_match()` - Tracks pattern usage

Views:
- `intelligence_stats` - Decision counts, approval rate
- `doubt_queue_stats` - Queue status breakdown

**Status:** Schema created but not yet applied (migration sync issues)

---

## Test Results

### Test 1: Basic Evaluation (No Persistence)

```bash
curl -X POST ".../intelligence-evaluate" -d '{
  "extracted_data": {
    "year": 1968,
    "make": "Oldsmobile",
    "model": "442",
    "vin": "344678M123456",
    "sale_price": 45000,
    "mileage": 67000
  },
  "persist_decision": false
}'
```

**Result:**
```json
{
  "decision": "DOUBT",
  "field_decisions": [
    {"field": "vin", "decision": "DOUBT", "reason": "Non-standard VIN length (13 chars)"},
    {"field": "year", "decision": "APPROVE"},
    {"field": "sale_price", "decision": "APPROVE"},
    {"field": "mileage", "decision": "APPROVE"}
  ]
}
```

### Test 2: Invalid VIN (Hard Reject)

```bash
curl -X POST ".../intelligence-evaluate" -d '{
  "extracted_data": {
    "year": 2020,
    "make": "BMW",
    "vin": "WBSOI234567890123"  // Contains 'O'
  }
}'
```

**Result:**
```json
{
  "decision": "REJECT",
  "reject_reasons": ["VIN contains invalid characters (I, O, or Q are never used)"]
}
```

### Test 3: Live Pipeline with Intelligence

```bash
curl -X POST ".../process-import-queue" -d '{
  "batch_size": 10,
  "use_intelligence": true
}'
```

**Results (10 extractions):**

| Status | Count | Examples |
|--------|-------|----------|
| APPROVE | 3 | 2003 Mercedes G500, 2001 BMW 530i, 1990 Bentley |
| DOUBT | 6 | Pre-1981 vehicles with non-standard VINs |
| Failed | 1 | Extractor error (null make) |

**Doubts correctly identified:**
- 1965 Ford Ranchero: 11-char VIN + low mileage (1,000 on 61yo car)
- 1980 Porsche 911SC: VIN is NULL
- 1968 Ford Galaxie 500: 11-char VIN
- 1967 Pontiac GTO: 13-char VIN
- 1973 Chevrolet LUV: 13-char VIN (tagged as `edge_case`)
- 1960 Mercedes 220SE: 14-char VIN

---

## Integration

### Enabling Intelligence in Pipeline

```bash
# Without intelligence (current default)
curl -X POST ".../process-import-queue" -d '{"batch_size": 10}'

# With intelligence
curl -X POST ".../process-import-queue" -d '{"batch_size": 10, "use_intelligence": true}'
```

### New Queue Statuses

When `use_intelligence: true`:
- `complete` - APPROVED and saved
- `pending_review` - DOUBTED, needs research
- `rejected` - REJECTED, hard failure
- `failed` - Extractor error (not intelligence decision)

---

## Next Steps

1. **Apply schema** - Run migration SQL in Supabase dashboard
2. **Enable persistence** - Decisions will log to `intelligence_decisions`
3. **Process doubt queue** - Call `intelligence-research` to resolve DOUBTs
4. **Extend validators** - Add derivative evidence (images, description, comments)
5. **Build pattern learning** - Track resolved doubts → create patterns

---

## Files Created/Modified

```
supabase/functions/_shared/intelligence-layer.ts      # Core module (NEW)
supabase/functions/intelligence-evaluate/index.ts     # Evaluate endpoint (NEW)
supabase/functions/intelligence-research/index.ts     # Research endpoint (NEW)
supabase/functions/process-import-queue/index.ts      # Added use_intelligence flag (MODIFIED)
supabase/migrations/20260128150825_*.sql              # Schema (NEW, pending apply)
docs/STRUCTURAL_FOUNDATION.md                         # Architecture doc (NEW)
```
