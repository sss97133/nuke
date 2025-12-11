# Auction House Crawling Readiness

## ✅ What's Ready

### 1. Dealer Profile Extraction
- ✅ Extracts dealer/auction house profiles from Classic.com
- ✅ Detects business type: `'dealer'` vs `'auction_house'`
- ✅ Handles both types in same extraction flow

### 2. Organization Creation
- ✅ Creates organizations with `type: 'auction_house'` or `type: 'dealer'`
- ✅ Stores in `businesses` table with correct `business_type`
- ✅ Geographic matching prevents duplicates

### 3. Inventory Extraction Queue
- ✅ Automatically queues inventory extraction after profile creation
- ✅ Differentiates between dealers and auction houses:
  - **Dealers**: Scrapes `inventory_url` → creates `dealer_inventory` records
  - **Auction Houses**: Scrapes `auctions_url` → should create `auction_events` and `auction_lots`

### 4. Image Extraction
- ✅ Logo extraction (from Classic.com)
- ✅ Favicon extraction (from website)
- ✅ Primary image extraction (property front - basic, keeping expectations low)

---

## ⚠️ What's Missing for Auction Houses

### 1. Auction Event/Lot Structure

**Current State**: `scrape-multi-source` extracts listings but doesn't structure them as auction events/lots

**Needed**: 
- Parse auction events (dates, locations, catalogs)
- Structure lots within events
- Store in `auction_events` and `auction_lots` tables

**Example Structure**:
```json
{
  "auction_events": [
    {
      "event_name": "Spring Classic Auction",
      "event_date": "2024-04-15",
      "location": "Las Vegas, NV",
      "catalog_url": "https://auctionhouse.com/spring-2024",
      "lots": [
        {
          "lot_number": "101",
          "vehicle": { "year": 1985, "make": "Chevrolet", "model": "K10" },
          "starting_bid": 15000,
          "reserve_price": 20000,
          "auction_date": "2024-04-15T10:00:00Z"
        }
      ]
    }
  ]
}
```

### 2. Auction-Specific Extraction Schema

**Current**: Generic listing extraction schema

**Needed**: Auction-specific schema for Firecrawl:
```typescript
{
  auction_events: [{
    event_name: string,
    event_date: string,
    location: string,
    catalog_url: string,
    lots: [{
      lot_number: string,
      vehicle_data: {...},
      starting_bid: number,
      reserve_price: number,
      auction_date: string
    }]
  }]
}
```

---

## Ready to Crawl? Status

### ✅ Ready For:
1. **Dealer Profile Indexing** - Fully ready
   - Extract profiles from Classic.com
   - Create organizations
   - Queue inventory extraction

2. **Dealer Inventory Extraction** - Fully ready
   - Scrapes dealer websites
   - Creates `dealer_inventory` records
   - Links vehicles to organizations

3. **Auction House Profile Indexing** - Ready
   - Extracts auction house profiles
   - Creates organizations with `type: 'auction_house'`
   - Queues auction extraction

### ⚠️ Partially Ready For:
4. **Auction House Inventory Extraction** - Needs Enhancement
   - ✅ Queues extraction from `auctions_url`
   - ✅ Extracts listings
   - ❌ Doesn't structure as `auction_events`/`auction_lots`
   - ❌ Lists are stored as generic listings, not auction lots

---

## Next Steps for Full Auction House Support

### Phase 1: Enhanced Auction Extraction Schema

Update `scrape-multi-source` to use auction-specific schema when `source_type === 'auction_house'`:

```typescript
const auctionSchema = {
  type: 'object',
  properties: {
    auction_events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          event_name: { type: 'string' },
          event_date: { type: 'string' },
          location: { type: 'string' },
          catalog_url: { type: 'string' },
          lots: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                lot_number: { type: 'string' },
                vehicle: { /* vehicle schema */ },
                starting_bid: { type: 'number' },
                reserve_price: { type: 'number' },
                auction_date: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }
};
```

### Phase 2: Auction Event/Lot Storage

Create function to store auction data:
```typescript
async function storeAuctionData(
  organizationId: string,
  auctionEvents: AuctionEvent[],
  supabase: any
) {
  for (const event of auctionEvents) {
    // Create auction_event
    const { data: auctionEvent } = await supabase
      .from('auction_events')
      .insert({
        organization_id: organizationId,
        event_name: event.event_name,
        event_date: event.event_date,
        location: event.location,
        catalog_url: event.catalog_url
      })
      .select('id')
      .single();

    // Create auction_lots for each lot
    for (const lot of event.lots) {
      // Create vehicle first
      const vehicleId = await createOrFindVehicle(lot.vehicle);
      
      // Create auction_lot
      await supabase
        .from('auction_lots')
        .insert({
          auction_event_id: auctionEvent.id,
          lot_number: lot.lot_number,
          vehicle_id: vehicleId,
          starting_bid: lot.starting_bid,
          reserve_price: lot.reserve_price,
          scheduled_start_time: lot.auction_date
        });
    }
  }
}
```

---

## Current Workaround

For now, auction house listings are:
1. ✅ Extracted as generic listings
2. ✅ Queued in `import_queue`
3. ✅ Processed as vehicles
4. ⚠️ Not structured as auction events/lots (manual structuring needed later)

This is acceptable for initial indexing - we can enhance the auction structure later.

---

## Summary

**Ready to crawl auction house sites?** 

✅ **YES** - For profile indexing and basic listing extraction  
⚠️ **PARTIALLY** - Auction event/lot structuring needs enhancement

**Recommendation**: Start crawling now, enhance auction structure in Phase 2.

