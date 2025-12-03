# 📱 Where Scraped Vehicles Show in the UI

## 🎯 Quick Answer:

**Your scraped trucks appear in 5 places:**

1. **`/market/squarebodies`** - Analytics dashboard (BEST for stats)
2. **`/market/squarebodies/live`** - Real-time feed (BEST for "thriving" vibe)
3. **`/vehicles`** - All vehicles list
4. **`/discover`** - Discovery feed
5. **`/feed`** - Live activity feed

---

## 📍 **Primary UI: Squarebody Market Dashboard**

**URL:** https://n-zero.dev/market/squarebodies

**What it shows:**
```
┌──────────────────────────────────────────────────┐
│ Squarebody Market                                │
├──────────────────────────────────────────────────┤
│                                                  │
│ 📊 STATS (auto-updates every 30s):              │
│   Total discovered: 247                          │
│   Today: 12       Week: 47      Month: 183      │
│   Average price: $18,500                         │
│   Price range: $3,500 - $42,000                  │
│                                                  │
│ 📈 CHARTS:                                       │
│   [Price trend line graph]                       │
│   [Regional activity map]                        │
│                                                  │
│ 🚗 RECENT DISCOVERIES (Grid of 12):             │
│   ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐              │
│   │ K10 │ │ C20 │ │ K10 │ │ C10 │              │
│   │$18K │ │$12K │ │$24K │ │$15K │              │
│   └─────┘ └─────┘ └─────┘ └─────┘              │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Code:** `nuke_frontend/src/pages/SquarebodyMarketDashboard.tsx`  
**Query (line 75):**
```typescript
.eq('discovery_source', 'craigslist_scrape')
```

---

## 🔴 **NEW: Squarebody Live Feed** (THE THRIVING VIEW)

**URL:** https://n-zero.dev/market/squarebodies/live

**What it shows:**
```
┌──────────────────────────────────────────────────┐
│ 🔴 LIVE: Squarebody Market                      │
├──────────────────────────────────────────────────┤
│                                                  │
│ ⚡ 3 NEW SQUAREBODIES JUST DROPPED! [View]      │ ← Appears when scraper adds
│                                                  │
│ 📊 Today: 12  |  Week: 47  |  Month: 183        │
│                                                  │
│ ┌────────────────────────────────────────────┐  │
│ │ 🆕 1973 Chevy K10                          │  │
│ │ [Image of black K5 Blazer]                 │  │
│ │ $18,500 • Los Angeles, CA                  │  │
│ │ ⏱️ 2 minutes ago                           │  │
│ │ 🏷️ From Craigslist                        │  │
│ └────────────────────────────────────────────┘  │
│                                                  │
│ ┌────────────────────────────────────────────┐  │
│ │ 🆕 1979 GMC C20 Dually                     │  │
│ │ [Image of blue dually]                     │  │
│ │ $3,500 • Canyon Country, CA                │  │
│ │ ⏱️ 5 minutes ago                           │  │
│ └────────────────────────────────────────────┘  │
│                                                  │
│ [Infinite scroll...]                             │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Code:** `nuke_frontend/src/pages/SquarebodyLiveFeed.tsx` (just built)  
**Updates:** INSTANT via WebSocket when scraper adds vehicles

---

## 🎯 **The Flow: Scraper → Database → UI**

```
2 AM: Daily scraper runs
        ↓
Finds 25 listings on Craigslist LA
        ↓
Scrapes each listing
        ↓
INSERT INTO vehicles (discovery_source = 'craigslist_scrape')
        ↓
        ├─────────────────────────┬──────────────────────┐
        │                         │                      │
        ↓ (30s poll)              ↓ (WebSocket)        ↓ (30s poll)
┌─────────────────┐   ┌─────────────────────┐  ┌─────────────────┐
│ Market Dashboard│   │   Live Feed         │  │ All Vehicles    │
│ (Stats update)  │   │   (Toast appears)   │  │ (List updates)  │
│                 │   │                     │  │                 │
│ "Today: 12"     │   │ "3 new trucks!"     │  │ +12 in list     │
│ becomes         │   │ [Cards slide in]    │  │                 │
│ "Today: 15"     │   │                     │  │                 │
└─────────────────┘   └─────────────────────┘  └─────────────────┘
```

---

## 🚀 **Testing on Production:**

### **Once deployed (n-zero.dev), check these URLs:**

1. **Market Dashboard:**
   https://n-zero.dev/market/squarebodies
   - Should show 247+ squarebodies
   - Stats: Today/Week/Month counts
   - Recent discoveries grid

2. **Live Feed (NEW):**
   https://n-zero.dev/market/squarebodies/live
   - Real-time feed
   - Toast banners when trucks added
   - "Just now", "2m ago" timestamps

3. **All Vehicles:**
   https://n-zero.dev/vehicles
   - Includes scraped vehicles
   - Can filter by source

4. **Individual Vehicle:**
   https://n-zero.dev/vehicles/[any_scraped_vehicle_id]
   - Shows "Discovered on Craigslist" badge
   - Links to original listing

---

## 🧪 **Test Backend is Flowing:**

```bash
# Trigger scraper RIGHT NOW
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-squarebodies" \
  -H "Authorization: Bearer YOUR_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"max_regions":2,"max_listings_per_search":10}'

# Check results (30 seconds later)
# Open: https://n-zero.dev/market/squarebodies/live
# Should see new trucks at top with "Just now" timestamp
```

---

## ✅ **Current Status:**

- ✅ **Backend: WORKING** (just tested - 25 listings found, 14 vehicles updated)
- ✅ **Functions: DEPLOYED** (scraper v78, health check v1)  
- ✅ **Frontend: DEPLOYED** (nukefrontend-emaf5x9qm)
- ⏳ **Migrations: PENDING** (need manual apply for health tracking)
- ⏳ **Cron: PENDING** (need manual setup for daily automation)

---

## 🎯 **What User Sees on n-zero.dev:**

**Squarebody enthusiast visits:**
1. Homepage → Clicks "Squarebody Market"
2. Lands on `/market/squarebodies`
3. Sees: "247 trucks discovered, 12 today, avg $18.5K"
4. Clicks "🔴 LIVE FEED" button
5. Sees trucks flowing in real-time
6. Toast: "3 new trucks just dropped!"
7. Clicks truck → Full vehicle page
8. Sees original Craigslist link
9. Contacts seller

**Backend → UI is LIVE** 🚀

**Next:** Apply migrations so you can monitor health + set up daily scraping

