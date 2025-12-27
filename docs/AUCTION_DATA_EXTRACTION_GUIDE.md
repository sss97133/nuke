# Auction Data Extraction Guide

## Overview
This guide provides comprehensive instructions for extracting auction metadata from auction listing pages. Use this when building extractors for new auction platforms or improving existing ones.

## Critical Auction Data Fields

### 1. Current Bid / High Bid
**What to Look For:**
- Current bid amount (for active auctions)
- High bid (highest bid placed)
- May appear as "Current Bid: $XX,XXX" or "High Bid: $XX,XXX"

**Common HTML Patterns:**
```html
<!-- Pattern 1: Label + Value -->
<span>Current Bid</span> <strong>$21,000</strong>
<div class="current-bid">USD $21,000</div>

<!-- Pattern 2: Data Attributes -->
<div data-current-bid="21000">$21,000</div>
<span data-bid="21000">$21,000</span>

<!-- Pattern 3: JSON/JavaScript -->
<script>
  var listingData = { "currentBid": 21000 };
</script>

<!-- Pattern 4: CSS Classes -->
<strong class="bid-value">$21,000</strong>
<div class="info-value">USD $21,000</div>
```

**Regex Patterns (in priority order):**
```javascript
// Pattern 1: Label + currency symbol
/Current\s+Bid[^>]*>.*?USD\s*\$?([\d,]+)/i
/Current\s+Bid[^>]*>.*?\$([\d,]+)/i
/High\s+Bid[^>]*>.*?\$([\d,]+)/i

// Pattern 2: CSS class-based (common on BaT)
/<strong[^>]*class[^>]*bid[^>]*>.*?\$([\d,]+)/i
/<strong[^>]*class="info-value"[^>]*>USD\s*\$?([\d,]+)/i

// Pattern 3: Data attributes
/data-current-bid[^>]*>.*?\$([\d,]+)/i
/data-bid[^>]*>.*?\$([\d,]+)/i

// Pattern 4: JSON/JavaScript (check script tags)
/"currentBid":\s*(\d+)/i
/"highBid":\s*(\d+)/i
/"price":\s*(\d+)/i
```

**Extraction Strategy:**
1. **First**: Check for data attributes (`data-current-bid`, `data-bid`) - most reliable
2. **Second**: Search for JSON in `<script>` tags - structured data is clean
3. **Third**: Use regex on HTML with label patterns - most common
4. **Fourth**: Look for CSS class patterns specific to the site (e.g., BaT uses `info-value`)
5. **Parse currency**: Remove `$` and commas, convert to integer

---

### 2. Final Price / Sold Price
**What to Look For:**
- Final sale price (for completed auctions)
- "Sold for $XX,XXX" text
- May appear as "Final Price: $XX,XXX" or "Winning Bid: $XX,XXX"

**Common HTML Patterns:**
```html
<!-- Pattern 1: Label + Value -->
<span class="value">Sold for <span class="bid-value">$21,000</span></span>
<div>Final Price: $21,000</div>
<strong>Sold for $21,000</strong>

<!-- Pattern 2: JSON -->
<script>
  { "finalPrice": 21000, "salePrice": 21000 }
</script>
```

**Regex Patterns:**
```javascript
// Pattern 1: "Sold for" text
/Sold\s+for[^>]*>.*?\$([\d,]+)/i
/Sold\s+(?:for|to)[^>]*>.*?\$([\d,]+)/i

// Pattern 2: "Final Price"
/Final\s+Price[^>]*>.*?\$([\d,]+)/i
/Winning\s+Bid[^>]*>.*?\$([\d,]+)/i

// Pattern 3: JSON
/"finalPrice":\s*(\d+)/i
/"salePrice":\s*(\d+)/i
/"winningBid":\s*(\d+)/i

// Pattern 4: CSS classes (Cars & Bids pattern)
/<span[^>]*class="bid-value"[^>]*>\$([\d,]+)/i
```

**Extraction Strategy:**
1. Check for "Sold for" or "Final Price" text with currency
2. Check JSON data in script tags
3. Look for specific CSS classes (site-dependent)
4. **Important**: Only extract final_price if auction is ended/sold

---

### 3. Bid Count
**What to Look For:**
- Total number of bids placed
- "54 bids" or "Bid Count: 54"
- May appear in a list item: `<li class="num-bids"><span>Bids</span><span>54</span></li>`

**Common HTML Patterns:**
```html
<!-- Pattern 1: Label + Number -->
<span>54 bids</span>
<li class="num-bids"><span class="tag">Bids</span><span class="value">54</span></li>
<div>Bid Count: 54</div>

<!-- Pattern 2: Data Attributes -->
<div data-bid-count="54">54</div>
<span data-bids="54">54</span>

<!-- Pattern 3: JSON -->
<script>
  { "bidCount": 54 }
</script>
```

**Regex Patterns:**
```javascript
// Pattern 1: Label + number
/(\d+)\s+bids?/i
/Bid\s+Count[^>]*>.*?(\d+)/i

// Pattern 2: HTML structure (Cars & Bids pattern)
/<li[^>]*class[^>]*num-bids[^>]*>.*?<span[^>]*value[^>]*>(\d+)/i
/number-bids-value[^>]*>(\d+)/i

// Pattern 3: Data attributes
/data-bid-count[^>]*>.*?(\d+)/i
/data-bids[^>]*>.*?(\d+)/i

// Pattern 4: JSON
/"bidCount":\s*(\d+)/i
/"bids":\s*(\d+)/i
/"numBids":\s*(\d+)/i
```

**Extraction Strategy:**
1. Look for "X bids" pattern (most common)
2. Check for structured HTML with classes (site-specific)
3. Check JSON data
4. Parse as integer (remove commas if present)

---

### 4. Auction End Date / Time
**What to Look For:**
- Date and time when auction ends (for active auctions)
- Critical for countdown timers
- ISO format preferred: `2025-05-22T14:30:00Z`
- May appear as "5/22/25" or "May 22, 2025 2:30 PM"

**Common HTML Patterns:**
```html
<!-- Pattern 1: Data Attributes (BEST - used for timers) -->
<div data-countdown-date="2025-05-22T14:30:00Z"></div>
<span data-end-date="2025-05-22 14:30:00"></span>

<!-- Pattern 2: JSON -->
<script>
  { "endDate": "2025-05-22T14:30:00Z" }
</script>

<!-- Pattern 3: Human-readable text -->
<div>Auction Ends: May 22, 2025 2:30 PM</div>
<span>Ends: 5/22/25</span>
```

**Regex Patterns:**
```javascript
// Pattern 1: Data attributes (MOST RELIABLE)
/data-countdown-date\s*=\s*"([^"]+)"/i
/data-end-date\s*=\s*"([^"]+)"/i
/data-ends[^>]*=\s*"([^"]+)"/i

// Pattern 2: JSON (ISO format preferred)
/"endDate"\s*:\s*"([^"]+)"/i
/"auctionEnd"\s*:\s*"([^"]+)"/i
/"endsAt"\s*:\s*"([^"]+)"/i

// Pattern 3: Human-readable (parse carefully)
/Auction\s+Ends[^>]*>.*?(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})/i
/Ends[^>]*>.*?(\w+\s+\d{1,2},\s+\d{4}[^<]*\d{1,2}:\d{2}\s*(?:AM|PM))/i

// Pattern 4: Simple date format (Cars & Bids pattern)
/<span[^>]*class="time-ended"[^>]*>(\d{1,2}\/\d{1,2}\/\d{2,4})/i
```

**Extraction Strategy:**
1. **Priority 1**: Data attributes (`data-countdown-date`, `data-end-date`) - used for JavaScript timers
2. **Priority 2**: JSON data with ISO format dates
3. **Priority 3**: Parse human-readable dates (convert to ISO)
4. **Convert to ISO**: Always normalize to ISO 8601 format (`YYYY-MM-DDTHH:mm:ssZ`)
5. **Important**: Only extract end_date for ACTIVE auctions (not ended/sold)

---

### 5. View Count
**What to Look For:**
- Number of page views
- "1,234 views" or "View Count: 1,234"

**Common HTML Patterns:**
```html
<span>1,234 views</span>
<div>View Count: 1,234</div>
<script>
  { "viewCount": 1234 }
</script>
```

**Regex Patterns:**
```javascript
/([\d,]+)\s+views?/i
/View\s+Count[^>]*>.*?([\d,]+)/i
/"viewCount":\s*(\d+)/i
/"views":\s*(\d+)/i
```

---

### 6. Watcher Count
**What to Look For:**
- Number of watchers/followers
- "54 watchers" or "Watchers: 54"

**Common HTML Patterns:**
```html
<span>54 watchers</span>
<div>Watchers: 54</div>
<script>
  { "watcherCount": 54 }
</script>
```

**Regex Patterns:**
```javascript
/(\d+)\s+watchers?/i
/Watchers?[^>]*>.*?(\d+)/i
/"watcherCount":\s*(\d+)/i
/"watchers":\s*(\d+)/i
```

---

### 7. Reserve Status
**What to Look For:**
- Whether reserve is met or not met
- Reserve price (optional)

**Common HTML Patterns:**
```html
<span>Reserve Met</span>
<div>Reserve: $25,000</div>
<script>
  { "reserveMet": true, "reservePrice": 25000 }
</script>
```

**Regex Patterns:**
```javascript
// Reserve met status
/Reserve\s+Met/i
/"reserveMet":\s*true/i
/data-reserve-met[^>]*>.*?true/i

// Reserve price
/Reserve[^>]*>.*?\$([\d,]+)/i
/"reservePrice":\s*(\d+)/i
/data-reserve-price[^>]*>.*?\$([\d,]+)/i
```

---

### 8. Sale Date (for completed auctions)
**What to Look For:**
- Date when auction ended/sold
- "5/22/25" or "Sold: May 22, 2025"
- Often appears near "Sold for" text

**Common HTML Patterns:**
```html
<!-- Cars & Bids pattern -->
<span class="time-ended">5/22/25</span>

<!-- Generic patterns -->
<div>Sold: May 22, 2025</div>
<span>Ended: 5/22/25</span>
```

**Regex Patterns:**
```javascript
// Pattern 1: Cars & Bids specific (class="time-ended")
/<span[^>]*class[^>]*time-ended[^>]*>(\d{1,2}\/\d{1,2}\/\d{2,4})/i

// Pattern 2: "Sold for/on" with date
/Sold\s+(?:for|on)[^>]*>.*?(\d{1,2}\/\d{1,2}\/\d{2,4})/i
/Sold\s+on[^>]*>.*?(\w+\s+\d{1,2},\s+\d{4})/i

// Pattern 3: "Ended" with date
/Ended[^>]*>.*?(\d{1,2}\/\d{1,2}\/\d{2,4})/i

// Pattern 4: JSON
/"saleDate":\s*"([^"]+)"/i
/"soldAt":\s*"([^"]+)"/i
```

**Date Parsing:**
```javascript
// Handle M/D/YY format (e.g., "5/22/25")
const mdyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
if (mdyMatch) {
  const month = parseInt(mdyMatch[1], 10);
  const day = parseInt(mdyMatch[2], 10);
  let year = parseInt(mdyMatch[3], 10);
  // Convert 2-digit year to 4-digit (assume 2000s if < 50, else 1900s)
  if (year < 100) {
    year = year < 50 ? 2000 + year : 1900 + year;
  }
  const date = new Date(year, month - 1, day);
  return date.toISOString().split('T')[0]; // Return YYYY-MM-DD
}
```

---

## Site-Specific Patterns

### Cars & Bids
**Key Patterns:**
```html
<!-- Bid Value -->
<span class="bid-value">$21,000</span>

<!-- Sold for -->
<span class="value">Sold for <span class="bid-value">$21,000</span></span>

<!-- Bid Count -->
<li class="num-bids"><span class="tag">Bids</span><span class="value">54</span></li>

<!-- End Date -->
<span class="time-ended">5/22/25</span>
<div data-countdown-date="2025-05-22T14:30:00Z"></div>
```

### Bring a Trailer (BaT)
**Key Patterns:**
```html
<!-- Current Bid -->
<strong class="info-value">USD $21,000</strong>

<!-- Bid Count -->
<span class="number-bids-value">54</span>

<!-- JSON Data (check script tags) -->
<script type="application/ld+json">
  { "price": 21000, "bidCount": 54 }
</script>
```

### Classic.com
**Key Patterns:**
```html
<!-- Often uses JSON-LD schema -->
<script type="application/ld+json">
  { "offers": { "price": 21000 } }
</script>
```

---

## Extraction Best Practices

### 1. Multi-Pattern Approach
Always try multiple patterns in priority order:
1. Data attributes (most reliable)
2. JSON/JavaScript (structured data)
3. HTML regex patterns (most common)
4. CSS class-based patterns (site-specific)

### 2. Currency Parsing
```javascript
function parseCurrency(text) {
  if (!text) return null;
  const match = text.match(/[\$]?([\d,]+)/);
  if (match && match[1]) {
    const amount = parseInt(match[1].replace(/,/g, ''), 10);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }
  return null;
}
```

### 3. Integer Parsing
```javascript
function parseInteger(text) {
  if (!text) return null;
  const match = text.match(/(\d+)/);
  if (match && match[1]) {
    const num = parseInt(match[1].replace(/,/g, ''), 10);
    return Number.isFinite(num) && num >= 0 ? num : null;
  }
  return null;
}
```

### 4. Date Parsing
```javascript
function parseDate(dateStr) {
  if (!dateStr) return null;
  const parsed = Date.parse(dateStr.trim());
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }
  return null;
}
```

### 5. Context Matters
- **Active auctions**: Extract `current_bid`, `auction_end_date`, `bid_count`
- **Ended auctions**: Extract `final_price`, `sale_date`, `bid_count`
- **Never mix**: Don't set `auction_end_date` for sold auctions

### 6. JSON Extraction
Always check `<script>` tags for JSON data:
```javascript
// Look for script tags with JSON
const scriptPattern = /<script[^>]*>(.*?)<\/script>/gis;
const jsonPatterns = [
  /"currentBid":\s*(\d+)/i,
  /"bidCount":\s*(\d+)/i,
  /"endDate":\s*"([^"]+)"/i,
  // etc.
];
```

---

## Database Schema Mapping

Extracted auction data should be stored in the `external_listings` table:

```typescript
{
  current_bid: number | null,        // Current/high bid (active auctions)
  final_price: number | null,        // Final sale price (ended auctions)
  bid_count: number | null,          // Total number of bids
  view_count: number | null,         // Page views
  watcher_count: number | null,      // Watchers/followers
  reserve_met: boolean | null,       // Reserve met status
  reserve_price: number | null,      // Reserve price
  auction_end_date: string | null,   // End date/time (ISO format, active only)
  sale_date: string | null,          // Sale date (YYYY-MM-DD format, ended only)
  listing_status: 'active' | 'ended' | 'sold' | 'unsold'
}
```

---

## Testing Checklist

When implementing extraction for a new site, verify:

- [ ] Current bid extracted correctly for active auctions
- [ ] Final price extracted correctly for sold auctions
- [ ] Bid count matches what's displayed
- [ ] End date extracted (for active auctions only)
- [ ] End date in ISO format and parseable
- [ ] View count extracted (if available)
- [ ] Watcher count extracted (if available)
- [ ] Reserve status extracted (if applicable)
- [ ] Sale date extracted (for ended auctions)
- [ ] Sale date in YYYY-MM-DD format
- [ ] No mixing of active/ended fields (e.g., end_date on sold listings)
- [ ] All numeric fields parse correctly (handle commas in numbers)

---

## Common Pitfalls

1. **Mixing active/ended fields**: Don't set `auction_end_date` on sold listings
2. **Currency parsing**: Remove commas and `$` before parsing
3. **Date formats**: Always normalize to ISO 8601
4. **Regex greediness**: Use non-greedy matches (`.*?`) when possible
5. **Case sensitivity**: Use case-insensitive flags (`/i`) for text patterns
6. **Number parsing**: Handle commas in numbers (e.g., "1,234")
7. **Null handling**: Return `null` instead of `undefined` or `0` when not found
8. **Context extraction**: Check surrounding HTML context to avoid false matches

---

## Example Implementation

See `supabase/functions/extract-premium-auction/index.ts` for a complete implementation example, specifically the `extractCarsAndBidsAuctionData` function (lines 343-527).

