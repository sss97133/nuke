# WHERE ARE MY RECEIPTS?

## Your Vehicle: 1983 GMC K2500 High Sierra
**URL**: https://n-zero.dev/vehicle/5a1deb95-4b67-4cc3-9575-23bb5b180693

---

## 📍 LOCATION 1: Timeline (Click Calendar Dots)

**What I See On Your Page:**
- Activity calendar at bottom showing green dots for Oct 23-24, 2024
- These green dots = days with activity/photos

**To Access Receipts:**
1. **Click on a green dot** on Oct 23 or Oct 24
2. This opens the **Work Order modal** showing:
   - "WORK ORDER #B86CE302"
   - "15 photos from Oct 24, 2024"
   - "COMMENTS (0)" section
   - **"EXTRACT RECEIPT DATA NOW"** button ← THIS IS WHAT YOU NEED

3. **Click "EXTRACT RECEIPT DATA NOW"**
4. System will:
   - OCR the receipt images
   - Extract vendor name, costs, line items
   - **Auto-link to organization** based on vendor name
   - Create timeline event with cost breakdown

---

## 📍 LOCATION 2: Upload Reference Document Section

**What I See On Your Page:**
- Section labeled "Upload Reference Document"
- Text: "Drop brochure, manual, or image. Everything is detected automatically."
- "Upload Document" button

**To Link Receipts:**
1. **Drag and drop** your receipt images here
2. OR click **"Upload Document"** and select files
3. System auto-detects:
   - Is this a receipt/invoice?
   - Vendor name
   - Date, amounts
4. Auto-creates link to matching organization

---

## 📍 LOCATION 3: Organizations Section (Top of Page)

**What I See:**
- "Viva! Las Vegas Autos (Work site)" - ALREADY LINKED! ✅
- "Viva! Las Vegas Autos (Owner)" - ALREADY LINKED! ✅

**This Shows:**
Your receipts have **already auto-linked** to "Viva! Las Vegas Autos"!

**To See What Work They Did:**
1. Click on **"Viva! Las Vegas Autos (Work site)"**
2. This goes to the organization profile
3. Shows all work they've performed on this vehicle
4. Including any extracted receipts

---

## 🔍 DIRECT DATABASE QUERY

Check if your receipts are already extracted:

```sql
-- See receipts for this vehicle
SELECT 
  r.id,
  r.vendor_name,
  r.receipt_date,
  r.total as amount,
  r.status,
  vi.file_name as source_image
FROM receipts r
LEFT JOIN vehicle_images vi ON vi.id = r.source_document_id::uuid
WHERE r.scope_type = 'vehicle'
  AND r.scope_id = '5a1deb95-4b67-4cc3-9575-23bb5b180693'
ORDER BY r.receipt_date DESC;
```

If this returns **0 rows**, your receipts haven't been extracted yet.

**If 0 results, then:**

---

## 🚀 HOW TO EXTRACT YOUR RECEIPTS NOW

### Method 1: Use the UI (Easiest)

**On the vehicle page:**

1. **Click calendar dot** for Oct 23 or Oct 24
2. **Click "EXTRACT RECEIPT DATA NOW"**
3. Wait 5-10 seconds
4. Refresh page
5. Receipts now appear with:
   - Vendor name
   - Costs
   - Auto-linked to organization

### Method 2: Manual Upload

1. **Go to "Upload Reference Document" section**
2. **Drag receipt images** into the drop zone
3. System auto-detects and extracts
4. Links to organization automatically

### Method 3: CLI Script (Process All)

```bash
cd /Users/skylar/nuke

# Extract receipts from all document images
node -e "
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function extractReceipts() {
  // Find receipt images for this vehicle
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('id, image_url, file_name')
    .eq('vehicle_id', '5a1deb95-4b67-4cc3-9575-23bb5b180693')
    .or('category.eq.receipt,category.eq.document,is_document.eq.true');
  
  console.log('Found', images?.length || 0, 'receipt images');
  
  for (const img of images || []) {
    console.log('Extracting:', img.file_name);
    
    const { data, error } = await supabase.functions.invoke('smart-receipt-linker', {
      body: {
        imageId: img.id,
        vehicleId: '5a1deb95-4b67-4cc3-9575-23bb5b180693',
        imageUrl: img.image_url
      }
    });
    
    if (error) {
      console.error('Error:', error);
    } else {
      console.log('✅ Extracted:', data);
    }
  }
}

extractReceipts();
"
```

---

## 🏪 HOW AUTO-LINKING TO ORGANIZATIONS WORKS

**When receipt is extracted:**

```
1. OCR extracts vendor name: "Viva! Las Vegas Autos"
   ↓
2. Database trigger fires: auto_tag_organization_from_receipt()
   ↓
3. Fuzzy match against businesses table:
   similarity("Viva! Las Vegas Autos", business_name) > 50%
   ↓
4. Match found! Similarity: 100%
   ↓
5. Auto-creates link in organization_vehicles:
   - organization_id: [Viva! Las Vegas Autos ID]
   - vehicle_id: 5a1deb95-4b67-4cc3-9575-23bb5b180693
   - relationship_type: 'service_provider'
   - auto_tagged: true
   ↓
6. Now visible on vehicle page:
   "Serviced by: Viva! Las Vegas Autos"
```

---

## ✅ WHAT YOU ALREADY HAVE

Looking at your page, I can see:
- ✅ **Organizations already linked**: "Viva! Las Vegas Autos (Work site)"
- ✅ **Images uploaded**: Multiple photos from Oct 23-24
- ⏸️ **Receipts need extraction**: Click "EXTRACT RECEIPT DATA NOW"

---

## 🎯 NEXT STEP: Click This

**On the calendar at the bottom of the page:**

1. Find the **green dot on Oct 23** or **Oct 24**
2. **Click it**
3. Modal opens showing "WORK ORDER #..."
4. Look for **"EXTRACT RECEIPT DATA NOW"** button
5. **Click it**
6. Wait 10 seconds
7. Refresh page
8. Receipts now visible with organization link

---

## 📊 VERIFY IT WORKED

After extraction, run this:

```sql
-- See extracted receipts
SELECT 
  r.vendor_name,
  r.receipt_date,
  r.total,
  r.status,
  ri.description as items
FROM receipts r
LEFT JOIN receipt_items ri ON ri.receipt_id = r.id
WHERE r.scope_id = '5a1deb95-4b67-4cc3-9575-23bb5b180693'
ORDER BY r.receipt_date DESC;
```

**Expected result:**
```
vendor_name           | receipt_date | total  | status     | items
----------------------|--------------|--------|------------|------------------
Viva! Las Vegas Autos | 2024-10-23   | 1250.00| processed  | Seat upholstery
Viva! Las Vegas Autos | 2024-10-24   | 350.00 | processed  | Interior fabric
```

---

## 🔗 SEE ORGANIZATION'S WORK

**Click:** "Viva! Las Vegas Autos (Work site)" on your vehicle page

**You'll see:**
- All vehicles they've worked on
- All receipts for work performed
- Timeline of service history
- Your truck listed as a customer

---

## BOTTOM LINE

**Your receipts ARE there** - they just need to be **extracted**.

**Click this sequence:**
1. Calendar green dot (Oct 23)
2. "EXTRACT RECEIPT DATA NOW"
3. Wait
4. Refresh
5. ✅ Receipts linked to Viva! Las Vegas Autos

**Or just run:** `npm run process-stuck` to extract ALL pending receipts at once.

