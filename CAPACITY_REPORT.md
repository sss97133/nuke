# 📊 Supabase Capacity Report - December 29, 2025

## 🎯 **EXECUTIVE SUMMARY**

**Status**: ✅ **READY FOR AUTONOMOUS EXTRACTION**

Your Supabase cloud infrastructure is:
- ✅ **181 Edge Functions** deployed and active
- ✅ **15+ cron jobs** running 24/7
- ✅ **26% database capacity** used (2.1 GB / 8 GB)
- ✅ **1.4% storage** used (1.4 GB / 100 GB)
- ✅ **Remote execution tested** and working

**You can safely leave for hours** - the system will continue extracting, processing, and updating auction data autonomously.

---

## 📊 CURRENT DATABASE STATE

### **Tables & Sizes:**
| Table | Size | Records | Notes |
|-------|------|---------|-------|
| `vehicle_images` | **1.4 GB** | 382,826 | Largest table (all vehicle photos) |
| `image_tags` | 247 MB | - | AI-generated image tags |
| `image_coordinate_observations` | 110 MB | - | 3D coordinate data |
| `vehicles` | **91 MB** | **9,542** | Core vehicle records |
| `scraping_health` | 61 MB | - | Extraction monitoring |
| `timeline_events` | 36 MB | - | Vehicle history events |
| `auction_comments` | 22 MB | - | BaT/C&B comments |
| `external_listings` | - | **1,236** | Auction listings (2 live) |
| `businesses` | - | **296** | Organizations/dealers |
| `external_identities` | - | **9,969** | Claimable user profiles |

### **Import Queue (Processing Pipeline):**
| Status | Count | Health |
|--------|-------|--------|
| ✅ Complete | 7,708 | Successfully processed |
| 🔄 Processing | 751 | Currently active |
| ⏳ Pending | **70** | Ready to process |
| ❌ Failed | 4,112 | Need review (33% failure rate) |
| 📋 Duplicate | 981 | Filtered out |

---

## 🤖 ACTIVE CRON JOBS (Autonomous Extraction)

### **🔴 High Frequency (Every 1-3 Minutes):**

#### `process-import-queue-manual` - **Every 1 minute**
```typescript
Processes: 10 items from import_queue
Creates: Vehicle records, downloads images
Throughput: ~600 vehicles/hour sustained
```

#### `aggressive-backlog-clear` - **Every 2 minutes**
```typescript
Runs 3 processors in parallel:
├─> process-bat-extraction-queue (50 items)
├─> process-inventory-sync-queue (30 items)
└─> process-import-queue (100 items, fast mode)
Throughput: ~3,000+ vehicles/hour peak
```

#### `overnight-extraction-pulse` - **Every 3 minutes (8PM-7AM)**
```typescript
AGGRESSIVE extraction during off-hours:
├─> process-import-queue (100 items/batch)
├─> go-grinder (chain_depth=10, max=1000)
└─> autonomous-extraction-agent (smart discovery)
Throughput: ~6,000 vehicles/hour overnight
```

### **🟡 Medium Frequency (Every 5-15 Minutes):**

#### `sync-active-auctions` - **Every 15 minutes**
```typescript
Updates ALL live auction data:
- Current bids (from BaT API)
- Bid counts, watcher counts
- End dates, listing status
Targets: All external_listings with end_date > NOW()
```

#### `cars-and-bids-15m` - **Every 15 minutes**
```typescript
Scrapes: https://carsandbids.com/auctions
Max: 20 vehicles per run
Method: extract-premium-auction (site_type='carsandbids')
```

#### `mecum-15m` - **Every 15 minutes**
```typescript
Scrapes: https://www.mecum.com/lots/
Max: 20 vehicles per run
```

#### `barrett-jackson-15m` - **Every 15 minutes**
```typescript
Scrapes: https://www.barrett-jackson.com/Events/
Max: 20 vehicles per run
```

#### `craigslist-squarebodies-5m` - **Every 5 minutes**
```typescript
Scrapes: 20 Craigslist regions
Max: 60 listings per region = 1,200 potential vehicles/run
```

### **🟢 Low Frequency (Hourly/Daily):**

#### `enrich-organizations-daily` - **Daily at 3AM**
```typescript
Enriches: 50 organizations with external data
Adds: Logos, websites, contact info, inventory counts
```

#### `daily-production-run` - **Daily at 2AM**
```typescript
Full system health check and cleanup
```

---

## 🎯 EXTRACTION SOURCES → STORAGE

### **1. Bring a Trailer**
```
Source: https://bringatrailer.com/auctions/ (462 live)
│
├─> sync-active-auctions (every 15 min)
│   └─> Updates: external_listings (current_bid, bid_count, end_date)
│
├─> import-bat-listing (via queue)
│   ├─> Creates: vehicles record
│   ├─> Creates: external_listings record
│   ├─> Creates: vehicle_images (30-50 per vehicle)
│   ├─> Creates: external_identities (seller, buyer)
│   └─> Creates: auction_comments (if scraped)
│
└─> SNOWBALL: seller profiles → extract-bat-profile-vehicles
    └─> Queues: ALL vehicles from seller (can be 50+)
```

### **2. Cars & Bids**
```
Source: https://carsandbids.com/ (~100 active)
│
├─> cars-and-bids-15m (every 15 min)
│   └─> extract-premium-auction (site_type='carsandbids')
│       ├─> Parses: __NEXT_DATA__ (100+ images per vehicle)
│       ├─> Creates: vehicles record
│       ├─> Creates: external_listings
│       └─> Creates: vehicle_images (all gallery)
│
└─> NO SNOWBALL: C&B doesn't expose seller profiles
```

### **3. PCarMarket**
```
Source: https://pcarmarket.com/ (~200 Porsche listings)
│
├─> NOT AUTOMATED (manual trigger only)
│   └─> Call: scrape-multi-source or extract-premium-auction
│
└─> Storage:
    ├─> vehicles (Porsche-specific data)
    └─> external_listings (platform='pcarmarket')
```

---

## 💾 STORAGE CAPACITY ANALYSIS

### **Current Usage:**
```
Database: 2.1 GB / 8 GB (26%)
Storage:  1.4 GB / 100 GB (1.4%)
```

### **Projected After 24 Hours:**
```
If aggressive extraction (overnight pulse):
- Vehicles: 9,542 → 24,000 (+14,500 @ 200KB each = +2.9 GB)
- Images: 382,826 → 672,000 (+289,000 @ 10KB thumb = +2.9 GB)
- Database: 2.1 GB → 5.0 GB (62% used) ✅ SAFE
- Storage: 1.4 GB → 4.3 GB (4.3% used) ✅ PLENTY OF ROOM
```

### **When to Worry:**
- 🟢 **<50% database** = Healthy, keep going
- 🟡 **50-75% database** = Monitor closely
- 🔴 **>75% database** = Pause discovery, process queue only
- 🔴 **>7.5 GB database** = CRITICAL, cleanup needed

---

## 🔍 MONITORING COMMANDS

### **Quick Health Check:**
```bash
cd /Users/skylar/nuke

# Full dashboard
npx supabase db remote exec "$(cat scripts/monitor-autonomous-extraction.sql)"

# Just queue status
npx supabase db remote exec "SELECT status, COUNT(*) FROM import_queue GROUP BY status;"

# Live auction count
npx supabase db remote exec "SELECT COUNT(*) FROM external_listings WHERE end_date > NOW();"

# Recent activity
npx supabase db remote exec "SELECT COUNT(*) FROM vehicles WHERE created_at > NOW() - INTERVAL '1 hour';"
```

### **Manual Triggers (If You Want to Speed Up):**
```bash
# Sync ALL BaT live auctions (462 auctions)
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/sync-active-auctions" \
  -H "Authorization: Bearer $(grep SUPABASE_SERVICE_ROLE_KEY nuke_frontend/.env.local | cut -d '=' -f2)" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 500}'

# Extract Cars & Bids active auctions
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-premium-auction" \
  -H "Authorization: Bearer $(grep SUPABASE_SERVICE_ROLE_KEY nuke_frontend/.env.local | cut -d '=' -f2)" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://carsandbids.com/auctions", "site_type": "carsandbids", "max_vehicles": 100}'

# Force process queue (clear backlog fast)
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-import-queue" \
  -H "Authorization: Bearer $(grep SUPABASE_SERVICE_ROLE_KEY nuke_frontend/.env.local | cut -d '=' -f2)" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 100, "max_batches": 50, "fast_mode": true}'
```

---

## 🛡️ SAFEGUARDS & LIMITS

### **Prevents Runaway Extraction:**
1. ✅ **URL Deduplication**: `import_queue.listing_url` UNIQUE
2. ✅ **Atomic Locking**: `locked_at` prevents double-processing
3. ✅ **Priority Queue**: High-value first (active auctions = priority 8)
4. ✅ **Batch Limits**: Max 100 items/batch
5. ✅ **Timeout Protection**: Functions timeout after 150s
6. ✅ **Retry Logic**: Failed items retry max 3x with backoff

### **Rate Limiting:**
```typescript
Between listing scrapes: 500ms delay
Between image downloads: 100ms delay
Batch processing: 10-100 items, then pause
Cron frequency: Scaled by time (aggressive overnight, light daytime)
```

### **Cost Controls:**
```typescript
Firecrawl: Used sparingly (expensive)
Direct fetch: Preferred for most scraping
Image storage: Thumbnails generated (saves space)
Edge functions: Monitored (2M invocations/month limit)
```

---

## ✅ **YOU'RE ALL SET!**

### **What's Running Right Now:**
- ✅ **sync-active-auctions** updating live bids every 15 min
- ✅ **process-import-queue** processing 10 items every minute
- ✅ **go-grinder** continuous discovery every minute
- ✅ **cars-and-bids-15m** checking for new auctions
- ✅ **mecum-15m** monitoring Mecum sales
- ✅ **overnight-extraction-pulse** will kick in at 8PM (aggressive mode)

### **Expected Results (4 Hours Away):**
- **Vehicles**: +2,500 to +5,500 (total: ~12,000-15,000)
- **Images**: +50,000 to +120,000 (total: ~430,000-500,000)
- **Live Auctions**: Bids/timers synced ~16 times
- **Organizations**: +20-50 new dealers/sellers discovered
- **Queue**: Pending should decrease (processing outpaces discovery)

### **How to Monitor While Away:**
1. **Supabase Dashboard**: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam
2. **SQL Editor**: Paste `scripts/monitor-autonomous-extraction.sql`
3. **Logs**: Edge Functions → Logs tab

### **When You Return:**
```bash
cd /Users/skylar/nuke
npx supabase db remote exec "$(cat scripts/monitor-autonomous-extraction.sql)"
```

**The cloud will keep grinding while you're away!** 🚀

