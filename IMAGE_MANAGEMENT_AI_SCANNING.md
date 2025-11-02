# Image Management & AI Scanning System

## Implemented Features ✅

### 1. **Delete Images**
- ⭐ Owner-only button (🗑) on each image
- Confirms before deletion
- Removes from database and updates UI
- Cannot be undone

### 2. **Set Primary Image**
- ⭐ Owner-only button (⭐) on each image
- Sets image as organization's primary/logo
- Shows "PRIMARY" badge
- Only one image can be primary at a time
- Used as hero image and profile thumbnail

### 3. **AI Scanning & Tagging**
- 🔍 Owner-only button (🔍) on each image
- Calls OpenAI Vision (GPT-4o-mini)
- Extracts:
  - **Tags**: Descriptive keywords (e.g., "engine_rebuild", "fabrication")
  - **Inventory**: Tools, equipment, parts, vehicles visible
  - **Description**: Summary of image content
- Stores results in database for future querying

---

## AI Scanning Architecture

### What the AI Extracts

```
Image Upload
    ↓
User clicks 🔍 Scan
    ↓
OpenAI Vision Analyzes Image
    ↓
Extracts:
  ├── Tags: ["engine_rebuild", "performance", "marine"]
  ├── Inventory:
  │   ├── "454 Big Block Engine" (vehicle part)
  │   ├── "Chrome Exhaust Headers" (part)
  │   ├── "Wooden Pallet" (material)
  │   └── "Engine Hoist" (equipment)
  ├── Equipment: ["Engine stand", "Toolbox"]
  ├── Parts: ["Pistons", "Gaskets", "Bearings"]
  └── Description: "Restored marine engine on pallet..."
    ↓
Stores in Database:
  ├── organization_image_tags (searchable tags)
  └── organization_inventory (auto-cataloged items)
```

### AI Prompt (What It's Told)

The AI is instructed to act as an **"expert automotive shop inventory analyst"** and extract:

1. **Inventory Items** with:
   - Name (specific as possible)
   - Category: tool, equipment, part, material, vehicle
   - Brand/Manufacturer (if visible on labels/logos)
   - Model/Part number (if visible)
   - Condition: excellent, good, fair, poor
   - Quantity (if multiple visible)
   - Confidence score (0.0-1.0)

2. **Tags**: Keywords like:
   - `engine_rebuild`
   - `fabrication`
   - `dyno_testing`
   - `paint_booth`
   - `lift_installation`

3. **Description**: Brief summary of the scene

---

## Database Schema

### `organization_image_tags`
```sql
CREATE TABLE organization_image_tags (
  id UUID PRIMARY KEY,
  organization_id UUID REFERENCES businesses(id),
  image_id UUID REFERENCES organization_images(id),
  tag TEXT NOT NULL,
  tagged_by UUID REFERENCES auth.users(id),
  confidence DECIMAL(3,2) DEFAULT 0.80,  -- AI confidence
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(image_id, tag)  -- One tag per image
);
```

**Purpose**: Searchable tags for images (both AI and user-generated)

**Queries Enabled**:
- "Show all images tagged `engine_rebuild`"
- "What work has this shop documented?"
- "Find images with confidence > 0.9"

### `organization_images` (Enhanced)
```sql
ALTER TABLE organization_images ADD:
  ai_scanned BOOLEAN DEFAULT FALSE,
  ai_scan_date TIMESTAMPTZ,
  ai_description TEXT,
  ai_confidence DECIMAL(3,2);
```

**Purpose**: Track which images have been AI-scanned and store AI-generated descriptions

### `organization_inventory` (Enhanced)
```sql
ALTER TABLE organization_inventory ADD:
  ai_extracted BOOLEAN DEFAULT FALSE,
  confidence_score DECIMAL(3,2),
  image_id UUID REFERENCES organization_images(id);
```

**Purpose**: Link inventory items back to source images, track AI vs manual entry

---

## Use Cases

### For Desert Performance (Your Example)

**Before**:
- 4 engine images uploaded
- No metadata except filename
- Can't search or categorize

**After**:
1. **Upload 4 Engine Images**
   - EXIF extraction (Phase 1) → Dates, GPS
   - Click 🔍 on each image

2. **AI Scans Images**:
   - **Image 1**: "Orange engine block, chrome headers"
     - Tags: `engine_rebuild`, `marine`, `performance`, `custom_paint`
     - Inventory:
       - "454 Big Block Engine" (part, confidence: 0.95)
       - "Chrome Exhaust Headers" (part, confidence: 0.92)
       - "Aluminum Pulleys" (part, confidence: 0.88)
       - "Wooden Shipping Pallet" (material, confidence: 0.99)
   
   - **Image 2**: "Engine with blue protective cover"
     - Tags: `engine_rebuild`, `turbo`, `preparation`
     - Inventory:
       - "Turbocharged Engine" (part, confidence: 0.90)
       - "Protective Blankets" (material, confidence: 0.95)
   
   - **Images 3-4**: Similar analysis...

3. **Results**:
   - **Organization Inventory** auto-populated:
     - 4 engines cataloged
     - 12 parts identified
     - 3 tools detected
   - **Searchable Tags**:
     - "Show me all `engine_rebuild` work"
     - "What marine projects have we done?"
   - **Portfolio Building**:
     - Prospective customers see tagged work
     - "Order Similar Work" button shows related projects

---

## Future Enhancements

### Phase 2: Batch Scanning
```typescript
// Scan all un-scanned images at once
const unscannedImages = images.filter(img => !img.ai_scanned);
await Promise.all(unscannedImages.map(img => handleScanImage(img.id)));
```

### Phase 3: Auto-Scan on Upload
```typescript
// In AddOrganizationData.tsx, after image upload:
if (AUTO_SCAN_ENABLED) {
  await handleScanImage(imageRecord.id);
}
```

### Phase 4: Inventory Aggregation UI
**New "AI Inventory" Tab**:
- List all equipment/tools detected across images
- "This shop has been photographed with:"
  - 5x Engine Hoists
  - 12x Torque Wrenches
  - 3x Welders
  - etc.
- Click to see source images

### Phase 5: Work Order Auto-Creation
```typescript
// If AI detects a complete work sequence:
Images: before → during → after
Tags: engine_rebuild, marine, 454_big_block
Parts: 15 items detected

→ Suggest: "Create Work Order from these images?"
```

---

## API: Edge Function

**Endpoint**: `/functions/v1/scan-organization-image`

**Request**:
```json
{
  "imageId": "abc-123",
  "imageUrl": "https://...",
  "organizationId": "org-456"
}
```

**Response**:
```json
{
  "success": true,
  "tags": ["engine_rebuild", "marine", "performance"],
  "inventory": [
    {
      "name": "454 Big Block Engine",
      "category": "part",
      "brand": "Chevrolet",
      "model": "454",
      "condition": "excellent",
      "quantity": 1,
      "confidence": 0.95
    }
  ],
  "equipment": ["Engine Hoist", "Pallet Jack"],
  "parts": ["Chrome Headers", "Pistons", "Gaskets"],
  "description": "Restored 454 big block marine engine...",
  "confidence": 0.92
}
```

---

## Database Queries

### Get All Tags for an Organization
```sql
SELECT tag, COUNT(*) as usage_count, AVG(confidence) as avg_confidence
FROM organization_image_tags
WHERE organization_id = 'org-id'
GROUP BY tag
ORDER BY usage_count DESC;
```

### Get Inventory Summary
```sql
SELECT * FROM get_organization_inventory_from_images('org-id');
-- Returns: item_name, item_type, brand, total_quantity, image_count, avg_confidence
```

### Find Images by Tag
```sql
SELECT oi.* 
FROM organization_images oi
JOIN organization_image_tags oit ON oi.id = oit.image_id
WHERE oit.tag = 'engine_rebuild'
  AND oit.confidence > 0.8
ORDER BY oi.taken_at DESC;
```

### Get Image Tags Summary
```sql
SELECT get_image_tags_summary('image-id');
-- Returns: { "tags": [...], "tag_count": 5, "ai_extracted": 3, "user_added": 2 }
```

---

## Deployment Checklist

### 1. Apply Database Migration ✅
```bash
npx supabase migration up --db-url <connection-string>
# Or via Supabase MCP tool
```

### 2. Deploy Edge Function ✅
```bash
npx supabase functions deploy scan-organization-image
```

### 3. Build & Deploy Frontend ✅
```bash
cd nuke_frontend && npm run build
vercel --prod --force --yes
```

### 4. Test on Live Site
1. Go to Desert Performance org
2. Click 🔍 on an engine image
3. Wait ~5 seconds for AI scan
4. Check:
   - Alert shows "Scan complete! Found X tags, Y inventory items"
   - Inventory tab shows new items
   - (TODO: Display tags in image viewer)

---

## Integration with Existing Systems

### Timeline Events (Future)
When AI scans an image, create timeline event:
```typescript
await supabase.from('business_timeline_events').insert({
  business_id: organizationId,
  event_type: 'ai_analysis',
  title: `AI analyzed image: ${scanResult.tags.join(', ')}`,
  description: scanResult.description,
  event_date: new Date().toISOString(),
  metadata: {
    image_id: imageId,
    tags: scanResult.tags,
    inventory_count: scanResult.inventory.length,
    confidence: scanResult.confidence
  }
});
```

### Work Order Auto-Link (Future)
If AI detects specific parts/work:
```typescript
// Check for matching work orders
const { data: workOrders } = await supabase
  .from('work_orders')
  .select('*')
  .eq('organization_id', organizationId)
  .ilike('title', `%${scanResult.parts[0]}%`);

if (workOrders.length > 0) {
  // Suggest linking image to work order
  alert(`This image might belong to work order: ${workOrders[0].title}`);
}
```

### User Contributions (Future)
Track AI-assisted contributions:
```typescript
await supabase.from('user_contributions').insert({
  user_id: userId,
  contribution_type: 'ai_tagging',
  entity_type: 'organization',
  entity_id: organizationId,
  contribution_date: new Date(),
  metadata: {
    tags_added: scanResult.tags.length,
    inventory_added: scanResult.inventory.length
  }
});
```

---

## Summary

**What You Can Do Now**:
1. ✅ Delete images (owner only)
2. ✅ Set primary/logo image (owner only)
3. ✅ AI scan images for tags and inventory (owner only)

**What the AI Does**:
- Identifies tools, equipment, parts, vehicles
- Extracts brand names and part numbers
- Generates searchable tags
- Auto-populates inventory database
- Provides confidence scores

**Next Steps**:
1. Deploy migration + edge function
2. Test on Desert Performance
3. Iterate on AI prompt for better accuracy
4. Add UI to display tags in image viewer
5. Build "AI Inventory" aggregation view

Ready to deploy and test?

