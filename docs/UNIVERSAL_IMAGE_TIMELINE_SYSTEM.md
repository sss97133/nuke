# Universal Image Timeline System
## Multi-Entity Timeline Propagation Architecture

## Overview
Every image upload creates a **cascading timeline event** across all related entities (User, Organization, Vehicle/Work Order), with EXIF data extraction driving authentic chronological documentation.

---

## Core Architecture

### 1. Image Processing Pipeline

```
Image Upload
    ↓
EXIF Extraction (imageMetadata.ts)
    ↓
Storage (Supabase Storage)
    ↓
Database Record Creation
    ↓
Timeline Event Cascade ← NEW
```

### 2. Timeline Event Cascade Logic

When a user uploads images to **any entity**, create timeline events for:

1. **User Profile** (`user_contributions`)
   - "Uploaded 5 images to [Entity Name]"
   - Builds user's work portfolio
   - Shows where they contribute

2. **Organization Profile** (`business_timeline_events`)
   - "Work documented: [Category]"
   - Shows shop activity feed
   - Demonstrates capabilities

3. **Asset Profile** (Vehicle or Work Order)
   - **Vehicle**: `vehicle_timeline_events`
   - **Work Order**: `work_order_timeline_events` ← NEW TABLE
   - Shows work progress/history

---

## Implementation Strategy

### Phase 1: Extend Organization Image Upload (Current)

**File**: `/nuke_frontend/src/components/organization/AddOrganizationData.tsx`

**Current Flow**:
```typescript
// Upload images → organization_images table
// NO timeline events created ❌
```

**New Flow**:
```typescript
// 1. Extract EXIF from images
const metadata = await extractImageMetadata(file);

// 2. Upload to storage
const { publicUrl } = await uploadToStorage(file);

// 3. Create organization_images record
const imageRecord = await createImageRecord({
  organization_id,
  image_url: publicUrl,
  taken_at: metadata.dateTaken,
  latitude: metadata.location?.latitude,
  longitude: metadata.location?.longitude,
  exif_data: metadata
});

// 4. CASCADE: Create timeline events
await createTimelineEventCascade({
  entity_type: 'organization',
  entity_id: organization_id,
  user_id: currentUser.id,
  images: [imageRecord],
  event_date: metadata.dateTaken || new Date()
});
```

---

### Phase 2: Work Order System (New Concept)

#### Problem Statement
**Shop workflows:**
- Customer brings engine/component
- Shop documents restoration work
- Work deserves its own "profile" (like a vehicle)
- Eventually links to vehicle IF it gets installed

**Use Cases:**
1. **Boat engine rebuild** (Desert Performance example)
   - 4 images of orange engine on pallet
   - Not yet linked to a vehicle
   - Customer can share work order link
   - Prospective customers can browse completed work

2. **Transmission overhaul**
   - Documented from disassembly → rebuild → testing
   - Timeline shows progress
   - Eventually installed in vehicle = linked

3. **Custom fabrication**
   - Shop documents one-off parts
   - Becomes a "portfolio piece"
   - Other customers can order same work

#### Database Schema

**New Table**: `work_orders`
```sql
CREATE TABLE work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES businesses(id) NOT NULL,
  
  -- Work Order Identity
  work_order_number TEXT UNIQUE, -- e.g., "WO-2024-001"
  title TEXT NOT NULL, -- e.g., "454 Big Block Marine Engine Rebuild"
  description TEXT,
  category TEXT, -- engine, transmission, suspension, fabrication, paint, etc.
  
  -- Customer (optional - may be internal R&D)
  customer_id UUID REFERENCES auth.users(id),
  customer_name TEXT, -- If not registered user
  
  -- Status
  status TEXT DEFAULT 'quoted', -- quoted, in_progress, completed, invoiced, cancelled
  priority TEXT DEFAULT 'normal', -- rush, normal, low
  
  -- Dates
  quoted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  due_date DATE,
  
  -- Financial
  quoted_amount DECIMAL(10,2),
  actual_cost DECIMAL(10,2),
  labor_hours DECIMAL(8,2),
  
  -- Linkage (optional)
  vehicle_id UUID REFERENCES vehicles(id), -- NULL until installed
  linked_at TIMESTAMPTZ, -- When installed
  
  -- Visibility
  is_public BOOLEAN DEFAULT true, -- Show in shop portfolio?
  is_template BOOLEAN DEFAULT false, -- Can customers order this?
  
  -- Metadata
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Work Order Images
CREATE TABLE work_order_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  large_url TEXT,
  thumbnail_url TEXT,
  category TEXT, -- before, during, after, detail, testing
  caption TEXT,
  taken_at TIMESTAMPTZ,
  latitude NUMERIC,
  longitude NUMERIC,
  exif_data JSONB,
  uploaded_by UUID REFERENCES auth.users(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Work Order Timeline
CREATE TABLE work_order_timeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  event_type TEXT NOT NULL, -- status_change, image_upload, note, part_ordered, etc.
  title TEXT NOT NULL,
  description TEXT,
  event_date TIMESTAMPTZ NOT NULL,
  cost_amount DECIMAL(10,2),
  labor_hours DECIMAL(8,2),
  image_urls TEXT[],
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Work Order Parts/BOM
CREATE TABLE work_order_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE,
  part_name TEXT NOT NULL,
  part_number TEXT,
  quantity INTEGER DEFAULT 1,
  unit_cost DECIMAL(10,2),
  total_cost DECIMAL(10,2),
  supplier TEXT,
  ordered_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  metadata JSONB
);
```

---

### Phase 3: Universal Image Upload Service

**New Service**: `/nuke_frontend/src/services/universalImageUploadService.ts`

```typescript
export interface ImageUploadContext {
  entityType: 'vehicle' | 'organization' | 'work_order';
  entityId: string;
  userId: string;
  category?: string;
  organizationId?: string; // If uploaded by shop employee
}

export class UniversalImageUploadService {
  
  /**
   * Upload images with full EXIF extraction and timeline cascade
   */
  async uploadImages(
    files: File[],
    context: ImageUploadContext
  ): Promise<UploadResult> {
    
    const results = [];
    
    for (const file of files) {
      // 1. Extract EXIF metadata
      const metadata = await extractImageMetadata(file);
      
      // 2. Upload to storage
      const storagePath = this.getStoragePath(context, file);
      const { publicUrl, error } = await supabase.storage
        .from('vehicle-images') // Rename to 'nuke-images'?
        .upload(storagePath, file);
      
      if (error) {
        results.push({ file, success: false, error });
        continue;
      }
      
      // 3. Create image record in appropriate table
      const imageRecord = await this.createImageRecord(
        context,
        publicUrl,
        metadata
      );
      
      // 4. CASCADE: Create timeline events
      await this.createTimelineEventCascade(
        context,
        imageRecord,
        metadata
      );
      
      results.push({ file, success: true, imageRecord });
    }
    
    return { results, totalSuccess: results.filter(r => r.success).length };
  }
  
  /**
   * Create image record in entity-specific table
   */
  private async createImageRecord(
    context: ImageUploadContext,
    imageUrl: string,
    metadata: ImageMetadata
  ) {
    const baseRecord = {
      image_url: imageUrl,
      large_url: imageUrl, // TODO: Generate large variant
      thumbnail_url: imageUrl, // TODO: Generate thumbnail
      taken_at: metadata.dateTaken?.toISOString(),
      latitude: metadata.location?.latitude,
      longitude: metadata.location?.longitude,
      exif_data: metadata,
      uploaded_by: context.userId,
      uploaded_at: new Date().toISOString()
    };
    
    // Insert into appropriate table
    switch (context.entityType) {
      case 'vehicle':
        return await supabase
          .from('vehicle_images')
          .insert({ ...baseRecord, vehicle_id: context.entityId })
          .select()
          .single();
      
      case 'organization':
        return await supabase
          .from('organization_images')
          .insert({ ...baseRecord, organization_id: context.entityId, category: context.category })
          .select()
          .single();
      
      case 'work_order':
        return await supabase
          .from('work_order_images')
          .insert({ ...baseRecord, work_order_id: context.entityId, category: context.category })
          .select()
          .single();
    }
  }
  
  /**
   * CASCADE: Create timeline events for all related entities
   */
  private async createTimelineEventCascade(
    context: ImageUploadContext,
    imageRecord: any,
    metadata: ImageMetadata
  ) {
    const eventDate = metadata.dateTaken || new Date();
    const imageCount = 1; // Group later
    
    // 1. USER TIMELINE (profile contributions)
    await supabase.from('user_contributions').insert({
      user_id: context.userId,
      entity_type: context.entityType,
      entity_id: context.entityId,
      contribution_type: 'image_upload',
      contribution_date: eventDate,
      metadata: {
        image_id: imageRecord.id,
        category: context.category,
        has_gps: !!metadata.location
      }
    });
    
    // 2. ENTITY TIMELINE (vehicle, work order, org)
    const entityEvent = {
      event_type: 'image_upload',
      title: `Photo documentation${imageCount > 1 ? ` (${imageCount} images)` : ''}`,
      description: context.category ? `Category: ${context.category}` : null,
      event_date: eventDate,
      user_id: context.userId,
      image_urls: [imageRecord.image_url],
      metadata: {
        image_id: imageRecord.id,
        exif_extracted: !!metadata.dateTaken,
        location: metadata.location
      }
    };
    
    switch (context.entityType) {
      case 'vehicle':
        await supabase.from('vehicle_timeline_events').insert({
          ...entityEvent,
          vehicle_id: context.entityId
        });
        break;
      
      case 'organization':
        await supabase.from('business_timeline_events').insert({
          ...entityEvent,
          business_id: context.entityId,
          event_category: context.category || 'general'
        });
        break;
      
      case 'work_order':
        await supabase.from('work_order_timeline_events').insert({
          ...entityEvent,
          work_order_id: context.entityId
        });
        
        // Also cascade to ORGANIZATION timeline (shop activity feed)
        const { data: workOrder } = await supabase
          .from('work_orders')
          .select('organization_id, title')
          .eq('id', context.entityId)
          .single();
        
        if (workOrder) {
          await supabase.from('business_timeline_events').insert({
            business_id: workOrder.organization_id,
            event_type: 'work_order_progress',
            title: `Work documented: ${workOrder.title}`,
            description: `${imageCount} image${imageCount > 1 ? 's' : ''} added`,
            event_date: eventDate,
            event_category: 'work_order',
            user_id: context.userId,
            image_urls: [imageRecord.image_url],
            metadata: {
              work_order_id: context.entityId,
              image_id: imageRecord.id
            }
          });
        }
        break;
    }
    
    // 3. ORGANIZATION TIMELINE (if user is employee)
    if (context.organizationId && context.entityType !== 'organization') {
      await supabase.from('business_timeline_events').insert({
        business_id: context.organizationId,
        event_type: 'employee_contribution',
        title: `${context.userId} documented work`,
        description: `Added ${imageCount} image${imageCount > 1 ? 's' : ''} to ${context.entityType}`,
        event_date: eventDate,
        event_category: 'contribution',
        user_id: context.userId,
        metadata: {
          entity_type: context.entityType,
          entity_id: context.entityId,
          image_id: imageRecord.id
        }
      });
    }
  }
}
```

---

### Phase 4: Work Order UI Components

#### Work Order Profile Page
`/nuke_frontend/src/pages/WorkOrderProfile.tsx`

Similar to VehicleProfile, but focused on shop work:
- **Header**: Work order number, title, status, customer
- **Hero Image**: Primary "after" or "hero" shot
- **Timeline**: Progress documentation (EXIF-dated)
- **Parts List**: BOM with costs
- **Images Gallery**: Before/During/After categories
- **Valuation**: Labor hours + parts = total cost
- **Actions**:
  - "Order Similar Work" button (if `is_template`)
  - "Link to My Vehicle" (if customer owns vehicle)
  - "Share Work Order" (public link)

#### Shop Dashboard Enhancement
`/nuke_frontend/src/pages/OrganizationProfile.tsx` → Add "Work Orders" tab

- List all work orders
- Filter by status (in_progress, completed)
- Gallery view of completed work (portfolio)
- Click to view detail

---

## Key Benefits

### For Users
1. **Unified Portfolio**: All contributions tracked (vehicles, orgs, work orders)
2. **Authentic Timelines**: EXIF dates = real history
3. **Credit System**: Every image upload builds reputation

### For Organizations
1. **Activity Feed**: Live shop progress
2. **Portfolio Building**: Completed work showcases capabilities
3. **Customer Acquisition**: "Order Similar Work" templates
4. **Team Attribution**: Track employee contributions

### For Vehicles
1. **Accurate History**: Work documented as it happens
2. **Multi-Shop**: If serviced at different shops, all linked
3. **Value Tracking**: Timeline shows invested labor/parts

### For Work Orders (NEW)
1. **Standalone Profiles**: Work exists before vehicle linkage
2. **Progress Tracking**: Timeline shows start → finish
3. **Customer Transparency**: Real-time photo updates
4. **Reusability**: Templates for repeat services

---

## Migration Path

### Step 1: Organization Image Upload (This Week)
- [ ] Add EXIF extraction to `AddOrganizationData.tsx`
- [ ] Create timeline events on org image upload
- [ ] Test with Desert Performance images

### Step 2: Work Order Schema (Next Week)
- [ ] Create work_orders table + related tables
- [ ] Add RLS policies
- [ ] Create API endpoints

### Step 3: Work Order UI (2 Weeks)
- [ ] WorkOrderProfile page
- [ ] Create/Edit work order forms
- [ ] Add "Work Orders" tab to OrganizationProfile
- [ ] Image upload with EXIF for work orders

### Step 4: Universal Image Service (3 Weeks)
- [ ] Consolidate image upload logic
- [ ] Implement full timeline cascade
- [ ] Refactor existing vehicle image uploads to use service

### Step 5: Vehicle ↔ Work Order Linking (4 Weeks)
- [ ] "Link to Vehicle" flow
- [ ] Transfer timeline events when linked
- [ ] Handle multi-shop history

---

## Database Changes Needed

### Immediate (Organization Images)
```sql
-- Add event_category to business_timeline_events if missing
ALTER TABLE business_timeline_events 
ADD COLUMN IF NOT EXISTS event_category TEXT DEFAULT 'general';

-- Add image_urls array if missing
ALTER TABLE business_timeline_events
ADD COLUMN IF NOT EXISTS image_urls TEXT[];
```

### Near-Term (Work Orders)
```sql
-- Execute work order schema from above
-- Add indexes
CREATE INDEX idx_work_orders_org ON work_orders(organization_id);
CREATE INDEX idx_work_orders_status ON work_orders(status);
CREATE INDEX idx_work_orders_vehicle ON work_orders(vehicle_id);
CREATE INDEX idx_work_order_images_wo ON work_order_images(work_order_id);
CREATE INDEX idx_work_order_timeline_wo ON work_order_timeline_events(work_order_id);
```

---

## Questions for User

1. **Work Order Naming**: Do shops use specific numbering systems? (e.g., "WO-2024-001" vs custom)

2. **Public Templates**: Should completed work orders be publicly browsable as "services we offer"?

3. **Customer Portal**: Do customers need login to track their work orders, or just a public share link?

4. **Vehicle Linking**: When work order is linked to vehicle, should timeline events:
   - Stay on work order only?
   - Copy to vehicle timeline?
   - Show on both (cross-reference)?

5. **Boat Engines**: Do we expand beyond automotive? (Marine, powersports, aviation, industrial?)

6. **Organization Auto-Tagging**: If image has GPS matching a shop location, auto-associate with that org?

---

## Next Steps

**Immediate Action** (Today):
1. Implement EXIF extraction for org images (Phase 1)
2. Create timeline events when org images uploaded
3. Test with Desert Performance

**This Week**:
1. Design Work Order schema details
2. Mockup WorkOrderProfile UI
3. User feedback on work order concept

**Next Week**:
1. Deploy work order tables
2. Build WorkOrderProfile page
3. Add work order creation to org dashboard

