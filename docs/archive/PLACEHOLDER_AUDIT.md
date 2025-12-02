# Placeholder Audit & Real Data Status

## ✅ COMPLETE - Real Database Connections

### Core Vehicle System
- **VehicleProfile.tsx**: Fully operational with real Supabase queries
  - Loads vehicle data from `vehicles` table
  - Real image queries from `vehicle_images`
  - Timeline events from `vehicle_timeline_events`
  
### Admin System  
- **AdminDashboard.tsx**: Fully operational
  - Real queries to `pending_approvals` view
  - Real RPC calls to `approve_contributor_request()`
  - Shop context (shop_id, shop_name) displayed when present
  
### Shops System
- **Shops.tsx**: Fully operational
  - Real CRUD operations on `shops` table
  - Create/read shops with RLS enforcement
  - Shows verification_status from database

### Image Gallery
- **ImageGallery.tsx**: Fully operational
  - Real queries to `vehicle_images` table
  - Real tool inventory from `user_tools` table
  - Image tagging with actual database persistence

## ⚠️ ACCEPTABLE PLACEHOLDERS (Future Features)

### Admin Dashboard Tabs
- **Location**: `pages/AdminDashboard.tsx` lines 252-271
- **Status**: Placeholder text for future features
- **Text**: "Admin task management coming soon", "Platform analytics coming soon", "User management coming soon"
- **Action**: None needed - these are clearly marked future features

### OCR/External API Integration
- **Location**: `services/dynamicFieldService.ts`, `services/buildImportService.ts`
- **Status**: Commented TODOs for OCR integration
- **Action**: None needed - external API integration is explicitly future work

### Tool Image Service Placeholders
- **Location**: `services/toolImageService.ts` lines 230-262
- **Status**: Uses placeholder icons when tool images unavailable
- **Action**: None needed - graceful fallback system working

## 🔧 TO FIX - Missing Real Data Connections

### 1. ContributorOnboarding Component
- **Status**: Referenced in checkpoint but NOT YET CREATED
- **Priority**: HIGH
- **Action**: Create component with:
  - Real shop selection from user's memberships
  - Real document upload to Supabase storage
  - Real insert to `contributor_onboarding` table
  - Shop validation via `shop_members` query

### 2. Business Verification Missing RPC
- **Status**: Migration created but no frontend implementation
- **Priority**: MEDIUM  
- **Action**: Need to create verification wizard that:
  - Uploads docs to storage
  - Creates `shop_verification_requests` records
  - Calls `approve_shop_verification()` RPC

### 3. Shop Capabilities Not Tracking
- **Status**: Table exists but no event attribution
- **Priority**: LOW
- **Action**: Add `shop_id` to event pipeline calls

## 📊 Database Coverage Report

### Tables with FULL real data queries:
- ✅ vehicles
- ✅ vehicle_images  
- ✅ vehicle_timeline_events
- ✅ user_tools
- ✅ shops
- ✅ pending_approvals (view)
- ✅ admin_users
- ✅ profiles

### Tables with PARTIAL or NO queries yet:
- ⚠️ shop_members (created but not queried in UI)
- ⚠️ shop_invitations (created but minimal UI)
- ⚠️ contributor_onboarding (exists but no submission UI)
- ⚠️ contributor_documentation (exists but no upload UI)
- ⚠️ shop_verification_requests (created but no UI)
- ⚠️ shop_documents (created but no upload UI)
- ⚠️ shop_capabilities (created but no tracking)

## 🎯 Next Steps (Priority Order)

1. **Create ContributorOnboarding component** 
   - Real shop membership query
   - Real document upload flow
   - Real submission to database
   
2. **Wire up shop member management**
   - Query shop_members table
   - Display member list
   - Accept invitations
   
3. **Add shop context to image uploads**
   - Pass shop_id when uploading
   - Display "Contributed by <Shop>" in gallery

4. **Event pipeline shop attribution**
   - Add shop_id to eventPipeline calls
   - Track shop_capabilities automatically

## 🚫 NOT Placeholders (Actual Design Choices)

These look like placeholders but are intentional:
- Form input placeholder attributes (e.g., "Enter business name")
- Icon placeholders for missing images (intentional fallback)
- "No data yet" empty states (correct UX)

## Summary

**Real Data Connections**: 8/15 tables (53%)
**Critical Missing**: ContributorOnboarding component
**Blocker Status**: None - core vehicle/admin workflows functional
**Recommendation**: Focus on ContributorOnboarding to complete the contributor approval loop
