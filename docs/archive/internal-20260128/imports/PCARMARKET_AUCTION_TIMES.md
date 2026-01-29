# PCarMarket Auction Time Parameters & Countdown

## Overview

Complete system for extracting, calculating, and displaying all time-related parameters for PCarMarket auctions, including real-time countdowns.

## Time Parameters Extracted

### Core Dates
- **Auction Start Date/Time** - When auction began
- **Auction End Date/Time** - When auction ends/closes
- **Sale Date** - When vehicle was sold (if applicable)
- **Current Time** - Time of calculation
- **Timezone** - Timezone of calculation

### Calculated Values
- **Time Remaining** - Countdown until auction ends
  - Days, hours, minutes, seconds
  - Total seconds
  - Formatted strings (short and long)
- **Time Since Start** - How long auction has been running
  - Days, hours, minutes, seconds
  - Formatted string
- **Total Duration** - Length of auction period
  - Days
  - Total seconds

### Status Indicators
- **is_active** - Auction is currently active
- **is_ended** - Auction has ended
- **is_upcoming** - Auction hasn't started yet

### Countdown Object
```json
{
  "days": 5,
  "hours": 12,
  "minutes": 30,
  "seconds": 45,
  "total_seconds": 478245,
  "is_expired": false,
  "formatted": "5 days, 12 hours",
  "formatted_short": "5d 12h"
}
```

## Database Storage

### vehicles Table
- `auction_end_date` - Direct field for end date
- `origin_metadata.auction_times` - Complete time parameters (JSONB)

### origin_metadata Structure
```json
{
  "auction_times": {
    "auction_start_date": "2025-01-15T10:00:00Z",
    "auction_end_date": "2025-01-22T18:00:00Z",
    "current_time": "2025-01-20T12:00:00Z",
    "timezone": "America/Los_Angeles",
    "is_active": true,
    "is_ended": false,
    "is_upcoming": false,
    "time_remaining_seconds": 216000,
    "time_remaining_formatted": "2 days, 12 hours",
    "time_since_start_formatted": "5 days, 2 hours",
    "total_duration_days": 7,
    "countdown": {
      "days": 2,
      "hours": 12,
      "minutes": 0,
      "seconds": 0,
      "total_seconds": 216000,
      "is_expired": false
    },
    "calculated_at": "2025-01-20T12:00:00Z"
  }
}
```

## SQL Functions

### calculate_auction_countdown(end_date)
Calculates countdown from end date.

**Usage:**
```sql
SELECT calculate_auction_countdown(auction_end_date) 
FROM vehicles 
WHERE id = 'vehicle-id';
```

**Returns:**
```json
{
  "days": 2,
  "hours": 12,
  "minutes": 30,
  "seconds": 45,
  "total_seconds": 216045,
  "is_expired": false,
  "formatted": "2 days, 12 hours, 30 minutes",
  "formatted_short": "2d 12h 30m"
}
```

### get_vehicle_auction_times(vehicle_id)
Gets all time parameters for a vehicle.

**Usage:**
```sql
SELECT get_vehicle_auction_times('e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8');
```

**Returns:** Complete time parameters object

### vehicle_auction_times View
View showing countdown and status for all PCarMarket auctions.

**Usage:**
```sql
SELECT 
  vehicle_id,
  year, make, model,
  countdown,
  auction_status,
  time_remaining_seconds
FROM vehicle_auction_times
WHERE auction_status = 'active'
ORDER BY time_remaining_seconds ASC;
```

## Scripts

### 1. Extract Auction Times
```bash
node scripts/extract-pcarmarket-auction-times.js <auction_url> [vehicle_id]
```

Extracts time data from PCarMarket page and updates vehicle.

### 2. Calculate Countdown
```bash
node scripts/calculate-auction-countdown.js <vehicle_id>
node scripts/calculate-auction-countdown.js <vehicle_id> --live
```

Calculates and displays countdown. Use `--live` for real-time updates.

## Edge Function

### calculate-auction-countdown
Serverless function to calculate countdown.

**Request:**
```json
{
  "vehicle_id": "e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8"
}
```

**Response:**
```json
{
  "success": true,
  "end_date": "2025-01-22T18:00:00Z",
  "current_time": "2025-01-20T12:00:00Z",
  "countdown": {
    "days": 2,
    "hours": 12,
    "minutes": 0,
    "seconds": 0,
    "total_seconds": 216000,
    "is_expired": false,
    "formatted": "2 days, 12 hours",
    "formatted_short": "2d 12h"
  },
  "time_remaining_seconds": 216000,
  "time_remaining_formatted": "2 days, 12 hours",
  "is_expired": false
}
```

## Usage Examples

### Query Active Auctions with Countdown
```sql
SELECT 
  v.id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  v.auction_end_date,
  calculate_auction_countdown(v.auction_end_date)->>'formatted' as time_remaining,
  calculate_auction_countdown(v.auction_end_date)->>'is_expired' as is_expired
FROM vehicles v
WHERE v.profile_origin = 'pcarmarket_import'
  AND v.auction_end_date > NOW()
ORDER BY v.auction_end_date ASC;
```

### Get All Time Parameters
```sql
SELECT get_vehicle_auction_times('e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8');
```

### View All Active Auctions
```sql
SELECT * FROM vehicle_auction_times 
WHERE auction_status = 'active'
ORDER BY time_remaining_seconds ASC;
```

## Integration

Time extraction is integrated into:
- `scripts/scrape-pcarmarket-all-images.js` - Extracts times during image scraping
- `scripts/extract-pcarmarket-auction-times.js` - Dedicated time extraction
- `supabase/functions/calculate-auction-countdown/index.ts` - Edge Function API

## Next Steps

1. ✅ Extract auction dates from page
2. ✅ Calculate countdown
3. ✅ Store in database
4. ✅ Create SQL functions
5. ⏭️ Add real-time countdown display in UI
6. ⏭️ Set up scheduled jobs to update countdowns
7. ⏭️ Add notifications for ending auctions

