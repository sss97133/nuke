# Organization System Review & Cleanup Session

**Purpose:** Comprehensive discussion and cleanup of the organization system - backend structure, frontend presentation, user-operator relationships, permissions, and real-world handover.

---

## CURRENT STATE: A Mess

### The Big Problem
**TWO tables exist for organizations:**
| Table | Records | Used By |
|-------|---------|---------|
| `organizations` | 30 | Legacy - vehicles.selling_organization_id |
| `businesses` | 282 | Frontend, contributors, all new features |

The `organization_contributors` table has a foreign key to `businesses`, NOT `organizations`. The frontend queries `businesses`. This dual-table situation is confusing.

### Data Quality Issues

**Duplicates:**
- "RM Sotheby's" (dealer) AND "RM Sothebys" (auction_house)
- "Bonhams" appears twice (once as dealer, once as auction_house)

**Wrong Types:**
- Bonhams, RM Sotheby's listed as "dealer" when they're auction houses
- No distinction between auction_house subtypes (collector car vs general)

**Missing Data:**
```
     type      | count | has_logo | has_desc | verified
---------------+-------+----------+----------+----------
 dealer        |    20 |        3 |       20 |        2
 auction_house |     9 |        0 |        4 |        0
 shop          |     1 |        0 |        0 |        0
```

**Missing Slugs (can't access via URL):**
- Barrett-Jackson
- Gooding and Company
- Mecum Auctions
- RM Sothebys (the duplicate)

---

## DATABASE ARCHITECTURE

### Primary Tables

**`businesses`** (the active table - 90+ columns!)
```sql
-- Core identity
id, business_name, legal_name, business_type, description
slug (missing), logo_url, banner_url

-- Contact & location
email, phone, website, address, city, state, zip_code, country
latitude, longitude, geographic_key

-- Capabilities
specializations[], services_offered[], industry_focus[]
has_lift, has_paint_booth, has_dyno, has_alignment_rack
accepts_dropoff, offers_mobile_service

-- Performance metrics
total_vehicles, total_images, total_events
total_projects_completed, total_reviews
average_project_rating, repeat_customer_rate

-- Business metrics (investors)
total_sold, total_revenue, gross_margin_pct
inventory_turnover, avg_days_to_sell, gmv

-- Status
is_verified, verification_level (unverified/basic/premium/elite)
is_public, is_tradable, stock_symbol
status (active/inactive/suspended/for_sale/sold)

-- Ownership tracking
discovered_by, uploaded_by
```

**`organization_contributors`** (user-org relationships)
```sql
id, organization_id (→ businesses), user_id (→ auth.users)
role CHECK (owner, co_founder, board_member, manager, employee,
            technician, contractor, moderator, contributor,
            photographer, historian)
status CHECK (active, inactive, pending)
start_date, end_date
contribution_count, notes
```

**`business_ownership`** (alternative ownership model)
```sql
business_id (→ businesses), owner_id (→ auth.users)
ownership_percentage, status
```

### All 53 Org-Related Tables
```
business_ownership               organization_analysis_queue
business_team_data              organization_article_queue
business_timeline_events        organization_capabilities
business_type_taxonomy          organization_contributors
business_user_roles             organization_etf_holdings
business_vehicle_fleet          organization_followers
businesses                      organization_hierarchy
contributor_documentation       organization_image_tags
contributor_onboarding          organization_images
dealer_inventory               organization_inventory
dealer_inventory_seen          organization_inventory_sync_queue
dealer_pdi_checklist           organization_market_orders
dealer_sales_summary           organization_market_trades
dealer_sales_transactions      organization_narratives
dealer_site_schemas            organization_offerings
dealer_specs                   organization_ownership_verifications
dealer_vehicle_specs           organization_revenue_summary
org_assets                     organization_services
org_audit_log                  organization_share_holdings
organization_activity_view     organization_vehicle_notifications
                               organization_vehicles
                               organization_website_mappings
                               organizations (legacy!)
```

---

## FRONTEND ARCHITECTURE

### Pages
| File | Route | Purpose |
|------|-------|---------|
| `Organizations.tsx` | `/org` | Browse all orgs (queries `businesses`) |
| `OrganizationProfile.tsx` | `/org/:id` | Single org detail |
| `MyOrganizations.tsx` | `/my-orgs` | User's affiliated orgs |
| `CreateOrganization.tsx` | `/org/create` | Create new org |

### Components (21 total)
```
components/organization/
├── OrganizationCard.tsx          - Grid card display
├── OrganizationEditor.tsx        - Edit form
├── OrganizationQuickView.tsx     - Popup preview
├── OrganizationLocationPicker.tsx - Map/address picker
├── OrganizationOverviewTab.tsx   - Profile overview tab
├── OrganizationMembersTab.tsx    - Team members tab
├── OrganizationInventoryTab.tsx  - Vehicle inventory tab
├── OrganizationVehiclesTab.tsx   - Associated vehicles
├── OrganizationAuctionsTab.tsx   - Auction history
├── OrganizationImagesTab.tsx     - Photo gallery
├── OrganizationServiceTab.tsx    - Services offered
├── OrganizationTimeline.tsx      - Activity timeline
├── OrganizationTimelineTab.tsx   - Timeline tab
├── OrganizationTimelineHeatmap.tsx - Activity heatmap
├── OrganizationNotifications.tsx - Notification settings
├── OrganizationInvestmentCard.tsx - Investment metrics
└── ...
```

---

## USER → OPERATOR FLOW

### Current Roles System
```
organization_contributors.role:
  owner         - Full control, can transfer ownership
  co_founder    - Near-full control
  board_member  - Strategic decisions
  manager       - Day-to-day operations
  employee      - Standard access
  technician    - Service/work focused
  contractor    - External contributor
  moderator     - Community/content
  contributor   - General contributor
  photographer  - Media focused
  historian     - Archive/documentation
```

### Current RLS Policies (on businesses)
```sql
-- Anyone can view public orgs
"Anyone views public orgs" FOR SELECT
  USING (is_public = true)

-- Owners can update
"Owners/contributors update orgs" FOR UPDATE
  USING (
    auth.uid() = discovered_by
    OR EXISTS (SELECT 1 FROM organization_contributors oc
               WHERE oc.organization_id = businesses.id
               AND oc.user_id = auth.uid()
               AND oc.status = 'active'
               AND oc.role IN ('owner','co_founder','board_member','manager'))
    OR EXISTS (SELECT 1 FROM organization_ownership_verifications oov
               WHERE oov.organization_id = businesses.id
               AND oov.user_id = auth.uid()
               AND oov.status = 'approved')
  )
```

### Verification Workflow
```
organization_ownership_verifications:
  user_id claims ownership of organization_id
  verification_method (email, document, phone, domain, physical)
  status (pending, approved, rejected, expired)
  verified_by, verified_at
```

---

## DATABASE ACCESS

```bash
# Direct psql connection
PGPASSWORD='RbzKq32A0uhqvJMQ' psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres
```

### Diagnostic Queries

```sql
-- Find duplicates (by name similarity)
SELECT name, COUNT(*)
FROM (
  SELECT business_name as name FROM businesses WHERE is_public = true
  UNION ALL
  SELECT name FROM organizations
) combined
GROUP BY name HAVING COUNT(*) > 1;

-- Organizations missing critical data
SELECT business_name,
       CASE WHEN logo_url IS NULL THEN 'no' ELSE 'yes' END as has_logo,
       CASE WHEN description IS NULL THEN 'no' ELSE 'yes' END as has_desc,
       is_verified
FROM businesses
WHERE is_public = true
ORDER BY is_verified DESC, business_name;

-- Check organization_contributors usage
SELECT b.business_name, COUNT(oc.id) as contributor_count,
       STRING_AGG(DISTINCT oc.role, ', ') as roles
FROM businesses b
LEFT JOIN organization_contributors oc ON oc.organization_id = b.id AND oc.status = 'active'
WHERE b.is_public = true
GROUP BY b.id, b.business_name
ORDER BY contributor_count DESC;

-- Find orgs referenced in vehicles but not in businesses
SELECT DISTINCT v.selling_organization_id
FROM vehicles v
WHERE v.selling_organization_id IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM businesses b WHERE b.id = v.selling_organization_id);
```

---

## VISION: Elegant Org Profiles

**Goal:** Organization profiles should be as polished as vehicle profiles.

### What Good Looks Like
- **Hero image** with logo overlay
- **Clear identity**: Name, type, location, established date
- **Rich description** with specializations
- **Verification badge** for trusted organizations
- **Team section** showing key people
- **Vehicle inventory** with high-quality images
- **Service history** timeline
- **Metrics** appropriate to org type:
  - Auction houses: Total sales volume, average hammer price
  - Dealers: Inventory count, days to sell
  - Shops: Projects completed, customer rating

### What's Currently Wrong
- Generic card grid with no personality
- Missing images (most orgs have no logo)
- No hero images or banners
- Duplicates showing as separate entries
- Unverified major auction houses
- Mix of incomplete and abandoned entries

---

## CLEANUP PRIORITIES

### Phase 1: Data Deduplication
1. Identify and merge duplicate organizations
2. Correct mistyped organization types
3. Generate slugs for all orgs
4. Hide or delete abandoned/empty entries

### Phase 2: Data Enrichment
1. Add logos for major auction houses
2. Write descriptions for top organizations
3. Add verified status for known legitimate orgs
4. Populate location data (lat/lng for map)

### Phase 3: Schema Cleanup
1. Decide: Keep `organizations` table or migrate to `businesses`?
2. Clean up the 90+ columns on `businesses` - many seem unused
3. Standardize on one ownership model (contributors vs ownership)

### Phase 4: Frontend Polish
1. Improve card design with better hierarchy
2. Add hero image/banner support
3. Better empty states
4. Type-specific metric displays

---

## DISCUSSION QUESTIONS

### Architecture
1. Should we consolidate `organizations` and `businesses` into one table?
2. Which ownership model should win: `organization_contributors` or `business_ownership`?
3. Are all 53 org-related tables actually used?

### User Flow
1. How does a real-world shop owner claim their digital profile?
2. What verification methods make sense? (email domain, physical visit, document)
3. How do we handle "discovered" orgs vs "claimed" orgs?

### Permissions
1. What can each role actually do?
2. Should employees be able to add inventory?
3. Can contractors submit work without manager approval?

### Data Quality
1. How do we prevent duplicate creation?
2. Should we auto-merge based on name/address similarity?
3. What's the minimum data needed for a public org?

---

## KEY FILES

### Backend
| File | Purpose |
|------|---------|
| `supabase/migrations/` | All schema definitions |
| Organization-related functions | Need to identify |

### Frontend
| File | Purpose |
|------|---------|
| `/src/pages/Organizations.tsx` | Main browse page |
| `/src/pages/OrganizationProfile.tsx` | Detail page |
| `/src/services/organizationSearch.ts` | Search service |
| `/src/components/organization/*.tsx` | All org components |

---

## SESSION GOALS

1. **Understand** the current mess (dual tables, duplicates, missing data)
2. **Discuss** the ideal architecture for orgs
3. **Plan** the cleanup in prioritized phases
4. **Decide** on user-operator handover flow
5. **Execute** immediate wins (merge dupes, fix types, add slugs)

---

## READY TO START

Review this document, then:
1. Ask clarifying questions about business requirements
2. Propose a cleanup plan with priorities
3. Execute fixes starting with most impactful

I'm ready to discuss the organization system in depth.
