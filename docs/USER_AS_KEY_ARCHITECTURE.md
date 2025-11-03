# User-as-Key Architecture: Proactive Software Design

## Core Philosophy

**Traditional Software:** Users push buttons → System reacts  
**N-Zero Software:** User exists → System proactively works on their behalf

The user is not an operator. The user is a **KEY** - an authentication token that unlocks automatic, intelligent action.

---

## Design Principles

### 1. **Auto-Detection Over Manual Entry**
```
❌ BAD: "Click here to link your BaT listing"
✅ GOOD: System auto-detects BaT listing, links it, notifies user it's done
```

### 2. **Implicit Subscriptions**
```
❌ BAD: "Subscribe to get notifications from Viva"
✅ GOOD: User views 3 Viva vehicles → auto-subscribe
```

### 3. **Background Intelligence**
```
❌ BAD: "Click to sync BaT data"
✅ GOOD: Cron job syncs every hour automatically
```

### 4. **Predictive Actions**
```
❌ BAD: "Upload images from Dropbox"
✅ GOOD: Connected Dropbox? Auto-scan every night at 2 AM
```

### 5. **User Approves, Doesn't Execute**
```
User's role: Authenticate → Review → Approve/Deny
System's role: Detect → Process → Execute → Notify
```

---

## Implementation: Notification System

### Traditional Approach (What I Initially Built):
```typescript
// User has to manually subscribe
<button onClick={() => subscribeToDealer(vivaId)}>
  Subscribe to Viva
</button>

// User has to manually link BaT listing
<button onClick={() => linkBaTListing(url)}>
  Link BaT Listing
</button>

// User has to manually sync
<button onClick={() => syncBaTData()}>
  Sync BaT Data
</button>
```

### User-as-Key Approach (What You Want):
```typescript
// System auto-detects and acts

// 1. AUTO-SUBSCRIBE when user shows interest
async function trackUserActivity(userId: string, vehicleId: string) {
  const vehicle = await getVehicle(vehicleId);
  const orgId = vehicle.organization_id;
  
  // Count user's views of this dealer's vehicles
  const viewCount = await getUserViewCount(userId, orgId);
  
  if (viewCount >= 3) {
    // Auto-subscribe (they're clearly interested)
    await autoSubscribe(userId, 'dealer_new_listings', orgId);
    
    // Subtle notification: "You're now following Viva! Las Vegas Autos"
    await notify(userId, 'auto_subscribed', { dealerName: vehicle.org_name });
  }
}

// 2. AUTO-DETECT BaT listings when vehicle is added
async function onVehicleCreated(vehicle: Vehicle) {
  // Background job: Search BaT for this VIN/year/make/model
  const batListing = await searchBaTForVehicle(vehicle);
  
  if (batListing) {
    // Auto-link without user action
    await linkExternalListing(vehicle.id, batListing);
    
    // Notify owner: "We found this on BaT and linked it for you"
    await notify(vehicle.uploaded_by, 'bat_listing_detected', { batUrl: batListing.url });
  }
}

// 3. AUTO-SYNC via cron (no user button)
// Supabase cron job runs every hour:
async function cronSyncAllActiveListings() {
  const activeListings = await getActiveExternalListings();
  
  for (const listing of activeListings) {
    await syncBaTListing(listing.id);
    
    // If bid increased, auto-notify subscribers
    if (listing.newBid > listing.oldBid) {
      await notifySubscribers('bid_increased', listing);
    }
  }
}
```

---

## Real-World Examples

### Example 1: BaT Integration (Your Case)

**What you experienced:**
- You manually found duplicate profiles
- You manually had to say "link these"
- You manually had to extract BaT data

**What should happen automatically:**
1. **Auto-Detection:** When Dropbox imports 1966 C10 with VIN `C1446S140169`, system immediately searches BaT for matches
2. **Auto-Linking:** Finds [https://bringatrailer.com/listing/1966-chevrolet-c10-pickup-105/](https://bringatrailer.com/listing/1966-chevrolet-c10-pickup-105/), auto-creates `external_listings` entry
3. **Auto-Sync:** Cron job updates bid count (3), view count (8,487), watcher count (653) every hour
4. **Auto-Notify:** If auction is ending in <24h, notifies all users who viewed this vehicle
5. **Fair Play Attribution:** Auto-marks "BaT listed first" → no N-Zero commission, only affiliate credit

**User just sees:**
- Vehicle profile shows "Also listed on BaT" badge
- Real-time bid updates without clicking anything
- Notification: "Auction ending in 6 hours - current bid $40k"

### Example 2: Dealer Subscriptions

**Traditional approach:**
```
User → Clicks "Subscribe to Viva"
User → Clicks "Enable notifications"
User → Clicks "Save preferences"
```

**User-as-Key approach:**
```
User views Viva vehicle #1
User views Viva vehicle #2
User views Viva vehicle #3
→ System auto-subscribes, subtle toast: "You're now following Viva"
→ Next time Viva lists a vehicle, user gets notified automatically
```

### Example 3: Price Drop Alerts

**Traditional:**
```
User sees vehicle they like
User clicks "Watch this vehicle"
User enables "Notify me of price changes"
```

**User-as-Key:**
```
User views vehicle for >10 seconds
→ System auto-tracks as "interested"
→ Price drops 10% next week
→ Automatic notification: "Price dropped on 1972 K10 you viewed"
User never had to click anything
```

---

## Technical Implementation

### Auto-Subscribe Trigger
```sql
-- Function that runs whenever a user views a vehicle
CREATE OR REPLACE FUNCTION auto_subscribe_on_interest()
RETURNS TRIGGER AS $$
DECLARE
  org_id UUID;
  view_count INTEGER;
BEGIN
  -- Get organization for this vehicle
  SELECT organization_id INTO org_id
  FROM organization_vehicles
  WHERE vehicle_id = NEW.vehicle_id
  LIMIT 1;
  
  IF org_id IS NOT NULL THEN
    -- Count how many vehicles from this org the user has viewed
    SELECT COUNT(DISTINCT pv.vehicle_id) INTO view_count
    FROM profile_vehicle_views pv
    JOIN organization_vehicles ov ON pv.vehicle_id = ov.vehicle_id
    WHERE pv.user_id = NEW.user_id
    AND ov.organization_id = org_id;
    
    -- Auto-subscribe after 3 views
    IF view_count >= 3 THEN
      INSERT INTO user_subscriptions (
        user_id,
        subscription_type,
        target_id,
        auto_subscribed,
        is_active
      ) VALUES (
        NEW.user_id,
        'dealer_new_listings',
        org_id,
        TRUE,  -- Mark as auto-subscribed
        TRUE
      )
      ON CONFLICT DO NOTHING;
      
      -- Create in-app notification
      INSERT INTO user_notifications (
        user_id,
        channel_type,
        notification_title,
        notification_body,
        action_url
      )
      SELECT
        NEW.user_id,
        'in_app',
        'Now Following ' || b.business_name,
        format('You''re now subscribed to %s. We''ll notify you when they list new vehicles.', b.business_name),
        '/org/' || org_id
      FROM businesses b WHERE b.id = org_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Auto-Detect BaT Listings (Cron Job)
```typescript
// Runs every 6 hours
async function autoDetectExternalListings() {
  // Get all vehicles added in last 24 hours
  const recentVehicles = await getRecentVehicles(24);
  
  for (const vehicle of recentVehicles) {
    // Search BaT for this vehicle
    const batResults = await searchBaT({
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      vin: vehicle.vin
    });
    
    if (batResults.length > 0) {
      // Auto-link without user action
      await createExternalListing(vehicle.id, batResults[0]);
      
      // Notify owner (just FYI, no action needed)
      await notify(vehicle.uploaded_by, {
        title: 'BaT Listing Detected',
        body: `We found your ${vehicle.year} ${vehicle.make} ${vehicle.model} on Bring a Trailer and linked it for you.`,
        action: 'view_vehicle',
        silent: true  // Don't interrupt, just show in feed
      });
    }
  }
}
```

### Auto-Sync BaT Data (Cron Job)
```typescript
// Runs every hour
async function autoSyncActiveListings() {
  const activeListings = await supabase
    .from('external_listings')
    .select('*')
    .eq('listing_status', 'active')
    .eq('sync_enabled', true);
  
  for (const listing of activeListings.data) {
    // Sync without user clicking anything
    await syncBaTListing(listing.id);
    
    // Auto-notify subscribers if something interesting happened
    // (bid increased, auction ending soon, reserve met, etc.)
  }
}
```

### Implicit Interest Tracking
```sql
-- Track user interest automatically (no explicit "watch" button)
CREATE TABLE IF NOT EXISTS implicit_user_interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  interest_score INTEGER DEFAULT 0,  -- Incremented on views, time spent, etc.
  first_viewed_at TIMESTAMPTZ DEFAULT NOW(),
  last_viewed_at TIMESTAMPTZ DEFAULT NOW(),
  total_view_time_seconds INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 1,
  shared BOOLEAN DEFAULT FALSE,
  bookmarked BOOLEAN DEFAULT FALSE,
  UNIQUE (user_id, vehicle_id)
);

-- Auto-notify on price drops for vehicles user showed interest in
CREATE OR REPLACE FUNCTION auto_notify_interested_users()
RETURNS TRIGGER AS $$
BEGIN
  -- If price dropped >5%
  IF OLD.asking_price IS NOT NULL AND NEW.asking_price < OLD.asking_price * 0.95 THEN
    -- Find all users who showed interest (viewed 2+ times or spent >30 seconds)
    INSERT INTO user_notifications (user_id, channel_type, notification_title, notification_body, action_url)
    SELECT
      iui.user_id,
      'in_app',
      'Price Drop Alert',
      format('%s %s %s dropped from $%s to $%s (-%s%%)', 
        v.year, v.make, v.model,
        OLD.asking_price, NEW.asking_price,
        ROUND((1 - NEW.asking_price / OLD.asking_price) * 100)),
      '/vehicle/' || NEW.vehicle_id
    FROM implicit_user_interests iui
    JOIN vehicles v ON iui.vehicle_id = v.id
    WHERE iui.vehicle_id = NEW.vehicle_id
    AND (iui.view_count >= 2 OR iui.total_view_time_seconds >= 30);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## User Flow (Fully Automatic)

### Scenario: User discovers Viva's inventory

**Traditional flow** (20 clicks, 5 minutes):
1. User clicks "Organizations"
2. User clicks "Viva"
3. User clicks "Vehicles"
4. User clicks vehicle #1, views it
5. User clicks back
6. User clicks vehicle #2, views it
7. User clicks "Subscribe to Viva"
8. User clicks "Enable notifications"
9. User clicks "Save"
10. ... (10 more clicks)

**User-as-Key flow** (2 clicks, 30 seconds):
1. User opens Viva profile (authenticated = they're the key)
2. User scrolls, views 3 vehicles
3. **SYSTEM AUTO-SUBSCRIBES** them silently
4. Toast notification: "You're now following Viva"
5. Done. User never clicked "subscribe", system did it for them

---

### Scenario: Viva lists new vehicle on BaT

**Traditional flow:**
1. Viva lists on BaT first
2. Viva employee has to manually copy/paste BaT URL into N-Zero
3. User has to click "sync BaT data"
4. User has to click "notify subscribers"

**User-as-Key flow (AUTOMATIC):**
1. Viva lists on BaT (morning)
2. **Cron job (6 hours later):** Scrapes Viva's BaT member page, detects new listing
3. **Auto-links** to N-Zero vehicle profile (by VIN)
4. **Auto-creates** `external_listings` entry
5. **Auto-notifies** all Viva subscribers: "New listing: 1972 K10 on BaT"
6. **Auto-syncs** bid count every hour
7. **Auto-alerts** when auction is ending in 24h
8. **Nobody clicked anything** - system just works

---

## Cron Jobs (Background Automation)

### Hourly Jobs:
- `sync-active-bat-listings` - Update bid counts, watcher counts
- `detect-new-bat-listings` - Scrape dealer member pages for new listings
- `process-notification-queue` - Send pending notifications
- `auto-subscribe-interested-users` - Subscribe users based on behavior

### Daily Jobs:
- `scan-dropbox-for-new-images` - Auto-import new dealer photos
- `detect-duplicate-vehicles` - Find and flag potential duplicates
- `update-vehicle-valuations` - Refresh pricing models
- `cleanup-old-notifications` - Archive read notifications >30 days

### Weekly Jobs:
- `scan-all-dealer-bat-pages` - Full BaT member page scan for all dealers
- `generate-market-reports` - Create weekly market summaries
- `update-external-listing-links` - Re-validate affiliate links

---

## Fair Play with External Platforms

### Principle: **Complement, Don't Compete**

**If BaT listed first:**
- N-Zero displays BaT listing prominently
- All links go to BaT (not internal listing)
- N-Zero earns affiliate commission (5-10% of BaT's fee)
- Attribution tracking: "Originally listed on BaT by Viva"

**If N-Zero listed first:**
- N-Zero offers "Submit to BaT" button
- Pre-fills BaT forms with N-Zero data
- N-Zero earns listing commission (1-2% of sale price)
- Attribution tracking: "Listed on N-Zero, cross-posted to BaT"

**If listed simultaneously:**
- Display both listings side-by-side
- Track which gets more engagement
- Commission split: N-Zero gets referring commission from BaT

### Transparency:
```typescript
// Visible to users on every vehicle profile
<ExternalListingCard>
  Platform: Bring a Trailer
  Status: ACTIVE AUCTION
  Current Bid: $40,000
  Reserve: Not Met
  Ends: May 3, 2024
  
  Fair Play Notice:
  This vehicle was listed on BaT before N-Zero.
  BaT gets full credit. N-Zero provides referral link.
  If you bid through our link, we earn a small affiliate commission.
</ExternalListingCard>
```

---

## Implementation Checklist

### Phase 1: Auto-Detection (Week 1)
- [x] Database schema for external listings
- [x] Database schema for notifications
- [x] BaT listing scraper Edge Function
- [ ] Cron job: Auto-detect BaT listings every 6 hours
- [ ] Cron job: Auto-sync active BaT listings every hour
- [ ] Auto-link function (match by VIN or fuzzy match)

### Phase 2: Implicit Subscriptions (Week 2)
- [ ] Track user views/interactions in real-time
- [ ] Auto-subscribe after 3 views of same dealer
- [ ] Auto-subscribe after 10 seconds on vehicle profile
- [ ] Auto-subscribe after sharing/bookmarking
- [ ] Subtle toast notifications (not annoying popups)

### Phase 3: Predictive Notifications (Week 3)
- [ ] Auto-notify price drops (no explicit "watch" needed)
- [ ] Auto-notify auction ending soon
- [ ] Auto-notify similar vehicles listed
- [ ] Auto-notify when vehicles user viewed get new images
- [ ] Smart notification timing (not 3 AM, not spam)

### Phase 4: Background Sync (Week 4)
- [ ] Dropbox auto-scan (nightly at 2 AM)
- [ ] BaT member page scrape (every 6 hours)
- [ ] Duplicate vehicle detection (daily)
- [ ] Market data refresh (weekly)

---

## Success Metrics

**Traditional Metrics (Button-Driven):**
- Click-through rate
- Conversion rate
- Time to complete task

**User-as-Key Metrics (Intelligence-Driven):**
- % of actions completed automatically (goal: >80%)
- Time saved per user (goal: 10+ minutes/session)
- User "surprise and delight" moments (auto-detected duplicates, auto-linked listings)
- % of notifications that are actionable (goal: >70% - no spam)

---

## The Vision

**You open N-Zero in the morning:**
- 3 new notifications (automatically detected overnight)
  1. "Viva listed a 1969 Camaro Z28" (you're auto-subscribed because you viewed 5 Viva vehicles)
  2. "Price dropped on 1972 K10 you viewed" (you never clicked "watch", system just knew)
  3. "Your 1974 Bronco was cross-listed on BaT" (system detected it, linked it, notified you)

**You click ONE thing:** Approve/Review

**You didn't have to:**
- Subscribe manually
- Link listings manually
- Sync data manually  
- Set up alerts manually
- Remember to check BaT

**The system just KNOWS** because you're authenticated (you're the key), and it works on your behalf.

---

## Next Steps

1. Finish implementing auto-detection cron jobs
2. Deploy implicit interest tracking
3. Remove all manual "sync" buttons (replace with "Last synced 5min ago" status)
4. Add subtle "Working for you..." indicators
5. Test with your workflow (Viva's 55 BaT listings)

**Goal:** You should never have to "manage" notifications. The system should just work.

