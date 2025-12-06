# Invoice Learning System - Access Guide

## 🎯 Where Everything Is Accessible

### 1. **Wiring Query Context Bar** ⚡

**Location:** Vehicle Profile Page
- Navigate to any vehicle → Scroll to "Parts Quote Generator" section
- Context bar appears above the quote generator

**Access:**
```
Vehicle Profile → ⚡ WIRING QUERY section
```

**What It Does:**
- Natural language queries: "I need a motec wiring harness for my vehicle"
- Context-aware (detects if you're mid-project)
- Generates quotes instantly
- Shows recommendations and pricing

**Example Queries:**
- "I need a motec wiring harness for my vehicle"
- "What wiring do I need for this build?"
- "Get me a quote for motec ECU and wiring"
- "I need sensors for my motec system"

---

### 2. **Invoice Learning Function** 🧠

**Location:** Edge Function (Backend)
- Function: `learn-from-invoice`
- Accessible via API or test script

**Access via Test Script:**
```bash
node scripts/test-invoice-learning.js <invoice_url>
```

**Access via API:**
```typescript
const { data } = await supabase.functions.invoke('learn-from-invoice', {
  body: {
    document_id: 'uuid',
    vehicle_id: 'uuid',
    document_url: 'https://...',
    shop_name: 'Desert Performance'
  }
})
```

**What It Does:**
- Parses invoices with AI Vision
- Extracts parts, brands, prices, labor
- Indexes missing parts into catalog
- Learns pricing from real invoices
- Learns system organization patterns
- Learns labor patterns

---

### 3. **Wiring Quote Generator** 💰

**Location:** Vehicle Profile Page
- Below the Wiring Query Context Bar
- Also accessible via Edge Function

**Access:**
```
Vehicle Profile → Parts Quote Generator section
```

**What It Does:**
- Generates quotes for wiring systems
- Combines Motec + ProWire products
- Uses learned pricing from invoices
- Calculates labor based on learned patterns
- Marks products without prices as "quote required"

**Access via API:**
```typescript
const { data } = await supabase.functions.invoke('generate-wiring-quote', {
  body: {
    vehicle_id: 'uuid',
    suppliers: ['Motec', 'ProWire'],
    include_labor: true,
    labor_rate: 125.00
  }
})
```

---

### 4. **Natural Language Query Handler** 🗣️

**Location:** Edge Function (Backend)
- Function: `query-wiring-needs`
- Called automatically by Wiring Query Context Bar

**Access:**
- Automatically called when user submits query in context bar
- Can also be called directly via API

**What It Does:**
- Parses natural language queries
- Identifies vehicle context
- Determines intent (quote, recommendation, etc.)
- Queries catalog for relevant products
- Generates recommendations
- Calls quote generator
- Returns complete response

**Example:**
```
User: "I need a motec wiring for my 77 blazer"
System:
  1. Parses: 1977 Chevrolet Blazer, Motec ECU, wiring
  2. Finds vehicle in database
  3. Queries catalog → Finds 18 products
  4. Generates recommendations
  5. Generates quote → $4,517 total
  6. Returns complete response
```

---

## 📍 Quick Access Map

### For Users (Frontend)

1. **Vehicle Profile Page**
   - URL: `/vehicles/:id`
   - Section: "⚡ WIRING QUERY"
   - Component: `WiringQueryContextBar`
   - Action: Type query → Get quote

2. **Parts Quote Generator**
   - URL: `/vehicles/:id` (same page)
   - Section: "Parts Quote Generator"
   - Component: `PartsQuoteGenerator`
   - Action: View/manage quotes

### For Developers (Backend)

1. **Invoice Learning**
   - Script: `scripts/test-invoice-learning.js`
   - Function: `supabase/functions/learn-from-invoice/index.ts`
   - Migration: `supabase/migrations/20251207_invoice_learning_system.sql`

2. **Wiring Quote Generation**
   - Function: `supabase/functions/generate-wiring-quote/index.ts`
   - Uses: `invoice_learned_pricing`, `labor_patterns_learned`

3. **Natural Language Queries**
   - Function: `supabase/functions/query-wiring-needs/index.ts`
   - Uses: `generate-wiring-quote` internally

---

## 🔧 Database Tables

### Invoice Learning Tables

1. **`invoice_learned_pricing`**
   - Stores prices learned from invoices
   - Access: Via `generate-wiring-quote` (automatically used)

2. **`system_organization_patterns`**
   - Stores system groupings learned from invoices
   - Access: Via quote generator (for organization)

3. **`labor_patterns_learned`**
   - Stores labor patterns learned from invoices
   - Access: Via `generate-wiring-quote` (for accurate labor)

4. **`brand_supplier_mappings`**
   - Tracks brand-to-supplier relationships
   - Access: Via invoice learning function

### Catalog Tables

1. **`catalog_parts`**
   - All parts (catalog + invoice-learned)
   - Access: Via quote generator
   - Source: `source_type` = 'catalog' or 'invoice_learning'

2. **`catalog_sources`**
   - Catalog sources (Motec, ProWire, etc.)
   - Access: Via quote generator

---

## 🚀 Workflow Examples

### Example 1: User Wants Motec Wiring

1. **User Action:**
   - Goes to vehicle profile
   - Types in context bar: "I need a motec wiring harness for my vehicle"
   - Clicks QUOTE

2. **System Action:**
   - `query-wiring-needs` parses query
   - Finds vehicle context
   - Queries catalog for Motec + ProWire products
   - Generates recommendations
   - Calls `generate-wiring-quote`
   - Uses learned pricing (if available)
   - Uses learned labor patterns
   - Returns quote

3. **User Sees:**
   - Recommendations (MCM112 ECU, etc.)
   - Quote summary (parts, labor, total)
   - Next steps

### Example 2: Process Invoice to Learn Pricing

1. **User Action:**
   - Uploads Desert Performance invoice
   - Runs test script

2. **System Action:**
   - `learn-from-invoice` parses invoice
   - Extracts parts (M130, LTCD, sensors)
   - Extracts prices ($3,500, $844, $240)
   - Extracts labor (50 hours)
   - Indexes parts into catalog
   - Stores pricing in `invoice_learned_pricing`
   - Stores labor in `labor_patterns_learned`
   - Stores system organization

3. **Result:**
   - Future quotes use learned pricing
   - Labor estimates are accurate (50 hours, not 18!)
   - System knows how parts group together

---

## 📚 Documentation

### Component Documentation
- **Wireframe:** `docs/wireframes/WIRING_QUERY_CONTEXT_BAR.md`
- **System Overview:** `docs/systems/INVOICE_LEARNING_SYSTEM.md`
- **Natural Language Queries:** `docs/systems/NATURAL_LANGUAGE_WIRING_QUERIES.md`

### Code Files
- **Context Bar:** `nuke_frontend/src/components/wiring/WiringQueryContextBar.tsx`
- **Invoice Learning:** `supabase/functions/learn-from-invoice/index.ts`
- **Quote Generator:** `supabase/functions/generate-wiring-quote/index.ts`
- **Query Handler:** `supabase/functions/query-wiring-needs/index.ts`

---

## ✅ Status

- ✅ Wiring Query Context Bar: **Created & Integrated**
- ✅ Invoice Learning System: **Complete**
- ✅ Quote Generator: **Updated to use learned data**
- ✅ Natural Language Queries: **Functional**
- ✅ Documentation: **Complete**

**Everything is accessible and ready to use!**

