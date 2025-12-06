# Invoice Learning System

## Overview

The Invoice Learning System reverse-engineers parts knowledge from real invoices and receipts. Instead of guessing prices or labor, it learns from actual professional builds to build a comprehensive knowledge base.

## How It Works

### 1. Invoice Processing
- Upload invoice/receipt (PDF or image)
- AI Vision extracts:
  - Parts (part numbers, brands, prices)
  - Labor (hours, rates, descriptions)
  - System organization (groupings like "Motec Engine management system")
  - Shop/vendor information

### 2. Parts Indexing
- Checks if parts exist in `catalog_parts`
- Adds missing parts with invoice-learned data
- Updates existing parts with better pricing
- Tracks source: `invoice_learning` vs `catalog`

### 3. Pricing Intelligence
- Stores prices in `invoice_learned_pricing`
- Tracks price history across multiple invoices
- Links prices to shops, vehicles, and dates
- Used by quote generator when catalog prices missing

### 4. System Organization Learning
- Learns how parts group into systems
- Example: "Motec Engine management system" = [M130, LTCD, sensors, harness]
- Stores in `system_organization_patterns`
- Helps organize quotes by system

### 5. Labor Pattern Learning
- Extracts labor hours from invoices
- Learns: "Installation" = 50 hours (not 18!)
- Stores in `labor_patterns_learned`
- Used for accurate labor estimates

### 6. Brand-to-Supplier Mappings
- Tracks which shops sell which brands
- Example: Motec → Desert Performance, ProWire → Direct
- Builds supplier network knowledge

## Database Schema

### `invoice_learned_pricing`
Stores pricing data learned from invoices:
- Part number, brand, name
- Price, quantity, unit price
- Source invoice, shop name
- Vehicle context
- Confidence score

### `system_organization_patterns`
Stores system groupings:
- System name (e.g., "Motec Engine management system")
- System category (Engine, Transmission, etc.)
- Part numbers in system
- Total system cost

### `labor_patterns_learned`
Stores labor patterns:
- Work description
- Labor hours, rate, total
- System category
- Parts count, complexity

### `brand_supplier_mappings`
Tracks brand-to-supplier relationships:
- Brand name
- Supplier name, type, location
- How many invoices we've seen this on

## Usage

### Process an Invoice

```bash
# Upload invoice to Supabase Storage first, then:
node scripts/test-invoice-learning.js <invoice_url>
```

Or call the Edge Function directly:

```typescript
const { data } = await supabase.functions.invoke('learn-from-invoice', {
  body: {
    document_id: 'uuid-of-document',
    vehicle_id: 'uuid-of-vehicle', // Optional
    document_url: 'https://storage.supabase.co/...',
    shop_name: 'Desert Performance', // Optional
    invoice_date: '2024-01-15' // Optional
  }
})
```

### Example: Desert Performance Invoice

For the 1932 Roadster with Motec system:

1. **Parts Learned:**
   - Motec M130: $3,500
   - Motec LTCD: $844
   - Bosch LSU 4.9 sensors: $240
   - Custom harness: $3,000
   - (All indexed into catalog)

2. **System Learned:**
   - "Motec Engine management system"
   - Category: Engine
   - Parts: [M130, LTCD, sensors, harness]

3. **Labor Learned:**
   - Installation: 50 hours (not 18!)
   - Dyno testing: $750
   - Programming: included

4. **Brand Mappings:**
   - Motec → Desert Performance
   - Bosch → Desert Performance
   - Denso → Desert Performance

## Integration with Quote Generator

The `generate-wiring-quote` function now uses learned data:

1. **Pricing:**
   - Checks `invoice_learned_pricing` for parts without catalog prices
   - Uses most recent learned price
   - Marks source: `catalog` vs `invoice_learned`

2. **Labor:**
   - Checks `labor_patterns_learned` for similar work
   - Uses learned hours if available
   - Falls back to defaults if no learned patterns

3. **System Organization:**
   - Can group parts by learned system patterns
   - Better quote organization

## Benefits

1. **Real-World Pricing:**
   - Learns actual dealer prices (Motec doesn't publish)
   - Tracks price history
   - Multiple sources = better accuracy

2. **Accurate Labor:**
   - Learns from professional shops
   - 50 hours for complex installs (not 18!)
   - System-specific labor patterns

3. **Complete Parts Database:**
   - Builds catalog from invoices
   - No missing parts
   - Real-world part numbers

4. **System Intelligence:**
   - Learns how parts group
   - Better quote organization
   - System-level pricing

5. **Supplier Network:**
   - Knows who sells what
   - Brand-to-shop mappings
   - Better sourcing recommendations

## Next Steps

1. **Process More Invoices:**
   - Upload invoices from various shops
   - Build comprehensive knowledge base
   - Learn pricing across suppliers

2. **Improve Extraction:**
   - Better part number recognition
   - System grouping intelligence
   - Labor categorization

3. **Quote Enhancement:**
   - Use system patterns for organization
   - Multi-supplier price comparison
   - Historical price trends

4. **Validation:**
   - Cross-check learned prices
   - Verify labor patterns
   - Confidence scoring

## Example Output

```json
{
  "success": true,
  "summary": {
    "invoice": {
      "vendor": "Desert Performance",
      "date": "2024-01-15",
      "total": 12500.00
    },
    "parts_indexed": 12,
    "parts_details": [
      { "part_number": "M130", "name": "Motec M130 ECU", "action": "created" },
      { "part_number": "LTCD", "name": "Motec LTCD Display", "action": "created" }
    ],
    "pricing_learned": 12,
    "systems_learned": 2,
    "systems_details": [
      { "system": "Motec Engine management system", "parts_count": 8 }
    ],
    "labor_learned": 3,
    "labor_details": [
      { "description": "Installation", "hours": 50 }
    ],
    "brands_mapped": 5
  }
}
```

## Status

✅ **Complete and Ready**
- Database schema created
- Edge Function implemented
- Quote generator integrated
- Test script ready

**Ready to process invoices and build knowledge base!**

