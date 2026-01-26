# Nuke Ltd Organization Analysis Report
**Generated:** 2026-01-25
**Database:** Nuke Platform (Supabase: qkgaybvrernstplzjaam)

---

## Executive Summary

**Nuke Ltd** exists in the database and serves as an excellent framework test case. The organization has:
- 1 owner/contributor
- 3 vehicles linked (all auto-tagged work locations)
- 1 timeline event (organization creation)
- 1 pending ownership verification (tax ID document)
- 0 images, 0 ownership records, 0 completed verifications

**Status:** Active, Unverified, Public
**Primary Focus:** Mixed (confidence: 0.3)
**Location:** Boulder City, NV

---

## 1. Core Organization Record

### Basic Information
```json
{
  "id": "f32ea08c-c2c5-4ca9-896d-cb99ce6c7bfb",
  "business_name": "Nuke",
  "legal_name": "Nuke Ltd",
  "business_type": "other",
  "status": "active",
  "is_public": true,
  "is_verified": false,
  "verification_level": "unverified"
}
```

### Contact & Location
```json
{
  "email": "info@nukeltd.com",
  "phone": "(314) 192-5352",
  "website": "https://www.nukeltd.com",
  "address": "676 wells rd",
  "city": "boulder city",
  "state": "nv",
  "zip_code": "89005",
  "country": "US",
  "latitude": 35.97720940,
  "longitude": -114.85362400
}
```

### Business Profile
- **Industry Focus:** [] (empty)
- **Specializations:** [] (empty)
- **Services Offered:** [] (empty)
- **Years in Business:** null
- **Employee Count:** null

### Facilities & Capabilities
All service capabilities are set to `false`:
- accepts_dropoff: false
- offers_mobile_service: false
- has_lift: false
- has_paint_booth: false
- has_dyno: false
- has_alignment_rack: false

### Financial Metrics
```json
{
  "hourly_rate_min": null,
  "hourly_rate_max": null,
  "labor_rate": null,
  "estimated_value": null,
  "asking_price": null,
  "is_for_sale": false,
  "current_value": null,
  "is_tradable": false,
  "currency": "USD",
  "tax_rate": null
}
```

### Performance Metrics
```json
{
  "total_projects_completed": 0,
  "total_vehicles_worked": 0,
  "average_project_rating": 0.00,
  "total_reviews": 0,
  "repeat_customer_rate": 0.00,
  "on_time_completion_rate": 0.00,
  "total_sold": 0,
  "total_revenue": 0.00,
  "gross_margin_pct": null,
  "inventory_turnover": null,
  "avg_days_to_sell": null,
  "project_completion_rate": null,
  "repeat_customer_count": 0,
  "gmv": 0.00,
  "receipt_count": 0,
  "listing_count": 0,
  "total_projects": 0
}
```

### Platform Metrics
```json
{
  "total_vehicles": 3,
  "total_images": 0,
  "total_events": 1,
  "total_listings": 0,
  "total_bids": 0,
  "total_comments": 0,
  "total_auction_wins": 0,
  "total_success_stories": 0
}
```

### Brand Assets
```json
{
  "logo_url": "https://images.squarespace-cdn.com/content/v1/660f87f31386427935b72e33/aa5d61d7-35cb-43b8-b029-ae75cde06503/nukelogo.png",
  "banner_url": "https://images.squarespace-cdn.com/content/v1/660f87f31386427935b72e33/aa5d61d7-35cb-43b8-b029-ae75cde06503/nukelogo.png"
}
```

### Data Signals (AI Intelligence)
Last analyzed: **2026-01-23T07:36:28.564062+00:00**

```json
{
  "confidence": 0.3,
  "inferred_type": "unknown",
  "primary_focus": "mixed",
  "vehicles": {
    "total": 3,
    "service": 3,
    "inventory": 0,
    "sold": 1
  },
  "receipts": {
    "total": 0,
    "avg_value": 0,
    "with_labor": 0,
    "with_parts": 0,
    "total_investment": 0
  },
  "timeline": {
    "work_events": 6,
    "total_events": 99,
    "avg_duration_hours": 0
  },
  "images": {
    "total": 258,
    "finished_work": 0,
    "work_in_progress": 0
  }
}
```

**Analysis:** The data signals show 258 images in the system but 0 in `total_images` field, indicating a data inconsistency. The organization has 99 timeline events but only 1 appears in `business_timeline_events`, suggesting events are tracked elsewhere (possibly `timeline_events` table linked via vehicles).

### Timestamps
```json
{
  "created_at": "2025-11-01T22:25:55.690862+00:00",
  "updated_at": "2026-01-21T03:00:19.315+00:00",
  "member_since": "2025-11-01T22:25:55.690862+00:00",
  "intelligence_last_updated": "2026-01-23T07:36:28.564062+00:00"
}
```

### Discovery Information
```json
{
  "discovered_by": "0b9f107a-d124-49de-9ded-94698f63c1c4",
  "discovered_via": null,
  "uploaded_by": "0b9f107a-d124-49de-9ded-94698f63c1c4",
  "source_url": null
}
```

### Search Optimization
```json
{
  "search_keywords": ["nuke ltd", "nv", "other", "nuke", "boulder city"],
  "search_vector": "'boulder':5 'citi':6 'ltd':3 'nuke':1,2 'nv':7"
}
```

---

## 2. Organization Contributors

**Total Contributors:** 1

### Contributor #1
```json
{
  "id": "e44c010d-b360-479d-9f2c-692832c486d6",
  "organization_id": "f32ea08c-c2c5-4ca9-896d-cb99ce6c7bfb",
  "user_id": "0b9f107a-d124-49de-9ded-94698f63c1c4",
  "role": "owner",
  "start_date": "2025-11-01",
  "end_date": null,
  "status": "active",
  "contribution_count": 1,
  "notes": null,
  "created_at": "2025-11-01T22:25:55.832236+00:00",
  "updated_at": "2025-11-01T22:25:55.832236+00:00"
}
```

**Note:** The same user (`0b9f107a-d124-49de-9ded-94698f63c1c4`) appears as:
- Organization creator (`discovered_by`)
- Organization uploader (`uploaded_by`)
- Owner/contributor
- All vehicle linker (`linked_by_user_id`)

---

## 3. Organization Vehicles

**Total Vehicles:** 3 (all auto-tagged work locations)

### Vehicle #1: 1997 Lexus LX450
```json
{
  "id": "9880058b-e093-4391-bd74-cc81235a2982",
  "vehicle_id": "4ecc1fa5-c2c2-485b-bc57-144d6215d22a",
  "vehicle": {
    "id": "4ecc1fa5-c2c2-485b-bc57-144d6215d22a",
    "vin": "JT6HJ88J4V0178097",
    "year": 1997,
    "make": "LEXUS",
    "model": "LX450"
  },
  "relationship_type": "work_location",
  "status": "active",
  "auto_tagged": true,
  "gps_match_confidence": 33.00,
  "receipt_match_count": 0,
  "listing_status": "for_sale",
  "asking_price": null,
  "days_on_lot": 3,
  "user_confirmed": false,
  "user_rejected": false,
  "created_at": "2025-11-30T21:12:43.756246+00:00"
}
```

### Vehicle #2: 1988 Suburban
```json
{
  "id": "057cd038-53f8-44e6-8a5c-c173f207cf82",
  "vehicle_id": "031c94fe-16fe-44f3-817b-f60abd94bb86",
  "vehicle": {
    "id": "031c94fe-16fe-44f3-817b-f60abd94bb86",
    "vin": null,
    "year": 1988,
    "make": "",
    "model": "Suburban"
  },
  "relationship_type": "work_location",
  "status": "active",
  "auto_tagged": true,
  "gps_match_confidence": 33.50,
  "receipt_match_count": 0,
  "listing_status": "for_sale",
  "days_on_lot": 3,
  "user_confirmed": false,
  "created_at": "2025-11-30T21:13:04.886259+00:00"
}
```

### Vehicle #3: 1967 Camaro
```json
{
  "id": "5f45030b-7750-4b2c-be99-1539734b4e21",
  "vehicle_id": "e90512ed-9d9c-4467-932e-061fa871de83",
  "vehicle": {
    "id": "e90512ed-9d9c-4467-932e-061fa871de83",
    "vin": null,
    "year": 1967,
    "make": "",
    "model": "Camaro"
  },
  "relationship_type": "work_location",
  "status": "active",
  "auto_tagged": true,
  "gps_match_confidence": 24.75,
  "receipt_match_count": 0,
  "listing_status": "for_sale",
  "days_on_lot": 4,
  "user_confirmed": false,
  "created_at": "2025-11-29T21:11:17.271626+00:00"
}
```

**Key Observations:**
- All 3 vehicles are auto-tagged (not manually verified)
- GPS match confidence ranges from 24.75% to 33.50% (weak signals)
- All have `relationship_type: "work_location"` (not ownership/inventory)
- All marked `for_sale` but no asking prices
- 2 of 3 vehicles missing VIN
- 2 of 3 vehicles have empty make field
- None have been user-confirmed or user-rejected
- 0 receipt matches across all vehicles

---

## 4. Organization Images

**Total Images:** 0

No images are directly linked to the organization via `organization_images` table.

**Note:** The `data_signals` field shows 258 images, suggesting they may be linked via vehicles rather than directly to the organization.

---

## 5. Business Timeline Events

**Total Events:** 1

### Event #1: Organization Founded
```json
{
  "id": "b15c0cfc-9089-475e-b4e0-2fe3fea35d62",
  "business_id": "f32ea08c-c2c5-4ca9-896d-cb99ce6c7bfb",
  "created_by": "0b9f107a-d124-49de-9ded-94698f63c1c4",
  "event_type": "founded",
  "event_category": "legal",
  "title": "Organization created",
  "description": "Nuke added to the platform",
  "event_date": "2025-11-01",
  "location": null,
  "documentation_urls": [],
  "cost_amount": null,
  "cost_currency": "USD",
  "affects_valuation": false,
  "affects_capacity": false,
  "affects_reputation": false,
  "verification_status": "unverified",
  "confidence_score": 50,
  "metadata": {
    "initial_creator": "0b9f107a-d124-49de-9ded-94698f63c1c4"
  },
  "created_at": "2025-11-01T22:25:55.969843+00:00"
}
```

**Note:** The `data_signals` field shows 99 total timeline events with 6 work events, indicating there are many more events tracked in the `timeline_events` table (likely vehicle-specific events).

---

## 6. Business Ownership Records

**Total Ownership Records:** 0

No formal ownership records exist in the `business_ownership` table, despite having a contributor with role "owner" in `organization_contributors`.

**Expected Behavior:** According to the `create_initial_business_ownership()` trigger function (from migration 20250915000001), a business ownership record should have been created automatically when the business was inserted, with:
- 100% ownership
- ownership_type: 'founder'
- ownership_title: 'Founder/Owner'

**Issue:** This trigger may have failed or the table structure diverged after creation.

---

## 7. Organization Ownership Verifications

**Total Verification Attempts:** 1

### Verification #1: Tax ID Document (Pending)
```json
{
  "id": "409f87d8-a8af-48dd-b73d-4ead930395ff",
  "organization_id": "f32ea08c-c2c5-4ca9-896d-cb99ce6c7bfb",
  "user_id": "0b9f107a-d124-49de-9ded-94698f63c1c4",
  "verification_type": "tax_id",
  "status": "pending",
  "document_url": "https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-data/organization-data/f32ea08c-c2c5-4ca9-896d-cb99ce6c7bfb/ownership/1762036662805_tax_id.pdf",
  "supporting_documents": [],
  "extracted_data": {},
  "ai_confidence_score": null,
  "human_reviewer_id": null,
  "human_review_notes": null,
  "rejection_reason": null,
  "submitted_at": "2025-11-01T22:37:43.72325+00:00",
  "ai_processed_at": null,
  "human_reviewed_at": null,
  "approved_at": null,
  "expires_at": "2026-01-30T22:37:43.72325+00:00",
  "created_at": "2025-11-01T22:37:43.72325+00:00",
  "updated_at": "2025-11-01T22:37:43.72325+00:00"
}
```

**Status:** Pending for 86 days (submitted 2025-11-01, expires 2026-01-30)
**Document:** Tax ID PDF uploaded to Supabase storage
**Processing:** Not yet processed by AI or human reviewer

**Expiration Warning:** This verification expires in 5 days (2026-01-30).

---

## 8. Businesses Table Schema

Based on migration files `20250915000001_create_business_entities.sql` and `20251227120000_add_businesses_metrics_columns.sql`, the full schema includes:

### Core Fields (98 total columns)

#### Identity
- `id` (UUID, PK)
- `business_name` (TEXT, NOT NULL)
- `legal_name` (TEXT)
- `business_type` (TEXT) - CHECK constraint with 17 allowed values
- `type` (TEXT) - additional type field
- `industry_focus` (TEXT[])

#### Legal & Registration
- `business_license` (TEXT)
- `tax_id` (TEXT)
- `registration_state` (TEXT)
- `registration_date` (DATE)
- `dealer_license` (TEXT)

#### Contact Information
- `email` (TEXT)
- `phone` (TEXT)
- `website` (TEXT)

#### Location
- `address` (TEXT)
- `city` (TEXT)
- `state` (TEXT)
- `zip_code` (TEXT)
- `country` (TEXT, DEFAULT 'US')
- `latitude` (DECIMAL 10,8)
- `longitude` (DECIMAL 11,8)
- `geographic_key` (TEXT)

#### Business Details
- `description` (TEXT)
- `specializations` (TEXT[])
- `services_offered` (TEXT[])
- `years_in_business` (INTEGER)
- `employee_count` (INTEGER)
- `facility_size_sqft` (INTEGER)

#### Service Capabilities (BOOLEAN flags)
- `accepts_dropoff` (DEFAULT false)
- `offers_mobile_service` (DEFAULT false)
- `has_lift` (DEFAULT false)
- `has_paint_booth` (DEFAULT false)
- `has_dyno` (DEFAULT false)
- `has_alignment_rack` (DEFAULT false)

#### Business Hours
- `hours_of_operation` (JSONB)

#### Market Data
- `hourly_rate_min` (DECIMAL 10,2)
- `hourly_rate_max` (DECIMAL 10,2)
- `service_radius_miles` (INTEGER)
- `labor_rate` (DECIMAL 10,2)
- `currency` (TEXT, DEFAULT 'USD')
- `tax_rate` (DECIMAL)

#### Reputation & Performance
- `total_projects_completed` (INTEGER, DEFAULT 0)
- `total_vehicles_worked` (INTEGER, DEFAULT 0)
- `average_project_rating` (DECIMAL 3,2, DEFAULT 0)
- `total_reviews` (INTEGER, DEFAULT 0)
- `repeat_customer_rate` (DECIMAL 5,2, DEFAULT 0)
- `on_time_completion_rate` (DECIMAL 5,2, DEFAULT 0)

#### Verification & Trust
- `is_verified` (BOOLEAN, DEFAULT false)
- `verification_date` (TIMESTAMPTZ)
- `verification_level` (TEXT) - CHECK: unverified/basic/premium/elite
- `insurance_verified` (BOOLEAN, DEFAULT false)
- `license_verified` (BOOLEAN, DEFAULT false)

#### Business Status
- `status` (TEXT, DEFAULT 'active') - CHECK: active/inactive/suspended/for_sale/sold
- `is_public` (BOOLEAN, DEFAULT true)

#### Market Value & Trading
- `estimated_value` (DECIMAL 15,2)
- `last_valuation_date` (DATE)
- `is_for_sale` (BOOLEAN, DEFAULT false)
- `asking_price` (DECIMAL 15,2)
- `is_tradable` (BOOLEAN)
- `stock_symbol` (TEXT)
- `current_value` (DECIMAL)

#### Media
- `logo_url` (TEXT)
- `cover_image_url` (TEXT)
- `banner_url` (TEXT)
- `portfolio_images` (TEXT[])

#### Platform Metrics (added 2025-12-27)
- `total_sold` (INTEGER, DEFAULT 0)
- `total_revenue` (DECIMAL 15,2, DEFAULT 0)
- `gross_margin_pct` (DECIMAL 5,2)
- `inventory_turnover` (DECIMAL 10,2)
- `avg_days_to_sell` (DECIMAL 10,2)
- `project_completion_rate` (DECIMAL 5,2)
- `repeat_customer_count` (INTEGER, DEFAULT 0)
- `gmv` (DECIMAL 15,2, DEFAULT 0) - Gross Merchandise Value
- `receipt_count` (INTEGER, DEFAULT 0)
- `listing_count` (INTEGER, DEFAULT 0)
- `total_projects` (INTEGER, DEFAULT 0)
- `primary_focus` (TEXT) - CHECK: service/inventory/mixed

#### Marketplace Metrics
- `total_vehicles` (INTEGER)
- `total_images` (INTEGER)
- `total_events` (INTEGER)
- `total_listings` (INTEGER)
- `total_bids` (INTEGER)
- `total_comments` (INTEGER)
- `total_auction_wins` (INTEGER)
- `total_success_stories` (INTEGER)
- `member_since` (TIMESTAMPTZ)

#### AI/Intelligence
- `data_signals` (JSONB) - Analyzed organization behavior patterns
- `intelligence_last_updated` (TIMESTAMPTZ)
- `ui_config` (JSONB) - User interface configuration
- `has_team_data` (BOOLEAN)

#### Metadata & Discovery
- `metadata` (JSONB, DEFAULT '{}')
- `discovered_by` (UUID)
- `discovered_via` (TEXT)
- `uploaded_by` (UUID)
- `source_url` (TEXT)

#### Search
- `search_keywords` (TEXT[])
- `search_vector` (TSVECTOR)

#### Timestamps
- `created_at` (TIMESTAMPTZ, DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ, DEFAULT NOW())

### Business Type Constraint Values (17 types)
1. sole_proprietorship
2. partnership
3. llc
4. corporation
5. garage
6. dealership
7. restoration_shop
8. performance_shop
9. body_shop
10. detailing
11. mobile_service
12. specialty_shop
13. parts_supplier
14. fabrication
15. racing_team
16. **auction_house** (added 2025-12-16)
17. other

---

## 9. Data Inconsistencies & Issues

### Issue #1: Missing Business Ownership Record
**Severity:** Medium
**Description:** No record in `business_ownership` table despite trigger function
**Expected:** Automatic creation via `create_initial_business_ownership()` trigger
**Actual:** 0 records in `business_ownership`
**Impact:** Ownership percentage tracking, voting rights, acquisition tracking all missing

### Issue #2: Image Count Discrepancy
**Severity:** Low
**Description:** `total_images` field shows 0 but `data_signals.images.total` shows 258
**Possible Cause:** Images linked to vehicles, not directly to organization
**Impact:** Misleading metrics in org profile display

### Issue #3: Timeline Event Count Mismatch
**Severity:** Low
**Description:** Only 1 event in `business_timeline_events` but `data_signals.timeline.total_events` shows 99
**Possible Cause:** Events tracked in `timeline_events` table at vehicle level
**Impact:** Business-level timeline appears empty despite substantial activity

### Issue #4: Low GPS Match Confidence
**Severity:** Medium
**Description:** All vehicle links show 24-33% GPS confidence (weak)
**Status:** All auto-tagged, none user-confirmed
**Impact:** Vehicle-organization relationships may be incorrect

### Issue #5: Incomplete Vehicle Data
**Severity:** Medium
**Description:** 2 of 3 vehicles missing VIN and make fields
**Impact:** Vehicle identification and tracking limitations

### Issue #6: Pending Verification Approaching Expiration
**Severity:** High
**Description:** Tax ID verification pending for 86 days, expires in 5 days
**Impact:** Organization will remain unverified unless processed soon

---

## 10. Test Case Suitability

### Strengths as Test Framework
1. **Real-world complexity:** Has actual data (vehicles, events, images) to test against
2. **Multiple relationships:** Tests vehicle linking, contributor tracking, verification flow
3. **Data quality issues:** Exposes real validation problems (missing VINs, low confidence scores)
4. **AI intelligence:** Has `data_signals` populated, tests analytics functions
5. **Pending state:** Verification in pending state tests workflow completion
6. **Geographic data:** Has lat/long for location-based feature testing
7. **Brand assets:** Has logo/banner URLs for media handling tests

### Weaknesses
1. **Missing ownership records:** Can't test ownership transfer workflows
2. **No financial data:** All revenue/pricing fields are null or zero
3. **No service capabilities:** All facility flags are false
4. **Minimal timeline:** Only 1 business-level event
5. **Unconfirmed relationships:** All vehicle links are auto-tagged, not validated

### Recommended Test Scenarios
1. **Verification workflow:** Process the pending tax_id verification
2. **Vehicle confirmation:** User-confirm or reject the 3 auto-tagged vehicles
3. **Data enrichment:** Populate missing VINs, makes, facility capabilities
4. **Ownership tracking:** Create proper business_ownership record
5. **Timeline expansion:** Add milestone events (equipment purchase, award, expansion)
6. **Financial tracking:** Add receipts, sales, revenue data
7. **Image linking:** Verify the 258 images are properly associated
8. **Intelligence refresh:** Re-run `analyze_organization_data_signals()` after enrichment
9. **Search testing:** Test keyword search and search_vector functionality
10. **RLS policies:** Test access controls with different user roles

---

## 11. Related Tables Schema Reference

### organization_contributors
- Links users to organizations with roles (owner, contributor, etc.)
- Tracks contribution count and date ranges
- Current data: 1 owner

### organization_vehicles
- Links vehicles to organizations with relationship types
- Supports auto-tagging with GPS confidence scoring
- Includes inventory management fields (listing_status, asking_price, days_on_lot)
- Current data: 3 vehicles (all work_location type)

### organization_images
- Direct image-to-organization links
- Separate from vehicle images
- Current data: 0 images

### business_timeline_events
- Organization-level milestone tracking
- 19 event types across 6 categories
- Supports verification and impact assessment
- Current data: 1 event (founded)

### business_ownership
- Formal ownership records with percentages
- Tracks investment amounts and acquisition details
- Supports multiple owners with voting rights
- Current data: 0 records (missing!)

### organization_ownership_verifications
- Document-based verification workflow
- Supports AI and human review stages
- Tracks expiration dates
- Current data: 1 pending verification (tax_id)

---

## 12. SQL Query Results Summary

All queries executed successfully via Supabase REST API:

```sql
-- Query 1: Find Nuke Ltd
SELECT * FROM businesses WHERE business_name ILIKE '%nuke%' OR legal_name ILIKE '%nuke%'
-- Result: 1 row (f32ea08c-c2c5-4ca9-896d-cb99ce6c7bfb)

-- Query 2: Contributors
SELECT * FROM organization_contributors WHERE organization_id = 'f32ea08c-c2c5-4ca9-896d-cb99ce6c7bfb'
-- Result: 1 row (owner role)

-- Query 3: Vehicles with details
SELECT ov.*, v.* FROM organization_vehicles ov
JOIN vehicles v ON v.id = ov.vehicle_id
WHERE ov.organization_id = 'f32ea08c-c2c5-4ca9-896d-cb99ce6c7bfb'
-- Result: 3 rows (1997 Lexus LX450, 1988 Suburban, 1967 Camaro)

-- Query 4: Images
SELECT * FROM organization_images WHERE organization_id = 'f32ea08c-c2c5-4ca9-896d-cb99ce6c7bfb'
-- Result: 0 rows

-- Query 5: Timeline events
SELECT * FROM business_timeline_events WHERE business_id = 'f32ea08c-c2c5-4ca9-896d-cb99ce6c7bfb'
-- Result: 1 row (founded event)

-- Query 6: Ownership
SELECT * FROM business_ownership WHERE business_id = 'f32ea08c-c2c5-4ca9-896d-cb99ce6c7bfb'
-- Result: 0 rows (MISSING)

-- Query 7: Verifications
SELECT * FROM organization_ownership_verifications WHERE organization_id = 'f32ea08c-c2c5-4ca9-896d-cb99ce6c7bfb'
-- Result: 1 row (pending tax_id verification)
```

---

## Appendix A: Business Type Taxonomy Evolution

The `business_type` constraint has been updated at least once:

**Original (2025-09-15):** 16 types (no auction_house)
**Updated (2025-12-16):** 17 types (added auction_house)

This shows the schema is actively maintained and extended as new business categories emerge in the platform.

---

## Appendix B: AI Intelligence Functions

Two key functions power organization intelligence:

### 1. analyze_organization_data_signals(org_id)
- Analyzes vehicles, receipts, timeline events, images
- Infers business type and primary focus
- Returns confidence score (0.0-1.0)
- Updates `data_signals` JSONB field
- Maps inferred types to UI-compatible taxonomy

**Type Inference Logic:**
- Service count > inventory × 2 + labor receipts → body_shop (0.8)
- Inventory > service × 2 → dealership (0.8)
- Service + receipts > 0 → garage (0.6)
- Inventory > 0 → dealership (0.6)
- Fallback → unknown (0.3)

### 2. get_effective_org_config(org_id)
- Returns effective UI configuration with priority cascade
- **Priority 1:** Explicit ui_config (user override)
- **Priority 2:** business_type field
- **Priority 3:** Data-driven inference (data_signals)
- **Fallback:** Default (unknown/mixed)

**Primary Focus Mapping:**
- body_shop/garage/restoration/performance → service
- dealership → inventory
- auction_house → auctions
- other → mixed

---

## Appendix C: Document URLs

**Logo/Banner:**
https://images.squarespace-cdn.com/content/v1/660f87f31386427935b72e33/aa5d61d7-35cb-43b8-b029-ae75cde06503/nukelogo.png

**Tax ID Verification PDF:**
https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-data/organization-data/f32ea08c-c2c5-4ca9-896d-cb99ce6c7bfb/ownership/1762036662805_tax_id.pdf

**Website:**
https://www.nukeltd.com

---

**End of Report**
