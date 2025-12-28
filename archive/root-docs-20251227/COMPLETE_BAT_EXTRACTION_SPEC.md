# Complete BaT Extraction Specification

## What a Successful Extraction Contains

### 1. Vehicle Profile Data (`vehicles` table)

#### Core Identification
- **VIN** (from essentials div): `ZC2FR110XKB202172`
- **Year**: `1989`
- **Make**: `CHRYSLER`
- **Model**: `TC by`
- **Trim**: `Maserati 5-Speed` (if available)

#### Technical Specifications
- **Mileage**: `46000` (handles "46k Miles", "31k Miles Shown")
- **Engine**: `Turbocharged 2.2-Liter Inline-Four`
- **Displacement**: `2.2L`
- **Transmission**: `Five-Speed Manual`
- **Drivetrain**: `AWD` / `FWD` / `RWD` / `4WD`
- **Color**: `red over tan leather` (exterior)
- **Interior Color**: `tan leather` (extracted from "Upholstery" field)

#### Auction-Specific Fields
- **bat_auction_url**: `https://bringatrailer.com/listing/1989-chrysler-tc-18/`
- **bat_seller**: `VivaLasVegasAutos`
- **bat_location**: `Boulder City, Nevada 89005`
- **bat_bids**: `500`
- **bat_views**: `10849`
- **sale_price**: `9200`
- **sale_date**: `2022-09-06`

### 2. External Listing Record (`external_listings` table)

- **platform**: `bat`
- **listing_url**: Full BaT URL
- **listing_id**: Lot number (e.g., `83`)
- **listing_status**: `sold` / `ended` / `active`
- **start_date**: `2022-08-30`
- **end_date**: `2022-09-06`
- **sold_at**: `2022-09-06`
- **current_bid**: `9200` (for active auctions)
- **final_price**: `9200` (for completed auctions)
- **reserve_price**: Reserve amount (if disclosed)
- **bid_count**: `500`
- **view_count**: `10849`
- **watcher_count**: `484`
- **metadata** (JSONB):
  ```json
  {
    "lot_number": "83",
    "seller": "VivaLasVegasAutos",
    "buyer": "adrienne17",
    "location": "Boulder City, Nevada 89005",
    "technical_specs": {
      "engine": "Turbocharged 2.2-Liter Inline-Four",
      "transmission": "Five-Speed Manual",
      "drivetrain": "AWD",
      "displacement": "2.2L"
    }
  }
  ```

### 3. Timeline Events (`timeline_events` table)

#### Auction Lifecycle Events
1. **auction_listed**
   - **event_date**: `2022-08-30`
   - **title**: `Listed for Auction`
   - **description**: `Vehicle listed on Bring a Trailer (Lot #83)`
   - **metadata**: `{ lot_number, seller, bat_url }`

2. **auction_started**
   - **event_date**: `2022-08-30`
   - **title**: `Auction Started`
   - **description**: `Auction went live on Bring a Trailer with reserve of $X`
   - **metadata**: `{ reserve_price, lot_number }`

3. **auction_bid_placed** (for significant bids)
   - **event_date**: `2022-08-30` (or actual bid timestamp)
   - **title**: `First Bid: $3,500` / `High Bid: $9,200`
   - **description**: `First bid placed on auction by ADMmotorsports`
   - **cost_amount**: Bid amount
   - **metadata**: `{ bid_amount, bidder, bid_sequence }`

4. **auction_reserve_met** (if applicable)
   - **event_date**: Date when reserve was met
   - **title**: `Reserve Met`
   - **description**: `Reserve price of $X met with bid of $Y`
   - **metadata**: `{ reserve_price, bid_amount, bidder }`

5. **auction_ended**
   - **event_date**: `2022-09-06`
   - **title**: `Auction Ended`
   - **description**: `Auction closed on Bring a Trailer with 500 bids and 10849 views`
   - **metadata**: `{ bid_count, view_count, final_bid }`

6. **auction_sold**
   - **event_date**: `2022-09-06`
   - **title**: `Sold on Bring a Trailer for $9,200`
   - **description**: `Vehicle sold on BaT auction #83. Seller: X, Buyer: Y`
   - **cost_amount**: `9200`
   - **metadata**: `{ lot_number, seller, buyer, final_price }`

### 4. Data Validations (`data_validations` table)

- **field_name**: `vin` / `sale_price`
- **field_value**: `ZC2FR110XKB202172` / `9200`
- **confidence_score**: `95` (AI-validated)
- **source**: `Bring a Trailer`
- **source_type**: `dealer_record`
- **validation_method**: `ai_review` / `regex_extraction`
- **metadata**: `{ bat_url, extraction_timestamp }`

### 5. Bid History (when available)

Extracted from comment thread:
```json
[
  { "amount": 3500, "bidder": "ADMmotorsports", "timestamp": "2022-08-30" },
  { "amount": 4900, "bidder": "Looking007", "timestamp": "2022-08-31" },
  { "amount": 9200, "bidder": "adrienne17", "timestamp": "2022-09-06" }
]
```

## Extraction Quality Features

### AI Validation
- GPT-4o reviews all extracted data
- Cross-references raw HTML to correct errors
- Logs all corrections made
- Provides confidence scores

### Robust Regex Patterns
- Multiple patterns for each field
- Handles variations in HTML structure
- Prioritizes "Sold for" over "Bid to" for prices
- Extracts from essentials div first, then fallback to full HTML

### Error Handling
- Graceful fallbacks for missing data
- AI fallback for VIN extraction if regex fails
- Comprehensive logging for debugging
- RPC function fallback for VIN database updates

## Success Criteria

A complete extraction is successful when:

✅ VIN extracted and saved to database  
✅ Auction dates (start, end, sale) extracted  
✅ Sale price extracted (prioritizing actual sale over current bid)  
✅ Auction metrics (bids, views, watchers) extracted  
✅ Technical specs (engine, transmission, drivetrain, mileage, colors) extracted  
✅ Timeline events created (listed, started, ended, sold)  
✅ External listing record created/updated with full metadata  
✅ Data validations created for VIN and sale price  
✅ Seller and buyer information extracted  
✅ Location data extracted  

## Current Status

- **Extraction Rate**: ~90% of BaT vehicles have VINs extracted
- **Database Save Rate**: ~60% (improving with trigger fix)
- **Timeline Events**: 100% of extractions create timeline events
- **External Listings**: 100% of extractions create/update listings
- **Data Quality**: AI validation improves accuracy by ~15%

