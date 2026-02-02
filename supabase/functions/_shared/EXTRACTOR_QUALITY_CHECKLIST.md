# Extractor Quality Checklist (Agent Instructions)

When inspecting or fixing any listing/auction extractor, apply this checklist so vehicles are not duplicated and classic-car fields are captured.

## 1. Duplicate vehicle handling (avoid `vehicles_discovery_url_unique` violation)

Before **inserting** a new vehicle, resolve existing vehicle in this order:

1. **By external_listings** (preferred):  
   `platform` + `listing_url_key` (use `normalizeListingUrlKey(url)` from `_shared/listingUrl.ts`).  
   If a row exists, use its `vehicle_id` and **update** the vehicle + upsert listing.

2. **By discovery_url exact**:  
   `vehicles.discovery_url = extracted.url` (same scheme/host/path).  
   If found, use that `vehicle_id` and **update** + upsert listing.

3. **By URL pattern** (same listing, different URL format):  
   `vehicles.discovery_url ILIKE '%domain.com/path/slug%'` using a stable slug or path.  
   If found, use that `vehicle_id` and **update** + upsert listing.

4. **Only then** insert a new vehicle.  
   Never set `vehicleId = existingListing.vehicle_id` when the vehicle was found via (2) or (3)—`existingListing` may be null.

## 2. Classic car identity (VIN / chassis)

- **Chassis number** is the effective VIN for pre-1981 classics. Extract it from copy (e.g. "Chassis no. 16407", "Chassis: 16407").
- **VIN field**: If no 17-character VIN is found, set `vehicles.vin` from chassis number so one canonical identifier exists.
- Store chassis separately in `external_listings.metadata.chassis_number` and/or vehicle `origin_metadata` when the source has it.

## 3. Auction / listing metadata to capture

Where the source provides them, extract and persist:

- **Estimate** (low/high) and currency.
- **Auction calendar position**: e.g. "2025 Pebble Beach Auctions (Lot 38)" (sale name + year + lot number).
- **Coachwork**: e.g. "Scaglietti" (store in metadata and/or notes).
- **Saleroom addendum / SRA note**: plain text or HTML stripped.
- **Highlights** and **technical specs**: full arrays in metadata (no arbitrary truncation).
- **Listing URL key**: always use `normalizeListingUrlKey(url)` for `external_listings.listing_url_key`.

## 4. Shared usage

- **Listing URL normalization**: `import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';`
- **Resolve vehicle before insert**: use the 1 → 2 → 3 → 4 order above; after resolving, either update existing vehicle or insert new, then upsert `external_listings` and images.

## 5. Extractors to align

- `extract-gooding` (reference implementation)
- `extract-bonhams`
- `extract-bh-auction`
- `extract-historics-uk`
- `extract-rmsothebys`
- `extract-collecting-cars` / `extract-collecting-cars-simple`
- `import-classic-auction`
- Any other function that writes to `vehicles` + `external_listings` from a listing URL
