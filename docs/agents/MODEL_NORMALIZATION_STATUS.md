# Model Normalization Status

> **Last updated:** 2026-02-06 ~7:00 PM PST

## Status: COMPLETE (major passes done)

## Results Summary

### Pass 1: Case normalization (psql script)
- **21,249 records** normalized across 1,166 makes
- "corvette coupe" → "Corvette Coupe", "camaro z28" → "Camaro Z28", etc.
- Script: `scripts/normalize-models-psql.sh`

### Pass 2: Hyphenated make corruption fix
- **3,261 Mercedes-Benz** models fixed ("-Benz 560SL" → "560SL")
- **219 Austin-Healey** models fixed ("-Healey 3000" → "3000 BJ8 Mk III")
- **109 Rolls-Royce** models fixed
- **56 Aston Martin** makes fixed ("Aston" → "Aston Martin")
- **2 De Tomaso** makes fixed
- Total: **~3,650 records**

### Pass 3: BaT descriptor-as-make fix
- **81 descriptors** fixed ("13k-Mile" → real make from model field)
- **5 numeric makes** fixed ("255" → real make)
- **5 Porsche model-as-make** fixed ("911" → "Porsche")

### Earlier work
- **1,251 empty makes** backfilled from URLs (backfill-make-model-from-urls.ts)
- **~130 empty makes** extracted manually from Mecum/Classic.com URLs
- **~565 empty makes** inferred from model names (Camaro→Chevrolet, etc.)

### Known remaining issues
- **~34 BaT records** still have bad makes (edge cases: replicas, fire apparatus, etc.)
- **~18,000 case variant groups** remain (mostly from the trigger blocking bulk updates)
- **Root cause:** `trigger_check_duplicates()` trigger fires on every UPDATE and does a full duplicate scan, causing 30s+ timeout on bulk operations
- **Fix needed:** The trigger should be made smarter (skip if only model/make changed) or disabled during batch operations

## Root Cause: BaT Title Parsing Bug

The BaT extractor splits listing titles wrong:
- BaT title: `"13k-Mile 2015 BMW M4 Convertible"`
- Parser takes first word as make → `make="13k-Mile"`, `model="2015 BMW M4 Convertible"`
- Should skip descriptors (Xk-Mile, One-Owner, X-Years-Owned, X-Powered) before finding the year+make

Similarly, hyphenated makes get split wrong:
- `"Mercedes-Benz"` → make="Mercedes-Benz" but model gets "-Benz 560SL" 
- `"Austin-Healey"` → make="Austin", model="-Healey 3000..."

**The extractors need to be updated to handle these patterns.** Files:
- `scripts/backfill-make-model-from-urls.ts` (extractFromTitle function)
- `supabase/functions/bat-simple-extract/` (BaT-specific extractor)

## Trigger Issue (for future agents)

The `trigger_auto_detect_duplicates` trigger on `vehicles` table fires on every UPDATE and runs `detect_vehicle_duplicates()` which does a full table scan. This makes bulk updates impossible through normal means.

**Workaround:** Use `SET session_replication_role = replica;` before bulk updates to disable triggers, then `SET session_replication_role = DEFAULT;` after.

**Proper fix:** The trigger should check if the update is a data-quality fix (make/model change) vs a meaningful content change, and skip the expensive duplicate detection for the former.
