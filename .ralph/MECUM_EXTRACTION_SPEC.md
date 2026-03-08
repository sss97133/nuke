# Mecum Extraction Specification

## Overview

Mecum stores rich vehicle data in `__NEXT_DATA__` JSON embedded in each lot page. This document specifies all extractable fields and how they map to our schema.

## Data Source

- **Location**: `<script id="__NEXT_DATA__">` in page HTML
- **Path**: `props.pageProps.post`
- **Format**: Next.js/GraphQL structured data

---

## Field Mapping

### Vehicle Identity

| Mecum Field | Our Field | Notes |
|-------------|-----------|-------|
| `vinSerial` | `vin` | Primary VIN source (structured) |
| `title` | `title` | "1963 Ferrari 250 GT SWB California Spyder" |
| `lotYears.edges[0].node.name` | `year` | Extracted from taxonomy |
| `makes.edges[0].node.name` | `make` | Extracted from taxonomy |
| `models.edges[0].node.name` | `model` | Extracted from taxonomy |

### Vehicle Specs

| Mecum Field | Our Field | Notes |
|-------------|-----------|-------|
| `color` | `color` | "Rosso Cina" |
| `interior` | `interior_color` | "Pella Beige" |
| `transmission` | `transmission` | "4-Speed Manual" |
| `odometer` | `mileage` | Integer value |
| `odometerUnits` | - | "M" (miles) or "K" (km) |
| `isActualMiles` | - | Boolean when documented |
| `engineNumber` | `engine_number` | For high-value cars |
| `frameNumber` | `frame_number` | For high-value cars |
| `lotSeries` | `series` / description | Often contains provenance summary |

### Sale Data

| Mecum Field | Our Field | Notes |
|-------------|-----------|-------|
| `hammerPrice` | `sale_price`, `sold_price` | **THE ACTUAL SALE PRICE** |
| `currentBid` | `high_bid` | For unsold/live lots |
| `saleResults.edges[0].node.slug` | `sale_result` | "sold", "not-sold" |
| `highEstimate` | `estimate_high` | Pre-auction estimate |
| `lowEstimate` | `estimate_low` | Pre-auction estimate |

### Auction Event Data

| Mecum Field | Our Field | Notes |
|-------------|-----------|-------|
| `auctionsTax.edges[0].node.auctionId` | `auction_events.raw_data.auction_id` | "FL24", "AZ23" |
| `auctionsTax.edges[0].node.name` | `auction_events.raw_data.auction_name` | "Kissimmee 2024" |
| `runDates.edges[0].node.slug` | `auction_events.auction_start_date` | "2024-01-13" |
| `lotNumber` | `auction_events.lot_number` | "S195.3" |
| `auction.nodes[0].auctionFields.auctionVenue` | `auction_events.raw_data.auction_venue` | "Osceola Heritage Park" |
| `auction.nodes[0].auctionFields.auctionCity` | `auction_events.seller_location` | "Kissimmee" |
| `auction.nodes[0].auctionFields.auctionState` | `auction_events.seller_location` | "Florida" |
| `salesforceItemId` | `auction_events.source_listing_id` | Mecum's internal ID |

### Collection/Owner Data

| Mecum Field | Our Field | Notes |
|-------------|-----------|-------|
| `collectionsTax.edges[0].node.name` | → `organizations.name` | **TRIGGERS ORG CREATION** |
| `collectionsTax.edges[0].node.slug` | → `organizations.slug` | URL-safe identifier |
| `pageTemplate` | metadata | "premium" = important car |

### Content/Provenance

| Mecum Field | Our Field | Notes |
|-------------|-----------|-------|
| `blocks[].attributes.content` | `description` | Full lot description |
| Content parsing | `auction_events.raw_data.ownership_history` | Extracted owner names |
| Content parsing | `auction_events.raw_data.provenance_content` | Provenance paragraphs |

---

## Ownership History Extraction

High-value lots often contain detailed provenance in the content blocks. Example:

```
"The original owner was Andre Aldeghi of Minnesota, who kept the car until 1972.
Colin Bach of Atherton, California, owned 4137GT for a short time prior to
selling the car to Jerry Fiorito..."
```

### Extraction Patterns

```javascript
/original owner (?:was )?([A-Z][a-zA-Z\s]+?) of ([^,.]+)/gi
/sold to ([A-Z][a-zA-Z\s]+?)(?:,? of ([^,.]+))?(?:,| in )/gi
/([A-Z][a-zA-Z\s]+?) of ([A-Z][a-zA-Z,\s]+?) owned/gi
/([A-Z][a-zA-Z\s]+?),? (?:owner|CEO|president) (?:of|and) ([^,]+)/gi
```

### Notable Owners Found

Examples of owners we can extract:
- Tim Koogle (former Yahoo CEO)
- Joe Lacob (Golden State Warriors owner)
- Named collections (The Michael Fux Collection, etc.)

---

## Collection → Organization Flow

When `collectionsTax` is present:

1. **Check if organization exists** by slug
2. **Create if not exists**:
   ```sql
   INSERT INTO organizations (name, slug, type, discovered_via, source_url)
   VALUES ($name, $slug, 'collection', 'mecum-extraction', $lot_url)
   ON CONFLICT (slug) DO NOTHING
   RETURNING id;
   ```
3. **Link vehicle** via `selling_organization_id`
4. **Update organization metadata** with vehicle count

---

## Images

| Mecum Source | Notes |
|--------------|-------|
| `images[]` | Array of image objects |
| JSON-LD `@type: Car` → `image` | More reliable, full gallery |
| Cloudinary URLs | `res.cloudinary.com/mecum/...` |

**Image URL pattern**:
```
https://res.cloudinary.com/mecum/image/upload/v{version}/auctions/{auction_id}/{lot_id}/{image_id}.jpg
```

Upgrade to high-res: Replace `w_640` with `w_1920`

---

## Auction Event Timeline

Same vehicle can appear at multiple auctions. Each appearance = new `auction_event`:

```
Vehicle (VIN: 4137GT)
├── auction_events[0]: Kissimmee 2024, Lot S195.3, SOLD $17.88M
├── auction_events[1]: (hypothetical) Monterey 2020, Lot 123, NOT SOLD
└── auction_events[2]: (hypothetical) Scottsdale 2018, Lot 456, SOLD $15.2M
```

This creates the **price history timeline** for provenance tracking.

---

## Extractor Files

| File | Purpose |
|------|---------|
| `mecum-ultimate-extract.js` | Full extraction with provenance |
| `mecum-json-extract.js` | Price-focused extraction |
| `mecum-deep-dive.js` | Debug/inspection tool |
| `mecum-fast-discover.js` | Discovery only (DO NOT mark active) |

---

## TODO

- [ ] Auto-create organizations from `collectionsTax`
- [ ] Parse ownership history into structured `vehicle_owners` table
- [ ] Extract celebrity owner tags
- [ ] Link to auction_house organizations (Mecum itself)
- [ ] Video extraction from `heroVideo` field
