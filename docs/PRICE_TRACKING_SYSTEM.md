# Vehicle Price Tracking System

## Overview

The Nuke platform tracks vehicle prices over time like stock prices - every price change is recorded as a point in the price history graph. Prices are treated as "transfers of ownership" that go up and down, creating a complete audit trail of value changes.

## Architecture

### Database Tables

#### `vehicles` Table
Stores current price values:
- `sale_price` - Final sale price (when vehicle is sold)
- `sale_date` - Date of sale
- `sale_status` - Status: 'available', 'sold', 'pending'
- `asking_price` - Current asking price
- `current_value` - Estimated current market value
- `purchase_price` - Original purchase price
- `msrp` - Manufacturer's suggested retail price

#### `vehicle_price_history` Table
Tracks all price changes over time:
- `vehicle_id` - Reference to vehicle
- `price_type` - Type: 'msrp', 'purchase', 'current', 'asking', 'sale'
- `value` - The price value
- `source` - Where the price came from (e.g., 'db_trigger', 'bat_import', 'user_input')
- `as_of` - Timestamp when this price was effective
- `created_at` - When the record was created
- `confidence` - Confidence score (0-100)
- `is_estimate` - Whether this is an estimate or actual price
- `logged_by` - User who triggered the change
- `proof_url` - URL to proof/documentation
- `seller_name` - Name of seller (for sale prices)
- `buyer_name` - Name of buyer (for sale prices)
- `notes` - Additional notes

### Automatic Price Tracking

A database trigger (`trg_log_vehicle_price_history`) automatically logs all price changes:

```sql
CREATE TRIGGER trg_log_vehicle_price_history
  AFTER UPDATE OF msrp, purchase_price, current_value, asking_price, sale_price 
  ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION log_vehicle_price_history();
```

**How it works:**
1. When any price field is updated in the `vehicles` table
2. The trigger automatically creates a record in `vehicle_price_history`
3. The record includes the new price, timestamp, and source information
4. This creates a complete audit trail of all price changes

### Price Types

- **`msrp`** - Manufacturer's suggested retail price (original MSRP)
- **`purchase`** - Purchase price (what the current owner paid)
- **`current`** - Current estimated market value
- **`asking`** - Asking price (if vehicle is for sale)
- **`sale`** - Final sale price (when vehicle is sold)

## Usage

### Recording Sold Prices

Use the `vehiclePriceTrackingService` to record sold prices:

```typescript
import { recordSoldPrice } from '@/services/vehiclePriceTrackingService';

await recordSoldPrice(
  vehicleId,
  90000, // sale price
  '2025-12-17', // sale date
  {
    source: 'bat_import',
    seller_name: 'John Doe',
    buyer_name: 'Jane Smith',
    proof_url: 'https://bringatrailer.com/listing/...',
    notes: 'Sold at BaT auction'
  }
);
```

This will:
1. Update the vehicle's `sale_price` and `sale_date`
2. Automatically trigger the price history logging
3. Add enriched metadata to the price history

### Querying Price History

Get price history for a vehicle over time:

```typescript
import { getPriceHistory } from '@/services/vehiclePriceTrackingService';

const history = await getPriceHistory({
  vehicleId: 'dc368c60-755e-4bd0-85f0-223316719de1',
  priceType: 'sale', // optional: filter by price type
  startDate: '2025-01-01', // optional
  endDate: '2025-12-31', // optional
  limit: 100 // optional
});
```

This returns an array of price points that can be plotted like a stock price graph.

### Getting Price Trends

Get price trends showing how prices have changed:

```typescript
import { getPriceTrends } from '@/services/vehiclePriceTrackingService';

const trends = await getPriceTrends(vehicleId);
// Returns: [{ price_type, current_value, previous_value, change, change_percent, as_of }]
```

### Finding Missing Sold Prices

Find vehicles that are missing sold price data:

```typescript
import { getVehiclesMissingSoldPrice } from '@/services/vehiclePriceTrackingService';

const missing = await getVehiclesMissingSoldPrice();
// Returns vehicles that are sold but missing sale_price
```

## Total Inventory Value Calculation

The total inventory value is calculated in `CursorHomepage.tsx` using a priority system:

1. **If sold**: Use `sale_price`
2. **Otherwise**: Use `asking_price`
3. **Fallback**: Use `current_value`
4. **Last resort**: Use `purchase_price`

This ensures the total reflects the actual/realized value for sold vehicles and the asking/estimated value for available vehicles.

## Backfilling Missing Sold Prices

Use the backfill script to find and record missing sold prices:

```bash
# Find vehicles missing sold price data
npx ts-node scripts/backfill-sold-prices.ts

# Auto-backfill vehicles with bat_sold_price
npx ts-node scripts/backfill-sold-prices.ts --auto
```

The script will:
1. Find vehicles marked as sold but missing `sale_price`
2. Find vehicles with `sale_date` but no `sale_price`
3. Find vehicles with `bat_sold_price` but no `sale_price`
4. Optionally auto-backfill using available data

## Price Changes as "Transfers of Ownership"

The system treats price changes as "transfers of ownership" that go up and down:

1. **Every price change is recorded** - No price change goes untracked
2. **Complete audit trail** - Every price point has a timestamp, source, and metadata
3. **Historical analysis** - Can query price history over any time period
4. **Trend analysis** - Can calculate price changes, percentages, and trends
5. **Source attribution** - Every price has a verifiable source

This creates a complete picture of how vehicle values change over time, similar to stock price tracking.

## Best Practices

1. **Always record sold prices** - When a vehicle is sold, immediately record the `sale_price` and `sale_date`
2. **Use source attribution** - Include metadata about where the price came from (BAT, manual entry, etc.)
3. **Include proof URLs** - For sold prices, include the auction URL or listing URL
4. **Regular backfills** - Periodically run the backfill script to catch missing sold prices
5. **Monitor price history** - Use the price history API to track value changes over time

## API Reference

See `nuke_frontend/src/services/vehiclePriceTrackingService.ts` for the complete API reference.

## Database Schema

See `supabase/migrations/20251101000002_create_vehicle_price_history.sql` for the complete schema.

