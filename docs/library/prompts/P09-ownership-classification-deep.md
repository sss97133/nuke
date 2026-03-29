# P09: Ownership Classification — Beyond Regex

## Context
Read these before executing:
- `docs/library/intellectual/papers/trust-scoring-methodology.md` — descriptions are testimony, not data
- `docs/library/intellectual/theoreticals/valuation-methodology.md` Part IV — provenance multiplier
- `docs/library/reference/encyclopedia/README.md` Section 18 — entity resolution and the Organization Sandbox
- `supabase/functions/extract-bat-core/index.ts` — current regex classifier (just added in P4)
- The epistemology of truth framework in memory: claims → consensus → inspection → scientific test

## Problem
The P4 ownership classifier uses 4 regex patterns. It classified 694 as owner, 780 as consigner, 2 as built. But 4,164 remain `sold_by` (unknown). BaT descriptions are written by BaT staff in a formulaic style — the ownership signal is almost always present, but the regex misses variant phrasings.

More fundamentally, the regex treats ownership as binary. Reality is a spectrum:
- **Pure owner**: Seller bought it, drove it, is selling it. ("acquired by the seller in 2019")
- **Flip**: Seller bought it recently specifically to resell. ("purchased by the selling dealer in January 2025" — 2 months ago)
- **Consignment with history**: Seller knows the car, took it on consignment from a friend. ("offered on behalf of a friend of the selling dealer")
- **Pure consignment**: Seller has no relationship to the car. ("consigned from the original owner")
- **Estate/collection**: Seller is handling a deceased person's assets. ("from the estate of" / "from the collection of")
- **Trade-in/wholesale**: Dealer took it as a trade-in on another sale. ("taken in trade")

The relationship_type CHECK constraint already supports these: `'owner'`, `'consigner'`, `'purchased_from'`, `'buyer'`. What's missing is the classification depth.

## Scope
One improved classification script. Updates to the regex classifier in extract-bat-core. No new tables. No LLM calls.

## Steps

1. Analyze the 4,164 unclassified descriptions to find missed patterns:
```sql
-- What phrases appear in unclassified vehicles?
-- Look for the standard BaT ownership sentence (usually 1st or 2nd sentence)
SELECT LEFT(v.description, 400)
FROM organization_vehicles ov
JOIN vehicles v ON v.id = ov.vehicle_id
WHERE ov.organization_id IN (SELECT organization_id FROM bat_seller_monitors)
  AND ov.relationship_type = 'sold_by'
  AND v.description IS NOT NULL
ORDER BY random()
LIMIT 30;
```

2. Build a comprehensive phrase catalog. Expected findings from BaT's formulaic style:
```
OWNER signals:
  "acquired by the seller/selling dealer in [year]"
  "purchased by the seller/selling dealer in [year]"
  "bought by the seller/selling dealer"
  "the seller/selling dealer purchased"
  "the seller/selling dealer acquired"
  "seller's/selling dealer's purchase"
  "has been in the seller's/selling dealer's care"
  "in the seller's/selling dealer's ownership"
  "the seller/selling dealer has owned"

CONSIGNMENT signals:
  "offered on behalf of"
  "consigned from"
  "consigned by"
  "is being offered on consignment"
  "sold on behalf of"
  "offered by the current owner"  (when seller != owner)

ESTATE signals:
  "from the estate of"
  "from the collection of"
  "deceased"
  "inherited"

TRADE-IN signals:
  "taken in trade"
  "trade-in"
  "acquired as part of"

FLIP signals (owner, but recent acquisition):
  - Detect by comparing seller acquisition date to listing date
  - If acquired < 6 months before listing → likely flip
  - Store as 'owner' but with metadata: { flip_likelihood: 'high' }
```

3. Update the regex in `extract-bat-core/index.ts` and `scripts/backfill-ownership-classification.mjs` with the expanded patterns.

4. Run the backfill. Expected result: unclassified should drop from 4,164 to < 500.

5. For the remaining unclassified, check if descriptions are NULL or too short:
```sql
SELECT
  count(*) FILTER (WHERE v.description IS NULL) as no_desc,
  count(*) FILTER (WHERE length(v.description) < 100) as short_desc,
  count(*) FILTER (WHERE length(v.description) >= 100) as has_desc_unclassified
FROM organization_vehicles ov
JOIN vehicles v ON v.id = ov.vehicle_id
WHERE ov.organization_id IN (SELECT organization_id FROM bat_seller_monitors)
  AND ov.relationship_type = 'sold_by';
```

Vehicles without descriptions are legitimately `sold_by` (unknown). Don't force-classify them.

## Verify
```sql
-- After expanded classification
SELECT relationship_type, count(*)
FROM organization_vehicles
WHERE organization_id IN (SELECT organization_id FROM bat_seller_monitors)
GROUP BY relationship_type
ORDER BY count DESC;
-- 'sold_by' should be < 1,000 (down from 4,164)
-- 'owner' should be > 2,000
-- 'consigner' should be > 1,000

-- Spot-check 10 random reclassified vehicles
SELECT v.id, LEFT(v.description, 300), ov.relationship_type
FROM organization_vehicles ov
JOIN vehicles v ON v.id = ov.vehicle_id
WHERE ov.organization_id IN (SELECT organization_id FROM bat_seller_monitors)
  AND ov.relationship_type IN ('owner', 'consigner')
  AND ov.auto_matched_at > now() - interval '1 hour'
ORDER BY random()
LIMIT 10;
-- Manually verify each one matches its classification
```

## Anti-Patterns
- Do NOT use LLM calls for classification. The BaT description format is formulaic enough that regex handles 95%+. The remaining 5% are genuinely ambiguous — force-classifying them would be fabrication.
- Do NOT classify based on seller username alone. "VintageCarDealer" might sell their personal car. Only the description text is evidence.
- Do NOT add new relationship_type values to the CHECK constraint. The existing values cover all cases. Map to the closest valid value.
- Do NOT try to classify non-BaT descriptions with BaT-specific patterns. The formulaic "acquired by the seller" phrasing is BaT staff editorial, not universal.

## Library Contribution
After completing:
- Add ownership classification methodology to `docs/library/intellectual/papers/` as a new paper
- Update `docs/library/reference/dictionary/README.md` — add definitions for "Flip", "Estate Sale", "Consignment", "Trade-In" as classification types
- Update `docs/library/reference/almanac/` with ownership distribution statistics per seller
