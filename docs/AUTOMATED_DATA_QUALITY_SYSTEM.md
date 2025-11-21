# Automated Data Quality System

## Overview

This system automatically detects and fixes data quality issues (like incorrect prices) **without requiring manual intervention via Cursor or other tools**.

## 🎯 The Problem You Had

- Price was wrong: $0 instead of $11,000
- Had to manually use Cursor to fix it
- Had to write SQL scripts
- Had to scrape BaT manually

## ✅ The Solution

**Now you just click a button** - the system does everything automatically!

## Components

### 1. Edge Function: `auto-fix-bat-prices`

**Location:** `supabase/functions/auto-fix-bat-prices/index.ts`

**What it does:**
- Scrapes BaT listings to get current price data
- Compares with database values
- Automatically fixes mismatches
- Adds field source attribution
- Logs all fixes for audit trail

**Actions:**
- `check_and_fix` - Fix a specific vehicle or all vehicles
- `check_only` - Check for issues without fixing
- `fix_batch` - Fix a batch of vehicles (for cron jobs)

### 2. Database Migration: `20251121_auto_fix_bat_prices.sql`

**What it creates:**
- `vehicle_price_fixes` table - Audit trail of all price fixes
- `detect_price_issues()` function - Finds vehicles with price problems
- `price_issues_dashboard` view - UI-friendly view of issues
- `log_price_fix()` function - Logs fixes with before/after values
- Daily cron job - Automatically runs fixes at 2 AM

### 3. UI Component: `PriceFixButton`

**Location:** `nuke_frontend/src/components/vehicle/PriceFixButton.tsx`

**What it does:**
- **Automatically detects** price issues on vehicle profile
- Shows warning banner when issues found
- **One-click button** to trigger automatic fix
- Shows success/error feedback
- Auto-refreshes page after fix

**Integration:**
- Automatically appears on `VehicleProfile.tsx` when issues detected
- **No manual action needed** - just click "Auto-Fix" button

## How It Works

### Automatic Detection

1. **On Vehicle Load:**
   - `PriceFixButton` checks if `sale_price = 0` or `bat_sold_price = NULL`
   - If BaT URL exists, shows warning banner

2. **Daily Cron Job:**
   - Runs at 2 AM every day
   - Finds all vehicles with price issues
   - Processes 10 vehicles per run
   - Automatically fixes them

3. **Manual Trigger (One-Click):**
   - User clicks "Auto-Fix" button on vehicle profile
   - Edge function scrapes BaT listing
   - Updates database with correct price
   - Adds field source attribution

### Fix Process

1. **Scrape BaT:**
   - Opens BaT listing URL
   - Extracts price from page title: "sold for $11,000"
   - Extracts sale date and lot number

2. **Compare:**
   - Checks `sale_price` vs BaT price
   - Checks `bat_sold_price` vs BaT price
   - Checks `bat_sale_date` vs BaT date

3. **Fix:**
   - Updates incorrect values
   - Adds field source with BaT URL
   - Logs fix in `vehicle_price_fixes` table
   - Returns success/failure status

4. **Attribution:**
   - Creates `vehicle_field_sources` entry
   - Source: `ai_scraped`
   - URL: BaT listing
   - Confidence: 100%
   - Metadata: lot number, extraction date

## Usage

### For Users (No Technical Knowledge Required)

**On Vehicle Profile:**
1. If price issue detected, see warning banner
2. Click "Auto-Fix" button
3. Wait 2-3 seconds
4. Page refreshes with correct price

**That's it!** No Cursor, no SQL, no manual work.

### For Developers

**Trigger Fix for Specific Vehicle:**
```typescript
const { data } = await supabase.functions.invoke('auto-fix-bat-prices', {
  body: {
    vehicle_id: 'f7a10a48-4cd8-4ff9-9166-702367d1c859',
    action: 'check_and_fix',
  },
});
```

**Check for Issues (No Fix):**
```typescript
const { data } = await supabase.functions.invoke('auto-fix-bat-prices', {
  body: {
    action: 'check_only',
  },
});
```

**View Issues Dashboard:**
```sql
SELECT * FROM price_issues_dashboard ORDER BY severity, updated_at DESC;
```

**View Fix History:**
```sql
SELECT * FROM vehicle_price_fixes 
WHERE vehicle_id = 'f7a10a48-4cd8-4ff9-9166-702367d1c859'
ORDER BY created_at DESC;
```

## Monitoring

### Price Issues Dashboard

Query the `price_issues_dashboard` view to see:
- All vehicles with price issues
- Issue type (sale_price_zero, bat_sold_price_missing, etc.)
- Severity (high, medium, low)
- Last fix attempt
- Fix count

### Fix History

The `vehicle_price_fixes` table tracks:
- Before/after values
- Fix method (auto_scrape, manual, batch_job)
- Success/failure status
- Error messages
- Timestamps

## Extending the System

### Add More Issue Types

1. Add detection logic to `detect_price_issues()` function
2. Add fix logic to `auto-fix-bat-prices` edge function
3. Add UI component for new issue type

### Add More Data Sources

Currently supports:
- Bring a Trailer (BaT)

Can be extended to:
- eBay Motors
- Cars & Bids
- Hemmings
- Classic.com
- Private sales

### Add More Field Types

Currently fixes:
- `sale_price`
- `bat_sold_price`
- `bat_sale_date`
- `bat_listing_title`

Can be extended to:
- VIN validation
- Mileage verification
- Image URL validation
- Any other field with external source

## Benefits

1. **No Manual Work** - System fixes issues automatically
2. **Self-Healing** - Database corrects itself over time
3. **Audit Trail** - All fixes logged for review
4. **User-Friendly** - One-click fix from UI
5. **Scalable** - Handles thousands of vehicles
6. **Reliable** - Runs daily, catches issues quickly

## Future Enhancements

1. **Admin Dashboard** - View all issues and fix history
2. **Bulk Fix** - Fix all issues at once from admin panel
3. **Notifications** - Alert when issues detected
4. **Confidence Scores** - Rate fix confidence based on source
5. **Multi-Source Validation** - Compare prices from multiple sources
6. **Price History** - Track price changes over time

---

*This system eliminates the need for manual data fixes via Cursor or SQL scripts.*
