# Auction Forensics Metrics

All trackable figures for analysis and visualization.

## Per-Vehicle Metrics (forensics_data)

### Timing
| Metric | Field | Unit | Description |
|--------|-------|------|-------------|
| Duration | `duration` | seconds | Total time on block |
| Active Bidding Time | `activeBiddingTime` | seconds | Time with bid activity |
| Dead Time | `deadTime` | seconds | Gaps with no activity |

### Bid Activity
| Metric | Field | Unit | Description |
|--------|-------|------|-------------|
| Bid Count | `bidCount` | count | Total bids detected |
| Bids Per Second | `bidsPerSecond` | rate | Overall bid velocity |
| Peak Bids/Sec | `peakBidsPerSecond` | rate | Maximum bid velocity |
| Bid Acceleration | `bidAcceleration` | ratio | Speed change (>1 = faster end) |
| Final Rush Intensity | `finalRushIntensity` | rate | Bids in last 10 seconds |
| Starting Bid | `bids[0].amount` | USD | Opening bid |
| Final Bid | `bids[-1].amount` | USD | Hammer price |
| Avg Bid Increment | `avgBidIncrement` | USD | Average step size |
| Max Bid Increment | `maxBidIncrement` | USD | Largest single jump |

### Auctioneer Analysis
| Metric | Field | Unit | Description |
|--------|-------|------|-------------|
| Words Per Minute | `wordsPerMinute` | wpm | Auctioneer speech rate |
| Filler Ratio | `fillerRatio` | 0-1 | % filler vs real content |

### Price vs Estimate
| Metric | Source | Description |
|--------|--------|-------------|
| Estimate Low | `auction_events.estimate_low` | Low pre-sale estimate |
| Estimate High | `auction_events.estimate_high` | High pre-sale estimate |
| Winning Bid | `auction_events.winning_bid` | Final sale price |
| Price vs Estimate | calculated | `final / ((low+high)/2)` |

### Alert Flags
| Flag | Field | Threshold |
|------|-------|-----------|
| Too Fast | `flags.tooFast` | Duration < 60s |
| Low Activity | `flags.lowActivity` | < 3 bids |
| Unusual Pattern | `flags.unusualPattern` | Acceleration < 0.5 or > 3 |
| Price Alert | `flags.priceAlert` | >50% deviation from estimate |
| Alert Score | `alertScore` | 0-100 composite |

## Aggregate Metrics (for graphing)

### By Auction/Event
```sql
SELECT
  broadcast_date,
  COUNT(*) as lots,
  AVG((forensics_data->>'duration')::float) as avg_duration,
  AVG((forensics_data->>'bidCount')::int) as avg_bids,
  AVG((forensics_data->>'alertScore')::int) as avg_alert_score,
  COUNT(*) FILTER (WHERE (forensics_data->>'alertScore')::int > 30) as flagged_count
FROM auction_events
WHERE forensics_data IS NOT NULL
GROUP BY broadcast_date;
```

### By Vehicle Type (Year/Make)
```sql
SELECT
  v.year, v.make,
  COUNT(*) as count,
  AVG((ae.forensics_data->>'duration')::float) as avg_duration,
  AVG(ae.winning_bid) as avg_price,
  AVG((ae.estimate_low + ae.estimate_high)/2) as avg_estimate
FROM auction_events ae
JOIN vehicles v ON ae.vehicle_id = v.id
WHERE ae.forensics_data IS NOT NULL
GROUP BY v.year, v.make;
```

### Price Performance
```sql
SELECT
  CASE
    WHEN winning_bid < estimate_low THEN 'Under estimate'
    WHEN winning_bid > estimate_high THEN 'Over estimate'
    ELSE 'Within range'
  END as category,
  COUNT(*),
  AVG((forensics_data->>'alertScore')::int) as avg_alert
FROM auction_events
WHERE forensics_data IS NOT NULL
  AND estimate_low IS NOT NULL
GROUP BY 1;
```

## Graph Ideas

### Time Series
- Alert score trends over auction day
- Bid velocity by time of day
- Duration distribution

### Scatter Plots
- Duration vs Final Price
- Estimate vs Actual (with alert coloring)
- Bid Count vs Duration

### Distributions
- Alert score histogram
- Duration distribution by auction house
- Price deviation from estimate

### Comparisons
- Mecum vs Barrett-Jackson patterns
- High-value vs standard lots
- Sold vs No-sale characteristics

## Current Data Volume

| Source | Records | With Estimates | With Forensics |
|--------|---------|----------------|----------------|
| Mecum | 7,480 | 1,423 | 6 (test) |
| All Sources | 31,813 | 1,423 | 6 |

**Need**: Process ~50-100 lots to have meaningful graphing data.
