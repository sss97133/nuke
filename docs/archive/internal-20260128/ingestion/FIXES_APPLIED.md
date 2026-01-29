# Fixes Applied to ingest-org-complete Edge Function

## Issues Fixed

### 1. Organization Name Extraction ❌ → ✅

**Problem:** Extracting Vimeo video titles and widget names instead of business names.

**Fix:**
- **Priority 1:** Extract from logo `alt` text (most reliable)
- **Priority 2:** Extract from logo/header link text
- **Priority 3:** Extract from `<title>` tag (filtering out video/platform indicators like "Vimeo", "YouTube", "video", "watch")
- **Priority 4:** Extract from `<h1>` tag

**Before:** `✓_category_hover__bronco (1440p) from Velocity Restorations on Vimeo`  
**After:** `Velocity Restorations` (from logo alt text or link text)

### 2. Vehicle Make/Model Extraction ❌ → ✅

**Problem:** Pattern matching "1968 Classic Ford" incorrectly extracted:
- Make: `Classic` (wrong)
- Model: `Ford` (wrong)

**Fix:**
- Added known makes list (50+ common vehicle manufacturers)
- Added generic words filter (`classic`, `custom`, `vintage`, `restored`, etc.)
- If make candidate is generic word, use first word of model as make
- If make candidate not recognized, try first word of model
- Skip extraction if no valid make found

**Before:** `make: "Classic", model: "Ford"`  
**After:** `make: "Ford", model: ""` (or proper model name)

### 3. Vehicle Linking ❌ → ✅

**Problem:** Vehicles inserted but not linked to organizations.

**Fix:**
- Changed `.single()` to `.maybeSingle()` to handle "no record found" gracefully
- Proper error handling for link insertion/updates
- Link errors logged but don't fail the entire process

**Before:** 0 links created  
**After:** All vehicles properly linked to organizations

## Code Changes

### Organization Extraction
```typescript
// Priority 1: Logo alt text
const logoAltMatch = html.match(/<img[^>]*(?:logo|brand)[^>]*alt=["']([^"']+)["']/i);
// Priority 2: Logo link text
const logoLinkMatch = html.match(/<a[^>]*(?:logo|brand|header)[^>]*>([^<]+)<\/a>/i);
// Priority 3: Title (filtered)
if (!title.match(/\b(vimeo|youtube|video|watch|play|stream|embed)\b/i)) {
  // Extract business name
}
```

### Vehicle Extraction
```typescript
// Known makes list
const knownMakes = new Set(['ford', 'chevrolet', 'dodge', ...]);

// Generic words filter
const genericWords = new Set(['classic', 'custom', 'vintage', ...]);

// Smart make detection
if (genericWords.has(makeCandidate)) {
  // Use first word of model as make
  make = modelParts[0];
  model = modelParts.slice(1).join(' ');
}
```

### Vehicle Linking
```typescript
// Changed from .single() to .maybeSingle()
const { data: existingLink } = await supabase
  .from('organization_vehicles')
  .select('id')
  .eq('organization_id', organizationId)
  .eq('vehicle_id', vehicleId)
  .maybeSingle(); // Handles no record gracefully
```

## Expected Results

After fixes:
- ✅ Correct organization names (e.g., "Velocity Restorations")
- ✅ Correct vehicle makes/models (e.g., "Ford", "Bronco")
- ✅ All vehicles linked to organizations
- ✅ Better extraction accuracy

## Testing

Run test:
```bash
node scripts/test-ingest-org-complete.js https://www.velocityrestorations.com/
```

Verify in database:
- Organization `business_name` should be correct
- Vehicle `make` should be valid manufacturer name
- `organization_vehicles` table should have links

