# Massive Vintage Vehicle Import System

## 🎯 Target: 10,000+ Vintage Vehicles

**Current Status**: 321 vehicles → **Goal**: 10,000+ vehicles

## System Overview

This system is designed to aggressively import vintage vehicles from **all possible sources** to reach 10,000+ vehicles in the database.

### Scale

- **150+ Sources** configured
- **30 Major Cities** on Craigslist
- **20+ Search Terms** per city
- **All Major Marketplaces** (Hemmings, Classic.com, AutoTrader Classics, etc.)
- **All Auction Sites** (BaT, Cars & Bids, etc.)
- **All Classified Sites** (KSL, SearchTempest, etc.)

### Sources Breakdown

1. **Craigslist**: 30 cities × 5 search terms = **150 sources**
2. **KSL Cars**: 9 categories
3. **Bring a Trailer**: 10 makes
4. **Hemmings**: 4 categories
5. **Classic.com**: 3 searches
6. **AutoTrader Classics**: 3 categories
7. **ClassicCars.com**: 3 categories
8. **Cars & Bids**: 3 searches
9. **SearchTempest**: 3 aggregator searches

**Total: ~188 sources**

## How It Works

1. **Cycles**: Runs every 10 minutes
2. **Priority-Based**: Higher priority sources run first
3. **Rate Limiting**: Respects per-domain limits
4. **Deduplication**: Checks for existing listings
5. **Queue Processing**: Automatically processes import queue after each cycle
6. **Statistics**: Tracks all metrics

## Usage

### Start the System

```bash
./scripts/start-massive-import.sh
```

### View Logs

```bash
tail -f logs/massive-import.log
```

### Stop the System

```bash
kill $(cat logs/massive-import.pid)
```

## Expected Performance

### Per Cycle
- **Sources Processed**: ~188 sources
- **Listings Scraped**: ~500-2,000 listings
- **New Listings Added**: ~200-800 new listings
- **Cycle Time**: ~10-15 minutes

### Daily
- **Cycles**: ~144 cycles/day
- **Listings Scraped**: ~72,000-288,000 listings/day
- **New Listings Added**: ~28,800-115,200 listings/day
- **After Deduplication**: ~5,000-20,000 unique vehicles/day

### To Reach 10,000 Vehicles

At **conservative** rate of 1,000 new vehicles/day:
- **Time to 10,000**: ~10 days
- **At 5,000 vehicles/day**: ~2 days
- **At 10,000 vehicles/day**: ~1 day

## Search Terms

The system searches for:
- **Decades**: 1960, 1961, 1962... 1999
- **Categories**: classic car, vintage car, antique car, muscle car, collector car
- **Models**: corvette, mustang, camaro, charger, c10, k10, f150, bronco, etc.
- **Keywords**: restored, project car, barn find, pickup, truck

## Cities Covered

**Top 30 Major Cities**:
- SF Bay Area, Los Angeles, New York, Chicago, Atlanta, Dallas
- Denver, Seattle, Portland, Phoenix, Houston, Miami, Boston
- Philadelphia, Minneapolis, Detroit, Cleveland, Cincinnati
- Pittsburgh, Baltimore, Washington DC, Raleigh, Charlotte
- Nashville, Memphis, New Orleans, Kansas City, St. Louis
- Milwaukee, Indianapolis, Columbus, Buffalo, Rochester

## Monitoring

### Statistics Tracked
- Total cycles completed
- Total listings scraped
- Total listings added to queue
- Success rates per source
- Error counts
- Uptime

### Check Progress

```sql
-- Current vehicle count
SELECT COUNT(*) FROM vehicles;

-- Recent imports
SELECT COUNT(*) FROM vehicles 
WHERE created_at > NOW() - INTERVAL '24 hours';

-- By source
SELECT discovery_source, COUNT(*) 
FROM vehicles 
GROUP BY discovery_source 
ORDER BY COUNT(*) DESC;
```

## Optimization

### For Maximum Speed
1. Reduce cycle wait time (currently 10 minutes)
2. Increase batch size for queue processing
3. Add more cities/search terms
4. Reduce rate limits (risky - may get blocked)

### For Maximum Reliability
1. Increase rate limits
2. Add more retry logic
3. Monitor error rates
4. Adjust based on source health

## Next Steps

1. **Start the system**: `./scripts/start-massive-import.sh`
2. **Monitor logs**: `tail -f logs/massive-import.log`
3. **Check progress**: Query database for vehicle counts
4. **Adjust as needed**: Modify sources/rates based on results

---

**Status**: ✅ Ready to Scale  
**Current Vehicles**: 321  
**Target**: 10,000+  
**Estimated Time**: 1-10 days depending on rate

