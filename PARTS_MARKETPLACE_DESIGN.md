# 🛒 PARTS MARKETPLACE - ENHANCED TAGGING SYSTEM
**Vision:** Turn every image tag into a shoppable part with suppliers, prices, and instant checkout

---

## 🎯 GOAL: FROM GENERIC TAGS TO SHOPPABLE PARTS

### **CURRENT STATE (BAD):**
```
Tag: "Headlight"
- No part number
- No supplier info
- No price
- Can't buy it
```

### **DESIRED STATE (GOOD):**
```
Tag: "Headlight Assembly"
Part#: 15643917 (OEM) | LMC-HL-73 (LMC Truck)
Suppliers:
  └─ LMC Truck: $89.99 [BUY NOW]
  └─ RockAuto: $67.50 [BUY NOW]
  └─ Amazon: $45.99 [BUY NOW]
Condition: New
Fits: 1973-1987 Chevy/GMC C/K Series
```

---

## 📊 DATABASE SCHEMA ENHANCEMENT

### **Enhanced `image_tags` Table:**
```sql
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS
  -- Part Identification
  oem_part_number TEXT,
  aftermarket_part_numbers TEXT[], -- Array of alt part numbers
  part_description TEXT,
  fits_vehicles TEXT[], -- Compatibility
  
  -- Supplier/Pricing
  suppliers JSONB, -- [{name, url, price, stock, shipping}]
  lowest_price_cents INTEGER,
  highest_price_cents INTEGER,
  price_last_updated TIMESTAMPTZ,
  
  -- Purchase Integration
  is_shoppable BOOLEAN DEFAULT false,
  affiliate_links JSONB, -- [{supplier, url, commission_rate}]
  
  -- Part Metadata
  condition TEXT, -- new, used, remanufactured
  warranty_info TEXT,
  install_difficulty TEXT, -- easy, moderate, hard, expert
  estimated_install_time_minutes INTEGER;
```

### **New `part_suppliers` Table:**
```sql
CREATE TABLE part_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name TEXT NOT NULL, -- 'LMC Truck', 'RockAuto', etc.
  supplier_url TEXT,
  supplier_logo_url TEXT,
  api_available BOOLEAN DEFAULT false,
  scrape_config JSONB, -- Scraping rules
  commission_rate DECIMAL(5,2), -- Affiliate %
  shipping_methods JSONB,
  return_policy TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### **New `part_catalog` Table:**
```sql
CREATE TABLE part_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_name TEXT NOT NULL,
  oem_part_number TEXT,
  category TEXT, -- 'dashboard', 'engine', 'body', etc.
  subcategory TEXT,
  fits_makes TEXT[], -- ['Chevrolet', 'GMC']
  fits_models TEXT[], -- ['C10', 'C1500', 'Blazer']
  fits_years INT4RANGE, -- [1973,1987]
  description TEXT,
  install_notes TEXT,
  part_image_urls TEXT[],
  supplier_listings JSONB, -- [{supplier_id, price, url, stock}]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### **New `part_purchases` Table:**
```sql
CREATE TABLE part_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  vehicle_id UUID REFERENCES vehicles(id),
  image_tag_id UUID REFERENCES image_tags(id),
  part_catalog_id UUID REFERENCES part_catalog(id),
  supplier_id UUID REFERENCES part_suppliers(id),
  
  -- Purchase Details
  part_name TEXT,
  part_number TEXT,
  quantity INTEGER DEFAULT 1,
  unit_price_cents INTEGER,
  shipping_cents INTEGER,
  tax_cents INTEGER,
  total_cents INTEGER,
  
  -- Payment
  payment_method TEXT, -- stripe, paypal, etc.
  payment_intent_id TEXT,
  payment_status TEXT, -- pending, paid, failed, refunded
  
  -- Fulfillment
  order_number TEXT,
  tracking_number TEXT,
  ordered_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 🔧 LMC TRUCK CATALOG SCRAPER

### **Edge Function: `scrape-lmc-truck`**

```typescript
// supabase/functions/scrape-lmc-truck/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface LMCPart {
  name: string;
  partNumber: string;
  price: number;
  url: string;
  category: string;
  subcategory: string;
  fitsYears: string;
  fitsMakes: string[];
  fitsModels: string[];
  imageUrl?: string;
  description?: string;
}

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const { category } = await req.json()
  
  // Categories to scrape
  const categories = category ? [category] : [
    'dash-components',
    'instrument-lenses',
    'dashboard-components',
    'air-vent-outlets',
    'glove-box',
    'steering-wheels',
    'seats',
    'door-panels',
    // ... all categories
  ]
  
  const scrapedParts: LMCPart[] = []
  
  for (const cat of categories) {
    const url = `https://www.lmctruck.com/interior/dash-components/${cat}`
    
    try {
      const response = await fetch(url)
      const html = await response.text()
      
      // Parse HTML to extract parts
      // LMC Truck structure: <div class="product-item">
      const partRegex = /<div class="product-item"[^>]*>(.*?)<\/div>/gs
      const matches = html.matchAll(partRegex)
      
      for (const match of matches) {
        const partHTML = match[1]
        
        // Extract part number: data-part-number="15643917"
        const partNumMatch = partHTML.match(/data-part-number="([^"]+)"/)
        const partNumber = partNumMatch?.[1]
        
        // Extract name: <h3 class="part-name">
        const nameMatch = partHTML.match(/<h3[^>]*>(.*?)<\/h3>/)
        const name = nameMatch?.[1]?.trim()
        
        // Extract price: <span class="price">$89.99</span>
        const priceMatch = partHTML.match(/<span class="price">\$([0-9.]+)<\/span>/)
        const price = priceMatch ? parseFloat(priceMatch[1]) : null
        
        // Extract fits: "Fits: 1973-1987 Chevy/GMC C/K Series"
        const fitsMatch = partHTML.match(/Fits:\s*([0-9-]+)\s+(.*?)</i)
        const fitsYears = fitsMatch?.[1] || ''
        const fitsModels = fitsMatch?.[2]?.split('/') || []
        
        if (partNumber && name) {
          scrapedParts.push({
            name,
            partNumber,
            price: price || 0,
            url: `${url}?part=${partNumber}`,
            category: 'interior',
            subcategory: cat,
            fitsYears,
            fitsMakes: ['Chevrolet', 'GMC'],
            fitsModels
          })
        }
      }
    } catch (error) {
      console.error(`Error scraping ${cat}:`, error)
    }
  }
  
  // Insert into part_catalog
  const { data, error } = await supabase
    .from('part_catalog')
    .upsert(
      scrapedParts.map(part => ({
        part_name: part.name,
        oem_part_number: part.partNumber,
        category: part.category,
        subcategory: part.subcategory,
        fits_makes: part.fitsMakes,
        fits_models: part.fitsModels,
        fits_years: part.fitsYears ? `[${part.fitsYears.split('-').join(',')}]` : null,
        description: part.description,
        supplier_listings: [{
          supplier: 'LMC Truck',
          price_cents: Math.round(part.price * 100),
          url: part.url,
          in_stock: true
        }]
      })),
      { onConflict: 'oem_part_number' }
    )
  
  return new Response(JSON.stringify({
    success: !error,
    parts_scraped: scrapedParts.length,
    parts_inserted: data?.length || 0,
    error: error?.message
  }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
```

---

## 🏷️ ENHANCED TAG UI - SHOPPABLE PARTS

### **New Component: `ShoppablePartTag.tsx`**

```tsx
interface ShoppablePartTagProps {
  tag: ImageTag;
  onBuy: (supplier: string, partNumber: string) => void;
}

const ShoppablePartTag: React.FC<ShoppablePartTagProps> = ({ tag, onBuy }) => {
  const [showSuppliers, setShowSuppliers] = useState(false);
  
  return (
    <div className="shoppable-tag" style={{
      background: tag.is_shoppable ? '#c0ffc0' : '#c0c0c0',
      border: '2px solid #000',
      padding: '4px',
      marginBottom: '4px',
      fontFamily: '"MS Sans Serif", sans-serif',
      fontSize: '8pt'
    }}>
      {/* Part Name */}
      <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>
        {tag.tag_name}
        {tag.is_shoppable && <span style={{ color: '#008000' }}> 🛒</span>}
      </div>
      
      {/* Part Numbers */}
      {tag.oem_part_number && (
        <div style={{ fontSize: '7pt', color: '#424242' }}>
          OEM: {tag.oem_part_number}
          {tag.aftermarket_part_numbers && tag.aftermarket_part_numbers.length > 0 && (
            <> | AM: {tag.aftermarket_part_numbers.join(', ')}</>
          )}
        </div>
      )}
      
      {/* Supplier Pricing */}
      {tag.suppliers && tag.suppliers.length > 0 && (
        <div style={{ marginTop: '4px' }}>
          <button
            onClick={() => setShowSuppliers(!showSuppliers)}
            style={{
              width: '100%',
              padding: '2px',
              background: '#c0c0c0',
              border: '1px outset #fff',
              fontSize: '8pt',
              cursor: 'pointer'
            }}
          >
            {showSuppliers ? '▼' : '▶'} {tag.suppliers.length} Suppliers (${(tag.lowest_price_cents / 100).toFixed(2)} - ${(tag.highest_price_cents / 100).toFixed(2)})
          </button>
          
          {showSuppliers && (
            <div style={{
              background: '#fff',
              border: '1px inset #808080',
              marginTop: '2px',
              padding: '2px'
            }}>
              {tag.suppliers.map((supplier: any, idx: number) => (
                <div key={idx} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '2px',
                  borderBottom: idx < tag.suppliers.length - 1 ? '1px solid #e0e0e0' : 'none'
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold' }}>{supplier.name}</div>
                    <div style={{ fontSize: '7pt', color: '#808080' }}>
                      {supplier.stock_status || 'In Stock'}
                      {supplier.shipping_days && ` • Ships in ${supplier.shipping_days} days`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 'bold', color: '#008000' }}>
                      ${(supplier.price_cents / 100).toFixed(2)}
                    </div>
                    <button
                      onClick={() => onBuy(supplier.name, tag.oem_part_number)}
                      style={{
                        padding: '1px 4px',
                        background: '#008000',
                        color: '#fff',
                        border: '1px outset #fff',
                        fontSize: '7pt',
                        cursor: 'pointer',
                        marginTop: '2px'
                      }}
                    >
                      BUY
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      {/* Not Shoppable - Add Part Info */}
      {!tag.is_shoppable && (
        <button
          onClick={() => {/* Open part info modal */}}
          style={{
            width: '100%',
            padding: '2px',
            background: '#ffffe1',
            border: '1px solid #000',
            fontSize: '7pt',
            cursor: 'pointer',
            marginTop: '4px'
          }}
        >
          + Add Part Info
        </button>
      )}
    </div>
  );
};
```

---

## 💳 CHECKOUT FLOW

### **Component: `PartCheckoutModal.tsx`**

```tsx
interface PartCheckoutModalProps {
  part: {
    name: string;
    partNumber: string;
    supplier: string;
    price: number;
    imageUrl: string;
    vehicleId: string;
  };
  onClose: () => void;
  onComplete: (orderId: string) => void;
}

const PartCheckoutModal: React.FC<PartCheckoutModalProps> = ({ part, onClose, onComplete }) => {
  const [quantity, setQuantity] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'paypal'>('stripe');
  const [processing, setProcessing] = useState(false);
  
  const subtotal = part.price * quantity;
  const shipping = 12.99; // TODO: Calculate based on supplier
  const tax = subtotal * 0.08; // TODO: Calculate based on location
  const total = subtotal + shipping + tax;
  
  const handlePurchase = async () => {
    setProcessing(true);
    
    try {
      // 1. Create Stripe Payment Intent
      const { data: paymentIntent } = await supabase.functions.invoke('create-payment-intent', {
        body: {
          amount_cents: Math.round(total * 100),
          currency: 'usd',
          metadata: {
            part_number: part.partNumber,
            supplier: part.supplier,
            vehicle_id: part.vehicleId
          }
        }
      });
      
      // 2. Record purchase in database
      const { data: purchase } = await supabase
        .from('part_purchases')
        .insert({
          part_name: part.name,
          part_number: part.partNumber,
          quantity,
          unit_price_cents: Math.round(part.price * 100),
          shipping_cents: Math.round(shipping * 100),
          tax_cents: Math.round(tax * 100),
          total_cents: Math.round(total * 100),
          payment_intent_id: paymentIntent.id,
          payment_status: 'pending',
          vehicle_id: part.vehicleId
        })
        .select()
        .single();
      
      // 3. Open Stripe checkout
      const stripe = await loadStripe(STRIPE_PUBLIC_KEY);
      const { error } = await stripe.confirmPayment({
        clientSecret: paymentIntent.client_secret,
        confirmParams: {
          return_url: `${window.location.origin}/purchase-success`
        }
      });
      
      if (!error) {
        onComplete(purchase.id);
      }
    } catch (error) {
      console.error('Purchase failed:', error);
      alert('Purchase failed: ' + error.message);
    } finally {
      setProcessing(false);
    }
  };
  
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.8)',
      zIndex: 10001,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <div style={{
        background: '#c0c0c0',
        border: '2px outset #fff',
        width: '500px',
        fontFamily: '"MS Sans Serif", sans-serif'
      }}>
        {/* Title Bar */}
        <div style={{
          background: '#000080',
          color: '#fff',
          padding: '2px 4px',
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '9pt',
          fontWeight: 'bold'
        }}>
          <span>Checkout - {part.supplier}</span>
          <button onClick={onClose} style={{
            background: '#c0c0c0',
            border: '1px outset #fff',
            padding: '0 4px'
          }}>✕</button>
        </div>
        
        {/* Content */}
        <div style={{ padding: '12px' }}>
          {/* Part Details */}
          <div style={{
            background: '#fff',
            border: '1px inset #808080',
            padding: '8px',
            marginBottom: '8px'
          }}>
            <div style={{ fontWeight: 'bold', fontSize: '9pt' }}>{part.name}</div>
            <div style={{ fontSize: '8pt', color: '#424242' }}>Part #: {part.partNumber}</div>
            <div style={{ fontSize: '8pt', color: '#008000', fontWeight: 'bold', marginTop: '4px' }}>
              ${part.price.toFixed(2)} each
            </div>
          </div>
          
          {/* Quantity */}
          <div style={{ marginBottom: '8px' }}>
            <label style={{ fontSize: '8pt', marginRight: '8px' }}>Quantity:</label>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
              style={{
                width: '60px',
                padding: '2px',
                border: '1px inset #808080',
                fontSize: '8pt'
              }}
            />
          </div>
          
          {/* Order Summary */}
          <div style={{
            background: '#fff',
            border: '1px inset #808080',
            padding: '8px',
            marginBottom: '8px',
            fontSize: '8pt'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
              <span>Subtotal:</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
              <span>Shipping:</span>
              <span>${shipping.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
              <span>Tax:</span>
              <span>${tax.toFixed(2)}</span>
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              borderTop: '1px solid #000',
              paddingTop: '4px',
              marginTop: '4px',
              fontWeight: 'bold',
              fontSize: '9pt'
            }}>
              <span>TOTAL:</span>
              <span>${total.toFixed(2)}</span>
            </div>
          </div>
          
          {/* Payment Method */}
          <div style={{ marginBottom: '8px' }}>
            <label style={{ fontSize: '8pt', display: 'block', marginBottom: '4px' }}>
              Payment Method:
            </label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as any)}
              style={{
                width: '100%',
                padding: '2px',
                border: '1px inset #808080',
                fontSize: '8pt'
              }}
            >
              <option value="stripe">Credit Card (Stripe)</option>
              <option value="paypal">PayPal</option>
            </select>
          </div>
          
          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={onClose}
              disabled={processing}
              style={{
                flex: 1,
                padding: '6px',
                background: '#c0c0c0',
                border: '1px outset #fff',
                fontSize: '8pt',
                cursor: processing ? 'not-allowed' : 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              onClick={handlePurchase}
              disabled={processing}
              style={{
                flex: 2,
                padding: '6px',
                background: processing ? '#808080' : '#008000',
                color: '#fff',
                border: '1px outset #fff',
                fontSize: '8pt',
                fontWeight: 'bold',
                cursor: processing ? 'not-allowed' : 'pointer'
              }}
            >
              {processing ? 'Processing...' : `Purchase ${quantity}x for $${total.toFixed(2)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
```

---

## 🤖 AI PART RECOGNITION ENHANCEMENT

### **Upgrade AI Analysis to Detect Part Numbers:**

```typescript
// supabase/functions/analyze-vehicle-image/index.ts

// ENHANCED PROMPT:
const prompt = `Analyze this vehicle image and identify ALL visible parts with:
1. Generic name (e.g. "Headlight Assembly")
2. OEM part number if visible (e.g. stamped on part, readable in photo)
3. Estimated year range this part fits
4. Make/model compatibility
5. Bounding box coordinates (x, y, width, height as %)

For dashboard components specifically:
- Instrument cluster bezel
- Gauge faces  
- Air vent outlets
- Glove box door
- Radio bezel
- Ash tray
- Heater controls

Return JSON array of parts with:
{
  name: string,
  oem_part_number?: string,
  category: string,
  x: number,
  y: number,
  width: number,
  height: number,
  confidence: number,
  fits_years?: string,
  notes?: string
}`;

// After AI returns tags, lookup in part_catalog to enrich with supplier data
for (const tag of aiTags) {
  if (tag.oem_part_number) {
    const { data: catalogPart } = await supabase
      .from('part_catalog')
      .select('*, supplier_listings')
      .eq('oem_part_number', tag.oem_part_number)
      .single();
    
    if (catalogPart) {
      tag.suppliers = catalogPart.supplier_listings;
      tag.is_shoppable = true;
      tag.lowest_price_cents = Math.min(...catalogPart.supplier_listings.map(s => s.price_cents));
    }
  }
}
```

---

## 📦 IMPLEMENTATION PLAN

### **Phase 1: Database & Schema** (Week 1)
1. Create migrations for enhanced tables
2. Add columns to `image_tags`
3. Create `part_catalog`, `part_suppliers`, `part_purchases`
4. Set up RLS policies

### **Phase 2: LMC Truck Scraper** (Week 1-2)
1. Build Edge Function to scrape LMC Truck
2. Parse product pages, extract part numbers, prices
3. Handle pagination (they have thousands of parts)
4. Store in `part_catalog`
5. Schedule daily sync to update prices/stock

### **Phase 3: Enhanced Tagging UI** (Week 2)
1. Upgrade `ImageLightbox` tag sidebar
2. Show part numbers, suppliers, prices
3. Add "BUY" buttons per supplier
4. Implement supplier comparison view

### **Phase 4: Checkout System** (Week 3)
1. Create `PartCheckoutModal` component
2. Integrate Stripe for payment processing
3. Store purchase records
4. Send confirmation emails
5. Track shipments

### **Phase 5: AI Enhancement** (Week 3-4)
1. Train AI to recognize specific parts
2. Match against LMC Truck catalog
3. Auto-populate part numbers
4. Suggest compatible parts

---

## 🚀 QUICK WIN: MANUAL PART ENRICHMENT

**While we build the scraper, enable manual part entry:**

```tsx
// In ImageLightbox sidebar, add "Enrich Tag" button
<button onClick={() => openPartEnrichmentModal(tag)}>
  + Add Part Info
</button>

// Modal allows entering:
- Part number
- Supplier URLs (LMC, RockAuto, Amazon)
- Prices
- Mark as "shoppable"
```

---

## 📋 NEXT STEPS

Want me to:
1. ✅ Create database migrations for part marketplace
2. ✅ Build LMC Truck scraper Edge Function
3. ✅ Upgrade tag UI to show part info
4. ✅ Implement buy buttons + checkout
5. ✅ Integrate Stripe for payments

Or start with a specific piece (e.g. "build the scraper first")?

This transforms your tagging system from **generic object detection** into a **full parts marketplace** where users can click any dashboard component and instantly buy it from multiple suppliers!
