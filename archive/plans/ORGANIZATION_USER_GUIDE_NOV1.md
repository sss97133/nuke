# Organization System - User Guide

**Date**: November 1, 2025  
**Status**: ✅ LIVE IN PRODUCTION

---

## How to Add a New Organization

### Method 1: Direct URL
Navigate to: **`https://n-zero.dev/org/create`**

### Method 2: From Navigation
1. Go to any organization profile
2. Click "Organizations" in the top nav
3. Look for "Create Organization" link (to be added to header)

### Creating an Organization

**Required Fields:**
- **Business Name** - Display name (e.g., "Desert Performance")

**Recommended Fields:**
- **Legal Name** - Full legal entity name (e.g., "Desert Performance LLC")
- **Business Type** - Select from dropdown (Garage, Dealership, Performance Shop, etc.)
- **Description** - Brief description of services/focus
- **Phone** - Contact number
- **Email** - Contact email
- **Website** - Business website URL

**Optional Fields:**
- **Address, City, State, ZIP** - Physical location

**Important Notes:**
- You will be **credited as the creator** (not automatic owner)
- The profile is **collaborative** - any user can contribute data
- To claim **ownership**, you must submit business documents for verification
- Organizations follow the same Wikipedia-style model as vehicles

---

## How to Edit Organization Data

### 1. Edit Basic Organization Info

**Current Status:** ✅ IMPLEMENTED  
**Access:** Creator or verified owner only

The "Contribute Data" button on the organization profile allows you to:
- Submit updated contact information
- Add/update members
- Upload location images
- Add contact details

### 2. Edit Inventory Items

**Status:** ✅ NOW LIVE  
**Access:** Item submitter only (RLS enforced)

**How to Edit Your Inventory Items:**

1. **Navigate to the organization profile**
   - Go to `https://n-zero.dev/org/[org-id]`

2. **Click the "Inventory" tab**
   - Filter by type if needed (Tool, Equipment, Facility, etc.)

3. **Find your item**
   - Only items **you submitted** will show an "Edit" button

4. **Click "Edit"**
   - Modal opens with all current values pre-filled

5. **Make changes:**
   - Update item type, name, brand, model
   - Modify description, quantity, value, condition
   - Change acquisition date
   - Upload new photo (replaces old one)

6. **Save or Delete:**
   - **"Save Changes"** - Updates the item
   - **"Delete"** - Permanently removes the item (confirmation required)

**What You Can Edit:**
- Item type (tool, equipment, facility, specialty, certification)
- Name/description
- Brand and model
- Details/description
- Quantity
- Value (USD)
- Condition (excellent, good, fair, needs repair)
- Acquisition date
- Photo (upload new to replace)

**What You Cannot Edit:**
- Submitter attribution (always you)
- Submission timestamp (original date preserved)
- Organization ID (locked to org)

**Delete Confirmation:**
- Prompt: "Delete this inventory item? This cannot be undone."
- Requires explicit confirmation
- Permanent deletion from database

---

## How Inventory Editing Works

### Permission System (RLS Policies)

**Read Access:**
```sql
-- Anyone can view inventory
CREATE POLICY "organization_inventory_select"
    ON organization_inventory
    FOR SELECT
    USING (true);
```

**Write Access:**
```sql
-- Any authenticated user can add items
CREATE POLICY "organization_inventory_insert"
    ON organization_inventory
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- Only submitter can update/delete their items
CREATE POLICY "organization_inventory_update_submitter"
    ON organization_inventory
    FOR UPDATE
    USING (submitted_by = auth.uid());

CREATE POLICY "organization_inventory_delete_submitter"
    ON organization_inventory
    FOR DELETE
    USING (submitted_by = auth.uid());
```

### UI Behavior

**Edit Button Visibility:**
- Frontend checks: `currentUserId === item.submitted_by`
- Button only appears on items you submitted
- Backend RLS enforces this (double security)

**Modal Pre-population:**
- All current values loaded into form
- Existing photo URL preserved if no new upload
- Can modify any field except submitter/timestamp

**Update Flow:**
1. User clicks "Edit"
2. Modal opens with current values
3. User makes changes
4. On submit:
   - If new photo: Upload to storage first
   - Update database record with new values
   - Reload inventory list
   - Close modal

**Delete Flow:**
1. User clicks "Delete"
2. Confirmation prompt appears
3. If confirmed:
   - Delete record from database
   - Reload inventory list
   - Close modal

---

## Organization Profile Tabs

### 1. Overview
- Organization details (type, description, contact)
- Stock information (if tradable)
- Statistics (vehicles, images, events)

### 2. Vehicles
- Vehicles associated with the organization
- Can add vehicles via organization membership

### 3. Images
- Gallery of organization photos
- Location images, shop photos, etc.

### 4. Inventory
- **Tools** - Hand tools, diagnostic equipment
- **Equipment** - Lifts, welders, compressors
- **Facility Features** - Paint booth, dyno, etc.
- **Specialty/Unique** - Custom capabilities
- **Certifications** - ASE, manufacturer certs

### 5. Contributors
- List of users who have contributed data
- Contribution counts
- Timeline of contributions
- Attribution for all submissions

---

## Inventory Categories

### Tool
- Hand tools (wrenches, sockets, etc.)
- Power tools (impacts, grinders, etc.)
- Diagnostic scanners
- Specialty tools

### Equipment
- Lifts (2-post, 4-post, etc.)
- Welders (MIG, TIG, stick)
- Air compressors
- Tire machines, balancers
- Alignment equipment
- Dyno equipment
- Paint guns, HVLP systems

### Facility Feature
- Paint booth
- Dyno room
- Alignment bay
- Fabrication area
- Climate-controlled storage
- Office/waiting area
- Parts storage system

### Specialty/Unique
- Custom fabrication capabilities
- Rare/vintage tools
- Unique services
- Proprietary equipment

### Certification/License
- ASE certifications
- Manufacturer certifications (GM, Ford, etc.)
- Business licenses
- Safety certifications (OSHA, EPA)
- Specialty training certificates

---

## Common Workflows

### Adding Inventory as Shop Owner

1. **Create organization** (if doesn't exist)
   - Go to `/org/create`
   - Fill in business details
   - Submit

2. **Navigate to Inventory tab**
   - Click "Add Item" button (owner/contributor access)

3. **Add each tool/equipment piece**
   - Select type
   - Enter details (name, brand, model, value, etc.)
   - Upload photo
   - Set acquisition date
   - Submit

4. **Result:**
   - Item appears in inventory
   - You're credited as submitter
   - Timeline event created
   - Contribution count increases

### Updating Inventory Item

1. **Navigate to organization inventory tab**
2. **Find your item** (has "Edit" button)
3. **Click "Edit"**
4. **Update fields** (price increased, condition changed, etc.)
5. **Save changes**
6. **Result:** Item updated, attribution preserved

### Removing Outdated Inventory

1. **Navigate to item**
2. **Click "Edit"**
3. **Click "Delete"**
4. **Confirm deletion**
5. **Result:** Item removed from inventory

### Collaborative Organization Building

**Scenario:** Multiple users build out shop profile

- **User A (Shop Owner):**
  - Creates organization
  - Adds contact info, hours, services
  - Uploads shop photos

- **User B (Employee/Contributor):**
  - Adds tool inventory (knows what tools are there)
  - Uploads equipment photos
  - Adds certifications

- **User C (Customer/Community):**
  - Adds facility features they've seen
  - Verifies contact information
  - Contributes photos

**All contributions attributed:**
- User A: "Created organization"
- User B: "Added 15 inventory items"
- User C: "Added 3 images, verified contact info"

---

## Attribution & Credit System

### Every Action is Tracked

**Inventory Item:**
- Submitter avatar + name displayed
- Timestamp recorded
- Attribution visible on item card
- Timeline event created

**Timeline Entry:**
```
"[User] added Equipment: Rotary 4-Post Lift SPO14"
- Date: March 15, 2021
- Category: Operational
- Value: $6,800
```

**Contributors Tab:**
```
Mike Johnson (@mike)
- Role: Contributor
- 15 contributions
- Timeline: [list of all contributions]
```

### Trust & Verification

**Current System:**
- All contributions are public
- Attribution is permanent
- Submitter can edit/delete their own items
- Organization owner/admin TBD for moderation

**Future Enhancements:**
- Verification system (multiple users confirm item exists)
- Trust scores based on verified contributions
- Badges for high-quality contributors
- Community moderation tools

---

## Best Practices

### For Shop Owners

1. **Be thorough** - Add all significant tools/equipment
2. **Include photos** - Visual proof increases credibility
3. **Update regularly** - Mark items as sold/removed when applicable
4. **Be accurate** - Correct values and conditions build trust
5. **Add context** - Use description field for specs, history, capabilities

### For Contributors

1. **Only add what you've seen** - Don't guess or assume
2. **Provide evidence** - Photos are key
3. **Be specific** - Include brand, model, specs
4. **Date accurately** - Use acquisition date if known
5. **Describe capabilities** - What can this tool/equipment do?

### For Everyone

1. **Respect attribution** - Don't claim others' work
2. **Collaborate** - Multiple perspectives build better profiles
3. **Update, don't duplicate** - Edit existing items rather than creating new ones
4. **Be honest** - Inaccurate data hurts everyone
5. **Document everything** - Photos + details = credibility

---

## Technical Notes

### Frontend Components

**Main Component:**
- `/nuke_frontend/src/components/organization/OrganizationInventory.tsx`
- Handles list view, add modal, edit modal
- Manages state for items, filters, modals

**Key Features:**
- Filter tabs (all, tool, equipment, etc.)
- Card-based grid layout
- Edit button conditional rendering
- Modal forms (add/edit)
- Delete confirmation

### Backend

**Database Table:**
- `organization_inventory` - 30+ fields
- JSONB for specifications
- Text arrays for capabilities/certifications
- Full attribution tracking

**RLS Policies:**
- Public read
- Authenticated insert
- Submitter-only update/delete

**Indexes:**
- `organization_id` (primary lookup)
- `item_type` (filter queries)
- `submitted_by` (user inventory)

### Storage

**Image Uploads:**
- Path: `vehicle-data/organization-data/[org-id]/inventory/[timestamp]_[random].[ext]`
- Public URLs generated via Supabase Storage
- No authentication required for read

---

## Troubleshooting

### "Edit button doesn't appear"

**Cause:** You didn't submit that item  
**Solution:** Only submitter can edit. If it's your org, you can ask the submitter to update or delete it.

### "Delete confirmation not working"

**Cause:** Browser blocking confirm dialog  
**Solution:** Check browser console for errors, ensure JavaScript enabled

### "Image upload fails"

**Cause:** File size, permissions, or storage quota  
**Solution:**
- Check file size (< 5MB recommended)
- Ensure authenticated
- Check Supabase Storage quota

### "Can't create organization"

**Cause:** Missing required fields or not authenticated  
**Solution:**
- Ensure logged in
- Fill in required "Business Name" field
- Check console for specific error

### "RLS policy violation"

**Cause:** Trying to edit/delete someone else's item  
**Solution:** You can only edit items you submitted. Contact submitter or org owner.

---

## Future Features (Roadmap)

### Phase 2: Verification
- Users can "verify" inventory items
- Multi-user confirmation increases trust
- Verification badges on items

### Phase 3: Service History
- Link maintenance records to equipment
- Track service intervals
- Alerts for overdue maintenance

### Phase 4: Equipment Marketplace
- List tools/equipment for sale
- Rental availability
- "Looking for" requests

### Phase 5: Capabilities Search
- "Find shops with [tool] near [location]"
- Job referral system
- Collaborative builds

### Phase 6: Organization Admin Panel
- Moderate contributions
- Approve/reject submissions
- Manage members/roles

---

## Summary

**Adding Organizations:**
- Go to `/org/create`
- Fill in business details
- Submit to create collaborative profile

**Editing Inventory:**
- Navigate to Inventory tab
- Click "Edit" on your items
- Update details or delete
- Changes saved immediately

**Attribution:**
- All contributions credited
- Timeline events created
- Contributors tab shows full audit trail

**Access Control:**
- Anyone can view inventory
- Authenticated users can add items
- Only submitters can edit/delete their items

**Production Status:**
- ✅ No emojis (removed from all UI)
- ✅ Edit functionality live
- ✅ Delete with confirmation
- ✅ Attribution tracking complete
- ✅ RLS policies enforced

---

**Questions?** Check the Contributors tab on any organization to see how attribution works in practice!

