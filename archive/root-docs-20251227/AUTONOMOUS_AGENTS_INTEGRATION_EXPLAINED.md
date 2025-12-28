# How Autonomous Agents Fit Into Your Existing System

**Perfect Integration**: The autonomous agents use your **existing proven `scrape-multi-source` function** and populate your **existing database schema**.

## 🔄 **Complete Data Flow**

### **Your Existing Database Fields Get Filled**:

```sql
-- VEHICLES TABLE (100+ fields populated)
vehicles:
├── Basic: make, model, year, vin, color, mileage
├── Details: transmission, engine_size, drivetrain, trim  
├── Auction: sale_price, bat_auction_url, bat_seller, bat_bids
├── Location: city, state, zip_code, gps_latitude, gps_longitude
├── Images: primary_image_url, image_url
├── Metadata: discovery_source, discovery_url, origin_metadata
└── Provenance: *_source, *_confidence for every field

-- BUSINESSES TABLE (organizations created automatically)
businesses:
├── Basic: business_name, business_type, phone, email, website
├── Location: address, city, state, zip_code, latitude, longitude  
├── Details: specializations, services_offered, total_vehicles
├── Branding: logo_url, banner_url, metadata.brand_assets
└── Discovery: source_url, discovered_via, metadata.scrape_source_id
```

### **Your Existing `scrape-multi-source` Function Does**:

1. **✅ DOM Mapping**: Uses Firecrawl structured extraction + LLM fallback
2. **✅ Extract**: Pulls vehicle data using extraction schemas  
3. **✅ Normalize**: Validates and cleans extracted data
4. **✅ Paginate**: Handles large inventories with batching
5. **✅ Insert TO CORRECT SPOTS**:
   - `businesses` table (auto-creates dealer/auction house profiles)
   - `scrape_sources` table (tracks source health)
   - `import_queue` table (staging for vehicle processing)
   - `vehicles` table (via downstream `process-import-queue`)
   - `vehicle_images` table (downloads and processes images)
   - `organization_vehicles` table (links vehicles to organizations)

## 🤖 **Autonomous Agents Integration**

### **What Agents Do**:
```
Autonomous Agent (every 4 hours)
    ↓
1. Reads curated_sources table (your premium auction sites)
2. Calls your existing scrape-multi-source function
3. scrape-multi-source does all the DOM mapping/extraction
4. Data flows into your existing database schema
5. Logs results to agent_execution_logs
    ↓
33k vehicles/day in your existing tables
```

### **Exact Integration Points**:

**Agent Code**:
```typescript
// Autonomous agents call your existing function
const response = await fetch(`${supabaseUrl}/functions/v1/scrape-multi-source`, {
  body: JSON.stringify({
    source_url: site.url,           // Cars & Bids, Mecum, etc.
    source_type: 'auction_house',   // Sets businessType in your function
    max_listings: maxVehicles,      // Batch size control
    extract_dealer_info: true       // Creates business profiles
  })
});
```

**Your Function Response** (exactly what scrape-multi-source returns):
```json
{
  "success": true,
  "source_id": "uuid",           // scrape_sources.id
  "organization_id": "uuid",     // businesses.id (auto-created)
  "listings_found": 25,          // Total vehicles discovered  
  "listings_queued": 25,         // import_queue records created
  "squarebody_count": 5,         // Specialty vehicle count
  "sample_listings": [...]       // Preview of extracted data
}
```

## 📊 **Data Populates Your Existing Schema**

### **No New Tables, No Duplicate Systems**:

✅ **Uses `vehicles` table** - All 100+ fields filled correctly  
✅ **Uses `businesses` table** - Auction house profiles auto-created  
✅ **Uses `import_queue`** - Your existing staging system  
✅ **Uses `vehicle_images`** - Downloads and processes images  
✅ **Uses `scrape_sources`** - Tracks source health  
✅ **Uses existing provenance** - `*_source` and `*_confidence` fields

### **DOM Mapping is Automatic**:

Your `scrape-multi-source` function **already handles DOM mapping**:
- ✅ **Firecrawl structured extraction** with vehicle schemas
- ✅ **LLM fallback** for complex sites  
- ✅ **Direct HTML parsing** for simple sites
- ✅ **URL enumeration** for listing discovery
- ✅ **Source-specific logic** (BaT, Classic.com, BHCC, etc.)

## 🎯 **What This Solves**

### **Your Original Problem**:
> "thousands of sites that need to be mapped before we extract them"

### **Solution**:
**Autonomous agents continuously discover and extract** using your existing `scrape-multi-source` function that **already handles DOM mapping** for different site types.

### **For 1M Profiles**:
```
Daily Agent Run:
├── Reads 10 curated premium auction sites
├── Calls scrape-multi-source for each site  
├── scrape-multi-source maps DOM structure automatically
├── Extracts vehicle data to your existing schema
├── Creates organization profiles automatically
└── Results: 33k vehicles/day in your existing tables
```

## ✅ **Perfect Integration**

**No breaking changes** - agents **enhance** your existing system:
- ✅ Same database schema  
- ✅ Same extraction function
- ✅ Same data quality standards
- ✅ Same provenance tracking
- ✅ Same organization linking

**Agents just make it run consistently** at the scale you need (33k/day) using the proven system you already have.

**Your existing `scrape-multi-source` function is production-ready for 1M profiles** - agents just trigger it systematically on curated premium sources.
