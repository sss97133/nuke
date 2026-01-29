# Intelligent Dealer Detection System

## Overview

This system automatically detects when dealers post their inventory across multiple Craigslist cities (like Jordan Motorsports), creates/finds organizations, and aggregates their full inventory from their websites.

## The Problem

Some dealers post the same vehicles on Craigslist across multiple cities. They include:
- VIN in listing (e.g., `<span class="valu">1FTSW31F73EA94719</span>`)
- Dealer name and website URL in listing
- Same vehicle, different Craigslist city URLs

Without intelligent detection, this creates:
- Duplicate vehicle profiles (same VIN, different listings)
- Missing organization relationships
- Unaggregated inventory data

## Solution Architecture

### 1. Enhanced VIN Extraction (`scrape-vehicle`)

**File:** `supabase/functions/scrape-vehicle/index.ts`

- Added pattern for `<span class="valu">VIN</span>` format (Jordan Motorsports pattern)
- Prioritizes VIN extraction before other parsing

```typescript
// Pattern 1: Dealer listings with <span class="valu">VIN</span>
/<span[^>]*class="[^"]*valu[^"]*"[^>]*>([A-HJ-NPR-Z0-9]{17})<\/span>/i
```

### 2. Dealer Information Extraction (`scrape-vehicle`)

**File:** `supabase/functions/scrape-vehicle/index.ts`

New `extractDealerInfo()` function extracts:
- **Dealer name**: Patterns like "Jordan Motorsports", "Desert Performance"
- **Website URL**: Extracts from HTML and text (e.g., `jordanmotorsport.com`)
- **Phone number**: Standard phone patterns

**Extraction Methods:**
1. Website URLs: Multiple regex patterns for domain extraction
2. Dealer names: Patterns matching "Name + Motors/Motorsports/Auto/Classics"
3. Phone numbers: Standard US phone formats
4. Domain-to-name inference: If website found but no name, extract from domain

### 3. Intelligent Organization Detection (`process-import-queue`)

**File:** `supabase/functions/process-import-queue/index.ts`

**Matching Priority:**
1. **Website match** (strongest): If dealer website exists in listing, match organizations by `website` field
2. **Name match**: Match by slug or name similarity
3. **Create new**: If no match, create new organization

**Features:**
- Updates organization website if found org by name but missing website
- Creates organization from domain if only website URL found
- Links vehicles to organizations automatically

### 4. VIN-Based Cross-City Deduplication

**File:** `supabase/functions/process-import-queue/index.ts`

**Logic:**
- Before creating vehicle, check if VIN already exists
- If same VIN found:
  - **Skip creation** - don't create duplicate
  - **Update discovery_url** - point to latest listing (cross-city detection)
  - **Link to organization** - ensure vehicle linked to dealer org
  - **Mark queue item as completed** - merged with existing

**Example Flow:**
1. Nashville Craigslist listing: `1FTSW31F73EA94719` + Jordan Motorsports
2. Portland Craigslist listing: `1FTSW31F73EA94719` + Jordan Motorsports  
3. **Result**: Single vehicle profile, updated discovery URL, linked to Jordan Motorsports org

### 5. Automatic Inventory Sync

**File:** `supabase/functions/process-import-queue/index.ts`

**Function:** `triggerDealerInventorySync()`

When dealer organization is detected:
- Triggers `scrape-multi-source` to scrape dealer's full website
- Scrapes up to 100 vehicles from their inventory page
- Rate-limited: Only syncs once per 24 hours per organization
- Updates `last_inventory_sync` timestamp

**Integration:**
- Automatically called when:
  - Existing organization found with website
  - New organization created with website

## Data Flow

```
Craigslist Listing (Nashville)
  ↓
scrape-vehicle extracts:
  - VIN: 1FTSW31F73EA94719
  - Dealer: Jordan Motorsports
  - Website: jordanmotorsport.com
  ↓
process-import-queue:
  1. Check VIN: Does 1FTSW31F73EA94719 exist?
     → NO: Create vehicle
     → YES: Update existing, skip duplicate
  2. Check Organization: Does jordanmotorsport.com exist?
     → NO: Create org
     → YES: Link to existing
  3. Trigger inventory sync (async)
     → Scrape jordanmotorsport.com
     → Import all vehicles from website
```

## Attribution & Tracking

### Vehicle Attribution

- **discovery_url**: Latest Craigslist listing URL (updates on cross-city detection)
- **origin_organization_id**: Links vehicle to dealer organization
- **selling_organization_id**: Same as origin (dealer is seller)
- **origin_metadata**: Stores queue_id, source_id, image_urls

### Organization Attribution

- **discovered_via**: 'import_queue' (tracks how org was found)
- **source_url**: First Craigslist listing that discovered the org
- **website**: Canonical website URL (used for matching)
- **last_inventory_sync**: Tracks when website was last scraped

## Example: Jordan Motorsports

**Listing 1 (Nashville):**
```
URL: https://nashville.craigslist.org/ctd/d/nashville-2003-ford-l-powerstroke-fx4/7899809394.html
VIN: 1FTSW31F73EA94719
Dealer: Jordan Motorsports
Website: jordanmotorsport.com
```

**Listing 2 (Portland - same vehicle):**
```
URL: https://portland.craigslist.org/...
VIN: 1FTSW31F73EA94719 (same)
Dealer: Jordan Motorsports (same)
Website: jordanmotorsport.com (same)
```

**System Behavior:**
1. First listing creates vehicle + organization
2. Second listing detects existing VIN → updates discovery_url, links to org
3. Organization inventory sync scrapes jordanmotorsport.com
4. Result: Single vehicle profile, linked to organization, full inventory imported

## Scale Considerations

As mentioned: **~1000 dealers** operate this way across the US.

**Current Implementation:**
- Handles any dealer with VIN + name/website pattern
- No hardcoded dealer list (fully automated)
- Scales to all 1000+ dealers automatically

**Performance:**
- VIN lookups: Indexed database queries (fast)
- Organization matching: Indexed by website/name (fast)
- Inventory sync: Rate-limited to prevent overload (24h cooldown)

## Future Enhancements

1. **LLM Prompt Engineering**: Use GPT-4 to better extract dealer info from unstructured text
2. **Pattern Learning**: Track which dealers post where, build predictive models
3. **Multi-Platform**: Extend beyond Craigslist (Facebook Marketplace, etc.)
4. **Dealer Verification**: Flag verified dealers vs suspected dealers
5. **Inventory Diff**: Track which vehicles sold/added between syncs

## Testing

To test with Jordan Motorsports:
1. Import Nashville listing: `https://nashville.craigslist.org/ctd/d/nashville-2003-ford-l-powerstroke-fx4/7899809394.html`
2. Verify: Organization created, VIN extracted
3. Import Portland listing (same VIN)
4. Verify: No duplicate created, vehicle linked to same org
5. Check: Organization inventory should sync from jordanmotorsport.com

## Files Modified

- `supabase/functions/scrape-vehicle/index.ts` - VIN extraction, dealer info extraction
- `supabase/functions/process-import-queue/index.ts` - Organization detection, VIN deduplication, inventory sync

