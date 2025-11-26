# Vehicle Watchlist System

## Overview

A stock market-style "buy order" system for vehicles. Users set criteria (year, make, model, price range) and get notified when matching vehicles become available, especially from dealers like Viva! Las Vegas Autos.

## Components

### 1. Vehicle Watchlist Table
Users create watchlists with criteria:
- **Year range**: min/max year
- **Make/Model**: specific or any
- **Price range**: max/min price
- **Condition**: any, excellent, good, fair, project
- **VIN requirement**: must have VIN or not
- **Source preferences**: BAT, N-Zero, external
- **Seller preferences**: Viva, other dealers
- **Notification settings**: in-app, email, push

### 2. Watchlist Matches Table
Tracks when vehicles match watchlist criteria:
- Match type: new_listing, price_drop, ending_soon
- Match score: 0-100 (how well it matches)
- Match reasons: ['year_match', 'make_match', 'price_in_range']
- Notification status: sent, viewed

### 3. BAT Seller Monitor
Monitors specific BAT seller profiles (e.g., VivaLasVegasAutos):
- Checks seller profile page for new listings
- Creates vehicle profiles for new listings
- Automatically matches to watchlists
- Tracks monitoring stats

## How It Works

### For Users (Buy Orders)

1. **Create Watchlist**
   ```
   User sets: "I want a 1958-1965 Citroen 2CV under $30,000 from BAT"
   ```

2. **Automatic Matching**
   - When Viva lists a 1958 Citroen 2CV on BAT
   - System detects new listing
   - Checks all watchlists
   - Finds match (score: 90/100)
   - Creates match record

3. **Notification**
   - User gets in-app notification
   - "New listing matches your watchlist: 1958 Citroen 2CV"
   - Shows match score and reasons
   - Direct link to vehicle profile

### For Dealers (Advertising)

1. **Monitor Setup**
   - Dealer (Viva) sets up BAT seller monitor
   - System checks their seller profile every 6 hours
   - Detects new listings automatically

2. **Automatic Promotion**
   - New listing detected
   - Vehicle profile created
   - Matched to interested users
   - Users notified immediately
   - Listing gets visibility boost

## Database Schema

### `vehicle_watchlist`
- User criteria (year, make, model, price)
- Notification preferences
- Match statistics

### `watchlist_matches`
- Links watchlists to matching vehicles
- Tracks notification status
- Stores match scores and reasons

### `bat_seller_monitors`
- Tracks which sellers to monitor
- Stores monitoring stats
- Last checked timestamp

## Functions

### `check_watchlist_match(vehicle_id, listing_type)`
Checks if a vehicle matches any watchlist criteria and returns matches with scores.

### `process_new_bat_listing(vehicle_id, external_listing_id)`
Processes a new BAT listing:
1. Finds matching watchlists
2. Creates match records
3. Updates watchlist stats
4. Returns number of matches

## Edge Function

### `monitor-bat-seller`
- Fetches BAT seller profile page
- Extracts listing URLs
- Identifies new listings
- Creates vehicle profiles
- Matches to watchlists
- Updates monitor stats

## Setup Instructions

### 1. Apply Migration
```bash
supabase db push
```

### 2. Setup Viva Monitor
```bash
chmod +x scripts/setup-viva-bat-monitor.sh
./scripts/setup-viva-bat-monitor.sh
```

### 3. Deploy Edge Function
```bash
supabase functions deploy monitor-bat-seller
```

### 4. Schedule Monitoring
Set up cron job or scheduled function to call `monitor-bat-seller` every 6 hours:
```bash
# Via Supabase Cron (recommended)
# Or external cron service
0 */6 * * * curl -X POST https://your-project.supabase.co/functions/v1/monitor-bat-seller \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{"sellerUsername":"VivaLasVegasAutos","organizationId":"c433d27e-2159-4f8c-b4ae-32a5e44a77cf"}'
```

## Frontend Integration

### Watchlist UI Components Needed

1. **Create Watchlist Form**
   - Year range picker
   - Make/model autocomplete
   - Price range slider
   - Source/seller preferences
   - Notification channel selection

2. **Watchlist Dashboard**
   - List of active watchlists
   - Match count per watchlist
   - Recent matches

3. **Match Notifications**
   - In-app notification badge
   - Match card showing:
     - Vehicle details
     - Match score
     - Match reasons
     - Link to vehicle profile
     - "View Listing" button

4. **Match Details Page**
   - All vehicles matching a watchlist
   - Filter by match type
   - Sort by match score
   - Mark as viewed/dismiss

## Auto-Buy System (Limit Orders)

### How It Works

Users can set **automatic buy orders** that execute when:
1. **Price drops to target** (like limit buy orders)
   - "Buy if price drops to $25,000"
   - Executes automatically when listing price hits target

2. **New listing matches criteria**
   - "Auto-buy any 1958 Citroen 2CV under $30,000"
   - Executes when matching vehicle is listed

3. **Reserve is met** (for auctions)
   - "Auto-bid when reserve is met, up to $35,000"
   - Places bid automatically when reserve price is reached

4. **Buy-now available**
   - "Auto-buy if buy-now price is under $28,000"
   - Executes buy-now purchase immediately

### Execution Types

- **`bid_placed`**: Automatically places bid on auction
- **`buy_now`**: Executes buy-now purchase
- **`reserve_met_bid`**: Places bid when reserve is met
- **`price_drop_buy`**: Buys when price drops to target

### Safety Features

- **Confirmation required**: Default requires user confirmation before executing
- **Maximum price limits**: Can't exceed set maximum
- **Payment method**: Uses stored payment method
- **Execution tracking**: All executions logged and tracked

## Benefits

### For Users
- **Never miss a listing**: Get notified immediately when vehicles they want become available
- **Save time**: No need to constantly check BAT/dealer sites
- **Price alerts**: Get notified when prices drop or auctions ending soon
- **Automatic execution**: Like limit orders - buy automatically when price is right
- **Multiple criteria**: Set multiple watchlists for different vehicle types
- **Snap up deals**: Auto-buy when price drops to target (like stock market limit orders)

### For Dealers (Viva)
- **Automatic promotion**: New listings automatically shown to interested users
- **Better visibility**: Vehicles get in front of qualified buyers immediately
- **No manual work**: System handles everything automatically
- **Analytics**: See how many users are interested in each listing

## Next Steps

1. ✅ Database schema created
2. ✅ Edge function created
3. ⏳ Frontend watchlist UI components
4. ⏳ Notification system integration
5. ⏳ Scheduled monitoring setup
6. ⏳ Analytics dashboard for dealers

