# DESIGN BOOK — Chapter 4: Screens

Every screen in the application. What it shows, how it behaves in every state, what components it uses.

**Cross-references:**
- Component specs: [02-components.md](./02-components.md)
- Site architecture: [02-site-architecture.md](./02-site-architecture.md)
- Interaction patterns: [03-interactions.md](./03-interactions.md)
- Design tokens: [TOKENS.md](./TOKENS.md)

---

## Home / Hub

**Route:** `/`
**File:** `nuke_frontend/src/pages/HomePage.tsx`
**Purpose:** The landing dashboard. Tabs between Garage, Feed, Map, and Market views.
**Primary Interaction:** Switch between personal vehicle collection and discovery feeds.

### Layout Spec

- Background: `var(--bg)`
- Tab bar at top: GARAGE, FEED, MAP, MARKET tabs
- Tab content fills remaining viewport
- Tab state stored in URL query param (`?tab=feed`) for deep-linking

### Screen States

**Loaded State — Data Present:**
- GARAGE tab: Grid of user's vehicles (GarageVehicleCard components)
- FEED tab: FeedPage component with FeedStatsStrip, FeedToolbar, and vehicle card grid
- MAP tab: NukeMap component with vehicle location pins
- MARKET tab: Market overview with segments and trends

**Loaded State — No Data (Empty):**
- GARAGE: "NO VEHICLES YET" + "ADD VEHICLE" button linking to `/vehicle/add`
- FEED: FeedEmptyState component — "NO VEHICLES MATCH" + SEARCH and AUCTIONS links
- MAP: Map renders with no pins. No error state needed.
- MARKET: Market data always has content (aggregated stats)

**Loading State:**
- Tab content area shows `background: var(--bg)` with matching skeleton heights
- FeedStatsStrip shows a 32px height skeleton bar

**Error State:**
- Generic error message at 10px, `var(--text-secondary)`, with retry action

### Component Inventory

- Tab bar (custom, not a third-party component)
- `GarageVehicleCard` — vehicle cards in Garage tab
- `FeedPage` — full feed experience (FeedStatsStrip, FeedToolbar, FeedLayout, VehicleCard)
- `NukeMap` — Leaflet/MapLibre map
- Market segment cards

---

## Vehicle Profile

**Route:** `/vehicle/:id`
**File:** `nuke_frontend/src/pages/vehicle-profile/VehicleHeader.tsx` (4,924 lines) + context
**Purpose:** The most important page. Shows a vehicle as a knowledge graph: specs, images, timeline, comments, provenance, observations, scores.
**Primary Interaction:** Explore every dimension of a vehicle through BadgePortals and tabbed content.
**Data Sources:** `vehicles` table, `vehicle_images`, `vehicle_events`, `auction_comments`, `vehicle_observations`

### Layout Spec

- Background: `var(--bg)`
- Full-width hero image area
- Below hero: VehicleSubHeader with auction status and BadgePortals for year, make, model
- VehicleBasicInfo: specs table (engine, transmission, drivetrain, colors, mileage)
- QuickStatsBar: comment count, image count, observation count
- Two-column layout: VehicleDossierPanel (left) + VehicleScoresWidget (right)
- BarcodeTimeline: event history visualization
- WorkspaceContent: tabbed area (Photos, History, Timeline, Comments, Provenance)
- FieldProvenanceDrawer: click any field to see which source contributed it

### Screen States

**Loaded State — Data Present:**
- Hero image fills top area (4:3 aspect, selected by AI scoring from `vehicle_images`)
- All spec fields populated from `vehicles` table
- BadgePortals active with depth counts
- Timeline shows events in chronological order
- Comments section shows extracted auction comments

**Loaded State — No Hero Image:**
- Instead of dark void: vehicle identity displayed as text + BadgePortals for year, make, model, body style, transmission
- "NO PHOTO" label at `var(--fs-7)`, `var(--text-disabled)`

**Loaded State — No Timeline:**
- "Explore [year] [make] vehicles for comparables" with linked BadgePortals

**Loading State:**
- Hero image area: `var(--surface-hover)` fill at correct aspect ratio
- Spec table: grey fill bars matching text line heights
- No animation on skeletons

**Error State:**
- "VEHICLE NOT FOUND" at 12px, `var(--text-secondary)` + "SEARCH" and "BROWSE" links

### Component Inventory

- `VehicleHeroImage` — primary photo display
- `VehicleBadgeBar` — tag badges (matching#, concours, etc.)
- `VehicleSubHeader` — auction status, reserve, bid count, BadgePortals
- `VehicleBasicInfo` — specs table
- `QuickStatsBar` — inline stat counters
- `VehicleDossierPanel` — data quality, completeness %, missing fields
- `VehicleScoresWidget` — auction readiness, condition, market scores
- `BarcodeTimeline` — event timeline visualization
- `VehicleBanners` — status alerts (pending, merged, deleted)
- `WorkspaceContent` — tabbed content area
- `FieldProvenanceDrawer` — field-level source attribution
- `VehicleSaleSettings` — price, auction config, reserve controls

### Common Violations

- Adding `border-radius` to the hero image container
- Using `box-shadow` on the specs table for "card effect"
- Using 14px+ font sizes on spec labels
- Static badge elements instead of BadgePortals

---

## Feed / Discovery

**Route:** Embedded in Home (`/?tab=feed`)
**File:** `nuke_frontend/src/feed/components/FeedPage.tsx`
**Purpose:** The primary vehicle discovery experience. Grid of vehicle cards with filtering.
**Primary Interaction:** Browse, filter, and expand vehicle cards. Click badges to explore clusters.

### Layout Spec

- FeedStatsStrip: sticky 32px bar with vehicle count, value, today's additions, for-sale count, live auctions, inline search
- FeedToolbar: view mode toggle (grid/gallery/technical), sort controls, filter controls
- FeedLayout: responsive grid of VehicleCard components
- FeedFilterSidebar: collapsible filter panel (make, year range, price range, body style, transmission, drivetrain, source)

### Screen States

**Loaded State — Data Present:**
- Grid mode: cards arranged in responsive grid (auto-fill, minmax ~260px)
- Gallery mode: horizontal list rows with thumbnail + text
- Technical mode: dense table rows with inline data
- Each card uses CardShell with click-to-expand behavior in grid mode

**Loaded State — No Data (Empty):**
- FeedEmptyState: "NO VEHICLES MATCH" + filter reset button + SEARCH and AUCTIONS links

**Loading State:**
- FeedSkeleton: grey card shapes matching grid layout, no animation

### Component Inventory

- `FeedStatsStrip` — stats bar
- `FeedToolbar` — view/sort/filter controls
- `FeedLayout` — responsive grid container
- `VehicleCard` — individual vehicle card (wraps CardShell, CardImage, CardIdentity, CardMeta, CardDealScore, CardSource, CardPrice, CardRankScore)
- `FeedEmptyState` — empty state with actions
- `FeedFilterSidebar` — filter panel
- `FeedSkeleton` — loading skeleton

---

## Search

**Route:** `/search`
**File:** `nuke_frontend/src/pages/Search.tsx`
**Purpose:** Global search across vehicles, organizations, and users.
**Primary Interaction:** Type query, browse results, click to navigate.

### Screen States

**Loaded — Results Present:**
- Results grouped by entity type (vehicles, orgs, users)
- Vehicle results show thumbnail, YMM, price, source
- Organization results show name, type, vehicle count

**Loaded — No Results:**
- "NO RESULTS FOR [QUERY]" + suggestion to broaden search + links to Browse and Auctions

**Loading State:**
- Result card skeletons matching loaded layout

---

## Browse Vehicles

**Route:** `/browse`
**File:** `nuke_frontend/src/pages/BrowseVehicles.tsx`
**Purpose:** Filtered vehicle grid with faceted search.
**Primary Interaction:** Apply filters (year, make, model, price) to narrow vehicle list.

### Screen States

**Loaded — Data Present:**
- Vehicle grid with filter sidebar
- Active filters shown as removable badges above grid

**Loaded — No Results:**
- Empty state with filter reset and search link

---

## Auction Marketplace

**Route:** `/auctions`
**File:** `nuke_frontend/src/pages/AuctionMarketplace.tsx`
**Purpose:** Live and recent auction listings.
**Primary Interaction:** Browse active auctions, view auction details.

### Screen States

**Loaded — Active Auctions Present:**
- Grid of auction cards with countdown timers, current bid, reserve status
- Sorted by ending soonest by default

**Loaded — No Live Auctions:**
- Shows recently ended auctions (last 30 days) as fallback
- "NO LIVE AUCTIONS" label + recently ended section

---

## Auction Listing Detail

**Route:** `/auction/:listingId`
**File:** `nuke_frontend/src/pages/AuctionListing.tsx`
**Purpose:** Individual auction listing with bid history, images, and vehicle data.
**Primary Interaction:** View auction details, place bids (if authenticated).

---

## Profile

**Route:** `/profile` (own) or `/profile/:userId` (public)
**File:** `nuke_frontend/src/pages/Profile.tsx`
**Purpose:** User profile showing vehicles, organizations, contributions, reputation.
**Primary Interaction:** View user's vehicle collection and activity.

### Screen States

**Loaded — Own Profile:**
- Vehicle collection grid
- Organization memberships
- Activity feed

**Loaded — Public Profile:**
- Public vehicles only
- Organization affiliations

---

## Organization Profile

**Route:** `/org/:id`
**File:** `nuke_frontend/src/pages/OrganizationProfile.tsx`
**Purpose:** Organization page showing inventory, members, deals.
**Primary Interaction:** Browse organization's vehicle inventory.

---

## Add Vehicle

**Route:** `/vehicle/add`
**File:** `nuke_frontend/src/pages/add-vehicle/AddVehicle.tsx`
**Purpose:** Multi-step vehicle creation from URL, VIN, or manual entry.
**Primary Interaction:** Paste URL or enter VIN to create vehicle record.

---

## Edit Vehicle

**Route:** `/vehicle/:id/edit`
**File:** `nuke_frontend/src/pages/EditVehicle.tsx`
**Purpose:** Modify existing vehicle data.

---

## Personal Photo Library

**Route:** `/photo-library` or `/inbox`
**File:** `nuke_frontend/src/pages/PersonalPhotoLibrary.tsx`
**Purpose:** Photo organization and vehicle assignment.
**Primary Interaction:** Upload, review, and assign photos to vehicles.

---

## Capture

**Route:** `/capture`
**File:** `nuke_frontend/src/pages/Capture.tsx`
**Purpose:** Camera-based data intake for technicians and shop workers.

---

## Tech Capture

**Route:** `/tech`
**File:** `nuke_frontend/src/pages/TechCapture.tsx`
**Purpose:** Technician photo upload pipeline.

---

## Restoration Intake

**Route:** `/restoration`
**File:** `nuke_frontend/src/pages/RestorationIntake.tsx`
**Purpose:** Start a restoration project workflow.

---

## Library

**Route:** `/library`
**File:** `nuke_frontend/src/pages/Library.tsx`
**Purpose:** Document and media library.

---

## Capsule

**Route:** `/capsule`
**File:** `nuke_frontend/src/pages/Capsule.tsx`
**Purpose:** Time capsule / vehicle snapshot feature.

---

## Notifications

**Route:** `/notifications`
**File:** `nuke_frontend/src/pages/Notifications.tsx`
**Purpose:** User notification center.

---

## Daily Debrief

**Route:** `/debrief`
**File:** `nuke_frontend/src/pages/DailyDebrief.tsx`
**Purpose:** Daily activity summary and briefing.

---

## Portfolio

**Route:** `/market/portfolio`
**File:** `nuke_frontend/src/pages/Portfolio.tsx`
**Purpose:** Investment holdings and valuations.

---

## Market Dashboard

**Route:** `/market/dashboard`
**File:** `nuke_frontend/src/pages/MarketDashboard.tsx`
**Purpose:** Market overview with segment analysis.

---

## Invoice Manager

**Route:** `/invoices`
**File:** `nuke_frontend/src/pages/InvoiceManager.tsx`
**Purpose:** Invoice creation and management.

---

## Import Data

**Route:** `/import`
**File:** `nuke_frontend/src/pages/ImportDataPage.tsx`
**Purpose:** Bulk data import pipeline.

---

## Curation Queue

**Route:** `/curation-queue`
**File:** `nuke_frontend/src/pages/CurationQueue.tsx`
**Purpose:** Review queue for AI-detected vehicles and data.

---

## BaT Members

**Route:** `/bat-members` or `/members`
**File:** `nuke_frontend/src/pages/BaTMembers.tsx`
**Purpose:** Bring a Trailer community member directory.

---

## Claim External Identity

**Route:** `/claim-identity`
**File:** `nuke_frontend/src/pages/ClaimExternalIdentity.tsx`
**Purpose:** Link external platform identities to Nuke account.

---

## Acquisition Pipeline

**Route:** `/pipeline`
**File:** `nuke_frontend/src/pages/AcquisitionPipeline.tsx`
**Purpose:** Vehicle acquisition tracking and pipeline management.

---

## Team Inbox

**Route:** `/team-inbox`
**File:** `nuke_frontend/src/pages/TeamInbox.tsx`
**Purpose:** Shared team communication and task management.

---

## Business Settings

**Route:** `/business/settings`
**File:** `nuke_frontend/src/pages/BusinessSettings.tsx`
**Purpose:** Business/organization configuration.

---

## Developer Portal

**Route:** `/developers`
**File:** `nuke_frontend/src/pages/developers/index.tsx`
**Purpose:** API documentation, SDK reference, developer tools.

---

## Settings Pages

**Routes:** `/settings/api-keys`, `/settings/webhooks`, `/settings/usage`
**Files:** `nuke_frontend/src/pages/settings/ApiKeysPage.tsx`, `WebhooksPage.tsx`, `UsageDashboardPage.tsx`
**Purpose:** API key management, webhook configuration, usage metrics.

---

## Static / Legal Pages

| Route | File | Purpose |
|-------|------|---------|
| `/about` | `About.tsx` | About page |
| `/privacy` | `PrivacyPolicy.tsx` | Privacy policy |
| `/terms` | `TermsOfService.tsx` | Terms of service |
| `/eula` | `EULA.tsx` | End user license agreement |
| `/data-deletion` | `DataDeletion.tsx` | Data deletion instructions |
| `/extension` | `Extension.tsx` | Browser extension landing page |

---

## Auth Pages

| Route | File | Purpose |
|-------|------|---------|
| `/login` | `auth/Login.tsx` | Login / signup |
| `/signup` | `auth/Login.tsx` | Same as login (tab switch) |
| `/reset-password` | `ResetPassword.tsx` | Password reset flow |
| `/auth/callback` | `auth/OAuthCallback.tsx` | OAuth redirect handler |

---

## Admin Pages (50+)

All behind `/admin/*` route with `RequireAdmin` gate.

| Page | File | Purpose |
|------|------|---------|
| Mission Control | `AdminMissionControl.tsx` | Ops dashboard: extraction jobs, sync status |
| Analytics | `AdminAnalytics.tsx` | Platform analytics |
| Pending Vehicles | `AdminPendingVehicles.tsx` | Vehicle review queue |
| Verifications | `AdminVerifications.tsx` | Ownership claim review |
| Data Diagnostic | `DataDiagnostic.tsx` | Data quality diagnostics |
| Database Audit | `DatabaseAudit.tsx` | Database health checks |
| Scraper Dashboard | `admin/UnifiedScraperDashboard.tsx` | Scraper health and status |
| Sources Dashboard | `admin/SourcesDashboard.tsx` | Data source monitoring |
| Identity Claims | `admin/AdminIdentityClaims.tsx` | Identity claim management |
| Inventory Analytics | `admin/InventoryAnalytics.tsx` | Inventory metrics |
| User Metrics | `admin/UserMetrics.tsx` | User activity metrics |
| Pulse | `admin/AdminPulse.tsx` | Real-time system pulse |
| Data Pulse | `admin/DataPulse.tsx` | Data pipeline pulse |
| Bot Test | `admin/BotTestDashboard.tsx` | Bot testing interface |
| Bulk Price Editor | `admin/BulkPriceEditor.tsx` | Batch price editing |
| Price CSV Import | `admin/PriceCsvImport.tsx` | CSV-based price import |
| Proxy Bid Ops | `admin/ProxyBidOperations.tsx` | Proxy bid management |
| Meme Library | `admin/MemeLibraryAdmin.tsx` | Meme content management |
| KSL Scraper | `admin/KSLScraper.tsx` | KSL.com scraper interface |

---

## Route-to-Screen Mapping (Complete)

| Route | Page File | Screen Name |
|-------|-----------|-------------|
| `/` | `HomePage.tsx` | Home / Hub |
| `/vehicle/:id` | `vehicle-profile/VehicleHeader.tsx` | Vehicle Profile |
| `/vehicle/add` | `add-vehicle/AddVehicle.tsx` | Add Vehicle |
| `/vehicle/:id/edit` | `EditVehicle.tsx` | Edit Vehicle |
| `/vehicle/list` | `Vehicles.tsx` | Vehicle List |
| `/search` | `Search.tsx` | Search |
| `/browse` | `BrowseVehicles.tsx` | Browse Vehicles |
| `/auctions` | `AuctionMarketplace.tsx` | Auction Marketplace |
| `/auction/:listingId` | `AuctionListing.tsx` | Auction Detail |
| `/profile` | `Profile.tsx` | Own Profile |
| `/profile/:userId` | `Profile.tsx` | Public Profile |
| `/org/:id` | `OrganizationProfile.tsx` | Organization Profile |
| `/org` | (via OrganizationRoutes) | Organization List |
| `/org/create` | `CreateOrganization.tsx` | Create Organization |
| `/market/portfolio` | `Portfolio.tsx` | Portfolio |
| `/market/dashboard` | `MarketDashboard.tsx` | Market Dashboard |
| `/photo-library` | `PersonalPhotoLibrary.tsx` | Photo Library |
| `/capture` | `Capture.tsx` | Capture |
| `/tech` | `TechCapture.tsx` | Tech Capture |
| `/restoration` | `RestorationIntake.tsx` | Restoration Intake |
| `/library` | `Library.tsx` | Library |
| `/capsule` | `Capsule.tsx` | Capsule |
| `/notifications` | `Notifications.tsx` | Notifications |
| `/debrief` | `DailyDebrief.tsx` | Daily Debrief |
| `/invoices` | `InvoiceManager.tsx` | Invoice Manager |
| `/import` | `ImportDataPage.tsx` | Import Data |
| `/curation-queue` | `CurationQueue.tsx` | Curation Queue |
| `/pipeline` | `AcquisitionPipeline.tsx` | Acquisition Pipeline |
| `/team-inbox` | `TeamInbox.tsx` | Team Inbox |
| `/bat-members` | `BaTMembers.tsx` | BaT Members |
| `/claim-identity` | `ClaimExternalIdentity.tsx` | Claim Identity |
| `/developers` | `developers/index.tsx` | Developer Portal |
| `/business/settings` | `BusinessSettings.tsx` | Business Settings |
| `/admin/*` | (50+ admin pages) | Admin |

---

## Universal Screen Rules

Every screen in the application follows these rules:

1. **Background:** `var(--bg)` on the page container
2. **No dead-end empty states.** Every empty view offers a next action.
3. **No loading spinners.** Use static skeleton fills matching the loaded layout.
4. **No gradients, shadows, or rounded corners** on any element.
5. **ALL CAPS labels** at 8-9px for section headers and category labels.
6. **Courier New for data values** (prices, counts, VINs, timestamps).
7. **URL state:** Every navigable screen state is reflected in the URL for deep-linking.
8. **Responsive:** Content reflows at 768px breakpoint. Mobile bottom nav appears below 768px.

---

*Every screen is a view into the graph. The layout follows the data. The data IS the design.*
