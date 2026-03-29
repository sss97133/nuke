# P12: Valuation for Modified & Restored Vehicles

## Context
Read these before executing:
- `docs/library/intellectual/theoreticals/valuation-methodology.md` — the 6-multiplier model, especially Part III (Condition), Part IV (Provenance), Part VI (Institutional)
- `docs/library/intellectual/papers/market-intelligence-patterns.md` — Finding 5: survivor premium now beats restoration premium; Finding 1: presentation drives price
- `docs/library/intellectual/theoreticals/observation-half-life-model.md` — how condition observations decay
- `docs/library/reference/encyclopedia/README.md` — digital twin architecture, observation-as-testimony
- `supabase/functions/compute-vehicle-valuation/index.ts` — `getBasePrice` and the comp selection cascade

## Problem
The valuation engine treats all vehicles as factory-spec. A bone-stock 1973 Porsche 911T and a 1973 911T with a 3.6L engine swap, coilovers, RS-style flares, and Recaro seats get the same comp pool. The estimate for the modified car is meaningless — it's being compared against stock vehicles.

This is the second source of "wildly wrong" estimates (after the circularity bug fixed in P1). The comp selection in `getBasePrice` matches on year/make/model but has no concept of modification level.

The market intelligence paper documents this: modified vehicles exist in a parallel market. A restomod Blazer sells for $80-150K while a stock Blazer sells for $30-60K. Using stock comps for a restomod produces a $40K estimate on a $120K vehicle. The estimate is not "slightly off" — it's in a different universe.

## Scope
Schema enrichment (2 columns on vehicles). Comp selection logic update. No new tables. No new edge functions.

## Steps

1. Define modification classification taxonomy. Three levels from the market intelligence data:

```
STOCK: Factory-original or factory-equivalent restoration
  Signals: "numbers matching", "original", "factory", "restored to original spec",
           "matching numbers", "date-code correct", "concours"

MODIFIED: Significant non-factory changes that alter character
  Signals: "engine swap", "LS swap", "restomod", "custom", "built",
           "upgraded", "modified", "aftermarket", "coilovers", "turbo",
           "supercharged", "widebody", "custom interior"

SURVIVOR: Unrestored original, patina intact, factory wear
  Signals: "survivor", "barn find", "original paint", "unrestored",
           "patina", "time capsule", "untouched"
```

These are NOT condition grades. A modified vehicle can be in excellent condition. A survivor can be in poor condition. This is about what the vehicle IS, not how good it is.

2. Add classification columns to vehicles:
```sql
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS modification_level TEXT,
  ADD COLUMN IF NOT EXISTS modification_signals JSONB;

-- CHECK constraint for valid values
ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_modification_level_check
  CHECK (modification_level IS NULL OR modification_level = ANY(ARRAY[
    'stock', 'modified', 'survivor', 'restomod', 'pro_touring'
  ]));

COMMENT ON COLUMN vehicles.modification_level IS 'Classification of vehicle modification state. Affects comp pool selection for valuations. Owned by extract-bat-core.';
COMMENT ON COLUMN vehicles.modification_signals IS 'Evidence phrases from description that drove the modification classification. For audit.';
```

3. Build the classifier. This is regex on `vehicles.description`, similar to ownership classification:

```javascript
function classifyModification(description) {
  if (!description) return null;
  const desc = description.toLowerCase();
  const signals = [];

  // STOCK signals
  const stockPatterns = [
    /numbers[- ]matching/, /matching numbers/, /date[- ]code correct/,
    /restored to original/, /factory[- ]original/, /concours/,
    /factory spec/, /as delivered/, /original specification/
  ];

  // MODIFIED signals
  const modifiedPatterns = [
    /engine swap/, /ls\d? swap/, /ls[- ]swap/, /restomod/, /pro[- ]touring/,
    /custom build/, /custom[- ]built/, /turbo(charged)?/, /supercharged/,
    /widebody/, /wide[- ]body/, /coilover/, /air ride/,
    /aftermarket (engine|motor|transmission|trans)/, /crate engine/,
    /efi conversion/, /fuel injection conversion/, /disc brake conversion/
  ];

  // SURVIVOR signals
  const survivorPatterns = [
    /barn find/, /survivor/, /original paint/, /unrestored/,
    /patina/, /time capsule/, /untouched/, /never restored/,
    /all original/, /as found/
  ];

  let stockScore = 0, modScore = 0, survScore = 0;

  for (const p of stockPatterns) { if (p.test(desc)) { stockScore++; signals.push(p.source); } }
  for (const p of modifiedPatterns) { if (p.test(desc)) { modScore++; signals.push(p.source); } }
  for (const p of survivorPatterns) { if (p.test(desc)) { survScore++; signals.push(p.source); } }

  if (modScore > stockScore && modScore > survScore) return { level: 'modified', signals };
  if (survScore > stockScore && survScore > modScore) return { level: 'survivor', signals };
  if (stockScore > 0) return { level: 'stock', signals };
  return null; // ambiguous — don't classify
}
```

4. Update `getBasePrice` in `compute-vehicle-valuation/index.ts`:

Currently the comp cascade is: exact VIN → canonical Y/M/M → normalized model → core model → make fallback.

Add a pre-filter: if `vehicle.modification_level` is set, filter comps to same modification level:
```typescript
// In getBasePrice, after initial comp query:
if (vehicle.modification_level === 'modified' || vehicle.modification_level === 'restomod') {
  // Only use comps that are also modified/restomod
  // Fall through to wider pool only if no modified comps exist
  const modifiedComps = comps.filter(c => c.modification_level === 'modified' || c.modification_level === 'restomod');
  if (modifiedComps.length >= 3) {
    comps = modifiedComps;
    compMethod = compMethod + '_mod_filtered';
  }
  // else: fall through to full pool with a confidence penalty
}
```

When no modified comps exist, keep the full pool but apply a confidence penalty:
```typescript
if (vehicle.modification_level === 'modified' && !hasModifiedComps) {
  confidence = Math.min(confidence, 30);
  // The estimate is based on stock comps applied to a modified vehicle — essentially useless
}
```

5. Backfill classification:
```bash
# Script: scripts/backfill-modification-classification.mjs
# Reads vehicles.description, classifies, updates vehicles.modification_level + modification_signals
# Batch 1000, pg_sleep(0.1)
```

6. Add classification to `extract-bat-core/index.ts` — run after description extraction, same pattern as ownership classifier.

## Verify
```sql
-- Classification distribution
SELECT modification_level, count(*)
FROM vehicles
WHERE modification_level IS NOT NULL
GROUP BY modification_level;
-- Expect: stock ~40%, modified ~15%, survivor ~5%, NULL ~40% (no signal)

-- Spot-check modified classifications
SELECT id, year, make, model, LEFT(description, 200), modification_level, modification_signals
FROM vehicles
WHERE modification_level = 'modified'
ORDER BY random() LIMIT 10;
-- Manually verify each one is actually modified

-- Comp pool change: for a known restomod, check if comps are now modified-only
-- (Test by calling compute-vehicle-valuation on a known restomod vehicle)
```

## Anti-Patterns
- Do NOT treat modification_level as a quality grade. A modified vehicle is not "worse" than stock. The market for restomods is large and well-documented. The problem is comp pool separation, not value judgment.
- Do NOT use image analysis for classification yet. Description text is sufficient for 90%+ of vehicles. Image-based modification detection is a future enhancement (YONO zone classifier already exists).
- Do NOT create separate valuation functions for modified vehicles. The same multiplier model applies — just with different comps.
- Do NOT classify based on price. A $5K truck is not automatically "stock" and a $100K truck is not automatically "modified." Price is an output, not an input.
- Do NOT try to quantify the modification. "LS swap" and "rebuilt original 350" are both engine work, but one changes the vehicle's market segment and the other doesn't. The classifier catches the segment change, not the work itself.

## Library Contribution
After completing:
- Add "Modified Vehicle Valuation" paper to `docs/library/intellectual/papers/`
- Update `docs/library/intellectual/theoreticals/valuation-methodology.md` — add Section on comp pool segmentation
- Update `docs/library/reference/dictionary/README.md` — add "Modification Level", "Restomod", "Survivor", "Pro-Touring" definitions
- Update `docs/library/reference/almanac/` with modification distribution statistics
- Update `docs/library/intellectual/papers/market-intelligence-patterns.md` — add Finding on modification premium by segment
