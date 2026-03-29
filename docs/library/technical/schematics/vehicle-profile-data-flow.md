# Vehicle Profile Data Flow Schematic

**Last updated:** 2026-03-29
**Scope:** All data flows from database tables through RPCs/queries to React hooks to UI components in the vehicle profile page.

---

## Master Data Flow Diagram

```
+===========================================================================+
|                        VEHICLE PROFILE PAGE                                |
|                                                                            |
|  URL: /vehicle/:vehicleId                                                  |
|  Entry: VehicleProfileProvider (wraps all children)                        |
+===========================================================================+
|                                                                            |
|  +------------------+     +------------------+     +-------------------+   |
|  |   DATABASE        |     |   CONTEXT LAYER   |     |   COMPONENT LAYER |   |
|  |   (Supabase)      | --> |   (React Context)  | --> |   (React UI)      |   |
|  +------------------+     +------------------+     +-------------------+   |
|                                                                            |
+============================================================================+

                     DETAILED DATA FLOW MAP

 +--------------------------+   RPC: get_vehicle_profile_data
 | vehicles                  | ----------------------------------------+
 | vehicle_images             |   (single RPC returns vehicle,           |
 | timeline_events            |    images, timeline, stats)              |
 | vehicle_comments_unified   |                                         |
 | vehicle_observations       |                                         v
 +--------------------------+                              +---------------------------+
                                                           | VehicleProfileContext      |
 +--------------------------+   Direct query               | (VehicleProfileProvider)   |
 | vehicle_events            | -----> buildAuctionPulse--->|                           |
 | auction_comments          |                             | State:                    |
 +--------------------------+                              |   vehicle                 |
                                                           |   vehicleImages           |
 +--------------------------+   Direct query               |   timelineEvents          |
 | field_evidence            | --------------------------->|   auctionPulse            |
 +--------------------------+                              |   totalCommentCount       |
                                                           |   observationCount        |
 +--------------------------+   Direct query               |   leadImageUrl / heroMeta |
 | work_order_receipt_unified| --------------------------->|   liveSession             |
 | deal_jackets              |                             |   permissions             |
 | deal_contacts             |                             |   linkedOrganizations     |
 +--------------------------+                              +---------------------------+
                                                                      |
 +--------------------------+   Direct query                          |
 | auction_readiness         | ------+                                |
 +--------------------------+        |                                v
                                     |          +--------------------------------------+
 +--------------------------+        |          |         WorkspaceContent              |
 | analysis_signals          | --+   |          |                                      |
 +--------------------------+   |   |          |  LEFT COLUMN         RIGHT COLUMN    |
                                |   |          |  +-----------+       +-----------+    |
 +--------------------------+   |   |          |  | Dossier   |       | Gallery   |    |
 | comment_discoveries       |   |   |          |  | Signals   |       | Scores    |    |
 | description_discoveries   |   |   |          |  | Identity  |       | ARS       |    |
 | vehicle_events (scores)   | --+---+--------->  | Descript  |       | Videos    |    |
 +--------------------------+   |   |          |  | Comments  |       |           |    |
                                |   |          |  | Listing   |       |           |    |
                                |   |          |  | Comps     |       |           |    |
                                |   +--------->  | Obs Hist  |       |           |    |
                                |              |  | Pricing   |       |           |    |
                                +------------->  | Build*    |       |           |    |
                                               |  | ROI       |       |           |    |
                                               |  | Estimate  |       |           |    |
                                               |  | Auctions  |       |           |    |
                                               |  +-----------+       +-----------+    |
                                               +--------------------------------------+
```

---

## Flow 1: Vehicle Core Load

The primary data load. A single RPC attempts to return the vehicle record, images, timeline, and stats in one round-trip. If the RPC fails or times out (2.5s client-side timeout), falls back to a direct query.

```
DATABASE                        LOADER                          CONTEXT
--------                        ------                          -------

vehicles                   loadVehicleImpl()              VehicleProfileContext
  id, year, make,          (loadVehicleData.ts)           (VehicleProfileContext.tsx)
  model, vin, ...                |
       |                         |
       v                         v
  +---------------------+   RPC: get_vehicle_profile_data()
  | get_vehicle_profile  |   with p_vehicle_id param
  | _data (Postgres RPC) |   Returns: { vehicle, images[], timeline_events[], stats }
  +---------------------+
       |                    On RPC success:
       |                      setVehicle(rpcData.vehicle)
       |                      setVehicleImages(rpcData.images) [if not truncated]
       |                      setTimelineEvents(rpcData.timeline_events)
       |                      commentCount = rpcData.stats.comment_count
       |                      observationCount = rpcData.stats.observation_count
       |
       |                    On RPC failure (timeout/error):
       v                      Direct SELECT from vehicles table
  vehicles table              → setVehicle(data)
  (explicit columns,          → separate loads for images, timeline, counts
   not SELECT *)

  Post-load side effects:
    - selectBestHeroImage() → setLeadImageUrl, setHeroMeta
    - buildAuctionPulseFromExternalListings() → setAuctionPulse
    - loadResponsible() → setResponsibleName
    - loadLinkedOrgs() → setLinkedOrganizations
    - loadLiveSession() → setLiveSession (deferred 500ms)
    - vehicle_views INSERT (fire-and-forget)
    - user_presence UPSERT heartbeat (60s interval)
```

**Key files:**
- `loadVehicleData.ts:257` — `loadVehicleImpl()` function
- `VehicleProfileContext.tsx:181` — `loadVehicle` callback
- `VehicleProfileContext.tsx:433` — initial load trigger

---

## Flow 2: Image Resolution

Two-phase image loading: RPC may provide initial images, then `resolveVehicleImages()` runs for the full gallery. Hero image selection runs separately with quality scoring.

```
DATABASE                        RESOLVER                        CONTEXT / UI
--------                        --------                        ----------

vehicle_images              resolveVehicleImages()          VehicleProfileContext
  image_url                 (resolveVehicleImages.ts)         .vehicleImages[]
  medium_url, large_url          |                                |
  is_primary                     v                                v
  is_document               fetchVehicleImages()            ProfileGallery
  is_duplicate                (lib/fetchVehicleImages)        (WorkspaceContent.tsx)
  photo_quality_score             |                                |
  vehicle_zone                    v                                v
  ai_processing_status      Filter: !is_document,            ImageGallery
  zone_confidence             !is_duplicate,                  (components/images/)
  exif_data                   match_status != mismatch
  taken_at                         |
                                   v
                              Order: is_primary DESC,
                                position, created_at
                                   |
                                   v
                              Return { urls[], leadUrl }

HERO SELECTION (parallel):

vehicle_images              selectBestHeroImage()           Context state
  (same table)              (loadVehicleData.ts:95)
       |                         |
       v                    Priority cascade:
  Attempt 0:                 1. is_primary=true (unconditional win)
    is_primary=true          2. front exterior zones + AI completed
  Attempt 1:                    (ext_front, ext_front_driver, ext_front_passenger)
    ext_front* zones            scored by: moneyShot + quality + zone + aspect ratio
    ai_processing=completed     trusted sources get +50 bonus
  Attempt 2:                 3. any zone with quality score
    any zone with quality    4. any non-doc non-dup image
  Attempt 2.5:               5. primary_image_url fallback
    any non-doc/non-dup
  Attempt 3:                      |
    primary_image_url              v
                              setLeadImageUrl(url)
                              setHeroMeta({ camera, location, date })
```

**Key files:**
- `resolveVehicleImages.ts:25` — `resolveVehicleImages()`
- `loadVehicleData.ts:95` — `selectBestHeroImage()`
- `VehicleProfileContext.tsx:218` — `loadVehicleImages` callback

---

## Flow 3: Timeline Merge

Timeline events and work sessions are loaded in parallel, merged into a unified chronological stream, and rendered as the BarcodeTimeline strip.

```
DATABASE                        LOADER                          CONTEXT / UI
--------                        ------                          ----------

timeline_events             loadTimelineEvents()            VehicleProfileContext
  event_date                (VehicleProfileContext.tsx:239)    .timelineEvents[]
  event_type                     |                                |
  title, category                |  Promise.all([                 v
  cost_amount                    |    timeline_events query,   BarcodeTimeline
  metadata                       |    work_sessions query     (sub-header strip)
       +                         |  ])                             |
       |                         |                                 v
work_sessions                    v                            DayCard popups
  session_date              Merge algorithm:                  (via PopupStack)
  title                      1. Load timeline_events
  work_type                     (vehicle_id, limit 200)
  image_count                2. Load work_sessions
  duration_minutes              (vehicle_id, all)
  total_parts_cost           3. Convert work_sessions to
  total_labor_cost              timeline event shape:
  total_job_cost                event_type = 'work_session'
  work_description              event_date = session_date
  status                        cost_amount = job + parts
                                metadata.source = 'work_sessions'
                             4. Merge both arrays
                             5. Sort by event_date DESC
                                   |
                                   v
                             setTimelineEvents(merged)
```

**Key files:**
- `VehicleProfileContext.tsx:239` — `loadTimelineEvents` callback
- Realtime subscription at `VehicleProfileContext.tsx:485` updates on INSERT/UPDATE

---

## Flow 4: Intelligence Pipeline

The intelligence panel aggregates AI-extracted insights from comments and descriptions, plus cross-platform sighting history and comparable sales.

```
DATABASE                        RPC                             HOOK / UI
--------                        ---                             ---------

comment_discoveries         popup_vehicle_intel              useVehicleIntel()
  overall_sentiment         (Postgres RPC)                   (hooks/useVehicleIntel.ts)
  sentiment_score                |                                |
  key_quotes                     |                                v
  expert_insights                |                           VehicleIntelligencePanel
  community_concerns             |                           (being added by Agent A)
  price_sentiment                |
  market_signals                 |
  seller_disclosures             |
  authenticity                   |
       +                         |
description_discoveries          |
  red_flags[]                    |         Returns VehicleIntel:
  mods[]                         | ------> {
  work_history[]                 |           comment_intel,
  condition                      |           description_intel,
  title_status                   |           scores,
  owner_count                    |           apparitions[],
  matching_numbers               |           recent_comps[]
  documentation[]                |         }
  option_codes[]                 |
  equipment[]                    |
  price_positive[]               |
  price_negative[]               |
       +                         |
vehicle_events                   |
  (cross-platform sightings)     |
       +                         |
vehicles                         |
  nuke_estimate                  |
  nuke_estimate_confidence       |
  heat_score                     |
  deal_score                     |
       +                         |
vehicles (comps)                 |
  (similar year/make/model)      |
```

**Key files:**
- `hooks/useVehicleIntel.ts:68` — `useVehicleIntel()` hook
- RPC: `popup_vehicle_intel` (Postgres function)

---

## Flow 5: Field Evidence

The provenance layer that tracks competing values for each vehicle field from different sources, with confidence scoring and conflict classification.

```
DATABASE                        HOOK                            UI
--------                        ----                            --

field_evidence              useFieldEvidence()              VehicleDossierPanel
  field_name                (hooks/useFieldEvidence.ts)     (VehicleDossierPanel.tsx)
  proposed_value                 |                                |
  source_type                    |                                v
  source_confidence              |                           Per-field display:
  extraction_context             |                             primary value
  extracted_at                   v                             source count
  status                    Query: field_evidence             conflict indicator
       |                      WHERE vehicle_id = ?              (genuine/refinement/
       |                      ORDER BY source_confidence DESC     synonym/variance)
       |                         |                                |
       v                         v                                v
  ensure_field_evidence     If < 3 rows found:              FieldProvenanceDrawer
  (Postgres RPC)             trigger backfill RPC             (click to expand
   On-demand backfill        ensure_field_evidence()           all sources)
   from vehicles record      then re-fetch
       |                         |
       v                         v
  Mapping pipeline:         Group by field_name
   proposed_value            Sort: confidence DESC,
    → field_value              trust weight DESC,
   source_confidence/100       created_at DESC
    → confidence (0-1)       Classify conflicts:
                               genuine | refinement |
                               synonym | variance
                             Count agreements per field
                                   |
                                   v
                             FieldEvidenceMap
                             { [field]: { primary, sources[],
                               agreementCount, hasConflict,
                               conflictType } }
```

**Trust hierarchy (SOURCE_TRUST weights):**
```
vin_decode / nhtsa_vin_decode  100
title_document                  90
bat_listing                     85
receipt                         80
image_vision                    65
user_input                      50
enrichment                      30
(default)                       40
```

**Key files:**
- `hooks/useFieldEvidence.ts:172` — `useFieldEvidence()` hook
- `VehicleDossierPanel.tsx` — renders field evidence grid
- `FieldProvenanceDrawer.tsx` — expanded source comparison drawer

---

## Flow 6: Build Status

Work order accounting and deal jacket data for post-sale build tracking.

```
DATABASE                        HOOK                            UI
--------                        ----                            --

work_order_receipt_unified  useBuildStatus()                BuildStatusPanel
(view joining:              (hooks/useBuildStatus.ts)       (BuildStatusPanel.tsx)
  work_orders                    |                                |
  work_order_line_items          |                                v
  payments                       |                           Work order cards
  comped items)                  |                           with line totals:
       |                         |                             parts, labor,
       v                         |  Promise.all([               comped, paid,
  SELECT *                       |    receipts query,           balance due
    FROM work_order_receipt       |    deal jacket query          |
    _unified                     |  ])                            v
    WHERE vehicle_id = ?         |                           WorkOrderProgress
    ORDER BY work_order_created  |                           (line item checklist)
       +                         |                                |
deal_jackets                     |                                v
  sale_price_inc_doc             |                           GenerateBill
  deposit_amount                 |                           (invoice PDF render)
  sold_date                      |
       +                         |
deal_contacts                    |
  (via deal_jackets              |         Returns BuildStatusData:
   .sold_to_id FK)               | ------> {
  full_name                      |           workOrders[],
  email                          |           dealJacket: { contact },
  phone_mobile                   |           totals: { invoice, paid,
  address, city,                 |                     balance, comped,
  state, zip                     |                     orderCount },
                                 |           hasData
                                 |         }
```

**Key files:**
- `hooks/useBuildStatus.ts:64` — `useBuildStatus()` hook
- `WorkspaceContent.tsx:133` — destructures build status
- `BuildStatusPanel.tsx` — renders work order details
- `WorkOrderProgress.tsx` — line item sign-off checklist
- `GenerateBill.tsx` — invoice generation

---

## Flow 7: Vehicle Scores

Scores stored directly on the vehicles record, read through the context.

```
DATABASE                        CONTEXT                         UI
--------                        -------                         --

vehicles                    useVehicleProfile()             VehicleScoresWidget
  condition_rating          (VehicleProfileContext.tsx)      (VehicleScoresWidget.tsx)
  value_score                    |                                |
  investment_quality_score       |                                v
  provenance_score               |                           5 score bars:
  overall_desirability_score     v                             Condition     /10
       |                    vehicle state object               Value Score   /100
       |                    (from loadVehicleImpl)              Inv. Quality  /100
       v                         |                             Provenance    /100
  Included in RPC or             v                             Desirability  /100
  direct vehicle query      VehicleProfileContext
  (no separate fetch)        .vehicle                        Self-guarding:
                                                              returns null if
                                                              ALL scores are null
```

**Key files:**
- `VehicleScoresWidget.tsx:50` — renders score bars from context vehicle data
- Reads directly from `useVehicleProfile().vehicle`

---

## Flow 8: Auction Readiness

The ARS (Auction Readiness Score) is a 6-dimension composite score computed server-side and stored in a dedicated table.

```
DATABASE                        COMPONENT                       UI
--------                        ---------                       --

auction_readiness           AuctionReadinessPanel           Widget rendering:
  vehicle_id                (AuctionReadinessPanel.tsx)       Composite /100
  composite_score                |                            Tier badge
  tier                           |                            6 dimension bars:
  identity_score                 v                              IDENTITY
  photo_score               Direct query:                       PHOTOS
  doc_score                   auction_readiness                  DOCS
  desc_score                  WHERE vehicle_id = ?               DESCRIPTION
  market_score                .maybeSingle()                     MARKET
  condition_score                |                               CONDITION
  coaching_plan[]                v                            Photo zones status
  photo_zones_present[]     Renders only if:                  Coaching actions
  photo_zones_missing[]       canView (owner/contrib/admin)     (up to 8 gaps)
  mvps_complete               AND data exists
  computed_at
```

**Key files:**
- `AuctionReadinessPanel.tsx:55` — fetches and renders ARS data
- Direct Supabase query (no custom hook)
- Access-controlled: owner, contributor, or admin only

---

## Flow 9: Analysis Signals

Computed alerts from the analysis engine, stored in a signals table, fetched by a dedicated hook.

```
DATABASE                        HOOK                            UI
--------                        ----                            --

analysis_signals            useAnalysisSignals()            AnalysisSignalsSection
  widget_slug               (hooks/useAnalysisSignals.ts)   (AnalysisSignalsSection.tsx)
  score                          |                                |
  label                          v                                v
  severity                  Query: analysis_signals          Alert cards with:
  reasons[]                   WHERE vehicle_id = ?             severity badge
  evidence                    AND dismissed_until IS NULL       label + reasons
  recommendations               ORDER BY severity ASC,         evidence detail
  confidence                     computed_at DESC               recommendations
  computed_at                    |
  dismissed_until                v
                            Returns AnalysisSignal[]
```

**Key files:**
- `hooks/useAnalysisSignals.ts:17` — `useAnalysisSignals()` hook
- `AnalysisSignalsSection.tsx` — renders alert cards

---

## Flow 10: Auction Pulse (Realtime)

Live auction telemetry with realtime subscriptions and polling.

```
DATABASE                        BUILDER                         CONTEXT / UI
--------                        -------                         ----------

vehicle_events              buildAuctionPulseFromExternalListings()   VehicleProfileContext
  source_platform           (buildAuctionPulse.ts)                     .auctionPulse
  source_url                     |                                          |
  event_status                   |                                          v
  ended_at                       |                                     VehicleHeader
  current_price                  v                                     (countdown, bid,
  bid_count                 Normalize vehicle_events                    watcher count)
  watcher_count               into AuctionPulse shape
  view_count                     |
  final_price                    v
  sold_at                   auction_comments                      Realtime channels:
  metadata                    (bid telemetry)                       vehicle_events *
       |                         |                                  auction_comments INSERT
       v                         v
  Derived fields:           AuctionPulse {
    winner_name               platform, listing_url,
    seller_username             listing_status, end_date,
    comment_count               current_bid, bid_count,
    last_bid_at                 watcher_count, view_count,
    last_comment_at             comment_count, final_price,
                                sold_at, winner_name,
                                seller_username,
                                last_bid_at, last_comment_at
                              }

  60-second polling interval (when tab visible)
  for active auctions
```

**Key files:**
- `VehicleProfileContext.tsx:491` — realtime subscriptions
- `VehicleProfileContext.tsx:555` — 60s polling
- `buildAuctionPulse.ts` — normalization logic
- `loadVehicleData.ts:398` — initial pulse derivation

---

## Realtime Subscriptions Summary

```
Channel: vp-ctx:{vehicleId}
  vehicles UPDATE        → reloadVehicle()
  vehicle_images *       → reloadImages()
  timeline_events *      → reloadTimeline()

Channel: auction-pulse:{vehicleId}
  vehicle_events *       → re-derive auction pulse
  auction_comments INSERT → increment comment_count, update last_bid_at

Window events:
  vehicle_images_updated   → reloadImages() + reloadTimeline()
  timeline_updated         → reloadTimeline()
  timeline_events_created  → reloadTimeline()
```

---

## Component Layout Reference

```
VehicleProfileProvider
  |
  +-- VehicleHeader (hero image, title, auction pulse)
  |
  +-- BarcodeTimeline (timeline strip, day card popups)
  |
  +-- WorkspaceContent
       |
       +-- LEFT COLUMN (38% default, resizable)
       |    |
       |    +-- WorkMemorySection (owner/contrib only)
       |    +-- VehicleDossierPanel (field evidence grid)
       |    +-- AnalysisSignalsSection (computed alerts)
       |    +-- OwnerIdentityCard (deal jacket contact)
       |    +-- VehicleDescriptionCard
       |    +-- VehicleCommentsCard (if comments exist)
       |    +-- VehicleListingDetailsCard
       |    +-- SimilarSalesSection
       |    +-- ObservationTimeline
       |    +-- VehiclePricingValueCard
       |    +-- BuildManifestPanel (owner/contrib)
       |    +-- BuildTimelineChart (owner/contrib)
       |    +-- BuildStatusPanel (if work orders)
       |    +--   WorkOrderProgress
       |    +--   GenerateBill
       |    +-- VehicleROISummaryCard
       |    +-- NukeEstimatePanel
       |    +-- ExternalListingCard
       |    +-- WiringQueryContextBar (owner)
       |    +-- PartsQuoteGenerator (owner)
       |    +-- VehicleLedgerDocumentsCard (verified owner/contrib)
       |    +-- VehicleReferenceLibrary
       |    +-- Privacy Settings
       |
       +-- ColumnDivider (drag to resize)
       |
       +-- RIGHT COLUMN (62% default)
            |
            +-- BundleReviewQueue
            +-- ImageGallery (8 view modes)
            +-- VehicleScoresWidget (5 score bars)
            +-- AuctionReadinessPanel (6 ARS dimensions)
            +-- VehicleVideoSection
```
