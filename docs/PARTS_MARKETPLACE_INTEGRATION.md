# Parts Marketplace Integration Architecture

## Overview

The parts marketplace integration allows users to:
1. **Identify parts** from labeled images
2. **Find replacement parts** from suppliers (like LMCTruck)
3. **Purchase through our platform** (we act as middleman)

## Current State: Image Labeling

Before marketplace integration, we need:
- ✅ Images uploading correctly
- ✅ Images labeling perfectly (angle, part, spatial data)
- ✅ Manual references linking to images
- ⏳ Parts marketplace integration (future)

## Architecture

### Phase 1: Parts Data Consumption

#### 1.1 Supplier Data Integration
- **LMCTruck** (primary for 60s-90s GM trucks)
- **Other suppliers** (RockAuto, Summit Racing, etc.)
- **OEM parts catalogs**

#### 2. Data Structure
```sql
-- Parts catalog from suppliers
CREATE TABLE supplier_parts (
  id UUID PRIMARY KEY,
  supplier_name TEXT, -- 'lmctruck', 'rockauto', etc.
  supplier_part_number TEXT,
  oem_part_number TEXT,
  part_name TEXT,
  part_category TEXT,
  make TEXT,
  model TEXT,
  year_start INTEGER,
  year_end INTEGER,
  price DECIMAL(10,2),
  availability TEXT, -- 'in_stock', 'backorder', 'discontinued'
  supplier_url TEXT,
  image_url TEXT,
  description TEXT,
  metadata JSONB
);

-- Link parts to vehicle images
CREATE TABLE image_part_matches (
  id UUID PRIMARY KEY,
  image_id UUID REFERENCES vehicle_images(id),
  supplier_part_id UUID REFERENCES supplier_parts(id),
  match_confidence INTEGER, -- 0-100
  match_method TEXT, -- 'ai_identified', 'manual_reference', 'user_selected'
  created_at TIMESTAMPTZ
);
```

### Phase 2: AI Navigation & Matching

#### 2.1 Web Scraping/API Integration
- **Option A**: Official API (if available)
- **Option B**: Web scraping with AI navigation
  - Use AI to navigate supplier websites
  - Extract part data, prices, availability
  - Handle pagination, filters, search

#### 2.2 Part Matching Algorithm
```typescript
// Match identified part from image to supplier catalog
async function matchImagePartToSupplier(
  imageId: string,
  identifiedPart: string,
  vehicleContext: VehicleContext
): Promise<SupplierPart[]> {
  // 1. Search supplier catalog by part name + vehicle YMM
  // 2. Use AI to match visual similarity
  // 3. Cross-reference with manual part numbers
  // 4. Rank by confidence
}
```

### Phase 3: Purchase Flow

#### 3.1 Middleman Purchase Window
```typescript
// User clicks "Buy Replacement Part" on labeled image
interface PurchaseFlow {
  1. Show matched parts from suppliers
  2. User selects part + quantity
  3. Calculate total (part price + our margin + shipping)
  4. Process payment through our system
  5. Place order with supplier (API or automated)
  6. Track order status
  7. Handle fulfillment
}
```

#### 3.2 Order Management
```sql
CREATE TABLE part_orders (
  id UUID PRIMARY KEY,
  user_id UUID,
  vehicle_id UUID,
  image_id UUID, -- The image that triggered the purchase
  supplier_part_id UUID,
  quantity INTEGER,
  unit_price DECIMAL(10,2),
  our_margin DECIMAL(10,2),
  shipping_cost DECIMAL(10,2),
  total_price DECIMAL(10,2),
  order_status TEXT, -- 'pending', 'placed', 'confirmed', 'shipped', 'delivered'
  supplier_order_id TEXT,
  tracking_number TEXT,
  created_at TIMESTAMPTZ
);
```

## Implementation Priority

### Step 1: Perfect Image Labeling ✅ (Current Focus)
- Image upload working
- Angle classification accurate
- Part identification precise
- Manual references linking
- Spatial mapping correct

### Step 2: Manual Integration (Next)
- Upload manuals (73-87 GM trucks)
- Index manual content (extract part numbers, diagrams)
- Link manual pages to image classifications
- Show manual pages in annotation viewer

### Step 3: Parts Data Collection (Future)
- Scrape/API integration with LMCTruck
- Build parts catalog database
- Match parts to vehicle YMM
- Index part images for visual matching

### Step 4: AI Matching (Future)
- Match identified parts from images to supplier catalog
- Use manual part numbers as cross-reference
- Visual similarity matching
- Confidence scoring

### Step 5: Purchase Integration (Future)
- Build purchase UI
- Payment processing
- Order management
- Supplier order placement
- Tracking & fulfillment

## Benefits

1. **Instant Part Discovery**: User sees labeled image → clicks annotation → sees manual page → sees replacement parts
2. **Accurate Matching**: AI navigates supplier sites faster than humans
3. **Revenue Stream**: We take margin on parts sales
4. **Better UX**: One-click purchase vs. manual navigation
5. **Data Advantage**: We know what parts users need from images

## Example Flow

```
User uploads image of brake caliper
  ↓
AI labels: "brake_caliper", "front_left_wheel", spatial coordinates
  ↓
User clicks "Annotation" button
  ↓
Shows: Manual page 247 (Brake System - Front Caliper Assembly)
  ↓
Shows: "Buy Replacement Part" button
  ↓
AI searches LMCTruck: "1975 Chevy C10 front brake caliper"
  ↓
Shows: 3 matching parts with prices, availability, images
  ↓
User selects part, clicks "Purchase"
  ↓
Our system processes payment, places order with LMCTruck
  ↓
Order tracking, fulfillment, delivery
```

## Technical Considerations

1. **Supplier Agreements**: Need to establish relationships/APIs
2. **Pricing**: Dynamic pricing, margins, shipping calculations
3. **Inventory**: Real-time availability checking
4. **Returns**: Handle returns/refunds
5. **Compliance**: Sales tax, regulations
6. **Scalability**: Handle multiple suppliers, high volume

## Next Steps

1. ✅ Complete image labeling system
2. ⏳ Upload and index manuals
3. ⏳ Build annotation viewer with manual pages
4. ⏳ Research LMCTruck API/scraping options
5. ⏳ Design parts matching algorithm
6. ⏳ Build purchase flow UI
7. ⏳ Implement order management

