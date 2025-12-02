# Organization Profile Rebuild Plan

## Completed ✅
1. **Documentation**: Created ORGANIZATION_DATA_FLOW.md explaining:
   - Permission hierarchy (Legal Owner > Contributors > Employees > Public)
   - Data flow paths (Inventory, Images, Timeline Events)
   - RLS policies and security model
   - Common patterns and gotchas

2. **Modular Components**: Started OrganizationOverviewTab.tsx

3. **Tools**: Created 3 dealer tools:
   - AI Assistant (Cursor-style chat for data dumps)
   - Bulk Editor (Excel-style spreadsheet)
   - Dropbox Import (automated sync)

## Next Steps (Priority Order)

### 1. Complete Modular Tab Components
Create clean, focused components:
- `OrganizationVehiclesTab.tsx` - Vehicle inventory with filters
- `OrganizationInventoryTab.tsx` - Dealer-specific tools (in_stock vehicles)
- `OrganizationImagesTab.tsx` - Image gallery with upload
- `OrganizationMembersTab.tsx` - Team management
- `OrganizationTimelineTab.tsx` - Activity feed

### 2. Rebuild OrganizationProfile.tsx
- Import modular components
- Clean permission checks using documented patterns
- Proper loading states
- Error boundaries

### 3. Permission Helper Service
Create `/services/organizationPermissions.ts`:
```typescript
export const checkOrgPermission = async (
  orgId: string,
  userId: string,
  action: 'view' | 'edit' | 'delete' | 'manage_members' | 'link_vehicles'
): Promise<boolean>
```

### 4. Data Flow Validation
Add validation middleware:
- Vehicle linking must check permissions
- Image uploads must set user_id
- Timeline events must validate dates
- Cascade rules must be enforced

### 5. UI/UX Improvements
**Vehicles Tab:**
- Grid/List toggle
- Filter by relationship_type (in_stock, sold, service)
- Quick link/unlink actions
- Show vehicle status clearly

**Inventory Tab (Dealer Focus):**
- Show only in_stock vehicles
- Quick price editor
- Status updater (in_stock → sold)
- Link to AI Assistant/Bulk Editor

**Images Tab:**
- Upload with drag-drop
- GPS map showing image locations
- Timeline view (by taken_at date)
- Bulk tagging

**Members Tab:**
- Invite by email
- Role management UI
- Permission matrix display
- Activity history per member

**Timeline Tab:**
- Heatmap calendar
- Filter by event_type
- Click to see details
- Link to related vehicles/images

### 6. IAM Flow Documentation
Add to docs:
```
User Login → Session
  ↓
Load Profile → Get user_type, roles
  ↓
Access Org Page → Check permissions
  ↓
  - discovered_by = user → EDIT
  - organization_contributors.role = owner/manager → FULL
  - organization_contributors.role = employee → EDIT
  - business_ownership.owner_id = user → FULL
  - is_public = true → VIEW
  ↓
Render UI based on permission level
```

### 7. Edge Cases to Handle
- [ ] User tries to link vehicle they don't own
- [ ] User uploads image to private org
- [ ] Member leaves org (set status=inactive, keep attribution)
- [ ] Org deletion (cascade properly, keep audit trail)
- [ ] Duplicate vehicle links (unique constraint enforcement)

### 8. Testing Checklist
- [ ] Owner can edit everything
- [ ] Manager can edit, can't delete org
- [ ] Employee can contribute data, can't manage members
- [ ] Public user can only view if is_public=true
- [ ] Vehicle owner can link their vehicle to any org
- [ ] Image uploader can delete their own images
- [ ] Timeline events show correct creator attribution

## Design Principles

**Clarity:**
- Tab names are obvious: Overview, Vehicles, Inventory (dealers), Images, Members, Timeline
- No cluttered "everything on one page"
- Clear permissions indicators (badges for role)

**Data Integrity:**
- All creates include creator attribution
- All links include linked_by_user_id
- Timestamps are accurate (event_date vs created_at)
- Cascading deletes preserve attribution

**Performance:**
- Lazy load tabs (don't load all data upfront)
- Paginate large lists (vehicles, images)
- Cache stats (use triggers to update counts)
- Use thumbnail_url for image grids

**User Experience:**
- Fast actions (inline editing)
- Clear feedback (saving states, success/error messages)
- Undo support where possible
- Mobile-responsive

## Current Issues to Fix

1. **Sloppy Inventory Tab**: Too many buttons, unclear purpose
   - FIX: Merge with Vehicles tab, add "View as Dealer" toggle
   
2. **Vehicles Tab underutilized**: Just shows list
   - FIX: Add filters, bulk actions, relationship management
   
3. **Permission checks inconsistent**: Multiple ways to check same thing
   - FIX: Use centralized permission service
   
4. **Data flow unclear**: Users don't understand org vs vehicle ownership
   - FIX: Add tooltips, clear role badges, documentation links

## File Structure
```
/components/organization/
  OrganizationOverviewTab.tsx ✅
  OrganizationVehiclesTab.tsx (TODO)
  OrganizationInventoryTab.tsx (TODO)
  OrganizationImagesTab.tsx (TODO)
  OrganizationMembersTab.tsx (TODO)
  OrganizationTimelineTab.tsx (TODO)
  
/services/
  organizationPermissions.ts (TODO)
  
/pages/
  OrganizationProfile.tsx (REFACTOR)
  
/pages/dealer/
  DealerAIAssistant.tsx ✅
  DealerBulkEditor.tsx ✅
  DealerDropboxImport.tsx ✅
  
/docs/
  ORGANIZATION_DATA_FLOW.md ✅
  ORGANIZATION_REBUILD_PLAN.md ✅
```

## Success Criteria

✅ Clear permission model documented
✅ Modular tab components
✅ IAM flow validated
✅ Data flow traceable
✅ UI is clean and obvious
✅ Mobile-responsive
✅ Performance optimized

