# Chapter 3: Timeline Architecture

The timeline is the vehicle's life story. Every auction listing, every sale, every repair, every mileage reading, every photo session — all are events on a unified timeline. The vehicle profile's BarcodeTimeline component renders this history as a visual barcode, and the DayCard popup reveals the details of any given day.

This chapter documents the data model, event types, work session integration, and the frontend rendering pipeline.

---

## Core Principle: The Timeline IS the Vehicle

A vehicle's identity is not just its specifications — it is the sum of everything that has happened to it. A 1967 Shelby GT500 with a documented racing history from 1968-1972, three owners, two restorations, and a BaT sale in 2023 is a fundamentally different entity from the same model that sat in a barn for 40 years.

The timeline captures this narrative. It is the primary dimension through which users explore a vehicle profile.

---

## The timeline_events Table

The `timeline_events` table holds **987,249 rows** — nearly a million events spanning the full history of tracked vehicles.

### Full Schema

```sql
CREATE TABLE timeline_events (
    id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id                      uuid,                       -- FK to vehicles
    user_id                         uuid DEFAULT auth.uid(),    -- Who created this event

    -- Event identity
    event_type                      text NOT NULL,              -- What kind of event
    source                          text NOT NULL,              -- Where this event came from
    source_type                     text NOT NULL DEFAULT 'user_input', -- Category of source
    title                           text NOT NULL,              -- Display title
    description                     text,                       -- Detailed description
    event_date                      date NOT NULL,              -- When the event occurred
    event_category                  text,                       -- Broad category
    activity_type                   text,                       -- Specific activity classification

    -- Media
    image_urls                      text[],                     -- Associated images
    metadata                        jsonb DEFAULT '{}',         -- Flexible event-specific data

    -- Temporal
    created_at                      timestamptz DEFAULT now(),
    updated_at                      timestamptz DEFAULT now(),

    -- Measurement
    mileage_at_event                integer,                    -- Odometer reading at time of event
    cost_amount                     numeric,                    -- Financial cost
    cost_currency                   text DEFAULT 'USD',
    cost_estimate                   numeric,                    -- Estimated cost if actual unknown
    duration_hours                  numeric,                    -- Time spent
    labor_hours                     numeric,                    -- Billable labor hours

    -- Location
    location_name                   text,
    location_address                text,
    location_coordinates            point,                      -- PostGIS point

    -- Service provider
    service_provider_name           text,
    service_provider_type           text,
    invoice_number                  text,
    organization_id                 uuid,                       -- FK to organizations
    client_id                       uuid,

    -- Warranty
    warranty_info                   jsonb DEFAULT '{}',

    -- Parts and tools
    parts_used                      text[],
    parts_mentioned                 text[] DEFAULT '{}',
    tools_mentioned                 text[] DEFAULT '{}',

    -- Documentation
    verification_documents          text[],
    photo_analysis                  jsonb DEFAULT '{}',
    receipt_data                    jsonb DEFAULT '{}',

    -- Insurance
    is_insurance_claim              boolean DEFAULT false,
    insurance_claim_number          text,

    -- Next service
    next_service_due_date           date,
    next_service_due_mileage        integer,

    -- Confidence
    data_source                     text DEFAULT 'user_input',
    confidence_score                integer DEFAULT 50,

    -- Tags
    automated_tags                  text[] DEFAULT '{}',
    manual_tags                     text[] DEFAULT '{}',

    -- Monetization
    is_monetized                    boolean DEFAULT false,
    work_started                    timestamptz,
    work_completed                  timestamptz,
    contract_id                     uuid,
    applied_labor_rate              numeric,
    applied_shop_rate               numeric,
    rate_source                     text,

    -- Quality
    contextual_analysis_status      text DEFAULT 'pending',
    documented_by                   uuid,
    primary_technician              uuid,
    quality_rating                  integer,
    quality_justification           text,
    value_impact                    numeric,
    ai_confidence_score             numeric,
    concerns                        text[],
    industry_standard_comparison    jsonb DEFAULT '{}',

    -- Search
    search_vector                   tsvector,
    work_order_id                   uuid                        -- FK to work_orders
);
```

### Event Types

The `event_type` column classifies what happened. There are 24 distinct event types in production:

#### Auction Events
| Event Type | Count | Description |
|-----------|-------|-------------|
| `auction_listed` | ~154K | Vehicle was listed for auction |
| `auction_sold` | ~344K | Vehicle sold at auction |
| `auction_bid_placed` | ~76K | A bid was placed |
| `auction_started` | ~9K | Auction clock started |
| `auction_ended` | ~2K | Auction ended (any outcome) |
| `auction_reserve_met` | — | Reserve price was met |
| `auction_reserve_not_met` | ~29K | Reserve was not met |

#### Vehicle Lifecycle Events
| Event Type | Count | Description |
|-----------|-------|-------------|
| `purchase` | — | Vehicle was purchased (non-auction) |
| `sale` | — | Vehicle was sold (non-auction) |
| `registration` | — | Registration event |
| `vehicle_added` | — | Vehicle was added to the platform |
| `vin_added` | — | VIN was recorded |
| `profile_merge` | — | Two profiles were merged |
| `profile_merged` | — | Result of a merge operation |

#### Maintenance and Service Events
| Event Type | Count | Description |
|-----------|-------|-------------|
| `maintenance` | — | Scheduled maintenance |
| `repair` | ~8K | Repair work |
| `service` | — | General service |
| `inspection` | — | Inspection or assessment |
| `modification` | — | Aftermarket modification |
| `work_completed` | — | Work session completed |

#### Data Events
| Event Type | Count | Description |
|-----------|-------|-------------|
| `mileage_reading` | ~117K | Odometer reading |
| `pending_analysis` | ~27K | Awaiting AI analysis |
| `photo_session` | — | Photo upload session |
| `other` | ~154K | Uncategorized events |

### Source Distribution

Events come from many sources. The top sources by volume:

| Source | Count | Description |
|--------|-------|-------------|
| `bat` | 504,722 | Bring a Trailer extraction |
| `bat_import` | 265,801 | BaT batch import |
| `Bring a Trailer` | 88,257 | BaT (alternate slug) |
| `cars_and_bids` | 32,280 | Cars & Bids extraction |
| `photo_upload` | 27,087 | User photo uploads |
| `Barrettjackson` | 25,563 | Barrett-Jackson |
| `bonhams_import` | 19,895 | Bonhams batch import |
| `Pcarmarket` | 8,797 | PCarMarket |
| `craigslist` | 2,962 | Craigslist listings |
| `automated_import` | 2,755 | Automated import pipeline |

---

## The work_sessions Table

Work sessions track physical shop work on vehicles. They complement timeline events with structured session data — start/end times, costs, zones touched, and stage transitions.

### Full Schema

```sql
CREATE TABLE work_sessions (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                     uuid NOT NULL,              -- Who worked on the vehicle
    vehicle_id                  uuid NOT NULL,              -- FK to vehicles
    session_date                date NOT NULL,              -- Date of the session
    start_time                  timestamptz NOT NULL,       -- Session start
    end_time                    timestamptz NOT NULL,       -- Session end
    duration_minutes            integer NOT NULL,           -- Computed duration
    confidence_score            numeric NOT NULL DEFAULT 0.0, -- How confident the system is in this session's data
    image_count                 integer NOT NULL DEFAULT 0, -- Photos taken during session
    work_description            text,                       -- What was done
    metadata                    jsonb,                      -- Flexible session data
    created_at                  timestamptz DEFAULT now(),
    updated_at                  timestamptz DEFAULT now(),

    -- Activity link
    user_activity_id            uuid,                       -- FK to user_activities

    -- Session state
    status                      text DEFAULT 'in_progress', -- 'in_progress', 'completed', 'reviewed'
    title                       text,                       -- Display title
    work_type                   text,                       -- Category of work

    -- Financial
    total_parts_cost            numeric DEFAULT 0,
    total_tool_depreciation     numeric DEFAULT 0,
    labor_rate_per_hour         numeric,
    total_labor_cost            numeric DEFAULT 0,
    total_job_cost              numeric DEFAULT 0,
    quoted_price                numeric,
    final_invoice               numeric,
    profit_margin               numeric,
    finalized_at                timestamptz,

    -- Personnel
    technician_id               uuid,
    technician_phone_link_id    uuid,

    -- Session classification
    session_type                text DEFAULT 'auto_detected', -- How the session was created
    start_image_id              uuid,                       -- First photo of the session
    end_image_id                uuid,                       -- Last photo of the session

    -- Spatial and stage tracking
    zones_touched               text[] DEFAULT '{}',        -- Vehicle zones worked on (engine bay, undercarriage, etc.)
    stages_observed             text[] DEFAULT '{}',        -- Work stages observed (disassembly, welding, etc.)
    stage_transitions           jsonb DEFAULT '[]',         -- Ordered list of stage changes
    place_id                    uuid,                       -- FK to places table

    -- Evidence
    evidence                    jsonb DEFAULT '{}'          -- Supporting evidence for the session
);
```

### Work Session Row Count

Currently **27 rows** — work sessions are created by the work photo ingest system, which detects shop activity from timestamped photos and GPS data. The system identifies work sessions by clustering photos taken at known shop locations within time windows.

### Session Types

| Type | Description |
|------|-------------|
| `auto_detected` | System detected from photo timestamps and GPS |
| `manual` | User-created session |
| `photo_session` | Photo documentation session (no work performed) |

### Zones and Stages

The `zones_touched` array tracks which areas of the vehicle were worked on:
- `engine_bay`, `undercarriage`, `interior`, `exterior`, `trunk`, `wheels`, `exhaust`, `electrical`

The `stages_observed` array tracks what work stages were captured:
- `disassembly`, `inspection`, `cleaning`, `repair`, `welding`, `fabrication`, `painting`, `assembly`, `testing`

The `stage_transitions` JSONB records the order of stage changes with timestamps, enabling the system to reconstruct the work narrative.

---

## BarcodeTimeline: The Frontend Renderer

The BarcodeTimeline is the primary visual component for vehicle history. Located at `nuke_frontend/src/pages/vehicle-profile/BarcodeTimeline.tsx`, it renders the combined timeline of events and work sessions as a horizontal barcode where each bar represents a day with activity.

### Data Merge Logic

The BarcodeTimeline combines two data streams:

1. **timeline_events** — all events for the vehicle, sorted by `event_date`
2. **work_sessions** — all sessions for the vehicle, sorted by `session_date`

The merge algorithm:
1. Fetch both datasets for the given `vehicle_id`
2. Create a map of `date -> events[]` from timeline_events
3. Overlay work sessions onto the same date map
4. For each date with activity, render a bar with color intensity based on event count
5. Event types determine bar color (auction events = one color, maintenance = another, etc.)

### Bar Encoding

Each bar in the barcode represents a single calendar day. The visual encoding:
- **Width**: Fixed (thin bars for dense history, wider for sparse)
- **Color**: Determined by the dominant event type that day
- **Intensity**: Higher opacity for days with more events
- **Height**: Uniform (the barcode metaphor)

### Interaction Model

Clicking a bar in the BarcodeTimeline opens the DayCard popup for that date.

---

## DayCard: The Timeline Detail Popup

The DayCard component (`nuke_frontend/src/pages/vehicle-profile/DayCard.tsx`) is a popup that shows everything that happened to a vehicle on a specific day.

### What a DayCard Shows

For a given date, the DayCard aggregates:
- Timeline events (auction listed, sold, bid placed, mileage reading, etc.)
- Work sessions (with zones, stages, costs, photos)
- Photos taken that day
- Cost totals (parts + labor)
- Mileage readings

### DayCard Data Flow

```
User clicks bar in BarcodeTimeline
        |
        v
BarcodeTimeline passes date + vehicle_id to DayCard
        |
        v
DayCard queries:
  1. timeline_events WHERE vehicle_id = ? AND event_date = ?
  2. work_sessions WHERE vehicle_id = ? AND session_date = ?
  3. vehicle_images WHERE vehicle_id = ? AND taken_at::date = ?
        |
        v
DayCard renders combined view via PopupStack
```

The DayCard opens via the PopupStack system — the platform's unified popup manager that handles stacking, positioning, and dismissal of overlay panels.

---

## Timeline Event Creation

Timeline events are created by multiple pathways:

### 1. Extraction Pipeline
When an extractor (e.g., `bat-simple-extract`) processes a listing, it creates timeline events:
- `auction_listed` when the listing is first seen
- `auction_sold` when the sale result is recorded
- `mileage_reading` when the listing mentions mileage at a specific date

### 2. Work Photo Ingest
The work photo system (`scripts/drop-folder-ingest.mjs`) creates:
- `photo_session` events for each batch of photos
- `pending_analysis` events queued for AI classification
- `work_completed` events when a session is finalized

### 3. User Input
Users can manually create timeline events for:
- Maintenance performed
- Modifications installed
- Inspections completed
- Purchase and sale events

### 4. AI Discovery
The discovery pipeline creates timeline events when it identifies:
- Ownership changes from description analysis
- Service history mentions in comments
- Mileage readings embedded in auction data

---

## Timeline Queries

### Get Full Timeline for a Vehicle

```sql
SELECT
    id, event_type, source, title, description,
    event_date, mileage_at_event, cost_amount,
    location_name, service_provider_name
FROM timeline_events
WHERE vehicle_id = $1
ORDER BY event_date DESC, created_at DESC;
```

### Get Timeline with Work Sessions Merged

```sql
-- Timeline events
SELECT
    id, 'timeline_event' as record_type,
    event_type, title, description,
    event_date as date, cost_amount,
    mileage_at_event
FROM timeline_events
WHERE vehicle_id = $1

UNION ALL

-- Work sessions
SELECT
    id, 'work_session' as record_type,
    work_type as event_type,
    title, work_description as description,
    session_date as date, total_job_cost as cost_amount,
    NULL as mileage_at_event
FROM work_sessions
WHERE vehicle_id = $1

ORDER BY date DESC;
```

### Mileage Trajectory

```sql
SELECT event_date, mileage_at_event
FROM timeline_events
WHERE vehicle_id = $1
  AND mileage_at_event IS NOT NULL
ORDER BY event_date ASC;
```

### Cost History

```sql
SELECT
    event_date,
    event_type,
    cost_amount,
    SUM(cost_amount) OVER (ORDER BY event_date) as cumulative_cost
FROM timeline_events
WHERE vehicle_id = $1
  AND cost_amount IS NOT NULL
ORDER BY event_date ASC;
```

---

## Relationship to Other Systems

### Timeline Events and Observations

Timeline events and vehicle observations are complementary but distinct:

- **vehicle_observations** store raw testimony with full provenance — what was SAID about the vehicle
- **timeline_events** store what HAPPENED to the vehicle — events on its life timeline

An observation can generate timeline events (an auction listing observation creates an `auction_listed` event), but they are not 1:1. A single listing observation might generate multiple timeline events (listing, bids, sale result), and some timeline events have no corresponding observation (user-entered maintenance).

### Timeline Events and Work Orders

The `work_order_id` column on `timeline_events` links events to formal work orders. A work order may span multiple timeline events (inspection -> repair -> test drive -> completion), creating a narrative arc within the timeline.

### Timeline Search

The `search_vector` column (tsvector) enables full-text search across timeline events:
```sql
SELECT * FROM timeline_events
WHERE vehicle_id = $1
  AND search_vector @@ plainto_tsquery('english', 'brake rebuild');
```

---

## Summary

The timeline architecture transforms raw observations and work records into a navigable life story. The `timeline_events` table (987K rows) holds the event stream, `work_sessions` (27 rows) adds structured shop work data, the BarcodeTimeline component renders the visual barcode, and the DayCard popup provides day-level detail. Together, they answer the fundamental question for any collector vehicle: what has this vehicle been through?
