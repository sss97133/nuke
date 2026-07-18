# Comment intelligence inventory

Date: 2026-05-26
Agent: Claude (autonomous build session)
Purpose: Document what's actually mineable in the comment data so the next product decision is informed, not guessed.

## TL;DR

You have a **massively under-surfaced comment intelligence layer**. 126,408 vehicles have Claude-Haiku-mined structured insights stored as JSONB. 224,369 individual comments have per-author persona signals. Together this is the load-bearing differentiator no other vehicle data company has — and it's not visible anywhere in the product UI right now.

The discovery pipeline last ran 2026-02-15. 3+ months stale, but the existing 126K is permanent value.

## What exists

### `auction_comments` (13.8M rows, 12 GB)

Raw + AI-enriched comment-level data per BaT comment. Fields populated by an analysis pass:

| Field | Purpose |
|---|---|
| `sentiment` (text) + `sentiment_score` (numeric) | Per-comment sentiment |
| `toxicity_score` | Flagged abuse signal |
| `expertise_indicators` (text[]) + `expertise_score` | Author technical credibility |
| `authenticity_score` | Are claims credible |
| `influence_score` | Audience engagement signal |
| `key_claims` (text[]) | Extracted verifiable assertions |
| `has_question` + `question_primary_l1` + `question_primary_l2` | Two-level question taxonomy |
| `question_categories` (jsonb) | Detailed question classification |
| `expertise_indicators` (text[]) | What domains they show knowledge of |
| `bid_amount` + `is_leading_bid` + `bid_increment` | Bid event linkage |

Coverage of these fields was not measurable due to statement_timeout — needs a pre-aggregated MV or sampled assessment to know how filled they are.

### `comment_discoveries` (126,408 rows, 403 MB)

**Per-vehicle aggregated AI discoveries from comment threads.** Each row covers all comments on one vehicle, mined by Claude-Haiku into a structured JSONB blob:

```jsonc
{
  "sentiment": {"score": 0.8, "overall": "positive", "mood_keywords": [...], "emotional_themes": ["joy", "appreciation", "nostalgia"]},
  "key_quotes": ["memorable comment 1", "memorable comment 2", ...],
  "market_signals": {"demand": "high", "rarity": "moderate", "price_trend": "rising", "value_factors": ["color rarity", "low mileage"]},
  "expert_insights": ["technical observation 1", ...],
  "price_sentiment": {"overall": "positive", "comments": "..."},
  "comparable_sales": ["mention 1", "mention 2"],
  "discussion_themes": ["Collector enthusiasm", "BMW Z8 appreciation", ...],
  "community_concerns": ["concern 1", "concern 2"],
  "seller_disclosures": ["disclosure 1", ...],
  "authenticity_discussion": {"concerns_raised": "...", "seller_responses": "..."}
}
```

Plus top-level normalized fields:
- `overall_sentiment` (indexed) — positive / mixed / neutral / negative
- `sentiment_score` (-1 to 1)
- `comment_count`, `total_fields`, `sale_price` (denormalized for ranking)
- `data_quality_score`, `missing_data_flags`, `recommended_sources`

### `comment_persona_signals` (224K rows, 94 MB)

**Per-comment author/intent profile**. AI-mined:

- 5 tone scores (helpful, technical, friendly, confident, snarky)
- expertise_level + expertise_areas
- intent classification
- buyer-type booleans: `is_serious_buyer`, `is_tire_kicker`, `is_seller_shill`
- behavior booleans: `asks_questions`, `answers_questions`, `gives_advice`, `makes_jokes`, `critiques_others`, `supports_others`
- claim booleans: `makes_claims`, `claims_verifiable`, `admits_uncertainty`

This is the layer for finding **experts in a niche**, **tire-kickers**, **shills**, and **mechanically credible commenters** at scale.

## What the data looks like aggregated

### Sentiment distribution (126K vehicles)

| Sentiment | Vehicles | Avg score | Avg comments per vehicle |
|---|---|---|---|
| positive | 116,113 | 0.84 | 84 |
| mixed | 8,839 | 0.36 | 72 |
| neutral | 1,035 | 0.01 | 46 |
| negative | 413 | -0.45 | 51 |
| very positive | 6 | 0.89 | 150 |
| excited | 2 | 0.80 | 150 |

**92% positive sentiment.** BaT commenters skew enthusiast-positive. The signal isn't "did it get hated" (almost nothing does) — it's "was it MIXED or NEGATIVE" (rare = standout). 413 vehicles got real negative feedback. Those are interesting outliers worth surfacing.

### Top discovered vehicles (200-comment threshold, sample)

| Vehicle | Sentiment | Score | Market Signals | Top Themes |
|---|---|---|---|---|
| 2002 BMW Z8 | positive | 0.85 | rising, high demand, rare | "Collector enthusiasm", "Investment potential" |
| 1989 BMW M3 S14 | positive | 0.75 | rare, low demand | "Price discussion", "Driving experience", "Technical discussion" |
| 1995 BMW M3 | positive | 0.86 | rare, rising | "Rarity premium", "Quality restoration", "Originality" |
| 1991 Mercedes 560SEC | positive | 0.77 | rare, rising | "Rarity premium", "Low mileage" |
| 1981 DeLorean DMC-12 | positive | 0.97 | rare, moderate demand | "Quality restoration", "Driving experience" |

The themes + value_factors are mineable structured filters. **Want to find every vehicle BaT commenters thought was "rising in price"?** That's a single JSONB query against 126K rows. Existing index `comment_discoveries_sentiment` covers sentiment but not the inner JSONB fields — would need a GIN index for fast jsonb path queries (separate migration).

## What's not surfaced

There's no UI page that exposes any of this. The existing components (`NukeEstimatePanel`, `VehiclePricingValueCard`, `VisualValuationBreakdown`) consume `nuke_estimates` not `comment_discoveries`. There's no /pulse or /themes or /community-signals page.

## Highest-leverage next moves (ranked)

### 1. Layer comment_discoveries into the new /valuation page (~1 hour build)
For each YMM lookup, also pull comment_discoveries aggregates: dominant themes across all matching vehicles, prevailing sentiment, common value_factors, recurring community concerns. Surface as a "What buyers say about {YMM}" card under the comparables table. This makes the valuation page substantially richer without changing its core purpose.

### 2. Add a vehicle-profile "pulse" widget (~half day)
On individual vehicle pages, render the per-vehicle comment_discovery as a "Community Pulse" section: sentiment + key_quotes + market_signals + community_concerns. This is the kind of thing collectors would actually pay for — "what does the BaT crowd think about this specific car." Zero new compute; the data is already mined.

### 3. Build the GIN index on comment_discoveries.raw_extraction (~5 min)
Without it, JSONB-path queries against the 126K-row table fight statement_timeouts. With a `CREATE INDEX ... USING gin (raw_extraction jsonb_path_ops)`, market_signals.demand and price_trend become fast filters. Required before #1 or any aggregate that searches inside the JSONB.

### 4. Revive the discovery pipeline (~unknown, depends on why it died)
Last `discovered_at`: 2026-02-15. Either the cron stopped, the source comments dried up (which we know — auction_comments last new row 2026-04-13), or the discovery edge function broke. Worth investigating but not blocking — 126K vehicles is enough to ship the surface.

### 5. Add a "negative review" surface (~2 hours)
There are 413 vehicles with overall_sentiment='negative'. These are the rare instances where BaT commenters torched a listing. Filterable browse: "What did the community reject?" Would be unique content that has clear demand (people Google "Bring a Trailer worst auctions").

## Why this matters

The mined comment intelligence is the **structural moat** of this dataset. Hagerty has prices, KBB has prices, BaT has comments raw. Nobody else has 126,408 vehicles' worth of structured "what did the community actually say" with key quotes, market signals, and community concerns extracted. The fact that this is invisible in the product is the actual product gap.

The /valuation page I shipped today is a hook. Comment intelligence is the substance. Pairing them — "here's what it sells for, and here's what the crowd says" — is something nobody else can build today.

## Sources

- Schema inspection: `\d auction_comments`, `\d comment_discoveries`, `\d comment_persona_signals`
- Aggregates: live `qkgaybvrernstplzjaam.supabase.co` via psql + service role, 2026-05-26
- Sample rows: included inline above (sentiment distribution, top discovered vehicles)
- Most queries against the 13.8M-row `auction_comments` timed out at 15s — true aggregates require either an MV pre-computation or batched-cursor analysis
