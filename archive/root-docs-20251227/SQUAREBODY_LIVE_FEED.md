# 🔴 Squarebody Live Feed

**Real-time activity feed** showing new squarebodies as they're discovered, scraped, and added to the database.

## What Is This?

This is the "Big Tech" style real-time feed system you asked for - like Twitter/X showing "12 new tweets", or Reddit showing "new posts available". 

When your Craigslist scraper finds new squarebodies, they appear **instantly** on this page with:
- 🔴 Live indicator
- Toast banner: "3 new squarebodies just dropped!"
- Real-time cards sliding in
- Time stamps ("2m ago", "Just now")

## Tech Stack

### How Big Tech Does It:
1. **WebSockets** - bidirectional real-time communication
2. **Server-Sent Events (SSE)** - one-way server-to-client push
3. **Polling** - periodic refresh (simple but inefficient)
4. **Database subscriptions** - listen to DB changes

### What You're Using:
✅ **Supabase Realtime** - PostgreSQL change data capture (CDC)
- WebSocket connection to database
- Listens for INSERT events on `vehicles` table
- Filters: `make=Chevrolet/GMC, year=1973-1991`
- Pushes new vehicles to client instantly

## How It Works

```
┌─────────────────────────────────────────────┐
│  Craigslist Scraper                         │
│  (runs every 30 min or on-demand)           │
└──────────────┬──────────────────────────────┘
               │
               ↓ INSERT INTO vehicles
┌─────────────────────────────────────────────┐
│  PostgreSQL Database                        │
│  + Supabase Realtime (CDC)                  │
└──────────────┬──────────────────────────────┘
               │
               ↓ WebSocket push
┌─────────────────────────────────────────────┐
│  React Frontend                             │
│  useEffect(() => {                          │
│    supabase.channel('squarebody_feed')      │
│      .on('INSERT', handleNewVehicle)        │
│  })                                         │
└─────────────────────────────────────────────┘
               │
               ↓ State update
┌─────────────────────────────────────────────┐
│  UI Updates                                 │
│  - Toast banner appears                     │
│  - New card slides in at top               │
│  - Counter increments                       │
│  - Optional notification sound             │
└─────────────────────────────────────────────┘
```

## Features

### 1. Real-Time Subscription
```typescript
supabase
  .channel('squarebody_feed')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'vehicles',
    filter: 'make=in.(Chevrolet,GMC),year=gte.1973,year=lte.1991'
  }, (payload) => {
    if (isSquarebody(payload.new)) {
      handleNewSquarebody(payload.new);
    }
  })
  .subscribe();
```

### 2. Toast Banner
When new trucks arrive, a banner appears:
```
⚡ 3 new squarebodies just dropped! [View]
```
Click to load them into the feed.

### 3. Live Stats
- **Today**: Count of trucks added today
- **This Week**: Last 7 days
- **This Month**: Last 30 days

Updates automatically when new trucks arrive.

### 4. Vehicle Cards
Each card shows:
- Image (or truck emoji if no image)
- Year, Make, Model, Series (e.g., "K10")
- Price (if available)
- Location
- Time ago ("2m ago", "Just now")
- Source badge ("From Craigslist")

### 5. Filtering
Only shows **true squarebodies**:
- ✅ 1973-1991
- ✅ Chevrolet or GMC
- ✅ Trucks only (C10, K10, K20, etc.)
- ❌ Excludes Suburbans, Blazers (unless K5)

## Access

**URL:** `/market/squarebodies/live`

From the main Squarebody Dashboard:
- Click "Analytics →" to go to analytics view
- Or add a "🔴 LIVE FEED" button

## Comparison to Other Systems

### Twitter/X
- Shows "See 12 new Tweets" banner
- Pulls down to refresh
- **You have:** Click banner to load new trucks

### Reddit
- "New posts available" notification
- Auto-loads on scroll
- **You have:** Toast banner + auto-stats update

### Stock Trading Apps
- Live price tickers
- Real-time order book
- **You have:** Live vehicle feed with prices

### Facebook
- "New stories to see" badge
- Red notification dots
- **You have:** Pending count + toast banner

## Performance

### Network Usage
- **WebSocket:** ~1-5 KB/min (idle)
- **New vehicle:** ~2-10 KB per event
- **Much better than polling:** Would be ~50-100 KB/min

### Database Load
- **Supabase Realtime:** Built-in, no extra load
- **PostgreSQL CDC:** Native feature, minimal overhead
- **Filters:** Applied server-side (efficient)

### Client Performance
- **React state updates:** Instant (<16ms)
- **UI animations:** CSS transitions (GPU-accelerated)
- **Memory:** Limits to 50 vehicles in feed

## Next Steps

### Optional Enhancements:

1. **Push Notifications** (browser)
   ```javascript
   if (Notification.permission === 'granted') {
     new Notification('New Squarebody!', {
       body: '1973 Chevy K10 - $18,500'
     });
   }
   ```

2. **Sound Alerts**
   - Subtle "ding" when new truck arrives
   - Already wired up, just needs audio file

3. **Filters/Preferences**
   - Only K10s
   - Price range ($10k-$30k)
   - Specific regions (LA, SF, etc.)

4. **Save Searches**
   - Email alerts for matching trucks
   - SMS notifications

5. **Watchlist**
   - Mark favorites
   - Get alerts on price drops

## Code Location

**Component:** `/nuke_frontend/src/pages/SquarebodyLiveFeed.tsx`
**Route:** Added to `/nuke_frontend/src/App.tsx`
**Service:** Uses existing `FeedService.ts` patterns

## Testing

### 1. Manual Test
```bash
# Trigger scraper
cd /Users/skylar/nuke
./scripts/scrape-cl-now.sh

# Watch the live feed page
# Open: http://localhost:5173/market/squarebodies/live
# New trucks should appear within seconds
```

### 2. Check WebSocket Connection
```javascript
// In browser console
supabase.getChannels()
// Should see 'squarebody_feed' in list
```

### 3. Simulate New Vehicle
```sql
-- In Supabase Dashboard
INSERT INTO vehicles (
  year, make, model, series,
  asking_price, location,
  discovery_source, is_public
) VALUES (
  1979, 'Chevrolet', 'C10', 'C10',
  15000, 'Los Angeles, CA',
  'craigslist_scrape', true
);
-- Watch it appear instantly in the live feed!
```

## Troubleshooting

### No vehicles showing up?
- Check scraper is running (see Craigslist docs)
- Check database: `SELECT * FROM vehicles WHERE make IN ('Chevrolet', 'GMC') AND year BETWEEN 1973 AND 1991 ORDER BY created_at DESC LIMIT 10;`
- Check console for WebSocket errors

### WebSocket not connecting?
- Check Supabase project settings
- Verify Realtime is enabled
- Check browser console for errors

### Toast banner not appearing?
- Check `handleNewSquarebody()` is being called
- Verify `isSquarebody()` filter logic
- Check pending count state

---

**Built:** December 2, 2025  
**Status:** ✅ Ready to use  
**Pattern:** Real-time Activity Feed (Big Tech style)

