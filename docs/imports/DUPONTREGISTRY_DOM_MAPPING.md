# duPont Registry DOM Mapping & Scraping Strategy

## Overview

duPont Registry has **two separate sites**:
1. **Main Marketplace**: `www.dupontregistry.com` - Standard listings (dealer/private sales)
2. **Live Auctions**: `live.dupontregistry.com` - Auction-style listings (requires login for browse/search)

---

## Site 1: Main Marketplace (`www.dupontregistry.com`)

### URL Pattern
- **Vehicle Listing**: `https://www.dupontregistry.com/autos/listing/{year}/{make}/{model}/{listing-id}`
- **Example**: `https://www.dupontregistry.com/autos/listing/2025/ferrari/296--gts/506113`
- **Browse/Search**: `https://www.dupontregistry.com/autos` or `/autos/results/{make}`

### Vehicle Listing Page Structure

#### 1. Header/Title Section
- **Selector**: `h1` or `[class*="title"]` or `[data-title]`
- **Extract**: Full title text
- **Example**: "2025 Ferrari 296 GTS"
- **Parse**: `year`, `make`, `model` from title

#### 2. Price Section
- **Selector**: `[class*="price"]` or `[data-price]` or `[class*="asking"]`
- **Extract**: Asking price (USD)
- **Format**: `$450,000` → `450000`
- **Field**: `asking_price`

#### 3. Image Gallery
- **Selector**: `[class*="gallery"] img` or `[class*="image"] img` or `[data-image]`
- **Extract**: All `src`, `data-src`, `data-lazy-src` attributes
- **Count**: Variable (typically 20-100+ images)
- **Primary**: First image → `thumbnail_url`

#### 4. Technical Information Section
- **Selector**: `[class*="spec"]` or `[class*="technical"]` or `[class*="info"]`
- **Extract Key-Value Pairs**:
  - **VIN**: `vin` field
  - **Mileage**: `mileage` field
  - **Color**: `color` field (exterior)
  - **Interior Color**: `interior_color` (in raw_data)
  - **Transmission**: `transmission` field
  - **Engine**: `engine_size` field
  - **Horsepower**: `horsepower` field
  - **Drivetrain**: `drivetrain` field
  - **Body Style**: `body_style` field

#### 5. Description Section
- **Selector**: `[class*="description"]` or `[class*="overview"]` or main content area
- **Extract**: Full narrative text
- **Field**: `notes`

#### 6. Features & Options Section
- **Selector**: `[class*="feature"]` or `[class*="option"]` or list items
- **Extract**: Array of feature strings
- **Structure**: 
  - Exterior features
  - Interior features
  - Mechanical features
- **Field**: `raw_data.features`

#### 7. Seller/Dealer Section
- **Selector**: `[class*="seller"]` or `[class*="dealer"]` or `[class*="contact"]`
- **Extract**:
  - **Seller Name**: `bat_seller` or `raw_data.seller_name`
  - **Seller Type**: `raw_data.seller_type` (`'dealer'` or `'private'`)
  - **Location**: `bat_location` or `raw_data.location`
  - **Phone**: `raw_data.seller_phone` (if available)
  - **Email**: `raw_data.seller_email` (if available)
  - **Website**: `raw_data.seller_website` (if available)

#### 8. Status Section
- **Selector**: `[class*="status"]` or `[data-status]`
- **Extract**: `'available'`, `'sold'`, `'pending'`
- **Field**: `sale_status`

---

## Site 2: Live Auctions (`live.dupontregistry.com`)

### URL Pattern
- **Auction Listing**: `https://live.dupontregistry.com/auction/{year}-{make}-{model}-{slug}-{lot-number}`
- **Example**: `https://live.dupontregistry.com/auction/2021-lamborghini-urushighspec-400`
- **Browse/Search**: `https://live.dupontregistry.com/` (requires login for full access)

### Auction Listing Page Structure (Based on Search Results)

#### 1. Header/Title Section
- **Selector**: `h1` or `[class*="title"]`
- **Extract**: Full title text
- **Example**: "2021 Lamborghini Urus | High-Spec"
- **Parse**: `year`, `make`, `model` from title

#### 2. Technical Information Section
Based on search results, this section contains structured data:

| Field | Source Text | Database Field |
|-------|-------------|----------------|
| **Lot Number** | "Lot Number: 400" | `raw_data.lot_number` |
| **Year** | "Year: 2021" | `year` |
| **Make** | "Make: Lamborghini" | `make` |
| **Model** | "Model: Urus \| High-Spec" | `model` |
| **Mileage** | "Mileage: 13015" | `mileage` |
| **Drivetrain** | "Drivetrain: 8 Speed Automatic AWD" | `transmission`, `drivetrain` |
| **VIN** | "VIN: ZPBUA1ZL1MLA13113" | `vin` |
| **Engine** | "Engine: Twin-Turbo 4.0L V8" | `engine_size` |
| **Body Style** | "Body Style: SUV/Crossover" | `body_style` |
| **Location** | "Location: Lebanon Tennessee 37090" | `bat_location` or `raw_data.location` |
| **Seller** | "Seller: duPont_REGISTRY" | `bat_seller` or `raw_data.seller_name` |
| **Seller Type** | "Seller Type: Dealer" | `raw_data.seller_type` |
| **Exterior Color** | "Exterior Color: Black" | `color` |
| **Interior Color** | "Interior Color: Lava Red" | `raw_data.interior_color` |

**Selector**: `[class*="technical"]` or `[class*="information"]` or structured list/table

#### 3. Seller's Introduction Section
- **Selector**: `[class*="introduction"]` or `[class*="seller-intro"]`
- **Extract**: Full introduction text
- **Field**: `raw_data.seller_introduction` or merged into `notes`

#### 4. Overview Section
- **Selector**: `[class*="overview"]` or main content area
- **Extract**: Full narrative overview
- **Field**: `notes` (merged with seller introduction)

#### 5. Features & Options Section
Based on search results, structured as:

**Exterior**:
- Nero Granatus paint
- 23" Taigete wheels
- Black painted brake calipers

**Interior**:
- Rosso leather seats and door panel accents
- Rosso seat belts
- Panoramic roof
- Advanced 3D camera
- Park assistance package
- Bicolor Elegante interior package
- Selective drive modes

**Mechanical**:
- Twin-turbo 4.0L V8
- 8 Speed automatic transmission
- Permanent AWD with limited slip center differential
- Carbon ceramic brakes

**Selector**: `[class*="feature"]` or `[class*="option"]` or structured lists
**Field**: `raw_data.features` (structured by category)

#### 6. Known Shortcomings Section
- **Selector**: `[class*="shortcoming"]` or `[class*="known-issue"]`
- **Extract**: List of known issues/imperfections
- **Field**: `raw_data.known_shortcomings`
- **Example**: "1x1" scratch to tailgate spoiler and roof rail"

#### 7. Auction Details Section
Based on search results:
- **Bids**: "Bids: 0"
- **Watching**: "Watching: 5"
- **Ending**: "Ending: December 30, 2025 at 7:00 PM"
- **Current Bid**: "Current Bid: $103,000 By: No bids yet"
- **Countdown**: "0 Days : 0 Hours : 0 Minutes : 0 Seconds"

**Selector**: `[class*="auction"]` or `[class*="bid"]` or `[data-auction]`
**Fields**:
- `raw_data.bid_count` (from "Bids: 0")
- `raw_data.watching_count` (from "Watching: 5")
- `raw_data.auction_end_date` (from "Ending: ...")
- `asking_price` (from "Current Bid: $103,000")
- `raw_data.current_bidder` (from "By: ...")
- `raw_data.time_remaining` (from countdown)

#### 8. Image Gallery
- **Selector**: `[class*="gallery"] img` or `[class*="image"] img` or `[data-image]`
- **Extract**: All gallery images
- **Count**: Variable

---

## Login Requirement Strategy

### Problem
- **Browse/Search Pages**: Require login to view full results
- **Individual Listings**: May be accessible without login (needs verification)

### Solutions

#### Option 1: Direct URL Scraping (Recommended)
**Strategy**: Scrape individual listing URLs directly
- **Pros**: No login required, simpler implementation
- **Cons**: Need to discover URLs from other sources

**URL Discovery Methods**:
1. **Sitemap**: Check `https://www.dupontregistry.com/sitemap.xml`
2. **RSS Feeds**: Check for RSS/Atom feeds
3. **Search Engine Results**: Use Google/Bing site: queries
4. **External Aggregators**: If available
5. **Incremental Discovery**: Start with known URLs, follow internal links

#### Option 2: Authenticated Scraping
**Strategy**: Create account and maintain session
- **Pros**: Full access to browse/search
- **Cons**: Account management, rate limiting, ToS concerns

**Implementation**:
1. Create account (if free tier available)
2. Login via Playwright/Firecrawl
3. Maintain session cookies
4. Scrape browse/search pages
5. Extract all listing URLs
6. Scrape individual listings

**Tools**:
- **Firecrawl**: Supports authenticated sessions
- **Playwright**: Full browser automation with login
- **Puppeteer**: Alternative browser automation

#### Option 3: Hybrid Approach (Best)
**Strategy**: Combine both methods
1. **Primary**: Direct URL scraping (no login)
2. **Secondary**: Authenticated scraping for discovery (if needed)
3. **Fallback**: Manual URL list or sitemap

---

## DOM Selectors (Detailed)

### Main Marketplace (`www.dupontregistry.com`)

#### Title
```css
h1[class*="title"]
h1[class*="listing-title"]
[data-title]
```

#### Price
```css
[class*="price"]
[class*="asking-price"]
[data-price]
.price-value
```

#### Images
```css
[class*="gallery"] img
[class*="image-gallery"] img
[data-image]
img[src*="dupontregistry"]
```

#### Technical Info
```css
[class*="technical"]
[class*="spec"]
[class*="specification"]
[class*="vehicle-info"]
```

#### Description
```css
[class*="description"]
[class*="overview"]
[class*="details"]
main article
```

#### Features
```css
[class*="feature"] li
[class*="option"] li
[class*="equipment"] li
```

#### Seller Info
```css
[class*="seller"]
[class*="dealer"]
[class*="contact"]
[class*="listing-contact"]
```

### Live Auctions (`live.dupontregistry.com`)

#### Technical Information
```css
[class*="technical"]
[class*="information"]
[class*="spec"]
section[class*="tech"]
```

#### Lot Number
```css
[class*="lot"]
[data-lot-number]
/* Text pattern: "Lot Number: 400" */
```

#### Auction Details
```css
[class*="auction"]
[class*="bid"]
[class*="countdown"]
[data-auction]
```

#### Current Bid
```css
[class*="current-bid"]
[class*="bid-amount"]
[data-current-bid]
```

#### Time Remaining
```css
[class*="countdown"]
[class*="time-remaining"]
[class*="ending"]
[data-countdown]
```

#### Features (Structured)
```css
[class*="feature"] section
[class*="option"] section
/* Categories: Exterior, Interior, Mechanical */
```

---

## Extraction Patterns (Regex)

### Title Parsing
```javascript
// Pattern: "2025 Ferrari 296 GTS"
const titleMatch = title.match(/(\d{4})\s+([A-Za-z\s-]+)\s+(.+)/);
// year: 2025, make: Ferrari, model: 296 GTS
```

### Price Extraction
```javascript
// Pattern: "$450,000" or "$1,234,567"
const priceMatch = price.match(/\$([\d,]+)/);
const priceValue = parseInt(priceMatch[1].replace(/,/g, ''));
```

### VIN Extraction
```javascript
// Pattern: 17-character alphanumeric
const vinMatch = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
```

### Mileage Extraction
```javascript
// Pattern: "13,015 miles" or "13015"
const mileageMatch = text.match(/([\d,]+)\s*(?:miles|mi)?/i);
const mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
```

### Lot Number (Auctions)
```javascript
// Pattern: "Lot Number: 400"
const lotMatch = text.match(/Lot\s+Number:\s*(\d+)/i);
```

### Auction End Date
```javascript
// Pattern: "Ending: December 30, 2025 at 7:00 PM"
const endMatch = text.match(/Ending:\s*(.+?)(?:\s+at\s+)?/i);
// Parse date string
```

### Location
```javascript
// Pattern: "Lebanon Tennessee 37090" or "Miami, FL"
const locationMatch = text.match(/Location:\s*(.+)/i);
```

---

## Data Extraction Priority

### High Priority (Required)
1. ✅ `year`, `make`, `model` (from title/URL)
2. ✅ `listing_url` (for deduplication)
3. ✅ `images` (at least one for thumbnail)
4. ✅ `price` (asking price or current bid)

### Medium Priority (Enhance Profile)
1. ✅ `mileage`, `vin`, `color`
2. ✅ `description` (overview text)
3. ✅ `location`, `seller_name`
4. ✅ `transmission`, `engine_size`, `horsepower`

### Low Priority (Nice to Have)
1. ✅ `features` array (structured)
2. ✅ `known_shortcomings` (auctions)
3. ✅ `auction_details` (live auctions)
4. ✅ `service_records` (if available)

---

## Scraping Tools & Configuration

### Recommended: Firecrawl
```javascript
{
  "url": "https://www.dupontregistry.com/autos/listing/2025/ferrari/296--gts/506113",
  "formats": ["markdown", "html"],
  "includeTags": ["img", "h1", "h2", "section"],
  "waitFor": 3000
}
```

### Alternative: Playwright (for authenticated)
```javascript
// Login flow
await page.goto('https://live.dupontregistry.com/login');
await page.fill('[name="email"]', email);
await page.fill('[name="password"]', password);
await page.click('[type="submit"]');
await page.waitForNavigation();

// Then scrape
await page.goto(listingUrl);
const content = await page.content();
```

---

## Handling Login Requirements

### Strategy 1: Sitemap Discovery
```bash
# Check for sitemap
curl https://www.dupontregistry.com/sitemap.xml
curl https://live.dupontregistry.com/sitemap.xml
```

### Strategy 2: Search Engine Queries
```bash
# Use Google/Bing to find listings
site:dupontregistry.com/autos/listing
site:live.dupontregistry.com/auction
```

### Strategy 3: Authenticated Session (If Needed)
1. Create test account
2. Login via Playwright
3. Extract session cookies
4. Use cookies in Firecrawl/requests
5. Scrape browse pages
6. Extract all listing URLs
7. Scrape individual listings (may not need auth)

### Strategy 4: Incremental Discovery
1. Start with known URLs (from search results)
2. Follow internal links on listing pages
3. Extract "Similar Vehicles" or "More from Dealer" links
4. Build URL list incrementally

---

## Rate Limiting & Best Practices

### Rate Limits
- **Recommended**: 1-2 second delay between requests
- **Respect**: `robots.txt` directives
- **Monitor**: Response codes (429 = rate limited)

### Headers
```javascript
{
  "User-Agent": "Mozilla/5.0 (compatible; NukeBot/1.0)",
  "Accept": "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.dupontregistry.com/"
}
```

### Error Handling
- **429 Too Many Requests**: Exponential backoff
- **403 Forbidden**: Check if login required
- **404 Not Found**: Skip, log, continue
- **Timeout**: Retry with longer timeout

---

## Browse/Search Page DOM Mapping

### Main Marketplace Browse Page (`www.dupontregistry.com/autos/results/all`)

#### Page Structure

**1. Listing Grid/List**
- **Selector**: `[class*="listing"]`, `[class*="result"]`, `[class*="vehicle-card"]`, `[class*="car-card"]`
- **Extract**: All vehicle listing cards
- **Pattern**: Each card contains:
  - **Title**: `year make model` (e.g., "2025 Ferrari 296 GTS")
  - **Price**: `$XXX,XXX` (e.g., "$450,000")
  - **Thumbnail**: Image URL
  - **Link**: Full listing URL (`/autos/listing/{year}/{make}/{model}/{id}`)
  - **Location**: City, State (if available)
  - **Mileage**: If shown on card
  - **Dealer/Seller**: Name (if shown)

**2. Listing URL Extraction**
- **Selector**: `a[href*="/autos/listing/"]` or `a[href*="/autos/"]`
- **Pattern**: `/autos/listing/{year}/{make}/{model}/{id}`
- **Extract**: All unique listing URLs
- **Regex**: `/\/autos\/listing\/(\d{4})\/([^\/]+)\/([^\/]+)\/(\d+)/`

**3. Pagination**
- **Selector**: `[class*="pagination"]`, `[class*="page"]`, `[class*="next"]`
- **Extract**: Next page links, page numbers
- **Pattern**: `/autos/results/all?page={n}` or `/autos/results/all/{page}`
- **Follow**: All pagination links to discover all listings

**4. Filters (if accessible)**
- **Selector**: `[class*="filter"]`, `[class*="search"]`, `[class*="facet"]`
- **Extract**: Make, model, year, price range filters
- **Note**: May require login for full filter access

**5. Dealer Links**
- **Selector**: `a[href*="/autos/"]` (dealer profile links)
- **Pattern**: `/autos/{dealer-slug}/{dealer-id}`
- **Example**: `/autos/lexani--motorcars/734`
- **Extract**: All dealer profile URLs for separate scraping

#### Extraction Strategy

```typescript
async function discoverListingsFromBrowsePage(
  url: string,
  supabase: any
): Promise<string[]> {
  const listingUrls = new Set<string>();
  const dealerUrls = new Set<string>();
  
  // Scrape browse page
  const html = await fetchPage(url);
  const doc = parseHTML(html);
  
  // Extract listing URLs
  const listingLinks = doc.querySelectorAll('a[href*="/autos/listing/"]');
  listingLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href) {
      const fullUrl = href.startsWith('http') ? href : `https://www.dupontregistry.com${href}`;
      listingUrls.add(fullUrl);
    }
  });
  
  // Extract dealer profile URLs
  const dealerLinks = doc.querySelectorAll('a[href*="/autos/"][href*="--"]');
  dealerLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href && !href.includes('/listing/')) {
      const fullUrl = href.startsWith('http') ? href : `https://www.dupontregistry.com${href}`;
      dealerUrls.add(fullUrl);
    }
  });
  
  // Follow pagination
  const nextPageLink = doc.querySelector('[class*="next"] a, [class*="pagination"] a[aria-label*="next"]');
  if (nextPageLink) {
    const nextUrl = nextPageLink.getAttribute('href');
    if (nextUrl) {
      const nextPageUrls = await discoverListingsFromBrowsePage(
        nextUrl.startsWith('http') ? nextUrl : `https://www.dupontregistry.com${nextUrl}`,
        supabase
      );
      nextPageUrls.forEach(url => listingUrls.add(url));
    }
  }
  
  return Array.from(listingUrls);
}
```

### Live Auctions Browse Page (`live.dupontregistry.com`)

**Note**: Requires login for full access. Individual auction pages are accessible.

**If Accessible (without login):**

**1. Auction Carousel/Grid**
- **Selector**: `[class*="auction"]`, `[class*="lot"]`, `[class*="carousel"]`
- **Extract**: Featured/live auctions

**2. Auction URLs**
- **Pattern**: `/auction/{year}-{make}-{model}-{slug}-{lot-number}`
- **Example**: `/auction/2021-lamborghini-urushighspec-400`

**3. Auction Status**
- **Live**: Currently accepting bids
- **Upcoming**: Scheduled auctions
- **Ended**: Completed auctions

---

## Dealer Profile Page DOM Mapping

### URL Pattern: `/autos/{dealer-slug}/{dealer-id}`

**Example**: `https://www.dupontregistry.com/autos/lexani--motorcars/734`

#### Fields to Extract

**1. Dealer Name**
- **Selector**: `h1[class*="dealer"]`, `[class*="dealer-name"]`, `[class*="business-name"]`
- **Field**: `business_name`

**2. Dealer Website**
- **Selector**: `a[href*="http"][class*="website"]`, `[class*="dealer-website"]`
- **Field**: `website`
- **Note**: May link to external site (like Lexani's weird site)

**3. Dealer Location**
- **Selector**: `[class*="location"]`, `[class*="address"]`, `[class*="dealer-location"]`
- **Fields**: `city`, `state`

**4. Dealer Contact**
- **Phone**: `[class*="phone"]`, `a[href^="tel:"]`
- **Email**: `a[href^="mailto:"]`, `[class*="email"]`
- **Fields**: `phone`, `email`

**5. Dealer Description**
- **Selector**: `[class*="description"]`, `[class*="about"]`, `[class*="bio"]`
- **Field**: `description`

**6. Inventory Link**
- **Selector**: `a[href*="/autos/results"][class*="inventory"]`, `[class*="view-inventory"]`
- **Field**: `metadata.inventory_url`

**7. Social Media Links**
- **Instagram**: `a[href*="instagram.com"]`
- **Facebook**: `a[href*="facebook.com"]`
- **Twitter**: `a[href*="twitter.com"]`
- **Extract**: Handles for external identity creation

**8. Dealer ID/Slug**
- **From URL**: Extract `{dealer-slug}` and `{dealer-id}`
- **Fields**: `metadata.dupont_registry_slug`, `metadata.dupont_registry_id`

---

## User Profile Page DOM Mapping

### URL Pattern: `live.dupontregistry.com/user/{username}`

**Example**: `https://live.dupontregistry.com/user/mark.goldman431`

**Note**: May require login. Test accessibility first.

#### Fields to Extract

**1. Username**
- **From URL**: Extract `{username}` from path
- **Field**: `external_identities.handle`

**2. Display Name**
- **Selector**: `[class*="display-name"]`, `[class*="user-name"]`, `h1[class*="profile"]`
- **Field**: `external_identities.display_name`

**3. Profile Stats**
- **Bids**: `[class*="bids"]` or `[data-bids]`
- **Watching**: `[class*="watching"]` or `[data-watching]`
- **Sold**: `[class*="sold"]` or `[data-sold]`
- **Field**: `metadata.stats`

**4. Activity Feed**
- **Recent Bids**: `[class*="recent-bids"]`, `[class*="bid-history"]`
- **Listings**: `[class*="listings"]`, `[class*="vehicles"]`
- **Field**: `metadata.activity`

**5. Profile Image**
- **Selector**: `img[class*="avatar"]`, `img[class*="profile"]`
- **Field**: `metadata.profile_image_url`

---

## Summary

### Main Marketplace (`www.dupontregistry.com`)
- ✅ **Accessible**: Individual listings appear accessible
- ✅ **Browse Page**: `/autos/results/all` - may be accessible (test)
- ✅ **No Login**: For direct URL access
- ⚠️ **Browse**: May require login for full results (verify)

### Live Auctions (`live.dupontregistry.com`)
- ✅ **Accessible**: Individual auction pages accessible (based on search results)
- ⚠️ **Browse**: Requires login for search/browse
- ✅ **User Profiles**: May require login
- ✅ **Strategy**: Direct URL scraping for listings

### Dealer Profiles (`www.dupontregistry.com/autos/{dealer-slug}/{id}`)
- ✅ **Accessible**: Dealer profile pages accessible
- ✅ **Extract**: Name, website, location, contact, social media
- ✅ **Special Case**: Lexani-style dealers (weird website, clear Instagram)

### Recommended Approach
1. **Start**: Direct URL scraping (no login)
2. **Discover URLs**: 
   - Browse page (`/autos/results/all`) if accessible
   - Sitemap if available
   - Search engines (`site:dupontregistry.com/autos/listing`)
   - Dealer profile pages (extract inventory links)
3. **Scrape**: Individual listings directly
4. **Fallback**: Authenticated scraping only if needed for discovery

### Key Fields Extracted
- **Marketplace**: ~40+ fields (standard listing format)
- **Auctions**: ~50+ fields (includes auction-specific: lot number, bid count, countdown, etc.)
- **Dealer Profiles**: ~15+ fields (organization data)
- **User Profiles**: ~5+ fields (external identity data)

---

## Next Steps

1. ✅ Verify individual listing accessibility (both sites)
2. ✅ Test browse page accessibility (`/autos/results/all`)
3. ✅ Test sitemap availability
4. ✅ Implement direct URL scraper
5. ✅ Implement dealer profile scraper
6. ✅ Implement user profile scraper (if accessible)
7. ✅ Add authenticated scraping (if needed for discovery)
8. ✅ Map all fields to database schema
9. ✅ Test with sample listings
10. ✅ Deploy and monitor

