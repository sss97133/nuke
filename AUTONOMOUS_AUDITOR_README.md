# 🤖 Autonomous Data Auditor

**Self-healing database agent** that automatically finds, validates, and fixes data quality issues.

## What It Does

The autonomous auditor implements your **exact question chain**:

1. **Is data present?** → Checks completeness for VIN, price, mileage, etc.
2. **Can I find missing data?** → Searches listings, VIN decodes, images
3. **Is data true?** → Validates against `data_validation_rules`
4. **How certain can I be?** → Uses `field_evidence` confidence scores
5. **Can I find proof?** → Identifies proof sources (VIN, BaT, receipts)
6. **Where do I find proof?** → Ranks sources by trust hierarchy
7. **Is proof authentic?** → Validates via `data_source_trust_hierarchy`

## Quick Start

### 1. Run the database migration

```bash
cd /Users/skylar/nuke
supabase db push
```

This creates:
- `audit_runs` - Tracks each audit run
- `audit_actions` - Individual actions taken
- `get_vehicles_needing_audit()` - Priority queue function
- `get_audit_statistics()` - Stats function

### 2. Run your first audit

```bash
npm run audit
```

This will:
- Find vehicles with quality score < 60
- Check for missing/incorrect data
- Auto-fix high-confidence issues (≥85%)
- Flag low-confidence issues for review
- Stay within $50/day budget

### 3. Check results

```sql
-- See recent audit runs
SELECT * FROM recent_audit_runs;

-- See what actions were taken
SELECT 
  vehicle_id,
  action_type,
  description,
  status,
  actual_cost
FROM audit_actions
WHERE run_id = (SELECT run_id FROM audit_runs ORDER BY started_at DESC LIMIT 1);

-- See audit statistics
SELECT get_audit_statistics(7);  -- Last 7 days
```

## Usage Examples

### Default audit (50 vehicles, $50 budget)
```bash
npm run audit
```

### Custom budget
```bash
npm run audit -- --budget=100
```

### Audit specific number of vehicles
```bash
npm run audit -- --vehicles=10
```

### Dry run (see what would happen without making changes)
```bash
npm run audit -- --dry-run
```

### Lower confidence threshold (more aggressive)
```bash
npm run audit -- --confidence=70
```

### Enable expensive features
```bash
npm run audit -- --enable-ocr  # Enable image OCR for VIN extraction
```

### Verbose output
```bash
VERBOSE=true npm run audit
```

## Configuration

Default configuration (in `autonomousDataAuditor.ts`):

```typescript
{
  daily_cost_limit: 50.00,         // $50/day max
  per_vehicle_limit: 2.00,         // $2/vehicle max
  approval_threshold: 0.50,        // Actions >$0.50 need approval
  
  max_vehicles_per_run: 50,        // Process 50 vehicles per run
  min_confidence_auto_fix: 85,     // 85% confidence to auto-fix
  
  enable_vin_decode: true,         // Use NHTSA VIN decoder (FREE)
  enable_listing_scrape: true,     // Scrape original listings
  enable_image_ocr: false,         // OCR images for VIN/data (expensive)
  enable_ai_analysis: true,        // Use AI for reasoning
}
```

## How It Works

### 1. Priority Queue

Vehicles are audited in order of:
1. Most missing critical fields (VIN, price, year, make, model)
2. Lowest quality scores
3. Most validation errors

```sql
SELECT * FROM get_vehicles_needing_audit(60, 100);
-- Returns top 100 vehicles with score < 60
```

### 2. Audit Process

For each vehicle:

```
┌─────────────────────────────────────────┐
│ 1. Check Completeness                  │
│    - VIN present? Price? Mileage?      │
│    - Score: 0-100                       │
└─────────────────────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│ 2. Find Missing Data                   │
│    - Can we get VIN from listing?      │
│    - Can we decode VIN?                │
│    - Can we OCR images?                │
└─────────────────────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│ 3. Validate Existing Data              │
│    - Run validation rules               │
│    - Check field evidence               │
│    - Detect conflicts                   │
└─────────────────────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│ 4. Build Action Plan                   │
│    - Priority 1: VIN decode (unlocks)  │
│    - Priority 2: Price (needed)        │
│    - Priority 3: Other fields          │
└─────────────────────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│ 5. Execute Actions                     │
│    - Budget check ($2/vehicle max)     │
│    - Confidence check (85% min)        │
│    - Log to field_evidence              │
└─────────────────────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│ 6. Report Results                      │
│    - Actions executed                   │
│    - Actions pending approval          │
│    - Cost spent                         │
└─────────────────────────────────────────┘
```

### 3. Action Types

| Action | Cost | Confidence | Description |
|--------|------|------------|-------------|
| `fetch_vin` | $0.00 | 100% | Decode VIN via NHTSA API (FREE) |
| `scrape_listing` | $0.05 | 85% | Scrape original BaT/Craigslist listing |
| `ocr_image` | $0.10 | 90% | OCR title/VIN plate images |
| `ai_analysis` | $0.02 | 65% | AI image analysis for condition |
| `apply_consensus` | $0.00 | varies | Apply forensic consensus |
| `fix_validation` | $0.00 | varies | Fix validation rule violations |

### 4. Safety Gates

**Budget Limits:**
- Global: $50/day (configurable)
- Per-vehicle: $2/vehicle max
- Approval threshold: Actions >$0.50 need human approval

**Confidence Limits:**
- Auto-fix: ≥85% confidence only
- Flag for review: 70-84% confidence
- Reject: <70% confidence

**Forensic Integration:**
All changes go through your existing forensic system:
```sql
-- Agent proposes change
INSERT INTO field_evidence (vehicle_id, field_name, proposed_value, source_type)
VALUES (...);

-- Forensic system validates
SELECT build_field_consensus(vehicle_id, field_name, auto_assign := true);

-- Only assigns if consensus ≥85%
```

## Monitoring

### View recent runs
```sql
SELECT * FROM recent_audit_runs LIMIT 10;
```

### Check action effectiveness
```sql
SELECT * FROM audit_action_effectiveness;
```

### Find vehicles still needing work
```sql
SELECT 
  v.id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  vqs.overall_score,
  ARRAY_AGG(aa.action_type) FILTER (WHERE aa.status = 'needs_approval') as pending_actions
FROM vehicles v
LEFT JOIN vehicle_quality_scores vqs ON vqs.vehicle_id = v.id
LEFT JOIN audit_actions aa ON aa.vehicle_id = v.id
WHERE vqs.overall_score < 60
GROUP BY v.id, v.year, v.make, v.model, vqs.overall_score
ORDER BY vqs.overall_score ASC
LIMIT 20;
```

### Audit statistics
```sql
SELECT get_audit_statistics(30);  -- Last 30 days
```

Returns:
```json
{
  "total_runs": 12,
  "total_vehicles_audited": 450,
  "total_vehicles_improved": 320,
  "total_cost": 125.50,
  "total_fixes": 847,
  "avg_vehicles_per_run": 37.5,
  "avg_cost_per_run": 10.46,
  "success_rate": 91.7
}
```

## Scheduling (Cron)

Run automatically every night at 2 AM:

```bash
# Add to crontab
0 2 * * * cd /Users/skylar/nuke && npm run audit >> /var/log/nuke-audit.log 2>&1
```

Or use GitHub Actions:

```yaml
name: Autonomous Audit
on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM daily
  workflow_dispatch:  # Manual trigger
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run audit
```

## Example Output

```
🤖 Autonomous Data Auditor

Configuration:
  Daily budget: $50
  Max vehicles: 50
  Auto-fix confidence: 85%
  VIN decode: enabled
  Listing scrape: enabled
  Image OCR: disabled
  AI analysis: enabled

🔍 Starting autonomous data audit: audit_1701734400000
📋 Found 127 vehicles needing audit

🔍 Auditing: 1973 Chevrolet C10
  ▶️  Executing: Decode VIN to get: engine_size, drivetrain
  ✅ Decode VIN to get: engine_size, drivetrain - confidence: 100%
  Score: 85/100 (90% complete, 80% correct)
  Actions: 1 executed, 0 pending

🔍 Auditing: 1967 Ford Mustang
  ⏸️  scrape_listing needs approval ($0.75)
  Score: 45/100 (60% complete, 30% correct)
  Actions: 0 executed, 1 pending

... (48 more vehicles)

✅ Audit Complete
Vehicles audited: 50
Vehicles improved: 38
Total cost: $12.45
Total fixes: 87

Most common missing fields:
  mileage: 23 vehicles
  sale_price: 18 vehicles
  vin: 12 vehicles
  engine_size: 34 vehicles

⏸️  12 vehicles need human approval

============================================================
✅ Audit complete!
```

## Troubleshooting

### "No vehicles found to audit"
Good! Your database is clean. Lower the score threshold:
```bash
npm run audit -- --min-score=80
```

### "Budget exceeded immediately"
Increase the budget or lower per-vehicle limit:
```bash
npm run audit -- --budget=100
```

### "Too many actions need approval"
Raise the approval threshold:
```bash
npm run audit -- --approval=1.00  # Approve anything under $1
```

### Check what's happening
```bash
VERBOSE=true npm run audit -- --dry-run
```

## Integration with Existing Systems

The auditor uses your **existing infrastructure**:

- ✅ `data_validation_rules` - Validation logic
- ✅ `field_evidence` - Evidence tracking
- ✅ `build_field_consensus()` - Consensus building
- ✅ `data_source_trust_hierarchy` - Trust levels
- ✅ `vehicle_quality_scores` - Quality tracking

**No duplication.** It orchestrates what you already built.

## Next Steps

1. **Run migration**: `supabase db push`
2. **Test dry run**: `npm run audit -- --dry-run --vehicles=5`
3. **Review results**: Check `audit_runs` table
4. **Approve pending**: Review `audit_actions` with `needs_approval`
5. **Run for real**: `npm run audit`
6. **Schedule daily**: Add to cron or GitHub Actions

## Questions Answered

> **Is the data present?**  
✅ Checks `has_vin`, `has_price`, `has_images`, etc.

> **Can I find missing data?**  
✅ Checks `listing_url`, VIN decode availability, images for OCR

> **Is the data true?**  
✅ Runs `data_validation_rules`, checks `field_evidence` consensus

> **How certain can I be?**  
✅ Uses `source_confidence` + `trust_hierarchy` (0-100 scale)

> **Can I find proof?**  
✅ Lists available proof sources with cost/confidence estimates

> **Where do I find proof?**  
✅ NHTSA VIN (100%), BaT auction (85%), scraped listing (70%), AI (65%)

> **Is proof authentic?**  
✅ Validates via `data_source_trust_hierarchy` trust levels

---

**You now have a self-healing database.** 🎉

