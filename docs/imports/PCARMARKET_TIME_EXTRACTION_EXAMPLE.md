# PCarMarket Time Extraction - Complete Example

## Time Parameters Extracted

### Example Output

For an auction ending in 2 days, 12 hours, 30 minutes:

```json
{
  "auction_start_date": "2025-01-15T10:00:00Z",
  "auction_end_date": "2025-01-22T18:00:00Z",
  "current_time": "2025-01-20T05:30:00Z",
  "timezone": "America/Los_Angeles",
  
  "is_active": true,
  "is_ended": false,
  "is_upcoming": false,
  
  "time_remaining_seconds": 216000,
  "time_remaining_minutes": 3600,
  "time_remaining_hours": 60,
  "time_remaining_days": 2,
  "time_remaining_formatted": "2 days, 12 hours, 30 minutes",
  
  "time_since_start_seconds": 432000,
  "time_since_start_minutes": 7200,
  "time_since_start_hours": 120,
  "time_since_start_days": 5,
  "time_since_start_formatted": "5 days, 0 hours",
  
  "total_duration_seconds": 604800,
  "total_duration_days": 7,
  
  "countdown": {
    "days": 2,
    "hours": 12,
    "minutes": 30,
    "seconds": 0,
    "total_seconds": 216000,
    "is_expired": false,
    "formatted": "2 days, 12 hours, 30 minutes",
    "formatted_short": "2d 12h 30m"
  }
}
```

## SQL Query Examples

### Get Countdown for Vehicle
```sql
SELECT 
  v.id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  calculate_auction_countdown(v.auction_end_date) as countdown
FROM vehicles v
WHERE v.id = 'e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8';
```

### All Active Auctions
```sql
SELECT 
  vehicle_id,
  year || ' ' || make || ' ' || model as vehicle,
  countdown->>'formatted' as time_remaining,
  countdown->>'days'::int as days,
  countdown->>'hours'::int as hours,
  countdown->>'minutes'::int as minutes
FROM vehicle_auction_times
WHERE auction_status = 'active'
ORDER BY time_remaining_seconds ASC;
```

### Auctions Ending Soon (Next 24 Hours)
```sql
SELECT 
  v.id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  calculate_auction_countdown(v.auction_end_date)->>'formatted_short' as ends_in,
  v.discovery_url
FROM vehicles v
WHERE v.profile_origin = 'pcarmarket_import'
  AND v.auction_end_date > NOW()
  AND v.auction_end_date <= NOW() + INTERVAL '24 hours'
ORDER BY v.auction_end_date ASC;
```

## JavaScript Usage

### Calculate Countdown
```javascript
import { calculateCountdown } from './scripts/calculate-auction-countdown.js';

const endDate = '2025-01-22T18:00:00Z';
const countdown = calculateCountdown(endDate);

console.log(countdown.formatted); // "2 days, 12 hours"
console.log(countdown.formatted_short); // "2d 12h"
console.log(countdown.is_expired); // false
```

### Get Vehicle Countdown
```javascript
const result = await getVehicleCountdown(vehicleId);
console.log(result.countdown.formatted);
```

### Live Countdown Display
```javascript
// Updates every second
await displayLiveCountdown(vehicleId, 1);
```

## Edge Function Usage

```bash
curl -X POST https://your-project.supabase.co/functions/v1/calculate-auction-countdown \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"vehicle_id": "e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8"}'
```

## Integration Points

1. **During Import** - Time data extracted and stored
2. **SQL Functions** - Real-time countdown calculation
3. **Edge Function** - API access for frontend
4. **View** - Easy querying of all auctions
5. **Scripts** - Command-line tools for extraction/display

## Display Formats

### Short Format
- `2d 12h 30m` - For compact displays
- `5h 15m` - Hours and minutes only
- `45s` - Seconds only (if < 1 hour)
- `Ended` - If expired

### Long Format
- `2 days, 12 hours, 30 minutes` - Full description
- `5 days, 0 hours` - Days only
- `12 hours, 30 minutes` - Hours and minutes
- `Auction ended` - If expired

## Real-Time Updates

The countdown can be updated in real-time:

```javascript
// Update every second
setInterval(async () => {
  const countdown = await getVehicleCountdown(vehicleId);
  updateDisplay(countdown);
}, 1000);
```

Or use the `--live` flag:
```bash
node scripts/calculate-auction-countdown.js <vehicle_id> --live
```

---

All time parameters are now calculated and stored! ✅

