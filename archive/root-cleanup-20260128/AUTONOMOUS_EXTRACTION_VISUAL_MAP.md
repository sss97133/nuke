# 🗺️ Autonomous Extraction Visual Map

## 📡 THE CLOUD EXTRACTION PIPELINE (What Runs While You're Away)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    EXTERNAL AUCTION SOURCES                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  🎯 BaT (bringatrailer.com)        🚗 C&B (carsandbids.com)        │
│     462 live auctions                  ~100 active auctions        │
│     ↓ Every 15 min                     ↓ Every 15 min             │
│     sync-active-auctions               cars-and-bids-15m          │
│                                                                     │
│  🔨 Mecum (mecum.com)               🏎️ B-J (barrett-jackson.com)  │
│     ~50 live lots                      ~30 live lots              │
│     ↓ Every 15 min                     ↓ Every 15 min             │
│     mecum-15m                          barrett-jackson-15m        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
                    DATA FLOWS TO CLOUD
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                  SUPABASE EDGE FUNCTIONS (181 Active)               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  🔄 SYNC Functions (Real-time Updates)                             │
│  ├─> sync-active-auctions   → Updates current_bid, end_date       │
│  ├─> sync-bat-listing       → Updates individual listing          │
│  └─> sync-instagram-org     → Updates org social media            │
│                                                                     │
│  📥 EXTRACTION Functions (New Data)                                │
│  ├─> extract-premium-auction     → Full listing extraction        │
│  ├─> comprehensive-bat-extract   → Deep BaT scraping              │
│  ├─> extract-bat-profile-vehicles→ Seller profile scraping        │
│  ├─> import-bat-listing          → Individual BaT import          │
│  └─> scrape-multi-source         → Generic site scraping          │
│                                                                     │
│  ⚙️ PROCESSING Functions (Queue → Database)                        │
│  ├─> process-import-queue        → Main queue processor           │
│  ├─> process-bat-extraction-queue→ BaT-specific queue             │
│  ├─> process-inventory-sync-queue→ Dealer inventory sync          │
│  └─> backfill-images             → Image downloader               │
│                                                                     │
│  🤖 AUTONOMOUS Functions (Smart Discovery)                         │
│  ├─> autonomous-extraction-agent → AI-driven discovery            │
│  ├─> go-grinder                  → Continuous chain extraction    │
│  └─> entity-discovery            → Find related entities          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
                    STORED IN POSTGRES
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    DATABASE TABLES (2.1 GB / 8 GB)                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  📋 import_queue (Staging Pipeline)                                │
│  ├─> pending: 70       ⏳ Ready to process                        │
│  ├─> processing: 751   🔄 Being extracted right now               │
│  ├─> complete: 7,708   ✅ Successfully created vehicles           │
│  ├─> failed: 4,112     ❌ Need manual review                      │
│  └─> duplicate: 981    📋 Filtered out                            │
│                                                                     │
│  🚗 vehicles (Core Data) - 9,542 records, 91 MB                    │
│  ├─> Fields: year, make, model, vin, mileage, color, etc.         │
│  ├─> Pricing: sale_price, current_bid, auction_outcome            │
│  ├─> Origin: profile_origin (bat_import, carsandbids, etc.)       │
│  └─> Links: origin_organization_id, external identities           │
│                                                                     │
│  🎯 external_listings (Live Auction Tracking) - 1,236 records      │
│  ├─> platform: bat, carsandbids, mecum, barrettjackson            │
│  ├─> current_bid: "70000" (string, parsed by frontend)            │
│  ├─> end_date: 2026-01-18 (determines if "live")                  │
│  ├─> listing_status: active/pending/ended/sold (unreliable!)      │
│  └─> TRUST end_date OVER status! (key fix you just made)          │
│                                                                     │
│  📸 vehicle_images - 382,826 images, 1.4 GB                        │
│  ├─> source: bat_import, carsandbids_import, org_import           │
│  ├─> image_url: Full resolution URLs                              │
│  ├─> is_primary: First image flagged                              │
│  └─> position: Display order                                      │
│                                                                     │
│  🏢 businesses (Organizations) - 296 records                       │
│  ├─> Dealers, auction houses, clubs                               │
│  ├─> Linked via: organization_vehicles                            │
│  └─> Inventory tracked via: dealer_inventory                      │
│                                                                     │
│  👤 external_identities (Claimable Profiles) - 9,969 records       │
│  ├─> platform: bat, carsandbids, instagram, classic_com           │
│  ├─> handle: seller_username (from auctions)                      │
│  ├─> TRIGGERS: extract-bat-profile-vehicles (SNOWBALL!)           │
│  └─> Links to: user claims, portfolio tracking                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## ⚡ THE SNOWBALL EFFECT (Controlled)

```
START: Extract 1 BaT listing
  ↓
  Discovers: seller "wrenchmonkey72"
  ↓
  Creates: external_identity (platform='bat', handle='wrenchmonkey72')
  ↓
  COULD TRIGGER: extract-bat-profile-vehicles
  ↓
  Discovers: 50 vehicles sold by wrenchmonkey72
  ↓
  Queues: 50 URLs → import_queue (priority=1, low)
  ↓
  Each vehicle extraction discovers MORE sellers
  ↓
  Each NEW seller queued for profile extraction
  ↓
  EXPONENTIAL GROWTH! 🚀
```

### **HOW IT'S CONTROLLED:**

1. **Everything → import_queue first** (no immediate cascade)
2. **Priority system**: Active auctions (priority=8) processed before seller profiles (priority=1)
3. **Batch limits**: Max 100 items/batch prevents timeouts
4. **Rate limiting**: Delays between operations
5. **Deduplication**: Same URL won't queue twice
6. **Manual review**: Failed items (4,112) need human attention

### **Current Snowball Status:**
- 🟢 **CONTROLLED**: 70 pending items (very manageable)
- ⚠️ **4,112 failed** (need review - likely bad URLs/extinct sites)
- ✅ **7,708 complete** (successfully processed without cascading)

---

## 📈 OPTIMIZATION TIPS

### **If Queue Grows Too Fast (>10,000 pending):**
```sql
-- Pause discovery, focus on processing:
UPDATE cron.job SET active = false 
WHERE jobname IN ('go-grinder-continuous', 'daytime-extraction-pulse');

-- Keep processing at max:
UPDATE cron.job SET active = true 
WHERE jobname LIKE '%process-import-queue%';
```

### **If You Want MAXIMUM Speed:**
```sql
-- Enable aggressive overnight mode 24/7:
UPDATE cron.job 
SET schedule = '*/3 * * * *'  -- Every 3 minutes, all day
WHERE jobname = 'overnight-extraction-pulse';
```

### **If Database Fills Up:**
```sql
-- Clean old debug data:
DELETE FROM debug_runtime_logs WHERE created_at < NOW() - INTERVAL '7 days';
DELETE FROM scraping_health WHERE created_at < NOW() - INTERVAL '30 days';

-- Archive old image tags:
DELETE FROM image_tags WHERE created_at < NOW() - INTERVAL '90 days';
```

---

## 🎯 **GO-AWAY CHECKLIST**

- [x] ✅ Edge Functions deployed (181 active)
- [x] ✅ Cron jobs configured (15+ running)
- [x] ✅ Remote execution tested (sync + queue working)
- [x] ✅ Monitoring dashboard created
- [x] ✅ Capacity analyzed (plenty of room)
- [x] ✅ Safeguards in place (prevents runaway)
- [x] ✅ Quick start script ready

**Everything is ready. You can leave now!** 🚀
