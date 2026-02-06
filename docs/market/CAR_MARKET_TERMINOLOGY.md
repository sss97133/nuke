# The Wall Street of Car Trading

## Market Terminology

### Transaction Costs (The Spread)

| Term | Definition | Example |
|------|------------|---------|
| **Hammer Price** | Final bid amount before fees | $500,000 |
| **Buyer's Premium** | Fee charged to buyer on top of hammer | 5-12% |
| **Seller's Commission** | Fee taken from seller's proceeds | 0-10% |
| **Total Spread** | Combined buyer + seller fees | The "cost of trading" |
| **Effective Rate** | Total spread as % of hammer | True transaction cost |
| **Fee Cap** | Maximum fee regardless of price | BaT's $7,500 cap |
| **Cap Zone** | Price range where cap kicks in | $150K+ on BaT |

### Market Venues (Exchanges)

| Venue Type | Examples | Characteristics |
|------------|----------|-----------------|
| **Online Auction** | BaT, C&B, PCarMarket | Low fees, capped, global reach |
| **Live Auction** | RM Sotheby's, Mecum, Gooding | High fees, no cap, event-driven |
| **Hybrid** | Barrett-Jackson | Live + online bidding |
| **Private Treaty** | Dealers, brokers | Negotiated, opaque pricing |
| **P2P** | Facebook, Craigslist | Zero fees, high friction |

### Liquidity Metrics

| Term | Definition | Why It Matters |
|------|------------|----------------|
| **Sell-Through Rate** | % of lots that actually sell | Market health indicator |
| **Days on Market** | Time from list to sale | Liquidity measure |
| **Bid Depth** | Number of active bidders | Demand signal |
| **Comment Velocity** | Comments per hour | Engagement/heat |
| **Reserve Met %** | How often reserves are hit | Seller expectations vs market |

### Price Discovery

| Term | Definition |
|------|------------|
| **Price Discovery** | Process of finding market value through bidding |
| **Bid-Ask Spread** | Gap between seller's reserve and highest bid |
| **Market Clearing Price** | Where supply meets demand |
| **Hammer Ratio** | Final price / opening bid |
| **Estimate Accuracy** | Hammer / pre-sale estimate |

### Participant Types

| Type | Behavior | Fee Sensitivity |
|------|----------|-----------------|
| **Collector** | Buy and hold, quality-focused | Low |
| **Flipper** | Quick turnover, margin-focused | High |
| **Dealer** | Inventory building | Medium |
| **End User** | Buying to drive/enjoy | Medium |
| **Investor** | Asset allocation, appreciation | Low |

### Market Segments

| Segment | Price Range | Primary Venues | Avg Spread |
|---------|-------------|----------------|------------|
| **Ultra** | $1M+ | RM, Gooding, BaT | 0.4-20% |
| **Elite** | $500K-1M | RM, BaT, Bonhams | 1-20% |
| **Enthusiast** | $100-500K | BaT, Mecum | 3-15% |
| **Accessible** | $25-100K | BaT, C&B | 5-10% |
| **Entry** | <$25K | C&B, BaT, FB | 5-10% |

### Arbitrage Opportunities

| Type | Description |
|------|-------------|
| **Venue Arbitrage** | Same car sells for more on different platform |
| **Geographic Arb** | Price differs by region/country |
| **Temporal Arb** | Seasonal price variations |
| **Information Arb** | Better data = better pricing |
| **Fee Arb** | Using low-fee venue for high-value cars |

## The BaT Advantage (Quantified)

At $500K+, BaT's capped fees create massive arbitrage vs traditional auctions:

```
$500K car:
  BaT total cost:    $7,599  (1.5%)
  RM total cost:   $100,000  (20%)
  Arbitrage:        $92,401

$2M car:
  BaT total cost:    $7,599  (0.4%)
  RM total cost:   $400,000  (20%)
  Arbitrage:       $392,401
```

## Key Insight

**The collector car market is inefficient.** Fee structures vary 50x between venues. The informed trader who understands spread differentials has massive advantage.

This is why we're building Nuke - to be the terminal that reveals these inefficiencies.
