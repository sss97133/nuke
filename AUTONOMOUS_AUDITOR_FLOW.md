# 🔄 Autonomous Auditor - Visual Flow

## The Complete Audit Cycle

```
┌────────────────────────────────────────────────────────────────────┐
│                      START: npm run audit                          │
└────────────────────────────┬───────────────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────────────┐
│  STEP 1: GET PRIORITY QUEUE                                        │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ SELECT * FROM get_vehicles_needing_audit(60, 50)            │  │
│  │                                                              │  │
│  │ Returns: Vehicles with quality_score < 60                   │  │
│  │ Sorted by: Missing fields (DESC), Quality score (ASC)       │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  Result: 127 vehicles found                                        │
└────────────────────────────┬───────────────────────────────────────┘
                             │
                             ▼
         ┌───────────────────────────────────┐
         │   FOR EACH VEHICLE (max 50)      │
         └───────────┬───────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────────┐
│  STEP 2: AUDIT SINGLE VEHICLE                                      │
│                                                                    │
│  Vehicle: 1973 Chevrolet C10                                       │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ QUESTION 1: Is data present?                               │   │
│  │ ┌────────────────────────────────────────────────────────┐ │   │
│  │ │ checkCompleteness()                                    │ │   │
│  │ │                                                        │ │   │
│  │ │ Critical: ✅ year, ✅ make, ✅ model, ❌ vin           │ │   │
│  │ │ Important: ✅ sale_price, ❌ mileage                  │ │   │
│  │ │ Optional: ✅ color, ❌ transmission, ❌ engine_size   │ │   │
│  │ │                                                        │ │   │
│  │ │ Completeness Score: 60/100                            │ │   │
│  │ └────────────────────────────────────────────────────────┘ │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ QUESTION 2 & 6: Can I find data? Where is proof?          │   │
│  │ ┌────────────────────────────────────────────────────────┐ │   │
│  │ │ findMissingData()                                      │ │   │
│  │ │                                                        │ │   │
│  │ │ Missing: vin, mileage, transmission, engine_size      │ │   │
│  │ │                                                        │ │   │
│  │ │ Actions found:                                         │ │   │
│  │ │ 1. [P1] scrape_listing for VIN                        │ │   │
│  │ │    Cost: $0.05, Confidence: 85%, Source: BaT listing  │ │   │
│  │ │                                                        │ │   │
│  │ │ 2. [P1] ocr_image for VIN (if enabled)                │ │   │
│  │ │    Cost: $0.10, Confidence: 90%, Source: title image  │ │   │
│  │ └────────────────────────────────────────────────────────┘ │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ QUESTION 3: Is data true?                                  │   │
│  │ ┌────────────────────────────────────────────────────────┐ │   │
│  │ │ checkValidation()                                      │ │   │
│  │ │                                                        │ │   │
│  │ │ SELECT * FROM vehicle_validation_issues               │ │   │
│  │ │ WHERE vehicle_id = ? AND status = 'open'              │ │   │
│  │ │                                                        │ │   │
│  │ │ Found:                                                 │ │   │
│  │ │ - [ERROR] mileage_too_high: 650,000 miles suspicious  │ │   │
│  │ │                                                        │ │   │
│  │ │ Correctness Score: 75/100                             │ │   │
│  │ └────────────────────────────────────────────────────────┘ │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ QUESTION 4, 5, 7: How certain? Proof? Authentic?          │   │
│  │ ┌────────────────────────────────────────────────────────┐ │   │
│  │ │ checkEvidence()                                        │ │   │
│  │ │                                                        │ │   │
│  │ │ SELECT * FROM field_evidence WHERE vehicle_id = ?     │ │   │
│  │ │                                                        │ │   │
│  │ │ Field: drivetrain                                      │ │   │
│  │ │ Evidence:                                              │ │   │
│  │ │   1. "4WD" from VIN decode (trust: 100, conf: 100%)   │ │   │
│  │ │   2. "2WD" from scraped (trust: 70, conf: 70%)        │ │   │
│  │ │                                                        │ │   │
│  │ │ CONFLICT DETECTED!                                     │ │   │
│  │ │                                                        │ │   │
│  │ │ Consensus: "4WD" (VIN wins - highest trust)           │ │   │
│  │ │ Confidence: 100%                                       │ │   │
│  │ │ Action: accept_consensus                              │ │   │
│  │ └────────────────────────────────────────────────────────┘ │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  Overall Score: 67/100 (60% complete, 75% correct)                │
└────────────────────────────┬───────────────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────────────┐
│  STEP 3: BUILD & PRIORITIZE ACTIONS                                │
│                                                                    │
│  Actions Pending:                                                  │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ Priority 1 (Critical - VIN unlocks everything):            │   │
│  │   [1] scrape_listing for VIN ($0.05, 85% conf)            │   │
│  │                                                            │   │
│  │ Priority 2 (High - Price needed):                          │   │
│  │   (none)                                                   │   │
│  │                                                            │   │
│  │ Priority 3 (Medium - Specs):                               │   │
│  │   [2] apply_consensus for drivetrain ($0.00, 100% conf)   │   │
│  │   [3] fix_validation for mileage ($0.00, 50% conf)        │   │
│  └────────────────────────────────────────────────────────────┘   │
└────────────────────────────┬───────────────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────────────┐
│  STEP 4: EXECUTE ACTIONS (with gates)                              │
│                                                                    │
│  Budget available: $50.00 (daily) - $0.00 (spent) = $50.00        │
│  Vehicle budget: $2.00 per vehicle                                 │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ Action [1]: scrape_listing for VIN                        │   │
│  │                                                            │   │
│  │ GATE 1: Budget check                                       │   │
│  │   Cost: $0.05 < $2.00 vehicle limit ✅                    │   │
│  │   Cost: $0.05 < $50.00 daily limit ✅                     │   │
│  │                                                            │   │
│  │ GATE 2: Approval check                                     │   │
│  │   Cost: $0.05 < $0.50 threshold ✅                        │   │
│  │   → Auto-approved                                          │   │
│  │                                                            │   │
│  │ GATE 3: Confidence check                                   │   │
│  │   Confidence: 85% >= 85% threshold ✅                     │   │
│  │   → Auto-fix approved                                      │   │
│  │                                                            │   │
│  │ ▶️  EXECUTING: Scrape BaT listing...                      │   │
│  │ ✅ COMPLETED: VIN found = "TBD123456789"                  │   │
│  │                                                            │   │
│  │ Logging to field_evidence:                                 │   │
│  │   INSERT INTO field_evidence (vehicle_id, field_name,     │   │
│  │     proposed_value, source_type, source_confidence)       │   │
│  │   VALUES (?, 'vin', 'TBD123456789',                       │   │
│  │     'scraped_listing', 85)                                 │   │
│  │                                                            │   │
│  │ Cost: $0.05 (actual)                                       │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ Action [2]: apply_consensus for drivetrain                │   │
│  │                                                            │   │
│  │ GATE 1: Budget check                                       │   │
│  │   Cost: $0.00 ✅                                          │   │
│  │                                                            │   │
│  │ GATE 2: Approval check                                     │   │
│  │   Cost: $0.00 ✅                                          │   │
│  │                                                            │   │
│  │ GATE 3: Confidence check                                   │   │
│  │   Confidence: 100% >= 85% ✅                              │   │
│  │                                                            │   │
│  │ ▶️  EXECUTING: build_field_consensus(?, 'drivetrain')     │   │
│  │ ✅ COMPLETED: Set to "4WD" (VIN source)                   │   │
│  │                                                            │   │
│  │ Cost: $0.00                                                │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ Action [3]: fix_validation for mileage                    │   │
│  │                                                            │   │
│  │ GATE 3: Confidence check                                   │   │
│  │   Confidence: 50% < 85% threshold ❌                      │   │
│  │   → NEEDS APPROVAL                                         │   │
│  │                                                            │   │
│  │ ⏸️  PENDING: Human review required                        │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  Actions executed: 2                                               │
│  Actions pending approval: 1                                       │
│  Cost spent: $0.05                                                 │
└────────────────────────────┬───────────────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────────────┐
│  STEP 5: UPDATE VEHICLE QUALITY SCORE                              │
│                                                                    │
│  Before: 67/100 (60% complete, 75% correct)                        │
│  After:  85/100 (80% complete, 90% correct)                        │
│                                                                    │
│  Improvement: +18 points                                           │
└────────────────────────────┬───────────────────────────────────────┘
                             │
                             ▼
         ┌───────────────────────────────────┐
         │   NEXT VEHICLE (repeat 2-5)      │
         └───────────┬───────────────────────┘
                     │
                     │ (after 50 vehicles or budget limit)
                     │
                     ▼
┌────────────────────────────────────────────────────────────────────┐
│  STEP 6: SAVE AUDIT RUN & REPORT                                   │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ INSERT INTO audit_runs (                                   │   │
│  │   run_id, vehicles_audited, vehicles_improved,            │   │
│  │   total_cost, total_fixes, status, results                │   │
│  │ ) VALUES (                                                 │   │
│  │   'audit_1701734400000', 50, 38,                          │   │
│  │   12.45, 87, 'completed', {...}                           │   │
│  │ )                                                          │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ SUMMARY REPORT                                             │   │
│  │ ────────────────────────────────────────────────────────── │   │
│  │ Vehicles audited: 50                                       │   │
│  │ Vehicles improved: 38                                      │   │
│  │ Vehicles flagged: 12                                       │   │
│  │                                                            │   │
│  │ Total cost: $12.45                                         │   │
│  │ Total fixes: 87                                            │   │
│  │                                                            │   │
│  │ Most common missing fields:                                │   │
│  │   mileage: 23 vehicles                                     │   │
│  │   engine_size: 34 vehicles                                 │   │
│  │   vin: 12 vehicles                                         │   │
│  │                                                            │   │
│  │ ⏸️  12 vehicles need human approval                       │   │
│  └────────────────────────────────────────────────────────────┘   │
└────────────────────────────┬───────────────────────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   ✅ COMPLETE   │
                    └─────────────────┘
```

## Key Decision Points

### Budget Gates
```
                    ┌─────────────────────┐
                    │   Action Proposed   │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ cost < $2/vehicle?   │
                    └──┬───────────────┬───┘
                  YES  │               │  NO
                       ▼               ▼
            ┌──────────────────┐   SKIP (budget)
            │ cost < $50/day?  │
            └──┬───────────┬───┘
          YES  │           │  NO
               ▼           ▼
          CONTINUE     SKIP (budget)
```

### Approval Gates
```
            ┌──────────────────────┐
            │   Budget Approved    │
            └──────────┬───────────┘
                       │
                       ▼
            ┌──────────────────────┐
            │ cost < $0.50?        │
            └──┬───────────────┬───┘
          YES  │               │  NO
               ▼               ▼
          AUTO-EXECUTE    NEEDS APPROVAL
```

### Confidence Gates
```
            ┌──────────────────────┐
            │   Approved           │
            └──────────┬───────────┘
                       │
                       ▼
            ┌──────────────────────┐
            │ confidence ≥ 85%?    │
            └──┬───────────────┬───┘
          YES  │               │  NO
               ▼               ▼
          AUTO-FIX       NEEDS APPROVAL
```

## Data Flow Through Forensic System

```
┌─────────────────────────────────────────────────────┐
│  1. EVIDENCE COLLECTION                             │
│  ────────────────────────────────────────────────── │
│  Auditor finds: VIN = "TBD123456789"               │
│  Source: scraped_listing                            │
│  Confidence: 85%                                    │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  2. STORE IN FIELD_EVIDENCE                         │
│  ────────────────────────────────────────────────── │
│  INSERT INTO field_evidence (                       │
│    vehicle_id, field_name, proposed_value,         │
│    source_type, source_confidence                  │
│  )                                                  │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  3. BUILD CONSENSUS                                 │
│  ────────────────────────────────────────────────── │
│  SELECT build_field_consensus(                      │
│    vehicle_id, 'vin', auto_assign := true          │
│  )                                                  │
│                                                     │
│  Checks:                                            │
│  - All evidence for this field                      │
│  - Trust hierarchy (scraped = 70)                  │
│  - Conflicts with other sources?                   │
│  - Confidence threshold (85% ≥ 80% ✅)             │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  4. ASSIGN TO VEHICLE                               │
│  ────────────────────────────────────────────────── │
│  UPDATE vehicles                                    │
│  SET vin = 'TBD123456789'                          │
│  WHERE id = ?                                       │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  5. UPDATE PROVENANCE                               │
│  ────────────────────────────────────────────────── │
│  INSERT INTO vehicle_field_provenance (             │
│    vehicle_id, field_name, current_value,          │
│    total_confidence, primary_source                │
│  )                                                  │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  6. AUDIT TRAIL                                     │
│  ────────────────────────────────────────────────── │
│  INSERT INTO audit_actions (                        │
│    action_type, status, result, actual_cost        │
│  )                                                  │
└─────────────────────────────────────────────────────┘
```

## Continuous Improvement Loop

```
Day 1:  🔍 Audit → 127 vehicles need work
        ✅ Fix 38 vehicles
        ⏸️  12 need approval

Day 2:  🔍 Audit → 89 vehicles need work (-38)
        ✅ Fix 42 vehicles
        ⏸️  8 need approval

Day 3:  🔍 Audit → 47 vehicles need work (-42)
        ✅ Fix 35 vehicles
        ⏸️  5 need approval

Day 7:  🔍 Audit → 12 vehicles need work
        ✅ Fix 10 vehicles
        ⏸️  2 need approval

Day 30: 🔍 Audit → 0 vehicles need work
        🎉 Database clean!
        🔄 Switch to maintenance mode
```

---

**This is how your autonomous auditor works end-to-end.**

Every action logged. Every decision gated. Every change validated.

**Run `npm run audit` and watch it happen.**

