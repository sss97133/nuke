# LLM-Fueled Intelligent Site Mapping System

## Overview

The `thorough-site-mapper` function uses LLM (GPT-4o) to intelligently analyze websites and create complete DOM mappings with automatic organization profile creation.

---

## Features

### 1. **LLM-Powered Site Analysis**
- Uses GPT-4o to analyze page structure
- Identifies ALL available fields (not just obvious ones)
- Creates intelligent CSS selectors with fallbacks
- Maps fields to database schema automatically

### 2. **Automatic Organization Profile Creation**
- Automatically creates organization profiles for source platforms
- Detects site type (marketplace, auction_house, etc.)
- Links organization to source for proper attribution

### 3. **Complete Field Mapping**
- Maps to `vehicles` table (core vehicle data)
- Maps to `businesses` table (seller/dealer info)
- Maps to `raw_data` (site-specific fields)
- Maps to `external_identities` (user profiles)

### 4. **Intelligent DOM Analysis**
- Analyzes actual page content (HTML + Markdown)
- Identifies hidden data (JSON-LD, microdata, script variables)
- Creates extraction rules with multiple fallback selectors
- Handles lazy-loaded content, dynamic rendering

---

## Process Flow

```
1. Deep Site Analysis
   ↓
   - Crawl site with Firecrawl
   - Discover all page types
   - Analyze each page type with LLM

2. Complete Field Identification
   ↓
   - Use LLM to identify EVERY field
   - Analyze sample pages for actual content
   - Map fields to database schema

3. Field Mapping to Database
   ↓
   - Match fields to vehicles table
   - Match fields to businesses table
   - Match fields to raw_data
   - Match fields to external_identities

4. Extraction Rules Creation
   ↓
   - Create site-specific extraction rules
   - Define CSS selectors with fallbacks
   - Define regex patterns
   - Define transformation functions

5. Completeness Validation
   ↓
   - Calculate field coverage percentage
   - Identify missing fields
   - Verify 95%+ coverage target

6. Organization Profile Creation
   ↓
   - Automatically create org profile
   - Link to source
   - Set business type based on site analysis

7. Store Complete Site Map
   ↓
   - Save to site_maps table
   - Link to scrape_sources
   - Ready for use by scrapers
```

---

## LLM Analysis Requirements

### For Each Page Type, LLM Analyzes:

1. **All Sections**
   - Header/title
   - Image gallery
   - Technical specifications
   - Pricing information
   - Description/overview
   - Features/options
   - History/service records
   - Seller/dealer information
   - Location information
   - Auction details (if applicable)
   - Comments/reviews (if applicable)

2. **All Fields in Each Section**
   - Technical specs: year, make, model, trim, VIN, mileage, color, transmission, engine, etc.
   - Pricing: asking_price, sale_price, reserve_price, current_bid, etc.
   - Description: full narrative, highlights, features, options
   - History: service_history, accident_history, ownership_history
   - Seller: name, type, website, phone, email, location
   - Location: city, state, zip_code, country, coordinates
   - Auction: lot_number, auction_status, end_date, bid_count
   - Images: primary_image, gallery_images, thumbnail
   - Metadata: structured data, JSON-LD, microdata

3. **Extraction Methods**
   - CSS selectors (with fallbacks)
   - XPath (if needed)
   - Regex patterns
   - JSON-LD extraction
   - Script variable extraction
   - AI extraction (for complex cases)

---

## Usage

### Manual Invocation

```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/thorough-site-mapper \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source_url": "https://www.dupontregistry.com",
    "create_complete_map": true
  }'
```

### Automatic Invocation

The `database-fill-agent` automatically triggers `thorough-site-mapper` for sources with incomplete mappings (< 95% coverage).

---

## Output

Returns a complete site map with:
- All page types discovered
- All fields identified and mapped
- Extraction rules for each field
- Completeness metrics (coverage percentage)
- Organization profile ID (created automatically)
- Recommendations for improvement

---

## Example: duPont Registry

When mapping `www.dupontregistry.com`:

1. **Discovers Page Types:**
   - Vehicle listing pages (`/autos/listing/{year}/{make}/{model}/{id}`)
   - Browse pages (`/autos/results/...`)
   - Dealer profile pages (`/autos/{dealer-slug}/{id}`)

2. **Identifies Fields:**
   - Vehicle: year, make, model, price, VIN, mileage, color, etc.
   - Seller: dealer_name, dealer_website, dealer_phone, location
   - Images: gallery images, primary image, thumbnails
   - Site-specific: listing_id, dealer_slug, etc.

3. **Creates Organization:**
   - Business name: "Dupont Registry"
   - Business type: "other" (marketplace)
   - Website: "https://www.dupontregistry.com"
   - Linked to scrape_source

4. **Maps All Fields:**
   - Core fields → `vehicles` table
   - Dealer info → `businesses` table
   - Site-specific → `raw_data` JSONB

---

## Benefits

1. **Automatic**: No manual DOM mapping needed
2. **Complete**: Identifies ALL fields, not just obvious ones
3. **Intelligent**: Uses LLM to understand page structure
4. **Robust**: Multiple selector fallbacks for reliability
5. **Accountable**: Tracks coverage percentage (95%+ target)
6. **Self-Documenting**: Creates complete site maps automatically

---

## Next Steps

After mapping, scrapers can use the site map to:
- Extract data using mapped selectors
- Handle site-specific extraction rules
- Ensure complete field coverage
- Link vehicles to organization profiles automatically

