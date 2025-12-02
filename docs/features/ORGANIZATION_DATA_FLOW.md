# Organization Data Flow & Permissions

## Core Architecture

### Identity & Authentication
```
User (auth.users) 
  ↓
Profile (profiles) → user_type: ['user', 'admin', 'moderator', 'professional']
  ↓
Organization Link via multiple paths:
  1. business_ownership (legal owner via documents)
  2. organization_contributors (roles: owner, manager, employee, etc.)
  3. business_user_roles (employment relationship)
```

### Organization Data Model

**Primary Table:** `businesses`
```sql
- id (UUID)
- business_name (TEXT)
- discovered_by (UUID) → First contributor who created profile
- uploaded_by (UUID) → Same as discovered_by
- is_public (BOOLEAN) → Visibility
- is_verified (BOOLEAN) → Platform verification status
```

**Ownership Hierarchy:**
1. **Legal Owner** → `business_ownership.owner_id` (verified via documents)
2. **Contributors** → `organization_contributors` (owner, manager, employee, etc.)
3. **Employees** → `business_user_roles` (employment details, permissions)

### Permission Levels

**FULL ACCESS (Write + Delete):**
- Legal owners via `business_ownership`
- Contributors with role: `owner`, `co_founder`, `board_member`, `manager`
- Verified ownership via `organization_ownership_verifications`
- First discoverer: `discovered_by = auth.uid()`

**EDIT ACCESS (Write only):**
- Contributors with role: `employee`, `technician`
- Anyone who uploaded data: `uploaded_by = auth.uid()`

**READ ACCESS:**
- Everyone if `is_public = true`
- All members/contributors
- Public can view public orgs

### Data Flow Paths

#### 1. INVENTORY FLOW (Vehicles)
```
Source: Dropbox | Bulk Editor | AI Assistant | Manual Add
  ↓
Create Vehicle → vehicles table
  ↓
Link to Organization → organization_vehicles table
  ↓
  - relationship_type: ['owner', 'in_stock', 'consignment', 'sold', 'service']
  - auto_tagged: BOOLEAN (GPS-based auto-linking)
  - linked_by_user_id: UUID (who created the link)
```

**Permission Check:**
```sql
CAN_LINK_VEHICLE = 
  vehicle.user_id = auth.uid() 
  OR organization_contributors.role IN ('owner', 'manager')
  OR business_ownership.owner_id = auth.uid()
```

#### 2. IMAGE FLOW
```
Upload Image → Supabase Storage (bucket: vehicle-data/organization-data/)
  ↓
Extract EXIF (date, GPS, camera)
  ↓
Create organization_images record
  ↓
  - organization_id: UUID
  - user_id: UUID (uploader)
  - latitude/longitude: NUMERIC (from EXIF)
  - taken_at: TIMESTAMPTZ (from EXIF)
  ↓
Trigger: auto_tag_organization_from_gps()
  ↓
  IF GPS within 500m of organization.latitude/longitude
    → Create timeline event
    → Link to nearby vehicles (if any)
```

**Permission Check:**
```sql
CAN_UPLOAD_IMAGE = 
  auth.uid() IS NOT NULL (anyone can contribute)

CAN_DELETE_IMAGE = 
  user_id = auth.uid() (own images)
  OR business_ownership.owner_id = auth.uid() (legal owner)
```

#### 3. TIMELINE EVENT FLOW
```
Trigger Source:
  - Manual event creation
  - Image upload (auto-creates event at taken_at date)
  - Work order completion
  - Vehicle status change
  ↓
Create business_timeline_events record
  ↓
  - business_id: UUID
  - event_type: TEXT ['service', 'image_upload', 'work_order', etc.]
  - event_date: DATE (when event occurred, NOT created_at)
  - labor_hours: NUMERIC
  - created_by: UUID
  ↓
Update organization stats (trigger)
  ↓
  - total_events
  - total_images
  - total_vehicles
```

**Permission Check:**
```sql
CAN_CREATE_EVENT = 
  auth.uid() IS NOT NULL (anyone can create)

CAN_VIEW_EVENTS = 
  is_public = true
  OR business_ownership.owner_id = auth.uid()
  OR organization_contributors.user_id = auth.uid()
```

### Security Model (RLS Policies)

**businesses table:**
- SELECT: Public if `is_public = true`, owners always
- INSERT: Authenticated users (becomes `discovered_by`)
- UPDATE: Owners, contributors (owner/manager), discoverer
- DELETE: Owners only

**organization_vehicles table:**
- SELECT: Everyone (public links)
- INSERT: Authenticated users
- UPDATE/DELETE: Link creator, vehicle owner, org owners/managers

**organization_images table:**
- SELECT: Everyone
- INSERT: Authenticated users (auto-sets `user_id = auth.uid()`)
- UPDATE/DELETE: Uploader OR org owners

**organization_contributors table:**
- SELECT: Everyone
- INSERT: Org owners only
- UPDATE/DELETE: Org owners only

### Common Patterns

**Check if user is org owner:**
```typescript
const isOwner = async (orgId: string, userId: string): boolean => {
  const { data } = await supabase
    .from('organization_contributors')
    .select('id')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .in('role', ['owner', 'co_founder', 'board_member', 'manager'])
    .eq('status', 'active')
    .single();
  
  return !!data;
};
```

**Check if user can edit:**
```typescript
const canEdit = async (orgId: string, userId: string): boolean => {
  // Check 1: Is discoverer?
  const { data: org } = await supabase
    .from('businesses')
    .select('discovered_by')
    .eq('id', orgId)
    .single();
  
  if (org?.discovered_by === userId) return true;
  
  // Check 2: Is contributor?
  const { data: contrib } = await supabase
    .from('organization_contributors')
    .select('id')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();
  
  return !!contrib;
};
```

### Data Validation Rules

**Vehicle Link Creation:**
1. Vehicle must exist in `vehicles` table
2. Organization must exist in `businesses` table
3. User must have permission to link (own vehicle OR org manager)
4. relationship_type must be valid: `['owner', 'in_stock', 'consignment', 'sold', 'service', 'work_location']`

**Image Upload:**
1. organization_id must be valid
2. Image file must be valid format (jpg, png, heic)
3. EXIF extraction happens server-side
4. GPS auto-linking is optional (requires GPS in EXIF)

**Timeline Event:**
1. business_id must be valid
2. event_date must be valid date (can be past)
3. event_type must be from allowed list
4. labor_hours must be >= 0

### Cascading Deletes

**Delete Organization:**
```
businesses (CASCADE)
  ↓
  - organization_contributors
  - organization_vehicles (links only, not vehicles themselves)
  - organization_images
  - business_timeline_events
  - work_orders
```

**Delete User:**
```
auth.users (CASCADE)
  ↓
  - organization_contributors
  - business_user_roles
  - BUT NOT businesses (organization persists)
  - BUT NOT organization_images (attribution preserved)
```

### Audit Trail

All tables include:
- `created_at: TIMESTAMPTZ` (when record was created)
- `updated_at: TIMESTAMPTZ` (when record was last modified)
- Creator attribution (`user_id`, `created_by`, `uploaded_by`, `linked_by_user_id`)

No soft deletes - hard deletes with cascading for data integrity.

### Common Gotchas

1. **Multiple Owner Types:**
   - `discovered_by` = First contributor (can edit)
   - `business_ownership.owner_id` = Legal owner (full access)
   - `organization_contributors.role=owner` = Administrative owner (full access)
   
2. **relationship_type vs role:**
   - `organization_vehicles.relationship_type` = How org relates to vehicle
   - `organization_contributors.role` = How user relates to org
   
3. **Auto-linking:**
   - GPS-based linking is automatic but can be overridden
   - Set `auto_tagged = false` to prevent future auto-links
   
4. **Timeline Event Dates:**
   - `event_date` = When the event occurred (can be historical)
   - `created_at` = When the record was created (always NOW)

