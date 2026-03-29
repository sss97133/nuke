# P10: Organization Reputation Signal

## Context
Read these before executing:
- `docs/library/intellectual/papers/trust-scoring-methodology.md` — source trust hierarchy, temporal decay
- `docs/library/intellectual/papers/market-intelligence-patterns.md` — Finding 3: comments predict price; Finding 1: presentation drives price
- `docs/library/intellectual/papers/user-simulation-methodology.md` — stylometric fingerprinting, persona signals
- `docs/library/intellectual/theoreticals/valuation-methodology.md` Part VI — institutional multiplier
- `docs/library/reference/encyclopedia/README.md` Section 18 — Organization Sandbox
- `nuke_frontend/src/services/profileStatsService.ts` — seller_track_record, org_data_quality (P08)

## Problem
The valuation methodology paper defines an "Institutional Multiplier" — vehicles sold through prestigious auction houses command premiums. But we only model this at the platform level (RM Sotheby's > BaT > Craigslist). We don't model it at the individual seller level.

A vehicle sold by 911r (reputation: specialist, 1,373 vehicles, deep Porsche knowledge, community following) should have a different institutional signal than the same vehicle sold by an unknown first-time BaT seller. The data to compute this already exists — we just don't synthesize it.

The reputation signal is NOT a vanity metric. It feeds back into valuations. It informs buyer confidence. It is the dealer-level equivalent of what the trust-scoring paper calls "source credibility."

## Scope
One service function. One database column (denormalized). Frontend rendering in org profile. No new tables. No new edge functions.

## Steps

1. Define the reputation signal dimensions. Each is computable from existing data:

**Dimension 1: Sale Volume Consistency** (0.0 - 1.0)
- Monthly listing cadence over trailing 24 months
- Score = 1.0 if active every month, decays toward 0.0 for sporadic sellers
- Source: `vehicle_events` timestamps grouped by month
```sql
SELECT date_trunc('month', ended_at) as month, count(*)
FROM vehicle_events
WHERE source_organization_id = $org_id AND source_platform = 'bat'
  AND ended_at > now() - interval '24 months'
GROUP BY 1 ORDER BY 1;
```

**Dimension 2: Sale Success Rate** (0.0 - 1.0)
- Percentage of listings that resulted in a sale (vs. reserve not met, withdrawn)
- Source: `vehicle_events.event_status`
```sql
SELECT
  count(*) FILTER (WHERE event_status = 'sold') as sold,
  count(*) as total
FROM vehicle_events
WHERE source_organization_id = $org_id AND source_platform = 'bat';
```

**Dimension 3: Description Accuracy** (0.0 - 1.0)
- For vehicles with both org description and independent verification (inspection reports, registry data), how accurate was the description?
- Proxy until we have verification data: description length + field completeness
- Vehicles with descriptions > 500 words and 80%+ field fill = 1.0
- Vehicles with no description = 0.0
```sql
SELECT
  avg(CASE WHEN length(v.description) > 500 THEN 1.0
       WHEN length(v.description) > 200 THEN 0.7
       WHEN length(v.description) > 50 THEN 0.4
       ELSE 0.0 END) as desc_quality
FROM organization_vehicles ov
JOIN vehicles v ON v.id = ov.vehicle_id
WHERE ov.organization_id = $org_id;
```

**Dimension 4: Community Engagement** (0.0 - 1.0)
- Average comment count on their listings, normalized against platform median
- High comments = community interest = reputation signal
- Source: `vehicle_events.comment_count` or `auction_events.comment_count`
```sql
SELECT avg(ve.comment_count) as avg_comments
FROM vehicle_events ve
WHERE ve.source_organization_id = $org_id AND ve.source_platform = 'bat'
  AND ve.comment_count IS NOT NULL;
-- Compare to platform median:
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY comment_count)
FROM vehicle_events WHERE source_platform = 'bat' AND comment_count IS NOT NULL;
```

**Dimension 5: Price Achievement** (0.0 - 1.0)
- For vehicles with non-circular estimates, how do sale prices compare?
- sale_price / nuke_estimate ratio, capped at 1.0
- Consistently selling above estimate = strong reputation
- Source: `nuke_estimates` + `vehicles.sale_price`
```sql
SELECT avg(LEAST(v.sale_price / NULLIF(ne.estimated_value, 0), 1.5)) as price_achievement
FROM organization_vehicles ov
JOIN vehicles v ON v.id = ov.vehicle_id
JOIN nuke_estimates ne ON ne.vehicle_id = v.id
WHERE ov.organization_id = $org_id
  AND v.sale_price > 0 AND ne.estimated_value > 0
  AND ne.is_circular IS NOT TRUE;
```

2. Composite reputation score:
```
reputation = (volume_consistency * 0.15)
           + (success_rate * 0.25)
           + (description_accuracy * 0.20)
           + (community_engagement * 0.15)
           + (price_achievement * 0.25)
```

Weights reflect the trust-scoring paper's hierarchy: outcome data (success rate, price achievement) > presentation data (description) > activity data (volume, engagement).

3. Add to `profileStatsService.ts`:
```typescript
export interface OrgReputationSignal {
  composite_score: number;         // 0.0 - 1.0
  label: 'established' | 'active' | 'emerging' | 'insufficient';
  dimensions: {
    volume_consistency: number;
    success_rate: number;
    description_accuracy: number;
    community_engagement: number;
    price_achievement: number;
  };
  sample_size: number;             // total vehicles scored
  computed_at: string;
}
```

Label thresholds:
- `>= 0.75` → `established` (minimum 50 vehicles)
- `>= 0.50` → `active` (minimum 20 vehicles)
- `>= 0.25` → `emerging` (minimum 5 vehicles)
- `< 0.25 or < 5 vehicles` → `insufficient`

4. Denormalize to `businesses` table for fast access:
```sql
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS reputation_score NUMERIC,
  ADD COLUMN IF NOT EXISTS reputation_label TEXT,
  ADD COLUMN IF NOT EXISTS reputation_computed_at TIMESTAMPTZ;
```

5. Render in org profile overview tab — a single line above the sold vehicles table:
```
REPUTATION: ESTABLISHED (0.82)
Volume 0.91 · Success 0.87 · Descriptions 0.74 · Engagement 0.68 · Price Achievement 0.89
Based on 694 vehicles over 4 years
```

6. Feed back into valuations. In `compute-vehicle-valuation/index.ts`, the `InstitutionalMultiplier` currently only considers platform prestige. Add seller reputation as a sub-signal:
```typescript
// In getInstitutionalMultiplier or equivalent:
// Look up org reputation for the seller
const orgId = vehicle_event?.source_organization_id;
if (orgId) {
  const { data: org } = await supabase.from('businesses')
    .select('reputation_score').eq('id', orgId).maybeSingle();
  if (org?.reputation_score >= 0.75) institutionalMultiplier *= 1.03; // 3% premium
  if (org?.reputation_score >= 0.90) institutionalMultiplier *= 1.02; // additional 2%
}
```

Conservative multipliers. The reputation signal should not move valuations by more than 5%.

## Verify
```sql
-- After computing reputation for all 6 monitored sellers:
SELECT b.business_name, b.reputation_score, b.reputation_label
FROM businesses b
WHERE b.id IN (SELECT organization_id FROM bat_seller_monitors);
-- All 6 should have scores. Labels should vary.

-- Sanity check: 911r (Porsche specialist, 1,373 vehicles) should score higher
-- than Viva Las Vegas (55 vehicles, lower volume consistency)
```

Load the Viva org profile — reputation line should appear. Load 911r profile — should show "ESTABLISHED" with higher score.

## Anti-Patterns
- Do NOT weight volume itself. A dealer that listed 5,000 Craigslist beaters has high volume but low signal. Volume consistency (regular cadence) matters, not raw count.
- Do NOT use comment sentiment. The user-simulation paper shows sentiment analysis at the comment level is unreliable (r = 0.3-0.4). Use comment COUNT (engagement) not comment CONTENT.
- Do NOT set the valuation multiplier above 1.05. Reputation should be a mild tiebreaker, not a price driver. The methodology paper is clear: comps dominate.
- Do NOT compute reputation for platform-level orgs (BaT, C&B, Mecum). They are not sellers — they are marketplaces. Filter by `business_type != 'auction_platform'`.
- Do NOT create a leaderboard. Reputation is per-org context, not a ranking system. Rankings incentivize gaming.

## Library Contribution
After completing:
- Add "Organization Reputation Signal" paper to `docs/library/intellectual/papers/`
- Update `docs/library/intellectual/theoreticals/valuation-methodology.md` — add reputation to the Institutional Multiplier section
- Update `docs/library/reference/dictionary/README.md` — add "Reputation Signal", "Established Seller", "Volume Consistency" definitions
- Update `docs/library/reference/almanac/` with reputation score distributions
