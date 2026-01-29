# Natural Language Wiring Queries

## 🎯 What Happens When Someone Says:

### **"I need a motec wiring for my 77 blazer"**

---

## 📋 Step-by-Step Process

### Step 1: Query Parsing
**AI analyzes the query:**
- Extracts vehicle: **1977 Chevrolet Blazer**
- Identifies need: **Motec ECU + wiring components**
- Determines intent: **Quote**

**Parsed Result:**
```json
{
  "vehicle": {
    "year": 1977,
    "make": "Chevrolet",
    "model": "Blazer"
  },
  "needs": {
    "motec_ecu": true,
    "wiring_components": true,
    "connectors": true
  },
  "intent": "quote"
}
```

### Step 2: Vehicle Lookup
- Finds or creates vehicle context: **1977 Chevrolet Blazer**
- Links to vehicle_id if exists in database

### Step 3: Catalog Query
**Searches indexed catalogs:**
- **Motec products:** ECUs, software, displays
- **ProWire products:** Connectors, terminals, wire

**Found:** 18 relevant products

### Step 4: AI Recommendations
**Generates recommendations:**
- **MCM112 Plug-In ECU Kit** ⭐ (Required)
- **Wiring components** (DTM connectors, boots, etc.)
- **System description:** Complete Motec wiring system

### Step 5: Quote Generation
**Calls `generate-wiring-quote`:**
- Combines Motec + ProWire products
- Calculates labor (18 hours @ $125/hr = $2,250)
- Marks products without prices as "quote required"
- Generates complete quote

### Step 6: Response
**Returns:**
- Vehicle context
- Product recommendations
- System description
- Complete quote with pricing
- Next steps

---

## 📊 Example Response

```json
{
  "query": "I need a motec wiring for my 77 blazer",
  "vehicle": {
    "year": 1977,
    "make": "Chevrolet",
    "model": "Blazer"
  },
  "recommendations": [
    {
      "part_number": "MCM112",
      "name": "MCM112 Plug-In ECU Kit",
      "reason": "Plug-in ECU kit perfect for 1977 Blazer",
      "required": true,
      "category": "ECU"
    }
  ],
  "products_found": 18,
  "quote": {
    "parts": [...],
    "pricing": {
      "parts_subtotal": 17.38,
      "parts_with_prices": 6,
      "parts_quote_required": 12,
      "labor_hours": 18,
      "labor_total": 2250.00,
      "grand_total": 2267.38
    }
  },
  "next_steps": [
    "Review recommended products",
    "Request quote for Motec products",
    "Order ProWire components",
    "Schedule installation (18 hours)"
  ]
}
```

---

## 🎯 What The User Gets

1. **Vehicle-Specific Recommendations:**
   - Motec ECU for their 1977 Blazer
   - Compatible wiring components
   - Complete system description

2. **Complete Quote:**
   - Parts with prices (ProWire: $17.38)
   - Parts requiring quote (Motec: 12 items)
   - Labor estimate (18 hours = $2,250)
   - Grand total: $2,267.38

3. **Clear Next Steps:**
   - What to review
   - What needs quote
   - What can be ordered now
   - Installation timeline

---

## ✅ System Capabilities

**The system can now handle:**
- ✅ Natural language queries
- ✅ Vehicle identification from query
- ✅ Product recommendations
- ✅ Quote generation
- ✅ Multi-supplier integration (Motec + ProWire)
- ✅ Products with/without prices

**Example queries that work:**
- "I need a motec wiring for my 77 blazer"
- "What wiring do I need for a 1977 Blazer with Motec ECU?"
- "Quote me a complete wiring system for my 77 Chevy"
- "I need Motec ECU and wiring for my 1977 Blazer"

---

## 🔗 Integration Points

1. **Query Handler:** `query-wiring-needs` edge function
2. **Quote Generator:** `generate-wiring-quote` edge function
3. **Catalog:** `catalog_parts` table (Motec + ProWire)
4. **Vehicle Data:** `vehicles` table

---

**The system is now fully functional for natural language wiring queries!**

