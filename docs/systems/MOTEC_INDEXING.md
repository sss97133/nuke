# Motec Site Indexing

## 🎯 Overview

Motec.com is indexed as the **"nervous system"** of vehicle electrical systems. Their ECUs (Engine Control Units) are the computers that control and manage all wiring logic.

## 📋 What Gets Indexed

### Core Components:
- **ECUs** - Engine Control Units (the "brain" controlling wiring)
- **Software** - Configuration and tuning software
- **Displays** - Dashboard displays (C125, C1212, ADL series)
- **Sensors** - Temperature, pressure, position sensors
- **Accessories** - Cables, connectors, harnesses
- **Documentation** - Manuals, installation guides, technical reference

### Product Types:
- ECU kits (plug-in and standalone)
- Display systems
- Software packages
- Training materials
- Application notes

## 🚀 Usage

### Full Site Scrape:
```bash
node scripts/scrape-motec-entire-site.js
```

This will:
1. Scrape 39+ pages across the Motec site
2. Extract all products (ECUs, software, displays, etc.)
3. Store in `catalog_parts` table
4. Categorize by product type

### Edge Function:
```javascript
await supabase.functions.invoke('scrape-motec-catalog', {
  body: {
    url: 'https://www.motec.com/products',
    category_name: 'Products'
  }
});
```

## 📊 Database Structure

**Table:** `catalog_parts`
- `provider`: "Motec"
- `category`: Product type (ECU, Software, Display, etc.)
- `part_number`: Product SKU/code
- `name`: Product name
- `price_current`: Price in USD
- `application_data`: Additional metadata

## 🔗 Integration

Motec products are indexed alongside:
- **ProWire** - Wiring components (connectors, terminals, wire)
- **Service Manuals** - Factory documentation
- **Parts Catalogs** - OEM parts

Together, these form a complete electrical system knowledge base:
- **Motec ECUs** = The nervous system (control logic)
- **ProWire Components** = The wiring (physical connections)
- **Service Manuals** = The instructions (how to wire it)

## 🎯 Use Cases

1. **Wiring System Design:**
   - Query Motec ECUs for compatible wiring requirements
   - Find ProWire connectors that match ECU pinouts
   - Reference service manuals for installation

2. **Quote Generation:**
   - Calculate costs for complete electrical system
   - Include ECU, wiring components, and installation
   - Generate parts list with prices

3. **System Integration:**
   - Match ECU specifications to wiring requirements
   - Find compatible sensors and displays
   - Reference documentation for proper installation

## 📈 Current Status

**Indexed:**
- Products page: 29 products
- Software: 17 products
- Displays: 15+ products
- Downloads: 10 products
- Training: 5 products
- Homepage: 3 products

**Total:** 80+ products indexed

## 🔄 Maintenance

Run the scraper periodically to:
- Update product information
- Add new products
- Refresh prices
- Index new documentation

```bash
# Re-index entire site
node scripts/scrape-motec-entire-site.js
```

---

**Motec ECUs are the "nervous system" - they control the wiring logic and are essential for complete electrical system indexing.**

