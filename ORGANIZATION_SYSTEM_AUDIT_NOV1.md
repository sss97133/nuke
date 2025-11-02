# Organization System Audit - November 1, 2025

## Your Requirements (From Recent Prompts)

### ✅ IMPLEMENTED

#### 1. **Image Management**
- ✅ Delete images (owner only)
- ✅ Set primary/logo image (owner only)
- ✅ AI scanning with tags and inventory extraction
- ✅ EXIF data extraction (date, GPS, camera)
- ✅ Lightbox viewer for images
- ✅ Full-resolution image display

**Status**: COMPLETE ✅

---

#### 2. **Timeline System**
- ✅ Company timeline exists
- ✅ Timeline shows events with dates
- ✅ Events from image uploads
- ✅ EXIF dates used (not upload dates)

**Status**: COMPLETE ✅

---

#### 3. **Basic Organization Profile**
- ✅ Organization details (name, type, description)
- ✅ Stock information (if tradable)
- ✅ Statistics (vehicles, images, events)
- ✅ Multiple tabs (Overview, Vehicles, Images, Inventory, Contributors)
- ✅ Contributor attribution chain

**Status**: COMPLETE ✅

---

### 🚧 PARTIALLY IMPLEMENTED

#### 4. **Contribution & Attribution**
- ✅ Contributors tracked in `organization_contributors`
- ✅ Timeline events attribute to user
- ✅ Images link to uploader
- ⚠️ **MISSING**: User profile doesn't show their org contributions
- ⚠️ **MISSING**: Reputation/credit system not implemented

**Status**: 70% Complete

**What's Missing**:
- User profile page showing "I contributed to X orgs"
- Contribution quality/tier scoring
- Public recognition of top contributors

---

#### 5. **Ownership Verification**
- ✅ "Claim Ownership" button exists
- ✅ Upload ownership documents (business license, tax docs)
- ✅ Documents stored in Supabase storage
- ⚠️ **MISSING**: Admin approval workflow
- ⚠️ **MISSING**: Verification status badges
- ⚠️ **MISSING**: Owner privileges differentiation

**Status**: 60% Complete

**What's Missing**:
- Admin dashboard to approve/reject ownership claims
- "Verified Owner" badge on profile
- Owner-specific permissions (beyond basic RLS)

---

#### 6. **Trading System (Stocks/ETFs)**
- ✅ `organization_offerings` table exists
- ✅ Stock symbol and price display
- ✅ "Trade Shares" button
- ⚠️ **MISSING**: Trading modal/UI incomplete
- ⚠️ **MISSING**: Order placement not wired up
- ⚠️ **MISSING**: Portfolio doesn't show org stocks

**Status**: 40% Complete

**What's Missing**:
- Functional "Trade Shares" modal (buy/sell UI)
- Integration with `place-market-order` edge function
- Portfolio page showing org stock holdings
- Real-time price updates

---

### ❌ NOT IMPLEMENTED

#### 7. **Collaborative Model (Like Vehicles)**
- ❌ Any user can discover an org
- ❌ Any user can contribute data
- ❌ Contribution requires approval only for ownership
- ⚠️ **CURRENT**: Orgs are somewhat public but contribution UI is unclear

**Status**: 30% Complete

**Critical Gaps**:
- "Add Organization" is not easily discoverable
- No public org directory/search (like vehicles)
- Unclear how users contribute without being "owner"
- No "Discover Organization" flow

---

#### 8. **GPS Auto-Tagging**
- ❌ If image has GPS matching org location → auto-associate
- ❌ If user working at org GPS location → auto-tag
- ❌ Automatic org linking based on location

**Status**: 0% - Not Started

**What's Needed**:
- GPS matching algorithm
- Org location radius (e.g., within 100m)
- Auto-suggest: "This image was taken at Desert Performance. Link it?"
- User confirmation before linking

---

#### 9. **Organization-Owned Vehicles**
- ✅ `organization_vehicles` table exists
- ✅ Vehicles tab shows linked vehicles
- ⚠️ **MISSING**: UI to link vehicle to org
- ⚠️ **MISSING**: Vehicle profile doesn't show "Owned by [Org]"
- ⚠️ **MISSING**: Multi-org association (vehicle serviced at multiple shops)

**Status**: 30% Complete

**What's Needed**:
- "Link Vehicle" button on vehicle profile
- "Owned by" vs "Serviced by" distinction
- Vehicle history showing all orgs that touched it
- Transfer vehicle ownership to org

---

#### 10. **Receipt Linking to Organizations**
- ⚠️ **PARTIAL**: Receipts exist on vehicles
- ❌ Receipts don't link to orgs
- ❌ No "work performed at [shop]" on receipts
- ❌ Organization timeline doesn't show customer transactions

**Status**: 20% Complete

**What's Needed**:
- Add `organization_id` to `receipts` table
- Receipt shows "Work performed at: Desert Performance"
- Clicking org name → goes to org profile
- Org timeline shows "Service performed for [Customer]"

---

#### 11. **Work Orders System**
- ❌ **NOT STARTED** (see `/docs/UNIVERSAL_IMAGE_TIMELINE_SYSTEM.md` for design)

**Status**: 0% - Designed but not implemented

**Critical Feature for Your Vision**:
- Standalone work order profiles
- "454 Big Block Marine Engine Rebuild" as its own entity
- Timeline of work progress
- Eventually links to vehicle
- Shop portfolio piece
- "Order Similar Work" templates

**Priority**: HIGH (this is your "boat engines" use case)

---

## Database Schema Audit

### ✅ EXISTS & CORRECT

```sql
✅ businesses (organizations table)
✅ organization_images
✅ organization_image_tags (NEW - just added)
✅ organization_contributors
✅ organization_inventory
✅ organization_locations
✅ organization_licenses
✅ organization_members
✅ organization_ownership_verifications
✅ organization_offerings (stocks/ETFs)
✅ organization_share_holdings
✅ organization_market_orders
✅ organization_market_trades
✅ organization_vehicles
✅ business_timeline_events
✅ business_ownership
✅ business_user_roles
```

### ❌ MISSING TABLES

```sql
❌ work_orders
❌ work_order_images
❌ work_order_timeline_events
❌ work_order_parts (BOM)
❌ user_contributions (cross-entity contribution tracking)
```

### ⚠️ SCHEMA GAPS

#### `receipts` table
- ❌ Missing `organization_id` (should link to shop that performed work)
- ❌ Missing `work_order_id` (if work was part of a work order)

#### `vehicle_timeline_events`
- ⚠️ Has `metadata` but not strongly typed org linkage
- ❌ Should have explicit `organization_id` for "serviced_at" events

#### `organization_offerings`
- ⚠️ Exists but unused (no trades happening)
- ⚠️ Price updates not automated

#### `organization_contributors`
- ⚠️ No contribution scoring/tiering
- ⚠️ No reputation metrics

---

## UI/UX Audit

### Organization Profile Page

**What Works** ✅:
- Clean layout with tabs
- Primary image as hero
- Price header with stock info
- Timeline shows events
- Images gallery with metadata
- Inventory system
- Contributors list

**What's Broken/Missing** ⚠️:
- "Trade Shares" button → opens placeholder modal
- No way to link vehicles from this page
- No "Add Work Order" button
- GPS-tagged images don't show on map
- Tags from AI scan not displayed in UI
- Search/filter not implemented

---

### Missing Pages/Flows

#### ❌ Organizations Directory
- No `/organizations` page with search/browse
- Can't discover orgs like you can discover vehicles
- No filters (by type, location, etc.)

#### ❌ Create Organization Flow
- Have `/org/create` but it's basic
- No multi-step wizard
- No location picker/map
- No "claim existing org" vs "create new"

#### ❌ Work Order Profile
- `/work-order/:id` doesn't exist
- No UI to create work orders
- No way to link images to work orders

#### ❌ User Contribution History
- User profile doesn't show org contributions
- No "I documented 50 hours of work at 3 shops"
- No portfolio of contributions

---

## Trading System Audit

### What Exists

```typescript
✅ organization_offerings (stocks table)
✅ organization_share_holdings (user positions)
✅ organization_market_orders (order book)
✅ organization_market_trades (trade history)
✅ place-market-order edge function (supports orgs)
```

### What's Broken

```typescript
❌ TradePanel not fully wired for orgs
⚠️ Portfolio page shows vehicle stocks but not org stocks
❌ No price feed/updates for org stocks
❌ Market depth/order book not displayed
❌ "Trade Shares" button opens placeholder
```

### Fix Needed

Update `OrganizationProfile.tsx` to use working `TradePanel`:

```typescript
// Current (placeholder):
{showTrade && (
  <div>Placeholder trade modal</div>
)}

// Should be:
{showTrade && (
  <TradePanel
    assetType="organization"
    assetId={organization.id}
    assetName={organization.business_name}
    offeringId={offering?.id}
    currentPrice={offering?.current_share_price}
    availableShares={offering?.total_shares}
    onClose={() => setShowTrade(false)}
  />
)}
```

---

## Image Pipeline Audit

### ✅ WORKING

1. **EXIF Extraction**
   - Date taken, GPS, camera info extracted
   - Reverse geocoding (GPS → location name)
   - Timeline uses EXIF dates

2. **AI Scanning**
   - Edge function deployed
   - Extracts tags, inventory, description
   - High confidence items saved to DB

3. **Storage & Display**
   - Images uploaded to Supabase storage
   - Full-res display in lightbox
   - Metadata displayed

### ⚠️ GAPS

1. **Image Variants**
   - Still using same URL for large/thumbnail
   - Not generating optimized sizes
   - Slow load for galleries

2. **AI Scan UI**
   - Tags extracted but not shown in image viewer
   - No "Show all images tagged X"
   - No tag search/filter

3. **Batch Operations**
   - No "Scan All Images" button
   - No bulk delete
   - No bulk re-categorize

---

## Timeline Event Cascade Audit

### Your Vision
> "if a user uploads to a vehicle profile a set of images, and they work for an org, the vehicle, the user and the org all get timeline events"

### Current State

```
Image Upload to Organization
    ↓
✅ Creates: business_timeline_events (org timeline)
✅ Creates: organization_contributors (attribution)
❌ MISSING: user_contributions (user timeline)
❌ MISSING: Cross-reference if user is employee
```

### What's Missing

1. **User Timeline**
   - No table to track "User X uploaded images to Org Y"
   - User profile doesn't show contributions

2. **3-Entity Propagation**
   - Vehicle image upload only creates vehicle timeline
   - Doesn't propagate to org (if user is employee)
   - Doesn't create user contribution record

3. **Work Order Link**
   - Images uploaded to org don't link to work orders
   - No "This is part of Work Order #123"

---

## Critical Path to Full Implementation

### Phase 1: Fix Existing Features (1-2 days)

#### Priority 1: Trading System
- [ ] Wire up `TradePanel` to "Trade Shares" button
- [ ] Add org stocks to Portfolio page
- [ ] Test buy/sell flow end-to-end

#### Priority 2: Display AI Tags
- [ ] Show tags below images in viewer
- [ ] Add tag filter to images gallery
- [ ] "Show all images tagged X"

#### Priority 3: Organizations Directory
- [ ] Create `/organizations` page
- [ ] List all orgs with search
- [ ] Filter by type, location
- [ ] "Add Organization" button prominent

---

### Phase 2: Work Orders (3-5 days)

This is **critical** for your vision ("boat engines as standalone entities").

- [ ] Create work orders database schema
- [ ] Build WorkOrderProfile page (like VehicleProfile)
- [ ] "Create Work Order" flow from org dashboard
- [ ] Link images to work orders
- [ ] Work order timeline with progress
- [ ] "Link to Vehicle" when work is installed

**See**: `/docs/UNIVERSAL_IMAGE_TIMELINE_SYSTEM.md` for complete design

---

### Phase 3: Timeline Cascade (2-3 days)

Implement universal 3-entity timeline propagation:

- [ ] Create `user_contributions` table
- [ ] Every image upload → creates 3 events:
  - User contribution record
  - Entity timeline (vehicle/org/work order)
  - Organization timeline (if user is employee)
- [ ] User profile shows contribution history
- [ ] Reputation/scoring system

---

### Phase 4: GPS Auto-Tagging (2 days)

- [ ] GPS matching algorithm
- [ ] "This image was taken at [Org]. Link it?" prompts
- [ ] Auto-tag work orders to orgs by GPS
- [ ] Map view of org locations with images

---

### Phase 5: Receipt → Org Linking (1-2 days)

- [ ] Add `organization_id` to receipts
- [ ] Receipt shows "Work performed at: [Shop]"
- [ ] Org timeline shows customer transactions
- [ ] Click shop name → org profile

---

## Immediate Action Items

### 1. Test AI Scanning (TODAY)
```bash
# Go to Desert Performance
# Click 🔍 on an engine image
# Verify tags extracted
# Check database for results
```

### 2. Fix Trading UI (TODAY)
```typescript
// In OrganizationProfile.tsx, replace placeholder with:
import TradePanel from '../components/trading/TradePanel';

{showTrade && offering && (
  <TradePanel
    assetType="organization"
    assetId={organization.id}
    assetName={organization.business_name}
    offeringId={offering.id}
    currentPrice={offering.current_share_price}
    availableShares={offering.total_shares}
    onClose={() => setShowTrade(false)}
  />
)}
```

### 3. Show AI Tags in UI (TODAY)
Add to image viewer in `OrganizationProfile.tsx`:
```typescript
// After GPS coordinates, add:
{img.ai_scanned && (
  <div style={{ marginTop: '6px' }}>
    <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: '2px' }}>
      Tags:
    </div>
    {/* Fetch and display tags from organization_image_tags */}
  </div>
)}
```

---

## Summary

### ✅ Working Well
- Image management (delete, primary, scan)
- EXIF extraction
- AI scanning backend
- Timeline display
- Basic org profile
- Contributor tracking

### ⚠️ Needs Fixing
- Trading UI not wired up
- AI tags not displayed
- No org directory/search
- User contributions not tracked

### ❌ Critical Missing Features
- **Work Orders** (highest priority for your vision)
- Timeline cascade (3-entity propagation)
- GPS auto-tagging
- Receipt → org linking
- User contribution history/portfolio

---

## Recommendation

**Start with quick wins (Phase 1)** to get existing features fully functional:
1. Wire trading UI (30 min)
2. Display AI tags (1 hour)
3. Build orgs directory page (2 hours)

**Then tackle Work Orders (Phase 2)** - this is the game-changer for your "boat engines" use case.

Ready to proceed? Which phase should I start with?

