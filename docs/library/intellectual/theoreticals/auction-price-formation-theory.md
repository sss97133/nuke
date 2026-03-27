# Auction Price Formation Theory: Why Deals Happen and Why You Can Overpay Anywhere

**Status**: Theoretical -- no implementation, pure research framework
**Author**: Nuke Research
**Date**: 2026-03-27
**Dependencies**: Valuation methodology, signal calculation, market-intelligence-patterns
**Domain**: Universal (any auction market with unique assets)
**Origin**: Analysis of ATM Auctions (Monroe, NC) -- a regional equipment liquidation house where vehicles are incidental lots, yet still sell at or near market value despite tiny audiences.

---

## Abstract

A regional equipment auction in Monroe, North Carolina has 50 people in folding chairs. Bring a Trailer has 100,000 registered users. Both produce final sale prices that converge on "market value" for collector vehicles with surprising regularity. This should not happen. If price is a function of demand, and demand is a function of audience size, then BaT should produce prices 2,000x higher than a folding-chair liquidation. It does not.

This paper proposes a theory of price formation in collector vehicle auctions: the **Competitive Bidder Threshold** (CBT). The core claim is that efficient price discovery in an English auction requires not thousands of participants, but a remarkably small number of **motivated, informed bidders** -- typically 4 to 5. Above this threshold, additional bidders contribute negligible price pressure. Below it, prices become volatile and unpredictable in both directions.

This threshold explains three phenomena that the Nuke valuation methodology must account for:

1. **Why deals happen**: When fewer than 4 informed bidders attend, the winning bid can fall 30-50% below market. The asset was not cheap -- the room was empty.
2. **Why overpaying happens everywhere**: When 2+ bidders with emotional attachment compete past rational exit points, final price exceeds market regardless of venue prestige. BaT bidding wars between dentists produce the same irrational premium as two locals fighting over a K10 at an estate sale.
3. **Why venue size is a poor predictor of final price**: A 50-person auction and a 100,000-person auction produce statistically similar final prices for equivalent assets, because the price-setting mechanism depends on the top 4-5 bidders, not the total audience.

---

## Part I: The Competitive Bidder Threshold

### 1.1 English Auction Price Dynamics

In an English ascending auction (the dominant format for both BaT and folding-chair liquidations), the final price is determined not by the winner's valuation, but by the **second-highest bidder's exit point**. This is William Vickrey's fundamental insight (1961): the winner pays just enough to exceed the runner-up's maximum willingness to pay.

This means total audience size is irrelevant to price formation. What matters is the distribution of the top valuations in the room.

Define:
- `V1` = highest bidder's private valuation (what they would pay if forced)
- `V2` = second-highest bidder's private valuation
- `P_final` = hammer price

In a pure English auction: `P_final ~ V2` (approximately the second-highest valuation, plus one bid increment).

The winner captures surplus: `V1 - P_final`. Everyone else captures nothing.

### 1.2 Why 4-5 Bidders Is the Threshold

If price is set by V2, then having more bidders only matters if they shift V2 upward. Consider the distribution of private valuations for a collector vehicle:

```
Bidder population for a 1977 K5 Blazer:

Regional auction (50 people):
  - 45 are here for tractors. V_vehicle = $0 (no interest)
  - 3 think "cool truck" but have a soft ceiling of $8-12K
  - 2 know exactly what it is and value it at $18-25K

BaT (100,000 registered, ~500 watching this listing):
  - 480 are browsing, not bidding. V = $0
  - 12 place early bids in the $8-15K range
  - 5 are serious, informed bidders with V = $18-30K
  - 3 have emotional attachment and V = $25-40K
```

In both cases, the final price is set by the competition between the top 4-5 bidders. The 45 tractor guys and the 480 browsers are noise -- they never place a bid that moves the price past the serious bidders' floor.

The threshold is not arbitrary. It emerges from the statistical property that **adding bidders from the general population has diminishing returns on the maximum order statistic** once you have sampled enough from the tail of the valuation distribution.

Formally: if private valuations are drawn from a distribution F(v), the expected value of the k-th highest order statistic from n draws converges rapidly. Going from n=5 to n=500 shifts E[V2] by far less than going from n=1 to n=5.

### 1.3 The Threshold Is About Informed Bidders, Not Total Bidders

The critical distinction is between:

- **Informed bidders**: Know the market, have recent comp awareness, understand condition implications, have pre-established valuation anchors. Their private valuations cluster around true market value.
- **Uninformed bidders**: Casual interest, no comp awareness, valuation based on vibes. Their bids are noise that falls below the informed cluster.
- **Emotional bidders**: Informed but irrational. Their valuations exceed market due to personal attachment, competitive arousal, or sunk-cost escalation. They set V1 (and sometimes V2) above rational market.

The CBT of 4-5 refers to *informed* bidders. You need enough informed participants that V2 (second-highest informed valuation) approximates market consensus. Below this threshold, V2 is set by an uninformed bidder or there is no V2, and the price decouples from market.

---

## Part II: Why Deals Happen

### 2.1 The Empty Room Problem

A "deal" in the collector vehicle market is not a function of the vehicle being undervalued by the market. It is a function of the **room being under-attended by informed bidders on that specific day**.

Consider the ATM Auctions scenario:

```
Lot 147: 1972 Chevrolet C10, short bed, 350/TH350, patina driver
Market value (BaT comp range): $18,000 - $24,000

Scenario A: 3 informed bidders present
  V1 = $22,000, V2 = $19,000, V3 = $14,000
  P_final ~ $19,500
  Result: Fair market price

Scenario B: 1 informed bidder present
  V1 = $22,000, V2 = $8,000 (tractor guy who thinks it's cool)
  P_final ~ $8,500
  Result: "Deal" -- 55% below market

Scenario C: 0 informed bidders present
  V1 = $6,000 (flipper), V2 = $4,500 (parts guy)
  P_final ~ $5,000
  Result: Extreme deal -- asset mispriced by information absence
```

The vehicle is identical. The "deal" is entirely a function of who showed up. This is not market inefficiency in the EMH sense -- it is **information distribution failure**. The market knows this truck is worth $20K. The room does not, because the room is 50 people who came for John Deere equipment.

### 2.2 Structural Deal Generators

Certain auction formats systematically produce rooms with fewer informed vehicle bidders:

| Format | Why Informed Bidders Are Absent | Deal Probability |
|--------|--------------------------------|------------------|
| Estate liquidation | Vehicles are incidental lots; marketing targets equipment buyers | High |
| Farm dispersal | Same as above; audience is agricultural | High |
| Municipal surplus | Audience is fleet buyers, not collectors | Moderate |
| No-reserve general consignment | Mixed lots dilute specialist attention | Moderate |
| Specialty collector auction (Mecum, BaT) | Marketing explicitly targets vehicle collectors | Low |
| Curated collector auction (RM Sotheby's) | Invitational; every attendee is informed | Very Low |

The deal probability is inversely correlated with the **specificity of audience curation**. BaT's entire business model is assembling 4-5 informed bidders for every listing. ATM's business model is moving volume -- assembling informed bidders for any specific lot is incidental.

### 2.3 The Information Asymmetry Discount

In estate liquidations, there is a secondary deal mechanism: the **seller does not know what they have**. The estate executor (often a family member or attorney) has no vehicle expertise. They set no reserve, provide no description, and take the first photo from the worst angle. The listing says "1972 Chevy truck, runs."

This is the inverse of Market Intelligence Finding #1 (presentation drives price): anti-presentation destroys price. The vehicle's value is hidden behind a wall of missing information, and informed bidders who can see through it are rewarded.

This creates an exploitable signal: **vehicles with the worst presentation at non-specialist auctions have the highest expected return**, because the information discount exceeds the condition discount.

---

## Part III: Why You Can Overpay Anywhere

### 3.1 Emotional Escalation

The same mechanism that produces deals at regional auctions produces overpayment at prestige auctions. When two or more bidders with **emotional attachment** compete, the final price is set not by rational V2 but by the point where one bidder's emotional ceiling exceeds the other's.

```
BaT listing: 1985 Toyota Land Cruiser FJ60, 1-owner, 40K miles

Rational market (comp range): $45,000 - $55,000

Bidder A: "I had one of these in college. My kids need to grow up with one."
  V_emotional = $78,000

Bidder B: "This is the cleanest FJ60 I have ever seen. I will not lose this."
  V_emotional = $82,000

P_final = $79,000
Market premium: +55%
```

This is not irrational in the behavioral economics sense -- both bidders are maximizing a utility function that includes non-monetary value (nostalgia, identity, competitive satisfaction). But it produces prices that exceed any comp-based valuation.

### 3.2 The Comment Thread Amplifier

BaT's unique contribution to overpayment is the **comment thread as social proof accelerator**. From Finding #3 (comments predict price):

- Comments generate attention
- Attention generates more comments
- Comment sentiment ("best one I've seen on BaT") creates social validation
- Social validation raises emotional bidders' ceiling
- Higher ceilings produce higher V2
- Higher V2 produces higher P_final

This is a positive feedback loop that does not exist in folding-chair auctions. ATM has no comment thread. The emotional bidder at ATM fights only one opponent. The emotional bidder on BaT fights one opponent while 200 people cheer them on.

### 3.3 The Winner's Curse in Thin Markets

In auctions with common-value elements (the vehicle has an objective market value that all bidders are trying to estimate), the winner is systematically the bidder who most overestimates the value. This is the classic winner's curse (Thaler, 1988).

The curse is most severe in **thin markets** -- auctions with few bidders and high uncertainty about true value. Both the folding-chair auction and the prestige auction can be thin in this sense:

- At ATM: thin because few bidders, uncertain condition, no inspection opportunity
- At BaT: thin because the vehicle is rare (few comps), condition is seller-reported, and the comment thread creates false confidence

The winner's curse predicts that winning bidders overpay relative to true market value, on average, across all venue types. The magnitude depends on uncertainty, not venue prestige.

---

## Part IV: Implications for Nuke

### 4.1 Valuation Model Adjustments

The current Nuke Estimate (see: valuation-methodology) uses CompBase as the foundation: find similar vehicles that sold, weight by similarity, compute a value. But CompBase treats every final price as equally informative. It should not.

A final price from a sale with:
- **5+ informed bidders** (BaT with 100+ comments) approximates true market and should receive full weight
- **2-3 informed bidders** (typical BaT listing) is slightly below true market due to thin competition
- **1 informed bidder** (estate liquidation) is a deal price and should be flagged as below-market
- **0 informed bidders** should be excluded from comp calculations entirely

The number of informed bidders is not directly observable but can be proxied by:
- Comment count and sentiment (BaT)
- Bid count and velocity (any platform with bid data)
- Venue type (collector auction vs. equipment liquidation)
- Listing quality (high-quality presentation = more informed attention)

### 4.2 Sourcing Strategy

For acquisition (buying vehicles to flip or hold), the CBT theory suggests:

**Maximize your informed bidder advantage.**
- Target venues where you are one of fewer than 4 informed bidders
- Estate liquidations, farm dispersals, municipal surplus -- anywhere vehicles are incidental
- The more domain expertise you bring to a non-specialist auction, the wider your edge

**Avoid venues where emotional bidders cluster.**
- "Best one I've seen" comment threads on BaT
- No-reserve listings for culturally iconic models (FJ40, early Bronco, K5 Blazer)
- Any listing where the comment thread has become a community event

**The paradox of monitoring:** If you build a system that efficiently alerts informed bidders to underpriced lots at regional auctions, you destroy the information asymmetry that produced the deal. Nuke's existence as a comprehensive vehicle data platform is itself a market-making force.

### 4.3 Source Trust Calibration

The observation_sources trust_score should account for price formation dynamics:

| Source Type | Price Signal Reliability | Trust for Comps |
|-------------|--------------------------|-----------------|
| Curated collector (RM Sotheby's, Gooding) | Very high (deep informed pool, vetted consignments) | 0.90 |
| Open collector (BaT, C&B) | High (large informed pool, variable emotional premium) | 0.80 |
| General automotive (eBay Motors, Craigslist) | Moderate (mixed audience, ask vs. sale ambiguity) | 0.60 |
| Regional equipment/estate (ATM, local houses) | Low-moderate (thin informed pool, high variance) | 0.40-0.55 |
| Municipal/fleet surplus | Low (fleet buyers, no collector premium) | 0.30 |

ATM's current trust_score of 0.40 is appropriate: the prices are real transaction data, but the audience composition makes them unreliable as market indicators for collector value.

---

## Part V: The Research Frontier

### 5.1 Open Questions

**Q1: What is the actual CBT number?**
Theory suggests 4-5, but this needs empirical validation. If Nuke collected bid-level data (number of unique bidders, bid timing, bid velocity), we could compute the inflection point where additional bidders stop moving the final price. BaT's public bid history makes this testable.

**Q2: Does the CBT vary by price segment?**
A $5,000 truck might reach efficient pricing with 3 bidders (smaller pool of potential buyers, lower stakes). A $500,000 Ferrari might require 6-7 (wealth filtering reduces the informed pool). Is CBT a function of price, rarity, or both?

**Q3: Can we detect emotional escalation in real-time?**
If bid velocity accelerates in the final minutes and exceeds the comp-predicted ceiling, the final price is likely emotion-driven. Can we build a signal that identifies when a BaT auction has crossed from rational to emotional, in real-time?

**Q4: Is there a "reverse CBT" for selling?**
If you are selling a vehicle, you want to maximize the number of informed bidders (to push V2 up to market) while minimizing emotional ceiling-raisers (who attract other emotional bidders, but whose presence is unpredictable). The optimal selling venue maximizes informed attendance, not total attendance.

**Q5: Does platform design affect price formation?**
BaT's 7-day auction with public comments creates fundamentally different dynamics than a live auction with 60-second lots. Does the extended timeline increase or decrease the CBT? Does public bidding (vs. sealed-bid) change the emotional escalation pattern? Does no-reserve vs. reserve shift the CBT by changing bidder strategy?

**Q6: How do you value a "deal" in retrospect?**
If a 1972 C10 sold for $8,500 at an estate liquidation but comps suggest $20,000, which price is "real"? Both are actual transactions. The $8,500 buyer would resell it for $18,000 on BaT six months later. The comp engine should understand that the estate price was informationally impoverished, not that the vehicle was worth $8,500.

**Q7: Can regional auction monitoring be systematized at scale?**
There are hundreds of ATM-equivalents across the US. Each runs 2-4 auctions per month. 95% of lots are irrelevant. The signal-to-noise ratio is terrible. But the rare signal (barn-find K5 in lot 147) is extremely high-value. Is the monitoring cost worth the expected deal frequency? What is the ROI calculation?

### 5.2 Data Requirements

To move from theory to empirical validation, Nuke needs:

1. **Bid-level data**: Number of unique bidders, bid amounts, bid timing (BaT provides this publicly)
2. **Bidder classification**: Proxy for informed vs. uninformed (bid timing, bid amount relative to comps, bidder history)
3. **Venue metadata**: Audience size, venue type, marketing reach, lot composition
4. **Matched pairs**: Same vehicle (or near-identical) sold at different venue types (estate vs. BaT) to isolate venue effect from vehicle effect
5. **Comment sentiment at scale**: Already partially built in comment_discoveries; needs to be correlated with final price deviation from comps

### 5.3 Connection to Other Theoreticals

- **Valuation Methodology**: CompBase should weight prices by estimated bidder depth. Estate prices get discounted; curated auction prices get full weight.
- **Signal Calculation**: Bidder activity (bid count, bid velocity, comment engagement) is a signal for price reliability. High-signal sales produce better comps.
- **Observation Half-Life**: A price observation from a thin-bidder auction decays faster than one from a deep-bidder auction, because it is less likely to represent persistent market consensus.
- **Organic Connection Theory**: The deal-finding problem is a discovery problem. How does an informed bidder find lot 147 at an auction marketed to tractor buyers? This is the organic connection problem applied to sourcing.
- **Entity Resolution**: The same vehicle appearing at an estate liquidation and later on BaT creates a natural experiment for measuring the venue effect on price.

---

## Decision Record

| Decision | Chosen | Alternative | Why |
|----------|--------|-------------|-----|
| Model price formation as CBT (threshold), not linear demand | CBT | Linear demand curve | Empirical observation: 50-person and 100K-person auctions produce similar prices. Linear demand would predict 2000x difference. |
| Classify bidders as informed/uninformed/emotional, not just count them | Tripartite classification | Binary (bidder/non-bidder) | Binary ignores the mechanism. The emotional bidder and the informed bidder produce opposite effects on price reliability. |
| Treat estate liquidation prices as informationally impoverished, not market signals | Discount | Equal weight | Using estate prices as comps would systematically undervalue vehicles. The price reflects room composition, not vehicle worth. |
| Keep this theoretical (no implementation) | Theory | Build deal-finding bot | Building a deal-finder that monitors 200 regional auctions is a large engineering project with unclear ROI. The theory should be validated with BaT bid data first. |

---

## Part VI: Empirical Harness

This section exists to prevent the paper from being unfalsifiable slop. Every claim above must be testable against real data. If it can't be tested, it doesn't belong here.

### 6.1 Data Inventory (as of 2026-03-27)

| Dataset | Count | Key Columns | Notes |
|---------|-------|-------------|-------|
| BaT vehicle_events | 159,340 | final_price (95K), bid_count (149K), comment_count (132K), watcher_count (18K) | Primary test corpus |
| auction_comments | 143K vehicles with bids | author_username, bid_amount, sentiment_score, expertise_score | Can reconstruct unique bidders per auction |
| comment_discoveries | per-vehicle | overall_sentiment, sentiment_score, data_quality_score | AI-extracted engagement signals |
| vehicles | 824K total, 324K with sale_price | make, model, year, sale_price | Cohort construction |
| Make/model cohorts with 10+ BaT sales | 1,428 | — | Sufficient for comp-deviation analysis |

### 6.2 Harness Tests

Each test has a **claim**, a **query**, a **pass condition**, and a **kill condition** (the result that would invalidate the theory).

---

**TEST 1: Bid count correlates with price, but with diminishing returns**

Claim: Additional bids increase final price, but the marginal effect diminishes above a threshold.

Baseline data (already computed):
```
Bid Bucket    | Vehicles | Avg Price
1-5 bids      |    1,925 |   $22,291
6-15 bids     |   14,945 |   $27,368
16-30 bids    |   38,225 |   $37,620
31-50 bids    |   29,994 |   $50,416
50+ bids      |    5,746 |   $88,170
```

This shows correlation but NOT diminishing returns — price keeps climbing. However, this conflates two effects: expensive vehicles attract more bids AND more bids push price up. We need to control for vehicle type.

**Controlled test** (run within cohort):
```sql
-- Price deviation from cohort median vs. bid count
-- Tests whether more bids = higher price WITHIN the same make/model
WITH cohort_medians AS (
  SELECT v.make, v.model,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY ve.final_price) as median_price,
    count(*) as cohort_size
  FROM vehicle_events ve
  JOIN vehicles v ON v.id = ve.vehicle_id
  WHERE ve.source_platform = 'bat' AND ve.final_price > 0
  GROUP BY v.make, v.model
  HAVING count(*) >= 20
),
deviations AS (
  SELECT
    ve.bid_count,
    (ve.final_price - cm.median_price) / cm.median_price as price_deviation,
    cm.cohort_size
  FROM vehicle_events ve
  JOIN vehicles v ON v.id = ve.vehicle_id
  JOIN cohort_medians cm ON cm.make = v.make AND cm.model = v.model
  WHERE ve.source_platform = 'bat' AND ve.final_price > 0 AND ve.bid_count > 0
)
SELECT
  CASE
    WHEN bid_count <= 10 THEN '01-10 bids'
    WHEN bid_count <= 20 THEN '11-20 bids'
    WHEN bid_count <= 30 THEN '21-30 bids'
    WHEN bid_count <= 40 THEN '31-40 bids'
    WHEN bid_count <= 50 THEN '41-50 bids'
    ELSE '50+ bids'
  END as bid_bucket,
  count(*) as n,
  round(avg(price_deviation)::numeric, 3) as avg_deviation,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price_deviation)::numeric, 3) as median_deviation
FROM deviations
GROUP BY 1
ORDER BY min(bid_count);
```

**Pass**: Average deviation increases with bid count but the *slope* flattens. Going from 10→20 bids matters more than 40→50.
**Kill**: Deviation increases linearly or accelerates with bid count. No threshold exists.

---

**TEST 2: Comment count predicts price deviation from cohort**

Claim: Higher comment counts push prices above cohort median, functioning as an attention/emotional amplifier.

Baseline data (already computed):
```
Comment Bucket     | Vehicles | Avg Price | Median Price
0-20 comments      |    1,183 |    $9,156 |      $4,500
21-50 comments     |   15,420 |   $18,664 |     $13,500
51-100 comments    |   39,646 |   $31,796 |     $21,750
101-200 comments   |   19,418 |   $57,397 |     $36,000
200+ comments      |    2,597 |  $187,138 |     $86,001
```

**Controlled test** (same cohort-deviation approach as Test 1 but using comment_count).

**Pass**: Vehicles with 100+ comments deviate positively from cohort median by >20%. This confirms the comment-thread-as-amplifier effect.
**Kill**: No correlation between comment count and cohort deviation after controlling for vehicle type. Comments reflect interest in the vehicle type, not price inflation.

---

**TEST 3: Unique bidder count has a saturation point**

Claim: The Competitive Bidder Threshold exists — above N unique bidders, final price stops increasing relative to cohort.

```sql
-- Unique bidders per vehicle vs. price deviation from cohort
WITH bidder_counts AS (
  SELECT vehicle_id, count(DISTINCT author_username) as unique_bidders
  FROM auction_comments
  WHERE bid_amount > 0
  GROUP BY vehicle_id
),
cohort_medians AS (
  SELECT v.make, v.model,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY ve.final_price) as median_price,
    count(*) as cohort_size
  FROM vehicle_events ve
  JOIN vehicles v ON v.id = ve.vehicle_id
  WHERE ve.source_platform = 'bat' AND ve.final_price > 0
  GROUP BY v.make, v.model
  HAVING count(*) >= 20
),
joined AS (
  SELECT
    bc.unique_bidders,
    (ve.final_price - cm.median_price) / cm.median_price as price_deviation
  FROM vehicle_events ve
  JOIN vehicles v ON v.id = ve.vehicle_id
  JOIN cohort_medians cm ON cm.make = v.make AND cm.model = v.model
  JOIN bidder_counts bc ON bc.vehicle_id = ve.vehicle_id
  WHERE ve.source_platform = 'bat' AND ve.final_price > 0
)
SELECT
  CASE
    WHEN unique_bidders <= 3 THEN '1-3 bidders'
    WHEN unique_bidders <= 5 THEN '4-5 bidders'
    WHEN unique_bidders <= 8 THEN '6-8 bidders'
    WHEN unique_bidders <= 12 THEN '9-12 bidders'
    WHEN unique_bidders <= 20 THEN '13-20 bidders'
    ELSE '20+ bidders'
  END as bidder_bucket,
  count(*) as n,
  round(avg(price_deviation)::numeric, 3) as avg_deviation,
  round(stddev(price_deviation)::numeric, 3) as deviation_stddev
FROM joined
GROUP BY 1
ORDER BY min(unique_bidders);
```

**Pass**: Avg deviation increases sharply from 1-3 to 4-5 bidders, then flattens. The stddev ALSO decreases (price becomes more predictable with more bidders). The CBT is empirically visible.
**Kill**: Deviation increases monotonically with no inflection point. Or deviation is random with respect to bidder count. CBT does not exist.

**THIS IS THE MOST IMPORTANT TEST.** If it kills, the entire paper is wrong and should be reclassified as a failed hypothesis. If it passes, the CBT number becomes an empirical constant we can use in valuation.

---

**TEST 4: Low-bidder auctions produce higher price variance**

Claim: Auctions with fewer bidders have more unpredictable outcomes — both deals AND overpays. The variance, not just the mean, is a function of bidder count.

```sql
-- Same as Test 3 but focus on stddev of price_deviation per bidder bucket
-- Already included in Test 3 query above (deviation_stddev column)
```

**Pass**: Stddev of price deviation is highest for 1-3 bidders and decreases monotonically as bidder count increases.
**Kill**: Stddev is constant across bidder buckets. Bidder count does not affect price predictability.

---

**TEST 5: Sentiment-price divergence detects emotional escalation**

Claim: When final price exceeds cohort median AND comment sentiment is extremely positive ("best one I've seen"), the premium is emotion-driven, not information-driven.

```sql
-- Correlate comment_discoveries sentiment with price deviation
WITH cohort_medians AS (
  SELECT v.make, v.model,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY ve.final_price) as median_price
  FROM vehicle_events ve
  JOIN vehicles v ON v.id = ve.vehicle_id
  WHERE ve.source_platform = 'bat' AND ve.final_price > 0
  GROUP BY v.make, v.model
  HAVING count(*) >= 20
)
SELECT
  cd.overall_sentiment,
  count(*) as n,
  round(avg((ve.final_price - cm.median_price) / cm.median_price)::numeric, 3) as avg_deviation,
  round(avg(ve.final_price)::numeric) as avg_price
FROM vehicle_events ve
JOIN vehicles v ON v.id = ve.vehicle_id
JOIN cohort_medians cm ON cm.make = v.make AND cm.model = v.model
JOIN comment_discoveries cd ON cd.vehicle_id = ve.vehicle_id
WHERE ve.source_platform = 'bat' AND ve.final_price > 0
  AND cd.overall_sentiment IS NOT NULL
GROUP BY cd.overall_sentiment
ORDER BY avg_deviation;
```

**Pass**: "Very Positive" or "Excited" sentiment correlates with >30% positive deviation from cohort. "Mixed" or "Cautious" sentiment correlates with negative or neutral deviation.
**Kill**: No meaningful correlation between sentiment and price deviation. Sentiment is noise.

---

**TEST 6: The "deal" price vs. "market" price for the same vehicle**

Claim: When the same vehicle (by VIN or entity resolution) sells at different venues or times, the price difference is attributable to venue/bidder composition, not vehicle change.

```sql
-- Find vehicles with multiple sale events and compare prices
SELECT
  v.id, v.year, v.make, v.model,
  array_agg(ve.source_platform ORDER BY ve.ended_at) as platforms,
  array_agg(ve.final_price ORDER BY ve.ended_at) as prices,
  array_agg(ve.bid_count ORDER BY ve.ended_at) as bid_counts,
  max(ve.final_price) - min(ve.final_price) as price_spread,
  round((max(ve.final_price) - min(ve.final_price))::numeric / nullif(min(ve.final_price), 0), 2) as spread_pct
FROM vehicle_events ve
JOIN vehicles v ON v.id = ve.vehicle_id
WHERE ve.final_price > 0
GROUP BY v.id, v.year, v.make, v.model
HAVING count(*) >= 2 AND max(ve.final_price) > min(ve.final_price) * 1.1
ORDER BY spread_pct DESC
LIMIT 50;
```

**Pass**: Vehicles that sold at low-bidder-count events and then resold at high-bidder-count events show a consistent price increase. The venue effect is real and measurable.
**Kill**: Price differences between re-sales are random and uncorrelated with bidder count. Vehicle condition change is the dominant factor, not venue.

Note: This test has a confound (vehicle condition may change between sales). Results are suggestive, not definitive. A stronger version requires matched pairs at different venues within the same month.

### 6.3 Running the Harness

The harness should be executable as a single script that outputs pass/fail for each test:

```bash
# Future: npm run research:cbt-harness
# Runs all 6 tests, outputs results table, flags kills
```

Until the script exists, each test can be run individually via psql. The queries above are copy-paste ready.

### 6.4 What a "Kill" Means

If Test 3 (the core CBT test) fails, the paper's central claim is wrong. The correct response is:

1. Mark the paper status as `Falsified` with the date and test results
2. Preserve the paper as a record of what was tested and why it failed
3. Investigate what the data actually shows — if not CBT, what IS the price formation mechanism?
4. Write a new paper based on what the data reveals

A theory that can be killed cleanly is worth more than one that can never be tested.

---

## For the Next Agent

The harness is the next step, not more theory. Run Tests 1-3 in order. If Test 3 passes (inflection point visible in the unique-bidder-count vs. price-deviation curve), the CBT is real and the paper stands. If it fails, the paper becomes a tombstone — a useful record of a wrong idea.

Do not build a regional auction scraper until Test 3 passes. The ROI depends on whether the CBT exists.

The ATM Auctions source (`observation_sources` slug: `atm-auctions`) is registered. It represents a whole category of sources (regional equipment liquidation) that we may want to monitor systematically in the future. For now, it is a user-explorable reference, not an active pipeline.
