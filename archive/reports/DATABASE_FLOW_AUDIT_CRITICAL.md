# VEHICLE PROFILE - DATABASE & DATA FLOW AUDIT

**Date:** November 1, 2025  
**Scope:** Complete analysis of database schema, data flow, and architectural problems

---

## EXECUTIVE SUMMARY

The VehicleProfile system suffers from **severe database fragmentation** with **40+ tables**, **redundant data storage**, **unclear data ownership**, and **circular dependencies**. The frontend makes **dozens of separate database queries** to load a single page, with no caching or optimization strategy.

**Critical Issues:**
1. Data spread across 40+ tables with no clear hierarchy
2. Same data stored in multiple places (price in 3+ tables)
3. Frontend makes 15-20 separate queries to load one vehicle
4. No materialized views or computed columns for performance
5. Inconsistent naming (timeline_events vs vehicle_timeline_events)
6. Duplicate permission checking logic (3 different tables)
7. No clear distinction between "source of truth" tables and derived views

---

## DATABASE SCHEMA ANALYSIS

### CORE VEHICLE DATA (4 tables - MESSY)

#### 1. **vehicles** (PRIMARY TABLE)
**Location:** `20250101_minimal_setup.sql`  
**Columns:** 50+ fields including:
- Basic info: `make`, `model`, `year`, `vin`, `color`
- Specs: `engine_size`, `horsepower`, `transmission`, `drivetrain`
- Pricing: `msrp`, `current_value`, `purchase_price`
- Ownership: `user_id`, `purchase_date`, `previous_owners`
- Metadata: `is_public`, `created_at`, `updated_at`

**PROBLEM:** This is a **god table** with too many responsibilities. Pricing, specs, and ownership should be separate.

#### 2. **vehicle_dynamic_data** (EXPANDABLE FIELDS)
**Location:** `20250908201210_enhanced_data_provenance_fix.sql`  
**Purpose:** Store additional fields not in vehicles table  
**Columns:**
- `field_name`, `field_value`, `field_type`
- `field_category`: specs, pricing, history, maintenance, legal
- `is_verified`, `created_at`

**PROBLEM:** Why do we have BOTH `vehicles.horsepower` AND `vehicle_dynamic_data` rows for horsepower? **Redundant storage**.

#### 3. **vehicle_field_sources** (DATA PROVENANCE)
**Location:** `20250908201210_enhanced_data_provenance_fix.sql`  
**Purpose:** Track where each field came from (AI, human, scraper)  
**Columns:**
- `field_name`, `source_type` (human_input, ai_scan, ocr)
- `confidence_score`, `is_verified`
- `source_url`, `source_image_id`, `ai_reasoning`

**PROBLEM:** This tracks sources for fields, but which table's fields? `vehicles`? `vehicle_dynamic_data`? Both? **Unclear relationship**.

#### 4. **vehicle_field_annotations** (MORE PROVENANCE)
**Location:** `20250119_data_annotation_schema.sql`  
**Purpose:** Annotate vehicle fields with confidence scores  
**Columns:**
- `field_name`, `field_value`
- `data_source_id` → references `vehicle_data_sources`
- `confidence_score`, `verification_status`

**PROBLEM:** We now have **TWO provenance tables** (`vehicle_field_sources` and `vehicle_field_annotations`). Which one to use? **Duplicate systems**.

---

### IMAGE DATA (3 tables + storage)

#### 1. **vehicle_images** (CORE)
**Location:** `20250117_vehicle_images_table.sql`  
**Columns:**
- `vehicle_id`, `user_id`, `image_url`
- `image_type`, `image_category`, `category` (3 category fields!)
- `is_primary`, `position`, `caption`
- **NEW:** `thumbnail_url`, `medium_url`, `large_url`, `optimization_status`

**PROBLEMS:**
- **3 category fields:** `image_type`, `image_category`, `category` (backward compat)
- Images link to `vehicles.id` but pricing/timeline need to link back
- No `exif_data` column (stored in separate query?)

#### 2. **image_tags** (AI TAGGING)
**Not found in migrations** - where is this?

#### 3. **image_analysis** (AI VISION)
**Not found in migrations** - where is this?

---

### TIMELINE & EVENTS (3+ tables - CIRCULAR MESS)

#### 1. **timeline_events** (CORE TABLE)
**Location:** `20250118_timeline_events_schema.sql`  
**Columns:**
- `vehicle_id`, `user_id`, `event_type`, `event_category`
- `title`, `description`, `event_date`, `mileage_at_event`
- `source_type`: user_input, service_record, receipt
- `confidence_score`, `verification_status`
- `receipt_amount`, `documentation_urls[]`
- `affects_value`, `affects_safety`, `affects_performance`

**GOOD:** Single source of truth for events.

#### 2. **vehicle_timeline_events** (VIEW? TABLE?)
**Location:** Referenced in code but not in migrations  
**Purpose:** "Enriched view" with computed fields  
**Columns:** Same as timeline_events + `participant_count`, `verification_count`, `service_info`

**PROBLEM:** Is this a **VIEW** or a **TABLE**? Code treats it like a table. If it's a view, where's the migration?

#### 3. **vehicle_documents** (DOCUMENTS)
**Location:** `20250920_document_management.sql`  
**Columns:**
- `vehicle_id`, `document_type`, `title`, `document_date`
- `file_url`, `privacy_level`, `contains_pii`
- `extracted_data` (JSONB), `vendor_name`, `amount`
- **LINK:** `timeline_event_id` → references `timeline_events(id)`

**PROBLEM:** **Circular dependency!**
- `vehicle_documents.timeline_event_id` → `timeline_events.id`
- `timeline_events.documentation_urls[]` → document URLs

Which creates which first? Document or event? **Chicken-and-egg problem**.

---

### PRICING & VALUATION (DISASTER - 5+ places)

#### WHERE IS VEHICLE PRICE STORED?

1. **vehicles.current_value** - Main current value field
2. **vehicles.purchase_price** - Original purchase price
3. **vehicles.msrp** - Original MSRP
4. **vehicle_dynamic_data** - Can store `field_name='current_value'`
5. **timeline_events.receipt_amount** - Costs from events
6. **vehicle_documents.amount** - Document extracted amounts
7. **vehicle_price_history** - Not found, does this exist?
8. **vehicle_valuations** - Not found, where are AI valuations?

**PROBLEM:** **NO SINGLE SOURCE OF TRUTH FOR PRICING!**

Frontend VehiclePricingSection shows:
- Estimated Value
- Documented Investments
- Valuation Breakdown

**WHERE DOES THIS DATA COME FROM?**  
Code doesn't show - it's all scattered or missing!

---

### PERMISSIONS & OWNERSHIP (3 tables - REDUNDANT)

#### 1. **vehicles.user_id** (BASIC OWNERSHIP)
Simple: vehicle belongs to user_id

#### 2. **vehicle_contributors** (COLLABORATIVE)
**Location:** Not in migrations (where is this?)  
**Purpose:** Multiple users can contribute to one vehicle  
**Roles:** owner, co_owner, restorer, moderator, consigner

#### 3. **vehicle_user_permissions** (GRANULAR)
**Location:** `database/queries/EXECUTE_NOW.sql`  
**Purpose:** Fine-grained permissions  
**Roles:** owner, co_owner, sales_agent, mechanic, appraiser, dealer_rep, inspector

#### 4. **vehicle_service_roles** (PROFESSIONAL)
**Location:** `database/queries/RUN_NOW_PROFESSIONAL_SYSTEM.sql`  
**Purpose:** Professional service provider access  
**Roles:** mechanic, appraiser, detailer, inspector, photographer

**PROBLEM:** We have **4 DIFFERENT PERMISSION SYSTEMS!**
- Which one is used by VehicleProfile?
- `useVehiclePermissions` hook checks `vehicle_contributors`
- But `vehicle_user_permissions` and `vehicle_service_roles` also exist
- **Complete chaos!**

---

### COMMENTS (3 tables - OK)

1. **vehicle_comments** - Comments on vehicle
2. **timeline_event_comments** - Comments on events
3. **data_point_comments** - Comments on specific fields

**ASSESSMENT:** This is actually reasonable. 3 different comment contexts.

---

### TRADING/FINANCIAL (6+ tables - MOSTLY FAKE)

1. **vehicle_offerings** - Trading pairs for fractional ownership
2. **user_cash_balances** - User cash accounts
3. **market_orders** - Order book
4. **share_holdings** - Portfolio positions
5. **vehicle_bonds** - Bond investments (fake/coming soon)
6. **vehicle_stakes** - Staking system (fake/coming soon)

**PROBLEM:** These tables exist but frontend shows fake "Financial Products" UI with hardcoded data. **Database not connected to UI.**

---

## DATA FLOW ANALYSIS

### HOW VEHICLEPROFILE LOADS DATA

#### Page Load Sequence (from code inspection):

```typescript
1. loadVehicle() → SELECT * FROM vehicles WHERE id = vehicleId
2. checkAuth() → getSession()
3. useVehiclePermissions() → SELECT * FROM vehicle_contributors WHERE vehicle_id = ...
4. loadTimelineEvents() → SELECT * FROM vehicle_timeline_events WHERE vehicle_id = ...
   - If empty, fallback: SELECT * FROM vehicle_images WHERE vehicle_id = ... (derive events)
5. VehicleHeader → queries vehicles table again (DUPLICATE!)
6. VehicleHeroImage → queries vehicles.hero_image
7. VehiclePricingSection → WHERE DOES THIS QUERY? Unknown!
8. VehicleBasicInfo → uses vehicle from state
9. VehicleImageGallery → SELECT * FROM vehicle_images WHERE vehicle_id = ...
10. VehicleCommentsSection → SELECT * FROM vehicle_comments WHERE vehicle_id = ...
11. FinancialProducts → queries vehicle_offerings, share_holdings (may not exist)
12. VehicleShareHolders → queries supporter data (where?)
13. WorkMemorySection → queries work_sessions (where?)
14. EnhancedImageTagger → queries image_tags (where?)
15. VehicleTagExplorer → queries tag data (where?)
```

**PROBLEM:** **15-20 separate database queries** to load one page!

No:
- Batching
- Joins
- Materialized views
- Caching
- Single query with relations

---

### MISSING CRITICAL TABLES

Based on component usage, these tables are referenced but **NOT IN MIGRATIONS:**

1. **vehicle_timeline_events** - Is this a view or table?
2. **image_tags** - Image tagging system
3. **image_analysis** - AI vision results
4. **vehicle_valuations** - AI-generated valuations
5. **vehicle_price_history** - Price tracking over time
6. **work_sessions** - Professional work tracking
7. **vehicle_supporters** - User support/backing system

Either:
- Tables exist but migrations are missing
- Features are partially implemented
- Code references tables that don't exist yet

---

### DATA CONSISTENCY PROBLEMS

#### Problem 1: Price Updates
**Scenario:** Owner changes `vehicles.current_value`

**What should happen:**
1. Update `vehicles.current_value`
2. Create `vehicle_price_history` record
3. Recalculate `share_holdings.current_mark` if fractional
4. Update `vehicle_valuations` confidence
5. Trigger timeline event?

**What actually happens:**  
Just updates `vehicles.current_value`. **No cascade, no history, no consistency**.

#### Problem 2: Document Upload
**Scenario:** User uploads invoice PDF

**What should happen:**
1. Upload to storage → get URL
2. Create `vehicle_documents` record
3. Extract data with AI (vendor, amount, date)
4. Create `timeline_events` record with extracted data
5. Update `vehicles.current_value` if affects value
6. Create `vehicle_price_history` if price changed

**What actually happens:**
1. Upload to storage
2. Create document record
3. ...then it breaks or does nothing

**Why:** Circular dependency - document needs timeline_event_id, but timeline event needs document URL.

#### Problem 3: Image Upload
**Scenario:** User uploads photo

**What should happen:**
1. Upload to storage → get URL
2. Create `vehicle_images` record
3. Extract EXIF data (date, GPS)
4. Generate variants (thumbnail, medium, large)
5. Run AI vision analysis
6. Create image_tags
7. Optionally create timeline event for date

**What actually happens:**
1. Upload
2. Create vehicle_images
3. EXIF extraction happens somewhere (where?)
4. Variants created by Edge Function (where?)
5. AI analysis... maybe?

**No clear orchestration or state management.**

---

## ARCHITECTURAL PROBLEMS

### 1. NO CLEAR DATA HIERARCHY

**Question:** What's the primary key for a vehicle's data?

**Answer:** Unclear!

- `vehicles.id` is the UUID
- But data is in `vehicles`, `vehicle_dynamic_data`, `vehicle_field_sources`, `vehicle_field_annotations`
- Which table is "truth"?
- How do you know if a field is in vehicles or dynamic_data?

**Recommendation:** Define clear layers:
- **Layer 1 (Core):** `vehicles` table - immutable vehicle identity
- **Layer 2 (Specs):** `vehicle_specs` table - technical specifications
- **Layer 3 (Ownership):** `vehicle_ownership` table - ownership history
- **Layer 4 (Pricing):** `vehicle_pricing` table - current + historical prices
- **Layer 5 (Events):** `timeline_events` - temporal history

### 2. REDUNDANT PERMISSION SYSTEMS

**4 different tables** for permissions:
- vehicles.user_id
- vehicle_contributors
- vehicle_user_permissions
- vehicle_service_roles

**Recommendation:** Pick ONE and use it everywhere.

Suggested: **vehicle_permissions** with role hierarchy:
```sql
CREATE TABLE vehicle_permissions (
  id UUID PRIMARY KEY,
  vehicle_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role TEXT NOT NULL, -- owner, contributor, viewer, editor, etc.
  granted_by UUID,
  granted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  UNIQUE(vehicle_id, user_id)
);
```

### 3. NO COMPUTED/MATERIALIZED VIEWS

**Every query re-computes:**
- Timeline event counts
- Image counts
- Comment counts
- Verification status
- Profile completion percentage

**Recommendation:** Create materialized views:
```sql
CREATE MATERIALIZED VIEW vehicle_summary AS
SELECT 
  v.id,
  v.year, v.make, v.model,
  COUNT(DISTINCT vi.id) as image_count,
  COUNT(DISTINCT te.id) as event_count,
  COUNT(DISTINCT vc.id) as comment_count,
  MAX(te.event_date) as last_activity,
  -- ... more computed fields
FROM vehicles v
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
LEFT JOIN timeline_events te ON v.id = te.vehicle_id
LEFT JOIN vehicle_comments vc ON v.id = vc.vehicle_id
GROUP BY v.id;
```

Refresh on updates with triggers.

### 4. CIRCULAR DEPENDENCIES

**vehicle_documents ↔ timeline_events:**
- Documents reference timeline_event_id
- Timeline events reference documentation_urls

**Recommendation:** Break the circle:
- timeline_events is primary
- vehicle_documents only stores file metadata
- Link table: `timeline_event_documents(event_id, document_id)`

### 5. NO CACHING STRATEGY

Frontend makes 15-20 queries per page load with:
- No request batching
- No query result caching
- No optimistic updates
- No local state management (Redux/Zustand)

**Recommendation:**
- Use React Query for caching
- Batch queries with Supabase RPC
- Implement optimistic updates
- Cache user session and permissions

---

## PERFORMANCE ANALYSIS

### Current Query Pattern

```typescript
// Page load = 15-20 sequential queries!
const vehicle = await supabase.from('vehicles').select('*').eq('id', id).single();
const permissions = await supabase.from('vehicle_contributors')...
const events = await supabase.from('timeline_events')...
const images = await supabase.from('vehicle_images')...
const comments = await supabase.from('vehicle_comments')...
// ...and 10 more queries
```

**Total Time:** 15 queries × 50ms avg = **750ms minimum**

### Optimized Pattern

```sql
-- Single query with joins
SELECT 
  v.*,
  json_agg(DISTINCT vi.*) as images,
  json_agg(DISTINCT te.*) as timeline_events,
  json_agg(DISTINCT vc.*) as comments,
  COUNT(DISTINCT vi.id) as image_count,
  COUNT(DISTINCT te.id) as event_count
FROM vehicles v
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
LEFT JOIN timeline_events te ON v.id = te.vehicle_id
LEFT JOIN vehicle_comments vc ON v.id = vc.vehicle_id
WHERE v.id = $1
GROUP BY v.id;
```

**Total Time:** 1 query × 100ms = **100ms** (7x faster!)

Or use **Supabase RPC function**:
```typescript
const { data } = await supabase.rpc('get_vehicle_profile', { vehicle_id: id });
// Returns everything in one round-trip
```

---

## RECOMMENDATIONS

### IMMEDIATE FIXES (Week 1)

1. **Document the schema** - Create ER diagram showing all 40+ tables
2. **Identify dead tables** - Remove unused tables from old migrations
3. **Pick ONE permission system** - Deprecate the others
4. **Fix circular dependencies** - timeline_events ↔ documents
5. **Add missing migrations** - vehicle_timeline_events, image_tags, etc.

### SHORT-TERM (Month 1)

6. **Create vehicle_profile RPC** - Single query to get all vehicle data
7. **Add materialized views** - vehicle_summary, vehicle_stats
8. **Implement caching** - React Query for frontend
9. **Batch uploads** - Image + document processing in transactions
10. **Add database triggers** - Auto-update counts, timestamps

### LONG-TERM (Quarter 1)

11. **Restructure pricing** - Single vehicle_pricing table with history
12. **Centralize provenance** - One data_provenance table
13. **Implement event sourcing** - All changes via events
14. **Add read replicas** - Separate read/write databases
15. **Implement CDC** - Change Data Capture for real-time updates

---

## CONCLUSION

The Vehicle Profile system suffers from **"too many cooks in the kitchen"** syndrome. The database evolved organically with:
- 40+ tables added over time
- Multiple permission systems
- Redundant data storage
- No clear data ownership
- Circular dependencies
- Missing migrations for referenced tables

**The frontend compounds this** by making 15-20 separate queries with no caching or batching.

**Impact:**
- Slow page loads (750ms+ just for queries)
- Confusing codebase (which table to use?)
- Data inconsistency (price in 3 places)
- Developer friction (where to add new fields?)
- Difficult to debug (which query failed?)

**Priority:** 🔴 **CRITICAL INFRASTRUCTURE ISSUE**

Fixing this requires:
1. Schema consolidation and documentation
2. Query optimization with RPC functions
3. Caching layer implementation
4. Clear data ownership rules
5. Migration cleanup

**Estimated Time:** 3-4 weeks for complete overhaul

