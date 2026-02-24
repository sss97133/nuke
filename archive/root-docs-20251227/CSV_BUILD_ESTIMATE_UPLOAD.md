# 📊 CSV Build Estimate - Where to Upload

## ✅ **DEPLOYED TO PRODUCTION**

**New URL**: https://nuke-r6xijxhud-nuke.vercel.app  
**Main URL**: https://nuke.ag (updates in 2-3 min)

**Changes live:**
- ✅ UnifiedWorkOrderReceipt (new modal)
- ✅ Security fixes (false ownership removed)
- ✅ AI status fixes ("pending" → "analyzed")

---

## 📍 **WHERE TO DROP YOUR CSV**

### **OPTION 1: Vehicle Page → Upload Reference Document** ⭐ RECOMMENDED

**Navigate to:**
```
https://nuke.ag/vehicle/5a1deb95-4b67-4cc3-9575-23bb5b180693
```

**Find section:**
- Scroll down to "Upload Reference Document"
- Text says: "Drop brochure, manual, or image. Everything is detected automatically."

**Drop your CSV:**
1. Drag `build-estimate.csv` into the drop zone
2. **OR** click "Upload Document" and select file
3. System auto-detects: "This is a build estimate CSV"
4. Parses columns: part, supplier, cost, quantity
5. Creates `vehicle_builds` record
6. Imports all line items
7. Links to suppliers (Taylor Customs, Ernies, etc.)

---

### **OPTION 2: Header Search → Paste CSV Text**

**At top of any page:**
- Click textbox: "VIN, URL, text..."
- **Paste entire CSV content** (Cmd+V)
- Click "GO"
- AI router detects CSV format
- Routes to build import service

---

### **OPTION 3: Dealer AI Assistant** (If you have org access)

**Navigate to:**
```
https://nuke.ag/dealer-ai-assistant/[your-org-id]
```

**Drop CSV:**
- Drag file into chat interface
- AI processes and routes data
- Creates build records

---

## 📋 **CSV FORMAT (Your Build Estimate)**

**Expected columns:**
```csv
category,name,supplier,cost,quantity,notes
Paint,Base/Clear Coat,Taylor Customs,1200,1,Custom two-tone
Labor,Paint Labor,Taylor Customs,3200,80,80hrs @ $40/hr
Upholstery,Seat Reupholstery,Ernies Upholstery,850,1,Custom fabric
Engine,LS3 Crate,Chevrolet,8500,1,376ci 430hp
```

**Flexible headers** (auto-normalized):
- `Part` / `part` / `PART` → all work
- `Supplier` / `vendor` / `VENDOR` → all work
- `Cost` / `price` / `investment` / `total` → all work
- `Quantity` / `qty` / `QTY` → all work

**System handles:**
- ✅ Different column names (auto-maps)
- ✅ Currency symbols ($1,200 → 1200)
- ✅ Empty cells (uses defaults)
- ✅ Extra columns (ignores unknown)

---

## 🤖 **WHAT HAPPENS AFTER UPLOAD:**

```
1. CSV Uploaded
   ↓
2. BuildImportService.parseCSV(content)
   ↓
3. Parses rows → BuildLineItemImport[]
   ↓
4. Creates vehicle_builds record:
   - name: "Initial Build Estimate"
   - status: "in_progress"
   - vehicle_id: 5a1deb95-4b67-4cc3-9575-23bb5b180693
   ↓
5. For each line item:
   - Creates build_line_items record
   - Links to supplier (creates if new)
   - Maps to part_category
   - Stores cost, quantity, notes
   ↓
6. Auto-attributes to organizations:
   - "Taylor Customs" in supplier → Links to Taylor org
   - "Ernies Upholstery" → Links to Ernies org
   - Creates work_order_collaborators records
   ↓
7. Updates vehicle valuation:
   - Total build cost calculated
   - Shown in forensic valuation
   - Evidence: "Build estimate CSV"
   - Confidence: 75% (estimate, not receipts)
```

---

## 🎯 **TEST IT NOW:**

1. **Hard refresh** vehicle page: `Cmd+Shift+R`
2. **Find "Upload Reference Document"** section
3. **Drop your `build-estimate.csv`** file
4. **Watch it process** (should take 5-10 seconds)
5. **Check results:**
   - Build tab shows line items
   - Costs appear in valuation
   - Suppliers linked to organizations

---

## 📊 **VERIFY IT WORKED:**

```sql
-- See imported build data
SELECT 
  vb.name as build_name,
  COUNT(bli.id) as line_items,
  SUM(bli.total_cost) as total_cost
FROM vehicle_builds vb
LEFT JOIN build_line_items bli ON bli.build_id = vb.id
WHERE vb.vehicle_id = '5a1deb95-4b67-4cc3-9575-23bb5b180693'
GROUP BY vb.id, vb.name;

-- See supplier attribution
SELECT 
  bli.description,
  s.name as supplier,
  bli.total_cost,
  b.business_name as linked_org
FROM build_line_items bli
JOIN suppliers s ON s.id = bli.supplier_id
LEFT JOIN businesses b ON b.business_name ILIKE '%' || s.name || '%'
WHERE bli.build_id IN (
  SELECT id FROM vehicle_builds 
  WHERE vehicle_id = '5a1deb95-4b67-4cc3-9575-23bb5b180693'
);
```

---

## 🔧 **IF UPLOAD FAILS:**

Use direct import script:

```bash
# Save your CSV as: /Users/skylar/nuke/data/build-estimate.csv

cd /Users/skylar/nuke
node -e "
const fs = require('fs');
const { BuildImportService } = require('./nuke_frontend/src/services/buildImportService.ts');

const csvContent = fs.readFileSync('./data/build-estimate.csv', 'utf8');
const items = await BuildImportService.parseCSV(csvContent);
await BuildImportService.importBuildData(
  '5a1deb95-4b67-4cc3-9575-23bb5b180693',
  'Initial Build Estimate',
  items
);
console.log('✅ Imported', items.length, 'line items');
"
```

---

**DROP YOUR CSV IN "Upload Reference Document" SECTION AND IT WILL AUTO-PROCESS.**

**Production is deployed. Hard refresh to see new UI.**
