# Dealer Bulk Import System - Dropbox Integration

## 🎯 **Use Case: Viva! Las Vegas Autos**

**Problem:**
- Dealer turns & burns lots of cars (high volume)
- Each car has a "deal jacket" (folder of docs/photos)
- Manual upload per vehicle is too slow
- Need automated import from organized Dropbox

**Solution:**
- Connect Dropbox to Viva's organization
- Monitor specific folders for new deal jackets
- Auto-parse PDFs and images
- Create vehicle profiles automatically
- Populate dealer inventory with status/pricing

---

## 📁 **Expected Dropbox Structure**

```
/Viva Inventory/
├── /In Stock/
│   ├── /1977 K5 Blazer - #VIN123/
│   │   ├── title.pdf
│   │   ├── photos_exterior_001.jpg
│   │   ├── photos_exterior_002.jpg
│   │   ├── photos_interior_001.jpg
│   │   ├── purchase_invoice.pdf
│   │   └── inspection_report.pdf
│   ├── /1974 Bronco - #VIN456/
│   │   └── ...
├── /Consignment/
│   ├── /1965 Corvette - #VIN789/
│   │   ├── consignment_agreement.pdf
│   │   └── photos/
├── /Sold/
│   └── /Archive 2024/
└── /Service/
    └── /Customer Vehicles/
```

---

## 🤖 **Auto-Import Pipeline**

### **Step 1: Dropbox Webhook Listener**
**Edge Function:** `dropbox-webhook-handler`

**Triggers when:**
- New folder created in `/Viva Inventory/`
- Files added to existing folder
- Files modified

**Actions:**
1. Detect folder name format: `{Year} {Make} {Model} - #{VIN/ID}`
2. Parse folder name → extract vehicle info
3. Queue for processing

---

### **Step 2: Deal Jacket Parser**
**Edge Function:** `parse-deal-jacket`

**For each file in folder:**

#### **PDFs:**
- **Title**: Extract VIN, owner, lien holder → `vehicle_documents`
- **Purchase Invoice**: Extract cost, seller, date → `dealer_sales_transactions`
- **Consignment Agreement**: Extract owner, commission %, dates → `dealer_inventory`
- **Inspection Report**: Extract condition notes → `vehicle` metadata
- **Service Records**: Parse work done → `timeline_events`

#### **Images:**
- **Exterior photos**: Upload → `vehicle_images`, tag as `category: exterior`
- **Interior photos**: Upload → `vehicle_images`, tag as `category: interior`
- **Engine bay**: Upload, AI analyze for condition
- **Undercarriage**: Upload, check for rust/damage
- **VIN tag photo**: OCR to verify VIN

**AI Processing:**
- GPT-4 Vision + OCR for all documents
- Extract structured data (JSON)
- Confidence scoring

---

### **Step 3: Vehicle Profile Creation**
**Auto-creates:**

1. **Vehicle Record** (`vehicles` table)
   - VIN (from title or folder name)
   - Year, make, model (from folder name)
   - Owner info (from title)
   - Condition assessment (from AI)

2. **Dealer Inventory** (`dealer_inventory` table)
   - Status: `in_stock` | `consignment` | `maintenance`
   - Acquisition cost (from invoice)
   - Asking price (from pricing sheet or AI valuation)
   - Consignment % (from agreement)

3. **Documents** (`vehicle_documents` table)
   - All PDFs uploaded and linked
   - OCR text stored for search

4. **Images** (`vehicle_images` table)
   - All photos uploaded
   - EXIF extracted
   - AI tags applied

5. **Timeline Event** (`business_timeline_events`)
   - "1977 K5 Blazer added to inventory"
   - Links to Viva's timeline

---

## 💻 **Implementation**

### **Phase 1: Dropbox OAuth & File Access**

Create Dropbox app:
1. App Type: Scoped Access
2. Permissions: `files.metadata.read`, `files.content.read`
3. OAuth flow for Viva to authorize

**Tables:**
```sql
CREATE TABLE dropbox_connections (
  id UUID PRIMARY KEY,
  organization_id UUID REFERENCES businesses(id),
  access_token TEXT ENCRYPTED,
  refresh_token TEXT ENCRYPTED,
  root_folder TEXT, -- "/Viva Inventory"
  auto_import_enabled BOOLEAN DEFAULT TRUE,
  last_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### **Phase 2: Webhook Handler**

**Edge Function:** `supabase/functions/dropbox-webhook`
```typescript
Deno.serve(async (req) => {
  // Dropbox sends webhook when files change
  const { list_folder } = req.body;
  
  // For each new folder:
  // 1. Parse folder name → extract vehicle info
  // 2. Download all files
  // 3. Queue for AI processing
  // 4. Create vehicle + dealer inventory
});
```

### **Phase 3: Deal Jacket AI Parser**

**Edge Function:** `supabase/functions/parse-deal-jacket`
```typescript
interface DealJacket {
  folderName: string;
  files: {
    pdfs: string[];      // URLs to PDFs
    images: string[];    // URLs to images
  }
}

// AI Prompt:
"You are a car dealer admin assistant. Parse this deal jacket and extract:
1. Vehicle: VIN, year, make, model, trim, mileage, color
2. Acquisition: type (purchase/consignment/trade), cost, date, seller
3. Pricing: asking price, market value, condition notes
4. Documents: categorize each PDF (title, invoice, inspection, etc.)
5. Condition: overall rating, issues, repairs needed

Return structured JSON for database insertion."
```

### **Phase 4: Bulk Import UI**

**For Viva's organization page:**

```
┌─────────────────────────────────────────────────────────┐
│ 📁 Dropbox Auto-Import                                  │
│ ────────────────────────────────────────────────────── │
│ Status: ✅ Connected to Dropbox                         │
│ Folder: /Viva Inventory                                │
│ Last sync: 2 minutes ago                                │
│                                                         │
│ [⚙ Configure] [🔄 Sync Now] [📊 Import History]       │
│                                                         │
│ Recent Imports:                                         │
│ • 1977 K5 Blazer #VIN123 (5 min ago) ✅                │
│ • 1974 Bronco #VIN456 (1 hour ago) ✅                  │
│ • 1965 Corvette #VIN789 (2 hours ago) ⚠ Missing title │
└─────────────────────────────────────────────────────────┘
```

---

## 📊 **Data Flow**

```
Dropbox folder created
  ↓
Webhook notification
  ↓
Download files to temp storage
  ↓
AI parses PDFs + images
  ↓
Extract: VIN, vehicle info, docs, pricing
  ↓
Check if vehicle exists (by VIN)
  ├─ Exists: Update dealer_inventory
  └─ New: Create vehicle + dealer_inventory
  ↓
Upload images to vehicle profile
  ↓
Link documents
  ↓
Create timeline event
  ↓
Viva's profile updated automatically
```

---

## 🚀 **Next Steps**

### **Immediate (1-2 hours):**
1. Create Dropbox OAuth flow
2. Build `dropbox-webhook-handler` edge function
3. Build `parse-deal-jacket` edge function
4. Create UI for Dropbox connection

### **Testing:**
1. You authorize Viva's Dropbox
2. I monitor `/Viva Inventory/` folder
3. You create a test folder: `/Viva Inventory/In Stock/1977 K5 Test/`
4. Drop some photos + PDFs
5. System auto-creates vehicle profile

### **Production:**
- Bulk import existing Dropbox folders (backfill)
- Ongoing: Auto-sync new folders as they're created

---

## 💡 **Alternative: Manual Bulk Upload**

If Dropbox is complex, we can start with:

**Drag & Drop Folder Upload:**
```
1. User drags entire folder from desktop
2. System reads folder structure
3. Groups files by subfolder (each = one vehicle)
4. AI parses and creates profiles
5. Review screen before finalizing
```

Faster to implement, same result.

---

**Which approach?**
- Dropbox webhook (automated, ongoing)
- Manual folder drag-drop (quick start, one-time bulk)
- Both (manual for backfill, webhook for ongoing)

Tell me and I'll build it!

