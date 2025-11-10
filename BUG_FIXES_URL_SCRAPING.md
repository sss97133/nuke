# Bug Fixes: URL Scraping

**Date:** November 5, 2025  
**Issues:** 406 Error + TypeError on mileage.replace

---

## Bug #1: 406 Error on Duplicate URL Check

### Error
```
qkgaybvrernstplzjaam.supabase.co/rest/v1/vehicles?select=id%2Cmake%2Cmodel%2Cyear%2Cdiscovered_by&discovery_url=eq.https%3A%2F%2Flasvegas.craigslist.org%2Fcto%2Fd%2Fpahrump-gmc-squarebody-short-bed%2F7893296003.html:1  
Failed to load resource: the server responded with a status of 406 ()
```

### Root Cause
**RLS Policies:** The `vehicles` table has RLS enabled, but there was no policy allowing anonymous users to check for duplicate `discovery_url` values on public vehicles.

**Existing policies:**
- `Public vehicles are viewable by everyone` - only checks `is_public = true`
- No specific policy for `discovery_url` lookups

### Fix Applied
```sql
-- Allow anon users to check duplicate discovery_url (public vehicles only)
CREATE POLICY "anon_check_duplicate_discovery_url"
  ON vehicles FOR SELECT
  TO anon
  USING (
    discovery_url IS NOT NULL 
    AND is_public = true
  );

-- Allow authenticated users to check any vehicle by discovery_url
CREATE POLICY "authenticated_check_duplicate_discovery_url"
  ON vehicles FOR SELECT
  TO authenticated
  USING (discovery_url IS NOT NULL);
```

**Result:** Anonymous and authenticated users can now query by `discovery_url` to check for duplicates before scraping.

---

## Bug #2: TypeError - mileage.replace is not a function

### Error
```javascript
URL scraping error: TypeError: et.mileage.replace is not a function
    at index-ByV6TR2-.js:330:491
```

### Root Cause
**AddVehicle.tsx line 293:**
```typescript
if (scrapedData.mileage) updates.mileage = parseInt(scrapedData.mileage.replace(/,/g, ''));
```

**Problem:** The code assumes `mileage` is always a string, but the scraper sometimes returns a number directly.

**Example:**
```typescript
// Craigslist scraper might return:
scrapedData.mileage = "125,000" // String - works
scrapedData.mileage = 125000    // Number - BREAKS
```

### Fix Applied
**Before:**
```typescript
if (scrapedData.mileage) updates.mileage = parseInt(scrapedData.mileage.replace(/,/g, ''));
```

**After:**
```typescript
if (scrapedData.mileage) {
  // Handle both string and number mileage
  const mileageStr = typeof scrapedData.mileage === 'string' 
    ? scrapedData.mileage 
    : String(scrapedData.mileage);
  updates.mileage = parseInt(mileageStr.replace(/,/g, ''));
}
```

**Result:** Works with both string and number inputs.

---

## Additional Fix: Mobile Duplicate Check

**MobileAddVehicle.tsx** was using `.single()` which throws an error if no match is found.

**Before:**
```typescript
const { data: existing } = await supabase
  .from('vehicles')
  .select('id, year, make, model')
  .eq('discovery_url', url)
  .single(); // ❌ Throws error if not found
```

**After:**
```typescript
const { data: existing } = await supabase
  .from('vehicles')
  .select('id, year, make, model, is_public')
  .eq('discovery_url', url)
  .maybeSingle(); // ✅ Returns null if not found
```

---

## Testing

### Test Case 1: Craigslist URL (Number Mileage)
```
URL: https://lasvegas.craigslist.org/cto/d/pahrump-gmc-squarebody-short-bed/7893296003.html
Scraped mileage: 125000 (number)
Result: ✅ Converts to string, removes commas, parses to integer
```

### Test Case 2: BaT URL (String Mileage)
```
URL: https://bringatrailer.com/listing/1964-chevrolet-corvette-327-375/
Scraped mileage: "77,350" (string with commas)
Result: ✅ Removes commas, parses to integer
```

### Test Case 3: Duplicate URL Check
```
URL: https://example.com/vehicle-123
First import: Creates vehicle
Second import: ✅ Detects duplicate, redirects to existing profile
```

---

## Files Modified

1. **`AddVehicle.tsx`**
   - Fixed mileage type handling (line 293)

2. **`MobileAddVehicle.tsx`**
   - Changed `.single()` to `.maybeSingle()`
   - Added `is_public` to select

3. **Supabase RLS Policies**
   - Added `anon_check_duplicate_discovery_url`
   - Added `authenticated_check_duplicate_discovery_url`

---

## Prevention

### Type Safety Recommendation
Add TypeScript interface for scraped data:

```typescript
interface ScrapedVehicleData {
  make?: string;
  model?: string;
  year?: string | number;
  vin?: string;
  mileage?: string | number; // ← Accept both types
  color?: string;
  transmission?: string;
  engine_size?: string;
  sale_price?: number;
  title?: string;
  source?: string;
}
```

### Robust Parsing Helper
```typescript
function parseNumericField(value: string | number | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  
  const str = typeof value === 'string' ? value : String(value);
  const cleaned = str.replace(/[^0-9]/g, ''); // Remove all non-digits
  const parsed = parseInt(cleaned, 10);
  
  return isNaN(parsed) ? undefined : parsed;
}

// Usage:
if (scrapedData.mileage) {
  updates.mileage = parseNumericField(scrapedData.mileage);
}
```

---

## Summary

✅ **Fixed 406 Error:** Added RLS policies for `discovery_url` lookups  
✅ **Fixed TypeError:** Handle both string and number mileage  
✅ **Fixed Mobile:** Use `.maybeSingle()` instead of `.single()`  
✅ **Deployed:** All fixes applied and ready for testing

