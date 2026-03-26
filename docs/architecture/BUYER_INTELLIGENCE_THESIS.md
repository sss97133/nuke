# Buyer Intelligence Thesis — Price Is Not a Statistic, It's a Story

## The Problem With Median (and Average)

Median price for a Porsche 911 is meaningless. A 911 can sell for $35K (996 with IMS issues) or $3.5M (1973 RS Lightweight). The "median" tells you nothing about what THIS car will sell for, because price is determined by WHO is in the room.

**Price is a probability distribution shaped by the presence of specific buyer types.**

---

## The Core Insight: Buyer Presence Changes Price Probability

When a known 911 collector is bidding on a BaT auction, the expected sale price shifts upward. Not because the car is worth more — because the COMPETITION dynamics change. A collector who has spent $2.4M on seven 911s in the last 3 years will bid differently than a first-time buyer.

This is studied in art markets. The paper we should find: first-time-to-market calculations in art auctions show that the presence of institutional buyers (museums, known collectors) shifts the price distribution by 15-40% compared to identical works without those buyers present.

**The same applies to collector vehicles.**

---

## What We Have (the raw material)

| Data | Count | What It Reveals |
|------|-------|-----------------|
| BaT user profiles | 515,096 | Username, location (from sales), join date |
| External identities | 517,040 | Cross-platform identity seeds |
| Auction comments | 11,669,325 | Bidding behavior, questions, expertise signals |
| Vehicles with bat_seller | ~63K | Seller inventory = dealer vs collector signal |
| Comment text | 11.6M rows | Bid amounts, questions about provenance, expertise |

### The Freebie: Buyers Who Also Sell

When a BaT buyer ALSO sells on BaT, we get:
- **Location** (from the sale listing — city, state)
- **Inventory** (what they own/owned)
- **Taste profile** (what makes/models/eras they collect)
- **Price tolerance** (what they've paid and what they've accepted)
- **Turnover rate** (how long they hold vehicles)

This is a GOLDMINE for buyer modeling.

---

## The Avenues

### 1. Buyer Segmentation (from comment + purchase analysis)

Parse the 11.6M comments to identify buyer types:

**The Collector** — bids on multiple vehicles of same make/era. Comments show deep knowledge ("matching numbers", "original paint", "Kardex"). Has purchased 3+ vehicles in 2 years.

**The Flipper** — buys and sells within 6 months. Comments focus on condition/price, not provenance. High transaction velocity.

**The Enthusiast** — comments extensively but bids rarely. When they DO bid, they're informed. Their presence signals quality (social proof).

**The Dealer** — sells frequently, buys strategically. Comments are transactional. Location reveals market territory.

**The Whale** — 5+ purchases over $100K. Their presence in an auction fundamentally changes the price ceiling.

### 2. Buyer-Adjusted Price Probability

Instead of "median price for 911": **"probability distribution of sale price given the identified bidder pool."**

If 3 known 911 collectors are commenting on a listing, the price distribution shifts right (higher). If only first-time buyers are present, it shifts left.

This requires:
- Identifying bidders from comment usernames
- Linking bidders to their purchase history
- Building buyer type profiles
- Computing price shift based on buyer composition

### 3. Comment Sentiment as Price Signal

BaT comments contain:
- **Bid amounts** (parseable: "Bid for $47,500")
- **Reserve complaints** ("reserve is too high") → price ceiling signal
- **Expertise signals** ("numbers matching per Kardex") → quality verification
- **Red flags called out** ("paint doesn't look original") → price depression
- **Emotional bidding** ("this is my dream car") → irrational premium signal

The comment_discoveries AI analysis already extracts sentiment. But we're not using it for price prediction.

### 4. Cross-Platform Buyer Identity

A buyer on BaT may also bid on Mecum, buy on C&B, browse on Hemmings. If we can link identities across platforms:
- Same username
- Same VIN purchased/sold
- Same geographic area + similar purchasing pattern

This gives us a COMPLETE buyer profile across the market, not just one platform.

### 5. First-Time-to-Market Premium (Art Market Paper)

The art market research shows:
- Works appearing at auction for the FIRST time command a premium
- Works that have been traded recently command LESS (market saturation)
- The size of the premium depends on the seller's reputation

**Vehicle analog:**
- A barn find (first time to market in decades) commands premium
- A car that's been flipped 3 times in 5 years is discounted
- A car from a known collector's estate commands premium

We CAN compute this: `vehicle_events` shows how many times a car has been auctioned. `auction_comments` show the narrative. `field_evidence` tracks ownership provenance.

### 6. Geographic Price Arbitrage

Same car, different price by region:
- BaT (national audience) vs Craigslist (local market)
- West Coast vs East Coast vs Midwest
- Urban vs rural

With buyer locations (from the sell-side freebie), we can map buyer density by make/model and identify arbitrage opportunities.

---

## The Think Tank: What to Build

### Phase 1: Buyer Profile Engine
- Parse comment authors → link to user profiles
- Track purchase history per buyer
- Segment into types (collector, flipper, enthusiast, dealer, whale)
- Store in `buyer_profiles` table with behavioral metrics

### Phase 2: Price Probability Model
- Replace median/average with probability distributions
- Input: vehicle specs + identified bidder pool + market conditions
- Output: P10/P25/P50/P75/P90 price range with confidence
- "This car has a 70% chance of selling between $85K-$120K given current bidder interest"

### Phase 3: Comment Intelligence
- Sentiment scoring per comment (already started in comment_discoveries)
- Bid extraction from comment text
- Expertise scoring per commenter
- Red flag detection aggregation
- Real-time comment velocity → price movement correlation

### Phase 4: Cross-Platform Identity Resolution
- Username matching across BaT/C&B/Mecum
- Geographic clustering
- Purchase pattern matching
- Build unified buyer profiles spanning all platforms

### Phase 5: Market Presence Indicator
- "3 known 911 collectors are watching this auction"
- "This seller has 100% positive completion rate across 12 sales"
- "First time to market — last sold privately in 1987"
- "Bidding velocity suggests reserve will be met in next 2 hours"

---

## Papers to Find

1. Art market first-time-to-market premium studies
2. Auction theory: winner's curse adjustments with known bidder types
3. Behavioral economics of competitive bidding
4. Network effects in collector markets (when a collector's purchase validates a model, others follow)
5. Price discovery in thin markets (low-volume vehicles where comps barely exist)

---

## The Vision

Every vehicle on Nuke doesn't just show a price. It shows a STORY:

"This 1973 Porsche 911 Carrera RS has been in 2 known collections. 4 identified 911 specialists are watching. Comment sentiment is 87% positive with 3 red flags addressed by the seller. Based on bidder composition, we estimate a 75% probability of selling between $580K-$720K. The last comparable (matching-numbers RS, 47K miles) sold 6 months ago for $640K — but that auction had only 1 specialist bidder present."

THAT is the ontological data. Not "median: $450K."
