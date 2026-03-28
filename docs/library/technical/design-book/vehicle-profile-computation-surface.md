# The Vehicle Profile — Computation Surface

> The profile is the middle of the data pipeline, not the end. Data flows in from extraction, observation, and ingestion on one side, and flows out as computed intelligence to users, buyers, sellers, and analysts on the other.

---

## What the Vehicle Profile IS

The vehicle profile is a **Computation Surface**. It does not show cached values. It does not display pre-aggregated statistics. It computes analysis in real time from the underlying knowledge graph every time it renders. The profile is the primary materialization layer where raw observations become visible intelligence.

The profile sits at the **middle point** of the data pipeline:

```
SOURCES                          COMPUTATION SURFACE                    CONSUMERS
                                 (Vehicle Profile)
Extractors      ───┐                                        ┌───> Buyers
Observations    ───┤         ┌─────────────────────┐        ├───> Sellers
Photos          ───┤         │  Knowledge Graph     │        ├───> Analysts
Comments        ───┼────────>│  ──> Live Compute    │───────>├───> Coaching System
User Input      ───┤         │  ──> Render at       │        ├───> ARS
Work Orders     ───┤         │      current density │        ├───> API / SDK
Receipts        ───┘         └─────────────────────┘        └───> Invoices / Reports
```

The profile does not own data. It reads from the graph and computes on it. If the underlying data changes, the profile changes the next time it renders. There is no cache invalidation problem because there is no cache.

---

## The Timeline IS the Vehicle

A vehicle's life is a timeline. Every event that happens to a vehicle is a **Timeline Event** — the atomic unit of the vehicle's existence:

- Factory build
- Ownership transfers
- Auction appearances and results
- Work performed (labor, fabrication, repair)
- Parts installed, removed, or transferred between vehicles
- Photos taken (classified by area, operation, and date)
- Inspections and condition reports
- Title events (registration, lien, transfer)
- Accidents and damage reports
- Modifications (factory-to-current delta)
- Community mentions (forum posts, auction comments, social media)

There is no separate "build log" system, no "work tracker" system, no "photo gallery" system. These are **filtered views of the same timeline**. A build log is the timeline filtered to work events. A photo gallery is the timeline filtered to image events. A service history is the timeline filtered to maintenance events.

### The Anti-Pattern: Parallel Tracking Systems

```
WRONG:
  work_orders table  ──> Build Log component
  vehicle_images     ──> Photo Gallery component
  auction_events     ──> Auction History component
  title_events       ──> Title History component
  (4 separate data paths, 4 separate UIs, 4 separate caches)

RIGHT:
  vehicle timeline   ──> Timeline component
                         ├── filtered by work events    = Build Log view
                         ├── filtered by image events   = Photo Gallery view
                         ├── filtered by auction events  = Auction History view
                         └── filtered by title events    = Title History view
  (1 data path, 1 UI with filter modes, 0 caches)
```

Agents building on the vehicle profile must feed data into the existing timeline structures, not create parallel display systems.

---

## The Day Card (Timeline Popup)

When you click a day on the timeline that had activity, you get a popup — the **Day Card**. This is not a separate component. It is the standard popup rendered for a time-scoped data slice. The Day Card is **end-to-end, full-resolution**. It shows everything about that day.

### Raw Data Layer

The Day Card surfaces every observation from that date:

- **Images**: All photos from that day — parts photos, before/after documentation, progress shots, receipts, context photos. Grouped by area (exhaust, brakes, interior, etc.) and operation.
- **Technician Identity**: Who performed the work. Linked to the actor graph.
- **Parts Involved**: Every part consumed, with images of the actual parts where available. Part numbers, sources, costs.
- **Before/After Documentation**: The state of the component before work began and after completion.
- **Receipts and Costs**: Itemized costs — parts, labor hours, materials. Linked to the financial layer.
- **Work Session Metadata**: Start time, end time, total hours, work type classification.

### Computation Layer (Seven-Level Analysis)

On top of the raw data, the Day Card computes **seven levels of contextual analysis**. This is the conversion of experience and intuition into measured fact:

#### Level 1: Vehicle
Where is this vehicle in its build/restoration arc? What percentage complete? What is the trajectory — accelerating, stalling, or steady? How does the current session advance the overall project? What remains?

#### Level 2: Job
How does this specific task compare to the same task on other vehicles? Is 11.5 hours for exhaust fabrication fast or slow? Is $1,239 in parts cheap or expensive? What is the national median for this operation on comparable trucks? "This felt like a hard job" becomes "this exhaust fabrication took 11.5h vs 8.2h national median for comparable trucks."

#### Level 3: Client
Communication cadence — how quickly does this client respond to updates? Approval speed — how long between estimate presentation and sign-off? Payment pattern — net-30, net-60, or upon completion? Satisfaction signals — are they engaged, requesting changes, or going quiet?

#### Level 4: Technician
Speed vs quality profile for this tech. Specialization match — is this their area of expertise or outside their lane? Track record on this type of work across all vehicles they have touched. Hours per operation trending up or down over time.

#### Level 5: Shop
Current throughput — how many vehicles are active? Capacity utilization — what percentage of available bay-hours are being used? Seasonal patterns — does winter slow things down? Quality metrics — callback rate, rework frequency.

#### Level 6: Region
Local labor rates vs this invoice. Parts availability and lead times in this market. Specialist density — how many shops within 100 miles can do this work? Weather and season factors affecting project timelines.

#### Level 7: Market / National
National benchmarks for this type of build. How does this vehicle's total build cost compare to similar builds across the country? What do completed examples sell for? What is the return-on-investment trajectory?

### What the Seven Levels Produce

The Day Card does not show seven expandable sections. The seven levels produce a **contextual narrative** — a paragraph or two that synthesizes the analysis into actionable intelligence. The raw data is always available for drill-down, but the headline is the computed insight:

> "Session 14 of the K2500 build. Exhaust fabrication complete — 11.5h labor at $85/hr ($977.50) plus $1,239 in materials. This is 40% above national median for comparable trucks, but the scope included custom 304 SS mandrel bends and QTP electric cutouts that most builds skip. Dave Granholm approved the estimate within 2 hours (his fastest response yet). The build is now 73% complete by estimated remaining hours. At current pace, delivery in 3-4 weeks."

---

## The Bill is a Generated View

The bill or invoice is not a separate system. It is not a different database. It is not a parallel set of tables. The bill is the **same data rendered in a different format**. A button.

Same underlying timeline events. Same work orders. Same line items. Same receipts. Just formatted as a professional invoice with:

- Header (shop identity, logo, contact)
- Customer information (pulled from deal_jackets / contact graph)
- Vehicle identification
- Line items table (from work_order_line_items)
- Subtotals by category (labor, parts, materials)
- Tax, total, payment terms

This is like print CSS — same content, different presentation. The "Generate Bill" action does not query different tables or compute different numbers. It reads the same work events the Day Card reads and renders them as a document.

### The Anti-Pattern: Separate Invoice Systems

```
WRONG:
  invoices table
  invoice_line_items table
  invoice_payments table
  InvoiceGenerator component
  (parallel data that drifts from work orders)

RIGHT:
  work_orders + work_order_line_items + receipts
  ──> rendered as timeline (Day Card view)
  ──> rendered as invoice (Bill view)
  ──> rendered as estimate (Quote view)
  (one data source, multiple presentation formats)
```

---

## Progressive Density

A vehicle profile renders at whatever resolution the data supports. The profile NEVER shows empty shells. If a section has no data, it does not render.

### Density Levels

**Sparse vehicle** — Year, make, model. Maybe a photo. Maybe a price from one source. That is all the profile shows. No empty widgets. No "No data available" placeholders. No skeleton sections waiting to be filled. The profile is honest about what it knows.

**Moderate vehicle** — Identity confirmed. Some history — a few auction appearances, maybe a forum mention. A handful of photos. A market estimate with low confidence. The profile shows what exists and nothing more.

**Dense vehicle** — Full timeline with dozens or hundreds of events. Thousands of photos classified by area and operation. Work sessions with day cards. Component events tracking every part. Cross-platform apparitions (appeared on BaT, then Craigslist, then a forum). Buyer/seller intelligence. Community sentiment from comment analysis. The seven-level analysis has enough data to compute meaningful benchmarks.

**Bedrock vehicle** — Everything above, plus scientific measurements. Dyno results. Compression test readings. Paint thickness measurements. Metallurgical analysis. Fluid analysis reports. The physical world has been measured and the measurements are in the graph.

### Implementation Rule

Every widget, every section, every panel on the vehicle profile MUST check for data before rendering. The check is not "does this table have rows?" — it is "does this vehicle have meaningful data for this analysis?" A vehicle with one blurry photo does not get a "Photo Gallery" section. A vehicle with no work orders does not get a "Build Progress" section.

```typescript
// WRONG: renders empty shell
if (vehicle) return <BuildProgress vehicle={vehicle} />

// RIGHT: renders only when data exists
if (workSessions?.length > 0) return <BuildProgress sessions={workSessions} />

// BEST: component self-guards
function BuildProgress({ vehicleId }) {
  const sessions = useWorkSessions(vehicleId);
  if (!sessions?.length) return null;  // disappears entirely
  // ...render
}
```

---

## The Profile as Data Attractor

The vehicle profile attracts data. As more observations arrive from more sources, the profile gets richer. Every new piece of data makes the computation more accurate.

Data arrives from many directions:
- **Extractors** find new listings, auction results, forum mentions
- **Users** contribute photos, corrections, personal knowledge
- **Vision pipeline** classifies images by area, operation, condition
- **Comment analysis** extracts sentiment, expertise signals, factual claims
- **Cross-platform resolution** discovers that the same chassis appeared in 5 different places
- **Work tracking** records every session, part, and invoice
- **Receipt mining** connects financial records to specific operations

None of this data is "pushed" to the profile. The profile computes over whatever is in the graph. When a new observation arrives via `ingest-observation`, the next time the profile renders, the new data is included in the computation. No cache invalidation. No event bus. No subscription. Just a function from graph state to rendered intelligence.

---

## What Agents Must Understand

These rules are mandatory for any agent working on the vehicle profile or its data sources.

### 1. Do Not Create Parallel Systems

Work events go into work_orders and work_order_line_items. Photos go into vehicle_images. Receipts go into receipts or work_order_line_items. Auction results go into auction_events. Timeline events go into vehicle_observations.

Do not create `build_log` tables. Do not create `day_card` tables. Do not create `invoice` tables that duplicate work_order data. Do not create `photo_album` tables. The existing tables are the system. Feed them.

### 2. Do Not Show Aggregates Over Dirty Data

No median prices computed over heterogeneous mixes of vehicles. No "average days on market" that blends dealer inventory with estate sales. No statistics that look precise but are computed over data that has not been cleaned or classified.

Show specific vehicles. Show specific transactions. Show specific facts with citations. When aggregates are appropriate, show the underlying data that produced them.

### 3. Do Not Cache What Should Be Computed

The nuke estimate is a live computation, not a stored value that gets displayed. The heat score is a live computation. The deal score is a live computation. The auction readiness score is a live computation.

These values exist in the database as materialized snapshots for performance in list views and API responses. But the vehicle profile page computes them fresh from the underlying data. The profile is the computation surface — it shows the live answer, not the cached answer.

### 4. Do Not Rewrite Files

Read the existing code first. Understand what is there. Make surgical edits. A bug fix is 3-10 lines, not a 400-line file replacement. Before creating a new component, check if the functionality already exists in a different component that can be extended. Before creating a new hook, check if an existing hook already queries the data you need.

### 5. The Popup is the Deep Dive

Every clickable element on the profile should open a popup with full-resolution detail. The profile surface shows the summary; the popup shows the computation. Click a work session — get the Day Card with all seven levels of analysis. Click a photo cluster — get the full gallery with classification metadata. Click a price — get the comparable sales and computation methodology.

The profile is a summary surface. The popups are the computation surfaces. Together they form the complete materialization layer.

### 6. Existing Tables to Use

Before creating anything new, check these existing structures:

| Data Type | Where It Goes |
|-----------|--------------|
| Work events | `work_orders`, `work_order_line_items`, `work_sessions` |
| Photos | `vehicle_images` (with area/operation classification) |
| Parts | `work_order_line_items` (type = 'part') |
| Receipts/costs | `work_order_line_items` (with cost fields) |
| Timeline events | `vehicle_observations` (via `ingest-observation`) |
| Auction results | `auction_events`, `vehicle_events` |
| Comments/sentiment | `auction_comments`, `comment_discoveries` |
| Condition data | `vehicle_observations` (kind = 'condition_report') |
| Owner history | `vehicle_observations` (kind = 'ownership_transfer') |
| Market data | `analysis_signals` (computed by analysis engine) |

### 7. Timeline Data Merging

The BarcodeTimeline renders from `VehicleProfileContext.timelineEvents`, which is a **merged array** of two sources:

- **`timeline_events` table** — Photo sessions, auction events, modifications, inspections, etc.
- **`work_sessions` table** — Work performed on the vehicle (fabrication, parts, heavy work, etc.)

Work sessions are converted to timeline event shape (`event_type: 'work_session'`, metadata includes `work_type`, `image_count`, `duration_minutes`, `total_parts_cost`, etc.) by the context provider before being passed to the timeline. This merging happens in `VehicleProfileContext.loadTimelineEvents()`.

**Why two tables?** `timeline_events` was created for general lifecycle events. `work_sessions` was created by the work photo pipeline for detailed build tracking with session-level metadata (duration, zones touched, technician, labor costs). They serve different write paths but the same read surface — the timeline.

**Day Card popups:** When a user clicks a day on the BarcodeTimeline that has a work session, the receipt popup shows work-specific detail (duration, photos, work description) and an "OPEN DAY CARD" button that opens a full DayCard in the PopupStack. The DayCard auto-loads detailed data via the `get_daily_work_receipt` RPC.

### 8. The Profile Is the Convergence Point

All roads lead to the vehicle profile. Every data source, every extraction pipeline, every user contribution, every automated analysis — they all produce data that the vehicle profile consumes and renders. The profile is where the knowledge graph becomes visible.

Do not create alternative display systems. Do not create dashboards that recompute what the profile already computes. Do not create "summary views" that bypass the profile's computation. If you need to show vehicle intelligence somewhere, link to the vehicle profile or use the same computation functions the profile uses.

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                    VEHICLE PROFILE PAGE                         │
│                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│  │  Identity Header     │  │  Timeline                        │ │
│  │  (YMM, VIN, hero)    │  │  ┌─────────────────────────────┐ │ │
│  │                      │  │  │ Day Card Popup               │ │ │
│  │  Progressive:        │  │  │  - Raw data layer            │ │ │
│  │  shows only what     │  │  │  - 7-level analysis          │ │ │
│  │  data supports       │  │  │  - Generate Bill button      │ │ │
│  │                      │  │  └─────────────────────────────┘ │ │
│  ├──────────────────────┤  │                                  │ │
│  │  Computed Signals    │  │  Filters:                        │ │
│  │  (live, not cached)  │  │  [All] [Work] [Photos] [Sales]  │ │
│  │  - Nuke Estimate     │  │  [Title] [Condition] [Community]│ │
│  │  - Heat Score        │  │                                  │ │
│  │  - ARS               │  │  Each filter = same timeline,   │ │
│  │  - Deal Score        │  │  different event types shown     │ │
│  ├──────────────────────┤  ├──────────────────────────────────┤ │
│  │  Context Widgets     │  │  Bill / Invoice View             │ │
│  │  (appear only when   │  │  (same data as Day Card,         │ │
│  │   data exists)       │  │   rendered as document)          │ │
│  └──────────────────────┘  └──────────────────────────────────┘ │
│                                                                 │
│  Data source: Knowledge Graph (vehicle_observations,            │
│  work_orders, vehicle_images, auction_events, etc.)             │
│  Computation: Real-time on render. No caching layer.            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Related Documents

- **Digital Twin Architecture**: `~/.claude/projects/-Users-skylar/memory/digital-twin-architecture.md` — The north star. The database IS the vehicle.
- **Design Book**: `docs/library/technical/design-book/` — Visual language, components, interactions.
- **Auction Readiness Strategy**: Referenced in MEMORY.md — ARS is one of the computed signals.
- **Extraction Handbook**: `docs/library/technical/extraction-playbook.md` — How data enters the pipeline.
- **Entity Resolution Rules**: `docs/architecture/ENTITY_RESOLUTION_RULES.md` — How observations link to vehicles.
- **Dictionary**: `docs/library/reference/dictionary/README.md` — Canonical definitions for Computation Surface, Day Card, Progressive Density, Seven-Level Analysis, Timeline Event, Materialization Layer.

---

*This document is the canonical reference for all vehicle profile work. Read it before touching profile code. If your change contradicts this document, stop and reconsider.*
