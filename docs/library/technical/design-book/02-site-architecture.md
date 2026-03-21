# Chapter 2: Site Architecture — Every Page, Every Component

**Status**: Reference (auto-generated from codebase inventory, 2026-03-21)
**Site**: nuke.ag
**Stack**: React 18 + React Router v6 + Supabase + TanStack Query + Vite

---

## 2.1 The Three Entity Types

Everything on the site is a view of one of three entity types. Every page is either showing an entity, listing entities, or comparing entities.

| Entity | Profile Page | Data Source | Core Identity |
|--------|-------------|-------------|---------------|
| **Vehicle** | `/vehicle/:id` | `vehicles` table + `vehicle_observations` + `vehicle_images` | Year, Make, Model, VIN |
| **User** | `/profile/:userId` | `users` table + `vehicles` (owned) + `organizations` (member of) | Name, reputation, contributions |
| **Organization** | `/org/:id` | `organizations` table + `vehicles` (inventory) + `users` (members) | Name, type (dealer/shop/auction house) |

Every other page is a derivative view — a filtered, aggregated, or specialized lens on these three entity types and the observations connecting them.

---

## 2.2 Page Hierarchy

### Tier 1: Entity Profiles (the core)

These are the pages that matter. Everything else feeds into or derives from them.

| Page | Route | Component | Lines | What it shows |
|------|-------|-----------|-------|--------------|
| **Vehicle Profile** | `/vehicle/:id` | `VehicleProfile.tsx` + `VehicleHeader.tsx` (4,924) | ~8,000 total | The vehicle as knowledge graph: specs, images, timeline, comments, provenance, observations, scores |
| **User Profile** | `/profile/:userId` | `Profile.tsx` (1,118) | ~1,500 | The person: their vehicles, organizations, contributions, reputation |
| **Organization Profile** | `/org/:id` | `OrganizationProfile.tsx` | ~1,200 | The org: inventory, members, deals, reputation |

### Tier 2: Discovery (finding entities)

| Page | Route | Component | Lines | What it shows |
|------|-------|-----------|-------|--------------|
| **Home/Hub** | `/` | `HomePage.tsx` (912) | ~1,500 | Garage, Feed, Map, Market tabs — the dashboard |
| **Search** | `/search` | `Search.tsx` + `SearchResults.tsx` (900) | ~1,500 | Global search across vehicles, orgs, users |
| **Browse** | `/browse` | `BrowseVehicles.tsx` (604) | ~1,000 | Vehicle grid with filters |
| **Auction Marketplace** | `/auctions` | `AuctionMarketplace.tsx` (979) | ~1,500 | Live and recent auctions |
| **Feed** | embedded in Home | `DiscoveryFeed.tsx` | ~800 | Activity stream of observations |

### Tier 3: Action (doing things with entities)

| Page | Route | Component | Lines | Purpose |
|------|-------|-----------|-------|---------|
| **Add Vehicle** | `/vehicle/add` | `AddVehicle.tsx` (2,188) | Multi-step | Create vehicle from URL, VIN, or manual entry |
| **Edit Vehicle** | `/vehicle/:id/edit` | `EditVehicle.tsx` (1,362) | | Modify vehicle data |
| **Photo Library** | `/photo-library` | `PersonalPhotoLibrary.tsx` (1,719) | | Organize and assign photos |
| **Capture** | `/capture` | `Capture.tsx` | | Camera-based data intake |
| **Restoration Intake** | `/restoration` | `RestorationIntake.tsx` (949) | | Start a restoration project |
| **Import Data** | `/import` | `ImportDataPage.tsx` (590) | | Bulk data import |
| **Create Auction** | `/auctions/create` | `CreateAuctionListing.tsx` | | List a vehicle for auction |

### Tier 4: Business (money and management)

| Page | Route | Component | Lines | Purpose |
|------|-------|-----------|-------|---------|
| **Portfolio** | `/market/portfolio` | `Portfolio.tsx` (1,269) | | Investment holdings |
| **Market Dashboard** | `/market/dashboard` | `MarketDashboard.tsx` | | Market overview |
| **Invoices** | `/invoices` | `InvoiceManager.tsx` (804) | | Invoice management |
| **My Auctions** | `/auctions/mine` | `MyAuctions.tsx` (1,027) | | User's auction activity |
| **Dealer Tools** | `/dealer/*` | 3 pages | | Dealer-specific workflows |
| **Developer Portal** | `/developers` | `developers/index.tsx` (3,053) | | API docs and SDK |

### Tier 5: Admin (ops and monitoring)

50+ admin pages behind `/admin/*`. Key ones:

| Page | Lines | Purpose |
|------|-------|---------|
| Mission Control | 1,949 | Ops dashboard — extraction jobs, sync status |
| Verifications | 1,239 | Ownership claim review queue |
| Extraction Monitor | 660 | Watch extraction jobs in real-time |
| Data Quality | 537 | Data quality metrics and alerts |
| Scraper Dashboard | 723 | Scraper health and status |

---

## 2.3 The Vehicle Profile (in detail)

The vehicle profile is the most important page. 8,000+ lines across 14 components. Here's what each piece does:

```
┌─────────────────────────────────────────────────────────────┐
│ VehicleHeader (4,924 lines)                                  │
│ ┌─────────────────────────────────────────────────────────┐  │
│ │ VehicleHeroImage (205)  │ VehicleBadgeBar (84)          │  │
│ │ Primary photo           │ Tags: matching#, concours...  │  │
│ └─────────────────────────┴───────────────────────────────┘  │
│ ┌─────────────────────────────────────────────────────────┐  │
│ │ VehicleSubHeader (726)                                   │  │
│ │ Auction status, reserve, bid count, platform             │  │
│ └─────────────────────────────────────────────────────────┘  │
│ ┌─────────────────────────────────────────────────────────┐  │
│ │ VehicleBasicInfo (1,003)                                 │  │
│ │ Specs table: engine, trans, drivetrain, colors, mileage  │  │
│ │ THIS IS WHERE vehicle_current_state VIEW SHOULD FEED     │  │
│ └─────────────────────────────────────────────────────────┘  │
│ ┌─────────────────────────────────────────────────────────┐  │
│ │ QuickStatsBar (62)                                       │  │
│ │ Comment count, image count, observation count             │  │
│ └─────────────────────────────────────────────────────────┘  │
│ ┌────────────────────────┬────────────────────────────────┐  │
│ │ VehicleDossierPanel    │ VehicleScoresWidget (103)      │  │
│ │ (773)                  │ Auction readiness, condition,  │  │
│ │ Data quality,          │ market scores                  │  │
│ │ completeness %,        │                                │  │
│ │ missing fields         │                                │  │
│ └────────────────────────┴────────────────────────────────┘  │
│ ┌─────────────────────────────────────────────────────────┐  │
│ │ BarcodeTimeline (597)                                    │  │
│ │ Event timeline: auctions, transfers, observations        │  │
│ └─────────────────────────────────────────────────────────┘  │
│ ┌─────────────────────────────────────────────────────────┐  │
│ │ VehicleBanners (99)                                      │  │
│ │ Status alerts: pending, merged, deleted, needs review    │  │
│ └─────────────────────────────────────────────────────────┘  │
│ ┌─────────────────────────────────────────────────────────┐  │
│ │ WorkspaceContent (395) — TABBED                          │  │
│ │ ┌──────┬─────────┬──────────┬──────────┬──────────────┐ │  │
│ │ │Photos│ History │ Timeline │ Comments │ Provenance   │ │  │
│ │ └──────┴─────────┴──────────┴──────────┴──────────────┘ │  │
│ └─────────────────────────────────────────────────────────┘  │
│ ┌─────────────────────────────────────────────────────────┐  │
│ │ FieldProvenanceDrawer (390)                              │  │
│ │ Click any field → shows which source contributed it      │  │
│ │ THIS IS WHERE observation weights + freshness SHOULD GO  │  │
│ └─────────────────────────────────────────────────────────┘  │
│ ┌─────────────────────────────────────────────────────────┐  │
│ │ VehicleSaleSettings (189)                                │  │
│ │ Price, auction config, reserve controls                  │  │
│ └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Data flow:**
```
VehicleProfileContext.tsx (831 lines)
  → loadVehicleImpl() → Supabase query on vehicles table
  → selectBestHeroImage() → vehicle_images (AI-scored)
  → loadVehicleImagesImpl() → vehicle_images with filters
  → buildAuctionPulseFromExternalListings() → vehicle_events
```

**Key gap:** The profile reads from `vehicles` table directly. The `vehicle_current_state` view (weighted observation composite) exists but is NOT consumed by the profile page yet.

---

## 2.4 Shared Components (the widget system)

### What we call things

| Term | Size | Examples | Purpose |
|------|------|---------|---------|
| **Primitive** | 1-20 lines | `Badge`, `Button`, `Input`, `Label` | Base UI atoms from `src/components/ui/` |
| **Widget** | 50-200 lines | `QuickStatsBar`, `VehicleScoresWidget`, `VehicleBanners` | Small data display units, single concern |
| **Card** | 200-1,000 lines | `VehicleCardDense` (3,162), `GarageVehicleCard` (1,113) | Medium content blocks, self-contained |
| **Panel** | 500-2,000 lines | `VehicleDossierPanel` (773), `VehicleOwnershipPanel` (1,121) | Large layout sections with multiple concerns |
| **Page** | 500-5,000 lines | `VehicleProfile`, `HomePage`, `AdminMissionControl` | Full route targets |

### The 12 UI Primitives (`src/components/ui/`)

```
badge.tsx        — Tag/label component
button.tsx       — Standardized button (primary, secondary, ghost)
card.tsx         — Card container with header/body/footer
checkbox.tsx     — Checkbox input
input.tsx        — Text input
label.tsx        — Form label
select.tsx       — Dropdown select
textarea.tsx     — Multi-line text input
Toast.tsx        — Toast notification
ConfirmModal.tsx — Confirmation dialog
CollapsibleWidget.tsx — Expand/collapse container
BlueGlowIcon.tsx — Icon with glow effect
```

### Image System (5 components, ~9,000 lines)

| Component | Lines | Purpose |
|-----------|-------|---------|
| `ImageGallery.tsx` | 4,394 | Main gallery with grid/carousel modes |
| `ImageLightbox.tsx` | 2,247 | Full-screen image viewer |
| `ImageInfoPanel.tsx` | 1,179 | EXIF data, AI analysis, tagging |
| `EnhancedImageTagger.tsx` | 1,018 | Manual image tagging/labeling |
| `UniversalImageUpload.tsx` | 763 | Upload interface |

### Search System (3 components, ~3,700 lines)

| Component | Lines | Purpose |
|-----------|-------|---------|
| `AIDataIngestionSearch.tsx` | 1,877 | URL → extract → ingest search bar |
| `SearchResults.tsx` | 900 | Result cards with filters |
| `SearchFilterPanel.tsx` | — | Filter sidebar |

---

## 2.5 Derivative Pages

Most pages are filtered/aggregated views of the three entity types:

| Page | Derives From | Filter/Lens |
|------|-------------|-------------|
| Browse | Vehicle list | Year/make/model/price filters |
| Auction Marketplace | Vehicle list + events | Where event_type = 'auction' AND status = 'active' |
| Portfolio | Vehicle list + valuations | Where owner = current_user |
| My Auctions | Vehicle list + auction_events | Where seller = current_user |
| Dealer Inventory | Vehicle list + organization | Where org_id = dealer AND status = 'for_sale' |
| Garage (Home tab) | Vehicle list | Where owner = current_user |
| Feed | Observation stream | Recent observations across all followed entities |
| Market Dashboard | Aggregated vehicle stats | By segment, make, year range |
| Curation Queue | Vehicle list | Where needs_review = true |

---

## 2.6 Component Count Summary

| Category | Count | Total Lines (est.) |
|----------|-------|--------------------|
| Pages | 132 | ~40,000 |
| Components | 431 | ~50,000 |
| Hooks | 43 | ~5,000 |
| Services | 118 | ~15,000 |
| Contexts | 4 | ~2,000 |
| UI Primitives | 12 | ~500 |
| CSS | 4 files | 2,861 |
| **Total** | **744 files** | **~115,000 lines** |

---

## 2.7 Design System Reference

See `01-foundations.md` for the complete design token spec. Key rules:

- **Font**: Arial only. Courier New for data values.
- **Size**: 8-12px. Nothing larger except page titles.
- **Borders**: 2px solid. Zero radius. Zero shadows. Zero gradients.
- **Spacing**: 4px base unit.
- **Labels**: ALL CAPS at 8-9px.
- **Animation**: 180ms cubic-bezier(0.16, 1, 0.3, 1).
- **Colors**: Grey palette. Racing accents (Gulf, Martini, JPS) as easter eggs only.
