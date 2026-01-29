# ProWire USA Catalog Indexing

## 🎯 Goal

Index Deutsch connector products from prowireusa.com to enable:
- **Instant wiring quotes** - Auto-generate quotes with part numbers and prices
- **Wiring job estimates** - Calculate costs for wiring projects
- **Part lookup** - Find connectors by part number or application

---

## 🔧 Why Firecrawl (Not Mendable)

### Firecrawl Advantages:
✅ **Structured extraction** - Can extract products with schemas  
✅ **Direct scraping** - Scrapes product pages directly  
✅ **Product data** - Extracts part numbers, prices, descriptions  
✅ **Already integrated** - We use Firecrawl for LMC catalog  
✅ **Stores in our DB** - Products go into `catalog_parts` table  

### Mendable.dev Limitations:
❌ **Search/discovery tool** - Better for finding content, not extracting products  
❌ **Not structured** - Doesn't extract product data into our schema  
❌ **Query-based** - Requires queries, not bulk catalog indexing  

**Verdict:** Use **Firecrawl** for catalog indexing.

---

## 📋 Catalog URLs to Index

1. **Deutsch Kit Builder**
   - URL: `https://www.prowireusa.com/deutsch-kit-builder.html`
   - Type: Assembly manual/configurator

2. **Deutsch DT Series Heat Shrink Boots**
   - URL: `https://www.prowireusa.com/content/9660/Deutsch%20DT%20Series%20Heat%20Shrink%20Boots`
   - Type: Product category

3. **Deutsch DTM Rubber Boots**
   - URL: `https://www.prowireusa.com/deutsch-dtm-rubber-boots`
   - Type: Product category

4. **Deutsch DT Rubber Boots**
   - URL: `https://www.prowireusa.com/deutsch-dt-rubber-boots`
   - Type: Product category

5. **Deutsch DTP Rubber Boots**
   - URL: `https://www.prowireusa.com/deutsch-dtp-rubber-boots`
   - Type: Product category

6. **Homepage** (for discovering all categories)
   - URL: `https://www.prowireusa.com/`
   - Type: Catalog index

---

## 🚀 Usage

### Option 1: Script (Recommended)
```bash
# Scrape specific catalog URLs
node scripts/scrape-prowire-catalog.js

# Crawl all product pages from homepage
node scripts/scrape-prowire-catalog.js --all
```

### Option 2: Edge Function
```javascript
// Scrape a single category
await supabase.functions.invoke('scrape-prowire-catalog', {
  body: {
    url: 'https://www.prowireusa.com/deutsch-dt-rubber-boots',
    category_name: 'Deutsch DT Rubber Boots'
  }
});
```

---

## 📊 What Gets Extracted

### Product Data:
- **Part Number** - DT-123, DTM-456, DTP-789, etc.
- **Name** - Product name/title
- **Price** - USD price
- **Description** - Product description
- **Image URL** - Product image
- **Category** - Wiring, connectors, boots, etc.
- **Stock Status** - In stock / out of stock

### Storage:
- Stored in `catalog_parts` table
- Linked to `catalog_sources` (provider: "ProWire")
- Category: "wiring"
- Application data includes supplier info

---

## 🔄 Integration with Wiring Quotes

### Use Case: Generate Wiring Quote

```typescript
// User uploads wiring diagram image
// AI identifies: "Need 4x DT-06-2S connectors, 2x DTM-06-2S boots"

// System queries indexed catalog:
const connectors = await supabase
  .from('catalog_parts')
  .select('*')
  .in('part_number', ['DT-06-2S', 'DTM-06-2S'])
  .eq('category', 'wiring');

// Generate quote:
const quote = {
  parts: connectors.map(c => ({
    part_number: c.part_number,
    name: c.name,
    quantity: getQuantityFromDiagram(c.part_number),
    price: c.price_current,
    total: c.price_current * getQuantityFromDiagram(c.part_number)
  })),
  total: connectors.reduce((sum, c) => 
    sum + (c.price_current * getQuantityFromDiagram(c.part_number)), 0
  )
};
```

---

## 🎯 Next Steps

1. **Run the scraper:**
   ```bash
   node scripts/scrape-prowire-catalog.js
   ```

2. **Verify products stored:**
   ```sql
   SELECT COUNT(*) FROM catalog_parts 
   WHERE catalog_id IN (
     SELECT id FROM catalog_sources WHERE provider = 'ProWire'
   );
   ```

3. **Test wiring quote generation:**
   - Upload wiring diagram
   - AI identifies needed connectors
   - System generates quote from indexed products

4. **Expand to other wiring suppliers:**
   - Waytek Wire
   - Del City
   - Painless Performance
   - etc.

---

## 📈 Scaling to Thousands of Products

The robust indexing script (`index-all-documents-robust.js`) can be adapted for web catalog scraping:

1. **Create catalog source** for each supplier
2. **Scrape product pages** with Firecrawl
3. **Extract products** using schemas or HTML parsing
4. **Store in catalog_parts** with retries and error handling
5. **Update prices** periodically

**This enables instant quotes for any indexed wiring catalog!**

